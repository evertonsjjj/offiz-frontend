import { InformacoesConversa } from './InformacoesConversa'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { api, asList, ApiError, getSessionIdentity } from '../../lib/api'
import { wsClient } from '../../lib/ws'
import { consumirPedidoLanding, lerPedidoLanding, type PedidoLanding } from '../../lib/pedidoLanding'
import { concluirRascunho, concluirReferenciaRascunho, escopoRascunhos, guardarRascunho, lerRascunhos } from '../../lib/rascunhosConversa'
import { preparacaoNoDestino, type PreparacaoNaConversa } from '../../lib/perfilSabatina'
import { useToasts } from '../Toasts'
import { useConfirmacao } from '../useConfirmacao'
import { useIdioma, type Traduzir } from '../../lib/i18n'
import { formatBytes, tempoRelativo, tipoEntregaLabel } from '../../lib/format'
import type {
  AnexoConversa,
  AnexoConversaResposta,
  CasoResumo,
  ContratoUploadResposta,
  ConversaDetalhe,
  ConversaMensagem,
  ConversaResumo,
  Effort,
  FeedbackConflito,
  FeedbackCriado,
  Job,
  ModoConversa,
  NotaFeedback,
  OfficeInfo,
  RespostaMensagem,
  ReferenciaConversa,
  SugestaoMarca,
  TrabalhoDaConversa,
  WsJobStatus,
} from '../../lib/types'
import {
  eSugestaoDeAgendamento,
  eSugestaoDeCanon,
  eSugestaoDeDevolutiva,
  eSugestaoDeMarca,
  extrasDaMensagem,
} from '../../lib/types'
import { PerfilProposto, type ConfirmacaoPerfil } from './PerfilProposto'
import { PainelTrabalho } from './PainelTrabalho'
import { SeletorAcervoConversa, type ItemAcervoAnexo } from './SeletorAcervoConversa'
import { useAlturaPedido } from './useAlturaPedido'
import { useAcompanharFim } from './useAcompanharFim'
import { Icone, iconeDoArquivo } from '../Icone'
import { transcreverVoz, validarVozNoApp } from '../../lib/voice'
import { orientacaoFalha } from '../../lib/falhasTrabalho'
import { detalhesDesfecho, lerDesfecho, temPendenciaDesfecho, textoDesfecho, type DesfechoConversa } from '../../lib/desfechoConversa'
import { perguntaPendente } from '../../lib/perguntasConversa'

function DetalhesConferencia({ desfecho, original, t }: { desfecho: DesfechoConversa; original: string; t: Traduzir }) {
  return <details className="texto-suave" style={{ marginTop: 8, fontSize: 12 }}>
    <summary>{t('Detalhes da conferência', 'Review details')}</summary>
    <ul>{detalhesDesfecho(desfecho, original).map((detalhe, i) => <li key={i}>{detalhe}</li>)}</ul>
  </details>
}

interface UploadInfo {
  nome: string
  /** Identidade confirmada pelo servidor; pode diferir do nome enviado. */
  nomeAnexo?: string
  tamanho: number
  estado: 'enviando' | 'ok' | 'erro'
  /** Erro, ou o aviso de "anexado mas ilegível no chat". */
  erro?: string
}

/** Mesmo esforço fixo da aba Tarefas. Era Extra (xhigh); baixou para high em
 *  10/08/2026 — corridas de conteúdo a R$ 9–19 CADA no Sonnet, com o peso do
 *  trabalho nas ferramentas (fal/ffmpeg/validação), não no raciocínio. */
const ESFORCO_FIXO: Effort = 'high'

/** Slug do escritório jurídico — só ele ganha o hub com modos (Fase 3). */
const OFFICE_JURIS = 'juris'

/** Limite de upload do contrato (contrato de API: 20MB). */
const CONTRATO_MAX_MB = 20
/* Anexo GENÉRICO da conversa: o mesmo teto do upload do produto
   (MAX_UPLOAD_MB no backend). O limite de contrato não serve aqui — vídeo de
   celular passa dos 20 MB fácil, e barrar o material do dono na porta de
   entrada seria pior que o problema que o limite evita. */
const ANEXO_MAX_MB = 200

/** A lista é horizontal no celular: o menu fica ancorado ao controle, fora
 * do recorte da lista, e nunca desloca o foco de um clique em outro campo. */
function MenuConversa({ conversa, escopo, ocupado, aoRenomear, aoFixar, aoExcluir }: {
  conversa: ConversaResumo
  escopo: string
  ocupado: boolean
  aoRenomear: () => void
  aoFixar: () => void
  aoExcluir: () => void
}) {
  const { t } = useIdioma()
  const id = useId()
  const origem = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [aberto, setAberto] = useState<{ escopo: string; ultimo: boolean } | null>(null)
  const [posicao, setPosicao] = useState({ top: 0, left: 0, visivel: false })
  const visivel = aberto?.escopo === escopo && !ocupado
  const nome = conversa.titulo || t(`Conversa #${conversa.id}`, `Conversation #${conversa.id}`)
  const fechar = (foco = false) => { setAberto(null); if (foco) origem.current?.focus({ preventScroll: true }) }
  useLayoutEffect(() => {
    if (!visivel || !origem.current || !menu.current) return
    const alvo = origem.current.getBoundingClientRect(), tamanho = menu.current.getBoundingClientRect()
    const margem = 8
    const left = Math.max(margem, Math.min(alvo.right - tamanho.width, window.innerWidth - tamanho.width - margem))
    const top = alvo.bottom + tamanho.height + margem <= window.innerHeight
      ? alvo.bottom + 4 : Math.max(margem, alvo.top - tamanho.height - 4)
    setPosicao({ top, left, visivel: true })
  }, [visivel, aberto])
  useLayoutEffect(() => {
    if (!visivel || !posicao.visivel || !menu.current) return
    const itens = menu.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    itens[aberto?.ultimo ? itens.length - 1 : 0]?.focus({ preventScroll: true })
  }, [visivel, posicao.visivel, aberto])
  useEffect(() => {
    if (!visivel) return
    const fora = (e: PointerEvent) => {
      if (e.target instanceof Node && !origem.current?.contains(e.target) && !menu.current?.contains(e.target)) setAberto(null)
    }
    const reposicionar = (e: Event) => {
      if (e.target instanceof Node && menu.current?.contains(e.target) || !origem.current || !menu.current) return
      const alvo = origem.current.getBoundingClientRect(), tamanho = menu.current.getBoundingClientRect()
      if (alvo.right <= 0 || alvo.left >= window.innerWidth || alvo.bottom <= 0 || alvo.top >= window.innerHeight) { setAberto(null); return }
      setPosicao({ visivel: true, left: Math.max(8, Math.min(alvo.right - tamanho.width, window.innerWidth - tamanho.width - 8)),
        top: alvo.bottom + tamanho.height + 8 <= window.innerHeight ? alvo.bottom + 4 : Math.max(8, alvo.top - tamanho.height - 4) })
    }
    document.addEventListener('pointerdown', fora)
    window.addEventListener('resize', reposicionar)
    window.addEventListener('scroll', reposicionar, true)
    return () => {
      document.removeEventListener('pointerdown', fora)
      window.removeEventListener('resize', reposicionar)
      window.removeEventListener('scroll', reposicionar, true)
    }
  }, [visivel])
  function escolher(acao: () => void) { fechar(true); acao() }
  return <>
    <button ref={origem} type="button" className="conversa-opcoes" disabled={ocupado}
      aria-label={t(`Opções da conversa ${nome}`, `Conversation options: ${nome}`)}
      aria-haspopup="menu" aria-expanded={visivel} aria-controls={visivel ? id : undefined}
      title={t('Opções da conversa', 'Conversation options')}
      onClick={() => { setPosicao(p => ({ ...p, visivel: false })); setAberto(visivel ? null : { escopo, ultimo: false }) }}
      onKeyDown={e => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault(); setPosicao(p => ({ ...p, visivel: false })); setAberto({ escopo, ultimo: e.key === 'ArrowUp' })
      }}><span aria-hidden="true">⋯</span></button>
    {visivel && createPortal(<div ref={menu} id={id} role="menu" aria-label={nome}
      className="conversa-opcoes-menu" style={{ top: posicao.top, left: posicao.left, visibility: posicao.visivel ? 'visible' : 'hidden' }}
      onKeyDown={e => {
        const itens = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        const indice = itens.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(true) }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault()
          const proximo = e.key === 'Home' ? 0 : e.key === 'End' ? itens.length - 1
            : (indice + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length
          itens[proximo]?.focus()
        } else if (e.key === 'Tab') {
          e.preventDefault()
          const controles = [...document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')]
            .filter(el => !menu.current?.contains(el) && el.getClientRects().length > 0)
          const i = controles.indexOf(origem.current!)
          const destino = e.shiftKey ? origem.current : controles[i + 1] ?? origem.current
          fechar(); destino?.focus({ preventScroll: true })
        }
      }}>
      <p className="conversa-opcoes-nome">{nome}</p>
      <button type="button" role="menuitem" onClick={() => escolher(aoRenomear)}>{t('Renomear', 'Rename')}</button>
      <button type="button" role="menuitem" onClick={() => escolher(aoFixar)}>{conversa.fixada ? t('Desafixar', 'Unpin') : t('Fixar', 'Pin')}</button>
      <button type="button" role="menuitem" className="conversa-opcoes-perigo" onClick={() => escolher(aoExcluir)}>{t('Excluir', 'Delete')}</button>
    </div>, document.body)}
  </>
}

/** Cliente mínimo para o select "Conversar sobre o cliente…" (só ativos). */
interface ClienteMini {
  id: number
  nome: string
  status: 'ativo' | 'standby'
}

/* ------------------------------------------------------------------ */
/* Modos do chat jurídico (hub de 4 cards, paridade com o JurisIA)     */
/* ------------------------------------------------------------------ */

const MODO_LABEL: Record<string, [string, string]> = {
  pesquisa: ['Pesquisa', 'Research'],
  contrato: ['Contrato', 'Contract'],
  caso: ['Caso', 'Case'],
}

/** O ícone de cada modo — o mesmo do card do hub, para o selo e o card
 *  contarem a mesma história. */
const MODO_ICONE: Record<string, string> = {
  pesquisa: 'lupa',
  contrato: 'arq-documento',
  // 'casos' (a balança) e não 'conversa': os três modos são nomeados pelo
  // ASSUNTO (pesquisa, contrato, caso), e um caso jurídico é 'casos' em todo o
  // resto do produto — aqui, na lista de conversas, na aba Casos.
  caso: 'casos',
}

/** O selo do modo (lista lateral, cabeçalho da conversa e setup do modo). */
function SeloModo({ modo }: { modo?: string | null }) {
  const { t } = useIdioma()
  const chave = modo || 'pesquisa'
  return (
    <span className={`chathub-badge chathub-badge-${chave}`}>
      {MODO_ICONE[chave] && <Icone nome={MODO_ICONE[chave]} tamanho={15} />}
      {MODO_LABEL[chave] ? t(...MODO_LABEL[chave]) : modo}
    </span>
  )
}

interface CardHub {
  key: string
  /** null = não é modo de chat (Geração de Peça navega para a aba Casos). */
  modo: ModoConversa | null
  /** Chave do set de ícones (ver `Icone.tsx`). */
  icone: string
  titulo: [string, string]
  descricao: [string, string]
}

const CARDS_HUB: CardHub[] = [
  {
    key: 'pesquisa',
    modo: 'pesquisa',
    icone: 'lupa',
    titulo: ['Pesquisa Jurídica', 'Legal research'],
    descricao: ['Tire dúvidas de qualquer área com fontes oficiais verificadas.', 'Ask questions with verified official sources.'],
  },
  {
    key: 'contrato',
    modo: 'contrato',
    icone: 'arq-documento',
    titulo: ['Leitura de Contrato', 'Contract review'],
    descricao: ['Envie um contrato e pergunte sobre cláusulas, riscos e prazos.', 'Upload a contract and ask about clauses, risks and deadlines.'],
  },
  {
    key: 'caso',
    modo: 'caso',
    icone: 'casos',
    titulo: ['Conversar sobre um Caso', 'Discuss a case'],
    descricao: ['Escolha um caso e converse com a IA sobre ele — com os dados e documentos.', 'Choose a case and discuss it with the AI using its details and documents.'],
  },
  {
    key: 'peca',
    modo: null,
    // 'ia' (a fagulha) e não 'lapis': é o MESMO botão “Gerar peça” de
    // PecasCaso/CasosTab, e 'lapis' já significa editar/renomear/ajustar.
    icone: 'ia',
    titulo: ['Geração de Peça', 'Draft a legal document'],
    descricao: ['Peças são geradas dentro do caso: abra o caso e clique em “Gerar peça”.', 'Documents are drafted within a case: open the case and select “Draft document”.'],
  },
]

const MODO_DESCRICAO: Record<ModoConversa, [string, string]> = {
  pesquisa: ['Pergunte qualquer coisa — a IA responde com verificação nas fontes oficiais.', 'Ask a question — the AI checks its answer against official sources.'],
  contrato: ['Envie o contrato (PDF, DOCX ou TXT) e depois pergunte sobre cláusulas, riscos e prazos.', 'Upload the contract (PDF, DOCX or TXT), then ask about clauses, risks and deadlines.'],
  caso: ['A IA conversa já sabendo os dados e os documentos do caso escolhido.', 'The AI already has the selected case’s details and documents.'],
}

/* ------------------------------------------------------------------ */
/* Markdown SIMPLES: quebras de linha e **negrito** — sem lib nova.    */
/* ------------------------------------------------------------------ */

function comNegrito(linha: string, keyBase: string): ReactNode[] {
  const partes = linha.split(/\*\*([^*]+)\*\*/g)
  return partes.map((p, i) => (i % 2 === 1 ? <strong key={`${keyBase}-${i}`}>{p}</strong> : p))
}

function MarkdownSimples({ texto }: { texto: string }) {
  const linhas = texto.split('\n')
  return (
    <>
      {linhas.map((l, i) => (
        <span key={i}>
          {comNegrito(l, `l${i}`)}
          {i < linhas.length - 1 && <br />}
        </span>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Aba Chat AI — conversa multi-turno com a IA, sem produzir entregas  */
/* ------------------------------------------------------------------ */

const ROTULO_COR: Record<string, [string, string]> = {
  cor_primaria: ['principal', 'primary'],
  cor_acento: ['destaque', 'accent'],
  cor_fundo: ['fundo', 'background'],
}

/** "toda segunda às 09:00" / "todo dia 5 às 09:00" — o mesmo vocabulário da
 *  aba ⏰ Agenda, para o cartão e a aba contarem a mesma história. */
const DIAS_SEMANA_CURTO = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']
const DIAS_SEMANA_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
function resumoQuandoAgendamento(s: {
  recorrencia: 'semanal' | 'mensal' | 'uma_vez'
  dia: number
  hora: string
  data?: string | null
}, t: Traduzir): string {
  if (s.recorrencia === 'uma_vez') {
    // 'AAAA-MM-DD' → 'dd/mm', sem passar por Date (fuso trocaria o dia).
    const [, mes, dia] = (s.data ?? '').split('-')
    return dia && mes
      ? t(`dia ${dia}/${mes} às ${s.hora}, uma vez`, `on ${mes}/${dia} at ${s.hora}, once`)
      : t(`às ${s.hora}, uma vez`, `at ${s.hora}, once`)
  }
  if (s.recorrencia === 'semanal') {
    return t(`toda ${DIAS_SEMANA_CURTO[s.dia] ?? 'semana'} às ${s.hora}`, `every ${DIAS_SEMANA_EN[s.dia] ?? 'week'} at ${s.hora}`)
  }
  return t(`todo dia ${s.dia} às ${s.hora}`, `on day ${s.dia} of every month at ${s.hora}`)
}

/**
 * O cartão de "quer que eu deixe isso como padrão?" — cores em AMOSTRA, não em
 * hexadecimal.
 *
 * O dono desta tela não lê `#101010`: ele reconhece o preto do time dele. As
 * bolinhas mostram o que vai mudar antes de mudar, que é o que separa um
 * assistente de uma surpresa. O texto da diretriz aparece inteiro pelo mesmo
 * motivo — vai virar regra permanente do escritório.
 */
function CartaoMarca({
  sugestao,
  ocupado,
  aoAplicar,
  aoDispensar,
}: {
  sugestao: SugestaoMarca
  ocupado: boolean
  aoAplicar: () => void
  aoDispensar: () => void
}) {
  const { t } = useIdioma()
  const cores = Object.entries(sugestao.tema ?? {}).filter(([k]) => k in ROTULO_COR)
  const icone = sugestao.tema?.icone
  return (
    <div className="conversa-sugestao">
      <p className="conversa-sugestao-titulo">
        <Icone nome="paleta" tamanho={15} /> {t('Quer que eu deixe assim para todas as peças?', 'Use this for every deliverable?')}{' '}
        <strong>{sugestao.resumo}</strong>
      </p>
      {cores.length > 0 && (
        <ul className="conversa-marca-cores">
          {cores.map(([chave, valor]) => (
            <li key={chave}>
              <span
                className="conversa-marca-amostra"
                style={{ background: valor }}
                aria-hidden="true"
              />
              <span className="texto-suave">{t(...ROTULO_COR[chave])}</span>
            </li>
          ))}
          {icone && (
            <li>
              <span className="conversa-marca-amostra conversa-marca-emoji" aria-hidden="true">
                {icone}
              </span>
              <span className="texto-suave">{t('ícone', 'icon')}</span>
            </li>
          )}
        </ul>
      )}
      {sugestao.diretriz && (
        <p className="conversa-marca-diretriz">
          {t('E guardo isto no que o escritório já sabe:', 'I will also save this to the office’s knowledge:')}{' '}<em>“{sugestao.diretriz}”</em>
        </p>
      )}
      <div className="conversa-sugestao-acoes">
        <button
          type="button"
          className="botao botao-primario botao-pequeno"
          disabled={ocupado}
          onClick={aoAplicar}
        >
          {ocupado ? (
            t('aplicando…', 'applying…')
          ) : (
            <>
              <Icone nome="visto" tamanho={15} /> {t('Sim, deixa como padrão', 'Yes, make it the default')}
            </>
          )}
        </button>
        <button
          type="button"
          className="botao botao-fantasma botao-pequeno"
          onClick={aoDispensar}
        >
          {t('Não, obrigado', 'No, thanks')}
        </button>
      </div>
    </div>
  )
}

/* O que a conversa aceita como anexo. Documento a IA LÊ; mídia ela não vê, mas
   o arquivo vai para entrada/ e a tarefa a edita — é isso que faz a conversa
   ser o portal do dono ("arrasta o vídeo aqui e pede pra editar"). O campo do
   CONTRATO segue só com texto: lá o produto é o texto extraído. */
const ACEITA_ANEXO = [
  '.pdf', '.docx', '.txt', '.md', '.csv', '.tsv',
  '.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv',
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg',
].join(',')

function avisoLeituraAnexo(anexo: AnexoConversa, t: Traduzir): string | undefined {
  if (anexo.leitura_parcial) return t('Leitura parcial', 'Partial reading') + ': ' +
    (anexo.leitura_aviso?.replace(/^Leitura parcial:\s*/i, '') || t('Só uma parte do conteúdo foi lida.', 'Only part of the content was read.'))
  return anexo.leitura_aviso || undefined
}

export function ConversaTab({
  orgId,
  slug,
  office,
  meuPapel,
  nivelPredio = false,
  aoVerEntregas,
  aoVerFluxo,
  aoVerPeca,
  inicioConteudo,
  rascunhoInicial,
  aoContextoAtualizado,
  painelConteudo,
  atividadeConteudo,
  antesDeEnviar,
  aoMudarConversa,
}: {
  orgId: number
  slug: string
  office: OfficeInfo
  /** Papel do usuário NESTA org. Só owner/admin recebe o atalho para a
   *  configuração quando o escritório ainda não foi ligado — para os demais o
   *  link seria um beco (a tela é gated) e ainda os tiraria do escritório. */
  meuPapel?: string
  /** Conversa do PRÉDIO (o CEO): endpoints do nível org, sugestão vem com o
   *  andar-alvo e anexos ficam de fora (o backend responderia 400). */
  nivelPredio?: boolean
  /** As CAIXINHAS do trabalho ancorado (15/08/2026): abrir a decisão na
   *  vitrine e o quadro "como foi feita" no Estúdio. A shell só as passa
   *  quando as abas existem — sem elas, as caixinhas nem aparecem. */
  aoVerEntregas?: () => void
  aoVerFluxo?: (jobId: number) => void
  /** Abre a peça carteada pela IA (chat rico) — a mesma porta do Estúdio que
   *  a vitrine usa. Sem ela o cartão vira registro, nunca botão morto. */
  aoVerPeca?: (pecaSlug: string) => void
  inicioConteudo?: ReactNode
  rascunhoInicial?: { texto: string; chave: number; referencia?: ReferenciaConversa; preparacao?: PreparacaoNaConversa }
  aoContextoAtualizado?: () => void
  painelConteudo?: ReactNode
  atividadeConteudo?: ReactNode
  /** Preflight keeps the draft intact when this device is not connected. */
  antesDeEnviar?: () => Promise<boolean>
  aoMudarConversa?: (id: number | null) => void
}) {
  const { t, idioma } = useIdioma()
  const sessaoDaTela = getSessionIdentity()
  const [searchParams, setSearchParams] = useSearchParams()
  const { sucesso, falha, notificar } = useToasts()
  const { confirmar, solicitarTexto, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}:${slug}:${nivelPredio}`)

  // Gate da Fase 3: o hub com modos só existe no escritório jurídico.
  // Financeiro/assistentes ficam EXATAMENTE com o comportamento anterior.
  const ehJuris = office.slug === OFFICE_JURIS
  function conversaDoContexto(c: ConversaResumo): boolean {
    return (c.organization_id === undefined || c.organization_id === orgId)
      && (c.office_slug === undefined || c.office_slug === (nivelPredio ? null : slug))
  }

  const [conversas, setConversas] = useState<ConversaResumo[] | null>(null)
  const [buscaConversa, setBuscaConversa] = useState('')
  const [erroHistorico, setErroHistorico] = useState(false)
  const [erroOrganizacao, setErroOrganizacao] = useState<{ contexto: number; id: number; texto: string } | null>(null)
  const [alterandoConversas, setAlterandoConversas] = useState<number[]>([])
  const alterandoConversasRef = useRef(new Map<number, symbol>())
  const contextoHistoricoRef = useRef(0)
  const consultaHistoricoRef = useRef<AbortController | null>(null)
  const sequenciaHistoricoRef = useRef(0)
  const versaoMetadadosRef = useRef(0)
  const metadadosConfirmadosRef = useRef(new Map<number, { titulo?: { versao: number; valor: string }; fixada?: { versao: number; valor: boolean } }>())
  const excluindoRef = useRef(new Set<number>())
  const [excluindo, setExcluindo] = useState<number[]>([])
  // null = tela de conversa NOVA (ainda não criada no backend).
  const [conversaId, setConversaId] = useState<number | null>(null)
  useEffect(() => { aoMudarConversa?.(conversaId) }, [conversaId, aoMudarConversa])
  const [conversa, setConversa] = useState<ConversaDetalhe | null>(null)
  const [carregandoThread, setCarregandoThread] = useState(false)
  // Recuperar a leitura não apaga uma falha de envio nem repete o pedido.
  const [erroThread, setErroThread] = useState<string | null>(null)
  const aberturaThreadRef = useRef<AbortController | null>(null)
  const leituraThreadRef = useRef<{ id: number; contexto: number } | null>(null)
  const conversaAindaNaoLida = conversaId != null && conversa?.id !== conversaId
  const [clientes, setClientes] = useState<ClienteMini[]>([])
  const [clienteNovo, setClienteNovo] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [rascunhoNaoGuardado, setRascunhoNaoGuardado] = useState(false)
  const [pedidoDaLanding, setPedidoDaLanding] = useState<PedidoLanding | null>(null)
  const pedidoLandingProcessadoRef = useRef<string | null>(null)
  const [preparacaoPendente, setPreparacaoPendente] = useState<{ dados: PreparacaoNaConversa; contexto: number; incorporada: boolean } | null>(null)
  const preparacaoProcessadaRef = useRef<typeof rascunhoInicial>()

  const [pensando, setPensando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pedidoVazio, setPedidoVazio] = useState(false)
  // 409 do backend (escritório ainda não ligado) — aviso em linguagem de dono.
  const [aviso, setAviso] = useState<string | null>(null)
  const podeConfigurar = meuPapel === 'owner' || meuPapel === 'admin'
  // Sugestões de tarefa: dispensadas ou já iniciadas (por id da mensagem).
  // PERSISTIDAS por conversa: sem isso o F5 zerava o estado e o cartão
  // "Sim, iniciar tarefa" voltava com o job JÁ RODANDO — o dono clicava de
  // novo e nascia tarefa duplicada (o caso real dos trabalhos 37 e 41).
  const [sugestoes, setSugestoes] = useState<Record<number, 'dispensada' | 'iniciada'>>({})
  const [iniciandoTarefa, setIniciandoTarefa] = useState(false)
  const [aplicandoMarca, setAplicandoMarca] = useState(false)
  const [agendando, setAgendando] = useState(false)
  /** Trabalho que esta conversa está ajustando (vem do "Pedir ajuste") ou que
   *  nasceu dela — é o que o painel da direita acompanha. */
  const [ajusteJobId, setAjusteJobId] = useState<number | null>(null)
  const ajusteJobIdRef = useRef(ajusteJobId)
  ajusteJobIdRef.current = ajusteJobId
  // Consultar uma versão antiga é uma escolha; eventos não devem trocá-la.
  const painelEscolhidoRef = useRef(false)
  const retomadaPainelRef = useRef<number | null>(null)
  const refreshMensagensRef = useRef<AbortController | null>(null)
  const refreshAposEnvioRef = useRef(false)
  const referenciaRascunhoRef = useRef<{ contexto: number; referencia: ReferenciaConversa } | null>(null)
  const [revisaoReferenciaRascunho, setRevisaoReferenciaRascunho] = useState(0)
  function mudarReferenciaRascunho(referencia: typeof referenciaRascunhoRef.current) {
    if (referenciaRascunhoRef.current === referencia) return
    referenciaRascunhoRef.current = referencia
    setRevisaoReferenciaRascunho(v => v + 1)
  }
  const [painelAberto, setPainelAberto] = useState(false)
  const painelFechadoRef = useRef(false)
  function abrirPainelEscolhido() {
    painelEscolhidoRef.current = true
    painelFechadoRef.current = false
    setPainelAberto(true)
  }
  /* O botão flutuante de TELA CHEIA saiu em 16/08/2026 (decisão do dono: "ficou
   * ruim"). Junto foi a preferência salva — sem o botão, quem tivesse
   * `offiz:conversa-cheia = 1` no navegador ficaria preso em tela cheia, sem
   * lista lateral e sem nada na tela que explicasse por quê. */
  /** A PEÇA em foco (uma das versões entregues). Vai na criação da conversa
   *  quando ela ainda não existe, e por PUT quando existe. */
  const [ajusteEntregaId, setAjusteEntregaId] = useState<number | null>(null)
  /** O campo da mensagem — o painel dá foco nele ao escrever a referência. */
  const campoRef = useRef<HTMLTextAreaElement | null>(null)
  const conversaRegiaoRef = useRef<HTMLElement | null>(null)
  const conversaTituloRef = useRef<HTMLHeadingElement | null>(null)
  /** O último texto que NÓS escrevemos no campo. Serve para saber se o que está
   *  ali é nosso (pode ser substituído) ou do dono (nunca se sobrescreve). */
  const sementeRef = useRef<string>('')

  const chaveSugestoes = (id: number) => `offiz:sugestoes:${orgId}:${id}`
  function sugestoesSalvas(id: number): Record<number, 'dispensada' | 'iniciada'> {
    try {
      return JSON.parse(localStorage.getItem(chaveSugestoes(id)) || '{}')
    } catch {
      return {}
    }
  }
  // Write-through: toda mudança de estado das sugestões vai junto pro
  // localStorage da conversa aberta (v1 honesta — por navegador; o vínculo do
  // TRABALHO em si é do servidor e volta pelo trabalho_job_id).
  useEffect(() => {
    const id = conversaIdRef.current
    if (id == null) return
    try {
      localStorage.setItem(chaveSugestoes(id), JSON.stringify(sugestoes))
    } catch {
      /* storage cheio/privado: o pior caso é voltar o cartão num F5 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugestoes])

  // ── Fase 3 (só juris): modo da conversa nova + casos + contrato ──
  // null = ainda no hub de 4 cards; setado = composer do modo escolhido.
  const [modoNovo, setModoNovo] = useState<ModoConversa | null>(null)
  const [casoNovo, setCasoNovo] = useState('')
  const [casos, setCasos] = useState<CasoResumo[]>([])
  // Nome do contrato enviado NESTA sessão (o GET só expõe tem_contrato).
  const [contratoNome, setContratoNome] = useState<string | null>(null)
  const [enviandoContrato, setEnviandoContrato] = useState(false)
  const [arrastandoContrato, setArrastandoContrato] = useState(false)
  const contratoInputRef = useRef<HTMLInputElement | null>(null)

  // ── WIZARD (todos os escritórios): anexos genéricos da conversa —
  // o conteúdo entra no contexto do chat E a cópia vai para entrada/
  // (a tarefa sugerida encontra os arquivos lá). ──
  const [anexos, setAnexos] = useState<AnexoConversa[]>([])
  /** O seletor "Do acervo": lista carregada uma vez, aberta sob demanda. */
  const [acervoAnexo, setAcervoAnexo] = useState<ItemAcervoAnexo[] | null>(null)
  const [erroAcervoAnexo, setErroAcervoAnexo] = useState<string | null>(null)
  const [carregandoAcervoAnexo, setCarregandoAcervoAnexo] = useState(false)
  const consultaAcervoRef = useRef<AbortController | null>(null)
  const [escolhendoAcervo, setEscolhendoAcervo] = useState(false)
  const [contextoAcervo, setContextoAcervo] = useState<string | null>(null)
  // O que subiu NESTA sessão, com estado por arquivo (o fetch não dá progresso
  // real de bytes — o que importa para o dono é "subiu / não subiu / por quê").
  const [uploads, setUploads] = useState<UploadInfo[]>([])
  const [arrastandoAnexo, setArrastandoAnexo] = useState(false)
  // VOZ: gravar → transcrever no servidor → texto no campo (o dono revisa e
  // envia). Nunca envia sozinho: transcrição erra nome próprio, e mandar
  // direto tiraria a chance de corrigir antes de a IA trabalhar em cima.
  const [gravando, setGravando] = useState(false)
  const [transcrevendo, setTranscrevendo] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const gravadorRef = useRef<MediaRecorder | null>(null)
  const abrindoMicrofoneRef = useRef(false)
  const [enviandoAnexo, setEnviandoAnexo] = useState(false)
  const [remocaoAnexo, setRemocaoAnexo] = useState<{ contexto: number; nome: string } | null>(null)
  const remocaoAnexoRef = useRef<{ contexto: number; nome: string } | null>(null)
  const revisaoAnexosRef = useRef(0)
  const mutacaoAnexosRef = useRef<{ contexto: number } | null>(null)
  const anexoInputRef = useRef<HTMLInputElement | null>(null)

  // ── Fase 4 (só juris): feedback 👍/👎 nas respostas da IA ──
  // avaliadas[id] = nota já enviada; fbAberto = mensagem com a caixinha do 👎.
  const [avaliadas, setAvaliadas] = useState<Record<number, NotaFeedback>>({})
  const [fbAberto, setFbAberto] = useState<number | null>(null)
  const [fbComentario, setFbComentario] = useState('')
  const [fbEnviando, setFbEnviando] = useState(false)
  // Conflito com o playbook detectado pelo backend (informativo, dispensável).
  const [fbConflitos, setFbConflitos] = useState<Record<number, FeedbackConflito>>({})

  const conversaIdRef = useRef<number | null>(null)
  conversaIdRef.current = conversaId
  const contextoConversaRef = useRef(0)
  const removendoAnexo = remocaoAnexo?.contexto === contextoConversaRef.current ? remocaoAnexo.nome : null
  const temTrabalhoAtivo = conversa?.trabalhos?.some(j => j.status === 'queued' || j.status === 'running') ?? false
  const enviosRef = useRef(new Set<number>())
  const escopoRef = useRef('')
  escopoRef.current = `${orgId}/${slug}/${nivelPredio}`
  function preservarMetadados<T extends ConversaResumo>(det: T, versaoDaLeitura: number): T {
    const confirmado = metadadosConfirmadosRef.current.get(det.id)
    return { ...det,
      ...(confirmado?.titulo && confirmado.titulo.versao > versaoDaLeitura ? { titulo: confirmado.titulo.valor } : {}),
      ...(confirmado?.fixada && confirmado.fixada.versao > versaoDaLeitura ? { fixada: confirmado.fixada.valor } : {}),
    }
  }
  const restaurarSelecaoRef = useRef(true)
  const selecaoNavegandoRef = useRef<string | null>(null)
  const listaEscopoRef = useRef<string | null>(null)
  function chaveSelecao() {
    const sessao = getSessionIdentity()
    return sessao ? `offiz:conversa-aberta:${sessao}:${escopoRef.current}` : null
  }
  function lembrarSelecao(id: number | null) {
    try {
      const chave = chaveSelecao()
      if (chave) {
        if (id == null) localStorage.removeItem(chave)
        else localStorage.setItem(chave, String(id))
      }
    } catch { /* armazenamento indisponível não impede conversar */ }
  }
  function publicarSelecao(id: number | null, substituir = false) {
    const valor = id == null ? 'nova' : String(id)
    if (searchParams.get('conversa') === valor) return
    selecaoNavegandoRef.current = valor
    setSearchParams(atual => {
      const proximo = new URLSearchParams(atual)
      proximo.set('conversa', valor)
      return proximo
    }, { replace: substituir })
  }
  const criacaoConversaRef = useRef<{ contexto: number; promessa: Promise<number> } | null>(null)
  const rascunhosRef = useRef(new Map<string, string>())
  const referenciasRascunhosRef = useRef(new Map<string, ReferenciaConversa>())
  const rascunhosEmEnvioRef = useRef(new Set<string>())
  const chavePersistencia = escopoRascunhos(orgId, slug, nivelPredio)
  const escopoRascunhoRef = useRef<string | null>(null)
  const chaveRascunhoRef = useRef('nova')
  const mensagemRef = useRef(mensagem)
  mensagemRef.current = mensagem

  function preparacaoVigente(pendente: NonNullable<typeof preparacaoPendente>) {
    return pendente.contexto === contextoConversaRef.current && preparacaoNoDestino(pendente.dados, {
      orgId, slug, nivelPredio, sessao: getSessionIdentity(), conversaId: conversaIdRef.current,
    })
  }
  const preparacaoVisivel = preparacaoPendente && preparacaoVigente(preparacaoPendente) ? preparacaoPendente : null
  function incorporarPreparacao() {
    if (!preparacaoPendente || !preparacaoVigente(preparacaoPendente)) return
    const texto = preparacaoPendente.dados.textos.join('\n\n')
    setMensagem(atual => atual.trim() ? `${atual}\n\n${texto}` : texto)
    setPreparacaoPendente({ ...preparacaoPendente, incorporada: true })
    campoRef.current?.focus()
  }

  function trocarRascunho(chave: string) {
    rascunhosRef.current.set(chaveRascunhoRef.current, mensagemRef.current)
    if (referenciaRascunhoRef.current) referenciasRascunhosRef.current.set(chaveRascunhoRef.current, referenciaRascunhoRef.current.referencia)
    else referenciasRascunhosRef.current.delete(chaveRascunhoRef.current)
    if (mensagemRef.current.trim() || !rascunhosEmEnvioRef.current.has(chaveRascunhoRef.current)) {
      guardarRascunho(escopoRascunhoRef.current, chaveRascunhoRef.current, mensagemRef.current, referenciaRascunhoRef.current?.referencia)
    }
    chaveRascunhoRef.current = chave
    const referencia = referenciasRascunhosRef.current.get(chave)
    mudarReferenciaRascunho(referencia ? { contexto: contextoConversaRef.current, referencia } : null)
    const texto = rascunhosRef.current.get(chave) ?? ''
    mensagemRef.current = texto
    setMensagem(texto)
    sementeRef.current = ''
  }

  function encerrarVoz() {
    const gravador = gravadorRef.current
    gravadorRef.current = null
    if (gravador) {
      gravador.onstop = null
      if (gravador.state !== 'inactive') gravador.stop()
      gravador.stream.getTracks().forEach((trilha) => trilha.stop())
    }
  }

  function limparOperacoesDaConversa() {
    setFbEnviando(false)
    aberturaThreadRef.current?.abort()
    aberturaThreadRef.current = null
    leituraThreadRef.current = null
    refreshMensagensRef.current?.abort()
    refreshAposEnvioRef.current = false
    consultaAcervoRef.current?.abort()
    consultaAcervoRef.current = null
    setErroAcervoAnexo(null)
    setCarregandoAcervoAnexo(false)
    painelEscolhidoRef.current = false
    painelFechadoRef.current = false
    setPainelAberto(false)
    retomadaPainelRef.current = null
    encerrarVoz()
    setGravando(false)
    setTranscrevendo(false)
    setEnviandoContrato(false)
    setAplicandoMarca(false)
    setAgendando(false)
  }

  function registrarSugestaoIniciada(idMensagem: number, idConversa: number | null) {
    if (idConversa == null) return
    try {
      localStorage.setItem(chaveSugestoes(idConversa), JSON.stringify({ ...sugestoesSalvas(idConversa), [idMensagem]: 'iniciada' }))
    } catch { /* sem armazenamento local, o vínculo do servidor continua valendo */ }
    if (conversaIdRef.current === idConversa) setSugestoes((prev) => ({ ...prev, [idMensagem]: 'iniciada' }))
  }
  const threadRef = useRef<HTMLDivElement | null>(null)
  const perguntaMensagemRef = useRef<HTMLDivElement | null>(null)
  // Polling da resposta pendente: se a última mensagem é do usuário, a IA
  // ainda está gerando no servidor (a geração continua mesmo se o cliente
  // saiu). Buscamos a conversa a cada 3s até a resposta chegar.
  const pollRef = useRef<number | null>(null)

  function pararPolling() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const iniciarPolling = useCallback((id: number) => {
    pararPolling()
    const contexto = contextoConversaRef.current
    setPensando(true)
    const deadline = Date.now() + 150_000 // ~2,5 min: além disso, avisa
    let consultando = false
    pollRef.current = window.setInterval(async () => {
      // Aba escondida não busca (guard de Page Visibility, 27/08).
      if (document.hidden) return
      if (contextoConversaRef.current !== contexto || conversaIdRef.current !== id) return
      if (Date.now() > deadline) {
        pararPolling(); setPensando(false)
        setErro(t('Não foi possível confirmar a resposta a tempo. Seu pedido já foi enviado. Abra esta conversa novamente para consultar o resultado.', 'The response could not be confirmed in time. Your request was sent. Open this conversation again to check the result.'))
        return
      }
      if (consultando) return
      consultando = true
      const versaoMetadados = versaoMetadadosRef.current
      try {
        const det = await api.get<ConversaDetalhe>(`/conversas/${id}`)
        if (contextoConversaRef.current !== contexto || conversaIdRef.current !== id) return
        if (det.id !== id || !conversaDoContexto(det)) throw new Error(t('A conversa recebida pertence a outro contexto. Abra novamente a conversa desta empresa.', 'The received conversation belongs to a different context. Reopen the conversation for this organization.'))
        const ms = Array.isArray(det.mensagens) ? det.mensagens : []
        setConversa({ ...preservarMetadados(det, versaoMetadados), mensagens: ms })
        if (!painelEscolhidoRef.current && det.trabalho_job_id != null) {
          setAjusteJobId(det.trabalho_job_id)
          setAjusteEntregaId(null)
        }
        if (ms.length === 0 || ms[ms.length - 1].role === 'assistant') {
          pararPolling()
          setPensando(false) // a resposta chegou
        }
      } catch {
        /* rede instável — tenta de novo no próximo tick */
      } finally { consultando = false }
    }, 3000)
  }, [orgId, slug, nivelPredio, t])

  // Encerra o polling quando o componente sai de cena.
  useEffect(() => () => { pararPolling(); encerrarVoz() }, [])

  function tratarErro(e: unknown, padrao: string) {
    if (e instanceof ApiError && e.status === 409) {
      setAviso(e.detail)
    } else {
      setErro(e instanceof ApiError ? e.detail : padrao)
    }
  }

  const carregarConversas = useCallback(async () => {
    const escopo = `${orgId}/${slug}/${nivelPredio}`
    const sessao = getSessionIdentity()
    const contexto = contextoHistoricoRef.current
    const versao = versaoMetadadosRef.current
    const sequencia = ++sequenciaHistoricoRef.current
    consultaHistoricoRef.current?.abort()
    const controller = new AbortController()
    consultaHistoricoRef.current = controller
    const vigente = () => !controller.signal.aborted && sequenciaHistoricoRef.current === sequencia
      && escopoRef.current === escopo && getSessionIdentity() === sessao
      && contextoHistoricoRef.current === contexto && versaoMetadadosRef.current === versao
    setErroHistorico(false)
    try {
      const data = await api.get<unknown>(
        nivelPredio ? `/orgs/${orgId}/predio/conversas` : `/predios/${orgId}/${slug}/conversas`,
        controller.signal,
      )
      if (vigente()) {
        const lista = asList<ConversaResumo>(data, 'conversas').filter(conversaDoContexto)
        const confirmada = ++versaoMetadadosRef.current
        for (const item of lista) metadadosConfirmadosRef.current.set(item.id, {
          ...(typeof item.titulo === 'string' ? { titulo: { versao: confirmada, valor: item.titulo } } : {}),
          ...(typeof item.fixada === 'boolean' ? { fixada: { versao: confirmada, valor: item.fixada } } : {}),
        })
        listaEscopoRef.current = escopo
        setConversas(lista)
        setConversa(atual => {
          const resumo = lista.find(c => c.id === atual?.id)
          return atual && resumo ? { ...atual, titulo: resumo.titulo, fixada: resumo.fixada } : atual
        })
        setErroOrganizacao(null)
      }
    } catch (e) {
      if (!vigente()) return
      if (e instanceof ApiError && e.status === 409) setAviso(e.detail)
      setErroHistorico(true)
    } finally {
      if (consultaHistoricoRef.current === controller) consultaHistoricoRef.current = null
    }
    // A consulta é cercada por empresa, sessão, sequência e versão de metadados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, slug, nivelPredio])

  useEffect(() => {
    contextoHistoricoRef.current += 1
    versaoMetadadosRef.current += 1
    metadadosConfirmadosRef.current.clear()
    alterandoConversasRef.current.clear()
    setAlterandoConversas([])
    setErroOrganizacao(null)
    contextoConversaRef.current += 1
    pararPolling()
    limparOperacoesDaConversa()
    restaurarSelecaoRef.current = true
    selecaoNavegandoRef.current = null
    listaEscopoRef.current = null
    conversaIdRef.current = null
    const guardados = lerRascunhos(chavePersistencia)
    escopoRascunhoRef.current = chavePersistencia
    rascunhosRef.current = new Map(Object.entries(guardados).map(([id, r]) => [id, r.texto]))
    referenciasRascunhosRef.current = new Map(Object.entries(guardados).filter(([, r]) => r.referencia).map(([id, r]) => [id, r.referencia!]))
    rascunhosEmEnvioRef.current.clear()
    mudarReferenciaRascunho(guardados.nova?.referencia ? { contexto: contextoConversaRef.current, referencia: guardados.nova.referencia } : null)
    chaveRascunhoRef.current = 'nova'
    mensagemRef.current = guardados.nova?.texto ?? ''
    setMensagem(mensagemRef.current)
    setRascunhoNaoGuardado(false)
    setConversas(null)
    setErroHistorico(false)
    setConversaId(null)
    setConversa(null)
    setPensando(false)
    setClienteNovo('')
    setModoNovo(null)
    setCasoNovo('')
    setContratoNome(null)
    setAnexos([])
    setUploads([])
    setEnviandoAnexo(false)
    setIniciandoTarefa(false)
    setEscolhendoAcervo(false)
    setFbAberto(null)
    setFbComentario('')
    setSugestoes({})
    setAjusteJobId(null)
    setAjusteEntregaId(null)
    setCarregandoThread(false)
    setErroThread(null)
    setErro(null)
    setAviso(null)
    carregarConversas()
    return () => { contextoHistoricoRef.current += 1; consultaHistoricoRef.current?.abort(); contextoConversaRef.current += 1; aberturaThreadRef.current?.abort(); consultaAcervoRef.current?.abort() }
  }, [carregarConversas, chavePersistencia])

  // A hidratação acima atualiza a ref antes do estado: não gravar o vazio do
  // primeiro render sobre um rascunho restaurado, inclusive em StrictMode.
  useEffect(() => {
    if (escopoRascunhoRef.current !== chavePersistencia || mensagemRef.current !== mensagem) return
    const chave = chaveRascunhoRef.current
    rascunhosRef.current.set(chave, mensagem)
    if (!mensagem.trim() && rascunhosEmEnvioRef.current.has(chave)) return
    const referencia = mensagem.trim() ? referenciaRascunhoRef.current?.referencia : undefined
    if (!mensagem.trim()) mudarReferenciaRascunho(null)
    if (referencia) referenciasRascunhosRef.current.set(chave, referencia)
    else referenciasRascunhosRef.current.delete(chave)
    if (chavePersistencia) setRascunhoNaoGuardado(!guardarRascunho(chavePersistencia, chave, mensagem, referencia))
  }, [mensagem, conversaId, chavePersistencia, revisaoReferenciaRascunho])

  // Restaura apenas um item da lista autorizada desta sessão/empresa/área.
  // Um pedido novo ou um ajuste explícito tem prioridade sobre a lembrança.
  useEffect(() => {
    if (!restaurarSelecaoRef.current || conversas == null || listaEscopoRef.current !== escopoRef.current) return
    restaurarSelecaoRef.current = false
    if (searchParams.has('conversa') || searchParams.has('pedido-inicial') || searchParams.has('pergunta') || searchParams.has('ajustepeca') || rascunhoInicial?.texto) return
    try {
      const chave = chaveSelecao()
      const id = chave ? Number(localStorage.getItem(chave)) : 0
      if (conversas.some((c) => c.id === id)) void abrirConversa(id, 'restaurar')
      else {
        lembrarSelecao(null)
        // Um escritório preparado pode ter uma conversa fixada pelo consultor.
        // No primeiro acesso, abri-la sem atropelar um pedido já escrito.
        const preparada = conversas.find((c) => c.fixada)
        if (preparada && !mensagemRef.current.trim()) void abrirConversa(preparada.id, 'restaurar')
      }
    } catch { /* a lista continua utilizável sem preferência */ }
    // A seleção ocorre uma única vez após carregar a lista; funções de interação
    // não são dependências porque mudam durante a digitação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversas, searchParams, rascunhoInicial])

  // A URL identifica o assunto, sem trazer texto privado. Voltar/Avançar
  // percorre assuntos reais; um id de outra empresa/área nunca é consultado.
  const conversaNaUrl = searchParams.get('conversa')
  const sementeNaUrl = searchParams.has('pergunta') || searchParams.has('ajustepeca')
  useEffect(() => {
    if (sementeNaUrl || conversas == null || listaEscopoRef.current !== escopoRef.current || conversaNaUrl == null) return
    // Uma atualização de estado pode chegar antes do commit da navegação.
    // Não interpretar a URL anterior como um Back e apagar a criação/envio.
    if (selecaoNavegandoRef.current && selecaoNavegandoRef.current !== conversaNaUrl) return
    selecaoNavegandoRef.current = null
    if (conversaNaUrl === 'nova') {
      if (conversaIdRef.current != null) novaConversa(false)
      return
    }
    const id = /^[1-9]\d*$/.test(conversaNaUrl) ? Number(conversaNaUrl) : NaN
    // A criação e a abertura já validaram esta seleção. Uma atualização da
    // lista pode chegar atrasada sem ainda conter a conversa recém-criada.
    if (Number.isSafeInteger(id) && conversaIdRef.current === id) return
    if (!Number.isSafeInteger(id) || !conversas.some(c => c.id === id)) {
      if (conversaIdRef.current != null) novaConversa(false)
      setAviso(t('Esta conversa não está disponível nesta empresa e área. Escolha uma conversa no histórico ou comece um novo assunto.', 'This conversation is unavailable in this organization and team. Choose a conversation from history or start a new topic.'))
      return
    }
    if (conversaIdRef.current !== id) void abrirConversa(id, 'url')
    // As funções usam refs e não devem reabrir a conversa a cada digitação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversas, conversaNaUrl, sementeNaUrl])

  // O pedido público inicia um assunto próprio, sem herdar o foco de um
  // trabalho anterior. A URL nunca contém o texto nem autoriza um envio.
  useEffect(() => {
    const id = searchParams.get('pedido-inicial')
    if (!id || conversas === null || pedidoLandingProcessadoRef.current === id) return
    pedidoLandingProcessadoRef.current = id
    const pedido = lerPedidoLanding(id)
    if (!pedido) {
      limparPedidoDaLanding(id)
      setAviso(t('O pedido da página inicial não está disponível nesta sessão. Você pode escrever um novo pedido.', 'The request from the home page is unavailable in this session. You can write a new request.'))
      return
    }
    novaConversa()
    if (mensagemRef.current.trim()) setPedidoDaLanding(pedido)
    else {
      mudarReferenciaRascunho(null)
      referenciasRascunhosRef.current.delete('nova')
      mensagemRef.current = pedido.texto
      setMensagem(pedido.texto)
      limparPedidoDaLanding(id)
    }
    campoRef.current?.focus()
    // Uma mudança no pedido ou na lista é o evento; funções de interação
    // leem as refs da conversa atual e não devem reagir a cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, conversas])

  function limparPedidoDaLanding(id: string) {
    consumirPedidoLanding(id)
    setPedidoDaLanding(null)
    setSearchParams(atual => {
      const limpo = new URLSearchParams(atual)
      if (limpo.get('pedido-inicial') === id) limpo.delete('pedido-inicial')
      return limpo
    }, { replace: true })
  }

  function incorporarPedidoDaLanding() {
    if (!pedidoDaLanding) return
    if (!lerPedidoLanding(pedidoDaLanding.id)) {
      limparPedidoDaLanding(pedidoDaLanding.id)
      setAviso(t('O pedido da página inicial expirou. Seu rascunho atual continua no campo.', 'The request from the home page expired. Your current draft is still in the field.'))
      return
    }
    novaConversa()
    const atual = mensagemRef.current
    const texto = atual.trim() ? `${atual}\n\n${pedidoDaLanding.texto}` : pedidoDaLanding.texto
    mensagemRef.current = texto
    setMensagem(texto)
    limparPedidoDaLanding(pedidoDaLanding.id)
    campoRef.current?.focus()
  }

  // Clientes ativos para o select da conversa nova (mesmo fetch do prédio).
  // Prédios sem cadastro de clientes simplesmente ficam sem o select.
  // Recarrega quando a CARTEIRA muda (evento da aba Clientes): as abas ficam
  // montadas ao mesmo tempo, então sem isso o cliente recém-cadastrado não
  // aparecia aqui até a página ser recarregada.
  useEffect(() => {
    if (nivelPredio) return
    let ativo = true
    const buscar = () => {
      api
        .get<unknown>(`/predios/${orgId}/${slug}/clientes`)
        .then((data) => {
          if (!ativo) return
          setClientes(asList<ClienteMini>(data, 'clientes').filter((c) => c.status === 'ativo'))
        })
        .catch(() => {
          if (ativo) setClientes([])
        })
    }
    buscar()
    window.addEventListener('offiz:clientes-mudou', buscar)
    return () => {
      ativo = false
      window.removeEventListener('offiz:clientes-mudou', buscar)
    }
  }, [orgId, slug, nivelPredio])

  // Casos do prédio para o modo "Conversar sobre um Caso" (só juris).
  useEffect(() => {
    if (!ehJuris) return
    let ativo = true
    api
      .get<unknown>(`/predios/${orgId}/${slug}/casos`)
      .then((data) => {
        if (ativo) setCasos(asList<CasoResumo>(data, 'itens', 'casos'))
      })
      .catch(() => {
        if (ativo) setCasos([])
      })
    return () => {
      ativo = false
    }
  }, [ehJuris, orgId, slug])

  // Semente vinda da aba Entregas ("Pedir ajuste"): abre uma conversa NOVA
  // sobre a peça entregue, já com o cliente selecionado e o composer pré-
  // preenchido. O usuário completa "quero ajustar…" e envia; a IA discute e,
  // por ser produção, sugere iniciar uma NOVA tarefa. Consome e limpa os
  // params (recarregar não repete o seed).
  useEffect(() => {
    const peca = searchParams.get('ajustepeca')
    if (!peca) return
    // A mesma transição de “Nova conversa”: também interrompe voz/leitura e
    // limpa uploads, anexos e contrato, inclusive se um upload ainda responde.
    novaConversa(false)
    const cli = searchParams.get('ajustecli')
    const job = searchParams.get('ajustejob')
    const jobId = job && /^[1-9]\d*$/.test(job) && Number.isSafeInteger(Number(job)) ? Number(job) : null
    painelEscolhidoRef.current = jobId != null
    mudarReferenciaRascunho(jobId != null ? { contexto: contextoConversaRef.current, referencia: { jobId, intencao: 'ajustar' } } : null)
    setAjusteJobId(jobId)
    setAjusteEntregaId(null)
    if (jobId != null) abrirPainelEscolhido()
    setClienteNovo(cli ?? '') // o select casa o id assim que os clientes carregam
    // Juris: pula o hub direto para o modo pesquisa (o composer precisa
    // estar visível para a mensagem semeada aparecer).
    if (ehJuris) setModoNovo('pesquisa')
    const semente = `Sobre a entrega “${peca}”, o que eu gostaria de ajustar: `
    sementeRef.current = semente
    setMensagem((atual) => atual.trim() ? `${atual}\n${semente}` : semente)
    const limpo = new URLSearchParams(searchParams)
    limpo.delete('ajustepeca')
    limpo.delete('ajustecli')
    limpo.delete('ajustejob')
    limpo.set('conversa', 'nova')
    selecaoNavegandoRef.current = 'nova'
    setSearchParams(limpo, { replace: true })
  }, [searchParams, setSearchParams])

  // Semente vinda da aba "O que eu já sei": o botão "perguntar sobre isso"
  // abre a conversa com a pergunta já escrita, para o dono só apertar enviar.
  // Consome e limpa o param (recarregar não repete o seed).
  useEffect(() => {
    const pergunta = searchParams.get('pergunta')
    if (!pergunta) return
    novaConversa(false)
    mudarReferenciaRascunho(null)
    if (ehJuris) setModoNovo('pesquisa')
    setMensagem((atual) => atual.trim() ? `${atual}\n${pergunta}` : pergunta)
    const limpo = new URLSearchParams(searchParams)
    limpo.delete('pergunta')
    limpo.set('conversa', 'nova')
    selecaoNavegandoRef.current = 'nova'
    setSearchParams(limpo, { replace: true })
  }, [searchParams, setSearchParams])

  // Rola o thread para o fim quando chegam mensagens novas.
  useEffect(() => {
    if (!rascunhoInicial || rascunhoInicial.preparacao) return
    mudarReferenciaRascunho(rascunhoInicial.referencia
      ? { contexto: contextoConversaRef.current, referencia: rascunhoInicial.referencia }
      : null)
    if (rascunhoInicial.referencia) {
      painelEscolhidoRef.current = true
      abrirPainelEscolhido()
      setAjusteJobId(rascunhoInicial.referencia.jobId)
      setAjusteEntregaId(rascunhoInicial.referencia.entregaId ?? null)
    }
    if (rascunhoInicial.texto) {
      const texto = rascunhoInicial.texto
      const anterior = sementeRef.current
      setMensagem((atual) => !atual.trim() || atual === anterior ? texto : `${atual}\n\n${texto}`)
      sementeRef.current = texto
    }
    campoRef.current?.focus()
  }, [rascunhoInicial])

  useEffect(() => {
    const dados = rascunhoInicial?.preparacao
    if (!dados || preparacaoProcessadaRef.current === rascunhoInicial) return
    const url = searchParams.get('conversa')
    const esperado = dados.destino.conversaId == null ? 'nova' : String(dados.destino.conversaId)
    if (url != null && url !== esperado || dados.sessao !== getSessionIdentity() || dados.orgId !== orgId
      || dados.destino.slug !== (nivelPredio ? 'predio' : slug)) {
      preparacaoProcessadaRef.current = rascunhoInicial
      return
    }
    // Espera o assunto autorizado e seu rascunho; não aplica a outra seleção.
    if (conversas == null || listaEscopoRef.current !== escopoRef.current || carregandoThread) return
    if (dados.destino.conversaId != null && (leituraThreadRef.current?.id !== dados.destino.conversaId
      || leituraThreadRef.current.contexto !== contextoConversaRef.current)) return
    preparacaoProcessadaRef.current = rascunhoInicial
    if (!preparacaoNoDestino(dados, { orgId, slug, nivelPredio, sessao: getSessionIdentity(), conversaId: conversaIdRef.current })
      || rascunhoInicial.texto !== dados.textos.join('\n\n')) return
    const incorporada = !mensagemRef.current.trim()
    setPreparacaoPendente({ dados, contexto: contextoConversaRef.current, incorporada })
    if (incorporada) setMensagem(rascunhoInicial.texto)
  }, [rascunhoInicial, searchParams, conversas, conversaId, carregandoThread, orgId, slug, nivelPredio])

  const { novaAtividade, irAoFim } = useAcompanharFim(threadRef,
    `${orgId}:${slug}:${conversaId}`, conversaId != null && !carregandoThread)

  /** A primeira leitura e sua recuperação restauram o assunto inteiro. O
   * rascunho pertence à seleção e nunca é substituído pela resposta do GET. */
  const consultarThread = useCallback(async (devolverFoco = false) => {
    const id = conversaIdRef.current
    const contexto = contextoConversaRef.current
    const versaoMetadados = versaoMetadadosRef.current
    if (id == null || aberturaThreadRef.current || enviosRef.current.has(contexto)) return
    const controller = new AbortController()
    const focoAnterior = devolverFoco ? document.activeElement : null
    aberturaThreadRef.current = controller
    setCarregandoThread(true)
    setErroThread(null)
    const prazo = window.setTimeout(() => {
      if (aberturaThreadRef.current !== controller || conversaIdRef.current !== id || contextoConversaRef.current !== contexto) return
      controller.abort()
      aberturaThreadRef.current = null
      setCarregandoThread(false)
      setErroThread(t('A consulta demorou demais. Verifique a conexão e carregue a conversa novamente.', 'Loading took too long. Check your connection and load the conversation again.'))
    }, 30_000)
    controller.signal.addEventListener('abort', () => window.clearTimeout(prazo), { once: true })
    try {
      const det = await api.get<ConversaDetalhe>(`/conversas/${id}`, controller.signal)
      if (controller.signal.aborted || conversaIdRef.current !== id || contextoConversaRef.current !== contexto) return
      if (det.id !== id || !conversaDoContexto(det)) throw new Error('Contexto da conversa divergente.')
      const ms = Array.isArray(det.mensagens) ? det.mensagens : []
      leituraThreadRef.current = { id, contexto }
      lembrarSelecao(id)
      setConversa({ ...preservarMetadados(det, versaoMetadados), mensagens: ms })
      setSugestoes(prev => ({ ...prev, ...Object.fromEntries((det.tarefas_iniciadas ?? []).map(id => [id, 'iniciada' as const])) }))
      setAnexos(det.anexos ?? [])
      setErroThread(null)
      if (!painelEscolhidoRef.current) {
        setAjusteJobId(det.trabalho_job_id ?? null)
        setAjusteEntregaId(null)
      }
      if (ms.length > 0 && ms[ms.length - 1].role === 'user') iniciarPolling(id)
      if (devolverFoco) window.setTimeout(() => {
        if (conversaIdRef.current === id && contextoConversaRef.current === contexto
          && (document.activeElement === focoAnterior || document.activeElement === document.body)) campoRef.current?.focus({ preventScroll: true })
      }, 0)
    } catch (e) {
      if (controller.signal.aborted || conversaIdRef.current !== id || contextoConversaRef.current !== contexto) return
      setErroThread(e instanceof ApiError ? e.detail : t('Não foi possível abrir a conversa.', 'Could not open the conversation.'))
    } finally {
      window.clearTimeout(prazo)
      if (aberturaThreadRef.current === controller) aberturaThreadRef.current = null
      if (!controller.signal.aborted && conversaIdRef.current === id && contextoConversaRef.current === contexto) setCarregandoThread(false)
    }
    // Trocar empresa/área não pode reutilizar um verificador de outro contexto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, slug, nivelPredio, iniciarPolling, t])

  /** Recarrega SÓ as mensagens da conversa aberta (sem resetar o resto do
   *  estado): é como a DEVOLUTIVA aparece — o finish a escreve DEPOIS que o
   *  polling do chat parou, e o painel avisa quando o trabalho termina. */
  const recarregarMensagens = useCallback(async () => {
    const id = conversaIdRef.current
    const contexto = contextoConversaRef.current
    const versaoMetadados = versaoMetadadosRef.current
    const revisaoAnexos = revisaoAnexosRef.current
    if (id == null) return
    if (enviosRef.current.has(contexto)) {
      refreshAposEnvioRef.current = true
      return
    }
    if (leituraThreadRef.current?.id !== id || leituraThreadRef.current.contexto !== contexto) {
      await consultarThread()
      return
    }
    refreshMensagensRef.current?.abort()
    const controller = new AbortController()
    refreshMensagensRef.current = controller
    try {
      const det = await api.get<ConversaDetalhe>(`/conversas/${id}`, controller.signal)
      if (controller.signal.aborted || conversaIdRef.current !== id || contextoConversaRef.current !== contexto) return
      if (det.id !== id || !conversaDoContexto(det)) throw new Error('Contexto da conversa divergente.')
      const ms = Array.isArray(det.mensagens) ? det.mensagens : []
      setConversa({ ...preservarMetadados(det, versaoMetadados), mensagens: ms })
      // Não substituir um upload confirmado nem ressuscitar um vínculo
      // removido com uma leitura iniciada antes da alteração dos anexos.
      if (revisaoAnexosRef.current === revisaoAnexos && mutacaoAnexosRef.current?.contexto !== contexto) {
        setAnexos(det.anexos ?? [])
      }
      if (!painelEscolhidoRef.current) {
        const retomada = retomadaPainelRef.current
        const destino = retomada != null && det.trabalhos?.some(j => j.id === retomada)
          ? retomada : det.trabalho_job_id
        if (destino != null && (retomada == null || destino === retomada)) {
          setAjusteJobId(destino)
          setAjusteEntregaId(null)
        }
      }
    } catch {
      /* silencioso: é um refresh oportunista, a conversa continua utilizável */
    } finally {
      if (refreshMensagensRef.current === controller) refreshMensagensRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, slug, nivelPredio, consultarThread])

  const trabalhoEmVoo = conversa?.trabalhos?.some(j => j.status === 'queued' || j.status === 'running' || j.finalizando) ?? false
  // A ligação com a tarefa existe desde o início; a coluna de prévia só
  // ganha espaço quando há resultado ou a pessoa pediu para abri-la.
  useEffect(() => {
    if (painelFechadoRef.current || painelEscolhidoRef.current || ajusteJobId == null) return
    const trabalho = conversa?.trabalhos?.find(j => j.id === ajusteJobId)
    if (trabalho && !trabalho.finalizando && !['queued', 'running'].includes(trabalho.status)
      && trabalho.entregas.some(e => e.tipo !== 'interno' && e.tipo !== 'devolutiva')) setPainelAberto(true)
  }, [ajusteJobId, conversa?.trabalhos])
  useEffect(() => {
    if (conversaId == null) return
    const refresh = () => {
      if (document.hidden) return
      void recarregarMensagens()
      // O resumo lateral também muda ao concluir. Atualizar só as mensagens
      // deixava "Trabalhando agora" mesmo depois de a entrega ficar disponível.
      void carregarConversas()
    }
    const off = wsClient.on('job_status', msg => {
      const status = msg as WsJobStatus
      if (status.org_id === orgId && (nivelPredio || status.office_slug === slug)) refresh()
    })
    const reconectou = wsClient.on('_conectado', refresh)
    const retomou = (event: Event) => {
      const detalhe = (event as CustomEvent<{ orgId: number; slug: string; conversaId: number; origemId: number; jobId: number }>).detail
      if (!detalhe || detalhe.orgId !== orgId || detalhe.conversaId !== conversaIdRef.current || (!nivelPredio && detalhe.slug !== slug)) return
      if (!painelEscolhidoRef.current && ajusteJobIdRef.current === detalhe.origemId) {
        retomadaPainelRef.current = detalhe.jobId
        setAjusteJobId(detalhe.jobId)
        setAjusteEntregaId(null)
      }
      refresh()
    }
    window.addEventListener('offiz:trabalho-retomado', retomou)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    // Recupera o término mesmo se o socket perder um evento; não mantém
    // consultas periódicas depois de todos os trabalhos da conversa acabarem.
    const timer = trabalhoEmVoo ? window.setInterval(refresh, 10000) : null
    return () => {
      off(); reconectou()
      if (timer != null) window.clearInterval(timer)
      window.removeEventListener('offiz:trabalho-retomado', retomou)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      refreshMensagensRef.current?.abort()
    }
  }, [orgId, slug, nivelPredio, conversaId, trabalhoEmVoo, recarregarMensagens, carregarConversas])

  async function abrirConversa(id: number, origem: 'interacao' | 'restaurar' | 'url' = 'interacao') {
    restaurarSelecaoRef.current = false
    pararPolling()
    contextoConversaRef.current += 1
    limparOperacoesDaConversa()
    trocarRascunho(String(id))
    conversaIdRef.current = id
    setConversaId(id)
    if (origem !== 'url') publicarSelecao(id, origem === 'restaurar')
    setConversa(null)
    setErro(null)
    setPedidoVazio(false)
    setErroThread(null)
    setPensando(false)
    setContratoNome(null)
    setAjusteEntregaId(null)
    setAjusteJobId(null)
    setAviso(null)
    setUploads([])
    setEnviandoAnexo(false)
    setIniciandoTarefa(false)
    setEscolhendoAcervo(false)
    setAnexos([])
    setFbAberto(null)
    setFbComentario('')
    setSugestoes(sugestoesSalvas(id))
    await consultarThread()
  }

  function novaConversa(atualizarUrl = true) {
    restaurarSelecaoRef.current = false
    lembrarSelecao(null)
    pararPolling()
    contextoConversaRef.current += 1
    limparOperacoesDaConversa()
    trocarRascunho('nova')
    conversaIdRef.current = null
    setConversaId(null)
    if (atualizarUrl) publicarSelecao(null)
    setConversa(null)
    setClienteNovo('')
    setErro(null)
    setPedidoVazio(false)
    setErroThread(null)
    setPensando(false)
    setCarregandoThread(false)
    setAviso(null)
    setUploads([])
    setEnviandoAnexo(false)
    setIniciandoTarefa(false)
    setEscolhendoAcervo(false)
    // Juris: volta ao hub de modos.
    setModoNovo(null)
    setCasoNovo('')
    setContratoNome(null)
    setAnexos([])
    setFbAberto(null)
    setFbComentario('')
    setSugestoes({})
    setAjusteJobId(null)
    setAjusteEntregaId(null)
  }

  async function organizarConversa(c: ConversaResumo, fixar?: boolean) {
    if (getSessionIdentity() !== sessaoDaTela || !conversaDoContexto(c)
      || alterandoConversasRef.current.has(c.id) || excluindoRef.current.has(c.id)) return
    const operacao = Symbol()
    alterandoConversasRef.current.set(c.id, operacao)
    const contexto = contextoHistoricoRef.current
    const escopo = escopoRef.current
    const sessao = getSessionIdentity()
    const vigente = () => contextoHistoricoRef.current === contexto && escopoRef.current === escopo
      && getSessionIdentity() === sessao && alterandoConversasRef.current.get(c.id) === operacao
    let campos: { titulo?: string; fixada?: boolean }
    try {
      if (fixar === undefined) {
        const titulo = await solicitarTexto({
          titulo: t('Renomear conversa', 'Rename conversation'),
          mensagem: t('Dê um nome que ajude a encontrar este assunto. O pedido e os arquivos continuam na mesma conversa.', 'Choose a name that helps you find this topic. The request and files stay in the same conversation.'),
          rotulo: t('Nome da conversa', 'Conversation name'), valorInicial: c.titulo,
          maxLength: 120, acao: t('Salvar nome', 'Save name'), perigoso: false,
        })
        if (titulo === null || titulo === c.titulo || !vigente()) return
        campos = { titulo }
      } else campos = { fixada: fixar }
      if (!vigente()) return
      setAlterandoConversas(atuais => [...atuais, c.id])
      versaoMetadadosRef.current += 1
      consultaHistoricoRef.current?.abort()
      const recebido = await api.patch<ConversaResumo>(`/conversas/${c.id}`, campos)
      if (!vigente()) return
      if (recebido.id !== c.id || !conversaDoContexto(recebido)
        || campos.titulo !== undefined && recebido.titulo !== campos.titulo
        || campos.fixada !== undefined && recebido.fixada !== campos.fixada) throw new Error('Alteração não confirmada.')
      const versao = ++versaoMetadadosRef.current
      const anterior = metadadosConfirmadosRef.current.get(c.id)
      metadadosConfirmadosRef.current.set(c.id, { ...anterior,
        ...(campos.titulo !== undefined ? { titulo: { versao, valor: campos.titulo } } : {}),
        ...(campos.fixada !== undefined ? { fixada: { versao, valor: campos.fixada } } : {}),
      })
      setConversas(atuais => atuais?.map(item => item.id === c.id ? { ...item, ...campos } : item) ?? atuais)
      setConversa(atual => atual?.id === c.id ? { ...atual, ...campos } : atual)
      setErroOrganizacao(atual => atual?.id === c.id ? null : atual)
      sucesso(campos.titulo !== undefined ? t('Nome da conversa salvo.', 'Conversation name saved.')
        : campos.fixada ? t('Conversa fixada.', 'Conversation pinned.') : t('Conversa desafixada.', 'Conversation unpinned.'))
    } catch {
      if (vigente()) setErroOrganizacao({ contexto, id: c.id,
        texto: t(`Não foi possível confirmar a alteração de “${c.titulo}”. Confira o histórico antes de tentar alterar de novo.`, `The change to “${c.titulo}” could not be confirmed. Check history before trying to change it again.`) })
    } finally {
      if (alterandoConversasRef.current.get(c.id) === operacao) {
        alterandoConversasRef.current.delete(c.id)
        if (contextoHistoricoRef.current === contexto) setAlterandoConversas(atuais => atuais.filter(id => id !== c.id))
      }
    }
  }

  async function excluir(c: ConversaResumo) {
    if (getSessionIdentity() !== sessaoDaTela || !conversaDoContexto(c)
      || excluindoRef.current.has(c.id) || alterandoConversasRef.current.has(c.id)) return
    excluindoRef.current.add(c.id)
    const nome = c.titulo || t(`Conversa #${c.id}`, `Conversation #${c.id}`)
    const escopoDestino = escopoRef.current
    const sessaoDestino = getSessionIdentity()
    const contextoDestino = contextoHistoricoRef.current
    const rascunhoDestino = escopoRascunhoRef.current
    try {
      if (!await confirmar({
        titulo: t('Excluir conversa', 'Delete conversation'),
        mensagem: t(`Excluir a conversa “${nome}”? Isso não pode ser desfeito.`, `Delete the conversation “${nome}”? This cannot be undone.`),
        acao: t('Excluir conversa', 'Delete conversation'),
      })) return
      if (contextoHistoricoRef.current !== contextoDestino || escopoRef.current !== escopoDestino || getSessionIdentity() !== sessaoDestino) return
      setExcluindo(atuais => [...atuais, c.id])
      await api.del(`/conversas/${c.id}`)
      guardarRascunho(rascunhoDestino, String(c.id), '')
      if (contextoHistoricoRef.current !== contextoDestino || escopoRef.current !== escopoDestino || getSessionIdentity() !== sessaoDestino) return
      versaoMetadadosRef.current += 1
      consultaHistoricoRef.current?.abort()
      metadadosConfirmadosRef.current.delete(c.id)
      setConversas((prev) => (prev ? prev.filter((x) => x.id !== c.id) : prev))
      if (conversaIdRef.current === c.id) novaConversa()
      rascunhosRef.current.delete(String(c.id))
      referenciasRascunhosRef.current.delete(String(c.id))
      sucesso(t('Conversa excluída.', 'Conversation deleted.'))
    } catch (e) {
      if (contextoHistoricoRef.current !== contextoDestino || escopoRef.current !== escopoDestino || getSessionIdentity() !== sessaoDestino) return
      falha(e instanceof ApiError ? e.detail : t('Não foi possível excluir a conversa.', 'Could not delete the conversation.'))
    } finally {
      excluindoRef.current.delete(c.id)
      setExcluindo(atuais => atuais.filter(id => id !== c.id))
    }
  }

  /**
   * Garante que a conversa exista no backend (cria na primeira ação).
   * No juris a criação envia o modo escolhido (e o caso, no modo 'caso').
   */
  async function garantirConversa(): Promise<number> {
    if (conversaIdRef.current != null) return conversaIdRef.current
    const contexto = contextoConversaRef.current
    if (criacaoConversaRef.current?.contexto === contexto) return criacaoConversaRef.current.promessa
    const corpo: Record<string, unknown> = {}
    if (clienteNovo) corpo.cliente_id = Number(clienteNovo)
    if (ehJuris) {
      const modo: ModoConversa = modoNovo ?? 'pesquisa'
      corpo.modo = modo
      if (modo === 'caso' && casoNovo) corpo.caso_id = Number(casoNovo)
    }
    // Vínculo com o trabalho que está sendo ajustado (o backend valida que ele
    // é deste andar e injeta o contexto no prompt).
    if (ajusteJobId != null) {
      corpo.ajuste_job_id = ajusteJobId
      if (ajusteEntregaId != null) corpo.ajuste_entrega_id = ajusteEntregaId
    }
    const promessa = api.post<ConversaDetalhe>(
      nivelPredio ? `/orgs/${orgId}/predio/conversas` : `/predios/${orgId}/${slug}/conversas`,
      nivelPredio ? undefined : corpo,
    ).then(async (criada) => {
      if (nivelPredio && ajusteJobId != null && contextoConversaRef.current === contexto && referenciaRascunhoRef.current?.contexto !== contexto) {
        await api.put(`/conversas/${criada.id}/trabalho`, { job_id: ajusteJobId, ...(ajusteEntregaId != null ? { entrega_id: ajusteEntregaId } : {}) })
      }
      if (contextoConversaRef.current === contexto) {
        lembrarSelecao(criada.id)
        setConversaId(criada.id)
        conversaIdRef.current = criada.id
        setConversas(anteriores => [criada, ...(anteriores || []).filter(c => c.id !== criada.id)])
        publicarSelecao(criada.id, true)
        chaveRascunhoRef.current = String(criada.id)
        const pendente = lerRascunhos(escopoRascunhoRef.current).nova
        if (pendente) guardarRascunho(escopoRascunhoRef.current, String(criada.id), pendente.texto, pendente.referencia)
        guardarRascunho(escopoRascunhoRef.current, 'nova', '')
        if (rascunhosEmEnvioRef.current.delete('nova')) rascunhosEmEnvioRef.current.add(String(criada.id))
        rascunhosRef.current.delete('nova')
        referenciasRascunhosRef.current.delete('nova')
        setConversa({ ...criada, mensagens: Array.isArray(criada.mensagens) ? criada.mensagens : [] })
        leituraThreadRef.current = { id: criada.id, contexto }
      }
      return criada.id
    }).finally(() => {
      if (criacaoConversaRef.current?.contexto === contexto) criacaoConversaRef.current = null
    })
    criacaoConversaRef.current = { contexto, promessa }
    return promessa
  }

  /** `textoPronto` = chip de resposta pronta: um toque É a resposta, sem
   *  passar pelo campo. Sem ele, envia o que está no composer. */
  async function enviar(textoPronto?: string) {
    if (pensando || enviandoAnexo || removendoAnexo || enviandoContrato || carregandoThread || conversaAindaNaoLida) return
    const contexto = contextoConversaRef.current
    if (enviosRef.current.has(contexto)) return
    // Só os avisos já concluídos deste pedido podem sair após a confirmação.
    // Uploads feitos para o próximo rascunho mantêm suas próprias instâncias.
    const uploadsConfirmadosDoEnvio = new Set(uploads.filter(u => u.estado === 'ok'))
    let alvoId: number | null = null
    const escopoDoEnvio = escopoRascunhoRef.current
    const chaveDoEnvio = chaveRascunhoRef.current
    const referenciaDoEnvio = referenciaRascunhoRef.current?.referencia
    const texto = (textoPronto ?? mensagem).trim()
    if (!texto) {
      setPedidoVazio(true)
      return
    }
    setPedidoVazio(false)
    // Modo 'caso' exige o caso escolhido ANTES de criar a conversa.
    if (ehJuris && conversaId == null && modoNovo === 'caso' && !casoNovo) {
      setErro(t('Escolha o caso sobre o qual você quer conversar.', 'Choose the case you want to discuss.'))
      return
    }
    setErro(null)
    enviosRef.current.add(contexto)
    pararPolling() // envio ativo: a resposta vem no próprio await
    setPensando(true)
    if (antesDeEnviar) {
      try {
        if (!await antesDeEnviar()) return
        if (contextoConversaRef.current !== contexto) return
      } catch {
        setErro(t('Não consegui verificar a conexão. Seu pedido está salvo no campo.', 'Could not check the connection. Your request is still in the field.'))
        return
      } finally {
        enviosRef.current.delete(contexto)
        if (contextoConversaRef.current === contexto) setPensando(false)
      }
      enviosRef.current.add(contexto)
      setPensando(true)
    }
    // Uma leitura iniciada antes do envio não pode substituir suas bolhas.
    // Reconciliar novamente ao terminar também recupera devolutivas recentes.
    if (refreshMensagensRef.current) {
      refreshMensagensRef.current.abort()
      refreshAposEnvioRef.current = true
    }
    // Limpa apenas o pedido enviado. O usuário pode começar outro rascunho
    // enquanto a criação da conversa e a resposta estão pendentes.
    if (textoPronto === undefined) {
      guardarRascunho(escopoDoEnvio, chaveDoEnvio, mensagemRef.current, referenciaDoEnvio)
      rascunhosEmEnvioRef.current.add(chaveDoEnvio)
      mensagemRef.current = ''
      setMensagem('')
    }
    // Fora do try: o catch precisa achar a bolha otimista para removê-la.
    const bolhaId = -Date.now()
    try {
      alvoId = await garantirConversa()
      // O chip responde à conversa; a referência do texto que ficou no campo
      // só acompanha o envio desse rascunho.
      const foco = textoPronto === undefined ? referenciaRascunhoRef.current : null
      if (foco?.contexto === contexto) {
        await api.put(`/conversas/${alvoId}/trabalho`, {
          job_id: foco.referencia.jobId,
          entrega_id: foco.referencia.entregaId ?? null,
          intencao: foco.referencia.intencao,
        })
        if (contextoConversaRef.current !== contexto) return
        painelEscolhidoRef.current = true
        setAjusteJobId(foco.referencia.jobId)
        setAjusteEntregaId(foco.referencia.entregaId ?? null)
      }
      // Bolha do usuário aparece na hora; a da IA chega com a resposta do POST.
      const minha: ConversaMensagem = {
        id: bolhaId,
        role: 'user',
        conteudo: texto,
        criado_em: new Date().toISOString(),
      }
      if (contextoConversaRef.current === contexto) setConversa((prev) => (prev?.id === alvoId ? { ...prev, mensagens: [...prev.mensagens, minha] } : prev))
      // Sem `web_search`: quem decide pesquisar na web é o AGENTE, com o
      // critério que vai no system do backend. O campo continua existindo na
      // API (compatibilidade), só não é mais escolha do usuário.
      // ID CITÁVEL: "#482" numa mensagem aponta a conversa para aquele
      // trabalho — o backend valida (mesma org/andar) e o system passa a
      // carregar o bloco de ajuste daquela tarefa. Best-effort: número que
      // não é um trabalho desta pessoa simplesmente não vincula.
      const citado = texto.match(/#(\d{1,9})\b/)
      if (citado && foco?.contexto !== contexto) {
        const jobCitado = Number(citado[1])
        // O painel pode estar em outra versão sem que o vínculo persistido
        // tenha mudado. Uma citação explícita sempre confirma a versão no
        // servidor antes da mensagem, mesmo quando já está visível ao lado.
        if (Number.isFinite(jobCitado)) {
          try {
            await api.put(`/conversas/${alvoId}/trabalho`, { job_id: jobCitado })
            if (contextoConversaRef.current === contexto) {
              painelEscolhidoRef.current = true
              setAjusteJobId(jobCitado)
              setAjusteEntregaId(null)
              abrirPainelEscolhido()
            }
          } catch (e) {
            // Só um 404 confirmado pode seguir como texto comum. Falha de
            // rede ou de acesso não confirma o vínculo: preservar o rascunho
            // evita gravar a resposta sob o trabalho anterior.
            if (!(e instanceof ApiError && e.status === 404)) throw e
          }
        }
      }
      const resp = await api.post<RespostaMensagem>(`/conversas/${alvoId}/mensagens`, {
        conteudo: texto,
        ...(window.offizMotor?.chatDeviceId ? { motor_local: window.offizMotor.chatDeviceId } : {}),
      })
      // O ACK do próprio envio é uma escolha de continuar a conversa no fim.
      // Atualizações gerais e respostas tardias de outro assunto não movem a leitura.
      if (conversaIdRef.current === alvoId && contextoConversaRef.current === contexto
        && getSessionIdentity() === sessaoDaTela) irAoFim()
      if (textoPronto === undefined) {
        const proximoTexto = chaveRascunhoRef.current === String(alvoId)
          ? mensagemRef.current : rascunhosRef.current.get(String(alvoId))
        if (!proximoTexto?.trim()) {
          concluirRascunho(escopoDoEnvio, String(alvoId), texto)
          concluirRascunho(escopoDoEnvio, chaveDoEnvio, texto)
        }
      }
      const referenciaAlvo = chaveRascunhoRef.current === String(alvoId)
        ? referenciaRascunhoRef.current?.referencia : referenciasRascunhosRef.current.get(String(alvoId))
      if (foco && referenciaAlvo === foco.referencia) {
        concluirReferenciaRascunho(escopoDoEnvio, String(alvoId), foco.referencia)
        referenciasRascunhosRef.current.delete(String(alvoId))
      }
      if (referenciaRascunhoRef.current === foco) mudarReferenciaRascunho(null)
      if (resp?.mensagem) {
        const daIa: ConversaMensagem = {
          ...resp.mensagem,
          sugestao_tarefa: resp.mensagem.sugestao_tarefa ?? resp.sugestao_tarefa ?? null,
        }
        if (conversaIdRef.current === alvoId && contextoConversaRef.current === contexto) {
          if (uploadsConfirmadosDoEnvio.size && getSessionIdentity() === sessaoDaTela) {
            setUploads(atuais => atuais.filter(u => !uploadsConfirmadosDoEnvio.has(u)))
          }
          const recebidas = [daIa, ...(Array.isArray(resp.mensagens_extras) ? resp.mensagens_extras : [])]
          const job = resp.trabalho_iniciado
          const trabalho = job && Number.isSafeInteger(job.id) && job.id > 0 && job.org_id === orgId
            && (nivelPredio || job.office_slug === slug) && ['queued', 'running', 'done', 'failed', 'cancelled'].includes(job.status)
            ? job : null
          const iniciadas = Array.isArray(resp.tarefas_iniciadas)
            ? resp.tarefas_iniciadas.filter(id => Number.isSafeInteger(id) && id > 0) : []
          setConversa(prev => {
            if (prev?.id !== alvoId) return prev
            const ids = new Set(prev.mensagens.map(m => m.id))
            const novas = recebidas.filter(m => { if (ids.has(m.id)) return false; ids.add(m.id); return true })
            const existente = trabalho ? prev.trabalhos?.find(j => j.id === trabalho.id) : undefined
            return {
              ...prev,
              mensagens: [...prev.mensagens, ...novas],
              tarefas_iniciadas: [...new Set([...(prev.tarefas_iniciadas ?? []), ...iniciadas])],
              ...(trabalho ? {
                trabalho_job_id: trabalho.id,
                trabalhos: [...(prev.trabalhos ?? []).filter(j => j.id !== trabalho.id), {
                  ...existente,
                  id: trabalho.id, titulo: trabalho.titulo, status: trabalho.status,
                  criado_em: existente?.criado_em ?? daIa.criado_em, entregas: existente?.entregas ?? [],
                }],
              } : {}),
            }
          })
          if (trabalho) {
            // A criação já foi confirmada pelo servidor. O painel acompanha
            // este mesmo id sem outro POST nem confirmação de início.
            if (!painelEscolhidoRef.current) {
              retomadaPainelRef.current = trabalho.id
              setAjusteJobId(trabalho.id)
              setAjusteEntregaId(null)
              setPainelAberto(false)
            }
            window.dispatchEvent(new Event('offiz:biblioteca-mudou'))
          }
          if (resp.inicio_impedido?.trim() && !daIa.conteudo.includes(resp.inicio_impedido.trim())) setAviso(resp.inicio_impedido.trim())
        }
      }
      if (Array.isArray(resp?.solucoes_atualizadas) && resp.solucoes_atualizadas.length > 0) {
        aoContextoAtualizado?.()
      }
      // Título/tempo/contagem da lista lateral podem ter mudado no backend.
      carregarConversas()
    } catch (e) {
      if (contextoConversaRef.current !== contexto) {
        if (textoPronto === undefined && escopoRascunhoRef.current === escopoDoEnvio) {
          const chave = alvoId != null ? String(alvoId) : 'nova'
          const atual = rascunhosRef.current.get(chave)
          if (!atual?.trim()) { rascunhosRef.current.set(chave, texto); guardarRascunho(escopoDoEnvio, chave, texto, referenciaDoEnvio) }
        }
        return
      }
      tratarErro(e, t('Não foi possível enviar a mensagem.', 'Could not send the message.'))
      // A falha NÃO pode engolir o que a pessoa escreveu: o campo já tinha
      // sido esvaziado e a bolha otimista ficava lá como se tivesse ido.
      // Devolve o texto ao campo (sem atropelar algo já redigitado) e tira a
      // bolha — redigitar cinco minutos de pedido é motivo de desistência.
      // No caminho do chip o campo nunca foi esvaziado: despejar o texto do
      // botão ali por cima seria apagar o rascunho por uma falha de rede.
      if (textoPronto === undefined) {
        setMensagem((atual) => (atual.trim() ? atual : texto))
      }
      setConversa((prev) =>
        prev ? { ...prev, mensagens: prev.mensagens.filter((m) => m.id !== bolhaId) } : prev,
      )
    } finally {
      if (escopoRascunhoRef.current === escopoDoEnvio) {
        rascunhosEmEnvioRef.current.delete(chaveDoEnvio)
        if (alvoId != null) rascunhosEmEnvioRef.current.delete(String(alvoId))
      }
      enviosRef.current.delete(contexto)
      if (contextoConversaRef.current === contexto) {
        setPensando(false)
        if (refreshAposEnvioRef.current) {
          refreshAposEnvioRef.current = false
          void recarregarMensagens()
        }
      }
    }
  }

  /** Upload do contrato (modo 'contrato') — re-upload substitui o arquivo. */
  async function enviarContrato(arquivo: File) {
    if (carregandoThread || conversaAindaNaoLida || enviandoContrato || removendoAnexo) return
    const contexto = contextoConversaRef.current
    if (arquivo.size > CONTRATO_MAX_MB * 1024 * 1024) {
      falha(t(`Arquivo grande demais — o limite é ${CONTRATO_MAX_MB}MB.`, `File too large — the limit is ${CONTRATO_MAX_MB}MB.`))
      return
    }
    setErro(null)
    setEnviandoContrato(true)
    try {
      const id = await garantirConversa()
      const fd = new FormData()
      fd.append('arquivo', arquivo)
      const res = await api.postForm<ContratoUploadResposta>(`/conversas/${id}/contrato`, fd)
      if (contextoConversaRef.current !== contexto) return
      const nome = res?.nome || arquivo.name
      setContratoNome(nome)
      setConversa((prev) => (prev && prev.id === id ? { ...prev, tem_contrato: true } : prev))
      sucesso(t(`Contrato “${nome}” lido — pode perguntar sobre cláusulas, riscos e prazos.`, `Contract “${nome}” read — you can ask about clauses, risks and deadlines.`))
      carregarConversas()
    } catch (e) {
      if (contextoConversaRef.current === contexto) tratarErro(e, t('Não foi possível ler o contrato.', 'Could not read the contract.'))
    } finally {
      if (contextoConversaRef.current === contexto) setEnviandoContrato(false)
      if (contratoInputRef.current) contratoInputRef.current.value = ''
    }
  }

  function soltarContrato(e: DragEvent<HTMLElement>) {
    e.preventDefault()
    setArrastandoContrato(false)
    const arquivo = e.dataTransfer.files?.[0]
    if (arquivo) enviarContrato(arquivo)
  }

  /** WIZARD: anexa VÁRIOS arquivos à conversa (arrastando ou pelo botão) — a IA
   *  passa a conhecer o conteúdo e a cópia vai para entrada/ para a futura
   *  tarefa. Envio SEQUENCIAL: o endpoint recebe um arquivo por request e o
   *  contexto da conversa é read-modify-write no servidor — mandar em paralelo
   *  faria uma resposta sobrescrever a lista da outra. */
  async function enviarAnexos(lista: File[]) {
    if (carregandoThread || conversaAindaNaoLida || enviandoAnexo || removendoAnexo
      || getSessionIdentity() !== sessaoDaTela) return
    const contexto = contextoConversaRef.current
    const contextoAtual = () => contextoConversaRef.current === contexto && getSessionIdentity() === sessaoDaTela
    const atualizarUploads = (atualizar: (lista: UploadInfo[]) => UploadInfo[]) => {
      if (contextoAtual()) setUploads(atualizar)
    }
    const arquivos = lista.filter(Boolean)
    if (arquivos.length === 0) return
    const operacaoAnexos = iniciarAlteracaoAnexos(contexto)
    if (!operacaoAnexos) return
    setErro(null)
    setEnviandoAnexo(true)
    try {
      const id = await garantirConversa()
      if (!contextoAtual()) return
      for (const arquivo of arquivos) {
        // O arquivo em trânsito pode já ter sido recebido. Só interrompemos
        // os próximos envios; não repetimos nem desfazemos a escrita incerta.
        if (!contextoAtual()) break
        const info: UploadInfo = { nome: arquivo.name, tamanho: arquivo.size, estado: 'enviando' }
        atualizarUploads((prev) => [...prev, info])
        if (arquivo.size > ANEXO_MAX_MB * 1024 * 1024) {
          atualizarUploads((prev) =>
            prev.map((u) =>
              u === info ? { ...u, estado: 'erro', erro: t(`maior que ${ANEXO_MAX_MB}MB`, `larger than ${ANEXO_MAX_MB}MB`) } : u,
            ),
          )
          continue
        }
        try {
          const fd = new FormData()
          fd.append('arquivo', arquivo, arquivo.name)
          const res = await api.postForm<AnexoConversaResposta>(`/conversas/${id}/anexos`, fd)
          if (!contextoAtual()) return
          setAnexos(res?.anexos_detalhes ?? (res?.anexos ?? []).map(nome => nome === res.nome ? {
            nome, legivel: res.legivel, leitura_parcial: res.leitura_parcial, leitura_aviso: res.leitura_aviso,
          } : { nome }))
          atualizarUploads((prev) =>
            prev.map((u) =>
              u === info
                ? {
                    ...u,
                    estado: 'ok',
                    nomeAnexo: res?.nome,
                    erro: res?.leitura_parcial ? t('recebido — leitura parcial', 'received — partially read')
                      : res?.leitura_aviso ? t('recebido — confira a leitura abaixo', 'received — check reading details below')
                      : res?.legivel ? undefined : t('recebido — vou usar quando fizer o trabalho', 'received — available for the task'),
                  }
                : u,
            ),
          )
        } catch (e) {
          if (!contextoAtual()) return
          atualizarUploads((prev) =>
            prev.map((u) =>
              u === info
                ? { ...u, estado: 'erro', erro: e instanceof ApiError ? e.detail : t('falhou', 'failed') }
                : u,
            ),
          )
          if ((e instanceof Error || e instanceof DOMException) && e.name === 'AbortError'
            || e instanceof ApiError && [401, 403, 409].includes(e.status)) break
        }
      }
      if (contextoAtual()) carregarConversas()
    } catch (e) {
      if (contextoAtual()) tratarErro(e, t('Não foi possível anexar os arquivos.', 'Could not attach the files.'))
    } finally {
      concluirAlteracaoAnexos(operacaoAnexos)
      if (contextoAtual()) {
        setEnviandoAnexo(false)
        if (anexoInputRef.current) anexoInputRef.current.value = ''
      }
    }
  }

  async function removerAnexo(nome: string) {
    const contexto = contextoConversaRef.current
    const id = conversaIdRef.current
    if (!id || pensando || enviandoAnexo || enviandoContrato || carregandoThread || temTrabalhoAtivo
      || getSessionIdentity() !== sessaoDaTela || remocaoAnexoRef.current?.contexto === contexto) return
    const operacaoAnexos = iniciarAlteracaoAnexos(contexto)
    if (!operacaoAnexos) return
    const operacao = { contexto, nome }
    remocaoAnexoRef.current = operacao
    setRemocaoAnexo(operacao)
    setErro(null)
    try {
      await api.del(`/conversas/${id}/anexos/${encodeURIComponent(nome)}`)
      if (contextoConversaRef.current !== contexto) return
      setAnexos(atual => atual.filter(a => a.nome !== nome))
      setUploads(atual => atual.filter(u => u.nomeAnexo !== nome))
      campoRef.current?.focus({ preventScroll: true })
    } catch (e) {
      if (contextoConversaRef.current === contexto) tratarErro(e, t('Não consegui remover o anexo. Ele continua nesta conversa. Tente novamente.', 'Could not remove the attachment. It remains in this conversation. Please try again.'))
    } finally {
      concluirAlteracaoAnexos(operacaoAnexos)
      if (remocaoAnexoRef.current === operacao) remocaoAnexoRef.current = null
      if (contextoConversaRef.current === contexto) setRemocaoAnexo(null)
    }
  }

  /* ── ANEXAR DO ACERVO ────────────────────────────────────────────────
   * O material que a IA precisa quase sempre já está no escritório, legendado
   * pelo catálogo. Reenviá-lo do computador cria uma SEGUNDA cópia em
   * `entrada/` — mesmo arquivo, sem legenda, que a próxima tarefa vai ler como
   * se fosse outro material. Aqui o dono aponta o que já existe e o pedido
   * sai com o CAMINHO, que é o que o agente sabe abrir. */
  async function abrirAcervoParaAnexar() {
    if (carregandoThread || conversaAindaNaoLida || removendoAnexo) return
    if (consultaAcervoRef.current && !consultaAcervoRef.current.signal.aborted) return
    const contexto = contextoConversaRef.current
    consultaAcervoRef.current?.abort()
    const controller = new AbortController()
    consultaAcervoRef.current = controller
    const viva = () => !controller.signal.aborted && consultaAcervoRef.current === controller && contextoConversaRef.current === contexto
    const repetir = escolhendoAcervo && !!erroAcervoAnexo
    setContextoAcervo(`${orgId}:${slug}:${nivelPredio}:${sessaoDaTela}`)
    setEscolhendoAcervo(true)
    setAcervoAnexo(null)
    setCarregandoAcervoAnexo(true)
    if (!repetir) setErroAcervoAnexo(null)
    try {
      const andares = nivelPredio
        ? (await api.get<{ andares: { slug: string; nome?: string }[] }>(`/orgs/${orgId}/inicio`, controller.signal)).andares
        : [{ slug, nome: office.nome }]
      if (!viva()) return
      const pastas: Record<string, string> = {
        entrada: 'entrada',
        produto: 'memoria/brand/acervo',
        exemplos: 'memoria/brand/acervo/exemplos',
        marca: 'memoria/brand/assets/marca',
        aprovados: 'memoria/brand/acervo/aprovados',
      }
      const lista: ItemAcervoAnexo[] = []
      const resultados = await Promise.all(andares.map(async ({ slug: andar, nome: andarNome }) => ({
        andar,
        andarNome,
        arquivos: await api.get<Record<string, Array<{ nome: string; sub?: string; legenda?: string | null }>>>(`/predios/${orgId}/${andar}/arquivos`, controller.signal),
      })))
      for (const { andar, andarNome, arquivos } of resultados) {
        for (const [pasta, rel] of Object.entries(pastas)) {
          for (const item of arquivos?.[pasta] ?? []) {
            lista.push({ pasta, andar, andarNome, sub: item.sub ?? '', caminho: [rel, item.sub, item.nome].filter(Boolean).join('/'), nome: item.nome, legenda: item.legenda ?? null })
          }
        }
      }
      if (!viva()) return
      setAcervoAnexo(lista)
      setErroAcervoAnexo(null)
    } catch (e) {
      if (!viva()) return
      controller.abort()
      setErroAcervoAnexo(e instanceof ApiError ? e.detail : t('Não consegui abrir o acervo. Tente novamente.', 'Could not open the asset library. Please try again.'))
    } finally {
      if (consultaAcervoRef.current === controller && contextoConversaRef.current === contexto) {
        consultaAcervoRef.current = null
        setCarregandoAcervoAnexo(false)
      }
    }
  }

  function fecharAcervoParaAnexar() {
    consultaAcervoRef.current?.abort()
    consultaAcervoRef.current = null
    setEscolhendoAcervo(false)
    campoRef.current?.focus()
  }

  function iniciarAlteracaoAnexos(contexto: number) {
    if (mutacaoAnexosRef.current?.contexto === contexto) return null
    const operacao = { contexto }
    mutacaoAnexosRef.current = operacao
    revisaoAnexosRef.current += 1
    return operacao
  }

  function concluirAlteracaoAnexos(operacao: { contexto: number }) {
    if (mutacaoAnexosRef.current !== operacao) return
    mutacaoAnexosRef.current = null
    revisaoAnexosRef.current += 1
  }

  async function anexarDoAcervo(item: ItemAcervoAnexo) {
    if (removendoAnexo || enviandoAnexo || carregandoThread || conversaAindaNaoLida) return
    const contexto = contextoConversaRef.current
    const operacaoAnexos = iniciarAlteracaoAnexos(contexto)
    if (!operacaoAnexos) return
    {
      setEnviandoAnexo(true)
      try {
        const id = await garantirConversa()
        const r = await api.post<Pick<AnexoConversaResposta, 'anexos' | 'anexos_detalhes'>>(`/conversas/${id}/acervo`, {
          andar: item.andar, pasta: item.pasta, nome: item.nome, sub: item.sub ?? '',
        })
        if (contextoConversaRef.current !== contexto) return
        setAnexos(r.anexos_detalhes ?? r.anexos.map(nome => ({ nome })))
        setMensagem((atual) => `${atual}${atual.trim() ? '\n' : ''}Use o material ${item.nome} do meu acervo.`)
        fecharAcervoParaAnexar()
      } catch (e) {
        if (contextoConversaRef.current === contexto) tratarErro(e, t('Não consegui selecionar esse material.', 'Could not select this material.'))
      } finally { concluirAlteracaoAnexos(operacaoAnexos); if (contextoConversaRef.current === contexto) setEnviandoAnexo(false) }
      return
    }
  }

  /** Começa a gravar a voz do dono (MediaRecorder do próprio navegador). */
  async function gravarVoz() {
    if (carregandoThread || conversaAindaNaoLida) return
    if (gravando) {
      gravadorRef.current?.stop()
      return
    }
    if (abrindoMicrofoneRef.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      falha(t('Este navegador não deixa gravar áudio. Escreva a mensagem, ou tente pelo Chrome.', 'This browser does not support audio recording. Type your message or try Chrome.'))
      return
    }
    const contexto = contextoConversaRef.current
    abrindoMicrofoneRef.current = true
    try {
      validarVozNoApp()
      const trilha = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (contextoConversaRef.current !== contexto) {
        trilha.getTracks().forEach((t) => t.stop())
        return
      }
      const gravador = new MediaRecorder(trilha)
      gravadorRef.current = gravador
      const pedacos: Blob[] = []
      gravador.ondataavailable = (ev) => {
        if (ev.data.size > 0) pedacos.push(ev.data)
      }
      gravador.onstop = async () => {
        trilha.getTracks().forEach((t) => t.stop())
        if (gravadorRef.current === gravador) gravadorRef.current = null
        if (contextoConversaRef.current !== contexto) return
        setGravando(false)
        const blob = new Blob(pedacos, { type: gravador.mimeType || 'audio/webm' })
        if (blob.size < 1200) return // toque sem querer: nem manda ao servidor
        setTranscrevendo(true)
        try {
          const texto = await transcreverVoz(blob, garantirConversa, () => contextoConversaRef.current === contexto)
          if (contextoConversaRef.current !== contexto) return
          if (!texto) {
            falha(t('Não consegui entender o áudio. Tente de novo, mais perto do microfone.', 'Could not understand the recording. Try again, closer to the microphone.'))
            return
          }
          // Acrescenta ao que já estava escrito, em vez de substituir.
          setMensagem((atual) => (atual ? `${atual.trim()} ${texto}` : texto))
        } catch (e) {
          if (contextoConversaRef.current === contexto) falha(e instanceof ApiError ? e.detail : e instanceof Error ? e.message : t('Não consegui transcrever o áudio agora.', 'Could not transcribe the recording right now.'))
        } finally {
          if (contextoConversaRef.current === contexto) setTranscrevendo(false)
        }
      }
      gravador.start()
      setGravando(true)
      setSegundos(0)
    } catch {
      if (contextoConversaRef.current === contexto) falha(t('Não consegui usar o microfone — autorize o acesso no navegador e tente de novo.', 'Could not use the microphone. Allow access in your browser and try again.'))
    } finally {
      abrindoMicrofoneRef.current = false
    }
  }

  // Cronômetro da gravação + teto de 2 minutos (áudio longo demais some no
  // limite do servidor e demora para transcrever).
  useEffect(() => {
    if (!gravando) return
    const t = window.setInterval(() => {
      setSegundos((s) => {
        if (s + 1 >= 120) gravadorRef.current?.stop()
        return s + 1
      })
    }, 1000)
    return () => window.clearInterval(t)
  }, [gravando])

  /** Arrastar sobre o campo de escrever: aceita TODOS os arquivos soltos. */
  function soltarAnexos(ev: DragEvent<HTMLDivElement>) {
    ev.preventDefault()
    setArrastandoAnexo(false)
    enviarAnexos(Array.from(ev.dataTransfer?.files ?? []))
  }

  /**
   * Aplica a marca proposta pela IA: as cores no tema do prédio e o texto na
   * diretriz de marca.
   *
   * Quem chama é a TELA, com o token do próprio usuário — então a permissão é
   * exatamente a da página de Configurações (só dono/admin do prédio). Um
   * membro comum recebe 403 e a mensagem diz por quê, em vez de a IA prometer
   * o que ela não pode entregar.
   *
   * A diretriz é ACRESCENTADA, nunca sobrescrita: o que o dono já escreveu ali
   * é dele, e uma sugestão de cor não pode apagar a regra de marca dele.
   */
  async function aplicarMarcaSugerida(m: ConversaMensagem, s: SugestaoMarca) {
    const idConversa = conversaIdRef.current
    const contexto = contextoConversaRef.current
    setAplicandoMarca(true)
    try {
      if (s.tema && Object.keys(s.tema).length > 0) {
        await api.put(`/predios/${orgId}/${slug}/personalizacao`, { tema: s.tema })
        // A moldura do prédio relê cor e brasão neste evento — sem ele, o dono
        // só veria a mudança depois de um F5.
        window.dispatchEvent(new Event('offiz:personalizacao-mudou'))
      }
      if (s.diretriz) {
        const atual = await api.get<{ conteudo: string | null }>(
          `/predios/${orgId}/${slug}/conhecimento/marca`,
        )
        const base = (atual.conteudo || '').trimEnd()
        const bloco = `## Sobre mim

${s.diretriz}
`
        await api.put(`/predios/${orgId}/${slug}/conhecimento/marca`, {
          conteudo: base ? `${base}

${bloco}` : bloco,
        })
      }
      registrarSugestaoIniciada(m.id, idConversa)
      sucesso(t('Pronto — deixei isso como o padrão do seu escritório.', 'Done — this is now your office’s default.'))
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        falha(t('Só o dono ou um admin deste escritório pode mudar a identidade dele.', 'Only the owner or an office administrator can change its identity.'))
      } else {
        falha(e instanceof ApiError ? e.detail : t('Não consegui aplicar a mudança.', 'Could not apply the change.'))
      }
    } finally {
      if (contextoConversaRef.current === contexto) setAplicandoMarca(false)
    }
  }

  /** Guarda somente as seções efetivamente revisadas, com comparação
   * atômica da versão exibida. O cartão mantém o rascunho se houver conflito. */
  async function aplicarCanonSugerido(m: ConversaMensagem, confirmacao: ConfirmacaoPerfil) {
    const s = m.sugestao_tarefa
    if (!s || !eSugestaoDeCanon(s)) return
    const idConversa = conversaIdRef.current
    const contexto = contextoConversaRef.current
    setAplicandoMarca(true)
    try {
      await api.post(nivelPredio ? `/orgs/${orgId}/predio/conhecimento/canon/confirmar` : `/predios/${orgId}/${slug}/conhecimento/canon/confirmar`, confirmacao)
      if (contextoConversaRef.current !== contexto || conversaIdRef.current !== idConversa) return
      registrarSugestaoIniciada(m.id, idConversa)
      sucesso(t('Perfil atualizado com as informações que você confirmou.', 'Profile updated with the information you confirmed.'))
      aoContextoAtualizado?.()
    } finally {
      if (contextoConversaRef.current === contexto) setAplicandoMarca(false)
    }
  }

  /** Cria a atividade recorrente proposta pela conversa — com o token do
   *  usuário, então a permissão é exatamente a da aba ⏰ Agenda (owner/admin;
   *  membro comum recebe o 403 com a frase certa). */
  async function criarAgendamentoSugerido(m: ConversaMensagem) {
    const s = m.sugestao_tarefa
    if (!s || !eSugestaoDeAgendamento(s)) return
    const idConversa = conversaIdRef.current
    const contexto = contextoConversaRef.current
    setAgendando(true)
    try {
      await api.post(`/predios/${orgId}/${slug}/agenda`, {
        titulo: s.titulo,
        prompt: s.prompt,
        recorrencia: s.recorrencia,
        dia: s.dia,
        hora: s.hora,
        // uma_vez (27/08): o dia marcado viaja junto; nas recorrentes vai
        // undefined e o backend ignora.
        data: s.data ?? undefined,
        peca_slug: s.peca_slug ?? undefined,
      })
      registrarSugestaoIniciada(m.id, idConversa)
      sucesso(t(`Marcado: ${resumoQuandoAgendamento(s, t)} — dá para ajustar na aba Agenda.`, `Scheduled: ${resumoQuandoAgendamento(s, t)} — you can adjust it in Schedule.`))
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        falha(t('Só o dono ou um admin deste escritório pode agendar atividades.', 'Only the owner or an office administrator can schedule activities.'))
      } else {
        falha(e instanceof ApiError ? e.detail : t('Não consegui agendar agora.', 'Could not schedule this right now.'))
      }
    } finally {
      if (contextoConversaRef.current === contexto) setAgendando(false)
    }
  }

  /** ⏯ RETOMAR uma tarefa que parou pedindo insumos (devolutiva): o dono
   *  enviou o que faltava e a rota /continuar cria a rodada nova, que parte
   *  do que já existe no workspace — inclusive o material recém-anexado. */
  async function retomarDevolutiva(m: ConversaMensagem) {
    const s = m.sugestao_tarefa
    if (!s || !eSugestaoDeDevolutiva(s)) return
    const idConversa = conversaIdRef.current
    const contexto = contextoConversaRef.current
    setIniciandoTarefa(true)
    try {
      const novo = await api.post<Job>(`/jobs/${s.job_id}/continuar`, {})
      if (novo?.id != null && idConversa != null) {
        try {
          await api.put(`/conversas/${idConversa}/trabalho`, {
            job_id: novo.id,
          })
        } catch {
          /* o vínculo é best-effort; a retomada JÁ começou */
        }
        if (conversaIdRef.current === idConversa && contextoConversaRef.current === contexto) {
          painelEscolhidoRef.current = false
          retomadaPainelRef.current = novo.id
          setAjusteJobId(novo.id)
          setAjusteEntregaId(null)
          setPainelAberto(false)
        }
      }
      registrarSugestaoIniciada(m.id, idConversa)
      sucesso(t('Retomada solicitada com o material novo — acompanhe o andamento aqui em cima.', 'Resumption requested with the new material — follow its progress above.'))
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t('Não consegui retomar a tarefa.', 'Could not resume the task.'))
    } finally {
      if (contextoConversaRef.current === contexto) setIniciandoTarefa(false)
    }
  }

  async function iniciarTarefaSugerida(m: ConversaMensagem) {
    const s = m.sugestao_tarefa
    if (
      !s ||
      eSugestaoDeMarca(s) ||
      eSugestaoDeDevolutiva(s) ||
      eSugestaoDeAgendamento(s) ||
      eSugestaoDeCanon(s)
    )
      return
    const idConversa = conversaIdRef.current
    const contexto = contextoConversaRef.current
    setIniciandoTarefa(true)
    try {
      // PLANO multi-andar (CEO fase 2): as etapas rodam em sequência, cada
      // uma no seu andar, e as seguintes recebem os arquivos das anteriores.
      if (s.etapas && s.etapas.length >= 2) {
        const plano = await api.post<{ etapas: { job_id: number }[] }>(`/orgs/${orgId}/predio/planos`, {
          titulo: s.titulo,
          etapas: s.etapas,
          conversa_id: idConversa,
          sugestao_mensagem_id: m.id,
        })
        const primeiro = plano.etapas[0]?.job_id
        registrarSugestaoIniciada(m.id, idConversa)
        if (primeiro && idConversa != null) {
          if (conversaIdRef.current === idConversa) {
            painelEscolhidoRef.current = false
            retomadaPainelRef.current = null
            setAjusteJobId(primeiro)
            setAjusteEntregaId(null)
            setPainelAberto(false)
          }
          try {
            await api.put(`/conversas/${idConversa}/trabalho`, { job_id: primeiro, msg_id: m.id })
            if (conversaIdRef.current === idConversa) await recarregarMensagens()
          } catch { /* O plano já começou; não oferecer um segundo disparo. */ }
        }
        sucesso(
          t(`O plano “${s.titulo}” foi criado — as ${s.etapas.length} etapas entram na fila em sequência. Acompanhe o andamento e as entregas disponíveis.`, `The plan “${s.titulo}” was created — its ${s.etapas.length} steps are queued in sequence. Follow its progress and available deliverables.`),
        )
        return
      }
      // MESMO shape da aba Tarefas: POST /jobs {prompt, cliente_id?, effort xhigh}.
      const corpo: Record<string, unknown> = { prompt: s.prompt, effort: ESFORCO_FIXO, sugestao_mensagem_id: m.id }
      if (s.referencia_job_id != null && s.intencao_referencia) {
        corpo.referencia_job_id = s.referencia_job_id
        corpo.intencao_referencia = s.intencao_referencia
        corpo.escopo_referencia = s.escopo_referencia || 'completo'
        if (s.referencia_entrega_id != null) corpo.referencia_entrega_id = s.referencia_entrega_id
      }
      if (conversa?.cliente_id != null) corpo.cliente_id = conversa.cliente_id
      // DEVOLUTIVA (visão KORÁ): o job nasce SABENDO desta conversa — se a
      // tarefa terminar pedindo insumos, o aviso volta para cá com o ID
      // citável (o PUT /trabalho abaixo é a direção inversa, para o painel).
      if (idConversa != null) corpo.conversa_id = idConversa
      // Conversa do CEO: o andar-alvo veio na sugestão (o backend valida o
      // acesso de novo na criação — o enum orienta, o guard garante).
      const alvo = nivelPredio ? s.andar : slug
      if (!alvo) {
        falha(t('A sugestão veio sem o escritório-alvo — peça de novo, por favor.', 'The suggestion did not specify a destination office. Please ask again.'))
        return
      }
      const criado = await api.post<Job>(`/predios/${orgId}/${alvo}/jobs`, corpo)
      // O FIO NÃO SE CORTA: a tarefa nasceu desta conversa, então a conversa
      // passa a saber dela. Depois da entrega, continuar falando aqui já vem
      // com o contexto do que foi entregue (o mesmo que o "Pedir ajuste" faz) —
      // sem isto o dono tinha que ir na aba Entregas para ser entendido.
      // Best-effort: se falhar, a tarefa JÁ começou e o pior caso é a IA pedir
      // o contexto de novo — nunca derrubar o fluxo por causa do vínculo.
      if (criado?.id != null && idConversa != null) {
        try {
          await api.put(`/conversas/${idConversa}/trabalho`, {
            job_id: criado.id,
            msg_id: m.id,
          })
          if (conversaIdRef.current === idConversa) {
            painelEscolhidoRef.current = false
            retomadaPainelRef.current = null
            setAjusteJobId(criado.id)
            setAjusteEntregaId(null)
            setPainelAberto(false)
          }
        } catch {
          /* segue o jogo */
        }
      }
      registrarSugestaoIniciada(m.id, idConversa)
      // "peça" é vocabulário de advogado — para o dono de empresa é "o trabalho".
      sucesso(t(`Pedido “${s.titulo}” criado — acompanhe o andamento e as entregas disponíveis.`, `Request “${s.titulo}” created — follow its progress and available deliverables.`))
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        // O 412 do backend já vem em português de dono (jobs.py).
        if (contextoConversaRef.current === contexto) setErro(e.detail || t('O escritório ainda não foi ligado.', 'The office has not been activated yet.'))
      } else {
        falha(e instanceof ApiError ? e.detail : t('Não foi possível iniciar a tarefa.', 'Could not start the task.'))
      }
    } finally {
      if (contextoConversaRef.current === contexto) setIniciandoTarefa(false)
    }
  }

  /**
   * Área do direito da conversa (Fase 4): só conhecida quando a conversa é
   * modo 'caso' e o caso está na lista carregada — senão o feedback vai sem área.
   */
  function areaDaConversa(): string | undefined {
    if (!ehJuris || !conversa) return undefined
    const modo = (conversa.modo as ModoConversa | undefined) ?? 'pesquisa'
    if (modo !== 'caso' || conversa.caso_id == null) return undefined
    const c = casos.find((x) => x.id === conversa.caso_id)
    return c?.area_direito || undefined
  }

  /** Fase 4 (juris): registra o 👍/👎 do advogado sobre uma resposta da IA. */
  async function enviarFeedback(m: ConversaMensagem, nota: NotaFeedback, comentario?: string) {
    const alvoId = conversaIdRef.current
    if (alvoId == null || fbEnviando) return
    const contexto = contextoConversaRef.current
    const sessao = getSessionIdentity()
    const vigente = () => contextoConversaRef.current === contexto
      && conversaIdRef.current === alvoId && getSessionIdentity() === sessao
    setFbEnviando(true)
    try {
      const corpo: Record<string, unknown> = {
        origem: 'chat',
        conversa_id: alvoId,
        referencia_id: m.id,
        nota,
        // Trecho da resposta avaliada — dá contexto na gestão dos feedbacks.
        contexto_trecho: m.conteudo.slice(0, 300),
        ...(window.offizMotor?.chatDeviceId ? { motor_local: window.offizMotor.chatDeviceId } : {}),
      }
      const area = areaDaConversa()
      if (area) corpo.area_direito = area
      const texto = comentario?.trim()
      if (texto) corpo.comentario = texto
      const res = await api.post<FeedbackCriado>(`/predios/${orgId}/${slug}/feedbacks`, corpo)
      if (!vigente()) return
      setAvaliadas((prev) => ({ ...prev, [m.id]: nota }))
      setFbAberto(null)
      setFbComentario('')
      if (res?.conflito) {
        setFbConflitos((prev) => ({ ...prev, [m.id]: res.conflito as FeedbackConflito }))
      }
      sucesso(
        res?.analise_conflito === 'nao_realizada'
          ? t('Feedback salvo. A conferência de conflito com as diretrizes não foi realizada; confira manualmente antes de alterar o playbook.', 'Feedback saved. Conflicts with the guidelines were not checked; review them manually before changing the playbook.')
          : nota === 'positivo'
          ? t('Obrigado! Sua avaliação foi registrada.', 'Thanks! Your rating was saved.')
          : t('Feedback registrado.', 'Feedback saved.'),
      )
    } catch (e) {
      if (vigente()) falha(e instanceof ApiError ? e.detail : t('Não foi possível registrar o feedback.', 'Could not save your feedback.'))
    } finally {
      if (vigente()) setFbEnviando(false)
    }
  }

  /** Abre a ferramenta desta área sem trocar o assunto ou seus arquivos.
   * `vista` é o destino atual; `aba`/`f` preservam os links legados. */
  function irParaAba(aba: string) {
    setSearchParams(anterior => {
      const params = new URLSearchParams(anterior)
      if (aba === 'predio') {
        params.set('vista', 'conversa')
        params.delete('aba')
        params.delete('f')
      } else {
        params.set('vista', aba)
        params.set('aba', aba)
        params.set('f', aba)
        if (!nivelPredio) params.set('area', slug)
      }
      return params
    }, { replace: true })
  }

  /** Card "Geração de Peça" do hub: não é modo de chat — vive na aba Casos. */
  function irParaGeracaoDePeca() {
    notificar('info', t('A geração de peça acontece dentro do caso: abra um caso e clique em “Gerar peça”.', 'Documents are drafted within a case: open a case and select “Draft document”.'))
    irParaAba('casos')
  }

  const ehNova = conversaId == null
  // Um link de assunto existente espera a lista autorizada. Não mostrar o
  // rascunho de "nova" nesse intervalo, como se fosse a conversa do link.
  const aguardandoSelecao = ehNova && conversaNaUrl != null && conversaNaUrl !== 'nova'
    && !sementeNaUrl && selecaoNavegandoRef.current !== 'nova'
    && (conversas === null || conversas.some(c => String(c.id) === conversaNaUrl))
  const perguntaComOpcoes = perguntaPendente(conversa?.mensagens, conversa?.tarefas_iniciadas, sugestoes)
  // O resumo pertence à lista autorizada deste contexto. Conservar o assunto
  // conhecido desde a autorização do link, antes do commit da seleção, evita
  // parecer que o clique abriu outra conversa. Não usar uma lista de outro escopo.
  const resumoSelecao = listaEscopoRef.current === escopoRef.current
    ? conversas?.find(c => c.id === conversaId || aguardandoSelecao && String(c.id) === conversaNaUrl)
    : undefined
  const carregandoConversa = !erroThread && (carregandoThread || aguardandoSelecao && !erroHistorico)
  const tituloConversa = conversa?.titulo || resumoSelecao?.titulo || (carregandoConversa
    ? t('Abrindo conversa…', 'Opening conversation…')
    : t('Conversa selecionada', 'Selected conversation'))
  const mensagens = conversa?.mensagens ?? []
  const desfechosPorJob = new Map<number, { dados: DesfechoConversa; original: string }>()
  const pedidosDeInsumos = new Set<number>()
  for (const m of mensagens) {
    const dados = lerDesfecho(m.sugestao_tarefa)
    if (dados?.job_id) desfechosPorJob.set(dados.job_id, { dados, original: m.conteudo })
    if (m.role === 'assistant' && m.sugestao_tarefa && eSugestaoDeDevolutiva(m.sugestao_tarefa)) {
      const id = m.sugestao_tarefa.job_id
      if (Number.isSafeInteger(id) && id > 0 && conversa?.trabalhos?.some(j => j.id === id)) pedidosDeInsumos.add(id)
    }
  }
  // O THREAD REFLETE AS ENTREGAS (24/08/2026): os trabalhos nascidos nesta
  // conversa entram como CARTÕES na linha do tempo, na hora em que terminaram
  // — a conversa-histórico ganha o desfecho estruturalmente, inclusive nas
  // conversas antigas (a mensagem de desfecho do finish só existe nas novas).
  const linhaDoTempo: Array<{ quando: string; m?: (typeof mensagens)[number]; j?: TrabalhoDaConversa }> = [
    ...mensagens.filter(m => {
      const desfecho = lerDesfecho(m.sugestao_tarefa)
      // Uma falha tem um único cartão. Mantém mensagens antigas no banco,
      // mas evita repetir o erro técnico na bolha e no cartão do mesmo job.
      return !(desfecho?.tipo === 'desfecho' && desfecho.status === 'failed'
        && conversa?.trabalhos?.some(j => j.id === desfecho.job_id && j.status === 'failed'))
    }).map((m) => ({ quando: m.criado_em || '', m })),
    ...(conversa?.trabalhos ?? []).map((j) => ({
      quando: j.finalizado_em ?? j.criado_em ?? '',
      j,
    })),
  ].sort((a, b) => (a.quando > b.quando ? 1 : a.quando < b.quando ? -1 : 0))
  const perguntaOriginal = mensagens.find(m => m.id === perguntaComOpcoes)
  const indicePergunta = linhaDoTempo.findIndex(item => item.m?.id === perguntaComOpcoes)
  const perguntaAposCartoes = indicePergunta >= 0 && indicePergunta < linhaDoTempo.length - 1

  // Modo "vigente" da tela (juris): o escolhido no hub (conversa nova) ou o
  // da conversa aberta (conversas antigas sem modo contam como pesquisa).
  const modoAtual: ModoConversa | null = !ehJuris
    ? null
    : ehNova
      ? modoNovo
      : ((conversa?.modo as ModoConversa | undefined) ?? 'pesquisa')

  const cardModoAtual = modoAtual ? CARDS_HUB.find((c) => c.modo === modoAtual) : undefined
  const mostrarHub = ehJuris && ehNova && !aguardandoSelecao && modoNovo === null
  useAlturaPedido(campoRef, mensagem, !mostrarHub && !aguardandoSelecao)
  const temContrato = !!(contratoNome || conversa?.tem_contrato)
  const mostrarContrato = ehJuris && modoAtual === 'contrato' && !carregandoThread
  const nomeDoCaso = (id: string) => {
    const c = casos.find((x) => String(x.id) === id)
    return c ? c.cliente_nome : t(`Caso #${id}`, `Case #${id}`)
  }

  return (
    <div
      className={`conversa-layout${!ehNova ? ' conversa-layout--historico' : ''}${painelConteudo || (ajusteJobId != null && painelAberto) ? ' com-painel' : ''}${painelConteudo ? ' com-area' : ''}`}
    >
      {dialogo}
      {/* ── Coluna esquerda: nova conversa + lista ── */}
      <aside className="conversa-lista" aria-label={t('Suas conversas', 'Your conversations')}>
        <div className="conversa-historico-titulo"><strong>{t('Conversas', 'Conversations')}</strong><span>{nivelPredio ? t('Da empresa', 'Organization') : office.nome}</span></div>
        <button type="button" className="botao botao-primario botao-largo" onClick={() => novaConversa()}>
          <Icone nome="mais" tamanho={15} /> {t('Nova conversa', 'New conversation')}
        </button>
        {Boolean(conversas?.length) && <label className="conversa-busca"><Icone nome="lupa" tamanho={16} /><input type="search" aria-label={t('Buscar conversa', 'Search conversations')} placeholder={t('Buscar conversa', 'Search conversations')} value={buscaConversa} onChange={e => setBuscaConversa(e.target.value)} /></label>}
        {erroHistorico && <p className="alerta alerta-erro" role="alert">{t('Não foi possível carregar o histórico de conversas.', 'Could not load conversation history.')} <button type="button" className="botao-texto" onClick={() => void carregarConversas()}>{t('Tentar novamente', 'Try again')}</button></p>}
        {erroOrganizacao?.contexto === contextoHistoricoRef.current && <p className="alerta alerta-erro conversa-organizacao-erro" role="alert">{erroOrganizacao.texto} <button type="button" className="botao-texto" onClick={() => void carregarConversas()}>{t('Conferir histórico', 'Check history')}</button></p>}
        {conversas === null ? !erroHistorico && (
          <div aria-hidden="true">
            <div className="esqueleto esqueleto-card" />
            <div className="esqueleto esqueleto-card" />
          </div>
        ) : conversas.length === 0 ? (
          <p className="texto-suave conversa-lista-vazia">
            {t('Nenhuma conversa ainda. Peça o que precisar — quando o pedido estiver claro, eu começo o trabalho, e ele aparece pronto em Pedidos e entregas.', 'No conversations yet. Tell me what you need — once the request is clear, I can start the work and it will appear in Requests and deliverables.')}
          </p>
        ) : (
          <ul className="conversa-itens">
            {[...conversas.filter(c => c.fixada), ...conversas.filter(c => !c.fixada)].filter(c => `${c.titulo} ${c.cliente_nome || ''}`.toLocaleLowerCase().includes(buscaConversa.toLocaleLowerCase().trim())).map((c) => (
              <li key={c.id} className="conversa-item-linha">
                <button
                  type="button"
                  className={c.id === conversaId ? 'conversa-item selecionada' : 'conversa-item'}
                  aria-current={c.id === conversaId ? 'true' : undefined}
                  title={c.titulo}
                  onClick={() => abrirConversa(c.id)}
                >
                  <strong className="conversa-item-titulo">{c.titulo || t(`Conversa #${c.id}`, `Conversation #${c.id}`)}</strong>
                  <span className="conversa-item-meta">
                    {c.fixada && <span className="conversa-fixada">{t('Fixada', 'Pinned')}</span>}
                    {(c.sinal || c.resumo?.trim()) && <span className={`conversa-sinal${c.sinal ? ` conversa-sinal--${c.sinal}` : ''}`}>{c.resumo?.trim() || (c.sinal === 'trabalhando' ? t('Em produção', 'In production') : c.sinal === 'precisa_de_voce' ? t('Ver pedido', 'Review request') : t('Entrega disponível', 'Deliverable available'))}</span>}
                    {ehJuris && <SeloModo modo={c.modo} />}
                    {ehJuris && c.caso_nome && (
                      <span title={t('Caso vinculado', 'Linked case')}>
                        <Icone nome="casos" tamanho={15} /> {c.caso_nome}
                      </span>
                    )}
                    {c.cliente_nome && (
                      <span>
                        <Icone nome="pessoa" tamanho={15} /> {c.cliente_nome}
                      </span>
                    )}
                    <span className="conversa-atualizada">{tempoRelativo(c.atualizado_em, idioma)}</span>
                  </span>
                </button>
                <MenuConversa conversa={c} escopo={`${getSessionIdentity()}:${escopoRef.current}:${contextoHistoricoRef.current}`}
                  ocupado={excluindo.includes(c.id) || alterandoConversas.includes(c.id)}
                  aoRenomear={() => void organizarConversa(c)} aoFixar={() => void organizarConversa(c, !c.fixada)}
                  aoExcluir={() => void excluir(c)} />
              </li>
            ))}
          </ul>
        )}
        {Boolean(conversas?.length) && buscaConversa.trim() && !conversas?.some(c => `${c.titulo} ${c.cliente_nome || ''}`.toLocaleLowerCase().includes(buscaConversa.toLocaleLowerCase().trim())) && <p className="texto-suave conversa-lista-vazia">{t('Nenhuma conversa encontrada. Tente outro nome.', 'No conversations found. Try a different name.')}</p>}
      </aside>

      {/* ── Coluna direita: thread + composer ── */}
      <section ref={conversaRegiaoRef} tabIndex={-1} aria-label={t('Conversa atual', 'Current conversation')} className="conversa-painel" aria-busy={carregandoConversa}>
        {(!ehNova || aguardandoSelecao) && <header className="conversa-assunto"><Icone nome="conversa" tamanho={17} /><h1 ref={conversaTituloRef} tabIndex={-1} title={tituloConversa}>{tituloConversa}</h1>
          <InformacoesConversa key={`${getSessionIdentity()}:${orgId}:${conversaId}`} orgId={orgId}
            conversaId={!carregandoConversa ? conversaId : null} mostrarGuia={slug === 'conteudo'} atualizacao={conversa?.mensagens.length ?? 0} />
        </header>}
        {ehNova && !aguardandoSelecao && slug === 'conteudo' && <InformacoesConversa key={`${getSessionIdentity()}:${orgId}:nova`} orgId={orgId}
          conversaId={null} mostrarGuia atualizacao={0} />}
        {aviso && (
          <p className="alerta alerta-aviso" role="alert">
            {aviso}{' '}
            {podeConfigurar && (
              <Link to={`/config/org/${orgId}`}>{t('Concluir a configuração →', 'Complete setup →')}</Link>
            )}
          </p>
        )}

        {!ehNova && conversa?.cliente_nome && (
          <p className="conversa-contexto">
            <Icone nome="pessoa" tamanho={15} /> {t('Conversa sobre o cliente', 'Conversation about the client')}{' '}
            <strong>{conversa.cliente_nome}</strong>
          </p>
        )}

        {/* AS CAIXINHAS DO TRABALHO (15/08/2026): quando a conversa está
            ancorada num job, os três destinos dele ficam à mão — a peça aqui
            do lado, a decisão na vitrine e o quadro no Estúdio. A terceira
            porta é esta própria conversa: pedir ajuste é falar. */}
        {ajusteJobId != null && (aoVerEntregas || aoVerFluxo || !painelAberto) && (
          <div className="conversa-caixinhas" aria-label={t('Atalhos do trabalho desta conversa', 'Shortcuts for this conversation’s work')}>
            <span className="painel-trabalho-id">#{ajusteJobId}</span>
            {!painelAberto && (
              <button
                type="button"
                className="botao botao-fantasma botao-pequeno"
                onClick={abrirPainelEscolhido}
              >
                <Icone nome="olho" tamanho={15} /> {t('Ver aqui do lado', 'View alongside')}
              </button>
            )}
            {aoVerEntregas && (
              <button
                type="button"
                className="botao botao-fantasma botao-pequeno"
                onClick={aoVerEntregas}
              >
                <Icone nome="entregas" tamanho={15} /> {t('Abrir em Pedidos e entregas', 'Open in Requests and deliverables')}
              </button>
            )}
            {aoVerFluxo && (
              <button
                type="button"
                className="botao botao-fantasma botao-pequeno"
                onClick={() => aoVerFluxo(ajusteJobId)}
              >
                <Icone nome="fluxo" tamanho={15} /> {t('Como foi feita — Estúdio', 'How it was made — Studio')}
              </button>
            )}
          </div>
        )}

        {/* Juris: badge do modo + caso vinculado no cabeçalho da conversa */}
        {ehJuris && !ehNova && conversa && (
          <p className="conversa-contexto chathub-contexto">
            <SeloModo modo={conversa.modo} />
            {conversa.caso_nome && (
              <span>
                <Icone nome="casos" tamanho={15} /> {t('Caso:', 'Case:')} <strong>{conversa.caso_nome}</strong>
              </span>
            )}
            <span className="chathub-contexto-dica">{t('o modo é fixo — para trocar, comece outra conversa', 'the mode is fixed — start another conversation to change it')}</span>
          </p>
        )}

        {/* Juris: setup do modo escolhido (conversa ainda não criada) */}
        {ehJuris && ehNova && modoNovo !== null && cardModoAtual && (
          <div className="chathub-setup">
            <button
              type="button"
              className="botao-texto chathub-voltar"
              onClick={() => {
                setModoNovo(null)
                setCasoNovo('')
                setErro(null)
              }}
            >
              {t('← Modos', '← Modes')}
            </button>
            <SeloModo modo={modoNovo} />
            <span className="chathub-setup-texto">
              <strong>{t(...cardModoAtual.titulo)}.</strong> {t(...MODO_DESCRICAO[modoNovo])}
            </span>
          </div>
        )}

        {/* Juris (modo contrato): dropzone/chip do contrato em análise */}
        {mostrarContrato && (
          <div className="chathub-contrato">
            {enviandoContrato ? (
              <span className="chathub-contrato-lendo" role="status" aria-live="polite">
                <span className="cursor-piscando" aria-hidden="true" /> {t('Lendo o contrato…', 'Reading the contract…')}
              </span>
            ) : temContrato ? (
              <>
                <span className="chathub-contrato-chip" title={t('Contrato em análise nesta conversa', 'Contract being reviewed in this conversation')}>
                  <Icone nome="arq-documento" tamanho={15} /> {contratoNome ?? t('Contrato anexado', 'Contract attached')}
                </span>
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={() => contratoInputRef.current?.click()}
                >
                  <Icone nome="loop" tamanho={15} /> {t('Substituir arquivo', 'Replace file')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={arrastandoContrato ? 'chathub-dropzone arrastando' : 'chathub-dropzone'}
                onClick={() => contratoInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setArrastandoContrato(true)
                }}
                onDragLeave={() => setArrastandoContrato(false)}
                onDrop={soltarContrato}
              >
                <Icone nome="arq-documento" tamanho={15} /> {t('Envie o contrato — arraste aqui ou clique', 'Upload the contract — drop it here or click')}<span className="chathub-dropzone-dica">{t('PDF, DOCX ou TXT · máx.', 'PDF, DOCX or TXT · max.')}{' '}{CONTRATO_MAX_MB}MB</span>
              </button>
            )}
            <input
              ref={contratoInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              className="sr-only"
              aria-label={t('Arquivo do contrato', 'Contract file')}
              tabIndex={-1}
              onChange={(e) => {
                const arquivo = e.target.files?.[0]
                if (arquivo) enviarContrato(arquivo)
              }}
            />
          </div>
        )}

        <div className="conversa-thread" ref={threadRef} tabIndex={-1}>
          {/* Boas-vindas: é AQUI que o trabalho começa. Antes esta tela dizia que
              "nada aqui vira entrega" — o oposto do produto: a conversa É o
              caminho de pôr o escritório para trabalhar. */}
          {!ehJuris && ehNova && !aguardandoSelecao && mensagens.length === 0 && !pensando && ajusteJobId != null && (
            <div className="conversa-boasvindas">
              <h2>{rascunhoInicial?.referencia?.intencao === 'discutir' ? t('Conversar sobre esta entrega', 'Discuss this deliverable') : rascunhoInicial?.referencia?.intencao === 'testar' ? t('Preparar o próximo teste', 'Prepare the next test') : t('Ajustar esta entrega', 'Adjust this deliverable')}</h2>
              <p className="texto-suave">{t('A versão escolhida acompanha esta conversa. Conte o que precisa; as versões anteriores continuam guardadas.', 'The selected version accompanies this conversation. Tell us what you need; previous versions stay saved.')}</p>
            </div>
          )}
          {!ehJuris && ehNova && !aguardandoSelecao && mensagens.length === 0 && !pensando && ajusteJobId == null && inicioConteudo}
          {!inicioConteudo && !ehJuris && ehNova && !aguardandoSelecao && mensagens.length === 0 && !pensando && ajusteJobId == null && (
            <div className="conversa-boasvindas">
              <p>
                <strong>{t('Fale com o', 'Talk to')}{' '}{office.nome || slug} {t('— é aqui que o trabalho começa.', '— this is where the work begins.')}</strong>
              </p>
              <p className="texto-suave">
                {t('Peça o que precisar, com as suas palavras, e anexe o que ajudar. Quando o pedido estiver claro eu começo o trabalho, e ele aparece pronto em Pedidos e entregas para o seu OK. Se precisar de algo da internet, eu pesquiso sozinho.', 'Tell me what you need in your own words and attach any useful material. Once the request is clear, I can start the work. It will appear in Requests and deliverables for your approval. I can search the web when needed.')}
              </p>
              {/* AS TAREFAS PRONTAS GANHARAM BOTÃO (23/08/2026): o escritório
                  traz um cardápio inteiro e o dono encontrava só uma caixa de
                  texto vazia — quem não sabe o que pedir, não pede. O chip
                  preenche o compositor com o título; quem dispara é o dono,
                  no botão de enviar, como em qualquer pedido. */}
              {(office.prompts_prontos?.length ?? 0) > 0 && (
                <div className="conversa-chips">
                  <p className="texto-suave" style={{ marginBottom: 6 }}>
                    {t('Ou comece por uma destas:', 'Or start with one of these:')}
                  </p>
                  {(office.prompts_prontos ?? []).slice(0, 6).map((atalho, i) => (
                    <button
                      key={atalho.id ?? i}
                      type="button"
                      className="botao botao-fantasma botao-pequeno"
                      title={atalho.descricao || atalho.titulo}
                      onClick={() => {
                        setMensagem(atual => !atual.trim() || atual.trim() === atalho.titulo.trim()
                          ? atalho.titulo : `${atual}\n${atalho.titulo}`)
                        campoRef.current?.focus({ preventScroll: true })
                      }}
                    >
                      {atalho.titulo}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Juris: HUB com 4 cards (tela de conversa nova) */}
          {mostrarHub && mensagens.length === 0 && !pensando && (
            <div className="chathub">
              <div className="chathub-cabecalho">
                <h3>{t('Como você quer usar a IA jurídica?', 'How would you like to use legal AI?')}</h3>
                <p className="texto-suave">
                  {t('Toda conversa nasce com um modo — para trocar de modo, comece outra conversa.', 'Each conversation has a mode — start another conversation to change it.')}
                </p>
              </div>
              <div className="chathub-cards">
                {CARDS_HUB.map((card) => (
                  <button
                    key={card.key}
                    type="button"
                    className="chathub-card"
                    onClick={() => {
                      if (card.modo === null) {
                        irParaGeracaoDePeca()
                      } else {
                        setErro(null)
                        setModoNovo(card.modo)
                      }
                    }}
                  >
                    <Icone className="chathub-card-icone" nome={card.icone} tamanho={24} />
                    <strong className="chathub-card-titulo">{t(...card.titulo)}</strong>
                    <span className="chathub-card-desc">{t(...card.descricao)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Juris: dica do modo escolhido, antes da primeira mensagem */}
          {ehJuris && ehNova && !aguardandoSelecao && modoNovo !== null && mensagens.length === 0 && !pensando && (
            <div className="conversa-boasvindas">
              {modoNovo === 'contrato' && !temContrato ? (
                <p className="texto-suave">
                  {t('Envie o contrato acima para começar — depois é só perguntar. Você também pode mandar a pergunta primeiro: a IA vai pedir o arquivo.', 'Upload the contract above to begin, then ask your question. You can also ask first: the AI will request the file.')}
                </p>
              ) : modoNovo === 'caso' ? (
                <p className="texto-suave">
                  {t('Escolha o caso abaixo e mande a primeira mensagem — a IA já conhece os dados e os documentos do caso.', 'Choose a case below and send your first message — the AI already has its details and documents.')}
                </p>
              ) : (
                <p className="texto-suave">
                  {t('Pergunte qualquer coisa — as respostas passam pela verificação nas fontes oficiais.', 'Ask a question — answers are checked against official sources.')}
                </p>
              )}
            </div>
          )}

          {carregandoConversa && (
            <div role="status" aria-live="polite">
              <p className="texto-suave">{t('Carregando mensagens e anexos desta conversa…', 'Loading this conversation’s messages and attachments…')}</p>
              <div className="esqueleto esqueleto-card" aria-hidden="true" />
              <div className="esqueleto esqueleto-card" aria-hidden="true" />
            </div>
          )}
          {aguardandoSelecao && erroHistorico && <p className="texto-suave" role="status">{t('Consulte novamente o histórico para abrir este assunto, ou escolha Nova conversa. Seus rascunhos continuam guardados.', 'Retry loading history to open this topic, or choose New conversation. Your drafts remain saved.')}</p>}
          {erroThread && <div className="alerta alerta-erro" role="alert">
            <p>{erroThread}</p>
            <p>{t('Consulte novamente antes de enviar. Seu rascunho foi preservado e nenhuma mensagem será reenviada.', 'Load the conversation again before sending. Your draft is preserved and no messages will be resent.')}</p>
            <button type="button" className="botao botao-fantasma" onClick={() => void consultarThread(true)}>{t('Carregar conversa novamente', 'Load conversation again')}</button>
          </div>}
          {linhaDoTempo.map((item) => {
            if (item.j) {
              const j = item.j
              const rodando = j.status === 'running' || j.status === 'queued'
              const recibo = desfechosPorJob.get(j.id)
              const faltaMaterial = j.status === 'done' && pedidosDeInsumos.has(j.id)
                && !j.entregas.some(e => e.tipo !== 'interno' && e.tipo !== 'devolutiva')
              const aprovada = j.entregas.length > 0 && j.entregas.every(e => e.status === 'aprovada')
              const pendente = j.status === 'done' && !aprovada && temPendenciaDesfecho(recibo?.dados)
              const correcaoId = recibo?.dados.correcao_job_id
              const correcao = correcaoId ? conversa?.trabalhos?.find(t => t.id === correcaoId) : undefined
              const correcaoAtiva = correcao?.status === 'queued' || correcao?.status === 'running'
              return (
                <div key={`trab-${j.id}`} className="conversa-grupo">
                  <div className="conversa-bolha conversa-ia conversa-trabalho-cartao">
                    <div className="conversa-trabalho-topo">
                      <span
                        className={`status-pill ${
                          j.finalizando ? 'status-running' : j.status === 'done'
                            ? faltaMaterial ? 'status-cancelled' : pendente ? correcaoAtiva ? 'status-running' : 'status-cancelled' : 'status-done'
                            : j.status === 'failed'
                              ? 'status-failed'
                              : j.status === 'cancelled'
                                ? 'status-cancelled'
                              : 'status-running'
                        }`}
                      >
                        {j.finalizando ? t('Organizando arquivos', 'Organizing files') : j.status === 'done'
                          ? faltaMaterial ? t('Falta material', 'Needs material') : aprovada ? t('Aprovado', 'Approved')
                            : pendente ? correcaoAtiva ? t('Em correção', 'Being corrected')
                              : correcaoId ? t('Correção encaminhada', 'Correction assigned') : t('Pontos a revisar', 'Points to review')
                            : j.entregas.length > 0 ? t('Pronto para revisar', 'Ready to review') : t('Concluído', 'Completed')
                          : j.status === 'failed'
                            ? t('Não concluído', 'Not completed')
                            : j.status === 'queued'
                              ? t('Na fila', 'Queued')
                            : j.status === 'cancelled'
                              ? t('Interrompido', 'Stopped')
                            : rodando
                              ? t('trabalho rodando', 'task running')
                              : j.status}
                      </span>
                      <strong>{j.titulo}</strong>
                      <span className="painel-trabalho-id">#{j.id}</span>
                    </div>
                    {j.entregas.length > 0 && (
                      <div className="conversa-trabalho-entregas">
                        {j.entregas.slice(0, 3).map((e) => (
                          <span key={e.id} className="conversa-trabalho-chip" title={tipoEntregaLabel(e.tipo, idioma)}>
                            <Icone nome={iconeDoArquivo(e.nome)} tamanho={13} /> {e.nome}
                          </span>
                        ))}
                        {j.entregas.length > 3 && <span className="conversa-trabalho-chip">{t(`+ ${j.entregas.length - 3} arquivos`, `+ ${j.entregas.length - 3} files`)}</span>}
                      </div>
                    )}
                    {j.status === 'failed' && j.erro && (
                      <p className="texto-suave" style={{ margin: '6px 0 0', fontSize: 12 }}>
                        {orientacaoFalha(j.erro, t)}
                      </p>
                    )}
                    {recibo && temPendenciaDesfecho(recibo.dados) && <DetalhesConferencia desfecho={recibo.dados} original={recibo.original} t={t} />}
                    <div className="conversa-trabalho-acoes">
                      {j.entregas.length > 0 && !j.finalizando && (
                        <button type="button" className="botao botao-primario botao-pequeno" onClick={() => { setAjusteJobId(j.id); abrirPainelEscolhido() }}>
                          {j.status === 'done' ? t('Ver entrega', 'View deliverable') : t('Ver arquivos disponíveis', 'View available files')}
                        </button>
                      )}
                      {pendente && correcaoId && aoVerFluxo && (
                        <button type="button" className="botao-texto" onClick={() => aoVerFluxo(correcaoId)}>
                          {t(`Ver correção #${correcaoId}`, `View correction #${correcaoId}`)}
                        </button>
                      )}
                      {aoVerFluxo && (
                        <button type="button" className="botao-texto" onClick={() => aoVerFluxo(j.id)}>
                          {j.status === 'failed' ? t('Ver detalhes do trabalho', 'View task details') : t('ver como foi feito', 'see how it was made')}
                        </button>
                      )}
                    </div>
                    {j.finalizado_em && (
                      <span className="conversa-bolha-quando">{tempoRelativo(j.finalizado_em, idioma)}</span>
                    )}
                  </div>
                </div>
              )
            }
            const m = item.m!
            const contextoDaMensagem = contextoConversaRef.current
            const desfecho = lerDesfecho(m.sugestao_tarefa)
            const temCartao = !!conversa?.trabalhos?.some(j => j.id === desfecho?.job_id)
            const textoMensagem = desfecho?.tipo === 'desfecho' && desfecho.status === 'done'
              ? textoDesfecho(m.conteudo, temCartao, desfecho, idioma === 'en')
                || t('Seu trabalho está pronto para revisão.', 'Your work is ready for review.')
              : m.conteudo
            const estadoSugestao = conversa?.tarefas_iniciadas?.includes(m.id) ? 'iniciada' : sugestoes[m.id]
            const mostrarSugestao = m.role === 'assistant' && m.sugestao_tarefa && estadoSugestao !== 'dispensada'
            // Fase 4 (juris): 👍/👎 discretos nas respostas da IA já persistidas
            // (id > 0 — bolhas otimistas têm id negativo e são do usuário).
            const podeAvaliar = ehJuris && m.role === 'assistant' && m.id > 0
            const notaDada = avaliadas[m.id]
            const conflito = fbConflitos[m.id]
            return (
              <div key={m.id} className="conversa-grupo"
                ref={m.id === perguntaComOpcoes ? perguntaMensagemRef : undefined}
                tabIndex={m.id === perguntaComOpcoes ? -1 : undefined}>
                <div className={m.role === 'user' ? 'conversa-bolha conversa-user' : 'conversa-bolha conversa-ia'}>
                  <div className="conversa-bolha-conteudo">
                    <MarkdownSimples texto={textoMensagem} />
                  </div>
                  {!temCartao && desfecho && temPendenciaDesfecho(desfecho) && <DetalhesConferencia desfecho={desfecho} original={m.conteudo} t={t} />}
                  <span className="conversa-bolha-quando">{tempoRelativo(m.criado_em, idioma)}</span>
                  {podeAvaliar && (
                    <span className="feedback-acoes">
                      {notaDada ? (
                        <span className="feedback-feito" title={t('Feedback já registrado', 'Feedback already saved')}>
                          <Icone
                            nome={notaDada === 'positivo' ? 'polegar-cima' : 'polegar-baixo'}
                            tamanho={15}
                          />{' '}
                          {t('avaliada', 'rated')}
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="feedback-botao"
                            title={t('Avaliar resposta como boa', 'Rate response as good')}
                            aria-label={t('Avaliar resposta como boa', 'Rate response as good')}
                            disabled={fbEnviando}
                            onClick={() => enviarFeedback(m, 'positivo')}
                          >
                            <Icone nome="polegar-cima" tamanho={17} />
                          </button>
                          <button
                            type="button"
                            className="feedback-botao"
                            title={t('Resposta com problema — conte o porquê (opcional)', 'Problem with this response — explain why (optional)')}
                            aria-label={t('Avaliar resposta como ruim', 'Rate response as poor')}
                            disabled={fbEnviando}
                            onClick={() => {
                              setFbAberto((atual) => (atual === m.id ? null : m.id))
                              setFbComentario('')
                            }}
                          >
                            <Icone nome="polegar-baixo" tamanho={17} />
                          </button>
                        </>
                      )}
                    </span>
                  )}
                </div>
                {podeAvaliar && fbAberto === m.id && !notaDada && (
                  <div className="feedback-caixa">
                    <textarea
                      autoFocus
                      rows={2}
                      value={fbComentario}
                      onChange={(e) => setFbComentario(e.target.value)}
                      placeholder={t('O que estava errado ou faltou? (opcional — ajuda o escritório a aprender)', 'What was wrong or missing? (optional — helps the office learn)')}
                      disabled={fbEnviando}
                    />
                    <div className="feedback-caixa-acoes">
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={() => setFbAberto(null)}
                        disabled={fbEnviando}
                      >
                        {t('Cancelar', 'Cancel')}
                      </button>
                      <button
                        type="button"
                        className="botao botao-primario botao-pequeno"
                        onClick={() => enviarFeedback(m, 'negativo', fbComentario)}
                        disabled={fbEnviando}
                      >
                        {fbEnviando ? t('Enviando…', 'Sending…') : t('Enviar feedback', 'Send feedback')}
                      </button>
                    </div>
                  </div>
                )}
                {conflito && (
                  <div className="feedback-conflito" role="note">
                    <p>
                      <strong>{t('⚠️ Isso conflita com o playbook do escritório:', '⚠️ This conflicts with the office’s playbook:')}</strong> {conflito.descricao}
                      {conflito.campo_playbook && (
                        <span className="feedback-conflito-campo"> ({t('campo:', 'field:')} {conflito.campo_playbook})</span>
                      )}
                    </p>
                    <button
                      type="button"
                      className="botao-texto"
                      onClick={() =>
                        setFbConflitos((prev) => {
                          const novo = { ...prev }
                          delete novo[m.id]
                          return novo
                        })
                      }
                    >
                      {t('entendi', 'understood')}
                    </button>
                  </div>
                )}
                {mostrarSugestao &&
                  estadoSugestao === 'iniciada' &&
                  !eSugestaoDeMarca(m.sugestao_tarefa) &&
                  !eSugestaoDeDevolutiva(m.sugestao_tarefa) &&
                  !eSugestaoDeAgendamento(m.sugestao_tarefa) &&
                  !eSugestaoDeCanon(m.sugestao_tarefa) && (
                  <p className="conversa-sugestao-ok" role="status">
                    {t('✓ Pedido criado — acompanhe o andamento e confira as entregas disponíveis para o seu OK.', '✓ Request created — follow its progress and review available deliverables for your approval.')}
                  </p>
                )}
                {mostrarSugestao &&
                  estadoSugestao === 'iniciada' &&
                  eSugestaoDeCanon(m.sugestao_tarefa) && (
                  <p className="conversa-sugestao-ok" role="status">
                    {t('✓ Guardado no que eu já sei — podemos continuar quando quiser.', '✓ Saved to my knowledge — we can continue whenever you like.')}
                  </p>
                )}
                {mostrarSugestao &&
                  estadoSugestao !== 'iniciada' &&
                  eSugestaoDeCanon(m.sugestao_tarefa) && (
                  <PerfilProposto key={`${orgId}:${slug}:${conversaId}:${m.id}`} proposta={m.sugestao_tarefa}
                    canonUrl={nivelPredio ? `/orgs/${orgId}/predio/conhecimento/canon` : `/predios/${orgId}/${slug}/conhecimento/canon`}
                    podeSalvar={podeConfigurar} salvando={aplicandoMarca} continuarSomenteCorrecoes
                    aoConfirmar={confirmacao => aplicarCanonSugerido(m, confirmacao)}
                    aoContinuar={secoes => {
                      if (getSessionIdentity() !== sessaoDaTela || contextoConversaRef.current !== contextoDaMensagem
                        || conversaIdRef.current !== conversaId || escopoRef.current !== `${orgId}/${slug}/${nivelPredio}`) return
                      const correcoes = secoes.map(s => `${s.secao}: ${s.conteudo.trim()}`).join('\n\n')
                      if (correcoes) {
                        setMensagem(atual => atual.trim() ? `${atual}\n\n${correcoes}` : correcoes)
                        campoRef.current?.focus()
                      }
                      setSugestoes(prev => ({ ...prev, [m.id]: 'dispensada' }))
                    }} />
                )}
                {mostrarSugestao &&
                  estadoSugestao === 'iniciada' &&
                  eSugestaoDeAgendamento(m.sugestao_tarefa) && (
                  <p className="conversa-sugestao-ok" role="status">
                    {t('✓ Marcado na Agenda —', '✓ Added to the schedule —')}{' '}{resumoQuandoAgendamento(m.sugestao_tarefa, t)}.
                  </p>
                )}
                {mostrarSugestao &&
                  estadoSugestao !== 'iniciada' &&
                  !nivelPredio &&
                  eSugestaoDeAgendamento(m.sugestao_tarefa) && (
                  <div className="conversa-sugestao">
                    <p className="conversa-sugestao-titulo">
                      <Icone nome="agenda" tamanho={15} /> {t('Quer que eu deixe isso marcado —', 'Would you like me to schedule this —')} <strong>{resumoQuandoAgendamento(m.sugestao_tarefa, t)}</strong>?{' '}
                      {m.sugestao_tarefa.resumo ?? m.sugestao_tarefa.titulo}
                    </p>
                    <div className="conversa-sugestao-acoes">
                      <button
                        type="button"
                        className="botao botao-primario botao-pequeno"
                        disabled={agendando}
                        onClick={() => criarAgendamentoSugerido(m)}
                      >
                        <Icone nome="agenda" tamanho={15} /> {t('Sim, deixar marcado', 'Yes, schedule it')}
                      </button>
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={() => setSugestoes((prev) => ({ ...prev, [m.id]: 'dispensada' }))}
                      >
                        {t('Agora não', 'Not now')}
                      </button>
                    </div>
                  </div>
                )}
                {mostrarSugestao &&
                  estadoSugestao === 'iniciada' &&
                  eSugestaoDeDevolutiva(m.sugestao_tarefa) && (
                  <p className="conversa-sugestao-ok" role="status">
                    {t('✓ Retomada solicitada com o material novo — acompanhe o andamento.', '✓ Resumption requested with the new material — follow its progress.')}
                  </p>
                )}
                {mostrarSugestao &&
                  estadoSugestao !== 'iniciada' &&
                  eSugestaoDeDevolutiva(m.sugestao_tarefa) && (
                  <div className="conversa-sugestao conversa-devolutiva">
                    <p className="conversa-sugestao-titulo">
                      <Icone nome="ampulheta" tamanho={15} /> {t('A tarefa', 'The task')}{' '}
                      <strong>#{m.sugestao_tarefa.job_id}</strong> {t('parou pedindo insumos. Envie aqui o que falta (anexe na conversa) e retome.', 'stopped to request more material. Attach what is missing here, then resume.')}
                    </p>
                    <div className="conversa-sugestao-acoes">
                      <button
                        type="button"
                        className="botao botao-primario botao-pequeno"
                        disabled={iniciandoTarefa}
                        onClick={() => retomarDevolutiva(m)}
                      >
                        <Icone nome="play" tamanho={15} /> {t('Já enviei — retomar a tarefa', 'Material sent — resume task')}
                      </button>
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={() => setSugestoes((prev) => ({ ...prev, [m.id]: 'dispensada' }))}
                      >
                        {t('Deixar para depois', 'Leave for later')}
                      </button>
                    </div>
                  </div>
                )}
                {mostrarSugestao && estadoSugestao === 'iniciada' && eSugestaoDeMarca(m.sugestao_tarefa) && (
                  <p className="conversa-sugestao-ok" role="status">
                    {t('✓ Aplicado — este é o padrão do escritório agora.', '✓ Applied — this is now the office’s default.')}
                  </p>
                )}
                {mostrarSugestao &&
                  estadoSugestao !== 'iniciada' &&
                  eSugestaoDeMarca(m.sugestao_tarefa) && (
                    <CartaoMarca
                      sugestao={m.sugestao_tarefa}
                      ocupado={aplicandoMarca}
                      aoAplicar={() => aplicarMarcaSugerida(m, m.sugestao_tarefa as SugestaoMarca)}
                      aoDispensar={() =>
                        setSugestoes((prev) => ({ ...prev, [m.id]: 'dispensada' }))
                      }
                    />
                  )}
                {/* Cartão genérico de TAREFA: exige prompt/etapas de verdade —
                    um JSON só de enriquecimentos (chips/peça, chat rico 27/08)
                    não pode virar cartão "iniciar undefined". */}
                {mostrarSugestao && estadoSugestao !== 'iniciada' && m.sugestao_tarefa && !eSugestaoDeMarca(m.sugestao_tarefa) && !eSugestaoDeDevolutiva(m.sugestao_tarefa) && !eSugestaoDeAgendamento(m.sugestao_tarefa) && !eSugestaoDeCanon(m.sugestao_tarefa) && !!((m.sugestao_tarefa as { prompt?: string }).prompt || (m.sugestao_tarefa as { etapas?: unknown[] }).etapas) && (
                  <div className="conversa-sugestao">
                    <p className="conversa-sugestao-titulo">
                      <Icone nome="ideia" tamanho={15} />{' '}
                      {m.sugestao_tarefa.etapas
                        ? t('A IA sugere um plano em etapas:', 'The AI suggests a plan with multiple steps:')
                        : t('A IA sugere iniciar uma tarefa:', 'The AI suggests starting a task:')}{' '}
                      <strong>{m.sugestao_tarefa.titulo}</strong>
                    </p>
                    {m.sugestao_tarefa.etapas && (
                      <ol className="conversa-plano-etapas">
                        {m.sugestao_tarefa.etapas.map((e, i) => (
                          <li key={i}>
                            <strong>{e.titulo}</strong>
                            <span className="texto-suave"> — {e.andar}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                    <div className="conversa-sugestao-acoes">
                      <button
                        type="button"
                        className="botao botao-primario botao-pequeno"
                        disabled={iniciandoTarefa}
                        onClick={() => iniciarTarefaSugerida(m)}
                      >
                        <Icone nome="play" tamanho={15} />{' '}
                        {m.sugestao_tarefa.etapas ? t('Sim, iniciar o plano', 'Yes, start the plan') : t('Sim, iniciar tarefa', 'Yes, start the task')}
                      </button>
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={() => setSugestoes((prev) => ({ ...prev, [m.id]: 'dispensada' }))}
                      >
                        {t('Continuar conversando', 'Keep talking')}
                      </button>
                    </div>
                  </div>
                )}
                {/* Cartão-mini da peça (chat rico, 27/08): a tool mostrar_peca
                    vale em QUALQUER conversa do andar, então a promessa "um
                    toque abre o painel" precisa de cartão aqui também — com
                    porta para o Estúdio quando ela existe, e como registro
                    quando não (nunca um botão que não leva a lugar nenhum). */}
                {m.role === 'assistant' &&
                  extrasDaMensagem(m.sugestao_tarefa).peca &&
                  (() => {
                    const p = extrasDaMensagem(m.sugestao_tarefa).peca!
                    const estado =
                      p.estado === 'gerada'
                        ? t('gerada', 'generated')
                        : p.estado === 'com plano'
                          ? t('plano no Estúdio', 'plan in Studio')
                          : t('rascunho', 'draft')
                    const miolo = (
                      <>
                        <Icone nome="estudio" tamanho={16} />
                        <span className="conversa-cartao-peca__texto">
                          <strong>{p.titulo}</strong>
                          <span>{estado}</span>
                        </span>
                      </>
                    )
                    return aoVerPeca ? (
                      <button
                        type="button"
                        className="conversa-cartao-peca"
                        onClick={() => aoVerPeca(p.slug)}
                      >
                        {miolo}
                        <span className="conversa-cartao-peca__abrir">{t('abrir →', 'open →')}</span>
                      </button>
                    ) : (
                      <div className="conversa-cartao-peca conversa-cartao-peca--parado">
                        {miolo}
                      </div>
                    )
                  })()}
              </div>
            )
          })}
          {/* Um único grupo permanece depois dos cartões auxiliares, com
              acesso ao texto original sem repetir ou resumir a proposta. */}
          {perguntaOriginal && <div className="conversa-chips-ia" role="group" aria-label={t('Respostas à pergunta em aberto', 'Replies to the open question')}>
            {perguntaAposCartoes && <button type="button" className="botao-texto" onClick={() => {
              perguntaMensagemRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
              perguntaMensagemRef.current?.focus({ preventScroll: true })
            }}>{t('Ver a pergunta', 'View question')}</button>}
            {extrasDaMensagem(perguntaOriginal.sugestao_tarefa).perguntas!.map(p => <button key={p} type="button"
              className="conversa-chip" disabled={pensando} onClick={() => void enviar(p)}>{p}</button>)}
          </div>}
          {atividadeConteudo && <div className="atividade-chat" aria-label={t('Atividade dos trabalhos', 'Task activity')}>{atividadeConteudo}</div>}
          {pensando && (
            <div className="conversa-bolha conversa-ia conversa-pensando" aria-live="polite">
              <span className="cursor-piscando" aria-hidden="true" /> {t('pensando…', 'thinking…')}
            </div>
          )}
        </div>

        {novaAtividade && <button type="button" className="botao botao-fantasma botao-pequeno conversa-nova-atividade"
          onClick={() => { irAoFim(); threadRef.current?.focus({ preventScroll: true }) }}>
          {t('Ver nova atividade', 'View new activity')}
        </button>}

        {/* Composer: no juris, o hub esconde o composer até escolher o modo */}
        {!mostrarHub && !aguardandoSelecao && (
          <div
            className={`conversa-composer${arrastandoAnexo ? ' arrastando' : ''}`}
            onDragOver={(ev) => {
              ev.preventDefault()
              setArrastandoAnexo(true)
            }}
            onDragLeave={() => setArrastandoAnexo(false)}
            onDrop={soltarAnexos}
          >
            {ehNova && clientes.length > 0 && (
              <label className="conversa-select-cliente">
                <span className="sr-only">{t('Conversar sobre o cliente', 'Discuss a client')}</span>
                <select value={clienteNovo} onChange={(e) => setClienteNovo(e.target.value)}>
                  <option value="">{t('Conversar sobre o cliente… (opcional)', 'Discuss a client… (optional)')}</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {/* Os atalhos do repertório do escritório MORAVAM AQUI e saíram
                (05/08/2026): num andar com aba própria — 🛡️ Teste de segurança —
                a mesma ação aparecia em dois lugares com textos diferentes, e a
                da conversa era a pior das duas (não sabia o estado do
                consentimento nem do site). Um caminho por tarefa. A conversa
                volta a ser o que ela é: falar com as suas palavras. */}
            {ehJuris && ehNova && modoNovo === 'caso' && (
              <label className="conversa-select-cliente chathub-select-caso">
                <span className="sr-only">{t('Caso da conversa', 'Conversation’s case')}</span>
                <select value={casoNovo} onChange={(e) => setCasoNovo(e.target.value)}>
                  <option value="">{t('Escolha o caso…', 'Choose a case…')}</option>
                  {casos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.cliente_nome}
                      {c.numero_processo ? ` · ${c.numero_processo}` : ''}
                    </option>
                  ))}
                </select>
                {casoNovo && (
                  <span className="chathub-select-caso-ok" aria-hidden="true">
                    <Icone nome="casos" tamanho={15} /> {nomeDoCaso(casoNovo)}
                  </span>
                )}
              </label>
            )}
            {ehJuris && ehNova && modoNovo === 'caso' && casos.length === 0 && (
              <p className="texto-suave chathub-sem-casos">
                {t('Nenhum caso cadastrado ainda —', 'No cases yet —')}{' '}
                <button type="button" className="botao-texto" onClick={() => irParaAba('casos')}>
                  {t('crie o primeiro na aba Casos →', 'create your first in Cases →')}
                </button>
              </p>
            )}
            {pedidoDaLanding && <div className="alerta alerta-aviso" role="status">
              <strong>{t('Seu pedido da página inicial', 'Your request from the home page')}</strong>
              <p>{pedidoDaLanding.texto}</p>
              <p>{t('Seu rascunho atual foi preservado.', 'Your current draft has been preserved.')}</p>
              <button type="button" className="botao-texto" onClick={incorporarPedidoDaLanding}>{t('Acrescentar ao meu rascunho', 'Add to my draft')}</button>{' '}
              <button type="button" className="botao-texto" onClick={() => limparPedidoDaLanding(pedidoDaLanding.id)}>{t('Manter só meu rascunho', 'Keep only my draft')}</button>
            </div>}
            {preparacaoVisivel && <div className="alerta alerta-aviso" role="status" aria-label={t('Informações da preparação', 'Information from setup')}>
              <strong>{t('Informações que você trouxe', 'Information you provided')}</strong>
              <p>{t('Essas informações ainda não foram guardadas no perfil. Confira o texto e acrescente seu pedido antes de enviar.', 'This information has not been saved to your profile. Review the text and add your request before sending.')}</p>
              {!preparacaoVisivel.incorporada && <><p>{preparacaoVisivel.dados.textos.join('\n\n')}</p>
                <p>{t('Seu rascunho atual foi preservado.', 'Your current draft has been preserved.')}</p>
                <div className="conversa-sugestao-acoes">
                  <button type="button" className="botao botao-fantasma" style={{ minHeight: 44 }} onClick={incorporarPreparacao}>{t('Acrescentar estas informações', 'Add this information')}</button>
                  <button type="button" className="botao botao-fantasma" style={{ minHeight: 44 }} onClick={() => { if (preparacaoPendente && preparacaoVigente(preparacaoPendente)) setPreparacaoPendente(null) }}>{t('Manter só meu rascunho', 'Keep only my draft')}</button>
                </div>
              </>}
            </div>}
            {rascunhoNaoGuardado && <p className="texto-suave" role="status">{t('Este rascunho está só na tela: não consegui guardá-lo nesta aba. Copie o texto antes de recarregar.', 'This draft is only on screen: it could not be saved in this tab. Copy the text before reloading.')}</p>}
            <textarea
              ref={campoRef}
              aria-label={t('Seu pedido', 'Your request')}
              className="composer-textarea"
              value={mensagem}
              onChange={(e) => { setMensagem(e.target.value); if (e.target.value.trim()) setPedidoVazio(false) }}
              onKeyDown={(e) => {
                // Enter ENVIA — é o gesto que todo mundo já tem no corpo, e
                // exigir Ctrl+Enter fazia a pessoa apertar Enter, ganhar uma
                // linha em branco e travar. Shift+Enter quebra a linha; o
                // Ctrl/Cmd+Enter de antes continua valendo (memória de dedo).
                if (e.key !== 'Enter') return
                // Enter durante composição de acento/IME confirma o caractere,
                // não a mensagem.
                if (e.nativeEvent.isComposing) return
                if (e.shiftKey) return
                e.preventDefault()
                if (!pensando) enviar()
              }}
              placeholder={
                ehJuris && modoAtual === 'contrato' && !temContrato
                  ? t('Envie o contrato acima ou escreva sua pergunta…', 'Upload the contract above or type your question…')
                  : t('Escreva sua mensagem e aperte Enter…', 'Type your message and press Enter…')
              }
              rows={2}
            />
            {/* Anexos do wizard: chips do que a conversa já conhece */}
            {anexos.length > 0 && (
              <div className="conversa-anexos" role="group" tabIndex={0} aria-label={t('Arquivos anexados à conversa', 'Files attached to the conversation')}>
                {anexos.map((anexo) => (
                  <span key={anexo.nome} className="conversa-anexo-chip" title={anexo.origem_exibicao || t('Material selecionado para esta conversa', 'Material selected for this conversation')}>
                    <Icone nome="anexo" tamanho={15} /><span className="conversa-anexo-nome">{anexo.nome_exibicao || anexo.nome}{anexo.origem_exibicao && anexos.filter(a => (a.nome_exibicao || a.nome) === (anexo.nome_exibicao || anexo.nome)).length > 1 && <small> · {anexo.origem_exibicao}</small>}</span>
                    <button type="button" className="botao-texto" disabled={pensando || enviandoAnexo || !!removendoAnexo || enviandoContrato || carregandoThread || temTrabalhoAtivo}
                      title={temTrabalhoAtivo ? t('O trabalho está usando os anexos. Aguarde para remover.', 'The task is using these attachments. Wait before removing them.') : t('Remover da conversa', 'Remove from conversation')}
                      aria-label={t(`Remover ${anexo.nome_exibicao || anexo.nome}${anexo.origem_exibicao ? ` (${anexo.origem_exibicao})` : ''} da conversa`, `Remove ${anexo.nome_exibicao || anexo.nome}${anexo.origem_exibicao ? ` (${anexo.origem_exibicao})` : ''} from conversation`)}
                      onClick={() => void removerAnexo(anexo.nome)}><Icone nome="fechar" tamanho={15} /></button>
                  </span>
                ))}
              </div>
            )}
            {anexos.some(anexo => !!avisoLeituraAnexo(anexo, t)) && (
              <div role="status" aria-label={t('Leitura dos anexos', 'Attachment reading')} className="texto-suave">
                <ul style={{ margin: '8px 0', paddingLeft: 18, fontSize: 12, overflowWrap: 'anywhere' }}>
                  {anexos.filter(anexo => !!avisoLeituraAnexo(anexo, t)).map(anexo => (
                    <li key={anexo.nome}>{anexo.nome_exibicao || anexo.nome} · {avisoLeituraAnexo(anexo, t)}</li>
                  ))}
                </ul>
              </div>
            )}
            {/* O que subiu agora, com o estado de cada arquivo. */}
            {uploads.length > 0 && (
              <ul className="lista-uploads">
                {uploads.map((u, i) => (
                  <li key={`${u.nome}-${i}`} className={`upload-item upload-${u.estado}`}>
                    <span className="upload-nome">{u.nome}</span>
                    <span className="upload-tamanho">{formatBytes(u.tamanho, idioma)}</span>
                    <span className="upload-estado">
                      {u.estado === 'enviando' && t('enviando…', 'uploading…')}
                      {u.estado === 'ok' && (u.erro ?? t('pronto — já posso usar', 'ready — available to use'))}
                      {u.estado === 'erro' && (u.erro ?? t('falhou', 'failed'))}
                    </span>
                    {u.estado !== 'enviando' && (
                      <button
                        type="button"
                        className="botao-texto"
                        disabled={u.estado === 'ok' && !!u.nomeAnexo && (pensando || enviandoAnexo || !!removendoAnexo || enviandoContrato || carregandoThread || temTrabalhoAtivo)}
                        aria-label={u.estado === 'ok' && u.nomeAnexo ? t(`Remover o anexo ${u.nome}`, `Remove attachment ${u.nome}`) : t(`Tirar o aviso de ${u.nome} desta lista`, `Dismiss the notice for ${u.nome}`)}
                        onClick={() => u.estado === 'ok' && u.nomeAnexo ? void removerAnexo(u.nomeAnexo) : setUploads((prev) => prev.filter((x) => x !== u))}
                      >
                        <Icone nome="fechar" tamanho={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {escolhendoAcervo && contextoAcervo === `${orgId}:${slug}:${nivelPredio}:${sessaoDaTela}` && (
              <SeletorAcervoConversa
                key={`${orgId}:${slug}:${nivelPredio}:${sessaoDaTela}`}
                orgId={orgId} slug={slug} nivelPredio={nivelPredio}
                itens={acervoAnexo} carregando={carregandoAcervoAnexo}
                erro={erroAcervoAnexo} ocupado={enviandoAnexo}
                aoSelecionar={item => void anexarDoAcervo(item)}
                aoFechar={fecharAcervoParaAnexar}
                aoConsultarNovamente={() => void abrirAcervoParaAnexar()}
              />
            )}
            <div className="conversa-composer-rodape">
              <span className="conversa-composer-esq">
                <input
                  ref={anexoInputRef}
                  type="file"
                  accept={ACEITA_ANEXO}
                  multiple
                  className="sr-only"
                  aria-label={t('Anexar arquivos à conversa', 'Attach files to the conversation')}
                  tabIndex={-1}
                  onChange={(e) => {
                    enviarAnexos(Array.from(e.target.files ?? []))
                  }}
                />
                <button
                  type="button"
                  className={`botao botao-pequeno ${gravando ? 'botao-perigo gravando' : 'botao-fantasma'}`}
                  disabled={transcrevendo || carregandoThread || conversaAindaNaoLida}
                  title={gravando ? t('Parar e transcrever', 'Stop and transcribe') : t('Falar em vez de escrever', 'Speak instead of typing')}
                  aria-label={gravando ? t('Parar de gravar', 'Stop recording') : t('Falar em vez de escrever', 'Speak instead of typing')}
                  onClick={gravarVoz}
                >
                  {transcrevendo ? (
                    t('Ouvindo…', 'Listening…')
                  ) : gravando ? (
                    <>
                      <Icone nome="parar" tamanho={15} />{' '}
                      {t('Parar', 'Stop')} ({String(Math.floor(segundos / 60))}:{String(segundos % 60).padStart(2, '0')})
                    </>
                  ) : (
                    <>
                      <Icone nome="microfone" tamanho={15} /> {t('Falar', 'Speak')}
                    </>
                  )}
                </button>
                {(
                  <button
                    type="button"
                    className="botao botao-fantasma botao-pequeno"
                    disabled={enviandoAnexo || !!removendoAnexo || carregandoThread || conversaAindaNaoLida}
                    title={t('Anexar arquivos: documento, vídeo, foto ou áudio — ou arraste em cima do campo', 'Attach documents, videos, photos or audio — or drop them on the message field')}
                    onClick={() => anexoInputRef.current?.click()}
                  >
                    {enviandoAnexo ? (
                      t('Anexando…', 'Attaching…')
                    ) : (
                      <>
                        <Icone nome="anexo" tamanho={15} /> {t('Anexar', 'Attach')}
                      </>
                    )}
                  </button>
                )}
                {/* ANEXAR DO ACERVO (16/08/2026): o arquivo que a IA precisa
                    quase sempre JÁ ESTÁ no escritório — mandar o dono achá-lo
                    no computador de novo é pedir para ele duplicar material
                    que o acervo já legendou. Aqui ele aponta o que já existe e
                    a conversa recebe o caminho, não uma segunda cópia. */}
                {(
                  <button
                    type="button"
                    className="botao botao-fantasma botao-pequeno"
                    disabled={enviandoAnexo || !!removendoAnexo || carregandoThread || conversaAindaNaoLida}
                    title={t('Usar um arquivo que já está no seu acervo', 'Use a file already saved in your library')}
                    onClick={abrirAcervoParaAnexar}
                  >
                    <Icone nome="arq-pasta" tamanho={15} /> {t('Do acervo', 'From library')}
                  </button>
                )}
                <span className="texto-suave conversa-dica-arrastar">{t('ou arraste os arquivos aqui', 'or drop files here')}</span>
              </span>
              <button
                type="button"
                className="botao botao-primario"
                onClick={() => void enviar()}
                disabled={pensando || enviandoContrato || enviandoAnexo || !!removendoAnexo || carregandoThread || conversaAindaNaoLida}
              >
                {pensando ? t('Pensando…', 'Thinking…') : t('Enviar', 'Send')}
              </button>
            </div>
            {(erro || pedidoVazio) && (
              <p className="alerta alerta-erro" role="alert">
                {erro || t('Escreva sua mensagem antes de enviar.', 'Write a message before sending.')}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Coluna da ENTREGA: o resultado ao lado de quem pediu ──
          Só existe quando a conversa acompanha um trabalho (nascido dela, ou
          apontado pelo "Pedir ajuste"). O botão de fechar esconde o painel sem
          desfazer o vínculo: a IA continua sabendo de que peça se fala. */}
      {painelConteudo}
      {!painelConteudo && ajusteJobId != null && painelAberto && (
        <PainelTrabalho
          key={ajusteJobId}
          orgId={orgId}
          slug={slug}
          jobId={ajusteJobId}
          aoFechar={() => {
            painelFechadoRef.current = true
            setPainelAberto(false)
            // Navegar de volta não é começar a escrever. O foco identifica a
            // conversa sem abrir o teclado do celular nem usar um timer tardio.
            ;(conversaTituloRef.current || conversaRegiaoRef.current)?.focus()
          }}
          aoSairDeVoo={() => {
            // O finish pode ter escrito a DEVOLUTIVA na conversa — recarrega
            // as mensagens para ela aparecer sem F5.
            void recarregarMensagens()
          }}
          aoAjustar={(texto, entregaId) => {
            // O envio só segue depois que o servidor confirmar a peça escolhida.
            setAjusteEntregaId(entregaId)
            mudarReferenciaRascunho({
              contexto: contextoConversaRef.current,
              referencia: { jobId: ajusteJobId, entregaId, intencao: 'ajustar' },
            })
            // SUBSTITUI quando o que está no campo foi escrito por nós e o dono
            // ainda não digitou nada em cima (o caso comum: a semente do "Pedir
            // ajuste" + um clique numa peça viravam "…gostaria de ajustar:
            // Sobre "Y", quero ajustar:"). Se ele já escreveu algo, ACRESCENTA
            // — o texto dele é dele.
            setMensagem((atual) => {
              const dele = atual.trim()
              if (!dele || dele === (sementeRef.current || '').trim()) return texto
              return `${dele} ${texto}`
            })
            sementeRef.current = texto
            // O foco vai para o campo: o dono clicou em "ajustar esta" para
            // ESCREVER, não para admirar o texto aparecer.
            setTimeout(() => campoRef.current?.focus(), 0)
          }}
        />
      )}
      {ajusteJobId != null && !painelAberto && (
        <button
          type="button"
          className="botao botao-fantasma botao-pequeno conversa-reabrir-painel"
          onClick={abrirPainelEscolhido}
        >
          <Icone nome="entregas" tamanho={15} /> {t('Ver a entrega', 'View deliverable')}
        </button>
      )}
    </div>
  )
}
