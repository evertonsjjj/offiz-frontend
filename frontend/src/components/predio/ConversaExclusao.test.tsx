import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversaTab } from './ConversaTab'
import { api, setTokens } from '../../lib/api'
import { instalarDialogoDeTeste } from '../../test/dialog'

instalarDialogoDeTeste()
const avisos = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }))
vi.mock('../Toasts', () => ({ useToasts: () => avisos }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn(), del: vi.fn() } }))
const office = { slug: 'predio', nome: 'Clube Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const detalhe = { id: 42, organization_id: 1, office_slug: null, titulo: 'Campanha da camisa', atualizado_em: '2026-10-09T12:00:00Z', total_mensagens: 1, mensagens: [{ id: 99, role: 'assistant', conteudo: 'Histórico da campanha' }], anexos: [] }
const conteudo = (orgId = 1) => <MemoryRouter><ConversaTab orgId={orgId} slug="predio" office={office} nivelPredio /></MemoryRouter>
async function abrirExclusao() {
  const origem = await screen.findByRole('button', { name: 'Opções da conversa Campanha da camisa' })
  origem.focus()
  fireEvent.click(origem)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }))
  return origem
}

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  setTokens('sintetico', 'sintetico')
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/1/predio/conversas' ? { conversas: [detalhe] } : path === '/conversas/42' ? detalhe : { conversas: [] })
  vi.mocked(api.del).mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

it('confirma dentro do app e cancelar conserva o pedido digitado', async () => {
  const nativo = vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('Host sem confirm') })
  render(conteudo())
  await screen.findByRole('button', { name: 'Opções da conversa Campanha da camisa' })
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Pedido ainda não enviado' } })
  const excluir = await abrirExclusao()
  expect(screen.getByRole('dialog', { name: 'Excluir conversa' })).toHaveTextContent('Isso não pode ser desfeito')
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(campo).toHaveValue('Pedido ainda não enviado')
  expect(excluir).toHaveFocus()
  expect(api.del).not.toHaveBeenCalled()
  expect(nativo).not.toHaveBeenCalled()
})

it('aceitar remove só a conversa escolhida e bloqueia repetição durante a resposta', async () => {
  let concluir!: () => void
  vi.mocked(api.del).mockImplementation(() => new Promise<void>(resolve => { concluir = resolve }))
  render(conteudo())
  const excluir = await abrirExclusao()
  fireEvent.click(screen.getByRole('button', { name: 'Excluir conversa' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledWith('/conversas/42'))
  expect(excluir).toBeDisabled()
  fireEvent.click(excluir)
  expect(api.del).toHaveBeenCalledOnce()
  await act(async () => concluir())
  expect(screen.queryByRole('button', { name: 'Opções da conversa Campanha da camisa' })).not.toBeInTheDocument()
})

it('falha de exclusão conserva a conversa para tentar de novo', async () => {
  vi.mocked(api.del).mockRejectedValue(new Error('Sem conexão'))
  render(conteudo())
  await abrirExclusao()
  fireEvent.click(screen.getByRole('button', { name: 'Excluir conversa' }))
  await waitFor(() => expect(avisos.falha).toHaveBeenCalledWith('Não foi possível excluir a conversa.'))
  expect(screen.getByRole('button', { name: 'Opções da conversa Campanha da camisa' })).not.toBeDisabled()
})

it('mudar de empresa cancela confirmação antiga sem excluir nem avisar sucesso', async () => {
  const tela = render(conteudo())
  await abrirExclusao()
  await act(async () => tela.rerender(conteudo(2)))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.del).not.toHaveBeenCalled()
  expect(avisos.sucesso).not.toHaveBeenCalled()
})
