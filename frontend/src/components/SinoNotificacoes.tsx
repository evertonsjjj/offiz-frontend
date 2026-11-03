import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useIdioma } from '../lib/i18n'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, asList, AUTH_CREDENTIALS_KEY, getSessionIdentity } from '../lib/api'
import { wsClient } from '../lib/ws'
import { tempoRelativo } from '../lib/format'
import { Icone, type NomeIcone } from './Icone'
import { useConfirmacao } from './useConfirmacao'
import type { Notificacao, WsNotificacao } from '../lib/types'

/** Chave do set de traço por tipo de aviso (ver components/Icone.tsx). */
const ICONE_TIPO: Record<string, NomeIcone> = {
  job_done: 'check',
  job_failed: 'alerta',
  entrega_pendente: 'entregas',
}

export function SinoNotificacoes() {
  const { t, idioma } = useIdioma()
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([])
  const [aberto, setAberto] = useState(false)
  const [sessao, setSessao] = useState(getSessionIdentity)
  const [consultado, setConsultado] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erroConsulta, setErroConsulta] = useState(false)
  const [erroLeitura, setErroLeitura] = useState(false)
  const [marcandoTodas, setMarcandoTodas] = useState(false)
  const [limpando, setLimpando] = useState(false)
  const [erroLimpeza, setErroLimpeza] = useState(false)
  const [limpezaConfirmada, setLimpezaConfirmada] = useState(false)
  const [escopoResultadoLimpeza, setEscopoResultadoLimpeza] = useState<string | null>(null)
  const contextoRef = useRef(0)
  const vivoRef = useRef(true)
  const consultaRef = useRef<AbortController | null>(null)
  const lendoRef = useRef(new Set<number>())
  const todasRef = useRef(false)
  const limpandoRef = useRef(false)
  const dispensadasRef = useRef(new Set<number>())
  const revisaoRef = useRef(0)
  const recebidasRef = useRef(new Map<number, { revisao: number; notificacao: Notificacao }>())
  const lidasRef = useRef(new Map<number, number>())
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const botaoRef = useRef<HTMLButtonElement | null>(null)
  const painelId = useId()
  const navigate = useNavigate()
  const location = useLocation()
  const orgParametro = new URLSearchParams(location.search).get('org')
  const orgAtual = orgParametro && /^\d+$/.test(orgParametro) && Number.isSafeInteger(Number(orgParametro)) && Number(orgParametro) > 0 ? Number(orgParametro) : null
  const escopoLimpeza = `${sessao}:${orgAtual ?? 'todos'}`
  const escopoLimpezaRef = useRef(escopoLimpeza)
  escopoLimpezaRef.current = escopoLimpeza
  const { confirmar, dialogo } = useConfirmacao(escopoLimpeza)

  const carregar = useCallback(async () => {
    consultaRef.current?.abort()
    const controller = new AbortController()
    consultaRef.current = controller
    const contexto = contextoRef.current
    const revisaoInicial = revisaoRef.current
    const atual = () => vivoRef.current && contextoRef.current === contexto && getSessionIdentity() === sessao && !controller.signal.aborted
    setCarregando(true)
    try {
      const data = await api.get<unknown>('/notificacoes', controller.signal)
      if (!atual()) return
      const recebidasDepois = [...recebidasRef.current.values()].filter(n => n.revisao > revisaoInicial).sort((a, b) => b.revisao - a.revisao).map(n => n.notificacao)
      const idsRecebidos = new Set(recebidasDepois.map(n => n.id))
      const lista = [...recebidasDepois, ...asList<Notificacao>(data, 'notificacoes').filter(n => !idsRecebidos.has(n.id))]
      setNotificacoes(lista.filter(n => !dispensadasRef.current.has(n.id)).map(n => (lidasRef.current.get(n.id) ?? 0) > revisaoInicial ? { ...n, lida: true } : n))
      for (const [id, recebida] of recebidasRef.current) if (recebida.revisao <= revisaoInicial) recebidasRef.current.delete(id)
      for (const [id, revisao] of lidasRef.current) if (revisao <= revisaoInicial) lidasRef.current.delete(id)
      setConsultado(true)
      setErroConsulta(false)
    } catch {
      if (atual()) setErroConsulta(true)
    } finally {
      if (atual()) setCarregando(false)
    }
  }, [sessao])

  useEffect(() => {
    vivoRef.current = true
    const contexto = ++contextoRef.current
    setNotificacoes([])
    setConsultado(false)
    setErroConsulta(false)
    setErroLeitura(false)
    setMarcandoTodas(false)
    setLimpando(false)
    setErroLimpeza(false)
    setLimpezaConfirmada(false)
    setEscopoResultadoLimpeza(null)
    lendoRef.current = new Set()
    todasRef.current = false
    limpandoRef.current = false
    dispensadasRef.current.clear()
    revisaoRef.current = 0
    recebidasRef.current.clear()
    lidasRef.current.clear()
    const atual = () => vivoRef.current && contextoRef.current === contexto && getSessionIdentity() === sessao
    void carregar()
    const off = wsClient.on('notificacao', (msg) => {
      if (!atual()) return
      const n = (msg as WsNotificacao).notificacao
      if (!n || dispensadasRef.current.has(n.id)) return
      setLimpezaConfirmada(false)
      recebidasRef.current.set(n.id, { revisao: ++revisaoRef.current, notificacao: n })
      setNotificacoes((prev) => [n, ...prev.filter((p) => p.id !== n.id)])
    })
    const offReconecta = wsClient.on('_conectado', () => { if (atual()) void carregar() })
    const sincronizarSessao = () => {
      const identidade = getSessionIdentity()
      if (identidade === sessao) return
      consultaRef.current?.abort()
      contextoRef.current += 1
      setNotificacoes([])
      setAberto(false)
      setSessao(identidade)
    }
    const storage = (evento: StorageEvent) => {
      if (evento.storageArea === localStorage && (evento.key === null || evento.key === AUTH_CREDENTIALS_KEY || evento.key === 'offiz_auth_session')) sincronizarSessao()
    }
    window.addEventListener('focus', sincronizarSessao)
    window.addEventListener('storage', storage)
    window.addEventListener('offiz:sessao-expirada', sincronizarSessao)
    return () => {
      vivoRef.current = false
      contextoRef.current += 1
      consultaRef.current?.abort()
      off()
      offReconecta()
      window.removeEventListener('focus', sincronizarSessao)
      window.removeEventListener('storage', storage)
      window.removeEventListener('offiz:sessao-expirada', sincronizarSessao)
    }
  }, [carregar, sessao])

  useEffect(() => {
    setErroLimpeza(false)
    setLimpezaConfirmada(false)
  }, [escopoLimpeza])

  useEffect(() => {
    if (!aberto) return
    const onClickFora = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setAberto(false)
    }
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAberto(false); botaoRef.current?.focus() }
    }
    document.addEventListener('mousedown', onClickFora)
    document.addEventListener('keydown', onEscape)
    return () => { document.removeEventListener('mousedown', onClickFora); document.removeEventListener('keydown', onEscape) }
  }, [aberto])

  const naoLidas = notificacoes.filter((n) => !n.lida)
  const alvosLimpeza = notificacoes.filter(n => orgAtual === null || n.organization_id === orgAtual)

  async function limparNotificacoes() {
    if (limpandoRef.current || todasRef.current || getSessionIdentity() !== sessao) return
    const contexto = contextoRef.current
    const escopo = escopoLimpeza
    const ids = new Set(alvosLimpeza.slice(0, 200).map(n => n.id))
    if (!ids.size) return
    const sessaoAtual = () => vivoRef.current && contextoRef.current === contexto && getSessionIdentity() === sessao
    const atual = () => sessaoAtual() && escopoLimpezaRef.current === escopo
    limpandoRef.current = true
    try {
      const aceitou = await confirmar({
        titulo: t('Limpar notificações?', 'Clear notifications?'),
        mensagem: orgAtual === null
          ? t('Os avisos desta lista serão ocultados só para você. Os trabalhos, entregas e histórico continuam disponíveis; os avisos dos colegas não mudam.', 'The notifications in this list will be hidden only for you. Jobs, deliveries and history remain available; other people’s notifications stay unchanged.')
          : t('Os avisos deste cliente serão ocultados só para você. Os outros clientes, trabalhos, entregas e histórico não mudam.', 'This client’s notifications will be hidden only for you. Other clients, jobs, deliveries and history stay unchanged.'),
        acao: t('Limpar notificações', 'Clear notifications'),
        perigoso: false,
      })
      if (!aceitou || !atual()) return
      setLimpando(true)
      setEscopoResultadoLimpeza(escopo)
      setErroLimpeza(false)
      setLimpezaConfirmada(false)
      const resposta = await api.post<{ ok: boolean; notificacoes_ids: number[] }>('/notificacoes/limpar', {
        ids: [...ids], organization_id: orgAtual,
      })
      if (!atual()) return
      if (resposta.ok !== true || !Array.isArray(resposta.notificacoes_ids) || new Set(resposta.notificacoes_ids).size !== ids.size || !resposta.notificacoes_ids.every(id => ids.has(id))) throw new Error('Confirmação de limpeza inválida')
      for (const id of ids) {
        dispensadasRef.current.add(id)
        recebidasRef.current.delete(id)
        lidasRef.current.delete(id)
      }
      setNotificacoes(prev => prev.filter(n => !ids.has(n.id)))
      setLimpezaConfirmada(true)
    } catch {
      if (atual()) setErroLimpeza(true)
    } finally {
      if (sessaoAtual()) { limpandoRef.current = false; setLimpando(false) }
    }
  }

  async function marcarLida(n: Notificacao) {
    if (!n.lida && !lendoRef.current.has(n.id) && getSessionIdentity() === sessao) {
      const contexto = contextoRef.current
      const pendentes = lendoRef.current
      pendentes.add(n.id)
      try {
        await api.post(`/notificacoes/${n.id}/ler`)
        if (!vivoRef.current || contextoRef.current !== contexto || getSessionIdentity() !== sessao) return
        lidasRef.current.set(n.id, ++revisaoRef.current)
        setNotificacoes((prev) => prev.map((p) => (p.id === n.id ? { ...p, lida: true } : p)))
        setErroLeitura(false)
      } catch {
        if (vivoRef.current && contextoRef.current === contexto && getSessionIdentity() === sessao) setErroLeitura(true)
      } finally {
        pendentes.delete(n.id)
      }
    }
  }

  async function marcarTodas() {
    if (todasRef.current || limpandoRef.current || getSessionIdentity() !== sessao) return
    const contexto = contextoRef.current
    const ids = new Set(notificacoes.filter(n => !n.lida).map(n => n.id))
    if (!ids.size) return
    todasRef.current = true
    setMarcandoTodas(true)
    setErroLeitura(false)
    const atual = () => vivoRef.current && contextoRef.current === contexto && getSessionIdentity() === sessao
    try {
      await api.post('/notificacoes/ler-todas')
      if (!atual()) return
      const revisao = ++revisaoRef.current
      for (const id of ids) lidasRef.current.set(id, revisao)
      setNotificacoes((prev) => prev.map((n) => ids.has(n.id) ? { ...n, lida: true } : n))
    } catch {
      if (atual()) setErroLeitura(true)
    } finally {
      if (atual()) { todasRef.current = false; setMarcandoTodas(false) }
    }
  }

  function abrirNotificacao(n: Notificacao) {
    if (getSessionIdentity() !== sessao) return
    marcarLida(n)
    setAberto(false)
    if (!Number.isSafeInteger(n.organization_id) || !n.organization_id || n.organization_id < 1) return
    const destino = new URLSearchParams({ org: String(n.organization_id) })
    if (['entrega_pendente', 'job_done', 'job_failed'].includes(n.tipo)) {
      // O aviso abre a versão exata, sem trocar silenciosamente a conversa
      // da empresa por um histórico de área. A API verifica o acesso ao trabalho.
      destino.set('vista', 'biblioteca')
      if (n.job_id && Number.isSafeInteger(n.job_id) && n.job_id > 0) destino.set('trabalho', String(n.job_id))
    } else if (n.office_slug) destino.set('slug', n.office_slug)
    navigate(`/app?${destino}`)
  }

  return (
    <div className="sino-wrapper" ref={wrapperRef}>
      <button
        type="button"
        ref={botaoRef}
        className="sino-botao"
        onClick={() => setAberto((v) => !v)}
        aria-label={naoLidas.length > 0 ? t(`Notificações: ${naoLidas.length} não lidas`, `Notifications: ${naoLidas.length} unread`) : t('Notificações', 'Notifications')}
        aria-expanded={aberto}
        aria-controls={aberto ? painelId : undefined}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {naoLidas.length > 0 && (
          <span key={naoLidas.length} className="sino-badge">
            {naoLidas.length > 99 ? '99+' : naoLidas.length}
          </span>
        )}
      </button>

      {aberto && (
        <div className="sino-dropdown" id={painelId} role="region" aria-label={t('Notificações', 'Notifications')}>
          <div className="sino-cabecalho sino-cabecalho-notificacoes">
            <strong>{t('Notificações', 'Notifications')}</strong>
            {naoLidas.length > 0 && (
              <button type="button" className="botao-texto" disabled={marcandoTodas || limpando} onClick={marcarTodas}>
                {marcandoTodas ? t('Marcando…', 'Marking…') : t('Marcar todas como lidas', 'Mark all as read')}
              </button>
            )}
            {alvosLimpeza.length > 0 && <button type="button" className="botao-texto" disabled={limpando || marcandoTodas} onClick={() => void limparNotificacoes()}>
              {limpando && escopoResultadoLimpeza === escopoLimpeza ? t('Limpando…', 'Clearing…') : t('Limpar notificações', 'Clear notifications')}
            </button>}
          </div>
          <div className="sino-lista">
            {erroConsulta && <p className="sino-vazio" role="alert">{t('Não foi possível consultar as notificações.', 'Could not check notifications.')}{consultado && <> {t('Os avisos anteriores continuam abaixo.', 'Previous notifications are kept below.')}</>} <button type="button" className="botao-texto" disabled={carregando} onClick={() => void carregar()}>{t('Tentar novamente', 'Try again')}</button></p>}
            {erroLeitura && <p className="sino-vazio" role="alert">{t('Não foi possível confirmar a leitura. Você pode abrir o aviso ou marcar novamente.', 'Could not confirm that notifications were read. Open the notification or mark it again.')}</p>}
            {erroLimpeza && escopoResultadoLimpeza === escopoLimpeza && <p className="sino-vazio" role="alert">{t('Não foi possível limpar as notificações. Os avisos continuam aqui; tente novamente.', 'Could not clear notifications. They remain here; try again.')}</p>}
            {limpezaConfirmada && escopoResultadoLimpeza === escopoLimpeza && <p className="sino-vazio" role="status">{t('Notificações selecionadas limpas. Os trabalhos continuam disponíveis.', 'Selected notifications cleared. Your jobs remain available.')}</p>}
            {carregando && !consultado && <p className="sino-vazio" role="status">{t('Carregando notificações…', 'Loading notifications…')}</p>}
            {consultado && !erroConsulta && !carregando && notificacoes.length === 0 && <p className="sino-vazio">{t('Tudo em dia por aqui.', 'You are all caught up.')}</p>}
            {notificacoes.slice(0, 30).map((n) => (
              <button
                key={n.id}
                type="button"
                className={n.lida ? 'notificacao-item' : 'notificacao-item nao-lida'}
                onClick={() => abrirNotificacao(n)}
              >
                <Icone nome={ICONE_TIPO[n.tipo] ?? 'sino'} className="notificacao-icone" />
                <span className="notificacao-corpo">
                  <span className="notificacao-titulo">{n.titulo}</span>
                  {n.corpo && <span className="notificacao-texto">{n.corpo}</span>}
                  <span className="notificacao-quando">{tempoRelativo(n.criado_em, idioma)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {dialogo}
    </div>
  )
}
