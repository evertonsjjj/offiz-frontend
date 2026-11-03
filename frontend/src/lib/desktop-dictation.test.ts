import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { iniciarDitadoLocal } from './desktop-dictation'
import { transcreverVoz, validarVozNoApp } from './voice'
vi.mock('./voice', () => ({ transcreverVoz: vi.fn(), validarVozNoApp: vi.fn() }))
let recorder: FakeRecorder
class FakeRecorder {
  state = 'inactive'; mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { recorder = this }
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.onstop?.() }
}
const stopped = vi.fn()
const stream = { getTracks: () => [{ stop: stopped }] }
const microphone = vi.fn()
const callbacks = () => ({ estado: vi.fn(), texto: vi.fn(), erro: vi.fn() })
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers()
  microphone.mockResolvedValue(stream)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: microphone } })
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.mocked(transcreverVoz).mockResolvedValue('Minha nova mensagem.')
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('app antigo avisa antes de pedir o microfone e não envia áudio', async () => {
  vi.mocked(validarVozNoApp).mockImplementationOnce(() => { throw new Error('Atualize o Offiz') })
  const cb = callbacks(); iniciarDitadoLocal(cb)
  await vi.advanceTimersByTimeAsync(0)
  expect(microphone).not.toHaveBeenCalled()
  expect(transcreverVoz).not.toHaveBeenCalled()
  expect(cb.erro).toHaveBeenCalledWith(expect.objectContaining({ message: 'Atualize o Offiz' }))
  expect(cb.estado).toHaveBeenLastCalledWith('parado')
})
it('para o microfone antes da transcrição e entrega texto para revisão', async () => {
  const cb = callbacks(), capture = iniciarDitadoLocal(cb)
  await vi.advanceTimersByTimeAsync(0)
  recorder.ondataavailable?.({ data: new Blob(['áudio']) })
  capture.parar()
  expect(stopped).toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(0)
  expect(cb.texto).toHaveBeenCalledWith('Minha nova mensagem.')
  expect(cb.estado).toHaveBeenLastCalledWith('parado')
  expect(vi.getTimerCount()).toBe(0)
})
it('sair durante a permissão encerra o microfone que chegou atrasado', async () => {
  let resolve!: (stream: unknown) => void
  microphone.mockImplementation(() => new Promise(r => { resolve = r }))
  const cb = callbacks(), capture = iniciarDitadoLocal(cb)
  capture.cancelar(); resolve(stream)
  await vi.advanceTimersByTimeAsync(0)
  expect(stopped).toHaveBeenCalled()
  expect(transcreverVoz).not.toHaveBeenCalled(); expect(cb.texto).not.toHaveBeenCalled()
})
it('cancelar durante o Whisper descarta a resposta da tela anterior', async () => {
  let resolve!: (text: string) => void
  vi.mocked(transcreverVoz).mockImplementation(() => new Promise(r => { resolve = r }))
  const cb = callbacks(), capture = iniciarDitadoLocal(cb)
  await vi.advanceTimersByTimeAsync(0)
  recorder.ondataavailable?.({ data: new Blob(['áudio']) }); capture.parar()
  capture.cancelar(); resolve('Não deve aparecer.')
  await vi.advanceTimersByTimeAsync(0)
  expect(cb.texto).not.toHaveBeenCalled(); expect(cb.erro).not.toHaveBeenCalled()
})
it('encerra a gravação em dois minutos', async () => {
  const cb = callbacks(); iniciarDitadoLocal(cb)
  await vi.advanceTimersByTimeAsync(0)
  recorder.ondataavailable?.({ data: new Blob(['áudio']) })
  await vi.advanceTimersByTimeAsync(120000)
  expect(stopped).toHaveBeenCalled(); expect(transcreverVoz).toHaveBeenCalledTimes(1)
})
