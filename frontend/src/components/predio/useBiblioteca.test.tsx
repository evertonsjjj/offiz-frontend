import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { useBiblioteca } from './useBiblioteca'

const contexto = vi.hoisted(() => ({ sessao: 'conta-a' }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), getSessionIdentity: () => contexto.sessao, api: { get: vi.fn() } }))
beforeEach(() => { vi.resetAllMocks(); contexto.sessao = 'conta-a' })

it('preserva dados da mesma consulta em falha e só retira o aviso depois de uma resposta confirmada', async () => {
  let concluir!: (value: unknown) => void
  vi.mocked(api.get).mockResolvedValueOnce({ titulo: 'Entrega confirmada' }).mockRejectedValueOnce(new Error('Sem conexão')).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  const tela = renderHook(({ revisao }) => useBiblioteca<{ titulo: string }>('/orgs/1/biblioteca/35', revisao), { initialProps: { revisao: 0 } })
  await waitFor(() => expect(tela.result.current.dados?.titulo).toBe('Entrega confirmada'))
  tela.rerender({ revisao: 1 })
  await waitFor(() => expect(tela.result.current.erro).toBe('Sem conexão'))
  expect(tela.result.current.dados?.titulo).toBe('Entrega confirmada')
  tela.rerender({ revisao: 2 })
  expect(tela.result.current.erro).toBe('Sem conexão')
  expect(tela.result.current.dados?.titulo).toBe('Entrega confirmada')
  await act(async () => concluir({ titulo: 'Consulta atual' }))
  expect(tela.result.current.dados?.titulo).toBe('Consulta atual')
  expect(tela.result.current.erro).toBeUndefined()
})

it('não reutiliza o snapshot de outra URL nem aplica respostas antigas', async () => {
  let concluir!: (value: unknown) => void
  vi.mocked(api.get).mockResolvedValueOnce({ titulo: 'Empresa A' }).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve })).mockRejectedValueOnce(new Error('Empresa B indisponível'))
  const tela = renderHook(({ url, revisao }) => useBiblioteca<{ titulo: string }>(url, revisao), { initialProps: { url: '/orgs/1/biblioteca/35', revisao: 0 } })
  await waitFor(() => expect(tela.result.current.dados?.titulo).toBe('Empresa A'))
  tela.rerender({ url: '/orgs/1/biblioteca/35', revisao: 1 })
  tela.rerender({ url: '/orgs/2/biblioteca/35', revisao: 1 })
  await waitFor(() => expect(tela.result.current.erro).toBe('Empresa B indisponível'))
  expect(tela.result.current.dados).toBeUndefined()
  await act(async () => concluir({ titulo: 'Resposta antiga da empresa A' }))
  expect(tela.result.current.dados).toBeUndefined()
})

it('não conserva o snapshot nem a resposta pendente de uma sessão anterior na mesma URL', async () => {
  let concluir!: (value: unknown) => void
  vi.mocked(api.get).mockResolvedValueOnce({ titulo: 'Conta A' }).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve })).mockRejectedValueOnce(new Error('Conta B indisponível'))
  const tela = renderHook(({ revisao }) => useBiblioteca<{ titulo: string }>('/orgs/1/biblioteca/35', revisao), { initialProps: { revisao: 0 } })
  await waitFor(() => expect(tela.result.current.dados?.titulo).toBe('Conta A'))
  tela.rerender({ revisao: 1 })
  contexto.sessao = 'conta-b'
  tela.rerender({ revisao: 1 })
  await waitFor(() => expect(tela.result.current.erro).toBe('Conta B indisponível'))
  expect(tela.result.current.dados).toBeUndefined()
  await act(async () => concluir({ titulo: 'Resposta antiga da conta A' }))
  expect(tela.result.current.dados).toBeUndefined()
})
