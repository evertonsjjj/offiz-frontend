import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import PortaVozes from './PortaVozes'
import { api } from '../../lib/api'

const estado = vi.hoisted(() => ({ sessao: 'conta-a', sucesso: vi.fn(), falha: vi.fn() }))
const mediaDevicesOriginal = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), getSessionIdentity: () => estado.sessao, api: { get: vi.fn(async () => ({ porta_vozes: [] })), postForm: vi.fn(async () => ({})), del: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: estado.sucesso, falha: estado.falha }) }))
beforeEach(() => { estado.sessao = 'conta-a'; vi.mocked(api.get).mockResolvedValue({ porta_vozes: [] }); vi.mocked(api.postForm).mockResolvedValue({}); vi.mocked(api.del).mockResolvedValue(undefined) })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); if (mediaDevicesOriginal) Object.defineProperty(navigator, 'mediaDevices', mediaDevicesOriginal); else Reflect.deleteProperty(navigator, 'mediaDevices') })

const ana = { nome: 'ana', arquivos: [], tem_foto: false, tem_voz: true, foto_veredito: null, voice_id: null, pronto: false }
const dialogoPrototype = HTMLDialogElement.prototype
const dialogoMethods = Object.fromEntries(['showModal', 'close'].map(name => [name, Object.getOwnPropertyDescriptor(dialogoPrototype, name)]))
beforeAll(() => Object.defineProperties(dialogoPrototype, {
  showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } },
  close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } },
}))
afterAll(() => { for (const [name, descriptor] of Object.entries(dialogoMethods)) { if (descriptor) Object.defineProperty(dialogoPrototype, name, descriptor); else Reflect.deleteProperty(dialogoPrototype, name) } })
function microfonePendente() {
  const parar = vi.fn()
  const stream = { getTracks: () => [{ stop: parar }] } as unknown as MediaStream
  let resolver!: (stream: MediaStream) => void
  const pedir = vi.fn(() => new Promise<MediaStream>(resolve => { resolver = resolve }))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: pedir } })
  const iniciar = vi.fn()
  const pararRecorder = vi.fn()
  class Gravador {
    state = 'inactive'
    mimeType = 'audio/webm'
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    start() { this.state = 'recording'; iniciar() }
    stop() { this.state = 'inactive'; pararRecorder(); this.ondataavailable?.({ data: new Blob(['voz']) }); this.onstop?.() }
  }
  vi.stubGlobal('MediaRecorder', Gravador)
  return { pedir, parar, iniciar, pararRecorder, resolver: () => resolver(stream) }
}
async function abrirGravador() {
  vi.mocked(api.get).mockResolvedValue({ porta_vozes: [ana] })
  const tela = render(<PortaVozes orgId={3} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Regravar aqui' }))
  return tela
}

it('permite somente um pedido de microfone enquanto a permissão está pendente', async () => {
  const mic = microfonePendente()
  await abrirGravador()
  const iniciar = screen.getByRole('button', { name: 'Começar a gravar' })
  fireEvent.click(iniciar); fireEvent.click(iniciar)
  expect(mic.pedir).toHaveBeenCalledTimes(1)
  await act(async () => mic.resolver())
  expect(mic.iniciar).toHaveBeenCalledTimes(1)
})

it('solta o microfone concedido depois de sair, sem iniciar nem enviar gravação', async () => {
  const mic = microfonePendente()
  const tela = await abrirGravador()
  fireEvent.click(screen.getByRole('button', { name: 'Começar a gravar' }))
  tela.unmount()
  await act(async () => mic.resolver())
  expect(mic.parar).toHaveBeenCalledTimes(1)
  expect(mic.iniciar).not.toHaveBeenCalled()
  expect(api.postForm).not.toHaveBeenCalled()
})

it('fechar durante permissão invalida o pedido e solta a concessão atrasada', async () => {
  const mic = microfonePendente()
  await abrirGravador()
  fireEvent.click(screen.getByRole('button', { name: 'Começar a gravar' }))
  fireEvent.click(screen.getByRole('button', { name: /Fechar|Cancelar gravação/ }))
  await act(async () => mic.resolver())
  expect(mic.parar).toHaveBeenCalledTimes(1)
  expect(mic.iniciar).not.toHaveBeenCalled()
  expect(api.postForm).not.toHaveBeenCalled()
})

it('cancelar uma gravação em andamento não envia o áudio implicitamente', async () => {
  const mic = microfonePendente()
  await abrirGravador()
  fireEvent.click(screen.getByRole('button', { name: 'Começar a gravar' }))
  await act(async () => mic.resolver())
  fireEvent.click(screen.getByRole('button', { name: /Fechar|Cancelar gravação/ }))
  expect(mic.parar).toHaveBeenCalledTimes(1)
  expect(api.postForm).not.toHaveBeenCalled()
})

it('Parar e enviar é a única ação que guarda uma gravação confirmada', async () => {
  const mic = microfonePendente()
  await abrirGravador()
  fireEvent.click(screen.getByRole('button', { name: 'Começar a gravar' }))
  await act(async () => mic.resolver())
  fireEvent.click(screen.getByRole('button', { name: /Parar e enviar/ }))
  await waitFor(() => expect(api.postForm).toHaveBeenCalledExactlyOnceWith('/predios/3/conteudo/porta-vozes/ana?papel=voz', expect.any(FormData)))
  expect(mic.parar).toHaveBeenCalledTimes(1)
})

it('trocar de empresa durante permissão impede iniciar no contexto anterior', async () => {
  const mic = microfonePendente()
  const tela = await abrirGravador()
  fireEvent.click(screen.getByRole('button', { name: 'Começar a gravar' }))
  tela.rerender(<PortaVozes orgId={4} slug="conteudo" />)
  await act(async () => mic.resolver())
  expect(mic.parar).toHaveBeenCalledTimes(1)
  expect(mic.iniciar).not.toHaveBeenCalled()
  expect(api.postForm).not.toHaveBeenCalled()
})

it('uma permissão da conta anterior não abre o microfone na conta nova', async () => {
  const mic = microfonePendente()
  await abrirGravador()
  fireEvent.click(screen.getByRole('button', { name: 'Começar a gravar' }))
  estado.sessao = 'conta-b'
  await act(async () => mic.resolver())
  expect(mic.parar).toHaveBeenCalledTimes(1)
  expect(mic.iniciar).not.toHaveBeenCalled()
})

it('sair durante a gravação encerra gravador e tracks sem enviar o áudio', async () => {
  const mic = microfonePendente()
  const tela = await abrirGravador()
  fireEvent.click(screen.getByRole('button', { name: 'Começar a gravar' }))
  await act(async () => mic.resolver())
  tela.unmount()
  expect(mic.pararRecorder).toHaveBeenCalledTimes(1)
  expect(mic.parar).toHaveBeenCalledTimes(1)
  expect(api.postForm).not.toHaveBeenCalled()
})

it('falha ao criar o gravador solta o stream e conserva o envio de arquivo', async () => {
  const mic = microfonePendente()
  vi.stubGlobal('MediaRecorder', class { constructor() { throw new Error('Formato não disponível') } })
  await abrirGravador()
  fireEvent.click(screen.getByRole('button', { name: 'Começar a gravar' }))
  await act(async () => mic.resolver())
  expect(mic.parar).toHaveBeenCalledTimes(1)
  expect(estado.falha).toHaveBeenCalledWith(expect.stringContaining('envie um arquivo de áudio'))
  expect(screen.getByRole('button', { name: 'Começar a gravar' })).toBeEnabled()
  expect(api.postForm).not.toHaveBeenCalled()
})

it('leitura atrasada da outra empresa não troca a pessoa da empresa atual', async () => {
  let responderAntiga!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { responderAntiga = resolve })).mockResolvedValueOnce({ porta_vozes: [{ ...ana, nome: 'bruna' }] })
  const tela = render(<PortaVozes orgId={3} slug="conteudo" />)
  tela.rerender(<PortaVozes orgId={4} slug="conteudo" />)
  await screen.findByText('bruna')
  await act(async () => responderAntiga({ porta_vozes: [ana] }))
  expect(screen.queryByText('ana')).not.toBeInTheDocument()
  expect(screen.getByText('bruna')).toBeInTheDocument()
})

it('falha da primeira consulta oferece recuperação em vez de prender a tela vazia', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('Sem conexão')).mockResolvedValueOnce({ porta_vozes: [ana] })
  render(<PortaVozes orgId={3} slug="conteudo" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui ver os apresentadores')
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('ana')).toBeInTheDocument()
})

it('resposta de upload antiga não anuncia alteração na empresa escolhida depois', async () => {
  let responder!: (valor: unknown) => void
  vi.mocked(api.postForm).mockImplementationOnce(() => new Promise(resolve => { responder = resolve }))
  const tela = render(<PortaVozes orgId={3} slug="conteudo" />)
  fireEvent.change(await screen.findByLabelText('Nome do apresentador'), { target: { value: 'Ana' } })
  fireEvent.change(screen.getByLabelText('Áudio da pessoa'), { target: { files: [new File(['voz'], 'voz.mp3')] } })
  tela.rerender(<PortaVozes orgId={4} slug="conteudo" />)
  await act(async () => responder({}))
  expect(estado.sucesso).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Nome do apresentador')).toHaveValue('')
  expect(api.get).toHaveBeenCalledTimes(2)
})

it('cancelar exclusão da pessoa não chama a API nem depende de confirmação nativa', async () => {
  const nativo = vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('Host sem confirmação') })
  vi.mocked(api.get).mockResolvedValue({ porta_vozes: [ana] })
  render(<PortaVozes orgId={3} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Tirar ana' }))
  expect(screen.getByRole('dialog', { name: 'Excluir pessoa do escritório' })).toHaveTextContent('voz já preparada continua na conta do provedor')
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.del).not.toHaveBeenCalled(); expect(nativo).not.toHaveBeenCalled()
})

it('confirmar duas vezes exclui a pessoa exata uma vez', async () => {
  vi.mocked(api.get).mockResolvedValue({ porta_vozes: [ana] })
  render(<PortaVozes orgId={3} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Tirar ana' }))
  const confirmar = screen.getByRole('button', { name: 'Excluir pessoa' })
  fireEvent.click(confirmar); fireEvent.click(confirmar)
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/predios/3/conteudo/porta-vozes/ana'))
})

it('falha de exclusão mantém a pessoa para tentar novamente', async () => {
  vi.mocked(api.get).mockResolvedValue({ porta_vozes: [ana] })
  vi.mocked(api.del).mockRejectedValueOnce(new Error('Sem conexão'))
  render(<PortaVozes orgId={3} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Tirar ana' }))
  fireEvent.click(screen.getByRole('button', { name: 'Excluir pessoa' }))
  await waitFor(() => expect(estado.falha).toHaveBeenCalledWith(expect.stringContaining('Não consegui excluir')))
  expect(screen.getByText('ana')).toBeInTheDocument()
})

it('cadastra áudio sem exigir foto nem iniciar clonagem de voz', async () => {
  render(<PortaVozes orgId={3} slug="conteudo" />)
  const audio = await screen.findByLabelText('Áudio da pessoa')
  expect(audio).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Nome do apresentador'), { target: { value: 'Ana' } })
  fireEvent.change(audio, { target: { files: [new File(['audio'], 'voz.mp3', { type: 'audio/mpeg' })] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalledExactlyOnceWith('/predios/3/conteudo/porta-vozes/Ana?papel=voz', expect.any(FormData)))
  expect(screen.getByText(/Criar uma voz de IA é uma etapa separada/)).toBeInTheDocument()
})
