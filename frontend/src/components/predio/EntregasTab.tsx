import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, asList, baixarArquivo, respostaAutenticada, ApiError, getSessionIdentity } from '../../lib/api'
import { wsClient } from '../../lib/ws'
import { useToasts } from '../Toasts'
import { useConfirmacao } from '../useConfirmacao'
import { Icone, iconeDoArquivo } from '../Icone'
import { statusEntregaLabel, formatBytes, formatDataHora, tempoRelativo } from '../../lib/format'
import type { Entrega, WsJobStatus } from '../../lib/types'
import ResultadoEntrega, { temResultadoVisivel } from './ResultadoEntrega'
import ConteudoEditorial from './ConteudoEditorial'
import { useIdioma, type Traduzir } from '../../lib/i18n'
import { correspondeBusca } from '../../lib/busca'
import { protegerHtmlPrevia, temRecursosExternosHtml } from '../../lib/previaHtml'
import { hashCorpoProducao, useProducaoSegura, type ConfirmacaoProducao } from './useProducaoSegura'

/** Só a REJEIÇÃO abre painel: ela precisa do motivo (vira guardrail). Aprovar
 *  é um clique só; o elogio opcional virou feedback pós-decisão no histórico. */
type ModoPainel = 'rejeitar'

/** Filtro por DECISÃO: grupos pendentes / aprovados / rejeitados. */
type FiltroStatus = 'todas' | 'pendentes' | 'aprovadas' | 'rejeitadas'

const filtrosStatus = (traduzir: Traduzir): Array<{ valor: FiltroStatus; rotulo: string }> => [
  { valor: 'todas', rotulo: traduzir("Tudo", "All") },
  { valor: 'pendentes', rotulo: traduzir("Aguardando você", "Awaiting you") },
  { valor: 'aprovadas', rotulo: traduzir("Aprovadas", "Approved") },
  { valor: 'rejeitadas', rotulo: traduzir("Rejeitadas", "Rejected") },
]

/** Extensões que abrem INLINE (leitor de etapa) — o resto só baixa. */
function ehTextoLegivel(nome: string): boolean {
  return /\.(md|txt|html?|json|csv)$/i.test(nome)
}

/** Mídia que abre INLINE com player: o vídeo da peça só tinha "Baixar" — o
 *  dono não conseguia ASSISTIR o que veio para aprovar (caso real: a
 *  convocacao-vitoria.mp4 de 49MB). O blob aqui é seguro porque só entra em
 *  <video>/<img>, que não executam script — o perigo documentado no
 *  VisorEntrega é abrir HTML por blob, e isso continua proibido. */
function tipoMidiaInline(nome: string): 'video' | 'imagem' | null {
  if (/\.(mp4|webm|mov|m4v)$/i.test(nome)) return 'video'
  if (/\.(png|jpe?g|webp|gif)$/i.test(nome)) return 'imagem'
  return null
}

/** Baixa a entrega autenticada e devolve um blob: URL (revogar depois!). */
async function lerBlobEntrega(entregaId: number): Promise<string> {
  const res = await respostaAutenticada(`/entregas/${entregaId}/download`)
  return URL.createObjectURL(await res.blob())
}

/** E-mail: tipo explícito do backend ou, nas entregas antigas, o nome do arquivo. */
function ehEmail(e: Entrega): boolean {
  return e.tipo === 'email' || /(dicas|email|newsletter)/i.test(e.nome)
}

/** Bastidores do trabalho: docs de processo, não a peça final. */
export function ehBastidor(e: Entrega): boolean {
  // tipo 'interno' é o contrato novo (o finish marca manifesto/raciocínio/
  // laudo já aprovados); o regex fica como rede para entregas antigas.
  if (e.tipo === 'interno') return true
  return /^(status|raciocinio|raciocínio|manifesto)\.md$/i.test(e.nome) ||
    /^como[-_ ]foi[-_ ]feito\.txt$/i.test(e.nome) ||
    /\.qualidade\.json$/i.test(e.nome)
}

/** Prioridade do "arquivo principal" do trabalho (menor = mais principal).
 *  Vídeo vem PRIMEIRO: quando um trabalho entrega .mp4, o vídeo É a peça —
 *  o contact-sheet.html ao lado é apoio (antes o html ganhava e o dono via
 *  o storyboard em vez do filme). */
function prioridadePrincipal(e: Entrega): number {
  const ext = e.nome.split('.').pop()?.toLowerCase() ?? ''
  const ordem = ['mp4', 'webm', 'mov', 'pdf', 'pptx', 'ppt', 'html', 'htm', 'docx', 'xlsx', 'csv', 'png', 'jpg']
  const i = ordem.indexOf(ext)
  return i === -1 ? ordem.length : i
}

/** Avisa o resto do app (ex.: badge da aba Entregas) que houve decisão. */
function avisarEntregasMudaram() {
  window.dispatchEvent(new CustomEvent('offiz:entregas-mudou'))
}

/** O slug da PEÇA quando o trabalho veio da produção por peça (qualquer
 *  arquivo em outputs/pecas/<slug>/...) — é o que liga o cartão da vitrine
 *  ao quadro "Como foi feita" do Estúdio. */
function pecaDoTrabalho(entregas: Entrega[]): string | null {
  for (const e of entregas) {
    const m = /^outputs\/pecas\/([^/]+)\//.exec(e.caminho_rel.replace(/\\/g, '/'))
    if (m) return m[1]
  }
  return null
}

/* ───────── O QUE DÁ PARA MELHORAR (30/08/2026, pedido do dono) ─────────
   "Quero que a IA seja sincera e fale, depois de cada peça, o que poderia
   melhorar — daí o usuário começa uma nova tarefa. Mas com um limite."

   O limite aparece na TELA, não só no backend: no máximo três, e quando o
   escritório declara TETO (o que falta é material que não existe, não esforço)
   a lista some e sobra a frase honesta. Numa cadeia longa de refações, o aviso
   diz em que volta o dono está — para ele decidir com o dado na mão em vez de
   ir clicando.

   O botão cria a tarefa com o pedido JÁ ESCRITO pelo escritório: sugestão que
   o dono precisa reescrever à mão é crítica, não oferta. Falar no chat continua
   valendo e não foi tocado — são duas portas, não uma substituindo a outra.

   30/08, segunda metade do pedido: o bloco só FALAVA. Um escritório que critica
   e não escuta vira chefe, não funcionário — então a última palavra é do dono,
   por dois caminhos. "Está bom assim" fecha o assunto (e o backend guarda a
   dispensa: reabrir a entrega não traz a cobrança de volta, senão a decisão
   dele não valeria nada). O campo aberto existe porque a lista do escritório é
   um palpite: o dono pode querer outra coisa — inclusive discordar do TETO,
   que é a hora em que ele mais precisa de uma porta e é justo quando não há
   nenhuma sugestão para clicar. */
interface Melhoria {
  o_que: string
  por_que: string
  pedido: string
}

/** Um recibo por intenção, num único balcão do trabalho. A posição da
 * sugestão não identifica o pedido; só o JSON confirmado marca suas iguais. */
function SugestoesMelhoria({ orgId, slug, jobId, melhorias, telaAtual, aoConfirmar }: {
  orgId: number; slug: string; jobId: number; melhorias: Melhoria[]
  telaAtual: () => boolean; aoConfirmar: () => void
}) {
  const { t } = useIdioma()
  const [criadas, setCriadas] = useState<Set<string>>(() => new Set())
  const [validando, setValidando] = useState(false)
  const [ativa, setAtiva] = useState<string | null>(null)
  const atuais = useRef({ melhorias, telaAtual, aoConfirmar })
  atuais.current = { melhorias, telaAtual, aoConfirmar }
  const vivo = useRef(true)
  const trava = useRef(false)
  const sessao = useRef(getSessionIdentity())
  const base = `/predios/${orgId}/${slug}`
  const rota = `${base}/jobs`
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  const atual = () => vivo.current && getSessionIdentity() === sessao.current && atuais.current.telaAtual()
  async function confirmar(meta?: ConfirmacaoProducao) {
    if (!atual()) return
    setValidando(true)
    try {
      // O recibo antigo pode ter vindo de um reload. Nunca use o índice ou a
      // sugestão clicada agora para dizer que aquele pedido foi aceito.
      const pedidos = [...new Set(atuais.current.melhorias.map(m => m.pedido))]
      let iguais: string[] = []
      try {
        if (meta?.corpoSha256) iguais = (await Promise.all(pedidos.map(async pedido => ({ pedido, hash: await hashCorpoProducao({ prompt: pedido }) })))).filter(p => p.hash === meta.corpoSha256).map(p => p.pedido)
      } catch {
        // Sem fingerprint verificável, confirme o trabalho sem atribuí-lo a
        // outra sugestão. Não nasce outro POST para tentar descobrir isso.
      }
      if (!atual()) return
      const vigentes = new Set(atuais.current.melhorias.map(m => m.pedido))
      setCriadas(prev => new Set([...prev, ...iguais.filter(p => vigentes.has(p))]))
      atuais.current.aoConfirmar()
    } finally { if (atual()) setValidando(false) }
  }
  const envio = useProducaoSegura(base, JSON.stringify(['melhoria-sugerida', slug, jobId]), slug,
    (_id, meta) => { void confirmar(meta).catch(() => { /* Uma falha do aviso local não reenvia nem confirma duas vezes. */ }) }, { rota, rotaConsulta: `${rota}/por-intencao`, vincularCorpo: true })
  const ocupado = validando || envio.ocupado && envio.estado !== 'confirmado'
  async function pedir(m: Melhoria) {
    if (!atual() || trava.current || ocupado || criadas.has(m.pedido) || !(envio.podeEditar || envio.estado === 'confirmado')) return
    trava.current = true
    setAtiva(m.pedido)
    try {
      // Só o clique explícito seguinte começa uma nova intenção confirmada.
      if (envio.estado === 'confirmado') envio.prepararOutro()
      await envio.enviar({ prompt: m.pedido })
    } finally { trava.current = false; if (atual()) setAtiva(null) }
  }
  return <>
    {melhorias.map((m, i) => <div key={i} className="melhorar-item">
      <div className="melhorar-texto"><strong>{m.o_que}</strong>{m.por_que && <span className="texto-suave">{m.por_que}</span>}</div>
      <button type="button" className="botao botao-pequeno" disabled={ocupado || criadas.has(m.pedido) || !(envio.podeEditar || envio.estado === 'confirmado')} onClick={() => { void pedir(m) }}>
        {criadas.has(m.pedido) ? t('pedido ✓', 'requested ✓') : ativa === m.pedido && ocupado ? t('Enviando pedido…', 'Sending request…') : t('Pedir isso', 'Request this')}
      </button>
    </div>)}
    {envio.identificando && <p role="status">{t('Verificando sua conta…', 'Verifying your account…')}</p>}
    {(envio.temEnvioPendente || envio.precisaEscolherEnvio) && <p>{t('Há um pedido anterior aguardando confirmação. Confira o envio antes de pedir outra sugestão, ou prepare outro pedido separado.', 'A previous request awaits confirmation. Check it before requesting another suggestion, or prepare a separate request.')}</p>}
    {envio.erro && <p role="alert">{envio.erro}</p>}
    {envio.precisaVerificarConta && <button type="button" className="botao botao-pequeno" onClick={() => { void envio.verificarConta() }}>{t('Verificar conta', 'Verify account')}</button>}
    {envio.precisaEscolherEnvio && <div>{envio.enviosPendentes.map((e, i) => <button type="button" className="botao botao-pequeno" key={e.requestId} onClick={() => envio.selecionarEnvio(e.requestId)}>{t(`Conferir envio ${i + 1}`, `Check submission ${i + 1}`)}</button>)}</div>}
    {(envio.temEnvioPendente || envio.estado === 'repetir') && <button type="button" className="botao botao-pequeno" disabled={ocupado} onClick={() => { void envio.conferir() }}>{t('Conferir envio', 'Check submission')}</button>}
    {envio.estado === 'removido' && <button type="button" className="botao botao-pequeno" onClick={envio.prepararNovo}>{t('Preparar novo pedido', 'Prepare a new request')}</button>}
    {!ocupado && envio.enviosPendentes.length > 0 && <button type="button" className="botao botao-pequeno" onClick={envio.prepararOutro}>{t('Preparar outro pedido', 'Prepare another request')}</button>}
  </>
}

function OqueMelhorar({
  orgId,
  slug,
  jobId,
  conversaId,
  aoCriar,
}: {
  orgId: number
  slug: string
  jobId: number
  conversaId?: number | null
  aoCriar?: () => void
}) {
  const { t: traduzir } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [dados, setDados] = useState<{
    melhorias: Melhoria[]
    teto: string
    rodadas: number
    dispensado: boolean
  } | null>(null)
  const [meuTexto, setMeuTexto] = useState('')
  const [enviandoMeu, setEnviandoMeu] = useState(false)
  const [fechando, setFechando] = useState(false)
  // Só do clique DESTA sessão: o `dispensado` que vem do GET esconde o bloco
  // (é assunto encerrado de antes), mas quem acabou de decidir merece ver que a
  // decisão pegou — sumir sem dizer nada parece bug.
  const [fechadoAgora, setFechadoAgora] = useState(false)
  const sessaoRef = useRef(getSessionIdentity())
  const vivoRef = useRef(true)
  const escopo = JSON.stringify([orgId, slug, jobId, conversaId ?? null])
  const escopoRef = useRef(escopo)
  escopoRef.current = escopo
  const operacoesRef = useRef(new Set<string>())
  const telaAtual = useCallback(() => vivoRef.current
    && getSessionIdentity() === sessaoRef.current && escopoRef.current === escopo, [escopo])
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false } }, [])

  function iniciar(chave: string) {
    if (!telaAtual() || operacoesRef.current.has(chave)) return false
    operacoesRef.current.add(chave)
    return true
  }

  useEffect(() => {
    let vivo = true
    api
      .get<{ melhorias: Melhoria[]; teto: string; rodadas: number; dispensado?: boolean }>(
        `/predios/${orgId}/${slug}/trabalhos/${jobId}/melhorias`,
      )
      .then((r) => {
        if (vivo && telaAtual())
          setDados({
            melhorias: r.melhorias || [],
            teto: r.teto || '',
            rodadas: r.rodadas || 0,
            dispensado: !!r.dispensado,
          })
      })
      // Silêncio de propósito: entrega antiga não tem o campo, e um erro aqui
      // não pode manchar a vitrine com alarme sobre algo opcional.
      .catch(() => { if (vivo && telaAtual()) setDados(null) })
    return () => {
      vivo = false
    }
  }, [orgId, slug, jobId, conversaId, telaAtual])

  /** As duas respostas do dono saem pela MESMA porta porque as duas viram lição:
   *  "está bom" ensina onde é o suficiente, o texto dele ensina o que faltou.
   *  Rota única também evita a tela decidir sozinha o que virou tarefa — quem
   *  cria o job é o backend, com o texto que o dono escreveu. */
  function decidir(corpo: { decisao: 'esta_bom' } | { decisao: 'pedir'; texto: string }) {
    return api.post<{ ok: boolean; dispensado?: boolean; job_id?: number }>(
      `/predios/${orgId}/${slug}/trabalhos/${jobId}/melhorias/decidir`,
      corpo,
    )
  }

  async function estaBom() {
    const chave = `${escopo}:esta_bom`
    if (!iniciar(chave)) return
    setFechando(true)
    try {
      await decidir({ decisao: 'esta_bom' })
      if (!telaAtual()) return
      setFechadoAgora(true)
      // Sem toast: a linha que fica no lugar do bloco já é a confirmação, e
      // dois avisos para um clique discreto viram barulho.
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir("Não deu para registrar agora", "Could not save your decision. Please try again."))
    } finally {
      operacoesRef.current.delete(chave)
      if (telaAtual()) setFechando(false)
    }
  }

  async function pedirMeu() {
    const texto = meuTexto.trim()
    const chave = `${escopo}:meu_pedido`
    if (!texto || !iniciar(chave)) return
    setEnviandoMeu(true)
    try {
      await decidir({ decisao: 'pedir', texto })
      if (!telaAtual()) return
      // Esvaziar é parte do contrato com o dono: o texto virou tarefa, então
      // deixá-lo no campo convida a mandar a mesma coisa duas vezes.
      setMeuTexto((atual) => atual.trim() === texto ? '' : atual)
      sucesso(traduzir("Pedido enviado — acompanhe o andamento", "Request sent — follow its progress"))
      avisarEntregasMudaram()
      aoCriar?.()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir("Não deu para pedir agora", "Could not send the request. Please try again."))
    } finally {
      operacoesRef.current.delete(chave)
      if (telaAtual()) setEnviandoMeu(false)
    }
  }

  if (!dados) return null
  const { melhorias, teto, rodadas, dispensado } = dados
  if (fechadoAgora) {
    return (
      <p className="melhorar-fechado">
        {traduzir("Anotado: esta ficou boa do jeito que está.", "Noted: this one is good as it is.")}
      </p>
    )
  }
  // Assunto já encerrado numa visita anterior — o bloco não volta a cobrar.
  if (dispensado) return null
  // Escritório que não falou nada (entrega antiga, sem como-foi-feito.json) não
  // ganha caixa vazia na vitrine: aí a porta do dono é o "Pedir ajuste".
  if (!melhorias.length && !teto) return null
  const campoId = `melhorar-campo-${jobId}`

  return (
    <div className="melhorar">
      <div className="melhorar-topo">
        <strong>{traduzir("O que dá para melhorar", "What could improve")}</strong>
        <span className="texto-suave">{traduzir("quem diz é o escritório, sobre o próprio trabalho", "the team reviews its own work")}</span>
      </div>
      {teto && !melhorias.length && (
        <p className="melhorar-teto">
          <b>{traduzir("Está no teto do que dá para fazer com o material de hoje.", "This is the limit of what the current materials can support.")}</b> {teto}
        </p>
      )}
      {!!melhorias.length && <SugestoesMelhoria orgId={orgId} slug={slug} jobId={jobId} melhorias={melhorias} telaAtual={telaAtual} aoConfirmar={() => {
        if (!telaAtual()) return
        sucesso(traduzir('Pedido enviado — acompanhe o andamento', 'Request sent — follow its progress'))
        avisarEntregasMudaram()
        aoCriar?.()
      }} />}
      {rodadas >= 3 && (
        <p className="melhorar-aviso">
          {traduzir(`Esta peça já voltou ${rodadas} vezes. Cada volta custa tempo e provedor — vale decidir se o que falta ainda compensa, ou se ela já está boa o suficiente.`, `This deliverable has been revised ${rodadas} times. Each round takes time and provider usage; consider whether another revision is worthwhile or it is good enough.`)}
        </p>
      )}
      {/* A voz do dono. Fica por último de propósito: primeiro ele lê o que o
          escritório achou, depois responde — e o <form> existe para o campo ter
          um envio de verdade (Enter no botão, teclado feliz). */}
      <form
        className="melhorar-eu"
        onSubmit={(ev) => {
          ev.preventDefault()
          void pedirMeu()
        }}
      >
        <div className="melhorar-campo">
          <label htmlFor={campoId}>{traduzir("Ou diga com as suas palavras o que dá para melhorar", "Or describe in your own words what could improve")}</label>
          <textarea
            id={campoId}
            rows={2}
            value={meuTexto}
            onChange={(ev) => setMeuTexto(ev.target.value)}
            placeholder={traduzir("Ex.: o final corta seco, deixe uma frase de fechamento…", "E.g. the ending is abrupt; add a closing sentence…")}
          />
        </div>
        <button
          type="submit"
          className="botao botao-primario botao-pequeno"
          disabled={!meuTexto.trim() || enviandoMeu}
        >
          {enviandoMeu ? traduzir("Enviando…", "Sending…") : traduzir("Pedir isso", "Request this")}
        </button>
      </form>
      {/* Discreto por decisão de desenho, não por descaso: dizer "está bom" é
          resposta legítima, mas quem manda no cartão é o par aprovar/rejeitar. */}
      <div className="melhorar-rodape">
        <button
          type="button"
          className="botao-texto melhorar-ok"
          disabled={fechando}
          onClick={estaBom}
        >
          {fechando ? traduzir("registrando…", "saving…") : traduzir("Está bom assim", "Good as it is")}
        </button>
      </div>
    </div>
  )
}

/** Um TRABALHO = todas as entregas de um job, agrupadas para decisão única. */
interface Trabalho {
  jobId: number
  titulo: string
  cliente: string | null
  clienteId: number | null
  criadoEm: string
  principal: Entrega | null
  outros: Entrega[]
  bastidores: Entrega[]
  total: number
  conversaId: number | null
  conversaTitulo: string | null
}

/* ───────── Plano e Conversa MINIMIZADOS sob o conteúdo final ─────────
   Desenho do dono (27/08): "conteúdo final / --Plano / --Chat, tudo
   minimizado… caso eu queira voltar com o chat de uma entrega já feita
   para pedir um novo no mesmo estilo ou ajustar depois de aprovar." */
function SecoesDaEntrega({
  trabalho,
  todas,
}: {
  trabalho: Trabalho
  todas: Entrega[]
}) {
  const { t: traduzir } = useIdioma()
  const [msgs, setMsgs] = useState<Array<{ id: number; role: string; conteudo: string }> | null>(null)
  const [msgsErro, setMsgsErro] = useState<string | null>(null)
  const planos = todas.filter(
    (e) =>
      trabalho.conversaId != null &&
      e.conversa_id === trabalho.conversaId &&
      e.job_id !== trabalho.jobId &&
      /plano/i.test(e.nome) &&
      !ehBastidor(e),
  )
  async function carregarMsgs() {
    if (msgs !== null || trabalho.conversaId == null) return
    try {
      const r = await api.get<{ mensagens: Array<{ id: number; role: string; conteudo: string }> }>(
        `/conversas/${trabalho.conversaId}`,
      )
      setMsgs(asList(r, 'mensagens'))
    } catch (e) {
      setMsgsErro(e instanceof ApiError ? e.message : traduzir("Não deu para abrir a conversa", "Could not open the conversation"))
    }
  }
  if (!planos.length && trabalho.conversaId == null) return null
  return (
    <>
      {planos.length > 0 && (
        <details className="entrega-secao">
          <summary>{traduzir("Plano", "Plan")} ({planos.length})</summary>
          {planos.map((p) => (
            <div key={p.id} className="entrega-secao__item">
              <ResultadoEntrega
                entregaId={p.id}
                nome={p.nome}
                mime={p.mime}
                tamanhoBytes={p.tamanho_bytes}
              />
              <span className="texto-suave">{p.nome}</span>
            </div>
          ))}
        </details>
      )}
      {trabalho.conversaId != null && (
        <details
          className="entrega-secao"
          onToggle={(ev) => {
            if ((ev.target as HTMLDetailsElement).open) void carregarMsgs()
          }}
        >
          <summary>{traduzir("Conversa:", "Conversation:")} {trabalho.conversaTitulo || traduzir("a que criou este trabalho", "the one that started this task")}</summary>
          {msgsErro && <p className="texto-suave">{msgsErro}</p>}
          {!msgsErro && msgs === null && <p className="texto-suave">{traduzir("Abrindo…", "Opening…")}</p>}
          {msgs && (
            <div className="entrega-secao__chat">
              {msgs.slice(-12).map((m) => (
                <p
                  key={m.id}
                  className={`entrega-chat__msg entrega-chat__msg--${m.role === 'user' ? 'dono' : 'ia'}`}
                >
                  {m.conteudo.length > 400 ? m.conteudo.slice(0, 400) + '…' : m.conteudo}
                </p>
              ))}
            </div>
          )}
          <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            title={traduzir("Reabre este chat na Mesa — para pedir outro no mesmo estilo ou um ajuste", "Reopen this conversation to request another deliverable in the same style or an adjustment")}
            onClick={() => {
              localStorage.setItem('offiz:abrir-conversa', String(trabalho.conversaId))
              window.location.href = '/app'
            }}
          >
            {traduzir("Continuar nesta conversa →", "Continue this conversation →")}
          </button>
        </details>
      )}
    </>
  )
}

function agruparTrabalhos(entregas: Entrega[], traduzir: Traduzir): Trabalho[] {
  const porJob = new Map<number, Entrega[]>()
  for (const e of entregas) {
    const lista = porJob.get(e.job_id) ?? []
    lista.push(e)
    porJob.set(e.job_id, lista)
  }
  const trabalhos: Trabalho[] = []
  for (const [jobId, lista] of porJob) {
    const bastidores = lista.filter(ehBastidor)
    const finais = lista.filter((e) => !ehBastidor(e)).sort((a, b) => prioridadePrincipal(a) - prioridadePrincipal(b))
    const principal = finais[0] ?? null
    trabalhos.push({
      jobId,
      titulo: lista[0].job_titulo || principal?.nome || traduzir(`Trabalho #${jobId}`, `Task #${jobId}`),
      cliente: lista[0].cliente ?? null,
      clienteId: lista.find((e) => typeof e.cliente_id === 'number')?.cliente_id ?? null,
      criadoEm: lista.map((e) => e.criado_em).sort().slice(-1)[0] ?? lista[0].criado_em,
      principal,
      outros: finais.slice(1),
      bastidores,
      total: lista.length,
      conversaId: lista.find((e) => e.conversa_id)?.conversa_id ?? null,
      conversaTitulo: lista.find((e) => e.conversa_titulo)?.conversa_titulo ?? null,
    })
  }
  // Mais recente primeiro
  return trabalhos.sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1))
}

/** Lê o CONTEÚDO de uma entrega de texto (bastidores) para exibição inline. */
async function lerTextoEntrega(entregaId: number): Promise<string> {
  const res = await respostaAutenticada(`/entregas/${entregaId}/download`)
  return res.text()
}

/** O visor da PEÇA. A entrega principal dos escritórios é um `.html` pronto
 *  (o de conteúdo entrega post.html, "nunca .md") e o app imprimia o
 *  código-fonte dentro de um <pre>: o dono nunca via o que foi feito, só a
 *  marcação. Aqui o conteúdo é renderizado conforme a extensão.
 *
 *  O HTML entra em `srcdoc` com `sandbox=""` — sem scripts, sem formulários,
 *  sem navegação: é peça gerada por IA, então nada de afrouxar isso (um botão
 *  "copiar" dentro do template deixa de funcionar; copiar é do app).
 *
 *  NUNCA abrir a peça numa aba por blob: URL. A URL `blob:` HERDA A ORIGEM do
 *  app — um `<script>` na peça (alucinação ou injeção vinda da pesquisa web)
 *  rodaria em offiz.com.br e leria os tokens do localStorage. `noopener` não
 *  protege disso. Para ver maior, o próprio iframe vai a tela cheia. */
function VisorEntrega({ nome, texto }: { nome: string; texto: string }) {
  const { t: traduzir } = useIdioma()
  const ext = (nome.split('.').pop() || '').toLowerCase()

  if (ext === 'html' || ext === 'htm') {
    function telaCheia(ev: React.MouseEvent<HTMLButtonElement>) {
      const iframe = ev.currentTarget.parentElement?.querySelector('iframe')
      iframe?.requestFullscreen?.()
    }
    return (
      <div className="visor-peca">
        <iframe className="visor-html" title={traduzir(`Prévia de ${nome}`, `Preview of ${nome}`)} sandbox="" referrerPolicy="no-referrer" srcDoc={protegerHtmlPrevia(texto)} />
        {temRecursosExternosHtml(texto) && <p className="texto-suave">{traduzir('Imagens e fontes externas não carregam nesta prévia. O arquivo original continua disponível em Baixar.', 'External images and fonts do not load in this preview. The original file is still available under Download.')}</p>}
        <button type="button" className="botao botao-fantasma botao-pequeno" onClick={telaCheia}>
          <Icone nome="expandir" tamanho={15} /> {traduzir("Ver em tela cheia", "View fullscreen")}
        </button>
      </div>
    )
  }

  if (ext === 'csv') {
    const linhas = texto.trim().split('\n').slice(0, 200).map((l) => l.split(/[,;]/))
    return (
      <div className="visor-tabela">
        <table className="tabela">
          <tbody>
            {linhas.map((celulas, i) => (
              <tr key={i}>
                {celulas.map((c, j) =>
                  i === 0 ? <th key={j}>{c.trim()}</th> : <td key={j}>{c.trim()}</td>,
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (ext === 'md' || ext === 'txt' || ext === '') {
    return <div className="visor-markdown">{renderizarMarkdown(texto)}</div>
  }

  return <pre className="bastidores-texto">{texto}</pre>
}

/** Markdown de leitura (títulos, listas e negrito) — o suficiente para uma
 *  peça em .md não chegar ao dono com `##` e `**` na cara. */
function renderizarMarkdown(texto: string) {
  const negrito = (linha: string, chave: string) =>
    linha.split(/\*\*([^*]+)\*\*/g).map((p, i) =>
      i % 2 === 1 ? <strong key={`${chave}-${i}`}>{p}</strong> : p,
    )
  return texto.split('\n').map((linha, i) => {
    const l = linha.trimEnd()
    if (/^#{3,}\s/.test(l)) return <h4 key={i}>{negrito(l.replace(/^#+\s/, ''), `h${i}`)}</h4>
    if (/^##\s/.test(l)) return <h3 key={i}>{negrito(l.slice(3), `h${i}`)}</h3>
    if (/^#\s/.test(l)) return <h2 key={i}>{negrito(l.slice(2), `h${i}`)}</h2>
    if (/^[-*]\s/.test(l)) return <li key={i}>{negrito(l.slice(2), `li${i}`)}</li>
    if (!l.trim()) return <br key={i} />
    return <p key={i}>{negrito(l, `p${i}`)}</p>
  })
}

/** Bloco expansível que mostra status.md / raciocinio.md de forma legível. */
function Bastidores({ entregas }: { entregas: Entrega[] }) {
  const { t: traduzir } = useIdioma()
  const [textos, setTextos] = useState<Record<number, string>>({})
  const [carregando, setCarregando] = useState(false)

  async function carregarTextos() {
    if (carregando || Object.keys(textos).length > 0) return
    setCarregando(true)
    try {
      const resultado: Record<number, string> = {}
      for (const e of entregas) {
        try {
          resultado[e.id] = await lerTextoEntrega(e.id)
        } catch {
          resultado[e.id] = traduzir("(não foi possível carregar)", "(could not load)")
        }
      }
      setTextos(resultado)
    } finally {
      setCarregando(false)
    }
  }

  if (entregas.length === 0) return null
  return (
    <details className="bastidores" onToggle={(ev) => (ev.target as HTMLDetailsElement).open && carregarTextos()}>
      <summary>
        <Icone nome="conhecimento" tamanho={15} /> {traduzir("Como o escritório chegou nisso (status e raciocínio)", "How the team got here (status and reasoning)")}
      </summary>
      {carregando && <p className="texto-suave">{traduzir("Carregando…", "Loading…")}</p>}
      {entregas.map((e) => (
        <div key={e.id} className="bastidores-doc">
          {/* O rótulo vem do NOME do arquivo (23/08/2026): o como-foi-feito.txt
              é o melhor documento da entrega — "escolhi a ousada porque tem a
              cara do seu perfil" — e aparecia como "Raciocínio (dados e
              decisões)", que soa a relatório técnico e ninguém abria. */}
          <h4>
            {/como[-_ ]?foi[-_ ]?feito/i.test(e.nome)
              ? traduzir("Como eu fiz, em português", "How I made it, in Portuguese")
              : /status/i.test(e.nome)
                ? traduzir("Status do trabalho", "Task status")
                : traduzir("Raciocínio (dados e decisões)", "Reasoning (data and decisions)")}
          </h4>
          {textos[e.id] !== undefined &&
            (/[.](txt|md)$/i.test(e.nome) ? (
              // O texto é markdown de gente — renderizado, não <pre> cru.
              <div className="visor-markdown">{renderizarMarkdown(textos[e.id])}</div>
            ) : (
              <pre className="bastidores-texto">{textos[e.id]}</pre>
            ))}
        </div>
      ))}
    </details>
  )
}

/** Uma ETAPA do trabalho (um arquivo da entrega): leitor inline para os
 *  formatos de texto + decisão individual (✓/✕ com feedback) quando pendente.
 *  O feedback por etapa vira lição com o nome do arquivo no contexto — o
 *  escritório aprende ONDE acertou/errou dentro da tarefa. */
function EtapaLinha({
  entrega,
  badge,
  podeDecidir,
  decidindo,
  aoDecidir,
  aoBaixar,
  aoExcluir,
  excluindo = false,
}: {
  entrega: Entrega
  badge?: string
  podeDecidir: boolean
  decidindo: boolean
  aoDecidir: (
    e: Entrega,
    status: 'aprovada' | 'rejeitada',
    feedback?: string,
    reexecutar?: boolean,
  ) => Promise<void>
  aoBaixar: (e: Entrega) => void
  /** Excluir a entrega (apaga o arquivo). Vale para a decidida E para a
   *  pendente — nesta, com confirmação dizendo que nada será aprendido. */
  aoExcluir?: (e: Entrega) => void
  excluindo?: boolean
}) {
  const { t: traduzir, idioma } = useIdioma()
  const [painel, setPainel] = useState<'ler' | 'aprovar' | 'rejeitar' | null>(null)
  const [texto, setTexto] = useState<string | null>(null)
  const [carregandoTexto, setCarregandoTexto] = useState(false)
  const [feedback, setFeedback] = useState('')
  // Refazer SÓ esta etapa: a IA refaz o arquivo aplicando o feedback,
  // reutilizando os demais docs salvos do trabalho (e websearch se precisar).
  const [refazer, setRefazer] = useState(false)
  // Player de mídia: blob autenticado, revogado quando a linha desmonta.
  const midia = tipoMidiaInline(entrega.nome)
  const [midiaUrl, setMidiaUrl] = useState<string | null>(null)
  const midiaUrlRef = useRef<string | null>(null)
  midiaUrlRef.current = midiaUrl
  useEffect(
    () => () => {
      if (midiaUrlRef.current) URL.revokeObjectURL(midiaUrlRef.current)
    },
    [],
  )

  async function alternarLeitor() {
    if (painel === 'ler') {
      setPainel(null)
      return
    }
    setPainel('ler')
    if (midia) {
      if (midiaUrl === null && !carregandoTexto) {
        setCarregandoTexto(true)
        try {
          setMidiaUrl(await lerBlobEntrega(entrega.id))
        } catch {
          setTexto(traduzir("(não foi possível carregar a mídia — use o Baixar)", "(could not load the media — use Download)"))
        } finally {
          setCarregandoTexto(false)
        }
      }
      return
    }
    if (texto === null && !carregandoTexto) {
      setCarregandoTexto(true)
      try {
        setTexto(await lerTextoEntrega(entrega.id))
      } catch {
        setTexto(traduzir("(não foi possível carregar o conteúdo)", "(could not load the content)"))
      } finally {
        setCarregandoTexto(false)
      }
    }
  }

  function abrirDecisao(modo: 'aprovar' | 'rejeitar') {
    setPainel((atual) => (atual === modo ? null : modo))
    setFeedback('')
    setRefazer(false)
  }

  async function confirmar(status: 'aprovada' | 'rejeitada') {
    await aoDecidir(
      entrega,
      status,
      feedback.trim() || undefined,
      status === 'rejeitada' ? refazer : false,
    )
    setPainel(null)
    setFeedback('')
    setRefazer(false)
  }

  return (
    <li className={`etapa-linha etapa-${entrega.status}`}>
      <div className="etapa-topo">
        <Icone
          className="entrega-icone"
          nome={ehEmail(entrega) ? 'email' : iconeDoArquivo(entrega.nome)}
        />
        <div className="entrega-dados">
          <strong className="entrega-nome">{entrega.nome}</strong>
          <span className="entrega-meta texto-suave">
            {badge ? `${badge} · ` : ''}
            {entrega.tamanho_bytes != null ? formatBytes(entrega.tamanho_bytes, idioma) : /\.docx$/i.test(entrega.nome) ? 'Word' : ''}
            {entrega.status !== 'pendente' && (
              <>
                {' · '}
                <span className={`status-pill entrega-${entrega.status}`}>
                  {statusEntregaLabel(entrega.status, idioma)}
                </span>
              </>
            )}
          </span>
        </div>
        <span className="etapa-acoes">
          {ehTextoLegivel(entrega.nome) && !temResultadoVisivel(entrega.nome, entrega.mime) && (
            <button type="button" className="botao botao-fantasma botao-pequeno" onClick={alternarLeitor} aria-expanded={painel === 'ler'}>
              {painel === 'ler' ? (
                traduzir("fechar", "close")
              ) : midia === 'video' ? (
                <>
                  <Icone nome="play" tamanho={15} /> {traduzir("Assistir", "Watch")}
                </>
              ) : (
                <>
                  <Icone nome="olho" tamanho={15} /> {midia === 'imagem' ? traduzir("Ver", "View") : traduzir("Abrir", "Open")}
                </>
              )}
            </button>
          )}
          <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => aoBaixar(entrega)}>
            <Icone nome="baixar" tamanho={15} /> {/\.docx$/i.test(entrega.nome) ? traduzir('Baixar Word', 'Download Word') : traduzir("Baixar", "Download")}
          </button>
          {aoExcluir && (
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno perigo"
              disabled={excluindo}
              aria-label={traduzir(`Excluir ${entrega.nome}`, `Delete ${entrega.nome}`)}
              title={
                entrega.status === 'pendente'
                  ? traduzir("Excluir sem decidir (apaga o arquivo; nenhuma lição é gravada)", "Delete without a decision (deletes the file; no lesson is saved)")
                  : traduzir("Excluir do histórico (apaga o arquivo)", "Delete from history (deletes the file)")
              }
              onClick={() => aoExcluir(entrega)}
            >
              <Icone nome="lixeira" />
            </button>
          )}
          {podeDecidir && entrega.status === 'pendente' && (
            <>
              <button
                type="button"
                className="botao botao-ok botao-pequeno"
                disabled={decidindo}
                title={traduzir("Aprovar SÓ esta etapa (feedback opcional vira lição)", "Approve only this step (optional feedback becomes a lesson)")}
                onClick={() => abrirDecisao('aprovar')}
              >
                <Icone nome="visto" />
              </button>
              <button
                type="button"
                className="botao botao-perigo botao-pequeno"
                disabled={decidindo}
                title={traduzir("Rejeitar SÓ esta etapa (conte o porquê — vira lição)", "Reject only this step (explain why to save a lesson)")}
                onClick={() => abrirDecisao('rejeitar')}
              >
                <Icone nome="fechar" />
              </button>
            </>
          )}
        </span>
      </div>

      {/* O RESULTADO NA FRENTE (27/08): imagem grande, vídeo com player,
          HTML renderizado — sem clique. O visor atrás do clique fica só
          para os formatos de texto, que são leitura, não resultado. */}
      {temResultadoVisivel(entrega.nome, entrega.mime) && (
        <div className="etapa-visor etapa-visor--aberto">
          <ResultadoEntrega
            entregaId={entrega.id}
            nome={entrega.nome}
            mime={entrega.mime}
            tamanhoBytes={entrega.tamanho_bytes}
          />
        </div>
      )}
      {painel === 'ler' && !temResultadoVisivel(entrega.nome, entrega.mime) && (
        <div className="etapa-visor">
          {carregandoTexto ? (
            <p className="texto-suave">{traduzir("Carregando…", "Loading…")}</p>
          ) : (
            <VisorEntrega nome={entrega.nome} texto={texto ?? ''} />
          )}
        </div>
      )}

      {(painel === 'aprovar' || painel === 'rejeitar') && (
        <div className="entrega-feedback">
          <label className="campo">
            <span>
              {painel === 'aprovar'
                ? traduzir(`O que ficou bom em “${entrega.nome}”? (opcional)`, `What worked well in “${entrega.nome}”? (optional)`)
                : traduzir(`O que precisa mudar em “${entrega.nome}”?`, `What needs to change in “${entrega.nome}”?`)}
            </span>
            <textarea
              rows={2}
              autoFocus
              value={feedback}
              onChange={(ev) => setFeedback(ev.target.value)}
              placeholder={
                painel === 'aprovar'
                  ? traduzir("Ex.: gostei do tom simples e direto — sempre assim…", "E.g. I like the simple, direct tone — keep it this way…")
                  : traduzir("Ex.: ficou genérico demais — quero exemplos do meu produto…", "E.g. this is too generic — I want examples of my product…")
              }
            />
          </label>
          {painel === 'rejeitar' && (
            <label className="check-reexecutar">
              <input
                type="checkbox"
                checked={refazer}
                onChange={(ev) => setRefazer(ev.target.checked)}
              />
              <span>
                {traduzir("Refazer SÓ esta etapa com a correção", "Redo only this step with the correction")}
                <small>
                  {traduzir("a IA refaz este arquivo reutilizando os demais docs salvos do trabalho (e pesquisa na web se precisar)", "AI redoes this file using the other saved documents from the task, with web research if needed")}
                </small>
              </span>
            </label>
          )}
          <div className="entrega-feedback-acoes">
            <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => setPainel(null)}>
              {traduzir("Voltar", "Back")}
            </button>
            <button
              type="button"
              className={`botao botao-pequeno ${painel === 'aprovar' ? 'botao-ok' : 'botao-perigo'}`}
              // Refazer exige a correção descrita — desabilita em vez de
              // fechar o painel com um toast contraditório.
              disabled={decidindo || (painel === 'rejeitar' && refazer && !feedback.trim())}
              title={
                painel === 'rejeitar' && refazer && !feedback.trim()
                  ? traduzir("Descreva a correção para refazer a etapa", "Describe the correction to redo this step")
                  : undefined
              }
              onClick={() => confirmar(painel === 'aprovar' ? 'aprovada' : 'rejeitada')}
            >
              {decidindo
                ? traduzir("Registrando…", "Saving…")
                : painel === 'aprovar'
                  ? traduzir("Aprovar etapa", "Approve step")
                  : refazer
                    ? traduzir("Rejeitar e refazer", "Reject and redo")
                    : traduzir("Rejeitar etapa", "Reject step")}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

type EntregasProps = {
  orgId: number
  slug: string
  aoPedirAjuste?: () => void
  aoVerComoFoiFeita?: (pecaSlug: string, jobId?: number) => void
  aoVerFluxo?: (jobId: number) => void
}

export function EntregasTab(props: EntregasProps) {
  const [searchParams] = useSearchParams()
  return <EntregasConteudo key={JSON.stringify([props.orgId, props.slug, getSessionIdentity(), searchParams.get('conversa')])} {...props} />
}

function EntregasConteudo({
  orgId,
  slug,
  aoPedirAjuste,
  aoVerComoFoiFeita,
  aoVerFluxo,
}: EntregasProps) {
  const { t: traduzir, idioma } = useIdioma()
  const FILTROS_STATUS = filtrosStatus(traduzir)
  const [searchParams, setSearchParams] = useSearchParams()

  /** Vai à Conversa para pedir um ajuste desta entrega — a IA discute e, quando
   *  for produção, sugere iniciar uma NOVA tarefa. Passa o cliente e o nome da
   *  peça por query (o ConversaTab semeia a conversa).
   *
   *  Parte dos params ATUAIS: montar um URLSearchParams do zero derrubava
   *  `org`/`slug` da rota /app e a shell caía no primeiro prédio da lista —
   *  o pedido de ajuste ia parar no escritório errado. */
  function pedirAjuste(t: Trabalho) {
    const p = new URLSearchParams(searchParams)
    p.set('f', 'conversa')
    p.set('conversa', 'nova')
    p.delete('aba')
    p.delete('vista')
    p.delete('area')
    if (p.has('slug')) p.set('slug', slug)
    if (t.clienteId != null) p.set('ajustecli', String(t.clienteId))
    else p.delete('ajustecli')
    p.set('ajustepeca', t.principal?.nome || t.titulo)
    // O TRABALHO, não só o nome da peça: é o que faz a IA já saber o que é a
    // entrega e onde estão os arquivos, em vez de perguntar e pedir upload de
    // novo (o backend injeta pedido original + caminhos no contexto).
    p.set('ajustejob', String(t.jobId))
    setSearchParams(p, { replace: false })
    aoPedirAjuste?.()
  }

  const { sucesso, falha } = useToasts()
  const [entregas, setEntregas] = useState<Entrega[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todas')
  const [clienteFiltro, setClienteFiltro] = useState<string>('')
  const [busca, setBusca] = useState('')
  const [limite, setLimite] = useState(24)
  useEffect(() => setLimite(24), [orgId, slug, busca, filtroStatus, clienteFiltro])
  // Decisão POR ETAPA em voo (id da entrega) + renomear trabalho.
  const [decidindoEtapa, setDecidindoEtapa] = useState<number | null>(null)
  const [renomeando, setRenomeando] = useState<{ jobId: number; valor: string } | null>(null)
  const [salvandoNome, setSalvandoNome] = useState(false)
  const [feedbacks, setFeedbacks] = useState<Record<number, string>>({})
  const [reexecutar, setReexecutar] = useState<Record<number, boolean>>({})
  const [painel, setPainel] = useState<{ jobId: number; modo: ModoPainel } | null>(null)
  const [decidindo, setDecidindo] = useState<number | null>(null)
  // Feedback PÓS-decisão (histórico): melhora as próximas mesmo aprovando.
  const [feedbackPosJob, setFeedbackPosJob] = useState<number | null>(null)
  const [feedbackPosTexto, setFeedbackPosTexto] = useState('')
  const [feedbackPosEnviando, setFeedbackPosEnviando] = useState(false)
  const [apagando, setApagando] = useState(false)
  const apagandoRef = useRef(false)
  const sessaoRef = useRef(getSessionIdentity())
  const vivoRef = useRef(true)
  const leituraRef = useRef<AbortController | null>(null)
  const downloadsRef = useRef(new Map<number, AbortController>())
  const { confirmar: confirmarExclusao, dialogo } = useConfirmacao(`${sessaoRef.current}:${orgId}:${slug}`)
  const telaAtual = useCallback(() => vivoRef.current && getSessionIdentity() === sessaoRef.current, [])
  useEffect(() => {
    vivoRef.current = true
    return () => {
      vivoRef.current = false
      leituraRef.current?.abort()
      downloadsRef.current.forEach(controller => controller.abort())
      downloadsRef.current.clear()
    }
  }, [])

  const carregar = useCallback(async () => {
    if (!telaAtual()) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    const atual = () => telaAtual() && !controller.signal.aborted
    setCarregando(true)
    try {
      const data = await api.get<unknown>(`/predios/${orgId}/${slug}/entregas`, controller.signal)
      if (!atual()) return
      setEntregas(asList<Entrega>(data, 'entregas'))
      setErro(null)
    } catch (e) {
      if (atual()) setErro(e instanceof ApiError ? e.detail : traduzir("Não foi possível carregar as entregas.", "Could not load deliverables."))
    } finally { if (atual()) setCarregando(false) }
  }, [orgId, slug, traduzir, telaAtual])

  useEffect(() => {
    carregar()
    const off = wsClient.on('job_status', (msg) => {
      const st = msg as WsJobStatus
      if (st.org_id === orgId && st.office_slug === slug && st.status === 'done') carregar()
    })
    return () => off()
  }, [carregar, orgId, slug])

  async function enviarFeedbackPos(jobId: number) {
    if (!telaAtual() || feedbackPosEnviando) return
    const texto = feedbackPosTexto.trim()
    if (!texto) return
    setFeedbackPosEnviando(true)
    try {
      const r = await api.post<{ licao?: Record<string, unknown> | null }>(`/jobs/${jobId}/entregas/feedback`, { feedback: texto })
      if (!telaAtual()) return
      const licaoRegistrada = !!r?.licao && typeof r.licao === 'object' && !Array.isArray(r.licao)
      sucesso(licaoRegistrada
        ? traduzir("Feedback guardado para orientar as próximas entregas.", "Feedback saved to guide future deliverables.")
        : traduzir("Feedback registrado.", "Feedback recorded."))
      setFeedbackPosJob(null)
      setFeedbackPosTexto('')
      await carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível registrar o feedback.", "Could not save your feedback."))
    } finally {
      if (telaAtual()) setFeedbackPosEnviando(false)
    }
  }

  async function aprovarTrabalho(t: Trabalho) {
    if (!telaAtual() || decidindo !== null) return
    const idsPendentes = new Set((entregas ?? []).filter(e => e.job_id === t.jobId && e.status === 'pendente' && !e.editorial_peca_id).map(e => e.id))
    setDecidindo(t.jobId)
    try {
      const r = await api.post<{
        aprovadas?: number[]
        conhecimento_aplicado?: { substituicoes?: { antiga: string; nova: string }[] } | null
      }>(`/jobs/${t.jobId}/entregas/aprovar`)
      if (!telaAtual()) return
      const ids = r?.aprovadas
      if (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0 || !idsPendentes.has(id)) || new Set(ids).size !== ids.length) {
        falha(traduzir("A aprovação não foi confirmada. Confira os arquivos atualizados antes de decidir novamente.", "Approval was not confirmed. Check the updated files before making another decision."))
        await carregar()
        return
      }
      setPainel(null)
      // Aprovar continua sendo UM clique (ver o comentário do botão): o aviso
      // vem DEPOIS. Mas trocar uma regra é a única aprovação que APAGA algo do
      // escritório — sair calado seria a pessoa descobrir semanas depois que
      // uma regra dela sumiu.
      const trocadas = r?.conhecimento_aplicado?.substituicoes ?? []
      if (trocadas.length > 0) {
        sucesso(
          trocadas.length === 1
            ? traduzir(`Regra trocada: “${trocadas[0].antiga}” saiu, “${trocadas[0].nova}” entrou no lugar.`, `Rule replaced: “${trocadas[0].antiga}” was replaced with “${trocadas[0].nova}”.`)
            : traduzir(`${trocadas.length} regras suas foram trocadas — veja quais em “O que eu já sei”.`, `${trocadas.length} of your rules were replaced. Review them in “What I know”.`),
        )
      }
      sucesso(traduzir(`${ids.length} arquivo${ids.length > 1 ? 's aprovados' : ' aprovado'} em “${t.titulo}”. As decisões dos demais arquivos foram mantidas.`, `${ids.length} file${ids.length > 1 ? 's' : ''} approved in “${t.titulo}”. Other file decisions were kept.`))
      avisarEntregasMudaram()
      await carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível registrar a aprovação.", "Could not save the approval."))
    } finally {
      if (telaAtual()) setDecidindo(null)
    }
  }

  async function rejeitarTrabalho(t: Trabalho) {
    if (!telaAtual() || decidindo !== null) return
    const feedback = feedbacks[t.jobId]?.trim() || ''
    const querReexecutar = !!reexecutar[t.jobId]
    if (querReexecutar && !feedback) {
      falha(traduzir("Descreva a correção para re-executar a tarefa.", "Describe the correction before running the task again."))
      return
    }
    setDecidindo(t.jobId)
    try {
      const r = await api.post<{ licao_registrada?: boolean }>(`/jobs/${t.jobId}/entregas/rejeitar`, {
        feedback: feedback || undefined,
        reexecutar: querReexecutar,
      })
      if (!telaAtual()) return
      setPainel(null)
      if (querReexecutar) {
        // "Chat AI" é o nome da aba no modo avançado; no modo simples ela se
        // chama "Conversar". Mandar o dono procurar um botão que não existe na
        // tela dele é pior do que não dizer nada — daí o nome neutro.
        sucesso(traduzir("Trabalho rejeitado — nova tarefa criada com a sua correção. Acompanhe na conversa.", "Task rejected. A new task was created with your correction; follow it in the conversation."))
      } else if (feedback) {
        sucesso(r?.licao_registrada === true
          ? traduzir("Trabalho rejeitado — feedback guardado para orientar os próximos trabalhos.", "Task rejected. Your feedback was saved to guide future work.")
          : traduzir("Trabalho rejeitado — feedback registrado.", "Task rejected. Your feedback was recorded."))
      } else {
        sucesso(traduzir(`Trabalho “${t.titulo}” rejeitado.`, `Task “${t.titulo}” rejected.`))
      }
      avisarEntregasMudaram()
      await carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível registrar a rejeição.", "Could not save the rejection."))
    } finally {
      if (telaAtual()) setDecidindo(null)
    }
  }

  async function baixar(entrega: Entrega) {
    if (!telaAtual() || downloadsRef.current.has(entrega.id)) return
    const controller = new AbortController()
    downloadsRef.current.set(entrega.id, controller)
    const vigente = () => telaAtual() && !controller.signal.aborted
      && downloadsRef.current.get(entrega.id) === controller
    try {
      await baixarArquivo(`/entregas/${entrega.id}/download`, entrega.nome, { signal: controller.signal, vigente })
    } catch (e) {
      if (vigente()) falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível baixar o arquivo.", "Could not download the file."))
    } finally {
      if (downloadsRef.current.get(entrega.id) === controller) downloadsRef.current.delete(entrega.id)
    }
  }

  /** Decisão POR ETAPA (um arquivo): o feedback vira lição com o nome do
   *  arquivo no contexto — o conhecimento fica amarrado à etapa certa.
   *  `reexecutar` = refazer SÓ este arquivo (a IA reutiliza os demais docs
   *  salvos do trabalho e pesquisa na web quando precisar). */
  async function decidirEtapa(
    e: Entrega,
    status: 'aprovada' | 'rejeitada',
    feedback?: string,
    reexecutar?: boolean,
  ) {
    if (!telaAtual() || decidindoEtapa !== null) return
    if (reexecutar && !feedback) {
      falha(traduzir("Descreva a correção para refazer a etapa.", "Describe the correction before redoing this step."))
      return
    }
    setDecidindoEtapa(e.id)
    try {
      const corpo: Record<string, unknown> = {}
      if (feedback) corpo.feedback = feedback
      if (status === 'rejeitada' && reexecutar) corpo.reexecutar = true
      const r = await api.post<{ licao_registrada?: boolean }>(
        `/entregas/${e.id}/${status === 'aprovada' ? 'aprovar' : 'rejeitar'}`,
        Object.keys(corpo).length > 0 ? corpo : undefined,
      )
      if (!telaAtual()) return
      if (reexecutar) {
        sucesso(traduzir(`Etapa “${e.nome}” rejeitada — o escritório vai refazer SÓ este arquivo.`, `Step “${e.nome}” rejected. Only this file will be redone.`))
      } else {
        sucesso(
          feedback
            ? r?.licao_registrada === true
              ? traduzir(`Etapa “${e.nome}” ${status === 'aprovada' ? 'aprovada' : 'rejeitada'} — feedback guardado para orientar os próximos trabalhos.`, `Step “${e.nome}” ${status === 'aprovada' ? 'approved' : 'rejected'}. Your feedback was saved to guide future work.`)
              : traduzir(`Etapa “${e.nome}” ${status === 'aprovada' ? 'aprovada' : 'rejeitada'} — feedback registrado.`, `Step “${e.nome}” ${status === 'aprovada' ? 'approved' : 'rejected'}. Your feedback was recorded.`)
            : traduzir(`Etapa “${e.nome}” ${status === 'aprovada' ? 'aprovada' : 'rejeitada'}.`, `Step “${e.nome}” ${status === 'aprovada' ? 'approved' : 'rejected'}.`),
        )
      }
      avisarEntregasMudaram()
      await carregar()
    } catch (err) {
      if (telaAtual()) falha(err instanceof ApiError ? err.detail : traduzir("Não foi possível registrar a decisão.", "Could not save your decision."))
    } finally {
      if (telaAtual()) setDecidindoEtapa(null)
    }
  }

  /** Renomeia o TRABALHO (o nome do grupo de entregas). */
  async function salvarNome() {
    if (!renomeando || !telaAtual() || salvandoNome) return
    const titulo = renomeando.valor.trim()
    if (!titulo) {
      setRenomeando(null)
      return
    }
    setSalvandoNome(true)
    try {
      await api.patch(`/jobs/${renomeando.jobId}/titulo`, { titulo })
      if (!telaAtual()) return
      sucesso(traduzir("Entrega renomeada.", "Deliverable renamed."))
      setRenomeando(null)
      await carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível renomear.", "Could not rename this deliverable."))
    } finally {
      if (telaAtual()) setSalvandoNome(false)
    }
  }

  /** Lápis + input inline do nome do trabalho (pendentes E histórico). */
  function tituloEditavel(jobId: number, titulo: string) {
    if (renomeando?.jobId === jobId) {
      return (
        <span className="trabalho-renomear" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={renomeando.valor}
            onChange={(e) => setRenomeando({ jobId, valor: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') salvarNome()
              if (e.key === 'Escape') setRenomeando(null)
            }}
            aria-label={traduzir("Novo nome da entrega", "New deliverable name")}
            maxLength={120}
          />
          <button type="button" className="botao botao-primario botao-pequeno" disabled={salvandoNome} onClick={salvarNome}>
            {salvandoNome ? '…' : traduzir("Salvar", "Save")}
          </button>
          <button type="button" className="botao-texto" onClick={() => setRenomeando(null)}>
            {traduzir("cancelar", "cancel")}
          </button>
        </span>
      )
    }
    return (
      <>
        <strong>{titulo}</strong>{' '}
        <button
          type="button"
          className="botao-texto trabalho-lapis"
          title={traduzir("Renomear esta entrega", "Rename this deliverable")}
          aria-label={traduzir(`Renomear “${titulo}”`, `Rename “${titulo}”`)}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setRenomeando({ jobId, valor: titulo })
          }}
        >
          <Icone nome="lapis" tamanho={15} />
        </button>
      </>
    )
  }

  async function excluir(entrega: Entrega) {
    if (!telaAtual() || apagandoRef.current) return
    // A pendente sai com intenção explícita: nada de obrigar o operador a
    // "aprovar" um teste que não deu certo só para poder apagá-lo — decisão
    // inventada vira lição no learned.md, e o escritório aprende torto.
    const pendente = entrega.status === 'pendente'
    const pergunta = pendente
      ? traduzir(`Excluir “${entrega.nome}” sem decidir?

O arquivo é apagado do servidor e o escritório NÃO aprende nada com esta entrega.`, `Delete “${entrega.nome}” without a decision?

The file will be deleted from the server and no lesson will be saved from this deliverable.`)
      : traduzir(`Excluir “${entrega.nome}” do histórico? O arquivo também é apagado do servidor.`, `Delete “${entrega.nome}” from history? The file will also be deleted from the server.`)
    if (!await confirmarExclusao({ titulo: traduzir('Excluir entrega', 'Delete deliverable'), mensagem: pergunta, acao: traduzir('Excluir entrega', 'Delete deliverable') }) || !telaAtual() || apagandoRef.current) return
    apagandoRef.current = true
    setApagando(true)
    leituraRef.current?.abort()
    try {
      await api.del(`/entregas/${entrega.id}${pendente ? '?forcar=true' : ''}`)
      if (!telaAtual()) return
      sucesso(traduzir("Entrega excluída.", "Deliverable deleted."))
      await carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível excluir.", "Could not delete this deliverable."))
    } finally { apagandoRef.current = false; if (telaAtual()) setApagando(false) }
  }

  async function limparHistorico() {
    if (!telaAtual() || apagandoRef.current) return
    if (!await confirmarExclusao({ titulo: traduzir('Limpar histórico do escritório', 'Clear workspace history'), mensagem: traduzir("Excluir TODAS as entregas já decididas deste escritório? Os arquivos também são apagados do servidor. As pendentes ficam.", "Delete ALL reviewed deliverables in this workspace? Their files will also be deleted from the server. Pending deliverables will remain."), acao: traduzir('Excluir entregas decididas', 'Delete reviewed deliverables') }) || !telaAtual() || apagandoRef.current) return
    apagandoRef.current = true
    setApagando(true)
    leituraRef.current?.abort()
    try {
      const r = await api.del<{ removidas: number }>(`/predios/${orgId}/${slug}/entregas/decididas`)
      if (!telaAtual()) return
      sucesso(traduzir(`Histórico limpo — ${r.removidas} entrega(s) excluída(s).`, `History cleared — ${r.removidas} deliverable(s) deleted.`))
      await carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível limpar o histórico.", "Could not clear the history."))
    } finally { apagandoRef.current = false; if (telaAtual()) setApagando(false) }
  }

  function alternarPainel(jobId: number, modo: ModoPainel) {
    setPainel((atual) => {
      const mesmo = atual && atual.jobId === jobId && atual.modo === modo
      // Abrir o painel sempre começa com o campo em branco: texto sobrando de
      // uma abertura anterior viraria lição sem ninguém ter escrito de novo.
      if (!mesmo) setFeedbacks((prev) => ({ ...prev, [jobId]: '' }))
      return mesmo ? null : { jobId, modo }
    })
  }

  if (entregas === null && !erro) {
    return (
      <div aria-hidden="true">
        <div className="esqueleto esqueleto-linha" />
        <div className="esqueleto esqueleto-linha" />
        <div className="esqueleto esqueleto-linha" />
      </div>
    )
  }

  // Clientes distintos (para o filtro de controle por cliente)
  const clientes = Array.from(
    new Set((entregas ?? []).map((e) => e.cliente).filter((c): c is string => !!c)),
  ).sort()

  const casaCliente = (e: Entrega) => !e.editorial_peca_id && (!clienteFiltro || e.cliente === clienteFiltro)

  const pendentes = (entregas ?? []).filter((e) => e.status === 'pendente' && casaCliente(e))
  // A busca seleciona trabalhos completos: aprovar o cartão decide todos os
  // arquivos do job, portanto nenhum deles pode ficar oculto pela pesquisa.
  const trabalhos = agruparTrabalhos(pendentes, traduzir).filter(trabalho => pendentes.some(e => e.job_id === trabalho.jobId && correspondeBusca(busca, e.nome, e.job_titulo, e.cliente)))
  // Filtro por DECISÃO: 'pendentes' esconde o histórico; 'aprovadas'/
  // 'rejeitadas' escondem os pendentes e filtram o histórico pelo status.
  const mostrarPendentes = filtroStatus === 'todas' || filtroStatus === 'pendentes'
  const mostrarHistorico = filtroStatus !== 'pendentes'
  const historico = (entregas ?? []).filter(
    (e) =>
      e.status !== 'pendente' &&
      casaCliente(e) &&
      correspondeBusca(busca, e.nome, e.job_titulo, e.cliente) &&
      (filtroStatus === 'todas' || filtroStatus === 'pendentes'
        ? true
        : filtroStatus === 'aprovadas'
          ? e.status === 'aprovada'
          : e.status === 'rejeitada'),
  )

  const trabalhosHistorico = agruparTrabalhos(historico, traduzir)

  return (
    <div className="entregas">
      {dialogo}
      {slug === 'conteudo' && <ConteudoEditorial key={orgId} orgId={orgId} aoMudar={() => void carregar()} />}
      {/* Sem NENHUMA entrega, os filtros são 4 botões filtrando o nada — na
          primeira sessão eles só assustam. Aparecem quando há o que filtrar. */}
      {(entregas ?? []).length > 0 && (
      <div className="entregas-filtros">
        <label className="lista-busca">{traduzir('Buscar outras entregas', 'Search other deliverables')}<input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder={traduzir('Nome do trabalho, arquivo ou cliente', 'Work title, file or client')} /></label>
        <div className="seletor-esforco" role="radiogroup" aria-label={traduzir("Filtrar por decisão", "Filter by decision")}>
          {FILTROS_STATUS.map((f) => (
            <button
              key={f.valor}
              type="button"
              role="radio"
              aria-checked={filtroStatus === f.valor}
              className={filtroStatus === f.valor ? 'esforco-opcao ativa' : 'esforco-opcao'}
              onClick={() => setFiltroStatus(f.valor)}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
        {clientes.length > 0 && (
          <select
            className="entregas-filtro-cliente"
            value={clienteFiltro}
            onChange={(e) => setClienteFiltro(e.target.value)}
            aria-label={traduzir("Filtrar por cliente", "Filter by client")}
          >
            <option value="">{traduzir("Todos os clientes", "All clients")}</option>
            {clientes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>
      )}

      {erro && <p className="alerta alerta-erro" role="alert">{erro}{' '}<button type="button" className="botao-texto" disabled={carregando} onClick={carregar}>{carregando ? traduzir('Carregando…', 'Loading…') : traduzir('Tentar novamente', 'Try again')}</button></p>}

      {entregas !== null && mostrarPendentes && (
      <section>
        <h2 className="secao-titulo">
          {traduzir("Trabalhos aguardando sua aprovação", "Tasks awaiting your approval")}
          {trabalhos.length > 0 && <span className="contador">{trabalhos.length}</span>}
        </h2>
        {trabalhos.length === 0 && (
          <div className="estado-vazio compacto">
            <div className="estado-vazio-arte" aria-hidden="true">
              <Icone nome="entregas" tamanho={44} traco={1.3} />
            </div>
            <p>
              {!clienteFiltro
                ? traduzir("Nada esperando você por aqui. Peça algo na aba Conversar — quando ficar pronto, o trabalho aparece aqui para o seu OK.", "Nothing awaiting you here. Make a request in the conversation; when it is ready, it will appear here for your approval.")
                : traduzir("Nenhum trabalho pendente nesse filtro.", "No pending tasks match this filter.")}
            </p>
          </div>
        )}
        <ul className="lista-entregas">
          {trabalhos.slice(0, limite).map((t) => {
            const aberto = painel?.jobId === t.jobId ? painel.modo : null
            return (
              <li key={t.jobId} className="entrega-card">
                {/* Cabeçalho do trabalho */}
                <div className="trabalho-cabecalho">
                  <div className="trabalho-titulo">
                    {tituloEditavel(t.jobId, t.titulo)}
                    <span className="entrega-meta">
                      {t.cliente && (
                        <span className="status-pill status-queued">
                          <Icone nome="pessoa" tamanho={15} /> {t.cliente}
                        </span>
                      )}
                      <span className="texto-suave"> {tempoRelativo(t.criadoEm, idioma)} · {traduzir(`${t.total} arquivo${t.total > 1 ? 's' : ''}`, `${t.total} file${t.total > 1 ? 's' : ''}`)}</span>
                    </span>
                  </div>
                  <div className="entrega-acoes">
                    {/* Aprovar é o clique MAIS FREQUENTE do produto: ele
                        APROVA, e pronto. Já foi um botão que só abria um campo
                        de elogio e exigia um segundo clique em "Aprovar" — dois
                        cliques e um formulário no meio do gesto mais simples do
                        produto. O elogio não se perdeu: vira "💬 Dar feedback"
                        no histórico (pós-decisão, mesma lição, sem refazer). */}
                    <button
                      type="button"
                      className="botao botao-ok botao-pequeno"
                      disabled={decidindo === t.jobId}
                      onClick={() => aprovarTrabalho(t)}
                    >
                      {decidindo === t.jobId ? (
                        <>
                          {/* O check SE DESENHA enquanto a aprovação viaja —
                              a espera vira gesto (redesign ago/2026). */}
                          <Icone nome="visto" tamanho={15} className="icone-desenha" /> {traduzir("Aprovando…", "Approving…")}
                        </>
                      ) : (
                        <>
                          <Icone nome="visto" tamanho={15} /> {traduzir("Está bom", "Looks good")}
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="botao botao-perigo botao-pequeno"
                      disabled={decidindo === t.jobId}
                      aria-expanded={aberto === 'rejeitar'}
                      onClick={() => alternarPainel(t.jobId, 'rejeitar')}
                    >
                      <Icone nome="fechar" tamanho={15} /> {traduzir("Rejeitar", "Reject")}
                    </button>
                    <button
                      type="button"
                      className="botao botao-fantasma botao-pequeno"
                      title={traduzir("Conversar sobre esta entrega e pedir um ajuste (vira uma nova tarefa)", "Discuss this deliverable and request an adjustment (creates a new task)")}
                      onClick={() => pedirAjuste(t)}
                    >
                      <Icone nome="lapis" tamanho={15} /> {traduzir("Pedir ajuste", "Request adjustment")}
                    </button>
                    {(() => {
                      /* "Como foi feita" para TODO trabalho (15/08/2026): a
                         peça de vídeo abre pelo caminho rico (o documento);
                         qualquer outro abre pelo quadro do diário. Um botão
                         só — o dono não escolhe mecanismo, escolhe entender. */
                      const peca = aoVerComoFoiFeita
                        ? pecaDoTrabalho([
                            ...(t.principal ? [t.principal] : []),
                            ...t.outros,
                            ...t.bastidores,
                          ])
                        : null
                      if (peca) {
                        return (
                          <button
                            type="button"
                            className="botao botao-fantasma botao-pequeno"
                            title={traduzir("Abrir o fluxo desta peça no Estúdio: fontes, prompts e etapas", "Open this deliverable in Studio: sources, prompts and steps")}
                            onClick={() => aoVerComoFoiFeita!(peca, t.jobId)}
                          >
                            <Icone nome="fluxo" tamanho={15} /> {traduzir("Como foi feita", "How it was made")}
                          </button>
                        )
                      }
                      return aoVerFluxo ? (
                        <button
                          type="button"
                          className="botao botao-fantasma botao-pequeno"
                          title={traduzir("Abrir no Estúdio: o que entrou, quem mexeu e o que saiu", "Open in Studio: inputs, contributors and outputs")}
                          onClick={() => aoVerFluxo(t.jobId)}
                        >
                          <Icone nome="fluxo" tamanho={15} /> {traduzir("Como foi feita", "How it was made")}
                        </button>
                      ) : null
                    })()}
                  </div>
                </div>

                {/* As ETAPAS do trabalho: cada arquivo abre inline e recebe
                    decisão/feedback INDIVIDUAL (a lição fica amarrada à etapa).
                    Os ✓/✕ por etapa só existem com MAIS de um arquivo: com um
                    só, eles duplicavam o par grande do cabeçalho e o card de
                    um post simples exibia DOIS jeitos de aprovar — a auditoria
                    contou 13 botões num card de 3 arquivos. Caminho feliz:
                    UM botão verde visível. */}
                <ul className="trabalho-etapas">
                  {[...(t.principal ? [t.principal] : []), ...t.outros].map((e, idx) => (
                    <EtapaLinha
                      key={e.id}
                      entrega={e}
                      badge={idx === 0 && t.total > 1 ? traduzir("principal", "main") : undefined}
                      podeDecidir={t.total > 1}
                      decidindo={decidindoEtapa === e.id}
                      aoDecidir={decidirEtapa}
                      aoBaixar={baixar}
                      aoExcluir={excluir}
                      excluindo={apagando}
                    />
                  ))}
                </ul>

                {/* Bastidores legíveis (status.md / raciocinio.md) */}
                <Bastidores entregas={t.bastidores} />
                <OqueMelhorar key={JSON.stringify([t.jobId, t.conversaId])} orgId={orgId} slug={slug} jobId={t.jobId} conversaId={t.conversaId} aoCriar={carregar} />
                <SecoesDaEntrega trabalho={t} todas={entregas ?? []} />

                {aberto === 'rejeitar' && (
                  <div className="entrega-feedback">
                    <label className="campo">
                      <span>{traduzir("Motivo da rejeição", "Reason for rejection")}</span>
                      <textarea
                        rows={2}
                        autoFocus
                        placeholder={traduzir("Conte o que precisa mudar para orientar os próximos trabalhos…", "Describe what needs to change to guide future work…")}
                        value={feedbacks[t.jobId] ?? ''}
                        onChange={(ev) => setFeedbacks((prev) => ({ ...prev, [t.jobId]: ev.target.value }))}
                      />
                    </label>
                    <label className="check-reexecutar">
                      <input
                        type="checkbox"
                        checked={!!reexecutar[t.jobId]}
                        onChange={(ev) => setReexecutar((prev) => ({ ...prev, [t.jobId]: ev.target.checked }))}
                      />
                      <span>
                        {traduzir("Refazer o trabalho com esta correção", "Redo the task with this correction")}
                        <small>{traduzir("cria uma nova tarefa aplicando o seu retorno", "creates a new task using your feedback")}</small>
                      </span>
                    </label>
                    <div className="entrega-feedback-acoes">
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={() => {
                          setFeedbacks((prev) => ({ ...prev, [t.jobId]: '' }))
                          setPainel(null)
                        }}
                      >
                        {traduzir("Voltar", "Back")}
                      </button>
                      <button
                        type="button"
                        className="botao botao-perigo botao-pequeno"
                        disabled={decidindo === t.jobId}
                        onClick={() => rejeitarTrabalho(t)}
                      >
                        {decidindo === t.jobId
                          ? traduzir("Registrando…", "Saving…")
                          : reexecutar[t.jobId]
                            ? traduzir("Rejeitar e refazer", "Reject and redo")
                            : traduzir("Confirmar rejeição", "Confirm rejection")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
      )}

      {entregas !== null && mostrarHistorico && (
      <section>
        <div className="secao-cabecalho">
          <h2 className="secao-titulo">{traduzir("Histórico", "History")}</h2>
          {historico.length > 0 && (
            <button type="button" className="botao-texto perigo" disabled={apagando} onClick={limparHistorico}>
              <Icone nome="lixeira" tamanho={15} /> {traduzir("Limpar histórico", "Clear history")}
            </button>
          )}
        </div>
        {historico.length === 0 && (
          <p className="texto-suave">
            {filtroStatus === 'todas' && !clienteFiltro ? traduzir("Nenhuma entrega decidida ainda.", "No reviewed deliverables yet.") : traduzir("Nenhuma entrega decidida nesse filtro.", "No reviewed deliverables match this filter.")}
          </p>
        )}
        {/* Agrupado por TRABALHO (como as pendentes): os 3 outputs de uma
            tarefa aparecem num bloco só, recolhido — não em 3 linhas soltas. */}
        {historico.length > 0 && (
          <div className="hist-trabalhos">
            {trabalhosHistorico.slice(0, limite).map((t) => {
              const arquivos = [
                ...(t.principal ? [t.principal] : []),
                ...t.outros,
                ...t.bastidores,
              ]
              const decididaEm =
                arquivos.map((e) => e.decidido_em).filter(Boolean).sort().slice(-1)[0] ?? null
              const rejeitadas = arquivos.filter((e) => e.status === 'rejeitada').length
              const feedback = arquivos.map((e) => e.feedback).find(Boolean) || null
              return (
                <details key={t.jobId} className="canon-secao">
                  <summary>
                    <span className="canon-secao-titulo">
                      {t.cliente ? `${t.cliente} — ` : ''}
                      {tituloEditavel(t.jobId, t.titulo)}
                    </span>{' '}
                    <span
                      className={`status-pill entrega-${rejeitadas > 0 ? 'rejeitada' : 'aprovada'}`}
                    >
                      {rejeitadas === 0
                        ? traduzir("Aprovada", "Approved")
                        : rejeitadas === arquivos.length
                          ? traduzir("Rejeitada", "Rejected")
                          : traduzir(`${rejeitadas} rejeitada(s)`, `${rejeitadas} rejected`)}
                    </span>{' '}
                    <span className="texto-suave">
                      · {traduzir(`${arquivos.length} arquivo${arquivos.length === 1 ? '' : 's'}`, `${arquivos.length} file${arquivos.length === 1 ? '' : 's'}`)}
                      {decididaEm ? ` · ${formatDataHora(decididaEm, idioma)}` : ''}
                    </span>
                  </summary>
                  {/* As etapas decididas: o mesmo leitor inline das pendentes
                      (abrir cada etapa) — sem botões de decisão. */}
                  <ul className="trabalho-etapas">
                    {arquivos.map((e) => (
                      <EtapaLinha
                        key={e.id}
                        entrega={e}
                        badge={ehBastidor(e) ? traduzir("bastidores", "process notes") : undefined}
                        podeDecidir={false}
                        decidindo={false}
                        aoDecidir={decidirEtapa}
                        aoBaixar={baixar}
                        aoExcluir={excluir}
                        excluindo={apagando}
                      />
                    ))}
                  </ul>
                  <OqueMelhorar key={JSON.stringify([t.jobId, t.conversaId])} orgId={orgId} slug={slug} jobId={t.jobId} conversaId={t.conversaId} aoCriar={carregar} />
                <SecoesDaEntrega trabalho={t} todas={entregas ?? []} />
                  {feedback && (
                    <p className="texto-suave celula-feedback" style={{ margin: '0.4rem 0 0' }}>
                      Feedback: {feedback}
                    </p>
                  )}
                  {/* Feedback PÓS-decisão: melhora as próximas mesmo aprovando
                      (vira lição no Conhecimento, sem reexecutar nada). */}
                  {feedbackPosJob === t.jobId ? (
                    <div className="canon-rodape" style={{ alignItems: 'stretch', flexDirection: 'column', gap: '0.5rem' }}>
                      <textarea
                        className="canon-textarea"
                        rows={3}
                        value={feedbackPosTexto}
                        onChange={(e) => setFeedbackPosTexto(e.target.value)}
                        placeholder={traduzir("O que pode melhorar nas próximas? Ex.: nos Próximos Passos, use frases inteiras sem quebrar o texto…", "What could improve next time? E.g. use full sentences in Next Steps without breaking the text…")}
                      />
                      <span style={{ display: 'inline-flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                        <button type="button" className="botao-texto" onClick={() => setFeedbackPosJob(null)}>
                          {traduzir("cancelar", "cancel")}
                        </button>
                        <button
                          type="button"
                          className="botao botao-primario botao-pequeno"
                          disabled={!feedbackPosTexto.trim() || feedbackPosEnviando}
                          onClick={() => enviarFeedbackPos(t.jobId)}
                        >
                          {feedbackPosEnviando ? traduzir("Enviando…", "Sending…") : traduzir("Registrar feedback", "Save feedback")}
                        </button>
                      </span>
                    </div>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: '0.8rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="botao-texto"
                        onClick={() => {
                          setFeedbackPosJob(t.jobId)
                          setFeedbackPosTexto('')
                        }}
                      >
                        <Icone nome="conversa" tamanho={15} /> {traduzir("Dar feedback para orientar os próximos trabalhos", "Give feedback to guide future work")}
                      </button>
                      <button
                        type="button"
                        className="botao-texto"
                        title={traduzir("Conversar sobre esta entrega e pedir um ajuste (vira uma nova tarefa)", "Discuss this deliverable and request an adjustment (creates a new task)")}
                        onClick={() => pedirAjuste(t)}
                      >
                        <Icone nome="lapis" tamanho={15} /> {traduzir("Pedir ajuste", "Request adjustment")}
                      </button>
                    </span>
                  )}
                </details>
              )
            })}
          </div>
        )}
      </section>
      )}
      {((mostrarPendentes && trabalhos.length > limite) || (mostrarHistorico && trabalhosHistorico.length > limite)) && <button type="button" className="botao botao-fantasma" onClick={() => setLimite(n => n + 24)}>{traduzir('Mostrar mais entregas', 'Show more deliverables')}</button>}
    </div>
  )
}
