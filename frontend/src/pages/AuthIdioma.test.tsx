import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IdiomaProvider } from '../lib/i18n'
import { api } from '../lib/api'
import Convite from './Convite'
import RedefinirSenha from './RedefinirSenha'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, carregando: false, login: vi.fn(), atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('../components/Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), notificar: vi.fn() }) }))
vi.mock('../components/FachadaAuth', () => ({ FachadaAuth: () => null }))
vi.mock('../components/ToggleTema', () => ({ ToggleTema: () => null }))
vi.mock('../lib/api', async () => ({ ...await vi.importActual('../lib/api'), api: { get: vi.fn(), post: vi.fn(), postPublic: vi.fn() } }))
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US') })
afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })

it.each([
  ['owner', 'Owner', 'Dono'],
  ['admin', 'Administrator', 'Administrador'],
  ['member', 'Member', 'Membro'],
])('convite de %s traduz papel e validação sem alterar identidade ou senha ao trocar idioma', async (role, ingles, portugues) => {
  vi.mocked(api.post).mockResolvedValue({ email: 'joao@example.test', org_nome: 'João & Filhos', role, usuario_existe: false })
  render(<MemoryRouter initialEntries={['/convite/exemplo']}><IdiomaProvider><Routes><Route path="/convite/:token" element={<Convite />} /></Routes></IdiomaProvider></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: /You have been invited to join João & Filhos/ })).toBeInTheDocument()
  expect(screen.getByText(ingles)).toBeInTheDocument()
  const nome = screen.getByRole('textbox', {name:'Your name'})
  const senha = screen.getByLabelText('Create a password')
  fireEvent.change(nome, {target:{value:'João da Silva'}})
  fireEvent.change(senha, {target:{value:'Curta'}})
  fireEvent.click(screen.getByRole('button', {name:'Create password and sign in'}))
  expect(screen.getByRole('alert')).toHaveTextContent('at least 8 characters')
  fireEvent.change(screen.getByRole('combobox'), {target:{value:'pt-BR'}})
  expect(screen.getByText(portugues)).toBeInTheDocument()
  expect(screen.getByRole('textbox', {name:'Seu nome'})).toBe(nome)
  expect(senha).toHaveValue('Curta')
  expect(nome).toHaveValue('João da Silva')
  expect(screen.getByRole('alert')).toHaveTextContent('pelo menos 8 caracteres')
  expect(api.postPublic).not.toHaveBeenCalled()
  expect(api.post).toHaveBeenCalledWith('/convites/consultar', { token: 'exemplo' })
  expect(api.get).not.toHaveBeenCalled()
})

it('redefinição traduz instruções sem reenviar consulta nem perder a senha digitada', async () => {
  vi.mocked(api.post).mockResolvedValue({email:'joao@example.test',nome:'João',expira_em:'2026-10-01'})
  render(<MemoryRouter initialEntries={['/redefinir-senha/exemplo']}><IdiomaProvider><Routes><Route path="/redefinir-senha/:token" element={<RedefinirSenha />} /></Routes></IdiomaProvider></MemoryRouter>)
  await screen.findByRole('heading', {name:'Create a new password'})
  const senha = screen.getByLabelText(/^New password/)
  fireEvent.change(senha, {target:{value:'SenhaNova123'}})
  fireEvent.change(screen.getByRole('combobox'), {target:{value:'pt-BR'}})
  expect(screen.getByLabelText(/^Senha nova/)).toBe(senha)
  expect(senha).toHaveValue('SenhaNova123')
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(api.post).toHaveBeenCalledWith('/auth/reset-senha/consultar', { token: 'exemplo' })
  expect(api.get).not.toHaveBeenCalled()
})

it.each([
  ['/convite/', '/convites/consultar', Convite, /You have been invited/],
  ['/redefinir-senha/', '/auth/reset-senha/consultar', RedefinirSenha, /Create a new password/],
] as const)('abre link %s com token no fragmento, sem token na rota HTTP', async (path, endpoint, Page, heading) => {
  window.history.replaceState(null, '', `${path}#token-sintetico`)
  vi.mocked(api.post).mockResolvedValue({ email: 'demo@example.test', org_nome: 'Empresa Demo', role: 'member', usuario_existe: false, nome: 'Demo', expira_em: '2026-10-01' })
  render(<BrowserRouter><IdiomaProvider><Page /></IdiomaProvider></BrowserRouter>)
  await screen.findByRole('heading', { name: heading })
  expect(api.post).toHaveBeenCalledWith(endpoint, { token: 'token-sintetico' })
  expect(api.get).not.toHaveBeenCalled()
  expect(window.location.pathname).not.toContain('token-sintetico')
})
