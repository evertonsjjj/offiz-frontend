import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { api, AUTH_CREDENTIALS_KEY, clearTokens, getAccessToken, getRefreshToken, setTokens } from './api'

function pendente<T>() {
  let resolve!: (valor: T) => void
  const promise = new Promise<T>((concluir) => { resolve = concluir })
  return { promise, resolve }
}
beforeEach(() => { localStorage.clear(); setTokens('access-A', 'refresh-A') })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('PUT antigo não é repetido na conta B quando o401 da conta A chega após novo login', async () => {
  const primeira = pendente<Response>()
  const fetch = vi.fn().mockReturnValueOnce(primeira.promise)
  vi.stubGlobal('fetch', fetch)
  const expirou = vi.fn()
  window.addEventListener('offiz:sessao-expirada', expirou)
  const resultado = api.put('/usuarios/me/preferencias', { idioma_interface: 'en' }).catch((e: unknown) => e)
  clearTokens()
  setTokens('access-B', 'refresh-B')
  localStorage.setItem('offiz_usuario', JSON.stringify({ id: 2, idioma_interface: 'en' }))
  primeira.resolve(new Response('', { status: 401 }))
  expect(await resultado).toMatchObject({ status: 409, detail: 'Your session changed. Try again in the current account.' })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer access-A')
  expect(getAccessToken()).toBe('access-B')
  expect(getRefreshToken()).toBe('refresh-B')
  expect(expirou).not.toHaveBeenCalled()
  window.removeEventListener('offiz:sessao-expirada', expirou)
})

it('refresh pendente da conta A não restaura seus tokens nem bloqueia refresh da conta B', async () => {
  const renovarA = pendente<Response>()
  const comecouA = pendente<void>()
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/auth/refresh')) {
      const { refresh_token } = JSON.parse(String(init.body))
      if (refresh_token === 'refresh-A') { comecouA.resolve(); return renovarA.promise }
      expect(refresh_token).toBe('refresh-B')
      return Response.json({ access_token: 'access-B-novo', refresh_token: 'refresh-B-novo' })
    }
    const auth = new Headers(init.headers).get('Authorization')
    return auth === 'Bearer access-B-novo' ? Response.json({ idioma_interface: 'pt-BR' }) : new Response('', { status: 401 })
  })
  vi.stubGlobal('fetch', fetch)
  const antiga = api.put('/usuarios/me/preferencias', { idioma_interface: 'en' }).catch((e: unknown) => e)
  await comecouA.promise
  clearTokens()
  setTokens('access-B', 'refresh-B')
  expect(await api.put('/usuarios/me/preferencias', { idioma_interface: 'pt-BR' })).toEqual({ idioma_interface: 'pt-BR' })
  renovarA.resolve(Response.json({ access_token: 'access-A-novo', refresh_token: 'refresh-A-novo' }))
  expect(await antiga).toMatchObject({ status: 409 })
  expect(getAccessToken()).toBe('access-B-novo')
  expect(getRefreshToken()).toBe('refresh-B-novo')
  const pedidos = fetch.mock.calls.filter(([url]) => !url.endsWith('/auth/refresh'))
  expect(pedidos).toHaveLength(3)
  expect(pedidos.every(([, init]) => new Headers(init.headers).get('Authorization') !== 'Bearer access-A-novo')).toBe(true)
})

it.each([200, 401])('resposta%s de outra aba/sessão é descartada sem consumir o payload anterior', async (status) => {
  const primeira = pendente<Response>()
  const fetch = vi.fn().mockReturnValueOnce(primeira.promise)
  vi.stubGlobal('fetch', fetch)
  const resultado = api.get('/auth/me').catch((e: unknown) => e)
  // localStorage é compartilhado; a aba anterior vê a nova identidade mesmo
  // sem depender de um evento storage ou de uma renderização do React.
  setTokens('access-B', 'refresh-B')
  primeira.resolve(Response.json({ nome: 'Pessoa A' }, { status }))
  expect(await resultado).toMatchObject({ status: 409 })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(getAccessToken()).toBe('access-B')
})

it('sessão antiga sem marcador migra sem perder a renovação normal', async () => {
  localStorage.removeItem(AUTH_CREDENTIALS_KEY)
  localStorage.removeItem('offiz_auth_session')
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/auth/refresh')) return Response.json({ access_token: 'access-A-novo', refresh_token: 'refresh-A-novo' })
    return new Headers(init.headers).get('Authorization') === 'Bearer access-A'
      ? new Response('', { status: 401 }) : Response.json({ idioma_interface: 'en' })
  }))
  expect(await api.put('/usuarios/me/preferencias', { idioma_interface: 'en' })).toEqual({ idioma_interface: 'en' })
  expect(localStorage.getItem('offiz_auth_session')).toBeTruthy()
})

it('fallback fixo segue idioma da interface e detalhes do servidor continuam originais', async () => {
  localStorage.setItem('offiz_usuario', JSON.stringify({ id: 1, idioma_interface: 'en' }))
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response('', { status: 413 }))
    .mockResolvedValueOnce(Response.json({ detail: 'O acervo do cliente João precisa ser revisado.' }, { status: 409 }))
    .mockRejectedValueOnce(new TypeError('Failed to fetch')))
  await expect(api.get('/arquivo')).rejects.toMatchObject({ detail: 'The file is too large.' })
  await expect(api.get('/arquivo')).rejects.toMatchObject({ detail: 'O acervo do cliente João precisa ser revisado.' })
  await expect(api.get('/arquivo')).rejects.toMatchObject({ detail: 'Could not connect to the server. Check your connection.' })
})

it.each([503, 401])('falha %s ao renovar numa aba não encerra o login já renovado pela outra', async status => {
  vi.resetModules()
  const abaA = await import('./api')
  abaA.setTokens('access-expirado-fixture', 'refresh-fixture')
  vi.resetModules()
  const abaB = await import('./api')
  const renovarA = pendente<Response>()
  let renovacoes = 0
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/auth/refresh')) {
      if (++renovacoes === 1) return renovarA.promise
      return Response.json({ access_token: 'access-novo-fixture', refresh_token: 'refresh-novo-fixture' })
    }
    return new Headers(init.headers).get('Authorization') === 'Bearer access-novo-fixture'
      ? Response.json({ ok: true }) : new Response('', { status: 401 })
  })
  vi.stubGlobal('fetch', fetch)
  const resultadoA = abaA.api.get('/orgs/1').catch(e => e)
  await waitFor(() => expect(renovacoes).toBe(1))
  expect(await abaB.api.get('/orgs/1')).toEqual({ ok: true })
  renovarA.resolve(new Response('', { status }))
  expect(await resultadoA).toEqual({ ok: true })
  expect(abaB.getAccessToken()).toBe('access-novo-fixture')
  expect(abaB.getRefreshToken()).toBe('refresh-novo-fixture')
})

it.each([401, 200])('resposta %s do retry usa o token enviado e não invalida uma renovação mais recente da mesma sessão', async status => {
  const respostaB = pendente<Response>()
  let retryComecou = false
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/auth/refresh')) return Response.json({ access_token: 'access-B', refresh_token: 'refresh-B' })
    if (new Headers(init.headers).get('Authorization') === 'Bearer access-B') { retryComecou = true; return respostaB.promise }
    return new Response('', { status: 401 })
  })
  vi.stubGlobal('fetch', fetch)
  const resultado = api.get('/orgs/1').catch(e => e)
  await waitFor(() => expect(retryComecou).toBe(true))
  // Refresh de outra aba preserva a identidade do login.
  const credenciais = JSON.parse(localStorage.getItem(AUTH_CREDENTIALS_KEY)!)
  localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ ...credenciais, access: 'access-C', refresh: 'refresh-C' }))
  respostaB.resolve(Response.json({ ok: true }, { status }))
  if (status === 401) expect(await resultado).toMatchObject({ status: 409 })
  else expect(await resultado).toEqual({ ok: true })
  expect(getAccessToken()).toBe('access-C')
  expect(getRefreshToken()).toBe('refresh-C')
  expect(fetch).toHaveBeenCalledTimes(3)
})
