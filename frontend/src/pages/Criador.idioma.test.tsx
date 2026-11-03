import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { api, ApiError } from '../lib/api'
import { appDownloadWindowsBase } from '../lib/downloadsApp'
import CriadorPage from './Criador'
import { MemoryRouter } from 'react-router-dom'
import { iniciarDitadoLocal } from '../lib/desktop-dictation'
import type { OffizMotorBridge } from '../lib/motor-bridge'

vi.mock('../lib/desktop-dictation', () => ({ iniciarDitadoLocal: vi.fn() }))
afterEach(() => { delete window.offizMotor })

const { traduzir, transporte } = vi.hoisted(() => ({
  traduzir: (_pt: string, en: string) => en,
  transporte: {
    tipo: 'simulacao', abrir: vi.fn(), enviar: vi.fn(), onEvento: vi.fn(),
    arquivos: vi.fn(), arquivo: vi.fn(), publicar: vi.fn(), fechar: vi.fn(), cancelar: vi.fn(), anexar: vi.fn(),
  },
}))
vi.mock('../lib/i18n', () => ({ useIdioma: () => ({ t: traduzir, idioma: 'en' }) }))
vi.mock('../components/Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn() }) }))
vi.mock('../lib/criador-transporte', () => ({
  temCriadorDesktop: () => false,
  transporteSimulacao: () => transporte,
  transporteDesktop: () => transporte,
}))
vi.mock('../lib/api', async (original) => ({
  ...await original<typeof import('../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
}))

beforeEach(() => {
  vi.resetAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  transporte.onEvento.mockReturnValue(() => {})
  transporte.abrir.mockResolvedValue({
    aberta: true, slug: 'relacoes-com-clientes', ocupado: false, turnos: 0, alterados: [],
    manifesto: {
      slug: 'relacoes-com-clientes', nome: 'Relações com clientes', descricao: 'Atendimento acolhedor em português.',
      abas: [{ id: 'inicio' }, { id: 'conversa', rotulo: 'Nossas conversas' }, { id: 'entregas' }],
      prompts_prontos: [{ titulo: 'Resumo de acolhimento', prompt: 'Escreva para a cliente Mônica sem mudar a voz.', escopo: 'Relacionamento' }],
    },
  })
  transporte.enviar.mockResolvedValue(undefined)
  transporte.arquivos.mockResolvedValue({ ok: true, arquivos: [{ caminho: 'skills/acolhimento/SKILL.md', tamanho: 50 }] })
  transporte.arquivo.mockResolvedValue({ ok: true, conteudo: 'Use o tom de voz da Mônica. Não altere estas orientações.' })
  vi.mocked(api.get).mockResolvedValue([{ slug: 'juris', nome: 'Jurídico da João', tema: {} }])
  vi.mocked(api.post).mockResolvedValue({ slug: 'relacoes-com-clientes', arquivos: 4 })
})

it('criador em inglês mantém nome, manifesto, prompt digitado e arquivos em português', async () => {
  render(<MemoryRouter><CriadorPage /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Office builder' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Download for Windows' })).toHaveAttribute('href', `${appDownloadWindowsBase}/Offiz-Setup.exe`)
  expect(screen.getByRole('link', { name: 'Windows (ZIP)' })).toHaveAttribute('href', `${appDownloadWindowsBase}/Offiz-win.zip`)
  await screen.findByRole('option', { name: 'Copy of Jurídico da João' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Relações com clientes' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create and open' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/admin/offices', {
    slug: 'relacoes-com-clientes', nome: 'Relações com clientes', origem: '_basico',
  }))
  const entrada = await screen.findByPlaceholderText(/Request a change, paste a GitHub link/)
  expect(transporte.abrir).toHaveBeenCalledExactlyOnceWith('relacoes-com-clientes')
  expect(screen.getByRole('button', { name: 'Nossas conversas' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Deliverables' })).toBeInTheDocument()
  expect(screen.getByText('Resumo de acolhimento')).toBeInTheDocument()
  expect(screen.getByText('Relacionamento')).toBeInTheDocument()
  fireEvent.change(entrada, { target: { value: 'Escreva para a Mônica, mantenha o português e as referências.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(transporte.enviar).toHaveBeenCalledExactlyOnceWith('Escreva para a Mônica, mantenha o português e as referências.'))

  fireEvent.click(screen.getByRole('tab', { name: 'Files' }))
  fireEvent.click(await screen.findByRole('button', { name: 'skills/acolhimento/SKILL.md' }))
  expect(await screen.findByText('Use o tom de voz da Mônica. Não altere estas orientações.')).toBeInTheDocument()
  expect(transporte.arquivo).toHaveBeenCalledExactlyOnceWith('skills/acolhimento/SKILL.md')
  expect(api.put).not.toHaveBeenCalled()
  expect(transporte.publicar).not.toHaveBeenCalled()
})

it('a fala no aplicativo vira texto no criador e é cancelada ao sair', async () => {
  window.offizMotor = {} as OffizMotorBridge
  const cancelar = vi.fn(), parar = vi.fn()
  vi.mocked(iniciarDitadoLocal).mockReturnValue({ cancelar, parar })
  const view = render(<MemoryRouter><CriadorPage /></MemoryRouter>)
  await screen.findByRole('option', { name: 'Copy of Jurídico da João' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Relações com clientes' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create and open' }))
  await screen.findByRole('button', { name: 'Speak' })
  fireEvent.click(screen.getByRole('button', { name: 'Speak' }))
  expect(iniciarDitadoLocal).toHaveBeenCalledTimes(1)
  const callbacks = vi.mocked(iniciarDitadoLocal).mock.calls[0][0]
  act(() => { callbacks.estado('gravando'); callbacks.texto('Quero mudar o escritório.') })
  expect(screen.getByDisplayValue('Quero mudar o escritório.')).toBeVisible()
  expect(transporte.enviar).not.toHaveBeenCalled(); expect(transporte.anexar).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Speak' }))
  expect(parar).toHaveBeenCalledTimes(1)
  view.unmount(); expect(cancelar).toHaveBeenCalledTimes(1)
})

it('arquiva com erro visível, permite tentar novamente e restaura sem excluir o serviço', async () => {
  let catalogo = [{ slug: 'teste', nome: 'teste', tema: {}, arquivado: false }]
  vi.mocked(api.get).mockImplementation(async () => catalogo)
  vi.mocked(api.put).mockRejectedValueOnce(new ApiError(409, 'A publication is running.'))
    .mockImplementation(async (_path, body) => { catalogo = [{ ...catalogo[0], ...body as object }]; return {} })
  const view = render(<MemoryRouter><CriadorPage /></MemoryRouter>)
  await screen.findByRole('button', { name: /teste teste/ })
  let linha = within(view.container.querySelector('[data-office="teste"]') as HTMLElement)
  fireEvent.click(linha.getByText('Organize service'))
  fireEvent.click(linha.getByRole('button', { name: 'Archive service' }))
  expect(await linha.findByRole('alert')).toHaveTextContent('A publication is running.')
  fireEvent.click(linha.getByRole('button', { name: 'Archive service' }))
  await waitFor(() => expect(view.container.querySelector('[data-office="teste"]')).toBeNull())
  expect(api.put).toHaveBeenLastCalledWith('/admin/offices/teste/manifesto', { arquivado: true })
  expect(api.del).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: /Show archived/ }))
  linha = within(view.container.querySelector('[data-office="teste"]') as HTMLElement)
  fireEvent.click(linha.getByText('Organize service'))
  fireEvent.click(linha.getByRole('button', { name: 'Restore to catalog' }))
  await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/admin/offices/teste/manifesto', { arquivado: false }))
  await waitFor(() => expect(linha.queryByText('Archived')).not.toBeInTheDocument())
  expect(api.del).not.toHaveBeenCalled()
})

it('uma recarga antiga não desfaz o arquivamento confirmado por recarga mais recente', async () => {
  const offices = [
    { slug: 'teste', nome: 'teste', tema: {}, arquivado: false },
    { slug: 'apoio', nome: 'apoio', tema: {}, arquivado: false },
  ]
  let concluirAntiga!: (value: unknown) => void
  let concluirNova!: (value: unknown) => void
  vi.mocked(api.get).mockResolvedValueOnce(offices)
    .mockImplementationOnce(() => new Promise(resolve => { concluirAntiga = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { concluirNova = resolve }))
  vi.mocked(api.put).mockResolvedValue({})
  const view = render(<MemoryRouter><CriadorPage /></MemoryRouter>)
  await screen.findByRole('button', { name: /teste teste/ })
  for (const slug of ['teste', 'apoio']) {
    const linha = within(view.container.querySelector(`[data-office="${slug}"]`) as HTMLElement)
    fireEvent.click(linha.getByText('Organize service'))
    fireEvent.click(linha.getByRole('button', { name: 'Archive service' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`/admin/offices/${slug}/manifesto`, { arquivado: true }))
  }
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3))
  await act(async () => { concluirNova(offices.map(o => ({ ...o, arquivado: true }))) })
  await act(async () => { concluirAntiga([{ ...offices[0], arquivado: true }, offices[1]]) })
  expect(view.container.querySelector('[data-office="apoio"]')).toBeNull()
  expect(view.container.querySelector('[data-office="teste"]')).toBeNull()
  expect(screen.getByRole('checkbox', { name: /Show archived \(2\)/ })).toBeInTheDocument()
})
