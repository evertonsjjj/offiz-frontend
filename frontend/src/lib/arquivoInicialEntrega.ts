import type { Entrega } from './types'
import { primeiraImagemCarrossel } from './carrosselEntrega'

/** Select metadata only; opening a list must never download all its files. */
export function arquivoInicialEntrega(arquivos: Entrega[], referencia?: Entrega) {
  const midia = (e: Entrega) => (e.mime || '').startsWith('video/') || (e.mime || '').startsWith('image/') || /\.(mp4|mov|webm|m4v|png|jpe?g|webp|gif|svg)$/i.test(e.nome)
  const inicial = referencia || arquivos.find(e => e.nome === 'post.html') || arquivos.find(e =>
    midia(e),
  ) || arquivos[0]
  // The artwork belongs to this exact post. An auxiliary image must not
  // replace the main video, document or artwork from another post.
  const mesmoPost = arquivos.filter(e => (e.editorial_peca_id ?? null) === (inicial?.editorial_peca_id ?? null))
  const visual = inicial?.nome === 'post.html'
    ? mesmoPost.find(e => e.nome === 'arte.png')
      || mesmoPost.find(e => midia(e) && e.mime !== 'image/svg+xml' && !/\.svg$/i.test(e.nome))
      || mesmoPost.find(e => midia(e)) || inicial : inicial
  // Supporting cards must not replace a video, PDF, caption or other main file.
  const sequenciaVisual = inicial?.nome === 'post.html' || visual?.nome === 'arte.png' || /^card-\d{2}\.png$/i.test(visual?.nome || '')
  return (sequenciaVisual ? primeiraImagemCarrossel(arquivos, visual) : undefined) || visual
}
