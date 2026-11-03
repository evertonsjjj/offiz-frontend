import { useTextoInicio } from '../lib/i18nInicio'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError, getSessionIdentity } from '../lib/api'
import type { PreparacaoDaArea, PreparacaoNaConversa } from '../lib/perfilSabatina'
import type { OfficeInfo, DetalhePredio, ReferenciaConversa } from '../lib/types'
import type { AndarInicio, InicioOrganizacao, PreferenciaSolucao } from '../lib/inicio'
import { Icone } from '../components/Icone'
import { LogoMark } from '../components/LogoMark'
import { ToggleTema } from '../components/ToggleTema'
import { MenuUsuario } from '../components/MenuUsuario'
import { SaldoIA, type ModalidadeSaldoConfirmada } from '../components/SaldoIA'
import { MeuContrato } from '../components/ContratosIA'
import { SinoNotificacoes } from '../components/SinoNotificacoes'
import { ConversaTab } from '../components/predio/ConversaTab'
import { SolucoesInicio } from '../components/SolucoesInicio'
import { temMotorBridge, EVENTO_SETTINGS_LLM_MUDOU } from '../lib/motor-bridge'
import { useIdioma } from '../lib/i18n'
import { ResumoTrabalho } from '../components/predio/ResumoTrabalho'
import { loadRoute } from '../lib/routeReload'
import { PlacaExecucao } from '../predio/PlacaExecucao'
import { FerramentaDaArea, ferramentasDaArea } from '../components/predio/FerramentaDaArea'
import { localizarAba } from '../lib/abas'
import { wsClient } from '../lib/ws'
import { agruparOffices, nomeArea, nomeModulo } from '../lib/office-areas'
import { consultarConexaoIA, origemIA, type ConexaoIA } from '../lib/conexao-ia'
import { EstadoConexaoIA } from '../components/EstadoConexaoIA'
import { AtualizacaoMotor } from '../components/AtualizacaoMotor'
import '../styles/areas-cliente.css'

const BibliotecaProjetos = lazy(() => loadRoute(() => import('../components/predio/BibliotecaProjetos')))
const PrepararInicio = lazy(() => loadRoute(() => import('../components/PrepararInicio').then(m => ({ default: m.PrepararInicio }))))
const AcervoTab = lazy(() => loadRoute(() => import('../components/predio/AcervoTab').then(m => ({ default: m.AcervoTab }))))
const ConhecimentoTab = lazy(() => loadRoute(() => import('../components/predio/ConhecimentoSimples').then(m => ({ default: m.ConhecimentoSimples }))))
const ConfigOrgCorpo = lazy(() => loadRoute(() => import('./ConfigOrg').then(m => ({ default: m.ConfigOrgCorpo }))))
const PainelMotorEmbutido = lazy(() => loadRoute(() => import('./ConfigOrg').then(m => ({ default: m.PainelMotorEmbutido }))))
const AgendaTab = lazy(() => loadRoute(() => import('../components/predio/AgendaTab').then(m => ({ default: m.AgendaTab }))))

interface ContextoInicio { orgId: number; sessao: string | null; ativo: boolean }
interface LeituraInicio { contexto: ContextoInicio; controller: AbortController; promessa: Promise<void> }

// O catálogo conserva seu ID antigo. A rota da ferramenta não deve colidir
// com a biblioteca de pedidos da empresa, que usa vista=biblioteca.
const destinoFerramenta = (id: string) => id === 'biblioteca' ? 'doutrina-modelos' : id

function AtalhoDoEscritorio({ orgId, andares, tipo }: {
  orgId: number
  andares: AndarInicio[]
  tipo: 'entregas' | 'acervo'
}) {
  const { texto } = useTextoInicio()
  const { t } = useIdioma()
  const rotulo = tipo === 'acervo' ? texto("Acervo") : texto("Trabalhos")
  const icone = tipo === 'acervo' ? 'arq-pasta' : 'entregas'
  const [params] = useSearchParams()
  const menuRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (menuRef.current) menuRef.current.open = false
    const fora = (e: PointerEvent) => {
      const menu = menuRef.current
      if (menu && e.target instanceof Node && !menu.contains(e.target)) menu.open = false
    }
    const tecla = (e: KeyboardEvent) => {
      const menu = menuRef.current
      if (e.key === 'Escape' && menu?.open) {
        const menuFocado = document.activeElement?.closest('.inicio-nav-menu')
        menu.open = false
        if (!menuFocado || menuFocado === menu) menu.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', fora)
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('pointerdown', fora); document.removeEventListener('keydown', tecla) }
  }, [orgId, params])
  const fecharMenu = () => {
    if (menuRef.current) menuRef.current.open = false
    menuRef.current?.querySelector('summary')?.focus()
  }
  const destino = (andar: AndarInicio) => {
    const next = new URLSearchParams(params)
    next.set('vista', tipo); next.set('area', andar.slug)
    return `?${next}`
  }
  if (andares.length === 0) return null
  if (tipo === 'entregas') {
    const next = new URLSearchParams(params)
    next.set('vista', 'biblioteca'); next.delete('area'); next.delete('f')
    return <Link className="inicio-nav-link" aria-current={params.get('vista') === 'biblioteca' ? 'page' : undefined} to={`?${next}`}><Icone nome={icone} tamanho={17} />{t('Pedidos e entregas', 'Requests and deliverables')}</Link>
  }
  if (andares.length === 1) return <Link className="inicio-nav-link" aria-current={params.get('vista') === tipo ? 'page' : undefined} to={destino(andares[0])}><Icone nome={icone} tamanho={17} />{rotulo}</Link>
  return (
    <details ref={menuRef} className="inicio-nav-menu">
      <summary><Icone nome={icone} tamanho={17} />{rotulo}</summary>
      <div className="inicio-nav-opcoes areas-nav-opcoes">{agruparOffices(andares).map(({ id, offices }) => <section key={id} className="area-nav-grupo" aria-label={nomeArea(id, t)}>
        <h3>{nomeArea(id, t)}</h3>
        {offices.map(andar => <Link key={andar.slug} to={destino(andar)} onClick={fecharMenu}>{nomeModulo(andar, t)}</Link>)}
      </section>)}</div>
    </details>
  )
}

/** A API valida membership mesmo sem escritório concedido: uma lista de
 * andares vazia não significa que a empresa não existe. */
export function OffizInicio({ orgId, embutido = false, areaSlug, areaOffice }: { orgId: number; embutido?: boolean; areaSlug?: string; areaOffice?: OfficeInfo }) {
  const { texto } = useTextoInicio()
  const { t, idioma } = useIdioma()
  const [topoEstreito, setTopoEstreito] = useState(() => window.matchMedia?.('(max-width: 1000px)').matches ?? false)
  useEffect(() => {
    const consulta = window.matchMedia?.('(max-width: 1000px)')
    if (!consulta) return
    const atualizar = () => setTopoEstreito(consulta.matches)
    consulta.addEventListener('change', atualizar)
    return () => consulta.removeEventListener('change', atualizar)
  }, [])
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navegar = useNavigate()
  const ferramentasRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const fechar = (e: PointerEvent) => { if (e.target instanceof Node && !ferramentasRef.current?.contains(e.target) && ferramentasRef.current) ferramentasRef.current.open = false }
    const tecla = (e: KeyboardEvent) => {
      const menu = ferramentasRef.current
      if (e.key === 'Escape' && menu?.open) {
        if (menu.querySelector('.saldo-ia[open]')) return
        const menuFocado = document.activeElement?.closest('.inicio-nav-menu')
        menu.open = false
        if (!menuFocado || menuFocado === menu) menu.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', fechar); document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('pointerdown', fechar); document.removeEventListener('keydown', tecla) }
  }, [])
  const [conexao, setConexao] = useState<{ dados: InicioOrganizacao; valor: ConexaoIA } | null>(null)
  const [envioBloqueado, setEnvioBloqueado] = useState(false)
  const verificacaoRef = useRef(0)
  const [conexaoErro, setConexaoErro] = useState('')
  const [inicio, setInicio] = useState<InicioOrganizacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<{ orgId: number; texto: string; chave: number; referencia?: ReferenciaConversa; preparacao?: PreparacaoNaConversa }>()
  const ultimoRetornoRef = useRef(0)
  const contextoRef = useRef<ContextoInicio | null>(null)
  const leituraRef = useRef<LeituraInicio | null>(null)
  const [modalidadeSaldo, setModalidadeSaldo] = useState<ModalidadeSaldoConfirmada | null>(null)
  const modalidadeSaldoRef = useRef<ModalidadeSaldoConfirmada | null>(null)
  const tentativaOrigemRef = useRef<ModalidadeSaldoConfirmada | null>(null)
  const [conferenciaOrigem, setConferenciaOrigem] = useState<{ modalidade: ModalidadeSaldoConfirmada; consultando: boolean } | null>(null)

  const carregarInicio = useCallback(function lerInicio(forcar = false): Promise<void> {
    const contexto = contextoRef.current
    if (!contexto?.ativo || contexto.orgId !== orgId || contexto.sessao !== getSessionIdentity()) return Promise.resolve()
    const anterior = leituraRef.current
    if (anterior?.contexto === contexto) {
      if (!forcar) return anterior.promessa
      // Uma escrita precisa de uma leitura posterior; foco apenas reaproveita
      // a que já está acontecendo. Duas escritas juntas compartilham a próxima.
      return anterior.promessa.catch(() => undefined).then(() => lerInicio())
    }
    anterior?.controller.abort()
    const leitura: LeituraInicio = { contexto, controller: new AbortController(), promessa: Promise.resolve() }
    leituraRef.current = leitura
    setErro(null)
    leitura.promessa = api.get<InicioOrganizacao>(`/orgs/${orgId}/inicio`, leitura.controller.signal)
      .then((dados) => {
        if (contexto.ativo && contextoRef.current === contexto && contexto.sessao === getSessionIdentity() && !leitura.controller.signal.aborted) setInicio(dados)
      })
      .catch((e) => {
        if (!contexto.ativo || contextoRef.current !== contexto || contexto.sessao !== getSessionIdentity() || leitura.controller.signal.aborted) return
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setInicio(null)
        setErro(e instanceof ApiError ? e.detail : 'Não foi possível abrir sua empresa. Tente novamente.')
        throw e
      })
      .finally(() => { if (leituraRef.current === leitura) leituraRef.current = null })
    return leitura.promessa
  }, [orgId])
  const atualizar = useCallback(() => { void carregarInicio(true).catch(() => undefined) }, [carregarInicio])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = wsClient.on('job_status', event => {
      if (event.t !== 'job_status' || !('org_id' in event) || event.org_id !== orgId || !('status' in event) || event.status !== 'failed') return
      clearTimeout(timer)
      timer = setTimeout(atualizar, 500)
    })
    return () => { off(); clearTimeout(timer) }
  }, [orgId, atualizar])

  useEffect(() => {
    const contexto = { orgId, sessao: getSessionIdentity(), ativo: true }
    contextoRef.current = contexto
    atualizar()
    return () => {
      contexto.ativo = false
      if (leituraRef.current?.contexto === contexto) {
        leituraRef.current.controller.abort()
        leituraRef.current = null
      }
    }
  }, [orgId, atualizar])

  useEffect(() => {
    const aoRetornar = () => {
      if (document.hidden) return
      // Foco e visibilidade costumam chegar juntos no retorno à janela.
      const agora = Date.now()
      if (agora - ultimoRetornoRef.current < 1000) return
      ultimoRetornoRef.current = agora
      void carregarInicio().catch(() => undefined)
    }
    window.addEventListener('focus', aoRetornar)
    document.addEventListener('visibilitychange', aoRetornar)
    return () => {
      window.removeEventListener('focus', aoRetornar)
      document.removeEventListener('visibilitychange', aoRetornar)
    }
  }, [carregarInicio])

  const atualizarSolucao = useCallback(async (id: string, preferencia: PreferenciaSolucao) => {
    const contexto = contextoRef.current
    if (!contexto?.ativo || contexto.orgId !== orgId) return
    await api.patch(`/orgs/${orgId}/inicio/solucoes/${encodeURIComponent(id)}`, preferencia)
    if (!contexto.ativo || contextoRef.current !== contexto) return
    try {
      // O estado do botão só muda quando a preferência já aparece na lista.
      // Retornar à janela durante esta leitura reaproveita a mesma promessa.
      await carregarInicio(true)
    } catch {
      throw new ApiError(0, 'Sua preferência foi salva, mas a lista não atualizou. Use “Tentar novamente” para carregar as sugestões.')
    }
  }, [orgId, carregarInicio])

  // A troca de cliente nunca mostra o contexto anterior enquanto carrega.
  const dados = inicio?.org_id === orgId ? inicio : null
  const confirmarModalidadeSaldo = useCallback((confirmada: ModalidadeSaldoConfirmada) => {
    if (confirmada.orgId !== orgId || confirmada.sessao !== getSessionIdentity()) return
    const anterior = modalidadeSaldoRef.current
    if (anterior?.orgId === confirmada.orgId && anterior.sessao === confirmada.sessao && anterior.tipo === confirmada.tipo) return
    modalidadeSaldoRef.current = confirmada
    setModalidadeSaldo(confirmada)
  }, [orgId])
  const modalidadeAtual = modalidadeSaldo?.orgId === orgId && modalidadeSaldo.sessao === getSessionIdentity() ? modalidadeSaldo : null
  const origemSaldoPendente = !!dados && !!modalidadeAtual && !!dados.contrato_gerenciado !== (modalidadeAtual.tipo === 'pf_gerenciado')
  const conferirOrigem = useCallback((modalidade: ModalidadeSaldoConfirmada) => {
    const contexto = contextoRef.current
    if (!contexto?.ativo || contexto.orgId !== modalidade.orgId || contexto.sessao !== modalidade.sessao || modalidade.sessao !== getSessionIdentity()) return
    setConferenciaOrigem({ modalidade, consultando: true })
    void carregarInicio(true).catch(() => undefined).finally(() => {
      if (contexto.ativo && contextoRef.current === contexto && modalidade.sessao === getSessionIdentity() && modalidadeSaldoRef.current === modalidade) {
        setConferenciaOrigem({ modalidade, consultando: false })
      }
    })
  }, [carregarInicio])
  useEffect(() => {
    if (!origemSaldoPendente || !modalidadeAtual) { tentativaOrigemRef.current = null; return }
    if (tentativaOrigemRef.current === modalidadeAtual) return
    // O saldo revela uma modalidade diferente, mas não informa provedor,
    // credencial ou motor. Releia a fonte; não derive conexão da carteira.
    tentativaOrigemRef.current = modalidadeAtual
    conferirOrigem(modalidadeAtual)
  }, [origemSaldoPendente, modalidadeAtual, conferirOrigem])
  const consultandoOrigem = origemSaldoPendente && conferenciaOrigem?.modalidade === modalidadeAtual && conferenciaOrigem.consultando
  const podeConfigurar = dados?.meu_papel === 'owner' || dados?.meu_papel === 'admin'
  const podeLigarMotor = temMotorBridge()
  const conexaoAtual: ConexaoIA = conexao?.dados === dados ? conexao.valor : {
    origem: dados ? origemIA(dados, window.offizMotor) : 'api', estado: 'verificando', pronto: false,
  }
  const conectado = conexaoAtual.pronto
  const verificarMotor = useCallback(async (): Promise<boolean> => {
    if (!dados) return false
    const contexto = contextoRef.current
    const verificacao = ++verificacaoRef.current
    try {
      const valor = await consultarConexaoIA(dados, window.offizMotor)
      if (!contexto?.ativo || contexto !== contextoRef.current || contexto.sessao !== getSessionIdentity() || verificacao !== verificacaoRef.current) return false
      setConexao({ dados, valor }); setConexaoErro('')
      if (valor.pronto) setEnvioBloqueado(false)
      return valor.pronto
    } catch {
      if (!contexto?.ativo || contexto !== contextoRef.current || contexto.sessao !== getSessionIdentity() || verificacao !== verificacaoRef.current) return false
      setConexao({ dados, valor: { origem: origemIA(dados, window.offizMotor), estado: 'erro', pronto: false } })
      setConexaoErro(t('Não consegui verificar a conexão. Tente novamente.', 'Could not check the connection. Try again.'))
      return false
    }
  }, [dados, orgId, t])
  useEffect(() => {
    let vivo = true
    const verificar = () => { if (vivo && !document.hidden) void verificarMotor() }
    verificar()
    const off = window.offizMotor?.onUpdate(verificar)
    window.addEventListener('focus', verificar)
    const timer = window.setInterval(verificar, 10000)
    return () => { vivo = false; off?.(); window.clearInterval(timer); window.removeEventListener('focus', verificar) }
  }, [verificarMotor])
  useEffect(() => {
    window.addEventListener(EVENTO_SETTINGS_LLM_MUDOU, atualizar)
    return () => window.removeEventListener(EVENTO_SETTINGS_LLM_MUDOU, atualizar)
  }, [atualizar])
  const foco = params.get('f') || ''
  // f=biblioteca identifica a ferramenta nos links antigos de um andar.
  // Uma vista explícita continua prioritária, inclusive os pedidos universais.
  const bibliotecaLegada = !params.get('vista') && foco === 'biblioteca' && !!(params.get('area') || areaSlug)
  const vistaSolicitada = params.get('vista') || (bibliotecaLegada ? destinoFerramenta(foco) : foco)
  // Links antigos do sino e do chat abrem a mesma lista de pedidos. A tela
  // legada de entregas não deve reaparecer dependendo de onde houve o clique.
  const vista = ['entregas', 'tarefas', 'tareas'].includes(vistaSolicitada) ? 'biblioteca' : vistaSolicitada
  useEffect(() => {
    if (!['entregas', 'tarefas', 'tareas'].includes(vistaSolicitada)) return
    setParams(p => {
      const n = new URLSearchParams(p)
      n.set('vista', 'biblioteca'); n.delete('f')
      const job = n.get('job')
      if (job && /^[1-9]\d*$/.test(job) && Number.isSafeInteger(Number(job))) n.set('trabalho', job)
      n.delete('job')
      n.delete('arquivo')
      return n
    }, { replace: true })
  }, [vistaSolicitada, setParams])
  useEffect(() => {
    if (!bibliotecaLegada) return
    const n = new URLSearchParams(params)
    n.set('vista', destinoFerramenta('biblioteca')); n.delete('f')
    navegar({ search: `?${n}`, hash: location.hash }, { replace: true })
  }, [bibliotecaLegada, params, location.hash, navegar])
  const areaSolicitada = params.get('area') || areaSlug
  const area = areaSolicitada ? dados?.andares.find(a => a.slug === areaSolicitada) : dados?.andares[0]
  const fecharArea = () => { atualizar(); setParams(p => { const n = new URLSearchParams(p); n.set('vista', 'conversa'); n.delete('area'); n.delete('f'); n.delete('job'); return n }) }
  const configurar = () => setParams(p => { const n = new URLSearchParams(p); n.set('vista', 'config'); return n })
  const configurarMotor = () => setParams(p => { const n = new URLSearchParams(p); n.set('vista', 'motor'); return n })
  const abrirSaldo = () => setParams(p => { const n = new URLSearchParams(p); n.set('vista', 'saldo'); n.delete('f'); return n })
  // Um atalho para um estado ou trabalho específico não é a retomada da
  // biblioteca: filtros anteriores poderiam esconder o pedido solicitado.
  const abrirPedidos = (jobId?: number, estado?: string) => setParams(p => {
    const n = new URLSearchParams(p)
    n.set('vista', 'biblioteca')
    for (const chave of ['f', 'projeto', 'arquivo', 'busca-pedidos', 'filtro-pedidos', 'formato-pedidos', 'versoes-pedidos', 'pagina-pedidos', 'biblioteca-aba']) n.delete(chave)
    if (jobId != null && Number.isSafeInteger(jobId) && jobId > 0) n.set('trabalho', String(jobId))
    else n.delete('trabalho')
    if (estado) n.set('estado', estado)
    else n.delete('estado')
    return n
  })
  const navegarArea = (id: string) => {
    if (id === 'conversa' || id === 'mesa') { fecharArea(); return }
    setParams(p => { const n = new URLSearchParams(p); n.set('vista', destinoFerramenta(id)); n.delete('f'); if (area) n.set('area', area.slug); return n })
  }
  const [pecaFluxo, setPecaFluxo] = useState<{ slug: string; n: number; jobId?: number } | null>(null)
  const contextoConversa = `${orgId}:${areaSlug || 'predio'}`
  const [conversaAtual, setConversaAtual] = useState<{ contexto: string; id: number | null }>()
  const aoMudarConversa = useCallback((id: number | null) => setConversaAtual({ contexto: contextoConversa, id }), [contextoConversa])
  const contextoPainel = `${getSessionIdentity()}/${orgId}/${area?.slug ?? ''}/${vista}/${contextoConversa}/${conversaAtual?.contexto === contextoConversa ? conversaAtual.id : 'abrindo'}`
  const contextoPainelRef = useRef(contextoPainel)
  contextoPainelRef.current = contextoPainel
  const continuarPreparacao = (informacoes: PreparacaoDaArea) => {
    const contexto = contextoRef.current
    if (contextoPainelRef.current !== contextoPainel || !contexto?.ativo || contexto.orgId !== orgId
      || !informacoes.sessao || informacoes.sessao !== contexto.sessao || informacoes.sessao !== getSessionIdentity()
      || informacoes.orgId !== orgId || informacoes.slug !== area?.slug || vista !== 'inicio') return
    const id = conversaAtual?.contexto === contextoConversa ? conversaAtual.id : null
    setRascunho(anterior => ({ orgId, texto: informacoes.textos.join('\n\n'), chave: (anterior?.chave ?? 0) + 1,
      preparacao: { ...informacoes, origem: 'preparacao', destino: { slug: areaSlug || 'predio', conversaId: id } } }))
    fecharArea()
  }
  const [trabalhoFluxo, setTrabalhoFluxo] = useState<{ jobId: number; n: number } | null>(null)
  const verPeca = (slug: string, jobId?: number) => { setTrabalhoFluxo(null); setPecaFluxo(p => ({ slug, jobId, n: (p?.n ?? 0) + 1 })); navegarArea('estudio') }
  const verFluxo = (jobId: number) => { setPecaFluxo(null); setTrabalhoFluxo(p => ({ jobId, n: (p?.n ?? 0) + 1 })); navegarArea('estudio') }
  // Uma ferramenta aberta a partir da empresa usa a mesma área da entrega.
  const [detalheArea, setDetalheArea] = useState<{ orgId: number; slug: string; office?: OfficeInfo; erro?: boolean }>()
  const areaPainelSlug = area?.slug
  const [revisaoArea, setRevisaoArea] = useState(0)
  useEffect(() => {
    if (!areaPainelSlug || (areaPainelSlug === areaSlug && areaOffice)) return
    const controller = new AbortController()
    void api.get<DetalhePredio>(`/predios/${orgId}/${encodeURIComponent(areaPainelSlug)}`, controller.signal)
      .then(d => { if (!d?.office || d.office.slug !== areaPainelSlug) throw new Error('Área inválida'); if (!controller.signal.aborted) setDetalheArea({ orgId, slug: areaPainelSlug, office: d.office }) })
      .catch(() => { if (!controller.signal.aborted) setDetalheArea({ orgId, slug: areaPainelSlug, erro: true }) })
    return () => controller.abort()
  }, [orgId, areaPainelSlug, areaSlug, areaOffice, revisaoArea])
  const detalheAtual = detalheArea?.orgId === orgId && detalheArea.slug === areaPainelSlug ? detalheArea : undefined
  const officePainel = area && (area.slug === areaSlug && areaOffice ? areaOffice : detalheAtual?.office)
  const ferramentas = officePainel && area ? ferramentasDaArea(officePainel, area.slug, podeConfigurar).map(a => localizarAba(a, idioma)) : []
  const atalhosJuridicos = areaSlug === 'juris' && area?.slug === 'juris'
    ? ferramentas.filter(a => ['casos', 'monitor', 'biblioteca'].includes(a.id)) : []
  const ferramenta = ferramentas.find(a => destinoFerramenta(a.id) === vista)
  const tituloPainel = vista === 'saldo' ? t('Plano e consumo de IA', 'AI plan and usage') : vista === 'agenda' ? t('Agendamento', 'Schedule') : vista === 'biblioteca' ? t('Pedidos e entregas', 'Requests and deliverables') : vista === 'motor' ? t('IA neste computador', 'AI on this computer') : vista === 'config' ? t('Configurações', 'Settings') : vista === 'acervo' ? texto('Acervo') : ferramenta?.rotulo
  const painel = ((vista === 'biblioteca' || vista === 'saldo') && dados) || (vista === 'motor' && podeLigarMotor) || (vista === 'config' && podeConfigurar) || ((vista === 'acervo' || vista === 'agenda' || ferramenta) && area)
    ? <aside className={`inicio-painel-area${vista === 'estudio' ? ' inicio-painel-area--estudio' : ''}`} aria-label={tituloPainel}>
        <header>{vista !== 'biblioteca' && <strong>{tituloPainel}</strong>}
          {vista !== 'saldo' && vista !== 'biblioteca' && vista !== 'config' && vista !== 'motor' && (dados?.andares.length ?? 0) > 1 && <select aria-label={t('Área de trabalho', 'Work area')} value={area?.slug} onChange={e => setParams(p => { const n = new URLSearchParams(p); n.set('area', e.target.value); return n })}>{agruparOffices(dados?.andares ?? []).map(({ id, offices }) => <optgroup key={id} label={nomeArea(id, t)}>{offices.map(a => <option key={a.slug} value={a.slug}>{nomeModulo(a, t)}</option>)}</optgroup>)}</select>}
          <button type="button" className="botao-texto inicio-voltar-conversa" onClick={fecharArea}><Icone nome="conversa" tamanho={18} />{t('Voltar à conversa', 'Back to conversation')}</button></header>
        <Suspense fallback={<p role="status">{t('Abrindo painel…', 'Opening panel…')}</p>}>{vista === 'saldo' ? <MeuContrato key={orgId} orgId={orgId} /> : vista === 'biblioteca' && dados ? <Suspense fallback={<p role="status">{t('Abrindo sua biblioteca…', 'Opening your library…')}</p>}><BibliotecaProjetos key={orgId} orgId={orgId} areaSlug={areaSlug} andares={dados.andares} podeConfigurar={podeConfigurar} conversaId={conversaAtual?.contexto === contextoConversa ? conversaAtual.id : null} pedirNaConversa={(texto, referencia) => escolher(texto, referencia)} /></Suspense> : vista === 'motor' ? <PainelMotorEmbutido key={orgId} orgId={orgId} aoMudarPareamento={atualizar} podeConfigurarEmpresa={podeConfigurar} gerenciado={dados?.contrato_gerenciado} /> : vista === 'config' ? <ConfigOrgCorpo key={orgId} orgId={orgId} embutido /> : area && (vista === 'acervo' ? (area.acervo_de_marca ? <AcervoTab key={`${orgId}-${area.slug}`} orgId={orgId} slug={area.slug} /> : <ConhecimentoTab key={`${orgId}-${area.slug}`} orgId={orgId} slug={area.slug} />)
          : vista === 'agenda' ? <AgendaTab key={`${orgId}-${area.slug}`} orgId={orgId} slug={area.slug} office={officePainel} podeEditar={podeConfigurar} /> : officePainel && <FerramentaDaArea key={`${orgId}-${area.slug}-${vista}`} vista={ferramenta?.id ?? vista} orgId={orgId} slug={area.slug} office={officePainel} meuPapel={dados!.meu_papel} navegar={navegarArea} aoContinuarPerfil={continuarPreparacao} perguntar={texto => escolher(texto, undefined, vista === 'estudio')} peca={pecaFluxo} trabalho={trabalhoFluxo} conversaId={conversaAtual?.contexto === contextoConversa && (!areaSlug || areaSlug === area.slug) ? conversaAtual.id : null} antesDeGerar={async () => { const pronto = await verificarMotor(); if (!pronto) { if (podeLigarMotor) configurarMotor(); else if (podeConfigurar) configurar() }; return pronto }} />)}
        </Suspense>
      </aside> : undefined
  const officeCeo: OfficeInfo = useMemo(() => ({
    slug: 'predio', nome: dados?.org_nome || texto("Seu escritório"),
    descricao: texto("Conte o resultado que precisa. Vamos preparar o trabalho e apresentar o que falta para uma boa entrega."),
    tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#f5f5f7', icone: 'conversa' },
  }), [dados?.org_nome, texto])
  const escolher = useCallback((texto: string, referencia?: ReferenciaConversa, manterPainel = false) => {
    setRascunho((anterior) => ({ orgId, texto, referencia, chave: (anterior?.chave ?? 0) + 1 }))
    if (!manterPainel) setParams(p => { const n = new URLSearchParams(p); n.delete('vista'); n.delete('f'); return n })
  }, [orgId, setParams])
  const acoesConta = [
    { titulo: t('Saldo e consumo de IA', 'AI balance and usage'), executar: abrirSaldo },
    ...ferramentas.filter(a => a.id !== 'agenda').map(a => ({ titulo: a.rotulo, executar: () => navegarArea(a.id) })),
    ...(podeConfigurar ? [{ titulo: dados?.contrato_gerenciado ? t('Meu plano e configurações', 'My plan and settings') : conectado ? t('IA conectada e configurações', 'AI connection and settings') : t('Conectar IA e configurações', 'Connect AI and settings'), executar: configurar }] : []),
    ...(podeLigarMotor ? [{ titulo: t('IA neste computador', 'AI on this computer'), executar: configurarMotor }] : []),
  ]
  const resumoSaldo = dados && <SaldoIA key={orgId} compacto orgId={orgId} motorLocal={conexaoAtual.origem === 'local'} verConsumo={abrirSaldo} aoConfirmarModalidade={confirmarModalidadeSaldo} />
  const resumoOrigem = origemSaldoPendente ? <div className="inicio-conexao-status pendente" role="status">
    <strong>{t('Origem da IA', 'AI source')}</strong>
    <span>{consultandoOrigem ? t('Verificando origem…', 'Checking source…') : t('Consulta da origem pendente', 'Source check needed')}</span>
    <button type="button" className="botao-texto" disabled={consultandoOrigem} onClick={() => { if (modalidadeAtual) conferirOrigem(modalidadeAtual) }}>{t('Verificar origem', 'Check source')}</button>
  </div> : <EstadoConexaoIA conexao={conexaoAtual} configurar={conexaoAtual.origem === 'local' && podeLigarMotor ? configurarMotor : podeConfigurar ? configurar : undefined} />

  return (
    <div className={`offiz-inicio${embutido ? ' offiz-inicio--embutido' : ''}`}>
      <header className="inicio-topo">
        <div className="inicio-identidade">
          {embutido && <Link to="/predios" className="inicio-logo" aria-label={texto("Offiz, minhas empresas")}><LogoMark size={30} /><span>Offiz</span></Link>}
          <div className="inicio-contexto"><span className="inicio-empresa"><Icone nome="predio" tamanho={16} />{dados?.org_nome || texto("Seu escritório")}</span><span className="inicio-contexto-area">{areaSlug ? nomeModulo({ slug: areaSlug, nome: areaOffice?.nome || areaSlug }, t) : t('Todas as áreas', 'All teams')}</span></div>
        </div>
        <nav className="inicio-navegacao" aria-label={texto("Seu escritório")}>
          {dados && <>
            <button type="button" className="inicio-nav-link" onClick={fecharArea} aria-current={!painel ? 'page' : undefined}><Icone nome="conversa" tamanho={17} />{t('Conversa', 'Conversation')}</button>
            <AtalhoDoEscritorio orgId={orgId} andares={dados.andares} tipo="entregas" />
            <AtalhoDoEscritorio orgId={orgId} andares={dados.andares} tipo="acervo" />
            <details ref={ferramentasRef} className="inicio-nav-menu inicio-ferramentas"><summary aria-label={t('Mais: agenda e ferramentas', 'More: schedule and tools')}><Icone nome="oficina" tamanho={17} />{t('Mais', 'More')}</summary><div className="inicio-nav-opcoes">
              <div className="inicio-nav-ia">{resumoOrigem}{topoEstreito && resumoSaldo}</div>
              {area && <button type="button" className="inicio-nav-link" onClick={e => { navegarArea('agenda'); e.currentTarget.closest('details')?.removeAttribute('open') }} aria-current={vista === 'agenda' ? 'page' : undefined}><Icone nome="agenda" tamanho={17} />{t('Agendamento', 'Schedule')}</button>}
              {dados.andares.length > 1 && <select aria-label={t('Área das ferramentas', 'Tools area')} value={area?.slug} onChange={e => setParams(p => { const n = new URLSearchParams(p); n.set('area', e.target.value); return n })}>{agruparOffices(dados.andares).map(({ id, offices }) => <optgroup key={id} label={nomeArea(id, t)}>{offices.map(a => <option key={a.slug} value={a.slug}>{nomeModulo(a, t)}</option>)}</optgroup>)}</select>}
              {!officePainel && <p role={detalheAtual?.erro ? 'alert' : 'status'}>{detalheAtual?.erro ? t('Não foi possível carregar as ferramentas.', 'Could not load tools.') : t('Carregando ferramentas…', 'Loading tools…')}{detalheAtual?.erro && <button type="button" onClick={() => setRevisaoArea(r => r + 1)}>{texto('Tentar novamente')}</button>}</p>}
              {officePainel && ferramentas.length === 0 && <p>{t('Peça o trabalho diretamente na conversa desta área.', 'Request work directly in this area’s conversation.')}</p>}
              {ferramentas.filter(a => a.id !== 'agenda').map(a => <button key={a.id} type="button" className="inicio-nav-link" onClick={e => { navegarArea(a.id); e.currentTarget.closest('details')?.removeAttribute('open') }}>{a.rotulo}</button>)}
              {!embutido && acoesConta.filter(a => !ferramentas.some(f => f.rotulo === a.titulo)).map(a => <button key={a.titulo} type="button" className="inicio-nav-link" onClick={e => { a.executar(); e.currentTarget.closest('details')?.removeAttribute('open') }}>{a.titulo}</button>)}
            </div></details>
          </>}
        </nav>
        {!topoEstreito && resumoSaldo}
        {embutido && <div className="inicio-controles"><ToggleTema /><SinoNotificacoes /><MenuUsuario acoes={acoesConta} /></div>}
      </header>
      <main className="inicio-area">
        {dados && conexaoAtual.origem === 'local' && vista !== 'motor' && <AtualizacaoMotor versao={window.offizMotor?.versao} />}
        {dados && areaSlug && <div className="inicio-escopo-area"><span>{t('Você está na área de', 'You are working in')} <strong>{nomeModulo({ slug: areaSlug, nome: areaOffice?.nome || areaSlug }, t)}</strong></span><Link to={`/app?org=${orgId}&vista=conversa`}>{t('Abrir conversa geral da empresa', 'Open the organization’s general conversation')}</Link></div>}
        {atalhosJuridicos.length > 0 && <nav className="rotina-juridica" aria-label={t('Rotina jurídica', 'Legal workspace')}>
          <span>{t('Rotina do escritório', 'Office workflow')}</span>
          {atalhosJuridicos.map(atalho => {
            const destino = new URLSearchParams(params)
            destino.set('vista', destinoFerramenta(atalho.id))
            destino.set('area', 'juris')
            destino.delete('f')
            return <Link key={atalho.id} to={{ search: `?${destino}`, hash: location.hash }} aria-current={vista === destinoFerramenta(atalho.id) ? 'page' : undefined}>
              <Icone nome={atalho.icone} tamanho={17} />{atalho.rotulo}
            </Link>
          })}
        </nav>}
        {erro && (dados ? <p className="inicio-atualizacao-erro" role="alert"><Icone nome="alerta" tamanho={17} /><span>{texto("Não foi possível atualizar as sugestões.")}{" "}{erro}</span><button type="button" onClick={atualizar}>{texto("Tentar novamente")}</button></p> : <div className="inicio-erro" role="alert"><Icone nome="alerta" tamanho={23} /><p>{erro}</p><button type="button" className="botao botao-fantasma" onClick={atualizar}>{texto("Tentar novamente")}</button><Link to="/predios">{texto("Voltar às minhas empresas")}</Link></div>)}
        {!dados && !erro && <div className="inicio-carregando" role="status"><LogoMark size={38} /><p>{texto("Preparando seu escritório…")}</p></div>}
        {dados && <>
          {dados.org_status === 'suspensa' && <div className="inicio-conexao" role="status"><Icone nome="alerta" tamanho={20} /><div><strong>{texto("Esta empresa está com a operação suspensa.")}</strong><p>{texto("Seu histórico e acervo continuam disponíveis. Para retomar as conversas e os trabalhos, fale com o responsável pela empresa.")}</p></div></div>}
          {areaSolicitada && !area && <p className="alerta alerta-aviso" role="alert">{t('Esta área não está disponível nesta empresa. Abra a conversa ou escolha uma área disponível nas ferramentas.', 'This team is unavailable in this organization. Open the conversation or choose an available team in Tools.')} <button type="button" className="botao-texto" onClick={fecharArea}>{t('Voltar à conversa', 'Back to conversation')}</button></p>}
          {detalheAtual?.erro && <p role="alert">{t('Não foi possível carregar as ferramentas desta área.', 'Could not load this area’s tools.')} <button type="button" onClick={() => setRevisaoArea(r => r + 1)}>{texto('Tentar novamente')}</button></p>}
          {conexaoErro && <p role="alert">{conexaoErro}</p>}
          {envioBloqueado && !conectado && <p className="alerta alerta-aviso" role="alert">{conexaoAtual.origem === 'local' ? t('A mensagem ainda não foi enviada: conclua a conexão da IA neste computador. Seu texto e seus anexos continuam na conversa.', 'The message has not been sent: finish connecting AI on this computer. Your text and attachments are still in the conversation.') : t('A mensagem ainda não foi enviada: confira a conexão e o saldo indicados no topo. Seu texto e seus anexos foram preservados.', 'The message has not been sent: check the connection and credit shown at the top. Your text and attachments were preserved.')}</p>}
          {dados.org_status !== 'suspensa' && !conectado && !podeConfigurar && !podeLigarMotor && <p role="status">{t('Peça ao responsável pela empresa para conectar a IA. Seu histórico continua disponível.', 'Ask your organization administrator to connect AI. Your history is still available.')}</p>}
          {dados.sem_saldo && <div className="alerta alerta-aviso" role="alert">
            <strong>{t('Um trabalho parou por falta de crédito.', 'A task stopped because of insufficient credit.')}</strong>{' '}
            {t('É um aviso de um trabalho anterior, não uma consulta ao saldo atual. Confira o motivo no pedido; seus arquivos continuam disponíveis.', 'This is a notice from an earlier task, not a check of the current balance. Review the reason in the request; your files remain available.')}{' '}
            <button type="button" className="botao-texto" onClick={() => abrirPedidos(undefined, 'precisa_de_voce')}>{t('Ver trabalhos parados', 'View stopped tasks')}</button>
          </div>}
          <ConversaTab key={`${orgId}:${areaSlug || "predio"}`} orgId={orgId} slug={areaSlug || "predio"} office={areaOffice || officeCeo} meuPapel={dados.meu_papel} nivelPredio={!areaSlug}
            aoMudarConversa={aoMudarConversa}
            inicioConteudo={dados.org_status !== 'suspensa' && conexaoAtual.estado !== 'verificando' && !conectado && (podeConfigurar || podeLigarMotor) && vista !== 'motor' ? <Suspense fallback={<p role="status">{t('Abrindo conexão…', 'Opening connection…')}</p>}><PrepararInicio orgId={orgId} aoAtualizar={atualizar} podeConfigurarEmpresa={podeConfigurar} gerenciado={dados.contrato_gerenciado} perfilPreparado={dados.sabatina.perfil_preparado === true || dados.sabatina.estado === 'contextualizado'} /></Suspense> : <><ResumoTrabalho orgId={orgId} areaSlug={areaSlug} abrir={estado => abrirPedidos(undefined, estado)} /><SolucoesInicio key={orgId} inicio={dados} aoEscolher={escolher} aoAtualizarSolucao={atualizarSolucao} /></>}
            painelConteudo={painel}
            atividadeConteudo={dados.andares.filter(a => !areaSlug || a.slug === areaSlug).map(a => <PlacaExecucao key={`${orgId}:${a.slug}`} orgId={orgId} slug={a.slug} pendentes={0} aoAbrirEntregas={abrirPedidos}
              conversaId={areaSlug ? (conversaAtual?.contexto === contextoConversa ? conversaAtual.id : null) : undefined}
              contextoAtividade={{ empresa: dados.org_nome, area: nomeModulo(a, t) }} />)}
            aoVerPeca={areaSlug === 'conteudo' ? verPeca : undefined} aoVerFluxo={areaSlug === 'conteudo' ? verFluxo : undefined}
            antesDeEnviar={async () => { const pronto = await verificarMotor(); if (!pronto) { setEnvioBloqueado(true); if (origemIA(dados, window.offizMotor) === 'local' && podeLigarMotor) configurarMotor(); else if (podeConfigurar) configurar() }; return pronto }}
            rascunhoInicial={rascunho?.orgId === orgId ? rascunho : undefined} aoContextoAtualizado={atualizar}
          />
        </>}
      </main>
    </div>
  )
}

export default function CeoPage() {
  const { texto } = useTextoInicio()
  const { orgId } = useParams()
  const id = Number(orgId)
  if (!Number.isSafeInteger(id) || id <= 0) return <div className="pagina"><p className="alerta alerta-erro">{texto("Empresa não encontrada.")}</p><Link to="/predios">{texto("Voltar às minhas empresas")}</Link></div>
  return <OffizInicio key={id} orgId={id} />
}
