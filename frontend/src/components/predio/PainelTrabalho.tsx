import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, asList, ApiError, baixarArquivo, getSessionIdentity } from '../../lib/api'
import { useIdioma, type Traduzir } from '../../lib/i18n'
import { formatBytes } from '../../lib/format'
import { orientacaoFalha } from '../../lib/falhasTrabalho'
import { Icone } from '../Icone'
import type { Entrega, Job } from '../../lib/types'
import ResultadoEntrega from './ResultadoEntrega'
import SequenciaCarrossel from './SequenciaCarrossel'
import { ordenarArquivosCarrossel } from '../../lib/carrosselEntrega'
import { arquivoInicialEntrega } from '../../lib/arquivoInicialEntrega'
import { wsClient } from '../../lib/ws'
import { OrigemEntrega } from './OrigemEntrega'

/* ------------------------------------------------------------------ */
/* PainelTrabalho — a entrega AO LADO da conversa                      */
/*                                                                     */
/* Por que existe: pedir e receber estavam em abas diferentes. O dono   */
/* pedia na Conversa, ia para Entregas ver o resultado, e para pedir um */
/* ajuste voltava para a Conversa — onde a IA já não sabia de que peça  */
/* ele falava. Com o painel, a conversa é a bancada: o vídeo toca do    */
/* lado, e "ajustar esta" escreve a referência exata no campo.          */
/*                                                                     */
/* O painel segue UM trabalho (o que nasceu desta conversa, ou o que o  */
/* "Pedir ajuste" apontou) — não é uma segunda aba de Entregas.         */
/* ------------------------------------------------------------------ */

/** Status que ainda podem mudar — enquanto um deles, o painel pergunta de novo. */
const EM_VOO = new Set(['queued', 'running'])

const ROTULO_STATUS: Record<string, [string, string]> = {
  queued: ['na fila', 'queued'],
  running: ['trabalhando', 'working'],
  done: ['pronto', 'ready'],
  failed: ['falhou', 'failed'],
  cancelled: ['cancelado', 'cancelled'],
}

/** De quanto em quanto tempo o painel pergunta pelo status (ms).
 *  4s é o compromisso: o dono vê a mudança quase na hora e o servidor não
 *  paga um request por segundo por conversa aberta. */
const INTERVALO_POLL = 4000
const INTERVALO_CONFERENCIA = 10_000
const MAX_CONSULTAS_CONFERENCIA = 30

interface PecaEditorial { id: number; titulo: string }
interface ConferenciaEntrega { estado: string; avisos?: string[]; revisao_automatica?: { estado: string } | null }
export type DevolutivaDoTrabalho = Omit<Entrega, 'caminho_rel'>
interface EntregaDoTrabalho { arquivos: Entrega[]; devolutivas?: DevolutivaDoTrabalho[]; pecas_editoriais?: PecaEditorial[]; qualidade?: ConferenciaEntrega; origem?: string | null }
interface ConfirmacaoAprovacao { aprovadas?: unknown; licao_registrada?: boolean }
interface AprovacaoNoPainel {
  alvo: string
  estado: 'enviando' | 'confirmada' | 'incerta' | 'conferindo'
  ids: number[]
  licaoRegistrada: boolean
  erro: string | null
}

function prioridadeFormato(e: Entrega) {
  return e.nome === 'post.html' ? 0 : e.nome === 'arte.png' ? 1 : e.nome === 'legenda.docx' ? 2 : 3
}

function nomeFormato(e: Entrega, t: Traduzir) {
  if (e.editorial_peca_id) {
    if (e.nome === 'post.html') return t('Ler post', 'Read post')
    if (e.nome === 'arte.png') return t('Arte', 'Artwork')
    if (e.nome === 'legenda.docx') return t('Legenda em Word', 'Caption in Word')
  }
  const rotulo = rotuloCurto(e.nome, t)
  return /\.svg$/i.test(e.nome) ? t(`${rotulo} · editável`, `${rotulo} · editable`) : rotulo
}

/** Prefer known version labels; otherwise identify the file, not its job suffix. */
function rotuloCurto(nome: string, t: Traduzir): string {
  const ext = nome.match(/\.([a-z0-9]+)$/i)?.[1].toUpperCase()
  const sem = nome.replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_ ]job[-_ ]\d+$/i, '')
    .replace(/[-_ ](?:\d{2}[-_ ]\d{2}[-_ ]\d{4}|\d{4}[-_ ]\d{2}[-_ ]\d{2})$/, '')
  // O "como foi feito" é o único nome fixo do contrato de entrega — e cortá-lo
  // nas duas últimas palavras dava "foi feito", que não quer dizer nada.
  if (/^como[-_ ]foi[-_ ]feito$/i.test(sem)) return t('como foi feito', 'how it was made')
  const m = sem.match(/(com|sem)[-_ ](legenda|trilha|musica|música|audio|áudio)/i)
  if (m) {
    const objeto = m[2].toLowerCase()
    const ingles = objeto === 'legenda' ? 'captions' : objeto === 'trilha' ? 'soundtrack' : /m[uú]sica/.test(objeto) ? 'music' : 'audio'
    return t(m[0].replace(/[-_]/g, ' ').toLowerCase(), `${m[1].toLowerCase() === 'com' ? 'with' : 'without'} ${ingles}`)
  }
  const formato = sem.match(/(reel|reels|feed|story|stories|quadrado|vertical)/i)
  if (formato) return formato[0].toLowerCase() === 'quadrado' ? t('quadrado', 'square') : formato[0].toLowerCase()
  // Generated kits often share the date and job suffix across every file.
  // Keep the subject and file format so a PDF, slide deck and post are distinct.
  const partes = sem.split(/[-_ ]+/).filter(Boolean)
  const assunto = partes.slice(0, 3).join(' ').toLowerCase() || nome
  return ext ? `${assunto} · ${ext}` : assunto
}

/**
 * Um arquivo entregue, com o preview do seu tipo.
 *
 * O conteúdo vem por fetch autenticado (um `<video src>` cru levaria 401), e o
 * object URL é revogado ao desmontar — sem isso, cada peça aberta vaza um blob
 * na memória da aba, e esta tela fica aberta o dia inteiro.
 */
function PecaEntregue({
  entrega,
  tituloPost,
  aoAjustar,
  decisoes,
}: {
  entrega: Entrega
  tituloPost?: string
  aoAjustar: (nome: string) => void
  decisoes: ReactNode
}) {
  const { t, idioma } = useIdioma()
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  async function baixar() {
    setBaixando(true)
    setErro(null)
    try {
      await baixarArquivo(`/entregas/${entrega.id}/download`, entrega.nome)
    } catch (e) {
      setErro(e instanceof ApiError ? e.detail : t('Não consegui baixar o arquivo. Tente novamente.', 'Could not download the file. Please try again.'))
    } finally { setBaixando(false) }
  }
  return (
    <li className="painel-peca">
      <div className="painel-peca-topo">
        <strong className="painel-peca-nome" title={entrega.nome}>
          {tituloPost ? nomeFormato(entrega, t) : entrega.nome}
        </strong>
        {['pendente', 'aprovada', 'rejeitada'].includes(entrega.status) && <span className={`status-pill entrega-${entrega.status}`}
          aria-label={t(`Status do arquivo: ${entrega.nome}`, `File status: ${entrega.nome}`)}>
          {entrega.status === 'aprovada' ? t('Aprovado', 'Approved') : entrega.status === 'rejeitada' ? t('Rejeitado', 'Rejected') : t('Para revisar', 'To review')}
        </span>}
        {entrega.tamanho_bytes != null && (
          <span className="texto-suave">{formatBytes(entrega.tamanho_bytes, idioma)}</span>
        )}
      </div>

      {/* O preview único do produto (27/08): imagem/vídeo/áudio E o HTML
          renderizado em iframe sandbox — o window.open(blob) que rodava
          HTML de agente no NOSSO origin morreu aqui (blob herda origin;
          com token no localStorage era XSS de primeira). */}
      <div className="painel-peca-previa"><ResultadoEntrega
        entregaId={entrega.id}
        nome={entrega.nome}
        mime={entrega.mime}
        tamanhoBytes={entrega.tamanho_bytes}
      /></div>

      <footer className="painel-trabalho-decisoes">
        <div className="painel-peca-acoes">
          <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            onClick={() => aoAjustar(entrega.nome)}
            title={t('Escreve a referência desta peça no campo da conversa', 'Adds a reference to this deliverable in the message field')}
          >
            <Icone nome="lapis" tamanho={15} /> {tituloPost ? t('Pedir ajuste neste post', 'Request a change to this post') : t('Pedir ajuste', 'Request adjustment')}
          </button>
          <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            disabled={baixando}
            onClick={() => void baixar()}
          >
            {baixando ? t('Baixando…', 'Downloading…') : /\.docx$/i.test(entrega.nome) ? t('Baixar Word', 'Download Word') : t('Baixar', 'Download')}
          </button>
        </div>
        {erro && <p className="alerta alerta-erro" role="alert">{erro}</p>}
        {decisoes}
      </footer>
    </li>
  )
}

export function OrientacoesEntrega({ entrega }: { entrega: DevolutivaDoTrabalho }) {
  const { t } = useIdioma()
  const [aberta, setAberta] = useState(false)
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState('')
  const trava = useRef(false)
  const vivo = useRef(true)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  async function baixar() {
    if (trava.current) return
    trava.current = true; setBaixando(true); setErro('')
    try { await baixarArquivo(`/entregas/${entrega.id}/download`, entrega.nome) }
    catch (e) {
      if (vivo.current) setErro(e instanceof ApiError ? e.detail : t('Não consegui baixar as orientações. Tente novamente.', 'Could not download the instructions. Please try again.'))
    } finally { trava.current = false; if (vivo.current) setBaixando(false) }
  }
  return <li className="painel-peca">
    <strong className="painel-peca-nome">{entrega.nome}</strong>
    <div className="painel-peca-acoes">
      <button type="button" className="botao botao-fantasma botao-pequeno" aria-expanded={aberta}
        aria-label={aberta ? t(`Fechar orientações: ${entrega.nome}`, `Close instructions: ${entrega.nome}`) : t(`Abrir orientações: ${entrega.nome}`, `Open instructions: ${entrega.nome}`)}
        onClick={() => setAberta(v => !v)}>{aberta ? t('Fechar orientações', 'Close instructions') : t('Abrir orientações', 'Open instructions')}</button>
      <button type="button" className="botao botao-fantasma botao-pequeno" disabled={baixando}
        aria-label={t(`Baixar orientações: ${entrega.nome}`, `Download instructions: ${entrega.nome}`)}
        onClick={() => void baixar()}>{baixando ? t('Baixando…', 'Downloading…') : t('Baixar orientações', 'Download instructions')}</button>
    </div>
    {erro && <p className="alerta alerta-erro" role="alert">{erro}</p>}
    {aberta && <ResultadoEntrega entregaId={entrega.id} nome={entrega.nome} mime={entrega.mime} tamanhoBytes={entrega.tamanho_bytes} />}
  </li>
}
interface PainelTrabalhoProps {
  orgId: number
  slug: string
  jobId: number
  aoAjustar: (texto: string, entregaId: number) => void
  aoFechar: () => void
  aoSairDeVoo?: (job: Job) => void
}

export function PainelTrabalho(props: PainelTrabalhoProps) {
  const [sessao, setSessao] = useState(getSessionIdentity)
  useEffect(() => {
    const atualizar = () => setSessao(getSessionIdentity())
    window.addEventListener('offiz:token-changed', atualizar)
    window.addEventListener('storage', atualizar)
    return () => {
      window.removeEventListener('offiz:token-changed', atualizar)
      window.removeEventListener('storage', atualizar)
    }
  }, [])
  // New work/organization gets its own read state. Never show an old piece
  // or approval while the new request is still loading.
  return <PainelDoTrabalho key={`${props.orgId}:${props.jobId}:${sessao}`} {...props} />
}

function PainelDoTrabalho({
  orgId,
  slug,
  jobId,
  aoAjustar,
  aoFechar,
  aoSairDeVoo,
}: PainelTrabalhoProps) {
  const { t } = useIdioma()
  const [job, setJob] = useState<Job | null>(null)
  const [entregas, setEntregas] = useState<Entrega[] | null>(null)
  const [devolutivas, setDevolutivas] = useState<DevolutivaDoTrabalho[]>([])
  const [pecas, setPecas] = useState<PecaEditorial[]>([])
  const [conferencia, setConferencia] = useState<ConferenciaEntrega | null>(null)
  const [origem, setOrigem] = useState<string | null>(null)
  const [baixandoTudo, setBaixandoTudo] = useState(false)
  /** A peça visível. Nasce na primeira e o dono troca pelas abas. */
  const [abaId, setAbaId] = useState<number | null>(null)
  const escolhaRef = useRef<{ id: number; nome: string } | null>(null)
  const selecaoAusenteRef = useRef(false)
  const previaRef = useRef<HTMLUListElement>(null)
  const recuperarFocoRef = useRef(false)
  const [arquivoIndisponivel, setArquivoIndisponivel] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [erroConsulta, setErroConsulta] = useState<string | null>(null)
  const [revisao, setRevisao] = useState(0)
  const [revisaoEntregas, setRevisaoEntregas] = useState(0)
  const consultasConferencia = useRef(0)
  const painelId = useId()
  const sessao = getSessionIdentity()
  const alvo = `${orgId}:${jobId}:${slug}:${sessao}`
  const alvoAtual = useRef(alvo)
  alvoAtual.current = alvo
  const vivoRef = useRef(true)
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false } }, [])
  const travaAprovacao = useRef<{ alvo: string; tipo: 'enviar' | 'conferir' } | null>(null)
  const versaoConsulta = useRef(0)
  const [aprovacao, setAprovacao] = useState<AprovacaoNoPainel | null>(null)
  const aprovacaoAtual = aprovacao?.alvo === alvo ? aprovacao : null
  const aprovando = aprovacaoAtual?.estado === 'enviando'
  const aprovacaoIncerta = aprovacaoAtual?.estado === 'incerta' || aprovacaoAtual?.estado === 'conferindo'
  // A frase "guarda isso como acerto" só sai se a lição FOI registrada —
  // o backend devolve licao_registrada, e aprovar sem feedback não gera
  // lição nenhuma (23/08/2026: no teste real a frase saía sempre, e o
  // ciclo de aprendizado nunca tinha começado).
  const timer = useRef<number | null>(null)

  // O OK sem trocar de aba: o dono acabou de ver a peça AQUI — mandá-lo à aba
  // Entregas só para clicar "Está bom" era a fricção que o teste real apontou.
  const pendentes = (entregas ?? []).filter((e) => e.status === 'pendente')
  const loteGrande = (entregas?.length ?? 0) > 6
  const temEditorial = entregas?.some(e => e.editorial_peca_id)
  const grupos = temEditorial ? [...new Set(entregas!.map(e => e.editorial_peca_id || null))].map((id, i) => ({
    id, titulo: id ? pecas.find(p => p.id === id)?.titulo || t(`Post ${i + 1}`, `Post ${i + 1}`) : t('Outros arquivos', 'Other files'),
    arquivos: entregas!.filter(e => (e.editorial_peca_id || null) === id).sort((a, b) => prioridadeFormato(a) - prioridadeFormato(b)),
  })) : []
  const selecionada = abaId != null ? entregas?.find(e => e.id === abaId) : undefined
  const grupoIndice = selecionada ? Math.max(0, grupos.findIndex(g => g.id === (selecionada.editorial_peca_id || null))) : -1
  const grupo = grupos[grupoIndice]
  const arquivosVisiveis = ordenarArquivosCarrossel(grupo?.arquivos || entregas || [])
  const seletorCompacto = arquivosVisiveis.length > 6
  useEffect(() => {
    if (!recuperarFocoRef.current || !selecionada) return
    recuperarFocoRef.current = false
    previaRef.current?.focus()
  }, [selecionada])
  function escolherArquivo(id: number) {
    const arquivo = entregas?.find(e => e.id === id)
    if (!arquivo) return
    escolhaRef.current = { id: arquivo.id, nome: arquivo.nome }
    selecaoAusenteRef.current = false
    setArquivoIndisponivel(null); setAbaId(id)
  }
  function escolherGrupo(indice: number) {
    const arquivo = arquivoInicialEntrega(grupos[indice]?.arquivos || [])
    if (arquivo) escolherArquivo(arquivo.id)
  }
  async function baixarTudo() {
    setBaixandoTudo(true); setErro(null)
    try { await baixarArquivo(`/orgs/${orgId}/biblioteca/${jobId}/download`, `trabalho-${jobId}.zip`) }
    catch (e) { setErro(e instanceof ApiError ? e.detail : t('Não consegui baixar os arquivos. Tente novamente.', 'Could not download the files. Please try again.')) }
    finally { setBaixandoTudo(false) }
  }
  async function aprovarTudo() {
    if (!sessao || getSessionIdentity() !== sessao || travaAprovacao.current?.alvo === alvo || aprovacaoIncerta) return
    const tentativa = { alvo, tipo: 'enviar' as const }
    const idsPendentes = new Set(pendentes.map(e => e.id))
    if (!idsPendentes.size) return
    travaAprovacao.current = tentativa
    const atual = () => vivoRef.current && alvoAtual.current === alvo && getSessionIdentity() === sessao && travaAprovacao.current === tentativa
    const naoConfirmada = (detalhe?: string) => {
      setAprovacao({ alvo, estado: 'incerta', ids: [], licaoRegistrada: false, erro: [detalhe, t('A aprovação não foi confirmada. Confira os arquivos antes de tentar outra decisão.', 'Approval was not confirmed. Check the files before making another decision.')].filter(Boolean).join(' ') })
    }
    setAprovacao({ alvo, estado: 'enviando', ids: [], licaoRegistrada: false, erro: null })
    try {
      const r = await api.post<ConfirmacaoAprovacao>(
        `/jobs/${jobId}/entregas/aprovar`, {})
      if (!atual()) return
      const ids = r?.aprovadas
      if (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0 || !idsPendentes.has(id)) || new Set(ids).size !== ids.length) {
        naoConfirmada()
        return
      }
      // Uma leitura iniciada antes do ACK não pode desfazer a decisão recebida.
      // A próxima consulta continua sendo a fonte dos estados atuais.
      versaoConsulta.current += 1
      setEntregas((prev) =>
        prev ? prev.map(e => ids.includes(e.id) && e.status === 'pendente' ? { ...e, status: 'aprovada' } : e) : prev,
      )
      setAprovacao({ alvo, estado: 'confirmada', ids, licaoRegistrada: r.licao_registrada === true, erro: null })
      window.dispatchEvent(new Event('offiz:entregas-mudou'))
    } catch (e) {
      if (atual()) naoConfirmada(e instanceof ApiError ? e.detail : undefined)
    } finally {
      if (travaAprovacao.current === tentativa) travaAprovacao.current = null
    }
  }
  function conferirAprovacao() {
    if (!sessao || getSessionIdentity() !== sessao || !aprovacaoIncerta || travaAprovacao.current?.alvo === alvo) return
    travaAprovacao.current = { alvo, tipo: 'conferir' }
    setAprovacao(prev => prev?.alvo === alvo ? { ...prev, estado: 'conferindo', erro: null } : prev)
    versaoConsulta.current += 1
    setRevisaoEntregas(r => r + 1)
  }

  const emVoo = job ? EM_VOO.has(job.status) || job.finalizando === true : true

  // Status do trabalho: pergunta agora e continua perguntando ENQUANTO ele
  // estiver em voo. Chegando a um status final, o timer morre — painel aberto
  // por horas não pode virar um poll eterno.
  const avisouFimRef = useRef<number | null>(null)
  useEffect(() => {
    let vivo = true
    const sessaoConsulta = getSessionIdentity()
    const perguntar = () => {
      api
        .get<Job>(`/jobs/${jobId}`)
        .then((j) => {
          if (!vivo || getSessionIdentity() !== sessaoConsulta) return
          setJob(j)
          if (EM_VOO.has(j.status) || j.finalizando) {
            timer.current = window.setTimeout(perguntar, INTERVALO_POLL)
          } else if (avisouFimRef.current !== jobId) {
            // Uma vez por trabalho: a conversa recarrega e vê o que o finish
            // escreveu (a devolutiva chega como mensagem DEPOIS do envio).
            avisouFimRef.current = jobId
            aoSairDeVoo?.(j)
          }
        })
        .catch((e) => {
          if (vivo && getSessionIdentity() === sessaoConsulta) setErroConsulta(e instanceof ApiError ? e.detail : t('Não consegui ver o trabalho.', 'Could not load the task.'))
        })
    }
    perguntar()
    return () => {
      vivo = false
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, revisao])

  useEffect(() => {
    const sessaoEventos = getSessionIdentity()
    const atualizar = () => { if (getSessionIdentity() === sessaoEventos) setRevisaoEntregas(r => r + 1) }
    window.addEventListener('offiz:biblioteca-mudou', atualizar)
    window.addEventListener('offiz:entregas-mudou', atualizar)
    // A revisão independente é outro job; o evento do trabalho original
    // sozinho não informa quando seu parecer ficou disponível.
    const off = wsClient.on('job_status', e => {
      if ('org_id' in e && e.org_id === orgId) atualizar()
    })
    return () => {
      off()
      window.removeEventListener('offiz:biblioteca-mudou', atualizar)
      window.removeEventListener('offiz:entregas-mudou', atualizar)
    }
  }, [orgId])

  // As peças: só quando o trabalho SAI de voo (antes disso não há o que mostrar,
  // e a lista de entregas do prédio é uma consulta que não vale por segundo).
  useEffect(() => {
    if (emVoo) return
    let vivo = true
    const sessaoConsulta = getSessionIdentity()
    const recuperacao = travaAprovacao.current?.alvo === alvo && travaAprovacao.current.tipo === 'conferir' ? travaAprovacao.current : null
    const controller = new AbortController()
    let proximaConferencia: number | undefined
    const perguntar = () => {
      const versao = ++versaoConsulta.current
      const atual = () => vivo && getSessionIdentity() === sessaoConsulta && versao === versaoConsulta.current
      return api
      .get<EntregaDoTrabalho>(`/orgs/${orgId}/biblioteca/${jobId}`, controller.signal)
      .then((d) => {
        if (!atual()) return
        const todas = asList<Entrega>(d, 'arquivos')
        setDevolutivas((d.devolutivas || []).filter(e => e.job_id === jobId && e.tipo === 'devolutiva'))
        setPecas(d.pecas_editoriais || [])
        setConferencia(d.qualidade || null)
        setOrigem(d.origem || null)
        // Por id CRESCENTE: é a ordem em que o escritório entregou, e o dono
        // pensa nela ("a primeira é a com legenda"). A listagem do prédio vem
        // do mais novo para o mais antigo, o que aqui invertia as versões.
        const minhas = todas
          // tipo 'interno' = manifesto/raciocínio/laudo: trabalho, não peça —
          // no painel o dono compara VERSÕES da peça, não lê bastidor.
          .filter((e) => e.job_id === jobId && e.tipo !== 'interno' && e.tipo !== 'devolutiva')
          .sort((a, b) => a.id - b.id)
        setEntregas(minhas)
        if (recuperacao && travaAprovacao.current === recuperacao) {
          travaAprovacao.current = null
          setAprovacao(prev => prev?.alvo === alvo ? { ...prev, estado: 'confirmada', erro: null, ids: [] } : prev)
        }
        const escolha = escolhaRef.current
        if (escolha) {
          const atual = minhas.find(e => e.id === escolha.id)
          if (atual) escolhaRef.current = { id: atual.id, nome: atual.nome }
          else {
            escolhaRef.current = null; selecaoAusenteRef.current = true
            setAbaId(null); setArquivoIndisponivel(escolha.nome)
          }
        } else if (!selecaoAusenteRef.current) {
          const preferida = arquivoInicialEntrega(minhas)
          escolhaRef.current = preferida ? { id: preferida.id, nome: preferida.nome } : null
          setAbaId(preferida?.id ?? null)
        }
        if (['em_fila', 'em_revisao'].includes(d.qualidade?.revisao_automatica?.estado || '')
          && consultasConferencia.current < MAX_CONSULTAS_CONFERENCIA) {
          // Uma consulta somente após a resposta anterior: sem sobreposição,
          // execução de trabalho ou reinício do teto a cada evento recebido.
          proximaConferencia = window.setTimeout(() => {
            if (!vivo) return
            consultasConferencia.current += 1
            void perguntar()
          }, INTERVALO_CONFERENCIA)
        }
      })
      .catch((e) => {
        if (!atual()) return
        const mensagem = e instanceof ApiError ? e.detail : t('Não consegui listar as peças.', 'Could not list the deliverables.')
        if (recuperacao && travaAprovacao.current === recuperacao) {
          travaAprovacao.current = null
          setAprovacao(prev => prev?.alvo === alvo ? { ...prev, estado: 'incerta', erro: mensagem } : prev)
        } else setErroConsulta(mensagem)
      })
    }
    void perguntar()
    return () => {
      vivo = false
      controller.abort()
      if (proximaConferencia !== undefined) window.clearTimeout(proximaConferencia)
    }
  }, [emVoo, jobId, orgId, slug, job?.office_slug, revisao, revisaoEntregas, t, alvo])

  const titulo = useMemo(
    () => job?.titulo || (job ? t(`Trabalho nº ${job.id}`, `Task #${job.id}`) : t('Trabalho', 'Task')),
    [job, t],
  )
  const entregaAprovada = !!entregas?.length && entregas.every(e => e.status === 'aprovada')
  const aprovadasAgora = (entregas || []).filter(e => e.status === 'aprovada' && aprovacaoAtual?.ids.includes(e.id))
  const pedindoMaterial = job?.status === 'done' && !job.finalizando && devolutivas.length > 0
  const aguardandoUsuario = job?.status === 'done' && !job.finalizando && (pedindoMaterial || pendentes.length > 0)
  const tituloPainel = !job ? erroConsulta ? t('Entrega', 'Deliverable') : t('Consultando entrega…', 'Loading deliverable…')
    : job.finalizando ? t('Organizando arquivos', 'Organizing files')
    : pedindoMaterial ? t('Precisa de você', 'Needs your input')
    : entregaAprovada ? t('Entrega aprovada', 'Approved deliverable')
    : job?.status === 'done' && pendentes.length > 0 ? t('Entrega para revisar', 'Deliverable to review')
    : job.status === 'queued' ? t('Trabalho na fila', 'Task queued')
    : emVoo ? t('Produção em andamento', 'Work in progress') : t('Entrega', 'Deliverable')
  // A biblioteca é universal, mas sair do painel não muda a área da conversa.
  // O escritório executor do job pode ser diferente (pedido do chat geral).
  const parametrosEntrega = new URLSearchParams({ org: String(orgId), vista: 'biblioteca', trabalho: String(jobId) })
  if (selecionada) parametrosEntrega.set('arquivo', String(selecionada.id))
  if (slug && slug !== 'predio') parametrosEntrega.set('slug', slug)
  const enderecoEntrega = `/app?${parametrosEntrega}`
  const conferenciaEmAndamento = ['em_fila', 'em_revisao'].includes(conferencia?.revisao_automatica?.estado || '')
  const temPendencias = !conferencia || conferencia.estado !== 'conferida' || !!conferencia.avisos?.length || conferenciaEmAndamento
  const exigeRevisaoCompleta = loteGrande || temEditorial || temPendencias || origem === 'newsletter' || origem === 'conhecimento'
  const podeDecidir = job?.status === 'done' && !job.finalizando && pendentes.length > 0 && !aprovacaoIncerta && !erroConsulta
  const revisarForaDoPainel = podeDecidir && exigeRevisaoCompleta
  const decisoesTrabalho = <>
    {revisarForaDoPainel && <a className="botao botao-primario botao-pequeno painel-revisar" href={enderecoEntrega}
      title={grupo?.id ? t(`Revise os arquivos, a legenda e a aprovação do post “${grupo.titulo}”.`, `Review files, caption and approval for the post “${grupo.titulo}”.`) : t('Confira os arquivos e suas pendências antes de aprovar.', 'Review files and their issues before approving.')}>
      <Icone nome="visto" tamanho={15} /> {grupo?.id ? t('Revisar e aprovar este post', 'Review and approve this post') : entregas?.length === 1 ? t('Revisar esta entrega', 'Review this deliverable') : t('Revisar e aprovar as entregas', 'Review and approve deliverables')}
    </a>}
    {/* A revisão completa expõe as pendências e os efeitos da aprovação. */}
    {podeDecidir && !exigeRevisaoCompleta && <div className="conversa-sugestao-acoes">
      <button type="button" className="botao botao-primario botao-pequeno" disabled={aprovando} onClick={aprovarTudo}>
        {aprovando ? t('Aprovando…', 'Approving…') : <><Icone nome="visto" tamanho={15} /> {t('Está bom — aprovar', 'Looks good — approve')}{pendentes.length > 1 ? ` (${pendentes.length})` : ''}</>}
      </button>
    </div>}
    {(entregas?.length ?? 0) > 1 && <button type="button" className="botao botao-fantasma botao-pequeno painel-baixar-tudo" disabled={baixandoTudo} onClick={() => void baixarTudo()}>{baixandoTudo ? t('Baixando…', 'Downloading…') : t('Baixar todos os arquivos', 'Download all files')}</button>}
    {aprovadasAgora.length > 0 && <p className="texto-suave" role="status">
      {!entregaAprovada
        ? t(`✓ ${aprovadasAgora.length} ${aprovadasAgora.length === 1 ? 'arquivo aprovado' : 'arquivos aprovados'}: ${aprovadasAgora.map(e => e.nome).join(', ')}. As decisões dos outros arquivos foram mantidas.`, `✓ ${aprovadasAgora.length} ${aprovadasAgora.length === 1 ? 'file approved' : 'files approved'}: ${aprovadasAgora.map(e => e.nome).join(', ')}. Other file decisions were kept.`)
        : aprovacaoAtual?.licaoRegistrada
        ? t('✓ Aprovado — o escritório guardou isso como acerto.', '✓ Approved — the office saved this as a successful outcome.')
        : t('✓ Aprovado. Você pode deixar um comentário para orientar os próximos trabalhos.', '✓ Approved. You can leave a comment to guide future work.')}
    </p>}
  </>

  return (
    <aside className="painel-trabalho" aria-label={t('A entrega desta conversa', 'This conversation’s deliverable')}>
      <header className="painel-trabalho-topo">
        <div className="painel-trabalho-cabecalho">
          <strong className="painel-trabalho-titulo">{tituloPainel}</strong>
          <small className="painel-trabalho-pedido" title={titulo}>{titulo}</small>
          <div className="painel-trabalho-contexto">
            {job && (
              <span
                className="painel-trabalho-id"
                title={t(`Cite #${job.id} na conversa para falar desta tarefa`, `Mention #${job.id} in the conversation to discuss this task`)}
              >
                #{job.id}
              </span>
            )}
            {job && (
              <span className={`status-pill ${job.finalizando ? 'status-running' : aguardandoUsuario ? 'entrega-pendente' : job.status === 'done' ? 'status-done' : job.status === 'failed' ? 'status-failed' : 'status-queued'}`}>
                {job.finalizando ? t('organizando arquivos', 'organizing files') : pedindoMaterial ? t('precisa de você', 'needs your input')
                  : job.status === 'done' ? entregaAprovada ? t('aprovada', 'approved')
                    : aguardandoUsuario ? t('para revisar', 'to review') : t('concluído', 'completed')
                  : ROTULO_STATUS[job.status] ? t(...ROTULO_STATUS[job.status]) : job.status}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="botao-texto painel-trabalho-voltar"
          onClick={aoFechar}
          aria-label={t('Voltar à conversa', 'Back to conversation')}
          title={t('Fechar o painel (a conversa continua ligada ao trabalho)', 'Close the panel (the conversation stays linked to this task)')}
        >
          <Icone nome="fechar" tamanho={15} />
          <span>{t('Voltar à conversa', 'Back to conversation')}</span>
        </button>
      </header>

      {erro && <p className="alerta alerta-erro" role="alert">{erro}</p>}
      {aprovacaoIncerta && <div className="alerta alerta-erro" role="alert">
        <p>{aprovacaoAtual?.erro || t('Conferindo a aprovação dos arquivos…', 'Checking file approval…')}</p>
        <button type="button" className="botao botao-fantasma botao-pequeno" disabled={aprovacaoAtual?.estado === 'conferindo'} onClick={conferirAprovacao}>
          {aprovacaoAtual?.estado === 'conferindo' ? t('Conferindo…', 'Checking…') : t('Conferir aprovação', 'Check approval')}
        </button>
      </div>}
      {erroConsulta && <div className="alerta alerta-erro" role="alert"><p>{erroConsulta}</p><button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => { setErroConsulta(null); setRevisao((r) => r + 1) }}>{t('Tentar novamente', 'Try again')}</button></div>}

      {!job && !erroConsulta && <p role="status">{t('Consultando o andamento do trabalho…', 'Checking the task’s progress…')}</p>}
      {job && emVoo && !erroConsulta && (
        <p className="painel-trabalho-vivo" aria-live="polite">
          <span className="cursor-piscando" aria-hidden="true" /> {job.finalizando
            ? t('Os arquivos estão sendo organizados. A entrega aparece aqui quando a conclusão for confirmada; não precisa reenviar o pedido.', 'Files are being organized. The deliverable will appear here when completion is confirmed; there is no need to submit the request again.')
            : job.status === 'queued'
            ? t('O pedido está na fila, aguardando o motor. Acompanhe o andamento aqui — pode continuar conversando enquanto isso.', 'The request is queued, waiting for the engine. Follow its progress here — you can keep talking in the meantime.')
            : t('O escritório está trabalhando nisso. As peças aparecem aqui quando ficarem prontas — pode continuar conversando enquanto isso.', 'The office is working on this. Deliverables will appear here when ready — you can keep talking in the meantime.')}
        </p>
      )}

      {!emVoo && job?.status === 'failed' && (
        <div className="texto-suave">
          <p>{orientacaoFalha(job.erro, t)}</p>
          {job.erro && <details><summary>{t('Detalhes técnicos', 'Technical details')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{job.erro}</pre></details>}
        </div>
      )}
      {!emVoo && job?.status === 'cancelled' && <p className="texto-suave">{t('Este trabalho foi cancelado. Você pode conversar sobre os próximos passos.', 'This task was cancelled. You can discuss the next steps in the conversation.')}</p>}

      {pedindoMaterial && <section aria-label={t('Orientações para continuar', 'Instructions to continue')}>
        <p className="painel-conferencia" role="status">{t('O escritório pediu material para continuar. Abra as orientações, envie na conversa o que falta e retome por lá.', 'The office requested material to continue. Open the instructions, send what is missing in the conversation, and resume there.')}</p>
        <ul className="painel-pecas">{devolutivas.map(e => <OrientacoesEntrega key={e.id} entrega={e} />)}</ul>
      </section>}

      {arquivoIndisponivel && <div className="alerta alerta-aviso" role="status">
        <p>{t('O arquivo que você estava vendo não está mais disponível nesta entrega.', 'The file you were viewing is no longer available in this deliverable.')} <strong>{arquivoIndisponivel}</strong></p>
        <button type="button" className="botao botao-fantasma botao-pequeno" disabled={!entregas?.length}
          onClick={() => { const arquivo = arquivoInicialEntrega(entregas || []); if (arquivo) { recuperarFocoRef.current = true; escolherArquivo(arquivo.id) } }}>
          {t('Ver um arquivo disponível', 'View an available file')}
        </button>
      </div>}

      {!emVoo && entregas && entregas.length === 0 && job?.status === 'done' && !pedindoMaterial && !arquivoIndisponivel && (
        <p className="texto-suave">
          {t('Terminou sem gerar arquivo. Diga na conversa o que você esperava receber.', 'The task ended without producing a file. Tell us what you expected to receive in the conversation.')}
        </p>
      )}

      {entregas && entregas.length > 0 && (
        <>
          <div className="painel-entrega-resumo">
            <span className="texto-suave">{temEditorial && `${grupos.filter(g => g.id).length} ${grupos.filter(g => g.id).length === 1 ? t('post', 'post') : t('posts', 'posts')} · `}{entregas.length} {entregas.length === 1 ? t('arquivo', 'file') : t('arquivos', 'files')}</span>
            {selecionada && <a className="botao-texto" href={enderecoEntrega}>{t('Ver entrega completa', 'View full delivery')}</a>}
          </div>
          {/* A origem pertence ao escritório autorizado do trabalho. O slug da
              conversa pode ser "predio"; ele continua valendo para navegação. */}
          {job?.office_slug && <OrigemEntrega key={`${orgId}:${job.office_slug}:${jobId}`} orgId={orgId} slug={job.office_slug} jobId={jobId} />}
          {podeDecidir && temPendencias && <p className="painel-conferencia" role="status">{conferenciaEmAndamento
            ? t('A conferência dos arquivos está em andamento. Você já pode abrir a prévia.', 'File review is in progress. You can already open the preview.')
            : conferencia?.avisos?.length
              ? t('Há pontos a conferir nesta versão. Veja os detalhes na entrega completa.', 'This version has points to check. See the full delivery for details.')
              : t('A conferência desta versão ainda está incompleta.', 'Review of this version is still incomplete.')}</p>}
          {grupos.length > 1 && <div className="painel-seletor-post">
            <label><span className="sr-only">{t('Escolher post', 'Choose post')}</span>
              <select value={grupoIndice < 0 ? '' : grupoIndice} onChange={e => escolherGrupo(Number(e.target.value))}>
                {grupoIndice < 0 && <option value="" disabled>{t('Escolha um post', 'Choose a post')}</option>}
                {grupos.map((g, i) => <option key={g.id ?? 'outros'} value={i}>{i + 1}. {g.titulo}</option>)}
              </select>
            </label>
            <button type="button" className="botao botao-fantasma botao-pequeno" aria-label={t('Post anterior', 'Previous post')} disabled={grupoIndice <= 0} onClick={() => escolherGrupo(grupoIndice - 1)}>‹</button>
            <button type="button" className="botao botao-fantasma botao-pequeno" aria-label={t('Próximo post', 'Next post')} disabled={grupoIndice < 0 || grupoIndice === grupos.length - 1} onClick={() => escolherGrupo(grupoIndice + 1)}>›</button>
          </div>}
          {/* ABAS quando há mais de uma peça. "Com legenda" e "sem legenda" são
              duas versões da MESMA coisa: empilhá-las obrigava o dono a rolar
              para comparar, e comparar é justamente o que ele faz aqui. Uma peça
              só não ganha aba — seria moldura sem quadro. */}
          {seletorCompacto && <label className="painel-seletor-arquivo">
            <span>{t('Arquivo em exibição', 'File on display')}</span>
            <select aria-controls={`${painelId}-pecas`} value={selecionada?.id ?? ''}
              onChange={e => escolherArquivo(Number(e.target.value))}>
              {!selecionada && <option value="" disabled>{t('Escolha um arquivo', 'Choose a file')}</option>}
              {arquivosVisiveis.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </label>}
          {arquivosVisiveis.length > 1 && !seletorCompacto && (
            <div className="painel-abas" role="tablist" aria-label={t('Arquivos desta entrega', 'Files in this delivery')}>
              {arquivosVisiveis.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  role="tab"
                  id={`${painelId}-aba-${e.id}`}
                  aria-controls={`${painelId}-pecas`}
                  aria-selected={e.id === selecionada?.id}
                  tabIndex={e.id === selecionada?.id || (!selecionada && e.id === arquivosVisiveis[0]?.id) ? 0 : -1}
                  className={`painel-aba${e.id === selecionada?.id ? ' ativa' : ''}`}
                  onClick={() => escolherArquivo(e.id)}
                  onKeyDown={(ev) => {
                    const indice = arquivosVisiveis.findIndex((item) => item.id === e.id)
                    const proximo = ev.key === 'ArrowRight' ? (indice + 1) % arquivosVisiveis.length : ev.key === 'ArrowLeft' ? (indice - 1 + arquivosVisiveis.length) % arquivosVisiveis.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? arquivosVisiveis.length - 1 : null
                    if (proximo === null) return
                    ev.preventDefault()
                    escolherArquivo(arquivosVisiveis[proximo].id)
                    document.getElementById(`${painelId}-aba-${arquivosVisiveis[proximo].id}`)?.focus()
                  }}
                  title={e.nome}
                >
                  {nomeFormato(e, t)}
                </button>
              ))}
            </div>
          )}
          {selecionada && <SequenciaCarrossel arquivos={arquivosVisiveis} selecionadaId={selecionada.id} escolher={escolherArquivo} />}
          <ul ref={previaRef} tabIndex={-1} className="painel-pecas" id={`${painelId}-pecas`}
            role={selecionada && arquivosVisiveis.length > 1 ? seletorCompacto ? 'region' : 'tabpanel' : undefined}
            aria-labelledby={selecionada && arquivosVisiveis.length > 1 && !seletorCompacto ? `${painelId}-aba-${selecionada.id}` : undefined}
            aria-label={selecionada && (arquivosVisiveis.length === 1 || seletorCompacto) ? t(`Prévia: ${selecionada.nome}`, `Preview: ${selecionada.nome}`) : undefined}>
            {arquivosVisiveis
              .filter(e => e.id === selecionada?.id)
              .map((e) => (
                <PecaEntregue
                  key={e.id}
                  entrega={e}
                  tituloPost={grupo?.id ? grupo.titulo : undefined}
                  decisoes={decisoesTrabalho}
                  aoAjustar={(nome) => aoAjustar(grupo?.id ? t(`Sobre o post “${grupo.titulo}” (${nome}), quero ajustar: `, `About the post “${grupo.titulo}” (${nome}), I would like to change: `) : t(`Sobre “${nome}”, quero ajustar: `, `About “${nome}”, I would like to change: `), e.id)}
                />
              ))}
          </ul>
        </>
      )}
    </aside>
  )
}
