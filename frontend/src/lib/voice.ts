import '../../../standalone/vendor/audio.js'
import './motor-bridge'
import { api } from './api'

export function validarVozNoApp() {
  if (window.offizMotor && typeof window.offizMotor.transcreverVoz !== 'function') {
    throw new Error(document.documentElement.lang.startsWith('en')
      ? 'Update Offiz to use on-device voice transcription. You can keep typing meanwhile.'
      : 'Atualize o Offiz para falar com transcrição no computador. Enquanto isso, você pode escrever.')
  }
}

/** No aplicativo, uma falha local nunca troca silenciosamente para uma API. */
export async function transcreverVoz(blob: Blob, garantirConversa: () => Promise<number>, atual: () => boolean): Promise<string> {
  if (window.offizMotor) {
    validarVozNoApp()
    const english = document.documentElement.lang.startsWith('en')
    if (!window.offizMotor.transcreverVoz) throw new Error(english ? 'Update Offiz to use on-device voice transcription.' : 'Atualize o Offiz para usar a transcrição de voz no computador.')
    const wav = await AferiaAudio.toWav(blob, 120)
    if (!atual()) return ''
    const result = await window.offizMotor.transcreverVoz(wav, english ? 'en' : 'pt-BR')
    if (!result.ok) throw new Error(result.error || (english ? 'Could not transcribe on this computer.' : 'Não foi possível transcrever neste computador.'))
    return result.texto?.trim() || ''
  }
  const id = await garantirConversa()
  if (!atual()) return ''
  const form = new FormData(); form.append('audio', blob, 'voz.webm')
  const result = await api.postForm<{ texto?: string }>(`/conversas/${id}/audio`, form)
  return result.texto?.trim() || ''
}
