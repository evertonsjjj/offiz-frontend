import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, asList, ApiError, getSessionIdentity } from '../lib/api'
import { Icone } from '../components/Icone'
import { wsClient } from '../lib/ws'
import { useBrasao } from '../lib/useBrasao'
import { temaParaEstilo } from '../lib/tema'
import { formatDataHora, statusJobLabel, tempoRelativo } from '../lib/format'
import { useIdioma } from '../lib/i18n'
import type { OfficeInfo, Predio, WsNotificacao } from '../lib/types'
import { mailtoLink, temContato, temEmail, temWhatsapp, whatsappLink } from '../lib/contato'
import { agruparOffices, areaDoOffice, descricaoArea, iconeArea, nomeArea, nomeModulo, resumoModulo } from '../lib/office-areas'
import '../styles/areas-cliente.css'

/**
 * A CASA DO CLIENTE — um prédio por organização, um ANDAR por tipo de trabalho.
 *
 * Até 03/08/2026 esta tela mostrava um cartão por par (cliente × escritório):
 * quem tinha três tipos de trabalho via "três prédios", e o rodapé do app
 * pregava a doutrina antiga ("um prédio para cada escritório"). No modelo de
 * serviço é o contrário: **o cliente tem UM prédio e vai ganhando andares** —
 * hoje marketing, amanhã financeiro. O momento do upsell, que é o que se quer
 * comemorar, virava "ganhei um segundo prédio" em vez de "meu prédio cresceu".
 */

/** Um andar do prédio: o tipo de trabalho concedido àquele cliente. */
function Andar({ predio }: { predio: Predio }) {
  const { t, idioma } = useIdioma()
  const tema = predio.office?.tema
  // O brasão do cliente também aqui: esta é a porta de entrada de quem tem mais
  // de um andar, e o logo é o que ele reconhece antes de ler o nome. A vitrine
  // de andares AINDA DISPONÍVEIS abaixo segue com emoji de propósito — aquilo é
  // catálogo do Offiz, não prédio dele.
  const brasao = useBrasao(predio.org_id, predio.office_slug)
  return (
    <Link
      to={`/app?org=${predio.org_id}&slug=${predio.office_slug}`}
      className="andar-item"
      style={temaParaEstilo(tema)}
    >
      <span className="andar-icone" aria-hidden={!brasao}>
        {brasao ? (
          <img src={brasao} alt="" className="andar-brasao" />
        ) : (
          /* Sem brasão, o sinal do andar é o ÍCONE DE PRÉDIO do set. Um
             manifesto que declare `tema.icone` continua mandando: o <Icone>
             devolve como texto o que não for chave conhecida. */
          <Icone nome={tema?.icone || 'predio'} />
        )}
      </span>
      <span className="andar-texto">
        <span className="andar-nome">{nomeModulo({ ...predio.office, slug: predio.office_slug, nome: predio.office?.nome || predio.office_slug }, t)}</span>
        <span className="andar-descricao">{resumoModulo({ ...predio.office, slug: predio.office_slug, nome: predio.office?.nome || predio.office_slug }, t)}</span>
      </span>
      <span className="andar-estado">
        {predio.nao_lidas > 0 && (
          <span
            key={predio.nao_lidas}
            className="badge-nao-lidas"
            title={t(`${predio.nao_lidas} notificações não lidas`, `${predio.nao_lidas} unread notifications`)}
          >
            {predio.nao_lidas > 99 ? '99+' : predio.nao_lidas}
          </span>
        )}
        {predio.ultimo_job ? (
          <>
            <span className={`status-pill status-${predio.ultimo_job.status}`}>
              {statusJobLabel(predio.ultimo_job.status, idioma)}
            </span>
            <span className="andar-quando">{tempoRelativo(predio.ultimo_job.criado_em, idioma)}</span>
          </>
        ) : (
          <span className="andar-quando">{t('Nenhuma tarefa ainda', 'No tasks yet')}</span>
        )}
      </span>
    </Link>
  )
}

interface PredioAgrupado {
  orgId: number
  orgNome: string
  andares: Predio[]
  naoLidas: number
}

/** A vitrine do upsell — SEM preço, de propósito: contrato é fechado com
 *  quem monta o escritório (modelo de serviço), não num checkout. */
function AndaresDisponiveis({
  catalogo,
  jaConcedidos,
}: {
  catalogo: OfficeInfo[]
  jaConcedidos: Set<string>
}) {
  const { t } = useIdioma()
  const disponiveis = catalogo.filter(
    (o) => o.vendavel !== false && !o.arquivado && !jaConcedidos.has(o.slug),
  )
  if (disponiveis.length === 0 || !temContato) {
    // Tudo contratado (ou sem canal de contato): a mensagem genérica basta.
    return (
      <footer className="predio-crescer">
        <Icone nome="mais" />
        <span>
          {t('Precisa de outro tipo de trabalho? Fale com quem montou os seus escritórios para abrir um novo.', 'Need another type of work? Contact the person who set up your offices to add a new one.')}
        </span>
      </footer>
    )
  }
  const msg = (nome: string, especialidades: string) =>
    t(`Olá! Uso o Offiz e gostaria de conversar sobre ${nome} para minha empresa: ${especialidades}.`, `Hello! I use Offiz and would like to discuss ${nome} for my company: ${especialidades}.`)
  return (
    <footer className="predio-vitrine">
      <p className="predio-vitrine-titulo">
        <Icone nome="mais" tamanho={15} /> {t('Áreas e especialidades que podemos preparar para você:', 'Areas and specialties we can set up for you:')}
      </p>
      <ul className="predio-vitrine-lista areas-vitrine-lista">
        {agruparOffices(disponiveis).map(({ id, offices }) => {
          const nome = nomeArea(id, t)
          const especialidades = offices.map(o => nomeModulo(o, t)).join(' · ')
          return <li key={id}>
            <Icone nome={iconeArea(id)} tamanho={18} />
            <span className="predio-vitrine-nome"><strong>{nome}</strong><small>{especialidades}</small></span>
            {temWhatsapp ? (
              <a
                href={whatsappLink(msg(nome, especialidades))}
                target="_blank"
                rel="noopener noreferrer"
                className="botao botao-fantasma botao-pequeno"
                aria-label={t(`Conversar sobre ${nome}`, `Discuss ${nome}`)}
              >
                {t('Conversar', 'Discuss')}
              </a>
            ) : temEmail ? (
              <a href={mailtoLink(undefined, msg(nome, especialidades))} className="botao botao-fantasma botao-pequeno" aria-label={t(`Conversar sobre ${nome}`, `Discuss ${nome}`)}>
                {t('Conversar', 'Discuss')}
              </a>
            ) : null}
          </li>
        })}
      </ul>
      <p className="texto-suave predio-vitrine-nota">
        {t('Sem preço na tela de propósito: cada escritório é montado sob medida — o combinado é feito direto com quem monta o seu.', 'Each office is tailored to your needs. Pricing is agreed directly with the person who sets it up.')}
      </p>
    </footer>
  )
}

function CardPredio({ predio, catalogo, jaConcedidos }: { predio: PredioAgrupado; catalogo: OfficeInfo[]; jaConcedidos: Set<string> }) {
  const { t } = useIdioma()
  const areas = agruparOffices(predio.andares.map(p => ({ ...p, slug: p.office_slug, area: p.office?.area })))
  return (
    <section className="card-predio-completo">
      <header className="predio-fachada">
        <div>
          <h2 className="predio-nome">{predio.orgNome}</h2>
          <p className="predio-sub">
            {areas.length === 1 ? t('1 área', '1 area') : t(`${areas.length} áreas`, `${areas.length} areas`)}
            {' · '}
            {predio.andares.length === 1 ? t('1 especialidade', '1 specialty') : t(`${predio.andares.length} especialidades`, `${predio.andares.length} specialties`)}
          </p>
        </div>
        {predio.naoLidas > 0 && (
          <span className="badge-nao-lidas" title={t(`${predio.naoLidas} avisos não lidos na empresa`, `${predio.naoLidas} unread company notifications`)}>
            {predio.naoLidas > 99 ? '99+' : predio.naoLidas}
          </span>
        )}
      </header>
      {/* A porta de entrada única: o cliente não precisa saber qual andar
          faz o quê — o CEO decide. Vem ANTES dos andares de propósito. */}
      <Link to={`/ceo/${predio.orgId}`} className="predio-ceo-chamada">
        <Icone nome="predio" />
        <span>
          <strong>{t('Fale com a sua empresa', 'Talk to your company')}</strong>
          <small>{t('Peça com as suas palavras — eu escolho quem faz.', 'Tell me what you need — I will choose who handles it.')}</small>
        </span>
      </Link>
      <div className="predio-andares areas-cliente">
        {areas.map(({ id, offices }) => <section key={id} className="area-cliente" aria-labelledby={`area-${predio.orgId}-${id}`}>
          <header className="area-cliente-cabecalho">
            <Icone nome={iconeArea(id)} tamanho={20} />
            <div><h3 id={`area-${predio.orgId}-${id}`}>{nomeArea(id, t)}</h3><p>{descricaoArea(id, t)}</p></div>
          </header>
          {offices.map(a => <Andar key={`${a.org_id}-${a.office_slug}`} predio={a} />)}
        </section>)}
      </div>
      {/* O andar que ainda NÃO existe também faz parte da história do prédio:
          é assim que o cliente descobre que dá para crescer — e é o gancho do
          upsell, sem o consultor precisar ligar para lembrar. */}
      <AndaresDisponiveis
        catalogo={catalogo}
        jaConcedidos={jaConcedidos}
      />
    </section>
  )
}

export default function PrediosPage() {
  const [conta, setConta] = useState(getSessionIdentity)
  useEffect(() => {
    const mudou = () => setConta(getSessionIdentity())
    window.addEventListener('offiz:token-changed', mudou)
    window.addEventListener('storage', mudou)
    return () => { window.removeEventListener('offiz:token-changed', mudou); window.removeEventListener('storage', mudou) }
  }, [])
  return <PrediosDaConta key={conta ?? 'sem-conta'} conta={conta} />
}

function PrediosDaConta({ conta }: { conta: string | null }) {
  const { t, idioma } = useIdioma()
  const [predios, setPredios] = useState<Predio[] | null>(null)
  const [catalogo, setCatalogo] = useState<OfficeInfo[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [atualizando, setAtualizando] = useState(true)
  const [consultadoEm, setConsultadoEm] = useState<string>()
  const [revisao, atualizar] = useState(0)

  useEffect(() => {
    let ativo = true
    let sequencia = 0
    let requisicao: AbortController | undefined
    let debounce: ReturnType<typeof setTimeout> | undefined
    let ultimaConsulta = 0
    const atual = () => ativo && getSessionIdentity() === conta
    const carregar = async () => {
      if (!atual()) return
      requisicao?.abort()
      const controller = new AbortController()
      requisicao = controller
      const numero = ++sequencia
      const valida = () => atual() && !controller.signal.aborted && numero === sequencia
      setAtualizando(true)
      try {
        const data = await api.get<unknown>('/predios', controller.signal)
        if (!valida()) return
        setPredios(asList<Predio>(data, 'predios'))
        ultimaConsulta = Date.now()
        setConsultadoEm(new Date(ultimaConsulta).toISOString())
        setErro(null)
      } catch (e) {
        if (valida()) setErro(e instanceof ApiError ? e.detail : t('Não foi possível carregar os seus escritórios.', 'Could not load your offices.'))
      } finally {
        if (valida()) setAtualizando(false)
      }
    }
    const agendar = () => {
      if (!atual() || document.hidden) return
      // O aviso invalida a leitura agora, antes da próxima consulta agrupada.
      // Uma resposta antiga não pode abrir o atalho durante esses 250 ms.
      requisicao?.abort()
      setAtualizando(true)
      clearTimeout(debounce)
      debounce = setTimeout(() => void carregar(), 250)
    }
    const aoRetornar = () => { if (Date.now() - ultimaConsulta > 2000) agendar() }
    void carregar()
    // O catálogo alimenta a vitrine de andares disponíveis (best-effort).
    const catalogoController = new AbortController()
    api.get<unknown>('/offices', catalogoController.signal)
      .then(d => { if (atual() && !catalogoController.signal.aborted) setCatalogo(asList<OfficeInfo>(d, 'offices')) })
      .catch(() => { /* A lista de acessos não depende da vitrine. */ })
    const offNotif = wsClient.on('notificacao', (msg) => {
      const n = (msg as WsNotificacao).notificacao
      if (!n || !atual()) return
      setPredios((prev) =>
        prev
          ? prev.map((p) =>
              p.org_id === n.organization_id && p.office_slug === n.office_slug
                ? { ...p, nao_lidas: p.nao_lidas + 1 }
                : p,
            )
          : prev,
      )
    })
    const offStatus = wsClient.on('job_status', agendar)
    const offConectado = wsClient.on('_conectado', agendar)
    window.addEventListener('focus', aoRetornar)
    document.addEventListener('visibilitychange', aoRetornar)
    return () => {
      ativo = false
      requisicao?.abort(); catalogoController.abort(); clearTimeout(debounce)
      offNotif(); offStatus(); offConectado()
      window.removeEventListener('focus', aoRetornar)
      document.removeEventListener('visibilitychange', aoRetornar)
    }
  }, [conta, revisao, t])

  const filtrados = useMemo(() => {
    if (!predios) return []
    const normalizar = (valor: string) => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const q = normalizar(busca.trim())
    if (!q) return predios
    return predios.filter(
      (p) =>
        [p.org_nome, p.office?.nome || '', p.office_slug, p.office?.descricao || '',
          nomeArea(areaDoOffice({ slug: p.office_slug, area: p.office?.area }), t),
          nomeModulo({ ...p.office, slug: p.office_slug, nome: p.office?.nome || p.office_slug }, t),
        ].some(valor => normalizar(valor).includes(q)),
    )
  }, [predios, busca, t])

  /** Agrupa por organização: um prédio por cliente, andares dentro. */
  const agrupados = useMemo<PredioAgrupado[]>(() => {
    const mapa = new Map<number, PredioAgrupado>()
    for (const p of filtrados) {
      let grupo = mapa.get(p.org_id)
      if (!grupo) {
        grupo = { orgId: p.org_id, orgNome: p.org_nome, andares: [], naoLidas: 0 }
        mapa.set(p.org_id, grupo)
      }
      grupo.andares.push(p)
      grupo.naoLidas += p.nao_lidas || 0
    }
    for (const grupo of mapa.values()) {
      grupo.andares.sort((a, b) =>
        (a.office?.nome || a.office_slug).localeCompare(
          b.office?.nome || b.office_slug,
          idioma,
        ),
      )
    }
    return [...mapa.values()].sort((a, b) => a.orgNome.localeCompare(b.orgNome, idioma))
  }, [filtrados, idioma])

  // Atalho para quem tem UM andar só: entra direto no trabalho, em vez de parar
  // num prédio de um andar para clicar. Continua valendo — mas o dia em que o
  // segundo andar é concedido a pessoa cai AQUI e vê o próprio prédio com dois
  // andares, não dois prédios soltos. Era essa a quebra da promessa.
  if (predios && predios.length === 1 && !erro && !atualizando) {
    const p = predios[0]
    return <Navigate to={`/app?org=${p.org_id}&slug=${p.office_slug}`} replace />
  }

  // Com um cliente só (o caso normal), o título é o nome dele: é o prédio DELE.
  const umPredioSo = agrupados.length === 1
  const titulo = umPredioSo ? agrupados[0].orgNome : t('Suas empresas', 'Your companies')
  const subtitulo = umPredioSo
    ? t('Suas especialidades estão organizadas por área de trabalho.', 'Your specialties are organized by work area.')
    : t('Uma empresa por cliente, com suas áreas e especialidades.', 'One company per client, with its own areas and specialties.')

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <h1 className="titulo-poster">{titulo}</h1>
          <p className="pagina-sub">{subtitulo}</p>
        </div>
        {/* A busca só faz sentido para quem tem muita coisa — num prédio de dois
            andares ela é ruído na tela do cliente de 60 anos. */}
        {(predios?.length ?? 0) > 4 && (
          <div className="campo-busca">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={t('Buscar escritório…', 'Search offices…')}
              aria-label={t('Buscar escritórios', 'Search offices')}
            />
          </div>
        )}
      </div>

      {erro && <div role="alert" className="alerta alerta-erro">
        <p>{erro}{predios !== null && <> {t('Os acessos abaixo são da última consulta.', 'The access list below is from the last check.')}</>}</p>
        {consultadoEm && <p className="texto-suave">{t('Última consulta:', 'Last checked:')} <time dateTime={consultadoEm}>{formatDataHora(consultadoEm, idioma)}</time></p>}
        <button type="button" className="botao botao-fantasma" disabled={atualizando} onClick={() => atualizar(v => v + 1)}>{t('Tentar novamente', 'Try again')}</button>
      </div>}
      {atualizando && predios !== null && <p role="status" className="texto-suave">{t('Atualizando seus acessos…', 'Refreshing your access…')}</p>}

      {predios === null && !erro && (
        <div className="grid-predios">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card-predio esqueleto" aria-hidden="true" />
          ))}
        </div>
      )}

      {predios !== null && predios.length === 0 && (
        <div className="estado-vazio">
          <div className="estado-vazio-arte" aria-hidden="true">
            <Icone nome="predio" tamanho={44} traco={1.3} />
          </div>
          <h2>{t('Sua empresa ainda não tem escritórios', 'Your company has no offices yet')}</h2>
          <p>
            {t('Quando um tipo de trabalho for liberado para você, ele aparece aqui como um escritório. Fale com quem montou a sua empresa.', 'When a type of work is enabled for you, it appears here as an office. Contact the person who set up your company.')}
          </p>
        </div>
      )}

      {predios !== null && predios.length > 0 && agrupados.length === 0 && (
        <div className="estado-vazio">
          <div className="estado-vazio-arte" aria-hidden="true">
            <Icone nome="lupa" tamanho={44} traco={1.3} />
          </div>
          <h2>{t(`Nada encontrado para “${busca}”`, `No results for “${busca}”`)}</h2>
          <p>{t('Tente outro nome de escritório.', 'Try another office name.')}</p>
        </div>
      )}

      <div className="lista-predios">
        {agrupados.map((p) => (
          <CardPredio key={p.orgId} predio={p} catalogo={catalogo} jaConcedidos={new Set(predios?.filter(a => a.org_id === p.orgId).map(a => a.office_slug))} />
        ))}
      </div>
    </div>
  )
}
