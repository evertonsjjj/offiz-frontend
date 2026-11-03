import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DialogoLinkAcesso, ConvitesPendentesAdmin } from './AdminAcessos'
import { api, ApiError } from '../lib/api'

const toast = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn() }))
vi.mock('./Toasts', () => ({ useToasts: () => toast }))
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), post: vi.fn() } }))
const destino = { id: 3, nome: 'Demo exemplo' }
const resposta = { email: 'demo@example.com', link: 'https://example.invalid/convite/novo', email_enviado: false, expira_em_dias: 7, aviso: null }
const pendente = { id: 8, organization_id: 3, org_nome: 'Demo exemplo', email: 'demo@example.com', role: 'member', expira_em: '2026-09-29T12:00:00Z' }
const dialogPrototype = HTMLDialogElement.prototype
const dialogMethods = Object.fromEntries(['showModal', 'close'].map(name => [name, Object.getOwnPropertyDescriptor(dialogPrototype, name)]))
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperties(dialogPrototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', '') } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open') } },
  })
  vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('prompt() is not supported') })
  vi.mocked(api.post).mockResolvedValue(resposta)
  vi.mocked(api.get).mockResolvedValue([pendente])
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  for (const [name, descriptor] of Object.entries(dialogMethods)) {
    if (descriptor) Object.defineProperty(dialogPrototype, name, descriptor)
    else Reflect.deleteProperty(dialogPrototype, name)
  }
})

it('abre um campo real e cancela sem gerar link nem chamar prompt', () => {
  const fechar = vi.fn()
  render(<DialogoLinkAcesso destino={destino} aoFechar={fechar} aoGerar={vi.fn()} />)
  expect(screen.getByRole('dialog')).toHaveTextContent(destino.nome)
  const campo = screen.getByLabelText('E-mail de acesso')
  expect(campo).toHaveValue('')
  fireEvent.change(campo, { target: { value: 'invalido' } })
  fireEvent.submit(screen.getByRole('button', { name: 'Gerar link' }).closest('form')!)
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(fechar).toHaveBeenCalledTimes(1)
  expect(window.prompt).not.toHaveBeenCalled()
})

it('normaliza o e-mail, bloqueia envio duplicado e mantém o convite para copiar', async () => {
  let concluir!: (value: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { concluir = resolve }))
  const atualizar = vi.fn(), fechar = vi.fn(), copiar = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText: copiar } })
  render(<DialogoLinkAcesso destino={destino} aoFechar={fechar} aoGerar={atualizar} />)
  fireEvent.change(screen.getByLabelText('E-mail de acesso'), { target: { value: 'Demo@Example.com' } })
  const form = screen.getByRole('button', { name: 'Gerar link' }).closest('form')!
  act(() => { fireEvent.submit(form); fireEvent.submit(form) })
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/admin/orgs/3/convite-acesso', { email: 'demo@example.com' })
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }))
  expect(fechar).not.toHaveBeenCalled()
  await act(async () => { concluir(resposta) })
  expect(screen.getByLabelText('Link do convite')).toHaveValue(resposta.link)
  expect(atualizar).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }))
  await waitFor(() => expect(copiar).toHaveBeenCalledWith(resposta.link))
  expect(window.prompt).not.toHaveBeenCalled()
})

it('conserva o e-mail após erro da API e permite tentar novamente', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, 'Limite de assentos atingido.')).mockResolvedValue(resposta)
  render(<DialogoLinkAcesso destino={destino} aoFechar={vi.fn()} aoGerar={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('E-mail de acesso'), { target: { value: 'demo@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Gerar link' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Limite de assentos atingido.')
  expect(screen.getByLabelText('E-mail de acesso')).toHaveValue('demo@example.com')
  fireEvent.click(screen.getByRole('button', { name: 'Gerar link' }))
  expect(await screen.findByLabelText('Link do convite')).toHaveValue(resposta.link)
})

it('lista o convite sem conta criada e regenera preservando organização, e-mail e papel', async () => {
  render(<ConvitesPendentesAdmin ativo revisao={1} aoMudar={vi.fn()} />)
  expect(await screen.findByText('demo@example.com')).toBeVisible()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ausente' } })
  expect(screen.getByText('Nenhum convite pendente encontrado.')).toBeVisible()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Demo exemplo' } })
  fireEvent.click(screen.getByRole('button', { name: 'Gerar novo link' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByLabelText('E-mail de acesso')).toHaveAttribute('readonly')
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Gerar link' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/admin/orgs/3/convite-acesso', { email: 'demo@example.com', role: 'member' }))
})

it('recarrega ao voltar à aba e distingue falha de lista vazia', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([pendente])
  const view = render(<ConvitesPendentesAdmin ativo={false} revisao={1} aoMudar={vi.fn()} />)
  expect(api.get).not.toHaveBeenCalled()
  view.rerender(<ConvitesPendentesAdmin ativo revisao={1} aoMudar={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível listar os convites.')
  expect(screen.queryByText('Nenhum convite pendente encontrado.')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('demo@example.com')).toBeVisible()
  vi.mocked(api.get).mockResolvedValue([])
  view.rerender(<ConvitesPendentesAdmin ativo revisao={2} aoMudar={vi.fn()} />)
  expect(await screen.findByText('Nenhum convite pendente encontrado.')).toBeVisible()
})

it('mudar o destino do convite separa formulário, conta e resposta tardia', async () => {
  let concluir!: (valor: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { concluir = r }))
  const atualizar = vi.fn()
  const view = render(<DialogoLinkAcesso destino={destino} aoFechar={vi.fn()} aoGerar={atualizar} />)
  fireEvent.change(screen.getByLabelText('E-mail de acesso'), { target: { value: 'demo@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Gerar link' }))
  view.rerender(<DialogoLinkAcesso destino={{ id: 9, nome: 'Outro cliente', email: 'outro@example.invalid' }} aoFechar={vi.fn()} aoGerar={atualizar} />)
  expect(screen.getByLabelText('E-mail de acesso')).toHaveValue('outro@example.invalid')
  await act(async () => concluir(resposta))
  expect(screen.getByRole('dialog')).toHaveTextContent('Outro cliente')
  expect(screen.queryByLabelText('Link do convite')).not.toBeInTheDocument()
  expect(atualizar).not.toHaveBeenCalled()
})

it('cópia pendente é única e falha conserva o link selecionado para copiar manualmente', async () => {
  let rejeitar!: (erro: Error) => void
  const copiar = vi.fn(() => new Promise<void>((_, rejeita) => { rejeitar = rejeita }))
  vi.stubGlobal('navigator', { clipboard: { writeText: copiar } })
  render(<DialogoLinkAcesso destino={{ ...destino, email: resposta.email }} aoFechar={vi.fn()} aoGerar={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Gerar link' }))
  const link = await screen.findByLabelText('Link do convite')
  const botao = screen.getByRole('button', { name: 'Copiar link' })
  act(() => { fireEvent.click(botao); fireEvent.click(botao) })
  expect(copiar).toHaveBeenCalledTimes(1)
  expect(botao).toBeDisabled()
  await act(async () => rejeitar(new Error('bloqueado')))
  expect(link).toHaveFocus()
  expect(link).toHaveValue(resposta.link)
  expect(toast.falha).toHaveBeenCalledWith(expect.stringContaining('copie manualmente'))
  expect(toast.sucesso).not.toHaveBeenCalled()
  expect(botao).toBeEnabled()
})

it('convite fechado enquanto copia não anuncia sucesso na tela seguinte', async () => {
  let concluir!: () => void
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => new Promise<void>(r => { concluir = r })) } })
  const view = render(<DialogoLinkAcesso destino={{ ...destino, email: resposta.email }} aoFechar={vi.fn()} aoGerar={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Gerar link' }))
  await screen.findByLabelText('Link do convite')
  fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }))
  view.unmount()
  await act(async () => concluir())
  expect(toast.sucesso).not.toHaveBeenCalled()
  expect(toast.falha).not.toHaveBeenCalled()
})

it('consulta anterior não substitui convites atualizados e sair fecha a geração de link', async () => {
  let concluir!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(r => { concluir = r })).mockResolvedValue([pendente])
  const view = render(<ConvitesPendentesAdmin ativo revisao={1} aoMudar={vi.fn()} />)
  view.rerender(<ConvitesPendentesAdmin ativo revisao={2} aoMudar={vi.fn()} />)
  expect(await screen.findByText(pendente.email)).toBeVisible()
  await act(async () => concluir([]))
  expect(screen.getByText(pendente.email)).toBeVisible()
  expect(screen.queryByText('Nenhum convite pendente encontrado.')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Gerar novo link' }))
  view.rerender(<ConvitesPendentesAdmin ativo={false} revisao={2} aoMudar={vi.fn()} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
