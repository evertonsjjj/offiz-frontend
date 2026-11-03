import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { SecaoTribunais } from './ConfigOrg'

const toasts = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn() }))
vi.mock('../lib/api', async (original) => ({
  ...await original<typeof import('../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), putForm: vi.fn() },
}))
vi.mock('../components/Toasts', () => ({ useToasts: () => toasts }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.get).mockResolvedValue({
    credenciais: [
      { tribunal: 'trt2', sistema: 'pje', tipo: 'certificado_a1', valido: true },
      { tribunal: 'tjsp', sistema: 'esaj', tipo: 'login_senha', valido: true },
    ],
  })
})

it('distingue validação local de acesso e impede testar integração não implementada', async () => {
  render(<SecaoTribunais orgId={1} />)
  await screen.findByText('✓ Certificado validado localmente')
  expect(screen.getByText(/não confirma conexão ou acesso ao tribunal/)).toBeVisible()
  expect(screen.getByText(/e-SAJ, Eproc e Projudi ainda não têm conexão implementada/)).toBeVisible()
  const esaj = screen.getByText('e-SAJ · TJSP').closest('.tribunais-item') as HTMLElement
  expect(within(esaj).getByText('credencial guardada')).toBeVisible()
  const bloqueado = within(esaj).getByRole('button', { name: 'Validar certificado' })
  expect(bloqueado).toBeDisabled()
  fireEvent.click(bloqueado)
  expect(api.post).not.toHaveBeenCalled()
})

it('resultado positivo do PJe explica que só o arquivo foi validado', async () => {
  vi.mocked(api.post).mockResolvedValue({ ok: true })
  render(<SecaoTribunais orgId={1} />)
  await screen.findByText('✓ Certificado validado localmente')
  const pje = screen.getByText('PJe · TRT2').closest('.tribunais-item') as HTMLElement
  fireEvent.click(within(pje).getByRole('button', { name: 'Validar certificado' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/orgs/1/tribunais/trt2/testar'))
  expect(toasts.sucesso).toHaveBeenCalledWith(expect.stringContaining('validado localmente'))
  expect(toasts.sucesso).toHaveBeenCalledWith(expect.stringContaining('depende de uma consulta real'))
})

it('salvar credencial de stub explica armazenamento sem prometer conexão', async () => {
  vi.mocked(api.putForm).mockResolvedValue({})
  render(<SecaoTribunais orgId={1} />)
  await screen.findByText('credencial guardada')
  const esaj = screen.getByText('e-SAJ · TJSP').closest('.tribunais-item') as HTMLElement
  fireEvent.click(within(esaj).getByRole('button', { name: 'Substituir' }))
  expect(screen.getByText(/Salvar apenas guarda a credencial criptografada/)).toBeVisible()
  fireEvent.change(screen.getByLabelText('Tipo de credencial'), { target: { value: 'login_senha' } })
  fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'teste-sintetico' } })
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-sintetica' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar credencial' }))
  await waitFor(() => expect(api.putForm).toHaveBeenCalledTimes(1))
  const [path, form] = vi.mocked(api.putForm).mock.calls[0]
  expect(path).toBe('/orgs/1/tribunais/tjsp')
  expect((form as FormData).get('sistema')).toBe('esaj')
  expect(toasts.sucesso).toHaveBeenCalledWith(expect.stringContaining('ainda não está implementada'))
})

it('nova configuração exige tribunal concreto e envia sistema separadamente', async () => {
  vi.mocked(api.putForm).mockResolvedValue({})
  render(<SecaoTribunais orgId={1} />)
  await screen.findByText('✓ Certificado validado localmente')
  const projudi = screen.getByText('Projudi').closest('.tribunais-item') as HTMLElement
  fireEvent.click(within(projudi).getByRole('button', { name: 'Configurar' }))
  fireEvent.change(screen.getByLabelText('Sigla do tribunal'), { target: { value: 'projudi' } })
  fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'teste-sintetico' } })
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-sintetica' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar credencial' }))
  expect(api.putForm).not.toHaveBeenCalled()
  expect(toasts.falha).toHaveBeenCalledWith(expect.stringContaining('sigla do tribunal'))
  fireEvent.change(screen.getByLabelText('Sigla do tribunal'), { target: { value: ' TJPR ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar credencial' }))
  await waitFor(() => expect(api.putForm).toHaveBeenCalledTimes(1))
  const [path, form] = vi.mocked(api.putForm).mock.calls[0]
  expect(path).toBe('/orgs/1/tribunais/tjpr')
  expect((form as FormData).get('sistema')).toBe('projudi')
})

it('credencial legada sem tribunal permanece visível com orientação de recadastro', async () => {
  vi.mocked(api.get).mockResolvedValue({ credenciais: [
    { tribunal: 'pje', sistema: 'pje', tipo: 'certificado_a1', valido: true },
  ] })
  render(<SecaoTribunais orgId={1} />)
  await screen.findByText(/Esta credencial antiga foi salva/)
  const legado = screen.getByText('PJe · PJE').closest('.tribunais-item') as HTMLElement
  expect(within(legado).getByRole('button', { name: 'Validar certificado' })).toBeDisabled()
  fireEvent.click(within(legado).getByRole('button', { name: 'Substituir' }))
  expect(screen.getByLabelText('Sigla do tribunal')).toHaveValue('')
  expect(api.putForm).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
})
