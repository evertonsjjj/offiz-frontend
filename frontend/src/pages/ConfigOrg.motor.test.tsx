import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, setTokens } from '../lib/api'
import { PainelMotorEmbutido } from './ConfigOrg'
import type { MotorEstado, OffizMotorBridge } from '../lib/motor-bridge'

const toasts = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }))
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }))
vi.mock('../components/Toasts', () => ({ useToasts: () => toasts }))

const estado = (worker: string, orgId = 3): MotorEstado => ({ config: { orgId, orgNome: `Empresa ${orgId}`, localEngine: 'codex', backendUrl: 'https://fixture.invalid', claudeBin: null, workerEnabled: worker !== 'parado' }, pareado: true, pareadoPor: null, worker: { estado: worker, jobAtual: null, log: [] } })
function adiado<T>() { let resolver!: (valor: T) => void; let rejeitar!: (erro: Error) => void; const promessa = new Promise<T>((resolve, reject) => { resolver = resolve; rejeitar = reject }); return { promessa, resolver, rejeitar } }
let atualizar!: () => void
function criarPonte() {
  return { versao: '0.2.14', estado: vi.fn().mockResolvedValue(estado('ocioso')), claudeStatus: vi.fn().mockResolvedValue({ installed: true, loggedIn: true }), codexStatus: vi.fn().mockResolvedValue({ installed: true, authenticated: true }), onUpdate: vi.fn(cb => { atualizar = cb; return vi.fn() }), onInstalarLinha: vi.fn(() => vi.fn()), ligar: vi.fn().mockResolvedValue({ ok: true }), desligar: vi.fn().mockResolvedValue({ ok: true }) }
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); setTokens('sessao-sintetica-k', 'refresh-sintetico-k')
  vi.mocked(api.get).mockResolvedValue({ llm_provedor: 'openai', motor_cli: 'codex' })
  window.offizMotor = criarPonte() as unknown as OffizMotorBridge
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete window.offizMotor; localStorage.clear(); sessionStorage.clear() })

it('push recente de motor desligado prevalece sobre uma verificação antiga ainda pendente', async () => {
  const antiga = adiado<MotorEstado>(), bridge = window.offizMotor!
  vi.mocked(bridge.estado).mockReturnValueOnce(antiga.promessa).mockResolvedValueOnce(estado('parado'))
  render(<PainelMotorEmbutido orgId={3} aoMudarPareamento={vi.fn()} />)
  await waitFor(() => expect(bridge.onUpdate).toHaveBeenCalled())
  act(() => atualizar())
  await screen.findByText('desligado')
  await act(async () => antiga.resolver(estado('ocioso')))
  expect(screen.getByText('desligado')).toBeVisible()
  expect(screen.queryByText('ligado — aguardando tarefas')).not.toBeInTheDocument()
  expect(bridge.ligar).not.toHaveBeenCalled(); expect(bridge.desligar).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled()
})

it('erro de uma consulta antiga não invalida a verificação mais recente confirmada', async () => {
  const antiga = adiado<MotorEstado>(), bridge = window.offizMotor!
  vi.mocked(bridge.estado).mockReturnValueOnce(antiga.promessa).mockResolvedValueOnce(estado('parado'))
  render(<PainelMotorEmbutido orgId={3} aoMudarPareamento={vi.fn()} />)
  await waitFor(() => expect(bridge.onUpdate).toHaveBeenCalled())
  act(() => atualizar())
  await screen.findByText('desligado')
  await act(async () => antiga.rejeitar(new Error('Falha antiga sintética')))
  expect(screen.queryByText('Falha ao verificar')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ligar o motor' })).toBeEnabled()
  expect(bridge.ligar).not.toHaveBeenCalled()
})

it('troca de empresa descarta resposta antiga e não mantém a conta anterior como pronta', async () => {
  const antiga = adiado<MotorEstado>(), bridge = window.offizMotor!
  vi.mocked(bridge.estado).mockReturnValueOnce(antiga.promessa).mockResolvedValue(estado('parado', 4))
  const tela = render(<PainelMotorEmbutido orgId={3} aoMudarPareamento={vi.fn()} />)
  await waitFor(() => expect(bridge.estado).toHaveBeenCalled())
  tela.rerender(<PainelMotorEmbutido orgId={4} aoMudarPareamento={vi.fn()} />)
  await screen.findByText('✓ Pareado com Empresa 4')
  await act(async () => antiga.resolver(estado('ocioso', 3)))
  fireEvent.click(screen.getByText('Conectar esta empresa'))
  expect(screen.getByText('✓ Pareado com Empresa 4')).toBeVisible()
  expect(screen.queryByText('ligado — aguardando tarefas')).not.toBeInTheDocument()
})

it('troca de sessão descarta diagnóstico que pertencia ao login anterior', async () => {
  const antiga = adiado<MotorEstado>(), bridge = window.offizMotor!
  vi.mocked(bridge.estado).mockReturnValueOnce(antiga.promessa).mockResolvedValue(estado('parado'))
  const tela = render(<PainelMotorEmbutido orgId={3} aoMudarPareamento={vi.fn()} />)
  await waitFor(() => expect(bridge.estado).toHaveBeenCalled())
  setTokens('outra-sessao-sintetica-k', 'outro-refresh-sintetico-k')
  tela.rerender(<PainelMotorEmbutido orgId={3} aoMudarPareamento={vi.fn()} />)
  await screen.findByText('desligado')
  await act(async () => antiga.resolver(estado('ocioso')))
  expect(screen.getByText('desligado')).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
})

it('falha atual conserva o último snapshot como anterior e retry atualiza sem ligar processos', async () => {
  const bridge = window.offizMotor!
  render(<PainelMotorEmbutido orgId={3} aoMudarPareamento={vi.fn()} />)
  await screen.findByText('ligado — aguardando tarefas')
  vi.mocked(bridge.estado).mockRejectedValueOnce(new Error('Falha atual sintética')).mockResolvedValue(estado('parado'))
  act(() => atualizar())
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar o motor')
  expect(screen.getByText(/última consulta/i)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Verificar motor' }))
  expect(await screen.findByText('desligado')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(bridge.ligar).not.toHaveBeenCalled(); expect(bridge.desligar).not.toHaveBeenCalled()
})

function comTarefa(worker: string): MotorEstado {
  return { ...estado(worker), worker: { estado: worker, jobAtual: { id: 358, titulo: 'Chamada do jogo', office: 'conteudo', org: 3, inicio: 1 }, log: [] } }
}

it('desligamento pendente conserva a tarefa e não se transforma em Ligando após push parado', async () => {
  const bridge = window.offizMotor!, parada = adiado<{ ok: boolean }>()
  vi.mocked(bridge.estado).mockResolvedValue(comTarefa('executando'))
  vi.mocked(bridge.desligar).mockReturnValue(parada.promessa)
  render(<PainelMotorEmbutido orgId={3} aoMudarPareamento={vi.fn()} />)
  await screen.findByText('executando tarefa')
  fireEvent.click(screen.getByRole('button', { name: 'Desligar' }))
  expect(await screen.findByText('encerrando — aguardando tarefa')).toBeVisible()
  vi.mocked(bridge.estado).mockResolvedValue(comTarefa('parado'))
  act(() => atualizar())
  await screen.findByText(/Aguardando o encerramento da tarefa #358/)
  expect(screen.queryByText('desligado')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Ligando…' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Aguarde…' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Aguarde…' }))
  expect(bridge.ligar).not.toHaveBeenCalled()
  expect(bridge.desligar).toHaveBeenCalledTimes(1)
  vi.mocked(bridge.estado).mockResolvedValue(estado('parado'))
  await act(async () => parada.resolver({ ok: true }))
  expect(await screen.findByText('desligado')).toBeVisible()
  expect(screen.queryByText(/Aguardando o encerramento da tarefa/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ligar o motor' })).toBeEnabled()
  expect(bridge.ligar).not.toHaveBeenCalled()
})

it('snapshot legado parado com tarefa continua aguardando mesmo sem ação local em andamento', async () => {
  const bridge = window.offizMotor!
  vi.mocked(bridge.estado).mockResolvedValue(comTarefa('parado'))
  render(<PainelMotorEmbutido orgId={3} aoMudarPareamento={vi.fn()} />)
  expect(await screen.findByText('encerrando — aguardando tarefa')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Aguarde…' })).toBeDisabled()
  expect(screen.queryByText('desligado')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Ligar o motor' })).not.toBeInTheDocument()
  vi.mocked(bridge.estado).mockResolvedValue(estado('parado'))
  act(() => atualizar())
  expect(await screen.findByText('desligado')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Ligar o motor' })).toBeEnabled()
  expect(bridge.ligar).not.toHaveBeenCalled(); expect(bridge.desligar).not.toHaveBeenCalled()
})

it('ligar sem tarefa continua identificado como Ligando e impede comando duplicado', async () => {
  const bridge = window.offizMotor!, partida = adiado<{ ok: boolean }>()
  vi.mocked(bridge.estado).mockResolvedValue(estado('parado'))
  vi.mocked(bridge.ligar).mockReturnValue(partida.promessa)
  render(<PainelMotorEmbutido orgId={3} aoMudarPareamento={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ligar o motor' }))
  expect(await screen.findByRole('button', { name: 'Ligando…' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Ligando…' }))
  expect(bridge.ligar).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('encerrando — aguardando tarefa')).not.toBeInTheDocument()
  vi.mocked(bridge.estado).mockResolvedValue(estado('ocioso'))
  await act(async () => partida.resolver({ ok: true }))
  expect(await screen.findByText('ligado — aguardando tarefas')).toBeVisible()
  expect(bridge.desligar).not.toHaveBeenCalled()
})
