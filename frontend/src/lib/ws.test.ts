import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const credenciais = vi.hoisted(() => ({ access: 'fixture-A', sessao: 'sessao-A' as string | null }))
vi.mock('./api', () => ({
  API_BASE: 'http://fixture.invalid',
  getAccessToken: () => credenciais.access || null,
  getSessionIdentity: () => credenciais.sessao,
}))
import { wsClient } from './ws'

class SocketFixture {
  static OPEN = 1
  static CONNECTING = 0
  static instancias: SocketFixture[] = []
  readyState = SocketFixture.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3 })
  constructor(readonly url: string) { SocketFixture.instancias.push(this) }
  abrir() { this.readyState = SocketFixture.OPEN; this.onopen?.() }
  mensagem(t = 'job_status') { this.onmessage?.({ data: JSON.stringify({ t, job_id: 17 }) }) }
}

const remover: Array<() => void> = []
function ouvir(tipo: string) {
  const handler = vi.fn()
  remover.push(wsClient.on(tipo, handler))
  return handler
}
function conectar() {
  wsClient.connect()
  return SocketFixture.instancias[SocketFixture.instancias.length - 1]!
}
function contaB() { credenciais.access = 'fixture-B'; credenciais.sessao = 'sessao-B' }

beforeEach(() => {
  vi.useFakeTimers()
  credenciais.access = 'fixture-A'
  credenciais.sessao = 'sessao-A'
  SocketFixture.instancias = []
  vi.stubGlobal('WebSocket', SocketFixture)
})
afterEach(() => {
  remover.splice(0).forEach(fn => fn())
  wsClient.close()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('eventos ao vivo pertencem à credencial que abriu a conexão', () => {
  it('descarta mensagem da conta anterior antes mesmo de React tratar a mudança entre abas', () => {
    const eventos = ouvir('job_status'), todos = ouvir('*')
    const antigo = conectar(); antigo.abrir()
    eventos.mockClear(); todos.mockClear()
    contaB()
    antigo.mensagem()
    expect(eventos).not.toHaveBeenCalled()
    expect(todos).not.toHaveBeenCalled()
    expect(antigo.close).toHaveBeenCalledTimes(1)
  })

  it('não confirma conexão antiga que só abriu depois de entrar em outra conta', () => {
    const conectado = ouvir('_conectado')
    const antigo = conectar()
    contaB(); antigo.abrir()
    expect(conectado).not.toHaveBeenCalled()
    expect(antigo.close).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_001)
    expect(antigo.send).not.toHaveBeenCalled()
  })

  it('connect da conta atual substitui uma conexão aberta da conta anterior', () => {
    const eventos = ouvir('job_status')
    const antigo = conectar(); antigo.abrir()
    contaB()
    const atual = conectar()
    expect(atual).not.toBe(antigo)
    expect(antigo.close).toHaveBeenCalledTimes(1)
    expect(atual.url).toBe('ws://fixture.invalid/ws?token=fixture-B')
    atual.abrir(); atual.mensagem()
    antigo.mensagem()
    expect(eventos).toHaveBeenCalledTimes(1)
  })

  it('mesmo token sintético não permite misturar duas identidades de login', () => {
    const eventos = ouvir('job_status')
    const antigo = conectar(); antigo.abrir()
    credenciais.sessao = 'sessao-B'
    antigo.mensagem()
    expect(eventos).not.toHaveBeenCalled()
  })

  it('não envia ping com credencial anterior nem reconecta outra conta por fechamento antigo', () => {
    const desconectado = ouvir('_desconectado')
    const antigo = conectar(); antigo.abrir()
    contaB()
    vi.advanceTimersByTime(30_001)
    antigo.onclose?.()
    vi.advanceTimersByTime(60_000)
    expect(antigo.send).not.toHaveBeenCalled()
    expect(desconectado).not.toHaveBeenCalled()
    expect(SocketFixture.instancias).toHaveLength(1)
  })

  it('interrompe dispatch se um assinante troca a conta durante o mesmo evento', () => {
    remover.push(wsClient.on('job_status', contaB))
    const segundo = ouvir('job_status'), todos = ouvir('*')
    const antigo = conectar(); antigo.abrir()
    todos.mockClear()
    antigo.mensagem()
    expect(segundo).not.toHaveBeenCalled()
    expect(todos).not.toHaveBeenCalled()
  })

  it('refresh da mesma sessão troca a conexão e ignora callbacks atrasados', () => {
    const eventos = ouvir('job_status'), desconectado = ouvir('_desconectado')
    const antigo = conectar(); antigo.abrir()
    credenciais.access = 'fixture-A-renovado'
    window.dispatchEvent(new Event('offiz:token-renovado'))
    const atual = SocketFixture.instancias[SocketFixture.instancias.length - 1]!
    expect(atual).not.toBe(antigo)
    expect(atual.url).toContain('fixture-A-renovado')
    atual.abrir(); antigo.mensagem(); antigo.onclose?.(); atual.mensagem()
    expect(eventos).toHaveBeenCalledTimes(1)
    expect(desconectado).not.toHaveBeenCalled()
  })

  it('queda da conexão atual reconecta com backoff e mantém mensagens válidas', () => {
    const conectado = ouvir('_conectado'), desconectado = ouvir('_desconectado'), eventos = ouvir('job_status')
    const antigo = conectar(); antigo.abrir(); antigo.mensagem()
    antigo.readyState = 3; antigo.onclose?.()
    expect(desconectado).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_501)
    const atual = SocketFixture.instancias[SocketFixture.instancias.length - 1]!
    expect(atual).not.toBe(antigo)
    atual.abrir(); atual.mensagem()
    expect(conectado).toHaveBeenCalledTimes(2)
    expect(eventos).toHaveBeenCalledTimes(2)
  })

  it('não abre socket sem token ou identidade de sessão', () => {
    credenciais.access = ''; conectar()
    expect(SocketFixture.instancias).toHaveLength(0)
    credenciais.access = 'fixture-A'; credenciais.sessao = null; conectar()
    expect(SocketFixture.instancias).toHaveLength(0)
  })

  it('reconexão agendada por A não abre outra conta quando seu timer vence', () => {
    const antigo = conectar(); antigo.abrir()
    antigo.readyState = 3; antigo.onclose?.()
    contaB()
    vi.advanceTimersByTime(30_000)
    expect(SocketFixture.instancias).toHaveLength(1)
    const atual = conectar()
    expect(atual.url).toContain('fixture-B')
  })

  it('logout invalida callbacks de abertura e mensagens ainda enfileirados', () => {
    const conectado = ouvir('_conectado'), eventos = ouvir('job_status')
    const antigo = conectar()
    credenciais.access = ''; credenciais.sessao = null
    antigo.abrir(); antigo.mensagem()
    vi.advanceTimersByTime(60_000)
    expect(conectado).not.toHaveBeenCalled()
    expect(eventos).not.toHaveBeenCalled()
    expect(antigo.send).not.toHaveBeenCalled()
    expect(SocketFixture.instancias).toHaveLength(1)
  })

  it('refresh entre abas invalida o token anterior mesmo antes do aviso local', () => {
    const eventos = ouvir('job_status')
    const antigo = conectar(); antigo.abrir()
    credenciais.access = 'fixture-A-renovado'
    antigo.mensagem()
    expect(eventos).not.toHaveBeenCalled()
    expect(antigo.close).toHaveBeenCalledTimes(1)
    const atual = conectar(); atual.abrir(); atual.mensagem()
    expect(eventos).toHaveBeenCalledTimes(1)
  })

  it('erro tardio do socket antigo não fecha a conexão substituta', () => {
    const eventos = ouvir('job_status')
    const antigo = conectar(); antigo.abrir()
    contaB()
    const atual = conectar(); atual.abrir()
    antigo.onerror?.(); antigo.onclose?.(); antigo.abrir()
    expect(atual.close).not.toHaveBeenCalled()
    atual.mensagem()
    expect(eventos).toHaveBeenCalledTimes(1)
  })

  it('fechamento síncrono durante refresh não agenda uma conexão duplicada', () => {
    const desconectado = ouvir('_desconectado')
    const antigo = conectar(); antigo.abrir()
    antigo.close.mockImplementation(() => { antigo.readyState = 3; antigo.onclose?.() })
    credenciais.access = 'fixture-A-renovado'
    wsClient.reconnect()
    const atual = SocketFixture.instancias[SocketFixture.instancias.length - 1]!; atual.abrir()
    vi.advanceTimersByTime(10_000)
    expect(desconectado).not.toHaveBeenCalled()
    expect(SocketFixture.instancias).toHaveLength(2)
  })

  it('conexão atual envia ping, ignora JSON inválido e não duplica connect', () => {
    const eventos = ouvir('job_status')
    const atual = conectar(); atual.abrir()
    expect(conectar()).toBe(atual)
    atual.onmessage?.({ data: '{' })
    atual.onmessage?.({ data: JSON.stringify({ t: 12 }) })
    expect(eventos).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_001)
    expect(atual.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ t: 'ping' }))
    atual.mensagem()
    expect(eventos).toHaveBeenCalledTimes(1)
  })

  it('falha de um assinante não impede outras telas de receber o evento atual', () => {
    remover.push(wsClient.on('job_status', () => { throw new Error('fixture-privada') }))
    const eventos = ouvir('job_status'), todos = ouvir('*')
    const atual = conectar(); atual.abrir(); todos.mockClear()
    expect(() => atual.mensagem()).not.toThrow()
    expect(eventos).toHaveBeenCalledTimes(1)
    expect(todos).toHaveBeenCalledTimes(1)
  })

  it('falha ao atualizar uma tela sobre queda não impede reconexão', () => {
    remover.push(wsClient.on('_desconectado', () => { throw new Error('fixture-privada') }))
    const desconectado = ouvir('_desconectado')
    const antigo = conectar(); antigo.abrir(); antigo.readyState = 3
    expect(() => antigo.onclose?.()).not.toThrow()
    expect(desconectado).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_501)
    expect(SocketFixture.instancias).toHaveLength(2)
  })

  it('falha de um assinante que mudou sessão não autoriza os próximos callbacks', () => {
    remover.push(wsClient.on('job_status', () => { contaB(); throw new Error('fixture-privada') }))
    const eventos = ouvir('job_status')
    const atual = conectar(); atual.abrir()
    expect(() => atual.mensagem()).not.toThrow()
    expect(eventos).not.toHaveBeenCalled()
    expect(atual.close).toHaveBeenCalledTimes(1)
  })
})
