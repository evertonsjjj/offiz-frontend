/** Match the whole collection before paging; accents do not hide a result. */
export function normalizarBusca(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()
}
export function correspondeBusca(termo: string, ...campos: Array<string | null | undefined>): boolean {
  return normalizarBusca(campos.filter(Boolean).join(' ')).includes(normalizarBusca(termo))
}
