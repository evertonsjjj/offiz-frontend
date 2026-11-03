import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, getSessionIdentity, setTokens } from '../lib/api'
import type { InicioOrganizacao, SolucaoInicio } from '../lib/inicio'
import { OffizInicio } from './Ceo'
import { PainelMotorEmbutido } from './ConfigOrg'

vi.mock('../lib/api', async (original) => ({
  ...await original<typeof import('../lib/api')>(),
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() },
}))
vi.mock('../components/Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))

const aprendida: SolucaoInicio = {
  id: 'aprendida:semana', origem: 'aprendida', fixada: false, atualizada_em: '2026-09-09T12:00:00Z',
  titulo: 'Apresentação semanal da equipe', descricao: 'Alinhe prioridades a partir dos dados da semana.',
  prompt: 'Quero montar a apresentação semanal da equipe.', motivo: 'Você prepara essa apresentação toda segunda-feira.',
  andar: 'financeiro', tipo: 'apresentacao', entrega: 'Apresentação para revisão', insumos: ['Dados da semana'], etapas: ['Conferir os dados', 'Preparar os slides'],
}
const catalogo: SolucaoInicio = { ...aprendida, id: 'catalogo-video', origem: 'catalogo', titulo: 'Criar um vídeo', motivo: undefined }
const inicio: InicioOrganizacao = {
  org_id: 3, org_nome: 'Empresa de teste', org_status: 'ativa', meu_papel: 'member', tem_chave: true,
  andares: [{ slug: 'financeiro', nome: 'Financeiro', descricao: '' }],
  solucoes: [aprendida, catalogo], outras_solucoes: [], solucoes_ocultas: [],
  sabatina: { estado: 'contextualizado', pergunta: 'Por onde quer começar?', opcoes: [], permite_livre: true },
}
let dados: InicioOrganizacao
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  dados = inicio
  vi.mocked(api.get).mockImplementation(async (path) => path === '/orgs/3/inicio' ? dados : path.endsWith('/editorial') ? [] : respostaBiblioteca(path))
  vi.mocked(api.patch).mockResolvedValue(undefined)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})
afterEach(() => { cleanup(); delete window.offizMotor; vi.restoreAllMocks() })
const saldoDaModalidade = (gerenciado = !!dados.contrato_gerenciado, disponivel = 100) => ({ tipo: gerenciado ? 'pf_gerenciado' : 'byok', vigencia: 'vigente', periodo: '2026-10', consultado_em: '2026-10-03T23:00:00Z', renovacao_em: null, estado: gerenciado ? 'disponivel' : 'conta_propria', limite_brl_mes: gerenciado ? 100 : null, credito_brl: gerenciado ? 0 : null, total_brl: gerenciado ? 100 : null, consumido_brl: gerenciado ? 100 - disponivel : null, reservado_brl: gerenciado ? 0 : null, disponivel_brl: gerenciado ? disponivel : null, percentual_disponivel: gerenciado ? disponivel : null })
const consumoVazio = { totais: { tokens: 0, estimado_api_brl: 0, consumido_gerenciado_brl: 0, equivalente_assinatura_brl: 0, estimativa_legada_brl: 0, reservado_brl: 0, sem_medicao: 0 }, meses: [], conexoes: [], cobertura: [] }
const respostaBiblioteca = (path: string) => path.endsWith('/uso') || path.endsWith('/uso/historico') ? consumoVazio : path.endsWith('/saldo') ? saldoDaModalidade() : /^\/predios\/\d+\/[^/]+$/.test(path) ? { office: { slug: path.split('/').pop(), nome: 'Área de teste', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } } } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : path.includes('/biblioteca') ? { itens: [], total: 0, resumo: { prontos: 0, precisa_de_voce: 0, em_producao: 0, aprovados: 0 } } : { conversas: [] }
const montar = () => render(<MemoryRouter><OffizInicio orgId={3} /></MemoryRouter>)
async function abrirMais() {
  const resumo = await screen.findByLabelText('Mais: agenda e ferramentas')
  const menu = resumo.closest('details')!
  if (!menu.open) fireEvent.click(resumo)
  return menu
}
async function encontrarOrigem(nome: string) {
  await abrirMais()
  return screen.findByRole('button', { name: nome })
}
function EnderecoDaTela() { return <output aria-label="Endereço da tela">{useLocation().search}</output> }
function AncoraDaTela() { return <output aria-label="Âncora da tela">{useLocation().hash}</output> }

it('saldo compacto usa o topo e a origem fica em Mais, sem faixa separada ou consulta duplicada', async () => {
  dados = { ...inicio, contrato_gerenciado: true, meu_papel: 'owner' }
  const view = montar()
  const resumo = await screen.findByLabelText(/Saldo de IA: R\$\s*100,00/)
  expect(resumo.closest('header')).toHaveClass('inicio-topo')
  expect(resumo.closest('details')).toHaveClass('saldo-ia--compacto')
  expect(view.container.querySelector('.inicio-operacao')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Contrato Offiz: Configurada' })).not.toBeVisible()
  expect(await encontrarOrigem('Contrato Offiz: Configurada')).toBeVisible()
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/3/saldo')).toHaveLength(1)
  expect(api.post).not.toHaveBeenCalled()
})

it('tela estreita coloca um único saldo em Mais e mantém os detalhes e o valor atual', async () => {
  vi.stubGlobal('matchMedia', vi.fn(media => ({ matches: true, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  try {
    dados = { ...inicio, contrato_gerenciado: true, meu_papel: 'owner' }
    const view = montar()
    const menu = await abrirMais()
    const resumo = await within(menu).findByLabelText(/Saldo de IA: R\$\s*100,00/)
    expect(view.container.querySelectorAll('.saldo-ia')).toHaveLength(1)
    fireEvent.click(resumo)
    expect(within(menu).getByRole('meter')).toHaveAttribute('aria-valuenow', '100')
    expect(within(menu).getByRole('button', { name: 'Atualizar saldo' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menu).toHaveAttribute('open')
    expect(resumo).toHaveFocus()
    expect(resumo).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menu).not.toHaveAttribute('open')
    expect(screen.getByLabelText('Mais: agenda e ferramentas')).toHaveFocus()
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/3/saldo')).toHaveLength(1)
    expect(api.post).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})

const officeJuris = { slug: 'juris', nome: 'Jurídico', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
function prepararJuridico() {
  dados = { ...inicio, andares: [officeJuris, ...inicio.andares], solucoes: [], outras_solucoes: [] }
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados : path.includes('/casos') ? []
    : path === '/orgs/3/biblioteca/35' ? { id: 35, office_slug: 'juris', titulo: 'Peça de teste', estado: 'pronto', status: 'done', arquivos: [], desatualizados: [] }
    : respostaBiblioteca(path))
}

it('atalhos jurídicos abrem modelos sem perder rascunho, conversa ou referências', async () => {
  prepararJuridico()
  render(<MemoryRouter initialEntries={['/app?org=3&slug=juris&conversa=nova&trabalho=35#modelo']}><EnderecoDaTela /><AncoraDaTela /><OffizInicio orgId={3} areaSlug="juris" areaOffice={officeJuris} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /Pesquisa Jurídica/ }))
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Rascunho da pesquisa do caso.' } })
  const rotina = screen.getByRole('navigation', { name: 'Rotina jurídica' })
  expect(within(rotina).getByRole('link', { name: 'Casos' })).toHaveAttribute('href', expect.stringContaining('vista=casos'))
  expect(within(rotina).getByRole('link', { name: 'Monitor' })).toBeVisible()
  fireEvent.click(within(rotina).getByRole('link', { name: 'Doutrina & Modelos' }))
  const painel = await screen.findByRole('complementary', { name: 'Doutrina & Modelos' })
  expect(within(rotina).getByRole('link', { name: 'Doutrina & Modelos' })).toHaveAttribute('aria-current', 'page')
  for (const parametro of ['org=3', 'slug=juris', 'conversa=nova', 'trabalho=35', 'vista=doutrina-modelos']) expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent(parametro)
  expect(screen.getByLabelText('Âncora da tela')).toHaveTextContent('#modelo')
  fireEvent.click(within(painel).getByRole('button', { name: 'Voltar à conversa' }))
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(campo).toHaveValue('Rascunho da pesquisa do caso.')
  expect(api.post).not.toHaveBeenCalled()
})

it('atalhos jurídicos respeitam as ferramentas concedidas no manifesto', async () => {
  prepararJuridico()
  render(<MemoryRouter initialEntries={['/app?org=3&slug=juris']}><OffizInicio orgId={3} areaSlug="juris" areaOffice={{ ...officeJuris, abas: ['conversa', 'casos'] }} /></MemoryRouter>)
  const rotina = await screen.findByRole('navigation', { name: 'Rotina jurídica' })
  expect(within(rotina).getAllByRole('link')).toHaveLength(1)
  expect(within(rotina).getByRole('link', { name: 'Casos' })).toBeVisible()
})

it('Doutrina & Modelos abre a biblioteca jurídica pelo menu mantendo o pedido', async () => {
  prepararJuridico()
  render(<MemoryRouter initialEntries={['/app?org=3&slug=juris&conversa=nova&trabalho=35&arquivo=93&projeto=2']}><EnderecoDaTela /><OffizInicio orgId={3} areaSlug="juris" areaOffice={officeJuris} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /Pesquisa Jurídica/ }))
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Quero comparar os modelos antes de preparar a peça.' } })
  fireEvent.click(screen.getByText('Mais', { exact: true }))
  const menu = screen.getByText('Mais', { exact: true }).closest('details')!
  fireEvent.click(within(menu).getByRole('button', { name: 'Doutrina & Modelos' }))
  const painel = await screen.findByRole('complementary', { name: 'Doutrina & Modelos' })
  expect(await within(painel).findByRole('tab', { name: /^Modelos de Peça/ })).toBeInTheDocument()
  expect(within(painel).getByRole('tab', { name: /^Doutrinas \(livros\)/ })).toBeInTheDocument()
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/predios/3/juris/biblioteca?tipo=modelo', expect.any(AbortSignal)))
  expect(screen.queryByRole('complementary', { name: 'Pedidos e entregas' })).not.toBeInTheDocument()
  expect(menu).not.toHaveAttribute('open')
  const endereco = screen.getByLabelText('Endereço da tela')
  for (const parametro of ['vista=doutrina-modelos', 'area=juris', 'slug=juris', 'conversa=nova', 'trabalho=35', 'arquivo=93', 'projeto=2']) expect(endereco).toHaveTextContent(parametro)
  fireEvent.click(within(painel).getByRole('button', { name: 'Voltar à conversa' }))
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(campo).toHaveValue('Quero comparar os modelos antes de preparar a peça.')
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it.each([
  ['slug=juris&f=biblioteca', true],
  ['area=juris&f=biblioteca', false],
  ['slug=juris&vista=doutrina-modelos', true],
])('destino jurídico %s conserva o assunto e os alvos sem abrir pedidos', async (rota, andar) => {
  prepararJuridico()
  render(<MemoryRouter initialEntries={[`/app?org=3&${rota}&conversa=nova&trabalho=35&arquivo=93&projeto=2`]}><EnderecoDaTela /><OffizInicio orgId={3} {...(andar ? { areaSlug: 'juris', areaOffice: officeJuris } : {})} /></MemoryRouter>)
  const painel = await screen.findByRole('complementary', { name: 'Doutrina & Modelos' })
  expect(await within(painel).findByRole('tab', { name: /^Modelos de Peça/ })).toBeInTheDocument()
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/predios/3/juris/biblioteca?tipo=modelo', expect.any(AbortSignal)))
  const endereco = new URLSearchParams(screen.getByLabelText('Endereço da tela').textContent!)
  expect(endereco.get('vista')).toBe('doutrina-modelos')
  expect(endereco.has('f')).toBe(false)
  for (const [chave, valor] of [['conversa', 'nova'], ['trabalho', '35'], ['arquivo', '93'], ['projeto', '2']]) expect(endereco.get(chave)).toBe(valor)
  expect(api.post).not.toHaveBeenCalled()
})

it('vista=biblioteca permanece Pedidos e entregas mesmo na área jurídica', async () => {
  prepararJuridico()
  render(<MemoryRouter initialEntries={['/app?org=3&slug=juris&vista=biblioteca&f=biblioteca&conversa=nova']}><EnderecoDaTela /><OffizInicio orgId={3} areaSlug="juris" areaOffice={officeJuris} /></MemoryRouter>)
  expect(await screen.findByRole('complementary', { name: 'Pedidos e entregas' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /^Modelos de Peça/ })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Pedidos e entregas' })).toHaveAttribute('aria-current', 'page')
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.startsWith('/predios/3/juris/biblioteca'))).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it('destino jurídico legado conserva a âncora ao normalizar o favorito', async () => {
  prepararJuridico()
  render(<MemoryRouter initialEntries={['/app?org=3&slug=juris&f=biblioteca&conversa=nova#modelo']}><EnderecoDaTela /><AncoraDaTela /><OffizInicio orgId={3} areaSlug="juris" areaOffice={officeJuris} /></MemoryRouter>)
  const painel = await screen.findByRole('complementary', { name: 'Doutrina & Modelos' })
  expect(await within(painel).findByRole('tab', { name: /^Modelos de Peça/ })).toBeInTheDocument()
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('vista=doutrina-modelos')
  expect(screen.getByLabelText('Âncora da tela')).toHaveTextContent('#modelo')
  expect(api.post).not.toHaveBeenCalled()
})

it('nome da biblioteca no manifesto mantém o destino jurídico na conversa geral', async () => {
  prepararJuridico()
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados : path === '/predios/3/juris'
    ? { office: { ...officeJuris, abas: [{ id: 'biblioteca', rotulo: 'Pesquisa e modelos' }] } }
    : respostaBiblioteca(path))
  render(<MemoryRouter initialEntries={['/app?org=3&area=juris&conversa=nova']}><EnderecoDaTela /><OffizInicio orgId={3} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Pesquisa e modelos' }))
  const painel = await screen.findByRole('complementary', { name: 'Pesquisa e modelos' })
  expect(await within(painel).findByRole('tab', { name: /^Modelos de Peça/ })).toBeInTheDocument()
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('vista=doutrina-modelos')
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('conversa=nova')
  expect(api.post).not.toHaveBeenCalled()
})

it('destino jurídico direto não ignora uma biblioteca excluída do manifesto', async () => {
  prepararJuridico()
  render(<MemoryRouter initialEntries={['/app?org=3&slug=juris&vista=doutrina-modelos']}><OffizInicio orgId={3} areaSlug="juris" areaOffice={{ ...officeJuris, abas: ['conversa', 'casos'] }} /></MemoryRouter>)
  await screen.findByRole('button', { name: /Pesquisa Jurídica/ })
  expect(screen.queryByRole('complementary', { name: 'Doutrina & Modelos' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /^Modelos de Peça/ })).not.toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.startsWith('/predios/3/juris/biblioteca'))).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['vista=conversa', 'f=conversa'])('Geração de Peça abre Casos no destino canônico a partir de %s sem perder a conversa ou o alvo', async rota => {
  prepararJuridico()
  render(<MemoryRouter initialEntries={[`/app?org=3&slug=juris&conversa=nova&area=financeiro&trabalho=35&arquivo=93&projeto=2&${rota}`]}><EnderecoDaTela /><OffizInicio orgId={3} areaSlug="juris" areaOffice={officeJuris} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /Geração de Peça/ }))
  expect(await screen.findByRole('complementary', { name: 'Casos' })).toBeVisible()
  const endereco = screen.getByLabelText('Endereço da tela')
  for (const parametro of ['vista=casos', 'area=juris', 'slug=juris', 'conversa=nova', 'trabalho=35', 'arquivo=93', 'projeto=2']) expect(endereco).toHaveTextContent(parametro)
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it('criar o primeiro caso abre o painel mantendo o rascunho jurídico', async () => {
  prepararJuridico()
  render(<MemoryRouter initialEntries={['/app?org=3&slug=juris&conversa=nova&vista=conversa']}><EnderecoDaTela /><OffizInicio orgId={3} areaSlug="juris" areaOffice={officeJuris} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /Conversar sobre um Caso/ }))
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Quero entender a situação do meu cliente.' } })
  fireEvent.click(screen.getByRole('button', { name: /crie o primeiro na aba Casos/ }))
  expect(await screen.findByRole('complementary', { name: 'Casos' })).toBeVisible()
  expect(campo).toHaveValue('Quero entender a situação do meu cliente.')
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('conversa=nova')
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['f=entregas', 'vista=entregas', 'f=tarefas'])('destino antigo %s abre a mesma biblioteca de pedidos', async legado => {
  render(<MemoryRouter initialEntries={[`/app?org=3&${legado}`]}><EnderecoDaTela /><OffizInicio orgId={3} /></MemoryRouter>)
  expect(await screen.findByRole('complementary', { name: 'Pedidos e entregas' })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('vista=biblioteca'))
  expect(screen.getByRole('link', { name: 'Pedidos e entregas' })).toHaveAttribute('aria-current', 'page')
  expect(api.post).not.toHaveBeenCalled()
})

it('a área desconhecida não abre silenciosamente o primeiro escritório', async () => {
  render(<MemoryRouter initialEntries={['/app?org=3&vista=acervo&area=inexistente']}><OffizInicio orgId={3} /></MemoryRouter>)
  expect(await screen.findByText(/Esta área não está disponível nesta empresa/)).toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/predios/3/financeiro')).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it('Mais mostra a origem do contrato e da API própria sem prometer teste do provedor', async () => {
  dados = { ...inicio, contrato_gerenciado: true }
  const view = montar()
  await abrirMais()
  expect(await screen.findByText('Contrato Offiz')).toBeVisible()
  await waitFor(() => expect(screen.getByText('Configurada')).toBeVisible())
  view.unmount()
  dados = { ...inicio, contrato_gerenciado: false }
  montar()
  await abrirMais()
  expect(await screen.findByText('API própria')).toBeVisible()
})

it('envio com Codex desconectado explica a pendência e preserva o rascunho', async () => {
  dados = { ...inicio, meu_papel: 'owner', contrato_gerenciado: true, motor_modo: 'cli' }
  window.offizMotor = {
    chatDeviceId: 'device-test', estado: vi.fn(async () => ({ config: { orgId: 3, localEngine: 'codex' }, pareado: true, worker: { estado: 'ocioso', log: [] } })),
    onUpdate: vi.fn(() => () => {}), onInstalarLinha: vi.fn(() => () => {}),
    claudeStatus: vi.fn(async () => ({ installed: false })), codexStatus: vi.fn(async () => ({ installed: true, authenticated: false })),
  } as unknown as NonNullable<Window['offizMotor']>
  montar()
  const status = await screen.findByRole('button', { name: 'Motor local: Conectar conta' })
  expect(status).toHaveTextContent('Codex')
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Demo de roupas' } })
  fireEvent.keyDown(campo, { key: 'Enter', code: 'Enter' })
  expect(await screen.findByText(/A mensagem ainda não foi enviada: conclua/)).toBeVisible()
  expect(await screen.findByRole('complementary', { name: 'IA neste computador' })).toBeVisible()
  expect(campo).toHaveValue('Demo de roupas')
  expect(api.post).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByText('Conecte sua conta para conversar e produzir neste computador. No navegador, as contas de API são administradas pelo Offiz.')).toBeVisible())
})

it('retoma login Codex já aberto e oferece cancelamento sem iniciar outro processo', async () => {
  let concluir!: (value: unknown) => void
  const aguardar = vi.fn(() => new Promise(resolve => { concluir = resolve }))
  const cancelar = vi.fn(async () => { concluir({ ok: false, error: 'Login não concluído.' }); return { ok: true } })
  window.offizMotor = {
    estado: vi.fn(async () => ({ config: { orgId: 3, localEngine: 'codex' }, pareado: true, worker: { estado: 'ocioso', log: [] } })),
    onUpdate: vi.fn(() => () => {}), onInstalarLinha: vi.fn(() => () => {}),
    claudeStatus: vi.fn(async () => ({ installed: false })), codexStatus: vi.fn(async () => ({ installed: true, authenticated: false })),
    conectarCodex: vi.fn(async () => ({ ok: false, error: 'Já há um login em andamento.' })),
    aguardarLoginCodex: aguardar, cancelarLoginCodex: cancelar,
  } as unknown as NonNullable<Window['offizMotor']>
  render(<MemoryRouter><PainelMotorEmbutido orgId={3} aoMudarPareamento={vi.fn()} gerenciado /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Conectar OpenAI' }))
  expect(await screen.findByText(/Login em andamento. Conclua/)).toBeVisible()
  expect(aguardar).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Autorize no navegador…' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar login' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conectar OpenAI' })).toBeEnabled())
  expect(cancelar).toHaveBeenCalledTimes(1)
  expect(window.offizMotor.conectarCodex).toHaveBeenCalledTimes(1)
})

it('cliente gerenciado pode usar Claude conectado sem login Codex nem trocar a API', async () => {
  const estado = { config: { orgId: 3, orgNome: 'Empresa de teste', localEngine: 'claude' as const }, pareado: true, worker: { estado: 'parado', jobAtual: null, log: [] } }
  window.offizMotor = {
    estado: vi.fn(async () => estado), onUpdate: vi.fn(() => () => {}), onInstalarLinha: vi.fn(() => () => {}),
    claudeStatus: vi.fn(async () => ({ installed: true, loggedIn: true })),
    codexStatus: vi.fn(async () => ({ installed: false, authenticated: false })),
    escolherMotor: vi.fn(async () => ({ ok: true })), ligar: vi.fn(async () => ({ ok: true })),
  } as unknown as NonNullable<Window['offizMotor']>
  render(<MemoryRouter><PainelMotorEmbutido orgId={3} gerenciado podeConfigurarEmpresa={false} aoMudarPareamento={() => {}} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Claude Code' })).toHaveAttribute('aria-pressed', 'true'))
  expect(screen.getByRole('button', { name: 'OpenAI Codex' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Ligar o motor' }))
  await waitFor(() => expect(window.offizMotor!.ligar).toHaveBeenCalledOnce())
  expect(window.offizMotor!.escolherMotor).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it('mostra cada trabalho da fila e cancela somente o escolhido sem apagar o rascunho', async () => {
  let jobs = [81, 82, 83].map(id => ({ id, titulo: `Peça ${id}`, prompt: 'Criar', effort: 'high', status: 'queued', criado_em: new Date().toISOString() }))
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados : path.endsWith('/atividade') ? { jobs } : { conversas: [] })
  vi.mocked(api.post).mockImplementation(async path => { jobs = jobs.filter(job => path !== `/jobs/${job.id}/cancelar`); return {} })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  montar()
  fireEvent.click(await screen.findByText(/Todos os trabalhos em andamento/))
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Novo pedido' } })
  fireEvent.click(screen.getByRole('button', { name: 'Parar Peça 82' }))
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Parar trabalho' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Parar Peça 82' })).not.toBeInTheDocument())
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/82/cancelar', {})
  expect(screen.getByRole('button', { name: 'Parar Peça 81' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Parar Peça 83' })).toBeVisible()
  expect(campo).toHaveValue('Novo pedido')
})

it('aviso de crédito anterior leva aos trabalhos parados sem fingir consulta atual nem perder o rascunho', async () => {
  dados = { ...inicio, sem_saldo: true }
  render(<MemoryRouter initialEntries={['/app?org=3&conversa=nova&vista=conversa']}><EnderecoDaTela /><OffizInicio orgId={3} /></MemoryRouter>)
  expect(await screen.findByText('Um trabalho parou por falta de crédito.')).toBeVisible()
  expect(screen.queryByText('A conta de IA está sem saldo.')).not.toBeInTheDocument()
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Me ajuda a planejar esta semana.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ver trabalhos parados' }))
  expect(await screen.findByRole('complementary', { name: 'Pedidos e entregas' })).toBeVisible()
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('estado=precisa_de_voce')
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('org=3')
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('conversa=nova')
  expect(campo).toHaveValue('Me ajuda a planejar esta semana.')
  expect(screen.queryByRole('button', { name: 'Rever saldo ou trocar a IA' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
  expect(api.patch).not.toHaveBeenCalled()
})

it.each([false, true])('primeiro pedido não é bloqueado pelo aviso de crédito de outro trabalho (contrato=%s)', async contrato => {
  dados = { ...inicio, sem_saldo: true, contrato_gerenciado: contrato }
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados : path.endsWith('/saldo') && contrato ? {
    tipo: 'pf_gerenciado', vigencia: 'vigente', periodo: '2026-10', consultado_em: '2026-10-09T12:00:00Z',
    renovacao_em: null, estado: 'disponivel', limite_brl_mes: 100, credito_brl: 0, total_brl: 100,
    consumido_brl: 0, reservado_brl: 0, disponivel_brl: 100, percentual_disponivel: 100,
  } : respostaBiblioteca(path))
  vi.mocked(api.post).mockRejectedValue(new ApiError(503, 'Fim da prova sintética; nada foi enviado.'))
  montar()
  await screen.findByText('Configurada')
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Me ajuda a planejar os posts.' } })
  fireEvent.keyDown(campo, { key: 'Enter', code: 'Enter' })
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  expect(api.post).toHaveBeenCalledWith('/orgs/3/predio/conversas', undefined)
  expect(await screen.findByText('Fim da prova sintética; nada foi enviado.')).toBeVisible()
  expect(campo).toHaveValue('Me ajuda a planejar os posts.')
  expect(api.put).not.toHaveBeenCalled()
  expect(api.patch).not.toHaveBeenCalled()
})

it('aviso histórico preserva o recibo do trabalho parado e não retoma produção', async () => {
  dados = { ...inicio, sem_saldo: true, contrato_gerenciado: true }
  const conversa = { id: 71, organization_id: 3, office_slug: null, titulo: 'Posts da semana',
    anexos: [], trabalhos: [{ id: 81, titulo: 'Imagem da semana', status: 'failed', entregas: [],
      erro: 'fal.ai: insufficient credits' }],
    mensagens: [
      { id: 1, role: 'user', conteudo: 'Quero uma imagem da semana.', criado_em: '2026-10-08T12:00:00' },
      { id: 2, role: 'assistant', conteudo: 'O trabalho parou; os arquivos anteriores foram preservados.',
        criado_em: '2026-10-08T12:01:00', sugestao_tarefa: { tipo: 'desfecho', status: 'failed', job_id: 81 } },
    ],
  }
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados
    : path === '/conversas/71' ? conversa : path.endsWith('/conversas') ? { conversas: [conversa] }
      : respostaBiblioteca(path))
  render(<MemoryRouter initialEntries={['/app?org=3&conversa=71']}><EnderecoDaTela /><OffizInicio orgId={3} /></MemoryRouter>)
  await screen.findByText('Quero uma imagem da semana.')
  expect(screen.getByText('Imagem da semana')).toBeVisible()
  expect(screen.getByText('Um trabalho parou por falta de crédito.')).toBeVisible()
  await abrirMais()
  expect(screen.getByText('Configurada')).toBeVisible()
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('conversa=71')
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
  expect(api.patch).not.toHaveBeenCalled()
})

it('recusa atual de saldo do contrato é explicada sem perder o pedido nem repetir a chamada', async () => {
  dados = { ...inicio, sem_saldo: true, contrato_gerenciado: true }
  const conversa = { id: 72, organization_id: 3, office_slug: null, titulo: 'Nova conversa', mensagens: [], anexos: [] }
  const recusa = 'O saldo do contrato não está disponível para iniciar este pedido.'
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados
    : path === '/conversas/72' ? conversa : path.endsWith('/saldo') ? {
      tipo: 'pf_gerenciado', vigencia: 'vigente', periodo: '2026-10', consultado_em: '2026-10-09T12:00:00Z',
      renovacao_em: null, estado: 'esgotado', limite_brl_mes: 0, credito_brl: 0, total_brl: 0,
      consumido_brl: 0, reservado_brl: 0, disponivel_brl: 0, percentual_disponivel: 0,
    } : respostaBiblioteca(path))
  vi.mocked(api.post).mockImplementation(async path => {
    if (path === '/orgs/3/predio/conversas') return conversa
    throw new ApiError(429, recusa)
  })
  montar()
  await screen.findByLabelText(/Saldo de IA:.*Sem saldo disponível/)
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Me ajuda a planejar a semana.' } })
  fireEvent.keyDown(campo, { key: 'Enter', code: 'Enter' })
  expect(await screen.findByText(recusa)).toBeVisible()
  expect(campo).toHaveValue('Me ajuda a planejar a semana.')
  expect(vi.mocked(api.post).mock.calls.map(([path]) => path)).toEqual(['/orgs/3/predio/conversas', '/conversas/72/mensagens'])
  expect(api.put).not.toHaveBeenCalled()
  expect(api.patch).not.toHaveBeenCalled()
})

it('trabalho em execução aparece no chat e pode ser parado com Trabalhos aberto', async () => {
  const job = { id: 82, titulo: 'Apresentação em produção', prompt: 'Slides', effort: 'high', status: 'running', criado_em: new Date().toISOString() }
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/orgs/3/inicio') return dados
    if (path.endsWith('/atividade')) return { jobs: [job] }
    if (path.endsWith('/events')) return { events: [{ seq: 1, tipo: 'agent_text', payload: { texto: 'PROGRESSO: 25% — Estrutura pronta.\n' } }] }
    return respostaBiblioteca(path)
  })
  vi.mocked(api.post).mockResolvedValue({ ...job, status: 'cancelled' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  montar()
  const titulo = await screen.findByText(job.titulo)
  expect(titulo.closest('.atividade-chat')).not.toBeNull()
  await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25'))
  expect(screen.getByRole('button', { name: 'Ver atividade' })).toHaveAttribute('aria-expanded', 'false')
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Rascunho paralelo' } })
  fireEvent.click(screen.getByRole('link', { name: 'Pedidos e entregas' }))
  expect(await screen.findByRole('button', { name: 'parar' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'parar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Parar trabalho' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/jobs/82/cancelar', {}))
  expect(campo).toHaveValue('Rascunho paralelo')
})

it('membro conecta e troca sua IA no app sem acessar configurações ou chaves da empresa', async () => {
  dados = { ...inicio, tem_chave: false, motor_modo: 'cli' }
  const estado = { config: { orgId: 3, orgNome: 'Empresa de teste', claudeBin: null, backendUrl: 'http://localhost', localEngine: 'claude' as 'claude' | 'codex' }, pareado: true, pareadoPor: null, worker: { estado: 'parado', jobAtual: null, log: [] } }
  window.offizMotor = {
    estado: vi.fn(async () => estado), chatDeviceId: vi.fn(async () => 'device-test'),
    onUpdate: vi.fn(() => () => {}), onInstalarLinha: vi.fn(() => () => {}),
    claudeStatus: vi.fn(async () => ({ installed: true, loggedIn: true })),
    codexStatus: vi.fn(async () => ({ installed: true, authenticated: true })),
    escolherMotor: vi.fn(async motor => { estado.config.localEngine = motor; return { ok: true } }),
  } as unknown as NonNullable<Window['offizMotor']>
  montar()
  await screen.findByRole('heading', { name: 'Conecte a IA para continuar' })
  expect(screen.queryByRole('button', { name: 'Usar uma chave de API' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Configurações da empresa' })).not.toBeInTheDocument()
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Pedido ainda em elaboração' } })
  fireEvent.click(screen.getByRole('button', { name: 'IA neste computador' }))
  const painel = await screen.findByRole('complementary', { name: 'IA neste computador' })
  fireEvent.click(within(painel).getByRole('button', { name: 'OpenAI Codex' }))
  await waitFor(() => expect(window.offizMotor!.escolherMotor).toHaveBeenCalledWith('codex', ''))
  expect(api.get).not.toHaveBeenCalledWith('/orgs/3/settings/llm')
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }))
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(campo).toHaveValue('Pedido ainda em elaboração')
})

it('fixar persiste pela API e atualiza os cartões sem remontar ou apagar o rascunho', async () => {
  montar()
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Preciso incluir os dados de quinta-feira.' } })
  let concluirLeitura!: (valor: InicioOrganizacao) => void
  vi.mocked(api.get).mockImplementation(async (path) => path === '/orgs/3/inicio'
    ? new Promise<InicioOrganizacao>((resolve) => { concluirLeitura = resolve })
    : { conversas: [] })
  fireEvent.click(screen.getByRole('button', { name: `Fixar: ${aprendida.titulo}` }))
  await waitFor(() => expect(concluirLeitura).toBeTypeOf('function'))
  expect(screen.getByRole('button', { name: `Fixar: ${aprendida.titulo}` })).toBeDisabled()
  fireEvent(window, new Event('focus'))
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/3/inicio')).toHaveLength(2)
  await act(async () => concluirLeitura({ ...inicio, solucoes: [{ ...aprendida, fixada: true }, catalogo] }))
  await screen.findByRole('button', { name: `Desfixar: ${aprendida.titulo}` })
  expect(api.patch).toHaveBeenCalledWith('/orgs/3/inicio/solucoes/aprendida%3Asemana', { fixada: true })
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(campo).toHaveValue('Preciso incluir os dados de quinta-feira.')
  expect(screen.getByText(aprendida.motivo!)).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('erro ao salvar preferência fica visível sem alterar o pedido ou esconder o cartão', async () => {
  vi.mocked(api.patch).mockRejectedValue(new ApiError(409, 'O limite de sugestões foi atingido.'))
  montar()
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Rascunho ainda não enviado.' } })
  fireEvent.click(screen.getByRole('button', { name: `Ocultar: ${aprendida.titulo}` }))
  expect(await screen.findByRole('alert')).toHaveTextContent('O limite de sugestões foi atingido.')
  expect(screen.getByRole('button', { name: `Começar: ${aprendida.titulo}` })).toBeInTheDocument()
  expect(campo).toHaveValue('Rascunho ainda não enviado.')
  expect(api.post).not.toHaveBeenCalled()
})

it('ocultar guarda a sugestão na lista privada e restaurar a devolve ao início', async () => {
  montar()
  await screen.findByRole('button', { name: `Ocultar: ${aprendida.titulo}` })
  vi.mocked(api.patch).mockImplementation(async (_path, body) => {
    dados = (body as { oculta?: boolean }).oculta
      ? { ...inicio, solucoes: [catalogo], solucoes_ocultas: [{ ...aprendida, oculta: true }] }
      : inicio
  })
  const ocultar = screen.getByRole('button', { name: `Ocultar: ${aprendida.titulo}` })
  ocultar.focus()
  fireEvent.click(ocultar)
  const mostrarOcultas = await screen.findByRole('button', { name: 'Sugestões ocultas (1)' })
  await waitFor(() => expect(mostrarOcultas).toHaveFocus())
  fireEvent.click(mostrarOcultas)
  expect(screen.queryByRole('button', { name: `Começar: ${aprendida.titulo}` })).not.toBeInTheDocument()
  const restaurar = screen.getByRole('button', { name: `Restaurar: ${aprendida.titulo}` })
  restaurar.focus()
  fireEvent.click(restaurar)
  const comecar = await screen.findByRole('button', { name: `Começar: ${aprendida.titulo}` })
  await waitFor(() => expect(comecar).toHaveFocus())
  expect(api.patch).toHaveBeenNthCalledWith(1, '/orgs/3/inicio/solucoes/aprendida%3Asemana', { oculta: true })
  expect(api.patch).toHaveBeenNthCalledWith(2, '/orgs/3/inicio/solucoes/aprendida%3Asemana', { oculta: false })
  expect(api.post).not.toHaveBeenCalled()
})

it('voltar à janela busca sugestões novas preservando o mesmo campo e seu texto', async () => {
  montar()
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Ainda estou organizando este pedido.' } })
  dados = { ...inicio, solucoes: [{ ...aprendida, titulo: 'Apresentação para a diretoria' }, catalogo] }
  fireEvent(window, new Event('focus'))
  await screen.findByRole('button', { name: 'Começar: Apresentação para a diretoria' })
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(campo).toHaveValue('Ainda estou organizando este pedido.')
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/3/inicio').length).toBe(2))
  expect(api.post).not.toHaveBeenCalled()
})

it('resposta tardia de preferência não recarrega a empresa anterior após navegar', async () => {
  const { rerender } = montar()
  await screen.findByRole('button', { name: `Fixar: ${aprendida.titulo}` })
  let concluirEscrita!: () => void
  vi.mocked(api.patch).mockImplementation(() => new Promise<void>((resolve) => { concluirEscrita = resolve }))
  fireEvent.click(screen.getByRole('button', { name: `Fixar: ${aprendida.titulo}` }))
  vi.mocked(api.get).mockImplementation(async (path) => path === '/orgs/4/inicio'
    ? { ...inicio, org_id: 4, org_nome: 'Outra empresa', solucoes: [catalogo] }
    : { conversas: [] })
  rerender(<MemoryRouter><OffizInicio orgId={4} /></MemoryRouter>)
  await screen.findByText('Outra empresa')
  await act(async () => concluirEscrita())
  expect(screen.queryByText('Empresa de teste')).not.toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/3/inicio')).toHaveLength(1)
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('')
})

it('pedido escolhido em uma empresa não é reaplicado ao abrir outra empresa', async () => {
  const { rerender } = montar()
  fireEvent.click(await screen.findByRole('button', { name: `Começar: ${aprendida.titulo}` }))
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue(aprendida.prompt)
  vi.mocked(api.get).mockImplementation(async (path) => path === '/orgs/4/inicio'
    ? { ...inicio, org_id: 4, org_nome: 'Outro cliente' }
    : { conversas: [] })
  rerender(<MemoryRouter><OffizInicio orgId={4} /></MemoryRouter>)
  await screen.findByText('Outro cliente')
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('')
  expect(api.post).not.toHaveBeenCalled()
})

it('avisa a suspensão sem sugerir que conectar uma chave resolverá a operação', async () => {
  dados = { ...inicio, org_status: 'suspensa', tem_chave: false }
  montar()
  await screen.findByText('Esta empresa está com a operação suspensa.')
  expect(screen.queryByText('Falta conectar a inteligência do seu escritório.')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Acervo' })).toBeInTheDocument()
})

it('abrir Trabalhos mantém a conversa e o pedido em elaboração', async () => {
  montar()
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Quero revisar a apresentação antes de entregar.' } })
  fireEvent.click(screen.getByRole('link', { name: 'Pedidos e entregas' }))
  await screen.findByRole('button', { name: 'Voltar à conversa' })
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(campo).toHaveValue('Quero revisar a apresentação antes de entregar.')
  fireEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }))
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(api.post).not.toHaveBeenCalled()
})

it('sem conexão o envio não cria conversa nem apaga o pedido', async () => {
  dados = { ...inicio, tem_chave: false }
  montar()
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Este pedido deve permanecer aqui.' } })
  fireEvent.keyDown(campo, { key: 'Enter', code: 'Enter' })
  await waitFor(() => expect(campo).toHaveValue('Este pedido deve permanecer aqui.'))
  expect(api.post).not.toHaveBeenCalled()
})

it('no navegador uma chave guardada permite conversar sem mudar o motor local da empresa', async () => {
  dados = { ...inicio, motor_modo: 'cli', tem_chave: true }
  montar()
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Continuar depois de conectar.' } })
  fireEvent.keyDown(campo, { key: 'Enter', code: 'Enter' })
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orgs/3/predio/conversas', undefined))
  expect(api.put).not.toHaveBeenCalled()
})

it('a entrada de uma área mantém o mesmo chat e lê as conversas antigas dessa área', async () => {
  render(<MemoryRouter initialEntries={['/app?org=3&slug=financeiro']}><OffizInicio orgId={3} areaSlug="financeiro" areaOffice={{ slug: 'financeiro', nome: 'Financeiro', descricao: '', tema: { cor_primaria: '#000', cor_acento: '#000', cor_fundo: '#fff', icone: 'conversa' } }} /></MemoryRouter>)
  expect(await screen.findByRole('textbox', { name: 'Seu pedido' })).toBeInTheDocument()
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/predios/3/financeiro/conversas', expect.any(AbortSignal)))
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/orgs/3/predio/conversas')).toBe(false)
  expect(screen.getByRole('link', { name: 'Abrir conversa geral da empresa' })).toHaveAttribute('href', '/app?org=3&vista=conversa')
})

vi.mock('../components/predio/EstudioTab', () => ({ default: ({ aoVerEntregas }: { aoVerEntregas: () => void }) => <button onClick={aoVerEntregas}>Voltar do Estúdio aos trabalhos</button> }))
vi.mock('../components/predio/AgendaTab', () => ({ AgendaTab: ({ podeEditar }: { podeEditar: boolean }) => <p>Agenda: {podeEditar ? 'editável' : 'leitura'}</p> }))

const conteudoOffice = { slug: 'conteudo', nome: 'Conteúdo', descricao: '', tema: { cor_primaria: '#000', cor_acento: '#000', cor_fundo: '#fff', icone: 'conversa' } }
it('ferramentas visíveis abrem o painel da área sem apagar o pedido', async () => {
  dados = { ...inicio, andares: [{ slug: 'conteudo', nome: 'Conteúdo', descricao: '' }] }
  render(<MemoryRouter><OffizInicio orgId={3} areaSlug="conteudo" areaOffice={{ ...conteudoOffice, abas: ['conversa', 'agenda'] }} /></MemoryRouter>)
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Quero revisar minhas referências' } })
  fireEvent.click(screen.getByText('Mais', { exact: true }))
  const menu = screen.getByText('Mais', { exact: true }).closest('details')!
  fireEvent.click(within(menu).getByRole('button', { name: 'Agendamento' }))
  expect(await screen.findByText('Agenda: leitura')).toBeVisible()
  expect(menu).not.toHaveAttribute('open')
  expect(campo).toHaveValue('Quero revisar minhas referências')
  expect(api.post).not.toHaveBeenCalled()
})
it('membro abre plano e consumo pelo saldo mantendo a conversa e sem editar contrato', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados : path === '/orgs/3/contrato' ? { tipo: 'byok', vigencia: 'vigente', inicio: null, fim: null, servicos: [], conexoes: {}, periodo: '2026-10' } : respostaBiblioteca(path))
  montar()
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Meu próximo pedido' } })
  fireEvent.click(await screen.findByLabelText(/Saldo de IA: Conta própria/))
  fireEvent.click(screen.getByRole('button', { name: 'Ver plano e consumo' }))
  expect(await screen.findByRole('complementary', { name: 'Plano e consumo de IA' })).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(campo).toHaveValue('Meu próximo pedido')
  expect(screen.queryByRole('button', { name: 'Salvar contrato' })).not.toBeInTheDocument()
  expect(api.put).not.toHaveBeenCalled()
})
it('o link antigo do Estúdio abre o painel e preserva o pedido ao voltar aos trabalhos', async () => {
  dados = { ...inicio, andares: [{ slug: 'conteudo', nome: 'Conteúdo', descricao: '' }] }
  render(<MemoryRouter initialEntries={['/app?org=3&slug=conteudo&f=estudio']}><OffizInicio orgId={3} areaSlug="conteudo" areaOffice={conteudoOffice} /></MemoryRouter>)
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  expect(screen.getByRole('complementary', { name: 'Estúdio' })).toBeInTheDocument()
  fireEvent.change(campo, { target: { value: 'Continuar o mesmo pedido' } })
  fireEvent.click(screen.getByRole('button', { name: 'Voltar do Estúdio aos trabalhos' }))
  expect(await screen.findByRole('complementary', { name: 'Pedidos e entregas' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(campo).toHaveValue('Continuar o mesmo pedido')
})
it('ferramentas respeitam o manifesto e mantêm Agenda somente leitura para membro', async () => {
  dados = { ...inicio, andares: [{ slug: 'conteudo', nome: 'Conteúdo', descricao: '' }] }
  render(<MemoryRouter initialEntries={['/app?org=3&slug=conteudo&f=agenda']}><OffizInicio orgId={3} areaSlug="conteudo" areaOffice={{ ...conteudoOffice, abas: ['conversa', 'agenda'] }} /></MemoryRouter>)
  expect(await screen.findByText('Agenda: leitura')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Visão geral' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'O que eu já sei' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Conversa' }))
  expect(screen.queryByText('Agenda: leitura')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBeInTheDocument()
})


it('ordena navegação pelo fluxo de trabalho e abre agendamento', async () => {
  montar()
  const nav = await screen.findByRole('navigation', { name: 'Seu escritório' })
  expect([...nav.querySelectorAll(':scope > a, :scope > button')].map(item => item.textContent)).toEqual(['Conversa', 'Pedidos e entregas', 'Acervo'])
  fireEvent.click(within(nav).getByText('Mais'))
  fireEvent.click(within(nav).getByRole('button', { name: 'Agendamento' }))
  expect(await screen.findByRole('complementary', { name: 'Agendamento' })).toBeInTheDocument()
})

it('voltar à conversa e reabrir pedidos preserva filtros e o rascunho', async () => {
  render(<MemoryRouter initialEntries={['/app?org=3&vista=biblioteca&busca-pedidos=Campanha&filtro-pedidos=favoritos&formato-pedidos=imagem&versoes-pedidos=1&pagina-pedidos=2&estado=pronto']}><EnderecoDaTela /><OffizInicio orgId={3} /></MemoryRouter>)
  await screen.findByRole('complementary', { name: 'Pedidos e entregas' })
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Depois quero ajustar a legenda' } })
  fireEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }))
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(campo).toHaveValue('Depois quero ajustar a legenda')
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('filtro-pedidos=favoritos')
  fireEvent.click(screen.getByRole('link', { name: 'Pedidos e entregas' }))
  expect(await screen.findByRole('searchbox', { name: 'Buscar projetos e entregas' })).toHaveValue('Campanha')
  expect(screen.getByRole('combobox', { name: 'Filtrar trabalhos' })).toHaveValue('favoritos')
  expect(screen.getByRole('combobox', { name: 'Formato' })).toHaveValue('imagem')
  expect(screen.getByRole('checkbox', { name: 'Incluir versões anteriores' })).toBeChecked()
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('pagina-pedidos=2')
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('estado=pronto')
})

it('atalho de estado mostra os pedidos correspondentes sem filtros ou aba anteriores', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados : path.includes('/biblioteca?') ? { itens: [], total: 0, resumo: { prontos: 2, precisa_de_voce: 1, em_producao: 0, aprovados: 0 } } : respostaBiblioteca(path))
  render(<MemoryRouter initialEntries={['/app?org=3&vista=conversa&conversa=nova&busca-pedidos=inexistente&filtro-pedidos=arquivados&formato-pedidos=pdf&versoes-pedidos=1&pagina-pedidos=2&biblioteca-aba=padroes&projeto=8&trabalho=99&arquivo=888']}><EnderecoDaTela /><OffizInicio orgId={3} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /Pronto para você/ }))
  const endereco = screen.getByLabelText('Endereço da tela').textContent || ''
  const params = new URLSearchParams(endereco)
  expect(params.get('vista')).toBe('biblioteca')
  expect(params.get('estado')).toBe('pronto')
  for (const chave of ['busca-pedidos', 'filtro-pedidos', 'formato-pedidos', 'versoes-pedidos', 'pagina-pedidos', 'biblioteca-aba', 'projeto', 'trabalho', 'arquivo']) expect(params.has(chave)).toBe(false)
  expect(await screen.findByRole('button', { name: 'Todos os pedidos' })).toHaveAttribute('aria-current', 'page')
})

it('entrega da atividade abre o trabalho solicitado sem retomar um detalhe antigo da biblioteca', async () => {
  const job = { id: 82, titulo: 'Post em revisão', prompt: 'Pedido', effort: 'high', status: 'running', criado_em: new Date().toISOString() }
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/orgs/3/inicio') return dados
    if (path.endsWith('/atividade')) return { jobs: [job] }
    if (path.endsWith('/events')) return { events: [{ seq: 1, tipo: 'entrega_registrada', payload: { nome: 'post.png', caminho_rel: 'outputs/post.png' } }] }
    if (path === '/orgs/3/biblioteca/82') return { ...job, office_slug: 'financeiro', estado: 'em_producao', arquivos: [], desatualizados: [] }
    return respostaBiblioteca(path)
  })
  render(<MemoryRouter initialEntries={['/app?org=3&conversa=nova&trabalho=99&estado=precisa_de_voce&busca-pedidos=inexistente&pagina-pedidos=2&biblioteca-aba=padroes']}><EnderecoDaTela /><OffizInicio orgId={3} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver atividade' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Ver arquivo recebido →' }))
  const params = new URLSearchParams(screen.getByLabelText('Endereço da tela').textContent || '')
  expect(params.get('trabalho')).toBe('82')
  expect(params.get('vista')).toBe('biblioteca')
  expect(params.get('conversa')).toBe('nova')
  for (const chave of ['estado', 'busca-pedidos', 'pagina-pedidos', 'biblioteca-aba']) expect(params.has(chave)).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it('identifica o acompanhamento da empresa e abre o pedido de outra conversa preservando o rascunho', async () => {
  const job = { id: 82, conversa_id: 999, titulo: 'Pedido de outra conversa', prompt: 'Pedido', effort: 'high', status: 'running', criado_em: new Date().toISOString() }
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/orgs/3/inicio') return dados
    if (path.endsWith('/atividade')) return { jobs: [job] }
    if (path === '/orgs/3/biblioteca/82') return { ...job, office_slug: 'financeiro', estado: 'em_producao', arquivos: [], desatualizados: [] }
    return respostaBiblioteca(path)
  })
  render(<MemoryRouter initialEntries={['/app?org=3&conversa=nova&trabalho=99&estado=precisa_de_voce&busca-pedidos=inexistente&pagina-pedidos=2&biblioteca-aba=padroes']}><EnderecoDaTela /><OffizInicio orgId={3} /></MemoryRouter>)
  expect(await screen.findByText('Pedidos da empresa')).toBeInTheDocument()
  expect(screen.getByText('Empresa de teste · Financeiro')).toBeInTheDocument()
  expect(screen.getByText('Este acompanhamento pode incluir pedidos de outras conversas.')).toBeInTheDocument()
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Rascunho da conversa atual' } })
  fireEvent.click(screen.getByRole('button', { name: 'Abrir pedido: Pedido de outra conversa' }))
  const params = new URLSearchParams(screen.getByLabelText('Endereço da tela').textContent || '')
  expect(params.get('trabalho')).toBe('82')
  expect(params.get('vista')).toBe('biblioteca')
  expect(params.get('conversa')).toBe('nova')
  for (const chave of ['estado', 'busca-pedidos', 'pagina-pedidos', 'biblioteca-aba']) expect(params.has(chave)).toBe(false)
  expect(await screen.findByRole('complementary', { name: 'Pedidos e entregas' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }))
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(campo).toHaveValue('Rascunho da conversa atual')
  expect(api.post).not.toHaveBeenCalled()
})

it('não ocupa a conversa com rótulo de acompanhamento quando não há atividade', async () => {
  montar()
  await screen.findByRole('textbox', { name: 'Seu pedido' })
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/predios/3/financeiro/atividade'))
  expect(screen.queryByText('Pedidos da empresa')).not.toBeInTheDocument()
  expect(screen.queryByText('Este acompanhamento pode incluir pedidos de outras conversas.')).not.toBeInTheDocument()
})

it('organiza o acervo por área mantendo links e acesso a especialidade arquivada', async () => {
  dados = { ...inicio, andares: [
    { slug: 'conteudo', nome: 'Conteúdo & Marca', descricao: '' },
    { slug: 'assistente-pf', nome: 'Assistente Financeiro Pessoal', descricao: '' },
    { slug: 'financeiro', nome: 'Consultoria Financeira', descricao: '', arquivado: true },
  ] }
  montar()
  const nav = await screen.findByRole('navigation', { name: 'Seu escritório' })
  fireEvent.click(within(nav).getByText('Acervo'))
  const marketing = within(nav).getByRole('region', { name: 'Marketing & Conteúdo' })
  expect(within(marketing).getByRole('link', { name: 'Produção de conteúdo' })).toHaveAttribute('href', '/?vista=acervo&area=conteudo')
  const financas = within(nav).getByRole('region', { name: 'Finanças' })
  expect(within(financas).getByRole('link', { name: 'Pessoal' })).toHaveAttribute('href', '/?vista=acervo&area=assistente-pf')
  expect(within(financas).getByRole('link', { name: 'Planejamento' })).toHaveAttribute('href', '/?vista=acervo&area=financeiro')
  expect(within(nav).queryByRole('link', { name: 'Empresa' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('seletor agrupa especialidades sem mudar seus identificadores ou o rascunho ao navegar', async () => {
  dados = { ...inicio, andares: [
    { slug: 'conteudo', nome: 'Conteúdo & Marca', descricao: '' },
    { slug: 'assistente-pf', nome: 'Assistente Financeiro Pessoal', descricao: '' },
    { slug: 'analise', nome: 'Relatório Aurora', descricao: '', area: 'financas' },
  ] }
  render(<MemoryRouter initialEntries={['/app?org=3&vista=agenda&area=assistente-pf']}><OffizInicio orgId={3} /></MemoryRouter>)
  const seletor = await screen.findByRole('combobox', { name: 'Área de trabalho' })
  expect(seletor).toHaveValue('assistente-pf')
  expect(within(seletor).getByRole('group', { name: 'Finanças' })).toContainElement(within(seletor).getByRole('option', { name: 'Pessoal' }))
  expect(within(seletor).getByRole('option', { name: 'Relatório Aurora' })).toHaveValue('analise')
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Continuar meu pedido' } })
  fireEvent.change(seletor, { target: { value: 'conteudo' } })
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/predios/3/conteudo', expect.any(AbortSignal)))
  expect(campo).toHaveValue('Continuar meu pedido')
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

function prepararMenuAcervo() {
  dados = { ...inicio, andares: [
    { slug: 'conteudo', nome: 'Conteúdo & Marca', descricao: '' },
    { slug: 'financeiro', nome: 'Consultoria Financeira', descricao: '' },
  ] }
}

it('Escape fecha o menu de acervo e devolve o foco ao controle sem apagar o pedido', async () => {
  prepararMenuAcervo()
  montar()
  const resumo = await screen.findByText('Acervo', { exact: true })
  const menu = resumo.closest('details')!
  fireEvent.click(resumo)
  expect(menu).toHaveAttribute('open')
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Quero conferir minhas referências.' } })
  within(menu).getByRole('link', { name: 'Produção de conteúdo' }).focus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(menu).not.toHaveAttribute('open')
  expect(resumo).toHaveFocus()
  expect(campo).toHaveValue('Quero conferir minhas referências.')
  expect(api.post).not.toHaveBeenCalled()
})

it('clicar fora fecha acervo e conserva o foco do campo escolhido', async () => {
  prepararMenuAcervo()
  montar()
  const resumo = await screen.findByText('Acervo', { exact: true })
  const menu = resumo.closest('details')!
  fireEvent.click(resumo)
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  campo.focus()
  fireEvent.pointerDown(campo)
  expect(menu).not.toHaveAttribute('open')
  expect(campo).toHaveFocus()
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['acervo', 'mais'])('Escape devolve o foco ao menu %s usado por teclado quando outro menu também estava aberto', async foco => {
  prepararMenuAcervo()
  montar()
  const acervo = await screen.findByText('Acervo', { exact: true })
  const mais = screen.getByLabelText('Mais: agenda e ferramentas')
  // Enter/Space geram click sem pointerdown; abrir outro menu por teclado
  // não percorre o listener de clique fora.
  fireEvent.click(mais)
  fireEvent.click(acervo)
  const menuAcervo = acervo.closest('details')!
  const menuMais = mais.closest('details')!
  expect(menuAcervo).toHaveAttribute('open')
  expect(menuMais).toHaveAttribute('open')
  if (foco === 'acervo') within(menuAcervo).getByRole('link', { name: 'Produção de conteúdo' }).focus()
  else within(menuMais).getByRole('button', { name: 'Agendamento' }).focus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(menuAcervo).not.toHaveAttribute('open')
  expect(menuMais).not.toHaveAttribute('open')
  expect(foco === 'acervo' ? acervo : mais).toHaveFocus()
  expect(api.post).not.toHaveBeenCalled()
})

it('escolher o acervo fecha o menu mantendo a área exata, a conversa e o rascunho', async () => {
  prepararMenuAcervo()
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados
    : path.endsWith('/conhecimento/canon') || path.endsWith('/conhecimento/premissas') ? { conteudo: '' }
      : path.endsWith('/conhecimento/licoes') ? []
        : path.endsWith('/conhecimento/atividades') ? { atividades: [] }
          : path.endsWith('/conhecimento/tarefas') ? { tarefas: [] }
            : path.endsWith('/conhecimento/substituicoes') ? { substituicoes: [] }
              : path.endsWith('/arquivos') ? { entrada: [], exemplos: [], produto: [] }
                : respostaBiblioteca(path))
  render(<MemoryRouter initialEntries={['/app?org=3&conversa=nova&vista=conversa&trabalho=81&arquivo=82']}><EnderecoDaTela /><OffizInicio orgId={3} /></MemoryRouter>)
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Conferir o material antes de pedir.' } })
  const resumo = screen.getByText('Acervo', { exact: true })
  const menu = resumo.closest('details')!
  fireEvent.click(resumo)
  const link = within(menu).getByRole('link', { name: 'Planejamento' })
  link.focus()
  fireEvent.click(link)
  expect(menu).not.toHaveAttribute('open')
  expect(resumo).toHaveFocus()
  expect(await screen.findByRole('complementary', { name: 'Acervo' })).toBeVisible()
  const params = new URLSearchParams(screen.getByLabelText('Endereço da tela').textContent || '')
  expect(params.get('area')).toBe('financeiro')
  expect(params.get('vista')).toBe('acervo')
  expect(params.get('conversa')).toBe('nova')
  expect(params.get('trabalho')).toBe('81')
  expect(params.get('arquivo')).toBe('82')
  expect(campo).toHaveValue('Conferir o material antes de pedir.')
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it.each([true, false])('saldo confirma mudança de modalidade (contrato inicial=%s) e a origem relê o início uma vez sem perder o pedido', async contrato => {
  dados = { ...inicio, meu_papel: 'owner', contrato_gerenciado: contrato }
  render(<MemoryRouter initialEntries={['/app?org=3&vista=conversa&conversa=nova&trabalho=77&arquivo=91']}><EnderecoDaTela /><OffizInicio orgId={3} /></MemoryRouter>)
  await encontrarOrigem(`${contrato ? 'Contrato Offiz' : 'API própria'}: Configurada`)
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Meu rascunho continua aqui.' } })
  fireEvent.click(await screen.findByLabelText(contrato ? /Saldo de IA: R\$\s*100,00/ : /Saldo de IA: Conta própria/))
  dados = { ...dados, contrato_gerenciado: !contrato }
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  await encontrarOrigem(`${contrato ? 'API própria' : 'Contrato Offiz'}: Configurada`)
  expect(screen.queryByRole('button', { name: `${contrato ? 'Contrato Offiz' : 'API própria'}: Configurada` })).not.toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/3/inicio')).toHaveLength(2)
  expect(campo).toHaveValue('Meu rascunho continua aqui.')
  expect(screen.getByLabelText('Endereço da tela')).toHaveTextContent('conversa=nova&trabalho=77&arquivo=91')
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled()
})

it('mudar só o valor disponível não relê a configuração da origem da IA', async () => {
  dados = { ...inicio, meu_papel: 'owner', contrato_gerenciado: true }
  montar()
  fireEvent.click(await screen.findByLabelText(/Saldo de IA: R\$\s*100,00/))
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados : path.endsWith('/saldo') ? saldoDaModalidade(true, 50) : respostaBiblioteca(path))
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  await screen.findByLabelText(/Saldo de IA: R\$\s*50,00/)
  expect(await encontrarOrigem('Contrato Offiz: Configurada')).toBeVisible()
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/3/inicio')).toHaveLength(1)
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled()
})

it('falha ao reler a origem mantém o saldo confirmado e o pedido; tentativa manual não muda a configuração', async () => {
  dados = { ...inicio, meu_papel: 'owner', contrato_gerenciado: true }
  montar()
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Ainda não envie meu pedido.' } })
  fireEvent.click(await screen.findByLabelText(/Saldo de IA: R\$\s*100,00/))
  dados = { ...dados, contrato_gerenciado: false }
  let falha = true
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/orgs/3/inicio') { if (falha) throw new ApiError(503, 'Leitura da origem indisponível.'); return dados }
    return respostaBiblioteca(path)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  await screen.findByText('Consulta da origem pendente')
  expect(screen.getByLabelText(/Saldo de IA: Conta própria/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Contrato Offiz: Configurada' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'API própria: Configurada' })).not.toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/3/inicio')).toHaveLength(2)
  falha = false
  fireEvent.click(await encontrarOrigem('Verificar origem'))
  await encontrarOrigem('API própria: Configurada')
  expect(screen.queryByText('Consulta da origem pendente')).not.toBeInTheDocument()
  expect(campo).toHaveValue('Ainda não envie meu pedido.')
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/3/inicio')).toHaveLength(3)
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled()
})

it('início ainda divergente não dispara loop nem usa o saldo como chave de API; permite nova conferência explícita', async () => {
  dados = { ...inicio, meu_papel: 'owner', contrato_gerenciado: true }
  montar()
  fireEvent.click(await screen.findByLabelText(/Saldo de IA: R\$\s*100,00/))
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados : path.endsWith('/saldo') ? saldoDaModalidade(false) : respostaBiblioteca(path))
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  await screen.findByText('Consulta da origem pendente')
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  await screen.findByLabelText(/Saldo de IA: Conta própria.*Cobrança na sua conexão/)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/3/inicio')).toHaveLength(2)
  dados = { ...dados, contrato_gerenciado: false, tem_chave: false }
  fireEvent.click(await encontrarOrigem('Verificar origem'))
  await encontrarOrigem('API própria: Não configurada')
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled()
})

it.each(['org', 'sessão'])('retorno tardio da origem não substitui a nova %s', async troca => {
  setTokens('synthetic-session-a', 'synthetic-refresh-a')
  dados = { ...inicio, meu_papel: 'owner', contrato_gerenciado: true }
  const view = render(<MemoryRouter><OffizInicio key={getSessionIdentity()} orgId={3} /></MemoryRouter>)
  fireEvent.click(await screen.findByLabelText(/Saldo de IA: R\$\s*100,00/))
  let resolver!: (valor: InicioOrganizacao) => void
  let sinal!: AbortSignal
  vi.mocked(api.get).mockImplementation((path, signal) => {
    if (path === '/orgs/3/inicio') { sinal = signal!; return new Promise(resolve => { resolver = resolve }) }
    return Promise.resolve(path.endsWith('/saldo') ? saldoDaModalidade(false) : respostaBiblioteca(path))
  })
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  await waitFor(() => expect(resolver).toBeTypeOf('function'))
  const novaOrg = troca === 'org' ? 4 : 3
  const novosDados = { ...inicio, org_id: novaOrg, org_nome: 'Empresa da sessão atual', meu_papel: 'owner', contrato_gerenciado: false }
  vi.mocked(api.get).mockImplementation(async path => path === `/orgs/${novaOrg}/inicio` ? novosDados : path.endsWith('/saldo') ? saldoDaModalidade(false) : respostaBiblioteca(path))
  if (troca === 'sessão') act(() => setTokens('synthetic-session-b', 'synthetic-refresh-b'))
  view.rerender(<MemoryRouter><OffizInicio key={getSessionIdentity()} orgId={novaOrg} /></MemoryRouter>)
  await screen.findByText('Empresa da sessão atual')
  await act(async () => resolver({ ...inicio, meu_papel: 'owner', contrato_gerenciado: true, org_nome: 'Empresa antiga' }))
  expect(sinal.aborted).toBe(true)
  expect(screen.queryByText('Empresa antiga')).not.toBeInTheDocument()
  expect(await encontrarOrigem('API própria: Configurada')).toBeVisible()
  expect(screen.queryByText('Consulta da origem pendente')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled()
})

it('modalidade confirmada do saldo não transforma o motor local em API nem altera seu pareamento', async () => {
  dados = { ...inicio, meu_papel: 'owner', contrato_gerenciado: true, motor_modo: 'cli' }
  window.offizMotor = {
    chatDeviceId: 'device-synthetic', estado: vi.fn(async () => ({ config: { orgId: 3, localEngine: 'codex' }, pareado: true, worker: { estado: 'ocioso', log: [] } })),
    onUpdate: vi.fn(() => () => {}), onInstalarLinha: vi.fn(() => () => {}),
    claudeStatus: vi.fn(async () => ({ installed: false })), codexStatus: vi.fn(async () => ({ installed: true, authenticated: true })),
  } as unknown as NonNullable<Window['offizMotor']>
  montar()
  await encontrarOrigem('Motor local: Conectado')
  fireEvent.click(await screen.findByLabelText(/Saldo de IA: R\$\s*100,00/))
  dados = { ...dados, contrato_gerenciado: false }
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar saldo' }))
  await screen.findByLabelText(/Saldo de IA: Conta própria/)
  await encontrarOrigem('Motor local: Conectado')
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/3/inicio')).toHaveLength(2)
  expect(screen.queryByRole('button', { name: /API própria/ })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled()
})

it('verificação inicial pendente não é falta de conexão nem abre a preparação; conserva foco e pedido', async () => {
  dados = { ...inicio, meu_papel: 'owner', motor_modo: 'cli' }
  type Estado = Awaited<ReturnType<NonNullable<Window['offizMotor']>['estado']>>
  let concluir!: (estado: Estado) => void
  const pendente = new Promise<Estado>(resolve => { concluir = resolve })
  window.offizMotor = {
    chatDeviceId: 'device-synthetic', estado: vi.fn(() => pendente), onUpdate: vi.fn(() => () => {}),
    onInstalarLinha: vi.fn(() => () => {}), codexStatus: vi.fn(async () => ({ installed: true, authenticated: true })),
  } as unknown as NonNullable<Window['offizMotor']>
  montar()
  await encontrarOrigem('Motor local: Verificando…')
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  campo.focus()
  fireEvent.change(campo, { target: { value: 'Quero um post sobre a torcida.' } })
  expect(screen.queryByRole('heading', { name: 'Conecte a IA para continuar' })).not.toBeInTheDocument()
  await act(async () => concluir({ config: { orgId: 3, orgNome: 'Empresa de teste', claudeBin: null, backendUrl: 'http://localhost', localEngine: 'codex' }, pareado: true, pareadoPor: null, worker: { estado: 'ocioso', jobAtual: null, log: [] } }))
  await encontrarOrigem('Motor local: Conectado')
  expect(campo).toHaveValue('Quero um post sobre a torcida.')
  expect(campo).toHaveFocus()
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled()
})

it('falha confirmada da conexão continua oferecendo preparação sem apagar o pedido', async () => {
  dados = { ...inicio, meu_papel: 'owner', motor_modo: 'cli' }
  window.offizMotor = {
    chatDeviceId: 'device-synthetic', estado: vi.fn(async () => { throw new Error('Consulta sintética falhou') }),
    onUpdate: vi.fn(() => () => {}), onInstalarLinha: vi.fn(() => () => {}),
    codexStatus: vi.fn(async () => ({ installed: true, authenticated: true })),
  } as unknown as NonNullable<Window['offizMotor']>
  montar()
  await encontrarOrigem('Motor local: Falha ao verificar')
  expect(await screen.findByRole('heading', { name: 'Conecte a IA para continuar' })).toBeVisible()
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Vou conferir a conexão antes de enviar.' } })
  expect(campo).toHaveValue('Vou conferir a conexão antes de enviar.')
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled()
})


it('a área acompanha a conversa selecionada sem mostrar a placa de outra conversa', async () => {
  const office = { slug: 'conteudo', nome: 'Conteúdo', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
  dados = { ...inicio, andares: [office], solucoes: [], outras_solucoes: [] }
  const conversa = { id: 121, organization_id: 3, office_slug: 'conteudo', titulo: 'Chamada do jogo', mensagens: [], anexos: [], trabalhos: [] }
  const atual = { id: 82, conversa_id: 121, titulo: 'Produção desta conversa', prompt: 'Pedido', effort: 'high', status: 'running', criado_em: new Date().toISOString() }
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? dados
    : path === '/conversas/121' ? conversa : path.endsWith('/conversas') ? { conversas: [conversa] }
      : path.includes('/atividade') ? { jobs: [atual, { ...atual, id: 83, conversa_id: 999, titulo: 'Produção de outro chat' }] }
        : path.endsWith('/events?after_seq=0') ? { events: [] } : respostaBiblioteca(path))
  render(<MemoryRouter initialEntries={['/app?org=3&slug=conteudo&conversa=121']}><OffizInicio orgId={3} areaSlug="conteudo" areaOffice={office} /></MemoryRouter>)
  expect(await screen.findByText('Produção desta conversa')).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledWith('/predios/3/conteudo/atividade?conversa_id=121')
  expect(screen.queryByText('Produção de outro chat')).not.toBeInTheDocument()
  expect(screen.queryByText('Este acompanhamento pode incluir pedidos de outras conversas.')).not.toBeInTheDocument()
})

it('a área numa conversa nova não consulta o acompanhamento global', async () => {
  const office = { slug: 'conteudo', nome: 'Conteúdo', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
  dados = { ...inicio, andares: [office], solucoes: [], outras_solucoes: [] }
  render(<MemoryRouter initialEntries={['/app?org=3&slug=conteudo&conversa=nova']}><OffizInicio orgId={3} areaSlug="conteudo" areaOffice={office} /></MemoryRouter>)
  await screen.findByRole('textbox', { name: 'Seu pedido' })
  await act(async () => {})
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/atividade'))).toBe(false)
  expect(screen.queryByText('Pedidos da empresa')).not.toBeInTheDocument()
})
