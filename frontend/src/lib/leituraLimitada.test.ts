import { beforeEach, expect, it, vi } from 'vitest'
import { AUTH_CREDENTIALS_KEY, getSessionIdentity, setTokens, clearTokens } from './api'
import { lerTextoLimitado } from './leituraLimitada'

beforeEach(() => { localStorage.clear(); setTokens('fixture-preview', 'fixture-refresh') })
const sinal = () => new AbortController().signal
const ler = (res: Response, teto = 100, signal = sinal()) => lerTextoLimitado(res, teto, signal, getSessionIdentity())

it('mantém UTF-8 dividido entre blocos e remove BOM como Blob.text', async () => {
  const bytes = new TextEncoder().encode('\uFEFFação 🚲')
  let i = 0
  const body = new ReadableStream({ pull(c) { if (i === bytes.length) c.close(); else c.enqueue(bytes.slice(i, ++i)) } })
  const res = new Response(body, { headers: { 'Content-Type': 'text/plain; charset=windows-1252' } })
  expect(await ler(res, bytes.length)).toBe(await new Blob([bytes]).text())
  expect(res.body?.locked).toBe(false)
})

it.each(['inválido', 'Infinity', '1e6'])('ignora Content-Length inválido %s e confere os bytes recebidos', async length => {
  expect(await ler(new Response('é', { headers: { 'Content-Length': length } }), 2)).toBe('é')
  await expect(ler(new Response('é', { headers: { 'Content-Length': length } }), 1)).rejects.toThrow('Prévia acima do limite')
})

it.each(['-1', '1,2'])('rejeita Content-Length inconsistente %s e cancela antes de ler', async length => {
  const cancelar = vi.fn()
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([120])) }, cancel: cancelar })
  await expect(ler(new Response(body, { headers: { 'Content-Length': length } }))).rejects.toThrow('Tamanho de resposta inconsistente')
  expect(cancelar).toHaveBeenCalledOnce()
  expect(body.locked).toBe(false)
})

it('abortar durante read cancela o corpo e libera o leitor sem texto parcial', async () => {
  const cancelar = vi.fn()
  const body = new ReadableStream({ cancel: cancelar })
  const controller = new AbortController()
  const leitura = ler(new Response(body), 100, controller.signal)
  expect(body.locked).toBe(true)
  controller.abort()
  await expect(leitura).rejects.toMatchObject({ name: 'AbortError' })
  expect(cancelar).toHaveBeenCalledOnce()
  expect(body.locked).toBe(false)
})

it.each(['login', 'storage'])('mudança de sessão por %s durante read descarta e cancela o corpo anterior', async modo => {
  const cancelar = vi.fn()
  const body = new ReadableStream({ cancel: cancelar })
  const leitura = ler(new Response(body))
  if (modo === 'login') setTokens('fixture-outra-conta', 'fixture-refresh-outra')
  else {
    const credenciais = JSON.parse(localStorage.getItem(AUTH_CREDENTIALS_KEY)!)
    localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ ...credenciais, sessao: 'fixture-outra-sessao', access: 'fixture-outra-conta', refresh: 'fixture-outro-refresh' }))
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CREDENTIALS_KEY, storageArea: localStorage }))
  }
  await expect(leitura).rejects.toMatchObject({ status: 409 })
  expect(cancelar).toHaveBeenCalledOnce()
  expect(body.locked).toBe(false)
})

it('renovar o token na mesma sessão conserva leitura legítima', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const cancelar = vi.fn()
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c }, cancel: cancelar })
  const sessao = getSessionIdentity()
  const leitura = lerTextoLimitado(new Response(body), 100, sinal(), sessao)
  const credenciais = JSON.parse(localStorage.getItem(AUTH_CREDENTIALS_KEY)!)
  localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ ...credenciais, access: 'fixture-token-renovado', refresh: 'fixture-refresh-renovado' }))
  window.dispatchEvent(new Event('offiz:token-changed'))
  controller.enqueue(new TextEncoder().encode('Texto da mesma conta.'))
  controller.close()
  expect(await leitura).toBe('Texto da mesma conta.')
  expect(getSessionIdentity()).toBe(sessao)
  expect(cancelar).not.toHaveBeenCalled()
  expect(body.locked).toBe(false)
})

it('sessão capturada antes do HTTP não pode ser substituída pela sessão atual', async () => {
  const sessao = getSessionIdentity()
  setTokens('fixture-outra-conta', 'fixture-refresh-outra')
  const cancelar = vi.fn()
  const body = new ReadableStream({ cancel: cancelar })
  await expect(lerTextoLimitado(new Response(body), 100, sinal(), sessao)).rejects.toMatchObject({ status: 409 })
  expect(cancelar).toHaveBeenCalledOnce()
  expect(body.locked).toBe(false)
})

it('sem sessão autenticada não consome a resposta e encerra o corpo', async () => {
  clearTokens()
  const cancelar = vi.fn()
  const body = new ReadableStream({ cancel: cancelar })
  await expect(ler(new Response(body))).rejects.toMatchObject({ status: 409 })
  expect(cancelar).toHaveBeenCalledOnce()
})

it('corpo já consumido ou ausente é erro de prévia, sem inventar texto', async () => {
  const consumido = new Response('Já lido')
  await consumido.text()
  await expect(ler(consumido)).rejects.toThrow('Corpo indisponível para a prévia')
  await expect(ler(new Response(null))).rejects.toThrow('Corpo indisponível para a prévia')
})

it('erro da stream não conserva leitor bloqueado ou devolve conteúdo parcial', async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([120])); c.error(new Error('Falha sintética de rede')) } })
  await expect(ler(new Response(body))).rejects.toThrow('Falha sintética de rede')
  expect(body.locked).toBe(false)
})
