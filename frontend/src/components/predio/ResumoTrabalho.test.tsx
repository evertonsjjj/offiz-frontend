import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, setTokens } from '../../lib/api'
import { wsClient } from '../../lib/ws'
import { ResumoTrabalho } from './ResumoTrabalho'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn() } }))
vi.mock('../../lib/ws', () => ({ wsClient: { on: vi.fn(() => vi.fn()) } }))
const resumo = { resumo: { prontos: 2, precisa_de_voce: 1, em_producao: 3 } }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); setTokens('conta-fixture', 'refresh-fixture'); vi.mocked(api.get).mockResolvedValue(resumo); vi.mocked(wsClient.on).mockImplementation(() => vi.fn()) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('mantém o envelope dos contadores enquanto a primeira consulta está pendente', async () => {
  let resolver!: (valor: typeof resumo) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const abrir = vi.fn()
  render(<ResumoTrabalho orgId={3} abrir={abrir} />)
  const envelope = screen.getByRole('region', { name: 'Seu trabalho hoje' })
  const linha = envelope.querySelector('.biblioteca-resumo')
  expect(envelope).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('status')).toHaveTextContent('Consultando seus trabalhos')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByText('0')).not.toBeInTheDocument()

  await act(async () => { resolver({ resumo: { prontos: 0, precisa_de_voce: 7, em_producao: 1 } }) })
  expect(screen.getByRole('region', { name: 'Seu trabalho hoje' })).toBe(envelope)
  expect(envelope.querySelector('.biblioteca-resumo')).toBe(linha)
  expect(envelope).toHaveAttribute('aria-busy', 'false')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '0Pronto para você' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '7Precisa de você' }))
  expect(abrir).toHaveBeenCalledWith('precisa_de_voce')
})

it('preserva o envelope na primeira falha, no retry pendente e no zero confirmado', async () => {
  let rejeitar!: (erro: Error) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise((_, reject) => { rejeitar = reject }))
  render(<ResumoTrabalho orgId={3} abrir={vi.fn()} />)
  const envelope = screen.getByRole('region', { name: 'Seu trabalho hoje' })
  const linha = envelope.querySelector('.biblioteca-resumo')
  await act(async () => { rejeitar(new Error('offline')) })
  expect(screen.getByRole('alert')).toHaveTextContent('consultar seus trabalhos')
  expect(screen.queryByText('0')).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Seu trabalho hoje' })).toBe(envelope)
  expect(envelope.querySelector('.biblioteca-resumo')).toBe(linha)

  let resolver!: (valor: typeof resumo) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(screen.getByRole('alert')).toHaveTextContent('consultar seus trabalhos')
  await act(async () => { resolver({ resumo: { prontos: 0, precisa_de_voce: 0, em_producao: 0 } }) })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Seu trabalho hoje' })).toBe(envelope)
  expect(envelope.querySelector('.biblioteca-resumo')).toBe(linha)
  expect(screen.getByRole('button', { name: '0Pronto para você' })).toBeVisible()
  expect(screen.getByRole('button', { name: '0Precisa de você' })).toBeVisible()
  expect(screen.getByRole('button', { name: '0O Offiz está cuidando' })).toBeVisible()
})

it('conserva os contadores confirmados com horário e aviso de consulta interrompida até o retry terminar', async () => {
  const abrir = vi.fn()
  render(<ResumoTrabalho orgId={3} abrir={abrir} />)
  await screen.findByRole('button', { name: '2Pronto para você' })
  vi.mocked(api.get).mockRejectedValue(new Error('offline'))
  await act(async () => { window.dispatchEvent(new Event('offiz:biblioteca-mudou')) })
  expect(await screen.findByRole('alert')).toHaveTextContent(/última consulta/)
  const horario = screen.getByText(/Última consulta:/).querySelector('time')!
  expect(horario).toHaveAttribute('dateTime')
  fireEvent.click(screen.getByRole('button', { name: '2Pronto para você' }))
  expect(abrir).toHaveBeenCalledWith('pronto')
  let resolver!: (valor: typeof resumo) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/última consulta/)
  await act(async () => { resolver({ resumo: { ...resumo.resumo, prontos: 4 } }) })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '4Pronto para você' })).toBeVisible()
})

it('uma primeira falha oferece retry sem inventar contadores vazios', async () => {
  vi.mocked(api.get).mockRejectedValue(new Error('offline'))
  render(<ResumoTrabalho orgId={3} abrir={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent(/consultar seus trabalhos/)
  expect(screen.queryByText('0')).not.toBeInTheDocument()
  vi.mocked(api.get).mockResolvedValue(resumo)
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByRole('button', { name: '2Pronto para você' })
})

it('descarta leitura da área antiga e consulta o endereço exato da área atual', async () => {
  let resolver!: (valor: typeof resumo) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(<ResumoTrabalho orgId={3} areaSlug="conteudo" abrir={vi.fn()} />)
  view.rerender(<ResumoTrabalho orgId={4} areaSlug="midia" abrir={vi.fn()} />)
  await screen.findByRole('button', { name: '2Pronto para você' })
  expect(api.get).toHaveBeenLastCalledWith('/orgs/4/biblioteca?limite=1&office_slug=midia', expect.any(AbortSignal))
  expect(vi.mocked(api.get).mock.calls[0][1]?.aborted).toBe(true)
  await act(async () => { resolver({ resumo: { ...resumo.resumo, prontos: 99 } }) })
  expect(screen.queryByRole('button', { name: '99Pronto para você' })).not.toBeInTheDocument()
})

it('trocar login na mesma área limpa o snapshot e cancela o retorno da sessão anterior', async () => {
  render(<ResumoTrabalho orgId={3} abrir={vi.fn()} />)
  await screen.findByRole('button', { name: '2Pronto para você' })
  let resolver!: (valor: typeof resumo) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  await act(async () => { window.dispatchEvent(new Event('offiz:entregas-mudou')) })
  vi.mocked(api.get).mockResolvedValue({ resumo: { ...resumo.resumo, prontos: 7 } })
  act(() => setTokens('outra-conta', 'outro-refresh'))
  await screen.findByRole('button', { name: '7Pronto para você' })
  await act(async () => { resolver(resumo) })
  await waitFor(() => expect(screen.queryByRole('button', { name: '2Pronto para você' })).not.toBeInTheDocument())
})
