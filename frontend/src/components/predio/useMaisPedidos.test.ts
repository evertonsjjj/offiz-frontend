import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { api, setTokens } from '../../lib/api'
import { useMaisPedidos } from './useMaisPedidos'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn() } }))
const iniciais = Array.from({ length: 24 }, (_, i) => ({ id: i + 1 }))
beforeEach(() => { vi.clearAllMocks(); setTokens('mais-pedidos-A', 'refresh-sintetico') })

function adiar() {
  let resolver!: (v: unknown) => void
  vi.mocked(api.get).mockImplementation(() => new Promise(r => { resolver = r }))
  return (value: unknown) => resolver(value)
}

it('duplo clique não abre duas leituras da mesma página e não busca sozinho ao montar', async () => {
  const concluir = adiar()
  const { result } = renderHook(() => useMaisPedidos('/orgs/33/biblioteca?offset=0&limite=24', 0, iniciais, 0, 25))
  expect(api.get).not.toHaveBeenCalled()
  await act(async () => { void result.current.carregar(); void result.current.carregar() })
  expect(api.get).toHaveBeenCalledOnce()
  expect(result.current.ocupado).toBe(true)
  await act(async () => concluir({ itens: [{ id: 25 }] }))
  expect(result.current.pedidos).toHaveLength(25)
  expect(result.current.podeCarregar).toBe(false)
})

it.each(['filtro', 'revisao'] as const)('resposta antiga depois de mudar %s não compõe novos grupos', async modo => {
  const concluir = adiar()
  const { result, rerender } = renderHook(({ url, revisao }) => useMaisPedidos(url, revisao, iniciais, 0, 25), { initialProps: { url: '/orgs/33/biblioteca?filtro=todos', revisao: 0 } })
  await act(async () => { void result.current.carregar() })
  const signal = vi.mocked(api.get).mock.calls[0][1]
  rerender({ url: modo === 'filtro' ? '/orgs/33/biblioteca?filtro=aprovados' : '/orgs/33/biblioteca?filtro=todos', revisao: modo === 'revisao' ? 1 : 0 })
  expect(signal?.aborted).toBe(true)
  await act(async () => concluir({ itens: [{ id: 999 }] }))
  expect(result.current.pedidos).toEqual(iniciais)
  expect(result.current.falhou).toBe(false)
})

it('troca de sessão durante a leitura impede acrescentar bytes da conta anterior', async () => {
  const concluir = adiar()
  const { result } = renderHook(() => useMaisPedidos('/orgs/33/biblioteca', 0, iniciais, 0, 25))
  await act(async () => { void result.current.carregar() })
  setTokens('mais-pedidos-B', 'novo-refresh-sintetico')
  await act(async () => concluir({ itens: [{ id: 999 }] }))
  expect(result.current.pedidos).toEqual(iniciais)
})

it.each([{ itens: null }, { itens: [{ id: '25' }] }, { itens: [null] }, { itens: Array.from({ length: 25 }, (_, i) => ({ id: 25 + i })) }])('página malformada %j conserva a consulta anterior e informa falha', async dados => {
  vi.mocked(api.get).mockResolvedValue(dados)
  const { result } = renderHook(() => useMaisPedidos('/orgs/33/biblioteca', 0, iniciais, 0, 30))
  await act(async () => { await result.current.carregar() })
  expect(result.current.falhou).toBe(true)
  expect(result.current.pedidos).toEqual(iniciais)
})

it('página final vazia encerra a leitura explícita sem laço de novas consultas', async () => {
  vi.mocked(api.get).mockResolvedValue({ itens: [] })
  const { result } = renderHook(() => useMaisPedidos('/orgs/33/biblioteca', 0, iniciais, 0, 30))
  await act(async () => { await result.current.carregar() })
  expect(result.current.podeCarregar).toBe(false)
  expect(result.current.pedidos).toHaveLength(24)
  expect(api.get).toHaveBeenCalledOnce()
})
