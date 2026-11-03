import type { Idioma } from './i18n'

/** The currency remains USD, regardless of the interface language. */
export function formatUSD(valor: number, idioma: Idioma = 'pt-BR'): string {
  return `US$ ${valor.toLocaleString(idioma, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
