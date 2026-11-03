import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { SinoNotificacoes } from './SinoNotificacoes'
import { api, AUTH_CREDENTIALS_KEY } from '../lib/api'
import type { Notificacao } from '../lib/types'

const contexto = vi.hoisted(() => ({ sessao: 'conta-a', eventos: new Map<string, (msg: unknown) => void>() }))
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), getSessionIdentity: () => contexto.sessao, api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../lib/ws', () => ({ wsClient: { on: (evento: string, fn: (msg: unknown) => void) => { contexto.eventos.set(evento, fn); return () => contexto.eventos.delete(evento) } } }))
const aviso: Notificacao = { id: 7, organization_id: 3, office_slug: 'conteudo', tipo: 'job_done', titulo: 'Seu pedido está pronto', corpo: '', job_id: 35, lida: false, criado_em: '2026-10-07T12:00:00Z' }
const dialogPrototype = HTMLDialogElement.prototype
const metodosDialogo = Object.fromEntries(['showModal', 'close'].map(nome => [nome, Object.getOwnPropertyDescriptor(dialogPrototype, nome)]))
beforeAll(() => Object.defineProperties(dialogPrototype, {
  showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } },
  close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } },
}))
afterAll(() => {
  for (const [nome, descriptor] of Object.entries(metodosDialogo)) {
    if (descriptor) Object.defineProperty(dialogPrototype, nome, descriptor)
    else Reflect.deleteProperty(dialogPrototype, nome)
  }
})
function Endereco() { return <output aria-label="Destino da notificação">{useLocation().search}</output> }
const montar = (n: Notificacao = aviso) => {
  vi.mocked(api.get).mockResolvedValue([n])
  return render(<MemoryRouter initialEntries={['/app?org=9&slug=financeiro&conversa=22']}><Endereco /><SinoNotificacoes /></MemoryRouter>)
}
beforeEach(() => { vi.clearAllMocks(); contexto.sessao = 'conta-a'; contexto.eventos.clear(); vi.mocked(api.get).mockReset(); vi.mocked(api.post).mockReset().mockResolvedValue({}) })

const abrir = () => fireEvent.click(screen.getByRole('button', { name: /^Notificações/ }))
const montarConsulta = () => render(<MemoryRouter><SinoNotificacoes /></MemoryRouter>)

it('uma consulta pendente não afirma que todas as notificações foram lidas', async () => {
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}))
  montarConsulta(); abrir()
  expect(screen.queryByText('Tudo em dia por aqui.')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Carregando notificações')
})

it('falha inicial mostra recuperação e só confirma lista vazia após resposta', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('Sem conexão')).mockResolvedValueOnce([])
  montarConsulta(); abrir()
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar as notificações')
  expect(screen.queryByText('Tudo em dia por aqui.')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('Tudo em dia por aqui.')).toBeInTheDocument()
})

it('uma falha de atualização conserva os avisos já consultados', async () => {
  montar()
  await screen.findByRole('button', { name: 'Notificações: 1 não lidas' })
  vi.mocked(api.get).mockRejectedValueOnce(new Error('Sem conexão'))
  await act(async () => contexto.eventos.get('_conectado')?.({}))
  abrir()
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar as notificações')
  expect(screen.getByRole('button', { name: /Seu pedido está pronto/ })).toBeInTheDocument()
})

it('falha ao marcar todas mantém os avisos não lidos e permite repetir a ação', async () => {
  montar(); await screen.findByRole('button', { name: 'Notificações: 1 não lidas' }); abrir()
  vi.mocked(api.post).mockRejectedValueOnce(new Error('Resposta perdida'))
  fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar a leitura')
  expect(screen.getByRole('button', { name: 'Notificações: 1 não lidas' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument())
  expect(api.post).toHaveBeenCalledTimes(2)
})

it('abrir aviso com leitura incerta continua navegando e conserva a indicação não lida', async () => {
  montar(); await screen.findByRole('button', { name: 'Notificações: 1 não lidas' }); abrir()
  vi.mocked(api.post).mockRejectedValueOnce(new Error('Resposta perdida'))
  fireEvent.click(screen.getByRole('button', { name: /Seu pedido está pronto/ }))
  expect(screen.getByLabelText('Destino da notificação')).toHaveTextContent('trabalho=35')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Notificações: 1 não lidas' })).toBeInTheDocument())
  abrir()
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar a leitura')
})

it('resposta da conta anterior não aparece após a troca de sessão', async () => {
  let responderAntiga!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { responderAntiga = resolve })).mockResolvedValueOnce([])
  montarConsulta(); abrir()
  contexto.sessao = 'conta-b'
  fireEvent.focus(window)
  await act(async () => responderAntiga([aviso]))
  abrir()
  expect(screen.queryByRole('button', { name: /Seu pedido está pronto/ })).not.toBeInTheDocument()
  expect(await screen.findByText('Tudo em dia por aqui.')).toBeInTheDocument()
})

it('confirmação antiga não marca a lista recebida na conta nova', async () => {
  let confirmar!: (valor: unknown) => void
  montar(); await screen.findByRole('button', { name: 'Notificações: 1 não lidas' }); abrir()
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { confirmar = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))
  contexto.sessao = 'conta-b'
  const nova = { ...aviso, titulo: 'Aviso da conta atual' }
  vi.mocked(api.get).mockResolvedValueOnce([nova])
  fireEvent.focus(window)
  await act(async () => confirmar({}))
  await screen.findByRole('button', { name: 'Notificações: 1 não lidas' }); abrir()
  expect(screen.getByRole('button', { name: /Aviso da conta atual/ })).toHaveClass('nao-lida')
})

it('marcar todas não confirma um novo aviso que chegou durante a ação', async () => {
  let confirmar!: (valor: unknown) => void
  montar(); await screen.findByRole('button', { name: 'Notificações: 1 não lidas' }); abrir()
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { confirmar = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))
  act(() => contexto.eventos.get('notificacao')?.({ notificacao: { ...aviso, id: 8, titulo: 'Novo aviso' } }))
  await act(async () => confirmar({}))
  expect(screen.getByRole('button', { name: /Novo aviso/ })).toHaveClass('nao-lida')
  expect(screen.getByRole('button', { name: 'Notificações: 1 não lidas' })).toBeInTheDocument()
})

it('uma consulta iniciada antes do aviso ao vivo não faz o aviso desaparecer', async () => {
  let responder!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { responder = resolve }))
  montarConsulta(); abrir()
  act(() => contexto.eventos.get('notificacao')?.({ notificacao: aviso }))
  await act(async () => responder([]))
  expect(screen.getByRole('button', { name: /Seu pedido está pronto/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Notificações: 1 não lidas' })).toBeInTheDocument()
})

it('uma consulta antiga não reverte a leitura confirmada enquanto estava em andamento', async () => {
  montar(); await screen.findByRole('button', { name: 'Notificações: 1 não lidas' }); abrir()
  let responder!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { responder = resolve }))
  act(() => contexto.eventos.get('_conectado')?.({}))
  fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument())
  await act(async () => responder([aviso]))
  expect(screen.getByRole('button', { name: /Seu pedido está pronto/ })).not.toHaveClass('nao-lida')
})

it('clicar num aviso da sessão antiga não navega usando a conta nova', async () => {
  montar(); await screen.findByRole('button', { name: 'Notificações: 1 não lidas' }); abrir()
  contexto.sessao = 'conta-b'
  fireEvent.click(screen.getByRole('button', { name: /Seu pedido está pronto/ }))
  expect(screen.getByLabelText('Destino da notificação')).toHaveTextContent('conversa=22')
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['job_done', 'job_failed', 'entrega_pendente'])('aviso %s abre o trabalho exato na empresa correta', async tipo => {
  montar({ ...aviso, tipo })
  fireEvent.click(await screen.findByRole('button', { name: 'Notificações: 1 não lidas' }))
  fireEvent.click(screen.getByRole('button', { name: /Seu pedido está pronto/ }))
  expect(screen.getByLabelText('Destino da notificação')).toHaveTextContent('?org=3&vista=biblioteca&trabalho=35')
  expect(screen.getByLabelText('Destino da notificação')).not.toHaveTextContent('conversa=22')
  expect(screen.getByLabelText('Destino da notificação')).not.toHaveTextContent('slug=')
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/notificacoes/7/ler'))
})

it('aviso legado sem trabalho abre a biblioteca, sem inventar uma versão', async () => {
  montar({ ...aviso, job_id: null })
  fireEvent.click(await screen.findByRole('button', { name: 'Notificações: 1 não lidas' }))
  fireEvent.click(screen.getByRole('button', { name: /Seu pedido está pronto/ }))
  expect(screen.getByLabelText('Destino da notificação')).toHaveTextContent('?org=3&vista=biblioteca')
  expect(screen.getByLabelText('Destino da notificação')).not.toHaveTextContent('trabalho=')
})

it('o painel informa expansão e Escape retorna o foco ao sino', async () => {
  montar()
  const sino = await screen.findByRole('button', { name: 'Notificações: 1 não lidas' })
  expect(sino).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(sino)
  const painel = screen.getByRole('region', { name: 'Notificações' })
  expect(sino).toHaveAttribute('aria-expanded', 'true')
  expect(sino).toHaveAttribute('aria-controls', painel.id)
  screen.getByRole('button', { name: /Seu pedido está pronto/ }).focus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('region', { name: 'Notificações' })).not.toBeInTheDocument()
  expect(sino).toHaveFocus()
})

it('evento atômico de outra conta fecha avisos antigos e consulta a conta nova', async () => {
  montar(); await screen.findByRole('button', { name: 'Notificações: 1 não lidas' }); abrir()
  vi.mocked(api.get).mockResolvedValue([])
  contexto.sessao = 'conta-b'
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CREDENTIALS_KEY, storageArea: localStorage })))
  expect(screen.queryByRole('region', { name: 'Notificações' })).not.toBeInTheDocument()
  abrir()
  expect(await screen.findByText('Tudo em dia por aqui.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Seu pedido está pronto/ })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

function montarLimpeza(lista: Notificacao[] = [aviso], org: number | null = 3) {
  vi.mocked(api.get).mockResolvedValue(lista)
  return render(<MemoryRouter initialEntries={[org === null ? '/app' : `/app?org=${org}`]}><TrocarCliente /><SinoNotificacoes /></MemoryRouter>)
}

function TrocarCliente() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/app?org=4')}>Trocar cliente</button>
}

async function pedirLimpeza() {
  fireEvent.click(await screen.findByRole('button', { name: /^Notificações/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Limpar notificações' }))
  return screen.findByRole('dialog', { name: 'Limpar notificações?' })
}

async function confirmarLimpeza() {
  const dialogo = await pedirLimpeza()
  await act(async () => fireEvent.click(within(dialogo).getByRole('button', { name: 'Limpar notificações' })))
}

it('limpeza pede confirmação pessoal e cancelar não altera nem envia', async () => {
  montarLimpeza()
  const dialogo = await pedirLimpeza()
  expect(dialogo).toHaveTextContent('Os avisos deste cliente serão ocultados só para você')
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
  expect(api.post).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: /Seu pedido está pronto/ })).toBeInTheDocument()
})

it('limpeza aguarda resposta e preserva outro cliente e aviso novo durante a chamada', async () => {
  let confirmar!: (valor: unknown) => void
  montarLimpeza([aviso, { ...aviso, id: 9, organization_id: 4, titulo: 'Outro cliente' }])
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { confirmar = resolve }))
  await confirmarLimpeza()
  expect(api.post).toHaveBeenCalledWith('/notificacoes/limpar', { ids: [7], organization_id: 3 })
  expect(screen.getByRole('button', { name: /Seu pedido está pronto/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Limpando…' })).toBeDisabled()
  act(() => contexto.eventos.get('notificacao')?.({ notificacao: { ...aviso, id: 8, titulo: 'Novo aviso' } }))
  await act(async () => confirmar({ ok: true, notificacoes_ids: [7] }))
  expect(screen.queryByRole('button', { name: /Seu pedido está pronto/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Outro cliente/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Novo aviso/ })).toHaveClass('nao-lida')
  expect(screen.getByRole('button', { name: 'Notificações: 2 não lidas' })).toBeInTheDocument()
})

it('aviso que chega durante a confirmação fica fora do snapshot', async () => {
  montarLimpeza()
  const dialogo = await pedirLimpeza()
  act(() => contexto.eventos.get('notificacao')?.({ notificacao: { ...aviso, id: 8, titulo: 'Novo aviso' } }))
  vi.mocked(api.post).mockResolvedValue({ ok: true, notificacoes_ids: [7] })
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Limpar notificações' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/notificacoes/limpar', { ids: [7], organization_id: 3 }))
  expect(screen.getByRole('button', { name: /Novo aviso/ })).toBeInTheDocument()
})

it('falha de limpeza conserva avisos e permite tentar novamente', async () => {
  montarLimpeza()
  vi.mocked(api.post).mockRejectedValueOnce(new Error('Resposta perdida'))
  await confirmarLimpeza()
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível limpar')
  expect(screen.getByRole('button', { name: /Seu pedido está pronto/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Limpar notificações' }))
  const dialogo = await screen.findByRole('dialog', { name: 'Limpar notificações?' })
  vi.mocked(api.post).mockResolvedValueOnce({ ok: true, notificacoes_ids: [7] })
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Limpar notificações' }))
  expect(await screen.findByText('Tudo em dia por aqui.')).toBeInTheDocument()
})

it('consulta antiga e evento repetido não ressuscitam aviso limpo confirmado', async () => {
  let consultar!: (valor: unknown) => void
  montarLimpeza(); await screen.findByRole('button', { name: 'Notificações: 1 não lidas' })
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { consultar = resolve }))
  act(() => contexto.eventos.get('_conectado')?.({}))
  vi.mocked(api.post).mockResolvedValueOnce({ ok: true, notificacoes_ids: [7] })
  await confirmarLimpeza()
  await waitFor(() => expect(screen.queryByRole('button', { name: /Seu pedido está pronto/ })).not.toBeInTheDocument())
  await act(async () => consultar([aviso]))
  act(() => contexto.eventos.get('notificacao')?.({ notificacao: aviso }))
  expect(screen.queryByRole('button', { name: /Seu pedido está pronto/ })).not.toBeInTheDocument()
})

it('resposta tardia de limpeza não apaga avisos da nova conta', async () => {
  let confirmar!: (valor: unknown) => void
  montarLimpeza()
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { confirmar = resolve }))
  await confirmarLimpeza()
  contexto.sessao = 'conta-b'
  vi.mocked(api.get).mockResolvedValueOnce([{ ...aviso, titulo: 'Conta nova' }])
  await act(async () => fireEvent.focus(window))
  await act(async () => confirmar({ ok: true, notificacoes_ids: [7] }))
  fireEvent.click(await screen.findByRole('button', { name: 'Notificações: 1 não lidas' }))
  expect(screen.getByRole('button', { name: /Conta nova/ })).toBeInTheDocument()
})

it('trocar sessão antes de confirmar não envia snapshot com credencial nova', async () => {
  montarLimpeza()
  const dialogo = await pedirLimpeza()
  contexto.sessao = 'conta-b'
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Limpar notificações' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.post).not.toHaveBeenCalled()
})

it('resposta que não confirma os IDs mantém o aviso e mostra erro', async () => {
  montarLimpeza()
  vi.mocked(api.post).mockResolvedValueOnce({ ok: true, notificacoes_ids: [999] })
  await confirmarLimpeza()
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível limpar')
  expect(screen.getByRole('button', { name: /Seu pedido está pronto/ })).toBeInTheDocument()
})

it('sem cliente selecionado confirma limpeza só da lista própria', async () => {
  montarLimpeza([aviso], null)
  const dialogo = await pedirLimpeza()
  expect(dialogo).toHaveTextContent('Os avisos desta lista serão ocultados só para você')
  vi.mocked(api.post).mockResolvedValueOnce({ ok: true, notificacoes_ids: [7] })
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Limpar notificações' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/notificacoes/limpar', { ids: [7], organization_id: null }))
})

it('trocar cliente fecha confirmação sem enviar o snapshot anterior', async () => {
  montarLimpeza()
  await pedirLimpeza()
  fireEvent.click(screen.getByRole('button', { name: 'Trocar cliente' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.post).not.toHaveBeenCalled()
})

it('resposta tardia do cliente anterior não escreve no novo contexto', async () => {
  let confirmar!: (valor: unknown) => void
  montarLimpeza([aviso, { ...aviso, id: 9, organization_id: 4, titulo: 'Cliente atual' }])
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { confirmar = resolve }))
  await confirmarLimpeza()
  fireEvent.click(screen.getByRole('button', { name: 'Trocar cliente' }))
  await act(async () => confirmar({ ok: true, notificacoes_ids: [7] }))
  expect(screen.getByRole('button', { name: /Cliente atual/ })).toHaveClass('nao-lida')
  expect(screen.queryByText('Notificações selecionadas limpas. Os trabalhos continuam disponíveis.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Seu pedido está pronto/ })).toBeInTheDocument()
})

it('sucesso já confirmado não aparece depois de trocar cliente', async () => {
  montarLimpeza([aviso, { ...aviso, id: 9, organization_id: 4, titulo: 'Cliente atual' }])
  vi.mocked(api.post).mockResolvedValueOnce({ ok: true, notificacoes_ids: [7] })
  await confirmarLimpeza()
  expect(screen.getByRole('status')).toHaveTextContent('Notificações selecionadas limpas')
  fireEvent.click(screen.getByRole('button', { name: 'Trocar cliente' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Cliente atual/ })).toBeInTheDocument()
})

it('erro já recebido não aparece depois de trocar cliente', async () => {
  montarLimpeza([aviso, { ...aviso, id: 9, organization_id: 4, titulo: 'Cliente atual' }])
  vi.mocked(api.post).mockRejectedValueOnce(new Error('Sem conexão'))
  await confirmarLimpeza()
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível limpar')
  fireEvent.click(screen.getByRole('button', { name: 'Trocar cliente' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('resposta com ID duplicado que omite um alvo não limpa nenhum aviso', async () => {
  montarLimpeza([aviso, { ...aviso, id: 8, titulo: 'Segundo aviso' }])
  vi.mocked(api.post).mockResolvedValueOnce({ ok: true, notificacoes_ids: [7, 7] })
  await confirmarLimpeza()
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível limpar')
  expect(screen.getByRole('button', { name: /Seu pedido está pronto/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Segundo aviso/ })).toBeInTheDocument()
})
