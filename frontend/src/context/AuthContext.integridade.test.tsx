import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, AUTH_CREDENTIALS_KEY, getAccessToken, getSessionIdentity, setTokens } from '../lib/api'
import { wsClient } from '../lib/ws'
import { AuthProvider, useAuth } from './AuthContext'

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), postPublic: vi.fn() } }))
vi.mock('../lib/ws', () => ({ wsClient: { connect: vi.fn(), close: vi.fn() } }))
vi.mock('../components/Toasts', () => ({ useToasts: () => ({ falha: vi.fn() }) }))
const usuario = (id: number) => ({ id, email: `pessoa-${id}@example.invalid`, nome: `Pessoa ${id}`, is_admin: false })
function Estado() { const { usuario, carregando } = useAuth(); return <output aria-label="Estado da conta">{carregando ? 'confirmando' : 'liberado'}:{usuario?.id || 'sem-usuario'}</output> }
const trocarAba = () => { setTokens('fixture-B', 'refresh-B'); window.dispatchEvent(new StorageEvent('storage', { key: 'offiz_auth_session', storageArea: localStorage })) }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); setTokens('fixture-A', 'refresh-A'); localStorage.setItem('offiz_usuario', JSON.stringify(usuario(1))) })
afterEach(() => { cleanup(); delete window.offizMotor })

it.each(['falha', 'sucesso'])('boot antigo com %s não libera guard durante a confirmação da conta nova', async retorno => {
  let concluirA!: (valor: unknown) => void
  let rejeitarA!: (erro: Error) => void
  let concluirB!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve, reject) => { concluirA = resolve; rejeitarA = reject })).mockImplementationOnce(() => new Promise(resolve => { concluirB = resolve }))
  render(<AuthProvider><Estado /></AuthProvider>)
  act(trocarAba)
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('confirmando:sem-usuario')
  await act(async () => { if (retorno === 'falha') rejeitarA(new ApiError(409, 'Sessão mudou')); else concluirA(usuario(1)) })
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('confirmando:sem-usuario')
  await act(async () => concluirB(usuario(2)))
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:2')
})

it('resposta antiga não retira o usuário da conta atual já confirmada', async () => {
  let rejeitarA!: (erro: Error) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeitarA = reject })).mockResolvedValue(usuario(2))
  render(<AuthProvider><Estado /></AuthProvider>)
  await act(async () => trocarAba())
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:2')
  await act(async () => rejeitarA(new Error('offline')))
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:2')
})

function AcoesConta() {
  const { sair, login } = useAuth()
  return <><Estado /><button onClick={() => void sair()}>Sair</button><button onClick={() => void login('pessoa-2@example.invalid', 'senha-sintetica')}>Entrar</button></>
}

function saidaAdiada() {
  let concluir!: () => void
  let rejeitar!: (erro: Error) => void
  window.offizMotor = { desparear: vi.fn(() => new Promise<void>((resolve, reject) => { concluir = resolve; rejeitar = reject })) } as unknown as NonNullable<Window['offizMotor']>
  return { concluir: () => concluir(), rejeitar: (erro: Error) => rejeitar(erro) }
}

it.each(['sucesso', 'falha'])('saída antiga com %s conserva a conta nova confirmada por outra aba', async retorno => {
  const saida = saidaAdiada()
  vi.mocked(api.get).mockResolvedValue(usuario(1))
  render(<AuthProvider><AcoesConta /></AuthProvider>)
  await waitFor(() => expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:1'))
  fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
  expect(window.offizMotor!.desparear).toHaveBeenCalledOnce()
  vi.mocked(api.get).mockResolvedValue(usuario(2))
  await act(async () => trocarAba())
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:2')
  const identidadeB = getSessionIdentity(), fechamentos = vi.mocked(wsClient.close).mock.calls.length
  await act(async () => { if (retorno === 'falha') saida.rejeitar(new Error('motor indisponível')); else saida.concluir() })
  expect(getAccessToken()).toBe('fixture-B')
  expect(getSessionIdentity()).toBe(identidadeB)
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:2')
  expect(JSON.parse(localStorage.getItem('offiz_usuario')!)).toMatchObject({ id: 2 })
  expect(wsClient.close).toHaveBeenCalledTimes(fechamentos)
  expect(api.postPublic).not.toHaveBeenCalled()
})

it('clique duplo compartilha a saída e limpa apenas a sessão atual', async () => {
  const saida = saidaAdiada()
  vi.mocked(api.get).mockResolvedValue(usuario(1))
  render(<AuthProvider><AcoesConta /></AuthProvider>)
  await waitFor(() => expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:1'))
  fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
  fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
  expect(window.offizMotor!.desparear).toHaveBeenCalledOnce()
  await act(async () => saida.concluir())
  expect(getAccessToken()).toBeNull()
  expect(getSessionIdentity()).toBeNull()
  expect(localStorage.getItem('offiz_usuario')).toBeNull()
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:sem-usuario')
})

it('login nesta aba aguarda a saída antes de guardar os novos tokens', async () => {
  const saida = saidaAdiada()
  vi.mocked(api.get).mockResolvedValue(usuario(1))
  vi.mocked(api.postPublic).mockResolvedValue({ access_token: 'login-B', refresh_token: 'login-refresh-B', usuario: usuario(2) })
  render(<AuthProvider><AcoesConta /></AuthProvider>)
  await waitFor(() => expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:1'))
  fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
  expect(api.postPublic).not.toHaveBeenCalled()
  expect(getAccessToken()).toBe('fixture-A')
  await act(async () => saida.concluir())
  expect(api.postPublic).toHaveBeenCalledExactlyOnceWith('/auth/login', { email: 'pessoa-2@example.invalid', senha: 'senha-sintetica' })
  expect(getAccessToken()).toBe('login-B')
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:2')
})

it('renovação dos tokens da mesma identidade não cancela a saída autorizada', async () => {
  const saida = saidaAdiada()
  vi.mocked(api.get).mockResolvedValue(usuario(1))
  render(<AuthProvider><AcoesConta /></AuthProvider>)
  await waitFor(() => expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:1'))
  const identidade = getSessionIdentity()
  fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
  act(() => {
    // O transporte de refresh publica os dois tokens em um commit e conserva a identidade.
    const credenciais = JSON.parse(localStorage.getItem(AUTH_CREDENTIALS_KEY)!)
    localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ ...credenciais, access: 'fixture-A-renovado', refresh: 'refresh-A-renovado' }))
    window.dispatchEvent(new CustomEvent('offiz:token-renovado'))
  })
  expect(getSessionIdentity()).toBe(identidade)
  expect(getAccessToken()).toBe('fixture-A-renovado')
  await act(async () => saida.concluir())
  expect(getAccessToken()).toBeNull()
  expect(getSessionIdentity()).toBeNull()
  expect(localStorage.getItem('offiz_usuario')).toBeNull()
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:sem-usuario')
})

it('cache sem vínculo de sessão não mostra a pessoa anterior durante a confirmação', async () => {
  setTokens('fixture-B', 'refresh-B')
  let concluir!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(() => new Promise(resolve => { concluir = resolve }))
  render(<AuthProvider><Estado /></AuthProvider>)
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('confirmando:sem-usuario')
  await act(async () => concluir(usuario(2)))
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:2')
  expect(JSON.parse(localStorage.getItem('offiz_usuario')!)).toMatchObject({ id: 2, __offiz_sessao: getSessionIdentity() })
})

it('cache confirmado conserva abertura otimista somente na mesma sessão', async () => {
  vi.mocked(api.get).mockResolvedValue(usuario(1))
  const primeira = render(<AuthProvider><Estado /></AuthProvider>)
  await waitFor(() => expect(JSON.parse(localStorage.getItem('offiz_usuario')!).__offiz_sessao).toBe(getSessionIdentity()))
  primeira.unmount()
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}))
  render(<AuthProvider><Estado /></AuthProvider>)
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:1')
})

it('evento do conjunto atômico confirma outra conta sem depender dos espelhos', async () => {
  vi.mocked(api.get).mockResolvedValue(usuario(1))
  render(<AuthProvider><Estado /></AuthProvider>)
  await waitFor(() => expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:1'))
  vi.mocked(api.get).mockResolvedValue(usuario(2))
  await act(async () => {
    const credenciais = JSON.parse(localStorage.getItem(AUTH_CREDENTIALS_KEY)!)
    localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ ...credenciais, sessao: 'sessao-B-atomica', access: 'access-B', refresh: 'refresh-B' }))
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CREDENTIALS_KEY, storageArea: localStorage }))
  })
  expect(screen.getByLabelText('Estado da conta')).toHaveTextContent('liberado:2')
  expect(getAccessToken()).toBe('access-B')
  expect(JSON.parse(localStorage.getItem('offiz_usuario')!)).toMatchObject({ id: 2, __offiz_sessao: 'sessao-B-atomica' })
})
