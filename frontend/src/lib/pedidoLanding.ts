import { getSessionIdentity } from './api'

const CHAVE = 'offiz:pedido-da-pagina-inicial'
const VALIDADE = 30 * 60 * 1000
export interface PedidoLanding { id: string; texto: string; criado: number; sessao: string | null; usuarioId: number | null }

export const identificarPedidoLanding = () => Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')

/** O texto permanece nesta aba; a URL carrega apenas um identificador, sem briefing. */
export function guardarPedidoLanding(id: string, texto: string, usuarioId: number | null): boolean {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify({ id, texto: texto.trim().slice(0, 1500), criado: Date.now(), sessao: getSessionIdentity(), usuarioId }))
    return true
  } catch { return false }
}

function ler(id: string): PedidoLanding | null {
  try {
    const pedido = JSON.parse(sessionStorage.getItem(CHAVE) || 'null') as PedidoLanding | null
    if (!pedido || pedido.id !== id || typeof pedido.texto !== 'string' || !pedido.texto.trim() || pedido.texto.length > 1500 || !Number.isFinite(pedido.criado) || Date.now() - pedido.criado > VALIDADE || pedido.criado > Date.now()) return null
    return pedido
  } catch { return null }
}

/** Só o login iniciado por este pedido pode adotar um rascunho anônimo.
 * Um pedido de uma pessoa autenticada nunca passa para outra conta. */
export function vincularPedidoLandingNoLogin(destino: unknown, usuarioId: number): void {
  if (typeof destino !== 'string' || !destino.startsWith('/app?')) return
  const id = new URLSearchParams(destino.split('?')[1].split('#')[0]).get('pedido-inicial')
  if (!id) return
  const pedido = ler(id)
  if (!pedido || (pedido.usuarioId !== null && pedido.usuarioId !== usuarioId) || (pedido.sessao !== null && pedido.usuarioId === null)) return
  try { sessionStorage.setItem(CHAVE, JSON.stringify({ ...pedido, usuarioId, sessao: getSessionIdentity() })) } catch { /* não transfere se o armazenamento falhar */ }
}

export function lerPedidoLanding(id: string): PedidoLanding | null {
  const pedido = ler(id)
  const sessao = getSessionIdentity()
  return pedido && sessao && pedido.sessao === sessao ? pedido : null
}

export function consumirPedidoLanding(id: string): void {
  try {
    const pedido = JSON.parse(sessionStorage.getItem(CHAVE) || 'null') as PedidoLanding | null
    if (pedido?.id === id) sessionStorage.removeItem(CHAVE)
  } catch { /* sem armazenamento, nada a consumir */ }
}
