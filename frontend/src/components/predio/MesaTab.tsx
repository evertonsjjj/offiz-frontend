import { resumoEntregas } from '../../lib/resumoEntregas'
import { transcreverVoz, validarVozNoApp } from '../../lib/voice'
import type { PecaEditorial } from './ConteudoEditorial'
import { useIdioma, type Traduzir, type Idioma } from '../../lib/i18n'
/**
 * 🪑 A MESA do diretor (26/08/2026) — a tela onde o dono DECIDE.
 *
 * Três colunas no computador, uma por vez no celular:
 * - HISTÓRICO à esquerda: as conversas deste andar (no celular vira gaveta);
 * - a CONVERSA no centro: o chat é o lugar do pedido — a IA propõe, o dono
 *   aceita, e o trabalho nasce ancorado à conversa (devolutiva e desfecho
 *   voltam sozinhos para cá, cortesia do finish);
 * - a PEÇA à direita (no celular, folha por cima): o plano declarado da peça
 *   — referência copiei/recusei/acrescentei, origem por cena
 *   (acervo · acervo + IA · gerada), material com legenda, o que falta —
 *   e o PORTÃO: "Pode gerar" só destrava sem pendência vermelha, e a
 *   validação de verdade é a do servidor (POST /gerar responde 409).
 *
 * O que esta tela NUNCA faz: gerar por conta própria, recalcular custo
 * (o custo vem do motor via /mesa) ou publicar qualquer coisa.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react'
import { api, ApiError, asList, baixarArquivo, carregarArquivo, getSessionIdentity } from '../../lib/api'
import { Link } from 'react-router-dom'
import { Icone, type NomeIcone } from '../Icone'
import { ToggleTema } from '../ToggleTema'
import ResultadoEntrega from './ResultadoEntrega'
import ConteudoEditorial from './ConteudoEditorial'
import { ComentariosAbertosMesa } from './ComentariosFluxo'
import { ehBastidor } from './EntregasTab'
import VisorArquivo, { midiaDe, type MidiaVisor } from './VisorArquivo'
import { useToasts } from '../Toasts'
import { useConfirmacao } from '../useConfirmacao'
import { tempoRelativo } from '../../lib/format'
import { useBrasao } from '../../lib/useBrasao'
import { PerfilProposto, type ConfirmacaoPerfil } from './PerfilProposto'
import { ConfigOrgCorpo } from '../../pages/ConfigOrg'
import { AgendaTab } from './AgendaTab'
import type { OfficeInfo } from '../../lib/types'
import { extrasDaMensagem } from '../../lib/types'
import type { Entrega, SugestaoCanon, SugestaoDaConversa, SugestaoTarefa } from '../../lib/types'

/* Mesmo teto da aba Conversar — o endpoint é o mesmo. */
const ANEXO_MAX_MB = 200

type ConvResumo = {
  id: number
  titulo?: string
  total_mensagens?: number
  atualizado_em?: string | null
  fixada?: boolean
  grupo?: string | null
  /** O estado do trabalho ligado à conversa — a cor da bolinha do rail. */
  sinal?: string | null
  /** A frase de estado ('Entregue qui, 9h47') — a bolinha que fala. */
  resumo?: string | null
}

/* Cada cor da bolinha quer dizer UMA coisa — a legenda vira tooltip. */
function BOLINHA_LEGENDA_local(tr: Traduzir): Record<string, string> { return {
  trabalhando: tr("A IA está trabalhando nisto agora","The AI is working on this now"),
  precisa_de_voce: tr("Precisa de você — decisão esperando","Needs you: a decision is waiting"),
  entregue: tr("Trabalho entregue","Task delivered"),
} }

type Msg = {
  id: number
  role: string
  conteudo: string
  sugestao_tarefa?: SugestaoDaConversa | null
  criado_em?: string | null
}

type MaterialMesa = {
  caminho: string
  nome: string
  legenda?: string | null
  existe: boolean
}

type CenaMesa = {
  id: string
  tipo?: string | null
  rotulo: string
  roteiro?: string | null
  dur?: number | null
  travado: boolean
  origem: 'acervo' | 'mix' | 'gerada' | 'codigo' | 'slot'
  nota_origem?: string | null
  material: MaterialMesa[]
  thumb?: string | null
  video?: string | null
  gera: boolean
  custo_usd: number
  entrada_s?: number | null
  saida_s?: number | null
  slot?: boolean
  material_falta?: string | null
  fontes?: string[]
}

type FaltaMesa = {
  item: string
  porque?: string | null
  se_nao_vier?: string | null
  trava: boolean
  resolvido: boolean
}

type MesaPayload = {
  slug: string
  titulo: string
  estado: string
  molde?: string | null
  tem_plano: boolean
  referencia?: {
    fonte?: string
    de_onde?: string
    copiei?: string
    recusei?: string
    acrescentei?: string
  } | null
  cenas: CenaMesa[]
  origem_resumo: Record<string, number>
  dur_total?: number | null
  proporcoes?: string[]
  contagens?: Record<string, number>
  estimativa_min?: number | null
  falta: FaltaMesa[]
  critica?: {
    quando?: string | null
    por?: string | null
    itens: Array<{
      cena?: string | null
      gravidade: 'trava' | 'ajuste' | 'nota'
      achado: string
      correcao?: string | null
      resolvido: boolean
    }>
  } | null
  revisao_automatica?: {
    estado: string
    avisos: string[]
    limites?: string
    arquivos?: Array<{ entrega_id: number; nome: string; estado: string; detalhe: string; evidencias: string[]; limites: string[] }>
    correcao_job_id?: number
  } | null
  custo_pendente: number | null
  custo_consulta_confirmada?: boolean
  custo_pendente_escopo?: string
  custo_total_estimado?: boolean
  custos_fora_fal?: Array<{ etapa: string; custo_usd: number | null; via?: string }>
  etapas_pendentes?: Array<{ etapa: string; custo_usd: number | null; via?: string }>
  aviso_custo_externo?: string
  aviso_custo_consulta?: string
  pendencias?: string[]
  trilha_falta: boolean
  narracao: {
    texto?: string | null
    porta_voz?: string | null
    voz_direta?: boolean
    vozes: Array<{ nome: string; pronta: boolean }>
  }
  pode_gerar: boolean
  travas_abertas: number
  job_ativo?: { id: number; status: string; erro?: string | null } | null
  motor: { modo_org: string }
  orcamento?: { teto_usd?: number; gasto_usd?: number }
}

type PecaResumo = {
  slug: string
  titulo: string
  estado?: string
  cenas?: number
  editada_em?: string | null
  /** itens de falta não resolvidos do plano — o rail soma todos. */
  faltando?: number
}

type ArquivoAcervo = {
  nome: string
  /** Subpasta dentro da pasta ('' = raiz) — as pastas que a IA cria. */
  sub?: string
  tamanho_bytes?: number
  modificado_em?: string | null
  legenda?: string | null
  tags?: string[]
}

/* As pastas do acervo, na língua do dono — a MESMA whitelist do backend. */
function PASTAS_ACERVO_local(tr: Traduzir): Array<{ chave: string; rotulo: string; nota: string }> { return [
  { chave: 'entrada', rotulo: tr("Aguardando a IA","Awaiting AI"), nota: tr("O que você mandou e a IA ainda vai processar — ela descreve e guarda no lugar certo; acompanhe por aqui ou suba direto na pasta certa.","Files you sent that the AI has yet to process. It describes and stores them in the right folder. Follow progress here or upload directly to a folder.") },
  { chave: 'produto', rotulo: tr("Fotos e vídeos","Photos and videos"), nota: tr("Fotos, vídeos e áudios da empresa para usar nos trabalhos.","Your photos, videos, and audio used in productions.") },
  { chave: 'exemplos', rotulo: tr("Referências","References"), nota: tr("Posts de referência — do próprio clube ou de outros times — que definem o padrão que você quer que eu persiga.","Reference posts that set the standard you want me to follow.") },
  { chave: 'marca', rotulo: tr("Marca","Brand"), nota: tr("Escudo, fontes, manual — o que trava a identidade das peças.","Logos, fonts, and guidelines that define your visual identity.") },
  { chave: 'aprovados', rotulo: tr("Aprovados","Approved"), nota: tr("Trabalhos que passaram pelo seu OK — referência do que funciona e pode voltar a ser usado.","Work you approved: examples of what works and can be used again.") },
] }

/* O MIOLO do acervo — as pastas da visão empilhada (o desenho do mockup).
   Referências, Aprovados e Aguardando têm chip próprio no topo. */
const PASTAS_MIOLO = ['produto', 'marca']

const E_IMAGEM = /\.(png|jpe?g|webp|gif|svg)$/i

function ORIGEM_ROTULO_local(tr: Traduzir): Record<CenaMesa['origem'], string> { return {
  acervo: tr("acervo","assets"),
  mix: tr("acervo + IA","assets + AI"),
  gerada: tr("gerada","generated"),
  codigo: tr("código","code"),
  slot: 'slot',
} }

/** '4,3–7,0s' — a faixa de tempo do card, como no mockup. */
function faixaDaCena(c: CenaMesa, idioma: Idioma): string | null {
  if (c.entrada_s == null || c.saida_s == null) return null
  const f = (v: number) => v.toLocaleString(idioma, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${f(c.entrada_s)}–${f(c.saida_s)}s`
}

/** O charme do mockup: 'quarta, 15h35 · semana 35' — vivo, no cabeçalho.
 *  Atualiza a cada meio minuto; a semana é a ISO 8601 (a do calendário
 *  editorial que o produto já usa nas pautas). */
function agoraBonito(d: Date, idioma: Idioma): string {
  const dia = d.toLocaleDateString(idioma, { weekday: 'long' }).split('-')[0]
  const hora = d.toLocaleTimeString(idioma, { hour: '2-digit', minute: '2-digit' })
  const data = d.toLocaleDateString(idioma)
  return `${dia}, ${hora} · ${data}`
}

/** yyyy-mm-dd no fuso LOCAL — toISOString viraria ontem/amanhã na borda do dia. */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** O rótulo de grupo da lista de conversas — Hoje / Esta semana / o mês. */
function grupoDaConversa(iso: string | null | undefined, idioma: Idioma): string {
  const antes = idioma === 'en' ? 'Earlier' : 'Antes'
  if (!iso) return antes
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return antes
  const hoje = new Date()
  if (d.toDateString() === hoje.toDateString()) return idioma === 'en' ? 'Today' : 'Hoje'
  const corte = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 6)
  if (d >= corte) return idioma === 'en' ? 'This week' : 'Esta semana'
  const mes = d.toLocaleDateString(idioma, { month: 'long' })
  const rotulo = mes.charAt(0).toUpperCase() + mes.slice(1)
  return d.getFullYear() === hoje.getFullYear() ? rotulo : `${rotulo} ${d.getFullYear()}`
}

/** O nome de uma subpasta criada pela IA, apresentável: 'porta-vozes' vira
 *  'Porta vozes', '2026-08-classico' fica legível como veio. */
function nomeDaSub(sub: string): string {
  const ultimo = sub.split('/').pop() || sub
  const solto = ultimo.replace(/[_]+/g, ' ').replace(/(^|\s)-|-(\s|$)/g, ' ')
  return solto.charAt(0).toUpperCase() + solto.slice(1)
}

/** O nome da empresa entra capitalizado na tela — o cadastro pode vir todo
 *  minúsculo ('clube aurora') e o cabeçalho não pode herdar o descuido. */
function capitalizar(nome: string): string {
  return nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : nome
}

function eTarefa(s: SugestaoDaConversa | null | undefined): s is SugestaoTarefa {
  return !!s && !(s as { tipo?: string }).tipo && !!(s as SugestaoTarefa).prompt
}

/* Miniatura autenticada: <img src> direto leva 401 — o byte sai pela porta
   da peça (GET /arquivo) via blob, sempre revogado no desmonte. */
function Thumb({ base, caminho }: { base: string; caminho: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    let blob: string | null = null
    carregarArquivo(`${base}/arquivo?caminho=${encodeURIComponent(caminho)}`)
      .then((u) => {
        blob = u
        if (vivo) setUrl(u)
        else URL.revokeObjectURL(u)
      })
      .catch(() => undefined)
    return () => {
      vivo = false
      if (blob) URL.revokeObjectURL(blob)
    }
  }, [base, caminho])
  if (!url) return <div className="mesa-quadro mesa-quadro--vazio" aria-hidden />
  return <img className="mesa-quadro" src={url} alt="" />
}

function ThumbAcervo({
  orgId,
  slug,
  pasta,
  nome,
  sub = '',
}: {
  orgId: number
  slug: string
  pasta: string
  nome: string
  sub?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    let blob: string | null = null
    carregarArquivo(
      `/predios/${orgId}/${slug}/arquivos/${pasta}/${encodeURIComponent(nome)}` +
        (sub ? `?sub=${encodeURIComponent(sub)}` : ''),
    )
      .then((u) => {
        blob = u
        if (vivo) setUrl(u)
        else URL.revokeObjectURL(u)
      })
      .catch(() => undefined)
    return () => {
      vivo = false
      if (blob) URL.revokeObjectURL(blob)
    }
  }, [orgId, slug, pasta, nome, sub])
  if (!url) return <div className="mesa-quadro mesa-quadro--vazio" aria-hidden />
  return <img className="mesa-quadro" src={url} alt="" loading="lazy" />
}


/* ── A gaveta de Entregas agrupa por TRABALHO (08/09/2026) ─────────────────
   Mesma regra de bastidor da vitrine (ehBastidor). A peça PRINCIPAL aqui
   prefere vídeo e imagem ao HTML: na Mesa o dono aprova a ARTE, e a
   "prévia-para-aprovação.html" é uma página que a repete — e uma prévia de
   HTML aberta na gaveta captura a rolagem. Na vitrine antiga o html vem
   antes (post.html é o kit inteiro); aqui ele fica recolhido em "mais
   arquivos". */
const ORDEM_PRINCIPAL_GAVETA = ['mp4', 'webm', 'mov', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'html', 'htm', 'pptx', 'docx', 'xlsx', 'csv']

function prioridadeGaveta(e: Entrega): number {
  const ext = e.nome.split('.').pop()?.toLowerCase() ?? ''
  const i = ORDEM_PRINCIPAL_GAVETA.indexOf(ext)
  return i === -1 ? ORDEM_PRINCIPAL_GAVETA.length : i
}

/** O título em linguagem de dono: uma continuação vira o nome da tarefa + a
 *  etiqueta "continuação do nº N", em vez do cabeçalho técnico do pedido. */
function tituloDaGaveta(bruto: string | null | undefined, principal: Entrega | null, jobId: number, tr: Traduzir): { titulo: string; etiqueta: string | null } {
  const t = (bruto || '').trim()
  const m = /^CONTINUAÇÃO do trabalho nº (\d+)(?:\s*—\s*“(.+?)”)?/.exec(t)
  if (m) {
    return { titulo: m[2] || principal?.nome || tr(`Trabalho nº ${jobId}`, `Task no. ${jobId}`), etiqueta: tr(`continuação do nº ${m[1]}`, `continuation of no. ${m[1]}`) }
  }
  return { titulo: t || principal?.nome || tr(`Trabalho nº ${jobId}`, `Task no. ${jobId}`), etiqueta: null }
}

type TrabalhoGaveta = {
  jobId: number
  titulo: string
  etiqueta: string | null
  criadoEm: string
  principal: Entrega | null
  outros: Entrega[]
  todos: Entrega[]
  total: number
}

function agruparGaveta(lista: Entrega[], tr: Traduzir): TrabalhoGaveta[] {
  const porJob = new Map<number, Entrega[]>()
  for (const e of lista) {
    const atual = porJob.get(e.job_id) ?? []
    atual.push(e)
    porJob.set(e.job_id, atual)
  }
  const saida: TrabalhoGaveta[] = []
  for (const [jobId, todos] of porJob) {
    const finais = todos.filter((e) => !ehBastidor(e)).sort((a, b) => prioridadeGaveta(a) - prioridadeGaveta(b))
    const principal = finais[0] ?? null
    const { titulo, etiqueta } = tituloDaGaveta(todos[0].job_titulo, principal, jobId, tr)
    saida.push({
      jobId,
      titulo,
      etiqueta,
      criadoEm: todos.map((e) => e.criado_em).sort().slice(-1)[0] ?? todos[0].criado_em,
      principal,
      outros: finais.slice(1),
      todos,
      total: finais.length,
    })
  }
  return saida
}

/** O slug da PEÇA quando o trabalho veio da produção por peça (qualquer
 *  arquivo em outputs/pecas/<slug>/) — liga o cartão ao quadro do Estúdio. */
function pecaDoTrabalhoGaveta(entregas: Entrega[]): string | null {
  for (const e of entregas) {
    const m = /^outputs\/pecas\/([^/]+)\//.exec((e.caminho_rel || '').replace(/\\/g, '/'))
    if (m) return m[1]
  }
  return null
}

type MesaProps = Parameters<typeof MesaConteudo>[0]
type AnexoMesa = { id: number; nome: string; estado: string }

export function MesaTab(props: MesaProps) {
  return <MesaConteudo key={`${getSessionIdentity()}:${props.orgId}:${props.slug}`} {...props} />
}

function MesaConteudo({
  orgId,
  slug,
  aoVerEstudio,
  imersa = false,
  orgNome,
  officeNome,
  destinos,
  aoNavegar,
  office,
  painelInicial,
  configHref,
  aoVerFluxo,
  acompanhamento,
  emExecucao = false,
}: {
  orgId: number
  slug: string
  /** Andamento no fio da conversa, sem ocupar o topo da janela. */
  acompanhamento?: ReactNode
  emExecucao?: boolean
  aoVerEstudio?: (pecaSlug: string, jobId?: number) => void
  /** Tela cheia (o shell some): a Mesa hospeda o essencial do chrome. */
  imersa?: boolean
  orgNome?: string
  officeNome?: string
  /** As outras portas do escritório — viram o menu do rodapé, como no mockup. */
  destinos?: Array<{ id: string; rotulo: string; icone: string }>
  aoNavegar?: (id: string) => void
  /** O manifesto do andar — a Agenda embutida usa as sugestões de atividade
   *  dele. Sem ele valem os exemplos genéricos. */
  office?: OfficeInfo | null
  /** Abre a Mesa já com uma gaveta aberta. É por aqui que a notificação
   *  ("entrega pronta") chega ao resultado SEM sair para a shell antiga. */
  painelInicial?: { qual: 'entregas' | 'agenda'; n: number } | null
  /** Sala das máquinas (só owner/admin). */
  configHref?: string
  /** "Como foi feita" de QUALQUER entrega (07/09/2026, pedido do dono: "clicar
   *  nas gerações e ver o que ela usou de conteúdo e o pensamento"): abre o
   *  quadro do trabalho no Estúdio — as fontes com miniatura, o prompt de cada
   *  cena e o raciocínio (fiz / porque / descartei / faltou). A peça de vídeo
   *  vai pelo caminho rico (`aoVerEstudio`, que lê o documento); o resto abre
   *  pelo diário do trabalho. Sem Estúdio no andar, o botão não existe. */
  aoVerFluxo?: (jobId: number) => void
}) {
  const { t: tr, idioma } = useIdioma()
  const sessaoRef = useRef(getSessionIdentity())
  const montadoRef = useRef(true)
  const consultasRef = useRef(new Map<string, AbortController>())
  const telaAtual = useCallback(() => montadoRef.current && getSessionIdentity() === sessaoRef.current, [])
  const consulta = useCallback((chave: string) => {
    consultasRef.current.get(chave)?.abort()
    const controller = new AbortController()
    consultasRef.current.set(chave, controller)
    return controller
  }, [])
  useEffect(() => {
    montadoRef.current = true
    const consultas = consultasRef.current
    return () => { montadoRef.current = false; for (const leitura of consultas.values()) leitura.abort() }
  }, [])
  const ORIGEM_ROTULO = ORIGEM_ROTULO_local(tr)
  const PASTAS_ACERVO = PASTAS_ACERVO_local(tr)
  const BOLINHA_LEGENDA = BOLINHA_LEGENDA_local(tr)
  const [menuMe, setMenuMe] = useState(false)
  const [instante, setInstante] = useState(() => new Date())
  const agora = agoraBonito(instante, idioma)
  const brasao = useBrasao(orgId, slug)

  /* Os painéis do mockup: Acervo e Entregas abrem NA MESA, não no shell. */
  const [painel, setPainel] = useState<'acervo' | 'entregas' | 'dashboard' | 'maquinas' | 'agenda' | null>(null)
  const [acervo, setAcervo] = useState<Record<string, ArquivoAcervo[]> | null>(null)
  const [pastaAtiva, setPastaAtiva] = useState('acervo')
  // Subpasta aberta DENTRO da pasta ativa (null = a pasta inteira, agrupada)
  const [subAtiva, setSubAtiva] = useState<string | null>(null)
  const [filtroTexto, setFiltroTexto] = useState('')
  const [filtroDe, setFiltroDe] = useState('')
  const [filtroAte, setFiltroAte] = useState('')
  const [filtroPeriodo, setFiltroPeriodo] = useState('sempre')
  const [entregas, setEntregas] = useState<Entrega[] | null>(null)
  const [partida, setPartida] = useState<{
    tem_chave: boolean
    motor_local: boolean
    tem_motor: boolean
    sabatina_pendente: boolean
    voz_leitura?: string
    voz_ditado?: string
    sem_saldo?: boolean
  } | null>(null)
  const [dash, setDash] = useState<{
    mes: string
    entreguesNoMes: number
    aprovadasNoMes: number
    aguardando: number
    recusadasNoMes: number
    emVoo: number
    horasGanhas: number
  } | null>(null)
  const uploadPastaRef = useRef<HTMLInputElement | null>(null)

  const { sucesso, falha } = useToasts()
  const baseConv = `/predios/${orgId}/${slug}/conversas`
  const baseJobs = `/predios/${orgId}/${slug}/jobs`
  const baseEstudio = `/predios/${orgId}/${slug}/estudio`
  const { confirmar, solicitarTexto, dialogo } = useConfirmacao(`${sessaoRef.current}:${baseConv}`)
  const escopoMesaRef = useRef(baseConv)
  escopoMesaRef.current = baseConv

  const [conversas, setConversas] = useState<ConvResumo[]>([])
  const [conversaId, setConversaId] = useState<number | null>(null)
  /* Espelho síncrono do conversaId: os callbacks assíncronos (envio, poll)
     precisam saber se o dono TROCOU de conversa durante a espera. */
  const conversaIdRef = useRef<number | null>(null)
  const conversaRevisaoRef = useRef(0)
  const criacaoConversaRef = useRef<{ revisao: number; promise: Promise<number> } | null>(null)
  const envioRef = useRef<number | null>(null)
  const filasUploadsRef = useRef(new Map<number, Promise<void>>())
  const [mensagens, setMensagens] = useState<Msg[]>([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pensando, setPensando] = useState(false)
  const [navAberta, setNavAberta] = useState(false)
  const [navRecolhida, setNavRecolhida] = useState(false)
  // o menu de organizacao do rail: qual conversa, submenus e confirmacoes
  const [menuConv, setMenuConv] = useState<number | null>(null)
  const [renomeando, setRenomeando] = useState<number | null>(null)
  const [tituloDraft, setTituloDraft] = useState('')
  const [grupoAberto, setGrupoAberto] = useState(false)
  const [novoGrupo, setNovoGrupo] = useState<string | null>(null)
  const [apagando, setApagando] = useState<number | null>(null)
  const [verMaisAberto, setVerMaisAberto] = useState<Record<string, boolean>>({})
  const [pecaLarga, setPecaLarga] = useState(false)
  const [pecaLargura, setPecaLargura] = useState<number | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const [anexosPorMsg, setAnexosPorMsg] = useState<Record<number, string[]>>({})
  const [anexos, setAnexos] = useState<AnexoMesa[]>([])
  const proximoAnexoRef = useRef(0)
  const rascunhosRef = useRef(new Map<number | null, { texto: string; anexos: AnexoMesa[] }>())
  rascunhosRef.current.set(conversaId, { texto, anexos })
  const [anexosRemovendo, setAnexosRemovendo] = useState<number[]>([])
  const removendoAnexoRef = useRef(new Set<number>())
  const mutacoesRef = useRef(new Set<string>())
  const [erroConversas, setErroConversas] = useState('')
  const [erroPecas, setErroPecas] = useState('')
  const [erroConversa, setErroConversa] = useState('')
  const [erroAcervo, setErroAcervo] = useState('')
  const [erroEntregas, setErroEntregas] = useState('')
  const [erroMateriais, setErroMateriais] = useState('')

  const [pecas, setPecas] = useState<PecaResumo[]>([])
  /* Slug da peça que a resposta VIVA da IA carteou — o efeito (depois de
     abrirMesa existir) abre o painel dela ao lado e zera. */
  const [pecaPuxada, setPecaPuxada] = useState<string | null>(null)
  /* O último slug PEDIDO ao backend: resposta de abertura anterior que chega
     atrasada não pode pintar o painel por cima da peça que o dono abriu
     depois (o botão Gerar aponta para a peça corrente — pagaria a errada). */
  const pecaPedidaRef = useRef<string | null>(null)
  const [pecaAberta, setPecaAberta] = useState<string | null>(null)
  const [mesaBruta, setMesa] = useState<MesaPayload | null>(null)
  /* O PAYLOAD SÓ VALE PARA A PEÇA ABERTA. O corpo do painel inteiro (título,
     plano, cenas, portão) é pintado daqui, mas o botão Gerar posta em
     `pecaAberta`: enquanto a peça nova carregava, o dono lia o plano da
     ANTERIOR com o dedo no "Pode gerar" e pagava o render da nova. Com o
     chat abrindo peça sozinho isso deixou de exigir um clique dele. Derivar
     (em vez de zerar no abrirMesa) protege todos os usos de uma vez e não
     pisca nas RECARGAS da mesma peça (gerar, poll, narração, cena). */
  const mesa = mesaBruta && mesaBruta.slug === pecaAberta ? mesaBruta : null
  const [cenaAberta, setCenaAberta] = useState<string | null>(null)
  const [trocandoMaterial, setTrocandoMaterial] = useState(false)
  const [acervoOpcoes, setAcervoOpcoes] = useState<Array<{ caminho: string; nome: string }>>([])
  const [gerando, setGerando] = useState(false)
  const producaoRef = useRef(false)
  /* Cartão de tarefa: 'indo' trava o botão, 'feita' o aposenta — a lição
     dos trabalhos duplicados da ConversaTab (cada clique era um job pago). */
  const [acaoMsg, setAcaoMsg] = useState<Record<number, 'indo' | 'feita' | 'dispensada'>>({})

  const fimRef = useRef<HTMLDivElement | null>(null)
  const pollConversa = useRef<number | null>(null)
  const pollJob = useRef<number | null>(null)
  const arquivoRef = useRef<HTMLInputElement | null>(null)
  const campoRef = useRef<HTMLTextAreaElement | null>(null)
  // VOZ (26/08): o dono fala (whisper local do backend transcreve para o
  // campo — ele revisa antes de mandar) e ouve a resposta (speechSynthesis).
  const [gravando, setGravando] = useState(false)
  const [transcrevendo, setTranscrevendo] = useState(false)
  const [segundosVoz, setSegundosVoz] = useState(0)
  const [falando, setFalando] = useState<number | null>(null)
  const gravadorRef = useRef<MediaRecorder | null>(null)
  const vozContextoRef = useRef(0)
  const abrindoVozRef = useRef(false)
  const cancelarVoz = useCallback(() => {
    vozContextoRef.current += 1
    abrindoVozRef.current = false
    const recorder = gravadorRef.current; gravadorRef.current = null
    if (recorder) { recorder.onstop = null; if (recorder.state !== 'inactive') recorder.stop(); recorder.stream.getTracks().forEach(track => track.stop()) }
    setGravando(false); setTranscrevendo(false)
  }, [])
  useEffect(() => () => cancelarVoz(), [cancelarVoz, baseConv])

  const selecionarConversa = useCallback((id: number | null) => {
    cancelarVoz()
    conversaRevisaoRef.current += 1
    consultasRef.current.get('mensagens')?.abort()
    conversaIdRef.current = id
    envioRef.current = null
    setEnviando(false); setPensando(false); setErroConversa('')
    setConversaId(id); setMensagens([]); setAcaoMsg({}); setAnexosPorMsg({})
    const rascunho = rascunhosRef.current.get(id)
    setTexto(rascunho?.texto ?? ''); setAnexos(rascunho?.anexos ?? [])
    setAnexosRemovendo([])
  }, [cancelarVoz])

  /* ---------------- conversas ---------------- */

  const listarConversas = useCallback(async () => {
    const leitura = consulta('conversas')
    try {
      const r = await api.get<{ conversas: ConvResumo[] }>(baseConv, leitura.signal)
      if (!telaAtual() || leitura.signal.aborted) return
      setConversas(asList<ConvResumo>(r, 'conversas'))
      setErroConversas('')
    } catch {
      if (telaAtual() && !leitura.signal.aborted) setErroConversas(tr('Não foi possível carregar as conversas.', 'Could not load conversations.'))
    }
  }, [baseConv, consulta, telaAtual, tr])

  const listarPecas = useCallback(async () => {
    const leitura = consulta('pecas')
    try {
      const r = await api.get<{ pecas: PecaResumo[] }>(`${baseEstudio}/pecas`, leitura.signal)
      if (!telaAtual() || leitura.signal.aborted) return
      setPecas(asList<PecaResumo>(r, 'pecas'))
      setErroPecas('')
    } catch {
      if (telaAtual() && !leitura.signal.aborted) setErroPecas(tr('Não foi possível carregar as produções.', 'Could not load productions.'))
    }
  }, [baseEstudio, consulta, telaAtual, tr])

  useEffect(() => {
    void listarConversas()
    void listarPecas()
  }, [listarConversas, listarPecas])

  // o relógio do cabeçalho — meio minuto é preciso o bastante
  useEffect(() => {
    const t = window.setInterval(() => setInstante(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const carregarMensagens = useCallback(
    async (id: number) => {
      const revisao = conversaRevisaoRef.current
      const leitura = consulta('mensagens')
      let r: { mensagens: Msg[]; tarefas_iniciadas?: number[] }
      try { r = await api.get(`/conversas/${id}`, leitura.signal) }
      catch (e) {
        if (!telaAtual() || leitura.signal.aborted || conversaRevisaoRef.current !== revisao) return null
        throw e
      }
      if (!telaAtual() || leitura.signal.aborted || conversaRevisaoRef.current !== revisao || conversaIdRef.current !== id) return null
      const lista = asList<Msg>(r, 'mensagens')
      setMensagens(lista)
      setErroConversa('')
      // Sugestão já aceita continua morta depois do F5 — sem isso o botão
      // renascia e o clique repetido pagava o mesmo trabalho de novo.
      const feitas = r.tarefas_iniciadas
      if (feitas?.length) {
        setAcaoMsg((a) => {
          const novo = { ...a }
          for (const mid of feitas) if (!novo[mid]) novo[mid] = 'feita'
          return novo
        })
      }
      return lista
    },
    [consulta, telaAtual],
  )

  const pararPollConversa = useCallback(() => {
    if (pollConversa.current) {
      window.clearInterval(pollConversa.current)
      pollConversa.current = null
    }
    setPensando(false)
  }, [])

  const iniciarPollConversa = useCallback(
    (id: number) => {
      pararPollConversa()
      setPensando(true)
      const revisao = conversaRevisaoRef.current
      const atual = () => telaAtual() && conversaRevisaoRef.current === revisao && conversaIdRef.current === id
      const inicio = Date.now()
      pollConversa.current = window.setInterval(async () => {
        // Aba em 2º plano não busca (27/08): o Chrome congela renderer que
        // trabalha escondido — o tick seguinte, já visível, se atualiza.
        if (document.hidden || !atual()) return
        try {
          // A BUSCA VEM ANTES DO TETO. Com o guard de aba escondida, o
          // relógio corre sem ninguém buscar: checar o teto primeiro fazia o
          // primeiro tick visível matar o poll SEM nunca ler a resposta que
          // já estava no banco — o 'Pensando…' sumia e a tela ficava com a
          // pergunta do dono como última mensagem, sem erro nenhum.
          const lista = await carregarMensagens(id)
          if (!atual() || !lista) return
          const ultima = lista[lista.length - 1]
          if (ultima && ultima.role !== 'user') {
            pararPollConversa()
            return
          }
          if (Date.now() - inicio > 150_000) pararPollConversa()
        } catch {
          if (atual()) pararPollConversa()
        }
      }, 3000)
    },
    [carregarMensagens, pararPollConversa, telaAtual],
  )

  const abrirConversa = useCallback(
    async (id: number) => {
      pararPollConversa()
      selecionarConversa(id)
      setNavAberta(false)
      const revisao = conversaRevisaoRef.current
      try {
        const lista = await carregarMensagens(id)
        if (!lista || !telaAtual() || conversaRevisaoRef.current !== revisao) return
        const ultima = lista[lista.length - 1]
        if (ultima && ultima.role === 'user') iniciarPollConversa(id)
      } catch (e) {
        if (!telaAtual() || conversaRevisaoRef.current !== revisao) return
        setErroConversa(tr('Não foi possível carregar esta conversa.', 'Could not load this conversation.'))
        falha(e instanceof ApiError ? e.message : tr("Não deu para abrir a conversa", "Could not open the conversation"))
      }
    },
    [carregarMensagens, iniciarPollConversa, pararPollConversa, selecionarConversa, telaAtual, tr, falha],
  )

  /* Fio de volta das Entregas (27/08): "Continuar nesta conversa" deixa o
     id no localStorage e navega para cá — consumo único. */
  useEffect(() => {
    const id = localStorage.getItem('offiz:abrir-conversa')
    if (id) {
      localStorage.removeItem('offiz:abrir-conversa')
      const n = Number(id)
      if (Number.isFinite(n) && n > 0) void abrirConversa(n)
    }
  }, [abrirConversa])

  const garantirConversa = useCallback(async (): Promise<number> => {
    if (!telaAtual()) throw new ApiError(409, tr('A conversa mudou.', 'The conversation changed.'))
    if (conversaIdRef.current) return conversaIdRef.current
    const revisao = conversaRevisaoRef.current
    if (criacaoConversaRef.current?.revisao === revisao) return criacaoConversaRef.current.promise
    const promise = (async () => {
      const r = await api.post<{ id: number }>(baseConv, {})
      if (!telaAtual() || conversaRevisaoRef.current !== revisao) throw new ApiError(409, tr('A conversa mudou.', 'The conversation changed.'))
      setConversaId(r.id)
      conversaIdRef.current = r.id
      rascunhosRef.current.delete(null)
      void listarConversas()
      return r.id
    })()
    const criacao = { revisao, promise }
    criacaoConversaRef.current = criacao
    try { return await promise } finally { if (criacaoConversaRef.current === criacao) criacaoConversaRef.current = null }
  }, [baseConv, listarConversas, telaAtual, tr])

  const novaConversa = useCallback(() => {
    pararPollConversa()
    selecionarConversa(null)
    setNavAberta(false)
  }, [pararPollConversa, selecionarConversa])

  useEffect(() => () => pararPollConversa(), [pararPollConversa])

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' })
  }, [mensagens.length, pensando])

  useEffect(() => {
    conversaIdRef.current = conversaId
  }, [conversaId])

  /* ---------------- enviar / anexar ---------------- */

  /* O caminho ÚNICO de envio: o composer e os chips de resposta pronta
     desembocam aqui. Separado do `enviar` porque o chip manda o próprio
     texto — um toque É a resposta, sem passar pelo campo. */
  const enviarConteudo = useCallback(async (conteudo: string) => {
    if (!conteudo || envioRef.current !== null || !telaAtual()) return
    const escopoEnvio = escopoMesaRef.current
    const revisao = conversaRevisaoRef.current
    const atual = () => telaAtual() && conversaRevisaoRef.current === revisao && escopoMesaRef.current === escopoEnvio
    envioRef.current = revisao
    setEnviando(true)
    // bolha otimista — devolve o texto ao campo se falhar
    setMensagens((m) => [
      ...m,
      { id: -Date.now(), role: 'user', conteudo, criado_em: new Date().toISOString() },
    ])
    try {
      const id = await garantirConversa()
      await filasUploadsRef.current.get(revisao)
      if (!atual()) return
      setPensando(true)
      const res = await api.post<{ mensagem?: Msg; mensagens_extras?: Msg[] }>(`/conversas/${id}/mensagens`, {
        conteudo,
        ...(window.offizMotor?.chatDeviceId ? { motor_local: window.offizMotor.chatDeviceId } : {}),
      })
      // O DONO PODE TER TROCADO DE CONVERSA durante a espera (a resposta leva
      // dezenas de segundos). Repintar aqui jogaria o fio desta conversa por
      // cima do que ele está lendo — e grudaria os anexos desta na mensagem
      // de lá. O rail e o estúdio ainda se atualizam com o resultado.
      if (!atual()) return
      if (conversaIdRef.current !== id) {
        void listarConversas()
        void listarPecas()
        return
      }
      await carregarMensagens(id).catch(() => {
        if (atual()) setErroConversa(tr('Seu pedido foi enviado, mas não foi possível atualizar a conversa.', 'Your request was sent, but the conversation could not be refreshed.'))
      })
      if (conversaIdRef.current !== id || !atual()) return
      // A leitura do histórico pode chegar antes dos cartões do POST em
      // réplicas/cache. Preserva os adicionais, sem duplicar IDs já lidos.
      const recebidas = [...(res.mensagem ? [res.mensagem] : []), ...(Array.isArray(res.mensagens_extras) ? res.mensagens_extras : [])]
      setMensagens(atuais => {
        const ids = new Set(atuais.map(m => m.id))
        return [...atuais, ...recebidas.filter(m => { if (ids.has(m.id)) return false; ids.add(m.id); return true })]
      })
      setPensando(false)
      // CHAT RICO (27/08): a resposta viva que carteia uma peça PUXA o painel
      // dela pro lado. Só na resposta recém-chegada — reabrir uma conversa
      // antiga não força painel nenhum.
      const pecaViva = extrasDaMensagem(res?.mensagem?.sugestao_tarefa).peca
      if (pecaViva) setPecaPuxada(pecaViva.slug)
      // Os anexos que subiram GRUDAM na mensagem enviada e saem de cima do
      // composer — o chip solto parecia pendência (decisão do dono, 26/08).
      const nomesOk = anexos.filter((a) => a.estado === 'ok').map((a) => a.nome)
      if (nomesOk.length) {
        setMensagens((ms) => {
          const ultimaDoDono = [...ms].reverse().find((m) => m.role === 'user')
          if (ultimaDoDono) {
            setAnexosPorMsg((p) => ({ ...p, [ultimaDoDono.id]: nomesOk }))
          }
          return ms
        })
        setAnexos((a) => a.filter((x) => x.estado !== 'ok'))
      }
      void listarConversas()
      void listarPecas()
    } catch (e) {
      if (!atual()) return
      setPensando(false)
      setMensagens((m) => m.filter((x) => x.id > 0))
      // Devolve o texto ao campo SEM atropelar o que já estiver lá: no
      // caminho do composer o campo está vazio (o enviar limpou), mas um
      // envio por CHIP não toca no rascunho — jogar o texto do chip por cima
      // dele apagaria o que a pessoa escreveu.
      setTexto((atual) => (atual.trim() ? atual : conteudo))
      falha(e instanceof ApiError ? e.message : tr("A mensagem não foi", "The message was not sent"))
    } finally {
      if (atual() && envioRef.current === revisao) { envioRef.current = null; setEnviando(false) }
    }
  }, [anexos, carregarMensagens, garantirConversa, listarConversas, listarPecas, telaAtual, tr, falha])

  const enviar = useCallback(async () => {
    const conteudo = texto.trim()
    if (!conteudo || enviando) return
    setTexto('')
    await enviarConteudo(conteudo)
  }, [texto, enviando, enviarConteudo])

  const gravarVoz = useCallback(async () => {
    if (gravando) {
      gravadorRef.current?.stop()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      falha(tr("Este navegador não deixa gravar áudio — tente pelo Chrome.", "This browser cannot record audio. Please try Chrome."))
      return
    }
    if (abrindoVozRef.current || transcrevendo) return
    abrindoVozRef.current = true
    const contexto = vozContextoRef.current
    const atual = () => telaAtual() && vozContextoRef.current === contexto
    let trilha: MediaStream | null = null
    try {
      validarVozNoApp()
      trilha = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!atual()) { trilha.getTracks().forEach(track => track.stop()); return }
      const stream = trilha
      const gravador = new MediaRecorder(stream)
      gravadorRef.current = gravador
      const pedacos: Blob[] = []
      gravador.ondataavailable = (ev) => {
        if (ev.data.size > 0) pedacos.push(ev.data)
      }
      gravador.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (gravadorRef.current === gravador) gravadorRef.current = null
        if (!atual()) return
        setGravando(false)
        const blob = new Blob(pedacos, {
          type: gravador.mimeType || 'audio/webm',
        })
        if (blob.size < 1200) return // toque sem querer
        setTranscrevendo(true)
        try {
          const texto = await transcreverVoz(blob, garantirConversa, atual)
          if (!atual()) return
          if (!texto) {
            falha(tr("Não entendi o áudio — tente mais perto do microfone.", "I could not understand the audio. Try moving closer to the microphone."))
            return
          }
          setTexto((atual) => (atual ? `${atual.trim()} ${texto}` : texto))
        } catch (e) {
          if (atual()) falha(e instanceof Error ? e.message : tr("Não consegui transcrever agora.", "I could not transcribe the audio right now."))
        } finally {
          if (atual()) setTranscrevendo(false)
        }
      }
      gravador.start()
      setGravando(true)
      setSegundosVoz(0)
    } catch {
      trilha?.getTracks().forEach(track => track.stop())
      if (atual()) falha(tr("Não consegui usar o microfone — autorize o acesso no navegador.", "I could not use the microphone. Allow access in your browser."))
    } finally { if (atual()) abrindoVozRef.current = false }
  }, [gravando, transcrevendo, garantirConversa, falha, telaAtual, tr])

  // cronômetro + teto de 2 min (áudio longo some no limite do servidor)
  useEffect(() => {
    if (!gravando) return
    const t = window.setInterval(() => {
      setSegundosVoz((s) => {
        if (s + 1 >= 120) gravadorRef.current?.stop()
        return s + 1
      })
    }, 1000)
    return () => window.clearInterval(t)
  }, [gravando])

  /* Leitura em voz alta — observações de compatibilidade: o Windows QUANTIZA o rate em degraus (0.80-1.29 → 124wpm),
     então 1.05 é a marcha neutra e mexer por porcentagem é no-op; a voz
     pt-BR se escolhe por prefixo do lang. Web Speech: grátis, local,
     latência ~zero — o certo para ler chat (narração de peça é ElevenLabs). */
  const lerMensagem = useCallback(
    (m: Msg) => {
      if (typeof window.speechSynthesis === 'undefined') {
        falha(tr("Este navegador não tem leitura em voz alta.", "This browser does not support reading aloud."))
        return
      }
      if (falando === m.id) {
        window.speechSynthesis.cancel()
        setFalando(null)
        return
      }
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(m.conteudo)
      const voz = window.speechSynthesis.getVoices().find((v) => /^pt/i.test(v.lang))
      if (voz) {
        u.voice = voz
        u.lang = voz.lang
      } else u.lang = 'pt-BR'
      u.rate = 1.05
      u.onend = () => setFalando(null)
      u.onerror = () => setFalando(null)
      setFalando(m.id)
      window.speechSynthesis.speak(u)
    },
    [falando, falha],
  )

  // trocou de conversa / saiu da tela: a voz para junto
  const ultimaFaladaRef = useRef<number | null>(null)
  useEffect(() => {
    ultimaFaladaRef.current = null
    return () => window.speechSynthesis?.cancel()
  }, [conversaId])

  // modo 'sempre': cada resposta NOVA é lida sozinha — o histórico, nunca
  // (a primeira carga só marca de onde começa o novo).
  useEffect(() => {
    if ((partida?.voz_leitura ?? 'desligada') !== 'sempre') return
    const ult = mensagens[mensagens.length - 1]
    if (!ult || ult.role === 'user') return
    if (ultimaFaladaRef.current === null) {
      ultimaFaladaRef.current = ult.id
      return
    }
    if (ult.id <= ultimaFaladaRef.current) return
    ultimaFaladaRef.current = ult.id
    lerMensagem(ult)
  }, [mensagens, partida, lerMensagem])

  const fecharMenuConv = useCallback(() => {
    setMenuConv(null)
    setGrupoAberto(false)
    setNovoGrupo(null)
    setApagando(null)
  }, [])

  const editarConversa = useCallback(
    async (id: number, corpo: { titulo?: string; fixada?: boolean; grupo?: string }) => {
      if (!telaAtual()) return
      try {
        await api.patch(`/conversas/${id}`, corpo)
        if (!telaAtual()) return
        await listarConversas()
      } catch (e) {
        if (!telaAtual()) return
        falha(e instanceof ApiError ? e.message : tr("Não deu para salvar", "Could not save"))
      }
    },
    [listarConversas, falha, telaAtual, tr],
  )

  const apagarConversa = useCallback(
    async (id: number) => {
      /* PERGUNTA ANTES, porque não há volta: o backend faz `db.delete` com
         cascade nas mensagens — não existe lixeira nem desfazer. O controle
         mora na lista de conversas e aparece ao passar o mouse, então um
         clique errado apagava a conversa inteira em silêncio. Aconteceu em
         30/08/2026, e o que se perdeu foi o histórico de um pedido; a peça e o
         rastro sobreviveram porque vivem em Entregas. Destruição de dado do
         dono não pode ser um clique. */
      const alvo = conversas.find((c) => c.id === id)
      const nome = (alvo?.titulo || '').trim()
      const chave = `conversa:${id}`
      if (mutacoesRef.current.has(chave) || !telaAtual()) return
      const aceito = await confirmar({
        titulo: tr('Apagar conversa', 'Delete conversation'), acao: tr('Apagar conversa', 'Delete conversation'),
        mensagem: nome
            ? tr(`Apagar a conversa “${nome}”? As mensagens dela somem para sempre — não há como desfazer. As entregas e o histórico dos trabalhos NÃO são apagados.`, `Delete the conversation “${nome}”? Its messages will be permanently removed. Deliverables and task history will be kept.`)
            : tr("Apagar esta conversa? As mensagens somem para sempre — não há como desfazer. As entregas e o histórico dos trabalhos NÃO são apagados.", "Delete this conversation? Messages will be permanently removed. Deliverables and task history will be kept."),
      })
      if (!aceito || !telaAtual() || mutacoesRef.current.has(chave)) return
      mutacoesRef.current.add(chave)
      try {
        if (conversaIdRef.current === id) cancelarVoz()
        await api.del(`/conversas/${id}`)
        if (!telaAtual()) return
        rascunhosRef.current.delete(id)
        if (conversaIdRef.current === id) { pararPollConversa(); selecionarConversa(null) }
        await listarConversas()
        if (telaAtual()) sucesso(tr("Conversa apagada", "Conversation deleted"))
      } catch (e) {
        if (!telaAtual()) return
        falha(e instanceof ApiError ? e.message : tr("Não deu para apagar", "Could not delete"))
      } finally { mutacoesRef.current.delete(chave) }
    },
    [conversas, listarConversas, sucesso, falha, cancelarVoz, confirmar, pararPollConversa, selecionarConversa, telaAtual, tr],
  )

  /* O rail organizado: Fixadas, depois os grupos da dona (A→Z), depois o
     sem-grupo — onde toda conversa nasce até alguém organizá-la. */
  const rail = useMemo(() => {
    const fixadas = conversas.filter((c) => c.fixada)
    const soltas = conversas.filter((c) => !c.fixada && !c.grupo)
    const porGrupo = new Map<string, ConvResumo[]>()
    for (const c of conversas) {
      if (c.fixada || !c.grupo) continue
      const lista = porGrupo.get(c.grupo) || []
      lista.push(c)
      porGrupo.set(c.grupo, lista)
    }
    const grupos = [...porGrupo.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
    return { fixadas, soltas, grupos, nomes: grupos.map(([g]) => g) }
  }, [conversas])

  /* O VISOR da fonte (27/08 — 'clicar no nilton-01.jpg'): o gesto do
     editor antigo, agora no painel da Mesa. Blob autenticado; quem abre,
     revoga ao fechar. */
  const [visorFonte, setVisorFonte] = useState<{
    titulo: string
    caminho: string
    midia: MidiaVisor
    url: string | null
    erro: string | null
  } | null>(null)
  // A URL viva mora num ref: trocar de fonte, fechar no meio do fetch e
  // desmontar revogam SEMPRE — os três vazamentos da revisão de 27/08.
  const visorUrlRef = useRef<string | null>(null)
  const visorPedidoRef = useRef(0)
  const abrirFonte = useCallback(
    async (slug: string, rel: string) => {
      const pedido = ++visorPedidoRef.current
      if (visorUrlRef.current) {
        URL.revokeObjectURL(visorUrlRef.current)
        visorUrlRef.current = null
      }
      const nome = rel.split('/').pop() || rel
      setVisorFonte({ titulo: nome, caminho: rel, midia: midiaDe(nome), url: null, erro: null })
      try {
        const url = await carregarArquivo(
          `${baseEstudio}/pecas/${slug}/arquivo?caminho=${encodeURIComponent(rel)}`,
        )
        if (pedido !== visorPedidoRef.current) {
          URL.revokeObjectURL(url)
          return
        }
        visorUrlRef.current = url
        setVisorFonte((v) => (v && v.caminho === rel ? { ...v, url } : v))
      } catch (e) {
        if (pedido !== visorPedidoRef.current) return
        setVisorFonte((v) =>
          v && v.caminho === rel
            ? { ...v, erro: e instanceof ApiError ? e.message : tr("Não consegui abrir este arquivo", "Could not open this file") }
            : v,
        )
      }
    },
    [baseEstudio],
  )
  const fecharVisorFonte = useCallback(() => {
    visorPedidoRef.current += 1
    if (visorUrlRef.current) {
      URL.revokeObjectURL(visorUrlRef.current)
      visorUrlRef.current = null
    }
    setVisorFonte(null)
  }, [])
  useEffect(
    () => () => {
      if (visorUrlRef.current) URL.revokeObjectURL(visorUrlRef.current)
    },
    [],
  )

  /* Narração como CONTROLE (27/08): ligar/desligar/trocar voz grava no
     documento pela rota nova — sem passar pelo chat. */
  const [narrSalvando, setNarrSalvando] = useState(false)
  const narracaoRef = useRef(false)
  const cenaAbertaRef = useRef(cenaAberta)
  cenaAbertaRef.current = cenaAberta

  const carregarAcervo = useCallback(async () => {
    const leitura = consulta('acervo')
    try {
      const r = await api.get<Record<string, ArquivoAcervo[]>>(`/predios/${orgId}/${slug}/arquivos`, leitura.signal)
      if (!telaAtual() || leitura.signal.aborted) return
      setAcervo(r); setErroAcervo('')
    } catch (e) {
      if (!telaAtual() || leitura.signal.aborted) return
      setErroAcervo(tr('Não foi possível carregar o acervo.', 'Could not load the asset library.'))
      throw e
    }
  }, [orgId, slug, consulta, telaAtual, tr])

  // os números do rodapé do histórico ('N arquivos · N a organizar')
  useEffect(() => {
    void carregarAcervo().catch(() => {})
  }, [carregarAcervo])

  /* Enquanto alguma conversa está 'trabalhando', o rail se atualiza sozinho;
     quando a bolinha vira (terminou/precisa de você), acervo e peças são
     recarregados — o contador 'a organizar' cai SEM F5 (pedido de 26/08). */
  const sinaisAntes = useRef<Record<number, string | null>>({})
  useEffect(() => {
    const antes = sinaisAntes.current
    const agora: Record<number, string | null> = {}
    let virou = false
    for (const c of conversas) {
      agora[c.id] = c.sinal ?? null
      if (antes[c.id] === 'trabalhando' && agora[c.id] !== 'trabalhando') virou = true
    }
    sinaisAntes.current = agora
    if (virou) {
      void carregarAcervo().catch(() => {})
      void listarPecas()
      // o desfecho que o finish postou entra no thread sem F5
      if (conversaId) void carregarMensagens(conversaId).catch(() => {})
    }
    if (!conversas.some((c) => c.sinal === 'trabalhando')) return
    const t = window.setInterval(() => {
      // Aba escondida não busca (27/08 — guard de Page Visibility).
      if (!document.hidden) void listarConversas()
    }, 5000)
    return () => window.clearInterval(t)
  }, [conversas, conversaId, carregarAcervo, carregarMensagens, listarConversas, listarPecas])

  // o caminho de partida: (1) motor — chave ou Desktop; (2) sabatina.
  // Re-checa sempre que um painel fecha: o dono grava a chave na Sala das
  // máquinas ali do lado e o cartão tem que virar SOZINHO, sem F5.
  useEffect(() => {
    if (painel !== null) return
    let vivo = true
    let timer = 0
    const busca = async () => {
      try {
        const p = await api.get<{
          tem_chave: boolean
          motor_local: boolean
          tem_motor: boolean
          sabatina_pendente: boolean
          voz_leitura?: string
          voz_ditado?: string
          sem_saldo?: boolean
        }>(`/predios/${orgId}/${slug}/partida`)
        if (!vivo) return
        setPartida(p)
        // Caminho concluído (motor + sabatina): o vigia se aposenta.
        if (p.tem_motor && !p.sabatina_pendente && !p.sem_saldo && timer) {
          window.clearInterval(timer)
          timer = 0
        }
      } catch {
        if (vivo) setPartida(null)
      }
    }
    void busca()
    // Vigia de 10s: a chave gravada no painel ao lado (ou o Desktop pareado)
    // vira o cartão SOZINHO — sem F5, sem depender de fechar na ordem certa.
    timer = window.setInterval(() => {
      if (!document.hidden) void busca()
    }, 10_000)
    return () => {
      vivo = false
      if (timer) window.clearInterval(timer)
    }
  }, [orgId, slug, painel])

  const contagemAcervo = useMemo(() => {
    if (!acervo) return null
    const conta = (pasta: string) =>
      (acervo[pasta] || []).filter((a) => !/^brasao\./i.test(a.nome)).length
    const aOrganizar = conta('entrada')
    const referencias = conta('exemplos')
    const aprovados = conta('aprovados')
    const total = PASTAS_ACERVO.reduce((n, p) => n + conta(p.chave), 0)
    return {
      total,
      aOrganizar,
      referencias,
      aprovados,
      miolo: total - aOrganizar - referencias - aprovados,
    }
  }, [acervo])

  // Entrar não inicia uma entrevista nem consome IA. A preparação pode ser
  // feita pelo consultor; o usuário começa pelo pedido ou escolhe completar o perfil.

  // o composer cresce com o texto e volta ao mínimo quando esvazia.
  // Recalcula também quando o LAYOUT muda (painel abre, peça abre, nav
  // recolhe, janela redimensiona): a coluna estreita, o texto REQUEBRA e a
  // altura antiga fica pequena com scroll — o defeito das setinhas.
  useEffect(() => {
    const ajusta = () => {
      const el = campoRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    }
    ajusta()
    window.addEventListener('resize', ajusta)
    return () => window.removeEventListener('resize', ajusta)
  }, [texto, painel, pecaAberta, navRecolhida])

  // o divisor do painel direito — arrastar redimensiona, duplo clique alterna
  const arrastoRef = useRef<(() => void) | null>(null)
  useEffect(() => () => arrastoRef.current?.(), [])
  const iniciarArrasto = useCallback((e: { preventDefault(): void }) => {
    e.preventDefault()
    arrastoRef.current?.()
    const cursorAntes = document.body.style.cursor
    const selecaoAntes = document.body.style.userSelect
    const mover = (ev: MouseEvent) => {
      const w = Math.min(
        Math.max(window.innerWidth - ev.clientX, 320),
        Math.round(window.innerWidth * 0.72),
      )
      setPecaLargura(w)
    }
    const soltar = () => {
      window.removeEventListener('mousemove', mover)
      window.removeEventListener('mouseup', soltar)
      document.body.style.cursor = cursorAntes
      document.body.style.userSelect = selecaoAntes
      arrastoRef.current = null
    }
    arrastoRef.current = soltar
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', mover)
    window.addEventListener('mouseup', soltar)
  }, [])

  const executarSubida = useCallback(
    async (arquivos: FileList | File[]) => {
      const revisao = conversaRevisaoRef.current
      const atual = () => telaAtual() && conversaRevisaoRef.current === revisao
      const lista = Array.from(arquivos)
      if (!lista.length) return
      const grandes = lista.filter((f) => f.size > ANEXO_MAX_MB * 1024 * 1024)
      if (grandes.length) {
        falha(tr(`Arquivo acima de ${ANEXO_MAX_MB} MB: ${grandes[0].name}`, `File exceeds ${ANEXO_MAX_MB} MB: ${grandes[0].name}`))
        return
      }
      let id: number
      try {
        id = await garantirConversa()
      } catch (e) {
        if (!atual()) return
        falha(e instanceof ApiError ? e.message : tr("Não deu para abrir a conversa", "Could not open the conversation"))
        return
      }
      // UM por request e SEQUENCIAL — o contexto da conversa é
      // read-modify-write no servidor; paralelo sobrescreve a lista.
      for (const f of lista) {
        if (!atual() || conversaIdRef.current !== id) return
        const chave = ++proximoAnexoRef.current
        setAnexos((a) => [...a, { id: chave, nome: f.name, estado: 'enviando' }])
        const registrarEstado = (estado: string) => {
          if (!telaAtual()) return
          if (conversaIdRef.current === id) setAnexos(a => a.map(x => x.id === chave ? { ...x, estado } : x))
          else {
            const rascunho = rascunhosRef.current.get(id)
            if (rascunho) rascunhosRef.current.set(id, { ...rascunho, anexos: rascunho.anexos.map(x => x.id === chave ? { ...x, estado } : x) })
          }
        }
        try {
          const form = new FormData()
          form.append('arquivo', f)
          await api.postForm(`/conversas/${id}/anexos`, form)
          registrarEstado('ok')
          if (!atual() || conversaIdRef.current !== id) return
        } catch (e) {
          registrarEstado('erro')
          if (!atual() || conversaIdRef.current !== id) return
          falha(e instanceof ApiError ? e.message : `Falhou: ${f.name}`)
        }
      }
      if (!atual() || conversaIdRef.current !== id) return
      void carregarMensagens(id).catch(() => { if (atual()) setErroConversa(tr('Não foi possível atualizar a conversa.', 'Could not refresh the conversation.')) })
      // anexo da conversa cai em entrada/ — com o painel do acervo aberto,
      // o arquivo aparece chegando NA HORA
      if (painel === 'acervo') void carregarAcervo().catch(() => {})
    },
    [carregarMensagens, garantirConversa, painel, carregarAcervo, telaAtual, tr, falha],
  )

  const subirArquivos = useCallback((arquivos: FileList | File[]) => {
    const revisao = conversaRevisaoRef.current
    const lista = Array.from(arquivos)
    const executar = async () => { if (telaAtual() && conversaRevisaoRef.current === revisao) await executarSubida(lista) }
    const promise = (filasUploadsRef.current.get(revisao) ?? Promise.resolve()).then(executar)
    filasUploadsRef.current.set(revisao, promise)
    const limpar = () => { if (filasUploadsRef.current.get(revisao) === promise) filasUploadsRef.current.delete(revisao) }
    void promise.then(limpar, limpar)
    return promise
  }, [executarSubida, telaAtual])

  const removerAnexo = useCallback(async (anexo: AnexoMesa) => {
    if (removendoAnexoRef.current.has(anexo.id) || !telaAtual()) return
    if (anexo.estado !== 'ok') { setAnexos(lista => lista.filter(item => item.id !== anexo.id)); return }
    const id = conversaIdRef.current
    if (!id) return
    const revisao = conversaRevisaoRef.current
    const atual = () => telaAtual() && conversaRevisaoRef.current === revisao && conversaIdRef.current === id
    removendoAnexoRef.current.add(anexo.id); setAnexosRemovendo(lista => [...lista, anexo.id])
    try {
      await api.del(`/conversas/${id}/anexos/${encodeURIComponent(anexo.nome)}`)
      if (!atual()) return
      setAnexos(lista => lista.filter(item => item.nome !== anexo.nome))
      void carregarAcervo().catch(() => {})
    } catch {
      if (atual()) falha(tr('Não deu para remover do servidor', 'Could not remove this from the server'))
    } finally {
      removendoAnexoRef.current.delete(anexo.id)
      if (atual()) setAnexosRemovendo(lista => lista.filter(item => item !== anexo.id))
    }
  }, [carregarAcervo, telaAtual, falha, tr])

  const aoSoltar = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setArrastando(false)
      if (e.dataTransfer?.files?.length) void subirArquivos(e.dataTransfer.files)
    },
    [subirArquivos],
  )

  /* ---------------- tarefa sugerida → job ---------------- */

  const aceitarTarefa = useCallback(
    async (s: SugestaoTarefa, msgId: number) => {
      const chave = `acao:${msgId}`
      if (acaoMsg[msgId] || mutacoesRef.current.has(chave) || !telaAtual()) return
      const revisao = conversaRevisaoRef.current
      const atual = () => telaAtual() && conversaRevisaoRef.current === revisao
      mutacoesRef.current.add(chave)
      setAcaoMsg((a) => ({ ...a, [msgId]: 'indo' }))
      try {
        const id = conversaId
        const job = await api.post<{ id: number }>(baseJobs, {
          prompt: s.prompt,
          effort: 'high',
          conversa_id: id ?? undefined,
          sugestao_mensagem_id: msgId,
        })
        if (!telaAtual()) return
        if (id) {
          // best-effort: o fio do trabalho sobrevive ao F5
          api
            .put(`/conversas/${id}/trabalho`, { job_id: job.id, msg_id: msgId })
            .catch(() => undefined)
        }
        if (!atual()) return
        setAcaoMsg((a) => ({ ...a, [msgId]: 'feita' }))
        sucesso(tr("Trabalho iniciado — o desfecho volta nesta conversa", "Task started. The outcome will appear in this conversation"))
      } catch (e) {
        if (!atual()) return
        setAcaoMsg((a) => {
          const { [msgId]: _fora, ...resto } = a
          return resto
        })
        falha(e instanceof ApiError ? e.message : tr("Não deu para iniciar", "Could not start"))
      } finally { mutacoesRef.current.delete(chave) }
    },
    [acaoMsg, baseJobs, conversaId, sucesso, falha, telaAtual, tr],
  )

  /* MARCAR NA AGENDA PELA MESA (27/08). A Mesa é tela cheia e o rodapé dela
     só leva a Dashboard e Entregas — sem este botão, "posta essa peça
     quinta" (o caso que a agenda de dia marcado veio atender) não tinha como
     ser confirmado na tela onde o dono está. Mesma permissão da aba Agenda:
     o POST vai com o token dele e devolve 403 a quem não é dono/admin. */
  const aceitarAgendamento = useCallback(
    async (
      s: {
        titulo: string
        prompt: string
        recorrencia: string
        dia: number
        hora: string
        data?: string | null
        peca_slug?: string | null
      },
      msgId: number,
    ) => {
      const chave = `acao:${msgId}`
      if (acaoMsg[msgId] || mutacoesRef.current.has(chave) || !telaAtual()) return
      const revisao = conversaRevisaoRef.current
      const atual = () => telaAtual() && conversaRevisaoRef.current === revisao
      mutacoesRef.current.add(chave)
      setAcaoMsg((a) => ({ ...a, [msgId]: 'indo' }))
      try {
        await api.post(`/predios/${orgId}/${slug}/agenda`, {
          titulo: s.titulo,
          prompt: s.prompt,
          recorrencia: s.recorrencia,
          dia: s.dia,
          hora: s.hora,
          data: s.data ?? undefined,
          peca_slug: s.peca_slug ?? undefined,
        })
        if (!atual()) return
        setAcaoMsg((a) => ({ ...a, [msgId]: 'feita' }))
        sucesso(tr("Marcado — a atividade entrou na Agenda", "Scheduled. The activity is now in your schedule"))
      } catch (e) {
        if (!atual()) return
        setAcaoMsg((a) => {
          const { [msgId]: _fora, ...resto } = a
          return resto
        })
        falha(
          e instanceof ApiError && e.status === 403
            ? tr("Só o dono ou um admin deste escritório pode agendar", "Only an owner or administrator of this office can schedule work")
            : e instanceof ApiError
              ? e.message
          : tr("Não deu para agendar", "Could not schedule"),
        )
      } finally { mutacoesRef.current.delete(chave) }
    },
    [acaoMsg, orgId, slug, sucesso, falha, telaAtual, tr],
  )

  const aplicarCanon = useCallback(
    async (confirmacao: ConfirmacaoPerfil, msgId: number) => {
      const chave = `acao:${msgId}`
      if (acaoMsg[msgId] || mutacoesRef.current.has(chave) || !telaAtual()) return
      const revisao = conversaRevisaoRef.current
      mutacoesRef.current.add(chave)
      const idConversa = conversaIdRef.current
      const escopo = escopoMesaRef.current
      setAcaoMsg((a) => ({ ...a, [msgId]: 'indo' }))
      try {
        await api.post(`/predios/${orgId}/${slug}/conhecimento/canon/confirmar`, confirmacao)
        if (!telaAtual() || conversaRevisaoRef.current !== revisao || conversaIdRef.current !== idConversa || escopoMesaRef.current !== escopo) return
        if (confirmacao.concluir) setPartida((p) => (p ? { ...p, sabatina_pendente: false } : p))
        setAcaoMsg((a) => ({ ...a, [msgId]: 'feita' }))
        sucesso(tr('Perfil atualizado com as informações que você confirmou.', 'Profile updated with the information you confirmed.'))
      } catch (e) {
        if (!telaAtual() || conversaRevisaoRef.current !== revisao) return
        setAcaoMsg((a) => {
          const { [msgId]: _fora, ...resto } = a
          return resto
        })
        throw e
      } finally { mutacoesRef.current.delete(chave) }
    },
    [acaoMsg, orgId, slug, sucesso, tr, telaAtual],
  )

  const continuarJob = useCallback(
    async (jobId: number, msgId: number) => {
      const chave = `acao:${msgId}`
      if (acaoMsg[msgId] || mutacoesRef.current.has(chave) || !telaAtual()) return
      const revisao = conversaRevisaoRef.current
      const atual = () => telaAtual() && conversaRevisaoRef.current === revisao
      mutacoesRef.current.add(chave)
      setAcaoMsg((a) => ({ ...a, [msgId]: 'indo' }))
      try {
        await api.post(`/jobs/${jobId}/continuar`, {})
        if (!atual()) return
        setAcaoMsg((a) => ({ ...a, [msgId]: 'feita' }))
        sucesso(tr("Retomado — te aviso aqui quando terminar", "Resumed. I will let you know here when it is finished"))
      } catch (e) {
        if (!atual()) return
        setAcaoMsg((a) => {
          const { [msgId]: _fora, ...resto } = a
          return resto
        })
        falha(e instanceof ApiError ? e.message : tr("Não deu para retomar", "Could not resume"))
      } finally { mutacoesRef.current.delete(chave) }
    },
    [acaoMsg, sucesso, falha, telaAtual, tr],
  )

  /* ---------------- a peça ---------------- */

  const abrirAcervo = useCallback(() => {
    // Zera o pedido: sem isto a re-busca de 3s do pós-render reabria a peça
    // por cima do painel que o dono acabou de abrir.
    pecaPedidaRef.current = null
    setPainel('acervo')
    setPecaAberta(null)
    setMesa(null)
    void carregarAcervo().catch(() =>
      falha(tr("Não deu para abrir o acervo — tente de novo", "Could not open the asset library. Please try again")),
    )
  }, [carregarAcervo, falha])

  const carregarEntregas = useCallback(async () => {
    const leitura = consulta('entregas')
    try {
      const r = await api.get<unknown>(`/predios/${orgId}/${slug}/entregas`, leitura.signal)
      if (!telaAtual() || leitura.signal.aborted) return
      const lista = asList<Entrega>(r, 'entregas').filter(e => e.tipo !== 'interno' && e.tipo !== 'devolutiva')
      setEntregas(lista); setErroEntregas('')
    } catch (e) {
      if (!telaAtual() || leitura.signal.aborted) return
      setErroEntregas(tr('Não foi possível carregar as entregas.', 'Could not load deliverables.'))
      throw e
    }
  }, [orgId, slug, consulta, telaAtual, tr])

  const abrirEntregas = useCallback(() => {
    pecaPedidaRef.current = null
    setPainel('entregas')
    setPecaAberta(null)
    setMesa(null)
    void carregarEntregas().catch(() =>
      falha(tr("Não deu para abrir as entregas — tente de novo", "Could not open deliverables. Please try again")),
    )
  }, [carregarEntregas, falha])

  const subirNoAcervo = useCallback(
    async (arquivos: FileList) => {
      const lista = Array.from(arquivos)
      let enviados = 0
      // UM por request, sequencial — mesmo contrato do upload da aba antiga.
      for (const f of lista) {
        if (!telaAtual()) return
        try {
          const form = new FormData()
          form.append('arquivo', f)
          const pastaAlvo = pastaAtiva === 'acervo' ? 'entrada' : pastaAtiva
          await api.postForm(
            `/predios/${orgId}/${slug}/arquivos?pasta=${pastaAlvo}` +
              (subAtiva && pastaAlvo !== 'entrada'
                ? `&sub=${encodeURIComponent(subAtiva)}`
                : ''),
            form,
          )
          if (!telaAtual()) return
          enviados += 1
        } catch (e) {
          if (!telaAtual()) return
          falha(e instanceof ApiError ? e.message : `Falhou: ${f.name}`)
        }
      }
      if (!telaAtual()) return
      if (enviados === lista.length && enviados > 0) sucesso(tr("No acervo — eu leio e descrevo cada um em seguida", "Added to the asset library. I will read and describe each file next"))
      else if (enviados > 0) sucesso(tr(`${enviados} de ${lista.length} arquivos recebidos. Tente enviar os que falharam novamente.`, `${enviados} of ${lista.length} files received. Retry the files that failed.`))
      void carregarAcervo().catch(() => {})
    },
    [carregarAcervo, orgId, pastaAtiva, subAtiva, slug, sucesso, falha, telaAtual, tr],
  )

  const excluirDoAcervo = useCallback(
    async (pasta: string, nome: string, sub = '') => {
      const caminho = [pasta, sub, nome].filter(Boolean).join('/')
      const chave = `acervo:${caminho}`
      if (!telaAtual() || mutacoesRef.current.has(chave)) return
      const aceito = await confirmar({ titulo: tr('Excluir arquivo', 'Delete file'), mensagem: tr(`Excluir “${caminho}”? Não tem volta.`, `Delete “${caminho}”? This cannot be undone.`), acao: tr('Excluir arquivo', 'Delete file') })
      if (!aceito || !telaAtual() || mutacoesRef.current.has(chave)) return
      mutacoesRef.current.add(chave)
      try {
        await api.del(
          `/predios/${orgId}/${slug}/arquivos/${pasta}/${encodeURIComponent(nome)}` +
            (sub ? `?sub=${encodeURIComponent(sub)}` : ''),
        )
        if (!telaAtual()) return
        sucesso(tr("Excluído", "Deleted"))
        void carregarAcervo().catch(() => {})
      } catch (e) {
        if (!telaAtual()) return
        falha(e instanceof ApiError ? e.message : tr("Não deu para excluir", "Could not delete"))
      } finally { mutacoesRef.current.delete(chave) }
    },
    [carregarAcervo, orgId, slug, sucesso, falha, confirmar, telaAtual, tr],
  )

  const recusarEntrega = useCallback(
    async (entregaId: number) => {
      const chave = `recusa:${entregaId}`
      if (!telaAtual() || mutacoesRef.current.has(chave)) return
      const nome = entregas?.find(item => item.id === entregaId)?.nome ?? `#${entregaId}`
      const motivo = await solicitarTexto({ titulo: tr('Recusar entrega', 'Reject deliverable'), mensagem: tr(`Recusar “${nome}”? Um motivo informado vira lição para os próximos trabalhos. Sem motivo, somente esta entrega é recusada.`, `Reject “${nome}”? Feedback becomes a lesson for future work. With no feedback, only this deliverable is rejected.`), rotulo: tr('Motivo (opcional)', 'Reason (optional)'), acao: tr('Recusar entrega', 'Reject deliverable'), aceitarVazio: true })
      if (motivo === null || !telaAtual() || mutacoesRef.current.has(chave)) return
      mutacoesRef.current.add(chave)
      try {
        await api.post(`/entregas/${entregaId}/rejeitar`, {
          feedback: motivo.trim() || null,
        })
        if (!telaAtual()) return
        sucesso(motivo.trim() ? tr("Recusada — o motivo virou lição.", "Rejected. Your feedback was saved as a lesson.") : tr('Entrega recusada.', 'Deliverable rejected.'))
        await carregarEntregas().catch(() => {})
      } catch (e) {
        if (!telaAtual()) return
        falha(e instanceof ApiError ? e.message : tr("Não deu para recusar", "Could not reject"))
      } finally { mutacoesRef.current.delete(chave) }
    },
    [carregarEntregas, entregas, sucesso, falha, solicitarTexto, telaAtual, tr],
  )

  /* Conversar SOBRE uma entrega: nasce um chat novo já vinculado (o backend
     injeta o arquivo/trabalho no contexto — é a rota do 'pedir ajuste'). */
  const conversarSobreEntrega = useCallback(
    async (e: Entrega) => {
      const revisao = conversaRevisaoRef.current
      const atual = () => telaAtual() && conversaRevisaoRef.current === revisao
      const chave = `ajuste:${e.id}`
      if (!atual() || mutacoesRef.current.has(chave)) return
      mutacoesRef.current.add(chave)
      try {
        const r = await api.post<{ id: number }>(baseConv, {
          ajuste_job_id: e.job_id,
          ajuste_entrega_id: e.id,
        })
        if (!atual()) return
        pararPollConversa(); selecionarConversa(r.id)
        await listarConversas()
        if (!telaAtual() || conversaIdRef.current !== r.id) return
        setTexto(tr(`Sobre a entrega "${e.nome}": `, `About the deliverable “${e.nome}”: `))
        campoRef.current?.focus()
      } catch (err) {
        if (!atual()) return
        falha(err instanceof ApiError ? err.message : tr("Não deu para abrir a conversa", "Could not open the conversation"))
      } finally { mutacoesRef.current.delete(chave) }
    },
    [baseConv, listarConversas, falha, telaAtual, pararPollConversa, selecionarConversa, tr],
  )

  const aprovarEntregasDoJob = useCallback(
    async (jobId: number) => {
      const chave = `aprovar:${jobId}`
      if (!telaAtual() || mutacoesRef.current.has(chave)) return
      mutacoesRef.current.add(chave)
      try {
        await api.post(`/jobs/${jobId}/entregas/aprovar`, {})
        if (!telaAtual()) return
        sucesso(tr("Aprovadas — viram referência do padrão", "Approved. These now serve as references"))
        void carregarEntregas().catch(() => {})
      } catch (e) {
        if (!telaAtual()) return
        falha(e instanceof ApiError ? e.message : tr("Não deu para aprovar", "Could not approve"))
      } finally { mutacoesRef.current.delete(chave) }
    },
    [carregarEntregas, sucesso, falha, telaAtual, tr],
  )

  /* A régua do tempo ganho: 2h por peça aprovada. É ESTIMATIVA de
     consultoria, não medição — declarada na tela e ajustável por conversa
     (a estratégia prevê baseline por tipo de entrega; até lá, régua única). */
  const HORAS_POR_PECA = 2

  const abrirDashboard = useCallback(async () => {
    const leitura = consulta('dashboard')
    pecaPedidaRef.current = null
    setPainel('dashboard')
    setPecaAberta(null)
    setMesa(null)
    try {
      const [jobsR, entregasR, pecasR] = await Promise.all([
        api.get<unknown>(`/predios/${orgId}/${slug}/jobs`, leitura.signal),
        api.get<unknown>(`/predios/${orgId}/${slug}/entregas`, leitura.signal),
        slug === 'conteudo' ? api.get<PecaEditorial[]>(`/predios/${orgId}/conteudo/editorial`, leitura.signal) : Promise.resolve([]),
      ])
      if (!telaAtual() || leitura.signal.aborted) return
      const jobs = asList<{ status: string; criado_em?: string }>(jobsR, 'jobs')
      const agora = new Date()
      const resumo = resumoEntregas(asList<Entrega>(entregasR, 'entregas'), asList<PecaEditorial>(pecasR), agora)
      setDash({
        mes: agora.toISOString(),
        ...resumo,
        emVoo: jobs.filter((j) => j.status === 'queued' || j.status === 'running').length,
        horasGanhas: resumo.aprovadasNoMes * HORAS_POR_PECA,
      })
    } catch {
      if (!telaAtual() || leitura.signal.aborted) return
      falha(tr("Não deu para montar o dashboard — tente de novo", "Could not load the dashboard. Please try again"))
    }
  }, [orgId, slug, falha, consulta, telaAtual, tr])

  const abrirMaquinas = useCallback(() => {
    pecaPedidaRef.current = null
    setPainel('maquinas')
    setPecaAberta(null)
    setMesa(null)
  }, [])

  /* A AGENDA MORA AQUI DENTRO (30/08/2026, pedido do dono). Ela só existia na
     shell antiga, então marcar um trabalho para rodar sozinho obrigava a SAIR
     da Mesa — e o dono voltava para a tela velha toda vez. Como o Dashboard e
     a Sala das máquinas, ela é gaveta: o mesmo componente da shell, embutido,
     sem duplicar regra de agendamento em dois lugares. */
  const abrirAgenda = useCallback(() => {
    pecaPedidaRef.current = null
    setPainel('agenda')
    setPecaAberta(null)
    setMesa(null)
  }, [])

  useEffect(() => {
    if (!painelInicial) return
    if (painelInicial.qual === 'entregas') abrirEntregas()
    else abrirAgenda()
  }, [painelInicial, abrirEntregas, abrirAgenda])

  const abrirMesa = useCallback(
    async (pecaSlug: string) => {
      // QUEM PEDIU POR ÚLTIMO MANDA. Antes só o clique abria peça; agora o
      // chat também abre sozinho, então duas aberturas podem estar em voo —
      // e a resposta lenta da PRIMEIRA chegando depois pintava o painel da
      // peça A enquanto o botão Gerar já apontava para a peça B (render pago
      // na peça errada). O ref marca o pedido corrente; resposta velha morre.
      pecaPedidaRef.current = pecaSlug
      const leitura = consulta('mesa')
      setPainel(null)
      setPecaAberta(pecaSlug)
      setCenaAberta(null)
      setTrocandoMaterial(false)
      try {
        const m = await api.get<MesaPayload>(`${baseEstudio}/pecas/${pecaSlug}/mesa`, leitura.signal)
        if (!telaAtual() || leitura.signal.aborted || pecaPedidaRef.current !== pecaSlug) return
        setMesa(m)
      } catch (e) {
        if (!telaAtual() || leitura.signal.aborted || pecaPedidaRef.current !== pecaSlug) return
        setPecaAberta(null)
        falha(e instanceof ApiError ? e.message : tr("Não deu para abrir a peça", "Could not open the production"))
      }
    },
    [baseEstudio, consulta, telaAtual, tr, falha],
  )

  const fecharMesa = useCallback(() => {
    pecaPedidaRef.current = null
    setPainel(null)
    setPecaAberta(null)
    setMesa(null)
    setCenaAberta(null)
    if (pollJob.current) {
      window.clearInterval(pollJob.current)
      pollJob.current = null
    }
  }, [])

  /* CHAT RICO: a resposta viva carteou uma peça → o painel dela abre ao lado.
     Via estado (e não chamada direta no enviar) porque abrirMesa só existe
     daqui pra baixo — o enviar mora acima dela no arquivo.

     Puxar o painel é gentileza, não ordem: se o dono FOI para outro painel
     durante os segundos de espera (a Sala das máquinas, com o formulário da
     chave meio preenchido), abrir por cima desmontaria o que ele está
     fazendo; e se a peça carteada é a que já está aberta, reabrir só fecharia
     a cena que ele estava editando. Nos dois casos o cartão continua na
     mensagem, a um toque de distância. */
  useEffect(() => {
    if (!pecaPuxada) return
    setPecaPuxada(null)
    if (painel !== null) return
    if (pecaPuxada === pecaAberta) return
    void abrirMesa(pecaPuxada)
  }, [pecaPuxada, painel, pecaAberta, abrirMesa])

  /* o job da peça em voo: refaz a /mesa a cada 4s até pousar */
  useEffect(() => {
    const ativo = mesa?.job_ativo
    const emVoo = (ativo && (ativo.status === 'queued' || ativo.status === 'running')) || ['em_fila', 'em_revisao'].includes(mesa?.revisao_automatica?.estado || '')
    if (!emVoo || !pecaAberta) return
    const leituraAtual = consultasRef.current.get('mesa')
    const atual = () => telaAtual() && consultasRef.current.get('mesa') === leituraAtual && pecaPedidaRef.current === pecaAberta
    const t = window.setInterval(async () => {
      if (document.hidden) return
      try {
        const m = await api.get<MesaPayload>(`${baseEstudio}/pecas/${pecaAberta}/mesa`)
        // O cleanup mata o interval, mas não a busca já em voo: sem isto o
        // tick da peça anterior pinta o painel da peça recém-aberta.
        if (!atual()) return
        setMesa(m)
        const st = m.job_ativo?.status
        if (st && st !== 'queued' && st !== 'running' && !['em_fila', 'em_revisao'].includes(m.revisao_automatica?.estado || '')) {
          window.clearInterval(t)
          void listarPecas()
          if (conversaId) void carregarMensagens(conversaId).catch(() => {})
          if (st === 'done') sucesso(tr("Os arquivos estão guardados — confira o resultado da revisão no painel", "Files are saved. Check the review result in the panel"))
          else falha(tr("O render falhou — veja a conversa", "Rendering failed. See the conversation"))
          // O finish comita o status ANTES do merge do workspace: o doc que
          // este tick leu pode ser o pré-merge, sem a crítica. Uma re-busca
          // atrasada pega a versão pousada — mas só se a peça ainda for a que
          // está na mesa (em 3s o dono pode ter aberto outra).
          window.setTimeout(() => {
            if (atual()) void abrirMesa(pecaAberta)
          }, 3000)
        }
      } catch {
        /* erro transitório (backend reiniciando, blip) NÃO mata o poll —
           o próximo tick tenta de novo; o cleanup cobre o desmonte */
      }
    }, 4000)
    pollJob.current = t
    return () => window.clearInterval(t)
  }, [abrirMesa, baseEstudio, carregarMensagens, conversaId, listarPecas, mesa?.job_ativo, mesa?.revisao_automatica?.estado, pecaAberta, sucesso, falha, telaAtual])

  const gerar = useCallback(async () => {
    if (!pecaAberta || producaoRef.current || !telaAtual() || !mesa?.pode_gerar || mesa.custo_consulta_confirmada === false || mesa.custo_pendente == null
      || ((mesa.custo_total_estimado === false || (mesa.custos_fora_fal?.length ?? 0) > 0) && (mesa.orcamento?.teto_usd ?? 0) > 0)) return
    const alvo = pecaAberta
    const leituraAtual = consultasRef.current.get('mesa')
    const atual = () => telaAtual() && consultasRef.current.get('mesa') === leituraAtual && pecaPedidaRef.current === alvo
    producaoRef.current = true
    setGerando(true)
    try {
      const id = conversaId
      await api.post(`${baseEstudio}/pecas/${pecaAberta}/gerar`, {
        conversa_id: id ?? undefined,
      })
      if (!atual()) return
      sucesso(tr("Gerando — nada além do plano aprovado", "Generating only what the approved plan includes"))
      await abrirMesa(pecaAberta)
    } catch (e) {
      if (!atual()) return
      falha(e instanceof ApiError ? e.message : tr("O portão recusou", "The approval gate declined"))
    } finally {
      producaoRef.current = false
      if (telaAtual()) setGerando(false)
    }
  }, [abrirMesa, baseEstudio, conversaId, pecaAberta, mesa, sucesso, falha, telaAtual, tr])

  async function revisarArquivos() {
    if (!mesa?.job_ativo || !pecaAberta || producaoRef.current || !telaAtual()) return
    const alvo = pecaAberta
    const leituraAtual = consultasRef.current.get('mesa')
    const atual = () => telaAtual() && consultasRef.current.get('mesa') === leituraAtual && pecaPedidaRef.current === alvo
    setGerando(true)
    producaoRef.current = true
    try {
      await api.post(`/orgs/${orgId}/biblioteca/${mesa.job_ativo.id}/revisar`, {})
      if (atual()) await abrirMesa(alvo)
    } catch (e) {
      if (!atual()) return
      falha(e instanceof ApiError ? e.message : tr('Não foi possível iniciar a conferência', 'Could not start the review'))
    } finally { producaoRef.current = false; if (telaAtual()) setGerando(false) }
  }

  const pedirPlano = useCallback(() => {
    if (!mesa) return
    setTexto(tr(`Faz o plano da peça "${mesa.titulo}": referência, origem de cada cena e o que falta pra começar.`, `Create the plan for “${mesa.titulo}”: reference, source of each scene, and what is needed to start.`))
  }, [mesa])

  const abrirTrocaMaterial = useCallback(async () => {
    const alvo = pecaPedidaRef.current
    const cena = cenaAberta
    const leitura = consulta('materiais')
    setTrocandoMaterial(true)
    setAcervoOpcoes([]); setErroMateriais('')
    try {
      const r = await api.get<Record<string, ArquivoAcervo[]>>(
        `/predios/${orgId}/${slug}/arquivos`, leitura.signal,
      )
      if (!telaAtual() || leitura.signal.aborted || pecaPedidaRef.current !== alvo || cenaAbertaRef.current !== cena) return
      const opcoes: Array<{ caminho: string; nome: string }> = []
      for (const [pasta, prefixo] of [
        ['produto', 'memoria/brand/acervo'],
        ['aprovados', 'memoria/brand/acervo/aprovados'],
        ['exemplos', 'memoria/brand/acervo/exemplos'],
        ['marca', 'memoria/brand/assets/marca'],
        ['entrada', 'entrada'],
      ] as const) {
        for (const item of r[pasta] ?? []) {
          const sub = (item.sub ?? '').replace(/\\/g, '/')
          if (sub.startsWith('/') || sub.split('/').some(segmento => segmento === '..' || segmento === '.' || segmento.includes(':')) || /[\/\\]/.test(item.nome)) continue
          if (/\.(png|jpe?g|webp|gif|mp4|mov|webm)$/i.test(item.nome)) {
            const nome = [sub, item.nome].filter(Boolean).join('/')
            opcoes.push({ caminho: `${prefixo}/${nome}`, nome })
          }
        }
      }
      setAcervoOpcoes(opcoes)
    } catch {
      if (telaAtual() && !leitura.signal.aborted && pecaPedidaRef.current === alvo) setErroMateriais(tr('Não foi possível carregar os materiais.', 'Could not load materials.'))
    }
  }, [orgId, slug, cenaAberta, consulta, telaAtual, tr])

  const trocarMaterial = useCallback(
    async (caminho: string) => {
      if (!pecaAberta || !cenaAberta || producaoRef.current || !telaAtual()) return
      const alvo = pecaAberta
      const cenaAlvo = cenaAberta
      const leituraAtual = consultasRef.current.get('mesa')
      const atual = () => telaAtual() && consultasRef.current.get('mesa') === leituraAtual && pecaPedidaRef.current === alvo && cenaAbertaRef.current === cenaAlvo
      producaoRef.current = true; setGerando(true)
      try {
        await api.patch(`${baseEstudio}/pecas/${pecaAberta}/cenas/${cenaAberta}`, {
          material: caminho,
        })
        if (!atual()) return
        sucesso(tr("Material trocado — trocar re-cobra a cena, o custo novo está no painel", "Material replaced. Regenerating this scene costs extra; the new cost is in the panel"))
        setTrocandoMaterial(false)
        await abrirMesa(pecaAberta)
        if (!telaAtual() || pecaPedidaRef.current !== alvo || (cenaAbertaRef.current !== null && cenaAbertaRef.current !== cenaAlvo)) return
        setCenaAberta(cenaAberta)
      } catch (e) {
        if (!atual()) return
        falha(e instanceof ApiError ? e.message : tr("Não deu para trocar", "Could not replace"))
      } finally { producaoRef.current = false; if (telaAtual()) setGerando(false) }
    },
    [abrirMesa, baseEstudio, cenaAberta, pecaAberta, sucesso, falha, telaAtual, tr],
  )

  const salvarNarracao = useCallback(async (corpo: { ligada: false } | { ligada?: true; porta_voz: string }, mensagem: string) => {
    const alvo = pecaPedidaRef.current
    const leituraAtual = consultasRef.current.get('mesa')
    const atual = () => telaAtual() && consultasRef.current.get('mesa') === leituraAtual && pecaPedidaRef.current === alvo
    if (!alvo || narracaoRef.current || !atual()) return
    narracaoRef.current = true; setNarrSalvando(true)
    try {
      await api.patch(`${baseEstudio}/pecas/${alvo}/narracao`, corpo)
      if (!atual()) return
      sucesso(mensagem)
      await abrirMesa(alvo)
    } catch (e) {
      if (atual()) falha(e instanceof ApiError ? e.message : tr('Não foi possível salvar a narração.', 'Could not save narration.'))
    } finally { narracaoRef.current = false; if (telaAtual()) setNarrSalvando(false) }
  }, [abrirMesa, baseEstudio, telaAtual, sucesso, falha, tr])

  /* ---------------- render ---------------- */

  const emVoo =
    mesa?.job_ativo &&
    (mesa.job_ativo.status === 'queued' || mesa.job_ativo.status === 'running')
  const custoMesaIndisponivel = mesa?.custo_consulta_confirmada === false || mesa?.custo_pendente == null
  const custoMesaExterno = mesa?.custo_total_estimado === false || (mesa?.custos_fora_fal?.length ?? 0) > 0
  const custoMesaBloqueia = custoMesaIndisponivel || (custoMesaExterno && (mesa?.orcamento?.teto_usd ?? 0) > 0)
  const cena = mesa?.cenas.find((c) => c.id === cenaAberta) ?? null

  /* 5 por grupo, 10 no sem-grupo — e o 'ver mais' abre o resto. */
  const cortar = (lista: ConvResumo[], chave: string, cap: number) =>
    verMaisAberto[chave] ? lista : lista.slice(0, cap)

  const verMaisBotao = (lista: ConvResumo[], chave: string, cap: number) =>
    lista.length > cap ? (
      <button
        className="mesa-nav__vermais"
        onClick={() => setVerMaisAberto((v) => ({ ...v, [chave]: !v[chave] }))}
      >
        {verMaisAberto[chave] ? tr("Ver menos", "Show less") : tr(`Ver mais (${lista.length - cap})`, `Show more (${lista.length - cap})`)}
      </button>
    ) : null

  const linhaConversa = (c: ConvResumo) => (
    <div key={c.id} className="mesa-nav__linha">
      {renomeando === c.id ? (
        <input
          className="mesa-nav__renome"
          autoFocus
          value={tituloDraft}
          onChange={(e) => setTituloDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setRenomeando(null)
              void editarConversa(c.id, { titulo: tituloDraft })
            }
            if (e.key === 'Escape') setRenomeando(null)
          }}
          onBlur={() => setRenomeando(null)}
          aria-label={tr("Novo título da conversa", "New conversation title")}
        />
      ) : (
        <button
          className="mesa-nav__item"
          aria-current={c.id === conversaId}
          onClick={() => void abrirConversa(c.id)}
        >
          <span className="mesa-nav__titulo">
            <span className="mesa-nav__titulo-texto">{c.titulo || tr("Nova conversa", "New conversation")}</span>
            {c.sinal && BOLINHA_LEGENDA[c.sinal] && (
              <span
                className={`mesa-bolinha mesa-bolinha--${c.sinal}`}
                title={BOLINHA_LEGENDA[c.sinal]}
                aria-label={BOLINHA_LEGENDA[c.sinal]}
              />
            )}
          </span>
          <span className="mesa-nav__meta">
            {c.resumo || (c.atualizado_em ? tempoRelativo(c.atualizado_em, idioma) : '')}
          </span>
        </button>
      )}
      <button
        className="mesa-nav__mais"
        aria-label={tr("Opções da conversa", "Conversation options")}
        aria-expanded={menuConv === c.id}
        onClick={(e) => {
          e.stopPropagation()
          const abrir = menuConv !== c.id
          fecharMenuConv()
          if (abrir) setMenuConv(c.id)
        }}
      >
        <span aria-hidden>⋯</span>
      </button>
      {menuConv === c.id && (
        <div className="mesa-conv-menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setTituloDraft(c.titulo || '')
              fecharMenuConv()
              setRenomeando(c.id)
            }}
          >
            {tr("Renomear", "Rename")}</button>
          <button
            role="menuitem"
            onClick={() => {
              fecharMenuConv()
              void editarConversa(c.id, { fixada: !c.fixada })
            }}
          >
            {c.fixada ? tr("Desafixar", "Unpin") : tr("Fixar no topo", "Pin to top")}
          </button>
          <button role="menuitem" aria-expanded={grupoAberto} onClick={() => setGrupoAberto((v) => !v)}>
            {tr("Mover para grupo…", "Move to group…")}</button>
          {grupoAberto && (
            <div className="mesa-conv-menu__grupos">
              {rail.nomes
                .filter((g) => g !== c.grupo)
                .map((g) => (
                  <button
                    key={g}
                    role="menuitem"
                    onClick={() => {
                      fecharMenuConv()
                      void editarConversa(c.id, { grupo: g })
                    }}
                  >
                    {g}
                  </button>
                ))}
              {c.grupo && (
                <button
                  role="menuitem"
                  onClick={() => {
                    fecharMenuConv()
                    void editarConversa(c.id, { grupo: '' })
                  }}
                >
                  {tr("Tirar de “", "Remove from “")}{c.grupo}”
                </button>
              )}
              {novoGrupo === null ? (
                <button role="menuitem" onClick={() => setNovoGrupo('')}>
                  {tr("Novo grupo…", "New group…")}</button>
              ) : (
                <input
                  autoFocus
                  placeholder={tr("Nome do grupo", "Group name")}
                  value={novoGrupo}
                  onChange={(e) => setNovoGrupo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && novoGrupo.trim()) {
                      const g = novoGrupo.trim()
                      fecharMenuConv()
                      void editarConversa(c.id, { grupo: g })
                    }
                    if (e.key === 'Escape') setNovoGrupo(null)
                  }}
                  aria-label={tr("Nome do novo grupo", "New group name")}
                />
              )}
            </div>
          )}
          <button
            role="menuitem"
            className="mesa-conv-menu__apagar"
            onClick={() => {
              if (apagando === c.id) {
                fecharMenuConv()
                void apagarConversa(c.id)
              } else setApagando(c.id)
            }}
          >
            {apagando === c.id ? tr("Apagar mesmo? Não volta.", "Delete permanently? This cannot be undone.") : tr("Apagar", "Delete")}
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div
      className={`mesa${imersa ? ' mesa--imersa' : ''}${pecaAberta || painel ? ' mesa--peca-aberta' : ''}${navAberta ? ' mesa--nav-aberta' : ''}${navRecolhida ? ' mesa--nav-recolhida' : ''}${painel === 'entregas' && slug === 'conteudo' ? ' mesa--editorial' : ''}`}
      style={
        pecaLargura || pecaLarga
          ? ({ '--mesa-peca-w': pecaLargura ? `${pecaLargura}px` : '62%' } as CSSProperties)
          : undefined
      }
      onDragOver={(e) => {
        e.preventDefault()
        setArrastando(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setArrastando(false)
      }}
      onDrop={aoSoltar}
    >
      {arrastando && (
        <div className="mesa-solte">
          <div>
            {tr("Solte para anexar à conversa", "Drop to attach to the conversation")}<small>{tr("documento a IA lê; mídia vai para entrada/ e a tarefa edita", "The AI reads documents; media goes to the inbox for editing by the task")}</small>
          </div>
        </div>
      )}

      {/* ───────── histórico ───────── */}
      {navAberta && (
        <div className="mesa-veu" onClick={() => setNavAberta(false)} aria-hidden />
      )}
      <aside className="mesa-nav" aria-label={tr("Conversas", "Conversations")}>
        <div className="mesa-nav__topo">
          <span className="mesa-nav__org">
            {brasao && <img className="mesa-brasao" src={brasao} alt="" aria-hidden />}
            <span className="mesa-nav__org-nome">
              <strong>{capitalizar(orgNome || officeNome || 'Offiz')}</strong>
              <span className="mesa-by" aria-label={tr("Feito com Offiz", "Made with Offiz")}>
                by <strong>Offiz</strong>
              </span>
            </span>
          </span>
          <button
            className="mesa-icone"
            onClick={novaConversa}
            title={tr("Nova conversa", "New conversation")}
            aria-label={tr("Nova conversa", "New conversation")}
          >
            <Icone nome="mais" />
          </button>
        </div>
        <div className="mesa-nav__lista">
          {menuConv !== null && <div className="mesa-conv-veu" onClick={fecharMenuConv} />}
          {rail.fixadas.length > 0 && (
            <>
              <div className="mesa-nav__grupo">{tr("Fixadas", "Pinned")}</div>
              {cortar(rail.fixadas, 'fixadas', 5).map(linhaConversa)}
              {verMaisBotao(rail.fixadas, 'fixadas', 5)}
            </>
          )}
          {rail.grupos.map(([g, lista]) => (
            <Fragment key={g}>
              <div className="mesa-nav__grupo">{g}</div>
              {cortar(lista, `g:${g}`, 5).map(linhaConversa)}
              {verMaisBotao(lista, `g:${g}`, 5)}
            </Fragment>
          ))}
          {cortar(rail.soltas, 'soltas', 10).map((c, i, visiveis) => {
            const rotulo = grupoDaConversa(c.atualizado_em, idioma)
            const anterior = i > 0 ? grupoDaConversa(visiveis[i - 1].atualizado_em, idioma) : null
            return (
              <Fragment key={c.id}>
                {rotulo !== anterior && <div className="mesa-nav__grupo">{rotulo}</div>}
                {linhaConversa(c)}
              </Fragment>
            )
          })}
          {verMaisBotao(rail.soltas, 'soltas', 10)}
          {erroConversas && <div role="alert" className="mesa-suave">{erroConversas} <button className="mesa-link" onClick={() => void listarConversas()}>{tr('Tentar novamente', 'Try again')}</button></div>}
          {!conversas.length && !erroConversas && (
            <p className="mesa-nav__vazio">
              {tr("A primeira conversa nasce quando você escrever.", "Your first conversation starts when you write.")}</p>
          )}
        </div>
        <button className="mesa-nav__acervo" onClick={abrirAcervo}>
          <span className="mesa-nav__acervo-rotulo">
            <Icone nome="biblioteca" /> {tr("Acervo", "Asset library")}</span>
          {(() => {
            const faltando = pecas
              .filter((p) => p.estado !== 'entregue')
              .reduce((n, p) => n + (p.faltando || 0), 0)
            return faltando > 0 ? (
              <span className="mesa-nav__acervo-conta"><em>{faltando} {tr("faltando", "missing")}</em></span>
            ) : null
          })()}
          {contagemAcervo && (
            <span className="mesa-nav__acervo-conta">
              {contagemAcervo.total} {contagemAcervo.total === 1 ? tr("arquivo", "file") : tr("arquivos", "files")}
              {contagemAcervo.aOrganizar > 0 && (
                <em> · {contagemAcervo.aOrganizar} {tr("a organizar", "to organize")}</em>
              )}

            </span>
          )}
        </button>
        {imersa && (
          <div className="mesa-nav__rodape">
            {menuMe && (
              <div className="mesa-menu" role="menu">
                <Link className="mesa-menu__item" role="menuitem" to={`/app?org=${orgId}`}>
                  <Icone nome="conversa" /><span>{tr("Início do Offiz", "Offiz home")}</span>
                </Link>
                {(destinos || []).map((d) => (
                  <button
                    key={d.id}
                    role="menuitem"
                    className="mesa-menu__item"
                    onClick={() => {
                      setMenuMe(false)
                      if (d.id === 'entregas') abrirEntregas()
                      else if (d.id === 'inicio') void abrirDashboard()
                      else aoNavegar?.(d.id)
                    }}
                  >
                    <Icone nome={d.icone as NomeIcone} />
                    <span>{d.rotulo}</span>
                  </button>
                ))}
                {configHref && (
                  <button
                    className="mesa-menu__item"
                    role="menuitem"
                    onClick={() => {
                      setMenuMe(false)
                      abrirMaquinas()
                    }}
                  >
                    <Icone nome="config" />
                    <span>{tr("Sala das máquinas", "Settings")}</span>
                  </button>
                )}
                <button
                  className="mesa-menu__item"
                  role="menuitem"
                  onClick={() => {
                    setMenuMe(false)
                    abrirAgenda()
                  }}
                >
                  <Icone nome="agenda" />
                  <span>{tr("Agenda", "Schedule")}</span>
                </button>
              </div>
            )}
            <button
              className="mesa-me"
              aria-expanded={menuMe}
              onClick={() => setMenuMe((v) => !v)}
              title={tr("As outras áreas do escritório", "Other office areas")}
            >
              {brasao ? (
                <img className="mesa-me__av mesa-me__av--brasao" src={brasao} alt="" />
              ) : (
                <span className="mesa-me__av">{(orgNome || 'O')[0].toUpperCase()}</span>
              )}
              <span className="mesa-me__nome">
                {officeNome || tr("Escritório", "Office")}
                {(() => {
                  try {
                    const u = JSON.parse(localStorage.getItem('offiz_usuario') || 'null')
                    const nome = u?.nome || u?.email
                    return nome ? (
                      <em className="mesa-me__quem">{String(nome).split(' ')[0]}</em>
                    ) : null
                  } catch {
                    return null
                  }
                })()}
              </span>
              <Icone nome="menu" />
            </button>
          </div>
        )}
      </aside>

      {/* ───────── conversa ───────── */}
      <section className="mesa-chat">
        {partida?.sem_saldo && (
          <div className="mesa-saldo" role="alert">
            <strong>{tr("Foi registrada uma falha por saldo ou cota da conexão de IA.", "A failure due to the AI connection’s balance or quota was recorded.")}</strong>
            <span>
              {tr("Confira o saldo, a chave e o motor na Sala das máquinas. A retomada automática pode ser tentada após resolver a conexão; acompanhe os trabalhos na conversa e retome manualmente os que ainda precisarem.", "Check the balance, key and engine in settings. Automatic resumption may be attempted after the connection is resolved; follow the tasks in the conversation and manually resume any that still need it.")}</span>
            <button className="mesa-btn" onClick={abrirMaquinas}>
              {tr("Abrir a Sala das máquinas", "Open settings")}</button>
          </div>
        )}
        <header className="mesa-chat__topo">
          <button
            className="mesa-icone"
            onClick={() => {
              // no celular a nav é gaveta; no desktop, recolhe a coluna
              if (window.matchMedia('(max-width: 900px)').matches)
                setNavAberta((v) => !v)
              else setNavRecolhida((v) => !v)
            }}
            title={tr("Mostrar ou esconder as conversas", "Show or hide conversations")}
            aria-label={tr("Mostrar ou esconder as conversas", "Show or hide conversations")}
          >
            <Icone nome="menu" />
          </button>
          <h2>
            {conversas.find((c) => c.id === conversaId)?.titulo ||
              (imersa ? capitalizar(orgNome || tr("Mesa", "Desk")) : tr("Mesa", "Desk"))}
          </h2>
          {imersa && <span className="mesa-agora">{agora}</span>}
          {erroPecas && <div role="alert" className="mesa-suave">{erroPecas} <button className="mesa-link" onClick={() => void listarPecas()}>{tr('Tentar novamente', 'Try again')}</button></div>}
          {pecas.length > 0 && (
            <div className="mesa-pecas-chips">
              {pecas.slice(0, 6).map((p) => (
                <button
                  key={p.slug}
                  className="mesa-chip"
                  aria-current={p.slug === pecaAberta}
                  onClick={() => void abrirMesa(p.slug)}
                >
                  {p.titulo}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="mesa-fio">
          {erroConversa && <div role="alert" className="mesa-suave">{erroConversa} <button className="mesa-link" onClick={() => { if (conversaIdRef.current) void abrirConversa(conversaIdRef.current) }}>{tr('Tentar novamente', 'Try again')}</button></div>}
          {!mensagens.length && !pensando && !emExecucao && (
            <div className="mesa-vazio">
              {partida && !partida.tem_motor ? (
                <div className="mesa-cartao mesa-cartao--partida">
                  <strong>{tr("Primeiro passo: ligar o motor da IA.", "First step: connect the AI engine.")}</strong>
                  <span>
                    {tr('Confira a conexão nas configurações. No aplicativo, a conversa pode usar a conta conectada neste computador; no navegador, usa a conexão configurada para a empresa.', 'Check the connection in settings. In the app, the conversation can use the account connected on this computer; in the browser, it uses the connection configured for the organization.')}</span>
                  <button className="mesa-btn mesa-btn--cheio" onClick={abrirMaquinas}>
                    {tr("Abrir a Sala das máquinas", "Open settings")}</button>
                </div>
              ) : partida?.sabatina_pendente ? (
                <div className="mesa-cartao mesa-cartao--partida">
                  <strong>{tr('Pode começar pelo que precisa.', 'Start with what you need.')}</strong>
                  <span>
                    {tr('Se faltar alguma informação da empresa, completamos durante a conversa. Você também pode rever o perfil antes.', 'If any company information is missing, we can fill it in during the conversation. You can also review the profile first.')}</span>
                  <button
                    className="mesa-btn mesa-btn--cheio"
                    onClick={() =>
                      setTexto(tr('Quero completar o perfil da minha empresa.', 'I want to complete my company profile.'))
                    }
                  >
                    {tr('Completar meu perfil', 'Complete my profile')}</button>
                </div>
              ) : null}
              {(!partida || partida.tem_motor) && (
                <>
                  <p>
                    {tr("Peça a peça, cole a referência ou arraste um arquivo. A IA monta o plano — ", "Describe the deliverable, paste a reference, or drop a file. The AI prepares the plan. ")}<em>{tr("nada é gerado sem o seu ok", "Nothing is generated without your approval")}</em>.
                  </p>
                  <div className="mesa-partida">
                    {/* Os 3 de sempre (decisão do dono, 26/08) — e o das
                        peças só quando EXISTE peça: no dia 1 ele responderia
                        "nenhuma ainda", chip inútil. */}
                    {[
                      tr("O que você sabe da minha empresa?", "What do you know about my organization?"),
                      tr("Monta um post para apresentar minha empresa", "Create a post introducing my company"),
                      tr("Organiza e salva o que eu mandei no acervo", "Organize and save the files I sent in the asset library"),
                      ...(pecas.length > 0 ? [tr("Me mostra as peças que temos", "Show me our productions")] : []),
                    ].map((h) => (
                      <button key={h} className="mesa-chip" onClick={() => setTexto(h)}>
                        {h}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {mensagens.map((m) => {
            const revisaoDaMensagem = conversaRevisaoRef.current
            const s = m.sugestao_tarefa
            const tipo = (s as { tipo?: string } | null | undefined)?.tipo
            const { perguntas: chips, peca: cartaoPeca } = extrasDaMensagem(s)
            const eUltima = mensagens[mensagens.length - 1]?.id === m.id
            return (
              <div key={m.id} className={`mesa-msg mesa-msg--${m.role === 'user' ? 'dono' : 'ia'}`}>
                <p>{m.conteudo}</p>
                {anexosPorMsg[m.id] && (
                  <span className="mesa-msg__anexos">
                    {anexosPorMsg[m.id].map((n) => (
                      <span key={n} className="mesa-anexo mesa-anexo--ok">{n}</span>
                    ))}
                  </span>
                )}
                {(m.criado_em || m.role !== 'user') && (
                  <span className="mesa-msg__quando">
                    {m.role !== 'user' && (partida?.voz_leitura ?? 'desligada') !== 'desligada' && (
                      <button
                        className={`mesa-ouvir${falando === m.id ? ' mesa-ouvir--tocando' : ''}`}
                        onClick={() => lerMensagem(m)}
                        title={falando === m.id ? tr("Parar a leitura", "Stop reading") : tr("Ouvir esta resposta", "Listen to this response")}
                        aria-label={falando === m.id ? tr("Parar a leitura", "Stop reading") : tr("Ouvir esta resposta", "Listen to this response")}
                        aria-pressed={falando === m.id}
                      >
                        <Icone nome="audio" />
                      </button>
                    )}
                    {m.criado_em ? tempoRelativo(m.criado_em, idioma) : ''}
                  </span>
                )}
                {/* desfecho que cita a aba Entregas ganha o atalho (27/08:
                    'aonde eu clico para ver o plano aqui?') */}
                {m.role !== 'user' && /aba entregas/i.test(m.conteudo) && (
                  <button className="mesa-link mesa-msg__atalho" onClick={abrirEntregas}>
                    {tr("Abrir Entregas →", "Open deliverables →")}</button>
                )}
                {eTarefa(s) && (
                  <div className="mesa-cartao">
                    <span>{s.titulo}</span>
                    {/* GÊMEO MORTO (27/08, pedido do dono): se um cartão MAIS
                        NOVO com o mesmo título já foi iniciado, este vira
                        registro — clicá-lo pagaria o mesmo trabalho de novo. */}
                    {!acaoMsg[m.id] &&
                    mensagens.some((m2) => {
                      if (m2.id <= m.id || !acaoMsg[m2.id]) return false
                      const s2 = m2.sugestao_tarefa
                      return !!s2 && eTarefa(s2) && s2.titulo === s.titulo
                    }) ? (
                      <span className="mesa-cartao__superado">
                        {tr("Iniciado em outro cartão ✓", "Started from another card ✓")}</span>
                    ) : (
                      <button
                        className="mesa-btn mesa-btn--cheio"
                        disabled={!!acaoMsg[m.id]}
                        onClick={() => void aceitarTarefa(s, m.id)}
                      >
                        {acaoMsg[m.id] === 'feita'
                          ? tr("Iniciado ✓", "Started ✓")
                          : acaoMsg[m.id] === 'indo'
                            ? tr("Iniciando…", "Starting…")
                            : tr("Iniciar o trabalho", "Start task")}
                      </button>
                    )}
                  </div>
                )}
                {tipo === 'devolutiva' && (
                  <div className="mesa-cartao">
                    <span>{tr("O trabalho parou pedindo insumo.", "The task paused to ask for materials.")}</span>
                    <button
                      className="mesa-btn"
                      disabled={!!acaoMsg[m.id]}
                      onClick={() => void continuarJob((s as { job_id: number }).job_id, m.id)}
                    >
                      {acaoMsg[m.id] === 'feita' ? tr("Retomado ✓", "Resumed ✓") : tr("Retomar", "Resume")}
                    </button>
                  </div>
                )}
                {tipo === 'canon' && (acaoMsg[m.id] === 'feita' ? <p role="status">{tr('Guardado ✓', 'Saved ✓')}</p>
                  : acaoMsg[m.id] !== 'dispensada' && <PerfilProposto key={`${orgId}:${slug}:${conversaId}:${m.id}`}
                    proposta={s as SugestaoCanon} canonUrl={`/predios/${orgId}/${slug}/conhecimento/canon`}
                    podeSalvar={Boolean(configHref)} salvando={acaoMsg[m.id] === 'indo'} continuarSomenteCorrecoes
                    aoConfirmar={confirmacao => aplicarCanon(confirmacao, m.id)}
                    aoContinuar={secoes => {
                      if (!telaAtual() || conversaRevisaoRef.current !== revisaoDaMensagem
                        || conversaIdRef.current !== conversaId || escopoMesaRef.current !== baseConv) return
                      const correcoes = secoes.map(s => `${s.secao}: ${s.conteudo.trim()}`).join('\n\n')
                      if (correcoes) {
                        setTexto(atual => atual.trim() ? `${atual}\n\n${correcoes}` : correcoes)
                        campoRef.current?.focus()
                      }
                      setAcaoMsg(atuais => ({ ...atuais, [m.id]: 'dispensada' }))
                    }} />)}
                {tipo === 'marca' && (
                  <div className="mesa-cartao">
                    <span>
                      {tr("A IA propôs uma mudança de marca — responda aqui na conversa para ajustar antes de aplicar.", "The AI suggested a brand change. Reply in this conversation to adjust it before applying.")}</span>
                  </div>
                )}
                {tipo === 'agendamento' && (
                  <div className="mesa-cartao">
                    <span>
                      {(s as { resumo?: string | null; titulo: string }).resumo ||
                        (s as { titulo: string }).titulo}
                    </span>
                    <button
                      className="mesa-btn mesa-btn--cheio"
                      disabled={!!acaoMsg[m.id]}
                      onClick={() =>
                        void aceitarAgendamento(
                          s as Parameters<typeof aceitarAgendamento>[0],
                          m.id,
                        )
                      }
                    >
                      {acaoMsg[m.id] === 'feita'
                        ? tr("Marcado ✓", "Scheduled ✓")
                        : acaoMsg[m.id] === 'indo'
                          ? tr("Marcando…", "Scheduling…")
                          : tr("Deixar marcado", "Schedule this")}
                    </button>
                  </div>
                )}
                {/* CHAT RICO (27/08): o cartão-mini da peça — um clique puxa o
                    painel dela pro lado (plano, cenas, resultado). */}
                {m.role !== 'user' && cartaoPeca && (
                  <button
                    type="button"
                    className="mesa-cartao mesa-cartao--peca"
                    onClick={() => void abrirMesa(cartaoPeca.slug)}
                  >
                    <Icone nome="estudio" tamanho={16} />
                    <span className="mesa-cartao__peca-texto">
                      <strong>{cartaoPeca.titulo}</strong>
                      <span>
                        {cartaoPeca.estado === 'gerada'
                          ? tr("gerada", "generated")
                          : cartaoPeca.estado === 'com plano'
                            ? tr("plano no Estúdio", "plan in Studio")
                            : tr("rascunho", "draft")}
                      </span>
                    </span>
                    <span className="mesa-cartao__peca-abrir">{tr("abrir →", "open →")}</span>
                  </button>
                )}
                {/* Respostas prontas: só na ÚLTIMA mensagem — chip de decisão
                    já respondida é botão que atrapalha. Toque = resposta. */}
                {m.role !== 'user' && eUltima && (chips?.length ?? 0) > 0 && (
                  <div className="mesa-partida mesa-partida--rente mesa-msg__chips">
                    {chips!.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="mesa-chip"
                        disabled={enviando}
                        onClick={() => void enviarConteudo(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {pensando && <div className="mesa-msg mesa-msg--ia mesa-pensando">…</div>}
          {acompanhamento}
          <div ref={fimRef} />
        </div>

        <footer className="mesa-escrever">
          {painel === 'maquinas' && (
            <div className="mesa-partida mesa-partida--rente">
              {[
                tr("Como gravo a chave da IA?", "How do I save the AI key?"),
                tr("Como convido alguém do time?", "How do I invite a teammate?"),
                tr("O que cada configuração faz?", "What does each setting do?"),
              ].map((h) => (
                <button key={h} className="mesa-chip" onClick={() => setTexto(h)}>
                  {h}
                </button>
              ))}
            </div>
          )}
          {painel === 'agenda' && (
            <div className="mesa-partida mesa-partida--rente">
              {[
                tr("Que trabalhos já rodam sozinhos aqui?", "Which tasks already run automatically here?"),
                tr("Preparar um post para toda segunda-feira", "Prepare a post every Monday"),
                tr("O que falhou na última execução automática?", "What failed in the last automatic run?"),
              ].map((h) => (
                <button key={h} className="mesa-chip" onClick={() => setTexto(h)}>
                  {h}
                </button>
              ))}
            </div>
          )}
          {painel === 'acervo' && (
            <div className="mesa-partida mesa-partida--rente">
              {[
                tr("Organiza e descreve o que eu te mandei", "Organize and describe the files I sent"),
                tr("Quais fotos da empresa temos no acervo?", "Which company photos are in the library?"),
                tr("O que ainda falta no acervo?", "What is still missing from the asset library?"),
              ].map((h) => (
                <button key={h} className="mesa-chip" onClick={() => setTexto(h)}>
                  {h}
                </button>
              ))}
            </div>
          )}
          {anexos.length > 0 && (
            <div className="mesa-anexos">
              {anexos.map((a) => (
                <span key={a.id} className={`mesa-anexo mesa-anexo--${a.estado}`}>
                  {a.nome}
                  {a.estado !== 'enviando' && (
                    <button
                      className="mesa-anexo__tirar"
                      disabled={anexosRemovendo.includes(a.id)}
                      aria-label={`Remover ${a.nome}`}
                      title={tr("Subiu errado? Tira daqui e da fila do acervo", "Uploaded by mistake? Remove it here and from the asset queue")}
                      onClick={() => void removerAnexo(a)}
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void enviar()
            }}
          >
            <input
              ref={arquivoRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void subirArquivos(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="mesa-icone"
              onClick={() => arquivoRef.current?.click()}
              title={tr("Anexar referência ou material", "Attach a reference or material")}
            >
              <Icone nome="anexo" />
            </button>
            {(partida?.voz_ditado ?? 'desligado') === 'ligado' && (
            <button
              type="button"
              className={`mesa-icone${gravando ? ' mesa-mic--gravando' : ''}`}
              onClick={() => void gravarVoz()}
              title={
                gravando
                  ? tr(`Gravando… ${segundosVoz}s — clique para parar`, `Recording… ${segundosVoz}s — click to stop`)
                  : transcrevendo
                    ? tr("Transcrevendo…", "Transcribing…")
                    : tr("Falar em vez de escrever", "Speak instead of typing")
              }
              aria-label={gravando ? tr("Parar a gravação", "Stop recording") : tr("Falar em vez de escrever", "Speak instead of typing")}
              aria-pressed={gravando}
            >
              <Icone nome="microfone" />
            </button>
            )}
            <textarea
              ref={campoRef}
              rows={1}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                // Enter manda; Shift+Enter quebra linha — a gramática de chat
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void enviar()
                }
              }}
              placeholder={
                painel === 'acervo'
                  ? tr("Mande arquivos que eu guardo e categorizo — ou pergunte pelo acervo…", "Send files for me to store and organize, or ask about the asset library…")
                  : tr("Peça a peça, ou cole a referência…", "Describe the deliverable, or paste a reference…")
              }
              aria-label={tr("Mensagem", "Message")}
            />
            <button type="submit" className="mesa-enviar" disabled={enviando} aria-label={tr("Enviar", "Send")}>
              <Icone nome="enviar" />
            </button>
          </form>
        </footer>
      </section>

      {/* ───────── a peça ───────── */}
      <aside
        className={`mesa-peca${pecaAberta || painel ? ' mesa-peca--aberta' : ''}`}
        aria-live="polite"
      >
        {(pecaAberta || painel) && (
          <div
            className="mesa-divisor"
            onMouseDown={iniciarArrasto}
            onDoubleClick={() => {
              setPecaLargura(null)
              setPecaLarga((v) => !v)
            }}
            title={tr("Arraste para ajustar a largura; duplo clique alterna", "Drag to resize; double-click to toggle")}
            aria-hidden
          />
        )}
        {painel === 'acervo' && (
          <div className="mesa-peca__rolagem">
            <header className="mesa-peca__topo">
              <div>
                <h3>{orgNome ? tr(`Acervo do ${capitalizar(orgNome)}`, `Asset library for ${capitalizar(orgNome)}`) : tr("Acervo", "Asset library")}</h3>
                <span className="mesa-peca__meta">
                  {contagemAcervo ? (
                    <>
                      {contagemAcervo.total}{' '}
                      {contagemAcervo.total === 1 ? tr("arquivo", "file") : tr("arquivos", "files")}
                      {contagemAcervo.aOrganizar > 0 && (
                        <em className="mesa-pendencia">
                          {' '}
                          · {contagemAcervo.aOrganizar} {tr("a organizar", "to organize")}</em>
                      )}
                    </>
                  ) : (
                    tr("abrindo…", "opening…")
                  )}
                </span>
              </div>
              <button className="mesa-icone" onClick={fecharMesa} aria-label={tr("Fechar", "Close")}>
                ✕
              </button>
            </header>

            {erroAcervo && <div role="alert" className="mesa-suave">{erroAcervo} <button className="mesa-link" onClick={() => void carregarAcervo().catch(() => {})}>{tr('Tentar novamente', 'Try again')}</button></div>}
            <blockquote className="mesa-trava-nota">
              {tr("Toda cena nasce presa a um arquivo daqui — a peça só usa o que está nestas pastas. Pessoas, produtos e marcas vêm dos arquivos originais.", "Every scene starts from a file here. The production uses these folders, preserving people, products and brands from the originals.")}</blockquote>

            <div className="mesa-vozes">
              <button
                className="mesa-chip"
                aria-current={pastaAtiva === 'acervo' || PASTAS_MIOLO.includes(pastaAtiva)}
                onClick={() => {
                  setPastaAtiva('acervo')
                  setSubAtiva(null)
                }}
              >
                {tr("Acervo", "Asset library")}{contagemAcervo ? ` · ${contagemAcervo.miolo}` : ''}
              </button>
              <button
                className="mesa-chip"
                aria-current={pastaAtiva === 'exemplos'}
                onClick={() => {
                  setPastaAtiva('exemplos')
                  setSubAtiva(null)
                }}
              >
                {tr("Referências", "References")}{contagemAcervo ? ` · ${contagemAcervo.referencias}` : ''}
              </button>
              <button
                className="mesa-chip"
                aria-current={pastaAtiva === 'aprovados'}
                onClick={() => {
                  setPastaAtiva('aprovados')
                  setSubAtiva(null)
                }}
              >
                {tr("Aprovados", "Approved")}{contagemAcervo ? ` · ${contagemAcervo.aprovados}` : ''}
              </button>
              <button
                className="mesa-chip"
                aria-current={pastaAtiva === 'entrada'}
                onClick={() => {
                  setPastaAtiva('entrada')
                  setSubAtiva(null)
                }}
              >
                {tr("Aguardando a IA", "Awaiting AI")}{contagemAcervo ? ` · ${contagemAcervo.aOrganizar}` : ''}
              </button>
            </div>
            {pastaAtiva !== 'acervo' && (
              <p className="mesa-suave">
                {subAtiva !== null ? (
                  <button className="mesa-acv-voltar" onClick={() => setSubAtiva(null)}>
                    ← {PASTAS_ACERVO.find((p) => p.chave === pastaAtiva)?.rotulo}
                  </button>
                ) : (
                  PASTAS_MIOLO.includes(pastaAtiva) && (
                    <button
                      className="mesa-acv-voltar"
                      onClick={() => {
                        setPastaAtiva('acervo')
                        setSubAtiva(null)
                      }}
                    >
                      {tr("← Acervo", "← Asset library")}</button>
                  )
                )}
                {subAtiva !== null
                  ? tr(`A pasta "${nomeDaSub(subAtiva)}" — organizada pela IA.`, `The “${nomeDaSub(subAtiva)}” folder, organized by AI.`)
                  : PASTAS_ACERVO.find((p) => p.chave === pastaAtiva)?.nota}
              </p>
            )}

            <div className="mesa-filtros">
              <input
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
                placeholder={tr("Filtrar por nome ou legenda…", "Filter by name or caption…")}
                aria-label={tr("Filtrar arquivos", "Filter files")}
              />
              <select
                className="mesa-filtro-periodo"
                value={filtroPeriodo}
                onChange={(e) => {
                  const p = e.target.value
                  setFiltroPeriodo(p)
                  const hoje = new Date()
                  if (p === 'sempre') {
                    setFiltroDe('')
                    setFiltroAte('')
                  } else if (p === 'hoje') {
                    setFiltroDe(isoLocal(hoje))
                    setFiltroAte(isoLocal(hoje))
                  } else if (p === '7d') {
                    const d = new Date(hoje)
                    d.setDate(d.getDate() - 6)
                    setFiltroDe(isoLocal(d))
                    setFiltroAte(isoLocal(hoje))
                  } else if (p === 'mes') {
                    setFiltroDe(isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1)))
                    setFiltroAte(isoLocal(hoje))
                  } else if (p === 'mespassado') {
                    setFiltroDe(isoLocal(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)))
                    setFiltroAte(isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 0)))
                  }
                  // 'datas' mantém o intervalo atual e mostra os dois campos
                }}
                aria-label={tr("Filtrar por período", "Filter by date range")}
              >
                <option value="sempre">{tr("Qualquer data", "Any date")}</option>
                <option value="hoje">{tr("Hoje", "Today")}</option>
                <option value="7d">{tr("Últimos 7 dias", "Last 7 days")}</option>
                <option value="mes">{tr("Este mês", "This month")}</option>
                <option value="mespassado">{tr("Mês passado", "Last month")}</option>
                <option value="datas">{tr("Escolher datas…", "Choose dates…")}</option>
              </select>
              {filtroPeriodo === 'datas' && (
                <>
                  <label>
                    {tr("de", "from")}<input
                      type="date"
                      value={filtroDe}
                      onChange={(e) => setFiltroDe(e.target.value)}
                      aria-label={tr("A partir de", "From")}
                    />
                  </label>
                  <label>
                    {tr("até", "to")}<input
                      type="date"
                      value={filtroAte}
                      onChange={(e) => setFiltroAte(e.target.value)}
                      aria-label={tr("Até", "To")}
                    />
                  </label>
                </>
              )}
              <input
                ref={uploadPastaRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) void subirNoAcervo(e.target.files)
                  e.target.value = ''
                }}
              />
              {pastaAtiva !== 'acervo' && (
                <button
                  className="mesa-btn mesa-btn--cheio"
                  onClick={() => uploadPastaRef.current?.click()}
                >
                  {tr("Subir nesta pasta", "Upload to this folder")}</button>
              )}
            </div>

            {(pastaAtiva === 'acervo'
              ? PASTAS_ACERVO.filter((p) => PASTAS_MIOLO.includes(p.chave))
              : PASTAS_ACERVO.filter((p) => p.chave === pastaAtiva)
            ).flatMap((p) => {
              const arquivos = (acervo?.[p.chave] || []).filter((a) => {
                // O brasão vive na pasta da marca por armazenamento, mas é
                // IDENTIDADE (Sala das máquinas), não material de peça — a
                // listagem do acervo não o mostra.
                if (/^brasao\.(png|jpe?g|webp|svg)$/i.test(a.nome)) return false
                const t = filtroTexto.trim().toLowerCase()
                if (
                  t &&
                  !a.nome.toLowerCase().includes(t) &&
                  !(a.legenda || '').toLowerCase().includes(t)
                )
                  return false
                const quando = (a.modificado_em || '').slice(0, 10)
                if (filtroDe && quando && quando < filtroDe) return false
                if (filtroAte && quando && quando > filtroAte) return false
                return true
              })
              // As SEÇÕES da pasta: a raiz e cada subpasta que a IA criou.
              const porSub = new Map<string, ArquivoAcervo[]>()
              for (const a of arquivos) {
                const chaveSub = a.sub || ''
                porSub.set(chaveSub, [...(porSub.get(chaveSub) || []), a])
              }
              if (!porSub.has('')) porSub.set('', [])
              let subs = [...porSub.keys()].sort((x, y) =>
                x === '' ? -1 : y === '' ? 1 : x.localeCompare(y, 'pt-BR'),
              )
              if (subAtiva !== null && pastaAtiva !== 'acervo') subs = [subAtiva]
              return subs.map((sub) => {
                const lista = porSub.get(sub) || []
                const noAcervo = pastaAtiva === 'acervo'
                const empilhada = noAcervo || subAtiva === null
                const rotuloSecao = sub === '' ? p.rotulo : nomeDaSub(sub)
                return (
                  <div key={`${p.chave}//${sub}`} className="mesa-acv-bloco">
                    {empilhada && (
                      <div className="mesa-acv-bloco__topo">
                        <h4>
                          <button
                            className={`mesa-acv-abrir${sub ? ' mesa-acv-abrir--sub' : ''}`}
                            onClick={() => {
                              setPastaAtiva(p.chave)
                              setSubAtiva(sub || null)
                            }}
                            title={`Abrir ${rotuloSecao}`}
                          >
                            {rotuloSecao} <span aria-hidden>›</span>
                          </button>
                        </h4>
                        <span>
                          {lista.length === 1 ? tr("1 arquivo", "1 file") : tr(`${lista.length} arquivos`, `${lista.length} files`)}
                        </span>
                      </div>
                    )}
                    <div className="mesa-acv-grid">
                      {lista.map((a) => (
                        <div
                          key={`${a.sub || ''}/${a.nome}`}
                          className="mesa-acv-item"
                          title={a.legenda || a.nome}
                        >
                          {E_IMAGEM.test(a.nome) ? (
                            <ThumbAcervo
                              orgId={orgId}
                              slug={slug}
                              pasta={p.chave}
                              nome={a.nome}
                              sub={a.sub || ''}
                            />
                          ) : (
                            <div className="mesa-quadro mesa-quadro--vazio mesa-acv-doc">
                              <Icone nome="entregas" />
                            </div>
                          )}
                          <span className="mesa-acv-nome">{a.nome}</span>
                          {a.modificado_em && (
                            <span className="mesa-acv-quando">{tempoRelativo(a.modificado_em, idioma)}</span>
                          )}
                          <button
                            className="mesa-acv-excluir"
                            aria-label={`Excluir ${a.nome}`}
                            onClick={() => void excluirDoAcervo(p.chave, a.nome, a.sub || '')}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      {!lista.length && acervo && (
                        <p className="mesa-suave">{tr("Nada aqui ainda.", "Nothing here yet.")}</p>
                      )}
                    </div>
                    {noAcervo && sub === '' && (
                      <p className="mesa-suave mesa-acv-nota">{p.nota}</p>
                    )}
                  </div>
                )
              })
            })}
            {pastaAtiva === 'acervo' &&
              acervo &&
              !PASTAS_ACERVO.some((p) => (acervo[p.chave] || []).length > 0) && (
                <p className="mesa-suave">
                  {tr("Acervo vazio — me mande os arquivos NA CONVERSA que eu guardo, descrevo e organizo nas pastas. O botão de subir é o atalho para quando você já sabe o destino.", "The asset library is empty. Send files in the conversation and I will store, describe, and organize them. Use Upload when you already know the folder.")}</p>
              )}
          </div>
        )}

        {painel === 'dashboard' && (
          <div className="mesa-peca__rolagem">
            <header className="mesa-peca__topo">
              <div>
                <h3>Dashboard</h3>
                <span className="mesa-peca__meta">{dash?.mes ? new Date(dash.mes).toLocaleDateString(idioma, { month: 'long', year: 'numeric' }) : tr("abrindo…", "opening…")}</span>
              </div>
              <button className="mesa-icone" onClick={fecharMesa} aria-label={tr("Fechar", "Close")}>
                ✕
              </button>
            </header>

            {dash && (
              <>
                <div className="mesa-tempo-ganho">
                  <strong>
                    ~{dash.horasGanhas}h
                  </strong>
                  <span>
                    {tr("de trabalho que você não precisou fazer este mês — na régua de ", "of work saved this month, estimated at ")}{HORAS_POR_PECA}{tr("h por peça aprovada entregue no mês. É uma referência fixa de planejamento, não uma medição do seu tempo.", "h per approved deliverable delivered this month. This is a fixed planning estimate, not a measurement of your time.")}</span>
                </div>

                <div className="mesa-stats">
                  <div className="mesa-stat">
                    <strong>{dash.entreguesNoMes}</strong>
                    <span>{tr("peças entregues no mês", "deliverables this month")}</span>
                  </div>
                  <div className="mesa-stat">
                    <strong>{dash.aprovadasNoMes}</strong>
                    <span>{tr("aprovadas por você", "approved by you")}</span>
                  </div>
                  <div className="mesa-stat">
                    <strong>{dash.aguardando}</strong>
                    <span>{tr("esperando o seu OK", "awaiting your approval")}</span>
                  </div>
                  <div className="mesa-stat">
                    <strong>{dash.recusadasNoMes}</strong>
                    <span>{tr("recusadas — cada uma virou lição", "rejected, each saved as a lesson")}</span>
                  </div>
                  <div className="mesa-stat">
                    <strong>{dash.emVoo}</strong>
                    <span>{tr("trabalhando agora", "in progress now")}</span>
                  </div>
                </div>

                {dash.aguardando > 0 && (
                  <button className="mesa-btn mesa-btn--cheio" onClick={abrirEntregas}>
                    {tr("Decidir as ", "Review the ")}{dash.aguardando} {tr("pendentes", "pending items")}</button>
                )}

                {/* Comentários ancorados no "Como foi feita" (07/09/2026): o
                    que o dono apontou no fluxo e ainda não virou tarefa nem
                    lição — a porta para o ponto exato mora aqui. */}
                <ComentariosAbertosMesa
                  orgId={orgId}
                  slug={slug}
                  aoVerPeca={aoVerEstudio ? (p) => aoVerEstudio(p) : undefined}
                  aoVerTrabalho={aoVerFluxo}
                />
              </>
            )}
          </div>
        )}

        {painel === 'maquinas' && (
          <div className="mesa-peca__rolagem">
            <header className="mesa-peca__topo">
              <div>
                <h3>{tr("Sala das máquinas", "Settings")}</h3>
                <span className="mesa-peca__meta">
                  {tr("chave da IA, time, notificações — pergunte no chat se travar", "AI key, team, and notifications. Ask in chat if you get stuck")}</span>
              </div>
              <button className="mesa-icone" onClick={fecharMesa} aria-label={tr("Fechar", "Close")}>
                ✕
              </button>
            </header>
            <div className="mesa-aparencia">
              <span>{tr("Tema da tela — claro ou escuro", "Screen theme — light or dark")}</span>
              <ToggleTema />
            </div>
            <ConfigOrgCorpo orgId={orgId} embutido />
          </div>
        )}

        {painel === 'agenda' && (
          <div className="mesa-peca__rolagem">
            <header className="mesa-peca__topo">
              <div>
                <h3>{tr("Agenda", "Schedule")}</h3>
                <span className="mesa-peca__meta">
                  {tr("o que roda sozinho, no dia e na hora combinados", "work that runs automatically at the agreed date and time")}</span>
              </div>
              <button className="mesa-icone" onClick={fecharMesa} aria-label={tr("Fechar", "Close")}>
                ✕
              </button>
            </header>
            {/* O MESMO componente da shell, embutido — agendamento tem regra
                (recorrência, catch-up, marca de execução) e duplicá-la aqui
                seria criar a segunda verdade. `podeEditar` segue o mesmo
                portão da Sala das máquinas: quem não é owner/admin acompanha. */}
            <AgendaTab
              orgId={orgId}
              slug={slug}
              office={office}
              podeEditar={Boolean(configHref)}
            />
          </div>
        )}

        {painel === 'entregas' && (
          <div className="mesa-peca__rolagem">
            <header className="mesa-peca__topo">
              <div>
                <h3>{tr("Entregas", "Deliverables")}</h3>
                <span className="mesa-peca__meta">
                  {slug === 'conteudo' ? tr("Pautas, revisões e kits de publicação", "Briefs, revisions, and publishing kits") : entregas
                    ? tr(`${new Set(entregas.filter((e) => e.status === 'pendente').map((e) => e.job_id)).size} esperando o seu OK`, `${new Set(entregas.filter((e) => e.status === 'pendente').map((e) => e.job_id)).size} awaiting your approval`)
                    : tr("abrindo…", "opening…")}
                </span>
              </div>
              <button className="mesa-icone" onClick={fecharMesa} aria-label={tr("Fechar", "Close")}>
                ✕
              </button>
            </header>

            {erroEntregas && <div role="alert" className="mesa-suave">{erroEntregas} <button className="mesa-link" onClick={() => void carregarEntregas().catch(() => {})}>{tr('Tentar novamente', 'Try again')}</button></div>}
            {slug === 'conteudo' && <ConteudoEditorial key={orgId} orgId={orgId} aoMudar={() => void carregarEntregas().catch(() => {})} />}

            {(['pendente', 'aprovada'] as const).map((st) => {
              const grupo = (entregas || []).filter((e) => e.status === st && !e.editorial_peca_id)
              if (!grupo.length) return null
              return (
                <div key={st} className="mesa-falta">
                  <div className="mesa-secao">
                    <h4>{st === 'pendente' ? tr("Esperando o seu OK", "Awaiting your approval") : tr("Aprovadas", "Approved")}</h4>
                    {/* conta TRABALHOS, como a placa — não arquivos */}
                    <span className="mesa-suave">{new Set(grupo.map((e) => e.job_id)).size}</span>
                  </div>
                  {/* UM CARTÃO POR TRABALHO (08/09/2026 — "a gaveta não tá
                      poluída?"): a peça principal aberta, as ações uma vez
                      só (Aprovar já era do trabalho inteiro) e os outros
                      arquivos recolhidos. Antes, 81 linhas para ~20 trabalhos,
                      cada uma com cinco ações e prévias de HTML capturando a
                      rolagem. */}
                  {agruparGaveta(grupo, tr).map((t) => {
                    const peca = pecaDoTrabalhoGaveta(t.todos)
                    const principal = t.principal
                    return (
                      <div key={t.jobId} className="mesa-entrega mesa-entrega--trabalho">
                        {principal && (
                          <ResultadoEntrega
                            entregaId={principal.id}
                            nome={principal.nome}
                            mime={principal.mime}
                            tamanhoBytes={principal.tamanho_bytes}
                          />
                        )}
                        <div className="mesa-entrega__info">
                          <strong>{t.titulo}</strong>
                          <span className="mesa-suave">
                            {principal ? principal.tipo || 'arquivo' : tr("sem arquivo principal", "no primary file")}
                            {t.criadoEm ? ` · ${tempoRelativo(t.criadoEm, idioma)}` : ''}
                            {t.total > 1 ? tr(` · ${t.total} arquivos`, ` · ${t.total} files`) : ''}
                            {t.etiqueta ? ` · ${t.etiqueta}` : ''}
                          </span>
                        </div>
                        {principal && (
                          <button
                            className="mesa-link"
                            onClick={() =>
                              void baixarArquivo(`/entregas/${principal.id}/download`, principal.nome).catch(() =>
                                falha(tr("Não deu para baixar", "Could not download")),
                              )
                            }
                          >
                            {tr("Baixar", "Download")}</button>
                        )}
                        {principal && (
                          <button
                            className="mesa-link"
                            title={tr("Abre um chat novo já vinculado a esta entrega", "Open a new conversation linked to this deliverable")}
                            onClick={() => void conversarSobreEntrega(principal)}
                          >
                            {tr("Conversar", "Discuss")}</button>
                        )}
                        {peca && aoVerEstudio ? (
                          <button
                            className="mesa-link"
                            title={tr("O que entrou em cada cena, o prompt e o pensamento — no Estúdio", "Sources, prompts, and reasoning for each scene in the Studio")}
                            onClick={() => aoVerEstudio(peca, t.jobId)}
                          >
                            {tr("Como foi feita", "How it was made")}</button>
                        ) : aoVerFluxo ? (
                          <button
                            className="mesa-link"
                            title={tr("O que entrou, o prompt e o pensamento — no Estúdio", "Sources, prompts, and reasoning in the Studio")}
                            onClick={() => aoVerFluxo(t.jobId)}
                          >
                            {tr("Como foi feita", "How it was made")}</button>
                        ) : null}
                        {st === 'pendente' && (
                          <>
                            <button
                              className="mesa-btn"
                              title={t.total > 1 ? tr(`Aprova os ${t.total} arquivos desta entrega`, `Approve all ${t.total} files in this deliverable`) : undefined}
                              onClick={() => void aprovarEntregasDoJob(t.jobId)}
                            >
                              {tr("Aprovar", "Approve")}</button>
                            {principal && (
                              <button
                                className="mesa-link mesa-link--recusa"
                                onClick={() => void recusarEntrega(principal.id)}
                              >
                                {tr("Recusar", "Reject")}</button>
                            )}
                          </>
                        )}
                        {t.outros.length > 0 && (
                          <details className="mesa-entrega__outros">
                            <summary>
                              {t.outros.length === 1 ? tr("mais 1 arquivo", "1 more file") : tr(`mais ${t.outros.length} arquivos`, `${t.outros.length} more files`)} {tr("desta entrega", "in this deliverable")}</summary>
                            <ul>
                              {t.outros.map((o) => (
                                <li key={o.id}>
                                  <span className="mesa-entrega__outro-nome">{o.nome}</span>
                                  <span className="mesa-suave">{o.tipo || 'arquivo'}</span>
                                  <button
                                    className="mesa-link"
                                    onClick={() =>
                                      void baixarArquivo(`/entregas/${o.id}/download`, o.nome).catch(() =>
                                        falha(tr("Não deu para baixar", "Could not download")),
                                      )
                                    }
                                  >
                                    {tr("Baixar", "Download")}</button>
                                  {st === 'pendente' && (
                                    <button
                                      className="mesa-link mesa-link--recusa"
                                      onClick={() => void recusarEntrega(o.id)}
                                    >
                                      {tr("Recusar", "Reject")}</button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {slug !== 'conteudo' && entregas && !entregas.length && (
              <p className="mesa-suave">
                {tr("Nenhuma entrega ainda — a primeira nasce do primeiro trabalho aprovado na Mesa.", "No deliverables yet. The first comes from the first task approved at the Desk.")}</p>
            )}
          </div>
        )}

        {pecaAberta && (
          <div className="mesa-peca__rolagem">
            <header className="mesa-peca__topo">
              <div>
                <h3>{mesa?.titulo ?? tr("Abrindo…", "Opening…")}</h3>
                {mesa && (
                  <span className="mesa-peca__meta">
                    {mesa.cenas.length} {tr("cenas", "scenes")}{mesa.dur_total ? ` · ${String(mesa.dur_total).replace('.', ',')}s` : ''}
                    {mesa.proporcoes?.length
                      ? tr(` · ${mesa.proporcoes.length + 1} proporções`, ` · ${mesa.proporcoes.length + 1} aspect ratios`)
                      : ''}
                    {mesa.molde ? ` · ${mesa.molde.split('@')[0]}` : ''}
                    {emVoo ? tr(" · gerando", " · generating") : mesa.tem_plano ? tr(" · plano", " · plan") : ''}
                  </span>
                )}
              </div>
              <button
                className="mesa-icone"
                title={pecaLarga ? tr("Largura normal", "Normal width") : tr("Alargar o painel", "Widen panel")}
                aria-label={pecaLarga ? tr("Largura normal", "Normal width") : tr("Alargar o painel", "Widen panel")}
                onClick={() => {
                  setPecaLargura(null)
                  setPecaLarga((v) => !v)
                }}
              >
                <Icone nome={pecaLarga ? 'contrair' : 'expandir'} />
              </button>
              {mesa && aoVerEstudio && (
                <button
                  className="mesa-icone"
                  title={tr("Abrir no Estúdio (bastidor)", "Open in Studio (production details)")}
                  onClick={() => aoVerEstudio(mesa.slug)}
                >
                  <Icone nome="estudio" />
                </button>
              )}
              <button className="mesa-icone" onClick={fecharMesa} aria-label={tr("Fechar", "Close")}>
                ✕
              </button>
            </header>

            {!mesa && <p className="mesa-suave">{tr("Abrindo…", "Opening…")}</p>}
            {mesa && (
              <>

            {emVoo && (
              <div className="mesa-gerando">
                <span className="mesa-gerando__barra" />
                <p>
                  {tr("Gerando — só o que o plano aprovou. O desfecho volta na conversa e a crítica aparece aqui.", "Generating only what the plan approved. The outcome returns to the conversation, and the review appears here.")}</p>
              </div>
            )}

            {mesa.referencia && (
              <div className="mesa-ref">
                <div className="mesa-ref__fonte">
                  <Icone nome="fluxo" />
                  <strong>{mesa.referencia.fonte || tr("referência", "reference")}</strong>
                </div>
                <dl>
                  {mesa.referencia.de_onde && (
                    <>
                      <dt>{tr("de onde veio", "source")}</dt>
                      <dd>{mesa.referencia.de_onde}</dd>
                    </>
                  )}
                  {mesa.referencia.copiei && (
                    <>
                      <dt>{tr("copiei", "used")}</dt>
                      <dd>{mesa.referencia.copiei}</dd>
                    </>
                  )}
                  {mesa.referencia.recusei && (
                    <>
                      <dt>{tr("recusei", "rejected")}</dt>
                      <dd>{mesa.referencia.recusei}</dd>
                    </>
                  )}
                  {mesa.referencia.acrescentei && (
                    <>
                      <dt>{tr("acrescentei", "added")}</dt>
                      <dd>{mesa.referencia.acrescentei}</dd>
                    </>
                  )}
                </dl>
              </div>
            )}

            <div className="mesa-origens">
              {mesa.origem_resumo.acervo > 0 && (
                <span className="mesa-origem mesa-origem--acervo">
                  {mesa.origem_resumo.acervo} {tr("do acervo", "from the asset library")}</span>
              )}
              {mesa.origem_resumo.mix > 0 && (
                <span className="mesa-origem mesa-origem--mix">
                  {mesa.origem_resumo.mix} {tr("acervo + IA", "assets + AI")}</span>
              )}
              {mesa.origem_resumo.gerada > 0 && (
                <span className="mesa-origem mesa-origem--gerada">
                  {mesa.origem_resumo.gerada} {tr("gerada", "generated")}{mesa.origem_resumo.gerada > 1 ? 's' : ''}
                </span>
              )}
              {(mesa.origem_resumo.codigo ?? 0) > 0 && (
                <span className="mesa-origem mesa-origem--codigo">
                  {mesa.origem_resumo.codigo} {tr("por código", "from code")}</span>
              )}
              {(mesa.origem_resumo.slot ?? 0) > 0 && (
                <span className="mesa-origem mesa-origem--slot">
                  {mesa.origem_resumo.slot} slot{(mesa.origem_resumo.slot ?? 0) > 1 ? 's' : ''} {tr("aberto", "open")}{(mesa.origem_resumo.slot ?? 0) > 1 ? 's' : ''}
                </span>
              )}
              {mesa.custo_pendente != null && mesa.custo_pendente > 0 && !custoMesaExterno && (
                <span className="mesa-origem mesa-origem--custo">
                  US$ {mesa.custo_pendente.toFixed(2)} {tr("a gerar", "to generate")}</span>
              )}
            </div>

            {custoMesaIndisponivel ? <p role="alert"><strong>{tr('Custo indisponível', 'Cost unavailable')}</strong> · {mesa.aviso_custo_consulta || tr('Não foi possível conferir o custo. Atualize o plano para tentar novamente.', 'Could not check the cost. Refresh the plan to try again.')} <button type="button" className="mesa-link" onClick={() => void abrirMesa(mesa.slug)}>{tr('Atualizar o plano', 'Refresh plan')}</button></p> : custoMesaExterno && <p role="status"><strong>{tr('Estimativa fal.ai:', 'fal.ai estimate:')} US$ {mesa.custo_pendente!.toLocaleString(idioma, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> · {mesa.aviso_custo_externo || tr('Há custo externo não estimado. O valor não é o custo total.', 'There is an unestimated external cost. This amount is not the total cost.')} {' '}{(mesa.orcamento?.teto_usd ?? 0) > 0 ? tr('A equipe precisa conferir esse custo antes de começar.', 'The team needs to check this cost before starting.') : tr('Teto zero não limita o gasto. Confira a autorização da conexão antes de gerar.', 'A zero budget does not limit spending. Check the connection’s authorization before generating.')}</p>}
            {mesa.pendencias?.length ? <ul>{mesa.pendencias.map((p, i) => <li key={`pendencia-${i}`}>{p}</li>)}</ul> : null}

            {/* o rodapé de produção da tela-alvo: o que sai de onde e quanto
                tempo leva — verdade do motor, só exibida */}
            {mesa.contagens && (mesa.contagens.geracoes_imagem || mesa.contagens.renders_video || mesa.estimativa_min) ? (
              <p className="mesa-producao">
                {[
                  mesa.contagens.acervo ? tr(`${mesa.contagens.acervo} arquivo${mesa.contagens.acervo > 1 ? 's' : ''} do acervo`, `${mesa.contagens.acervo} file${mesa.contagens.acervo > 1 ? 's' : ''} from the asset library`) : null,
                  mesa.contagens.geracoes_imagem ? tr(`${mesa.contagens.geracoes_imagem} geraç${mesa.contagens.geracoes_imagem > 1 ? 'ões' : 'ão'} de imagem`, `${mesa.contagens.geracoes_imagem} image generation${mesa.contagens.geracoes_imagem > 1 ? 's' : ''}`) : null,
                  mesa.contagens.renders_video ? tr(`${mesa.contagens.renders_video} render${mesa.contagens.renders_video > 1 ? 's' : ''} de vídeo`, `${mesa.contagens.renders_video} video render${mesa.contagens.renders_video > 1 ? 's' : ''}`) : null,
                  mesa.estimativa_min ? `~${mesa.estimativa_min} min` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}

            {/* o aviso pedagógico do mockup — só enquanto é plano */}
            {!emVoo &&
              mesa.cenas.some((c) => c.gera) &&
              !mesa.cenas.some((c) => c.thumb || c.video) && (
              <p className="mesa-aviso-plano">
                <strong>{tr("Nada foi gerado ainda.", "Nothing has been generated yet.")}</strong> {tr("Isto é o plano — as cenas em cinza não existem. Clique em qualquer uma para ver a direção e de onde vai sair o material.", "This is the plan. The gray scenes do not exist yet. Click one to see its direction and where its material will come from.")}</p>
            )}

            {/* a cena aberta */}
            {cena ? (
              <div className="mesa-cena-aberta">
                <div className="mesa-cena-aberta__midia">
                  {cena.thumb ? (
                    <Thumb base={`${baseEstudio}/pecas/${mesa.slug}`} caminho={cena.thumb} />
                  ) : (
                    <div className="mesa-quadro mesa-quadro--plano">
                      <span>{cena.rotulo}</span>
                    </div>
                  )}
                </div>
                <div className="mesa-cena-aberta__corpo">
                  <h4>{cena.rotulo}</h4>
                  <span className={`mesa-origem mesa-origem--${cena.origem}`}>
                    {ORIGEM_ROTULO[cena.origem]}
                  </span>
                  {cena.roteiro && <p>{cena.roteiro}</p>}
                  {cena.nota_origem && <p className="mesa-suave">{cena.nota_origem}</p>}
                  {cena.material.length > 0 ? (
                    <div className="mesa-materiais">
                      <span className="mesa-rotulo">{tr("Material que vai usar", "Materials to use")}</span>
                      {cena.material.map((mt) => (
                        <button
                          key={mt.caminho}
                          type="button"
                          className={`mesa-material${mt.existe ? '' : ' mesa-material--falta'}`}
                          title={mt.legenda || mt.caminho}
                          disabled={!mt.existe}
                          onClick={() => void abrirFonte(mesa.slug, mt.caminho)}
                        >
                          {mt.nome}
                          {!mt.existe && tr(" — não está no acervo", " — not in the asset library")}
                        </button>
                      ))}
                      {!emVoo && (
                        <button className="mesa-link" onClick={() => void abrirTrocaMaterial()}>
                          {tr("Trocar material", "Replace material")}</button>
                      )}
                    </div>
                  ) : (
                    <p className="mesa-suave">{tr("Nada do acervo — esta cena é feita por código.", "No library assets. This scene is created with code.")}</p>
                  )}
                  {trocandoMaterial && (
                    <div className="mesa-troca">
                      {erroMateriais ? <div role="alert" className="mesa-suave">{erroMateriais} <button className="mesa-link" onClick={() => void abrirTrocaMaterial()}>{tr('Tentar novamente', 'Try again')}</button></div> : acervoOpcoes.length ? (
                        acervoOpcoes.map((o) => (
                          <button
                            key={o.caminho}
                            className="mesa-troca__opcao"
                            disabled={gerando}
                            onClick={() => void trocarMaterial(o.caminho)}
                          >
                            {o.nome}
                          </button>
                        ))
                      ) : (
                        <p className="mesa-suave">
                          {tr("Nada aproveitável no acervo — suba um arquivo pela conversa.", "No usable assets. Upload a file in the conversation.")}</p>
                      )}
                    </div>
                  )}
                  <button className="mesa-link" onClick={() => setCenaAberta(null)}>
                    {tr("← voltar", "← back")}</button>
                </div>
              </div>
            ) : null}

            {/* a tira de cenas */}
            <div className="mesa-cenas">
              {mesa.cenas.map((c) => (
                <button
                  key={c.id}
                  className="mesa-cena"
                  aria-current={c.id === cenaAberta}
                  onClick={() => {
                    setCenaAberta(c.id)
                    setTrocandoMaterial(false)
                  }}
                >
                  {c.thumb ? (
                    <Thumb base={`${baseEstudio}/pecas/${mesa.slug}`} caminho={c.thumb} />
                  ) : (
                    <div className={`mesa-quadro${c.gera ? ' mesa-quadro--plano' : ''}`}>
                      <span>{c.rotulo}</span>
                    </div>
                  )}
                  <span className={`mesa-cena__origem mesa-origem--${c.origem}`}>
                    {ORIGEM_ROTULO[c.origem]}
                  </span>
                  {faixaDaCena(c, idioma) && (
                    <span className="mesa-cena__tempo">{faixaDaCena(c, idioma)}</span>
                  )}
                  <span className="mesa-cena__rotulo">{c.roteiro || c.rotulo}</span>
                  {(c.fontes?.[0] || c.material[0]) && (
                    <span className="mesa-cena__fonte" title={c.fontes?.[0] || c.material[0]?.caminho}>
                      {(c.fontes?.[0] || c.material[0]?.caminho || '').split('/').pop()}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* o que falta */}
            {mesa.falta.length > 0 && (
              <div className="mesa-falta">
                <div className="mesa-secao">
                  <h4>{tr("O que falta para começar", "What is needed to start")}</h4>
                  <span className="mesa-suave">
                    {mesa.travas_abertas > 0
                      ? tr(`${mesa.travas_abertas} impede${mesa.travas_abertas > 1 ? 'm' : ''}`, `${mesa.travas_abertas} blocker${mesa.travas_abertas > 1 ? 's' : ''}`)
                      : tr("nada impede", "no blockers")}
                  </span>
                </div>
                {mesa.falta.map((f, i) => (
                  <div
                    key={i}
                    className={`mesa-item${f.trava && !f.resolvido ? ' mesa-item--trava' : ''}${f.resolvido ? ' mesa-item--ok' : ''}`}
                  >
                    <strong>{f.item}</strong>
                    {f.porque && <p>{f.porque}</p>}
                    {f.se_nao_vier && (
                      <p className="mesa-suave">
                        <b>{tr("se não vier:", "if unavailable:")}</b> {f.se_nao_vier}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {mesa.revisao_automatica && <div className="mesa-falta">
              <div className="mesa-secao"><h4>{tr('Conferência dos arquivos entregues', 'Review of delivered files')}</h4></div>
              <p>{({
                em_fila: tr('A revisão está na fila do motor.', 'The review is queued on the engine.'),
                em_revisao: tr('Os arquivos estão sendo examinados em uma execução separada.', 'Files are being examined in a separate run.'),
                conferida: tr('A revisão terminou com evidências registradas.', 'The review finished with recorded evidence.'),
                parcial: tr('Parte do resultado ainda não pôde ser conferida.', 'Part of the result could not be reviewed.'),
                pendente: tr('A revisão encontrou correções necessárias.', 'The review found required corrections.'),
                indisponivel: tr('A revisão não terminou. As entregas estão preservadas.', 'The review did not finish. Deliveries are preserved.'),
              } as Record<string, string>)[mesa.revisao_automatica.estado] || mesa.revisao_automatica.estado}</p>
              {mesa.revisao_automatica.avisos.map((aviso, i) => <p key={i}>{aviso}</p>)}
              {mesa.revisao_automatica.correcao_job_id && <p>{tr('A correção está ligada ao trabalho', 'The correction is linked to job')} #{mesa.revisao_automatica.correcao_job_id}.</p>}
              {mesa.revisao_automatica.arquivos?.map(a => <details className="mesa-item" key={a.entrega_id}>
                <summary>{a.nome} · {a.estado === 'conferido' ? tr('conferido', 'reviewed') : tr('ver limites e achados', 'see limits and findings')}</summary>
                <p>{a.detalhe}</p>{a.evidencias.map((v, i) => <p key={i}>{v}</p>)}
              </details>)}
              <p className="mesa-suave">{mesa.revisao_automatica.limites}</p>
              {mesa.job_ativo?.status === 'done' && !['em_fila', 'em_revisao'].includes(mesa.revisao_automatica.estado) && <button disabled={gerando} onClick={() => void revisarArquivos()}>{tr('Conferir novamente', 'Review again')}</button>}
            </div>}

            {/* A crítica declarada na montagem permanece separada do laudo dos arquivos. */}
            {mesa.critica && mesa.critica.itens.length > 0 && (
              <div className="mesa-falta">
                <div className="mesa-secao">
                  <h4>{tr("O que ainda não está profissional", "What still needs improvement")}</h4>
                  {mesa.critica.por && <span className="mesa-suave">{mesa.critica.por}</span>}
                </div>
                {mesa.critica.itens.map((c, i) => (
                  <div
                    key={i}
                    className={`mesa-item mesa-item--${c.gravidade}${c.resolvido ? ' mesa-item--ok' : ''}`}
                  >
                    <strong>
                      {c.cena ? `${c.cena} — ` : ''}
                      {c.achado}
                    </strong>
                    {c.correcao && <p>{c.correcao}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* narração */}
            {(mesa.narracao.vozes.length > 0 || mesa.narracao.texto || mesa.narracao.porta_voz || mesa.narracao.voz_direta) && (
              <div className="mesa-falta">
                <div className="mesa-secao">
                  <h4>{tr("Narração", "Narration")}</h4>
                  <span className="mesa-suave">
                    {mesa.narracao.voz_direta ? tr('Voz selecionada', 'Selected voice') : mesa.narracao.porta_voz || (mesa.narracao.texto ? tr('Voz padrão', 'Default voice') : tr('Sem narração', 'No narration'))}
                  </span>
                </div>
                <div className="mesa-vozes">
                  <button
                    className="mesa-chip"
                    aria-current={!mesa.narracao.porta_voz && !mesa.narracao.texto ? true : undefined}
                    disabled={narrSalvando || !!emVoo}
                    title={tr("Desliga a narração desta peça", "Turn off narration for this production")}
                    onClick={() => void salvarNarracao({ ligada: false }, tr('Narração desligada', 'Narration turned off'))}
                  >
                    {tr("Sem narração", "No narration")}</button>
                  {mesa.narracao.texto && !mesa.narracao.voz_direta && <button
                    className="mesa-chip"
                    aria-current={!mesa.narracao.porta_voz ? true : undefined}
                    disabled={narrSalvando || !!emVoo}
                    title={tr('Usa a voz padrão com o texto desta peça', 'Use the default voice with this production’s text')}
                    onClick={() => void salvarNarracao({ ligada: true, porta_voz: '' }, tr('Narração com voz padrão', 'Narration with the default voice'))}
                  >{tr('Voz padrão', 'Default voice')}</button>}
                  {mesa.narracao.vozes.map((v) => (
                    <button
                      key={v.nome}
                      className="mesa-chip"
                      aria-current={v.nome === mesa.narracao.porta_voz}
                      disabled={narrSalvando || !!emVoo}
                      title={v.pronta ? tr("Grava esta voz na peça", "Save this voice for the production") : tr("Sem voz clonada ainda — clique e eu te digo como criar", "No cloned voice yet. Click and I will explain how to create one")}
                      onClick={() => {
                        if (!v.pronta) {
                          setTexto(tr(`Clona a voz de ${v.nome} para a narração — me diz o que você precisa de mim (áudio ou vídeo falando).`, `Clone ${v.nome}’s voice for narration. Tell me what you need from me (an audio or video recording of them speaking).`))
                          return
                        }
                        void salvarNarracao({ porta_voz: v.nome }, tr(`Narração com ${v.nome}`, `Narration by ${v.nome}`))
                      }}
                    >
                      {v.nome}
                      {!v.pronta && tr(" ·  sem voz", " · no voice")}
                    </button>
                  ))}
                </div>
                {mesa.narracao.texto && <p className="mesa-script">“{mesa.narracao.texto}”</p>}
              </div>
            )}

            {/* o portão */}
            {!emVoo && (
              <div className="mesa-portao">
                {mesa.tem_plano ? (
                  <>
                    <button
                      className="mesa-btn mesa-btn--cheio"
                      disabled={!mesa.pode_gerar || gerando || custoMesaBloqueia}
                      onClick={() => void gerar()}
                      title={
                        mesa.pode_gerar
                          ? tr("Cria o trabalho de render — nada além do plano", "Create the render task, using only the plan")
                          : tr("Uma pendência vermelha impede começar", "A red blocker prevents starting")
                      }
                    >
                      {tr("Pode gerar", "Approve generation")}</button>
                    <button className="mesa-link" onClick={pedirPlano}>
                      {tr("Mudar o plano", "Change the plan")}</button>
                    {!mesa.pode_gerar && (
                      <span className="mesa-suave">{tr("pendência vermelha impede começar", "a red blocker prevents starting")}</span>
                    )}
                  </>
                ) : (
                  <>
                    <button className="mesa-btn" onClick={pedirPlano}>
                      {tr("Pedir o plano na conversa", "Ask for the plan in the conversation")}</button>
                    <span className="mesa-suave">
                      {tr("sem plano declarado, o portão não abre", "an explicit plan is required before generation")}</span>
                  </>
                )}
                {mesa.job_ativo?.status === 'done' && (
                  <button className="mesa-link" onClick={abrirEntregas}>
                    {tr("Ver as entregas", "View deliverables")}</button>
                )}
                {mesa.motor.modo_org === 'cli' && (
                  <span className="mesa-suave">
                    {tr("org no motor local — mídia gera no motor cloud", "organization uses the local engine; media generation uses cloud providers")}</span>
                )}
              </div>
            )}
              </>
            )}
          </div>
        )}
      </aside>
      {visorFonte && (
        <VisorArquivo
          titulo={visorFonte.titulo}
          caminho={visorFonte.caminho}
          midia={visorFonte.midia}
          url={visorFonte.url}
          erro={visorFonte.erro}
          aoFechar={fecharVisorFonte}
        />
      )}
      {dialogo}
    </div>
  )
}

export default MesaTab
