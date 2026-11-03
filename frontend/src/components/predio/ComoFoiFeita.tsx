import { formatUSD } from '../../lib/i18nProducao'
import { useIdioma } from '../../lib/i18n'
/**
 * 🧬 COMO FOI FEITA — o quadro "tipo Miro" da genealogia da peça (pedido do
 * dono, 13/08/2026): o rastreio do pensamento da IA sempre à mão, e o fluxo
 * EDITÁVEL — trocar uma fonte prepara o pedido pronto no chat do Estúdio
 * (quem muda o documento é o agente, com o plano de custo antes; esta tela
 * nunca gasta um centavo sozinha).
 *
 * Três colunas ligadas por arestas desenhadas de verdade (SVG medido no DOM):
 * FONTES (o material do dono, com a legenda do catálogo) → CENAS (prompt,
 * modelo, custo e a miniatura paga do cache) → SAÍDA (trilha, narração e o
 * filme na ordem da montagem). Fonte que o documento cita mas não existe
 * mais vira nó de TRAVA em vermelho — é o mesmo motivo que a devolutiva
 * explica no chat quando a IA diz "não consegui gerar".
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, ApiError, baixarArquivo, carregarArquivo, getSessionIdentity } from '../../lib/api'
import VisorArquivo, { midiaDe, type MidiaVisor } from './VisorArquivo'
import { Icone } from '../Icone'
import type { NomeIcone } from '../Icone'
import { wsClient } from '../../lib/ws'
import { BotaoComentar, ListaComentarios, useComentarios, type AncoraTipo } from './ComentariosFluxo'

type FonteFluxo = {
  caminho: string
  nome: string
  legenda?: string | null
  media: string
  existe: boolean
  papeis: string[]
  cenas: string[]
}

type AusenciaFluxo = { papel: string; caminho: string }

type CenaFluxo = {
  id: string
  ato?: string | null
  tipo: string
  rotulo: string
  roteiro?: string | null
  dur?: number | null
  travado: boolean
  prompt?: string | null
  modelo?: string | null
  seed?: number | null
  custo_usd: number
  takes: number
  quando?: string | null
  fontes: string[]
  ausencias: AusenciaFluxo[]
  thumb?: string | null
  video?: string | null
  video_composto?: string | null
  gerada: boolean
  composta: boolean
}

type FluxoPeca = {
  slug: string
  titulo: string
  estado: string
  gasto_usd: number
  teto_usd: number
  fontes: FonteFluxo[]
  cenas: CenaFluxo[]
  audio: {
    trilha?: { prompt?: string; modelo?: string; custo_usd: number; existe: boolean; arquivo: string } | null
    narracao?: { porta_voz?: string; estilo?: string; modelo?: string; existe: boolean; arquivo: string } | null
  }
  final: {
    master: string
    existe: boolean
    montagem: string[]
    quando?: string | null
    contact_sheet?: string | null
  }
  tem_rastro: boolean
}

type ArquivoAcervo = { nome: string; legenda?: string | null }

/** O visor: um arquivo do quadro aberto na frente, sem sair da tela. */
type Visor = {
  pedido: number
  downloadPath: string
  nomeArquivo: string
  caminho: string
  titulo: string
  midia: MidiaVisor
  url: string | null
  erro: string | null
}

type Aresta = { d: string; falta?: boolean }

/* 'arq-pasta' no desconhecido é o MESMO fallback de `iconeDoArquivo` e de
   TIPO_ENTREGA_ICONE (lib/format.ts) — tipo que ninguém soube dizer tem um
   sinal só no produto inteiro. */
const MEDIA_ICONE: Record<string, NomeIcone> = {
  imagem: 'arq-imagem', video: 'arq-video', audio: 'audio', outro: 'arq-pasta',
}

const usd = formatUSD

type ComoFoiFeitaProps = {
  orgId: number
  officeSlug: string
  pecaSlug: string
  /** Escreve o pedido PRONTO no composer do Estúdio — editar o fluxo é
   *  conversar: a tela prepara, você revisa e manda. */
  aoPreencher: (texto: string) => void
}

export default function ComoFoiFeita(props: ComoFoiFeitaProps) {
  return <FluxoDaPeca key={JSON.stringify([getSessionIdentity(), props.orgId, props.officeSlug, props.pecaSlug])} {...props} />
}

function FluxoDaPeca({ orgId, officeSlug, pecaSlug, aoPreencher }: ComoFoiFeitaProps) {
  const { t: tr, idioma } = useIdioma()
  const base = `/predios/${orgId}/${officeSlug}/estudio/pecas/${pecaSlug}`
  const [fluxo, setFluxo] = useState<FluxoPeca | null>(null)
  const [erro, setErro] = useState('')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [masterUrl, setMasterUrl] = useState<string | null>(null)
  const [abrindoMaster, setAbrindoMaster] = useState(false)
  const [erroMaster, setErroMaster] = useState('')
  const [trocando, setTrocando] = useState<FonteFluxo | null>(null)
  const [visor, setVisor] = useState<Visor | null>(null)
  const [acervo, setAcervo] = useState<Array<{ pasta: string; caminho: string; item: ArquivoAcervo }> | null>(null)
  const [arestas, setArestas] = useState<Aresta[]>([])
  const [tamanho, setTamanho] = useState({ w: 0, h: 0 })

  const quadroRef = useRef<HTMLDivElement | null>(null)
  const nosRef = useRef(new Map<string, HTMLElement>())
  const thumbsRef = useRef<Record<string, string>>({})
  const sessao = useRef(getSessionIdentity()).current
  const visorVivoRef = useRef(true)
  const visorPedidoRef = useRef(0)
  const visorLeituraRef = useRef<AbortController | null>(null)
  const visorUrlRef = useRef<string | null>(null)
  const masterLeituraRef = useRef<AbortController | null>(null)
  const masterUrlRef = useRef<string | null>(null)
  const fluxoVivoRef = useRef(true)
  const fluxoPedidoRef = useRef(0)
  const fluxoLeituraRef = useRef<AbortController | null>(null)

  /* COMENTÁRIOS ANCORADOS (07/09/2026): cada nó do quadro aceita um comentário
     preso a ele — e o comentário vira tarefa ou lição. */
  const comentarios = useComentarios(orgId, officeSlug, { peca: pecaSlug })
  const abertosEm = (tipo: AncoraTipo, ref: string) =>
    comentarios.lista.filter((c) => c.estado === 'aberto' && c.ancora.tipo === tipo && c.ancora.ref === ref).length

  const registrar = useCallback((id: string) => {
    return (el: HTMLElement | null) => {
      if (el) nosRef.current.set(id, el)
      else nosRef.current.delete(id)
    }
  }, [])

  const carregar = useCallback(() => {
    if (!fluxoVivoRef.current || !sessao || getSessionIdentity() !== sessao) return
    const pedido = ++fluxoPedidoRef.current
    fluxoLeituraRef.current?.abort()
    const controller = new AbortController()
    fluxoLeituraRef.current = controller
    const vigente = () => fluxoVivoRef.current && fluxoPedidoRef.current === pedido && !controller.signal.aborted && getSessionIdentity() === sessao
    api
      .get<FluxoPeca>(`${base}/fluxo`, controller.signal)
      .then((r) => {
        if (!vigente()) return
        setFluxo(r)
        setErro('')
      })
      .catch((e) => {
        if (vigente()) setErro(e instanceof ApiError ? e.detail : tr("Não consegui montar o fluxo desta peça.", "I could not build this production’s workflow."))
      })
      .finally(() => {
        if (fluxoLeituraRef.current === controller) fluxoLeituraRef.current = null
      })
  }, [base, sessao, tr])

  useEffect(() => {
    fluxoVivoRef.current = true
    carregar()
    // o render escreve o documento e o finish mescla — o quadro acompanha
    const desinscrever = wsClient.on('job_status', carregar)
    return () => {
      desinscrever()
      fluxoVivoRef.current = false
      fluxoPedidoRef.current++
      fluxoLeituraRef.current?.abort()
      fluxoLeituraRef.current = null
    }
  }, [carregar])

  // miniaturas: cada byte sai pela porta estreita da peça (whitelist do
  // documento) — objectURLs revogados na troca/desmontagem, nunca vazam.
  useEffect(() => {
    if (!fluxo) return
    let vivo = true
    const alvos: string[] = []
    for (const f of fluxo.fontes) {
      if (f.existe && f.media === 'imagem') alvos.push(f.caminho)
    }
    for (const c of fluxo.cenas) {
      if (c.thumb) alvos.push(c.thumb)
    }
    const faltam = alvos.filter((a) => !thumbsRef.current[a])
    if (faltam.length === 0) return
    ;(async () => {
      const novos: Record<string, string> = {}
      for (const rel of faltam) {
        try {
          novos[rel] = await carregarArquivo(`${base}/arquivo?caminho=${encodeURIComponent(rel)}`)
        } catch {
          /* sem miniatura — o cartão mostra o ícone */
        }
        if (!vivo) break
      }
      if (vivo && Object.keys(novos).length) {
        thumbsRef.current = { ...thumbsRef.current, ...novos }
        setThumbs(thumbsRef.current)
      } else {
        Object.values(novos).forEach((u) => URL.revokeObjectURL(u))
      }
    })()
    return () => {
      vivo = false
    }
  }, [fluxo, base])

  useEffect(
    () => () => {
      Object.values(thumbsRef.current).forEach((u) => URL.revokeObjectURL(u))
      thumbsRef.current = {}
    },
    [pecaSlug],
  )

  // as ARESTAS: medidas no DOM de verdade (fonte→cena→filme), recalculadas
  // quando o quadro muda de tamanho — é o que faz o "tipo Miro" ser um
  // desenho do fluxo real, não uma ilustração.
  const recalcular = useCallback(() => {
    const quadro = quadroRef.current
    const f = fluxo
    if (!quadro || !f) return
    const ref = quadro.getBoundingClientRect()
    const centroDireita = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return { x: r.right - ref.left, y: r.top - ref.top + r.height / 2 }
    }
    const centroEsquerda = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return { x: r.left - ref.left, y: r.top - ref.top + r.height / 2 }
    }
    const ligar = (deId: string, paraId: string, falta?: boolean): Aresta | null => {
      const de = nosRef.current.get(deId)
      const para = nosRef.current.get(paraId)
      if (!de || !para) return null
      const a = centroDireita(de)
      const b = centroEsquerda(para)
      const dx = Math.max(24, (b.x - a.x) / 2)
      return {
        d: `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`,
        falta,
      }
    }
    const novas: Aresta[] = []
    const existePorCaminho = new Map(f.fontes.map((x) => [x.caminho, x.existe]))
    for (const c of f.cenas) {
      for (const caminho of c.fontes) {
        const ar = ligar(`f:${caminho}`, `c:${c.id}`, existePorCaminho.get(caminho) === false)
        if (ar) novas.push(ar)
      }
    }
    for (const cid of f.final.montagem) {
      const ar = ligar(`c:${cid}`, 'final')
      if (ar) novas.push(ar)
    }
    if (f.audio.trilha) {
      const ar = ligar('a:trilha', 'final')
      if (ar) novas.push(ar)
    }
    if (f.audio.narracao) {
      const ar = ligar('a:narracao', 'final')
      if (ar) novas.push(ar)
      for (const fonte of f.fontes) {
        if (fonte.papeis.includes('porta-voz')) {
          const a2 = ligar(`f:${fonte.caminho}`, 'a:narracao', !fonte.existe)
          if (a2) novas.push(a2)
        }
      }
    }
    setArestas(novas)
    setTamanho({ w: quadro.scrollWidth, h: quadro.scrollHeight })
  }, [fluxo])

  useLayoutEffect(() => {
    recalcular()
    const quadro = quadroRef.current
    if (!quadro) return
    const ro = new ResizeObserver(recalcular)
    ro.observe(quadro)
    return () => ro.disconnect()
  }, [recalcular, thumbs])

  function abrirTroca(f: FonteFluxo) {
    setTrocando(f)
    if (acervo === null) {
      api
        .get<{ entrada: ArquivoAcervo[]; produto: ArquivoAcervo[]; exemplos: ArquivoAcervo[] }>(
          `/predios/${orgId}/${officeSlug}/arquivos`,
        )
        .then((r) => {
          const lista: Array<{ pasta: string; caminho: string; item: ArquivoAcervo }> = []
          for (const it of r.entrada || []) lista.push({ pasta: 'entrada', caminho: `entrada/${it.nome}`, item: it })
          for (const it of r.produto || []) lista.push({ pasta: 'acervo', caminho: `memoria/brand/acervo/${it.nome}`, item: it })
          for (const it of r.exemplos || []) lista.push({ pasta: 'exemplos', caminho: `memoria/brand/acervo/exemplos/${it.nome}`, item: it })
          setAcervo(lista)
        })
        .catch(() => setAcervo([]))
    }
  }

  function trocarPor(novoCaminho: string) {
    if (!trocando) return
    const cenas = trocando.cenas.length ? trocando.cenas.join(', ') : tr("onde ela aparece", "where it appears")
    aoPreencher(
      tr(`Na peça "${pecaSlug}", troque a referência ${trocando.caminho} (cenas ${cenas}) pelo arquivo ${novoCaminho}. `, `In production “${pecaSlug}”, replace the reference ${trocando.caminho} (scenes ${cenas}) with ${novoCaminho}. `) +
        tr("Atualize o documento, rode o plano e me diga o custo; depois re-renderize SÓ essas cenas ", "Update the document, run the plan, and tell me the cost; then re-render ONLY these scenes ") +
        tr("(cache por cena) — as outras não podem ser refeitas nem pagas de novo.", "(using scene caching). Do not regenerate or pay again for the other scenes."),
    )
    setTrocando(null)
  }

  async function assistirMaster() {
    if (!sessao || getSessionIdentity() !== sessao || !visorVivoRef.current || masterUrlRef.current || masterLeituraRef.current || !fluxo?.final.existe) return
    const controller = new AbortController()
    masterLeituraRef.current = controller
    const vigente = () => visorVivoRef.current && masterLeituraRef.current === controller && !controller.signal.aborted && getSessionIdentity() === sessao
    setAbrindoMaster(true)
    setErroMaster('')
    try {
      const url = await carregarArquivo(`${base}/arquivo?caminho=${encodeURIComponent(fluxo.final.master)}`, controller.signal)
      if (!vigente()) { URL.revokeObjectURL(url); return }
      masterUrlRef.current = url
      setMasterUrl(url)
    } catch {
      if (vigente()) setErroMaster(tr('Não consegui abrir o filme agora. Tente novamente ou baixe pela aba Entregas.', 'I could not open the video right now. Try again or download it from Deliverables.'))
    } finally {
      if (masterLeituraRef.current === controller) {
        masterLeituraRef.current = null
        if (visorVivoRef.current && getSessionIdentity() === sessao) setAbrindoMaster(false)
      }
    }
  }

  /* O VISOR (16/08/2026): ver O QUE ENTROU, não só a lista do que entrou.
   *
   * O quadro contava a história certa e não deixava conferir nenhuma peça
   * dela: o clipe de cada cena, a narração sozinha (que é o item mais pedido
   * — dá para aprovar a voz sem assistir ao filme) e o material do acervo que
   * serviu de base. Tudo passa pela MESMA porta autenticada do master, que só
   * serve o que o documento referencia. */
  async function abrirVisor(caminho: string, titulo: string, midia: MidiaVisor) {
    if (!sessao || getSessionIdentity() !== sessao) return
    const pedido = ++visorPedidoRef.current
    visorLeituraRef.current?.abort()
    const controller = new AbortController()
    visorLeituraRef.current = controller
    if (visorUrlRef.current) URL.revokeObjectURL(visorUrlRef.current)
    visorUrlRef.current = null
    const vigente = () => visorVivoRef.current && visorPedidoRef.current === pedido && !controller.signal.aborted && getSessionIdentity() === sessao
    const arquivo = { pedido, caminho, titulo, midia, downloadPath: `${base}/arquivo?caminho=${encodeURIComponent(caminho)}`, nomeArquivo: caminho.split('/').pop() || 'arquivo' }
    setVisor({ ...arquivo, url: null, erro: null })
    try {
      const url = await carregarArquivo(
        arquivo.downloadPath,
        controller.signal,
      )
      // Reabrir o mesmo caminho é outra leitura. A primeira não pode trocar
      // a prévia nova, mesmo se o transporte terminar depois do cancelamento.
      if (!vigente()) {
        if (url !== visorUrlRef.current) URL.revokeObjectURL(url)
        return
      }
      visorUrlRef.current = url
      setVisor({ ...arquivo, url, erro: null })
    } catch {
      if (vigente()) setVisor({ ...arquivo, url: null, erro: tr('Não consegui abrir a prévia agora. Você pode baixar o arquivo.', 'I could not open the preview right now. You can download the file.') })
    }
  }

  function fecharVisor() {
    visorPedidoRef.current++
    visorLeituraRef.current?.abort()
    visorLeituraRef.current = null
    if (visorUrlRef.current) URL.revokeObjectURL(visorUrlRef.current)
    visorUrlRef.current = null
    setVisor(null)
  }
  useEffect(() => {
    visorVivoRef.current = true
    return () => {
      visorVivoRef.current = false
      visorPedidoRef.current++
      visorLeituraRef.current?.abort()
      if (visorUrlRef.current) URL.revokeObjectURL(visorUrlRef.current)
      visorUrlRef.current = null
      masterLeituraRef.current?.abort()
      masterLeituraRef.current = null
      if (masterUrlRef.current) URL.revokeObjectURL(masterUrlRef.current)
      masterUrlRef.current = null
    }
  }, [])

  if (erro && !fluxo) return <p className="alerta alerta-erro">{erro}</p>
  if (!fluxo) return <p className="texto-suave">{tr("Montando o fluxo…", "Building the workflow…")}</p>

  const travas = fluxo.cenas.flatMap((c) => c.ausencias.map((a) => ({ cena: c.id, ...a })))

  return (
    <section className="cff" aria-label={tr("Como foi feita — o fluxo da peça", "How it was made — production workflow")}>
      <header className="cff-cabeca">
        <h3>
          <Icone nome="fluxo" tamanho={15} /> {tr("Como foi feita", "How it was made")}</h3>
        <p className="texto-suave">
          {tr("Cada quadrado é um material ou um passo; as linhas mostram o que entrou em quê. Trocar uma fonte prepara o pedido no chat — nada é gasto sem o seu Enter. Comente em qualquer quadrado: cada comentário vira tarefa ou lição.", "Each box is a material or a step; lines show how they connect. Replacing a source prepares a request in chat. Nothing is spent until you send it. Comments on boxes can become tasks or lessons.")}</p>
      </header>

      <ListaComentarios
        lista={comentarios.lista}
        agir={comentarios.agir}
        apagar={comentarios.apagar}
        titulo={tr("Comentários desta peça", "Production comments")}
      />

      {travas.length > 0 && (
        <p className="alerta alerta-erro cff-trava-aviso">
          {tr("🧭 Este fluxo tem trava: ", "🧭 This workflow has a blocker: ")}{travas.map((t) => tr(`a referência ${t.caminho} (cena ${t.cena}) não existe mais`, `reference ${t.caminho} (scene ${t.cena}) no longer exists`)).join('; ')}{tr(". A IA não regenera essas cenas até o insumo voltar — é isso que a devolutiva explica no chat.", ". The AI will not regenerate these scenes until the missing input is restored. The conversation explains what is needed.")}</p>
      )}
      {!fluxo.tem_rastro && (
        <p className="texto-suave cff-nota">
          {tr("Esta peça é de antes do rastro completo — mostro o que o documento sabe. Na próxima renderização, prompt, modelo e fontes ficam gravados cena a cena.", "This production predates full tracing, so I can show only what its document records. The next render will record prompts, models, and sources for each scene.")}</p>
      )}

      <div className="cff-quadro" ref={quadroRef}>
        <svg
          className="cff-arestas"
          width={tamanho.w}
          height={tamanho.h}
          aria-hidden="true"
        >
          {arestas.map((a, i) => (
            <path key={i} d={a.d} className={a.falta ? 'falta' : ''} />
          ))}
        </svg>

        {/* coluna 1 — FONTES: o material do dono */}
        <div className="cff-col">
          <h4>{tr("O seu material", "Your materials")}</h4>
          {fluxo.fontes.length === 0 && (
            <p className="texto-suave cff-nota">
              {tr("Nenhum arquivo seu entrou nesta peça — as cenas nasceram só de prompt.", "None of your files were used in this production. The scenes were generated from prompts alone.")}</p>
          )}
          {fluxo.fontes.map((f) => (
            <div
              key={f.caminho}
              ref={registrar(`f:${f.caminho}`)}
              className={`cff-no cff-fonte${f.existe ? '' : ' cff-falta'}`}
            >
              {f.existe && f.media === 'imagem' && thumbs[f.caminho] ? (
                <img src={thumbs[f.caminho]} alt="" className="cff-thumb" />
              ) : (
                <span className="cff-icone">
                  <Icone nome={f.existe ? MEDIA_ICONE[f.media] || 'arq-pasta' : 'alerta'} />
                </span>
              )}
              <div className="cff-no-texto">
                <strong>{f.legenda || f.nome}</strong>
                <small title={f.caminho}>
                  {f.papeis.join(' · ')}
                  {f.cenas.length > 0 ? ` → ${f.cenas.join(', ')}` : ''}
                </small>
                {!f.existe && <small className="cff-falta-txt">{tr("não existe mais no acervo", "no longer in the asset library")}</small>}
              </div>
              <div className="cff-no-acoes">
                <BotaoComentar
                  ancora={{ tipo: 'fonte', ref: f.caminho, rotulo: f.legenda || f.nome }}
                  quantos={abertosEm('fonte', f.caminho)}
                  aoCriar={comentarios.criar}
                />
                {/* VER A BASE. Esta coluna é o "conhecimento" da peça: o
                    material do dono que a IA leu para criar — o post que ele
                    curtiu e mandou usar de modelo, a foto do produto. Listar
                    sem deixar abrir obriga a caçar o arquivo no acervo para
                    conferir se era MESMO aquele. */}
                {f.existe && !f.papeis.includes('porta-voz') && (
                  <button
                    type="button"
                    className="botao-texto"
                    onClick={() =>
                      abrirVisor(f.caminho, f.legenda || f.nome, midiaDe(f.caminho))
                    }
                  >
                    <Icone nome="lupa" titulo={tr("Ver o que a IA usou como base", "View the source material used by the AI")} />
                  </button>
                )}
                {/* porta-voz não passa pelo seletor de fotos: trocar a VOZ é
                    assunto do documento (outro --porta-voz) — vai pelo chat. */}
                {f.existe && f.papeis.includes('porta-voz') ? (
                  <button
                    type="button"
                    className="botao-texto"
                    onClick={() =>
                      aoPreencher(
                        tr(`Na peça "${pecaSlug}", quero trocar o porta-voz da narração. Quem está no acervo, e o que muda no custo?`, `In production “${pecaSlug}”, I want to change the narrator. Who is in the asset library, and how would the cost change?`),
                      )
                    }
                  >
                    <Icone nome="loop" tamanho={15} /> {tr("Trocar", "Replace")}</button>
                ) : f.existe ? (
                  <button type="button" className="botao-texto" onClick={() => abrirTroca(f)}>
                    <Icone nome="loop" tamanho={15} /> {tr("Trocar", "Replace")}</button>
                ) : (
                  <button
                    type="button"
                    className="botao-texto"
                    onClick={() =>
                      aoPreencher(
                        tr(`A peça "${pecaSlug}" está travada: a referência ${f.caminho} (cenas ${f.cenas.join(', ') || '—'}) não existe mais. `, `Production “${pecaSlug}” is blocked: reference ${f.caminho} (scenes ${f.cenas.join(', ') || '—'}) no longer exists. `) +
                          tr(`O que você precisa que eu suba? Se houver outra foto no acervo que sirva, proponha.`, `What do you need me to upload? Suggest another suitable photo from the asset library if one is available.`),
                      )
                    }
                  >
                    <Icone nome="bussola" tamanho={15} /> {tr("Resolver no chat", "Resolve in chat")}</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* coluna 2 — CENAS: o pensamento da IA, cena a cena */}
        <div className="cff-col cff-col-cenas">
          <h4>{tr("As cenas", "The scenes")}</h4>
          {fluxo.cenas.map((c) => (
            <div
              key={c.id}
              ref={registrar(`c:${c.id}`)}
              className={`cff-no cff-cena${c.ausencias.length ? ' cff-falta' : ''}`}
            >
              {c.thumb && thumbs[c.thumb] ? (
                <img src={thumbs[c.thumb]} alt="" className="cff-thumb" />
              ) : (
                <span className="cff-icone">
                  <Icone nome={c.tipo === 'cartela' ? 'arq-texto' : c.gerada ? 'arq-video' : 'ampulheta'} />
                </span>
              )}
              <div className="cff-no-texto">
                <strong>
                  <code>{c.id}</code> {c.rotulo}
                  {c.travado && (
                    <>
                      {' '}
                      <Icone nome="cadeado" tamanho={15} />
                    </>
                  )}
                </strong>
                <small>
                  {c.tipo}
                  {c.dur ? tr(` · ${String(c.dur).replace('.', ',')} s`, ` · ${String(c.dur)} s`) : ''}
                  {c.modelo ? ` · ${c.modelo.split('/').slice(-1)[0]}` : ''}
                  {c.custo_usd > 0 ? ` · ${usd(c.custo_usd, idioma)}` : ''}
                  {c.takes > 0 ? ` · ${c.takes} take(s)` : tr(" · nada gerado", " · nothing generated")}
                </small>
                {c.ausencias.length > 0 && (
                  <small className="cff-falta-txt">
                    {tr("falta: ", "missing: ")}{c.ausencias.map((a) => a.caminho).join(', ')}
                  </small>
                )}
                {c.prompt && (
                  <details className="cff-prompt">
                    <summary>{tr("o prompt que a IA usou", "the prompt used by the AI")}</summary>
                    <p>{c.prompt}</p>
                    <BotaoComentar
                      ancora={{ tipo: 'prompt', ref: c.id, rotulo: tr(`prompt da cena ${c.id}`, `prompt for scene ${c.id}`) }}
                      quantos={abertosEm('prompt', c.id)}
                      aoCriar={comentarios.criar}
                    />
                  </details>
                )}
              </div>
              <div className="cff-no-acoes">
                <BotaoComentar
                  ancora={{ tipo: 'cena', ref: c.id, rotulo: `${c.id} · ${c.rotulo}` }}
                  quantos={abertosEm('cena', c.id)}
                  aoCriar={comentarios.criar}
                />
                {/* O clipe da cena. Preferimos o COMPOSTO (o que foi para o
                    filme) e caímos no gerado — é o que o dono chama de "o
                    clipe que você usou nesta cena". */}
                {(c.video_composto || c.video) && (
                  <button
                    type="button"
                    className="botao-texto"
                    onClick={() =>
                      abrirVisor(
                        (c.video_composto || c.video) as string,
                        tr(`Cena ${c.id} · ${c.rotulo}`, `Scene ${c.id} · ${c.rotulo}`),
                        'video',
                      )
                    }
                  >
                    <Icone nome="play" titulo={tr("Ver o clipe desta cena", "View this scene’s clip")} />
                  </button>
                )}
                {!c.video_composto && !c.video && c.thumb && (
                  <button
                    type="button"
                    className="botao-texto"
                    onClick={() => abrirVisor(c.thumb as string, tr(`Cena ${c.id} · ${c.rotulo}`, `Scene ${c.id} · ${c.rotulo}`), 'imagem')}
                  >
                    <Icone nome="lupa" titulo={tr("Ver a chapa desta cena", "View this scene’s image")} />
                  </button>
                )}
                <button
                  type="button"
                  className="botao-texto"
                  onClick={() =>
                    aoPreencher(
                      tr(`Na peça "${pecaSlug}", cena ${c.id}: quero mudar só esta cena — as outras não podem ser refeitas nem pagas de novo. O que muda: `, `In production “${pecaSlug}”, scene ${c.id}: change only this scene. Do not regenerate or pay again for the others. What to change: `),
                    )
                  }
                >
                  <Icone nome="conversa" titulo={tr("Pedir mudança nesta cena no chat", "Request a change to this scene in chat")} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* coluna 3 — SAÍDA: áudio + o filme */}
        <div className="cff-col">
          <h4>{tr("O filme", "The video")}</h4>
          {fluxo.audio.trilha && (
            <div ref={registrar('a:trilha')} className="cff-no cff-audio">
              <span className="cff-icone">
                <Icone nome="audio" />
              </span>
              <div className="cff-no-texto">
                <strong>{tr("Trilha ", "Soundtrack ")}{fluxo.audio.trilha.existe ? tr("gerada", "generated") : tr("planejada", "planned")}</strong>
                {fluxo.audio.trilha.prompt && <small>{fluxo.audio.trilha.prompt}</small>}
              </div>
              <div className="cff-no-acoes">
                <BotaoComentar
                  ancora={{ tipo: 'audio', ref: 'trilha', rotulo: tr('trilha', 'soundtrack') }}
                  quantos={abertosEm('audio', 'trilha')}
                  aoCriar={comentarios.criar}
                />
                {fluxo.audio.trilha.existe && (
                  <button
                    type="button"
                    className="botao-texto"
                    onClick={() =>
                      abrirVisor(fluxo.audio.trilha!.arquivo, tr('Trilha', 'Soundtrack'), 'audio')
                    }
                  >
                    <Icone nome="play" titulo={tr("Ouvir só a trilha", "Listen to soundtrack only")} />
                  </button>
                )}
              </div>
            </div>
          )}
          {fluxo.audio.narracao && (
            <div ref={registrar('a:narracao')} className="cff-no cff-audio">
              <span className="cff-icone">
                <Icone nome="voz" />
              </span>
              <div className="cff-no-texto">
                <strong>{tr("Narração ", "Narration ")}{fluxo.audio.narracao.existe ? tr("gerada", "generated") : tr("planejada", "planned")}</strong>
                <small>
                  {fluxo.audio.narracao.porta_voz
                    ? `porta-voz "${fluxo.audio.narracao.porta_voz}"`
                    : tr("voz padrão", "default voice")}
                  {fluxo.audio.narracao.estilo ? tr(` · estilo ${fluxo.audio.narracao.estilo}`, ` · style ${fluxo.audio.narracao.estilo}`) : ''}
                </small>
              </div>
              {/* SÓ A GRAVAÇÃO: aprovar a voz sem ter que assistir ao filme
                  inteiro é o pedido mais comum de quem revisa. */}
              <div className="cff-no-acoes">
                <BotaoComentar
                  ancora={{ tipo: 'audio', ref: 'narracao', rotulo: tr("narração", "narration") }}
                  quantos={abertosEm('audio', 'narracao')}
                  aoCriar={comentarios.criar}
                />
                {fluxo.audio.narracao.existe && (
                  <button
                    type="button"
                    className="botao-texto"
                    onClick={() =>
                      abrirVisor(fluxo.audio.narracao!.arquivo, tr("Narração", "Narration"), 'audio')
                    }
                  >
                    <Icone nome="play" titulo={tr("Ouvir só a narração", "Listen to narration only")} />
                  </button>
                )}
              </div>
            </div>
          )}
          <div
            ref={registrar('final')}
            className={`cff-no cff-final${fluxo.final.existe ? '' : ' cff-pendente'}`}
          >
            <span className="cff-icone">
              <Icone nome="estudio" />
            </span>
            <div className="cff-no-texto">
              <strong>{fluxo.titulo}</strong>
              <small>
                {fluxo.final.existe
                  ? tr(`filme montado · ${fluxo.final.montagem.length} cenas · gasto ${usd(fluxo.gasto_usd, idioma)}`, `video assembled · ${fluxo.final.montagem.length} scenes · spent ${usd(fluxo.gasto_usd, idioma)}`)
                  : tr("ainda não montado — as linhas mostram o que já está pronto", "not assembled yet; lines show what is ready")}
              </small>
              {fluxo.final.existe && !masterUrl && (
                <button type="button" className="botao botao-fantasma botao-pequeno" disabled={abrindoMaster} onClick={assistirMaster}>
                  <Icone nome="play" tamanho={15} /> {abrindoMaster ? tr('Abrindo filme…', 'Opening video…') : tr("Assistir aqui", "Watch here")}</button>
              )}
              {erroMaster && <p className="alerta alerta-erro" role="alert">{erroMaster}</p>}
            </div>
            <div className="cff-no-acoes">
              <BotaoComentar
                ancora={{ tipo: 'final', ref: 'master', rotulo: tr("o filme", "the video") }}
                quantos={abertosEm('final', 'master')}
                aoCriar={comentarios.criar}
              />
            </div>
          </div>
          {masterUrl && (
            <video src={masterUrl} controls autoPlay className="cff-video" />
          )}
        </div>
      </div>

      {/* O VISOR: o clipe da cena, a narração sozinha ou o material que virou
          base, na frente do quadro. */}
      {visor && (
        <VisorArquivo
          titulo={visor.titulo}
          caminho={visor.caminho}
          midia={visor.midia}
          url={visor.url}
          erro={visor.erro}
          identidadeArquivo={visor.pedido}
          aoBaixar={(signal, vigenteDownload) => baixarArquivo(visor.downloadPath, visor.nomeArquivo, {
            signal,
            vigente: () => vigenteDownload() && visorVivoRef.current && visorPedidoRef.current === visor.pedido && getSessionIdentity() === sessao,
          })}
          aoFechar={fecharVisor}
        />
      )}

      {/* o seletor de troca — editar o fluxo é escolher o arquivo e revisar
          o pedido pronto no chat */}
      {trocando && (
        <div className="cff-troca" role="dialog" aria-label={tr("Trocar a fonte", "Replace source")}>
          <header>
            <strong>
              {tr("Trocar ", "Replace ")}{trocando.legenda || trocando.nome}
              {trocando.cenas.length ? ` (cenas ${trocando.cenas.join(', ')})` : ''}
            </strong>
            <button type="button" className="botao-texto" onClick={() => setTrocando(null)}>
              <Icone nome="fechar" tamanho={15} /> {tr("fechar", "close")}</button>
          </header>
          <p className="texto-suave">
            {tr("Escolha outro arquivo do seu acervo — ou anexe um novo na conversa aqui do lado e peça “usa esse no lugar de ", "Choose another file from your asset library, or attach a new one in the conversation and ask “use this instead of ")}{trocando.nome}”.
          </p>
          {acervo === null && <p className="texto-suave">{tr("Abrindo o seu acervo…", "Opening your asset library…")}</p>}
          {acervo !== null && acervo.length === 0 && (
            <p className="texto-suave">{tr("Nenhum arquivo no acervo ainda — anexe um novo na conversa.", "No assets yet. Attach a new file in the conversation.")}</p>
          )}
          {acervo !== null && acervo.length > 0 && (
            <ul>
              {acervo
                .filter((a) => a.caminho !== trocando.caminho)
                .map((a) => (
                  <li key={a.caminho}>
                    <button type="button" onClick={() => trocarPor(a.caminho)}>
                      <span className="cff-troca-pasta">{a.pasta}</span>
                      {a.item.legenda ? `${a.item.legenda} — ` : ''}
                      {a.item.nome}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
