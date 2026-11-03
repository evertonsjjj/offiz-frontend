export interface VinculoConversaEntrega {
  conversa_id?: number | null
  conversa_titulo?: string | null
  conversa_office_slug?: string | null
}

export interface GrupoEntregasConversa<T> {
  chave: string
  conversaId: number | null
  titulo: string | null
  officeSlug: string | null
  pedidos: T[]
}

/** Identidade do assunto vem do vínculo autorizado, nunca do título ou job. */
export function gruposEntregasConversa<T extends VinculoConversaEntrega>(pedidos: T[]): GrupoEntregasConversa<T>[] {
  const grupos = new Map<string, GrupoEntregasConversa<T>>()
  for (const pedido of pedidos) {
    const id = typeof pedido.conversa_id === 'number' && Number.isSafeInteger(pedido.conversa_id) && pedido.conversa_id > 0 ? pedido.conversa_id : null
    const chave = id === null ? 'sem-conversa' : `conversa:${id}`
    const titulo = typeof pedido.conversa_titulo === 'string' ? pedido.conversa_titulo.trim() || null : null
    const officeSlug = typeof pedido.conversa_office_slug === 'string' ? pedido.conversa_office_slug : null
    let grupo = grupos.get(chave)
    if (!grupo) {
      grupo = { chave, conversaId: id, titulo: id === null ? null : titulo, officeSlug: id === null ? null : officeSlug, pedidos: [] }
      grupos.set(chave, grupo)
    } else if (grupo.conversaId !== null && !grupo.titulo && titulo) grupo.titulo = titulo
    grupo.pedidos.push(pedido)
  }
  return [...grupos.values()]
}

export function mesclarPedidosCarregados<T extends { id: number }>(iniciais: T[], adicionais: T[]): T[] {
  const porId = new Map<number, T>()
  for (const pedido of [...iniciais, ...adicionais]) {
    if (Number.isSafeInteger(pedido.id) && pedido.id > 0) porId.set(pedido.id, pedido)
  }
  return [...porId.values()]
}

/** Reabre a conversa em sua área real sem herdar alvos de outra entrega. */
export function enderecoConversaEntrega(orgId: number, conversaId: number, officeSlug: string | null): string {
  const params = new URLSearchParams({ org: String(orgId), conversa: String(conversaId), vista: 'conversa' })
  if (officeSlug) params.set('slug', officeSlug)
  return `/app?${params}`
}
