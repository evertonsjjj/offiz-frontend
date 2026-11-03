import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError } from '../lib/api'
import { instalarDialogoDeTeste } from '../test/dialog'
import { SecaoEstudioMidia, SecaoMcpKeys, SecaoTribunais } from './ConfigOrg'

const toasts = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }))
vi.mock('../lib/api', async original => ({
  ...await original<typeof import('../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
}))
vi.mock('../components/Toasts', () => ({ useToasts: () => toasts }))
instalarDialogoDeTeste()

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('Diálogo nativo indisponível no app') })
})

it('cancelar a remoção de mídia preserva a chave digitada e retorna o foco', async () => {
  vi.mocked(api.get).mockResolvedValue({ midia: { falai: true, elevenlabs: true } })
  render(<SecaoEstudioMidia orgId={1} />)
  const campo = await screen.findByLabelText('API key da fal.ai')
  fireEvent.change(campo, { target: { value: 'rascunho-sintetico-nao-real' } })
  const limpar = screen.getAllByRole('button', { name: 'Limpar' })[0]
  limpar.focus()
  fireEvent.click(limpar)
  const dialogo = await screen.findByRole('dialog', { name: 'Remover chave do provedor' })
  expect(within(dialogo).getByText(/fal.ai/)).toBeVisible()
  expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.keyDown(dialogo, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(campo).toHaveValue('rascunho-sintetico-nao-real')
  expect(limpar).toHaveFocus()
  expect(api.put).not.toHaveBeenCalled()
  expect(window.confirm).not.toHaveBeenCalled()
})

it('confirma apenas o provedor escolhido e bloqueia nova remoção durante a resposta', async () => {
  vi.mocked(api.get).mockResolvedValue({ midia: { falai: true, elevenlabs: true } })
  let concluir!: (resposta: { midia: { falai: boolean; elevenlabs: boolean } }) => void
  vi.mocked(api.put).mockImplementation(() => new Promise(resolve => { concluir = resolve }))
  render(<SecaoEstudioMidia orgId={1} />)
  fireEvent.click((await screen.findAllByRole('button', { name: 'Limpar' }))[0])
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remover chave' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledExactlyOnceWith('/orgs/1/midia-keys', { falai_api_key: '' }))
  expect(screen.getByRole('button', { name: 'Limpando…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Limpar' })).toBeDisabled()
  concluir({ midia: { falai: false, elevenlabs: true } })
  expect(await screen.findByText('Não configurada')).toBeVisible()
  expect(screen.getByText('✓ Configurada')).toBeVisible()
  expect(api.del).not.toHaveBeenCalled()
  expect(window.confirm).not.toHaveBeenCalled()
})

it('trocar de empresa cancela uma confirmação de chave ainda aberta', async () => {
  vi.mocked(api.get).mockResolvedValue({ midia: { falai: true, elevenlabs: false } })
  const tela = render(<SecaoEstudioMidia orgId={1} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Limpar' }))
  await screen.findByRole('dialog')
  tela.rerender(<SecaoEstudioMidia orgId={2} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.put).not.toHaveBeenCalled()
  expect(api.del).not.toHaveBeenCalled()
})

it('erro ao revogar MCP conserva a linha para nova tentativa explícita', async () => {
  vi.mocked(api.get).mockResolvedValue([{ id: 12, key_prefix: 'offiz-fixture', criado_em: null }])
  vi.mocked(api.del).mockRejectedValue(new ApiError(503, 'Serviço temporariamente indisponível'))
  render(<SecaoMcpKeys orgId={1} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Revogar' }))
  const dialogo = await screen.findByRole('dialog', { name: 'Revogar chave de acesso' })
  expect(within(dialogo).getByText(/offiz-fixture/)).toBeVisible()
  expect(within(dialogo).getByText(/perdem o acesso/)).toBeVisible()
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Revogar chave' }))
  await waitFor(() => expect(toasts.falha).toHaveBeenCalledWith('Serviço temporariamente indisponível'))
  expect(api.del).toHaveBeenCalledExactlyOnceWith('/orgs/1/mcp-keys/12')
  expect(screen.getByText('offiz-fixture…')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Revogar' })).toBeEnabled()
  expect(toasts.sucesso).not.toHaveBeenCalled()
})

it('a credencial removida é identificada pelo tribunal e cancelar não chama DELETE', async () => {
  vi.mocked(api.get).mockResolvedValue({ credenciais: [
    { tribunal: 'trt2', sistema: 'pje', tipo: 'certificado_a1', valido: true },
    { tribunal: 'tjsp', sistema: 'esaj', tipo: 'login_senha', valido: true },
  ] })
  render(<SecaoTribunais orgId={1} />)
  const item = (await screen.findByText('e-SAJ · TJSP')).closest('.tribunais-item') as HTMLElement
  fireEvent.click(within(item).getByRole('button', { name: 'Remover' }))
  const dialogo = await screen.findByRole('dialog', { name: 'Remover credencial do tribunal' })
  expect(within(dialogo).getByText(/TJSP/i)).toBeVisible()
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
  expect(api.del).not.toHaveBeenCalled()
  expect(screen.getByText('e-SAJ · TJSP')).toBeVisible()
  expect(window.confirm).not.toHaveBeenCalled()
})
