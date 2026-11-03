import { getSessionIdentity } from './api'
import type { ReferenciaConversa } from './types'

export const LIMITE_RASCUNHO = 50_000
const VALIDADE = 24 * 60 * 60 * 1000
const MAX_RASCUNHOS = 20
export interface RascunhoGuardado { texto: string; referencia?: ReferenciaConversa; atualizado: number }

export function escopoRascunhos(orgId: number, slug: string, predio: boolean): string | null {
  try { const sessao = getSessionIdentity(); return sessao ? `offiz:rascunhos:${sessao}:${orgId}/${slug}/${predio}` : null } catch { return null }
}

function referenciaValida(r: unknown): r is ReferenciaConversa {
  if (!r || typeof r !== 'object') return false
  const v = r as ReferenciaConversa
  return Number.isSafeInteger(v.jobId) && v.jobId > 0 && (v.entregaId === undefined || Number.isSafeInteger(v.entregaId) && v.entregaId > 0) && ['discutir', 'ajustar', 'reutilizar', 'testar'].includes(v.intencao)
}

export function lerRascunhos(escopo: string | null): Record<string, RascunhoGuardado> {
  if (!escopo) return {}
  try {
    const bruto = sessionStorage.getItem(escopo)
    if (!bruto || bruto.length > MAX_RASCUNHOS * (LIMITE_RASCUNHO + 1000)) return {}
    const dados = JSON.parse(bruto)
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return {}
    return Object.fromEntries(Object.entries(dados).filter(([chave, valor]) => {
      const r = valor as RascunhoGuardado
      return /^(nova|[1-9]\d*)$/.test(chave) && r && typeof r.texto === 'string' && !!r.texto.trim() && r.texto.length <= LIMITE_RASCUNHO && Number.isFinite(r.atualizado) && r.atualizado <= Date.now() && Date.now() - r.atualizado <= VALIDADE && (r.referencia === undefined || referenciaValida(r.referencia))
    }).sort(([, a], [, b]) => (b as RascunhoGuardado).atualizado - (a as RascunhoGuardado).atualizado).slice(0, MAX_RASCUNHOS)) as Record<string, RascunhoGuardado>
  } catch { return {} }
}

export function guardarRascunho(escopo: string | null, chave: string, texto: string, referencia?: ReferenciaConversa): boolean {
  if (!escopo || texto.length > LIMITE_RASCUNHO) return false
  try {
    const dados = lerRascunhos(escopo)
    if (texto.trim()) dados[chave] = { texto, ...(referencia ? { referencia } : {}), atualizado: Date.now() }
    else delete dados[chave]
    const recentes = Object.fromEntries(Object.entries(dados).sort(([ka, a], [kb, b]) => b.atualizado - a.atualizado || (ka === chave ? -1 : kb === chave ? 1 : 0)).slice(0, MAX_RASCUNHOS))
    if (Object.keys(recentes).length) sessionStorage.setItem(escopo, JSON.stringify(recentes))
    else sessionStorage.removeItem(escopo)
    return true
  } catch { return false }
}

/** A resposta antiga não apaga o próximo texto que a pessoa já digitou. */
export function concluirRascunho(escopo: string | null, chave: string, enviado: string): void {
  const guardado = lerRascunhos(escopo)[chave]
  if (guardado?.texto.trim() === enviado.trim()) guardarRascunho(escopo, chave, '')
}

/** Consumir o foco não consome o próximo texto já escrito na mesma conversa. */
export function concluirReferenciaRascunho(escopo: string | null, chave: string, referencia: ReferenciaConversa): void {
  const guardado = lerRascunhos(escopo)[chave]
  const atual = guardado?.referencia
  if (atual?.jobId === referencia.jobId && atual.entregaId === referencia.entregaId && atual.intencao === referencia.intencao) {
    guardarRascunho(escopo, chave, guardado.texto)
  }
}
