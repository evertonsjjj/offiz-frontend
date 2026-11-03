import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import ConteudoEditorial, { type PecaEditorial } from './ConteudoEditorial'
import { api } from '../../lib/api'
const traducao = vi.hoisted(() => ({ idioma: 'pt-BR' as 'pt-BR' | 'en', pt: (pt: string) => pt, en: (_pt: string, en: string) => en }))
vi.mock('../../lib/i18n', () => ({ useIdioma: () => ({ idioma: traducao.idioma, t: traducao.idioma === 'en' ? traducao.en : traducao.pt }) }))
vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, baixarArquivo: vi.fn() }))
vi.mock('./ResultadoEntrega', () => ({ default: () => <div>Arte da peça</div> }))
const peca: PecaEditorial = { id: 5, titulo: 'Post da semana', canal: 'instagram', data_planejada: '2026-09-10', briefing: 'Coleção nova', estado: 'em_revisao', job_id: 8, job_status: 'done', revisao_aprovada_id: null, variante_aprovada: 0, nova_revisao: false, publicado_em: null, link_publicacao: null, metricas: {}, revisoes: [{ id: 9, job_id: 8, criado_em: '2026-09-08', titulo: 'Post', canal: 'instagram', legendas: [{ nome: 'Direta', texto: 'Veja a coleção.' }, { nome: 'Leve', texto: 'Sua próxima escolha chegou.' }], arquivos: [{ entrega_id: 4, nome: 'arte.png', mime: 'image/png', tamanho_bytes: 200 }], qualidade: { avisos: ['Falta checagem da marca'], nota: 'Conferência automática' } }] }
beforeEach(() => { traducao.idioma = 'pt-BR'; vi.clearAllMocks(); vi.mocked(api.get).mockResolvedValue([peca]); vi.mocked(api.post).mockResolvedValue(peca) })
it('aprova a peça e a legenda selecionadas só depois de conferir pendências', async () => {
  render(<ConteudoEditorial orgId={2} />)
  fireEvent.click(await screen.findByText('Post da semana'))
  fireEvent.change(screen.getByLabelText('Legenda'), { target: { value: '1' } })
  expect(screen.getByDisplayValue('Sua próxima escolha chegou.')).toBeInTheDocument()
  expect(screen.getByText('Aprovar esta peça')).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByText('Aprovar esta peça'))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/2/conteudo/editorial/5/aprovar', { revisao_id: 9, variante: 1, ciente_pendencias: true }))
})
it('cria uma pauta sem disparar produção nem publicação', async () => {
  render(<ConteudoEditorial orgId={2} />)
  fireEvent.click(screen.getByText('+ Nova pauta'))
  fireEvent.change(screen.getByLabelText('Pauta'), { target: { value: 'Nova pauta' } })
  fireEvent.click(screen.getByText('Guardar pauta'))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/2/conteudo/editorial', { titulo: 'Nova pauta', canal: 'instagram', data_planejada: null, briefing: '' }))
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('inglês preserva títulos, variantes e legenda original ao aprovar', async () => {
  traducao.idioma = 'en'
  render(<ConteudoEditorial orgId={2} />)
  fireEvent.click(await screen.findByText('Post da semana'))
  expect(screen.getByRole('heading', { name: 'From brief to publication' })).toBeInTheDocument()
  expect(screen.getByText('Coleção nova')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Caption'), { target: { value: '1' } })
  expect(screen.getByRole('option', { name: 'Leve' })).toBeInTheDocument()
  expect(screen.getByDisplayValue('Sua próxima escolha chegou.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByText('Approve this deliverable'))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/2/conteudo/editorial/5/aprovar', { revisao_id: 9, variante: 1, ciente_pendencias: true }))
  expect(peca.revisoes[0].legendas[1]).toEqual({ nome: 'Leve', texto: 'Sua próxima escolha chegou.' })
})

it('120 trabalhos: busca alcança o fim da lista e filtro combina com o assunto', async () => {
  vi.mocked(api.get).mockResolvedValue(Array.from({ length: 120 }, (_, i) => ({ ...peca, id: i + 100, titulo: i === 119 ? 'Coleção de verão — última entrega' : `Trabalho ${i}`, estado: i === 119 ? 'aprovado' : 'planejado' })))
  render(<ConteudoEditorial orgId={2} />)
  await screen.findByText('Trabalho 0')
  expect(screen.queryByText('Trabalho 24')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Mostrar mais trabalhos'))
  expect(screen.getByText('Trabalho 24')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'colecao de verao' } })
  expect(await screen.findByText('Coleção de verão — última entrega')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Planejado' }))
  expect(screen.getByText('Nenhuma peça neste filtro.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Aprovado' }))
  expect(screen.getByText('Coleção de verão — última entrega')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})
