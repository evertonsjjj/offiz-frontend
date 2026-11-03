import { useIdioma, type Traduzir } from '../../lib/i18n'
/**
 * O QUADRO "COMO FOI FEITA" DE QUALQUER TRABALHO (15/08/2026).
 *
 * Três colunas ligadas por arestas medidas no DOM — o que entrou (arquivos E
 * regras), quem mexeu (um nó por agente, com a reprova do portão em vermelho)
 * e o que saiu (as entregas, com a principal marcada). O irmão genérico do
 * ComoFoiFeita: aquele lê o documento da peça; este lê o DIÁRIO DE EXECUÇÃO
 * que o backend grava para todo job (GET /estudio/trabalhos/{id}/fluxo).
 *
 * HONESTIDADE NA TELA: o quadro é derivado do diário — prova o que foi lido e
 * feito, não o raciocínio escrito. A placa diz isso; quando o rastro rico
 * existir (como-foi-feito.json), ela some.
 *
 * EDITAR É CONVERSAR: "trocar esta fonte" e "perguntar sobre isso" preparam o
 * pedido pronto no chat (aoPerguntar) — quem muda o trabalho é o agente, com
 * o custo dito antes. A tela nunca gasta um centavo sozinha.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { api, ApiError, baixarArquivo, carregarArquivo, getSessionIdentity } from '../../lib/api'
import { Icone, iconeDoArquivo, type NomeIcone } from '../Icone'
import { useToasts } from '../Toasts'
import { formatDataHora } from '../../lib/format'
import { orientacaoFalha } from '../../lib/falhasTrabalho'
import VisorArquivo, { type MidiaVisor } from './VisorArquivo'
import { JobStream } from './JobStream'
import type { Job, JobEvent } from '../../lib/types'
import { BotaoComentar, ListaComentarios, useComentarios } from './ComentariosFluxo'

type NoFluxo = {
  id: string
  titulo: string
  sub?: string
  selo?: string
  falta?: boolean
  chefe?: boolean
  vezes?: number
  ferramentas?: number
  segundos?: number
  entrega_id?: number
  status?: string
  interno?: boolean
  principal?: boolean
  /** O RACIOCÍNIO escrito pelo agente (como-foi-feito.json) — quatro campos
   *  fixos, em linguagem de dono. Presente = o quadro não é só derivado. */
  pq?: { fiz: string; porque: string; descartei: string[]; apoiei: string[]; faltou?: string }
  /** A BASE DE CONHECIMENTO (16/08/2026): a legenda do catálogo torna a fonte
   *  reconhecível ("o post de anúncio que você curtiu"), e a porta é o par
   *  (pasta, nome) do endpoint de bytes do acervo — o "ver" da fonte. */
  legenda?: string | null
  caminho?: string
  media?: string
  porta?: { pasta: string; nome: string } | null
  url?: string | null
}

type FluxoTrabalho = {
  /** `modelo`/`effort` = o que REALMENTE rodou (carimbo do roteador no job) —
   *  a auditoria de 24/08 pegou um comparativo inteiro achando que media Sol
   *  quando o roteador tinha escolhido o modelo leve. */
  job: {
    id: number; titulo: string; status: string; erro?: string | null
    criado_em?: string | null; modelo?: string | null; effort?: string | null
  }
  /** true = montado só do diário de execução; false = o agente ESCREVEU o
   *  porquê de cada etapa (como-foi-feito.json) e os nós carregam `pq`. */
  derivado: boolean
  referencias?: Array<{ titulo: string; url: string | null; arquivo: string; aplicacao: string; saida: string; limitacao: string; estado: 'declarada'; relato_entrega_id: number }>
  prontidao?: Array<{ nivel: 'bloqueado' | 'teste' | 'para_revisar'; faltas: string[]; conferido: string[]; relato_entrega_id: number }>
  tem_eventos: boolean
  colunas: Array<{ titulo: string; nos: NoFluxo[] }>
  arestas: Array<[string, string] | [string, string, boolean]>
}

type MaterialAcervo = { nome: string; legenda?: string | null }

/* Os MESMOS rótulos do painel do trabalho — o quadro e o painel falam do
   mesmo job, então trocar o vocabulário entre eles leria como dois estados. */
function ROTULO_STATUS_local(tr: Traduzir): Record<string, string> { return {
  failed: tr("falhou","failed"),
  cancelled: tr("cancelado","cancelled"),
} }

const ICONE_SELO: Record<string, NomeIcone> = {
  regra: 'canon',
  marca: 'paleta',
  referência: 'ideia',
  material: 'arq-documento',
  'porta-voz': 'pessoa',
  peça: 'arq-video',
  web: 'lupa',
}

/** Rótulos das pastas do acervo — os mesmos nomes de dono da tela de
 *  conhecimento, porque o seletor lista as mesmas três pastas. */
function PASTAS_ACERVO_local(tr: Traduzir): Array<{ chave: 'entrada' | 'produto' | 'exemplos'; rotulo: string }> { return [
  { chave: 'entrada', rotulo: tr("Documentos da empresa","Company documents") },
  { chave: 'produto', rotulo: tr("Fotos do produto","Product photos") },
  { chave: 'exemplos', rotulo: tr("Exemplos de posts","Example posts") },
] }

/** Miniatura REAL da fonte de imagem no nó do fluxo (24/08, pedido do dono:
 *  "ver ali o conteúdo que ela usou"). Carrega pela mesma porta de bytes do
 *  visor e revoga o blob ao desmontar — sem cache próprio: o quadro tem
 *  poucas fontes e a porta já é autenticada. */
function MiniThumb({ orgId, slug, porta }: {
  orgId: number
  slug: string
  porta: { pasta: string; nome: string }
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    let blob: string | null = null
    void carregarArquivo(
      `/predios/${orgId}/${slug}/arquivos/${encodeURIComponent(porta.pasta)}/${encodeURIComponent(porta.nome)}`,
    )
      .then((u) => {
        if (vivo) { blob = u; setUrl(u) } else URL.revokeObjectURL(u)
      })
      .catch(() => {})
    return () => {
      vivo = false
      if (blob) URL.revokeObjectURL(blob)
    }
  }, [orgId, slug, porta.pasta, porta.nome])
  if (!url) return <Icone className="fluxo-no-icone" nome="arq-imagem" tamanho={17} />
  return <img className="fluxo-no-thumb" src={url} alt="" />
}

type QuadroProps = {
  orgId: number
  slug: string
  jobId: number
  /** Escreve o pedido PRONTO no chat — editar o fluxo é conversar. */
  aoPerguntar?: (texto: string) => void
}

export default function QuadroFluxo(props: QuadroProps) {
  return <QuadroDoTrabalho key={JSON.stringify([getSessionIdentity(), props.orgId, props.slug, props.jobId])} {...props} />
}

function QuadroDoTrabalho({
  orgId,
  slug,
  jobId,
  aoPerguntar,
}: QuadroProps) {
  const { t: tr, idioma } = useIdioma()
  const sessao = getSessionIdentity()
  const vivoRef = useRef(true)
  const leiturasRef = useRef(new Set<AbortController>())
  const vigente = useCallback(() => vivoRef.current && getSessionIdentity() === sessao, [sessao])
  const novaLeitura = useCallback(() => {
    const controller = new AbortController()
    leiturasRef.current.add(controller)
    return controller
  }, [])
  useEffect(() => {
    vivoRef.current = true
    const leituras = leiturasRef.current
    return () => { vivoRef.current = false; for (const leitura of leituras) leitura.abort(); leituras.clear() }
  }, [])
  const PASTAS_ACERVO = PASTAS_ACERVO_local(tr)
  const ROTULO_STATUS = ROTULO_STATUS_local(tr)
  const [fluxo, setFluxo] = useState<FluxoTrabalho | null>(null)
  const [erro, setErro] = useState('')
  const [selecionado, setSelecionado] = useState<NoFluxo | null>(null)
  const [trocando, setTrocando] = useState<NoFluxo | null>(null)
  const [acervo, setAcervo] = useState<Array<{ pasta: string; rotulo: string; item: MaterialAcervo }> | null>(null)
  const [erroAcervo, setErroAcervo] = useState('')
  const [enviandoNova, setEnviandoNova] = useState(false)
  const [consultaQuadro, setConsultaQuadro] = useState(0)
  const [arestas, setArestas] = useState<Array<{ d: string; falta?: boolean }>>([])
  const [tamanho, setTamanho] = useState({ w: 0, h: 0 })
  const [visor, setVisor] = useState<{
    pedido: number
    downloadPath: string
    nomeArquivo: string
    titulo: string
    caminho: string
    midia: MidiaVisor
    url: string | null
    erro: string | null
  } | null>(null)
  const { falha } = useToasts()

  const quadroRef = useRef<HTMLDivElement | null>(null)
  const nosRef = useRef(new Map<string, HTMLElement>())
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const trocaRef = useRef(trocando)
  trocaRef.current = trocando
  const visorLeituraRef = useRef<{ n: number; controller: AbortController | null }>({ n: 0, controller: null })

  /* COMENTÁRIOS ANCORADOS (07/09/2026): no trabalho inteiro ou na etapa do
     raciocínio escolhida — cada um vira tarefa (retomada) ou lição. */
  const comentarios = useComentarios(orgId, slug, { job: jobId })
  const abertosEm = (tipo: 'etapa' | 'trabalho', ref: string) =>
    comentarios.lista.filter((c) => c.estado === 'aberto' && c.ancora.tipo === tipo && c.ancora.ref === ref).length

  const registrar = useCallback((id: string) => {
    return (el: HTMLElement | null) => {
      if (el) nosRef.current.set(id, el)
      else nosRef.current.delete(id)
    }
  }, [])

  /* O blob do visor morre com a tela (o ref existe para o cleanup de
   * desmontagem alcançar a URL sem depender do estado nas deps). */
  const visorUrlRef = useRef<string | null>(null)
  visorUrlRef.current = visor?.url ?? null
  useEffect(() => {
    return () => {
      if (visorUrlRef.current) URL.revokeObjectURL(visorUrlRef.current)
    }
  }, [])

  useEffect(() => {
    const controller = novaLeitura()
    setFluxo(null)
    setErro('')
    setSelecionado(null)
    setTrocando(null)
    api
      .get<FluxoTrabalho>(`/predios/${orgId}/${slug}/estudio/trabalhos/${jobId}/fluxo`, controller.signal)
      .then((r) => {
        if (controller.signal.aborted || !vigente()) return
        if (r.job.id !== jobId) throw new ApiError(502, tr('Não consegui confirmar o quadro deste trabalho.', 'I could not confirm this task’s workflow.'))
        setFluxo(r)
        setErro('')
      })
      .catch((e) => {
        if (!controller.signal.aborted && vigente()) setErro(e instanceof ApiError ? e.detail : tr("Não consegui montar o fluxo deste trabalho.", "I could not build this task’s workflow."))
      })
      .finally(() => leiturasRef.current.delete(controller))
    return () => { controller.abort(); leiturasRef.current.delete(controller) }
  }, [orgId, slug, jobId, consultaQuadro, novaLeitura, vigente, tr])

  /* As ARESTAS, medidas no DOM de verdade. A lição paga no protótipo, duas
   * vezes: (1) medir exige layout — num contêiner recém-saído de display:none
   * todo retângulo dá 0×0, então a medição roda em useLayoutEffect + duas
   * voltas de rAF; (2) a LIGAÇÃO de clique nunca pode morar dentro do rAF,
   * que não dispara em aba sem composição — aqui ela é do React, síncrona. */
  const recalcular = useCallback(() => {
    const quadro = quadroRef.current
    if (!quadro || !fluxo) return
    const ref = quadro.getBoundingClientRect()
    if (ref.width === 0) return
    const dir = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return { x: r.right - ref.left + quadro.scrollLeft, y: r.top - ref.top + r.height / 2 }
    }
    const esq = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return { x: r.left - ref.left + quadro.scrollLeft, y: r.top - ref.top + r.height / 2 }
    }
    const novas: Array<{ d: string; falta?: boolean }> = []
    for (const aresta of fluxo.arestas) {
      const [de, para, falta] = aresta
      const a = nosRef.current.get(de)
      const b = nosRef.current.get(para)
      if (!a || !b) continue
      const p = dir(a)
      const q = esq(b)
      novas.push({
        d: `M${p.x} ${p.y} C${p.x + 44} ${p.y} ${q.x - 44} ${q.y} ${q.x} ${q.y}`,
        falta: Boolean(falta),
      })
    }
    setArestas(novas)
    setTamanho({ w: quadro.scrollWidth, h: quadro.scrollHeight })
  }, [fluxo])

  useLayoutEffect(() => {
    let vivo = true
    /* Medir JÁ, sincronamente: no useLayoutEffect o DOM está montado e o
     * getBoundingClientRect força o layout. O rAF sozinho não basta — ele NÃO
     * dispara em aba/painel que não está compondo quadros (janela minimizada,
     * painel escondido), e o quadro abriria sem uma única aresta, sem erro
     * nenhum. As duas voltas de rAF continuam como refino pós-paint (fontes
     * que chegam mudam a altura dos nós), e o timeout é a rede de quando nem
     * o rAF vem. */
    recalcular()
    requestAnimationFrame(() => requestAnimationFrame(() => vivo && recalcular()))
    const rede = window.setTimeout(() => vivo && recalcular(), 300)
    const obs = new ResizeObserver(() => recalcular())
    if (quadroRef.current) obs.observe(quadroRef.current)
    return () => {
      vivo = false
      window.clearTimeout(rede)
      obs.disconnect()
    }
  }, [recalcular])

  /** Abre o seletor de troca: lista o acervo com as legendas do catálogo. */
  function carregarAcervo() {
    const controller = novaLeitura()
    setErroAcervo('')
    api
      .get<Record<string, MaterialAcervo[] | undefined>>(`/predios/${orgId}/${slug}/arquivos`, controller.signal)
      .then((r) => {
        if (controller.signal.aborted || !vigente()) return
        const lista: Array<{ pasta: string; rotulo: string; item: MaterialAcervo }> = []
        for (const { chave, rotulo } of PASTAS_ACERVO) {
          for (const item of r?.[chave] ?? []) lista.push({ pasta: chave, rotulo, item })
        }
        setAcervo(lista)
      })
      .catch(() => { if (!controller.signal.aborted && vigente()) setErroAcervo(tr('Não consegui consultar o acervo.', 'I could not load the asset library.')) })
      .finally(() => leiturasRef.current.delete(controller))
  }

  function abrirTroca(no: NoFluxo) {
    setTrocando(no)
    if (acervo === null) carregarAcervo()
  }

  /** A troca em si: prepara o pedido no chat. O texto nomeia o trabalho, a
   *  fonte velha e a nova — o agente sabe exatamente o que refazer. */
  function trocarPor(nome: string, origem: string) {
    if (!trocando) return
    aoPerguntar?.(
      tr(`No trabalho #${jobId} ("${fluxo?.job.titulo ?? ''}"), troque a fonte "${trocando.titulo}" `, `In task #${jobId} (“${fluxo?.job.titulo ?? ''}”), replace source “${trocando.titulo}” `) +
        tr(`por "${nome}" (${origem}) e refaça só o que depende dela — o resto não se mexe.`, `with “${nome}” (${origem}) and redo only what depends on it. Keep everything else unchanged.`),
    )
    setTrocando(null)
  }

  /** A outra porta da troca: subir o arquivo novo ali mesmo. Cai em entrada/
   *  pelo balcão de sempre — e o pedido já sai citando o nome gravado. */
  async function subirNova(arquivo: File | null) {
    if (!arquivo || !trocando) return
    const origem = trocando
    setEnviandoNova(true)
    try {
      const fd = new FormData()
      fd.append('arquivo', arquivo)
      const r = await api.postForm<{ nome: string }>(
        `/predios/${orgId}/${slug}/arquivos?pasta=entrada`,
        fd,
      )
      if (!vigente() || trocaRef.current !== origem) return
      trocarPor(r?.nome ?? arquivo.name, tr("acabei de enviar, está em Documentos da empresa", "just uploaded to company documents"))
      setAcervo(null) // a lista mudou — a próxima abertura recarrega
    } catch (e) {
      // TOAST, nunca o `erro` fatal: aquele early return apagava o quadro
      // inteiro — colunas, nó escolhido e o próprio diálogo de troca — por uma
      // falha de upload da qual dá para se recuperar sem sair do trabalho.
      if (vigente() && trocaRef.current === origem) falha(e instanceof ApiError ? e.detail : tr("Não consegui receber o arquivo agora.", "I could not receive the file right now."))
    } finally {
      if (vigente()) setEnviandoNova(false)
    }
  }

  /** O "ver" da fonte: abre o arquivo pela porta de bytes do acervo. */
  async function abrirVisor(no: NoFluxo) {
    if (!sessao || !vigente() || !no.porta || !no.caminho) return
    const titulo = no.legenda || no.titulo
    const caminho = no.caminho
    visorLeituraRef.current.controller?.abort()
    if (visor?.url) URL.revokeObjectURL(visor.url)
    const controller = novaLeitura()
    const n = ++visorLeituraRef.current.n
    visorLeituraRef.current.controller = controller
    const midia: MidiaVisor =
      no.media === 'imagem' || no.media === 'audio' || no.media === 'video'
        ? no.media
        : 'documento'
    const downloadPath = `/predios/${orgId}/${slug}/arquivos/${encodeURIComponent(no.porta.pasta)}/${encodeURIComponent(no.porta.nome)}`
    setVisor({ pedido: n, downloadPath, nomeArquivo: no.porta.nome, titulo, caminho, midia, url: null, erro: null })
    try {
      const url = await carregarArquivo(
        downloadPath,
        controller.signal,
      )
      if (!vigente() || controller.signal.aborted || visorLeituraRef.current.n !== n) { URL.revokeObjectURL(url); return }
      // Se o dono fechou o visor com o download em voo, o estado rejeita a
      // URL — e quem rejeita REVOGA, senão o blob fica órfão até o reload.
      setVisor((v) => {
        if (vigente() && !controller.signal.aborted && visorLeituraRef.current.n === n && v?.caminho === caminho) return { ...v, url }
        URL.revokeObjectURL(url)
        return v
      })
    } catch {
      if (!vigente() || controller.signal.aborted || visorLeituraRef.current.n !== n) return
      setVisor((v) =>
        vigente() && !controller.signal.aborted && visorLeituraRef.current.n === n && v?.caminho === caminho
          ? { ...v, erro: tr('Não consegui abrir a prévia agora. Você pode baixar o arquivo.', 'I could not open the preview right now. You can download the file.') }
          : v,
      )
    } finally { leiturasRef.current.delete(controller) }
  }

  /** O "ver" da SAÍDA: a peça entregue, pelo download autenticado. O dono
   *  pediu com todas as letras (23/08): "poder ver ali o conteúdo mesmo que
   *  ela usou — ler o texto ou ver a imagem". A fonte já abria; a saída não. */
  async function abrirVisorEntrega(no: NoFluxo) {
    if (!sessao || !vigente() || !no.entrega_id) return
    const titulo = no.legenda || no.titulo
    const ext = (no.titulo.split('.').pop() || '').toLowerCase()
    const midia: MidiaVisor = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)
      ? 'imagem'
      : ['mp4', 'webm', 'mov'].includes(ext)
        ? 'video'
        : ['mp3', 'wav', 'ogg'].includes(ext)
          ? 'audio'
          : 'documento'
    const caminho = `entrega:${no.entrega_id}`
    visorLeituraRef.current.controller?.abort()
    if (visor?.url) URL.revokeObjectURL(visor.url)
    const controller = novaLeitura()
    const n = ++visorLeituraRef.current.n
    visorLeituraRef.current.controller = controller
    const downloadPath = `/entregas/${no.entrega_id}/download`
    setVisor({ pedido: n, downloadPath, nomeArquivo: no.titulo, titulo, caminho, midia, url: null, erro: null })
    try {
      const url = await carregarArquivo(downloadPath, controller.signal)
      if (!vigente() || controller.signal.aborted || visorLeituraRef.current.n !== n) { URL.revokeObjectURL(url); return }
      setVisor((v) => {
        if (vigente() && !controller.signal.aborted && visorLeituraRef.current.n === n && v?.caminho === caminho) return { ...v, url }
        URL.revokeObjectURL(url)
        return v
      })
    } catch {
      if (!vigente() || controller.signal.aborted || visorLeituraRef.current.n !== n) return
      setVisor((v) =>
        vigente() && !controller.signal.aborted && visorLeituraRef.current.n === n && v?.caminho === caminho
          ? { ...v, erro: tr('Não consegui abrir a prévia agora. Você pode baixar o arquivo.', 'I could not open the preview right now. You can download the file.') }
          : v,
      )
    } finally { leiturasRef.current.delete(controller) }
  }

  function fecharVisor() {
    ++visorLeituraRef.current.n
    visorLeituraRef.current.controller?.abort()
    if (visor?.url) URL.revokeObjectURL(visor.url)
    setVisor(null)
  }

  /* Os hooks abaixo ficam ANTES dos early returns (08/09/2026): depois
     deles, o primeiro render (sem fluxo) saía com menos hooks e o seguinte
     chamava mais — React #310, e o quadro de qualquer trabalho quebrava. */
  // ═══ A HISTÓRIA DO PENSAMENTO (24/08/2026 — pedido do dono) ═══
  // O quadro prova o que foi LIDO e FEITO; a história é o agente FALANDO —
  // a narrativa completa do raciocínio, com as ferramentas traduzidas para
  // gente (JobStream, o mesmo do acompanhamento ao vivo, aqui em replay).
  const [verPensamento, setVerPensamento] = useState(false)
  const [pensamento, setPensamento] = useState<{ job: Job; eventos: JobEvent[] } | null>(null)
  const [erroPensamento, setErroPensamento] = useState('')
  const [consultaPensamento, setConsultaPensamento] = useState(0)
  useEffect(() => {
    if (!verPensamento || pensamento || erroPensamento) return
    let vivo = true
    const controller = novaLeitura()
    ;(async () => {
      try {
        const [jb, evs] = await Promise.all([
          api.get<Job>(`/jobs/${jobId}`, controller.signal),
          api.get<{ events?: JobEvent[] } | JobEvent[]>(`/jobs/${jobId}/events?after=0`, controller.signal),
        ])
        if (!vivo || controller.signal.aborted || !vigente()) return
        if (jb.id !== jobId) throw new Error('Resposta de outro trabalho')
        const lista = Array.isArray(evs) ? evs : evs.events ?? []
        const normalizados = lista.map((e) => ({
          ...e,
          payload:
            typeof e.payload === 'string'
              ? (() => { try { return JSON.parse(e.payload as unknown as string) } catch { return { texto: e.payload } } })()
              : e.payload,
        }))
        setPensamento({ job: jb, eventos: normalizados as JobEvent[] })
      } catch {
        if (vivo && !controller.signal.aborted && vigente()) setErroPensamento(tr('Não consegui consultar a história deste trabalho.', 'I could not load this task’s history.'))
      } finally { leiturasRef.current.delete(controller) }
    })()
    return () => { vivo = false; controller.abort(); leiturasRef.current.delete(controller) }
  }, [verPensamento, pensamento, erroPensamento, consultaPensamento, jobId, novaLeitura, vigente, tr])

  if (erro) return <div className="alerta alerta-erro" role="alert"><p>{erro}</p><button type="button" className="botao-texto" onClick={() => setConsultaQuadro(n => n + 1)}>{tr('Tentar o quadro novamente', 'Try the workflow again')}</button></div>
  if (!fluxo) return <p className="texto-suave" role="status">{tr('Carregando o quadro…', 'Loading the workflow…')}</p>

  const [entrou, mexeu, saiu] = fluxo.colunas
  const ehFonte = (no: NoFluxo) => no.id.startsWith('f')
  const ehSaida = (no: NoFluxo) => no.id.startsWith('s')
  const naoTerminou = fluxo.job.status === 'failed' || fluxo.job.status === 'cancelled'

  const rotuloAgente = (no: NoFluxo) => {
    const partes: string[] = []
    if (no.ferramentas) partes.push(tr(`${no.ferramentas} ação${no.ferramentas === 1 ? '' : 'es'}`, `${no.ferramentas} action${no.ferramentas === 1 ? '' : 's'}`))
    if (no.segundos && no.segundos >= 1) partes.push(`${Math.round(no.segundos)}s`)
    if ((no.vezes ?? 0) > 1) partes.push(`${no.vezes}×`)
    return partes.join(' · ')
  }

  return (
    <section className="fluxo" aria-label={tr(`Como foi feito o trabalho ${fluxo.job.titulo}`, `How task ${fluxo.job.titulo} was made`)}>
      <header className="fluxo-topo">
        <strong>{fluxo.job.titulo}</strong>
        <span className="painel-trabalho-id">#{fluxo.job.id}</span>
        {naoTerminou && (
          <span className={`status-pill ${fluxo.job.status === 'failed' ? 'status-failed' : 'status-cancelled'}`}>
            {ROTULO_STATUS[fluxo.job.status] ?? fluxo.job.status}
          </span>
        )}
        {fluxo.job.criado_em && (
          <span className="texto-suave">{formatDataHora(fluxo.job.criado_em, idioma)}</span>
        )}
        {fluxo.job.modelo && (
          // O carimbo do que REALMENTE rodou: modelo efetivo × esforço. Sem
          // ele, "rodou no melhor modelo" era fé — e a auditoria provou que
          // a fé errava (media o modelo leve achando que era o premium).
          <span className="texto-suave" title={tr("Modelo e esforço que executaram este trabalho", "Model and effort used for this task")}>
            {fluxo.job.modelo}{fluxo.job.effort ? tr(` · esforço ${fluxo.job.effort}`, ` · effort ${fluxo.job.effort}`) : ''}
          </span>
        )}
        <button
          type="button"
          className="botao-texto"
          onClick={() => setVerPensamento((v) => !v)}
          title={tr("A narrativa completa do agente — cada fala e cada ferramenta, traduzidas", "The agent’s full account, including responses and tools")}
        >
          💭 {verPensamento ? tr("esconder a história", "hide the story") : tr("diário de execução", "execution log")}
        </button>
        <BotaoComentar
          ancora={{ tipo: 'trabalho', ref: String(jobId), rotulo: fluxo.job.titulo }}
          quantos={abertosEm('trabalho', String(jobId))}
          aoCriar={comentarios.criar}
        />
      </header>

      <ListaComentarios
        lista={comentarios.lista}
        agir={comentarios.agir}
        apagar={comentarios.apagar}
        titulo={tr("Comentários deste trabalho", "Task comments")}
      />

      {verPensamento && (
        <div className="fluxo-pensamento">
          {pensamento ? (
            <JobStream
              job={pensamento.job}
              eventos={pensamento.eventos}
              aoVerEntregas={() => {}}
            />
          ) : erroPensamento ? (
            <div className="alerta alerta-erro" role="alert"><p>{erroPensamento}</p><button type="button" className="botao-texto" onClick={() => { setErroPensamento(''); setConsultaPensamento(n => n + 1) }}>{tr('Tentar a história novamente', 'Try the history again')}</button></div>
          ) : (
            <p className="texto-suave" role="status">{tr("Abrindo a história…", "Opening the history…")}</p>
          )}
        </div>
      )}

      {/* O trabalho QUEBROU: dizer isso ANTES do quadro, senão a coluna vazia
          de "o que saiu" lê como "rodou e não produziu nada". */}
      {naoTerminou && (
        <p className="alerta alerta-erro" role="status">
          {orientacaoFalha(fluxo.job.erro, tr)}
        </p>
      )}

      {!!fluxo.prontidao?.length && <section aria-label={tr('Conferência relatada', 'Reported review')}>
        <h4>{tr('Conferência relatada', 'Reported review')}</h4>
        <p>{tr('O relato da IA não substitui a conferência dos arquivos nem a aprovação humana.', 'The AI report does not replace checking the files or human approval.')}</p>
        {fluxo.prontidao.map(p => <div key={p.relato_entrega_id}>
          <strong>{p.nivel === 'teste' ? tr('Estudo para teste', 'Test study') : p.nivel === 'bloqueado' ? tr('Faltam insumos', 'Missing inputs') : tr('Para revisar', 'For review')}</strong>
          {!!p.faltas.length && <><p>{tr('O que falta:', 'Missing:')}</p><ul>{p.faltas.map((f, i) => <li key={i}>{f}</li>)}</ul></>}
          <details><summary>{tr('Checagens informadas pela IA', 'Checks reported by AI')}</summary><ul>{p.conferido.map((f, i) => <li key={i}>{f}</li>)}</ul></details>
        </div>)}
      </section>}
      <section aria-label={tr('Referências declaradas', 'Declared references')}>
        <h4>{tr('Referências da entrega', 'Delivery references')}</h4>
        {fluxo.referencias?.length ? <>
          <p>{tr('Relato de produção: estas escolhas foram informadas pela IA. O relato sozinho não comprova acesso à fonte nem uso do arquivo.', 'Production report: these choices were reported by AI. The report alone does not prove source access or file use.')}</p>
          <ul>{fluxo.referencias.map((r, i) => <li key={`${r.relato_entrega_id}:${i}`}>
            <strong>{r.titulo}</strong>
            {r.url && /^https?:\/\//i.test(r.url) && <p><a href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a></p>}
            {r.arquivo && <p>{tr('Arquivo: ', 'File: ')}{r.arquivo}</p>}
            {r.saida && <p>{tr('Aplicado em: ', 'Applied to: ')}{r.saida}</p>}
            {r.aplicacao && <p>{r.aplicacao}</p>}
            {r.limitacao && <p role="status">{r.limitacao}</p>}
          </li>)}</ul>
        </> : <p>{tr('A origem específica da ideia e o vínculo entre imagem e resultado não foram registrados neste formato. Consulte o diário abaixo; não é possível afirmar qual post ou imagem guiou a peça apenas pelo resultado.', 'The specific idea source and image-to-output link were not recorded in this format. See the log below; the result alone cannot establish which post or image guided it.')}</p>}
      </section>
      {!fluxo.tem_eventos ? (
        <p className="fluxo-honestidade">
          {naoTerminou
            ? tr("Este trabalho quebrou antes de registrar qualquer passo — não há caminho para desenhar.", "This task failed before recording any steps. There is no workflow to display.")
            : tr("Este trabalho é de antes do diário de execução — não tenho como desenhar o caminho dele. Os próximos já nascem com o quadro.", "This task predates the execution log, so its workflow cannot be shown. New tasks include the diagram.")}
        </p>
      ) : (
        <>
          <div className="fluxo-quadro" ref={quadroRef}>
            <svg
              className="fluxo-arestas"
              width={tamanho.w || undefined}
              height={tamanho.h || undefined}
              aria-hidden="true"
            >
              {arestas.map((a, i) => (
                <path key={i} d={a.d} className={a.falta ? 'falta' : undefined} />
              ))}
            </svg>
            <div className="fluxo-colunas">
              {[entrou, mexeu, saiu].map((col) => (
                <div key={col.titulo} className="fluxo-col">
                  <span className="fluxo-col-titulo">{col.titulo === 'o que entrou' ? tr('o que entrou', 'inputs') : col.titulo === 'quem mexeu' ? tr('quem mexeu', 'who worked') : col.titulo === 'o que saiu' ? tr('o que saiu', 'outputs') : col.titulo}</span>
                  {col.nos.length === 0 && (
                    <p className="texto-suave fluxo-col-vazia">
                      {col === entrou
                        ? tr("nenhuma leitura de arquivo foi identificada no diário disponível", "no file read was identified in the available log")
                        : tr("nada aqui", "nothing here")}
                    </p>
                  )}
                  {col.nos.map((no) => (
                    <button
                      key={no.id}
                      type="button"
                      ref={registrar(no.id)}
                      className={[
                        'fluxo-no',
                        no.falta ? 'falta' : '',
                        selecionado?.id === no.id ? 'sel' : '',
                        no.interno ? 'interno' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setSelecionado(selecionado?.id === no.id ? null : no)}
                    >
                      {ehFonte(no) && no.media === 'imagem' && no.porta && !no.falta ? (
                        <MiniThumb orgId={orgId} slug={slug} porta={no.porta} />
                      ) : (
                        <Icone
                          className="fluxo-no-icone"
                          nome={
                            no.falta
                              ? 'alerta'
                              : ehSaida(no)
                                ? iconeDoArquivo(no.titulo)
                                : ehFonte(no)
                                  ? ICONE_SELO[no.selo ?? ''] ?? 'arq-documento'
                                  : 'pessoa'
                          }
                          tamanho={17}
                        />
                      )}
                      <span className="fluxo-no-dados">
                        <span className="fluxo-no-titulo">{no.legenda || no.titulo}</span>
                        {no.sub && <span className="fluxo-no-sub">{no.sub}</span>}
                        <span className="fluxo-no-selos">
                          {no.selo && <i>{no.selo}</i>}
                          {no.principal && <i className="forte">{tr("principal", "primary")}</i>}
                          {no.interno && <i>{tr("bastidor", "supporting")}</i>}
                          {no.status && !no.interno && <i>{no.status}</i>}
                          {!ehFonte(no) && !ehSaida(no) && !no.falta && (
                            <i>{no.chefe ? tr("dirigiu", "directed") : rotuloAgente(no) || tr("trabalhou", "worked")}</i>
                          )}
                          {no.pq && <i className="forte">{tr("por quê?", "why?")}</i>}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* O RACIOCÍNIO da etapa escolhida — os quatro campos fixos que o
              agente escreveu. Não é chain-of-thought crua nem log: o dono
              aprende a ler uma vez e reconhece sempre. */}
          {selecionado?.pq && (
            <div className="fluxo-pq">
              <div className="fluxo-pq-topo">
                <strong>{selecionado.titulo}</strong>
                <span className="texto-suave">{tr("o raciocínio desta etapa, escrito por ela", "the reasoning recorded for this step")}</span>
                <BotaoComentar
                  ancora={{ tipo: 'etapa', ref: selecionado.id, rotulo: selecionado.titulo }}
                  quantos={abertosEm('etapa', selecionado.id)}
                  aoCriar={comentarios.criar}
                />
              </div>
              <dl>
                <dt>{tr("o que eu fiz", "what I did")}</dt>
                <dd>{selecionado.pq.fiz}</dd>
                <dt>{tr("por quê", "why")}</dt>
                <dd>{selecionado.pq.porque}</dd>
                {selecionado.pq.descartei.length > 0 && (
                  <>
                    <dt>{tr("o que descartei", "what I ruled out")}</dt>
                    <dd>
                      <ul>
                        {selecionado.pq.descartei.map((d) => (
                          <li key={d}>
                            <Icone nome="fechar" tamanho={13} /> {d}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
                {!!selecionado.pq.faltou && (
                  <>
                    <dt>{tr("o que me faltou", "what I was missing")}</dt>
                    {/* A autocrítica estrutural: o que providenciar para a
                        próxima sair melhor. Só aparece quando o agente
                        declarou — vazio não vira linha morta. */}
                    <dd className="fluxo-pq-faltou">
                      <Icone nome="alerta" tamanho={13} /> {selecionado.pq.faltou}
                    </dd>
                  </>
                )}
                {selecionado.pq.apoiei.length > 0 && (
                  <>
                    <dt>{tr("em que me apoiei", "what I relied on")}</dt>
                    <dd className="fluxo-pq-provas">
                      {selecionado.pq.apoiei.map((a) => (
                        <span key={a} className="fluxo-pq-prova">
                          <Icone nome="arq-documento" tamanho={13} /> {a}
                        </span>
                      ))}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {/* As ações do nó escolhido — editar é conversar. */}
          {selecionado && (
            <div className="fluxo-acoes">
              <span className="texto-suave">“{selecionado.legenda || selecionado.titulo}”</span>
              {selecionado.url && /^https?:\/\//i.test(selecionado.url) && <a href={selecionado.url} target="_blank" rel="noopener noreferrer">{tr('Abrir endereço registrado', 'Open recorded address')}</a>}
              {ehFonte(selecionado) && selecionado.porta && (
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={() => void abrirVisor(selecionado)}
                >
                  <Icone nome="lupa" tamanho={15} /> {tr("Ver o arquivo", "View file")}</button>
              )}
              {ehSaida(selecionado) && selecionado.entrega_id && (
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={() => void abrirVisorEntrega(selecionado)}
                >
                  <Icone nome="lupa" tamanho={15} /> {tr("Ver a entrega", "View deliverable")}</button>
              )}
              {ehFonte(selecionado) && aoPerguntar && selecionado.selo !== 'web' && (
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={() => abrirTroca(selecionado)}
                >
                  <Icone nome="loop" tamanho={15} /> {tr("Trocar esta fonte", "Replace this source")}</button>
              )}
              {aoPerguntar && <button
                type="button"
                className="botao botao-fantasma botao-pequeno"
                onClick={() =>
                  aoPerguntar(
                    ehSaida(selecionado)
                      ? tr(`Sobre o trabalho #${jobId}: no arquivo "${selecionado.titulo}", quero ajustar: `, `About task #${jobId}: in file “${selecionado.titulo}”, I want to adjust: `)
                      : tr(`Sobre o trabalho #${jobId}: me explica como "${selecionado.titulo}" entrou no resultado?`, `About task #${jobId}: explain how “${selecionado.titulo}” contributed to the result?`),
                  )
                }
              >
                <Icone nome="conversa" tamanho={15} /> {tr("Conversar sobre isso", "Discuss this")}</button>}
            </div>
          )}

          {/* O seletor de troca: o acervo com as legendas, ou um upload ali mesmo. */}
          {trocando && (
            <div className="fluxo-troca" role="dialog" aria-label={tr("Trocar a fonte", "Replace source")}>
              <div className="fluxo-troca-topo">
                <strong>
                  {tr("Trocar “", "Replace “")}{trocando.titulo}{tr("” por…", "” with…")}</strong>
                <button
                  type="button"
                  className="botao-texto"
                  onClick={() => setTrocando(null)}
                >
                  {tr("cancelar", "cancel")}</button>
              </div>
              {erroAcervo && <p className="alerta alerta-erro" role="alert">{erroAcervo} <button type="button" className="botao-texto" onClick={carregarAcervo}>{tr('Tentar o acervo novamente', 'Try the asset library again')}</button></p>}
              {acervo === null && !erroAcervo && <p className="texto-suave" role="status">{tr('Consultando o acervo…', 'Loading the asset library…')}</p>}
              {acervo !== null && acervo.length === 0 && (
                <p className="texto-suave">{tr("O acervo está vazio — envie o arquivo novo abaixo.", "The asset library is empty. Upload the new file below.")}</p>
              )}
              {acervo !== null && acervo.length > 0 && (
                <ul className="fluxo-troca-lista">
                  {acervo.map(({ pasta, rotulo, item }) => (
                    <li key={`${pasta}/${item.nome}`}>
                      <button type="button" onClick={() => trocarPor(item.nome, rotulo)}>
                        <Icone nome={iconeDoArquivo(item.nome)} tamanho={17} />
                        <span>
                          <span className="fluxo-troca-nome">{item.legenda || item.nome}</span>
                          <span className="fluxo-troca-meta">
                            {item.legenda ? `${item.nome} · ` : ''}
                            {rotulo}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <label className="botao botao-fantasma botao-pequeno fluxo-troca-upload" aria-busy={enviandoNova}>
                {enviandoNova ? (
                  tr("Enviando…", "Uploading…")
                ) : (
                  <>
                    <Icone nome="anexo" tamanho={15} /> {tr("Enviar um arquivo novo", "Upload a new file")}</>
                )}
                <input
                  ref={uploadRef}
                  type="file"
                  hidden
                  disabled={enviandoNova}
                  onChange={(e) => {
                    void subirNova(e.target.files?.[0] ?? null)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          )}

          {/* A placa de honestidade — obrigatória ENQUANTO o quadro é derivado.
              Com o raciocínio escrito (como-foi-feito.json), ela dá lugar à
              dica de onde ele está. */}
          {fluxo.derivado ? (
            <p className="fluxo-honestidade">
              {tr("Este quadro organiza os registros de ferramentas, agentes e entregas. Uma solicitação de leitura ou pesquisa não comprova acesso bem-sucedido nem uso da fonte no resultado.", "This diagram organizes tool, agent and delivery records. A read or search request does not prove successful access or use of a source in the result.")}</p>
          ) : (
            <p className="fluxo-honestidade">
              {tr("As etapas com o selo ", "Steps marked ")}<strong>{tr("por quê?", "why?")}</strong> {tr("contêm um relato de produção da IA. Clique para ler as decisões e pendências. O relato não substitui evidência de uso; miniaturas do acervo mostram o arquivo disponível hoje, não uma captura histórica.", "contain an AI production report. Click to read decisions and gaps. A report does not replace usage evidence; asset thumbnails show today's file, not a historical snapshot.")}</p>
          )}
        </>
      )}

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
            vigente: () => vigenteDownload() && vigente() && visorLeituraRef.current.n === visor.pedido,
          })}
          aoFechar={fecharVisor}
        />
      )}
    </section>
  )
}
