import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import AdminPage from './Admin'
import { instalarDialogoDeTeste } from '../test/dialog'

instalarDialogoDeTeste()

const { traduzir, sucesso, falha } = vi.hoisted(() => ({
  traduzir: (_pt: string, en: string) => en,
  sucesso: vi.fn(),
  falha: vi.fn(),
}))
vi.mock('../lib/i18n', () => ({ useIdioma: () => ({ t: traduzir, idioma: 'en' }) }))
vi.mock('../components/Toasts', () => ({ useToasts: () => ({ sucesso, falha }) }))
vi.mock('../lib/api', async (original) => ({
  ...await original<typeof import('../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/offices') return [{ slug: 'juris', nome: 'Jurídico da João', tema: {} }]
    if (path === '/admin/orgs') return [{ id: 5, nome: 'Empresa João', slug: 'empresa-joao', status: 'ativa', offices: ['juris'] }]
    if (path === '/admin/usuarios') return [{ id: 23, nome: 'Mônica', email: 'monica@example.test', is_admin: false, pode_excluir: true, orgs: [{ id: 5, nome: 'Empresa João', role: 'member' }] }]
    if (path === '/admin/convites') return []
    if (path === '/admin/storage') return { orgs: [], total_bytes: 1234, orfaos_bytes: 0, storage_dir: 'local' }
    if (path.startsWith('/admin/stats')) return { jobs_por_status: { done: 2 }, jobs_total: 2, custo_brl: 1234.56, organizations: 1, usuarios: 1 }
    if (path.startsWith('/admin/auditoria')) return []
    throw new Error(`Unexpected GET ${path}`)
  })
  vi.mocked(api.post).mockResolvedValue({})
})

it('admin em inglês mantém nomes, slug e concessões originais ao criar a organização', async () => {
  render(<AdminPage />)
  expect(screen.getByRole('heading', { name: 'Administration' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'New client' }))
  expect(await screen.findByRole('checkbox', { name: 'Jurídico da João' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'People and access' }))
  expect(await screen.findByText('Mônica')).toBeInTheDocument()
  expect(screen.getByTitle('Empresa João — member')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Operations and history' }))
  expect(await screen.findByRole('heading', { name: 'Storage by company' })).toBeInTheDocument()
  expect(await screen.findByText(/R\$1,234\.56/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clients and demos' }))

  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Relações com clientes' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Administrator email' }), { target: { value: 'dono@example.test' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Jurídico da João' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create client' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/admin/orgs', {
    nome: 'Relações com clientes', slug: 'relacoes-com-clientes', owner_email: 'dono@example.test', offices: ['juris'], enviar_email: true,
  }))
  expect(sucesso).toHaveBeenCalledWith('Organization “Relações com clientes” created.')
})

it('confirmação de exclusão em inglês preserva identidade e exige o mesmo e-mail', async () => {
  const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('Native prompt must not be used') })
  render(<AdminPage />)
  fireEvent.click(screen.getByRole('button', { name: 'People and access' }))
  const nome = await screen.findByText('Mônica')
  fireEvent.click(within(nome.closest('tr')!).getByRole('button', { name: 'Delete' }))
  const dialogo = screen.getByRole('dialog', { name: 'Delete user account' })
  expect(dialogo).toHaveTextContent('DELETE Mônica’s account?')
  expect(dialogo).toHaveTextContent('Type the email “monica@example.test” to confirm:')
  const campo = within(dialogo).getByRole('textbox', { name: 'Email to confirm deletion' })
  fireEvent.change(campo, { target: { value: 'outra@example.test' } })
  fireEvent.submit(campo.closest('form')!)
  expect(api.del).not.toHaveBeenCalled()
  expect(within(dialogo).getByRole('alert')).toHaveTextContent('The email does not match. Nothing was deleted.')
  expect(campo).toHaveValue('outra@example.test')
  expect(prompt).not.toHaveBeenCalled()
  prompt.mockRestore()
})

it('diálogo de exclusão da organização traduz controles e preserva nome e identificador', async () => {
  const prototype = HTMLDialogElement.prototype
  const originais = Object.fromEntries(['showModal', 'close'].map(name => [name, Object.getOwnPropertyDescriptor(prototype, name)]))
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } },
  })
  const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('prompt() is not supported') })
  const view = render(<AdminPage />)
  try {
    const clientes = within(screen.getByRole('heading', { name: 'Your clients' }).closest('section')!)
    const nome = await clientes.findByText('Empresa João')
    const linha = within(nome.closest('tr')!)
    fireEvent.click(linha.getByText('Manage'))
    fireEvent.click(linha.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete organization' })
    expect(dialog).toHaveTextContent('Empresa João')
    expect(dialog).toHaveTextContent('empresa-joao')
    expect(dialog).toHaveTextContent('This cannot be undone.')
    const confirmar = within(dialog).getByRole('button', { name: 'Delete permanently' })
    expect(confirmar).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Type the identifier to confirm'), { target: { value: 'empresa-joao' } })
    expect(confirmar).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Delete organization' })).not.toBeInTheDocument()
    expect(api.del).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    prompt.mockRestore()
    for (const [name, descriptor] of Object.entries(originais)) {
      if (descriptor) Object.defineProperty(prototype, name, descriptor)
      else Reflect.deleteProperty(prototype, name)
    }
  }
})
