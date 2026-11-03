import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { SeletorIdioma } from '../components/SeletorIdioma'
import { api, ApiError, AUTH_CREDENTIALS_KEY, getSessionIdentity, setTokens } from './api'
import { IdiomaProvider, resolverIdioma, useIdioma } from './i18n'
import type { Usuario } from './types'
import { useRef, useState } from 'react'

vi.mock('./api', async (original) => ({
  ...await original<typeof import('./api')>(),
  api: { get: vi.fn(), put: vi.fn(), postPublic: vi.fn() },
}))
vi.mock('./ws', () => ({ wsClient: { connect: vi.fn(), close: vi.fn() } }))
vi.mock('../components/Toasts', () => ({ useToasts: () => ({ falha: vi.fn() }) }))

let pessoa: Usuario
function Tela() {
  const { t } = useIdioma()
  const tradutorDaAbertura = useRef(t)
  const [aviso, setAviso] = useState('')
  const { usuario, sair, login, recarregarUsuario } = useAuth()
  return <><h1>{t('Seu escritório', 'Your office')}</h1><p data-testid="usuario">{usuario?.nome || 'visitante'}</p><SeletorIdioma />
    <input aria-label="rascunho" defaultValue="Nome do cliente: João / Customer name: John" />
    <button onClick={sair}>logout</button><button onClick={() => void login('outra@example.test', 'sintetica')}>login outra</button>
    <button onClick={() => void recarregarUsuario()}>atualizar conta</button>
    <button onClick={() => setAviso(tradutorDaAbertura.current('Não foi possível carregar.', 'Could not load.'))}>resposta tardia</button>
    {aviso && <p role="status">{aviso}</p>}</>
}
const montar = () => render(<AuthProvider><IdiomaProvider><Tela /></IdiomaProvider></AuthProvider>)
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  pessoa = { id: 1, nome: 'João', email: 'joao@example.test', is_admin: false, idioma_interface: 'auto' }
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('pt-BR')
  localStorage.setItem('offiz_access_token', 'token-sintetico')
  localStorage.setItem('offiz_usuario', JSON.stringify({ ...pessoa, __offiz_sessao: getSessionIdentity() }))
  vi.mocked(api.get).mockImplementation(async () => pessoa)
  vi.mocked(api.put).mockImplementation(async (_path, body) => {
    pessoa = { ...pessoa, ...body as object }
    return { idioma_interface: pessoa.idioma_interface, modo_avancado: false }
  })
  vi.mocked(api.postPublic).mockImplementation(async () => ({ access_token: 'token-outra', refresh_token: 'refresh-sintetico', usuario: { id: 2, nome: 'Mary', email: 'outra@example.test', is_admin: false, idioma_interface: 'auto' } }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([['pt-PT', 'pt-BR'], ['pt-BR', 'pt-BR'], ['en-US', 'en'], ['en-GB', 'en'], ['fr-FR', 'pt-BR']])('automático resolve %s para %s', (sistema, idioma) => {
  expect(resolverIdioma('auto', sistema)).toBe(idioma)
})

it('salva idioma por usuário e muda texto real e document.lang sem remontar o campo', async () => {
  montar()
  await waitFor(() => expect(api.get).toHaveBeenCalled())
  const campo = screen.getByRole('textbox', { name: 'rascunho' })
  fireEvent.change(campo, { target: { value: 'Meu texto não deve ser traduzido.' } })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } })
  await screen.findByRole('heading', { name: 'Your office' })
  expect(api.put).toHaveBeenCalledWith('/usuarios/me/preferencias', { idioma_interface: 'en' })
  expect(document.documentElement.lang).toBe('en')
  expect(screen.getByRole('textbox', { name: 'rascunho' })).toBe(campo)
  expect(campo).toHaveValue('Meu texto não deve ser traduzido.')
  expect(JSON.parse(localStorage.getItem('offiz_usuario')!)).toMatchObject({ id: 1, idioma_interface: 'en' })
})

it('automático acompanha languagechange e a escolha manual fica estável', async () => {
  montar()
  await screen.findByRole('heading', { name: 'Seu escritório' })
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
  fireEvent(window, new Event('languagechange'))
  await screen.findByRole('heading', { name: 'Your office' })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pt-BR' } })
  await screen.findByRole('heading', { name: 'Seu escritório' })
  fireEvent(window, new Event('languagechange'))
  expect(screen.getByRole('heading', { name: 'Seu escritório' })).toBeInTheDocument()
})

it('preferência automática permanece auto na API e volta pelo cache após remontar', async () => {
  pessoa.idioma_interface = 'en'
  localStorage.setItem('offiz_usuario', JSON.stringify(pessoa))
  const primeira = montar()
  await screen.findByRole('heading', { name: 'Your office' })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'auto' } })
  await screen.findByRole('heading', { name: 'Seu escritório' })
  expect(JSON.parse(localStorage.getItem('offiz_usuario')!)).toMatchObject({ idioma_interface: 'auto' })
  primeira.unmount()
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
  montar()
  await screen.findByRole('heading', { name: 'Your office' })
  expect(screen.getByRole('combobox')).toHaveValue('auto')
})

it('logout e outra conta não herdam a escolha manual da pessoa anterior', async () => {
  montar()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } })
  await screen.findByRole('heading', { name: 'Your office' })
  fireEvent.click(screen.getByRole('button', { name: 'logout' }))
  await screen.findByRole('heading', { name: 'Seu escritório' })
  expect(localStorage.getItem('offiz_usuario')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'login outra' }))
  await screen.findByText('Mary')
  expect(screen.getByRole('combobox')).toHaveValue('auto')
  expect(screen.getByRole('heading', { name: 'Seu escritório' })).toBeInTheDocument()
})

it('troca de conta em outra aba retira o usuário anterior antes de carregar o novo', async () => {
  montar()
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'))
  let concluir!: (value: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  setTokens('token-outra-aba', 'refresh-outra-aba')
  fireEvent(window, new StorageEvent('storage', { key: AUTH_CREDENTIALS_KEY, storageArea: localStorage }))
  expect(screen.getByTestId('usuario')).toHaveTextContent('visitante')
  await act(async () => concluir({ id: 2, nome: 'Mary', email: 'mary@example.test', is_admin: false, idioma_interface: 'en' }))
  expect(screen.getByTestId('usuario')).toHaveTextContent('Mary')
  expect(screen.getByRole('heading', { name: 'Your office' })).toBeInTheDocument()
  localStorage.clear()
  fireEvent(window, new StorageEvent('storage', { key: null, storageArea: localStorage }))
  expect(screen.getByTestId('usuario')).toHaveTextContent('visitante')
})

it('troca de conta aguarda o motor confirmar a desconexão antes de usar outro login', async () => {
  let finalizar!: () => void
  const desparear = vi.fn(() => new Promise<void>(resolve => { finalizar = resolve }))
  vi.stubGlobal('offizMotor', { desparear })
  montar()
  await screen.findByText('João')
  fireEvent.click(screen.getByRole('button', { name: 'logout' }))
  fireEvent.click(screen.getByRole('button', { name: 'login outra' }))
  expect(desparear).toHaveBeenCalledOnce()
  expect(api.postPublic).not.toHaveBeenCalled()
  expect(localStorage.getItem('offiz_access_token')).toBe('token-sintetico')
  await act(async () => finalizar())
  await screen.findByText('Mary')
  expect(localStorage.getItem('offiz_access_token')).toBe('token-outra')
})

it('salvamento tardio depois de trocar conta não altera seu idioma nem cache', async () => {
  let concluir!: (value: unknown) => void
  vi.mocked(api.put).mockImplementation(() => new Promise((resolve) => { concluir = resolve }))
  montar()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } })
  fireEvent.click(screen.getByRole('button', { name: 'logout' }))
  fireEvent.click(screen.getByRole('button', { name: 'login outra' }))
  await screen.findByText('Mary')
  await act(async () => concluir({ idioma_interface: 'en' }))
  expect(screen.getByRole('combobox')).toHaveValue('auto')
  expect(JSON.parse(localStorage.getItem('offiz_usuario')!)).toMatchObject({ id: 2, idioma_interface: 'auto' })
})

it('erro de API mantém a escolha anterior e informa a falha', async () => {
  vi.mocked(api.put).mockRejectedValue(new ApiError(503, 'Não foi possível salvar.'))
  montar()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } })
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar.')
  expect(screen.getByRole('combobox')).toHaveValue('auto')
  expect(screen.getByRole('heading', { name: 'Seu escritório' })).toBeInTheDocument()
})

it('preferência do visitante é separada da conta e não chama API', async () => {
  localStorage.clear()
  montar()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } })
  await screen.findByRole('heading', { name: 'Your office' })
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'login outra' }))
  await screen.findByText('Mary')
  expect(screen.getByRole('heading', { name: 'Seu escritório' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'logout' }))
  await screen.findByRole('heading', { name: 'Your office' })
})

it('sincroniza somente o idioma efetivo com o menu nativo e tolera falha da versão desktop', async () => {
  const definirIdioma = vi.fn().mockRejectedValue(new Error('Fixture: bridge unavailable'))
  vi.stubGlobal('offizMotor', { definirIdioma })
  montar()
  await waitFor(() => expect(definirIdioma).toHaveBeenCalledWith('pt-BR'))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } })
  await screen.findByRole('heading', { name: 'Your office' })
  expect(definirIdioma).toHaveBeenLastCalledWith('en')
  expect(definirIdioma.mock.calls.every((args) => args.length === 1)).toBe(true)
})

it('callbacks já registrados usam o idioma atual, sem exigir recarga dos dados', async () => {
  montar()
  await waitFor(() => expect(api.get).toHaveBeenCalled())
  const chamadas = vi.mocked(api.get).mock.calls.length
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } })
  await screen.findByRole('heading', { name: 'Your office' })
  fireEvent.click(screen.getByRole('button', { name: 'resposta tardia' }))
  expect(screen.getByRole('status')).toHaveTextContent('Could not load.')
  expect(api.get).toHaveBeenCalledTimes(chamadas)
})
