import { ApiError, getSessionIdentity } from './api'
import { traduzirForaDoProvider as traduzir } from './idiomaBase'

/** Lê somente até o teto da prévia; o download original usa outro transporte.
 * A identidade vem de antes do HTTP, porque getReader não passa pelos métodos
 * blob/text protegidos de respostaAutenticada. Renovar tokens conserva a sessão. */
export async function lerTextoLimitado(res: Response, teto: number, signal: AbortSignal, sessao: string | null): Promise<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let cancelamento: Promise<void> | null = null
  let concluido = false
  const cancelar = () => {
    if (!cancelamento) cancelamento = Promise.resolve().then(() => reader ? reader.cancel() : res.body?.cancel()).then(() => {}, () => {})
    return cancelamento
  }
  const verificar = () => {
    if (signal.aborted) throw new DOMException('Leitura cancelada', 'AbortError')
    if (!sessao || getSessionIdentity() !== sessao) throw new ApiError(409, traduzir('A sessão mudou. Repita a ação na conta atual.', 'Your session changed. Try again in the current account.'))
  }
  const mudouSessao = () => { if (!sessao || getSessionIdentity() !== sessao) void cancelar() }
  const abortar = () => { void cancelar() }
  signal.addEventListener('abort', abortar, { once: true })
  window.addEventListener('storage', mudouSessao)
  window.addEventListener('offiz:token-changed', mudouSessao)
  try {
    verificar()
    if (!Number.isSafeInteger(teto) || teto < 0 || res.bodyUsed || !res.body) throw new Error('Corpo indisponível para a prévia')
    const length = res.headers.get('Content-Length')?.trim()
    if (length) {
      const valores = length.split(',').map(v => v.trim())
      if (valores.some(v => /^-\d+$/.test(v)) || (valores.length > 1 && new Set(valores).size > 1)) throw new Error('Tamanho de resposta inconsistente')
      if (/^\d+$/.test(valores[0]) && Number(valores[0]) > teto) throw new Error('Prévia acima do limite')
    }
    reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let total = 0, texto = ''
    while (true) {
      verificar()
      const parte = await reader.read()
      verificar()
      if (parte.done) break
      total += parte.value.byteLength
      if (total > teto) throw new Error('Prévia acima do limite')
      texto += decoder.decode(parte.value, { stream: true })
    }
    texto += decoder.decode()
    verificar()
    concluido = true
    return texto
  } finally {
    signal.removeEventListener('abort', abortar)
    window.removeEventListener('storage', mudouSessao)
    window.removeEventListener('offiz:token-changed', mudouSessao)
    if (!concluido) await cancelar()
    reader?.releaseLock()
  }
}
