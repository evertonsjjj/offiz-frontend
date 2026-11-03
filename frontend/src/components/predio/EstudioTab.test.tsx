import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AUTH_CREDENTIALS_KEY, api, ApiError, clearTokens, getSessionIdentity, setTokens } from '../../lib/api'
import EstudioTab from './EstudioTab'

const eventos = vi.hoisted(() => ({ ouvintes: new Set<() => void>() }))
const idioma = vi.hoisted(() => ({ valor: 'pt-BR' as 'pt-BR' | 'en', pt: (pt: string) => pt, en: (_pt: string, en: string) => en }))
vi.mock('../../lib/i18n', () => ({ useIdioma: () => ({ idioma: idioma.valor, t: idioma.valor === 'en' ? idioma.en : idioma.pt }) }))
vi.mock('../../lib/api', async original => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), postForm: vi.fn() },
}))
vi.mock('../../lib/ws', () => ({ wsClient: { on: (_nome: string, ouvinte: () => void) => { eventos.ouvintes.add(ouvinte); return () => eventos.ouvintes.delete(ouvinte) } } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn() }) }))
vi.mock('./ComoFoiFeita', () => ({ default: () => null }))
vi.mock('./EditorPeca', () => ({ default: () => null }))
vi.mock('./QuadroFluxo', () => ({ default: ({ jobId }: { jobId: number }) => <p>Quadro do trabalho {jobId}</p> }))
vi.mock('./PlanoDaPeca', () => ({ default: () => null }))

function adiado<T>() {
  let resolver!: (valor: T) => void, rejeitar!: (erro: Error) => void
  const promessa = new Promise<T>((resolve, reject) => { resolver = resolve; rejeitar = reject })
  return { promessa, resolver, rejeitar }
}
const props = { orgId: 3, slug: 'conteudo', aoPerguntar: vi.fn() }
const peca = (titulo = 'Peça atual', slug = 'peca-atual') => ({ slug, titulo, estado: 'rascunho', cenas: 1, duracao_s: 3, gasto_usd: 0, teto_usd: 0 })
const entrega = (job = 61, titulo = 'Trabalho atual') => ({ id: job + 100, job_id: job, job_titulo: titulo, nome: 'arte.png', criado_em: '2026-10-10T08:00:00Z', status: 'pendente', caminho_rel: 'outputs/arte.png', tipo: 'arquivo' })
const atualizar = () => act(async () => { for (const ouvir of eventos.ouvintes) ouvir() })

beforeEach(() => {
  vi.resetAllMocks(); eventos.ouvintes.clear(); localStorage.clear(); sessionStorage.clear(); idioma.valor = 'pt-BR'
  setTokens('fixture-access', 'fixture-refresh')
  vi.stubGlobal('crypto', webcrypto)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/estudio/pecas') ? { pecas: [peca()] } : url.endsWith('/entregas') ? [entrega()] : { peca: { titulo: 'Peça atual', cenas: [] } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

it('falha inicial dos trabalhos aparece como consulta falha e permite tentar a leitura sem produzir', async () => {
  vi.mocked(api.get).mockImplementation(async url => {
    if (url.endsWith('/estudio/pecas')) return { pecas: [] }
    throw new Error('Falha sintética da lista')
  })
  render(<EstudioTab {...props} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui carregar os trabalhos')
  const campo = screen.getByRole('textbox')
  fireEvent.change(campo, { target: { value: 'Preciso de um post para amanhã' } })
  vi.mocked(api.get).mockResolvedValue([entrega()])
  fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar os trabalhos' }))
  expect(await screen.findByText('Trabalho atual')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(campo).toHaveValue('Preciso de um post para amanhã')
  expect(api.post).not.toHaveBeenCalled(); expect(props.aoPerguntar).not.toHaveBeenCalled()
})

it('falha ao atualizar não apaga as peças e trabalhos já conferidos', async () => {
  render(<EstudioTab {...props} />)
  await screen.findByText('Peça atual'); await screen.findByText('Trabalho atual')
  vi.mocked(api.get).mockRejectedValue(new Error('Atualização indisponível'))
  await atualizar()
  expect(await screen.findAllByRole('alert')).toHaveLength(2)
  expect(screen.getByText('Peça atual')).toBeInTheDocument()
  expect(screen.getByText('Trabalho atual')).toBeInTheDocument()
  expect(screen.getAllByText(/A última lista carregada continua abaixo/)).toHaveLength(2)
  expect(api.post).not.toHaveBeenCalled()
})

it('retomar a lista de peças remove somente seu erro e não esconde a falha dos trabalhos', async () => {
  vi.mocked(api.get).mockRejectedValue(new Error('Consulta indisponível'))
  render(<EstudioTab {...props} />)
  expect(await screen.findAllByRole('alert')).toHaveLength(2)
  vi.mocked(api.get).mockResolvedValue({ pecas: [peca()] })
  fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar as peças' }))
  await screen.findByText('Peça atual')
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(screen.getByRole('alert')).toHaveTextContent('Não consegui carregar os trabalhos')
})

it('atividade do escritório recarrega também os trabalhos, sem mandar outro pedido', async () => {
  render(<EstudioTab {...props} />)
  await screen.findByText('Trabalho atual')
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/estudio/pecas') ? { pecas: [peca()] } : [entrega(72, 'Trabalho recém-entregue')])
  await atualizar()
  await screen.findByText('Trabalho recém-entregue')
  expect(screen.queryByText('Trabalho atual')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['peças', 'trabalhos'] as const)('resposta antiga de %s não substitui a atualização confirmada', async lista => {
  render(<EstudioTab {...props} />)
  await screen.findByText('Trabalho atual')
  const antiga = adiado<object>()
  let chamada = 0
  const alvo = lista === 'peças' ? '/estudio/pecas' : '/entregas'
  vi.mocked(api.get).mockImplementation(async url => {
    if (url.endsWith(alvo) && ++chamada === 1) return antiga.promessa
    return url.endsWith('/estudio/pecas') ? { pecas: [peca('Peça nova')] } : [entrega(72, 'Trabalho novo')]
  })
  await atualizar(); await atualizar()
  await screen.findByText(lista === 'peças' ? 'Peça nova' : 'Trabalho novo')
  await act(async () => antiga.resolver(lista === 'peças' ? { pecas: [peca('Peça antiga')] } : [entrega(73, 'Trabalho antigo')]))
  expect(screen.getByText(lista === 'peças' ? 'Peça nova' : 'Trabalho novo')).toBeInTheDocument()
  expect(screen.queryByText(lista === 'peças' ? 'Peça antiga' : 'Trabalho antigo')).not.toBeInTheDocument()
})

it.each(['empresa', 'área', 'sessão'] as const)('trocar %s descarta as duas consultas anteriores sem mudar o conteúdo novo', async contexto => {
  const antigas = [adiado<object>(), adiado<object>()]
  vi.mocked(api.get).mockImplementationOnce(() => antigas[0].promessa).mockImplementationOnce(() => antigas[1].promessa)
  const tela = render(<EstudioTab {...props} />)
  const sinais = vi.mocked(api.get).mock.calls.slice(0, 2).map(c => c[1])
  if (contexto === 'sessão') setTokens('other-fixture-access', 'other-fixture-refresh')
  tela.rerender(<EstudioTab {...props} orgId={contexto === 'empresa' ? 8 : 3} slug={contexto === 'área' ? 'financas' : 'conteudo'} />)
  await screen.findByText('Trabalho atual'); await screen.findByText('Peça atual')
  await act(async () => { antigas[0].resolver({ pecas: [peca('Peça da sessão anterior')] }); antigas[1].resolver([entrega(73, 'Trabalho da sessão anterior')]) })
  expect(screen.queryByText(/da sessão anterior/)).not.toBeInTheDocument()
  expect(screen.getByText('Trabalho atual')).toBeInTheDocument()
  expect(sinais.every(s => s?.aborted)).toBe(true)
})

it('sair sem outro render descarta a leitura pendente', async () => {
  const antiga = adiado<object>()
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/estudio/pecas') ? antiga.promessa : [])
  render(<EstudioTab {...props} />)
  clearTokens()
  await act(async () => antiga.resolver({ pecas: [peca('Material de conta encerrada')] }))
  expect(screen.queryByText('Material de conta encerrada')).not.toBeInTheDocument()
})

it('renovar os tokens na mesma sessão mantém a consulta autorizada e o pedido escrito', async () => {
  const atual = adiado<object>()
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/estudio/pecas') ? atual.promessa : [])
  const tela = render(<EstudioTab {...props} />)
  const campo = screen.getByRole('textbox')
  fireEvent.change(campo, { target: { value: 'Meu pedido ainda não foi enviado' } })
  const sessao = getSessionIdentity()
  localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ versao: 1, sessao, access: 'renovado-fixture', refresh: 'renovado-refresh' }))
  tela.rerender(<EstudioTab {...props} />)
  await act(async () => atual.resolver({ pecas: [peca()] }))
  expect(screen.getByText('Peça atual')).toBeInTheDocument()
  expect(campo).toHaveValue('Meu pedido ainda não foi enviado')
  expect(api.post).not.toHaveBeenCalled()
})

it('desmontar cancela as duas leituras e remove o acompanhamento ao vivo', async () => {
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}))
  const tela = render(<EstudioTab {...props} />)
  const sinais = vi.mocked(api.get).mock.calls.slice(0, 2).map(c => c[1])
  tela.unmount()
  expect(sinais.every(s => s?.aborted)).toBe(true)
  expect(eventos.ouvintes.size).toBe(0)
})

it('a orientação de consulta falha aparece em inglês quando essa é a língua escolhida', async () => {
  idioma.valor = 'en'
  vi.mocked(api.get).mockRejectedValue(new Error('Falha sintética'))
  render(<EstudioTab {...props} />)
  expect(await screen.findByRole('button', { name: 'Try loading tasks again' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try loading productions again' })).toBeInTheDocument()
  expect(screen.queryByText('Nenhuma peça ainda.')).not.toBeInTheDocument()
})

function fonteProducao() {
  vi.mocked(api.get).mockImplementation(async url => url === '/auth/me' ? { id: 7 } : url.endsWith('/estudio/pecas') ? { pecas: [] } : [])
}
async function montarDireta() {
  fonteProducao()
  const tela = render(<EstudioTab orgId={3} slug="conteudo" />)
  const campo = screen.getByRole('textbox', { name: 'Descreva a produção' })
  await waitFor(() => expect(campo).toBeEnabled())
  return { ...tela, campo }
}
const pedidoId = () => { const calls = vi.mocked(api.post).mock.calls; return (calls[calls.length - 1][1] as { request_id: string }).request_id }
const confirmadoDireto = (id = 81) => ({ id, request_id: pedidoId(), office_slug: 'conteudo', replayed: false })

it('fallback do Estúdio envia UUID e só abre o quadro após confirmação completa', async () => {
  const resposta = adiado<unknown>()
  vi.mocked(api.post).mockReturnValue(resposta.promessa)
  const { campo } = await montarDireta()
  fireEvent.change(campo, { target: { value: '  Preciso de um post amanhã  ' } })
  fireEvent.submit(campo.closest('form')!); fireEvent.submit(campo.closest('form')!)
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce())
  expect(api.post).toHaveBeenCalledWith('/predios/3/conteudo/jobs', { prompt: 'Preciso de um post amanhã', request_id: expect.any(String) })
  expect(screen.queryByText('Quadro do trabalho 81')).not.toBeInTheDocument()
  await act(async () => resposta.resolver(confirmadoDireto()))
  expect(await screen.findByText('Quadro do trabalho 81')).toBeInTheDocument()
})

it('ID sem recibo no fallback fica incerto e não inventa confirmação da produção', async () => {
  vi.mocked(api.post).mockResolvedValue({ id: 81 })
  const { campo } = await montarDireta()
  fireEvent.change(campo, { target: { value: 'Pedido A' } }); fireEvent.submit(campo.closest('form')!)
  await screen.findByRole('button', { name: 'Conferir envio' })
  expect(screen.queryByText('Quadro do trabalho 81')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledOnce()
})

it('fallback reabre após ACK perdido sem POST automático e recupera a intenção por GET', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('ACK perdido'))
  const primeira = await montarDireta()
  fireEvent.change(primeira.campo, { target: { value: 'Post de amanhã' } }); fireEvent.submit(primeira.campo.closest('form')!)
  await screen.findByRole('button', { name: 'Conferir envio' }); const id = pedidoId()
  primeira.unmount()
  const get = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async url => url.endsWith(`/por-intencao/${id}`) ? { id: 82, request_id: id, office_slug: 'conteudo', replayed: true } : get(url))
  render(<EstudioTab orgId={3} slug="conteudo" />)
  const conferir = await screen.findByRole('button', { name: 'Conferir envio' })
  expect(api.post).toHaveBeenCalledOnce()
  expect(vi.mocked(api.get).mock.calls.some(([u]) => u.includes('/por-intencao/'))).toBe(false)
  fireEvent.click(conferir)
  expect(await screen.findByText('Quadro do trabalho 82')).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledWith(`/predios/3/conteudo/jobs/por-intencao/${id}`)
  expect(api.post).toHaveBeenCalledOnce()
})

it('fallback depois de 404 não usa UUID anterior para texto diferente; preparar outro mantém o recibo antigo', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('ACK perdido'))
  const tela = await montarDireta()
  fireEvent.change(tela.campo, { target: { value: 'Pedido A' } }); fireEvent.submit(tela.campo.closest('form')!)
  await screen.findByRole('button', { name: 'Conferir envio' })
  const get = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async url => { if (url.includes('/por-intencao/')) throw new ApiError(404, 'Não encontrado'); return get(url) })
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir envio' }))
  await waitFor(() => expect(tela.campo).toBeEnabled())
  const antigo = pedidoId()
  fireEvent.change(tela.campo, { target: { value: 'Pedido B' } }); fireEvent.submit(tela.campo.closest('form')!)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('outro pedido'))
  expect(api.post).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Preparar outro pedido' })); fireEvent.submit(tela.campo.closest('form')!)
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
  expect(pedidoId()).not.toBe(antigo)
  const raws = Object.keys(localStorage).filter(k => k.startsWith('offiz:producao:')).map(k => localStorage.getItem(k))
  expect(raws).toHaveLength(2); expect(raws.join('')).not.toContain('Pedido A'); expect(raws.join('')).not.toContain('Pedido B')
})

it.each(['empresa', 'sessão', 'desmontagem'] as const)('ACK antigo do fallback após %s não abre quadro na tela atual nem apaga seu recibo', async contexto => {
  const resposta = adiado<unknown>()
  vi.mocked(api.post).mockReturnValue(resposta.promessa)
  const tela = await montarDireta()
  fireEvent.change(tela.campo, { target: { value: 'Pedido A' } }); fireEvent.submit(tela.campo.closest('form')!)
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce())
  const receipt = confirmadoDireto()
  if (contexto === 'sessão') setTokens('nova-sessao-estudio', 'novo-refresh')
  if (contexto === 'desmontagem') tela.unmount()
  else tela.rerender(<EstudioTab orgId={contexto === 'empresa' ? 8 : 3} slug="conteudo" />)
  await act(async () => resposta.resolver(receipt))
  expect(screen.queryByText('Quadro do trabalho 81')).not.toBeInTheDocument()
  expect(Object.keys(localStorage).filter(k => k.startsWith('offiz:producao:'))).toHaveLength(1)
})

it('fallback sem WebCrypto orienta HTTPS e não envia; Estúdio embutido continua delegando sem nova consulta de conta', async () => {
  const tela = await montarDireta()
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
  fireEvent.change(tela.campo, { target: { value: 'Pedido A' } }); fireEvent.submit(tela.campo.closest('form')!)
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTPS'); expect(api.post).not.toHaveBeenCalled()
  tela.unmount(); vi.mocked(api.get).mockClear()
  render(<EstudioTab {...props} />)
  const campo = screen.getByRole('textbox')
  fireEvent.change(campo, { target: { value: 'Faça um post' } }); fireEvent.submit(campo.closest('form')!)
  expect(props.aoPerguntar).toHaveBeenCalledExactlyOnceWith('Faça um post')
  expect(vi.mocked(api.get).mock.calls.some(([u]) => u === '/auth/me')).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})
