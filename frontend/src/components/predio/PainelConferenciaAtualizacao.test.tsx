import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, baixarArquivo } from '../../lib/api'
import { wsClient } from '../../lib/ws'
import type { WsMessage } from '../../lib/types'
import { PainelTrabalho } from './PainelTrabalho'

vi.mock('../../lib/api', async original => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn() }, baixarArquivo: vi.fn(),
}))
vi.mock('../../lib/ws', () => ({ wsClient: { on: vi.fn() } }))
vi.mock('./ResultadoEntrega', () => ({ default: ({ entregaId }: { entregaId: number }) => <div data-testid={`previa-${entregaId}`} /> }))

const job = { id: 77, status: 'done', titulo: 'Vídeo revisado', office_slug: 'conteudo' }
const arquivos = [
  { id: 9, job_id: 77, nome: 'campanha-com-legenda.mp4', mime: 'video/mp4', status: 'pendente', tipo: 'arquivo' },
  { id: 10, job_id: 77, nome: 'campanha-sem-legenda.mp4', mime: 'video/mp4', status: 'pendente', tipo: 'arquivo' },
]
const detalhe = (estado = 'em_fila') => ({ arquivos, qualidade: {
  estado: estado === 'conferida' ? 'conferida' : 'parcial', avisos: [], revisao_automatica: { estado },
} })
const endereco = '/orgs/1/biblioteca/77'
const consultas = () => vi.mocked(api.get).mock.calls.filter(([path]) => path === endereco).length
const props = { orgId: 1, slug: 'predio', jobId: 77, aoAjustar: vi.fn(), aoFechar: vi.fn() }
let notificar: ((evento: WsMessage) => void) | undefined
const desinscrever = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  notificar = undefined
  vi.mocked(wsClient.on).mockImplementation((_, handler) => {
    notificar = handler
    return desinscrever
  })
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : detalhe())
})
afterEach(() => { cleanup(); vi.useRealTimers() })

async function montar() {
  const tela = render(<PainelTrabalho {...props} />)
  await act(async () => {})
  expect(screen.getByTestId('previa-9')).toBeInTheDocument()
  return tela
}

it('acompanha o parecer posterior ao trabalho e mantém o arquivo escolhido sem refazer a produção', async () => {
  let estado = 'em_fila'
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : detalhe(estado))
  await montar()
  fireEvent.click(screen.getByRole('tab', { name: 'sem legenda' }))
  expect(screen.getByTestId('previa-10')).toBeInTheDocument()
  expect(screen.getByText('A conferência dos arquivos está em andamento. Você já pode abrir a prévia.')).toBeInTheDocument()
  estado = 'conferida'
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(consultas()).toBe(2)
  expect(screen.getByTestId('previa-10')).toBeInTheDocument()
  expect(screen.queryByText(/A conferência dos arquivos está em andamento/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Está bom — aprovar/ })).toBeEnabled()
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(consultas()).toBe(2)
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/jobs/77')).toHaveLength(1)
  expect(api.post).not.toHaveBeenCalled()
})

it('limita a trinta consultas automáticas e um evento não renova esse teto', async () => {
  await montar()
  await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
  expect(consultas()).toBe(31) // A leitura inicial não é uma tentativa automática.
  await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
  expect(consultas()).toBe(31)
  await act(async () => { window.dispatchEvent(new Event('offiz:biblioteca-mudou')) })
  expect(consultas()).toBe(32)
  await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
  expect(consultas()).toBe(32)
  expect(api.post).not.toHaveBeenCalled()
})

it('encerra a espera ao falhar e conserva a prévia até uma tentativa explícita', async () => {
  let falhar = false
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/jobs/77') return job
    if (falhar) throw new ApiError(503, 'A conferência não pôde ser consultada.')
    return detalhe()
  })
  await montar()
  fireEvent.click(screen.getByRole('tab', { name: 'sem legenda' }))
  falhar = true
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(screen.getByRole('alert')).toHaveTextContent('A conferência não pôde ser consultada.')
  expect(screen.getByTestId('previa-10')).toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(consultas()).toBe(2)
  falhar = false
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })) })
  expect(consultas()).toBe(3)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByTestId('previa-10')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('recebe eventos de entregas e revisão da empresa sem perder seleção ou erro de download', async () => {
  vi.mocked(baixarArquivo).mockRejectedValue(new ApiError(503, 'Não consegui baixar a versão escolhida.'))
  await montar()
  fireEvent.click(screen.getByRole('tab', { name: 'sem legenda' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Baixar' })) })
  expect(screen.getByRole('alert')).toHaveTextContent('Não consegui baixar a versão escolhida.')
  await act(async () => { window.dispatchEvent(new Event('offiz:entregas-mudou')) })
  await act(async () => { window.dispatchEvent(new Event('offiz:biblioteca-mudou')) })
  expect(consultas()).toBe(3)
  await act(async () => { notificar?.({ t: 'job_status', org_id: 2, job_id: 990, status: 'done' }) })
  expect(consultas()).toBe(3)
  await act(async () => { notificar?.({ t: 'job_status', org_id: 1, job_id: 991, status: 'done' }) })
  expect(consultas()).toBe(4)
  expect(screen.getByTestId('previa-10')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Não consegui baixar a versão escolhida.')
  expect(api.post).not.toHaveBeenCalled()
})

it('encerra timer, cancela a leitura pendente e remove assinaturas ao fechar', async () => {
  let signal: AbortSignal | undefined
  vi.mocked(api.get).mockImplementation(async (path, recebido) => {
    if (path === '/jobs/77') return job
    signal = recebido
    return detalhe()
  })
  const tela = await montar()
  tela.unmount()
  expect(signal?.aborted).toBe(true)
  expect(desinscrever).toHaveBeenCalledTimes(1)
  await act(async () => {
    window.dispatchEvent(new Event('offiz:biblioteca-mudou'))
    window.dispatchEvent(new Event('offiz:entregas-mudou'))
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(consultas()).toBe(1)
  expect(api.post).not.toHaveBeenCalled()
})

it('não cria polling quando o parecer já está encerrado', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : detalhe('parcial'))
  await montar()
  await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
  expect(consultas()).toBe(1)
  expect(api.post).not.toHaveBeenCalled()
})

it('ignora resposta antiga que chega depois de trocar de trabalho e empresa', async () => {
  let resolver: ((dado: ReturnType<typeof detalhe>) => void) | undefined
  let consultasAntigas = 0
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/jobs/77') return job
    if (path === '/jobs/88') return { ...job, id: 88 }
    if (path === endereco && consultasAntigas++ > 0) return new Promise(resolve => { resolver = resolve })
    if (path === '/orgs/2/biblioteca/88') return {
      ...detalhe('conferida'), arquivos: [{ ...arquivos[0], id: 88, job_id: 88, nome: 'nova.mp4' }],
    }
    return detalhe()
  })
  const tela = await montar()
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(resolver).toBeDefined()
  await act(async () => { tela.rerender(<PainelTrabalho {...props} orgId={2} jobId={88} />) })
  expect(screen.getByTestId('previa-88')).toBeInTheDocument()
  await act(async () => { resolver?.(detalhe('conferida')) })
  expect(screen.getByTestId('previa-88')).toBeInTheDocument()
  expect(screen.queryByTestId('previa-9')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})
