import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, setTokens } from '../lib/api'
import { wsClient } from '../lib/ws'
import PrediosPage from './Predios'

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../lib/ws', () => ({ wsClient: { on: vi.fn(() => vi.fn()) } }))
vi.mock('../lib/useBrasao', () => ({ useBrasao: () => null }))
const predio = (id: number) => ({ org_id: id, org_nome: `Empresa ${id}`, office_slug: 'conteudo', office: { slug: 'conteudo', nome: 'Conteúdo', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'predio' } }, nao_lidas: 0, ultimo_job: null })
function Destino() { return <output aria-label="Destino">{useLocation().search}</output> }
const montar = () => render(<MemoryRouter initialEntries={['/predios']}><Routes><Route path="/predios" element={<PrediosPage />} /><Route path="/app" element={<Destino />} /></Routes></MemoryRouter>)
const job = () => vi.mocked(wsClient.on).mock.calls.find(([tipo]) => tipo === 'job_status')![1]
const emitirJob = () => job()({ tipo: 'job_status', org_id: 1 } as Parameters<ReturnType<typeof job>>[0])
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); setTokens('conta-fixture', 'refresh-fixture'); vi.mocked(wsClient.on).mockImplementation(() => vi.fn()); vi.mocked(api.get).mockImplementation(async path => path === '/predios' ? [predio(1), predio(2)] : []); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

it('resposta antiga não substitui a lista nova nem aciona o atalho de empresa única', async () => {
  let antiga!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { antiga = resolve }))
  montar()
  act(emitirJob)
  await screen.findByRole('heading', { name: 'Empresa 2' })
  expect(vi.mocked(api.get).mock.calls[0][1]?.aborted).toBe(true)
  await act(async () => { antiga([predio(1)]) })
  expect(screen.queryByLabelText('Destino')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Empresa 2' })).toBeVisible()
})

it('um aviso já invalida a consulta antiga enquanto a próxima leitura ainda aguarda o agrupamento', async () => {
  let antiga!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { antiga = resolve }))
  vi.useFakeTimers()
  montar()
  act(emitirJob)
  await act(async () => { antiga([predio(1)]) })
  expect(screen.queryByLabelText('Destino')).not.toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls[0][1]?.aborted).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(screen.getByRole('heading', { name: 'Empresa 2' })).toBeVisible()
})

it('falha inicial oferece retry e só uma lista confirmada libera o atalho', async () => {
  vi.mocked(api.get).mockImplementation(async path => { if (path === '/predios') throw new ApiError(503, 'Consulta interrompida'); return [] })
  montar()
  expect(await screen.findByRole('alert')).toHaveTextContent('Consulta interrompida')
  expect(screen.queryByText('Sua empresa ainda não tem escritórios')).not.toBeInTheDocument()
  vi.mocked(api.get).mockResolvedValue([predio(8)])
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByLabelText('Destino')).toHaveTextContent('?org=8&slug=conteudo')
  expect(api.post).not.toHaveBeenCalled()
})

it('avisa sobre última consulta sem apagar a lista ou busca quando a atualização falha', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/predios' ? [1, 2, 3, 4, 5].map(predio) : [])
  montar()
  fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'Empresa 2' } })
  vi.mocked(api.get).mockRejectedValue(new Error('offline'))
  act(emitirJob)
  expect(await screen.findByRole('alert')).toHaveTextContent(/última consulta/)
  expect(screen.getByRole('searchbox')).toHaveValue('Empresa 2')
  expect(screen.getByRole('heading', { name: 'Empresa 2', level: 2 })).toBeVisible()
  expect(screen.getByText(/Última consulta:/).querySelector('time')).toHaveAttribute('dateTime')
})

it('troca de login descarta lista, catálogo e callbacks da sessão anterior', async () => {
  let antiga!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { antiga = resolve }))
  montar()
  const callbackAntigo = job()
  vi.mocked(api.get).mockImplementation(async path => path === '/predios' ? [predio(7), predio(8)] : [])
  act(() => setTokens('nova-conta', 'novo-refresh'))
  await screen.findByRole('heading', { name: 'Empresa 8' })
  const chamadas = vi.mocked(api.get).mock.calls.length
  await act(async () => { antiga([predio(1)]); callbackAntigo({ tipo: 'job_status', org_id: 1 } as Parameters<typeof callbackAntigo>[0]) })
  expect(screen.queryByLabelText('Destino')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Empresa 1' })).not.toBeInTheDocument()
  expect(api.get).toHaveBeenCalledTimes(chamadas)
})

it('agrupa avisos ao vivo e retorno da janela; desmontar cancela consulta pendente', async () => {
  const view = montar()
  await screen.findByRole('heading', { name: 'Empresa 2' })
  vi.useFakeTimers()
  act(() => { emitirJob(); emitirJob(); fireEvent.focus(window) })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/predios')).toHaveLength(2)
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}))
  act(emitirJob)
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  const chamadas = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/predios')
  const ultima = chamadas[chamadas.length - 1]
  view.unmount()
  expect(ultima[1]?.aborted).toBe(true)
})
