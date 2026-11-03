import { formatUSD } from '../../lib/i18nProducao'
import { useIdioma, type Traduzir } from '../../lib/i18n'
/**
 * 🎬 ESTÚDIO v2 — a casa SEPARADA da produção por peça (pedido do dono:
 * "quero o estúdio bem separado, vai iniciar a conversa ali mesmo").
 *
 * Três partes, na tela como no mockup aprovado:
 * - a CONVERSA DO ESTÚDIO embutida (própria, não a aba Conversar): descrever
 *   a peça, aprovar storyboard e pedir ajuste acontecem aqui;
 * - o FLUXO na ordem do filme: atos como caixinhas com fita de estado, cada
 *   ato abre a gaveta com as cenas;
 * - "COMO A IA PENSOU": o roteiro em texto, cena a cena, embaixo do fluxo.
 *
 * Continua valendo: abrir não gera nada e não custa nada — quem gasta é a
 * tarefa, que nasce daqui com o plano de custo antes.
 */

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { api, ApiError, asList, getSessionIdentity } from '../../lib/api'
import { wsClient } from '../../lib/ws'
import { Icone, type NomeIcone } from '../Icone'
import { useToasts } from '../Toasts'
import { tempoRelativo } from '../../lib/format'
import type { Entrega } from '../../lib/types'
import ComoFoiFeita from './ComoFoiFeita'
import EditorPeca from './EditorPeca'
import QuadroFluxo from './QuadroFluxo'
import PlanoDaPeca from './PlanoDaPeca'
import { useProducaoSegura } from './useProducaoSegura'
import './estudio.css'

/* Mesmo teto da aba Conversar — o endpoint é o mesmo (/conversas/{id}/anexos). */
const ANEXO_MAX_MB = 200

/* Contador de MÓDULO, não índice do lote: dois Ctrl+V no mesmo segundo caíam
   no mesmo "print-HHMMSS-1.png" e o segundo substituía o primeiro no servidor. */
let contadorColados = 0

type AnexoChip = {
  nome: string
  estado: 'enviando' | 'ok' | 'erro'
  detalhe?: string
}

type CenaDoc = {
  id: string
  tipo?: string
  ato?: string
  dur?: number | null
  roteiro?: string
  campos?: Record<string, unknown>
  takes?: Array<{ n?: number; escolhido?: boolean }>
  travado?: boolean
  estado?: string
}

type PecaDoc = {
  slug?: string
  titulo?: string
  molde?: string
  /** Peça ADOTADA (16/08/2026): o vídeo existia antes do documento; este é o
   *  caminho do arquivo original. Muda o botão primário — "Renderizar" numa
   *  adotada mandaria regerar um filme que já está pronto. */
  adotado_de?: string
  estado?: string
  grade?: { tempo_base_s?: number }
  orcamento?: { teto_usd?: number; gasto_usd?: number }
  direitos_de_imagem?: { pessoas_reais?: boolean; termo?: string | null }
  cenas?: CenaDoc[]
  audio?: {
    trilha_prompt?: string | null
    narracao?: { porta_voz?: string } | null
  }
}

type MoldeDoc = {
  nome?: string
  versao?: string
  descricao?: string
  grade?: Record<string, unknown>
  arte?: Record<string, unknown>
  camera?: Record<string, unknown>
  saida?: Record<string, unknown>
  campos_padrao?: Record<string, unknown>
}

type PecaResumo = {
  slug: string
  titulo: string
  molde?: string
  estado: string
  cenas: number
  duracao_s: number
  gasto_usd: number
  teto_usd: number
  editada_em?: string
}

type SugestaoChat = {
  titulo?: string
  prompt?: string
  etapas?: Array<{ titulo: string; andar: string }>
} | null

type MsgChat = {
  id: number
  role: string
  conteudo: string
  sugestao_tarefa?: SugestaoChat
}

function ROTULO_ESTADO_local(tr: Traduzir): Record<string, string> { return {
  rascunho: tr("rascunho","draft"),
  'storyboard-aprovado': tr("storyboard aprovado","storyboard approved"),
  entregue: tr("entregue","delivered"),
} }

/* Os ATOS da peça, na ordem do filme. O ícone é chave do set de traço, e não
   emoji: além do tom, tipar como `NomeIcone` faz uma chave errada quebrar no
   tsc em vez de virar quadradinho na tela do cliente. */
function ATO_META_local(tr: Traduzir): Record<string, { icone: NomeIcone; nome: string }> { return {
  abertura: { icone: 'raio', nome: tr("Abertura","Opening") },
  campeoes: { icone: 'arq-video', nome: tr("Série","Series") },
  serie: { icone: 'arq-video', nome: tr("Série","Series") },
  encerramento: { icone: 'visto', nome: tr("Encerramento","Closing") },
} }

const usd = formatUSD

type EstudioProps = {
  orgId: number
  slug: string
  aoPerguntar?: (texto: string) => void
  conversaAtual?: number | null
  antesDeGerar?: () => Promise<boolean>
  pecaInicial?: { slug: string; n: number; jobId?: number } | null
  trabalhoInicial?: { jobId: number; n: number } | null
  aoVerEntregas?: () => void
}

function ProducaoDiretaEstudio({ orgId, slug, texto, setTexto, salvar }: {
  orgId: number; slug: string; texto: string; setTexto: React.Dispatch<React.SetStateAction<string>>; salvar: (id: number) => void
}) {
  const { t } = useIdioma()
  const enviado = useRef<string | null>(null)
  const rota = `/predios/${orgId}/${slug}/jobs`
  const envio = useProducaoSegura(`/predios/${orgId}/${slug}`, '["estudio-direto"]', slug, id => {
    setTexto(atual => enviado.current !== null && atual.trim() === enviado.current ? '' : atual)
    salvar(id)
  }, { rota, rotaConsulta: `${rota}/por-intencao`, vincularCorpo: true })
  function outro() { enviado.current = null; envio.prepararOutro() }
  return <form className="estudio-iniciar-form" onSubmit={ev => {
    ev.preventDefault()
    const pedido = texto.trim()
    if (!envio.podeEditar || !pedido) return
    enviado.current ??= pedido
    void envio.enviar({ prompt: pedido })
  }}>
    <textarea value={texto} onChange={ev => setTexto(ev.target.value)} rows={2} disabled={!envio.podeEditar}
      aria-label={t('Descreva a produção', 'Describe the production')}
      placeholder={t('Descreva a peça que você quer — vídeo, post, campanha…', 'Describe what you want: video, post, campaign…')} />
    {envio.identificando && <p role="status">{t('Conferindo a conta e os pedidos já enviados…', 'Checking the account and submitted requests…')}</p>}
    {envio.temEnvioPendente && !envio.erro && <p role="status">{t('Há um pedido anterior para conferir antes de enviar outro.', 'Check the previous submission before sending another.')}</p>}
    {envio.precisaEscolherEnvio && <fieldset><legend>{t('Qual envio você quer conferir?', 'Which submission do you want to check?')}</legend>
      {envio.enviosPendentes.map((r, i) => <button key={r.requestId} type="button" onClick={() => envio.selecionarEnvio(r.requestId)}>{t(`Selecionar envio ${i + 1}`, `Select submission ${i + 1}`)}</button>)}
    </fieldset>}
    {envio.erro && <p role="alert">{envio.erro}</p>}
    {envio.precisaVerificarConta ? <button type="button" className="botao" onClick={() => void envio.verificarConta()}>{t('Tentar verificar a conta', 'Try checking the account')}</button>
      : envio.precisaEscolherEnvio ? null
        : envio.temEnvioPendente || envio.estado === 'consultando' ? <button type="button" className="botao" disabled={envio.ocupado} onClick={() => void envio.conferir()}>{envio.ocupado ? t('Conferindo envio…', 'Checking submission…') : t('Conferir envio', 'Check submission')}</button>
          : envio.estado === 'removido' ? <button type="button" className="botao" onClick={() => { enviado.current = null; envio.prepararNovo() }}>{t('Preparar um novo pedido', 'Prepare a new request')}</button>
            : <button type="submit" className="botao" disabled={envio.ocupado || !envio.podeEditar || !texto.trim()}>{envio.ocupado ? t('Preparando…', 'Preparing…') : envio.estado === 'repetir' ? t('Reenviar pedido', 'Resend request') : t('Produzir', 'Produce')}</button>}
    {!envio.ocupado && envio.enviosPendentes.length > 0 && <button type="button" className="botao botao-fantasma" onClick={outro}>{t('Preparar outro pedido', 'Prepare another request')}</button>}
  </form>
}

export default function EstudioTab(props: EstudioProps) {
  return <EstudioConteudo key={JSON.stringify([getSessionIdentity(), props.orgId, props.slug])} {...props} />
}

function EstudioConteudo({
  orgId,
  slug,
  pecaInicial,
  trabalhoInicial,
  aoVerEntregas,
  aoPerguntar,
  conversaAtual,
  antesDeGerar,
}: {
  orgId: number
  slug: string
  /** Quando embutido, todos os pedidos usam a conversa principal. */
  aoPerguntar?: (texto: string) => void
  conversaAtual?: number | null
  antesDeGerar?: () => Promise<boolean>
  /** Vinda da vitrine ("🧬 Ver como foi feita"): abre direto nesta peça.
   *  O `n` muda a cada clique — repetir a MESMA peça reabre mesmo assim.
   *  O `jobId` é a RESERVA: uma entrega pode ter saído em `outputs/pecas/…`
   *  sem que o documento da peça exista (arte estática não passa pelo fluxo
   *  de peça). Sem ele, o botão levava a "Peça não encontrada" e o dono ficava
   *  com uma tela morta — com ele, cai no diário do trabalho, que sempre há. */
  pecaInicial?: { slug: string; n: number; jobId?: number } | null
  /** Vindo de Entregas ou da conversa: abre direto o QUADRO deste trabalho.
   *  Mesmo contrato do pecaInicial — o `n` re-dispara o clique repetido. */
  trabalhoInicial?: { jobId: number; n: number } | null
  /** Leva à vitrine — a caixinha "ver a entrega" de um trabalho aberto. */
  aoVerEntregas?: () => void
}) {
  const { t: tr, idioma } = useIdioma()
  const ATO_META = ATO_META_local(tr)
  const ROTULO_ESTADO = ROTULO_ESTADO_local(tr)
  const { sucesso, falha } = useToasts()
  const [pecas, setPecas] = useState<PecaResumo[] | null>(null)
  const [novaProducao, setNovaProducao] = useState('')
  const [erro, setErro] = useState('')
  const [erroPecas, setErroPecas] = useState('')
  const [erroTrabalhos, setErroTrabalhos] = useState('')
  const [carregandoPecas, setCarregandoPecas] = useState(false)
  const [carregandoTrabalhos, setCarregandoTrabalhos] = useState(false)
  const leituraPecas = useRef<AbortController | null>(null)
  const leituraTrabalhos = useRef<AbortController | null>(null)
  const sessao = useRef(getSessionIdentity())
  const [aberta, setAberta] = useState<string | null>(null)
  const [doc, setDoc] = useState<PecaDoc | null>(null)
  // O EDITOR "com mais opções" (24/08/2026): timeline + inspetor por bloco.
  const [editorAberto, setEditorAberto] = useState(false)
  const [gavetaAto, setGavetaAto] = useState<string | null>(null)
  /* A BANCADA DE TRABALHOS (15/08/2026): o Estúdio deixou de ser só de peça de
   * vídeo — TODO trabalho do andar abre aqui, com o quadro "como foi feita".
   * A lista nasce das entregas agrupadas por job (o banco já sabe; varrer
   * outputs/ seria refazer pior o que a vitrine já faz). */
  const [trabalhos, setTrabalhos] = useState<Array<{
    jobId: number
    titulo: string
    quando: string
    arquivos: number
    pendentes: number
    /** Vídeo entregue FORA de outputs/pecas/ — o candidato à ADOÇÃO. */
    videoAdotavel: { entregaId: number; nome: string } | null
  }> | null>(null)
  const [trabalhoAberto, setTrabalhoAberto] = useState<number | null>(null)
  /** O trabalho para onde cair se o documento da peça não existir. */
  const jobDeReserva = useRef<number | null>(null)
  const [adotando, setAdotando] = useState<number | null>(null)
  /** O MOLDE aberto para o dono VER (16/08/2026): "molde X@1.0.0" era só um
   *  nome — o pedido foi literal, tudo que virou base tem a opção de ver. */
  const [molde, setMolde] = useState<{
    nome: string
    dados: MoldeDoc | null
    erro: string | null
  } | null>(null)

  // ── a conversa do Estúdio ────────────────────────────────────────
  const chaveConversa = `offiz:estudio-conversa:${orgId}:${slug}`
  const [conversaId, setConversaId] = useState<number | null>(() => {
    const salvo = Number(localStorage.getItem(chaveConversa) || 0)
    return salvo > 0 ? salvo : null
  })
  const [msgs, setMsgs] = useState<MsgChat[]>([])
  const [textoChat, setTextoChat] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [iniciando, setIniciando] = useState(false)
  const [trabalhoEmVoo, setTrabalhoEmVoo] = useState<string | null>(null)
  const [aceitas, setAceitas] = useState<Record<number, true>>({})
  const fimMsgsRef = useRef<HTMLDivElement | null>(null)
  const campoRef = useRef<HTMLTextAreaElement | null>(null)
  // Anexos: o material da peça entra AQUI (📎, arrastar ou colar) — vai para
  // entrada/ pelo mesmo endpoint da aba Conversar.
  const [anexos, setAnexos] = useState<AnexoChip[]>([])
  const [arrastando, setArrastando] = useState(false)
  const anexoInputRef = useRef<HTMLInputElement | null>(null)
  // Lotes de anexo em FILA, nunca descartados: colar a 2ª foto durante o
  // upload da 1ª tem que subir também — um descarte silencioso aqui é a IA
  // nunca ver um material que o dono jura que mandou.
  const filaAnexosRef = useRef<Promise<void>>(Promise.resolve())
  // A criação da conversa é UMA promise compartilhada: colar um arquivo e
  // apertar Enter no mesmo instante disparava dois POST /conversas — os anexos
  // iam para uma conversa e a mensagem para outra (a que salvasse por último
  // vencia o localStorage, e metade do histórico sumia).
  const conversaPromiseRef = useRef<Promise<number> | null>(null)
  // Tela cheia ("tipo um F11"): overlay fixo cobrindo a janela do app — de
  // propósito NÃO usa requestFullscreen: o top layer nativo renderiza acima
  // dos toasts e do sino, e um erro de envio ficava invisível em tela cheia.
  const [imersivo, setImersivo] = useState(false)

  const base = `/predios/${orgId}/${slug}/estudio`

  const carregarLista = useCallback(() => {
    leituraPecas.current?.abort()
    const controller = new AbortController()
    leituraPecas.current = controller
    const atual = () => !controller.signal.aborted && leituraPecas.current === controller && getSessionIdentity() === sessao.current
    setCarregandoPecas(true)
    setErroPecas('')
    api
      .get<{ pecas: PecaResumo[] }>(`${base}/pecas`, controller.signal)
      .then((r) => { if (atual()) setPecas(r.pecas) })
      .catch(() => { if (atual()) setErroPecas(tr('Não consegui carregar as peças.', 'I could not load the productions.')) })
      .finally(() => { if (atual()) setCarregandoPecas(false) })
  }, [base, tr])

  /** Os trabalhos do andar, agrupados por job — a matéria-prima da bancada. */
  const carregarTrabalhos = useCallback(() => {
    leituraTrabalhos.current?.abort()
    const controller = new AbortController()
    leituraTrabalhos.current = controller
    const atual = () => !controller.signal.aborted && leituraTrabalhos.current === controller && getSessionIdentity() === sessao.current
    setCarregandoTrabalhos(true)
    setErroTrabalhos('')
    api
      .get<unknown>(`/predios/${orgId}/${slug}/entregas`, controller.signal)
      .then((data) => {
        if (!atual()) return
        const porJob = new Map<number, {
          jobId: number
          titulo: string
          quando: string
          arquivos: number
          pendentes: number
          videoAdotavel: { entregaId: number; nome: string } | null
        }>()
        for (const e of asList<Entrega>(data, 'entregas')) {
          const t = porJob.get(e.job_id) ?? {
            jobId: e.job_id,
            titulo: e.job_titulo || `Trabalho #${e.job_id}`,
            quando: e.criado_em,
            arquivos: 0,
            pendentes: 0,
            videoAdotavel: null as { entregaId: number; nome: string } | null,
          }
          t.arquivos += 1
          // Peça editorial não se aprova aqui (calendário) — contá-la acendia
          // um distintivo que não abria nada. 09/09/2026.
          if (e.status === 'pendente' && e.tipo !== 'interno' && !e.editorial_peca_id) t.pendentes += 1
          if (e.criado_em > t.quando) t.quando = e.criado_em
          const caminho = (e.caminho_rel || '').replace(/\\/g, '/')
          const ehVideo = e.tipo === 'video' || /\.(mp4|webm|mov|m4v|mkv)$/i.test(e.nome)
          if (ehVideo && !caminho.startsWith('outputs/pecas/') && !t.videoAdotavel) {
            t.videoAdotavel = { entregaId: e.id, nome: e.nome }
          }
          porJob.set(e.job_id, t)
        }
        setTrabalhos(
          [...porJob.values()].sort((a, b) => (a.quando < b.quando ? 1 : -1)),
        )
      })
      .catch(() => { if (atual()) setErroTrabalhos(tr('Não consegui carregar os trabalhos.', 'I could not load the tasks.')) })
      .finally(() => { if (atual()) setCarregandoTrabalhos(false) })
  }, [orgId, slug, tr])

  useEffect(() => {
    carregarLista()
    carregarTrabalhos()
    return () => { leituraPecas.current?.abort(); leituraTrabalhos.current?.abort() }
  }, [carregarLista, carregarTrabalhos])

  useEffect(() => {
    if (pecaInicial?.slug) {
      jobDeReserva.current = pecaInicial.jobId ?? null
      setAberta(pecaInicial.slug)
      setTrabalhoAberto(null)
    }
  }, [pecaInicial])

  useEffect(() => {
    if (trabalhoInicial?.jobId) {
      setTrabalhoAberto(trabalhoInicial.jobId)
      setAberta(null)
    }
  }, [trabalhoInicial])

  useEffect(() => {
    setDoc(null)
    setErro('')
    if (!aberta) {
      setGavetaAto(null)
      return
    }
    const controller = new AbortController()
    api
      .get<{ peca: PecaDoc }>(`${base}/pecas/${encodeURIComponent(aberta)}`, controller.signal)
      .then((r) => { if (!controller.signal.aborted) setDoc({ ...r.peca, slug: aberta }) })
      .catch((e) => {
        if (controller.signal.aborted) return
        // Documento de peça inexistente com trabalho conhecido: o Estúdio
        // ABRE O DIÁRIO em vez de anunciar "Peça não encontrada". O caminho
        // `outputs/pecas/<slug>/` é uma PISTA, não uma promessa — quem
        // entrega arte estática grava lá sem nunca abrir documento.
        if (e instanceof ApiError && e.status === 404 && jobDeReserva.current != null) {
          const job = jobDeReserva.current
          jobDeReserva.current = null
          setAberta(null)
          setTrabalhoAberto(job)
          return
        }
        setErro(e instanceof ApiError ? e.detail : tr("Não consegui abrir esta peça.", "I could not open this production."))
      })
    return () => controller.abort()
  }, [base, aberta])

  // Trocou de prédio/andar com o componente montado: a conversa do Estúdio é
  // POR PRÉDIO — sem este reset, a mensagem seguinte ia para a conversa da
  // org ANTERIOR (o estado sobrevivia à troca de props).
  useEffect(() => {
    conversaPromiseRef.current = null
    const salvo = Number(localStorage.getItem(chaveConversa) || 0)
    setConversaId(salvo > 0 ? salvo : null)
    setMsgs([])
    setAnexos([])
    setAceitas({})
  }, [chaveConversa])

  // A conversa salva reabre com o histórico. Só um 404/403 (apagada ou sem
  // acesso) descarta o id — um erro transitório de rede não pode apagar o
  // histórico salvo do estúdio.
  useEffect(() => {
    if (!conversaId || aoPerguntar) return
    api
      .get<{ mensagens?: MsgChat[] }>(`/conversas/${conversaId}`)
      .then((det) => setMsgs(Array.isArray(det.mensagens) ? det.mensagens : []))
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          localStorage.removeItem(chaveConversa)
          setConversaId(null)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaId, aoPerguntar])

  useEffect(() => {
    fimMsgsRef.current?.scrollIntoView({ block: 'end' })
  }, [msgs, enviando])

  // Peças e documento se atualizam sozinhos quando QUALQUER job muda de
  // status (o render escreve memoria/pecas/ e o finish mescla) — sem poll.
  useEffect(() => {
    let controller: AbortController | undefined
    const recarregar = () => {
      carregarLista()
      carregarTrabalhos()
      if (aberta) {
        controller?.abort()
        const atual = new AbortController()
        controller = atual
        api
          .get<{ peca: PecaDoc }>(`${base}/pecas/${encodeURIComponent(aberta)}`, atual.signal)
          .then((r) => { if (!atual.signal.aborted) setDoc({ ...r.peca, slug: aberta }) })
          .catch(() => undefined)
      }
      setTrabalhoEmVoo(null)
    }
    const off = wsClient.on('job_status', recarregar)
    return () => { controller?.abort(); off() }
  }, [carregarLista, carregarTrabalhos, base, aberta])

  function garantirConversa(): Promise<number> {
    if (conversaId) return Promise.resolve(conversaId)
    // Promise compartilhada: chamadas concorrentes (anexo + Enter) esperam a
    // MESMA criação em vez de criar duas conversas.
    if (!conversaPromiseRef.current) {
      conversaPromiseRef.current = api
        .post<{ id: number }>(`/predios/${orgId}/${slug}/conversas`, {})
        .then((criada) => {
          setConversaId(criada.id)
          localStorage.setItem(chaveConversa, String(criada.id))
          return criada.id
        })
        .catch((e) => {
          // Falhou: solta a promise para a próxima tentativa criar de novo.
          conversaPromiseRef.current = null
          throw e
        })
    }
    return conversaPromiseRef.current
  }

  async function enviar(textoForcado?: string) {
    const texto = (textoForcado ?? textoChat).trim()
    if (!texto || enviando) return
    setEnviando(true)
    setErro('')
    setMsgs((prev) => [
      ...prev,
      { id: -Date.now(), role: 'user', conteudo: texto },
    ])
    setTextoChat('')
    try {
      const cid = await garantirConversa()
      const r = await api.post<{ mensagem?: MsgChat }>(
        `/conversas/${cid}/mensagens`,
        { conteudo: texto, ...(window.offizMotor?.chatDeviceId ? { motor_local: window.offizMotor.chatDeviceId } : {}) },
      )
      if (r.mensagem) setMsgs((prev) => [...prev, r.mensagem as MsgChat])
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : tr("Não consegui enviar agora — tente de novo.", "I could not send this right now. Please try again."))
    } finally {
      setEnviando(false)
    }
  }

  /** Todo lote entra na FILA (promise chain) e o envio é SEQUENCIAL: o
   *  contexto da conversa é read-modify-write no servidor, e requests em
   *  paralelo fariam uma resposta sobrescrever a lista da outra (a mesma
   *  lição da aba Conversar). */
  function anexar(lista: File[]) {
    const arquivos = lista.filter(Boolean)
    if (arquivos.length === 0) return
    filaAnexosRef.current = filaAnexosRef.current.then(() => subirLote(arquivos))
  }

  async function subirLote(arquivos: File[]) {
    try {
      const cid = await garantirConversa()
      for (const arquivo of arquivos) {
        const chip: AnexoChip = { nome: arquivo.name, estado: 'enviando' }
        setAnexos((prev) => [...prev, chip])
        const trocar = (novo: Partial<AnexoChip>) =>
          setAnexos((prev) => prev.map((a) => (a === chip ? { ...a, ...novo } : a)))
        if (arquivo.size > ANEXO_MAX_MB * 1024 * 1024) {
          trocar({ estado: 'erro', detalhe: tr(`maior que ${ANEXO_MAX_MB}MB`, `larger than ${ANEXO_MAX_MB}MB`) })
          continue
        }
        try {
          const fd = new FormData()
          fd.append('arquivo', arquivo, arquivo.name)
          await api.postForm(`/conversas/${cid}/anexos`, fd)
          trocar({ estado: 'ok' })
        } catch (e) {
          trocar({ estado: 'erro', detalhe: e instanceof ApiError ? e.detail : tr("falhou", "failed") })
        }
      }
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : tr("Não consegui anexar os arquivos.", "I could not attach the files."))
    } finally {
      if (anexoInputRef.current) anexoInputRef.current.value = ''
    }
  }

  /** Print colado chama-se sempre "image.png" — sem rebatizar, o segundo
   *  print SUBSTITUI o primeiro no servidor (o anexo é trocado por nome). */
  function batizarColados(arquivos: File[]): File[] {
    return arquivos.map((f) => {
      if (!/^image\.\w+$/i.test(f.name)) return f
      const ext = f.name.split('.').pop() || 'png'
      const hora = new Date().toISOString().slice(11, 19).replace(/:/g, '')
      return new File([f], `print-${hora}-${++contadorColados}.${ext}`, { type: f.type })
    })
  }

  function soltarAnexos(e: DragEvent<HTMLElement>) {
    e.preventDefault()
    setArrastando(false)
    const arquivos = Array.from(e.dataTransfer?.files || [])
    if (arquivos.length) anexar(arquivos)
  }

  // Esc fecha a tela cheia (overlay próprio, sem fullscreen nativo).
  // `defaultPrevented` = algum modal na frente (visor, molde) já consumiu o
  // Esc — sem o check, um aperto fechava o modal E derrubava a tela cheia.
  useEffect(() => {
    if (!imersivo) return
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setImersivo(false)
    }
    window.addEventListener('keydown', aoTecla)
    return () => window.removeEventListener('keydown', aoTecla)
  }, [imersivo])

  // Esc fecha o molde — o mesmo gesto do visor, na captura e consumindo o
  // evento, para a tela cheia atrás não cair junto.
  useEffect(() => {
    if (!molde) return
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setMolde(null)
      }
    }
    window.addEventListener('keydown', aoTecla, true)
    return () => window.removeEventListener('keydown', aoTecla, true)
  }, [molde])

  async function iniciarSugestao(m: MsgChat) {
    const s = m.sugestao_tarefa
    if (!s?.prompt || iniciando) return
    setIniciando(true)
    try {
      // effort 'high', não 'xhigh': o peso da peça está no fal/ffmpeg, não no
      // raciocínio — e o xhigh foi um dos motivos de corridas de R$ 19.
      const criado = await api.post<{ id: number }>(
        `/predios/${orgId}/${slug}/jobs`,
        { prompt: s.prompt, effort: 'high', conversa_id: conversaId ?? undefined, sugestao_mensagem_id: m.id },
      )
      if (conversaId && criado?.id) {
        // o fio: a conversa do estúdio passa a saber do trabalho (best-effort)
        api.put(`/conversas/${conversaId}/trabalho`, { job_id: criado.id }).catch(() => undefined)
      }
      setAceitas((prev) => ({ ...prev, [m.id]: true }))
      setTrabalhoEmVoo(s.titulo || tr("trabalho do estúdio", "studio task"))
      sucesso(tr(`“${s.titulo || 'Trabalho'}” começou — o fluxo atualiza sozinho quando terminar.`, `“${s.titulo || 'Task'}” started. The workflow updates automatically when it finishes.`))
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : tr("Não consegui iniciar a tarefa.", "I could not start the task."))
    } finally {
      setIniciando(false)
    }
  }

  /** Os botões da peça escrevem o pedido PRONTO no composer do Estúdio —
   *  você revisa e manda (nunca gasta sem o seu Enter). */
  function preencher(texto: string) {
    if (aoPerguntar) { aoPerguntar(texto); return }
    setTextoChat(texto)
    campoRef.current?.focus()
  }

  /** Abre o molde da peça para leitura — o que ele DECIDE, em linguagem de
   *  dono, com o contrato completo logo abaixo. */
  async function abrirMolde(nomeComVersao: string) {
    setMolde({ nome: nomeComVersao, dados: null, erro: null })
    try {
      const r = await api.get<{ molde: MoldeDoc }>(
        `${base}/moldes/${encodeURIComponent(nomeComVersao)}`,
      )
      setMolde((m) => (m && m.nome === nomeComVersao ? { ...m, dados: r?.molde ?? {} } : m))
    } catch (e) {
      setMolde((m) =>
        m && m.nome === nomeComVersao
          ? {
              ...m,
              erro:
                e instanceof ApiError && e.status === 404
                  ? tr("Este molde não está mais no catálogo do escritório.", "This template is no longer in the office catalog.")
                  : tr("Não consegui abrir o molde agora.", "I could not open the template right now."),
            }
          : m,
      )
    }
  }

  const docAberto = aberta && doc && doc.slug === aberta
  const atos: Array<{ ato: string; cenas: CenaDoc[] }> = []
  if (docAberto) {
    for (const c of doc.cenas || []) {
      const ato = c.ato || tr("cenas", "scenes")
      const ultimo = atos[atos.length - 1]
      if (ultimo && ultimo.ato === ato) ultimo.cenas.push(c)
      else atos.push({ ato, cenas: [c] })
    }
  }

  return (
    <div className={`estudio${imersivo ? ' estudio--imersivo' : ''}`}>
      <header className="estudio-topo">
        <div>
          {!aoPerguntar && <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icone nome="estudio" /> {tr("Estúdio", "Studio")}</h2>}
          <p className="texto-suave" style={{ margin: '4px 0 0' }}>
            {tr('Revise as cenas, confira o custo e acompanhe a produção.', 'Review the scenes, check the cost, and follow production.')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {trabalhoEmVoo && (
            <span className="estudio-emvoo" role="status">
              ◐ “{trabalhoEmVoo}{tr("” em andamento — o fluxo atualiza sozinho", "” in progress. The workflow updates automatically")}</span>
          )}
          {!aoPerguntar && <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            onClick={() => setImersivo((v) => !v)}
            title={imersivo ? tr("Sair da tela cheia (Esc)", "Exit full screen (Esc)") : tr("O Estúdio cobre a janela inteira", "Studio fills the entire window")}
          >
            <Icone nome="expandir" tamanho={15} />{' '}
            {imersivo ? tr("Sair da tela cheia", "Exit full screen") : tr("Tela cheia", "Full screen")}
          </button>}
        </div>
      </header>

      {erro && <p className="alerta alerta-erro" role="alert">{erro}</p>}
      {erroPecas && <p className="alerta alerta-erro" role="alert">
        {erroPecas}{' '}{pecas !== null && tr('A última lista carregada continua abaixo.', 'The last loaded list remains below.')} {' '}
        <button type="button" className="botao-texto" onClick={carregarLista} disabled={carregandoPecas}>{tr('Tentar carregar as peças', 'Try loading productions again')}</button>
      </p>}
      {erroTrabalhos && <p className="alerta alerta-erro" role="alert">
        {erroTrabalhos}{' '}{trabalhos !== null && tr('A última lista carregada continua abaixo.', 'The last loaded list remains below.')} {' '}
        <button type="button" className="botao-texto" onClick={carregarTrabalhos} disabled={carregandoTrabalhos}>{tr('Tentar carregar os trabalhos', 'Try loading tasks again')}</button>
      </p>}

      <div className={`estudio-corpo${aoPerguntar ? ' estudio-corpo--embutido' : ''}`}>
        <div className="estudio-principal">
          {!aberta && trabalhoAberto == null && <>
            {pecas === null && carregandoPecas && <p className="texto-suave" role="status">{tr('Carregando peças…', 'Loading productions…')}</p>}
            {trabalhos === null && carregandoTrabalhos && <p className="texto-suave" role="status">{tr('Carregando trabalhos…', 'Loading tasks…')}</p>}
          </>}
          {/* ── O QUADRO DE UM TRABALHO (qualquer um, não só peça) ── */}
          {trabalhoAberto != null && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="botao-texto"
                  onClick={() => setTrabalhoAberto(null)}
                >
                  {tr("← Todos os trabalhos", "← All tasks")}</button>
                {aoVerEntregas && (
                  <button
                    type="button"
                    className="botao botao-fantasma botao-pequeno"
                    onClick={aoVerEntregas}
                  >
                    <Icone nome="entregas" tamanho={15} /> {tr("Ver a entrega", "View deliverable")}</button>
                )}
              </div>
              <QuadroFluxo
                orgId={orgId}
                slug={slug}
                jobId={trabalhoAberto}
                aoPerguntar={preencher}
              />
            </>
          )}

          {pecas !== null && pecas.length === 0 && !aberta && trabalhoAberto == null && (
            <div className="sabe-card" style={{ maxWidth: 640 }}>
              <strong>{tr("Nenhuma peça ainda.", "No productions yet.")}</strong>
              <p className="texto-suave" style={{ margin: '6px 0 0' }}>
                {tr("Uma peça é um vídeo composto de várias cenas com a mesma direção de arte — abertura de evento, VT, série. ", "A production is a video with several scenes that share the same art direction, such as an event opening, commercial, or series. ")}<b>{tr("Descreva o vídeo na conversa aqui do lado", "Describe the video in the conversation alongside")}</b>{tr(": eu monto o roteiro cena a cena e digo o custo ", ": I will prepare a script for each scene and explain the cost ")}<em>{tr("antes", "before")}</em> {tr("de gastar.", "spending.")}</p>
            </div>
          )}

          {pecas !== null && pecas.length > 0 && !aberta && trabalhoAberto == null && (
            <ul className="sabe-lista">
              {pecas.map((p) => (
                <li key={p.slug} className="sabe-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15 }}>{p.titulo}</strong>
                    <span className="status-pill status-done">
                      {ROTULO_ESTADO[p.estado] || p.estado}
                    </span>
                  </div>
                  <p className="texto-suave" style={{ margin: '4px 0 8px', fontSize: 13 }}>
                    {p.cenas} {tr("cenas · ", "scenes · ")}{String(p.duracao_s).replace('.', ',')} {tr("s · gasto", "s · spent")}{' '}
                    {usd(p.gasto_usd, idioma)}
                    {p.teto_usd ? tr(` de ${usd(p.teto_usd, idioma)}`, ` of ${usd(p.teto_usd, idioma)}`) : ''}
                  </p>
                  <button
                    type="button"
                    className="botao botao-fantasma"
                    onClick={() => setAberta(p.slug)}
                  >
                    {tr("Abrir a peça →", "Open production →")}</button>
                </li>
              ))}
            </ul>
          )}

          {/* ── COMEÇAR UMA PRODUÇÃO DAQUI (24/08, pedido do dono: "o studio
              não tem a conversa para início desses pedidos"). A home só
              listava o que já existia — para criar, o dono tinha que sair
              para a aba Conversa. Agora o pedido nasce aqui e vira trabalho
              na hora; o acompanhamento abre em seguida no próprio quadro. ── */}
          {!aberta && trabalhoAberto == null && (
            <section className="estudio-iniciar" aria-label={tr("Começar uma produção", "Start a production")}>
              <h3 className="estudio-bancada-titulo">
                <Icone nome="conversa" tamanho={16} /> {tr("Começar uma produção", "Start a production")}</h3>
              {!aoPerguntar ? <ProducaoDiretaEstudio orgId={orgId} slug={slug} texto={novaProducao} setTexto={setNovaProducao} salvar={id => {
                setTrabalhoAberto(id)
                void carregarTrabalhos()
              }} /> : <form
                className="estudio-iniciar-form"
                onSubmit={(ev) => {
                  ev.preventDefault()
                  const texto = novaProducao.trim()
                  if (!texto) return
                  preencher(texto); setNovaProducao('')
                }}
              >
                <textarea
                  value={novaProducao}
                  onChange={(ev) => setNovaProducao(ev.target.value)}
                  rows={2}
                  placeholder={tr("Descreva a peça que você quer — vídeo, post, campanha… Ex.: “vídeo de 20s chamando para o jogo de domingo, com a cara do nosso Instagram”", "Describe what you want: video, post, campaign… For example: “a 20-second video for Sunday’s game, matching our Instagram style”")}
                />
                <button type="button" className="botao"
                  onClick={(ev) => (ev.currentTarget.form as HTMLFormElement | null)?.requestSubmit()}>
                  {tr('Preparar na conversa', 'Prepare in conversation')}
                </button>
              </form>}
            </section>
          )}

          {/* ── A BANCADA: todo trabalho do andar abre aqui, não só a peça.
              O quadro mostra o que entrou, quem mexeu e o que saiu — e as
              partes se editam conversando (o composer é o daqui do lado). ── */}
          {!aberta && trabalhoAberto == null && trabalhos !== null && trabalhos.length > 0 && (
            <section style={{ marginTop: pecas?.length ? 18 : 0 }} aria-label={tr("Todos os trabalhos", "All tasks")}>
              <h3 className="estudio-bancada-titulo">
                <Icone nome="fluxo" tamanho={16} /> {tr("Como cada trabalho foi feito", "How each task was made")}</h3>
              <p className="texto-suave" style={{ margin: '2px 0 10px', fontSize: 13 }}>
                {tr("Qualquer trabalho — post, carrossel, e-mail, vídeo — abre no quadro: o que entrou, quem mexeu e o que saiu. Para mudar uma parte, é só conversar.", "Open any task here: post, carousel, email, or video. See the inputs, work, and outputs. To change one part, just ask in the conversation.")}</p>
              <ul className="estudio-trabalhos">
                {trabalhos.map((t) => (
                  <li key={t.jobId} className="estudio-trabalho-linha">
                    <button
                      type="button"
                      className="estudio-trabalho"
                      onClick={() => setTrabalhoAberto(t.jobId)}
                    >
                      <span className="estudio-trabalho-titulo">{t.titulo}</span>
                      <span className="texto-suave">
                        #{t.jobId} · {t.arquivos} {tr("arquivo", "file")}{t.arquivos === 1 ? '' : 's'} ·{' '}
                        {tempoRelativo(t.quando, idioma)}
                      </span>
                      {t.pendentes > 0 && (
                        <span className="contador" aria-label={tr(`${t.pendentes} aguardando você`, `${t.pendentes} awaiting you`)}>
                          {t.pendentes}
                        </span>
                      )}
                      <Icone nome="fluxo" className="estudio-trabalho-seta" tamanho={17} />
                    </button>
                    {t.videoAdotavel && (
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        disabled={adotando === t.jobId}
                        title={tr("Este vídeo nasceu de um pedido solto e não tem documento — sem ele eu não sei o que é cada trecho. Adotar cria a peça com o que existe, travada, sem custo.", "This video came from an unstructured request and has no production document. Adopting it creates a locked production using existing files, at no cost.")}
                        onClick={async () => {
                          setAdotando(t.jobId)
                          try {
                            const r = await api.post<{ slug: string }>(
                              `${base}/pecas/adotar`,
                              { entrega_id: t.videoAdotavel!.entregaId, titulo: t.titulo },
                            )
                            sucesso(tr("Peça criada — agora dá para editar cena a cena.", "Production created. You can now edit each scene."))
                            carregarLista()
                            setTrabalhoAberto(null)
                            setAberta(r.slug)
                          } catch (e) {
                            falha(
                              e instanceof ApiError
                                ? e.detail
                                : tr("Não consegui adotar este vídeo agora.", "I could not adopt this video right now."),
                            )
                          } finally {
                            setAdotando(null)
                          }
                        }}
                      >
                        {adotando === t.jobId ? tr("Adotando…", "Adopting…") : (
                          <>
                            <Icone nome="arq-video" tamanho={15} /> {tr("Adotar para editar", "Adopt for editing")}</>
                        )}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {docAberto && editorAberto && (
            <EditorPeca
              orgId={orgId}
              officeSlug={slug}
              pecaSlug={aberta as string}
              aoPreencher={preencher}
              aoFechar={() => setEditorAberto(false)}
            />
          )}

          {docAberto && !editorAberto && (
            <>
              <button
                type="button"
                className="botao-texto"
                onClick={() => setAberta(null)}
                style={{ marginBottom: 8 }}
              >
                {tr("← Todas as peças", "← All productions")}</button>

              {/* "Abrir no editor" ESCONDIDO por ora (24/08, pedido do dono —
                  demo à vista e as prévias das cenas ainda não aparecem de
                  forma confiável). O EditorPeca continua inteiro e testado;
                  religar é devolver este botão. */}
              {false && (
                <button
                  type="button"
                  className="botao botao-primario botao-pequeno"
                  style={{ marginBottom: 8, marginLeft: 8 }}
                  title={tr("Timeline com blocos, takes, direção, nota e o custo dito antes", "Timeline with blocks, takes, direction, notes, and cost shown upfront")}
                  onClick={() => setEditorAberto(true)}
                >
                  {tr("🎬 Abrir no editor", "🎬 Open editor")}</button>
              )}

              <div className="sabe-card" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 16 }}>{doc.titulo || aberta}</strong>
                  <span className="status-pill status-done">
                    {ROTULO_ESTADO[doc.estado || ''] || doc.estado || tr("rascunho", "draft")}
                  </span>
                  <span className="texto-suave" style={{ fontSize: 12 }}>
                    {doc.molde && (
                      <>
                        {tr("molde", "template")}{' '}
                        <button
                          type="button"
                          className="botao-texto"
                          title={tr("Ver o que este molde decide: grade, direção de arte, saída", "See what this template defines: layout, art direction, and output")}
                          onClick={() => void abrirMolde(String(doc.molde))}
                        >
                          {doc.molde} <Icone nome="lupa" tamanho={13} />
                        </button>{' '}
                        ·{' '}
                      </>
                    )}
                    {(doc.cenas || []).length} {tr("cenas", "scenes")}{doc.orcamento
                      ? tr(` · gasto ${usd(doc.orcamento.gasto_usd || 0, idioma)} de ${usd(doc.orcamento.teto_usd || 0, idioma)}`, ` · spent ${usd(doc.orcamento.gasto_usd || 0, idioma)} of ${usd(doc.orcamento.teto_usd || 0, idioma)}`)
                      : ''}
                  </span>
                </div>
                {doc.direitos_de_imagem?.pessoas_reais && !doc.direitos_de_imagem?.termo && (
                  <p className="alerta alerta-erro" style={{ margin: '8px 0 0' }}>
                    {tr("⚖️ Pessoas reais sem termo de imagem — a geração fica travada até o termo entrar no documento.", "⚖️ Real people without image consent. Generation stays blocked until consent is recorded in the document.")}</p>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <button
                    type="button"
                    className="botao botao-fantasma botao-pequeno"
                    onClick={() =>
                      preencher(
                        tr(`Abra a peça "${aberta}" e rode o plano (sem gastar): em que pé está e qual o custo pendente por cena?`, `Open production “${aberta}” and run the plan without spending. What is its status and pending cost per scene?`),
                      )
                    }
                  >
                    {tr('Entender o plano', 'Explain the plan')}</button>
                  <button
                    type="button"
                    className="botao botao-fantasma botao-pequeno"
                    onClick={() =>
                      preencher(
                        tr(`Rode o storyboard da peça "${aberta}" (só as imagens-chave, nenhum vídeo) e me mostre o contact sheet.`, `Generate the storyboard for production “${aberta}” (key images only, no video) and show me the contact sheet.`),
                      )
                    }
                  >
                    Storyboard
                  </button>
                  {doc.adotado_de ? (
                    /* Adotada: o filme já existe. O verbo é AJUSTAR — e quem
                       ajusta é o agente, com o plano de custo antes. */
                    <button
                      type="button"
                      className="botao botao-primario botao-pequeno"
                      onClick={() =>
                        preencher(
                          tr(`Sobre a peça adotada "${aberta}" (o vídeo ${doc.adotado_de}): quero ajustar `, `About the adopted production “${aberta}” (video ${doc.adotado_de}): I want to adjust `),
                        )
                      }
                    >
                      <Icone nome="lapis" tamanho={15} /> {tr("Pedir um ajuste", "Request an adjustment")}</button>
                  ) : null}
                </div>
              </div>

              {!doc.adotado_de && <PlanoDaPeca key={`${base}/${aberta}`} base={base} peca={aberta!}
                conversaId={aoPerguntar ? conversaAtual : conversaId} perguntar={preencher} antesDeGerar={antesDeGerar} />}

              {/* O FLUXO na ordem do filme (o desenho do mockup) */}
              <div className="estudio-trilho" role="list" aria-label={tr("Atos da peça, na ordem do filme", "Production acts in film order")}>
                {atos.map((g) => {
                  const meta = ATO_META[g.ato] ?? { icone: 'arq-video' as NomeIcone, nome: g.ato }
                  const abertaAqui = gavetaAto === g.ato
                  return (
                    <button
                      key={g.ato}
                      type="button"
                      role="listitem"
                      className={`estudio-ato${abertaAqui ? ' aberta' : ''}`}
                      aria-expanded={abertaAqui}
                      onClick={() => setGavetaAto(abertaAqui ? null : g.ato)}
                    >
                      <span className="estudio-ato-topo">
                        <Icone nome={meta.icone} tamanho={16} />
                        <strong>{meta.nome}</strong>
                        <code>×{g.cenas.length}</code>
                      </span>
                      <span className="estudio-fita" aria-hidden="true">
                        {g.cenas.map((c) => (
                          <i
                            key={c.id}
                            className={(c.takes || []).length > 0 ? 'ok' : 'vazio'}
                          />
                        ))}
                      </span>
                      <span className="texto-suave" style={{ fontSize: 11 }}>
                        {g.cenas.filter((c) => (c.takes || []).length > 0).length} {tr("de", "of")}{' '}
                        {g.cenas.length} {tr("com material ⌄", "with materials ⌄")}</span>
                    </button>
                  )
                })}
              </div>

              {gavetaAto && (
                <div className="estudio-gaveta">
                  {(atos.find((g) => g.ato === gavetaAto)?.cenas || []).map((c) => {
                    const campos = c.campos || {}
                    const rotulo =
                      [campos['nome'], campos['rotulo']].filter(Boolean).join(' · ') || c.id
                    return (
                      <div key={c.id} className="estudio-cena">
                        <div className="estudio-cena-topo">
                          <code>{c.id}</code>
                          <strong>{String(rotulo)}</strong>
                          {c.travado && (
                            <span title={tr("Travada", "Locked")}>
                              <Icone nome="cadeado" tamanho={14} />
                            </span>
                          )}
                        </div>
                        {c.roteiro && <p className="texto-suave">{c.roteiro}</p>}
                        <p className="texto-suave" style={{ fontSize: 11.5 }}>
                          {c.tipo || 'serie'}
                          {c.dur ? tr(` · ${String(c.dur).replace('.', ',')} s`, ` · ${String(c.dur)} s`) : ''}
                          {(c.takes || []).length > 0
                            ? tr(` · ${(c.takes || []).length} take(s) pago(s)`, ` · ${(c.takes || []).length} paid take(s)`)
                            : tr(" · nada gerado ainda", " · nothing generated yet")}
                        </p>
                        <button
                          type="button"
                          className="botao-texto"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          onClick={() =>
                            preencher(
                              tr(`Na peça "${aberta}", cena ${c.id}: quero mudar só esta cena — as outras não podem ser refeitas nem pagas de novo. O que muda: `, `In production “${aberta}”, scene ${c.id}: change only this scene. Do not regenerate or pay again for the others. What to change: `),
                            )
                          }
                        >
                          <Icone nome="conversa" tamanho={15} /> {tr("Falar desta cena", "Discuss this scene")}</button>
                      </div>
                    )
                  })}
                </div>
              )}

              <details className="estudio-detalhes-producao" key={aberta}>
              <summary>{tr('Ver materiais, montagem e roteiro', 'View materials, editing and script')}</summary>
              {/* COMO FOI FEITA — a genealogia da peça, tipo Miro: fontes →
                  cenas → filme, com arestas medidas no DOM. Trocar uma fonte
                  prepara o pedido no composer daqui do lado. */}
              <ComoFoiFeita
                orgId={orgId}
                officeSlug={slug}
                pecaSlug={String(aberta)}
                aoPreencher={preencher}
              />

              {/* COMO A IA PENSOU — o roteiro em texto, embaixo do fluxo */}
              <section className="estudio-roteiro">
                <h3>{tr("Roteiro, cena a cena", "Scene-by-scene script")}</h3>
                <ol>
                  {(doc.cenas || []).map((c) => (
                    <li key={c.id}>
                      <code>{c.id}</code>{' '}
                      {c.roteiro || <span className="texto-suave">{tr("(sem texto de roteiro)", "(no script text)")}</span>}
                    </li>
                  ))}
                </ol>
                {doc.audio && (doc.audio.trilha_prompt || doc.audio.narracao) && (
                  <p className="texto-suave" style={{ fontSize: 12.5 }}>
                    <Icone nome="audio" tamanho={14} />{' '}
                    {doc.audio.trilha_prompt ? tr("trilha própria da peça", "production’s own soundtrack") : tr("sem trilha", "no soundtrack")}
                    {doc.audio.narracao?.porta_voz
                      ? tr(` · narração com o porta-voz "${doc.audio.narracao.porta_voz}"`, ` · narrated by “${doc.audio.narracao.porta_voz}”`)
                      : ''}
                  </p>
                )}
              </section>
              </details>
            </>
          )}
        </div>

        {/* A navegação antiga ainda pode hospedar sua conversa. Na shell
            unificada, o compositor principal continua sendo o único. */}
        {!aoPerguntar && <aside
          className={`estudio-chat${arrastando ? ' arrastando' : ''}`}
          aria-label={tr("Conversa do Estúdio", "Studio conversation")}
          onDragOver={(e) => {
            e.preventDefault()
            setArrastando(true)
          }}
          onDragLeave={(e) => {
            // relatedTarget: só limpa quando o ponteiro sai do aside DE VERDADE
            // (para um filho, o aro ficava preso ligado ao sair da janela).
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false)
          }}
          onDrop={soltarAnexos}
        >
          <header>
            <strong>{tr("Direção", "Direction")}</strong>
            <p className="texto-suave">
              {tr("A conversa desta produção mora aqui. Descreva a peça, aprove o storyboard, peça o ajuste — o custo vem antes de qualquer gasto. Fotos, logos e referências: anexe pelo 📎, arraste ou cole aqui.", "This production’s conversation lives here. Describe the deliverable, approve the storyboard, or request adjustments. Costs are shown before spending. Attach photos, logos, and references, or drop or paste them here.")}</p>
          </header>
          <div className="estudio-msgs">
            {msgs.length === 0 && !enviando && (
              <p className="texto-suave" style={{ fontSize: 12.5 }}>
                {tr("Ex.: “abertura de 45s para o campeonato, com os 8 campeões — tenho as fotos no acervo”.", "For example: “a 45-second opening for the championship with the 8 champions; their photos are in the asset library”.")}</p>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`estudio-bolha ${m.role === 'user' ? 'minha' : 'ia'}`}>
                <p>{m.conteudo}</p>
                {m.role !== 'user' && m.sugestao_tarefa?.prompt && !aceitas[m.id] && (
                  <div className="estudio-sugestao">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icone nome="ideia" tamanho={14} />
                      <strong>{m.sugestao_tarefa.titulo || tr("Iniciar o trabalho", "Start task")}</strong>
                    </span>
                    <button
                      type="button"
                      className="botao botao-primario botao-pequeno"
                      disabled={iniciando}
                      onClick={() => iniciarSugestao(m)}
                    >
                      {iniciando ? (
                        tr("Começando…", "Starting…")
                      ) : (
                        <>
                          <Icone nome="play" tamanho={15} /> {tr("Sim, iniciar", "Yes, start")}</>
                      )}
                    </button>
                  </div>
                )}
                {m.role !== 'user' && m.sugestao_tarefa?.prompt && aceitas[m.id] && (
                  <p className="texto-suave" role="status" style={{ fontSize: 12 }}>
                    {tr("✓ iniciado — acompanhe no topo", "✓ started — follow progress above")}</p>
                )}
              </div>
            ))}
            {enviando && (
              <div className="estudio-bolha ia" aria-live="polite">
                <p>
                  <span className="cursor-piscando" aria-hidden="true" /> {tr("pensando…", "thinking…")}</p>
              </div>
            )}
            <div ref={fimMsgsRef} />
          </div>
          {anexos.length > 0 && (
            <div className="estudio-anexos" aria-live="polite">
              {anexos.map((a, i) => (
                <span key={i} className={`estudio-anexo-chip ${a.estado}`}>
                  <Icone
                    nome={a.estado === 'enviando' ? 'ampulheta' : a.estado === 'ok' ? 'anexo' : 'alerta'}
                    tamanho={14}
                  />{' '}
                  {a.nome}
                  {a.detalhe ? ` — ${a.detalhe}` : ''}
                </span>
              ))}
            </div>
          )}
          <div className="estudio-composer">
            <input
              ref={anexoInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => anexar(Array.from(e.target.files || []))}
            />
            <button
              type="button"
              className="estudio-anexo-btn"
              style={{ display: 'inline-flex', alignItems: 'center' }}
              title={tr("Anexar arquivos (ou arraste/cole na conversa)", "Attach files (or drop/paste them into the conversation)")}
              aria-label={tr("Anexar arquivos", "Attach files")}
              onClick={() => anexoInputRef.current?.click()}
            >
              <Icone nome="anexo" />
            </button>
            <textarea
              ref={campoRef}
              value={textoChat}
              rows={3}
              placeholder={tr("Descreva a peça, ou peça o próximo passo… (cole arquivos aqui)", "Describe the production or ask for the next step… (paste files here)")}
              onChange={(e) => setTextoChat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  enviar()
                }
              }}
              onPaste={(e) => {
                const arquivos = Array.from(e.clipboardData?.files || [])
                if (arquivos.length) {
                  e.preventDefault()
                  anexar(batizarColados(arquivos))
                }
              }}
            />
            <button
              type="button"
              className="botao botao-primario"
              disabled={enviando || !textoChat.trim()}
              onClick={() => enviar()}
            >
              {enviando ? '…' : <Icone nome="seta-direita" tamanho={16} titulo={tr("Enviar", "Send")} />}
            </button>
          </div>
        </aside>}
      </div>

      {/* O MOLDE aberto: o que ele decide, em linguagem de dono, e o contrato
          completo logo abaixo — "ver" de verdade, não resumo que esconde. */}
      {molde && (
        <div
          className="cff-visor"
          role="dialog"
          aria-label={`Molde ${molde.nome}`}
          onClick={() => setMolde(null)}
        >
          <div className="cff-visor-caixa" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>{tr("Molde ", "Template ")}{molde.dados?.nome || molde.nome}</strong>
              <button type="button" className="botao-texto" onClick={() => setMolde(null)}>
                <Icone nome="fechar" tamanho={15} /> {tr("fechar", "close")}</button>
            </header>
            {molde.erro && <p className="alerta alerta-erro">{molde.erro}</p>}
            {!molde.erro && !molde.dados && <p className="texto-suave">{tr("Abrindo…", "Opening…")}</p>}
            {molde.dados && (
              <div className="estudio-molde">
                <p>
                  {molde.dados.descricao || (
                    <span className="texto-suave">{tr("Este molde não tem descrição.", "This template has no description.")}</span>
                  )}
                </p>
                <p className="texto-suave" style={{ fontSize: 12.5 }}>
                  {tr("É a RECEITA da peça: toda cena nasce com esta grade, esta direção de arte e esta saída — é por isso que as cenas combinam entre si sem você pedir.", "The production recipe: each scene starts with this layout, art direction, and output format. That keeps the scenes consistent.")}</p>
                <details>
                  <summary>{tr("O contrato completo (o que o motor lê)", "Full specification (used by the engine)")}</summary>
                  <pre className="estudio-molde-json">
                    {JSON.stringify(molde.dados, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
