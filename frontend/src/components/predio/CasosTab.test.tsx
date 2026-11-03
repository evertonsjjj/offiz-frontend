import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError } from '../../lib/api'
import { CasosTab } from './CasosTab'
import type { OffizMotorBridge } from '../../lib/motor-bridge'

const contexto = vi.hoisted(() => ({ sessao: 'conta-a', sucesso: vi.fn(), falha: vi.fn() }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(),
  getSessionIdentity: () => contexto.sessao,
  api: { get: vi.fn(), post: vi.fn(), postForm: vi.fn(), patch: vi.fn(), del: vi.fn() },
}))
vi.mock('../Toasts', () => ({ useToasts: () => contexto }))
vi.mock('./PecasCaso', () => ({ PecasCaso: () => null }))
const sugestao = { campos: { cliente_nome: { valor: 'Maria do documento', confianca: 'alta' } } }
const caso = { id: 7, cliente_nome: 'Maria manual', status: 'ativo', documentos: [] }

beforeEach(() => {
  vi.clearAllMocks(); contexto.sessao = 'conta-a'
  vi.mocked(api.get).mockResolvedValue(caso)
  vi.mocked(api.post).mockResolvedValue(caso)
  vi.mocked(api.postForm).mockResolvedValue(sugestao)
  window.offizMotor = { chatDeviceId: 'desktop-ficticio' } as OffizMotorBridge
})
afterEach(() => { cleanup(); delete window.offizMotor })
const painel = (org = 3) => <MemoryRouter initialEntries={['/app?novo=1']}><CasosTab orgId={org} slug="juris" /></MemoryRouter>
function anexar(view: ReturnType<typeof render>, name = 'fatos.docx') {
  const input = view.container.querySelector('input[type=file]')!
  fireEvent.change(input, { target: { files: [new File(['Maria'], name)] } })
}
const nome = () => screen.getByPlaceholderText('Nome completo ou razão social')

it('preview envia o dispositivo da assinatura e oferece os campos para revisão sem criar caso', async () => {
  const view = render(painel()); anexar(view)
  expect(view.container.querySelector('input[type=file]')).toHaveAttribute('accept', expect.stringContaining('.docx'))
  fireEvent.click(screen.getByRole('button', { name: 'Extrair dados com IA' }))
  await waitFor(() => expect(nome()).toHaveValue('Maria do documento'))
  const [url, form] = vi.mocked(api.postForm).mock.calls[0]
  expect(url).toBe('/predios/3/juris/casos/preview-extracao')
  expect((form as FormData).get('motor_local')).toBe('desktop-ficticio')
  expect((form as FormData).getAll('arquivos')).toHaveLength(1)
  expect(api.post).not.toHaveBeenCalled()
})

it('resposta atrasada não sobrescreve edição humana nem duplica a chamada', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.postForm).mockImplementation(() => new Promise(resolve => { resolver = resolve }) as never)
  const view = render(painel()); anexar(view)
  const button = screen.getByRole('button', { name: 'Extrair dados com IA' })
  fireEvent.click(button); fireEvent.click(button)
  fireEvent.change(nome(), { target: { value: 'Maria corrigida' } })
  await act(async () => resolver(sugestao))
  expect(nome()).toHaveValue('Maria corrigida')
  expect(screen.getByRole('note')).toHaveTextContent('Suas alterações foram preservadas')
  expect(api.postForm).toHaveBeenCalledTimes(1)
})

it('trocar empresa descarta o formulário e a resposta anterior', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.postForm).mockImplementation(() => new Promise(resolve => { resolver = resolve }) as never)
  const view = render(painel()); anexar(view)
  fireEvent.change(nome(), { target: { value: 'Cliente da empresa A' } })
  fireEvent.click(screen.getByRole('button', { name: 'Extrair dados com IA' }))
  view.rerender(painel(4))
  await act(async () => resolver(sugestao))
  expect(nome()).toHaveValue('')
  expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('trocar a sessão impede aplicar o preview da conta anterior', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.postForm).mockImplementation(() => new Promise(resolve => { resolver = resolve }) as never)
  const view = render(painel()); anexar(view)
  fireEvent.click(screen.getByRole('button', { name: 'Extrair dados com IA' }))
  contexto.sessao = 'conta-b'
  await act(async () => resolver(sugestao))
  expect(nome()).toHaveValue(''); expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('PDF sem texto mostra limite de OCR e mantém cadastro manual', async () => {
  vi.mocked(api.postForm).mockResolvedValue({ campos: {}, aviso: 'PDF sem texto selecionável; não foi aplicado OCR.' })
  const view = render(painel()); anexar(view, 'scan.pdf')
  fireEvent.click(screen.getByRole('button', { name: 'Extrair dados com IA' }))
  expect(await screen.findByRole('note')).toHaveTextContent('não foi aplicado OCR')
  expect(nome()).toHaveValue(''); expect(screen.getByRole('button', { name: 'Salvar caso' })).toBeEnabled()
})

it('salvar caso também vincula os arquivos selecionados e não repete criação quando um anexo falha', async () => {
  vi.mocked(api.postForm).mockRejectedValue(new ApiError(503, 'Upload indisponível'))
  const view = render(painel()); anexar(view)
  fireEvent.change(nome(), { target: { value: 'Maria manual' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar caso' }))
  await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.postForm).mock.calls[0][0]).toBe('/predios/3/juris/casos/7/documentos')
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(contexto.falha).toHaveBeenCalledWith('Caso salvo, mas há anexo pendente: Upload indisponível')
  expect(await screen.findByRole('heading', { name: 'Maria manual' })).toBeInTheDocument()
})

it('erro do motor informa o motivo recebido sem sugerir API key', async () => {
  vi.mocked(api.postForm).mockRejectedValue(new ApiError(412, 'Conecte a assinatura no aplicativo Offiz.'))
  const view = render(painel()); anexar(view)
  fireEvent.click(screen.getByRole('button', { name: 'Extrair dados com IA' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Conecte a assinatura no aplicativo Offiz.'))
  expect(nome()).toHaveValue('')
})

it('trocar conta durante criação não envia anexos nem abre o caso anterior', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { resolver = resolve }) as never)
  const view = render(painel()); anexar(view)
  fireEvent.change(nome(), { target: { value: 'Cliente privado' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar caso' }))
  contexto.sessao = 'conta-b'
  await act(async () => resolver(caso))
  expect(api.postForm).not.toHaveBeenCalled()
  expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('criação pendente só é enviada uma vez e não continua uploads após trocar empresa', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { resolver = resolve }) as never)
  const view = render(painel()); anexar(view)
  fireEvent.change(nome(), { target: { value: 'Cliente privado' } })
  const salvar = screen.getByRole('button', { name: 'Salvar caso' })
  fireEvent.click(salvar); fireEvent.click(salvar)
  expect(api.post).toHaveBeenCalledTimes(1)
  view.rerender(painel(4))
  await act(async () => resolver(caso))
  expect(api.postForm).not.toHaveBeenCalled()
  expect(contexto.sucesso).not.toHaveBeenCalled()
  expect(contexto.falha).not.toHaveBeenCalled()
  expect(nome()).toHaveValue('')
})
