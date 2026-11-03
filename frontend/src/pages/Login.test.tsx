import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import Login from './Login'
import { destinoLogin } from '../lib/destinoLogin'
import { setTokens } from '../lib/api'
import { guardarPedidoLanding, lerPedidoLanding } from '../lib/pedidoLanding'

const auth = vi.hoisted(() => ({ usuario: null, carregando: false, login: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../components/FachadaAuth', () => ({ FachadaAuth: () => null }))
vi.mock('../components/ToggleTema', () => ({ ToggleTema: () => null }))

function Destino() { const l = useLocation(); return <h1>{l.pathname + l.search + l.hash}</h1> }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); auth.usuario = null; auth.login.mockResolvedValue({ is_admin: false }) })

it('vincula o pedido anônimo apenas ao login iniciado por ele', async () => {
  guardarPedidoLanding('nonce', 'Pedido para minha primeira apresentação.', null)
  auth.login.mockImplementation(async () => { setTokens('sintetico', 'sintetico'); return { id: 7, is_admin: false } })
  render(<MemoryRouter initialEntries={[{ pathname: '/login', state: { de: '/app?pedido-inicial=nonce' } }]}><Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Destino />} /></Routes></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'cliente@example.com' } })
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'apenas-teste-local' } })
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
  expect(await screen.findByRole('heading', { name: '/app?pedido-inicial=nonce' })).toBeInTheDocument()
  expect(lerPedidoLanding('nonce')?.texto).toBe('Pedido para minha primeira apresentação.')
})

it.each([undefined, '/app?org=7&slug=conteudo&f=entregas&job=12#arquivo'])('login abre o início ou preserva o destino explícito: %s', async (de) => {
  render(<MemoryRouter initialEntries={[{ pathname: '/login', state: { de } }]}><Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Destino />} /></Routes></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'cliente@example.com' } })
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'apenas-teste-local' } })
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
  expect(await screen.findByRole('heading', { name: de || '/app' })).toBeInTheDocument()
})

it.each(['//example.com', '/\\example.com', 'https://example.com', '/login?de=1', '/login#entrar', '/app\n', 7, null])('não aceita retorno externo, malformado ou para o próprio login: %s', (de) => {
  expect(destinoLogin(de, false)).toBe('/app')
  expect(destinoLogin(de, true)).toBe('/admin')
})
