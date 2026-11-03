import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ConversaTab } from './ConversaTab'
import { api, getSessionIdentity, setTokens } from '../../lib/api'
import { guardarPedidoLanding, lerPedidoLanding } from '../../lib/pedidoLanding'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
const office = { slug: 'predio', nome: 'Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
function Local() { const l = useLocation(); return <output>{l.search}</output> }
function Tela() { return <StrictMode><MemoryRouter initialEntries={['/app?org=1&pedido-inicial=nonce']}><Local /><ConversaTab orgId={1} slug="predio" office={office} nivelPredio /></MemoryRouter></StrictMode> }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  setTokens('sintetico', 'sintetico')
  guardarPedidoLanding('nonce', 'Quero uma apresentação com meus resultados.', 7)
  vi.mocked(api.get).mockResolvedValue({ conversas: [] })
})

it('preenche o pedido uma vez, sem restaurar conversa antiga, enviar ou produzir', async () => {
  localStorage.setItem(`offiz:conversa-aberta:${getSessionIdentity()}:1/predio/true`, '42')
  vi.mocked(api.get).mockResolvedValue({ conversas: [{ id: 42, titulo: 'Cliente antigo' }] })
  render(<Tela />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Quero uma apresentação com meus resultados.'))
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/conversas/42')).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
  expect(lerPedidoLanding('nonce')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('?org=1')
})

it.each(['Acrescentar ao meu rascunho', 'Manter só meu rascunho'])('preserva texto digitado enquanto abre e oferece %s', async acao => {
  let resolver!: (valor: unknown) => void
  const lista = new Promise(resolve => { resolver = resolve })
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/conversas') ? lista : { conversas: [] })
  render(<Tela />)
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Já estava preparando este pedido.' } })
  await act(async () => { resolver({ conversas: [] }) })
  expect(campo).toHaveValue('Já estava preparando este pedido.')
  fireEvent.click(await screen.findByRole('button', { name: acao }))
  expect(campo).toHaveValue(acao.startsWith('Acrescentar') ? 'Já estava preparando este pedido.\n\nQuero uma apresentação com meus resultados.' : 'Já estava preparando este pedido.')
  expect(lerPedidoLanding('nonce')).toBeNull()
  expect(api.post).not.toHaveBeenCalled()
})
