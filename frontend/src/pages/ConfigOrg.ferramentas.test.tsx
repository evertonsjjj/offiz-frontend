import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { api, ApiError, setTokens } from '../lib/api'
import { ConfigOrgCorpo, PainelMotorEmbutido, SecaoEstudioMidia, SecaoMcpKeys } from './ConfigOrg'

const toasts = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }))
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }))
vi.mock('../components/Toasts', () => ({ useToasts: () => toasts }))

const llm = { anthropic_api_key_mascarada: null, llm_provedor: 'anthropic', motor_modo: 'api', limite_tokens_mes: 0, provedores: [] }
beforeEach(() => {
  vi.resetAllMocks()
  delete window.offizMotor
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/predios') return [{ org_id: 1, office_slug: 'conteudo' }]
    if (path.endsWith('/contrato')) return { tipo: 'byok' }
    if (path.endsWith('/settings/llm')) return llm
    throw new ApiError(403, 'Sem acesso nesta fixture')
  })
})

it('consulta somente as categorias visitadas e preserva o rascunho ao voltar', async () => {
  render(<MemoryRouter><AuthProvider><ConfigOrgCorpo orgId={1} /></AuthProvider></MemoryRouter>)
  const chave = await screen.findByLabelText('API key da Anthropic')
  expect(api.get).not.toHaveBeenCalledWith('/orgs/1/membros')
  expect(api.get).not.toHaveBeenCalledWith('/orgs/1/settings/notificacoes')
  expect(api.get).not.toHaveBeenCalledWith('/orgs/1/database')
  fireEvent.change(chave, { target: { value: 'rascunho-sintetico' } })
  fireEvent.click(screen.getByRole('button', { name: 'Minha conta' }))
  expect(screen.getByRole('combobox', { name: 'Idioma da interface' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Inteligência' }))
  expect(screen.getByLabelText('API key da Anthropic')).toBe(chave)
  expect(chave).toHaveValue('rascunho-sintetico')
  expect(api.put).not.toHaveBeenCalled()
})

it('falha no plano mostra recuperação e não oferece edições de conexão desconhecida', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(503, 'Plano indisponível')).mockResolvedValueOnce([])
  render(<MemoryRouter><ConfigOrgCorpo orgId={1} /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Não foi possível carregar seu plano' })).toBeVisible()
  expect(screen.queryByLabelText('API key da Anthropic')).not.toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalledWith('/orgs/1/settings/llm')
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByLabelText('API key da Anthropic')).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
})

it('nova empresa não recebe o rascunho de chave da empresa anterior', async () => {
  const tela = render(<MemoryRouter><ConfigOrgCorpo orgId={1} /></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('API key da Anthropic'), { target: { value: 'chave-sintetica-nao-salva' } })
  tela.rerender(<MemoryRouter><ConfigOrgCorpo orgId={2} /></MemoryRouter>)
  expect(await screen.findByLabelText('API key da Anthropic')).toHaveValue('')
  expect(api.put).not.toHaveBeenCalled()
})

it('outra sessão na mesma empresa não recebe chaves digitadas pela conta anterior', async () => {
  setTokens('acesso-sintetico-1', 'refresh-sintetico-1')
  const tela = render(<MemoryRouter><ConfigOrgCorpo orgId={1} /></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('API key da Anthropic'), { target: { value: 'rascunho-privado-da-conta-anterior' } })
  setTokens('acesso-sintetico-2', 'refresh-sintetico-2')
  tela.rerender(<MemoryRouter><ConfigOrgCorpo orgId={1} /></MemoryRouter>)
  expect(await screen.findByLabelText('API key da Anthropic')).toHaveValue('')
  expect(api.put).not.toHaveBeenCalled()
})

it('atalho de mídia abre somente sua categoria e o contrato não pede chaves ao cliente', async () => {
  window.history.replaceState(null, '', '/#midia')
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/predios') return [{ org_id: 1, office_slug: 'conteudo' }]
    if (path.endsWith('/contrato')) return { tipo: 'pf_gerenciado' }
    if (path.endsWith('/settings/notificacoes')) return { gerenciado: true, midia: { falai: true, elevenlabs: false } }
    throw new ApiError(403, 'Sem acesso nesta fixture')
  })
  render(<MemoryRouter><ConfigOrgCorpo orgId={1} /></MemoryRouter>)
  const servicos = await screen.findByRole('region', { name: 'Serviços de mídia do contrato' })
  expect(within(servicos).getByText('Habilitado no contrato')).toBeVisible()
  expect(within(servicos).getByText('Indisponível nesta configuração')).toBeVisible()
  expect(screen.queryByLabelText(/API key da/)).not.toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalledWith('/orgs/1/settings/llm')
  expect(api.get).not.toHaveBeenCalledWith('/orgs/1/membros')
  expect(api.post).not.toHaveBeenCalled()
})

it('mídia própria explica configuração sem prometer geração ou saldo', async () => {
  vi.mocked(api.get).mockResolvedValue({ midia: { falai: true, elevenlabs: false } })
  render(<SecaoEstudioMidia orgId={1} />)
  expect(await screen.findByText('✓ Configurada')).toBeVisible()
  expect(screen.getByText(/ainda não comprova saldo no fornecedor/)).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
})

it('membro sem permissão de chaves recebe orientação em vez de uma categoria vazia', async () => {
  vi.mocked(api.get).mockRejectedValue(new ApiError(403, 'Acesso reservado ao responsável'))
  render(<SecaoEstudioMidia orgId={1} />)
  expect(await screen.findByText(/O responsável pela empresa administra as conexões/)).toBeVisible()
  expect(screen.queryByLabelText(/API key da/)).not.toBeInTheDocument()
  expect(api.put).not.toHaveBeenCalled()
})

it('convite permanece copiável sem diálogo nativo quando o clipboard falha', async () => {
  let criado = false
  const convite = { id: 9, email: 'demo@example.test', role: 'member', expira_em: '2026-10-10T10:00:00', email_enviado: false }
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/predios') return [{ org_id: 1, office_slug: 'conteudo' }]
    if (path.endsWith('/contrato')) return { tipo: 'byok' }
    if (path.endsWith('/settings/llm')) return llm
    if (path.endsWith('/membros')) return { membros: [], andares_do_predio: ['conteudo'] }
    if (path.endsWith('/convites')) return criado ? [convite] : []
    throw new ApiError(403, 'Sem acesso nesta fixture')
  })
  vi.mocked(api.post).mockImplementation(async () => { criado = true; return { ...convite, link: 'https://example.test/convite/fixture' } })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Indisponível')) } })
  const prompt = vi.spyOn(window, 'prompt')
  render(<MemoryRouter><ConfigOrgCorpo orgId={1} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Empresa e equipe' }))
  fireEvent.change(await screen.findByRole('textbox', { name: 'E-mail de quem você quer convidar' }), { target: { value: 'demo@example.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Convidar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Copiar link' }))
  const campo = await screen.findByRole('textbox', { name: 'Selecione e copie o link do convite' })
  expect(campo).toHaveValue('https://example.test/convite/fixture')
  expect(campo).toHaveAttribute('readonly')
  expect(campo).toHaveFocus()
  expect(prompt).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar link' }))
  expect(screen.queryByRole('textbox', { name: 'Selecione e copie o link do convite' })).not.toBeInTheDocument()
})

it('chave MCP continua copiável sem clipboard, com teclado e restauração de foco', async () => {
  vi.mocked(api.get).mockResolvedValue([])
  vi.mocked(api.post).mockResolvedValue({ id: 12, key: 'offiz-mcp-fixture-nao-real', key_prefix: 'offiz-fixture' })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Indisponível')) } })
  const prompt = vi.spyOn(window, 'prompt')
  render(<SecaoMcpKeys orgId={1} />)
  const criar = screen.getByRole('button', { name: 'Criar chave' })
  criar.focus()
  fireEvent.click(criar)
  const dialog = await screen.findByRole('dialog', { name: 'Nova chave MCP' })
  const campo = within(dialog).getByRole('textbox', { name: 'Chave MCP criada' })
  expect(campo).toHaveFocus()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copiar' }))
  expect(await within(dialog).findByText(/A cópia automática não está disponível/)).toBeVisible()
  expect(campo).toHaveValue('offiz-mcp-fixture-nao-real')
  expect(prompt).not.toHaveBeenCalled()
  fireEvent.keyDown(campo, { key: 'Tab', shiftKey: true })
  expect(within(dialog).getByRole('button', { name: 'Fechar' })).toHaveFocus()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(criar).toHaveFocus()
})

it('erro de diagnóstico local oferece nova verificação sem fingir que precisa instalar', async () => {
  window.offizMotor = {
    estado: vi.fn(async () => ({ config: { orgId: 1, localEngine: 'codex' }, pareado: true, worker: { estado: 'ocioso', jobAtual: null, log: [] } })),
    claudeStatus: vi.fn(async () => ({ installed: false })),
    codexStatus: vi.fn().mockRejectedValueOnce(new Error('Indisponível')).mockResolvedValue({ installed: true, authenticated: true }),
    onUpdate: vi.fn(() => () => {}), onInstalarLinha: vi.fn(() => () => {}),
  } as unknown as NonNullable<Window['offizMotor']>
  render(<MemoryRouter><PainelMotorEmbutido orgId={1} aoMudarPareamento={vi.fn()} /></MemoryRouter>)
  expect(await screen.findByText('Não foi possível verificar o Codex.')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Instalar Codex CLI' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Verificar conexão' }))
  await waitFor(() => expect(screen.queryByText('Não foi possível verificar o Codex.')).not.toBeInTheDocument())
  fireEvent.click(screen.getByText('Conta ChatGPT / OpenAI'))
  expect(screen.getByText('✓ Conectado')).toBeVisible()
  expect(api.put).not.toHaveBeenCalled()
})

it('falha ao verificar o motor permite recuperar o status sem iniciar processos', async () => {
  window.offizMotor = {
    estado: vi.fn().mockRejectedValueOnce(new Error('Indisponível')).mockResolvedValue({ config: { orgId: 1, localEngine: 'codex' }, pareado: true, worker: { estado: 'parado', jobAtual: null, log: [] } }),
    claudeStatus: vi.fn(async () => ({ installed: false })), codexStatus: vi.fn(async () => ({ installed: true, authenticated: true })),
    onUpdate: vi.fn(() => () => {}), onInstalarLinha: vi.fn(() => () => {}), ligar: vi.fn(async () => ({ ok: true })),
  } as unknown as NonNullable<Window['offizMotor']>
  render(<MemoryRouter><PainelMotorEmbutido orgId={1} aoMudarPareamento={vi.fn()} /></MemoryRouter>)
  expect(await screen.findByText('Não foi possível verificar o motor desta máquina.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Verificar motor' }))
  expect(await screen.findByRole('button', { name: 'Ligar o motor' })).toBeEnabled()
  expect(window.offizMotor.ligar).not.toHaveBeenCalled()
})

it('resposta negativa ao ligar recebe feedback e pareamento de outra empresa impede ligar', async () => {
  const estado = { config: { orgId: 1, localEngine: 'codex' }, pareado: true, worker: { estado: 'parado', jobAtual: null, log: [] } }
  window.offizMotor = {
    estado: vi.fn(async () => estado), claudeStatus: vi.fn(async () => ({ installed: false })), codexStatus: vi.fn(async () => ({ installed: true, authenticated: true })),
    onUpdate: vi.fn(() => () => {}), onInstalarLinha: vi.fn(() => () => {}), ligar: vi.fn(async () => ({ ok: false })),
  } as unknown as NonNullable<Window['offizMotor']>
  const tela = render(<MemoryRouter><PainelMotorEmbutido orgId={1} aoMudarPareamento={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Ligar o motor' }))
  await waitFor(() => expect(toasts.falha).toHaveBeenCalledWith('Não foi possível ligar o motor.'))
  tela.unmount()
  render(<MemoryRouter><PainelMotorEmbutido orgId={2} aoMudarPareamento={vi.fn()} /></MemoryRouter>)
  const ligar = await screen.findByRole('button', { name: 'Ligar o motor' })
  expect(ligar).toBeDisabled()
  fireEvent.click(ligar)
  expect(window.offizMotor.ligar).toHaveBeenCalledTimes(1)
})
