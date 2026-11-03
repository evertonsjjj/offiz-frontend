import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import BibliotecaProjetos from './BibliotecaProjetos'
import { api, setTokens } from '../../lib/api'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))
vi.mock('../MiniaturaArquivo', () => ({ default: ({ caminho, nome }: { caminho: string; nome: string }) => <span aria-hidden="true" data-testid="miniatura-real" data-caminho={caminho} data-nome={nome} /> }))
vi.mock('./AgendaTab', () => ({ AgendaTab: () => null }))
const pedido = (id: number, conversa_id: number | null, titulo = `Pedido ${id}`) => ({ id, conversa_id, conversa_titulo: conversa_id ? 'Camisas e patrocinadores' : null, conversa_office_slug: null as string | null, titulo, office_slug: 'conteudo', projeto_id: null, projeto_nome: null, referencia_job_id: null, favorito: false, aprovado: true, criado_em: '2026-10-12T12:00:00Z', estado: 'aprovado', status: 'done', desatualizados: [], arquivos: [{ id: id * 10, job_id: id, nome: `foto-${id}.png`, mime: 'image/png', tamanho_bytes: 1234, status: 'aprovada', caminho_rel: `outputs/foto-${id}.png`, criado_em: '2026-10-12T12:00:00Z' }] })
type Pedido = Omit<ReturnType<typeof pedido>, 'referencia_job_id'> & { referencia_job_id: number | null }
let itens: Pedido[], total: number
beforeEach(() => {
  vi.clearAllMocks(); setTokens('bancada-conversas-entregas', 'refresh-sintetico')
  itens = [pedido(1, 7), pedido(2, 8), pedido(3, 7), pedido(4, null)]; total = itens.length
  vi.mocked(api.get).mockImplementation(async path => {
    if (path.endsWith('/projetos') || path.endsWith('/padroes')) return []
    const detalhe = /\/biblioteca\/(\d+)$/.exec(path)
    return detalhe ? itens.find(p => p.id === Number(detalhe[1])) : { itens, total }
  })
  vi.mocked(api.put).mockImplementation(async (_path, body) => ({ ok: true, job_id: (body as { job_id: number }).job_id }))
})
function Endereco() { return <output aria-label="Endereço">{useLocation().search}</output> }
const montar = (orgId = 33) => render(<MemoryRouter initialEntries={['/app?org=33&vista=biblioteca&filtro-pedidos=aprovados']}><Endereco /><BibliotecaProjetos orgId={orgId} andares={[{ slug: 'conteudo', nome: 'Conteúdo' }]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
const detalhe = (conversaId: number | null = 118, slug: string | null = 'conteudo') => ({ ...pedido(343, conversaId), conversa_office_slug: slug, arquivos: [] })
const montarDetalhe = (orgId = 33, pedirNaConversa = vi.fn()) => render(<MemoryRouter initialEntries={[`/app?org=${orgId}&vista=biblioteca&trabalho=343&arquivo=1082&conversa=999&area=financeiro&filtro-pedidos=aprovados&projeto=7`]}><Endereco /><BibliotecaProjetos orgId={orgId} andares={[{ slug: 'conteudo', nome: 'Conteúdo' }]} pedirNaConversa={pedirNaConversa} /></MemoryRouter>)

it.each([['conteudo', 'conteudo'], [null, null]])('detalhe retorna à conversa privada autorizada com área %s e sem alvos herdados', async (slug, esperado) => {
  itens = [detalhe(118, slug)]
  montarDetalhe()
  const botao = await screen.findByRole('button', { name: 'Ver conversa deste pedido' })
  fireEvent.click(botao)
  await waitFor(() => expect(screen.getByLabelText('Endereço')).toHaveTextContent('conversa=118'))
  const endereco = new URL(`https://test.invalid/${screen.getByLabelText('Endereço').textContent}`)
  expect(endereco.searchParams.get('org')).toBe('33')
  expect(endereco.searchParams.get('conversa')).toBe('118')
  expect(endereco.searchParams.get('slug')).toBe(esperado)
  expect(endereco.searchParams.get('vista')).toBe('conversa')
  for (const chave of ['trabalho', 'arquivo', 'area', 'filtro-pedidos', 'projeto']) expect(endereco.searchParams.has(chave)).toBe(false)
  expect(api.put).toHaveBeenCalledExactlyOnceWith('/conversas/118/trabalho', { job_id: 343, entrega_id: null, intencao: 'discutir' })
  expect(screen.getByLabelText('Endereço')).not.toHaveTextContent('conversa=999')
  expect(api.post).not.toHaveBeenCalled()
})

it.each([null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('detalhe sem ID privado válido %s não infere conversa pelo executor', async conversaId => {
  itens = [detalhe(conversaId, 'conteudo')]
  montarDetalhe()
  await screen.findByRole('heading', { name: 'Pedido 343' })
  expect(screen.queryByRole('button', { name: 'Ver conversa deste pedido' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it.each([undefined, ''])('detalhe legado sem área confirmada %s não usa o escritório executor como fallback', async slug => {
  itens = [{ ...detalhe(), conversa_office_slug: slug } as Pedido]
  montarDetalhe()
  await screen.findByRole('heading', { name: 'Pedido 343' })
  expect(screen.queryByRole('button', { name: 'Ver conversa deste pedido' })).not.toBeInTheDocument()
})

it('resposta de outro job não atribui sua conversa ao pedido solicitado', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : path.endsWith('/biblioteca/343') ? { ...detalhe(), id: 344 } : { itens: [], total: 0 })
  montarDetalhe()
  await screen.findByRole('heading', { name: 'Pedido 343' })
  expect(screen.queryByRole('button', { name: 'Ver conversa deste pedido' })).not.toBeInTheDocument()
})

it('detalhe atrasado de outra empresa não publica o link privado no contexto novo', async () => {
  let resolver!: (value: unknown) => void, sinal: AbortSignal | undefined
  vi.mocked(api.get).mockImplementation(async (path, signal) => {
    if (path.endsWith('/projetos') || path.endsWith('/padroes')) return []
    if (path === '/orgs/33/biblioteca/343') { sinal = signal; return new Promise(resolve => { resolver = resolve }) }
    if (path === '/orgs/44/biblioteca/343') return detalhe(218, null)
    return { itens: [], total: 0 }
  })
  const tela = montarDetalhe()
  await waitFor(() => expect(resolver).toBeTypeOf('function'))
  tela.rerender(<MemoryRouter initialEntries={['/app?org=44&vista=biblioteca&trabalho=343']}><Endereco /><BibliotecaProjetos orgId={44} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await screen.findByRole('button', { name: 'Ver conversa deste pedido' })
  expect(sinal?.aborted).toBe(true)
  await act(async () => resolver(detalhe(118, 'conteudo')))
  fireEvent.click(screen.getByRole('button', { name: 'Ver conversa deste pedido' }))
  await waitFor(() => expect(screen.getByLabelText('Endereço')).toHaveTextContent('conversa=218'))
  expect(api.put).toHaveBeenCalledExactlyOnceWith('/conversas/218/trabalho', { job_id: 343, entrega_id: null, intencao: 'discutir' })
  expect(screen.getByLabelText('Endereço')).toHaveTextContent('org=44')
  expect(screen.getByLabelText('Endereço')).not.toHaveTextContent('conversa=118')
  expect(api.post).not.toHaveBeenCalled()
})

it('vincula a versão escolhida inteira antes de navegar, sem iniciar outra produção', async () => {
  itens = [{ ...detalhe(), referencia_job_id: 342 } as Pedido]
  let confirmar!: (value: unknown) => void
  vi.mocked(api.put).mockImplementation(() => new Promise(resolve => { confirmar = resolve }))
  montarDetalhe()
  const botao = await screen.findByRole('button', { name: 'Ver conversa deste pedido' })
  fireEvent.click(botao)
  expect(screen.getByLabelText('Endereço')).toHaveTextContent('conversa=999')
  expect(botao).toBeDisabled()
  fireEvent.click(botao)
  expect(api.put).toHaveBeenCalledExactlyOnceWith('/conversas/118/trabalho', { job_id: 343, entrega_id: null, intencao: 'discutir' })
  await act(async () => confirmar({ ok: true, job_id: 343 }))
  expect(screen.getByLabelText('Endereço')).toHaveTextContent('conversa=118')
  expect(api.post).not.toHaveBeenCalled()
})

it.each([undefined, { ok: true, job_id: 342 }, { ok: false, job_id: 343 }])('resposta de vínculo incompleta ou de outra versão não navega (%j)', async resposta => {
  itens = [detalhe()]
  vi.mocked(api.put).mockResolvedValue(resposta)
  montarDetalhe()
  fireEvent.click(await screen.findByRole('button', { name: 'Ver conversa deste pedido' }))
  await screen.findByText('Não consegui confirmar o trabalho desta conversa. Tente novamente.')
  expect(screen.getByLabelText('Endereço')).toHaveTextContent('conversa=999')
  expect(api.post).not.toHaveBeenCalled()
})

it('falha de acesso conserva a versão aberta e não envia pedido novo', async () => {
  itens = [detalhe()]
  vi.mocked(api.put).mockRejectedValue(new Error('Acesso recusado na bancada'))
  montarDetalhe()
  fireEvent.click(await screen.findByRole('button', { name: 'Ver conversa deste pedido' }))
  await screen.findByText('Acesso recusado na bancada')
  expect(screen.getByLabelText('Endereço')).toHaveTextContent('conversa=999')
  expect(api.post).not.toHaveBeenCalled()
})

it('vínculo tardio após trocar de conta não navega para a conversa anterior', async () => {
  itens = [detalhe()]
  let confirmar!: (value: unknown) => void
  vi.mocked(api.put).mockImplementation(() => new Promise(resolve => { confirmar = resolve }))
  montarDetalhe()
  fireEvent.click(await screen.findByRole('button', { name: 'Ver conversa deste pedido' }))
  setTokens('nova-conta-na-bancada', 'outro-refresh')
  await act(async () => confirmar({ ok: true, job_id: 343 }))
  expect(screen.getByLabelText('Endereço')).toHaveTextContent('conversa=999')
  expect(api.post).not.toHaveBeenCalled()
})

it('vínculo confirmado após trocar de empresa não abre o chat antigo', async () => {
  itens = [detalhe()]
  let confirmar!: (value: unknown) => void
  vi.mocked(api.put).mockImplementation(() => new Promise(resolve => { confirmar = resolve }))
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : path === '/orgs/44/biblioteca/343' ? detalhe(218, null) : path.endsWith('/biblioteca/343') ? detalhe() : { itens: [], total: 0 })
  const tela = montarDetalhe()
  fireEvent.click(await screen.findByRole('button', { name: 'Ver conversa deste pedido' }))
  tela.rerender(<MemoryRouter><Endereco /><BibliotecaProjetos orgId={44} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Pedido 343' })
  await act(async () => confirmar({ ok: true, job_id: 343 }))
  expect(screen.getByLabelText('Endereço')).toHaveTextContent('conversa=999')
  expect(screen.getByLabelText('Endereço')).not.toHaveTextContent('conversa=118')
  expect(api.put).toHaveBeenCalledTimes(1)
  expect(api.post).not.toHaveBeenCalled()
})

it('conversa sobre o trabalho inteiro mesmo com um arquivo específico aberto', async () => {
  const pedirNaConversa = vi.fn()
  const base = pedido(343, 118)
  itens = [{ ...base, conversa_office_slug: 'conteudo', arquivos: [{ ...base.arquivos[0], id: 1082 }] } as Pedido]
  montarDetalhe(33, pedirNaConversa)
  fireEvent.click(await screen.findByRole('button', { name: 'Conversar sobre este trabalho' }))
  expect(pedirNaConversa).toHaveBeenCalledExactlyOnceWith('Sobre o trabalho 343, Pedido 343: ', { jobId: 343, intencao: 'discutir' })
  expect(api.post).not.toHaveBeenCalled()
})

it('agrupa pelo ID autorizado, mantém pedidos distintos e exibe legados separados', async () => {
  montar()
  const grupos = await screen.findAllByRole('region', { name: 'Camisas e patrocinadores' })
  expect(grupos).toHaveLength(2)
  expect(within(grupos[0]).getByRole('button', { name: /^Pedido 1/ })).toBeInTheDocument()
  expect(within(grupos[0]).getByRole('button', { name: /^Pedido 3/ })).toBeInTheDocument()
  expect(within(grupos[0]).queryByRole('button', { name: /^Pedido 2/ })).not.toBeInTheDocument()
  const legado = screen.getByRole('region', { name: 'Sem conversa vinculada' })
  expect(within(legado).getByRole('button', { name: /^Pedido 4/ })).toBeInTheDocument()
  expect(within(legado).queryByRole('link', { name: 'Ver conversa' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('miniatura aponta somente ao endpoint compacto da entrega principal e abrir preserva filtros', async () => {
  montar()
  const botao = await screen.findByRole('button', { name: /^foto-1.pngPedido 1|^Pedido 1/ })
  expect(within(botao).getByTestId('miniatura-real')).toHaveAttribute('data-caminho', '/entregas/10/miniatura')
  fireEvent.click(botao)
  expect(screen.getByLabelText('Endereço')).toHaveTextContent('trabalho=1')
  expect(screen.getByLabelText('Endereço')).toHaveTextContent('filtro-pedidos=aprovados')
  expect(vi.mocked(api.get).mock.calls.some(([p]) => p.endsWith('/download'))).toBe(false)
})

it('o link abre a conversa da própria empresa e área em vez de herdar filtros de entregas', async () => {
  itens = [{ ...pedido(5, 19), conversa_office_slug: 'conteudo' } as Pedido]
  montar()
  const link = await screen.findByRole('link', { name: 'Ver conversa' })
  expect(link).toHaveAttribute('href', '/app?org=33&conversa=19&vista=conversa&slug=conteudo')
})

it('Mostrar mais é explícito e reúne a mesma conversa além de24 pedidos sem duplicar a página', async () => {
  const iniciais = Array.from({ length: 24 }, (_, i) => pedido(i + 1, 7)); total = 26
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: Number(new URL(path, 'https://test.invalid').searchParams.get('offset')) ? [pedido(24, 7), pedido(25, 7)] : iniciais, total })
  montar()
  const mais = await screen.findByRole('button', { name: 'Mostrar mais pedidos' })
  expect(vi.mocked(api.get).mock.calls.filter(([p]) => p.includes('/biblioteca?'))).toHaveLength(1)
  fireEvent.click(mais)
  await screen.findByRole('button', { name: /^foto-25.pngPedido 25|^Pedido 25/ })
  expect(screen.getAllByRole('region', { name: 'Camisas e patrocinadores' })).toHaveLength(1)
  expect(screen.getByText('25 pedidos carregados')).toBeInTheDocument()
  expect(screen.getAllByRole('checkbox', { name: /^Selecionar Pedido / })).toHaveLength(25)
  fireEvent.click(screen.getByText('Organizar vários trabalhos'))
  expect(screen.queryByRole('button', { name: 'Selecionar esta página' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar primeiros 24 pedidos' }))
  expect(screen.getAllByRole('checkbox', { name: /^Selecionar Pedido / }).filter(campo => (campo as HTMLInputElement).checked)).toHaveLength(24)
  expect(screen.getByRole('checkbox', { name: 'Selecionar Pedido 25' })).not.toBeChecked()
  expect(api.post).not.toHaveBeenCalled()
})

it('falha ao carregar mais conserva pedidos anteriores e só repete com clique humano', async () => {
  const iniciais = Array.from({ length: 24 }, (_, i) => pedido(i + 1, 7)); total = 26
  vi.mocked(api.get).mockImplementation(async path => {
    if (path.endsWith('/projetos') || path.endsWith('/padroes')) return []
    if (Number(new URL(path, 'https://test.invalid').searchParams.get('offset'))) throw new Error('Falha sintética')
    return { itens: iniciais, total }
  })
  montar(); fireEvent.click(await screen.findByRole('button', { name: 'Mostrar mais pedidos' }))
  await screen.findByRole('alert')
  expect(screen.getAllByRole('checkbox', { name: /^Selecionar Pedido / })).toHaveLength(24)
  expect(vi.mocked(api.get).mock.calls.filter(([p]) => p.includes('/biblioteca?'))).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Tentar carregar mais pedidos' })).toBeEnabled()
})

it('página extra tardia de outra empresa é abortada e não entra na organização atual', async () => {
  let resolver!: (value: unknown) => void, sinal: AbortSignal | undefined
  const iniciais = Array.from({ length: 24 }, (_, i) => pedido(i + 1, 7)); total = 25
  vi.mocked(api.get).mockImplementation(async (path, signal) => {
    if (path.endsWith('/projetos') || path.endsWith('/padroes')) return []
    if (path.startsWith('/orgs/44/')) return { itens: [pedido(101, null)], total: 1 }
    if (Number(new URL(path, 'https://test.invalid').searchParams.get('offset'))) { sinal = signal; return new Promise(resolve => { resolver = resolve }) }
    return { itens: iniciais, total }
  })
  const tela = montar(); fireEvent.click(await screen.findByRole('button', { name: 'Mostrar mais pedidos' }))
  await waitFor(() => expect(resolver).toBeTypeOf('function'))
  tela.rerender(<MemoryRouter><BibliotecaProjetos orgId={44} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await screen.findByRole('button', { name: /^foto-101.pngPedido 101|^Pedido 101/ })
  expect(sinal?.aborted).toBe(true)
  await act(async () => resolver({ itens: [pedido(999, 7, 'Pedido privado antigo')], total: 25 }))
  expect(screen.queryByText('Pedido privado antigo')).not.toBeInTheDocument()
})
