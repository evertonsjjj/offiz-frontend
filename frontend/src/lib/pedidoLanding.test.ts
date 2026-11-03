import { beforeEach, expect, it, vi } from 'vitest'
import { clearTokens, setTokens } from './api'
import { consumirPedidoLanding, guardarPedidoLanding, lerPedidoLanding, vincularPedidoLandingNoLogin } from './pedidoLanding'

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks() })

it('guarda o pedido só nesta aba e consome uma única vez na sessão de origem', () => {
  setTokens('teste', 'teste')
  expect(guardarPedidoLanding('nonce', 'Meu briefing privado', 7)).toBe(true)
  expect(localStorage.getItem('offiz:pedido-da-pagina-inicial')).toBeNull()
  expect(lerPedidoLanding('outro')).toBeNull()
  expect(lerPedidoLanding('nonce')?.texto).toBe('Meu briefing privado')
  consumirPedidoLanding('nonce')
  expect(lerPedidoLanding('nonce')).toBeNull()
})

it('login explícito leva o pedido anônimo à sessão que acabou de entrar', () => {
  guardarPedidoLanding('nonce', 'Quero preparar uma apresentação.', null)
  expect(lerPedidoLanding('nonce')).toBeNull()
  setTokens('teste', 'teste')
  vincularPedidoLandingNoLogin('/app?pedido-inicial=nonce', 7)
  expect(lerPedidoLanding('nonce')?.usuarioId).toBe(7)
  clearTokens()
  setTokens('outra', 'outra')
  expect(lerPedidoLanding('nonce')).toBeNull()
  vincularPedidoLandingNoLogin('/app?pedido-inicial=nonce', 8)
  expect(lerPedidoLanding('nonce')).toBeNull()
})

it('renovar o acesso à mesma conta mantém o pedido, mas outra conta não o recebe', () => {
  setTokens('teste', 'teste')
  guardarPedidoLanding('nonce', 'Pedido da pessoa sete.', 7)
  clearTokens()
  setTokens('outra', 'outra')
  vincularPedidoLandingNoLogin('/app?pedido-inicial=nonce', 8)
  expect(lerPedidoLanding('nonce')).toBeNull()
  vincularPedidoLandingNoLogin('/app?pedido-inicial=nonce', 7)
  expect(lerPedidoLanding('nonce')?.texto).toBe('Pedido da pessoa sete.')
})

it('ignora pedidos vencidos e informa quando não consegue guardá-los', () => {
  setTokens('teste', 'teste')
  const agora = Date.now()
  guardarPedidoLanding('nonce', 'Texto.', 7)
  vi.spyOn(Date, 'now').mockReturnValue(agora + 31 * 60 * 1000)
  expect(lerPedidoLanding('nonce')).toBeNull()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
  expect(guardarPedidoLanding('outro', 'Texto.', 7)).toBe(false)
})
