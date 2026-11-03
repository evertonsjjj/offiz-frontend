let reloading = false

/** Um preload cancelado pelo Vite resolve como undefined. Enquanto a página
 * nova chega, mantenha Suspense em vez de entregar esse valor ao React.lazy. */
export async function loadRoute<T>(load: () => Promise<T>): Promise<T> {
  try {
    const module = await load()
    if (reloading) return new Promise<T>(() => {})
    return module
  } catch (error) {
    if (reloading) return new Promise<T>(() => {})
    throw error
  }
}

export function recoverRouteChunk(event: Event, reload = () => window.location.reload()) {
  const key = 'offiz:recarga-por-chunk'
  const now = Date.now()
  try {
    if (now - Number(sessionStorage.getItem(key) || 0) < 10_000) return
    sessionStorage.setItem(key, String(now))
  } catch {
    // Sem guardar a tentativa, uma falha de rede poderia recarregar sem fim.
    return
  }
  reloading = true
  event.preventDefault()
  reload()
}
