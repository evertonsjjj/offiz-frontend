/* ------------------------------------------------------------------ */
/* Visão geral — o dashboard do escritório (a aba inicial).             */
/*                                                                     */
/* O cockpit que existia na shell clássica, reencarnado na shell única  */
/* com cara de painel: números do mês, a última execução, a atividade   */
/* dos últimos 14 dias e as entregas recentes. Mesmos endpoints do      */
/* cockpit antigo (/stats, /jobs, /entregas, /clientes) — nada novo no  */
/* backend. A preparação só abre quando o servidor confirma uma        */
/* pendência; perfil do prédio também vale para o andar.                */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from 'react'

import { api, asList, getSessionIdentity } from '../../lib/api'
import { wsClient } from '../../lib/ws'
import { Icone } from '../Icone'
import { statusJobLabel, tipoEntregaLabel, TIPO_ENTREGA_ICONE, tempoRelativo, toDate } from '../../lib/format'
import { useIdioma, type Idioma, type Traduzir } from '../../lib/i18n'
import type { Entrega, Job, OfficeInfo, WsJobStatus } from '../../lib/types'
import { SetupSabatina } from './SetupSabatina'
import type { PreparacaoDaArea } from '../../lib/perfilSabatina'

interface ClienteMini {
  id: number
  nome: string
  status: 'ativo' | 'standby'
}

/** Contadores (GET /predios/{org}/{slug}/stats) — contagem SQL de verdade. */
interface PredioStats {
  tarefas_mes: number
  concluidas_mes: number
  /** O ID do job em execução, ou `false` se o prédio está livre — NÃO é uma
   *  contagem. Para "quantas rodando", use `jobs_em_andamento`. */
  rodando: number | false
  entregas_pendentes: number
  /** Quantos jobs em `running` neste prédio (contagem SQL agrupada). */
  jobs_em_andamento?: number
  /** Quantos jobs em `queued` neste prédio. */
  jobs_na_fila?: number
}

function mesmoMes(iso: string | null | undefined, agora: Date): boolean {
  const d = toDate(iso)
  if (!d) return false
  return d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth()
}

const DIAS_ATIVIDADE = 14

/** Um dia da faixa de atividade: contagens por desfecho. */
type DiaAtividade = {
  rotulo: string // dd/mm
  concluidas: number
  comErro: number
  ativas: number
  canceladas: number
  total: number
}

/** Bucketiza os jobs por dia local, do mais antigo (esq.) ao hoje (dir.).
 *  A lista vem com teto de 100 — em mês pesado a faixa SUBCONTA os dias
 *  mais antigos; os números dos cards não, porque vêm do /stats (SQL). */
function atividadePorDia(jobs: Job[], idioma: Idioma): DiaAtividade[] {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const dias: DiaAtividade[] = []
  const indicePorChave = new Map<string, number>()
  for (let i = DIAS_ATIVIDADE - 1; i >= 0; i--) {
    const d = new Date(hoje)
    d.setDate(hoje.getDate() - i)
    const chave = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    indicePorChave.set(chave, dias.length)
    dias.push({
      rotulo: d.toLocaleDateString(idioma, { day: '2-digit', month: '2-digit' }),
      concluidas: 0,
      comErro: 0,
      ativas: 0,
      canceladas: 0,
      total: 0,
    })
  }
  for (const j of jobs) {
    const d = toDate(j.criado_em)
    if (!d) continue
    const idx = indicePorChave.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
    if (idx === undefined) continue
    const dia = dias[idx]
    if (j.status === 'done') dia.concluidas += 1
    else if (j.status === 'failed') dia.comErro += 1
    else if (j.status === 'cancelled') dia.canceladas += 1
    else dia.ativas += 1
    dia.total += 1
  }
  return dias
}

function tituloDia(d: DiaAtividade, traduzir: Traduzir): string {
  if (d.total === 0) return traduzir(`${d.rotulo} — sem tarefas`, `${d.rotulo} — no tasks`)
  const partes = [
    d.concluidas > 0 ? traduzir(`${d.concluidas} concluída${d.concluidas === 1 ? '' : 's'}`, `${d.concluidas} completed`) : '',
    d.comErro > 0 ? traduzir(`${d.comErro} com erro`, `${d.comErro} failed`) : '',
    d.ativas > 0 ? traduzir(`${d.ativas} em andamento`, `${d.ativas} in progress`) : '',
    d.canceladas > 0 ? traduzir(`${d.canceladas} cancelada${d.canceladas === 1 ? '' : 's'}`, `${d.canceladas} cancelled`) : '',
  ].filter(Boolean)
  return traduzir(`${d.rotulo} — ${d.total} tarefa${d.total === 1 ? '' : 's'} (${partes.join(', ')})`, `${d.rotulo} — ${d.total} task${d.total === 1 ? '' : 's'} (${partes.join(', ')})`)
}

/** GET /predios/{org}/{slug}/metricas/loop — a saúde do loop de aprovação. */
interface MetricasLoop {
  trabalhos: {
    total: number
    aprovados_de_primeira: number
    com_rejeicao: number
    pendentes: number
    com_devolutiva: number
    rodadas_extras: number
  }
  taxa_aprovacao_primeira: number | null
  por_tipo: Array<{ tipo: string; aprovadas: number; rejeitadas: number; taxa: number | null }>
  tempo_mediano_ate_decisao_s: number | null
  criterios_reprovados: number
}

const PILL_ENTREGA = (traduzir: Traduzir): Record<string, { classe: string; rotulo: string }> => ({
  pendente: { classe: 'entrega-pendente', rotulo: traduzir('aguardando você', 'awaiting your approval') },
  aprovada: { classe: 'status-done', rotulo: traduzir('aprovada', 'approved') },
  rejeitada: { classe: 'entrega-rejeitada', rotulo: traduzir('ajuste pedido', 'adjustment requested') },
})

const PILL_JOB: Record<string, string> = {
  queued: 'status-queued',
  running: 'status-running',
  done: 'status-done',
  failed: 'status-failed',
  cancelled: 'status-cancelled',
}

/** O número do card SOBE de 0 ao valor na primeira carga (600ms, ease-out) e
 *  depois acompanha o valor direto — o refresh de 15s não re-anima. Com
 *  movimento reduzido o número aparece pronto. */
function ContadorAnimado({ valor }: { valor: number | null }) {
  const [mostrado, setMostrado] = useState<number | null>(null)
  const animou = useRef(false)
  useEffect(() => {
    if (valor === null) return
    const semMovimento =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (animou.current || semMovimento) {
      animou.current = true
      setMostrado(valor)
      return
    }
    animou.current = true
    const t0 = performance.now()
    let raf = 0
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / 600)
      const suave = 1 - Math.pow(1 - p, 3)
      setMostrado(Math.round(valor * suave))
      if (p < 1) raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [valor])
  return <>{valor === null ? '…' : (mostrado ?? 0)}</>
}

type DashboardProps = {
  orgId: number
  slug: string
  office: OfficeInfo
  meuPapel?: string
  /** Troca de aba na shell (ids da ShellSimples). */
  aoNavegar: (aba: string) => void
  aoContinuarPerfil?: (dados: PreparacaoDaArea) => void
}

export function DashboardTab(props: DashboardProps) {
  return <DashboardConteudo key={`${getSessionIdentity()}:${props.orgId}:${props.slug}:${props.meuPapel ?? ''}`} {...props} />
}

function DashboardConteudo({ orgId, slug, office, meuPapel, aoNavegar, aoContinuarPerfil }: DashboardProps) {
  const { t: traduzir, idioma } = useIdioma()
  const [stats, setStats] = useState<PredioStats | null>(null)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [entregas, setEntregas] = useState<Entrega[] | null>(null)
  const [clientes, setClientes] = useState<ClienteMini[] | null>(null)
  /** Saúde do loop: taxa de aprovação de primeira + retrabalho (12/08/2026). */
  const [loop, setLoop] = useState<MetricasLoop | null>(null)
  const usaClientes = !!office.usa_clientes
  const operador = meuPapel === 'owner' || meuPapel === 'admin'
  const [falhas, setFalhas] = useState({ stats: false, jobs: false, entregas: false, clientes: false })
  const [carregandoPainel, setCarregandoPainel] = useState(false)
  const montadoRef = useRef(true)
  const contaRef = useRef(getSessionIdentity())
  const painelRef = useRef<AbortController | null>(null)
  const setupRef = useRef<AbortController | null>(null)
  const telaAtual = useCallback(() => montadoRef.current && getSessionIdentity() === contaRef.current, [])

  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
      painelRef.current?.abort()
      setupRef.current?.abort()
    }
  }, [])

  // ── Sinais de setup (só operador: é ele quem pode escrever o Cânon) ──
  // null = ainda não sei (carregando ou falha de rede) → NÃO mostra o setup;
  // numa falha, abrir a sabatina em cima de um escritório já configurado
  // leria como "o sistema esqueceu a minha empresa".
  const [canon, setCanon] = useState<string | null>(null)
  const [semMateriais, setSemMateriais] = useState<boolean | null>(null)
  const [sabatinaPendente, setSabatinaPendente] = useState<boolean | null>(null)
  const [perfilEstado, setPerfilEstado] = useState<'inicial' | 'em_andamento' | 'contextualizado' | null>(null)
  const [setupOculto, setSetupOculto] = useState(false)
  // A sabatina acabou de concluir NESTA sessão: o refetch derruba o bloco de
  // setup na hora, e sem este flag a despedida sumia antes de ser lida.
  const [setupConcluido, setSetupConcluido] = useState(false)
  const [entrevistaEmAndamento, setEntrevistaEmAndamento] = useState(false)

  const carregarSetup = useCallback(async () => {
    if (!operador || !telaAtual()) return
    setupRef.current?.abort()
    const controller = new AbortController()
    setupRef.current = controller
    const [perfil, arquivos, partida] = await Promise.allSettled([
      api.get<{ conteudo: string }>(`/predios/${orgId}/${slug}/conhecimento/canon`, controller.signal),
      api.get<{ entrada?: unknown[]; exemplos?: unknown[]; produto?: unknown[] }>(`/predios/${orgId}/${slug}/arquivos`, controller.signal),
      api.get<{ sabatina_pendente?: boolean; perfil_estado?: string | null }>(`/predios/${orgId}/${slug}/partida`, controller.signal),
    ])
    if (!telaAtual() || controller.signal.aborted) return
    setSabatinaPendente(partida.status === 'fulfilled' && typeof partida.value?.sabatina_pendente === 'boolean'
      ? partida.value.sabatina_pendente : null)
    const estado = partida.status === 'fulfilled' ? partida.value?.perfil_estado : null
    setPerfilEstado(estado === 'inicial' || estado === 'em_andamento' || estado === 'contextualizado' ? estado : null)
    if (perfil.status === 'fulfilled') setCanon(perfil.value?.conteudo ?? '')
    if (arquivos.status === 'fulfilled') {
      const a = arquivos.value
      setSemMateriais((a?.entrada?.length ?? 0) === 0 && (a?.exemplos?.length ?? 0) === 0 && (a?.produto?.length ?? 0) === 0)
    }
  }, [orgId, slug, operador, telaAtual])

  const carregar = useCallback(async () => {
    if (!telaAtual()) return
    painelRef.current?.abort()
    const controller = new AbortController()
    painelRef.current = controller
    setCarregandoPainel(true)
    // Métricas são opcionais: uma consulta lenta não segura as entregas.
    void api.get<MetricasLoop>(`/predios/${orgId}/${slug}/metricas/loop`, controller.signal)
      .then(data => { if (telaAtual() && !controller.signal.aborted) setLoop(data) })
      .catch(() => { /* sem métrica não é erro do painel */ })
    const [contadores, tarefas, pecas, pessoas] = await Promise.allSettled([
      api.get<PredioStats>(`/predios/${orgId}/${slug}/stats`, controller.signal),
      api.get<unknown>(`/predios/${orgId}/${slug}/jobs?per_page=100`, controller.signal),
      api.get<unknown>(`/predios/${orgId}/${slug}/entregas`, controller.signal),
      usaClientes ? api.get<unknown>(`/predios/${orgId}/${slug}/clientes`, controller.signal) : Promise.resolve(null),
    ])
    if (!telaAtual() || controller.signal.aborted) return
    // Falha de consulta não confirma uma lista vazia. Mantém o último dado
    // recebido e informa que ele ainda não pôde ser atualizado.
    if (contadores.status === 'fulfilled') setStats(contadores.value)
    if (tarefas.status === 'fulfilled') setJobs(asList<Job>(tarefas.value, 'jobs'))
    if (pecas.status === 'fulfilled') setEntregas(asList<Entrega>(pecas.value, 'entregas'))
    if (usaClientes && pessoas.status === 'fulfilled') setClientes(asList<ClienteMini>(pessoas.value, 'clientes'))
    setFalhas({ stats: contadores.status === 'rejected', jobs: tarefas.status === 'rejected', entregas: pecas.status === 'rejected', clientes: usaClientes && pessoas.status === 'rejected' })
    setCarregandoPainel(false)
  }, [orgId, slug, usaClientes, telaAtual])

  // Carga inicial + rede de segurança (15s), como no cockpit clássico.
  useEffect(() => {
    carregar()
    carregarSetup()
    const t = window.setInterval(() => {
      if (!document.hidden) carregar()
    }, 15000)
    return () => clearInterval(t)
  }, [carregar, carregarSetup])

  useEffect(() => {
    const off = wsClient.on('job_status', (msg) => {
      const st = msg as WsJobStatus
      if (st.org_id !== orgId || st.office_slug !== slug) return
      carregar()
    })
    const aoMudarEntregas = () => carregar()
    window.addEventListener('offiz:entregas-mudou', aoMudarEntregas)
    return () => {
      off()
      window.removeEventListener('offiz:entregas-mudou', aoMudarEntregas)
    }
  }, [orgId, slug, carregar])

  // ── Números (fonte primária /stats; fallback: subcontagem local) ──
  const agora = new Date()
  const tarefasMesLocal = (jobs ?? []).filter((j) => mesmoMes(j.criado_em, agora))
  const tarefasMes = stats ? stats.tarefas_mes : jobs === null ? null : tarefasMesLocal.length
  const concluidasMes = stats
    ? stats.concluidas_mes
    : jobs === null
      ? null
      : tarefasMesLocal.filter((j) => j.status === 'done').length
  const pendentes = stats
    ? stats.entregas_pendentes
    : entregas === null
      ? null
      : (entregas ?? []).filter((e) => e.status === 'pendente').length
  const ativos = (clientes ?? []).filter((c) => c.status === 'ativo')

  const ordenados = [...(jobs ?? [])].sort((a, b) => {
    const ta = toDate(a.criado_em)?.getTime() ?? 0
    const tb = toDate(b.criado_em)?.getTime() ?? 0
    return tb - ta
  })
  const ultimo = ordenados[0] ?? null
  const rodando = ordenados.find((j) => j.status === 'running') ?? null

  // ── A manchete do dia (redesign ago/2026): a serifa diz o que importa AGORA
  // — o mesmo dado dos cards, dito em uma frase. Enquanto nada carregou, nada
  // de manchete: uma frase errada no topo pesa mais que um card com "…".
  /* `stats.rodando` é o ID DO JOB em execução (ou false — o backend documenta
     assim em predios.py: "id do job em execução (ou false — livre)"), NÃO uma
     contagem. Lido como número, a manchete anunciava "209 tarefas rodando
     agora" com UMA tarefa rodando — o id vazando como quantidade na primeira
     tela do escritório. A contagem de verdade é `jobs_em_andamento`. */
  const rodandoAgora =
    stats?.jobs_em_andamento != null
      ? stats.jobs_em_andamento
      : stats
        ? (stats.rodando ? 1 : 0)
        : rodando
          ? 1
          : 0
  const manchete = (() => {
    // `||`, não `&&`: a manchete AFIRMA — então só aparece quando as DUAS
    // fontes chegaram. Com /stats falho e /entregas ainda no ar, o `&&`
    // imprimia "Tudo em dia" com pendências reais em trânsito.
    if (pendentes === null || jobs === null) return null
    const partes: string[] = []
    if ((pendentes ?? 0) > 0)
      partes.push(
        pendentes === 1 ? traduzir('1 entrega esperando o seu OK', '1 deliverable awaiting your approval') : traduzir(`${pendentes} entregas esperando o seu OK`, `${pendentes} deliverables awaiting your approval`),
      )
    if (rodandoAgora > 0)
      partes.push(
        rodandoAgora === 1 ? traduzir('1 tarefa rodando agora', '1 task running now') : traduzir(`${rodandoAgora} tarefas rodando agora`, `${rodandoAgora} tasks running now`),
      )
    if (partes.length === 0) {
      // A lista de tarefas tem teto de 100: sem contadores confirmados,
      // zero nas listas não prova que o escritório inteiro está livre.
      if (stats === null && falhas.stats) return null
      return traduzir('Tudo em dia — nada esperando você.', 'All up to date — nothing waiting for you.')
    }
    return `${partes.join(' · ')}.`
  })()
  const dataLonga = agora.toLocaleDateString(idioma, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const dias = atividadePorDia(jobs ?? [], idioma)
  const maiorDia = Math.max(1, ...dias.map((d) => d.total))
  const totalFaixa = dias.reduce((soma, d) => soma + d.total, 0)
  const legenda = [
    { chave: 'concluidas' as const, rotulo: traduzir('concluídas', 'completed'), classe: 'dash-seg-ok' },
    { chave: 'comErro' as const, rotulo: traduzir('com erro', 'failed'), classe: 'dash-seg-erro' },
    { chave: 'ativas' as const, rotulo: traduzir('em andamento', 'in progress'), classe: 'dash-seg-ativa' },
    { chave: 'canceladas' as const, rotulo: traduzir('canceladas', 'cancelled'), classe: 'dash-seg-cancelada' },
  ].filter((l) => dias.some((d) => d[l.chave] > 0))

  const entregasRecentes = [...(entregas ?? [])]
    // manifesto/raciocínio/laudo (tipo 'interno') é trabalho, não peça — no
    // dashboard eles roubavam as 6 vagas das entregas de verdade.
    .filter((e) => e.tipo !== 'interno')
    .sort((a, b) => {
      const ta = toDate(a.criado_em)?.getTime() ?? 0
      const tb = toDate(b.criado_em)?.getTime() ?? 0
      return tb - ta
    })
    .slice(0, 6)

  // Só uma pendência confirmada pelo servidor pode abrir a preparação.
  // Ele considera prédio e andar; leitura desconhecida não impõe entrevista.
  const setupPendente =
    operador && sabatinaPendente === true && perfilEstado === 'inicial' && semMateriais === true && canon !== null
  const perfilParcial = operador && sabatinaPendente === true && perfilEstado === 'em_andamento' && canon !== null

  /* A SABATINA TOMA A TELA (15/08/2026).
   *
   * Ela era o primeiro filho de `.dash`, então no primeiro dia o dono lia a
   * entrevista empilhada sobre quatro blocos que só sabiam dizer zero:
   * "Tarefas no mês 0", "Aguardando você 0", "Nenhuma tarefa nos últimos 14
   * dias", "Nenhuma entrega ainda". O momento mais importante do produto
   * dividia a tela com quatro provas de que ele ainda não fez nada.
   *
   * Enquanto o escritório não conhece a empresa não há número que valha a pena
   * mostrar — então o painel inteiro espera. "Deixar para depois" continua
   * existindo (agora no rodapé da própria sabatina) e devolve o dashboard. */
  /* `setupConcluido` MANTÉM a sabatina na tela depois de gravar: o refetch
   * derruba `setupPendente` no mesmo instante, e sem este segundo tempo a
   * despedida sumiria antes de ser lida — era o motivo de este flag existir
   * desde a primeira versão. Quem fecha a tela agora é o dono, no botão. */
  if ((setupPendente || setupConcluido || entrevistaEmAndamento) && !setupOculto) {
    return (
      <div className="dash dash-so-setup">
        <SetupSabatina
          key={`${orgId}:${slug}`}
          orgId={orgId}
          slug={slug}
          canonAtual={canon ?? ''}
          aoIniciar={() => setEntrevistaEmAndamento(true)}
          aoConcluir={() => {
            setSetupConcluido(true)
            carregarSetup()
            carregar()
          }}
          aoFechar={() => setSetupOculto(true)}
          // Atualiza o acervo sem desmontar uma entrevista já em andamento.
          // Enviar só documentos continua permitindo começar pelo pedido.
          aoMaterialNovo={carregarSetup}
          aoConversar={dados => {
            if (!telaAtual()) return
            if (dados?.textos.length && aoContinuarPerfil) aoContinuarPerfil({ ...dados, orgId, slug, sessao: contaRef.current })
            else aoNavegar('conversa')
          }}
        />
        {!setupConcluido && (
          <button
            type="button"
            className="botao-texto dash-setup-depois"
            onClick={() => setSetupOculto(true)}
          >
            {traduzir('deixar para depois e ver o painel', 'leave for later and view the dashboard')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="dash">
      {Object.values(falhas).some(Boolean) && (
        <div className="alerta alerta-erro" role="alert">
          <p>{traduzir('Não foi possível atualizar todo o painel.', 'Could not update the whole dashboard.')}</p>
          {(stats !== null || jobs !== null || entregas !== null || clientes !== null) && (
            <p>{traduzir('As informações que não atualizaram continuam como na última consulta confirmada.', 'Information that could not be updated remains as it was in the last confirmed check.')}</p>
          )}
          <button type="button" className="botao botao-fantasma botao-pequeno" disabled={carregandoPainel} onClick={() => void carregar()}>
            {traduzir(carregandoPainel ? 'Consultando…' : 'Tentar novamente', carregandoPainel ? 'Checking…' : 'Try again')}
          </button>
        </div>
      )}
      {(setupPendente && setupOculto || perfilParcial) && (
        <button type="button" className="dash-setup-reabrir" onClick={() => { setSetupOculto(false); setEntrevistaEmAndamento(true) }}>
          <Icone nome="setup" tamanho={15} /> {traduzir('Completar meu perfil', 'Complete my profile')}
        </button>
      )}

      {/* ── A manchete do dia ── */}
      {manchete && (
        <header className="dash-manchete">
          <h2>{manchete}</h2>
          <p className="texto-suave">{dataLonga} {traduzir('· o dia do seu escritório', '· your office today')}</p>
        </header>
      )}
      {/* A faixa verde de "prontinho" que ficava aqui saiu em 15/08/2026: a
          despedida agora é dita na própria sabatina, numa tela que espera o
          dono clicar. Dizer a mesma coisa duas vezes fazia a segunda soar
          como aviso de sistema — e ela ainda carregava emoji, que a UI
          aposentou em 14/08. */}

      {/* ── Última execução (o "Latest Run") ── */}
      {ultimo && (
        <section className="dash-ultima" aria-label={traduzir('Última execução', 'Latest run')}>
          <span className={`status-pill ${PILL_JOB[ultimo.status] ?? 'status-queued'}`}>
            {statusJobLabel(ultimo.status, idioma)}
          </span>
          <span className="dash-ultima-titulo" title={ultimo.titulo || traduzir(`Tarefa #${ultimo.id}`, `Task #${ultimo.id}`)}>
            {ultimo.titulo || traduzir(`Tarefa #${ultimo.id}`, `Task #${ultimo.id}`)}
          </span>
          <span className="dash-ultima-quando texto-suave">{tempoRelativo(ultimo.criado_em, idioma)}</span>
        </section>
      )}

      {/* ── Os números do mês ── */}
      <div className="dash-cards">
        <div className="dash-card">
          <span className="dash-card-rotulo">{traduzir('Tarefas no mês', 'Tasks this month')}</span>
          <strong className="dash-card-numero">
            <ContadorAnimado valor={tarefasMes} />
          </strong>
          <span className="dash-card-sub texto-suave">
            {concluidasMes === null
              ? ''
              : traduzir(`${concluidasMes} concluída${concluidasMes === 1 ? '' : 's'}`, `${concluidasMes} completed`)}
          </span>
        </div>

        <button
          type="button"
          className={`dash-card dash-card-botao${(pendentes ?? 0) > 0 ? ' dash-destaque' : ''}`}
          onClick={() => aoNavegar('entregas')}
          title={traduzir('Abrir entregas', 'Open deliverables')}
        >
          <span className="dash-card-rotulo">{traduzir('Aguardando você', 'Waiting for you')}</span>
          <strong className="dash-card-numero">
            <ContadorAnimado valor={pendentes} />
          </strong>
          <span className="dash-card-sub texto-suave">
            {pendentes === 1 ? traduzir('trabalho para aprovar', 'task to approve') : traduzir('trabalhos para aprovar', 'tasks to approve')}
          </span>
        </button>

        {usaClientes && (
          <button
            type="button"
            className="dash-card dash-card-botao"
            onClick={() => aoNavegar('clientes')}
            title={traduzir('Abrir clientes', 'Open clients')}
          >
            <span className="dash-card-rotulo">{traduzir('Clientes', 'Clients')}</span>
            <strong className="dash-card-numero">
              <ContadorAnimado valor={clientes === null ? null : ativos.length} />
            </strong>
            <span className="dash-card-sub texto-suave">
              {clientes === null ? '' : clientes.length - ativos.length > 0
                ? traduzir(`${(clientes ?? []).length - ativos.length} em standby`, `${(clientes ?? []).length - ativos.length} on standby`)
                : traduzir('todos ativos', 'all active')}
            </span>
          </button>
        )}

        <div className={`dash-card${rodando ? ' dash-card-vivo' : ''}`}>
          <span className="dash-card-rotulo">{traduzir('Agora no escritório', 'In the office now')}</span>
          {rodando ? (
            <span className="dash-card-agora" title={rodando.titulo || traduzir(`Tarefa #${rodando.id}`, `Task #${rodando.id}`)}>
              {rodando.titulo || traduzir(`Tarefa #${rodando.id}`, `Task #${rodando.id}`)}
            </span>
          ) : jobs === null || (stats === null && falhas.stats) ? (
            <span className="dash-card-agora texto-suave">{falhas.jobs || falhas.stats ? traduzir('Ainda não foi possível conferir.', 'Could not check this yet.') : traduzir('Consultando…', 'Checking…')}</span>
          ) : (
            <>
              <span className="dash-card-agora texto-suave">{traduzir('Escritório ocioso', 'Office idle')}</span>
              <button type="button" className="botao-texto" onClick={() => aoNavegar('conversa')}>
                {traduzir('pedir um trabalho →', 'request work →')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Saúde do loop: o termômetro do rigor dos portões (12/08/2026).
          Só aparece quando já houve decisão — sem dado, nada de zero enganoso. */}
      {loop && loop.taxa_aprovacao_primeira !== null && (
        <section className="dash-loop" aria-label={traduzir('Saúde do loop de aprovação', 'Approval process health')}>
          <div className="dash-loop-topo">
            <strong>
              <Icone nome="loop" tamanho={15} /> {traduzir('Saúde do loop', 'Approval process')}
            </strong>
            <span className="texto-suave">
              {traduzir('quanto sai aprovado de primeira — sem você pedir ajuste', 'how much is approved on the first try, without requesting changes')}
            </span>
          </div>
          <div className="dash-loop-numeros">
            <div className="dash-loop-metrica">
              <strong>{Math.round(loop.taxa_aprovacao_primeira * 100)}%</strong>
              <span>{traduzir('aprovado de primeira', 'approved on the first try')}</span>
            </div>
            <div className="dash-loop-metrica">
              <strong>{loop.trabalhos.com_rejeicao}</strong>
              <span>{loop.trabalhos.com_rejeicao === 1 ? traduzir('voltou p/ ajuste', 'returned for changes') : traduzir('voltaram p/ ajuste', 'returned for changes')}</span>
            </div>
            <div className="dash-loop-metrica">
              <strong>{loop.trabalhos.rodadas_extras}</strong>
              <span>{loop.trabalhos.rodadas_extras === 1 ? traduzir('rodada extra', 'extra round') : traduzir('rodadas extras', 'extra rounds')}</span>
            </div>
            <div className="dash-loop-metrica">
              <strong>{loop.trabalhos.com_devolutiva}</strong>
              <span>{loop.trabalhos.com_devolutiva === 1 ? traduzir('pediu insumo', 'requested material') : traduzir('pediram insumo', 'requested material')}</span>
            </div>
            {loop.criterios_reprovados > 0 && (
              <div className="dash-loop-metrica dash-loop-alerta">
                <strong>{loop.criterios_reprovados}</strong>
                <span>{traduzir('reprovas no portão de qualidade', 'quality check failures')}</span>
              </div>
            )}
          </div>
          {loop.por_tipo.some((t) => t.rejeitadas > 0) && (
            <p className="texto-suave dash-loop-tipos">
              {traduzir('Onde os ajustes acontecem:', 'Where changes are needed:')}{' '}
              {loop.por_tipo
                .filter((t) => t.rejeitadas > 0)
                .map((t) => `${tipoEntregaLabel(t.tipo, idioma)} (${t.rejeitadas})`)
                .join(' · ')}
            </p>
          )}
        </section>
      )}

      {/* ── Atividade dos últimos 14 dias ── */}
      <section className="dash-bloco" aria-label={traduzir('Atividade dos últimos 14 dias', 'Activity over the last 14 days')}>
        <header className="dash-bloco-topo">
          <h3>{traduzir('Atividade', 'Activity')}</h3>
          <span className="texto-suave">{traduzir('últimos', 'last')} {DIAS_ATIVIDADE} {traduzir('dias', 'days')}</span>
        </header>
        {jobs === null ? (
          <p className="texto-suave">{falhas.jobs ? traduzir('Ainda não foi possível conferir as tarefas.', 'Could not check tasks yet.') : traduzir('Carregando…', 'Loading…')}</p>
        ) : totalFaixa === 0 ? (
          <p className="texto-suave dash-faixa-vazia">
            {traduzir('Nenhuma tarefa nos últimos', 'No tasks in the last')} {DIAS_ATIVIDADE} {traduzir('dias. Peça a primeira na aba Conversar.', 'days. Request the first one in Chat.')}
          </p>
        ) : (
          <>
            <div className="dash-faixa" role="img" aria-label={`${traduzir('Tarefas por dia:', 'Tasks per day:')} ${dias
              .filter((d) => d.total > 0)
              .map((d) => `${d.rotulo}: ${d.total}`)
              .join('; ')}`}>
              {dias.map((d) => (
                <div key={d.rotulo} className="dash-dia" title={tituloDia(d, traduzir)}>
                  {/* Barra empilhada, base embaixo: concluídas → erro → ativas. */}
                  <div className="dash-barra">
                    {d.ativas > 0 && (
                      <span
                        className="dash-seg dash-seg-ativa"
                        style={{ height: `${Math.max(6, (d.ativas / maiorDia) * 100)}%` }}
                      />
                    )}
                    {d.canceladas > 0 && (
                      <span
                        className="dash-seg dash-seg-cancelada"
                        style={{ height: `${Math.max(6, (d.canceladas / maiorDia) * 100)}%` }}
                      />
                    )}
                    {d.comErro > 0 && (
                      <span
                        className="dash-seg dash-seg-erro"
                        style={{ height: `${Math.max(6, (d.comErro / maiorDia) * 100)}%` }}
                      />
                    )}
                    {d.concluidas > 0 && (
                      <span
                        className="dash-seg dash-seg-ok"
                        style={{ height: `${Math.max(6, (d.concluidas / maiorDia) * 100)}%` }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="dash-faixa-eixo texto-suave" aria-hidden="true">
              <span>{dias[0].rotulo}</span>
              <span>{dias[Math.floor(dias.length / 2)].rotulo}</span>
              <span>{dias[dias.length - 1].rotulo}</span>
            </div>
            {legenda.length > 0 && (
              <ul className="dash-legenda">
                {legenda.map((l) => (
                  <li key={l.chave}>
                    <span className={`dash-legenda-ponto ${l.classe}`} aria-hidden="true" />
                    {l.rotulo}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* ── Entregas recentes ── */}
      <section className="dash-bloco" aria-label={traduzir('Entregas recentes', 'Recent deliverables')}>
        <header className="dash-bloco-topo">
          <h3>{traduzir('Entregas recentes', 'Recent deliverables')}</h3>
          <button type="button" className="botao-texto" onClick={() => aoNavegar('entregas')}>
            {traduzir('ver todas →', 'view all →')}
          </button>
        </header>
        {entregas === null ? (
          <p className="texto-suave">{falhas.entregas ? traduzir('Ainda não foi possível conferir as entregas.', 'Could not check deliverables yet.') : traduzir('Carregando…', 'Loading…')}</p>
        ) : entregasRecentes.length === 0 ? (
          <p className="texto-suave">
            {traduzir('Nenhuma entrega ainda — quando a primeira ficar pronta, ela aparece aqui para o seu OK.', 'No deliverables yet — the first one will appear here for your approval.')}
          </p>
        ) : (
          <ul className="dash-entregas">
            {entregasRecentes.map((e) => {
              const pill = PILL_ENTREGA(traduzir)[e.status] ?? PILL_ENTREGA(traduzir).pendente
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    className="dash-entrega"
                    onClick={() => aoNavegar('entregas')}
                    title={e.nome}
                  >
                    <Icone
                      className="dash-entrega-icone"
                      nome={TIPO_ENTREGA_ICONE[e.tipo ?? 'outro'] ?? 'entregas'}
                    />
                    <span className="dash-entrega-nome">{e.nome}</span>
                    {e.job_titulo && (
                      <span className="dash-entrega-job texto-suave">{e.job_titulo}</span>
                    )}
                    <span className="dash-entrega-quando texto-suave">
                      {tempoRelativo(e.criado_em, idioma)}
                    </span>
                    <span className={`status-pill ${pill.classe}`}>{pill.rotulo}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
