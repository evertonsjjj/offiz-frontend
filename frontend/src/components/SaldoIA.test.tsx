import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, getSessionIdentity, setTokens } from '../lib/api'
import { wsClient } from '../lib/ws'
import { notificarSaldoIA } from '../lib/saldo-eventos'
import type { ResumoSaldoIA } from '../lib/useSaldoIA'
import { SaldoIA } from './SaldoIA'

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn() } }))
vi.mock('../lib/ws', () => ({ wsClient: { on: vi.fn(() => vi.fn()) } }))
const saldo: ResumoSaldoIA = { tipo: 'pf_gerenciado', vigencia: 'vigente', periodo: '2026-10', consultado_em: '2026-10-03T23:00:00Z', renovacao_em: '2026-11-01T00:00:00Z', estado: 'disponivel', limite_brl_mes: 100, credito_brl: 20, total_brl: 120, consumido_brl: 10, reservado_brl: 5, disponivel_brl: 105, percentual_disponivel: 87.5 }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); vi.mocked(api.get).mockResolvedValue(saldo) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
const montar = (orgId = 3) => render(<SaldoIA orgId={orgId} verConsumo={vi.fn()} />)
const abrir = async () => fireEvent.click(await screen.findByLabelText(/Saldo de IA: R\$/))

it('resumo compacto mantém valor, estado acessível e detalhes de consumo', async () => {
  render(<SaldoIA orgId={3} compacto verConsumo={vi.fn()} />)
  const resumo = await screen.findByLabelText(/Saldo de IA: R\$\s*105,00/)
  expect(resumo).toHaveAccessibleName(/Disponível para usar/)
  expect(resumo).toHaveAttribute('aria-expanded', 'false')
  expect(resumo).toHaveTextContent('Saldo')
  expect(resumo.closest('details')).toHaveClass('saldo-ia--compacto')
  fireEvent.click(resumo)
  expect(resumo).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '105')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(resumo).toHaveFocus()
  expect(resumo).toHaveAttribute('aria-expanded', 'false')
})

it.each([['baixo', 'Saldo baixo'], ['esgotado', 'Sem saldo'], ['fora_vigencia', 'Fora da vigência']] as const)('resumo compacto não esconde o aviso atual %s', async (estado, aviso) => {
  vi.mocked(api.get).mockResolvedValue({ ...saldo, estado, vigencia: estado === 'fora_vigencia' ? 'encerrado' : 'vigente' })
  render(<SaldoIA orgId={3} compacto verConsumo={vi.fn()} />)
  const resumo = await screen.findByLabelText(/Saldo de IA: R\$/)
  expect(resumo).toHaveTextContent(aviso)
})

it('mostra o disponível no topo e distingue reservas, consumo e renovação ao abrir', async () => {
  montar(); await abrir()
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '105')
  expect(screen.getByText('Reservado')).toBeVisible()
  expect(screen.getByText(/Ainda não é consumo confirmado/)).toBeVisible()
  expect(screen.getByText(/Próxima renovação:/)).toBeVisible()
  expect(api.get).toHaveBeenCalledWith('/orgs/3/saldo', expect.any(AbortSignal))
})
it('conta própria não inventa saldo zero do fornecedor', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...saldo, tipo: 'byok', estado: 'conta_propria', renovacao_em: null, limite_brl_mes: null, credito_brl: null, total_brl: null, consumido_brl: null, reservado_brl: null, disponivel_brl: null, percentual_disponivel: null })
  montar(); fireEvent.click(await screen.findByLabelText(/Saldo de IA: Conta própria/))
  expect(screen.getByText(/saldo do fornecedor não é consultado/)).toBeVisible()
  expect(screen.queryByText(/R\$/)).not.toBeInTheDocument()
})
it.each(['baixo', 'esgotado', 'fora_vigencia'] as const)('mostra estado %s e orientação honesta', async estado => {
  vi.mocked(api.get).mockResolvedValue({ ...saldo, estado, vigencia: estado === 'fora_vigencia' ? 'encerrado' : 'vigente' })
  montar(); await abrir()
  expect(screen.getByText(estado === 'baixo' ? /saldo está perto do limite/ : estado === 'esgotado' ? /Novas chamadas pelo contrato/ : /Os valores são apenas para consulta/)).toBeVisible()
})
it('erro de consulta não vira zero e oferece atualização sem repetir trabalho', async () => {
  vi.mocked(api.get).mockRejectedValue(new ApiError(503, 'indisponível'))
  montar(); fireEvent.click(await screen.findByLabelText(/Saldo de IA: Indisponível/))
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível atualizar')
  expect(screen.queryByText(/R\$/)).not.toBeInTheDocument()
  vi.mocked(api.get).mockResolvedValue(saldo)
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  await waitFor(() => expect(screen.getByRole('meter')).toBeVisible())
})
it('resposta incompleta não vira valores financeiros inventados', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...saldo, consumido_brl: undefined })
  montar(); expect(await screen.findByLabelText(/Saldo de IA: Indisponível/)).toBeVisible()
})
it('atualização falha mantém valor anterior explicitamente marcado', async () => {
  montar(); await abrir()
  vi.mocked(api.get).mockRejectedValue(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('última consulta')
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '105')
})
it('troca de empresa descarta resposta atrasada da conta anterior', async () => {
  let resolver!: (valor: ResumoSaldoIA) => void
  vi.mocked(api.get).mockImplementation(path => path === '/orgs/3/saldo' ? new Promise(resolve => { resolver = resolve }) : Promise.resolve({ ...saldo, disponivel_brl: 25 }))
  const view = montar(); view.rerender(<SaldoIA orgId={4} verConsumo={vi.fn()} />)
  await screen.findByLabelText(/Saldo de IA: R\$\s*25,00/)
  await act(async () => resolver(saldo))
  expect(screen.queryByLabelText(/Saldo de IA: R\$\s*105,00/)).not.toBeInTheDocument()
})
it('troca de login na mesma empresa limpa o saldo anterior e descarta seu retorno atrasado', async () => {
  setTokens('primeira-conta-ficticia', 'r1')
  montar(); await screen.findByLabelText(/Saldo de IA: R\$\s*105,00/)
  let resolver!: (valor: ResumoSaldoIA) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  await abrir(); fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  vi.mocked(api.get).mockResolvedValue({ ...saldo, disponivel_brl: 25 })
  act(() => setTokens('segunda-conta-ficticia', 'r2'))
  await screen.findByLabelText(/Saldo de IA: R\$\s*25,00/)
  await act(async () => resolver(saldo))
  expect(screen.queryByLabelText(/Saldo de IA: R\$\s*105,00/)).not.toBeInTheDocument()
})
it('invalidação e websocket consultam só a empresa atual e agrupam os avisos', async () => {
  montar(); await screen.findByLabelText(/Saldo de IA: R\$/)
  vi.useFakeTimers()
  act(() => { notificarSaldoIA(9) })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(api.get).toHaveBeenCalledTimes(1)
  const job = vi.mocked(wsClient.on).mock.calls.find(([tipo]) => tipo === 'job_status')![1]
  act(() => { job({ tipo: 'job_status', org_id: 3 } as Parameters<typeof job>[0]); notificarSaldoIA(3); notificarSaldoIA(3) })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(api.get).toHaveBeenCalledTimes(2)
})
it('escape fecha o resumo e devolve o foco; consumo abre o painel', async () => {
  const ver = vi.fn(); render(<SaldoIA orgId={3} verConsumo={ver} />)
  await abrir(); fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByLabelText(/Saldo de IA: R\$/)).toHaveFocus()
  await abrir(); fireEvent.click(screen.getByRole('button', { name: 'Ver plano e consumo' }))
  expect(ver).toHaveBeenCalledTimes(1)
})

it.each(['evento', 'websocket'] as const)('aviso %s invalida a resposta em trânsito e mantém a última consulta marcada até confirmar o saldo', async origem => {
  montar(); await abrir()
  let resolver!: (valor: ResumoSaldoIA) => void
  let sinal!: AbortSignal
  vi.mocked(api.get).mockImplementationOnce((_path, signal) => { sinal = signal!; return new Promise(resolve => { resolver = resolve }) })
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  vi.useFakeTimers()
  act(() => {
    if (origem === 'evento') notificarSaldoIA(3)
    else {
      const job = vi.mocked(wsClient.on).mock.calls.find(([tipo]) => tipo === 'job_status')![1]
      job({ tipo: 'job_status', org_id: 3 } as Parameters<typeof job>[0])
    }
  })
  expect(sinal.aborted).toBe(true)
  expect(screen.getByLabelText(/Saldo de IA: R\$\s*105,00/)).toHaveAccessibleName(/Atualizando saldo/)
  expect(screen.getByRole('status')).toHaveTextContent('última consulta')
  expect(screen.getByText('saldo da última consulta')).toBeVisible()
  await act(async () => resolver({ ...saldo, disponivel_brl: 80, consultado_em: '2026-10-03T23:00:01Z' }))
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '105')
  expect(screen.queryByLabelText(/80,00/)).not.toBeInTheDocument()
  vi.mocked(api.get).mockResolvedValue({ ...saldo, estado: 'esgotado', disponivel_brl: 0, percentual_disponivel: 0, consultado_em: '2026-10-03T23:00:02Z' })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(screen.getByLabelText(/Saldo de IA: R\$\s*0,00/)).toHaveAccessibleName(/Sem saldo disponível/)
  expect(screen.queryByText(/Atualizando saldo\. Os valores/)).not.toBeInTheDocument()
  expect(api.get).toHaveBeenCalledTimes(3)
})

it('aviso de outra empresa não invalida a consulta nem muda seu estado', async () => {
  montar(); await abrir()
  let resolver!: (valor: ResumoSaldoIA) => void
  let sinal!: AbortSignal
  vi.mocked(api.get).mockImplementationOnce((_path, signal) => { sinal = signal!; return new Promise(resolve => { resolver = resolve }) })
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  act(() => notificarSaldoIA(9))
  expect(sinal.aborted).toBe(false)
  await act(async () => resolver({ ...saldo, disponivel_brl: 80 }))
  expect(screen.getByLabelText(/Saldo de IA: R\$\s*80,00/)).toHaveAccessibleName(/Disponível para usar/)
  expect(api.get).toHaveBeenCalledTimes(2)
})

it('aviso na aba oculta marca o saldo anterior e aguarda visibilidade sem consultar em segundo plano', async () => {
  montar(); await abrir()
  vi.useFakeTimers()
  vi.mocked(Object.getOwnPropertyDescriptor(document, 'hidden')!.get!).mockReturnValue(true)
  act(() => notificarSaldoIA(3))
  expect(screen.getByLabelText(/Saldo de IA: R\$\s*105,00/)).toHaveAccessibleName(/Atualizando saldo/)
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(api.get).toHaveBeenCalledTimes(1)
  vi.mocked(Object.getOwnPropertyDescriptor(document, 'hidden')!.get!).mockReturnValue(false)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText(/Saldo de IA: R\$\s*105,00/)).toHaveAccessibleName(/Disponível para usar/)
})

it('informa modalidade apenas após consulta confirmada, sem tratar a última consulta como nova configuração', async () => {
  setTokens('synthetic-account', 'synthetic-refresh')
  const confirmar = vi.fn()
  render(<SaldoIA orgId={3} verConsumo={vi.fn()} aoConfirmarModalidade={confirmar} />)
  await waitFor(() => expect(confirmar).toHaveBeenCalledWith({ orgId: 3, sessao: getSessionIdentity(), tipo: 'pf_gerenciado' }))
  await abrir()
  let rejeitar!: (e: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeitar = reject }))
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  expect(confirmar).toHaveBeenCalledTimes(1)
  await act(async () => rejeitar(new ApiError(503, 'offline')))
  expect(confirmar).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('alert')).toHaveTextContent('última consulta')
  vi.mocked(api.get).mockResolvedValue({ ...saldo, tipo: 'byok', estado: 'conta_propria', renovacao_em: null, limite_brl_mes: null, credito_brl: null, total_brl: null, consumido_brl: null, reservado_brl: null, disponivel_brl: null, percentual_disponivel: null })
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  await waitFor(() => expect(confirmar).toHaveBeenLastCalledWith({ orgId: 3, sessao: getSessionIdentity(), tipo: 'byok' }))
  expect(confirmar).toHaveBeenCalledTimes(2)
})

it.each(['org', 'sessão'])('modalidade de resposta antiga não notifica configuração ao trocar %s', async troca => {
  setTokens('synthetic-account-a', 'synthetic-refresh-a')
  let resolver!: (dados: ResumoSaldoIA) => void
  const confirmar = vi.fn()
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(<SaldoIA orgId={3} verConsumo={vi.fn()} aoConfirmarModalidade={confirmar} />)
  if (troca === 'org') view.rerender(<SaldoIA orgId={4} verConsumo={vi.fn()} aoConfirmarModalidade={confirmar} />)
  else act(() => setTokens('synthetic-account-b', 'synthetic-refresh-b'))
  await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
  expect(confirmar).toHaveBeenLastCalledWith({ orgId: troca === 'org' ? 4 : 3, sessao: getSessionIdentity(), tipo: 'pf_gerenciado' })
  await act(async () => resolver({ ...saldo, tipo: 'byok', estado: 'conta_propria', renovacao_em: null, limite_brl_mes: null, credito_brl: null, total_brl: null, consumido_brl: null, reservado_brl: null, disponivel_brl: null, percentual_disponivel: null }))
  expect(confirmar).toHaveBeenCalledTimes(1)
})
