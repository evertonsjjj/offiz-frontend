import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => { sessionStorage.clear(); vi.resetModules() })
afterEach(() => { vi.restoreAllMocks() })

describe('troca de versão durante a navegação', () => {
  it('abre uma rota normalmente e preserva erros que não são atualização', async () => {
    const { loadRoute } = await import('./routeReload')
    const module = { default: () => null }
    expect(await loadRoute(async () => module)).toBe(module)
    await expect(loadRoute(async () => { throw new Error('falha real') })).rejects.toThrow('falha real')
  })

  it('mantém carregamento quando o Vite cancela o import para recarregar', async () => {
    const { loadRoute, recoverRouteChunk } = await import('./routeReload')
    const reload = vi.fn()
    const event = new Event('vite:preloadError', { cancelable: true })
    const result = loadRoute(async () => {
      recoverRouteChunk(event, reload)
      return undefined
    })
    expect(event.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
    let settled = false
    void result.then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settled).toBe(false)
  })

  it('não repete a recarga se a versão nova também falhar', async () => {
    sessionStorage.setItem('offiz:recarga-por-chunk', String(Date.now()))
    const { loadRoute, recoverRouteChunk } = await import('./routeReload')
    const reload = vi.fn()
    const event = new Event('vite:preloadError', { cancelable: true })
    recoverRouteChunk(event, reload)
    expect(event.defaultPrevented).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    await expect(loadRoute(async () => { throw new Error('offline') })).rejects.toThrow('offline')
  })

  it('oferece tentativa manual quando o navegador bloqueia o armazenamento', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    const { recoverRouteChunk } = await import('./routeReload')
    const reload = vi.fn()
    const event = new Event('vite:preloadError', { cancelable: true })
    recoverRouteChunk(event, reload)
    expect(event.defaultPrevented).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
