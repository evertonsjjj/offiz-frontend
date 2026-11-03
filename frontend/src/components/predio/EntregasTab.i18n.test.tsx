import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StrictMode, useState } from 'react'
import { webcrypto } from 'node:crypto'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { EntregasTab } from './EntregasTab'
import { api, ApiError, baixarArquivo, carregarArquivo, clearTokens, respostaAutenticada, setTokens } from '../../lib/api'
import { wsClient } from '../../lib/ws'

const traduzir = vi.hoisted(() => (_pt: string, en: string) => en)
const toasts = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn() }))
vi.mock('../../lib/i18n', () => ({ useIdioma: () => ({ idioma: 'en', t: traduzir }) }))
vi.mock('../Toasts', () => ({ useToasts: () => toasts }))
vi.mock('../../lib/ws', () => ({ wsClient: { on: vi.fn(() => () => undefined) } }))
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }, respostaAutenticada: vi.fn(), baixarArquivo: vi.fn(), carregarArquivo: vi.fn() }
})

const original = {
  id: 5, job_id: 8, job_titulo: 'Resultados do lançamento', nome: 'relatório.html',
  caminho_rel: 'outputs/relatório.html', tamanho_bytes: 300, mime: 'text/html', status: 'pendente',
  cliente: 'João & Filhos', cliente_id: 3, criado_em: '2026-09-09T12:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  setTokens('fixture-entregas', 'fixture-refresh')
  vi.stubGlobal('crypto', webcrypto)
  vi.mocked(api.get).mockReset().mockImplementation(async (url) => url.endsWith('/melhorias') ? { melhorias: [], teto: '', rodadas: 0 } : [original])
  vi.mocked(api.post).mockReset().mockResolvedValue({})
  vi.mocked(respostaAutenticada).mockReset().mockResolvedValue(new Response('<h1>Receita do lançamento</h1><p>Texto aprovado em português.</p>'))
  vi.mocked(baixarArquivo).mockReset().mockResolvedValue(undefined)
  vi.mocked(carregarArquivo).mockReset().mockResolvedValue('blob:fixture-entregas')
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:fixture-entregas')
    static revokeObjectURL = vi.fn()
  })
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Esta prova não permite transporte real.'))))
})

afterEach(() => {
  retirarOuvintes.splice(0).forEach(retirar => retirar())
  try { expect(fetch).not.toHaveBeenCalled() }
  finally { vi.unstubAllGlobals() }
})

it('erro inicial permite recuperar a lista sem afirmar que não há entregas', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(503, 'Service unavailable'))
  render(<MemoryRouter><EntregasTab orgId={1} slug="financeiro" /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable')
  expect(screen.queryByText(/Nothing awaiting you here/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Resultados do lançamento')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('inglês traduz a revisão e mantém entrega, cliente, HTML e feedback no idioma original', async () => {
  render(<MemoryRouter><EntregasTab orgId={1} slug="financeiro" /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: /Tasks awaiting your approval/ })).toBeInTheDocument()
  expect(screen.getByText('Resultados do lançamento')).toBeInTheDocument()
  expect(screen.getAllByText('João & Filhos').length).toBeGreaterThan(0)
  const preview = await screen.findByTitle('relatório.html')
  expect(preview).toHaveAttribute('sandbox', '')
  expect(preview).toHaveAttribute('srcdoc', expect.stringContaining('<h1>Receita do lançamento</h1><p>Texto aprovado em português.</p>'))
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
  fireEvent.change(screen.getByLabelText('Reason for rejection'), { target: { value: 'Mantenha o título e corrija os valores em reais.' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /Redo the task with this correction/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Reject and redo' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/jobs/8/entregas/rejeitar', {
    feedback: 'Mantenha o título e corrija os valores em reais.', reexecutar: true,
  }))
  expect(original.nome).toBe('relatório.html')
  expect(original.status).toBe('pendente')
})

it('buscar PDF mantém todos os arquivos pendentes do trabalho que será aprovado', async () => {
  const nomes = ['apresentacao.pdf', 'slides.pptx', 'post-um.png', 'post-dois.png']
  const items = nomes.map((nome, i) => ({ ...original, id: 20+i, nome, caminho_rel: 'outputs/'+nome, mime: 'application/octet-stream' }))
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/melhorias') ? { melhorias: [] } : items)
  render(<MemoryRouter><EntregasTab orgId={1} slug="financeiro" /></MemoryRouter>)
  const busca = await screen.findByRole('searchbox', { name: 'Search other deliverables' })
  fireEvent.change(busca, { target: { value: 'pdf' } })
  expect(document.querySelectorAll('.trabalho-etapas > li')).toHaveLength(4)
  expect(screen.getByRole('button', { name: 'Looks good' })).toBeInTheDocument()
})

it('busca no histórico completo antes de paginar e mantém o trabalho no pedido de ajuste', async () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ ...original, id: 100+i, job_id: 200+i, status: 'aprovada', job_titulo: i === 0 ? 'Campanha Açúcar 120' : `Entrega ${i+1}`, criado_em: new Date(2026, 0, i+1).toISOString() }))
  vi.mocked(api.get).mockImplementation(async (url) => url.endsWith('/melhorias') ? { melhorias: [], teto: '', rodadas: 0 } : items)
  function Destino() { return <output data-testid="destino">{useLocation().search}</output> }
  const callback = vi.fn()
  render(<MemoryRouter initialEntries={['/app?slug=conteudo&vista=entregas&area=financeiro&org=1&conversa=42']}><EntregasTab orgId={1} slug="financeiro" aoPedirAjuste={callback} /><Destino /></MemoryRouter>)
  const busca = await screen.findByRole('searchbox', { name: 'Search other deliverables' })
  expect(document.querySelectorAll('.hist-trabalhos > details')).toHaveLength(24)
  expect(screen.queryByText(/Campanha Açúcar 120/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show more deliverables' }))
  expect(document.querySelectorAll('.hist-trabalhos > details')).toHaveLength(48)
  expect(screen.getByRole('button', { name: 'Show more deliverables' })).toBeInTheDocument()
  fireEvent.change(busca, { target: { value: 'acucar 120' } })
  expect(screen.queryByRole('button', { name: 'Show more deliverables' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText(/Campanha Açúcar 120/))
  fireEvent.click(screen.getByRole('button', { name: 'Request adjustment' }))
  const query = new URLSearchParams(screen.getByTestId('destino').textContent || '')
  expect(query.get('ajustejob')).toBe('200')
  expect(query.get('org')).toBe('1')
  expect(query.get('slug')).toBe('financeiro')
  expect(query.get('conversa')).toBe('nova')
  expect(query.has('vista')).toBe(false)
  expect(query.has('area')).toBe(false)
  expect(callback).toHaveBeenCalledOnce()
})

it('ajuste sem cliente não herda o cliente de outro pedido no endereço', async () => {
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/melhorias') ? { melhorias: [] } : [{ ...original, cliente_id: null, cliente: null }])
  function Destino() { return <output data-testid="destino">{useLocation().search}</output> }
  render(<MemoryRouter initialEntries={['/app?org=1&area=conteudo&vista=entregas&conversa=42&ajustecli=999']}><EntregasTab orgId={1} slug="conteudo" /><Destino /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Request adjustment' }))
  const query = new URLSearchParams(screen.getByTestId('destino').textContent || '')
  expect(query.get('ajustejob')).toBe('8')
  expect(query.get('conversa')).toBe('nova')
  expect(query.has('ajustecli')).toBe(false)
  expect(query.get('org')).toBe('1')
  expect(api.post).not.toHaveBeenCalled()
})

function adiado<T>() {
  let resolver!: (valor: T) => void, rejeitar!: (erro: Error) => void
  const promessa = new Promise<T>((resolve, reject) => { resolver = resolve; rejeitar = reject })
  return { promessa, resolver, rejeitar }
}

const retirarOuvintes: Array<() => void> = []
const melhorias = {
  melhorias: [
    { o_que: 'Sugestão sintética A', por_que: 'Motivo A', pedido: 'Pedido sintético A' },
    { o_que: 'Sugestão sintética B', por_que: 'Motivo B', pedido: 'Pedido sintético B' },
  ], teto: '', rodadas: 1, dispensado: false,
}
const outroTrabalho = { ...original, id: 6, job_id: 9, job_titulo: 'Outro trabalho sintético', nome: 'outro.html', caminho_rel: 'outputs/outro.html' }

function HospedeiroEntregas() {
  const [orgId, setOrgId] = useState(1), [slug, setSlug] = useState('financeiro')
  const [, reavaliar] = useState(0)
  const navegar = useNavigate(), local = useLocation()
  function mudarConversa() {
    const query = new URLSearchParams(local.search)
    query.set('conversa', '99')
    navegar({ search: query.toString() })
  }
  return <>
    <button onClick={() => setOrgId(2)}>Trocar empresa sintética</button>
    <button onClick={() => setSlug('juris')}>Trocar área sintética</button>
    <button onClick={mudarConversa}>Trocar conversa sintética</button>
    <button onClick={() => reavaliar(n => n + 1)}>Reavaliar sessão sintética</button>
    <EntregasTab orgId={orgId} slug={slug} />
  </>
}

function montarMelhorias(comOutro = false) {
  let conversaId = 42
  vi.mocked(api.get).mockImplementation(async url => url === '/auth/me' ? { id: 7 } : url.endsWith('/melhorias') ? melhorias
    : url.endsWith('/entregas') ? [{ ...original, conversa_id: conversaId }, ...(comOutro ? [outroTrabalho] : [])] : [])
  const tela = render(<MemoryRouter initialEntries={['/app?org=1&area=financeiro&vista=entregas&conversa=42']}><HospedeiroEntregas /></MemoryRouter>)
  return { ...tela, trocarConversaDoTrabalho: () => {
    conversaId = 99
    const listener = vi.mocked(wsClient.on).mock.calls.find(([evento]) => evento === 'job_status')?.[1]
    act(() => listener?.({ t: 'job_status', org_id: 1, office_slug: 'financeiro', status: 'done' }))
  } }
}

async function blocoDeMelhorias() {
  const titulo = await screen.findByText(original.job_titulo)
  const card = titulo.closest('.entrega-card') as HTMLElement
  const bloco = (await within(card).findByText('What could improve')).closest('.melhorar') as HTMLElement
  await waitFor(() => expect(within(bloco).queryByText('Verifying your account…')).not.toBeInTheDocument())
  return bloco
}

function botaoSugestao(bloco: HTMLElement, letra: 'A' | 'B') {
  const item = within(bloco).getByText(`Sugestão sintética ${letra}`).closest('.melhorar-item') as HTMLElement
  return within(item).getByRole('button')
}

function pedidoProprio(bloco: HTMLElement, texto: string) {
  const campo = within(bloco).getByRole('textbox')
  fireEvent.change(campo, { target: { value: texto } })
  const formulario = campo.closest('form') as HTMLElement
  fireEvent.submit(formulario)
  return { campo, formulario }
}

function observarMudancas() {
  const avisos = vi.fn()
  window.addEventListener('offiz:entregas-mudou', avisos)
  retirarOuvintes.push(() => window.removeEventListener('offiz:entregas-mudou', avisos))
  return avisos
}

const uuidPedido = (i = 0) => (vi.mocked(api.post).mock.calls[i][1] as { request_id: string }).request_id
const reciboPedido = (i = 0, id = 101) => ({ id, request_id: uuidPedido(i), office_slug: 'financeiro', replayed: false })

it('A/B/A serializa a confirmação HTTP e não duplica A; o clique seguinte em B cria outra intenção', async () => {
  const a = adiado<unknown>(), b = adiado<unknown>()
  vi.mocked(api.post).mockReturnValueOnce(a.promessa).mockReturnValueOnce(b.promessa)
  montarMelhorias()
  const bloco = await blocoDeMelhorias()
  const botaoA = botaoSugestao(bloco, 'A'), botaoB = botaoSugestao(bloco, 'B')
  fireEvent.click(botaoA)
  fireEvent.click(botaoB)
  fireEvent.click(botaoA)
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  expect(api.post).toHaveBeenNthCalledWith(1, '/predios/1/financeiro/jobs', { prompt: 'Pedido sintético A', request_id: expect.any(String) })
  expect(botaoA).toBeDisabled()
  expect(botaoB).toBeDisabled()
  await act(async () => a.resolver(reciboPedido()))
  await waitFor(() => expect(botaoA).toHaveTextContent('requested ✓'))
  expect(botaoB).toBeEnabled()
  fireEvent.click(botaoB); fireEvent.click(botaoA)
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
  expect(api.post).toHaveBeenNthCalledWith(2, '/predios/1/financeiro/jobs', { prompt: 'Pedido sintético B', request_id: expect.any(String) })
  expect(uuidPedido(1)).not.toBe(uuidPedido())
  await act(async () => b.resolver(reciboPedido(1, 102)))
  await waitFor(() => expect(botaoB).toHaveTextContent('requested ✓'))
})

it('A/B/A não libera B antes do ACK; falha de B exige consulta e retry explícito do mesmo corpo e UUID', async () => {
  const a = adiado<unknown>(), b = adiado<unknown>(), retry = adiado<unknown>()
  vi.mocked(api.post).mockReturnValueOnce(a.promessa).mockReturnValueOnce(b.promessa).mockReturnValueOnce(retry.promessa)
  montarMelhorias()
  const bloco = await blocoDeMelhorias()
  const botaoA = botaoSugestao(bloco, 'A'), botaoB = botaoSugestao(bloco, 'B')
  fireEvent.click(botaoA)
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  await act(async () => a.resolver(reciboPedido()))
  await waitFor(() => expect(botaoA).toHaveTextContent('requested ✓'))
  fireEvent.click(botaoB); fireEvent.click(botaoA)
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
  expect(botaoA).toHaveTextContent('requested ✓')
  expect(botaoA).toBeDisabled()
  expect(botaoB).toHaveTextContent('Sending request…')
  expect(botaoB).toBeDisabled()
  fireEvent.click(botaoB)
  expect(api.post).toHaveBeenCalledTimes(2)
  await act(async () => b.rejeitar(new ApiError(503, 'Falha sintética B')))
  expect(botaoB).toBeDisabled()
  expect(within(bloco).getAllByRole('button', { name: 'Check submission' })).toHaveLength(1)
  const getAnterior = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async url => { if (url.includes('/por-intencao/')) throw new ApiError(404, 'Ainda não encontrado'); return getAnterior(url) })
  fireEvent.click(within(bloco).getByRole('button', { name: 'Check submission' }))
  await waitFor(() => expect(botaoB).toBeEnabled())
  fireEvent.click(botaoB)
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3))
  expect(uuidPedido(2)).toBe(uuidPedido(1))
  expect(botaoB).toBeDisabled()
  await act(async () => retry.resolver(reciboPedido(2, 103)))
  await waitFor(() => expect(botaoB).toHaveTextContent('requested ✓'))
})

it.each([false, true])('pedido próprio confirmado limpa apenas o rascunho enviado (editado depois: %s)', async editado => {
  const envio = adiado<{ ok: boolean; job_id: number }>(), avisos = observarMudancas()
  vi.mocked(api.post).mockReturnValue(envio.promessa)
  montarMelhorias()
  const bloco = await blocoDeMelhorias()
  const { campo, formulario } = pedidoProprio(bloco, 'Pedido próprio A')
  fireEvent.submit(formulario)
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(api.post).toHaveBeenCalledWith('/predios/1/financeiro/trabalhos/8/melhorias/decidir', { decisao: 'pedir', texto: 'Pedido próprio A' })
  if (editado) fireEvent.change(campo, { target: { value: 'Rascunho novo B' } })
  await act(async () => envio.resolver({ ok: true, job_id: 104 }))
  expect(campo).toHaveValue(editado ? 'Rascunho novo B' : '')
  expect(toasts.sucesso).toHaveBeenCalledWith('Request sent — follow its progress')
  expect(toasts.falha).not.toHaveBeenCalled()
  expect(avisos).toHaveBeenCalledOnce()
  expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/predios/1/financeiro/entregas')).toHaveLength(2)
})

const contextosMelhoria = ['desmontagem', 'empresa', 'área', 'trabalho', 'sessão', 'conversa URL', 'conversa do trabalho'] as const
type ContextoMelhoria = typeof contextosMelhoria[number]
type TelaMelhorias = ReturnType<typeof montarMelhorias>
async function trocarContexto(tela: TelaMelhorias, contexto: ContextoMelhoria) {
  if (contexto === 'desmontagem') { tela.unmount(); return }
  if (contexto === 'empresa') fireEvent.click(screen.getByRole('button', { name: 'Trocar empresa sintética' }))
  else if (contexto === 'área') fireEvent.click(screen.getByRole('button', { name: 'Trocar área sintética' }))
  else if (contexto === 'sessão') {
    setTokens('outra-sessao-entregas', 'outro-refresh-entregas')
    fireEvent.click(screen.getByRole('button', { name: 'Reavaliar sessão sintética' }))
  } else if (contexto === 'conversa URL') fireEvent.click(screen.getByRole('button', { name: 'Trocar conversa sintética' }))
  else if (contexto === 'conversa do trabalho') tela.trocarConversaDoTrabalho()
  else fireEvent.change(screen.getByRole('searchbox', { name: 'Search other deliverables' }), { target: { value: outroTrabalho.job_titulo } })
  await act(async () => {})
}

const retornosObsoletos = contextosMelhoria.flatMap(contexto => (['sugestão', 'pedido próprio', 'dispensa'] as const)
  .flatMap(acao => (contexto === 'sessão' ? ['falha'] as const : ['sucesso', 'falha'] as const).map(retorno => ({ contexto, acao, retorno }))))
it.each(retornosObsoletos)('$acao retorna $retorno após $contexto sem aviso nem recarga da tela atual', async ({ contexto, acao, retorno }) => {
  const envio = adiado<{ ok: boolean; id: number }>(), avisos = observarMudancas()
  vi.mocked(api.post).mockReturnValue(envio.promessa)
  const tela = montarMelhorias(contexto === 'trabalho')
  const bloco = await blocoDeMelhorias()
  if (acao === 'sugestão') fireEvent.click(botaoSugestao(bloco, 'A'))
  else if (acao === 'pedido próprio') pedidoProprio(bloco, 'Intenção original sintética')
  else fireEvent.click(within(bloco).getByRole('button', { name: 'Good as it is' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce())
  await trocarContexto(tela, contexto)
  const leituras = vi.mocked(api.get).mock.calls.length
  await act(async () => {
    if (retorno === 'sucesso') envio.resolver({ ok: true, id: 105 })
    else envio.rejeitar(new ApiError(contexto === 'sessão' ? 409 : 503, 'Retorno antigo sintético'))
  })
  expect(toasts.sucesso).not.toHaveBeenCalled()
  expect(toasts.falha).not.toHaveBeenCalled()
  expect(avisos).not.toHaveBeenCalled()
  expect(api.get).toHaveBeenCalledTimes(leituras)
  expect(api.post).toHaveBeenCalledOnce()
  if (contexto !== 'desmontagem') expect(screen.queryByText('Noted: this one is good as it is.')).not.toBeInTheDocument()
})

it.each(['sugestão', 'pedido próprio', 'dispensa'] as const)('$acao na nova conversa do mesmo trabalho fica disponível e conserva a intenção pendente ao retornar a antiga', async acao => {
  const antigo = adiado<unknown>(), novo = adiado<unknown>(), avisos = observarMudancas()
  vi.mocked(api.post).mockReturnValueOnce(antigo.promessa).mockReturnValueOnce(novo.promessa)
  const tela = montarMelhorias()
  function iniciar(bloco: HTMLElement, texto: string) {
    if (acao === 'pedido próprio') {
      const campo = within(bloco).getByRole('textbox')
      fireEvent.change(campo, { target: { value: texto } })
      const formulario = campo.closest('form') as HTMLElement
      const botao = within(formulario).getByRole('button')
      expect(botao).toBeEnabled()
      fireEvent.submit(formulario)
      return botao
    }
    const botao = acao === 'sugestão' ? botaoSugestao(bloco, 'A') : within(bloco).getByRole('button', { name: 'Good as it is' })
    expect(botao).toBeEnabled()
    fireEvent.click(botao)
    return botao
  }
  iniciar(await blocoDeMelhorias(), 'Pedido da conversa anterior')
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce())
  await trocarContexto(tela, 'conversa do trabalho')
  const blocoNovo = await blocoDeMelhorias()
  if (acao === 'sugestão') {
    expect(botaoSugestao(blocoNovo, 'A')).toBeDisabled()
    expect(within(blocoNovo).getAllByRole('button', { name: 'Check submission' })).toHaveLength(1)
    fireEvent.click(within(blocoNovo).getByRole('button', { name: 'Prepare another request' }))
  }
  const botaoNovo = iniciar(blocoNovo, 'Pedido da conversa nova')
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
  expect(botaoNovo).toBeDisabled()
  const leituras = vi.mocked(api.get).mock.calls.length
  await act(async () => antigo.resolver(acao === 'sugestão' ? reciboPedido(0, 106) : { ok: true, id: 106 }))
  expect(botaoNovo).toBeDisabled()
  expect(api.get).toHaveBeenCalledTimes(leituras)
  expect(toasts.sucesso).not.toHaveBeenCalled()
  expect(toasts.falha).not.toHaveBeenCalled()
  expect(avisos).not.toHaveBeenCalled()
  if (acao === 'pedido próprio') {
    const campo = within(blocoNovo).getByRole('textbox')
    expect(campo).toHaveValue('Pedido da conversa nova')
    fireEvent.submit(campo.closest('form')!)
  } else fireEvent.click(botaoNovo)
  expect(api.post).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('Noted: this one is good as it is.')).not.toBeInTheDocument()
  await act(async () => novo.resolver(acao === 'sugestão' ? reciboPedido(1, 107) : { ok: true, id: 107 }))
  if (acao === 'dispensa') {
    expect(screen.getByText('Noted: this one is good as it is.')).toBeVisible()
    expect(toasts.sucesso).not.toHaveBeenCalled()
    expect(avisos).not.toHaveBeenCalled()
  } else {
    await waitFor(() => expect(toasts.sucesso).toHaveBeenCalledOnce())
    expect(avisos).toHaveBeenCalledOnce()
    if (acao === 'sugestão') expect(botaoNovo).toHaveTextContent('requested ✓')
    else expect(within(blocoNovo).getByRole('textbox')).toHaveValue('')
  }
  expect(toasts.falha).not.toHaveBeenCalled()
})

it.each(['novo login', 'logout'] as const)('%s antes de rerender bloqueia os três controles de melhoria da tela antiga', async mudanca => {
  montarMelhorias()
  const bloco = await blocoDeMelhorias()
  const campo = within(bloco).getByRole('textbox')
  fireEvent.change(campo, { target: { value: 'Rascunho da sessão anterior' } })
  if (mudanca === 'novo login') setTokens('novo-login-sintetico', 'novo-refresh-sintetico')
  else clearTokens()
  fireEvent.click(botaoSugestao(bloco, 'A'))
  fireEvent.submit(campo.closest('form')!)
  fireEvent.click(within(bloco).getByRole('button', { name: 'Good as it is' }))
  await act(async () => {})
  expect(api.post).not.toHaveBeenCalled()
  expect(toasts.sucesso).not.toHaveBeenCalled()
  expect(toasts.falha).not.toHaveBeenCalled()
  expect(campo).toHaveValue('Rascunho da sessão anterior')
})

it('dispensa confirmada conserva a confirmação normal sem toast redundante', async () => {
  const envio = adiado<{ ok: boolean; dispensado: boolean }>()
  vi.mocked(api.post).mockReturnValue(envio.promessa)
  montarMelhorias()
  const bloco = await blocoDeMelhorias()
  fireEvent.click(within(bloco).getByRole('button', { name: 'Good as it is' }))
  expect(api.post).toHaveBeenCalledWith('/predios/1/financeiro/trabalhos/8/melhorias/decidir', { decisao: 'esta_bom' })
  await act(async () => envio.resolver({ ok: true, dispensado: true }))
  expect(screen.getByText('Noted: this one is good as it is.')).toBeVisible()
  expect(toasts.sucesso).not.toHaveBeenCalled()
  expect(toasts.falha).not.toHaveBeenCalled()
})

function controleDownload(indice = 0) {
  const opcoes = vi.mocked(baixarArquivo).mock.calls[indice][2]
  expect(opcoes?.signal).toBeDefined()
  expect(opcoes?.vigente).toBeTypeOf('function')
  return { signal: opcoes!.signal!, vigente: opcoes!.vigente! }
}

it('download só começa por clique e mantém uma intenção por entrega enquanto pendente', async () => {
  const envio = adiado<void>(), novo = adiado<void>()
  vi.mocked(baixarArquivo).mockReturnValueOnce(envio.promessa).mockReturnValueOnce(novo.promessa)
  montarMelhorias()
  await blocoDeMelhorias()
  expect(baixarArquivo).not.toHaveBeenCalled()
  const baixar = screen.getByRole('button', { name: 'Download' })
  fireEvent.click(baixar)
  fireEvent.click(baixar)
  expect(baixarArquivo).toHaveBeenCalledOnce()
  expect(baixarArquivo).toHaveBeenCalledWith('/entregas/5/download', original.nome, expect.any(Object))
  const controle = controleDownload()
  expect(controle.signal.aborted).toBe(false)
  expect(controle.vigente()).toBe(true)
  await act(async () => envio.resolver(undefined))
  expect(controle.vigente()).toBe(false)
  fireEvent.click(baixar)
  expect(baixarArquivo).toHaveBeenCalledTimes(2)
  expect(controleDownload(1).signal).not.toBe(controle.signal)
  expect(controleDownload(1).vigente()).toBe(true)
  await act(async () => novo.resolver(undefined))
})

it('downloads de entregas diferentes conservam intenções independentes', async () => {
  const primeiro = adiado<void>(), segundo = adiado<void>()
  vi.mocked(baixarArquivo).mockReturnValueOnce(primeiro.promessa).mockReturnValueOnce(segundo.promessa)
  montarMelhorias(true)
  await blocoDeMelhorias()
  const botoes = screen.getAllByRole('button', { name: 'Download' })
  fireEvent.click(botoes[0])
  fireEvent.click(botoes[1])
  expect(baixarArquivo).toHaveBeenCalledTimes(2)
  const um = controleDownload(), dois = controleDownload(1)
  expect(um.signal).not.toBe(dois.signal)
  expect(um.vigente()).toBe(true)
  expect(dois.vigente()).toBe(true)
  await act(async () => primeiro.resolver(undefined))
  expect(um.vigente()).toBe(false)
  expect(dois.vigente()).toBe(true)
  fireEvent.click(botoes[1])
  expect(baixarArquivo).toHaveBeenCalledTimes(2)
  await act(async () => segundo.resolver(undefined))
})

it('erro vigente de download informa a falha e libera somente retry explícito com controller novo', async () => {
  const envio = adiado<void>(), retry = adiado<void>()
  vi.mocked(baixarArquivo).mockReturnValueOnce(envio.promessa).mockReturnValueOnce(retry.promessa)
  montarMelhorias()
  await blocoDeMelhorias()
  const baixar = screen.getByRole('button', { name: 'Download' })
  fireEvent.click(baixar)
  const primeiro = controleDownload()
  expect(primeiro.vigente()).toBe(true)
  await act(async () => envio.rejeitar(new ApiError(503, 'Arquivo indisponível, tente novamente')))
  expect(toasts.falha).toHaveBeenCalledOnce()
  expect(toasts.falha).toHaveBeenCalledWith('Arquivo indisponível, tente novamente')
  expect(baixarArquivo).toHaveBeenCalledOnce()
  expect(primeiro.vigente()).toBe(false)
  fireEvent.click(baixar)
  expect(baixarArquivo).toHaveBeenCalledTimes(2)
  const segundo = controleDownload(1)
  expect(segundo.signal).not.toBe(primeiro.signal)
  expect(segundo.signal.aborted).toBe(false)
  expect(segundo.vigente()).toBe(true)
  fireEvent.click(baixar)
  expect(baixarArquivo).toHaveBeenCalledTimes(2)
  await act(async () => retry.resolver(undefined))
  expect(segundo.vigente()).toBe(false)
  expect(toasts.falha).toHaveBeenCalledOnce()
})

it.each(['desmontagem', 'empresa', 'área', 'sessão', 'conversa URL'] as const)('download pendente após %s é abortado e não entrega efeito tardio', async contexto => {
  const envio = adiado<void>()
  vi.mocked(baixarArquivo).mockReturnValue(envio.promessa)
  const tela = montarMelhorias()
  await blocoDeMelhorias()
  fireEvent.click(screen.getByRole('button', { name: 'Download' }))
  expect(baixarArquivo).toHaveBeenCalledOnce()
  const controle = controleDownload()
  expect(controle.vigente()).toBe(true)
  await trocarContexto(tela, contexto)
  expect(controle.signal.aborted).toBe(true)
  expect(controle.vigente()).toBe(false)
  await act(async () => envio.rejeitar(new Error('Download antigo sintético')))
  expect(toasts.falha).not.toHaveBeenCalled()
  expect(baixarArquivo).toHaveBeenCalledOnce()
})

it.each([1, 2])('[estado confirmado] aprovação conta somente os IDs confirmados pelo backend (%s)', async quantidade => {
  const items = [original, { ...original, id: 7, nome: 'valores.csv', caminho_rel: 'outputs/valores.csv', mime: 'text/csv' }]
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/melhorias') ? { melhorias: [] } : items)
  vi.mocked(api.post).mockResolvedValue({ ok: true, aprovadas: items.slice(0, quantidade).map(e => e.id), licao_registrada: false })
  render(<MemoryRouter><EntregasTab orgId={1} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Looks good' }))
  await waitFor(() => expect(toasts.sucesso).toHaveBeenCalledWith(`${quantidade} file${quantidade > 1 ? 's' : ''} approved in “${original.job_titulo}”. Other file decisions were kept.`))
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/8/entregas/aprovar')
})

it.each([{}, { aprovadas: [5, 5] }, { aprovadas: [999] }, { aprovadas: [] }])('[estado confirmado] ACK de aprovação inválido consulta estado sem afirmar aprovação (%j)', async ack => {
  vi.mocked(api.post).mockResolvedValue(ack)
  render(<MemoryRouter><EntregasTab orgId={1} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Looks good' }))
  await waitFor(() => expect(toasts.falha).toHaveBeenCalledWith('Approval was not confirmed. Check the updated files before making another decision.'))
  expect(toasts.sucesso).not.toHaveBeenCalled()
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([url]) => url.endsWith('/entregas'))).toHaveLength(2))
  expect(api.post).toHaveBeenCalledOnce()
})

it.each([true, false, null])('[estado confirmado] rejeição só confirma lição quando o ACK permite (%s)', async licao => {
  vi.mocked(api.post).mockResolvedValue({ ok: true, rejeitadas: [5], licao_registrada: licao, novo_job: null })
  render(<MemoryRouter><EntregasTab orgId={1} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
  fireEvent.change(screen.getByLabelText('Reason for rejection'), { target: { value: 'Feedback sintético' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }))
  await waitFor(() => expect(toasts.sucesso).toHaveBeenCalledWith(licao === true ? 'Task rejected. Your feedback was saved to guide future work.' : 'Task rejected. Your feedback was recorded.'))
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/8/entregas/rejeitar', { feedback: 'Feedback sintético', reexecutar: false })
})

it.each([null, { id: 'synthetic-lesson' }])('[estado confirmado] feedback posterior não inventa lição ausente (%j)', async licao => {
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/melhorias') ? { melhorias: [] } : [{ ...original, status: 'aprovada' }])
  vi.mocked(api.post).mockResolvedValue({ ok: true, licao })
  render(<MemoryRouter><EntregasTab orgId={1} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /^Give feedback/ }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Feedback posterior sintético' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
  await waitFor(() => expect(toasts.sucesso).toHaveBeenCalledWith(licao ? 'Feedback saved to guide future deliverables.' : 'Feedback recorded.'))
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/8/entregas/feedback', { feedback: 'Feedback posterior sintético' })
})

it.each(['sugestão', 'próprio'] as const)('[estado confirmado] pedido %s enfileirado não anuncia início', async tipo => {
  const tela = montarMelhorias(), bloco = await blocoDeMelhorias()
  vi.mocked(api.post).mockImplementation(async (_url, body) => tipo === 'sugestão' ? { id: 91, status: 'queued', request_id: (body as { request_id: string }).request_id, office_slug: 'financeiro', replayed: false } : { ok: true, job_id: 91 })
  if (tipo === 'sugestão') fireEvent.click(botaoSugestao(bloco, 'A'))
  else pedidoProprio(bloco, 'Pedido sintético próprio')
  await waitFor(() => expect(toasts.sucesso).toHaveBeenCalledWith('Request sent — follow its progress'))
  expect(api.post).toHaveBeenCalledOnce()
  tela.unmount()
})

function remontarSugestoes(items = melhorias.melhorias, consulta?: unknown) {
  vi.mocked(api.get).mockImplementation(async url => {
    if (url === '/auth/me') return { id: 7 }
    if (url.includes('/por-intencao/')) { if (consulta instanceof Error) throw consulta; return consulta }
    return url.endsWith('/melhorias') ? { ...melhorias, melhorias: items } : [{ ...original, conversa_id: 42 }]
  })
  return render(<MemoryRouter initialEntries={['/app?org=1&area=financeiro&vista=entregas&conversa=42']}><HospedeiroEntregas /></MemoryRouter>)
}

it('reload e ordem B/A recuperam A pelo digest sem marcar B nem enviar automaticamente', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  const primeira = montarMelhorias(), bloco = await blocoDeMelhorias()
  fireEvent.click(botaoSugestao(bloco, 'A'))
  await within(bloco).findByRole('button', { name: 'Check submission' })
  const recibo = { ...reciboPedido(), replayed: true }
  primeira.unmount()
  remontarSugestoes([...melhorias.melhorias].reverse(), recibo)
  const atual = await blocoDeMelhorias()
  expect(api.post).toHaveBeenCalledOnce()
  expect(vi.mocked(api.get).mock.calls.filter(([u]) => u.includes('/por-intencao/'))).toHaveLength(0)
  expect(within(atual).getAllByRole('button', { name: 'Check submission' })).toHaveLength(1)
  fireEvent.click(within(atual).getByRole('button', { name: 'Check submission' }))
  await waitFor(() => expect(botaoSugestao(atual, 'A')).toHaveTextContent('requested ✓'))
  expect(botaoSugestao(atual, 'B')).toHaveTextContent('Request this')
  expect(botaoSugestao(atual, 'B')).toBeEnabled(); expect(api.post).toHaveBeenCalledOnce()
})

it('recuperar texto anterior alterado confirma trabalho sem marcar a sugestão nova e novo clique cria UUID distinta', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  const primeira = montarMelhorias(), bloco = await blocoDeMelhorias()
  fireEvent.click(botaoSugestao(bloco, 'A'))
  await within(bloco).findByRole('button', { name: 'Check submission' })
  const recibo = { ...reciboPedido(), replayed: true }, antiga = uuidPedido()
  primeira.unmount()
  remontarSugestoes([{ ...melhorias.melhorias[0], pedido: 'Outro pedido sintético A' }, melhorias.melhorias[1]], recibo)
  const atual = await blocoDeMelhorias()
  fireEvent.click(within(atual).getByRole('button', { name: 'Check submission' }))
  await waitFor(() => expect(toasts.sucesso).toHaveBeenCalledOnce())
  expect(botaoSugestao(atual, 'A')).toHaveTextContent('Request this')
  expect(within(atual).queryByText('requested ✓')).not.toBeInTheDocument()
  vi.mocked(api.post).mockImplementation(async (_p, body) => ({ id: 102, office_slug: 'financeiro', replayed: false, request_id: (body as { request_id: string }).request_id }))
  fireEvent.click(botaoSugestao(atual, 'A'))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
  expect(uuidPedido(1)).not.toBe(antiga)
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual({ prompt: 'Outro pedido sintético A', request_id: expect.any(String) })
  await waitFor(() => expect(botaoSugestao(atual, 'A')).toHaveTextContent('requested ✓'))
})

it('duas sugestões com mesmo JSON são marcadas juntas pela mesma confirmação, sem segundo POST', async () => {
  remontarSugestoes([melhorias.melhorias[0], { ...melhorias.melhorias[1], pedido: melhorias.melhorias[0].pedido }])
  const bloco = await blocoDeMelhorias()
  vi.mocked(api.post).mockImplementation(async (_p, body) => ({ id: 101, office_slug: 'financeiro', replayed: false, request_id: (body as { request_id: string }).request_id }))
  fireEvent.click(botaoSugestao(bloco, 'A'))
  await waitFor(() => expect(botaoSugestao(bloco, 'A')).toHaveTextContent('requested ✓'))
  expect(botaoSugestao(bloco, 'B')).toHaveTextContent('requested ✓')
  fireEvent.click(botaoSugestao(bloco, 'B')); expect(api.post).toHaveBeenCalledOnce()
})

it('dois envios incertos pedem escolha única; recuperar A conserva B e não gera outro pedido', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  const primeira = montarMelhorias(), bloco = await blocoDeMelhorias()
  fireEvent.click(botaoSugestao(bloco, 'A'))
  await within(bloco).findByRole('button', { name: 'Prepare another request' })
  const a = { ...reciboPedido(), replayed: true }
  fireEvent.click(within(bloco).getByRole('button', { name: 'Prepare another request' })); fireEvent.click(botaoSugestao(bloco, 'B'))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
  await within(bloco).findByRole('button', { name: 'Check submission' })
  const b = uuidPedido(1)
  primeira.unmount(); remontarSugestoes(melhorias.melhorias, a)
  const atual = await blocoDeMelhorias()
  const opcoes = within(atual).getAllByRole('button', { name: /^Check submission \d/ })
  expect(opcoes).toHaveLength(2); expect(within(atual).queryByRole('button', { name: 'Check submission' })).not.toBeInTheDocument()
  fireEvent.click(opcoes[0]); fireEvent.click(within(atual).getByRole('button', { name: 'Check submission' }))
  await waitFor(() => expect(botaoSugestao(atual, 'A')).toHaveTextContent('requested ✓'))
  expect(botaoSugestao(atual, 'B')).toHaveTextContent('Request this')
  const raws = Object.keys(localStorage).filter(k => k.startsWith('offiz:producao:')).map(k => JSON.parse(localStorage.getItem(k)!))
  expect(raws).toHaveLength(1); expect(raws[0].request_id).toBe(b); expect(api.post).toHaveBeenCalledTimes(2)
})

it('StrictMode monta sugestões sem gerar; recibo sem digest continua consultável sem atribuir a linha nova', async () => {
  vi.mocked(api.get).mockImplementation(async url => url === '/auth/me' ? { id: 7 } : url.endsWith('/melhorias') ? melhorias : [{ ...original, conversa_id: 42 }])
  render(<StrictMode><MemoryRouter><HospedeiroEntregas /></MemoryRouter></StrictMode>)
  const bloco = await blocoDeMelhorias()
  expect(api.post).not.toHaveBeenCalled()
  expect(vi.mocked(api.get).mock.calls.filter(([u]) => u.includes('/por-intencao/'))).toHaveLength(0)
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  fireEvent.click(botaoSugestao(bloco, 'A')); await within(bloco).findByRole('button', { name: 'Check submission' })
  const key = Object.keys(localStorage).find(k => k.startsWith('offiz:producao:'))!
  const saved = JSON.parse(localStorage.getItem(key)!); delete saved.corpo_sha256
  localStorage.setItem(key, JSON.stringify(saved))
  const get = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async url => url.includes('/por-intencao/') ? { ...reciboPedido(), replayed: true } : get(url))
  fireEvent.click(within(bloco).getByRole('button', { name: 'Check submission' }))
  await waitFor(() => expect(toasts.sucesso).toHaveBeenCalledOnce())
  expect(within(bloco).queryByText('requested ✓')).not.toBeInTheDocument(); expect(api.post).toHaveBeenCalledOnce()
})

it.each(['request_id', 'office_slug'] as const)('ACK de outra %s não marca sugestões nem limpa recibo', async campo => {
  montarMelhorias(); const bloco = await blocoDeMelhorias()
  vi.mocked(api.post).mockImplementation(async (_p, body) => ({ id: 101, office_slug: 'financeiro', replayed: false, request_id: (body as { request_id: string }).request_id, [campo]: campo === 'office_slug' ? 'juris' : '11111111-1111-4111-8111-111111111111' }))
  fireEvent.click(botaoSugestao(bloco, 'A')); await within(bloco).findByRole('button', { name: 'Check submission' })
  expect(toasts.sucesso).not.toHaveBeenCalled(); expect(within(bloco).queryByText('requested ✓')).not.toBeInTheDocument()
  expect(Object.keys(localStorage).filter(k => k.startsWith('offiz:producao:'))).toHaveLength(1)
})

it.each(['sessão', 'desmontagem'] as const)('validar sugestão após ACK e %s não avisa nem recarrega contexto antigo', async contexto => {
  let resolver!: (r: ArrayBuffer) => void
  let chamadas = 0
  const digest = vi.fn((algorithm: string, data: Uint8Array) => ++chamadas === 1
    ? webcrypto.subtle.digest(algorithm, new Uint8Array(data).buffer)
    : new Promise<ArrayBuffer>(r => { resolver = r }))
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: { digest } })
  vi.mocked(api.post).mockImplementation(async (_p, body) => ({ id: 101, office_slug: 'financeiro', replayed: false, request_id: (body as { request_id: string }).request_id }))
  const tela = remontarSugestoes([melhorias.melhorias[0]]), bloco = await blocoDeMelhorias(), avisos = observarMudancas()
  fireEvent.click(botaoSugestao(bloco, 'A'))
  await waitFor(() => expect(digest).toHaveBeenCalledTimes(2))
  expect(botaoSugestao(bloco, 'A')).toBeDisabled()
  if (contexto === 'sessão') { clearTokens(); setTokens('novo-login-pos-ack', 'novo-refresh'); fireEvent.click(screen.getByRole('button', { name: 'Reavaliar sessão sintética' })) }
  else tela.unmount()
  await act(async () => {})
  const leituras = vi.mocked(api.get).mock.calls.length
  await act(async () => resolver(new ArrayBuffer(32)))
  expect(toasts.sucesso).not.toHaveBeenCalled(); expect(avisos).not.toHaveBeenCalled()
  expect(api.get).toHaveBeenCalledTimes(leituras); expect(api.post).toHaveBeenCalledOnce()
})

it('aviso local que falha após confirmação não repete aviso nem POST', async () => {
  toasts.sucesso.mockImplementationOnce(() => { throw new Error('Aviso sintético indisponível') })
  montarMelhorias(); const bloco = await blocoDeMelhorias()
  vi.mocked(api.post).mockImplementation(async (_p, body) => ({ id: 101, office_slug: 'financeiro', replayed: false, request_id: (body as { request_id: string }).request_id }))
  fireEvent.click(botaoSugestao(bloco, 'A'))
  await waitFor(() => expect(botaoSugestao(bloco, 'A')).toHaveTextContent('requested ✓'))
  expect(toasts.sucesso).toHaveBeenCalledOnce(); expect(api.post).toHaveBeenCalledOnce(); expect(botaoSugestao(bloco, 'B')).toBeEnabled()
})

it.each([true, false, null])('[estado confirmado] rejeição de arquivo individual respeita confirmação da lição (%s)', async licao => {
  const items = [original, { ...original, id: 7, nome: 'valores.csv', caminho_rel: 'outputs/valores.csv', mime: 'text/csv' }]
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/melhorias') ? { melhorias: [] } : items)
  vi.mocked(api.post).mockResolvedValue({ ...original, status: 'rejeitada', licao_registrada: licao })
  render(<MemoryRouter><EntregasTab orgId={1} slug="financeiro" /></MemoryRouter>)
  fireEvent.click((await screen.findAllByTitle(/^Reject only this step/))[0])
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Feedback por arquivo sintético' } })
  fireEvent.click(screen.getByRole('button', { name: 'Reject step' }))
  await waitFor(() => expect(toasts.sucesso).toHaveBeenCalledWith(`Step “${original.nome}” rejected. Your feedback was ${licao === true ? 'saved to guide future work.' : 'recorded.'}`))
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/entregas/5/rejeitar', { feedback: 'Feedback por arquivo sintético' })
})

it.each(['empresa', 'sessão', 'desmontagem'] as const)('[estado confirmado] aprovação tardia após %s não confirma tela antiga', async contexto => {
  const envio = adiado<{ aprovadas: number[] }>(), eventos = observarMudancas()
  vi.mocked(api.post).mockReturnValue(envio.promessa)
  const tela = montarMelhorias()
  fireEvent.click(await screen.findByRole('button', { name: 'Looks good' }))
  await trocarContexto(tela, contexto)
  const leituras = vi.mocked(api.get).mock.calls.length
  await act(async () => envio.resolver({ aprovadas: [5] }))
  expect(toasts.sucesso).not.toHaveBeenCalled(); expect(toasts.falha).not.toHaveBeenCalled()
  expect(eventos).not.toHaveBeenCalled(); expect(api.post).toHaveBeenCalledOnce()
  expect(api.get).toHaveBeenCalledTimes(leituras)
})
