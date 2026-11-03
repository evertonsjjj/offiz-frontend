/**
 * O VISOR (16/08/2026): um arquivo do quadro aberto NA FRENTE, sem sair da
 * tela — o clipe de uma cena, a narração sozinha, o modelo de post que virou
 * base. Nasceu dentro do ComoFoiFeita e virou componente quando o QuadroFluxo
 * (o quadro de QUALQUER trabalho) precisou do mesmo gesto: o pedido do dono
 * foi literal, "tudo tem que ter a opção de ver".
 *
 * Quem é dono da URL do blob é o PAI (ele buscou, ele revoga) — aqui só se
 * apresenta e se fecha: clique no fundo, botão ou Esc.
 */

import { useEffect, useRef, useState } from 'react'
import { Icone } from '../Icone'
import { useIdioma } from '../../lib/i18n'
import { getSessionIdentity } from '../../lib/api'
import DialogoArquivo from './DialogoArquivo'

export type MidiaVisor = 'video' | 'audio' | 'imagem' | 'documento'

/** Pela extensão, porque é o que os documentos guardam — e ela decide qual
 *  elemento toca (um <video> com mp3 dentro não mostra controle nenhum).
 *  Desconhecido cai em 'documento', nunca num player quebrado: um PDF dentro
 *  de um <video> renderiza NADA, sem mensagem nenhuma. */
export function midiaDe(caminho: string): MidiaVisor {
  const ext = caminho.toLowerCase().split('.').pop() || ''
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(ext)) return 'audio'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return 'imagem'
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video'
  return 'documento'
}

type VisorProps = {
  titulo: string
  /** Só informativo — aparece embaixo, para o dono saber DE ONDE veio. */
  caminho: string
  midia: MidiaVisor
  /** null = ainda buscando (o pai mostra "Abrindo…"). */
  url: string | null
  erro: string | null
  /** Outra abertura do mesmo caminho invalida somente sua ação de download. */
  identidadeArquivo?: number
  /** O pai escolhe a porta autenticada e revalida o contexto da abertura. */
  aoBaixar?: (signal: AbortSignal, vigente: () => boolean) => Promise<void>
  aoFechar: () => void
}

export default function VisorArquivo(props: VisorProps) {
  const { t } = useIdioma()
  const origem = props.caminho.startsWith('entrega:')
    ? t('Arquivo da entrega', 'Deliverable file')
    : props.caminho
  return <DialogoArquivo className="cff-visor" nome={t(`Ver ${props.titulo}`, `View ${props.titulo}`)} aoFechar={props.aoFechar}>
    <div className="cff-visor-caixa" onClick={e => e.stopPropagation()}>
      <header>
        <strong>{props.titulo}</strong>
        <button type="button" className="botao-texto" onClick={props.aoFechar} autoFocus>
          <Icone nome="fechar" tamanho={15} /> {t('fechar', 'close')}
        </button>
      </header>
      <PreviaDoArquivo key={JSON.stringify([getSessionIdentity(), props.titulo, props.caminho, props.midia, props.url])} {...props} />
      <small className="texto-suave" title={origem}>{origem}</small>
      {props.aoBaixar && <DownloadDoArquivo
        key={JSON.stringify([getSessionIdentity(), props.titulo, props.caminho, props.midia, props.identidadeArquivo])}
        aoBaixar={props.aoBaixar}
      />}
    </div>
  </DialogoArquivo>
}

function PreviaDoArquivo({
  titulo,
  midia,
  url,
  erro,
  aoBaixar,
}: VisorProps) {
  const { t } = useIdioma()
  const [falhaMidia, setFalhaMidia] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const erroVisivel = erro || (falhaMidia ? t('Não consegui exibir a prévia deste arquivo.', 'I could not display this file’s preview.') : null)
  return <>
        {erroVisivel && <p className="alerta alerta-erro" role="alert">{erroVisivel}</p>}
        {!erro && falhaMidia && <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => { setFalhaMidia(false); setTentativa(n => n + 1) }}>{t('Tentar a prévia novamente', 'Try the preview again')}</button>}
        {!erroVisivel && !url && <p className="texto-suave" role="status">{t('Abrindo…', 'Opening…')}</p>}
        {!erroVisivel && url && midia === 'video' && <video key={tentativa} src={url} controls autoPlay={tentativa === 0} onError={() => setFalhaMidia(true)} className="cff-video" />}
        {!erroVisivel && url && midia === 'audio' && (
          <audio key={tentativa} src={url} controls autoPlay={tentativa === 0} onError={() => setFalhaMidia(true)} className="cff-audio-player" />
        )}
        {!erroVisivel && url && midia === 'imagem' && <img key={tentativa} src={url} alt={titulo} onError={() => setFalhaMidia(true)} className="cff-visor-img" />}
        {url && midia === 'documento' && (
          <p className="texto-suave">
            {aoBaixar
              ? t('Este tipo de arquivo não tem prévia aqui. Use “Baixar arquivo” para abrir no seu computador.', 'This file type cannot be previewed here. Use “Download file” to open it on your computer.')
              : t('Este tipo de arquivo não abre aqui — baixe para ver no seu computador.', 'This file type cannot be displayed here. Download it to view on your computer.')}
          </p>
        )}
  </>
}

/** Uma nova leitura por clique explícito; o Blob da prévia nunca vira download. */
function DownloadDoArquivo({ aoBaixar }: {
  aoBaixar: NonNullable<VisorProps['aoBaixar']>
}) {
  const { t } = useIdioma()
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState('')
  const sessao = useRef(getSessionIdentity()).current
  const vivoRef = useRef(true)
  const downloadRef = useRef<AbortController | null>(null)
  useEffect(() => {
    vivoRef.current = true
    return () => { vivoRef.current = false; downloadRef.current?.abort(); downloadRef.current = null }
  }, [])

  async function baixar() {
    if (!sessao || getSessionIdentity() !== sessao || !vivoRef.current || downloadRef.current) return
    const controller = new AbortController()
    downloadRef.current = controller
    const vigente = () => vivoRef.current && downloadRef.current === controller && !controller.signal.aborted && getSessionIdentity() === sessao
    setBaixando(true)
    setErro('')
    try {
      await aoBaixar(controller.signal, vigente)
    } catch {
      if (vigente()) setErro(t('Não consegui baixar este arquivo agora. Tente novamente.', 'I could not download this file right now. Please try again.'))
    } finally {
      if (downloadRef.current === controller) {
        downloadRef.current = null
        if (vivoRef.current && getSessionIdentity() === sessao) setBaixando(false)
      }
    }
  }

  return <div>
    <button type="button" className="botao botao-fantasma botao-pequeno" disabled={baixando} onClick={() => void baixar()}>
      <Icone nome="baixar" tamanho={16} /> {baixando ? t('Baixando…', 'Downloading…') : t('Baixar arquivo', 'Download file')}
    </button>
    {baixando && <span className="sr-only" role="status">{t('Baixando arquivo…', 'Downloading file…')}</span>}
    {erro && <p className="alerta alerta-erro" role="alert">{erro}</p>}
  </div>
}
