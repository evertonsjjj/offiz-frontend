/** Preserva deep-links internos sem aceitar redirecionamentos externos. */
export function destinoLogin(solicitado: unknown, admin: boolean): string {
  const padrao = admin ? '/admin' : '/app'
  if (typeof solicitado !== 'string' || !solicitado.startsWith('/') || /[\\\u0000-\u0020]/.test(solicitado)) return padrao
  try {
    const url = new URL(solicitado, 'https://offiz.invalid')
    if (url.origin !== 'https://offiz.invalid' || url.pathname === '/login') return padrao
    return url.pathname + url.search + url.hash
  } catch { return padrao }
}
