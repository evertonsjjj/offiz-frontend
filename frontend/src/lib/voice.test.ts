import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { transcreverVoz } from './voice'
import { api } from './api'
import type { OffizMotorBridge } from './motor-bridge'
vi.mock('./api', () => ({ api: { postForm: vi.fn() } }))
const toWav = vi.fn(async () => new ArrayBuffer(100))
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('AferiaAudio', { toWav }); document.documentElement.lang = 'pt-BR' })
afterEach(() => { delete window.offizMotor; vi.unstubAllGlobals() })
it('app transcreve localmente e não cria conversa ou envia áudio ao servidor', async () => {
  const local = vi.fn(async () => ({ ok: true, texto: 'Minha mensagem.' }))
  window.offizMotor = { transcreverVoz: local } as unknown as OffizMotorBridge
  const create = vi.fn(async () => 42)
  expect(await transcreverVoz(new Blob(['audio']), create, () => true)).toBe('Minha mensagem.')
  expect(local).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'pt-BR'); expect(create).not.toHaveBeenCalled(); expect(api.postForm).not.toHaveBeenCalled()
})
it('falha local e app antigo não enviam áudio à API como fallback', async () => {
  window.offizMotor = { transcreverVoz: async () => ({ ok: false, error: 'Motor indisponível' }) } as unknown as OffizMotorBridge
  await expect(transcreverVoz(new Blob(['audio']), async () => 42, () => true)).rejects.toThrow('Motor indisponível')
  window.offizMotor = {} as OffizMotorBridge
  await expect(transcreverVoz(new Blob(['audio']), async () => 42, () => true)).rejects.toThrow('Atualize')
  expect(api.postForm).not.toHaveBeenCalled()
})
it('navegador mantém a rota da conta e revisão do texto', async () => {
  vi.mocked(api.postForm).mockResolvedValue({ texto: 'Texto da conta.' })
  expect(await transcreverVoz(new Blob(['audio']), async () => 42, () => true)).toBe('Texto da conta.')
  expect(api.postForm).toHaveBeenCalledWith('/conversas/42/audio', expect.any(FormData)); expect(toWav).not.toHaveBeenCalled()
})
it('troca de contexto durante conversão impede iniciar o motor', async () => {
  const local = vi.fn(); window.offizMotor = { transcreverVoz: local } as unknown as OffizMotorBridge
  expect(await transcreverVoz(new Blob(['audio']), async () => 42, () => false)).toBe(''); expect(local).not.toHaveBeenCalled(); expect(api.postForm).not.toHaveBeenCalled()
})
