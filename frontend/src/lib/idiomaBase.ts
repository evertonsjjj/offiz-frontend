/** No context dependency: authentication errors and the root boundary can
 * still use the saved preference if a provider has failed. */
export function idiomaForaDoProvider(): 'pt-BR' | 'en' {
  let preferencia: unknown = 'auto'
  try {
    const pessoa = JSON.parse(localStorage.getItem('offiz_usuario') || 'null')
    preferencia = pessoa?.id ? pessoa.idioma_interface : localStorage.getItem('offiz:idioma:visitante')
  } catch { /* unavailable cache: use this device's language */ }
  if (preferencia === 'pt-BR' || preferencia === 'en') return preferencia
  return /^en(?:-|$)/i.test(navigator.language) ? 'en' : 'pt-BR'
}

export function traduzirForaDoProvider(pt: string, en: string): string {
  return idiomaForaDoProvider() === 'en' ? en : pt
}
