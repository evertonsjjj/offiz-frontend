import { act, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import AppShell from './AppShell'
import { api } from '../lib/api'

vi.mock('../lib/api', async (original) => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn() } }))
const auth = vi.hoisted(() => ({ usuario: { id: 1, is_admin: false } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../lib/ws', () => ({ wsClient: { on: () => () => {} } }))
vi.mock('./Ceo', () => ({ OffizInicio: ({ orgId, areaOffice }: { orgId: number; areaOffice?: { nome: string } }) => <div><h1>Início da empresa {orgId}</h1>{areaOffice?.nome}</div> }))
vi.mock('./ShellSimples', () => ({ ShellSimples: ({ office, carregando }: { office?: { nome: string }; carregando: boolean }) => <div><h1>Área de trabalho</h1>{carregando ? 'Carregando área' : office?.nome}</div> }))

beforeEach(() => { vi.clearAllMocks(); auth.usuario.is_admin = false })
it('mantém o identificador do pedido da landing até escolher a empresa', async () => {
  vi.mocked(api.get).mockResolvedValue([{ id: 7, nome: 'Aurora' }, { id: 8, nome: 'Outra' }])
  render(<MemoryRouter initialEntries={['/app?pedido-inicial=nonce']}><AppShell /></MemoryRouter>)
  expect(await screen.findByRole('link', { name: 'Aurora' })).toHaveAttribute('href', '/app?pedido-inicial=nonce&org=7')
})
it('link explícito sem acesso não abre outra empresa disponível', async () => {
  vi.mocked(api.get).mockResolvedValue([{ org_id: 2, org_nome: 'Outra empresa', office_slug: 'conteudo', office: {} }])
  render(<MemoryRouter initialEntries={['/app?org=1&slug=juris']}><AppShell /></MemoryRouter>)
  await screen.findByText('Este espaço não está disponível para sua conta.')
  expect(screen.queryByText('Área de trabalho')).toBeNull()
  expect(api.get).not.toHaveBeenCalledWith('/predios/2/conteudo')
})
it('empresa sem andares também entra pelo chat geral', async () => {
  vi.mocked(api.get).mockResolvedValue([{ id: 7, nome: 'Nova empresa' }])
  render(<MemoryRouter initialEntries={['/app']}><AppShell /></MemoryRouter>)
  await screen.findByText('Início da empresa 7')
  expect(api.get).toHaveBeenCalledWith('/orgs')
})
it('identificador inválido não escolhe uma empresa silenciosamente', () => {
  render(<MemoryRouter initialEntries={['/app?org=incorreto']}><AppShell /></MemoryRouter>)
  expect(screen.getByText('Endereço da empresa inválido.')).toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalled()
})

it.each(['/app?org=', '/app?org=9007199254740993', '/app?org=0&slug=conteudo', '/app?slug=conteudo', '/app?org=1&slug='])('não ignora contexto explícito inválido: %s', (url) => {
  render(<MemoryRouter initialEntries={[url]}><AppShell /></MemoryRouter>)
  expect(screen.getByText('Endereço da empresa inválido.')).toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalled()
})

it('admin abre um andar por link direto mesmo sem memberships', async () => {
  auth.usuario.is_admin = true
  vi.mocked(api.get).mockImplementation(async (path) => path === '/predios' ? [] : path.endsWith('/stats') ? {} : { office: { nome: 'Escritório autorizado' } })
  render(<MemoryRouter initialEntries={['/app?org=7&slug=conteudo']}><AppShell /></MemoryRouter>)
  expect(await screen.findByText('Escritório autorizado')).toBeInTheDocument()
  expect(screen.queryByText('Você ainda não tem um escritório')).toBeNull()
})

it('erro de rede na lista permite tentar novamente sem afirmar revogação', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('rede'))
  render(<MemoryRouter initialEntries={['/app?org=7&slug=conteudo']}><AppShell /></MemoryRouter>)
  expect(await screen.findByText('Não foi possível carregar seus acessos.')).toBeInTheDocument()
  vi.mocked(api.get).mockImplementation(async (path) => path === '/predios' ? [{ org_id: 7, office_slug: 'conteudo' }] : path.endsWith('/stats') ? {} : { office: { nome: 'Conteúdo' } })
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('Conteúdo')).toBeInTheDocument()
})

it('troca de empresa não mostra detalhe anterior nem aceita resposta atrasada', async () => {
  let resolverPrimeira!: (value: unknown) => void
  const primeira = new Promise((resolve) => { resolverPrimeira = resolve })
  vi.mocked(api.get).mockImplementation((path) => Promise.resolve(path === '/predios'
    ? [{ org_id: 1, office_slug: 'conteudo' }, { org_id: 2, office_slug: 'conteudo' }]
    : path.endsWith('/stats') ? {} : path === '/predios/1/conteudo' ? primeira : { office: { nome: 'Segunda empresa' } }))
  render(<MemoryRouter initialEntries={['/app?org=1&slug=conteudo']}><Link to="/app?org=2&slug=conteudo">Trocar empresa</Link><AppShell /></MemoryRouter>)
  await screen.findByText('Carregando área')
  fireEvent.click(screen.getByText('Trocar empresa'))
  expect(await screen.findByText('Segunda empresa')).toBeInTheDocument()
  await act(async () => resolverPrimeira({ office: { nome: 'Primeira empresa' } }))
  expect(screen.queryByText('Primeira empresa')).toBeNull()
  expect(screen.getByText('Segunda empresa')).toBeInTheDocument()
})

it('link do andar usa a mesma interface sem descartar o histórico da área', async () => {
  vi.mocked(api.get).mockImplementation(async (path) => path === '/predios' ? [{ org_id: 7, office_slug: 'conteudo' }] : { office: { nome: 'Conteúdo e Marca' } })
  render(<MemoryRouter initialEntries={['/app?org=7&slug=conteudo']}><AppShell /></MemoryRouter>)
  expect(await screen.findByText('Início da empresa 7')).toBeInTheDocument()
  expect(screen.getByText('Conteúdo e Marca')).toBeInTheDocument()
  expect(screen.queryByText('Área de trabalho')).toBeNull()
})
