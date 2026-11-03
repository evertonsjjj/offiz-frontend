import { beforeEach, expect, it, vi } from 'vitest'
import { setTokens } from './api'
import { concluirRascunho, escopoRascunhos, guardarRascunho, lerRascunhos, LIMITE_RASCUNHO } from './rascunhosConversa'

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); setTokens('teste', 'teste') })

it('expira rascunhos após 24 horas sem devolver texto ou referência antigos', () => {
  const escopo = escopoRascunhos(1, 'predio', true)
  guardarRascunho(escopo, 'nova', 'Pedido.', { jobId: 7, intencao: 'ajustar' })
  const agora = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(agora + 24 * 60 * 60 * 1000 + 1)
  expect(lerRascunhos(escopo)).toEqual({})
})

it('limita tamanho sem truncar o texto e restringe a quantidade persistida', () => {
  const escopo = escopoRascunhos(1, 'predio', true)
  expect(guardarRascunho(escopo, 'nova', 'x'.repeat(LIMITE_RASCUNHO + 1))).toBe(false)
  expect(lerRascunhos(escopo)).toEqual({})
  for (let i = 1; i <= 25; i++) guardarRascunho(escopo, String(i), `Rascunho ${i}`)
  expect(Object.keys(lerRascunhos(escopo))).toHaveLength(20)
})

it('resposta de envio antigo não apaga um rascunho posterior', () => {
  const escopo = escopoRascunhos(1, 'predio', true)
  guardarRascunho(escopo, '42', 'Pedido seguinte.')
  concluirRascunho(escopo, '42', 'Pedido anterior.')
  expect(lerRascunhos(escopo)['42'].texto).toBe('Pedido seguinte.')
  concluirRascunho(escopo, '42', 'Pedido seguinte.')
  expect(lerRascunhos(escopo)).toEqual({})
})

it('ignora JSON inválido, referência inválida e storage indisponível', () => {
  const escopo = escopoRascunhos(1, 'predio', true)!
  sessionStorage.setItem(escopo, '{inválido')
  expect(lerRascunhos(escopo)).toEqual({})
  sessionStorage.setItem(escopo, JSON.stringify({ nova: { texto: 'Pedido.', atualizado: Date.now(), referencia: { jobId: -1, intencao: 'inventada' } } }))
  expect(lerRascunhos(escopo)).toEqual({})
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
  expect(lerRascunhos(escopo)).toEqual({})
  expect(escopoRascunhos(1, 'predio', true)).toBeNull()
})
