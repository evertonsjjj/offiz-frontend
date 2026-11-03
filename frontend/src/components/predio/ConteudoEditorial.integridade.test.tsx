import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ConteudoEditorial, { type PecaEditorial } from './ConteudoEditorial'
import { api, baixarArquivo } from '../../lib/api'

const idioma = vi.hoisted(() => ({ atual: 'pt-BR', pt: (pt: string) => pt, en: (_pt: string, en: string) => en }))
vi.mock('../../lib/i18n', () => ({ useIdioma: () => ({ idioma: idioma.atual, t: idioma.atual === 'en' ? idioma.en : idioma.pt }) }))
vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, baixarArquivo: vi.fn() }))
vi.mock('./ResultadoEntrega', () => ({ default: ({ entregaId }: { entregaId: number }) => <div>Arquivo {entregaId}</div> }))

const original: PecaEditorial = {
  id: 5, titulo: 'Coleção de domingo', canal: 'instagram', data_planejada: null,
  briefing: 'Mostrar os detalhes da camisa.', estado: 'em_revisao', job_id: 8,
  job_status: 'done', revisao_aprovada_id: null, variante_aprovada: 0,
  nova_revisao: false, publicado_em: null, link_publicacao: null, metricas: {},
  revisoes: [{ id: 9, job_id: 8, criado_em: '2026-10-09', titulo: 'Camisa', canal: 'instagram',
    legendas: [{ nome: 'Direta', texto: 'Detalhes da nossa camisa.' }],
    arquivos: [{ entrega_id: 4, nome: 'camisa.png', mime: 'image/png', tamanho_bytes: 200 }],
    qualidade: { avisos: [], nota: 'Conferência' } }],
}

function pendente<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

let atualizarLista: () => void
beforeEach(() => {
  idioma.atual = 'pt-BR'
  vi.clearAllMocks()
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(baixarArquivo).mockReset()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const intervaloNativo = window.setInterval
  vi.spyOn(window, 'setInterval').mockImplementation((callback, tempo, ...args) => {
    if (tempo !== 15000) return intervaloNativo.call(window, callback, tempo, ...args)
    if (typeof callback !== 'function') throw new Error('Esperava atualização por função')
    atualizarLista = () => callback()
    return intervaloNativo.call(window, () => {}, tempo)
  })
  vi.mocked(api.get).mockResolvedValue([original])
})
afterEach(() => vi.restoreAllMocks())

it('uma consulta antiga não desfaz o estado aprovado confirmado pela consulta mais recente', async () => {
  const antiga = pendente<PecaEditorial[]>()
  const recente = pendente<PecaEditorial[]>()
  render(<ConteudoEditorial orgId={2} />)
  await screen.findByText(original.titulo)
  vi.mocked(api.get).mockReturnValueOnce(antiga.promise).mockReturnValueOnce(recente.promise)
  act(() => { atualizarLista(); atualizarLista() })
  await act(async () => recente.resolve([{ ...original, estado: 'aprovado' }]))
  expect(screen.getByText('Aprovado', { selector: 'span' })).toBeInTheDocument()
  await act(async () => antiga.resolve([original]))
  expect(screen.getByText('Aprovado', { selector: 'span' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('falha atrasada de consulta substituída não encobre a lista confirmada', async () => {
  const antiga = pendente<PecaEditorial[]>()
  render(<ConteudoEditorial orgId={2} />)
  await screen.findByText(original.titulo)
  vi.mocked(api.get).mockReturnValueOnce(antiga.promise).mockResolvedValueOnce([{ ...original, titulo: 'Consulta atual' }])
  await act(async () => { atualizarLista(); atualizarLista() })
  await act(async () => antiga.reject(new Error('Falha da consulta antiga')))
  expect(screen.getByText('Consulta atual')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('a leitura substituída pela mudança de idioma não apaga as peças atuais', async () => {
  const antiga = pendente<PecaEditorial[]>()
  vi.mocked(api.get).mockReturnValueOnce(antiga.promise).mockResolvedValueOnce([original])
  const view = render(<ConteudoEditorial orgId={2} />)
  idioma.atual = 'en'
  view.rerender(<ConteudoEditorial orgId={2} />)
  await screen.findByText(original.titulo)
  await act(async () => antiga.resolve([]))
  expect(screen.getByText(original.titulo)).toBeInTheDocument()
  expect(screen.queryByText('Save your first brief or request a batch of posts in the conversation. Deliverables will appear here for review.')).not.toBeInTheDocument()
})

it('uma revisão nova na atualização conserva o ajuste digitado e a versão escolhida', async () => {
  render(<ConteudoEditorial orgId={2} />)
  fireEvent.click(await screen.findByText(original.titulo))
  fireEvent.click(screen.getByText('Pedir ajuste nesta peça'))
  fireEvent.change(screen.getByLabelText('Pedido de ajuste'), { target: { value: 'Use uma frase mais curta e mantenha esta foto.' } })
  const nova = { ...original.revisoes[0], id: 10, job_id: 9,
    legendas: [{ nome: 'Nova', texto: 'Uma legenda nova.' }],
    arquivos: [{ entrega_id: 7, nome: 'nova.png', mime: 'image/png', tamanho_bytes: 220 }] }
  vi.mocked(api.get).mockResolvedValueOnce([{ ...original, nova_revisao: true, revisoes: [nova, ...original.revisoes] }])
  await act(async () => atualizarLista())
  expect(screen.getByLabelText('Pedido de ajuste')).toHaveValue('Use uma frase mais curta e mantenha esta foto.')
  expect(screen.getByLabelText('Revisão')).toHaveValue('9')
  expect(screen.getByText('Arquivo 4')).toBeInTheDocument()
  expect(screen.getByDisplayValue('Detalhes da nossa camisa.')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('falha da consulta atual fica explícita e conserva a lista já confirmada', async () => {
  render(<ConteudoEditorial orgId={2} />)
  await screen.findByText(original.titulo)
  vi.mocked(api.get).mockRejectedValueOnce(new Error('O calendário está indisponível agora'))
  await act(async () => atualizarLista())
  expect(screen.getByRole('alert')).toHaveTextContent('O calendário está indisponível agora')
  expect(screen.getByText(original.titulo)).toBeInTheDocument()
  fireEvent.click(screen.getByText('Tentar novamente'))
  await act(async () => {})
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('lista vazia confirmada na consulta atual não conserva uma peça removida', async () => {
  render(<ConteudoEditorial orgId={2} />)
  await screen.findByText(original.titulo)
  vi.mocked(api.get).mockResolvedValueOnce([])
  await act(async () => atualizarLista())
  expect(screen.queryByText(original.titulo)).not.toBeInTheDocument()
  expect(screen.getByText('Guarde a primeira pauta ou peça um lote de posts na conversa. As peças aparecerão aqui para revisão.')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('PEER controle revisão preexistente conserva arte e legenda sem mutações', async()=>{
 render(<ConteudoEditorial orgId={2}/>);fireEvent.click(await screen.findByText(original.titulo));
 expect(screen.getByText('Arquivo 4')).toBeInTheDocument();expect(screen.getByDisplayValue('Detalhes da nossa camisa.')).toBeInTheDocument();
 expect(api.post).not.toHaveBeenCalled();expect(baixarArquivo).not.toHaveBeenCalled();
})
it('PEER primeira revisão que chega no poll aparece no detalhe aberto', async()=>{
 vi.mocked(api.get).mockResolvedValueOnce([{...original,estado:'em_producao',job_status:'running',revisoes:[]}]);
 render(<ConteudoEditorial orgId={2}/>);fireEvent.click(await screen.findByText(original.titulo));
 vi.mocked(api.get).mockResolvedValueOnce([original]);await act(async()=>atualizarLista());
 expect(screen.getByText('Arquivo 4')).toBeInTheDocument();
 expect(screen.queryByText('Produzir esta pauta')).not.toBeInTheDocument();expect(api.post).not.toHaveBeenCalled();
})
it('PEER nova pendência na mesma revisão exige ciência renovada', async()=>{
 const avisada={...original,revisoes:[{...original.revisoes[0],qualidade:{avisos:['Confira a chamada'],nota:'Conferência'}}]};
 vi.mocked(api.get).mockResolvedValueOnce([avisada]);render(<ConteudoEditorial orgId={2}/>);fireEvent.click(await screen.findByText(original.titulo));
 const ciencia=screen.getByRole('checkbox');fireEvent.click(ciencia);expect(ciencia).toBeChecked();
 vi.mocked(api.get).mockResolvedValueOnce([{...avisada,revisoes:[{...avisada.revisoes[0],qualidade:{avisos:['Confira a chamada','Outra pendência nova'],nota:'Conferência'}}]}]);
 await act(async()=>atualizarLista());
 expect(screen.getByRole('checkbox')).not.toBeChecked();
 expect(screen.getByText('Aprovar esta peça')).toBeDisabled();expect(api.post).not.toHaveBeenCalled();
})
it('PEER download paralelo não reabilita outra aprovação ainda pendente', async()=>{
 const aprovacao=pendente<unknown>();const baixar=pendente<void>();
 vi.mocked(api.post).mockReturnValueOnce(aprovacao.promise);
 vi.mocked(baixarArquivo).mockReturnValueOnce(baixar.promise);
 render(<ConteudoEditorial orgId={2}/>);fireEvent.click(await screen.findByText(original.titulo));
 fireEvent.click(screen.getByText('Aprovar esta peça'));expect(screen.getByText('Aprovar esta peça')).toBeDisabled();
 fireEvent.click(screen.getByText('Baixar'));await act(async()=>baixar.resolve());
 expect(screen.getByText('Aprovar esta peça')).toBeDisabled();
 expect(api.post).toHaveBeenCalledTimes(1);await act(async()=>aprovacao.resolve({}));
})

it('ao chegar a primeira revisão, conserva seu ID quando outra revisão é recebida depois', async () => {
  vi.mocked(api.get).mockResolvedValueOnce([{ ...original, estado: 'em_producao', job_status: 'running', revisoes: [] }])
  render(<ConteudoEditorial orgId={2} />)
  fireEvent.click(await screen.findByText(original.titulo))
  vi.mocked(api.get).mockResolvedValueOnce([original])
  await act(async () => atualizarLista())
  expect(screen.getByLabelText('Revisão')).toHaveValue('9')
  const nova = { ...original.revisoes[0], id: 10, arquivos: [{ entrega_id: 7, nome: 'nova.png', mime: 'image/png', tamanho_bytes: 210 }] }
  vi.mocked(api.get).mockResolvedValueOnce([{ ...original, revisoes: [nova, ...original.revisoes] }])
  await act(async () => atualizarLista())
  expect(screen.getByLabelText('Revisão')).toHaveValue('9')
  expect(screen.getByText('Arquivo 4')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('ciência conserva a mesma revisão e avisos, mas não se transfere para outra legenda', async () => {
  const avisada = { ...original, revisoes: [{ ...original.revisoes[0], legendas: [...original.revisoes[0].legendas, { nome: 'Leve', texto: 'Outra legenda.' }], qualidade: { avisos: ['Confira a chamada'], nota: 'Conferência' } }] }
  vi.mocked(api.get).mockResolvedValueOnce([avisada])
  render(<ConteudoEditorial orgId={2} />)
  fireEvent.click(await screen.findByText(original.titulo))
  fireEvent.click(screen.getByRole('checkbox'))
  vi.mocked(api.get).mockResolvedValueOnce([{ ...avisada }])
  await act(async () => atualizarLista())
  expect(screen.getByRole('checkbox')).toBeChecked()
  fireEvent.change(screen.getByLabelText('Legenda'), { target: { value: '1' } })
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(screen.getByText('Aprovar esta peça')).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
})

it('aprovação histórica não presume ciência para aprovar outra legenda com pendências', async () => {
  const aprovada = { ...original, estado: 'aprovado', revisao_aprovada_id: 9, variante_aprovada: 0,
    revisoes: [{ ...original.revisoes[0], legendas: [...original.revisoes[0].legendas, { nome: 'Leve', texto: 'Outra legenda.' }], qualidade: { avisos: ['Confira a chamada'], nota: 'Conferência' } }] }
  vi.mocked(api.get).mockResolvedValueOnce([aprovada])
  render(<ConteudoEditorial orgId={2} />)
  fireEvent.click(await screen.findByText(original.titulo))
  expect(screen.getByText('Esta versão está aprovada')).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Legenda'), { target: { value: '1' } })
  expect(screen.getByText('Aprovar esta peça')).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  vi.mocked(api.post).mockResolvedValueOnce({ ...aprovada, variante_aprovada: 1 })
  fireEvent.click(screen.getByText('Aprovar esta peça'))
  await act(async () => {})
  expect(api.post).toHaveBeenCalledWith('/predios/2/conteudo/editorial/5/aprovar', { revisao_id: 9, variante: 1, ciente_pendencias: true })
  expect(aprovada.revisao_aprovada_id).toBe(9)
  expect(aprovada.variante_aprovada).toBe(0)
})

it('envios simultâneos do ajuste não repetem a ação e uma falha conserva o pedido para tentar de novo', async () => {
  const envio = pendente<unknown>()
  vi.mocked(api.post).mockReturnValueOnce(envio.promise)
  render(<ConteudoEditorial orgId={2} />)
  fireEvent.click(await screen.findByText(original.titulo))
  fireEvent.click(screen.getByText('Pedir ajuste nesta peça'))
  const pedido = 'Encurte a legenda, preservando a foto escolhida.'
  fireEvent.change(screen.getByLabelText('Pedido de ajuste'), { target: { value: pedido } })
  const formulario = screen.getByLabelText('Pedido de ajuste').closest('form')!
  act(() => { fireEvent.submit(formulario); fireEvent.submit(formulario) })
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Enviar ajuste')).toBeDisabled()
  await act(async () => envio.reject(new Error('Não foi possível enviar agora.')))
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível enviar agora.')
  expect(screen.getByLabelText('Pedido de ajuste')).toHaveValue(pedido)
  expect(screen.getByLabelText('Revisão')).toHaveValue('9')
  expect(screen.getByText('Enviar ajuste')).not.toBeDisabled()
  vi.mocked(api.post).mockResolvedValueOnce({})
  fireEvent.submit(formulario)
  await act(async () => {})
  expect(api.post).toHaveBeenCalledTimes(2)
  expect(api.post).toHaveBeenLastCalledWith('/predios/2/conteudo/editorial/5/gerar', { instrucao: pedido, escopo: 'texto', revisao_id: 9 })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByText('Ajuste na fila de produção. A versão anterior continua disponível para revisão.')).toBeInTheDocument()
})
