import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { IdiomaProvider } from '../../lib/i18n'
import { api, setTokens } from '../../lib/api'
import { escopoRascunhos, guardarRascunho, lerRascunhos } from '../../lib/rascunhosConversa'
import { ConversaTab } from './ConversaTab'
import { MesaTab } from './MesaTab'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: {
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn(),
} }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
vi.mock('../../lib/useBrasao', () => ({ useBrasao: () => null }))
vi.mock('../../lib/ws', () => ({ wsClient: { on: () => () => {}, subscribe: () => () => {}, connect: vi.fn(), close: vi.fn() } }))

const modos = ['predio', 'andar', 'mesa'] as const
type Modo = typeof modos[number]
const proposta = { tipo: 'canon', resumo: 'Informações propostas para revisar.', secoes: [
  { secao: 'Tom de voz', conteudo: 'Acolhedor e leve.' },
  { secao: 'Público', conteudo: 'Adultos de Curitiba.' },
  { secao: 'Objetivo', conteudo: 'Divulgar consultas.' },
] }
const textoInicial = 'Ajuste apenas a arte escolhida.'
const correcao = 'Direto e acolhedor, sem frases prontas.'
const referencia = { jobId: 77, entregaId: 88, intencao: 'ajustar' as const }
const scrollOriginal = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
beforeAll(() => Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }))
afterAll(() => {
  if (scrollOriginal) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollOriginal)
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})
const campo = (modo: Modo) => screen.getByRole('textbox', { name: modo === 'mesa' ? 'Mensagem' : 'Seu pedido' })
function tela(modo: Modo) {
  const slug = modo === 'predio' ? 'predio' : 'conteudo'
  const office = { slug, nome: 'Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
  return <StrictMode><MemoryRouter initialEntries={['/app?org=1&conversa=42']}><IdiomaProvider>
    {modo === 'mesa' ? <MesaTab orgId={1} slug="conteudo" orgNome="Aurora" configHref="/config" />
      : <ConversaTab orgId={1} slug={slug} office={office} meuPapel="owner" nivelPredio={modo === 'predio'} />}
  </IdiomaProvider></MemoryRouter></StrictMode>
}
async function abrir(modo: Modo) {
  const slug = modo === 'predio' ? 'predio' : 'conteudo'
  const conversa = { id: 42, organization_id: 1, office_slug: modo === 'predio' ? null : slug,
    titulo: 'Campanha escolhida', atualizado_em: '2026-10-10T00:00:00Z', total_mensagens: 1,
    mensagens: [{ id: 8, role: 'assistant', conteudo: 'Confira estas informações.', criado_em: '2026-10-10T00:00:00Z', sugestao_tarefa: proposta }],
    anexos: [{ nome: 'camisa.png' }], trabalho_job_id: 31,
  }
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/conversas/42') return conversa
    if (path.endsWith('/canon')) return { conteudo: '## Tom de voz\nFormal.\n' }
    if (path.endsWith('/conversas')) return { conversas: [conversa] }
    if (path.endsWith('/partida')) return { tem_motor: true, tem_chave: true, sabatina_pendente: false }
    if (path === '/jobs/31') return { id: 31, org_id: 1, office_slug: 'conteudo', titulo: 'Trabalho original', status: 'running' }
    return []
  })
  if (modo !== 'mesa') guardarRascunho(escopoRascunhos(1, slug, modo === 'predio'), '42', textoInicial, referencia)
  const view = render(tela(modo))
  if (modo === 'mesa') {
    fireEvent.click(await screen.findByRole('button', { name: /^Campanha escolhida/ }))
    await screen.findByText('Confira estas informações.')
    fireEvent.change(campo(modo), { target: { value: textoInicial } })
  }
  await screen.findByText('Formal.')
  await waitFor(() => expect(campo(modo)).toHaveValue(textoInicial))
  return view
}
function semEscritas() {
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled()
  expect(api.patch).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled(); expect(api.postForm).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('offiz:idioma:visitante', 'pt-BR'); setTokens('sessao-sintetica', 'refresh-sintetico')
  vi.mocked(api.postForm).mockResolvedValue({})
})

it.each(modos)('continuação em %s conserva só correções selecionadas no rascunho e não envia ou guarda o perfil', async modo => {
  const view = await abrir(modo)
  if (modo === 'mesa') {
    const input = view.container.querySelector<HTMLInputElement>('input[type=file]')!
    fireEvent.change(input, { target: { files: [new File(['sintetico'], 'camisa.png')] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remover camisa.png' })).toBeEnabled())
    await screen.findByText('Formal.'); vi.mocked(api.postForm).mockClear()
  }
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto de Tom de voz' }), { target: { value: correcao } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto de Público' }), { target: { value: 'Adolescentes.' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Público' }))
  const cartao = screen.getByRole('region', { name: 'Confira o perfil' })
  expect(within(cartao).getByRole('status')).toHaveTextContent('suas correções ficam no campo da conversa para você revisar e enviar')
  fireEvent.click(within(cartao).getByRole('button', { name: 'Continuar conversando' }))
  const esperado = `${textoInicial}\n\nTom de voz: ${correcao}`
  await waitFor(() => expect(campo(modo)).toHaveValue(esperado))
  expect(campo(modo)).toHaveFocus(); expect(screen.getByText('camisa.png')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Confira o perfil' })).not.toBeInTheDocument()
  if (modo !== 'mesa') {
    expect(lerRascunhos(escopoRascunhos(1, modo === 'predio' ? 'predio' : 'conteudo', modo === 'predio'))['42']).toMatchObject({ texto: esperado, referencia })
    expect(api.get).not.toHaveBeenCalledWith('/jobs/31')
    expect(screen.getByRole('button', { name: 'Ver aqui do lado' })).toBeInTheDocument()
    view.unmount(); render(tela(modo))
    await waitFor(() => expect(campo(modo)).toHaveValue(esperado))
    expect(screen.getByText('camisa.png')).toBeInTheDocument()
    expect(lerRascunhos(escopoRascunhos(1, modo === 'predio' ? 'predio' : 'conteudo', modo === 'predio'))['42']).toMatchObject({ texto: esperado, referencia })
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
    fireEvent.click(screen.getByRole('button', { name: /^Campanha escolhida/ }))
    await waitFor(() => expect(campo(modo)).toHaveValue(esperado))
    expect(screen.getByRole('button', { name: 'Remover camisa.png' })).toBeInTheDocument()
  }
  semEscritas()
})

it.each(modos)('continuar em %s sem edição não promove texto da IA para fala humana', async modo => {
  await abrir(modo)
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto de Tom de voz' }), { target: { value: '  Acolhedor e leve.  ' } })
  expect(within(screen.getByRole('region', { name: 'Confira o perfil' })).queryByRole('status')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar conversando' }))
  expect(campo(modo)).toHaveValue(textoInicial)
  expect(screen.queryByRole('region', { name: 'Confira o perfil' })).not.toBeInTheDocument(); semEscritas()
})

it.each(modos)('continuar em %s não exporta seção desmarcada ou apagada', async modo => {
  await abrir(modo)
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto de Tom de voz' }), { target: { value: correcao } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Tom de voz' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto de Público' }), { target: { value: '   ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continuar conversando' }))
  expect(campo(modo)).toHaveValue(textoInicial); semEscritas()
})

it.each(modos)('a troca de sessão em %s impede passar uma correção da tela anterior ao rascunho', async modo => {
  await abrir(modo)
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto de Tom de voz' }), { target: { value: correcao } })
  setTokens('outra-sessao-sintetica', 'outro-refresh-sintetico')
  fireEvent.click(screen.getByRole('button', { name: 'Continuar conversando' }))
  expect(campo(modo)).toHaveValue(textoInicial)
  expect(screen.getByRole('region', { name: 'Confira o perfil' })).toBeInTheDocument(); semEscritas()
})
