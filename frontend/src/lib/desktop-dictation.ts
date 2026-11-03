import { transcreverVoz, validarVozNoApp } from './voice'

export type EstadoDitado = 'parado' | 'preparando' | 'gravando' | 'transcrevendo'
type Callbacks = { estado: (estado: EstadoDitado) => void; texto: (texto: string) => void; erro: (erro: unknown) => void }

/** Captura limitada a dois minutos, com cancelamento também durante a permissão do microfone. */
export function iniciarDitadoLocal(callbacks: Callbacks) {
  let ativo = true, encerrando = false
  let gravador: MediaRecorder | undefined, stream: MediaStream | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const pedacos: Blob[] = []
  let bytes = 0
  const liberar = () => { clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()) }
  const cancelar = () => {
    ativo = false
    if (gravador) { gravador.onstop = null; gravador.ondataavailable = null; gravador.onerror = null; if (gravador.state !== 'inactive') gravador.stop() }
    liberar()
  }
  const falhar = (erro: unknown) => { if (ativo) { callbacks.erro(erro); callbacks.estado('parado') }; cancelar() }
  const parar = () => { encerrando = true; if (gravador?.state === 'recording') gravador.stop() }
  callbacks.estado('preparando')
  void (async () => {
    try {
      validarVozNoApp()
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!ativo || encerrando) { liberar(); if (ativo) callbacks.estado('parado'); return }
      gravador = new MediaRecorder(stream)
      gravador.ondataavailable = event => {
        if (!ativo) return
        bytes += event.data.size
        if (bytes > 8 * 1024 * 1024) { falhar(new Error(document.documentElement.lang.startsWith('en') ? 'Recording too large. Try a shorter message.' : 'Gravação muito grande. Tente uma mensagem mais curta.')); return }
        if (event.data.size) pedacos.push(event.data)
      }
      gravador.onerror = event => falhar(event)
      gravador.onstop = async () => {
        liberar()
        if (!ativo) return
        callbacks.estado('transcrevendo')
        try {
          const blob = new Blob(pedacos, { type: gravador?.mimeType || 'audio/webm' })
          if (!blob.size) return
          const texto = await transcreverVoz(blob, async () => { throw new Error('A transcrição local precisa do aplicativo Offiz.') }, () => ativo)
          if (ativo && texto) callbacks.texto(texto)
        } catch (error) { if (ativo) callbacks.erro(error) }
        finally { if (ativo) callbacks.estado('parado'); ativo = false }
      }
      gravador.start(1000)
      callbacks.estado('gravando')
      timer = setTimeout(parar, 120000)
    } catch (error) { falhar(error) }
  })()
  return { parar, cancelar }
}
