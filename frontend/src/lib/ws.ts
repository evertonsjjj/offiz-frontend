import { API_BASE, getAccessToken, getSessionIdentity } from './api'
import type { WsMessage } from './types'

type WsHandler = (msg: WsMessage) => void

const PING_INTERVAL_MS = 30_000
const MAX_BACKOFF_MS = 20_000

/**
 * Singleton de WebSocket: uma conexão por sessão de UI, reconexão com
 * backoff exponencial e dispatch de mensagens por tipo (`t`).
 */
class WsClient {
  private ws: WebSocket | null = null
  private contexto: { token: string; sessao: string } | null = null
  private handlers = new Map<string, Set<WsHandler>>()
  private desired = false
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  connect(): void {
    this.desired = true
    this.open()
  }

  close(): void {
    this.desired = false
    this.attempts = 0
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopPing()
    if (this.ws) {
      this.descartar(this.ws)
    }
  }

  /** Reconecta com o token atual (chamar após refresh de token, se necessário). */
  reconnect(): void {
    if (!this.desired) return
    if (this.ws) {
      this.descartar(this.ws)
    }
    this.open()
  }

  on(tipo: string, handler: WsHandler): () => void {
    let set = this.handlers.get(tipo)
    if (!set) {
      set = new Set()
      this.handlers.set(tipo, set)
    }
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  private open(): void {
    if (!this.desired) return
    const token = getAccessToken()
    const sessao = getSessionIdentity()
    if (!token || !sessao) {
      if (this.ws) this.descartar(this.ws)
      return
    }
    if (this.ws && this.contexto?.token === token && this.contexto.sessao === sessao &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    if (this.ws) this.descartar(this.ws)
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const credencialAtual = () => getAccessToken() === token && getSessionIdentity() === sessao
    // Os getters também podem observar uma mudança entre abas: não construir
    // uma conexão a partir de leituras que já deixaram de representar a sessão.
    if (!credencialAtual()) return
    const url = `${API_BASE.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    this.contexto = { token, sessao }
    const atual = () => this.ws === ws && credencialAtual()

    ws.onopen = () => {
      if (!atual()) { this.descartar(ws); return }
      this.attempts = 0
      this.startPing(ws, atual)
      this.dispatch({ t: '_conectado' }, atual)
      if (!atual()) this.descartar(ws)
    }

    ws.onmessage = (ev) => {
      if (!atual()) { this.descartar(ws); return }
      let msg: WsMessage
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      if (msg && typeof msg.t === 'string') this.dispatch(msg, atual)
      if (!atual()) this.descartar(ws)
    }

    ws.onclose = () => {
      if (this.ws !== ws) return
      if (!credencialAtual()) { this.descartar(ws); return }
      this.ws = null
      this.contexto = null
      this.stopPing()
      this.dispatch({ t: '_desconectado' }, credencialAtual)
      if (credencialAtual()) this.scheduleReconnect()
    }

    ws.onerror = () => {
      if (!atual()) { this.descartar(ws); return }
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }

  private descartar(ws: WebSocket): void {
    if (this.ws !== ws) return
    // Retirar a referência antes de close também protege callbacks síncronos.
    this.ws = null
    this.contexto = null
    this.stopPing()
    try { ws.close() } catch { /* já fechado */ }
  }

  private dispatch(msg: WsMessage, atual: () => boolean): void {
    const exact = this.handlers.get(msg.t)
    if (exact) for (const h of exact) {
      if (!atual()) return
      try { h(msg) } catch { /* falha de uma tela não interrompe os demais assinantes */ }
    }
    const all = this.handlers.get('*')
    if (all) for (const h of all) {
      if (!atual()) return
      try { h(msg) } catch { /* não divulgar payload ou exceção de um assinante */ }
    }
  }

  private scheduleReconnect(): void {
    if (!this.desired || this.reconnectTimer) return
    const token = getAccessToken(), sessao = getSessionIdentity()
    if (!token || !sessao) return
    const base = Math.min(1000 * 2 ** this.attempts, MAX_BACKOFF_MS)
    const delay = base + Math.floor(Math.random() * 500)
    this.attempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (getAccessToken() === token && getSessionIdentity() === sessao) this.open()
    }, delay)
  }

  private startPing(ws: WebSocket, atual: () => boolean): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (!atual()) { this.descartar(ws); return }
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ t: 'ping' })) } catch {
          try { ws.close() } catch { /* a reconexão segue o evento de fechamento */ }
        }
      }
    }, PING_INTERVAL_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }
}

export const wsClient = new WsClient()

/* Token renovado (api.ts) → reconecta com o token novo. Sem isto, depois que o
   access token expira o servidor fecha o socket (4401) e a reconexão insistia
   com o token velho até alguma chamada JSON renovar a sessão. */
if (typeof window !== 'undefined') {
  window.addEventListener('offiz:token-renovado', () => wsClient.reconnect())
}
