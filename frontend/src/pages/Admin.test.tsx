import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AdminPage, { SecaoCriarOrg } from './Admin'
import { api, ApiError } from '../lib/api'

const toast = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn() }))
vi.mock('../components/Toasts', () => ({ useToasts: () => toast }))
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } }))
const offices = [{ slug: 'conteudo', nome: 'Conteúdo e marca', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }]

it('seleciona somente o perfil financeiro escolhido e omite arquivados de novos cadastros', async () => {
  vi.mocked(api.post).mockResolvedValue({})
  const catalogo = [
    ...offices,
    { ...offices[0], slug: 'assistente-pf', nome: 'Assistente Financeiro Pessoal' },
    { ...offices[0], slug: 'assistente-pme', nome: 'Assistente Financeiro Empresarial' },
    { ...offices[0], slug: 'financeiro', nome: 'Consultoria Financeira' },
    { ...offices[0], slug: 'teste', nome: 'teste', arquivado: true },
  ]
  render(<SecaoCriarOrg offices={catalogo} aoCriar={vi.fn()} />)
  expect(screen.getByText('Marketing & Conteúdo')).toBeVisible()
  expect(screen.getByText('Finanças')).toBeVisible()
  expect(screen.queryByLabelText('teste')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Finanças'))
  fireEvent.click(screen.getByLabelText('Pessoal'))
  expect(screen.getByLabelText('Empresa')).not.toBeChecked()
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome' }), { target: { value: 'Cliente financeiro' } })
  fireEvent.change(screen.getByLabelText('E-mail de quem administra'), { target: { value: 'pessoa@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Criar cliente' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/orgs', expect.objectContaining({ offices: ['assistente-pf'] })))
})

it('demo ignora o conteúdo arquivado e escolhe somente um serviço disponível', async () => {
  vi.mocked(api.post).mockResolvedValue({})
  render(<SecaoCriarOrg offices={[{ ...offices[0], arquivado: true }, { ...offices[0], slug: 'assistente-pf', nome: 'Pessoal' }]} aoCriar={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
  fireEvent.click(screen.getByRole('button', { name: 'Criar cliente' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/orgs', expect.objectContaining({ offices: ['assistente-pf'], enviar_email: false })))
})

it('serviço arquivado já concedido permanece na organização mas não é oferecido novamente', async () => {
  vi.mocked(api.get).mockImplementation(async endpoint => endpoint === '/offices'
    ? [...offices, { ...offices[0], slug: 'teste', nome: 'teste', arquivado: true }, { ...offices[0], slug: 'assistente-pf', nome: 'Assistente Financeiro Pessoal' }]
    : endpoint === '/admin/orgs' ? [{ id: 3, nome: 'Cliente existente', slug: 'existente', offices: ['teste'] }] : [])
  render(<AdminPage />)
  await screen.findByText('Cliente existente')
  expect(screen.getByRole('button', { name: 'Remover teste' })).toBeInTheDocument()
  const seletor = screen.getByRole('combobox', { name: 'Escritório a conceder a Cliente existente' })
  expect(within(seletor).queryByRole('option', { name: 'teste' })).not.toBeInTheDocument()
  expect(within(seletor).getByRole('group', { name: 'Finanças' })).toBeInTheDocument()
})
const dialogPrototype = HTMLDialogElement.prototype
const dialogMethods = Object.fromEntries(['showModal', 'close'].map(name => [name, Object.getOwnPropertyDescriptor(dialogPrototype, name)]))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.get).mockResolvedValue([])
  Object.defineProperties(dialogPrototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } },
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const [name, descriptor] of Object.entries(dialogMethods)) {
    if (descriptor) Object.defineProperty(dialogPrototype, name, descriptor)
    else Reflect.deleteProperty(dialogPrototype, name)
  }
})

it.each([['Teste', 'teste'], ['Demo', 'demo']])('%s cria empresa e acesso separados, orienta o preparo da IA e não duplica o pedido', async (tipo, prefixo) => {
  let concluir!: (value: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { concluir = r }))
  const atualizar = vi.fn()
  render(<SecaoCriarOrg offices={offices} aoCriar={atualizar} />)
  fireEvent.click(screen.getByRole('button', { name: tipo }))
  const email = (screen.getByLabelText('E-mail de quem administra') as HTMLInputElement).value
  expect(email).toMatch(new RegExp(`^${prefixo}-.+@example.com$`))
  fireEvent.click(screen.getByRole('button', { name: 'Criar cliente' }))
  fireEvent.submit(screen.getByRole('button', { name: 'Criando…' }).closest('form')!)
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(api.post).toHaveBeenCalledWith('/admin/orgs', expect.objectContaining({ owner_email: email, offices: ['conteudo'], enviar_email: false }))
  await act(async () => { concluir({ convite_owner: { email, link: 'https://example.invalid/convite/teste', email_enviado: false } }) })
  const link = screen.getByRole('textbox', { name: 'Link do convite' })
  expect(link).toBeVisible()
  expect(link).toHaveValue('https://example.invalid/convite/teste')
  const preparo = screen.getByText('Antes de testar o chat, prepare a conexão em Contratos e IA. Criar a demo não configura IA nem libera saldo.')
  expect(preparo).toBeVisible()
  expect(atualizar).toHaveBeenCalledTimes(1)
  const before = toast.sucesso.mock.calls.length
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
  fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }))
  await waitFor(() => expect(toast.falha).toHaveBeenCalledWith(expect.stringContaining('copie manualmente')))
  expect(toast.sucesso.mock.calls.length).toBe(before)
  fireEvent.click(screen.getByRole('button', { name: 'Cliente' }))
  expect(preparo).toBeVisible()
})

it('clientes ficam na entrada, operação não carrega antes de abrir e o link sobrevive à navegação', async () => {
  vi.mocked(api.get).mockImplementation(async endpoint => endpoint === '/offices' ? offices : endpoint === '/admin/orgs' ? [{ id: 3, nome: 'Demo existente', slug: 'demo-existente', motor_modo: 'cli', offices: ['conteudo'] }] : [])
  vi.mocked(api.post).mockResolvedValue({ convite_owner: { email: 'demo@example.com', link: 'https://example.invalid/convite/demo', email_enviado: false } })
  render(<AdminPage />)
  expect(await screen.findByText('Demo existente')).toBeVisible()
  expect(screen.getByText('App local')).toBeVisible()
  expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/stats'))
  fireEvent.click(screen.getByRole('button', { name: 'Novo cliente' }))
  fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
  fireEvent.click(screen.getByRole('button', { name: 'Criar cliente' }))
  expect(await screen.findByDisplayValue('https://example.invalid/convite/demo')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Pessoas e acessos' }))
  expect(screen.getByDisplayValue('https://example.invalid/convite/demo')).not.toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Novo cliente' }))
  expect(screen.getByDisplayValue('https://example.invalid/convite/demo')).toBeVisible()
})


async function abrirExclusao() {
  vi.mocked(api.get).mockImplementation(async endpoint => endpoint === '/offices' ? offices : endpoint === '/admin/orgs' ? [{ id: 3, nome: 'Demo existente', slug: 'demo-existente', motor_modo: 'cli', offices: ['conteudo'] }] : [])
  const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('prompt() is not supported') })
  render(<AdminPage />)
  await screen.findByText('Demo existente')
  fireEvent.click(screen.getByText('Gerenciar'))
  fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
  return { dialog: await screen.findByRole('dialog', { name: 'Excluir organização' }), prompt }
}

it('link de acesso abre o formulário no admin sem depender de prompt nativo', async () => {
  vi.mocked(api.get).mockImplementation(async endpoint => endpoint === '/admin/orgs' ? [{ id: 3, nome: 'Demo existente', slug: 'demo-existente', offices: [] }] : [])
  const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('prompt() is not supported') })
  render(<AdminPage />)
  await screen.findByText('Demo existente')
  fireEvent.click(screen.getByText('Gerenciar'))
  fireEvent.click(screen.getByRole('button', { name: 'Link de acesso' }))
  const dialog = await screen.findByRole('dialog', { name: 'Link de acesso' })
  expect(within(dialog).getByLabelText('E-mail de acesso')).toHaveValue('')
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(prompt).not.toHaveBeenCalled()
})

it('confirma a exclusão no aplicativo com identificador exato e permite cancelar sem pedido', async () => {
  const { dialog, prompt } = await abrirExclusao()
  expect(dialog).toHaveTextContent('Demo existente')
  expect(dialog).toHaveTextContent('demo-existente')
  expect(dialog).toHaveTextContent(/Não há desfazer/i)
  const campo = within(dialog).getByLabelText('Digite o identificador para confirmar')
  const excluir = within(dialog).getByRole('button', { name: 'Excluir definitivamente' })
  expect(excluir).toBeDisabled()
  for (const valor of ['demo', ' demo-existente', 'demo-existente ', 'DEMO-EXISTENTE']) {
    fireEvent.change(campo, { target: { value: valor } })
    expect(excluir).toBeDisabled()
    fireEvent.submit(excluir.closest('form')!)
    expect(api.del).not.toHaveBeenCalled()
  }
  fireEvent.change(campo, { target: { value: 'demo-existente' } })
  expect(excluir).toBeEnabled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
  expect(screen.queryByRole('dialog', { name: 'Excluir organização' })).not.toBeInTheDocument()
  expect(api.del).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
  const reaberto = await screen.findByRole('dialog', { name: 'Excluir organização' })
  expect(within(reaberto).getByLabelText('Digite o identificador para confirmar')).toHaveValue('')
  expect(within(reaberto).getByRole('button', { name: 'Excluir definitivamente' })).toBeDisabled()
  expect(prompt).not.toHaveBeenCalled()
})

it('envia a exclusão só após confirmar e impede dois pedidos enquanto aguarda a resposta', async () => {
  let concluir!: (value: unknown) => void
  vi.mocked(api.del).mockImplementation(() => new Promise(r => { concluir = r }))
  const { dialog, prompt } = await abrirExclusao()
  fireEvent.change(within(dialog).getByLabelText('Digite o identificador para confirmar'), { target: { value: 'demo-existente' } })
  expect(api.del).not.toHaveBeenCalled()
  const botao = within(dialog).getByRole('button', { name: 'Excluir definitivamente' })
  const form = botao.closest('form')!
  act(() => {
    fireEvent.submit(form)
    fireEvent.submit(form)
  })
  expect(api.del).toHaveBeenCalledTimes(1)
  expect(api.del).toHaveBeenCalledWith('/admin/orgs/3', { confirmar_slug: 'demo-existente' })
  expect(botao).toBeDisabled()
  await act(async () => { concluir({ apagado: { limpeza_arquivos_pendente: 0 } }) })
  expect(screen.queryByRole('dialog', { name: 'Excluir organização' })).not.toBeInTheDocument()
  expect(toast.sucesso).toHaveBeenCalledWith('Organização Demo existente excluída.')
  expect(prompt).not.toHaveBeenCalled()
})

it('mantém o diálogo aberto com erro da API e permite tentar a exclusão novamente', async () => {
  vi.mocked(api.del).mockRejectedValueOnce(new ApiError(409, 'A organização ainda tem uma operação em andamento.')).mockResolvedValue({ apagado: {} })
  const { dialog, prompt } = await abrirExclusao()
  const campo = within(dialog).getByLabelText('Digite o identificador para confirmar')
  fireEvent.change(campo, { target: { value: 'demo-existente' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir definitivamente' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('A organização ainda tem uma operação em andamento.')
  expect(dialog).toBeVisible()
  expect(campo).toHaveValue('demo-existente')
  const tentar = within(dialog).getByRole('button', { name: 'Excluir definitivamente' })
  expect(tentar).toBeEnabled()
  fireEvent.click(tentar)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Excluir organização' })).not.toBeInTheDocument())
  expect(api.del).toHaveBeenCalledTimes(2)
  expect(prompt).not.toHaveBeenCalled()
})

it('a exclusão confirmada avisa quando restam arquivos no armazenamento', async () => {
  vi.mocked(api.del).mockResolvedValue({ apagado: { limpeza_arquivos_pendente: 1 } })
  const { dialog, prompt } = await abrirExclusao()
  fireEvent.change(within(dialog).getByLabelText('Digite o identificador para confirmar'), { target: { value: 'demo-existente' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir definitivamente' }))
  await waitFor(() => expect(toast.falha).toHaveBeenCalledWith(expect.stringContaining('A remoção dos arquivos ficou pendente')))
  expect(api.del).toHaveBeenCalledWith('/admin/orgs/3', { confirmar_slug: 'demo-existente' })
  expect(toast.sucesso).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog', { name: 'Excluir organização' })).not.toBeInTheDocument()
  expect(prompt).not.toHaveBeenCalled()
})
