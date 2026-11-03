import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { IdiomaProvider } from '../lib/i18n'
import { api, ApiError } from '../lib/api'
import type { Usuario } from '../lib/types'
import { ConfigOrgCorpo, SecaoMotorIA } from './ConfigOrg'

vi.mock('../lib/api', async (original) => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), put: vi.fn() } }))
vi.mock('../lib/ws', () => ({ wsClient: { connect: vi.fn(), close: vi.fn(), on: vi.fn(() => vi.fn()) } }))
vi.mock('../components/Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn() }) }))
let pessoa: Usuario

it('primeira conexão por API só muda o modo ao salvar e preserva os demais ajustes', async () => {
  vi.mocked(api.get).mockResolvedValue({
    motor_modo: 'cli', motor_cli: 'codex', llm_provedor: 'openai',
    anthropic_api_key_mascarada: null, limite_tokens_mes: 20000,
    voz_leitura: 'botao', voz_ditado: 'ligado',
    llm_modelo_premium: 'fixture-principal', llm_modelo_leve: 'fixture-leve',
    provedores: [{ chave: 'openai', nome: 'OpenAI', modelos: [], auto: { premium: 'fixture-principal', leve: 'fixture-leve' }, endpoints: [] }],
  })
  render(<SecaoMotorIA orgId={1} prepararApi />)
  const chave = await screen.findByLabelText('Chave de API')
  expect(screen.getByRole('button', { name: 'Salvar conexão' })).toBeDisabled()
  expect(api.put).not.toHaveBeenCalled()
  expect(screen.queryByText('Leitura em voz alta das respostas')).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Conectar pela chave de API' })).toHaveTextContent('Ao salvar, a IA desta empresa passa a usar a API.')
  fireEvent.change(chave, { target: { value: 'chave-sintetica-do-teste' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar conexão' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/orgs/1/settings/llm', expect.objectContaining({
    motor_modo: 'api', motor_cli: 'codex', llm_provedor: 'openai',
    anthropic_api_key: 'chave-sintetica-do-teste', limite_tokens_mes: 20000,
    voz_leitura: 'botao', voz_ditado: 'ligado', llm_modelo_premium: 'fixture-principal', llm_modelo_leve: 'fixture-leve',
  })))
})
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  pessoa = { id: 1, nome: 'Cliente', email: 'demo@example.test', is_admin: false, idioma_interface: 'en' }
  localStorage.setItem('offiz_access_token', 'token-sintetico')
  localStorage.setItem('offiz_usuario', JSON.stringify(pessoa))
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/auth/me') return pessoa
    if (path === '/predios') return []
    if (path === '/orgs/1/contrato') return { tipo: 'byok' }
    if (path === '/orgs/1/settings/llm') return { anthropic_api_key_mascarada: null, claude_model: 'modelo-fixture', effort_default: 'medium', llm_provedor: 'anthropic', motor_modo: 'api', limite_tokens_mes: 1000, provedores: [] }
    throw new ApiError(503, 'Fixture: section unavailable')
  })
  vi.mocked(api.put).mockImplementation(async (_path, body) => {
    pessoa = { ...pessoa, ...body as object }
    return { idioma_interface: pessoa.idioma_interface, modo_avancado: false }
  })
})

it('plano gerenciado mostra responsabilidade do Offiz sem consultar ou montar BYOD e S3', async () => {
  const anterior = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path, ...rest) => path === '/orgs/1/contrato'
    ? { tipo: 'pf_gerenciado', mensalidade_brl: 100, limite_brl_mes: 60, servicos: [], conexoes: {}, consumido_brl: 0, reservado_brl: 0, disponivel_brl: 60, periodo: '2026-09', inicio: null, fim: null, vigencia: 'vigente' }
    : anterior(path, ...rest))
  render(<MemoryRouter><AuthProvider><IdiomaProvider><ConfigOrgCorpo orgId={1} /></IdiomaProvider></AuthProvider></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Data and connections' }))
  await screen.findByRole('heading', { name: 'Data managed by Offiz' })
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/database'))).toBe(false)
  expect(screen.queryByLabelText(/S3 bucket/i)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'AI' }))
  expect(await screen.findByRole('link', { name: 'Windows installer (.exe)' })).toHaveAttribute('href', expect.stringContaining('Offiz-Setup.exe'))
  expect(screen.getByText(/No modo local, apenas imagens/)).toBeVisible()
})

it('configurações reagem ao idioma sem remontar nem salvar o rascunho de chave e limite', async () => {
  render(<MemoryRouter><AuthProvider><IdiomaProvider><ConfigOrgCorpo orgId={1} /></IdiomaProvider></AuthProvider></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Organization settings' })
  expect(await screen.findByRole('heading', { name: 'AI engine' })).toBeInTheDocument()
  const chave = await screen.findByLabelText('Anthropic API key')
  const limite = screen.getByLabelText('Monthly token limit — entire organization (all users)')
  fireEvent.change(chave, { target: { value: 'rascunho-sintetico-nao-enviar' } })
  fireEvent.change(limite, { target: { value: '4567' } })
  const chamadasLlm = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/1/settings/llm').length
  fireEvent.click(screen.getByRole('button', { name: 'My account' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Interface language' }), { target: { value: 'pt-BR' } })
  await screen.findByRole('heading', { name: 'Configurações da organização' })
  fireEvent.click(screen.getByRole('button', { name: 'Inteligência' }))
  expect(screen.getByLabelText('API key da Anthropic')).toBe(chave)
  expect(chave).toHaveValue('rascunho-sintetico-nao-enviar')
  expect(limite).toHaveValue(4567)
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/1/settings/llm')).toHaveLength(chamadasLlm)
  await waitFor(() => expect(api.put).toHaveBeenCalledExactlyOnceWith('/usuarios/me/preferencias', { idioma_interface: 'pt-BR' }))
})
