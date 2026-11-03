/** O sandbox impede scripts e acesso ao app, mas não o carregamento de
 * imagens/fontes remotas. Esta política pertence só à prévia: não altera
 * o arquivo entregue nem libera execução ou origem no iframe.
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP
 */
const POLITICA_PREVIA = "default-src 'none'; img-src data: blob:; font-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'"
const META_PREVIA = `<meta http-equiv="Content-Security-Policy" content="${POLITICA_PREVIA}">`

export function protegerHtmlPrevia(html: string): string {
  // A política vem antes de qualquer recurso, inclusive em HTML incompleto.
  // Mantém o doctype para não mudar o modo de layout do documento original.
  let inicio = 0
  while (inicio < html.length) {
    while (inicio < html.length && /\s/.test(html[inicio])) inicio++
    if (!html.startsWith('<!--', inicio)) break
    const fim = html.indexOf('-->', inicio + 4)
    if (fim < 0) break
    inicio = fim + 3
  }
  // Somente o doctype HTML5 simples: um ">" dentro de um identificador
  // legado entre aspas não pode engolir a meta e desativar a proteção.
  const doctype = html.slice(inicio, inicio + 100).match(/^<!doctype\s+html\s*>/i)?.[0]
  const cabecalho = doctype ? html.slice(0, inicio + doctype.length) : ''
  return cabecalho + META_PREVIA + html.slice(cabecalho.length)
}

/** Aviso de apresentação; a proteção efetiva é a CSP, mesmo sem este sinal. */
export function temRecursosExternosHtml(html: string): boolean {
  return /(?:\b(?:src|srcset|href)\s*=\s*["']?\s*(?:https?:|\/\/)|url\(\s*["']?\s*(?:https?:|\/\/)|@import\s)/i.test(html)
}
