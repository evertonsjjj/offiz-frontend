/**
 * O RESULTADO NA FRENTE (27/08/2026) — pedido literal do dono na demo:
 * "nas entregas tem que ser só o resultado final e podem assistir ou ver
 * via web. tudo tem que ser bem visível."
 *
 * Uma entrega de imagem aparece GRANDE, vídeo com player, áudio com
 * controles, HTML renderizado na hora — o nome do arquivo e os botões são
 * detalhe; a peça é o que ocupa a tela. Este componente é a implementação
 * ÚNICA desse gesto: EntregasTab, PainelTrabalho e o painel da Mesa usam o
 * mesmo, para o preview nunca divergir entre telas.
 *
 * Segurança do HTML: iframe com `sandbox=""` (tudo negado) — renderiza sem
 * executar script nem herdar origin. É a resposta ao furo do
 * `window.open(blob)` que rodava HTML de agente NO NOSSO ORIGIN (blob: URL
 * herda o origin de quem criou; com o token no localStorage, era XSS de
 * primeira). Aquele caminho morreu junto com a chegada deste componente.
 *
 * Custo de rede: auto-carrega até o teto; acima disso mostra o botão
 * "Carregar (tamanho)" — um vídeo de 200 MB baixando sozinho numa lista de
 * histórico é conta de banda, não resultado visível.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { carregarArquivo, respostaAutenticada, getSessionIdentity } from '../../lib/api'
import { lerTextoLimitado } from '../../lib/leituraLimitada'
import { useIdioma } from '../../lib/i18n'
import { formatBytes } from '../../lib/format'
import { protegerHtmlPrevia, temRecursosExternosHtml } from '../../lib/previaHtml'
import LeituraMarkdown from '../LeituraMarkdown'
import { Icone } from '../Icone'

export function ehVideoEntrega(nome: string, mime?: string | null): boolean {
  return (mime || '').startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(nome)
}
export function ehImagemEntrega(nome: string, mime?: string | null): boolean {
  return (mime || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(nome)
}
export function ehAudioEntrega(nome: string, mime?: string | null): boolean {
  return (mime || '').startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(nome)
}
export function ehHtmlEntrega(nome: string, mime?: string | null): boolean {
  return (mime || '').includes('html') || /\.html?$/i.test(nome)
}
export function ehTextoEntrega(nome: string, mime?: string | null): boolean {
  return /\.(md|markdown|txt|docx)$/i.test(nome) || mime === 'text/markdown' || mime === 'text/plain'
}

/** O chamador decide mostrar o resultado-first só para o que TEM resultado
 *  visual; planilhas continuam na linha de arquivo. */
export function temResultadoVisivel(nome: string, mime?: string | null): boolean {
  return (
    ehVideoEntrega(nome, mime) ||
    ehImagemEntrega(nome, mime) ||
    ehAudioEntrega(nome, mime) ||
    ehHtmlEntrega(nome, mime) || ehTextoEntrega(nome, mime) || /\.pdf$/i.test(nome) || mime === 'application/pdf'
  )
}

/* Acima disto o preview espera um clique (o tamanho aparece no botão). */
const TETO_AUTO_BYTES = 15 * 1024 * 1024
/* Inclui imagens embutidas em base64; acima do teto, o original segue baixável. */
const TETO_HTML_BYTES = 32 * 1024 * 1024
const TETO_TEXTO_BYTES = 2 * 1024 * 1024


export default function ResultadoEntrega({
  entregaId, nome, mime, tamanhoBytes, aoApontar,
}: {
  entregaId: number
  nome: string
  mime?: string | null
  tamanhoBytes?: number | null
  aoApontar?: (posicao: PosicaoEntrega) => void
}) {
  if (/\.pdf$/i.test(nome) || mime === 'application/pdf') return <VisorPdf key={entregaId} entregaId={entregaId} nome={nome} aoApontar={aoApontar} />
  return <VisorEntrega key={entregaId} entregaId={entregaId} nome={nome} mime={mime} tamanhoBytes={tamanhoBytes} aoApontar={aoApontar} />
}

export interface PosicaoEntrega { pagina?: number; segundo?: number; x?: number; y?: number }

function ImagemAmpliada({ url, nome, fechar, retornarFoco }: { url: string; nome: string; fechar: () => void; retornarFoco: HTMLButtonElement | null }) {
  const { t } = useIdioma()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const corpoRef = useRef<HTMLDivElement>(null)
  const imagemRef = useRef<HTMLImageElement>(null)
  const [podeDetalhar, setPodeDetalhar] = useState(false)
  const [detalhes, setDetalhes] = useState(false)
  const conferirTamanho = useCallback(() => {
    if (imagemRef.current && corpoRef.current) {
      setPodeDetalhar(imagemRef.current.naturalWidth > corpoRef.current.clientWidth
        || imagemRef.current.naturalHeight > corpoRef.current.clientHeight)
    }
  }, [])
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    conferirTamanho()
    return () => {
      dialog?.close()
      if (retornarFoco?.isConnected) retornarFoco.focus()
    }
  }, [retornarFoco, conferirTamanho])
  useEffect(() => {
    window.addEventListener('resize', conferirTamanho)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(conferirTamanho) : null
    if (corpoRef.current) observer?.observe(corpoRef.current)
    return () => { window.removeEventListener('resize', conferirTamanho); observer?.disconnect() }
  }, [conferirTamanho])
  useEffect(() => {
    if (corpoRef.current) {
      corpoRef.current.scrollLeft = 0
      corpoRef.current.scrollTop = 0
    }
  }, [detalhes])
  return createPortal(<dialog ref={dialogRef} className="resultado-entrega__ampliada"
    aria-label={t(`Imagem ampliada: ${nome}`, `Enlarged image: ${nome}`)}
    onCancel={e => { e.preventDefault(); fechar() }}>
    <header><strong>{nome}</strong><button type="button" className="botao botao-fantasma botao-pequeno" onClick={fechar} autoFocus>{t('Fechar', 'Close')}</button></header>
    {(podeDetalhar || detalhes) && <div className="resultado-entrega__ampliada-controles">
      <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => {
        if (detalhes && !podeDetalhar) corpoRef.current?.focus()
        setDetalhes(valor => !valor)
      }}>{detalhes ? t('Ver imagem inteira', 'View full image') : t('Ver detalhes', 'View details')}</button>
      {detalhes && <small role="status">{t('Role ou deslize a imagem para ver os detalhes.', 'Scroll or swipe the image to inspect details.')}</small>}
    </div>}
    <div ref={corpoRef} className={`resultado-entrega__ampliada-corpo${detalhes ? ' resultado-entrega__ampliada-corpo--detalhes' : ''}`} role="region" tabIndex={0}
      aria-label={detalhes ? t(`Detalhes de ${nome}`, `Details of ${nome}`) : t(`Imagem de ${nome}`, `Image of ${nome}`)}>
      <img ref={imagemRef} src={url} alt={nome} onLoad={conferirTamanho} />
    </div>
  </dialog>, document.body)
}

function VideoAmpliado({ url, nome, segundoInicial, fechar, retornarFoco, aoFalhar }: {
  url: string; nome: string; segundoInicial: number; fechar: (segundo: number) => void
  retornarFoco: HTMLButtonElement | null; aoFalhar: () => void
}) {
  const { t } = useIdioma()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    const video = videoRef.current
    dialog?.showModal()
    return () => {
      video?.pause()
      dialog?.close()
      if (retornarFoco?.isConnected) retornarFoco.focus()
    }
  }, [retornarFoco])
  const fecharVideo = () => {
    const video = videoRef.current
    const segundo = video && video.readyState >= HTMLMediaElement.HAVE_METADATA ? video.currentTime : segundoInicial
    fechar(typeof segundo === 'number' && Number.isFinite(segundo) ? segundo : 0)
  }
  return createPortal(<dialog ref={dialogRef} className="resultado-entrega__ampliada"
    aria-label={t(`Vídeo ampliado: ${nome}`, `Enlarged video: ${nome}`)}
    onCancel={e => { e.preventDefault(); fecharVideo() }}>
    <header><strong>{nome}</strong><button type="button" className="botao botao-fantasma botao-pequeno" onClick={fecharVideo} autoFocus>{t('Fechar', 'Close')}</button></header>
    <div className="resultado-entrega__ampliada-corpo">
      <video ref={videoRef} className="resultado-entrega__video-ampliado" src={url} controls preload="metadata" playsInline
        onLoadedMetadata={e => { if (Number.isFinite(segundoInicial)) e.currentTarget.currentTime = Math.max(0, segundoInicial) }}
        onError={aoFalhar} />
    </div>
  </dialog>, document.body)
}

function ponto(e: MouseEvent<HTMLImageElement>): PosicaoEntrega {
  const r = e.currentTarget.getBoundingClientRect()
  return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }
}

function VisorPdf({ entregaId, nome, aoApontar }: { entregaId: number; nome: string; aoApontar?: (p: PosicaoEntrega) => void }) {
  const { t } = useIdioma()
  const [pagina, setPagina] = useState(1)
  const [total, setTotal] = useState(1)
  const [imagem, setImagem] = useState<{ pagina: number; url: string; aoFalhar: () => void }>()
  const [erro, setErro] = useState('')
  const [tentativa, setTentativa] = useState(0)
  const previaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = new AbortController(); let url = ''
    const sessao = getSessionIdentity()
    const atual = () => !c.signal.aborted && sessao !== null && getSessionIdentity() === sessao
    const aoFalhar = () => {
      if (atual()) setErro(t('Não foi possível mostrar esta página. O arquivo original continua disponível para baixar.', 'Could not display this page. The original file is still available to download.'))
    }
    setErro('')
    setImagem(undefined)
    respostaAutenticada(`/entregas/${entregaId}/previa/${pagina}`, { signal: c.signal }).then(async r => {
      const blob = await r.blob()
      if (!atual()) return
      url = URL.createObjectURL(blob); setImagem({ pagina, url, aoFalhar }); setTotal(Number(r.headers.get('X-Total-Paginas')) || 1)
    }).catch(aoFalhar)
    return () => { c.abort(); if (url) URL.revokeObjectURL(url) }
  }, [entregaId, pagina, tentativa, t])
  return <div ref={previaRef} className="resultado-entrega__pdf" role="region" tabIndex={-1} aria-label={t(`Prévia de ${nome}`, `Preview of ${nome}`)}>
    <nav className="biblioteca-acoes" aria-label={t('Páginas do PDF', 'PDF pages')}><button className="botao botao-fantasma botao-pequeno" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}>{t('Anterior', 'Previous')}</button><span>{t('Página', 'Page')} {pagina} / {total}</span><button className="botao botao-fantasma botao-pequeno" disabled={pagina >= total} onClick={() => setPagina(p => p + 1)}>{t('Próxima', 'Next')}</button>{aoApontar && <button className="botao botao-fantasma botao-pequeno" onClick={() => aoApontar({ pagina })}>{t('Comentar nesta página', 'Comment on this page')}</button>}</nav>
    {erro ? <p className="resultado-entrega__erro" role="alert">{erro} <button type="button" className="botao botao-fantasma" onClick={() => { previaRef.current?.focus(); setTentativa(v => v + 1) }}>{t('Tentar novamente', 'Try again')}</button></p> : imagem?.pagina === pagina ? <img key={imagem.url} src={imagem.url} alt={`${nome} — ${t('página', 'page')} ${pagina}`} onError={imagem.aoFalhar} onClick={aoApontar ? e => aoApontar({ pagina, ...ponto(e) }) : undefined} style={aoApontar ? { cursor: 'crosshair' } : undefined} /> : <p role="status">{t('Abrindo página…', 'Opening page…')}</p>}
  </div>
}

function VisorEntrega({
  entregaId,
  nome,
  mime,
  tamanhoBytes,
  aoApontar,
}: {
  entregaId: number
  nome: string
  mime?: string | null
  tamanhoBytes?: number | null
  aoApontar?: (posicao: PosicaoEntrega) => void
}) {
  const { t, idioma } = useIdioma()
  const [url, setUrl] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [erro, setErro] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const [ampliada, setAmpliada] = useState(false)
  const [videoAmpliado, setVideoAmpliado] = useState<{ url: string; segundo: number } | null>(null)
  const ampliarRef = useRef<HTMLButtonElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  // Grande demais para baixar sozinho? O dono pede com um clique.
  const [pedido, setPedido] = useState(
    tamanhoBytes == null || tamanhoBytes <= TETO_AUTO_BYTES,
  )

  const video = ehVideoEntrega(nome, mime)
  const imagem = !video && ehImagemEntrega(nome, mime)
  const audio = !video && !imagem && ehAudioEntrega(nome, mime)
  const pagina = !video && !imagem && !audio && ehHtmlEntrega(nome, mime)
  const texto = !video && !imagem && !audio && !pagina && ehTextoEntrega(nome, mime)
  const word = /\.docx$/i.test(nome)
  const visivel = video || imagem || audio || pagina || texto

  useEffect(() => {
    if (!visivel || !pedido) return
    let vivo = true
    let local: string | null = null
    const abort = new AbortController()
    setErro(false)
    setUrl(null)
    setHtml(null)
    if (pagina || texto) {
      const teto = texto ? TETO_TEXTO_BYTES : TETO_HTML_BYTES
      const sessao = getSessionIdentity()
      respostaAutenticada(`/entregas/${entregaId}/${word ? 'leitura' : 'download'}`, { signal: abort.signal })
        .then(async (res) => {
          const texto = await lerTextoLimitado(res, teto, abort.signal, sessao)
          if (!vivo) return
          setHtml(texto)
        })
        .catch(() => {
          if (vivo) setErro(true)
        })
      return () => {
        vivo = false
        abort.abort()
      }
    }
    carregarArquivo(`/entregas/${entregaId}/download`, abort.signal)
      .then((u) => {
        if (!vivo) {
          URL.revokeObjectURL(u)
          return
        }
        local = u
        setUrl(u)
      })
      .catch(() => {
        if (vivo) setErro(true)
      })
    return () => {
      vivo = false
      abort.abort()
      if (local) URL.revokeObjectURL(local)
    }
  }, [entregaId, visivel, pedido, pagina, texto, word, tentativa])

  if (!visivel) return null
  if (erro) {
    return (
      <p className="resultado-entrega__erro texto-suave" role="alert">
        {t("Não consegui mostrar o resultado aqui — use o Baixar.", "Could not preview the result here. Use Download.")}
        {' '}<button type="button" className="botao botao-fantasma" onClick={() => setTentativa(t => t + 1)}>{t("Tentar novamente", "Try again")}</button>
      </p>
    )
  }
  if (!pedido) {
    return (
      <button
        type="button"
        className={`resultado-entrega__carregar${video || imagem ? ' resultado-entrega__carregar--visual' : ''}`}
        onClick={() => setPedido(true)}
      >
        <Icone nome={video ? 'play' : imagem ? 'arq-imagem' : 'anexo'} tamanho={video || imagem ? 32 : 18} />
        <strong>{video ? t('Abrir prévia de vídeo', 'Open video preview') : imagem ? t('Abrir prévia da imagem', 'Open image preview') : t('Carregar o arquivo', 'Load file')}</strong>
        {tamanhoBytes != null && <span>{formatBytes(tamanhoBytes, idioma)}</span>}
      </button>
    )
  }
  if (texto && html !== null) {
    return <article className="visor-markdown resultado-entrega__texto" aria-label={nome}>
      <LeituraMarkdown texto={html} />
      {aoApontar && <button type="button" onClick={() => aoApontar({})}>{t('Comentar neste texto', 'Comment on this text')}</button>}
    </article>
  }
  if (pagina && html !== null) {
    return (
      <div className="resultado-entrega__html">
      <iframe
        className="resultado-entrega__pagina"
        // sandbox VAZIO: renderiza, não executa. HTML de agente nunca roda
        // no nosso origin — ver o cabeçalho deste arquivo.
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={protegerHtmlPrevia(html)}
        title={nome}
      />
      {temRecursosExternosHtml(html) && <p className="texto-suave">{t('Imagens e fontes externas não carregam nesta prévia. O arquivo original continua disponível em Baixar.', 'External images and fonts do not load in this preview. The original file is still available under Download.')}</p>}
      {aoApontar && <button type="button" onClick={() => aoApontar({})}>{t('Comentar nesta página', 'Comment on this page')}</button>}
      </div>
    )
  }
  if (url && video) {
    // controls sem autoplay: som estourando sozinho é a coisa mais
    // indelicada que uma tela de trabalho pode fazer.
    const aoFalhar = () => { setVideoAmpliado(null); setErro(true) }
    return <div className="resultado-entrega__midia"><video ref={videoRef} className="resultado-entrega__video" src={url} controls preload="metadata" onError={aoFalhar} />
      <div className="resultado-entrega__video-acoes"><button ref={ampliarRef} type="button" className="botao botao-fantasma botao-pequeno" aria-haspopup="dialog" onClick={() => {
        videoRef.current?.pause()
        setVideoAmpliado({ url, segundo: videoRef.current?.currentTime || 0 })
      }}>{t('Ampliar vídeo', 'Enlarge video')}</button>{aoApontar && <button type="button" onClick={() => { videoRef.current?.pause(); aoApontar({ segundo: videoRef.current?.currentTime || 0 }) }}>{t('Comentar neste instante', 'Comment at this moment')}</button>}</div>
      {videoAmpliado?.url === url && <VideoAmpliado url={url} nome={nome} segundoInicial={videoAmpliado.segundo} retornarFoco={ampliarRef.current} aoFalhar={aoFalhar} fechar={segundo => {
        const atual = videoRef.current
        if (atual && atual.getAttribute('src') === videoAmpliado.url) atual.currentTime = segundo
        setVideoAmpliado(null)
      }} />}
    </div>
  }
  if (url && imagem) {
    return <div className="resultado-entrega__midia"><img className="resultado-entrega__img" src={url} alt={nome} loading="lazy" onError={() => setErro(true)} onClick={aoApontar ? e => aoApontar(ponto(e)) : undefined} style={aoApontar ? { cursor: 'crosshair' } : undefined} />
      <div className="resultado-entrega__acoes"><button ref={ampliarRef} type="button" className="botao botao-fantasma botao-pequeno" aria-haspopup="dialog" onClick={() => setAmpliada(true)}>{t('Ampliar imagem', 'Enlarge image')}</button>{aoApontar && <button type="button" onClick={() => aoApontar({})}>{t('Comentar nesta imagem', 'Comment on this image')}</button>}</div>
      {ampliada && <ImagemAmpliada url={url} nome={nome} fechar={() => setAmpliada(false)} retornarFoco={ampliarRef.current} />}
    </div>
  }
  if (url && audio) {
    return <div><audio ref={audioRef} className="resultado-entrega__audio" src={url} controls onError={() => setErro(true)} />{aoApontar && <button type="button" onClick={() => { audioRef.current?.pause(); aoApontar({ segundo: audioRef.current?.currentTime || 0 }) }}>{t('Comentar neste instante', 'Comment at this moment')}</button>}</div>
  }
  return <div className={`resultado-entrega__abrindo${video || imagem ? ' resultado-entrega__abrindo--visual' : ''}`} role="status">
    <span className="esqueleto esqueleto-linha" aria-hidden="true" />
    <span>{t('Abrindo prévia…', 'Opening preview…')}</span>
  </div>
}
