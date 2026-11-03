import { traduzirForaDoProvider as traduzir } from './idiomaBase'
import { notificarSaldoIA, podeAlterarConsumo } from './saldo-eventos'

export const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8100').replace(/\/+$/, '')
export const API_V1 = `${API_BASE}/api/v1`

const ACCESS_KEY = 'offiz_access_token'
const REFRESH_KEY = 'offiz_refresh_token'
const SESSION_KEY = 'offiz_auth_session'
export const AUTH_CREDENTIALS_KEY = 'offiz_auth_credentials'
interface Credenciais { versao: 1; sessao: string | null; access: string | null; refresh: string | null }

// getRandomValues também funciona em instalações HTTP locais; randomUUID
// exige contexto seguro em alguns navegadores. Não é uma credencial.
const novaIdentidadeSessao = () => Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')

export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

function credenciaisValidas(valor: unknown): valor is Credenciais {
  if (!valor || typeof valor !== 'object') return false
  const v = valor as Partial<Credenciais>
  const token = (t: unknown) => t === null || typeof t === 'string' && t.length > 0
  if (v.versao !== 1 || !token(v.access) || !token(v.refresh)) return false
  return v.sessao === null ? v.access === null && v.refresh === null : typeof v.sessao === 'string' && v.sessao.length > 0 && (v.access !== null || v.refresh !== null)
}

function lerCredenciais(): Credenciais | null {
  const bruto = localStorage.getItem(AUTH_CREDENTIALS_KEY)
  if (bruto !== null) {
    try { const valor: unknown = JSON.parse(bruto); return credenciaisValidas(valor) ? valor : null } catch { return null }
  }
  // Migração de uma sessão já aberta. Depois disso os espelhos nunca são
  // autoridade: uma escrita parcial/antiga não pode substituir o conjunto.
  const access = localStorage.getItem(ACCESS_KEY) || null, refresh = localStorage.getItem(REFRESH_KEY) || null
  if (!access && !refresh) return null
  const sessao = localStorage.getItem(SESSION_KEY) || novaIdentidadeSessao()
  const credenciais: Credenciais = { versao: 1, sessao, access, refresh }
  localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify(credenciais))
  localStorage.setItem(SESSION_KEY, sessao)
  return credenciais
}

export function getAccessToken(): string | null { return lerCredenciais()?.access ?? null }
export function getRefreshToken(): string | null { return lerCredenciais()?.refresh ?? null }

function guardarCredenciais(credenciais: Credenciais): void {
  // localStorage não oferece transação entre chaves. Este único commit torna
  // a identidade e os dois tokens visíveis juntos, inclusive em outra aba.
  localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify(credenciais))
  try {
    if (credenciais.access) localStorage.setItem(ACCESS_KEY, credenciais.access); else localStorage.removeItem(ACCESS_KEY)
    if (credenciais.refresh) localStorage.setItem(REFRESH_KEY, credenciais.refresh); else localStorage.removeItem(REFRESH_KEY)
    if (credenciais.sessao) localStorage.setItem(SESSION_KEY, credenciais.sessao); else localStorage.removeItem(SESSION_KEY)
  } catch { /* o leitor antigo pode precisar atualizar; o conjunto confirmado permanece */ }
  window.dispatchEvent(new CustomEvent('offiz:token-changed'))
}

function guardarTokens(access: string, refresh: string, sessao: string): boolean {
  const atual = lerCredenciais()
  if (atual?.sessao !== sessao) return false
  guardarCredenciais({ versao: 1, sessao, access, refresh })
  return true
}

/** Login troca a sessão; renovação troca apenas os tokens da mesma sessão. */
export function setTokens(access: string, refresh: string): void {
  guardarCredenciais({ versao: 1, sessao: novaIdentidadeSessao(), access, refresh })
}

export function clearTokens(): void {
  // O marcador vazio é intencional: espelhos residuais não ressuscitam a conta.
  guardarCredenciais({ versao: 1, sessao: null, access: null, refresh: null })
}

function sessaoAtual(): string | null {
  return lerCredenciais()?.sessao ?? null
}

/** Identificador não secreto, estável durante o login, inclusive após reabrir o app. */
export function getSessionIdentity(): string | null {
  return sessaoAtual()
}

function exigirMesmaSessao(sessao: string | null): void {
  if (sessaoAtual() !== sessao) throw new ApiError(409, traduzir('A sessão mudou. Repita a ação na conta atual.', 'Your session changed. Try again in the current account.'))
}

function notifySessionExpired(): void {
  clearTokens()
  window.dispatchEvent(new CustomEvent('offiz:sessao-expirada'))
}

let refreshInFlight: { sessao: string; promise: Promise<boolean> } | null = null

async function tryRefresh(sessao: string | null): Promise<boolean> {
  const credenciais = lerCredenciais()
  if (!sessao || credenciais?.sessao !== sessao) return false
  if (refreshInFlight?.sessao === sessao) return refreshInFlight.promise
  const refresh = credenciais.refresh
  if (!refresh) return false
  const promise = (async () => {
    try {
      const res = await fetch(`${API_V1}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!res.ok) return false
      const data = await res.json()
      // Um refresh antigo nunca restaura a conta depois de sair/trocar conta.
      if (sessaoAtual() !== sessao) return false
      if (data && data.access_token && data.refresh_token) {
        if (!guardarTokens(data.access_token, data.refresh_token, sessao)) return false
        // O WebSocket derruba a conexão quando o access token expira (o
        // servidor revalida a sessão); quem escuta este aviso reconecta com o
        // token novo — senão a placa ao vivo fica muda até o próximo clique.
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('offiz:token-renovado'))
        return true
      }
      return false
    } catch {
      return false
    }
  })()
  const tentativa = { sessao, promise }
  refreshInFlight = tentativa
  void promise.finally(() => {
    // Outra conta pode estar renovando enquanto a tentativa antiga termina.
    if (refreshInFlight === tentativa) refreshInFlight = null
  })
  return promise
}

async function parseDetail(res: Response): Promise<string> {
  try {
    const data = await res.json()
    if (typeof data?.detail === 'string') return data.detail
    if (Array.isArray(data?.detail) && data.detail.length > 0) {
      const first = data.detail[0]
      if (typeof first?.msg === 'string') return first.msg
    }
  } catch {
    /* corpo não-JSON */
  }
  switch (res.status) {
    case 400: return traduzir('Requisição inválida.', 'Invalid request.')
    case 401: return traduzir('Sessão expirada. Entre novamente.', 'Your session expired. Sign in again.')
    case 403: return traduzir('Você não tem permissão para esta ação.', 'You do not have permission to do this.')
    case 404: return traduzir('Recurso não encontrado.', 'Resource not found.')
    case 409: return traduzir('Conflito: a operação não pode ser concluída agora.', 'Conflict: this action cannot be completed right now.')
    case 412: return traduzir('Pré-condição não atendida.', 'A required condition has not been met.')
    case 413: return traduzir('Arquivo grande demais.', 'The file is too large.')
    default: return traduzir(`Erro do servidor (${res.status}).`, `Server error (${res.status}).`)
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  formData?: FormData
  auth?: boolean
  signal?: AbortSignal
}

/** O fetch termina nos cabeçalhos. O corpo pode chegar depois de trocar de
 * conta, sobretudo em vídeos e relatórios; validar só o fetch não basta. */
function respostaDaSessao(res: Response, sessao: string | null): Response {
  return new Proxy(res, {
    get(target, propriedade) {
      const valor = Reflect.get(target, propriedade, target)
      if (propriedade === 'clone') return () => respostaDaSessao(target.clone(), sessao)
      if (['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text'].includes(String(propriedade)) && typeof valor === 'function') {
        return async (...args: unknown[]) => {
          exigirMesmaSessao(sessao)
          const corpo = await Reflect.apply(valor, target, args)
          exigirMesmaSessao(sessao)
          return corpo
        }
      }
      return typeof valor === 'function' ? valor.bind(target) : valor
    },
  })
}

/** Transporte único para JSON, texto, mídia e formulários. Um refresh por sessão. */
export async function respostaAutenticada(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Caminho de API inválido')
  const sessao = auth ? sessaoAtual() : null
  let tokenDaResposta: string | null = null
  const executar = async () => {
    const credenciais = auth ? lerCredenciais() : null
    if (auth && (credenciais?.sessao ?? null) !== sessao) throw new ApiError(409, traduzir('A sessão mudou. Repita a ação na conta atual.', 'Your session changed. Try again in the current account.'))
    const headers = new Headers(init.headers)
    const token = credenciais?.access ?? null
    if (token) headers.set('Authorization', `Bearer ${token}`)
    else headers.delete('Authorization')
    if (auth) headers.set('X-Offiz-Execucao', window.offizMotor?.chatDeviceId ? 'cli' : 'api')
    try {
      const res = await fetch(`${API_V1}${path}`, { ...init, headers })
      if (auth) exigirMesmaSessao(sessao)
      tokenDaResposta = token
      return res
    } catch (e) {
      if (e instanceof ApiError) throw e
      if (init.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e
      throw new ApiError(0, traduzir('Não foi possível conectar ao servidor. Verifique sua conexão.', 'Could not connect to the server. Check your connection.'))
    }
  }
  const tokenInicial = getAccessToken()
  let res = await executar()
  if (res.status === 401 && auth) {
    // Um pedido paralelo pode já ter renovado desde que este saiu.
    const renovou = (getAccessToken() && getAccessToken() !== tokenInicial) || await tryRefresh(sessao)
    // Outra aba pode concluir a renovação enquanto a nossa tentativa falha.
    // Reconfere o token depois do await antes de encerrar uma sessão válida.
    if (renovou || (getAccessToken() && getAccessToken() !== tokenInicial)) {
      res = await executar()
    }
    if (auth) exigirMesmaSessao(sessao)
    if (res.status === 401) {
      // A resposta do retry também pode chegar depois de outra aba renovar.
      // Só encerra a sessão se a recusa ainda corresponde ao token vigente.
      if (getAccessToken() && getAccessToken() !== tokenDaResposta) {
        throw new ApiError(409, traduzir('A autenticação foi renovada em outra janela. Tente novamente na conta atual.', 'Authentication was renewed in another window. Try again in the current account.'))
      }
      notifySessionExpired()
      throw new ApiError(401, traduzir('Sessão expirada. Entre novamente.', 'Your session expired. Sign in again.'))
    }
  }
  if (!res.ok) {
    const detalhe = await parseDetail(res)
    if (auth) exigirMesmaSessao(sessao)
    throw new ApiError(res.status, detalhe)
  }
  return auth ? respostaDaSessao(res, sessao) : res
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, auth = true, signal } = opts
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (formData) {
    payload = formData
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const sessao = auth ? sessaoAtual() : null
  try {
    const res = await respostaAutenticada(path, { method, headers, body: payload, signal }, auth)
    if (res.status === 204) return undefined as T
    const text = await res.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  } finally {
    // Uma resposta perdida também pode deixar uma reserva no servidor.
    // Consultar o saldo não repete a operação paga.
    if (auth && sessao && sessaoAtual() === sessao && method !== 'GET' && podeAlterarConsumo(path)) notificarSaldoIA()
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  // DELETE aceita corpo: a exclusão de organização exige o slug digitado de
  // volta como confirmação (DELETE /admin/orgs/{id}).
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
  putForm: <T>(path: string, formData: FormData) => request<T>(path, { method: 'PUT', formData }),
  postPublic: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body, auth: false }),
}

/**
 * Carrega uma imagem AUTENTICADA e devolve um object URL para usar em <img>.
 *
 * `<img src="/api/v1/...">` não serve aqui: o navegador não manda o
 * Authorization nessa requisição, e o endpoint responde 401. Quem chamar é
 * responsável por `URL.revokeObjectURL` quando trocar/desmontar — senão cada
 * recarga vaza um blob.
 */
export async function carregarImagem(path: string): Promise<string> {
  // Serve para QUALQUER tipo (vídeo, PDF, HTML) — o nome ficou de quando só
  // havia imagem; ver `carregarArquivo`, o alias com o nome honesto.
  return carregarArquivo(path)
}

/** O mesmo de `carregarImagem`, com o nome que descreve o que ele faz: baixa
 *  autenticado e devolve um object URL para pôr num `<video>`, `<img>` ou
 *  `<iframe>`. Quem chama revoga. */
export async function carregarArquivo(path: string, signal?: AbortSignal): Promise<string> {
  const res = await respostaAutenticada(path, { signal })
  return URL.createObjectURL(await res.blob())
}

/**
 * Normaliza respostas que podem vir como array puro ou paginadas
 * ({items: [...]}, {resultados: [...]}, {jobs: [...]}, etc.).
 */
export function asList<T>(data: unknown, ...keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const k of [...keys, 'items', 'resultados', 'lista', 'data']) {
      if (Array.isArray(obj[k])) return obj[k] as T[]
    }
  }
  return []
}

/** Só o nome oferecido ao salvar: não altera o arquivo nem seu caminho. */
function nomeSeguroParaDownload(nome: string): string {
  let seguro = nome.normalize('NFC').replace(/\\/g, '/').split('/').pop() ?? ''
  seguro = seguro.replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '_').trim().replace(/[ .]+$/, '') || 'arquivo'
  const dispositivo = seguro.split('.', 1)[0].replace(/[ .]+$/, '')
  if (/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])$/i.test(dispositivo)) seguro = `_${seguro}`
  const encoder = new TextEncoder()
  const candidato = seguro.lastIndexOf('.') > 0 ? seguro.match(/\.[^.]+$/)?.[0] ?? '' : ''
  const extensao = encoder.encode(candidato).length <= 32 ? candidato : ''
  const raiz = extensao ? seguro.slice(0, -extensao.length) : seguro
  const limite = 200 - encoder.encode(extensao).length
  let curto = '', bytes = 0
  for (const caractere of raiz) {
    bytes += encoder.encode(caractere).length
    if (bytes > limite) break
    curto += caractere
  }
  return (curto.replace(/[ .]+$/, '') || 'arquivo') + extensao
}

/** RFC 6266: filename* UTF-8 tem precedência; cabeçalho inválido usa fallback. */
function nomeNoCabecalhoDownload(cabecalho: string | null): string | null {
  if (!cabecalho) return null
  const partes: string[] = []
  let inicio = 0, aspas = false, escape = false
  for (let i = 0; i < cabecalho.length; i++) {
    const caractere = cabecalho[i]
    if (escape) escape = false
    else if (aspas && caractere === '\\') escape = true
    else if (caractere === '"') aspas = !aspas
    else if (!aspas && caractere === ';') { partes.push(cabecalho.slice(inicio, i)); inicio = i + 1 }
  }
  if (aspas || escape) return null
  partes.push(cabecalho.slice(inicio))
  const nomes = new Map<string, string>()
  for (const parte of partes.slice(1)) {
    const parametro = parte.match(/^\s*(filename\*?)\s*=\s*(.*?)\s*$/i)
    if (!parametro) continue
    const chave = parametro[1].toLowerCase(), valor = parametro[2]
    if (nomes.has(chave)) return null
    nomes.set(chave, valor)
  }
  const estendido = nomes.get('filename*')?.match(/^utf-8'[^']*'(.+)$/i)
  if (estendido) {
    try { const nome = decodeURIComponent(estendido[1]); if (nome.trim()) return nome } catch { /* usa filename simples */ }
  }
  const simples = nomes.get('filename')
  if (!simples) return null
  const citado = simples.match(/^"((?:[^"\\]|\\.)*)"$/)
  if (citado) return citado[1].replace(/\\(.)/g, '$1') || null
  return /^[^\s";]+$/.test(simples) ? simples : null
}

/** Uma leitura autenticada por intenção. Cancelar ou perder o contexto não
 *  permite entregar bytes antigos ao navegador, mesmo com transporte tardio. */
export async function baixarArquivo(path: string, nomeArquivo: string, opcoes: {
  signal?: AbortSignal
  vigente?: () => boolean
} = {}): Promise<void> {
  const exigirVigencia = () => {
    if (opcoes.signal?.aborted || opcoes.vigente?.() === false) throw new DOMException('Download cancelado.', 'AbortError')
  }
  exigirVigencia()
  const res = await respostaAutenticada(path, { signal: opcoes.signal })
  exigirVigencia()
  const blob = await res.blob()
  exigirVigencia()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  let entregue = false
  try {
    a.href = url
    a.download = nomeSeguroParaDownload(nomeNoCabecalhoDownload(res.headers.get('Content-Disposition')) ?? nomeArquivo)
    document.body.appendChild(a)
    exigirVigencia()
    a.click()
    entregue = true
  } finally {
    a.remove()
    if (entregue) setTimeout(() => URL.revokeObjectURL(url), 10_000)
    else URL.revokeObjectURL(url)
  }
}
