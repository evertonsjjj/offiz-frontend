import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { api, clearTokens, setTokens } from '../../lib/api'
import { IdiomaProvider } from '../../lib/i18n'
import { SeletorIdioma } from '../SeletorIdioma'
import { ClientesTab } from './ClientesTab'
import { CasosTab } from './CasosTab'
import { BibliotecaTab } from './BibliotecaTab'
import { MonitorTab } from './MonitorTab'
import { PentestTab } from './PentestTab'

vi.mock('../../lib/api', async (original) => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn() },
  carregarArquivo: vi.fn(), baixarArquivo: vi.fn(),
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn() }) }))
// A geração de peças é independente do formulário e não deve rodar ao cadastrar um caso.
vi.mock('./PecasCaso', () => ({ PecasCaso: () => null }))

const office = { slug: 'financeiro', nome: 'Escritório do João', descricao: '', upload_mensal: true, tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const cliente = { id: 51, nome: 'João & Filhos', observacoes: 'Plano financeiro em português — não traduzir.', status: 'ativo', granularidade: 'anual', notificacao: 'semanal', periodos: [] }
const caso = { id: 61, cliente_nome: 'João & Filhos', descricao: 'Descrição original: preservar a revisão do João.', status: 'em_andamento', tipo_cliente: 'PJ', polo_cliente: 'reu', area_direito: 'civil', documentos: [] }

function RotaAtual() {
  const location = useLocation()
  return <output data-testid="rota-atual">{location.pathname + location.search}</output>
}
function montar(children: ReactNode, route: string) {
  return render(<IdiomaProvider><MemoryRouter initialEntries={[route]}><SeletorIdioma /><RotaAtual />{children}</MemoryRouter></IdiomaProvider>)
}
async function trocar(idioma: 'pt-BR' | 'en') {
  fireEvent.change(screen.getByRole('combobox', { name: /Idioma da interface|Interface language/ }), { target: { value: idioma } })
  await waitFor(() => expect(document.documentElement.lang).toBe(idioma))
}
function rota() { return screen.getByTestId('rota-atual').textContent }

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  localStorage.setItem('offiz:idioma:visitante', 'en')
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/predios/7/financeiro/clientes/51') return cliente
    if (path === '/predios/7/juris/casos/61') return caso
    if (path.endsWith('/pecas-tipos')) return { tipos: [{ id: 'inicial_civel', nome: 'Inicial cível' }] }
    return { clientes: [], casos: [], itens: [], entregas: [], processos: [], eventos: [] }
  })
  vi.mocked(api.post).mockResolvedValue({ id: 99 })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('novo cliente mantém os campos montados, a rota e os enums ao alternar English → PT → English', async () => {
  vi.mocked(api.post).mockResolvedValue(cliente)
  const inicial = '/app?org=7&slug=financeiro&f=clientes&novocli=1'
  montar(<ClientesTab orgId={7} slug="financeiro" office={office} />, inicial)
  const nome = screen.getByRole('textbox', { name: 'Name *' })
  const resumo = screen.getByRole('textbox', { name: 'Client summary' })
  fireEvent.change(nome, { target: { value: cliente.nome } })
  fireEvent.change(resumo, { target: { value: cliente.observacoes } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Investor profile' }), { target: { value: 'moderado' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Period organization' }), { target: { value: 'anual' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Tips notifications' }), { target: { value: 'semanal' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Send day' }), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '13:45' } })

  await trocar('pt-BR')
  expect(screen.getByRole('textbox', { name: 'Nome *' })).toBe(nome)
  expect(screen.getByRole('textbox', { name: 'Resumo do cliente' })).toBe(resumo)
  expect(resumo).toHaveValue(cliente.observacoes)
  expect(rota()).toBe(inicial)
  await trocar('en')
  expect(screen.getByRole('textbox', { name: 'Name *' })).toBe(nome)
  expect(nome).toHaveValue(cliente.nome)
  expect(screen.getByRole('combobox', { name: 'Investor profile' })).toHaveValue('moderado')
  expect(screen.getByRole('combobox', { name: 'Send day' })).toHaveValue('2')
  expect(rota()).toBe(inicial)
  expect(api.post).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Save client' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  expect(api.post).toHaveBeenCalledWith('/predios/7/financeiro/clientes', {
    nome: cliente.nome, email: undefined, celular: undefined, tipo: undefined, site: undefined,
    consentimento_pentest: false, perfil_investidor: 'moderado', granularidade: 'anual', notificacao: 'semanal',
    envio_dia: 2, envio_hora: '13:45', envio_email: true, observacoes: cliente.observacoes,
  })
  await waitFor(() => expect(rota()).toBe('/app?org=7&slug=financeiro&f=clientes&cliente=51'))
  expect(api.put).not.toHaveBeenCalled()
  expect(api.postForm).not.toHaveBeenCalled()
})

it('novo caso preserva nome, descrição e chaves de domínio, sem trocar novo/caso por chaves em inglês', async () => {
  vi.mocked(api.post).mockResolvedValue(caso)
  const inicial = '/app?org=7&slug=juris&f=casos&novo=1'
  montar(<CasosTab orgId={7} slug="juris" />, inicial)
  const nome = screen.getByRole('textbox', { name: 'Client / party *' })
  const descricao = screen.getByRole('textbox', { name: 'Description / notes' })
  fireEvent.change(nome, { target: { value: caso.cliente_nome } })
  fireEvent.change(descricao, { target: { value: caso.descricao } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Client type' }), { target: { value: 'PJ' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Party position' }), { target: { value: 'reu' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Practice area' }), { target: { value: 'civil' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'em_andamento' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Case number' }), { target: { value: '0000001-23.2026.8.26.0100' } })

  await trocar('pt-BR')
  expect(screen.getByRole('textbox', { name: 'Cliente / parte *' })).toBe(nome)
  expect(screen.getByRole('textbox', { name: 'Descrição / observações' })).toBe(descricao)
  expect(descricao).toHaveValue(caso.descricao)
  expect(rota()).toBe(inicial)
  await trocar('en')
  expect(screen.getByRole('textbox', { name: 'Client / party *' })).toBe(nome)
  expect(nome).toHaveValue(caso.cliente_nome)
  expect(screen.getByRole('combobox', { name: 'Party position' })).toHaveValue('reu')
  expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('em_andamento')
  expect(rota()).toBe(inicial)
  expect(api.post).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Save case' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  expect(api.post).toHaveBeenCalledWith('/predios/7/juris/casos', {
    cliente_nome: caso.cliente_nome, tipo_cliente: 'PJ', polo_cliente: 'reu', area_direito: 'civil',
    status: 'em_andamento', numero_processo: '0000001-23.2026.8.26.0100', descricao: caso.descricao,
  })
  await waitFor(() => expect(rota()).toBe('/app?org=7&slug=juris&f=casos&caso=61'))
  expect(api.postForm).not.toHaveBeenCalled()
})

it('biblioteca mantém o editor e o texto original ao trocar idioma, salvando tipo modelo e metadados canônicos', async () => {
  const inicial = '/app?org=7&slug=juris&f=biblioteca'
  montar(<BibliotecaTab orgId={7} slug="juris" />, inicial)
  fireEvent.click(await screen.findByRole('button', { name: 'New template' }))
  const editor = screen.getByRole('dialog')
  const titulo = within(editor).getByRole('textbox', { name: 'Title *' })
  const conteudo = within(editor).getByRole('textbox', { name: 'Content *' })
  const textoOriginal = '  Salvar caso\n\nDescrição / observações: João não autorizou a publicação.\n'
  fireEvent.change(titulo, { target: { value: 'Novo cliente' } })
  fireEvent.change(conteudo, { target: { value: textoOriginal } })
  fireEvent.change(within(editor).getByRole('textbox', { name: 'Description' }), { target: { value: 'Modelo criado por João.' } })
  fireEvent.change(within(editor).getByRole('combobox', { name: 'Practice area' }), { target: { value: 'civil' } })

  await trocar('pt-BR')
  expect(screen.getByRole('dialog')).toBe(editor)
  expect(within(editor).getByRole('textbox', { name: 'Título *' })).toBe(titulo)
  expect(within(editor).getByRole('textbox', { name: 'Conteúdo *' })).toBe(conteudo)
  expect(conteudo).toHaveValue(textoOriginal)
  expect(rota()).toBe(inicial)
  await trocar('en')
  expect(within(editor).getByRole('textbox', { name: 'Title *' })).toBe(titulo)
  expect(titulo).toHaveValue('Novo cliente')
  expect(conteudo).toHaveValue(textoOriginal)
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(within(editor).getByRole('button', { name: 'Create template' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  expect(api.post).toHaveBeenCalledWith('/predios/7/juris/biblioteca', {
    tipo: 'modelo', titulo: 'Novo cliente', descricao: 'Modelo criado por João.', tipo_peca: undefined,
    area_direito: 'civil', tags: [], conteudo: textoOriginal,
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(rota()).toBe(inicial)
  expect(api.get).toHaveBeenCalledWith('/predios/7/juris/biblioteca?tipo=modelo', expect.any(AbortSignal))
})

it('monitor preserva CNJ e apelido durante a troca e salva prioridade pelo enum original', async () => {
  montar(<MonitorTab orgId={7} slug="juris" />, '/app?org=7&slug=juris&f=monitor')
  fireEvent.click(await screen.findByRole('button', { name: 'Add case' }))
  const cnj = screen.getByPlaceholderText('0000000-00.0000.0.00.0000')
  const apelido = screen.getByRole('textbox', { name: 'Nickname (optional)' })
  fireEvent.change(cnj, { target: { value: '0000001-23.2026.8.26.0100' } })
  fireEvent.change(apelido, { target: { value: 'Aposentadoria — João' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), { target: { value: 'alta' } })
  await trocar('pt-BR')
  expect(screen.getByRole('textbox', { name: 'Apelido (opcional)' })).toBe(apelido)
  expect(apelido).toHaveValue('Aposentadoria — João')
  await trocar('en')
  expect(screen.getByPlaceholderText('0000000-00.0000.0.00.0000')).toBe(cnj)
  expect(cnj).toHaveValue('0000001-23.2026.8.26.0100')
  expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveValue('alta')
  expect(screen.getByRole('button', { name: 'Look up' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Monitor case' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/7/juris/monitor/processos', {
    numero_cnj: '00000012320268260100', apelido: 'Aposentadoria — João', prioridade: 'alta',
  }))
  expect(vi.mocked(api.get).mock.calls.every(([path]) => !path.includes('/lookup'))).toBe(true)
})

it('pentest troca apenas rótulos: mantém cliente, consentimento e o mesmo pedido de produção em inglês e português', async () => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('HTTP real proibido nesta fixture') }))
  sessionStorage.clear()
  setTokens('fixture-specialists-access', 'fixture-specialists-refresh')
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/auth/me') return { id: 7, email: 'especialistas@example.invalid' }
    if (path === '/predios/7/conformidade/clientes') return { clientes: [{ id: 51, nome: 'São João', site: 'https://site.test', consentimento_pentest: false, status: 'ativo' }] }
    if (path === '/predios/7/conformidade/entregas?cliente_id=51') return { entregas: [] }
    throw new Error(`Leitura inesperada: ${path}`)
  })
  vi.mocked(api.post).mockImplementation(async (_path, corpo) => ({ id: 99, request_id: (corpo as { request_id: string }).request_id, office_slug: 'conformidade', replayed: false }))
  const tela = montar(<PentestTab orgId={7} slug="conformidade" />, '/app?org=7&slug=conformidade&f=pentest')
  try {
    const clienteSelecionado = await screen.findByRole('combobox', { name: 'Client' })
    fireEvent.change(clienteSelecionado, { target: { value: '51' } })
    const cards = tela.container.querySelectorAll<HTMLElement>('.pentest-acao')
    expect(screen.getByRole('option', { name: 'São João — site.test' })).toBeInTheDocument()
    expect(screen.getByText('written authorization')).toBeInTheDocument()
    expect(within(cards[1]).getByRole('button', { name: 'Start' })).toBeDisabled()
    await waitFor(() => expect(within(cards[0]).getByRole('button', { name: 'Start' })).toBeEnabled())
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Start' }))
    await within(cards[0]).findByRole('button', { name: 'Prepare another request' })
    expect(api.get).toHaveBeenCalledWith('/auth/me')
    expect(api.post).toHaveBeenCalledTimes(1)
    const [path, payload] = vi.mocked(api.post).mock.calls[0] as [string, { cliente_id: number; prompt: string; request_id: string }]
    expect(path).toBe('/predios/7/conformidade/jobs')
    expect(payload).toMatchObject({ cliente_id: 51, prompt: expect.stringContaining('Rode a varredura pública (Camada 1) do cliente São João com a skill varredura-publica') })
    expect(payload).toMatchObject({ prompt: expect.stringContaining('Respeite o robots.txt e não tente contornar proteção nenhuma.') })
    expect(payload.request_id).toMatch(/^[0-9a-f-]{36}$/)

    await trocar('pt-BR')
    expect(screen.getByRole('combobox', { name: 'Cliente' })).toBe(clienteSelecionado)
    expect(clienteSelecionado).toHaveValue('51')
    expect(tela.container.querySelectorAll('.pentest-acao')[0]).toBe(cards[0])
    expect(screen.getByText('autorização escrita')).toBeInTheDocument()
    expect(within(cards[1]).getByRole('button', { name: 'Começar' })).toBeDisabled()
    expect(rota()).toBe('/app?org=7&slug=conformidade&f=pentest')
    expect(api.post).toHaveBeenCalledTimes(1)
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Preparar outro pedido' }))
    expect(api.post).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(within(cards[0]).getByRole('button', { name: 'Começar' })).toBeEnabled())
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Começar' }))
    await within(cards[0]).findByRole('button', { name: 'Preparar outro pedido' })
    expect(api.post).toHaveBeenCalledTimes(2)
    const [segundoPath, segundoPayload] = vi.mocked(api.post).mock.calls[1] as [string, { request_id: string }]
    expect(segundoPath).toBe(path)
    expect(segundoPayload.request_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(segundoPayload.request_id).not.toBe(payload.request_id)
    expect({ ...segundoPayload, request_id: payload.request_id }).toEqual(payload)

    await trocar('en')
    expect(screen.getByRole('combobox', { name: 'Client' })).toBe(clienteSelecionado)
    expect(clienteSelecionado).toHaveValue('51')
    expect(tela.container.querySelectorAll('.pentest-acao')[0]).toBe(cards[0])
    expect(within(cards[1]).getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(within(cards[0]).getByRole('button', { name: 'Prepare another request' })).toBeEnabled()
    expect(api.post).toHaveBeenCalledTimes(2)
  } finally {
    tela.unmount()
    clearTokens()
    sessionStorage.clear()
    vi.unstubAllGlobals()
  }
})
