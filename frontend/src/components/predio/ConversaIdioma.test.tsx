import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { IdiomaProvider, useIdioma } from '../../lib/i18n'
import { ConversaTab } from './ConversaTab'
import { PainelTrabalho } from './PainelTrabalho'
import type { ReactNode } from 'react'

vi.mock('../../lib/api', async (original) => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() },
  baixarArquivo: vi.fn(),
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))
const toasts = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }))
vi.mock('../Toasts', () => ({ useToasts: () => toasts }))
vi.mock('./ResultadoEntrega', () => ({ default: ({ nome }: { nome: string }) => <div>Preview: {nome}</div> }))

const office = { slug: 'predio', nome: 'Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const conversa = { id: 42, titulo: 'Planejamento da campanha', atualizado_em: '2026-09-09T12:00:00Z', total_mensagens: 0, mensagens: [], anexos: [] }
const job = { id: 77, status: 'done', titulo: 'Vídeo da campanha', office_slug: 'conteudo' }
const entrega = { id: 9, job_id: 77, nome: 'campanha-com-legenda.mp4', tamanho_bytes: 1536, mime: 'video/mp4', status: 'pendente', tipo: 'arquivo' }

function TrocarIdioma() {
  const { definirPreferencia } = useIdioma()
  return <><button onClick={() => void definirPreferencia('en')}>English</button><button onClick={() => void definirPreferencia('pt-BR')}>Português</button></>
}
const montar = (children: ReactNode) => render(<MemoryRouter><IdiomaProvider><TrocarIdioma />{children}</IdiomaProvider></MemoryRouter>)

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('pt-BR')
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/conversas/42') return conversa
    if (path === '/jobs/77') return job
    if (path.endsWith('/entregas')) return { entregas: [entrega] }
    if (path === '/orgs/1/biblioteca/77') return { arquivos: [entrega] }
    return { conversas: [] }
  })
  vi.mocked(api.post).mockImplementation(async (path) => path.endsWith('/mensagens')
    ? { mensagem: { id: 10, role: 'assistant', conteudo: 'Esta resposta continua no idioma do pedido.' } }
    : conversa)
})
afterEach(() => { vi.restoreAllMocks(); delete window.offizMotor })

it.each(['pt-BR', 'en'])('feedback jurídico usa o dispositivo e informa análise ausente (%s)', async idioma => {
  localStorage.setItem('offiz:idioma:visitante', idioma)
  window.offizMotor = { chatDeviceId: 'dispositivo-local-fixture' } as NonNullable<typeof window.offizMotor>
  const detalhe = { ...conversa, mensagens: [{ id: 10, role: 'assistant', conteudo: 'Minuta jurídica sintética para revisão.', criado_em: new Date().toISOString() }] }
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42' ? detalhe
    : path.endsWith('/casos') ? [] : { conversas: [conversa] })
  vi.mocked(api.post).mockResolvedValue({ feedback: { id: 5 }, conflito: null, analise_conflito: 'nao_realizada' })
  montar(<ConversaTab orgId={1} slug="juris" office={{ ...office, slug: 'juris' }} />)
  fireEvent.click(await screen.findByRole('button', { name: /^Planejamento da campanha/ }))
  fireEvent.click(await screen.findByRole('button', { name: idioma === 'en' ? 'Rate response as poor' : 'Avaliar resposta como ruim' }))
  fireEvent.change(screen.getByPlaceholderText(idioma === 'en'
    ? 'What was wrong or missing? (optional — helps the office learn)'
    : 'O que estava errado ou faltou? (opcional — ajuda o escritório a aprender)'), { target: { value: 'Use menos adjetivos.' } })
  fireEvent.click(screen.getByRole('button', { name: idioma === 'en' ? 'Send feedback' : 'Enviar feedback' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/1/juris/feedbacks', expect.objectContaining({
    motor_local: 'dispositivo-local-fixture', conversa_id: 42, referencia_id: 10, comentario: 'Use menos adjetivos.',
  })))
  await waitFor(() => expect(toasts.sucesso).toHaveBeenCalledWith(expect.stringContaining(idioma === 'en'
    ? 'Conflicts with the guidelines were not checked' : 'A conferência de conflito com as diretrizes não foi realizada')))
  expect(screen.queryByText(idioma === 'en' ? '⚠️ This conflicts with the office’s playbook:' : '⚠️ Isso conflita com o playbook do escritório:')).not.toBeInTheDocument()
})

it('resposta tardia da conferência não aparece depois de mudar de conversa', async () => {
  const detalhe = { ...conversa, mensagens: [{ id: 10, role: 'assistant', conteudo: 'Minuta para revisão.', criado_em: new Date().toISOString() }] }
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42' ? detalhe
    : path.endsWith('/casos') ? [] : { conversas: [conversa] })
  let concluir!: (value: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  montar(<ConversaTab orgId={1} slug="juris" office={{ ...office, slug: 'juris' }} />)
  fireEvent.click(await screen.findByRole('button', { name: /^Planejamento da campanha/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Avaliar resposta como boa' }))
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  await act(async () => concluir({ feedback: { id: 5 }, conflito: null, analise_conflito: 'nao_realizada' }))
  expect(toasts.sucesso).not.toHaveBeenCalled()
  expect(toasts.falha).not.toHaveBeenCalled()
})

it('muda a interface sem remontar o chat, apagar rascunho ou traduzir o pedido enviado', async () => {
  montar(<ConversaTab orgId={1} slug="predio" office={office} nivelPredio />)
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  const original = 'Quero manter este pedido em português. Cliente: João.'
  fireEvent.change(campo, { target: { value: original } })
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(await screen.findByRole('textbox', { name: 'Your request' })).toBe(campo)
  expect(campo).toHaveValue(original)
  expect(screen.getByRole('button', { name: 'New conversation' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Attach' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'From library' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Speak instead of typing' })).toHaveTextContent('Speak')
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText('Esta resposta continua no idioma do pedido.')
  expect(api.post).toHaveBeenCalledWith('/conversas/42/mensagens', expect.objectContaining({ conteudo: original }))
  expect(vi.mocked(api.post).mock.calls.some(([path]) => path.includes('/jobs'))).toBe(false)
  fireEvent.change(campo, { target: { value: 'Observação adicional, ainda sem enviar.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Português' }))
  expect(await screen.findByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Observação adicional, ainda sem enviar.')
  expect(screen.getByText('Esta resposta continua no idioma do pedido.')).toBeInTheDocument()
})

it('histórico e cartão de entrega usam controles em inglês sem alterar dados ou estado de produção', async () => {
  localStorage.setItem('offiz:idioma:visitante', 'en')
  const detalhe = { ...conversa, mensagens: [{ id: 10, role: 'assistant', conteudo: 'Revise a proposta com sua equipe.', criado_em: new Date().toISOString(), sugestao_tarefa: { peca: { slug: 'campanha', titulo: 'Peça em português', estado: 'com plano' }, perguntas: ['Prefiro manter a proposta original.'] } }] }
  vi.mocked(api.get).mockImplementation(async (path) => path === '/conversas/42' ? detalhe : { conversas: [conversa] })
  const abrirPeca = vi.fn()
  montar(<ConversaTab orgId={1} slug="predio" office={office} nivelPredio aoVerPeca={abrirPeca} />)
  fireEvent.click(await screen.findByRole('button', { name: /^Planejamento da campanha/ }))
  await screen.findByText('Revise a proposta com sua equipe.')
  expect(screen.getByText('just now')).toBeInTheDocument()
  expect(screen.getByText('plan in Studio')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Peça em português.*open/ }))
  expect(abrirPeca).toHaveBeenCalledWith('campanha')
  expect(screen.getByRole('button', { name: 'Prefiro manter a proposta original.' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /start the task/ })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('modos jurídicos e seletor de contrato ficam em inglês sem mudar o modo enviado', async () => {
  localStorage.setItem('offiz:idioma:visitante', 'en')
  montar(<ConversaTab orgId={1} slug="juris" office={{ ...office, slug: 'juris' }} />)
  fireEvent.click(screen.getByRole('button', { name: /^Contract review/ }))
  expect(screen.getByRole('button', { name: /Upload the contract — drop it here or click/ })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Your request' })).toHaveAttribute('placeholder', 'Upload the contract above or type your question…')
  fireEvent.change(screen.getByRole('textbox', { name: 'Your request' }), { target: { value: 'Explique a cláusula em português.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/1/juris/conversas', { modo: 'contrato' }))
})

it('painel traduz ações, versões e sugestão de ajuste, preservando nomes e seleção', async () => {
  localStorage.setItem('offiz:idioma:visitante', 'en')
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/jobs/77') return job
    if (path === '/orgs/1/biblioteca/77') return { arquivos: [entrega, { ...entrega, id: 10, nome: 'campanha-sem-legenda.mp4' }] }
    throw new Error(`Consulta inesperada: ${path}`)
  })
  const ajustar = vi.fn()
  montar(<PainelTrabalho orgId={1} slug="predio" jobId={77} aoAjustar={ajustar} aoFechar={vi.fn()} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'without captions' }))
  expect(screen.getByText('Vídeo da campanha')).toBeInTheDocument()
  expect(screen.getByText('to review')).toBeInTheDocument()
  expect(screen.getByText('1.5 KB')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Review and approve deliverables' })).toHaveAttribute('href', '/app?org=1&vista=biblioteca&trabalho=77&arquivo=10')
  fireEvent.click(screen.getByRole('button', { name: 'Request adjustment' }))
  expect(ajustar).toHaveBeenCalledWith('About “campanha-sem-legenda.mp4”, I would like to change: ', 10)
  fireEvent.click(screen.getByRole('button', { name: 'Português' }))
  expect(await screen.findByRole('tab', { name: 'sem legenda' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('Preview: campanha-sem-legenda.mp4')).toBeInTheDocument()
  expect(screen.getByText('1,5 KB')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  expect(ajustar).toHaveBeenLastCalledWith('Sobre “campanha-sem-legenda.mp4”, quero ajustar: ', 10)
  expect(api.post).not.toHaveBeenCalled()
})

it('painel mostra falha em inglês mantendo a explicação original do trabalho', async () => {
  localStorage.setItem('offiz:idioma:visitante', 'en')
  vi.mocked(api.get).mockImplementation(async (path) => path === '/jobs/77' ? { ...job, status: 'failed', erro: 'O cliente precisa enviar a foto original.' } : { arquivos: [] })
  montar(<PainelTrabalho orgId={1} slug="predio" jobId={77} aoAjustar={vi.fn()} aoFechar={vi.fn()} />)
  expect(await screen.findByText('This task stopped before finishing. Files that were saved remain available.')).toBeInTheDocument()
  const detalhes = screen.getByText('Technical details').closest('details')!
  expect(detalhes).not.toHaveAttribute('open')
  fireEvent.click(screen.getByText('Technical details'))
  expect(screen.getByText('O cliente precisa enviar a foto original.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Back to conversation' })).toBeInTheDocument()
})

it.each([
  { recorrencia: 'semanal', dia: 0, hora: '09:00', data: null, esperado: 'every Monday at 09:00' },
  { recorrencia: 'mensal', dia: 5, hora: '09:00', data: null, esperado: 'on day 5 of every month at 09:00' },
  { recorrencia: 'uma_vez', dia: 9, hora: '09:00', data: '2026-09-15', esperado: 'on 09/15 at 09:00, once' },
])('apresenta agenda $recorrencia em inglês sem reinterpretar os valores da recorrência', async ({ esperado, ...quando }) => {
  localStorage.setItem('offiz:idioma:visitante', 'en')
  const sugestao = { tipo: 'agendamento', titulo: 'Relatório da equipe', prompt: 'Prepare o relatório em português.', ...quando }
  const detalhe = { ...conversa, mensagens: [{ id: 10, role: 'assistant', conteudo: 'Confirme o horário proposto.', sugestao_tarefa: sugestao }] }
  vi.mocked(api.get).mockImplementation(async (path) => path === '/conversas/42' ? detalhe : { conversas: [conversa] })
  montar(<ConversaTab orgId={1} slug="conteudo" office={{ ...office, slug: 'conteudo' }} />)
  fireEvent.click(await screen.findByRole('button', { name: /^Planejamento da campanha/ }))
  expect(await screen.findByText(esperado)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Yes, schedule it' })).toBeInTheDocument()
  expect(screen.getByText(esperado).closest('p')).toHaveTextContent('Relatório da equipe')
  expect(sugestao).toMatchObject(quando)
  expect(api.post).not.toHaveBeenCalled()
})
