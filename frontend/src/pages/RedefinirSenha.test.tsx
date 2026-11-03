import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { IdiomaProvider } from '../lib/i18n'
import RedefinirSenha from './RedefinirSenha'

const sucesso = vi.hoisted(() => vi.fn())
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('../components/Toasts', () => ({ useToasts: () => ({ sucesso }) }))
vi.mock('../components/FachadaAuth', () => ({ FachadaAuth: () => null }))
vi.mock('../components/ToggleTema', () => ({ ToggleTema: () => null }))
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { post: vi.fn() } }))
const info = (token = 'a') => ({ email: `pessoa-${token}@example.test`, nome: `Pessoa ${token}`, expira_em: '2026-10-10' })
function Navegacao() {
  const navegar = useNavigate(); const local = useLocation()
  return <><output aria-label="Rota atual">{local.pathname}</output><button onClick={() => navegar('/redefinir-senha/b')}>Outro link</button><button onClick={() => navegar('/outra-pagina')}>Sair</button></>
}
const montar = () => render(<MemoryRouter initialEntries={['/redefinir-senha/a']}><IdiomaProvider><Navegacao /><Routes><Route path="/redefinir-senha/:token" element={<RedefinirSenha />} /><Route path="*" element={<p>Outra página</p>} /></Routes></IdiomaProvider></MemoryRouter>)
const preencher = () => {
  fireEvent.change(screen.getByLabelText(/^Senha nova/), { target: { value: 'SenhaDeTeste123' } })
  fireEvent.change(screen.getByLabelText(/^Repita a senha/), { target: { value: 'SenhaDeTeste123' } })
}
const enviar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar senha e entrar' }))
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); localStorage.setItem('offiz:idioma:visitante', 'pt-BR')
  vi.mocked(api.post).mockImplementation(async (path, body) => path.endsWith('/consultar') ? info((body as { token: string }).token) : {})
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

it('trocar o link limpa a senha anterior e impede aplicar antes de conferir a nova conta', async () => {
  let resolver!: (value: unknown) => void
  montar(); await screen.findByRole('heading', { name: 'Crie uma senha nova' }); preencher()
  vi.mocked(api.post).mockImplementation(path => path.endsWith('/consultar') ? new Promise(resolve => { resolver = resolve }) as never : Promise.resolve({}) as never)
  fireEvent.click(screen.getByRole('button', { name: 'Outro link' }))
  expect(screen.queryByLabelText(/^Senha nova/)).not.toBeInTheDocument()
  expect(screen.queryByText('pessoa-a@example.test')).not.toBeInTheDocument()
  expect(vi.mocked(api.post).mock.calls.filter(([path]) => path.endsWith('/aplicar'))).toHaveLength(0)
  await act(async () => resolver(info('b')))
  expect(screen.getByText('pessoa-b@example.test')).toBeInTheDocument()
  expect(screen.getByLabelText(/^Senha nova/)).toHaveValue('')
  expect(screen.getByLabelText(/^Repita a senha/)).toHaveValue('')
})

it('consulta tardia do link anterior não substitui a nova conta', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.post).mockImplementation((_path, body) => (body as { token: string }).token === 'a' ? new Promise(resolve => { resolver = resolve }) as never : Promise.resolve(info('b')) as never)
  montar(); fireEvent.click(screen.getByRole('button', { name: 'Outro link' }))
  await screen.findByText('pessoa-b@example.test')
  await act(async () => resolver(info('a')))
  expect(screen.queryByText('pessoa-a@example.test')).not.toBeInTheDocument()
})

it('resultado do POST antigo não confirma alteração nem navega no novo link', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.post).mockImplementation((path, body) => path.endsWith('/aplicar') ? new Promise(resolve => { resolver = resolve }) as never : Promise.resolve(info((body as { token: string }).token)) as never)
  montar(); await screen.findByText('pessoa-a@example.test'); preencher(); enviar()
  await waitFor(() => expect(resolver).toBeTypeOf('function'))
  fireEvent.click(screen.getByRole('button', { name: 'Outro link' })); await screen.findByText('pessoa-b@example.test')
  vi.useFakeTimers()
  await act(async () => resolver({}))
  expect(screen.queryByRole('heading', { name: 'Senha alterada!' })).not.toBeInTheDocument()
  expect(sucesso).not.toHaveBeenCalled()
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.getByLabelText('Rota atual')).toHaveTextContent('/redefinir-senha/b')
})

it('erro do POST antigo não contamina o novo link', async () => {
  let rejeitar!: (reason: Error) => void
  vi.mocked(api.post).mockImplementation((path, body) => path.endsWith('/aplicar') ? new Promise((_, reject) => { rejeitar = reject }) as never : Promise.resolve(info((body as { token: string }).token)) as never)
  montar(); await screen.findByText('pessoa-a@example.test'); preencher(); enviar()
  fireEvent.click(screen.getByRole('button', { name: 'Outro link' })); await screen.findByText('pessoa-b@example.test')
  await act(async () => rejeitar(new Error('offline')))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByLabelText(/^Senha nova/)).toHaveValue('')
})

it.each(['Outro link', 'Sair'])('timer de login é cancelado ao navegar por %s', async botao => {
  montar(); await screen.findByText('pessoa-a@example.test'); preencher()
  vi.useFakeTimers()
  await act(async () => enviar())
  expect(screen.getByRole('heading', { name: 'Senha alterada!' })).toBeInTheDocument()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: botao })))
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.getByLabelText('Rota atual')).toHaveTextContent(botao === 'Sair' ? '/outra-pagina' : '/redefinir-senha/b')
})

it('reenvio durante aplicação não duplica POST e falha permite corrigir a mesma senha', async () => {
  let rejeitar!: (reason: Error) => void
  vi.mocked(api.post).mockImplementation((path, body) => path.endsWith('/aplicar') ? new Promise((_, reject) => { rejeitar = reject }) as never : Promise.resolve(info((body as { token: string }).token)) as never)
  const { container } = montar(); await screen.findByText('pessoa-a@example.test'); preencher()
  fireEvent.submit(container.querySelector('form')!); fireEvent.submit(container.querySelector('form')!)
  expect(vi.mocked(api.post).mock.calls.filter(([path]) => path.endsWith('/aplicar'))).toHaveLength(1)
  await act(async () => rejeitar(new Error('offline')))
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível alterar a senha')
  expect(screen.getByLabelText(/^Senha nova/)).toHaveValue('SenhaDeTeste123')
  expect(screen.getByRole('button', { name: 'Salvar senha e entrar' })).toBeEnabled()
})

it('falha do primeiro link não deixa o próximo link indisponível', async () => {
  vi.mocked(api.post).mockImplementation((_path, body) => (body as { token: string }).token === 'a' ? Promise.reject(new Error('offline')) : Promise.resolve(info('b')) as never)
  montar(); await screen.findByRole('heading', { name: 'Link indisponível' })
  fireEvent.click(screen.getByRole('button', { name: 'Outro link' }))
  await screen.findByRole('heading', { name: 'Crie uma senha nova' })
  expect(screen.queryByRole('heading', { name: 'Link indisponível' })).not.toBeInTheDocument()
})
