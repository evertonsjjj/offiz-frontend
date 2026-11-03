import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, setTokens } from '../lib/api'
import { notificarSaldoIA } from '../lib/saldo-eventos'
import { wsClient } from '../lib/ws'
import { MeuContrato } from './ContratosIA'
import { SaldoIA } from './SaldoIA'

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))
vi.mock('../lib/ws', () => ({ wsClient: { on: vi.fn(() => vi.fn()) } }))
const contrato = { tipo: 'pf_gerenciado', mensalidade_brl: 150, limite_brl_mes: 120, servicos: ['openai'], periodo: '2026-10', consumido_brl: 10, reservado_brl: 5, disponivel_brl: 105, conexoes: { openai: true }, inicio: null, fim: null, vigencia: 'vigente' }
const saldo = { ...contrato, consultado_em: '2026-10-09T21:00:00Z', renovacao_em: '2026-11-01T00:00:00Z', estado: 'disponivel', credito_brl: 0, total_brl: 120, percentual_disponivel: 87.5 }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); setTokens('conta-fixture', 'refresh-fixture'); vi.mocked(api.get).mockResolvedValue(contrato); vi.mocked(wsClient.on).mockImplementation(() => vi.fn()); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

it('o plano acompanha a mesma atualização do saldo do topo sem efetuar gastos', async () => {
  let atual = false
  vi.mocked(api.get).mockImplementation(async path => {
    const resposta = path.endsWith('/saldo') ? saldo : contrato
    return atual ? { ...resposta, consumido_brl: 70, disponivel_brl: 45, percentual_disponivel: 37.5 } : resposta
  })
  render(<><SaldoIA orgId={3} verConsumo={vi.fn()} /><MeuContrato orgId={3} /></>)
  await screen.findByLabelText(/Saldo de IA: R\$\s*105,00/)
  const plano = screen.getByRole('region', { name: 'Meu plano de IA' })
  await within(plano).findByText(/105,00 disponíveis/)
  atual = true
  act(() => notificarSaldoIA(3))
  await screen.findByLabelText(/Saldo de IA: R\$\s*45,00/)
  expect(await within(plano).findByText(/45,00 disponíveis/)).toBeVisible()
  expect(within(plano).queryByText(/105,00 disponíveis/)).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled()
})

it('conserva o saldo confirmado e seu horário durante falha e retry, sem fingir atualização', async () => {
  render(<MeuContrato orgId={3} />)
  await screen.findByText(/105,00 disponíveis/)
  vi.mocked(api.get).mockRejectedValue(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/última consulta/)
  expect(screen.getByText(/105,00 disponíveis/)).toBeVisible()
  const horario = screen.getByText(/Última consulta:/).querySelector('time')!.getAttribute('datetime')
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/última consulta/)
  expect(screen.getByRole('status')).toHaveTextContent(/Atualizando/)
  expect(screen.getByText(/Última consulta:/).querySelector('time')).toHaveAttribute('dateTime', horario)
  await act(async () => { resolver({ ...contrato, disponivel_brl: 42 }) })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByText(/42,00 disponíveis/)).toBeVisible()
})

it('eventos de outra empresa não consultam o plano, e avisos da empresa atual são agrupados', async () => {
  render(<MeuContrato orgId={3} />)
  await screen.findByText(/105,00 disponíveis/)
  vi.useFakeTimers()
  act(() => notificarSaldoIA(9))
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(api.get).toHaveBeenCalledTimes(1)
  const callback = vi.mocked(wsClient.on).mock.calls.find(([tipo]) => tipo === 'job_status')![1]
  act(() => { notificarSaldoIA(3); notificarSaldoIA(3); callback({ tipo: 'job_status', org_id: 3 } as Parameters<typeof callback>[0]) })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(api.get).toHaveBeenCalledTimes(2)
})

it('trocar empresa cancela resposta anterior sem mostrar o saldo antigo no novo contexto', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(<MeuContrato orgId={3} />)
  vi.mocked(api.get).mockResolvedValue({ ...contrato, disponivel_brl: 22 })
  view.rerender(<MeuContrato orgId={4} />)
  await screen.findByText(/22,00 disponíveis/)
  expect(vi.mocked(api.get).mock.calls[0][1]?.aborted).toBe(true)
  await act(async () => { resolver(contrato) })
  expect(screen.queryByText(/105,00 disponíveis/)).not.toBeInTheDocument()
})

it('trocar login limpa dados confirmados e impede callbacks antigos na mesma empresa', async () => {
  render(<MeuContrato orgId={3} />)
  await screen.findByText(/105,00 disponíveis/)
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  vi.mocked(api.get).mockResolvedValue({ ...contrato, disponivel_brl: 11 })
  act(() => setTokens('nova-conta', 'novo-refresh'))
  await screen.findByText(/11,00 disponíveis/)
  await act(async () => { resolver(contrato) })
  expect(screen.queryByText(/105,00 disponíveis/)).not.toBeInTheDocument()
})

it('resposta financeira incompleta não apaga o último saldo confirmado nem vira zero', async () => {
  render(<MeuContrato orgId={3} />)
  await screen.findByText(/105,00 disponíveis/)
  vi.mocked(api.get).mockResolvedValue({ ...contrato, consumido_brl: undefined })
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/Saldo indisponível/)
  expect(screen.getByText(/105,00 disponíveis/)).toBeVisible()
  expect(screen.queryByText(/0,00 disponíveis/)).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar saldo' })).toBeEnabled())
})

it('retorno à janela agrupa leituras e desmontar cancela o request; não instala polling novo', async () => {
  const timer = vi.spyOn(window, 'setInterval')
  const view = render(<MeuContrato orgId={3} />)
  expect(timer).not.toHaveBeenCalled()
  await screen.findByText(/105,00 disponíveis/)
  timer.mockClear() // findBy usa seu próprio intervalo; as atualizações abaixo são por eventos.
  vi.useFakeTimers()
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  act(() => { fireEvent.focus(window); document.dispatchEvent(new Event('visibilitychange')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(timer).not.toHaveBeenCalled()
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}))
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  const chamada = vi.mocked(api.get).mock.calls[vi.mocked(api.get).mock.calls.length - 1]
  view.unmount()
  expect(chamada[1]?.aborted).toBe(true)
})

it('aviso de saldo invalida resposta antiga antes que a leitura agrupada comece', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  vi.useFakeTimers()
  render(<MeuContrato orgId={3} />)
  act(() => notificarSaldoIA(3))
  await act(async () => resolver(contrato))
  expect(screen.queryByText(/105,00 disponíveis/)).not.toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls[0][1]?.aborted).toBe(true)
  vi.mocked(api.get).mockResolvedValue({ ...contrato, disponivel_brl: 45 })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(screen.getByText(/45,00 disponíveis/)).toBeVisible()
})

it.each(['saldo', 'job_status', '_conectado'] as const)('aviso %s em aba oculta invalida a leitura em voo e confere no retorno', async evento => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  vi.useFakeTimers()
  render(<MeuContrato orgId={3} />)
  const sinal = vi.mocked(api.get).mock.calls[0][1]!
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  act(() => {
    if (evento === 'saldo') notificarSaldoIA(3)
    else {
      const callback = vi.mocked(wsClient.on).mock.calls.find(([tipo]) => tipo === evento)![1]
      callback({ tipo: evento, org_id: 3 } as Parameters<typeof callback>[0])
    }
  })
  await act(async () => { resolver(contrato); await vi.advanceTimersByTimeAsync(500) })
  expect(sinal.aborted).toBe(true)
  expect(screen.queryByText(/105,00 disponíveis/)).not.toBeInTheDocument()
  expect(api.get).toHaveBeenCalledTimes(1)
  vi.mocked(api.get).mockResolvedValue({ ...contrato, consumido_brl: 70, disponivel_brl: 45 })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(screen.getByText(/45,00 disponíveis/)).toBeVisible()
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled()
})

it('consumo em aba oculta exige nova consulta no retorno mesmo antes de dois segundos', async () => {
  render(<MeuContrato orgId={3} />)
  await screen.findByText(/105,00 disponíveis/)
  const horario = screen.getByText(/Última consulta:/).querySelector('time')!.getAttribute('datetime')
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  act(() => { notificarSaldoIA(3); notificarSaldoIA(3) })
  expect(screen.getByRole('status')).toHaveTextContent(/Atualizando/)
  expect(screen.getByText(/Última consulta:/).querySelector('time')).toHaveAttribute('datetime', horario)
  vi.mocked(api.get).mockResolvedValue({ ...contrato, consumido_brl: 115, disponivel_brl: 0 })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  act(() => { fireEvent.focus(window); document.dispatchEvent(new Event('visibilitychange')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(screen.getByText(/0,00 disponíveis/)).toBeVisible()
  expect(screen.queryByText(/105,00 disponíveis/)).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled()
})
