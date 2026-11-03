import { useIdioma } from '../../lib/i18n'
import { useTextoEscritorio } from '../../lib/i18nEscritorios'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, asList, ApiError, getSessionIdentity } from '../../lib/api'
import { Icone } from '../Icone'
import { useToasts } from '../Toasts'
import { useConfirmacao } from '../useConfirmacao'
import {
  IMPORTANCIA_LABEL,
  PRIORIDADE_CLASSE,
  PRIORIDADE_LABEL,
  formatCNJ,
  formatDataHora,
  tempoRelativo,
} from '../../lib/format'
import type {
  EventoProcesso,
  ImportanciaEvento,
  LookupProcesso,
  MonitorProcesso,
  PrioridadeProcesso,
} from '../../lib/types'

const PRIORIDADES: PrioridadeProcesso[] = ['alta', 'media', 'baixa']

function classeImportancia(imp: ImportanciaEvento | undefined): string {
  if (imp === 'critico') return 'evento-critico'
  if (imp === 'importante') return 'evento-importante'
  return 'evento-normal'
}

/* ------------------------------------------------------------------ */
/* Adicionar processo (CNJ → lookup → confirmar)                       */
/* ------------------------------------------------------------------ */

function AdicionarProcesso({
  orgId,
  slug,
  aoAdicionar,
  aoCancelar,
}: {
  orgId: number
  slug: string
  aoAdicionar: (p: MonitorProcesso) => void
  aoCancelar: () => void
}) {
  const { idioma } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso } = useToasts()
  const [cnj, setCnj] = useState('')
  const [apelido, setApelido] = useState('')
  const [prioridade, setPrioridade] = useState<PrioridadeProcesso>('media')
  const [lookup, setLookup] = useState<LookupProcesso | null>(null)
  const [consultando, setConsultando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const cnjLimpo = cnj.replace(/\D/g, '')
  const cnjValido = cnjLimpo.length === 20
  const cnjRef = useRef(cnjLimpo)
  cnjRef.current = cnjLimpo
  const sessaoRef = useRef(getSessionIdentity())
  const vivoRef = useRef(true)
  const consultaRef = useRef<AbortController | null>(null)
  const salvandoRef = useRef(false)
  const telaAtual = () => vivoRef.current && getSessionIdentity() === sessaoRef.current
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; consultaRef.current?.abort() } }, [])

  async function consultar() {
    if (!telaAtual()) return
    if (!cnjValido) {
      setErro(tx("O número CNJ deve ter 20 dígitos."))
      return
    }
    setErro(null)
    setConsultando(true)
    setLookup(null)
    consultaRef.current?.abort()
    const controller = new AbortController()
    consultaRef.current = controller
    const atual = () => telaAtual() && cnjRef.current === cnjLimpo && !controller.signal.aborted
    try {
      const res = await api.get<LookupProcesso>(
        `/predios/${orgId}/${slug}/monitor/lookup?cnj=${encodeURIComponent(cnjLimpo)}`,
        controller.signal,
      )
      if (!atual()) return
      setLookup(res)
    } catch (e) {
      if (atual()) setErro(e instanceof ApiError ? e.detail : tx("Não foi possível consultar o processo."))
    } finally {
      if (atual()) setConsultando(false)
    }
  }

  async function salvar() {
    if (!telaAtual() || salvandoRef.current) return
    if (!cnjValido) {
      setErro(tx("O número CNJ deve ter 20 dígitos."))
      return
    }
    salvandoRef.current = true
    setSalvando(true)
    try {
      const p = await api.post<MonitorProcesso>(`/predios/${orgId}/${slug}/monitor/processos`, {
        numero_cnj: cnjLimpo,
        apelido: apelido.trim() || undefined,
        prioridade,
      })
      if (!telaAtual()) return
      sucesso(tx("Processo adicionado ao monitor."))
      aoAdicionar(p)
    } catch (e) {
      if (telaAtual()) setErro(e instanceof ApiError ? e.detail : tx("Não foi possível adicionar o processo."))
    } finally {
      salvandoRef.current = false
      if (telaAtual()) setSalvando(false)
    }
  }

  return (
    <section className="cartao monitor-adicionar">
      <div className="secao-cabecalho">
        <h3 className="secao-titulo">{tx("Adicionar processo")}</h3>
        <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoCancelar}> {tx("Fechar")} </button>
      </div>

      <label className="campo">
        <span>{tx("Número CNJ")}</span>
        <div className="monitor-cnj-linha">
          <input
            type="text"
            value={cnj}
            onChange={(e) => {
              consultaRef.current?.abort()
              setCnj(e.target.value)
              setLookup(null)
              setConsultando(false)
              setErro(null)
            }}
            aria-label={tx('Número CNJ')}
            placeholder="0000000-00.0000.0.00.0000"
            inputMode="numeric"
          />
          <button type="button" className="botao botao-fantasma" onClick={consultar} disabled={consultando || !cnjValido}>
            {consultando ? tx("Consultando…") : tx("Consultar")}
          </button>
        </div>
        {cnj && !cnjValido && <small className="texto-suave">{cnjLimpo.length}{tx("/20 dígitos")}</small>}
      </label>

      {erro && <p className="alerta alerta-erro" role="alert">{tx(erro)}</p>}

      {lookup && (
        <div
          className={
            lookup.encontrado ? 'monitor-lookup ok' : lookup.erro ? 'monitor-lookup erro' : 'monitor-lookup vazio'
          }
        >
          {lookup.encontrado ? (
            <>
              <p className="monitor-lookup-titulo">
                <Icone nome="check" tamanho={15} /> {tx("Processo encontrado")} {lookup.tribunal_inferido && (
                  <span className="status-pill status-done">{lookup.tribunal_inferido}</span>
                )}
              </p>
              {lookup.movimentos && lookup.movimentos.length > 0 && (
                <ul className="monitor-lookup-movs">
                  {lookup.movimentos.slice(0, 5).map((m, i) => (
                    <li key={i}>
                      <span className="mov-data">{m.data ? formatDataHora(m.data, idioma) : '—'}</span>
                      <span className="mov-nome">{m.nome}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : lookup.erro ? (
            <p className="monitor-lookup-titulo">
              <Icone nome="conector" tamanho={15} /> {tx("Não foi possível consultar o DataJud agora")} {lookup.tribunal_inferido && <> {tx("(tribunal inferido:")} {lookup.tribunal_inferido})</>}{tx(". Pode ser instabilidade ou limite da base pública — tente novamente em instantes. Você ainda pode monitorar o processo; as movimentações aparecerão quando a consulta voltar.")} </p>
          ) : (
            <p className="monitor-lookup-titulo">
              <Icone nome="alerta" tamanho={15} /> {tx("Não localizado na base pública")} {lookup.tribunal_inferido && <> {tx("(tribunal inferido:")} {lookup.tribunal_inferido})</>}{tx(". Você ainda pode monitorá-lo — as novas movimentações aparecerão quando surgirem.")} </p>
          )}
        </div>
      )}

      <div className="linha-campos">
        <label className="campo">
          <span>{tx("Apelido (opcional)")}</span>
          <input
            type="text"
            value={apelido}
            onChange={(e) => setApelido(e.target.value)}
            placeholder={tx("Ex.: Aposentadoria — João")}
          />
        </label>
        <label className="campo">
          <span>{tx("Prioridade")}</span>
          <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)}>
            {PRIORIDADES.map((p) => (
              <option key={p} value={p}>
                {tx(PRIORIDADE_LABEL[p] ?? p)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="caso-form-rodape">
        <button type="button" className="botao botao-fantasma" onClick={aoCancelar}> {tx("Cancelar")} </button>
        <button type="button" className="botao botao-primario" onClick={salvar} disabled={salvando || !cnjValido}>
          {salvando ? tx("Adicionando…") : tx("Monitorar processo")}
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Timeline de eventos                                                 */
/* ------------------------------------------------------------------ */

function TimelineEventos({
  orgId,
  slug,
  monitorId,
  processos,
  aoLerEvento,
  atualizacao,
}: {
  orgId: number
  slug: string
  monitorId: number | null
  processos: MonitorProcesso[]
  aoLerEvento: () => void
  atualizacao: number
}) {
  const { idioma, t } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const [eventos, setEventos] = useState<EventoProcesso[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [apenasNaoLidos, setApenasNaoLidos] = useState(false)
  const chave = `${monitorId ?? 'todos'}:${apenasNaoLidos}`
  const chaveRef = useRef(chave)
  chaveRef.current = chave
  const filtroAnteriorRef = useRef(chave)
  const sessaoRef = useRef(getSessionIdentity())
  const vivoRef = useRef(true)
  const leituraRef = useRef<AbortController | null>(null)
  const lendoRef = useRef(new Set<string>())
  const telaAtual = useCallback((consulta?: string) => vivoRef.current && getSessionIdentity() === sessaoRef.current && (!consulta || consulta === chaveRef.current), [])
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; leituraRef.current?.abort() } }, [])

  const carregar = useCallback(async () => {
    if (!telaAtual(chave)) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    const atual = () => telaAtual(chave) && !controller.signal.aborted
    try {
      const qs = new URLSearchParams()
      if (apenasNaoLidos) qs.set('apenas_nao_lidos', 'true')
      if (monitorId) qs.set('monitor_id', String(monitorId))
      const sufixo = qs.toString() ? `?${qs.toString()}` : ''
      const data = await api.get<unknown>(`/predios/${orgId}/${slug}/monitor/eventos${sufixo}`, controller.signal)
      if (!atual()) return
      setEventos(asList<EventoProcesso>(data, 'eventos', 'itens'))
      setErro(null)
    } catch (e) {
      if (atual()) setErro(e instanceof ApiError ? e.detail : tx("Não foi possível carregar os eventos."))
    }
  }, [orgId, slug, apenasNaoLidos, monitorId, chave, telaAtual, tx])

  useEffect(() => {
    if (filtroAnteriorRef.current !== chave) setEventos(null)
    filtroAnteriorRef.current = chave
    setErro(null)
    carregar()
    return () => leituraRef.current?.abort()
  }, [carregar, chave, atualizacao])

  async function marcarLido(ev: EventoProcesso) {
    const acao = `${chave}:${ev.id}`
    if (!telaAtual(chave) || lendoRef.current.has(acao)) return
    lendoRef.current.add(acao)
    leituraRef.current?.abort()
    try {
      await api.post(`/predios/${orgId}/${slug}/monitor/eventos/${ev.id}/marcar-lido`)
      if (!telaAtual(chave)) return
      leituraRef.current?.abort()
      setEventos((prev) => (prev ? prev.map((e) => (e.id === ev.id ? { ...e, lido_em: new Date().toISOString() } : e)) : prev))
      aoLerEvento()
    } catch (e) {
      if (telaAtual(chave)) falha(e instanceof ApiError ? e.detail : tx("Não foi possível marcar como lido."))
    } finally { lendoRef.current.delete(acao) }
  }

  async function marcarTodos() {
    const acao = `${chave}:todos`
    if (!telaAtual(chave) || lendoRef.current.has(acao)) return
    lendoRef.current.add(acao)
    try {
      await api.post(`/predios/${orgId}/${slug}/monitor/eventos/marcar-todos-lidos`, monitorId ? { monitor_id: monitorId } : {})
      if (!telaAtual(chave)) return
      sucesso(tx("Eventos marcados como lidos."))
      await carregar()
      aoLerEvento()
    } catch (e) {
      if (telaAtual(chave)) falha(e instanceof ApiError ? e.detail : tx("Não foi possível marcar todos como lidos."))
    } finally { lendoRef.current.delete(acao) }
  }

  const apelidoPorMonitor = (id: number) => {
    const p = processos.find((x) => x.id === id)
    if (!p) return tx("Processo #{0}", id)
    return p.apelido || formatCNJ(p.numero_cnj)
  }

  const lista = eventos ?? []
  const temNaoLidos = lista.some((e) => !e.lido_em)

  return (
    <section className="cartao">
      <div className="secao-cabecalho">
        <h3 className="secao-titulo"> {tx("Linha do tempo")} {monitorId && <span className="texto-suave"> · {apelidoPorMonitor(monitorId)}</span>}
        </h3>
        <div className="monitor-timeline-acoes">
          <label className="check-inline">
            <input type="checkbox" checked={apenasNaoLidos} onChange={(e) => setApenasNaoLidos(e.target.checked)} />
            <span>{tx("Só não lidos")}</span>
          </label>
          {temNaoLidos && (
            <button type="button" className="botao botao-fantasma botao-pequeno" onClick={marcarTodos}>
              <Icone nome="visto" tamanho={15} /> {tx("Marcar todos lidos")} </button>
          )}
        </div>
      </div>

      {erro && <p className="alerta alerta-erro" role="alert">{tx(erro)}{' '}<button type="button" className="botao-texto" onClick={() => void carregar()}>{t('Tentar novamente', 'Try again')}</button></p>}

      {eventos === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-linha" />
          <div className="esqueleto esqueleto-linha" />
        </div>
      )}

      {eventos !== null && lista.length === 0 && (
        <div className="estado-vazio compacto">
          <div className="estado-vazio-arte" aria-hidden="true">
            <Icone nome="sino" tamanho={44} traco={1.3} />
          </div>
          <p>
            {apenasNaoLidos
              ? tx("Nenhum evento não lido — você está em dia.")
              : tx("Nenhuma movimentação registrada ainda. Use “verificar agora” num processo para buscar novidades.")}
          </p>
        </div>
      )}

      {lista.length > 0 && (
        <ul className="monitor-timeline">
          {lista.map((ev) => {
            // Fase 5 — alerta jurídico gerado por IA na varredura do monitor:
            // ganha borda/ícone próprios além da criticidade normal.
            const ehAlertaJuridico = ev.tipo === 'alerta_juridico'
            return (
              <li
                key={ev.id}
                className={`evento-item ${classeImportancia(ev.importancia)}${
                  ehAlertaJuridico ? ' evento-alerta-juridico' : ''
                }${ev.lido_em ? ' lido' : ''}`}
              >
                <span className="evento-marca" aria-hidden="true" />
                <div className="evento-conteudo">
                  <div className="evento-topo">
                    <span className={`status-pill importancia-${ev.importancia ?? 'normal'}`}>
                      {tx(IMPORTANCIA_LABEL[ev.importancia ?? 'normal'] ?? ev.importancia)}
                    </span>
                    {ehAlertaJuridico && (
                      <span className="status-pill evento-alerta-pill">
                        <Icone nome="casos" tamanho={15} /> {tx("Análise jurisprudencial (IA)")} </span>
                    )}
                    <span className="evento-processo">{apelidoPorMonitor(ev.monitor_id)}</span>
                    {ev.data_evento && <span className="evento-data">{formatDataHora(ev.data_evento, idioma)}</span>}
                    {!ev.lido_em && (
                      <button type="button" className="botao-texto evento-marcar" onClick={() => marcarLido(ev)}> {tx("marcar lido")} </button>
                    )}
                  </div>
                  <strong className="evento-titulo">{ev.titulo}</strong>
                  {ev.descricao && <p className="evento-descricao">{ev.descricao}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Card de processo monitorado                                         */
/* ------------------------------------------------------------------ */

function CardProcesso({
  proc,
  selecionado,
  aoSelecionar,
  aoVerificar,
  aoRemover,
  verificando,
  removendo,
}: {
  proc: MonitorProcesso
  selecionado: boolean
  aoSelecionar: () => void
  aoVerificar: () => void
  aoRemover: () => void
  verificando: boolean
  removendo: boolean
}) {
  const { idioma } = useIdioma()
  const tx = useTextoEscritorio()
  const naoLidos = proc.eventos_nao_lidos ?? 0
  return (
    <div className={selecionado ? 'monitor-card selecionado' : 'monitor-card'}>
      <button type="button" className="monitor-card-corpo" onClick={aoSelecionar}>
        <div className="monitor-card-topo">
          <strong className="monitor-card-apelido">{proc.apelido || formatCNJ(proc.numero_cnj)}</strong>
          <span className={`status-pill ${PRIORIDADE_CLASSE[proc.prioridade ?? 'media'] ?? 'prioridade-media'}`}>
            {tx(PRIORIDADE_LABEL[proc.prioridade ?? 'media'] ?? proc.prioridade)}
          </span>
        </div>
        <code className="monitor-card-cnj">{formatCNJ(proc.numero_cnj)}</code>
        <div className="monitor-card-meta">
          {proc.tribunal && <span className="monitor-tribunal">{proc.tribunal}</span>}
          <span>
            {proc.ultima_consulta_em ? tx("verificado {0}", tempoRelativo(proc.ultima_consulta_em, idioma)) : 'nunca verificado'}
          </span>
          {naoLidos > 0 && <span className="monitor-badge-naolidos">{naoLidos} {tx("novo")}{naoLidos > 1 ? 's' : ''}</span>}
        </div>
      </button>
      <div className="monitor-card-acoes">
        <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoVerificar} disabled={verificando}>
          {verificando ? (
            tx("Verificando…")
          ) : (
            <>
              <Icone nome="loop" tamanho={15} /> {tx("Verificar agora")} </>
          )}
        </button>
        <button type="button" className="botao-texto perigo" disabled={removendo} onClick={aoRemover}> {tx("remover")} </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Aba principal                                                       */
/* ------------------------------------------------------------------ */

export function MonitorTab({ orgId, slug }: { orgId: number; slug: string }) {
  return <MonitorConteudo key={`${orgId}:${slug}:${getSessionIdentity()}`} orgId={orgId} slug={slug} />
}

function MonitorConteudo({ orgId, slug }: { orgId: number; slug: string }) {
  const { t } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const [processos, setProcessos] = useState<MonitorProcesso[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [adicionando, setAdicionando] = useState(false)
  const [selecionado, setSelecionado] = useState<number | null>(null)
  const [verificandoId, setVerificandoId] = useState<number | null>(null)
  const [removendoId, setRemovendoId] = useState<number | null>(null)
  const [atualizacaoEventos, setAtualizacaoEventos] = useState(0)
  const sessaoRef = useRef(getSessionIdentity())
  const vivoRef = useRef(true)
  const leituraRef = useRef<AbortController | null>(null)
  const removendoRef = useRef(false)
  const verificandoRef = useRef(false)
  const { confirmar, dialogo } = useConfirmacao(`${sessaoRef.current}:${orgId}:${slug}`)
  const telaAtual = useCallback(() => vivoRef.current && getSessionIdentity() === sessaoRef.current, [])
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; leituraRef.current?.abort() } }, [])

  const carregar = useCallback(async () => {
    if (!telaAtual()) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    const atual = () => telaAtual() && !controller.signal.aborted
    try {
      const data = await api.get<unknown>(`/predios/${orgId}/${slug}/monitor/processos`, controller.signal)
      if (!atual()) return
      setProcessos(asList<MonitorProcesso>(data, 'processos', 'itens'))
      setErro(null)
    } catch (e) {
      if (atual()) setErro(e instanceof ApiError ? e.detail : tx("Não foi possível carregar os processos monitorados."))
    }
  }, [orgId, slug, telaAtual, tx])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function verificar(proc: MonitorProcesso) {
    if (!telaAtual() || verificandoRef.current) return
    verificandoRef.current = true
    setVerificandoId(proc.id)
    try {
      const res = await api.post<{ novos_eventos?: EventoProcesso[] }>(
        `/predios/${orgId}/${slug}/monitor/processos/${proc.id}/verificar`,
      )
      if (!telaAtual()) return
      setAtualizacaoEventos(atual => atual + 1)
      const novos = res?.novos_eventos?.length ?? 0
      if (novos > 0) {
        sucesso(tx("{0} nova(s) movimentação(ões) em “{1}”.", novos, proc.apelido || formatCNJ(proc.numero_cnj)))
      } else {
        sucesso(tx("Nenhuma movimentação nova por enquanto."))
      }
      await carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : tx("Não foi possível verificar o processo agora."))
    } finally {
      verificandoRef.current = false
      if (telaAtual()) setVerificandoId(null)
    }
  }

  async function remover(proc: MonitorProcesso) {
    if (!telaAtual() || removendoRef.current) return
    if (!await confirmar({ titulo: t('Parar de monitorar processo', 'Stop monitoring case'), mensagem: tx("Parar de monitorar “{0}”? Os eventos serão descartados.", proc.apelido || formatCNJ(proc.numero_cnj)), acao: t('Parar de monitorar', 'Stop monitoring') }) || !telaAtual() || removendoRef.current) return
    removendoRef.current = true
    setRemovendoId(proc.id)
    try {
      await api.del(`/predios/${orgId}/${slug}/monitor/processos/${proc.id}`)
      if (!telaAtual()) return
      sucesso(tx("Processo removido do monitor."))
      setSelecionado(atual => atual === proc.id ? null : atual)
      setAtualizacaoEventos(atual => atual + 1)
      await carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : tx("Não foi possível remover o processo."))
    } finally { removendoRef.current = false; if (telaAtual()) setRemovendoId(null) }
  }

  const lista = processos ?? []

  return (
    <div className="monitor">
      {dialogo}
      <div className="casos-barra monitor-barra">
        <div>
          <h2 className="secao-titulo">{tx("Monitor de processos")}</h2>
          <p className="texto-suave">{tx("Acompanhe movimentações na base pública (DataJud) e receba a linha do tempo por processo.")}</p>
        </div>
        {!adicionando && (
          <button type="button" className="botao botao-primario" onClick={() => setAdicionando(true)}>
            <Icone nome="mais" tamanho={15} /> {tx("Adicionar processo")} </button>
        )}
      </div>

      {adicionando && (
        <AdicionarProcesso
          orgId={orgId}
          slug={slug}
          aoCancelar={() => setAdicionando(false)}
          aoAdicionar={(p) => {
            setAdicionando(false)
            setProcessos((prev) => (prev ? [p, ...prev.filter((x) => x.id !== p.id)] : [p]))
            setSelecionado(p.id)
          }}
        />
      )}

      {erro && <p className="alerta alerta-erro" role="alert">{tx(erro)}{' '}<button type="button" className="botao-texto" onClick={() => void carregar()}>{t('Tentar novamente', 'Try again')}</button></p>}

      <div className="monitor-layout">
        <div className="monitor-processos">
          {processos === null && !erro && (
            <div aria-hidden="true">
              <div className="esqueleto esqueleto-card" />
              <div className="esqueleto esqueleto-card" />
            </div>
          )}

          {processos !== null && lista.length === 0 && !adicionando && (
            <div className="estado-vazio compacto">
              <div className="estado-vazio-arte" aria-hidden="true">
                <Icone nome="monitor" tamanho={44} traco={1.3} />
              </div>
              <h2>{tx("Nenhum processo monitorado")}</h2>
              <p>{tx("Adicione um número CNJ para acompanhar as movimentações automaticamente.")}</p>
            </div>
          )}

          {lista.length > 0 && (
            <>
              {selecionado !== null && (
                <button type="button" className="botao-texto monitor-ver-todos" onClick={() => setSelecionado(null)}> {tx("← Ver eventos de todos os processos")} </button>
              )}
              {lista.map((p) => (
                <CardProcesso
                  key={p.id}
                  proc={p}
                  selecionado={selecionado === p.id}
                  verificando={verificandoId === p.id}
                  removendo={removendoId !== null}
                  aoSelecionar={() => setSelecionado((atual) => (atual === p.id ? null : p.id))}
                  aoVerificar={() => verificar(p)}
                  aoRemover={() => remover(p)}
                />
              ))}
            </>
          )}
        </div>

        <div className="monitor-eventos">
          <TimelineEventos
            orgId={orgId}
            slug={slug}
            monitorId={selecionado}
            processos={lista}
            aoLerEvento={carregar}
            atualizacao={atualizacaoEventos}
          />
        </div>
      </div>
    </div>
  )
}
