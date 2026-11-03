import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { instalarDialogoDeTeste } from '../../test/dialog'
import { MonitorTab } from './MonitorTab'

const contexto = vi.hoisted(() => ({ sessao: 'conta-a', sucesso: vi.fn(), falha: vi.fn() }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), getSessionIdentity: () => contexto.sessao, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => contexto }))
instalarDialogoDeTeste()
const processo = { id: 1, numero_cnj: '00000000000000000001', apelido: 'Processo da empresa', prioridade: 'media', eventos_nao_lidos: 1 }
const evento = { id: 3, monitor_id: 1, titulo: 'Movimentação da empresa', importancia: 'normal', lido_em: null }
let processos = [processo]
let eventos = [evento]
const resposta = (url: string) => url.endsWith('/processos') ? { processos } : { eventos }
beforeEach(() => {
  vi.clearAllMocks(); contexto.sessao = 'conta-a'; processos = [processo]; eventos = [evento]
  vi.mocked(api.get).mockImplementation(async url => resposta(url) as never)
  vi.mocked(api.post).mockResolvedValue({})
  vi.mocked(api.del).mockImplementation(async () => { processos = []; eventos = [] })
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('remoção confirma o processo e o descarte dos eventos antes de apagar', async () => {
  render(<MonitorTab orgId={3} slug="juridico" />)
  fireEvent.click(await screen.findByRole('button', { name: 'remover' }))
  expect(screen.getByRole('dialog', { name: 'Parar de monitorar processo' })).toHaveTextContent('Processo da empresa')
  expect(screen.getByRole('dialog')).toHaveTextContent('Os eventos serão descartados')
  fireEvent.click(screen.getByRole('button', { name: 'Parar de monitorar' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/predios/3/juridico/monitor/processos/1'))
  expect(window.confirm).not.toHaveBeenCalled()
})

it('cancelar a remoção conserva o processo e não escreve', async () => {
  render(<MonitorTab orgId={3} slug="juridico" />)
  const origem = await screen.findByRole('button', { name: 'remover' })
  origem.focus(); fireEvent.click(origem)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Cancelar' }), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(origem).toHaveFocus(); expect(api.del).not.toHaveBeenCalled()
})

it('falha de remoção mantém processo e eventos para tentar novamente', async () => {
  vi.mocked(api.del).mockRejectedValueOnce(new Error('Sem conexão'))
  render(<MonitorTab orgId={3} slug="juridico" />)
  fireEvent.click(await screen.findByRole('button', { name: 'remover' }))
  fireEvent.click(screen.getByRole('button', { name: 'Parar de monitorar' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não foi possível remover o processo.'))
  expect(screen.getByRole('button', { name: 'remover' })).toBeEnabled()
  expect(screen.getByText('Movimentação da empresa')).toBeInTheDocument()
})

it('consulta atrasada não mostra os processos da empresa anterior', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url === '/predios/3/juridico/monitor/processos'
    ? new Promise(resolve => { resolver = resolve }) as never
    : url.endsWith('/processos') ? { processos: [{ ...processo, apelido: 'Processo atual' }] } as never : resposta(url) as never)
  const tela = render(<MonitorTab orgId={3} slug="juridico" />)
  tela.rerender(<MonitorTab orgId={4} slug="juridico" />)
  await screen.findByText('Processo atual', { selector: 'strong' })
  await act(async () => resolver({ processos: [processo] }))
  expect(screen.queryByText('Processo da empresa', { selector: 'strong' })).not.toBeInTheDocument()
  expect(screen.getByText('Processo atual', { selector: 'strong' })).toBeInTheDocument()
})

it('a linha do tempo anterior não substitui o processo selecionado', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/eventos')
    ? new Promise(resolve => { resolver = resolve }) as never
    : url.includes('monitor_id=1') ? { eventos: [{ ...evento, titulo: 'Evento selecionado' }] } as never : resposta(url) as never)
  render(<MonitorTab orgId={3} slug="juridico" />)
  fireEvent.click(await screen.findByRole('button', { name: /Processo da empresa/ }))
  await screen.findByText('Evento selecionado')
  await act(async () => resolver({ eventos: [evento] }))
  expect(screen.queryByText('Movimentação da empresa')).not.toBeInTheDocument()
  expect(screen.getByText('Evento selecionado')).toBeInTheDocument()
})

it('falha inicial dos processos tem recuperação sem vazio falso', async () => {
  let falhar = true
  vi.mocked(api.get).mockImplementation(async url => {
    if (url.endsWith('/processos') && falhar) throw new Error('Sem conexão')
    return resposta(url) as never
  })
  render(<MonitorTab orgId={3} slug="juridico" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os processos monitorados.')
  expect(screen.queryByText('Nenhum processo monitorado')).not.toBeInTheDocument()
  falhar = false
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('Processo da empresa', { selector: 'strong' })).toBeInTheDocument()
})

it('resultado do lookup é descartado se o número CNJ mudou durante a consulta', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url.includes('/lookup?')
    ? new Promise(resolve => { resolver = resolve }) as never : resposta(url) as never)
  render(<MonitorTab orgId={3} slug="juridico" />)
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar processo' }))
  const campo = screen.getByRole('textbox', { name: /^Número CNJ/ })
  fireEvent.change(campo, { target: { value: '00000000000000000001' } })
  fireEvent.click(screen.getByRole('button', { name: 'Consultar' }))
  fireEvent.change(campo, { target: { value: '00000000000000000002' } })
  await act(async () => resolver({ encontrado: true, movimentos: [{ nome: 'Informação do número anterior' }] }))
  expect(screen.queryByText('Informação do número anterior')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Consultar' })).toBeEnabled()
})

it('ao remover um processo, seus eventos saem também da linha do tempo de todos', async () => {
  render(<MonitorTab orgId={3} slug="juridico" />)
  await screen.findByText('Movimentação da empresa')
  fireEvent.click(screen.getByRole('button', { name: 'remover' }))
  fireEvent.click(screen.getByRole('button', { name: 'Parar de monitorar' }))
  await screen.findByText('Nenhum processo monitorado')
  await waitFor(() => expect(screen.queryByText('Movimentação da empresa')).not.toBeInTheDocument())
})

it('verificar um processo atualiza os eventos sem apagar o filtro de não lidos', async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    eventos = [{ ...evento, titulo: 'Movimentação nova' }]
    return { novos_eventos: eventos }
  })
  render(<MonitorTab orgId={3} slug="juridico" />)
  await screen.findByText('Movimentação da empresa')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Só não lidos' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/predios/3/juridico/monitor/eventos?apenas_nao_lidos=true', expect.any(AbortSignal)))
  fireEvent.click(screen.getByRole('button', { name: 'Verificar agora' }))
  await screen.findByText('Movimentação nova')
  expect(screen.getByRole('checkbox', { name: 'Só não lidos' })).toBeChecked()
})

it('falha inicial dos eventos tem retry e conserva uma lista carregada se o retry falha', async () => {
  let falhar = true
  vi.mocked(api.get).mockImplementation(async url => {
    if (url.includes('/eventos') && falhar) throw new Error('Sem conexão')
    return resposta(url) as never
  })
  render(<MonitorTab orgId={3} slug="juridico" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os eventos.')
  expect(screen.queryByText(/Nenhuma movimentação registrada/)).not.toBeInTheDocument()
  falhar = false
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByText('Movimentação da empresa')
  falhar = true
  fireEvent.click(screen.getByRole('button', { name: 'Verificar agora' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os eventos.')
  expect(screen.getByText('Movimentação da empresa')).toBeInTheDocument()
})
