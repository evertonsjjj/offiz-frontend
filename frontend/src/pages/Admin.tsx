import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, asList, ApiError, getSessionIdentity } from '../lib/api'
import { useToasts } from '../components/Toasts'
import { useConfirmacao } from '../components/useConfirmacao'
import { Icone } from '../components/Icone'
import { AdminContratos } from '../components/ContratosIA'
import { RunpodInfra } from '../components/RunpodInfra'
import { ConvitesPendentesAdmin, DialogoLinkAcesso } from '../components/AdminAcessos'
import { SeletorEscritorios } from '../components/SeletorEscritorios'
import { agruparOffices, nomeArea, nomeModulo } from '../lib/office-areas'
import { formatBytes, formatBRL, formatDataHora, statusJobLabel } from '../lib/format'
import { useIdioma, type Traduzir } from '../lib/i18n'
import type {
  AdminStats,
  EventoAdmin,
  OfficeInfo,
  OrgResumo,
  Usuario,
} from '../lib/types'

function slugDe(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Andares concedidos à org. O GET /admin/orgs já devolveu as duas formas ao
 *  longo do tempo (lista de slugs ou de objetos) — normaliza para slug. */
function slugsConcedidos(org: OrgResumo): string[] {
  if (!Array.isArray(org.offices)) return []
  return org.offices
    .map((o: unknown) =>
      typeof o === 'string' ? o : String((o as { office_slug?: string }).office_slug ?? ''),
    )
    .filter(Boolean)
}

/** Os períodos oferecidos — null = desde sempre. */
const periodosRotulos = (traduzir: Traduzir): Array<{ dias: number | null; rotulo: string }> => [
  { dias: 7, rotulo: traduzir("7 dias", "7 days") },
  { dias: 30, rotulo: traduzir("30 dias", "30 days") },
  { dias: 90, rotulo: traduzir("90 dias", "90 days") },
  { dias: null, rotulo: traduzir("tudo", "all time") },
]

/** Ordem fixa dos status nas barras — do que importa mais para o que menos. */
const ORDEM_STATUS = ['done', 'running', 'queued', 'failed', 'cancelled']

interface StorageOrg {
  id: number
  nome: string
  slug: string
  status: string
  bytes: number
  byod_ok: boolean
}

interface StorageResp {
  orgs: StorageOrg[]
  total_bytes: number
  orfaos_bytes: number
  storage_dir: string
}

function SecaoStorage() {
  const { t: traduzir, idioma } = useIdioma()
  const [dados, setDados] = useState<StorageResp | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      setDados(await api.get<StorageResp>('/admin/storage'))
      setErro(null)
    } catch (e) {
      setErro(e instanceof ApiError ? e.detail : traduzir("Não foi possível medir o storage.", "Could not measure storage usage."))
    }
    setCarregando(false)
  }, [traduzir])

  useEffect(() => {
    carregar()
  }, [carregar])

  const orgs = dados ? [...dados.orgs].sort((a, b) => b.bytes - a.bytes) : []

  return (
    <section className="cartao">
      <div className="admin-visao-topo">
        <h2 className="secao-titulo">{traduzir("Storage por empresa", "Storage by company")}</h2>
        <button
          type="button"
          className="botao botao-pequeno botao-fantasma"
          onClick={carregar}
          disabled={carregando}
        >
          {carregando ? traduzir("Medindo…", "Measuring…") : traduzir("Atualizar", "Refresh")}
        </button>
      </div>
      <p className="texto-suave">
        {traduzir("Quanto cada cliente ocupa no NOSSO servidor (workspaces, mídia, cânon). Quem tem banco próprio aparece marcado — os documentos dele moram lá, fora desta conta.", "Storage used by each client on our server (workspaces, media and confirmed knowledge). Clients with their own database are marked; documents stored there are not included here.")}
      </p>
      {erro && <p className="alerta alerta-erro">{erro}</p>}
      {dados === null && !erro && <p className="texto-suave">{traduzir("Medindo o disco…", "Measuring disk usage…")}</p>}
      {dados !== null && (
        <div className="tabela-scroll">
          <table className="tabela">
            <thead>
              <tr>
                <th>{traduzir("Empresa", "Company")}</th>
                <th>{traduzir("Uso no servidor central", "Central server usage")}</th>
                <th>{traduzir("Residência dos dados", "Data residency")}</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td>
                    {o.nome} <span className="texto-suave">({o.slug})</span>
                  </td>
                  <td>{formatBytes(o.bytes, idioma)}</td>
                  <td>{o.byod_ok ? traduzir("banco próprio ✓", "own database ✓") : traduzir("central", "central")}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td>
                  <strong>{formatBytes(dados.total_bytes, idioma)}</strong>
                </td>
                <td />
              </tr>
              {dados.orfaos_bytes > 0 && (
                <tr>
                  <td className="texto-suave">{traduzir("Pastas órfãs (orgs excluídas)", "Orphan folders (deleted organizations)")}</td>
                  <td className="texto-suave">{formatBytes(dados.orfaos_bytes, idioma)}</td>
                  <td className="texto-suave">{traduzir("lixo — pode limpar", "unused — can be cleaned")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function SecaoStats() {
  const { t: traduzir, idioma } = useIdioma()
  const PERIODOS = periodosRotulos(traduzir)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // Default 30 dias: "como está o negócio agora" — não a soma da vida inteira.
  const [dias, setDias] = useState<number | null>(30)
  const [tentativa, setTentativa] = useState(0)
  // Pílula clicada → a lista de tarefas daquele status (com log por tarefa).
  const [statusAberto, setStatusAberto] = useState<string | null>(null)

  useEffect(() => {
    const controle = new AbortController()
    setStats(null)
    setErro(null)
    setStatusAberto(null)
    api
      .get<AdminStats>(`/admin/stats${dias ? `?dias=${dias}` : ''}`, controle.signal)
      .then(dados => { if (!controle.signal.aborted) setStats(dados) })
      .catch((e) => { if (!controle.signal.aborted) setErro(e instanceof ApiError ? e.detail : traduzir("Não foi possível carregar as estatísticas.", "Could not load statistics.")) })
    return () => controle.abort()
  }, [dias, traduzir, tentativa])

  const jobsPorStatus = stats?.jobs_por_status ?? {}
  const totalJobs =
    stats?.jobs_total ??
    Object.values(jobsPorStatus).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
  const statusOrdenados = [
    ...ORDEM_STATUS.filter((s) => s in jobsPorStatus),
    ...Object.keys(jobsPorStatus).filter((s) => !ORDEM_STATUS.includes(s)),
  ]
  const rotuloPeriodo = dias ? traduzir(`nos últimos ${dias} dias`, `in the last ${dias} days`) : traduzir("desde sempre", "all time")

  return (
    <section className="cartao">
      <div className="admin-visao-topo">
        <h2 className="secao-titulo">{traduzir("Visão geral", "Overview")}</h2>
        <span className="linha-conceder" role="group" aria-label={traduzir("Período", "Period")}>
          {PERIODOS.map((p) => (
            <button
              key={p.rotulo}
              type="button"
              className={`botao botao-pequeno ${dias === p.dias ? 'botao-primario' : 'botao-fantasma'}`}
              onClick={() => setDias(p.dias)}
            >
              {p.rotulo}
            </button>
          ))}
        </span>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert"><p>{erro}</p>
        <button type="button" className="botao botao-fantasma" onClick={() => setTentativa(v => v + 1)}>{traduzir('Tentar novamente', 'Try again')}</button>
      </div>}
      {stats === null && !erro && <p className="texto-suave">{traduzir("Carregando…", "Loading…")}</p>}
      {stats !== null && (
        <>
          <div className="uso-cards">
            <div className="uso-card destaque">
              <span className="uso-valor">{totalJobs}</span>
              <span className="uso-rotulo">{totalJobs === 1 ? traduzir("tarefa", "task") : traduzir("tarefas", "tasks")} {rotuloPeriodo}</span>
            </div>
            <div className="uso-card">
              <span className="uso-valor">
                {typeof stats.custo_brl === 'number'
                  ? formatBRL(stats.custo_brl, idioma)
                  : '—'}
              </span>
              <span className="uso-rotulo">{traduzir("custo de IA", "AI cost")} {rotuloPeriodo}</span>
            </div>
            <div className="uso-card">
              <span className="uso-valor">{stats.organizations ?? stats.orgs ?? '—'}</span>
              <span className="uso-rotulo">{traduzir("organizações", "organizations")}</span>
            </div>
            <div className="uso-card">
              <span className="uso-valor">{stats.usuarios ?? '—'}</span>
              <span className="uso-rotulo">{traduzir("usuários ativos", "active users")}</span>
            </div>
          </div>

          {totalJobs === 0 && (
            <p className="texto-suave">{traduzir(`Nenhuma tarefa ${rotuloPeriodo}.`, `No tasks ${rotuloPeriodo}.`)}</p>
          )}
          {totalJobs > 0 && (
            <>
              {/* Barra proporcional: a proporção done/failed se VÊ, em vez de
                  se calcular de cabeça a partir de dois números soltos. */}
              <div className="admin-barra-status" aria-hidden="true">
                {statusOrdenados.map((s) => (
                  <span
                    key={s}
                    className={`admin-barra-fatia status-cor-${s}`}
                    style={{ width: `${(100 * (jobsPorStatus[s] ?? 0)) / totalJobs}%` }}
                    title={`${statusJobLabel(s, idioma)}: ${jobsPorStatus[s]}`}
                  />
                ))}
              </div>
              <div className="admin-status-jobs">
                {statusOrdenados.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`status-pill status-${s} admin-pill-btn${statusAberto === s ? ' aberto' : ''}`}
                    onClick={() => setStatusAberto(statusAberto === s ? null : s)}
                    title={traduzir("Clique para ver estas tarefas (e o log de cada uma)", "View these tasks and their logs")}
                  >
                    {statusJobLabel(s, idioma)}: {jobsPorStatus[s]}
                    {totalJobs > 0 && ` (${Math.round((100 * (jobsPorStatus[s] ?? 0)) / totalJobs)}%)`}
                  </button>
                ))}
              </div>
              {statusAberto && <ListaJobsAdmin key={`${statusAberto}:${dias}`} status={statusAberto} dias={dias} />}
            </>
          )}
        </>
      )}
    </section>
  )
}

/** Uma tarefa como o GET /admin/jobs devolve. */
interface JobAdmin {
  id: number
  org_id: number
  org_nome: string
  office_slug: string
  status: string
  criado_em: string | null
  erro: string | null
  custo_brl: number
  prompt_resumo: string
}

interface EventoJob {
  seq?: number
  tipo?: string
  payload?: Record<string, unknown>
  criado_em?: string
  [k: string]: unknown
}

/** As tarefas de um status (clique na pílula), com o LOG de cada uma sob
 *  demanda — "cliente falhou, eu vejo o log" sem sair da Administração. O log
 *  vem da rota que sempre existiu (GET /jobs/{id}/events; o guard de prédio
 *  deixa admin global entrar). */
function ListaJobsAdmin({ status, dias }: { status: string; dias: number | null }) {
  const { t: traduzir, idioma } = useIdioma()
  const [jobs, setJobs] = useState<JobAdmin[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<number | null>(null)
  const [eventos, setEventos] = useState<Record<number, EventoJob[] | 'carregando' | 'erro'>>({})
  const [tentativa, setTentativa] = useState(0)
  const leituras = useRef(new Map<number, AbortController>())

  useEffect(() => {
    const controle = new AbortController()
    setJobs(null)
    setErro(null)
    const params = new URLSearchParams({ status, limite: '50' })
    if (dias) params.set('dias', String(dias))
    api
      .get<{ jobs: JobAdmin[] }>(`/admin/jobs?${params}`, controle.signal)
      .then((r) => { if (!controle.signal.aborted) setJobs(r.jobs) })
      .catch((e) => { if (!controle.signal.aborted) setErro(e instanceof ApiError ? e.detail : traduzir("Não foi possível listar as tarefas.", "Could not list tasks.")) })
    return () => controle.abort()
  }, [status, dias, traduzir, tentativa])

  useEffect(() => {
    const pendentes = leituras.current
    return () => { for (const controle of pendentes.values()) controle.abort(); pendentes.clear() }
  }, [])

  async function alternarLog(id: number, repetir = false) {
    if (aberto === id && !repetir) {
      setAberto(null)
      return
    }
    setAberto(id)
    if (leituras.current.has(id) || (!repetir && eventos[id] && eventos[id] !== 'erro')) return
    const controle = new AbortController()
    leituras.current.set(id, controle)
    setEventos((prev) => ({ ...prev, [id]: 'carregando' }))
    try {
      const r = await api.get<{ events: EventoJob[] }>(`/jobs/${id}/events`, controle.signal)
      if (!controle.signal.aborted) setEventos((prev) => ({ ...prev, [id]: r.events }))
    } catch {
      if (!controle.signal.aborted) setEventos((prev) => ({ ...prev, [id]: 'erro' }))
    } finally { if (leituras.current.get(id) === controle) leituras.current.delete(id) }
  }

  /** Uma linha legível por evento — payload técnico só onde ajuda. */
  function linhaEvento(e: EventoJob): string {
    const p = e.payload ?? {}
    if (e.tipo === 'agent_text') return String(p.texto ?? '')
    if (e.tipo === 'tool_use') return `🔧 ${p.ferramenta ?? ''} ${p.resumo ?? ''}`
    if (e.tipo === 'erro') return `❌ ${p.mensagem ?? ''}`
    if (e.tipo === 'subagente') return traduzir(`👤 subagente ${p.nome ?? ''} (${p.acao ?? ''})`, `👤 subagent ${p.nome ?? ''} (${p.acao ?? ''})`)
    if (e.tipo === 'resultado') return traduzir(`✔ fim — ${formatBRL(Number(p.custo_brl ?? 0), idioma)}`, `✔ finished — ${formatBRL(Number(p.custo_brl ?? 0), idioma)}`)
    return `${e.tipo}: ${JSON.stringify(p).slice(0, 160)}`
  }

  return (
    <div className="admin-jobs">
      {erro && <div className="alerta alerta-erro" role="alert"><p>{erro}</p>
        <button type="button" className="botao botao-fantasma" onClick={() => setTentativa(v => v + 1)}>{traduzir('Tentar novamente', 'Try again')}</button>
      </div>}
      {jobs === null && !erro && <p className="texto-suave">{traduzir("Carregando as tarefas…", "Loading tasks…")}</p>}
      {jobs !== null && jobs.length === 0 && (
        <p className="texto-suave">{traduzir("Nenhuma tarefa neste recorte.", "No tasks match this filter.")}</p>
      )}
      {(jobs ?? []).map((j) => (
        <div key={j.id} className="admin-job">
          <button type="button" className="admin-job-linha" onClick={() => alternarLog(j.id)}>
            <span className="texto-suave">#{j.id}</span>
            <strong>{j.org_nome}</strong>
            <code>{j.office_slug}</code>
            <span className="texto-suave">
              {j.criado_em ? formatDataHora(j.criado_em, idioma) : '—'}
            </span>
            <span className="admin-job-prompt">{j.prompt_resumo}</span>
            <span aria-hidden="true">{aberto === j.id ? '▾' : '▸'}</span>
          </button>
          {/* O MOTIVO da falha sempre à vista — é o que o suporte veio ler. */}
          {j.erro && (
            <p className="admin-job-erro">
              <Icone nome="erro" tamanho={15} /> {j.erro}
            </p>
          )}
          {aberto === j.id && (
            <div className="admin-job-log">
              {eventos[j.id] === 'carregando' && <p className="texto-suave">{traduzir("Lendo o log…", "Reading log…")}</p>}
              {eventos[j.id] === 'erro' && (
                <div role="alert"><p className="texto-suave">{traduzir("Não consegui ler o log desta tarefa.", "Could not read this task’s log.")}</p>
                  <button type="button" className="botao botao-fantasma" onClick={() => alternarLog(j.id, true)}>{traduzir('Tentar novamente', 'Try again')}</button>
                </div>
              )}
              {Array.isArray(eventos[j.id]) && (
                <>
                  {(eventos[j.id] as EventoJob[]).length === 0 && (
                    <p className="texto-suave">{traduzir("Sem eventos — a tarefa não chegou a rodar.", "No events — the task did not start.")}</p>
                  )}
                  <pre className="admin-job-eventos">
                    {(eventos[j.id] as EventoJob[]).map((e) => linhaEvento(e)).filter(Boolean).join('\n')}
                  </pre>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** Convite de owner devolvido quando o dono informado ainda não tem conta. */
interface ConviteOwner {
  email: string
  link: string
  email_enviado?: boolean
  email_solicitado?: boolean
}

export function SecaoCriarOrg({ offices, aoCriar }: { offices: OfficeInfo[]; aoCriar: () => void }) {
  const { t: traduzir } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [tipo, setTipo] = useState<'cliente' | 'teste' | 'demo'>('cliente')
  const criando = useRef(false)
  const [nome, setNome] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEditado, setSlugEditado] = useState(false)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ texto: string; prepararIA: boolean } | null>(null)
  const [enviando, setEnviando] = useState(false)
  // Dono sem conta: o backend devolve um convite de owner. O link é a ÚNICA
  // via de acesso dessa pessoa (o produto não tem "esqueci minha senha"), e o
  // token não é recuperável depois — por isso ele fica na tela até o operador
  // criar a próxima org, e não some com o toast.
  const [convite, setConvite] = useState<ConviteOwner | null>(null)
  const disponiveis = offices.filter(o => !o.arquivado)
  function preparar(tipo: 'cliente' | 'teste' | 'demo') {
    if (criando.current) return
    setTipo(tipo)
    const codigo = Array.from(crypto.getRandomValues(new Uint32Array(2))).map(n => n.toString(36)).join('')
    const nome = tipo === 'cliente' ? '' : `${tipo === 'teste' ? 'Teste' : 'Demo'} ${new Date().toLocaleDateString()} ${codigo.slice(-4)}`
    setNome(nome); setSlug(slugDe(nome)); setSlugEditado(false)
    setOwnerEmail(tipo === 'cliente' ? '' : `${tipo}-${codigo}@example.com`)
    setSelecionados(new Set(tipo === 'cliente' || !disponiveis.length ? [] : [disponiveis.find(o => o.slug === 'conteudo')?.slug || disponiveis[0].slug]))
  }

  function alternarOffice(s: string) {
    setSelecionados((prev) => {
      const novo = new Set(prev)
      if (novo.has(s)) novo.delete(s)
      else novo.add(s)
      return novo
    })
  }

  async function criar(e: FormEvent) {
    e.preventDefault()
    if (criando.current) return
    setErro(null)
    setAviso(null)
    if (!nome.trim()) {
      setErro(traduzir("Informe o nome da organização.", "Enter the organization name."))
      return
    }
    if (!ownerEmail.trim()) {
      setErro(traduzir("Informe o e-mail do dono (owner).", "Enter the owner’s email."))
      return
    }
    criando.current = true
    if (Array.from(selecionados).some(slug => !disponiveis.some(o => o.slug === slug))) {
      criando.current = false
      setErro(traduzir('Um serviço selecionado saiu do catálogo disponível. Atualize a página e reveja a seleção.', 'A selected service is no longer available. Refresh the page and review your selection.'))
      return
    }
    setEnviando(true)
    setConvite(null)
    try {
      const criada = await api.post<{ convite_owner?: ConviteOwner }>('/admin/orgs', {
        nome: nome.trim(),
        slug: (slug.trim() || slugDe(nome)).toLowerCase(),
        owner_email: ownerEmail.trim().toLowerCase(),
        offices: Array.from(selecionados),
        enviar_email: tipo === 'cliente',
      })
      if (criada?.convite_owner) setConvite({ ...criada.convite_owner, email_solicitado: tipo === 'cliente' })
      setAviso({ texto: traduzir(`Organização “${nome.trim()}” criada.`, `Organization “${nome.trim()}” created.`), prepararIA: tipo !== 'cliente' })
      sucesso(traduzir(`Organização “${nome.trim()}” criada.`, `Organization “${nome.trim()}” created.`))
      setNome('')
      setSlug('')
      setSlugEditado(false)
      setOwnerEmail('')
      setSelecionados(new Set())
      aoCriar()
    } catch (err) {
      setErro(err instanceof ApiError ? err.detail : traduzir("Não foi possível criar a organização.", "Could not create the organization."))
    } finally {
      criando.current = false
      setEnviando(false)
    }
  }

  return (
    <section className="cartao admin-novo-cliente">
      <h2 className="secao-titulo">{traduzir('Novo cliente', 'New client')}</h2>
      <div className="config-categorias" aria-label={traduzir('Tipo de cadastro', 'Account type')}>
        {(['cliente', 'teste', 'demo'] as const).map(opcao => <button type="button" key={opcao} aria-pressed={tipo === opcao} disabled={enviando} onClick={() => preparar(opcao)}>{opcao === 'cliente' ? traduzir('Cliente', 'Client') : opcao === 'teste' ? traduzir('Teste', 'Test') : 'Demo'}</button>)}
      </div>
      <p className="texto-suave">{tipo === 'cliente' ? traduzir('Crie a empresa e escolha quem terá o primeiro acesso.', 'Create the company and choose who gets first access.') : traduzir('Empresa separada com e-mail fictício. Você recebe o link para escolher a senha e testar o primeiro acesso. Nenhum e-mail será enviado.', 'Separate company with a fictional email. You get a link to choose a password and test first sign-in. No email will be sent.')}</p>
      {erro && <p className="alerta alerta-erro">{erro}</p>}
      {aviso && <div className="alerta alerta-ok"><p>{aviso.texto}</p>
        {aviso.prepararIA && <p>{traduzir('Antes de testar o chat, prepare a conexão em Contratos e IA. Criar a demo não configura IA nem libera saldo.', 'Before testing the chat, set up the connection under Contracts and AI. Creating a demo does not configure AI or provide credit.')}</p>}
      </div>}
      {convite && (
        <div className="alerta alerta-aviso" role="status">
          <p>
            <strong>{traduzir(`${convite.email} ainda não tinha conta.`, `${convite.email} did not have an account.`)}</strong> {traduzir("Mande o link abaixo: a pessoa cria a própria senha e entra como dona da empresa.", "Share the link below so the person can create a password and join as the company owner.")}
            {convite.email_solicitado === false ? traduzir(' Use o link em outro perfil do navegador para manter sua administração aberta.', ' Use the link in another browser profile to keep administration open.') : convite.email_enviado
              ? traduzir(" (Também enviamos por e-mail.)", " (We also sent it by email.)")
              : traduzir(" (O e-mail não saiu — envie o link por outro canal.)", " (The email was not sent. Share the link through another channel.)")}
          </p>
          <p>
            <input
              type="text"
              aria-label={traduzir('Link do convite', 'Invitation link')}
              readOnly
              value={convite.link}
              onFocus={(e) => e.currentTarget.select()}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
            />
          </p>
          <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            onClick={async () => {
              try {
                if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
                await navigator.clipboard.writeText(convite.link)
                sucesso(traduzir("Link copiado.", "Link copied."))
              } catch { falha(traduzir('Não consegui copiar. Selecione o link e copie manualmente.', 'Could not copy. Select the link and copy it manually.')) }
            }}
          >
            {traduzir("Copiar link", "Copy link")}
          </button>
          <p className="texto-suave">
            {traduzir("O link vale 7 dias e não pode ser recuperado depois que esta tela sair — copie agora.", "The link is valid for 7 days and cannot be retrieved after leaving this screen. Copy it now.")}
          </p>
        </div>
      )}
      <form onSubmit={criar}>
        <div className="linha-campos">
          <label className="campo">
            <span>{traduzir("Nome", "Name")}</span>
            <input
              type="text"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value)
                if (!slugEditado) setSlug(slugDe(e.target.value))
              }}
              placeholder={traduzir("Escritório Silva & Associados", "Silva & Associates")}
            />
          </label>
          <details className="campo"><summary>{traduzir('Editar endereço da empresa', 'Edit company address')}</summary><label className="campo">
            <span>{traduzir('Endereço curto', 'Short address')}</span>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value)
                setSlugEditado(true)
              }}
              placeholder="silva-associados"
            />
          </label></details>
        </div>
        <div className="campo">
          <label htmlFor="novo-cliente-email">{traduzir('E-mail de quem administra', 'Administrator email')}</label>
          <input
            id="novo-cliente-email"
            aria-describedby="novo-cliente-email-ajuda"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="dono@cliente.com.br"
          />
          <small id="novo-cliente-email-ajuda" className="texto-suave">
            {traduzir("Não precisa ter conta: se o e-mail for novo, você recebe um link para mandar — a pessoa cria a própria senha.", "An existing account is not required. If the email is new, you receive a link to share so the person can choose their own password.")}
          </small>
        </div>
        <SeletorEscritorios offices={offices} selecionados={selecionados} aoAlternar={alternarOffice} disabled={enviando} />
        <button type="submit" className="botao botao-primario" disabled={enviando}>
          {enviando ? traduzir("Criando…", "Creating…") : traduzir('Criar cliente', 'Create client')}
        </button>
      </form>
    </section>
  )
}

/** Serializa ações da mesma conta/empresa e descarta efeitos após sair da sessão. */
function useOperacoesAdmin() {
  const emCurso = useRef(new Set<number>())
  const [ocupados, setOcupados] = useState(new Set<number>())
  const montado = useRef(false)
  useEffect(() => {
    montado.current = true
    return () => { montado.current = false; emCurso.current.clear() }
  }, [])
  const iniciar = (id: number) => {
    if (!montado.current || emCurso.current.has(id)) return null
    const sessao = getSessionIdentity()
    const ativa = () => montado.current && getSessionIdentity() === sessao
    emCurso.current.add(id)
    setOcupados(new Set(emCurso.current))
    return { ativa, finalizar: () => {
      emCurso.current.delete(id)
      if (ativa()) setOcupados(new Set(emCurso.current))
    } }
  }
  return { iniciar, ocupados }
}

function SecaoOrgs({
  orgs,
  offices,
  erro,
  aoMudar,
  ativo,
  carregando,
}: {
  orgs: OrgResumo[] | null
  offices: OfficeInfo[]
  erro: string | null
  aoMudar: () => void
  ativo: boolean
  carregando: boolean
}) {
  const { t: traduzir } = useIdioma()
  const { sucesso, falha } = useToasts()
  const { confirmar, solicitarTexto, dialogo } = useConfirmacao(`${getSessionIdentity()}:clientes:${ativo}`)
  const { iniciar, ocupados } = useOperacoesAdmin()
  const [erroLocal, setErroLocal] = useState<string | null>(null)
  const [orgAcesso, setOrgAcesso] = useState<OrgResumo | null>(null)
  // Busca + paginação (10/página): a tabela crescia uma tela por org.
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(0)
  // O select de conceder é POR org (controlado): um valor só vazaria entre linhas.
  const [concederSel, setConcederSel] = useState<Record<number, string>>({})
  const [orgExcluir, setOrgExcluir] = useState<OrgResumo | null>(null)
  const [confirmacaoExclusao, setConfirmacaoExclusao] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState<string | null>(null)
  const exclusaoDialogRef = useRef<HTMLDialogElement | null>(null)
  const exclusaoEmCurso = useRef(false)
  const contextoExclusao = useRef(0)

  useEffect(() => {
    if (!ativo) {
      contextoExclusao.current++
      setOrgExcluir(null)
      setOrgAcesso(null)
    }
  }, [ativo])

  useEffect(() => {
    if (!orgExcluir) return
    const dialogo = exclusaoDialogRef.current
    const anterior = document.activeElement
    dialogo?.showModal()
    return () => {
      dialogo?.close()
      if (anterior instanceof HTMLElement && anterior.isConnected && !anterior.closest('[hidden]')) anterior.focus()
    }
  }, [orgExcluir])

  function abrirExclusao(org: OrgResumo) {
    if (!ativo || exclusaoEmCurso.current || ocupados.has(org.id)) return
    setConfirmacaoExclusao('')
    setErroExclusao(null)
    setOrgExcluir(org)
  }

  async function conceder(org: OrgResumo, slug: string) {
    if (!slug) return
    const operacao = iniciar(org.id)
    if (!operacao) return
    setErroLocal(null)
    try {
      await api.post(`/orgs/${org.id}/offices`, { office_slug: slug })
      if (!operacao.ativa()) return
      setConcederSel(prev => ({ ...prev, [org.id]: '' }))
      sucesso(traduzir(`Escritório “${slug}” concedido a ${org.nome}.`, `Office “${slug}” granted to ${org.nome}.`))
      aoMudar()
    } catch (e) {
      if (!operacao.ativa()) return
      falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível conceder o escritório.", "Could not grant access to the office."))
    } finally { operacao.finalizar() }
  }

  async function revogar(org: OrgResumo, slug: string) {
    if (ocupados.has(org.id)) return
    if (!await confirmar({ titulo: traduzir('Remover acesso ao escritório', 'Remove office access'),
      mensagem: traduzir(`Remover o escritório “${slug}” da organização ${org.nome}?`, `Remove office “${slug}” from ${org.nome}?`),
      acao: traduzir('Remover acesso', 'Remove access') })) return
    const operacao = iniciar(org.id)
    if (!operacao) return
    setErroLocal(null)
    try {
      const r = await api.del<{ tarefas_presas_na_fila?: number }>(
        `/orgs/${org.id}/offices/${slug}`,
      )
      if (!operacao.ativa()) return
      // O claim passou a respeitar a revogação: tarefa já enfileirada PARA de
      // rodar em vez de queimar a chave do cliente. Se havia alguma, o operador
      // precisa saber — ela fica esperando até reconceder.
      const presas = r?.tarefas_presas_na_fila ?? 0
      sucesso(
        presas > 0
          ? traduzir(`Escritório “${slug}” removido de ${org.nome}. ${presas} tarefa(s) ficaram paradas na fila.`, `Office “${slug}” removed from ${org.nome}. ${presas} task(s) remain paused in the queue.`)
          : traduzir(`Escritório “${slug}” removido de ${org.nome}.`, `Office “${slug}” removed from ${org.nome}.`),
      )
      aoMudar()
    } catch (e) {
      if (!operacao.ativa()) return
      falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível remover o escritório.", "Could not remove the office."))
    } finally { operacao.finalizar() }
  }

  async function alternarStatus(org: OrgResumo) {
    if (ocupados.has(org.id)) return
    const suspender = (org.status ?? 'ativa') === 'ativa'
    const acao = suspender ? traduzir("Suspender", "Suspend") : traduzir("Reativar", "Reactivate")
    const mensagem = suspender
      ? traduzir(`Suspender ${org.nome}?\n\nO cliente continua entrando e vendo o que já existe, mas nenhuma tarefa nova é aceita e a fila para. Nada é apagado.`, `Suspend ${org.nome}?\n\nThe client can still sign in and view existing content, but new tasks are blocked and the queue is paused. Nothing is deleted.`)
      : traduzir(`Reativar ${org.nome}?\n\nAs tarefas que ficaram na fila voltam a rodar.`, `Reactivate ${org.nome}?\n\nQueued tasks will resume.`)
    let motivo: string | undefined
    if (suspender) {
      const resposta = await solicitarTexto({ titulo: `${acao} ${org.nome}`, mensagem, acao,
        rotulo: traduzir('Motivo (opcional, registrado na auditoria)', 'Reason (optional, saved in the audit trail)'), aceitarVazio: true })
      if (resposta === null) return
      motivo = resposta || undefined
    } else if (!await confirmar({ titulo: `${acao} ${org.nome}`, mensagem, acao, perigoso: false })) return
    const operacao = iniciar(org.id)
    if (!operacao) return
    setErroLocal(null)
    try {
      const r = await api.put<{ tarefas_na_fila?: number }>(`/admin/orgs/${org.id}/status`, {
        status: suspender ? 'suspensa' : 'ativa',
        motivo,
      })
      if (!operacao.ativa()) return
      const fila = r?.tarefas_na_fila ?? 0
      sucesso(
        suspender
          ? traduzir(`${org.nome} suspensa.${fila ? ` ${fila} tarefa(s) ficaram paradas.` : ''}`, `${org.nome} suspended.${fila ? ` ${fila} task(s) paused.` : ''}`)
          : traduzir(`${org.nome} reativada.${fila ? ` ${fila} tarefa(s) voltam a rodar.` : ''}`, `${org.nome} reactivated.${fila ? ` ${fila} task(s) will resume.` : ''}`),
      )
      aoMudar()
    } catch (e) {
      if (!operacao.ativa()) return
      falha(e instanceof ApiError ? e.detail : traduzir(`Não foi possível ${acao.toLowerCase()} a organização.`, `Could not ${acao.toLowerCase()} the organization.`))
    } finally { operacao.finalizar() }
  }

  async function mudarAssentos(org: OrgResumo) {
    if (ocupados.has(org.id)) return
    const atual = org.assentos ?? 5
    const resposta = await solicitarTexto({ titulo: traduzir(`Assentos de ${org.nome}`, `Seats for ${org.nome}`),
      mensagem: traduzir(`Assentos vendidos para ${org.nome}\n\nOcupação hoje: ${org.membros ?? 0} membro(s)${org.quarentena ? ` + ${org.quarentena} em quarentena` : ''}.\nPode ficar abaixo da ocupação: ninguém é removido, a org só não consegue convidar mais.`, `Seats purchased for ${org.nome}\n\nCurrent usage: ${org.membros ?? 0} member(s)${org.quarentena ? ` + ${org.quarentena} in quarantine` : ''}.\nYou can set a lower limit without removing anyone; the organization will not be able to invite more members.`),
      rotulo: traduzir('Quantidade de assentos', 'Number of seats'), tipo: 'number', valorInicial: String(atual),
      acao: traduzir('Salvar assentos', 'Save seat limit'), perigoso: false,
      validar: valor => Number.isInteger(Number(valor)) && Number(valor) >= 1 ? null : traduzir('Informe um número inteiro maior que zero.', 'Enter a whole number greater than zero.'),
    })
    if (resposta === null) return
    const assentos = Number(resposta)
    if (!Number.isInteger(assentos) || assentos < 1) {
      falha(traduzir("Informe um número inteiro maior que zero.", "Enter a whole number greater than zero."))
      return
    }
    const operacao = iniciar(org.id)
    if (!operacao) return
    try {
      await api.put(`/admin/orgs/${org.id}/assentos`, { assentos })
      if (!operacao.ativa()) return
      sucesso(traduzir(`${org.nome}: ${assentos} assento(s).`, `${org.nome}: ${assentos} seat(s).`))
      aoMudar()
    } catch (e) {
      if (!operacao.ativa()) return
      falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível mudar os assentos.", "Could not change the seat limit."))
    } finally { operacao.finalizar() }
  }

  async function alternarResidencia(org: OrgResumo) {
    if (ocupados.has(org.id)) return
    const autorizada = org.autorizada_banco_central !== false
    const revogando = autorizada
    const mensagem = revogando
      ? traduzir(`Exigir banco PRÓPRIO de ${org.nome}?\n\nSem o banco dela configurado e testado, a organização PARA de trabalhar (tarefas, chat e fila) até configurar. Os arquivos de documentos e a chave passam a morar no banco dela.`, `Require ${org.nome} to use its own database?\n\nUntil its database is configured and tested, tasks, chat and the queue are blocked. Document data and the key will be stored in its database.`)
      : traduzir(`Liberar o banco central do Offiz para ${org.nome}?`, `Allow ${org.nome} to use the central Offiz database?`)
    const titulo = revogando ? traduzir('Exigir banco próprio', 'Require own database') : traduzir('Liberar banco central', 'Allow central database')
    let motivo: string | undefined
    if (revogando) {
      const resposta = await solicitarTexto({ titulo, mensagem, acao: titulo,
        rotulo: traduzir('Motivo (opcional, registrado na auditoria)', 'Reason (optional, saved in the audit trail)'), aceitarVazio: true })
      if (resposta === null) return
      motivo = resposta || undefined
    } else if (!await confirmar({ titulo, mensagem, acao: titulo, perigoso: false })) return
    const operacao = iniciar(org.id)
    if (!operacao) return
    try {
      const r = await api.put<{ aviso?: string | null }>(
        `/admin/orgs/${org.id}/autorizacao-banco`,
        { autorizada: !autorizada, motivo },
      )
      if (!operacao.ativa()) return
      if (r?.aviso) falha(r.aviso)
      else sucesso(revogando ? traduzir(`${org.nome}: banco próprio exigido.`, `${org.nome}: own database required.`) : traduzir(`${org.nome}: banco central liberado.`, `${org.nome}: central database allowed.`))
      aoMudar()
    } catch (e) {
      if (!operacao.ativa()) return
      falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível mudar a residência de dados.", "Could not change data residency."))
    } finally { operacao.finalizar() }
  }

  async function excluir(e: FormEvent) {
    e.preventDefault()
    if (!ativo || !orgExcluir || exclusaoEmCurso.current) return
    const org = orgExcluir
    if (confirmacaoExclusao !== org.slug) {
      setErroExclusao(traduzir('Identificador incorreto — nada foi excluído.', 'The identifier does not match. Nothing was deleted.'))
      return
    }
    const operacao = iniciar(org.id)
    if (!operacao) return
    const contexto = contextoExclusao.current
    const atual = () => operacao.ativa() && contextoExclusao.current === contexto
    exclusaoEmCurso.current = true
    setExcluindo(true)
    setErroExclusao(null)
    try {
      const r = await api.del<{ apagado?: { limpeza_arquivos_pendente?: number } }>(`/admin/orgs/${org.id}`, { confirmar_slug: confirmacaoExclusao })
      if (!atual()) return
      if (r?.apagado?.limpeza_arquivos_pendente) falha(traduzir(`Organização ${org.nome} excluída. A remoção dos arquivos ficou pendente; verifique a limpeza do armazenamento em Operação e histórico.`, `Organization ${org.nome} deleted. File removal is pending; check storage cleanup in Operations and history.`))
      else sucesso(traduzir(`Organização ${org.nome} excluída.`, `Organization ${org.nome} deleted.`))
      setOrgExcluir(null)
      aoMudar()
    } catch (e) {
      if (atual()) setErroExclusao(e instanceof ApiError ? e.detail : traduzir("Não foi possível excluir a organização.", "Could not delete the organization."))
    } finally {
      exclusaoEmCurso.current = false
      if (operacao.ativa()) setExcluindo(false)
      operacao.finalizar()
    }
  }

  return (
    <section className="cartao">
      <h2 className="secao-titulo">{traduzir('Seus clientes', 'Your clients')}</h2>
      {dialogo}
      {erro && <div className="alerta alerta-erro" role="alert">
        <p>{erro}</p>
        {orgs !== null && <p>{traduzir('A lista abaixo é da última consulta confirmada.', 'The list below is from the last confirmed check.')}</p>}
        <button type="button" className="botao-texto" disabled={carregando} onClick={aoMudar}>{traduzir(carregando ? 'Consultando…' : 'Tentar novamente', carregando ? 'Checking…' : 'Try again')}</button>
      </div>}
      {erroLocal && <p className="alerta alerta-erro" role="alert">{erroLocal}</p>}
      {orgs === null && !erro && <p className="texto-suave">{traduzir("Carregando…", "Loading…")}</p>}
      {orgs !== null && orgs.length === 0 && <p className="texto-suave">{traduzir("Nenhuma organização criada ainda.", "No organizations created yet.")}</p>}
      {orgs !== null && orgs.length > 0 && (() => {
        const termo = busca.trim().toLowerCase()
        const filtradas = termo
          ? orgs.filter(
              (o) => o.nome.toLowerCase().includes(termo) || o.slug.toLowerCase().includes(termo),
            )
          : orgs
        const POR_PAGINA = 10
        const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA))
        const paginaAtual = Math.min(pagina, paginas - 1)
        const visiveis = filtradas.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA)
        return (
        <>
        <div className="linha-conceder admin-filtro">
          <input
            type="search"
            value={busca}
            placeholder={traduzir("Filtrar por nome ou slug…", "Filter by name or slug…")}
            aria-label={traduzir("Filtrar organizações", "Filter organizations")}
            onChange={(e) => { setBusca(e.target.value); setPagina(0) }}
          />
          {busca && (
            <button type="button" className="botao-texto" onClick={() => { setBusca(''); setPagina(0) }}>
              {traduzir("limpar", "clear")}
            </button>
          )}
          <span className="texto-suave">
            {traduzir(`${filtradas.length} de ${orgs.length} organização(ões)`, `${filtradas.length} of ${orgs.length} organization(s)`)}
          </span>
        </div>
        <div className="tabela-scroll">
          <table className="tabela admin-clientes-tabela">
            <thead>
              <tr>
                <th>{traduzir('Cliente', 'Client')}</th>
                <th>Status</th>
                <th>{traduzir("Pessoas", "People")}</th>
                <th>IA</th>
                <th>{traduzir("Escritórios", "Offices")}</th>
                <th>{traduzir("Conceder", "Grant access")}</th>
                <th>{traduzir("Ações", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((org) => {
                const concedidos = slugsConcedidos(org)
                return (
                  <tr key={org.id}>
                    <td data-label={traduzir('Cliente', 'Client')}><span><strong>{org.nome}</strong><small className="texto-suave admin-cliente-endereco">{org.slug}</small></span></td>
                    <td data-label="Status">
                      {(org.status ?? 'ativa') === 'suspensa' ? (
                        <strong title={traduzir("Nenhuma tarefa nova é aceita; a fila está parada.", "No new tasks are accepted; the queue is paused.")}>
                          <Icone nome="pausa" tamanho={15} /> {traduzir("suspensa", "suspended")}
                        </strong>
                      ) : (
                        <span>{traduzir("ativa", "active")}</span>
                      )}
                    </td>
                    <td data-label={traduzir('Pessoas', 'People')}>
                      {/* Estes números já vinham no GET /admin/orgs e a tela os
                          jogava fora — o operador não enxergava por que uma org
                          "cheia" tinha menos gente que assentos. */}
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={() => mudarAssentos(org)}
                        disabled={ocupados.has(org.id)}
                        title={traduzir("Mudar os assentos vendidos", "Change purchased seats")}
                      >
                        {org.membros ?? 0}/{org.assentos ?? '—'}
                      </button>
                      {(org.quarentena ?? 0) > 0 && (
                        <span
                          className="texto-suave"
                          title={traduzir("Assentos presos por quarentena (membros removidos há menos de 30 dias)", "Seats in quarantine (members removed less than 30 days ago)")}
                        >
                          {' '}
                          +{org.quarentena} <Icone nome="cadeado" tamanho={15} />
                        </span>
                      )}
                    </td>
                    <td data-label="IA">
                      {org.motor_modo === 'cli' ? <span title={traduzir('Cada pessoa conecta sua conta de IA no aplicativo.', 'Each person connects their AI account in the app.')}>{traduzir('App local', 'Local app')}</span> : org.tem_api_key ? (
                        <span title={traduzir('Chave da empresa configurada', 'Company API key configured')}>
                          {/* `titulo=` porque o 🔑 que estava aqui ERA lido pelo
                              leitor de tela; sem ele a célula fica muda (o
                              title do <span> não vira nome acessível). */}
                          <Icone nome="chave" tamanho={15} titulo={traduzir("Chave configurada", "Key configured")} />
                        </span>
                      ) : (
                        <span
                          className="texto-suave"
                          title={traduzir('Conecte uma chave para usar a IA pela API.', 'Connect an API key to use AI through the API.')}
                        >
                          {traduzir("— sem chave", "— no key")}
                        </span>
                      )}
                    </td>
                    <td data-label={traduzir('Escritórios', 'Offices')}>
                      {concedidos.length === 0 && <span className="texto-suave">—</span>}
                      <span className="chips-offices">
                        {concedidos.map((s) => (
                          <span key={s} className="chip-office">
                            {offices.find(o => o.slug === s)?.nome || s}
                            <button
                              type="button"
                              aria-label={traduzir(`Remover ${s}`, `Remove ${s}`)}
                              onClick={() => revogar(org, s)}
                              disabled={ocupados.has(org.id)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </span>
                    </td>
                    <td data-label={traduzir('Liberar escritório', 'Grant office')}>
                      {/* COMPACTO de novo (pedido do dono, 07/08/2026): a
                          lista de todos os concedíveis por linha fazia cada
                          org ocupar uma tela. O placeholder diz QUANTOS há —
                          o problema da versão antiga era o menu parecer ter
                          um item só, não o menu em si. */}
                      {(() => {
                        const livres = offices.filter((o) => !o.arquivado && !concedidos.includes(o.slug))
                        if (livres.length === 0) {
                          return <span className="texto-suave">{traduzir("todos concedidos", "all granted")}</span>
                        }
                        const escolhido = concederSel[org.id] ?? ''
                        const sel = livres.some(o => o.slug === escolhido) ? escolhido : ''
                        return (
                          <span className="linha-conceder">
                            <select
                              value={sel}
                              disabled={ocupados.has(org.id)}
                              aria-label={traduzir(`Escritório a conceder a ${org.nome}`, `Office to grant to ${org.nome}`)}
                              onChange={(e) =>
                                setConcederSel((prev) => ({ ...prev, [org.id]: e.target.value }))
                              }
                            >
                              <option value="">{traduzir(`${livres.length} disponíveis…`, `${livres.length} available…`)}</option>
                              {agruparOffices(livres).map(grupo => (
                                <optgroup key={grupo.id} label={`${nomeArea(grupo.id, traduzir)}${grupo.offices.every(o => o.vendavel === false) ? traduzir(' (interno e parceiros)', ' (internal and collaborators)') : ''}`}>
                                  {grupo.offices.map(o => <option key={o.slug} value={o.slug}>{nomeModulo(o, traduzir)}</option>)}
                                </optgroup>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="botao botao-fantasma botao-pequeno"
                              disabled={!sel || ocupados.has(org.id)}
                              onClick={() => conceder(org, sel)}
                            >
                              {traduzir("Conceder", "Grant access")}
                            </button>
                          </span>
                        )
                      })()}
                    </td>
                    <td data-label={traduzir('Ações', 'Actions')}>
                      <details className="admin-cliente-acoes">
                        <summary>{traduzir('Gerenciar', 'Manage')}</summary>
                      <div className="linha-conceder">
                        <button
                          type="button"
                          className="botao botao-fantasma botao-pequeno"
                          onClick={() => alternarStatus(org)}
                          disabled={ocupados.has(org.id)}
                        >
                          {(org.status ?? 'ativa') === 'ativa' ? traduzir("Suspender", "Suspend") : traduzir("Reativar", "Reactivate")}
                        </button>
                        <button
                          type="button"
                          className="botao botao-fantasma botao-pequeno"
                          onClick={() => setOrgAcesso(org)}
                          disabled={ocupados.has(org.id)}
                          title={traduzir("Gera o link em que a pessoa cria a própria senha e entra nesta organização", "Generate a link to create a password and join this organization")}
                        >
                          <Icone nome="chave" tamanho={15} />
                          {traduzir("Link de acesso", "Access link")}
                        </button>
                        <button
                          type="button"
                          className="botao botao-fantasma botao-pequeno"
                          onClick={() => alternarResidencia(org)}
                          disabled={ocupados.has(org.id)}
                          title={
                            org.autorizada_banco_central === false
                              ? traduzir(`Exige banco próprio${org.byod_ok ? ' (configurado ✓)' : ' — SEM banco: travada!'}`, `Own database required${org.byod_ok ? ' (configured ✓)' : ' — NO database: blocked!'}`)
                              : traduzir("Usa o banco central do Offiz (padrão)", "Uses the central Offiz database (default)")
                          }
                        >
                          {org.autorizada_banco_central === false
                            ? org.byod_ok
                              ? traduzir("🗄️ banco próprio ✓", "🗄️ own database ✓")
                              : traduzir("🗄️ banco próprio ⚠", "🗄️ own database ⚠")
                            : traduzir("🗄️ central", "🗄️ central")}
                        </button>
                        <button
                          type="button"
                          className="botao botao-fantasma botao-pequeno"
                          onClick={() => abrirExclusao(org)}
                          disabled={ocupados.has(org.id)}
                          title={traduzir("Apaga tudo da organização — sem desfazer", "Delete all organization data — cannot be undone")}
                        >
                          {traduzir("Excluir", "Delete")}
                        </button>
                      </div>
                      </details>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {paginas > 1 && (
          <div className="linha-conceder admin-paginacao">
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              disabled={paginaAtual === 0}
              onClick={() => setPagina(paginaAtual - 1)}
            >
              {traduzir("← anteriores", "← previous")}
            </button>
            <span className="texto-suave">
              {traduzir(`página ${paginaAtual + 1} de ${paginas}`, `page ${paginaAtual + 1} of ${paginas}`)}
            </span>
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              disabled={paginaAtual >= paginas - 1}
              onClick={() => setPagina(paginaAtual + 1)}
            >
              {traduzir("próximas →", "next →")}
            </button>
          </div>
        )}
        </>
        )
      })()}
      {ativo && orgAcesso && <DialogoLinkAcesso destino={orgAcesso} aoFechar={() => setOrgAcesso(null)} aoGerar={aoMudar} />}
      {ativo && orgExcluir && (
        <dialog
          ref={exclusaoDialogRef}
          className="conta-dialogo admin-exclusao-dialogo"
          aria-label={traduzir('Excluir organização', 'Delete organization')}
          aria-describedby="admin-exclusao-aviso"
          onCancel={e => { e.preventDefault(); if (!exclusaoEmCurso.current) setOrgExcluir(null) }}
        >
          <form onSubmit={excluir} aria-busy={excluindo}>
            <h2 className="secao-titulo">{traduzir('Excluir organização', 'Delete organization')}</h2>
            <p><strong>{orgExcluir.nome}</strong></p>
            <p id="admin-exclusao-aviso">{traduzir('Isto apaga tarefas, entregas, conversas, chaves e todos os arquivos desta organização. Não há desfazer.', 'This deletes tasks, deliverables, conversations, keys and all files in this organization. This cannot be undone.')}</p>
            <p>{traduzir('Identificador:', 'Identifier:')} <code>{orgExcluir.slug}</code></p>
            <div className="campo">
              <label htmlFor="admin-exclusao-confirmacao">{traduzir('Digite o identificador para confirmar', 'Type the identifier to confirm')}</label>
              <input
                id="admin-exclusao-confirmacao"
                value={confirmacaoExclusao}
                onChange={e => setConfirmacaoExclusao(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={excluindo}
                autoFocus
              />
            </div>
            {erroExclusao && <p className="alerta alerta-erro" role="alert">{erroExclusao}</p>}
            <div className="linha-conceder admin-exclusao-acoes">
              <button type="button" className="botao botao-fantasma" disabled={excluindo} onClick={() => setOrgExcluir(null)}>{traduzir('Cancelar', 'Cancel')}</button>
              <button type="submit" className="botao botao-perigo" disabled={excluindo || confirmacaoExclusao !== orgExcluir.slug}>
                {excluindo ? traduzir('Excluindo…', 'Deleting…') : traduzir('Excluir definitivamente', 'Delete permanently')}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </section>
  )
}

/** Rótulos em português das ações — o slug do banco não é para o operador ler. */
const acoesRotulos = (traduzir: Traduzir): Record<string, string> => ({
  org_criada: traduzir("Organização criada", "Organization created"),
  org_excluida: traduzir("Organização excluída", "Organization deleted"),
  org_status: traduzir("Status alterado", "Status changed"),
  office_concedido: traduzir("Escritório concedido", "Office granted"),
  office_revogado: traduzir("Escritório revogado", "Office revoked"),
  assentos_alterados: traduzir("Assentos alterados", "Seat limit changed"),
  quarentena_liberada: traduzir("Quarentena liberada", "Quarantine released"),
  office_pacote_criado: traduzir("Escritório criado no catálogo", "Office created in catalog"),
  office_pacote_atualizado: traduzir("Escritório atualizado no catálogo", "Office updated in catalog"),
  office_pacote_excluido: traduzir("Escritório removido do catálogo", "Office removed from catalog"),
  senha_reset: traduzir("Senha redefinida", "Password reset"),
})

function SecaoAuditoria({ recarregar }: { recarregar: number }) {
  const { t: traduzir, idioma } = useIdioma()
  const ROTULO_ACAO = acoesRotulos(traduzir)
  const [eventos, setEventos] = useState<EventoAdmin[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pagina, setPagina] = useState(0)

  useEffect(() => {
    // 200 é o TETO da tela (o endpoint aceita até 500) — paginação de 10 em
    // cima disso; trilha mais funda que 200 ações é caso de consulta ao banco.
    api
      .get<unknown>('/admin/auditoria?limite=200')
      .then((d) => setEventos(asList<EventoAdmin>(d, 'eventos')))
      .catch((e) => setErro(e instanceof ApiError ? e.detail : traduzir("Não foi possível ler a trilha.", "Could not load the audit trail.")))
  }, [recarregar, traduzir])

  return (
    <section className="cartao">
      <h2 className="secao-titulo">{traduzir("Trilha de ações", "Audit trail")}</h2>
      <p className="texto-suave">
        {traduzir("Quem concedeu, revogou, suspendeu ou excluiu — e quando. Responde desde quando este cliente tem este escritório, inclusive quando o acesso foi concedido novamente.", "Who granted, revoked, suspended or deleted access, and when. This shows how long a client has had an office, including when access was granted again.")}
      </p>
      {erro && <p className="alerta alerta-erro">{erro}</p>}
      {eventos === null && !erro && <p className="texto-suave">{traduzir("Carregando…", "Loading…")}</p>}
      {eventos !== null && eventos.length === 0 && (
        <p className="texto-suave">{traduzir("Nenhuma ação registrada ainda.", "No actions recorded yet.")}</p>
      )}
      {eventos !== null && eventos.length > 0 && (() => {
        const POR_PAGINA = 10
        const paginas = Math.max(1, Math.ceil(eventos.length / POR_PAGINA))
        const paginaAtual = Math.min(pagina, paginas - 1)
        const visiveis = eventos.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA)
        return (
        <>
        <div className="tabela-scroll">
          <table className="tabela">
            <thead>
              <tr>
                <th>{traduzir("Quando", "When")}</th>
                <th>{traduzir("Quem", "Who")}</th>
                <th>{traduzir("O quê", "What")}</th>
                <th>{traduzir("Organização", "Organization")}</th>
                <th>{traduzir("Alvo", "Target")}</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((e) => (
                <tr key={e.id}>
                  <td title={e.criado_em ?? ''}>
                    {e.criado_em ? formatDataHora(e.criado_em, idioma) : '—'}
                  </td>
                  <td>{e.ator_email}</td>
                  <td>{ROTULO_ACAO[e.acao] ?? e.acao}</td>
                  <td>
                    <code>{e.org_slug ?? '—'}</code>
                    {e.organization_id === null && e.org_slug && (
                      <span className="texto-suave" title={traduzir("A organização já não existe", "This organization no longer exists")}>
                        {' '}
                        {traduzir("(excluída)", "(deleted)")}
                      </span>
                    )}
                  </td>
                  <td>
                    {e.alvo ?? '—'}
                    {e.detalhe?.reconcessao === true && (
                      <span className="texto-suave"> {traduzir("(reconcessão)", "(granted again)")}</span>
                    )}
                    {typeof e.detalhe?.motivo === 'string' && e.detalhe.motivo && (
                      <span className="texto-suave"> — {e.detalhe.motivo}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {paginas > 1 && (
          <div className="linha-conceder admin-paginacao">
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              disabled={paginaAtual === 0}
              onClick={() => setPagina(paginaAtual - 1)}
            >
              {traduzir("← anteriores", "← previous")}
            </button>
            <span className="texto-suave">
              {traduzir(`página ${paginaAtual + 1} de ${paginas} (últimas ${eventos.length} ações)`, `page ${paginaAtual + 1} of ${paginas} (last ${eventos.length} actions)`)}
            </span>
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              disabled={paginaAtual >= paginas - 1}
              onClick={() => setPagina(paginaAtual + 1)}
            >
              {traduzir("próximas →", "next →")}
            </button>
          </div>
        )}
        </>
        )
      })()}
    </section>
  )
}

/** Link de redefinição de senha (POST /admin/usuarios/{id}/reset-senha). */
interface ResetSenhaLink {
  email: string
  nome: string
  link: string
  email_enviado: boolean
  expira_em_horas: number
}

/** Usuário como o /admin/usuarios devolve — com as orgs de cada um. */
type UsuarioAdmin = Usuario & {
  orgs?: Array<{ id: number; nome: string; role: string }>
  // Quem o backend RECUSA excluir (a própria conta logada, contas de
  // ADMIN_EMAILS). Vem do servidor para a tela não oferecer o que a API nega.
  pode_excluir?: boolean
  motivo_protecao?: string | null
}

const papeisRotulos = (traduzir: Traduzir): Record<string, string> => ({ owner: traduzir('dono', 'owner'), admin: 'admin', member: traduzir('membro', 'member') })

function SecaoUsuarios({ ativo, revisao }: { ativo: boolean; revisao: number }) {
  const { t: traduzir } = useIdioma()
  const { sucesso, falha } = useToasts()
  const { confirmar, solicitarTexto, dialogo } = useConfirmacao(`${getSessionIdentity()}:usuarios:${ativo}`)
  const { iniciar, ocupados } = useOperacoesAdmin()
  const ROTULO_ROLE = papeisRotulos(traduzir)
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(0)
  // O link fica na tela até o operador fechar: é de USO ÚNICO e o token não
  // é recuperável (o banco guarda só o hash) — sumir com toast seria perdê-lo.
  const [reset, setReset] = useState<ResetSenhaLink | null>(null)
  const resetCampo = useRef<HTMLInputElement>(null)
  const [copiando, setCopiando] = useState(false)
  const copiaEmCurso = useRef(false)
  const secaoAtiva = useRef(ativo)
  secaoAtiva.current = ativo
  const leitura = useRef({ id: 0, controle: null as AbortController | null })
  const invalidarLeitura = useCallback(() => {
    leitura.current.controle?.abort()
    leitura.current = { id: leitura.current.id + 1, controle: null }
  }, [])

  // Extraída do efeito porque o 404 de uma conta já apagada recarrega a lista
  // (a tela fica aberta muito tempo no suporte — o desencontro é normal).
  const recarregar = useCallback(() => {
    if (!ativo) return
    invalidarLeitura()
    const id = leitura.current.id
    const controle = new AbortController()
    leitura.current.controle = controle
    setErro(null)
    api
      .get<unknown>('/admin/usuarios', controle.signal)
      .then((d) => { if (!controle.signal.aborted && id === leitura.current.id) setUsuarios(asList<UsuarioAdmin>(d, 'usuarios')) })
      .catch((e) => {
        if (!controle.signal.aborted && id === leitura.current.id) setErro(e instanceof ApiError ? e.detail : traduzir("Não foi possível listar os usuários.", "Could not list users."))
      })
  }, [traduzir, ativo, invalidarLeitura])

  useEffect(() => {
    recarregar()
    return invalidarLeitura
  }, [recarregar, revisao, invalidarLeitura])

  async function excluirUsuario(u: UsuarioAdmin) {
    // Mesma proteção do excluir organização: digitar o e-mail de volta. É a
    // conta INTEIRA — memberships e conversas morrem junto; o histórico
    // (tarefas, entregas, trilha) sobrevive sem autor.
    if (u.pode_excluir === false || ocupados.has(u.id)) return
    const digitado = await solicitarTexto({ titulo: traduzir('Excluir conta de usuário', 'Delete user account'),
      mensagem: traduzir(`EXCLUIR a conta de ${u.nome}?\n\nSome o acesso, as participações em organizações e as conversas. Tarefas e entregas já feitas ficam (sem autor). Não há desfazer.\n\nDigite o e-mail “${u.email}” para confirmar:`, `DELETE ${u.nome}’s account?\n\nAccess, organization memberships and conversations will be removed. Existing tasks and deliverables remain without an author. This cannot be undone.\n\nType the email “${u.email}” to confirm:`),
      rotulo: traduzir('E-mail para confirmar a exclusão', 'Email to confirm deletion'), maxLength: 254,
      acao: traduzir('Excluir conta', 'Delete account'),
      validar: valor => valor.toLowerCase() === u.email.toLowerCase() ? null : traduzir('E-mail não confere — nada foi excluído.', 'The email does not match. Nothing was deleted.'),
    })
    if (digitado === null) return
    if (digitado.trim().toLowerCase() !== u.email.toLowerCase()) {
      falha(traduzir("E-mail não confere — nada foi excluído.", "The email does not match. Nothing was deleted."))
      return
    }
    const operacao = iniciar(u.id)
    if (!operacao) return
    try {
      const r = await api.del<{ orgs_sem_dono?: number[]; limpeza_anexos_pendente?: boolean }>(`/admin/usuarios/${u.id}`)
      if (!operacao.ativa()) return
      invalidarLeitura()
      if (r?.limpeza_anexos_pendente) falha(traduzir('Conta excluída. A limpeza dos anexos privados ficou pendente; solicite a verificação do armazenamento.', 'Account deleted. Private attachment cleanup is pending; request a storage check.'))
      const semDono = r?.orgs_sem_dono?.length ?? 0
      sucesso(
        semDono > 0
          ? traduzir(`Conta de ${u.email} excluída. ${semDono} organização(ões) ficaram SEM dono — gere um link de acesso de owner.`, `Account ${u.email} deleted. ${semDono} organization(s) now have NO owner. Generate an owner access link.`)
          : traduzir(`Conta de ${u.email} excluída.`, `Account ${u.email} deleted.`),
      )
      setUsuarios((prev) => (prev ?? []).filter((x) => x.id !== u.id))
    } catch (e) {
      if (!operacao.ativa()) return
      // 404 = a conta já não existe (lista aberta há tempo, ou apagada em
      // outra aba). O erro cru ("Usuário não encontrado") faz o operador achar
      // que o botão está quebrado — então explicamos e recarregamos a lista,
      // que é o que ele faria na mão.
      if (e instanceof ApiError && e.status === 404) {
        falha(traduzir("Esta conta já não existe — a lista estava desatualizada. Recarreguei.", "This account no longer exists. The outdated list has been refreshed."))
        recarregar()
        return
      }
      falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível excluir a conta.", "Could not delete the account."))
    } finally { operacao.finalizar() }
  }

  /** Troca o e-mail de LOGIN de uma conta.
   *
   *  Fica no admin global, e não na tela do prédio, de propósito: se o dono de
   *  um prédio pudesse trocar o e-mail de um membro, bastaria apontá-lo para o
   *  próprio endereço e pedir redefinição de senha para ficar com a conta.
   *
   *  A confirmação diz as duas coisas que surpreendem: a pessoa passa a entrar
   *  com o endereço NOVO (a senha continua a mesma), e se o antigo estava em
   *  ADMIN_EMAILS ela perde o admin JÁ na próxima ação — o guard compara com a
   *  variável de ambiente em cada chamada, e a variável não se ajusta sozinha.
   *  Trocar o próprio e-mail aqui te tranca do lado de fora do admin. */
  async function trocarEmail(u: UsuarioAdmin) {
    if (ocupados.has(u.id)) return
    const novo = await solicitarTexto({ titulo: traduzir('Trocar e-mail de login', 'Change sign-in email'),
      mensagem: [
        traduzir(`Novo e-mail de login para ${u.nome || u.email}?`, `New sign-in email for ${u.nome || u.email}?`),
        traduzir("A pessoa passa a entrar com este endereço; a senha continua a mesma.", "The person will sign in with this address; their password stays the same."),
        traduzir('ATENÇÃO: se o e-mail atual estiver em ADMIN_EMAILS, esta conta perde o admin global IMEDIATAMENTE (a lista fica no ambiente do servidor, não no banco). Se for a SUA conta, você se tranca do lado de fora do admin.', 'WARNING: if the current email is in ADMIN_EMAILS, this account immediately loses global admin access. The list is in the server environment, not the database. If this is YOUR account, you will be locked out of administration.'),
      ].join('\n\n'),
      rotulo: traduzir('Novo e-mail de login', 'New sign-in email'), tipo: 'email', valorInicial: u.email, maxLength: 254,
      acao: traduzir('Salvar e-mail', 'Save email'),
    })
    if (novo === null) return
    const email = novo.trim().toLowerCase()
    if (!email || email === u.email.toLowerCase()) return
    const operacao = iniciar(u.id)
    if (!operacao) return
    try {
      const r = await api.put<{ email: string; era_admin_global?: boolean }>(
        `/admin/usuarios/${u.id}/email`,
        { email },
      )
      if (!operacao.ativa()) return
      invalidarLeitura()
      sucesso(
        r.era_admin_global
          ? traduzir(`E-mail alterado para ${r.email}. O endereço antigo era admin global — ajuste ADMIN_EMAILS no ambiente AGORA, senão esta conta não entra mais no admin.`, `Email changed to ${r.email}. The old address was a global admin. Update ADMIN_EMAILS in the environment now or this account will lose admin access.`)
          : traduzir(`E-mail alterado para ${r.email}.`, `Email changed to ${r.email}.`),
      )
      setUsuarios((prev) =>
        (prev ?? []).map((x) => (x.id === u.id ? { ...x, email: r.email } : x)),
      )
    } catch (e) {
      if (!operacao.ativa()) return
      if (e instanceof ApiError && e.status === 404) {
        falha(traduzir("Esta conta já não existe — a lista estava desatualizada. Recarreguei.", "This account no longer exists. The outdated list has been refreshed."))
        recarregar()
        return
      }
      falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível trocar o e-mail.", "Could not change the email address."))
    } finally { operacao.finalizar() }
  }

  async function redefinir(u: Usuario) {
    if (ocupados.has(u.id)) return
    if (!await confirmar({ titulo: traduzir('Gerar link de redefinição', 'Generate password reset link'),
      mensagem: traduzir(`Gerar link de redefinição de senha para ${u.email}?\n\nO link serve UMA vez, vale 24h e invalida qualquer link anterior desta pessoa. Você não vê a senha — quem escolhe é ela.`, `Generate a password reset link for ${u.email}?\n\nIt can be used ONCE, is valid for 24 hours and invalidates previous links for this person. They choose their password; you never see it.`),
      acao: traduzir('Gerar link', 'Generate link') })) return
    const operacao = iniciar(u.id)
    if (!operacao) return
    try {
      const r = await api.post<ResetSenhaLink>(`/admin/usuarios/${u.id}/reset-senha`)
      if (!operacao.ativa()) return
      setReset(r)
      sucesso(traduzir("Link de redefinição gerado.", "Password reset link generated."))
    } catch (e) {
      if (!operacao.ativa()) return
      // Mesma história do excluir: 404 aqui é lista velha, não bug do botão.
      if (e instanceof ApiError && e.status === 404) {
        falha(traduzir("Esta conta já não existe — a lista estava desatualizada. Recarreguei.", "This account no longer exists. The outdated list has been refreshed."))
        recarregar()
        return
      }
      falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível gerar o link.", "Could not generate the link."))
    } finally { operacao.finalizar() }
  }

  return (
    <section className="cartao">
      <h2 className="secao-titulo">{traduzir("Usuários", "Users")}</h2>
      {dialogo}
      {erro && <div className="alerta alerta-erro" role="alert"><p>{erro}</p>
        <button type="button" className="botao botao-fantasma" onClick={recarregar}>{traduzir('Tentar novamente', 'Try again')}</button>
      </div>}
      {reset && (
        <div className="alerta alerta-aviso" role="status">
          <p>
            <strong>{traduzir(`Redefinição de senha de ${reset.email}`, `Password reset for ${reset.email}`)}</strong>
            <br />{traduzir("A pessoa abre o link e escolhe a senha dela — você não vê e não precisa saber.", "The person opens the link and chooses their own password. You do not see it or need to know it.")}
            {reset.email_enviado
              ? traduzir(" Também enviamos por e-mail.", " We also sent it by email.")
              : traduzir(" O e-mail não saiu — mande o link por outro canal.", " The email was not sent. Share the link through another channel.")}
          </p>
          <p>
            <input
              ref={resetCampo}
              type="text"
              readOnly
              aria-label={traduzir('Link de redefinição de senha', 'Password reset link')}
              value={reset.link}
              onFocus={(e) => e.currentTarget.select()}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
            />
          </p>
          <span className="linha-conceder">
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              disabled={copiando}
              onClick={async () => {
                if (copiaEmCurso.current) return
                const sessao = getSessionIdentity()
                copiaEmCurso.current = true
                setCopiando(true)
                try {
                  if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
                  await navigator.clipboard.writeText(reset.link)
                  if (secaoAtiva.current && getSessionIdentity() === sessao && resetCampo.current?.value === reset.link) sucesso(traduzir("Link copiado.", "Link copied."))
                } catch {
                  if (secaoAtiva.current && getSessionIdentity() === sessao && resetCampo.current?.value === reset.link) {
                    resetCampo.current.focus(); resetCampo.current.select()
                    falha(traduzir('Não foi possível copiar. O link continua disponível; copie manualmente.', 'Could not copy. The link is still available; copy it manually.'))
                  }
                } finally {
                  copiaEmCurso.current = false
                  if (getSessionIdentity() === sessao && resetCampo.current) setCopiando(false)
                }
              }}
            >
              {copiando ? traduzir('Copiando…', 'Copying…') : traduzir("Copiar link", "Copy link")}
            </button>
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              onClick={() => setReset(null)}
              disabled={copiando}
            >
              {traduzir("Já copiei, pode fechar", "Copied — close this")}
            </button>
          </span>
          <p className="texto-suave">
            {traduzir(`Vale ${reset.expira_em_horas}h e serve uma vez só — depois de usado, o mesmo link não abre de novo.`, `Valid for ${reset.expira_em_horas} hours and can be used only once.`)}
          </p>
        </div>
      )}
      {usuarios === null && !erro && <p className="texto-suave">{traduzir("Carregando…", "Loading…")}</p>}
      {usuarios !== null && (() => {
        const termo = busca.trim().toLowerCase()
        const filtrados = termo
          ? usuarios.filter(
              (u) =>
                u.nome.toLowerCase().includes(termo) ||
                u.email.toLowerCase().includes(termo) ||
                (u.orgs ?? []).some((o) => o.nome.toLowerCase().includes(termo)),
            )
          : usuarios
        const POR_PAGINA = 10
        const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
        const paginaAtual = Math.min(pagina, paginas - 1)
        const visiveis = filtrados.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA)
        return (
        <>
        <div className="linha-conceder admin-filtro">
          <input
            type="search"
            value={busca}
            placeholder={traduzir("Filtrar por nome, e-mail ou organização…", "Filter by name, email or organization…")}
            aria-label={traduzir("Filtrar usuários", "Filter users")}
            onChange={(e) => { setBusca(e.target.value); setPagina(0) }}
          />
          {busca && (
            <button type="button" className="botao-texto" onClick={() => { setBusca(''); setPagina(0) }}>
              {traduzir("limpar", "clear")}
            </button>
          )}
          <span className="texto-suave">{traduzir(`${filtrados.length} de ${usuarios.length} usuário(s)`, `${filtrados.length} of ${usuarios.length} user(s)`)}</span>
        </div>
        <div className="tabela-scroll">
          <table className="tabela">
            <thead>
              <tr>
                <th>{traduzir("Nome", "Name")}</th>
                <th>E-mail</th>
                <th>{traduzir("Organizações", "Organizations")}</th>
                <th>{traduzir("Ações", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((u) => (
                <tr key={u.id}>
                  <td>{u.nome}</td>
                  <td>{u.email}</td>
                  <td>
                    {(u.orgs ?? []).length === 0 && <span className="texto-suave">—</span>}
                    <span className="chips-offices">
                      {(u.orgs ?? []).map((o) => (
                        <span
                          key={o.id}
                          className="chip-office"
                          title={`${o.nome} — ${ROTULO_ROLE[o.role] ?? o.role}`}
                        >
                          {o.nome}
                          {o.role !== 'member' && (
                            <em className="texto-suave"> · {ROTULO_ROLE[o.role] ?? o.role}</em>
                          )}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>
                    <span className="linha-conceder">
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={() => redefinir(u)}
                        disabled={ocupados.has(u.id)}
                        title={traduzir("Gera um link de uso único para a pessoa criar uma senha nova", "Generate a one-time link to create a new password")}
                      >
                        <Icone nome="cadeado" tamanho={15} />
                        {traduzir("Redefinir senha", "Reset password")}
                      </button>
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={() => trocarEmail(u)}
                        disabled={ocupados.has(u.id)}
                        title={traduzir("Troca o e-mail de LOGIN desta conta", "Change the sign-in email for this account")}
                      >
                        <Icone nome="email" tamanho={15} />
                        {traduzir("Trocar e-mail", "Change email")}
                      </button>
                      {u.pode_excluir === false ? (
                        // Protegida pelo servidor (própria conta / ADMIN_EMAILS):
                        // mostrar o porquê em vez de um botão que só falharia.
                        <span className="admin-conta-protegida" title={u.motivo_protecao ?? ''}>
                          <Icone nome="cadeado" tamanho={14} />
                          {traduzir("protegida", "protected")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="botao botao-fantasma botao-pequeno"
                          onClick={() => excluirUsuario(u)}
                          disabled={ocupados.has(u.id)}
                          title={traduzir("Exclui a conta — sem desfazer", "Delete this account — cannot be undone")}
                        >
                          {traduzir("Excluir", "Delete")}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {paginas > 1 && (
          <div className="linha-conceder admin-paginacao">
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              disabled={paginaAtual === 0}
              onClick={() => setPagina(paginaAtual - 1)}
            >
              {traduzir("← anteriores", "← previous")}
            </button>
            <span className="texto-suave">{traduzir(`página ${paginaAtual + 1} de ${paginas}`, `page ${paginaAtual + 1} of ${paginas}`)}</span>
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              disabled={paginaAtual >= paginas - 1}
              onClick={() => setPagina(paginaAtual + 1)}
            >
              {traduzir("próximas →", "next →")}
            </button>
          </div>
        )}
        </>
        )
      })()}
    </section>
  )
}

export default function AdminPage() {
  return <AdminConteudo key={getSessionIdentity() ?? 'sem-sessao'} />
}

function AdminConteudo() {
  const { t: traduzir, idioma } = useIdioma()
  const [orgs, setOrgs] = useState<OrgResumo[] | null>(null)
  const [erroOrgs, setErroOrgs] = useState<string | null>(null)
  const [carregandoOrgs, setCarregandoOrgs] = useState(false)
  const [offices, setOffices] = useState<OfficeInfo[]>([])
  const [erroOffices, setErroOffices] = useState<string | null>(null)
  const [aba, setAba] = useState<'clientes' | 'usuarios' | 'operacao' | 'contratos'>('clientes')
  const [novoAberto, setNovoAberto] = useState(false)
  // Toda ação sobre organização também mexe na trilha — este contador manda a
  // seção de auditoria recarregar junto, senão ela mostraria o passado.
  const [versao, setVersao] = useState(0)
  const leituraOrgs = useRef({ id: 0, controle: null as AbortController | null })
  const leituraOffices = useRef({ id: 0, controle: null as AbortController | null })

  const carregarOrgs = useCallback(async () => {
    leituraOrgs.current.controle?.abort()
    const controle = new AbortController()
    const id = leituraOrgs.current.id + 1
    leituraOrgs.current = { id, controle }
    setCarregandoOrgs(true)
    setErroOrgs(null)
    try {
      const data = await api.get<unknown>('/admin/orgs', controle.signal)
      if (controle.signal.aborted || id !== leituraOrgs.current.id) return
      setOrgs(asList<OrgResumo>(data, 'orgs', 'organizations'))
      setErroOrgs(null)
    } catch (e) {
      if (controle.signal.aborted || id !== leituraOrgs.current.id) return
      setErroOrgs(e instanceof ApiError ? e.detail : traduzir("Não foi possível listar as organizações.", "Could not list organizations."))
    }
    setCarregandoOrgs(false)
    setVersao((v) => v + 1)
  }, [traduzir])

  const carregarOffices = useCallback(async () => {
    leituraOffices.current.controle?.abort()
    const controle = new AbortController()
    const id = leituraOffices.current.id + 1
    leituraOffices.current = { id, controle }
    setErroOffices(null)
    try {
      const data = await api.get<unknown>('/offices', controle.signal)
      if (!controle.signal.aborted && id === leituraOffices.current.id) setOffices(asList<OfficeInfo>(data, 'offices'))
    } catch {
      if (!controle.signal.aborted && id === leituraOffices.current.id) setErroOffices(traduzir('Não foi possível carregar as áreas disponíveis. Tente novamente antes de conceder novos acessos.', 'Could not load available areas. Try again before granting new access.'))
    }
  }, [traduzir])

  useEffect(() => {
    carregarOrgs()
    return () => { leituraOrgs.current.controle?.abort() }
  }, [carregarOrgs])
  useEffect(() => {
    carregarOffices()
    return () => { leituraOffices.current.controle?.abort() }
  }, [carregarOffices])

  const officesOrdenados = useMemo(
    () => [...offices].sort((a, b) => (a.nome || a.slug).localeCompare(b.nome || b.slug, idioma)),
    [offices, idioma],
  )

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <h1>{traduzir("Administração", "Administration")}</h1>
          <p className="pagina-sub">{traduzir('Gerencie seus clientes, prepare demos e cuide dos acessos.', 'Manage clients, prepare demos, and manage access.')}</p>
        </div>
        <button type="button" className="botao botao-primario" onClick={() => { setAba('clientes'); setNovoAberto(v => aba === 'clientes' ? !v : true) }}>{novoAberto && aba === 'clientes' ? traduzir('Fechar cadastro', 'Close form') : traduzir('Novo cliente', 'New client')}</button>
      </div>
      <nav className="config-categorias" aria-label={traduzir('Gestão dos clientes', 'Client management')}>
        {(['clientes', 'usuarios', 'contratos', 'operacao'] as const).map(id => <button key={id} type="button" aria-pressed={aba === id} onClick={() => setAba(id)}>{id === 'clientes' ? traduzir('Clientes e demos', 'Clients and demos') : id === 'usuarios' ? traduzir('Pessoas e acessos', 'People and access') : id === 'contratos' ? traduzir('Contratos e IA', 'Contracts and AI') : traduzir('Operação e histórico', 'Operations and history')}</button>)}
      </nav>
      <div className="config-grid" style={{ display: aba === 'clientes' ? undefined : 'none' }}>
        {erroOffices && <div className="alerta alerta-erro" role="alert"><p>{erroOffices}</p>
          <button type="button" className="botao botao-fantasma" onClick={carregarOffices}>{traduzir('Tentar novamente', 'Try again')}</button>
        </div>}
        {/* SÓ GESTÃO (decisão do dono, 07/08/2026): visão geral, organizações,
            criar organização, usuários e a trilha. Todo o trabalho de
            ESCRITÓRIO (tarefas, manifesto, criar/clonar) mora no /criador. */}
        <div hidden={!novoAberto}><SecaoCriarOrg offices={officesOrdenados} aoCriar={carregarOrgs} /></div>
        <SecaoOrgs ativo={aba === 'clientes'} carregando={carregandoOrgs} orgs={orgs} offices={officesOrdenados} erro={erroOrgs} aoMudar={carregarOrgs} />
      </div>
      <div hidden={aba !== 'usuarios'}>
        <ConvitesPendentesAdmin ativo={aba === 'usuarios'} revisao={versao} aoMudar={carregarOrgs} />
        <SecaoUsuarios ativo={aba === 'usuarios'} revisao={versao} />
      </div>
      {aba === 'contratos' && <AdminContratos orgs={orgs} aoSalvar={carregarOrgs} />}
      {aba === 'operacao' && <div className="config-grid">
        <SecaoStats />
        <RunpodInfra />
        <SecaoStorage />
        {/* A trilha por ÚLTIMO (pedido do dono): é consulta, não operação. */}
        <SecaoAuditoria recarregar={versao} />
      </div>}
    </div>
  )
}
