import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, AUTH_CREDENTIALS_KEY, baixarArquivo, carregarArquivo, clearTokens, respostaAutenticada, setTokens, getAccessToken, getRefreshToken, getSessionIdentity } from './api'
import { EVENTO_SALDO_IA_MUDOU, podeAlterarConsumo } from './saldo-eventos'

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); setTokens('velho', 'refresh'); URL.createObjectURL = vi.fn(() => 'blob:imagem') })
it.each(['/conversas/42/mensagens', '/jobs/3/retomar', '/predios/1/conteudo/agenda/4/executar', '/admin/orgs/2/creditos-ia'])('invalida saldo após mutação %s sem duplicar o pedido', async path => {
  const listener = vi.fn(); window.addEventListener(EVENTO_SALDO_IA_MUDOU, listener)
  const fetch = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal('fetch', fetch)
  try { await api.post(path, {}); expect(listener).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1) }
  finally { window.removeEventListener(EVENTO_SALDO_IA_MUDOU, listener) }
})

function snapshotsDeEscrita() {
  const snapshots: { access: string | null; refresh: string | null; sessao: string | null }[] = []
  const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem
  let lendo = false
  const ler = () => {
    if (lendo) return
    lendo = true
    try { snapshots.push({ access: getAccessToken(), refresh: getRefreshToken(), sessao: getSessionIdentity() }) } finally { lendo = false }
  }
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) { set.call(this, key, value); ler() })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function(this: Storage, key) { remove.call(this, key); ler() })
  return snapshots
}

it('publica login e tokens juntos antes de qualquer espelho', () => {
  const idA = getSessionIdentity(), snapshots = snapshotsDeEscrita()
  setTokens('conta-B', 'refresh-B')
  const idB = getSessionIdentity()
  expect(idB).not.toBe(idA)
  expect(snapshots.length).toBeGreaterThan(0)
  for (const snapshot of snapshots) expect(snapshot).toEqual(snapshot.sessao === idA ? { access: 'velho', refresh: 'refresh', sessao: idA } : { access: 'conta-B', refresh: 'refresh-B', sessao: idB })
})

it('saída publica um conjunto vazio antes de limpar espelhos, sem recriar sessão', () => {
  const idA = getSessionIdentity(), snapshots = snapshotsDeEscrita()
  clearTokens()
  expect(snapshots.length).toBeGreaterThan(0)
  for (const snapshot of snapshots) expect(snapshot).toEqual(snapshot.sessao === idA ? { access: 'velho', refresh: 'refresh', sessao: idA } : { access: null, refresh: null, sessao: null })
  expect(getSessionIdentity()).toBeNull()
})

it('refresh publica os dois tokens juntos conservando identidade e namespace de rascunho', async () => {
  const sessao = getSessionIdentity(), snapshots = snapshotsDeEscrita()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/auth/refresh')) return Response.json({ access_token: 'renovado', refresh_token: 'refresh-renovado' })
    return new Headers(init.headers).get('Authorization') === 'Bearer velho' ? new Response('', { status: 401 }) : Response.json({ ok: true })
  }))
  expect(await api.get('/me')).toEqual({ ok: true })
  expect(snapshots.length).toBeGreaterThan(0)
  for (const snapshot of snapshots) expect(snapshot).toEqual(snapshot.access === 'velho' ? { access: 'velho', refresh: 'refresh', sessao } : { access: 'renovado', refresh: 'refresh-renovado', sessao })
  expect(getSessionIdentity()).toBe(sessao)
})

it.each(['com-marcador', 'sem-marcador', 'somente-access', 'somente-refresh'])('migra sessão legada %s sem misturar ou apagar as credenciais existentes', modo => {
  localStorage.clear()
  if (modo !== 'somente-refresh') localStorage.setItem('offiz_access_token', 'access-legado')
  if (modo !== 'somente-access') localStorage.setItem('offiz_refresh_token', 'refresh-legado')
  if (modo !== 'sem-marcador') localStorage.setItem('offiz_auth_session', 'marcador-legado')
  const sessao = getSessionIdentity()
  expect(sessao).toBeTruthy()
  if (modo !== 'sem-marcador') expect(sessao).toBe('marcador-legado')
  expect(getAccessToken()).toBe(modo === 'somente-refresh' ? null : 'access-legado')
  expect(getRefreshToken()).toBe(modo === 'somente-access' ? null : 'refresh-legado')
  expect(JSON.parse(localStorage.getItem(AUTH_CREDENTIALS_KEY)!)).toMatchObject({ versao: 1, sessao })
  expect(getSessionIdentity()).toBe(sessao)
})

it.each(['{', 'null', '{"versao":2}', '{"versao":1,"sessao":null,"access":"residual","refresh":null}', '{"versao":1,"sessao":"a","access":"","refresh":null}', '{"versao":1,"sessao":"a","access":"token","refresh":5}', '{"versao":1,"sessao":null,"access":null,"refresh":null}'])('conjunto inválido ou vazio não ressuscita os espelhos anteriores: %s', bruto => {
  localStorage.setItem(AUTH_CREDENTIALS_KEY, bruto)
  expect(getAccessToken()).toBeNull()
  expect(getRefreshToken()).toBeNull()
  expect(getSessionIdentity()).toBeNull()
  expect(localStorage.getItem(AUTH_CREDENTIALS_KEY)).toBe(bruto)
})

it('espelhos alterados por código antigo não substituem o conjunto confirmado', () => {
  const sessao = getSessionIdentity()
  localStorage.setItem('offiz_access_token', 'espelho-alheio')
  localStorage.setItem('offiz_refresh_token', 'refresh-alheio')
  localStorage.setItem('offiz_auth_session', 'marcador-alheio')
  expect(getAccessToken()).toBe('velho')
  expect(getRefreshToken()).toBe('refresh')
  expect(getSessionIdentity()).toBe(sessao)
})
it('consulta saldo após resposta de mutação perdida sem repetir execução', async () => {
  const listener = vi.fn(); window.addEventListener(EVENTO_SALDO_IA_MUDOU, listener)
  const fetch = vi.fn(async () => { throw new Error('offline') }); vi.stubGlobal('fetch', fetch)
  try { await expect(api.post('/jobs', {})).rejects.toMatchObject({ status: 0 }); expect(listener).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1) }
  finally { window.removeEventListener(EVENTO_SALDO_IA_MUDOU, listener) }
})
it('leituras e pedidos públicos não invalidam saldo nem criam ciclo de consultas', async () => {
  const listener = vi.fn(); window.addEventListener(EVENTO_SALDO_IA_MUDOU, listener)
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })))
  try { await api.get('/jobs'); await api.get('/orgs/1/saldo'); await api.postPublic('/jobs'); expect(listener).not.toHaveBeenCalled() }
  finally { window.removeEventListener(EVENTO_SALDO_IA_MUDOU, listener) }
  expect(podeAlterarConsumo('/orgs/1/saldo')).toBe(false)
})
it('mutação da sessão anterior não atualiza o saldo da conta nova', async () => {
  const listener = vi.fn(); window.addEventListener(EVENTO_SALDO_IA_MUDOU, listener)
  let resolver!: (r: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolver = resolve })))
  try { const req = api.post('/jobs'); setTokens('outro', 'outro-r'); resolver(Response.json({ ok: true })); await expect(req).rejects.toMatchObject({ status: 409 }); expect(listener).not.toHaveBeenCalled() }
  finally { window.removeEventListener(EVENTO_SALDO_IA_MUDOU, listener) }
})
describe('transporte autenticado', () => {
  it('identifica pedidos locais e web sem alterar a autenticação', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    await api.get('/exemplo')
    expect(new Headers((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('X-Offiz-Execucao')).toBe('api')
    Object.defineProperty(window, 'offizMotor', { value: { chatDeviceId: 'dispositivo-teste' }, configurable: true })
    try {
      await api.post('/exemplo', {})
      const headers = new Headers((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].headers)
      expect(headers.get('X-Offiz-Execucao')).toBe('cli')
      expect(headers.get('Authorization')).toBe('Bearer velho')
    } finally { Object.defineProperty(window, 'offizMotor', { value: undefined, configurable: true }) }
  })
  it('renova uma única vez em leituras simultâneas de JSON e imagem', async () => {
    let renovacoes = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        renovacoes++; await new Promise(resolve => setTimeout(resolve, 5))
        return Response.json({ access_token: 'novo', refresh_token: 'refresh-novo' })
      }
      const h = new Headers(init.headers)
      if (h.get('Authorization') === 'Bearer velho') return new Response('', { status: 401 })
      return url.endsWith('/imagem') ? new Response('image', { headers: { 'Content-Type': 'image/png' } }) : Response.json({ ok: true })
    }))
    const [dado, imagem] = await Promise.all([api.get('/me'), carregarArquivo('/imagem')])
    expect(renovacoes).toBe(1); expect(dado).toEqual({ ok: true }); expect(imagem).toBe('blob:imagem')
  })
  it('interrompe após um retry e encerra a sessão recusada', async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/auth/refresh') ? Response.json({ access_token: 'novo', refresh_token: 'novo-r' }) : new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    await expect(respostaAutenticada('/video')).rejects.toMatchObject({ status: 401 })
    expect(fetch).toHaveBeenCalledTimes(3); expect(getAccessToken()).toBeNull()
  })
  it('mantém multipart e AbortSignal no retry', async () => {
    const form = new FormData(); form.set('nome', 'arte')
    const abort = new AbortController(); const envios: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return Response.json({ access_token: 'novo', refresh_token: 'r' })
      envios.push(init)
      return new Response('', { status: envios.length === 1 ? 401 : 200 })
    }))
    await respostaAutenticada('/upload', { method: 'PUT', body: form, signal: abort.signal })
    expect(envios.every(e => e.body === form && e.signal === abort.signal)).toBe(true)
    expect(new Headers(envios[1].headers).has('Content-Type')).toBe(false)
  })
  it('não anexa credenciais a destinos externos', async () => {
    await expect(respostaAutenticada('//evil.example')).rejects.toThrow('Caminho de API inválido')
  })

  it.each(['json', 'arquivo'] as const)('descarta %s quando a conta muda enquanto o corpo chega', async tipo => {
    let concluir!: (valor: string | Blob) => void
    let iniciou!: () => void
    const corpoIniciou = new Promise<void>(resolve => { iniciou = resolve })
    const resposta = new Response('')
    Object.defineProperty(resposta, tipo === 'json' ? 'text' : 'blob', { configurable: true, value: () => {
      iniciou()
      return new Promise(resolve => { concluir = resolve })
    } })
    vi.stubGlobal('fetch', vi.fn(async () => resposta))
    const pedido = tipo === 'json' ? api.get('/dados') : carregarArquivo('/arquivo')
    await corpoIniciou
    setTokens('outra-conta', 'outro-refresh')
    const recusado = expect(pedido).rejects.toMatchObject({ status: 409 })
    concluir(tipo === 'json' ? '{"cliente":"anterior"}' : new Blob(['privado']))
    await recusado
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('uma cópia da resposta conserva o vínculo com a sessão', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ privado: true })))
    const res = await respostaAutenticada('/dados')
    const copia = res.clone()
    expect(res.headers.get('Content-Type')).toContain('application/json')
    setTokens('outra-conta', 'outro-refresh')
    await expect(copia.json()).rejects.toMatchObject({ status: 409 })
  })
})

describe('download autenticado vinculado ao visor', () => {
  let cliques: Array<{ nome: string; url: string }>

  function adiado<T>() {
    let resolver!: (valor: T) => void
    const promessa = new Promise<T>(resolve => { resolver = resolve })
    return { promessa, resolver }
  }

  function respostaComCorpoAdiado() {
    const inicio = adiado<void>(), corpo = adiado<Blob>()
    const resposta = new Response('', { headers: { 'Content-Disposition': 'attachment; filename="arquivo-atual.docx"' } })
    // O corpo sintético ignora abort de propósito: o gate precisa impedir
    // o efeito final mesmo quando um transporte não coopera com cancelamento.
    Object.defineProperty(resposta, 'blob', { configurable: true, value: () => { inicio.resolver(); return corpo.promessa } })
    return { resposta, inicio, corpo }
  }

  function esperarSemDownload() {
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(cliques).toEqual([])
    expect(document.querySelector('a[download]')).toBeNull()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    cliques = []
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      cliques.push({ nome: this.download, url: this.href })
    })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Rede real proibida neste teste sintético') }))
  })

  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it.each(['abortado', 'fora de vigência'] as const)('recusa download inicialmente %s antes de qualquer GET', async motivo => {
    const controller = new AbortController()
    if (motivo === 'abortado') controller.abort()
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Bytes sintéticos'))
    await expect(baixarArquivo('/entregas/801/download', 'arte.png', {
      signal: controller.signal,
      vigente: () => motivo !== 'fora de vigência',
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    esperarSemDownload()
  })

  it('propaga signal e salva o nome efetivo do servidor com um GET e um clique', async () => {
    const controller = new AbortController(), vigente = vi.fn(() => true)
    const nome = 'Pré-produção 🎬.docx'
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Word sintético', { headers: {
      'Content-Disposition': `attachment; filename="pre-producao.docx"; filename*=utf-8''${encodeURIComponent(nome)}`,
    } }))
    await baixarArquivo('/entregas/802/download', 'pre-producao.md', { signal: controller.signal, vigente })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toMatch(/\/api\/v1\/entregas\/802\/download$/)
    expect(init?.signal).toBe(controller.signal)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer velho')
    expect(vigente).toHaveBeenCalled()
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(cliques).toEqual([{ nome, url: 'blob:imagem' }])
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(10_000)
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:imagem')
  })

  it('fechar ou trocar contexto enquanto o corpo chega impede URL e clique', async () => {
    const { resposta, inicio, corpo } = respostaComCorpoAdiado()
    let vigente = true
    vi.mocked(fetch).mockResolvedValueOnce(resposta)
    const pedido = baixarArquivo('/entregas/803/download', 'anterior.md', { vigente: () => vigente })
    await inicio.promessa
    vigente = false
    const recusado = expect(pedido).rejects.toMatchObject({ name: 'AbortError' })
    corpo.resolver(new Blob(['Arquivo do visor fechado']))
    await recusado
    expect(fetch).toHaveBeenCalledTimes(1)
    esperarSemDownload()
  })

  it('abortar durante um corpo não cooperativo impede URL e clique', async () => {
    const { resposta, inicio, corpo } = respostaComCorpoAdiado()
    const controller = new AbortController()
    vi.mocked(fetch).mockResolvedValueOnce(resposta)
    const pedido = baixarArquivo('/entregas/804/download', 'arte.png', { signal: controller.signal, vigente: () => true })
    await inicio.promessa
    controller.abort()
    const recusado = expect(pedido).rejects.toMatchObject({ name: 'AbortError' })
    corpo.resolver(new Blob(['Bytes tardios após abort']))
    await recusado
    expect(fetch).toHaveBeenCalledTimes(1)
    esperarSemDownload()
  })

  it('descarta resposta tardia do GET quando a abertura deixa de ser vigente', async () => {
    const cabecalhos = adiado<Response>()
    let vigente = true
    vi.mocked(fetch).mockReturnValueOnce(cabecalhos.promessa)
    const pedido = baixarArquivo('/entregas/805/download', 'arte.png', { vigente: () => vigente })
    vigente = false
    const recusado = expect(pedido).rejects.toMatchObject({ name: 'AbortError' })
    cabecalhos.resolver(new Response('Bytes do contexto anterior'))
    await recusado
    expect(fetch).toHaveBeenCalledTimes(1)
    esperarSemDownload()
  })

  it('logout enquanto o GET está pendente não inicia download na sessão vazia', async () => {
    const cabecalhos = adiado<Response>()
    vi.mocked(fetch).mockReturnValueOnce(cabecalhos.promessa)
    const pedido = baixarArquivo('/entregas/806/download', 'arte.png', { vigente: () => true })
    clearTokens()
    const recusado = expect(pedido).rejects.toMatchObject({ status: 409 })
    cabecalhos.resolver(new Response('Privado da sessão encerrada'))
    await recusado
    expect(fetch).toHaveBeenCalledTimes(1)
    esperarSemDownload()
  })

  it.each(['logout', 'outra conta'] as const)('%s durante o corpo continua protegido mesmo com vigente verdadeiro', async destino => {
    const { resposta, inicio, corpo } = respostaComCorpoAdiado()
    vi.mocked(fetch).mockResolvedValueOnce(resposta)
    const pedido = baixarArquivo('/entregas/807/download', 'arte.png', { vigente: () => true })
    await inicio.promessa
    if (destino === 'logout') clearTokens(); else setTokens('outra-conta', 'outro-refresh')
    const recusado = expect(pedido).rejects.toMatchObject({ status: 409 })
    corpo.resolver(new Blob(['Privado da sessão anterior']))
    await recusado
    expect(fetch).toHaveBeenCalledTimes(1)
    esperarSemDownload()
  })

  it('renovar tokens na mesma sessão durante o corpo conserva a ação vigente', async () => {
    const { resposta, inicio, corpo } = respostaComCorpoAdiado()
    const sessao = getSessionIdentity(), controller = new AbortController()
    vi.mocked(fetch).mockResolvedValueOnce(resposta)
    const pedido = baixarArquivo('/entregas/808/download', 'anterior.md', { signal: controller.signal, vigente: () => true })
    await inicio.promessa
    localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ versao: 1, sessao, access: 'renovado', refresh: 'refresh-renovado' }))
    corpo.resolver(new Blob(['Word autorizado na mesma sessão']))
    await pedido
    expect(getSessionIdentity()).toBe(sessao)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(cliques).toEqual([{ nome: 'arquivo-atual.docx', url: 'blob:imagem' }])
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })
})
