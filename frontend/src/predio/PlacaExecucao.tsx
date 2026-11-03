import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { api, asList, getSessionIdentity } from '../lib/api'
import { wsClient } from '../lib/ws'
import { formatDuracao, msDesde } from '../lib/format'
import { Icone } from '../components/Icone'
import { resumoTool, semPrefixoWorkspace, ultimaFrase, type LinhaLog } from './log-agente'
import { JobStream } from '../components/predio/JobStream'
import type { Job, JobEvent, WsJobEvent, WsJobStatus } from '../lib/types'
import { useIdioma } from '../lib/i18n'
import { orientacaoFalha } from '../lib/falhasTrabalho'

/* =============================================================
   PlacaExecucao — o letreiro vivo sobre o escritório da doca:
   TÍTULO da tarefa em execução, BARRA de progresso (marcadores
   `PROGRESSO: N% — …` que os agentes emitem no próprio texto —
   instrução appendada no claim) e a última linha do LOG ao vivo.
   Isolado num componente próprio: o cronômetro de 1s re-renderiza
   só a placa, nunca a shell inteira (o diorama WebGL agradece).
   ============================================================= */

/** Marcador de avanço no texto do agente: `PROGRESSO: 40% — research fechado`. */
const RE_PROGRESSO = /PROGRESSO:\s*(\d{1,3})\s*%\s*(?:[—–-]\s*)?(.*)/i

interface Progresso {
  pct: number
  rotulo: string | null
}

type LogPlaca = LinhaLog & { ingles?: string; ferramenta?: string; resumo?: string }

function umaLinha(texto: string, max = 140): string {
  return texto.replace(/\s+/g, ' ').trim().slice(0, max)
}

/* A dispensa de uma falha precisa sobreviver ao F5: o job fica 'failed' por
   2 horas na janela do buscar(), e uma dispensa só em memória ressuscitava o
   cartão a cada recarga — o dono clicava "ok, entendi" e ele voltava. */
const chaveFalhasOk = (orgId: number, slug: string) => `offiz:falhas-ok:${orgId}:${slug}`

function carregarFalhasOk(orgId: number, slug: string): Set<number> {
  try {
    const bruto = localStorage.getItem(chaveFalhasOk(orgId, slug))
    const lista: unknown = bruto ? JSON.parse(bruto) : []
    return new Set(Array.isArray(lista) ? lista.filter((n): n is number => typeof n === 'number') : [])
  } catch {
    return new Set()
  }
}

function salvarFalhasOk(orgId: number, slug: string, ids: Set<number>) {
  try {
    localStorage.setItem(chaveFalhasOk(orgId, slug), JSON.stringify([...ids].slice(-30)))
  } catch {
    // storage cheio ou bloqueado: a dispensa vale ao menos até recarregar
  }
}

/** O replay GET /jobs/{id}/events às vezes devolve payload como STRING JSON —
 *  mesmo contorno do useJobStream (consumir cru quebra o agrupador). */
function normalizarPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'string') {
    try {
      const p = JSON.parse(payload)
      return p && typeof p === 'object' ? p : {}
    } catch {
      return { texto: payload }
    }
  }
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

/** O histórico de eventos do job seguido, para o painel "ver cada passo":
 *  replay do GET (o log sobrevive a recarregar a página) + WS ao vivo, com
 *  merge idempotente por seq — o mesmo desenho do useJobStream, sem o reducer
 *  de cena que vinha junto. O replay também restaura a porcentagem ao abrir
 *  o app; só o diário expandido monta os detalhes no DOM. */
function useEventosDoJob(orgId: number, slug: string, jobId: number | null, ativo: boolean) {
  const [eventos, setEventos] = useState<JobEvent[]>([])
  const replayProntoRef = useRef(false)
  const bufferRef = useRef<JobEvent[]>([])
  const seqVistosRef = useRef<Set<number>>(new Set())
  const jobIdRef = useRef<number | null>(jobId)
  jobIdRef.current = jobId

  useEffect(() => {
    if (!ativo || !jobId) {
      setEventos([])
      seqVistosRef.current = new Set()
      return
    }
    let vivo = true
    replayProntoRef.current = false
    bufferRef.current = []
    seqVistosRef.current = new Set()
    setEventos([])

    const acomodar = (brutos: JobEvent[]) => {
      const juntos = [...brutos, ...bufferRef.current].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      const unicos: JobEvent[] = []
      for (const ev of juntos) {
        const seq = ev.seq ?? -1
        if (seq >= 0) {
          if (seqVistosRef.current.has(seq)) continue
          seqVistosRef.current.add(seq)
        }
        unicos.push(ev)
      }
      bufferRef.current = []
      replayProntoRef.current = true
      // Teto de memória: um job de 1h emite milhares de eventos e o diário
      // inteiro vivo no DOM foi suspeito nos congelamentos de 26/08 — os
      // últimos 500 contam a história; o restante fica no servidor.
      setEventos(unicos.slice(-500))
    }

    api
      .get<unknown>(`/jobs/${jobId}/events`)
      .then((data) => {
        if (!vivo) return
        acomodar(
          asList<JobEvent>(data, 'events', 'eventos').map((e) => ({
            ...e,
            payload: normalizarPayload(e.payload),
          })),
        )
      })
      .catch(() => {
        // Eventos podem ainda não existir; libera o buffer mesmo assim.
        if (vivo) acomodar([])
      })
    return () => {
      vivo = false
    }
  }, [ativo, jobId])

  useEffect(() => {
    if (!ativo) return
    const off = wsClient.on('job_event', (msg) => {
      const ev = msg as WsJobEvent
      if (ev.org_id !== orgId || ev.office_slug !== slug) return
      // Filtro por job: com dois jobs no mesmo prédio, as linhas se misturavam
      // — e sem job seguido, nada entra (aceitar tudo poluía o diário).
      if (!jobIdRef.current || ev.job_id !== jobIdRef.current) return
      const evento: JobEvent = { seq: ev.seq, tipo: ev.tipo, payload: normalizarPayload(ev.payload) }
      if (!replayProntoRef.current) {
        bufferRef.current.push(evento)
        return
      }
      const seq = evento.seq ?? -1
      if (seq >= 0) {
        if (seqVistosRef.current.has(seq)) return
        seqVistosRef.current.add(seq)
      }
      setEventos((prev) => {
        const arr = [...prev, evento]
        return arr.length > 500 ? arr.slice(-500) : arr
      })
    })
    return off
  }, [ativo, orgId, slug])

  return eventos
}

interface PlacaProps {
  orgId: number
  slug: string
  emAndamento?: number
  pendentes: number
  aoAbrirEntregas: (jobId?: number) => void
  /** O acompanhamento da área pode mostrar pedidos de outras conversas. */
  contextoAtividade?: { empresa: string; area: string }
  /** undefined: área inteira; null: conversa nova/abrindo, sem acompanhamento. */
  conversaId?: number | null
}

export function PlacaExecucao(props: PlacaProps) {
  const escopo = props.conversaId === undefined ? 'area' : props.conversaId ?? 'nova'
  return <PlacaDaArea key={`${props.orgId}:${props.slug}:${escopo}`} {...props} />
}

function PlacaDaArea({
  orgId,
  slug,
  emAndamento,
  pendentes,
  aoAbrirEntregas,
  contextoAtividade,
  conversaId,
}: PlacaProps) {
  const escopoPermitido = conversaId === undefined || (conversaId != null && Number.isSafeInteger(conversaId) && conversaId > 0)
  // A tarefa SEGUIDA pela placa: a primeira em execução (senão a 1ª da fila).
  const [job, setJob] = useState<Job | null>(null)
  // Progresso por job (nunca regride — o maior marcador visto vence).
  const [progresso, setProgresso] = useState<Record<number, Progresso>>({})
  const { t: tr, idioma } = useIdioma()
  const [logBruto, setLog] = useState<LogPlaca | null>(null)
  const log = logBruto?.ferramenta
    ? resumoTool(logBruto.ferramenta, logBruto.resumo || '', idioma)
    : logBruto ? { ...logBruto, texto: idioma === 'en' && logBruto.ingles ? logBruto.ingles : logBruto.texto } : null
  // Tarefa que FALHOU recentemente. Sem isto ela sumia da tela sem uma palavra:
  // `emAndamento` zera, a placa retorna null e a página volta ao estado inicial
  // como se nada tivesse acontecido — o único sinal era o sino, com erro cru.
  const [falhou, setFalhou] = useState<Job | null>(null)
  const [verErro, setVerErro] = useState(false)
  // "⏯ continuar": cria a corrida de continuação (o backend preserva o
  // parcial e monta o prompt com o pedido original) — só existe no cartão de
  // FALHA, ou seja, só para tarefa que não terminou.
  const [continuando, setContinuando] = useState(false)
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [ativos, setAtivos] = useState<Job[]>([])
  const [cancelandoId, setCancelandoId] = useState<number | null>(null)
  const cancelandoRef = useRef(false)
  const [confirmarParada, setConfirmarParada] = useState<Job | null>(null)
  const origemParadaRef = useRef<HTMLButtonElement | null>(null)
  const manterTrabalhoRef = useRef<HTMLButtonElement | null>(null)
  const grupoRef = useRef<HTMLDivElement | null>(null)
  const ultimosJobsRef = useRef(new Map<number, Job>())
  const consultaAtividadeRef = useRef(0)
  const atualizarAtividadeRef = useRef<() => void>(() => undefined)
  const vivaRef = useRef(true)
  useEffect(() => { vivaRef.current = true; return () => { vivaRef.current = false } }, [])
  useEffect(() => {
    if (confirmarParada) manterTrabalhoRef.current?.focus()
    else if (origemParadaRef.current) {
      if (origemParadaRef.current.isConnected) origemParadaRef.current.focus()
      else grupoRef.current?.focus()
      origemParadaRef.current = null
    }
  }, [confirmarParada])
  // Falhas que o usuário já dispensou: sem isto o cartão voltava no próximo
  // job_status (o job continua 'failed' dentro da janela de 2h), então "ok,
  // entendi" durava até o próximo evento do prédio. Persistido em localStorage
  // — em memória a dispensa morria no F5 e o cartão voltava por 2 horas.
  const dispensadas = useRef<Set<number>>(carregarFalhasOk(orgId, slug))
  useEffect(() => {
    dispensadas.current = carregarFalhasOk(orgId, slug)
  }, [orgId, slug])
  // A PILHA de falhas vivas do último poll: é o que "ok, entendi" limpa de
  // uma vez (dispensar id a id era whack-a-mole com tentativas idênticas).
  const falhasVivasRef = useRef<number[]>([])
  // Execuções que o dono ESCONDEU (botão "dispensar"). Sem isto, o dispensar
  // durava segundos: o poll relia a lista e devolvia a mesma tarefa à tela.
  // Some sozinho quando a tarefa acaba — é o id que está escondido, não a
  // placa, então a PRÓXIMA tarefa aparece normalmente.
  const [escondidas, setEscondidas] = useState<Set<number>>(new Set())
  const escondidasRef = useRef<Set<number>>(escondidas)
  escondidasRef.current = escondidas
  // Quantas estão rodando/na fila AGORA — alimenta o botão de "voltar a ver",
  // que só existe enquanto houver trabalho acontecendo. (Nome diferente do
  // `rodandoAgora` lá embaixo, que é um booleano sobre a tarefa SEGUIDA.)
  const [totalEmAndamento, setTotalEmAndamento] = useState(0)
  const jobRef = useRef<Job | null>(null)
  jobRef.current = job
  // Painel "ver cada passo": o log completo do trabalho, agente por agente.
  const [verPassos, setVerPassos] = useState(false)
  const verPassosRef = useRef(false)
  verPassosRef.current = verPassos
  const detalhesId = useId()
  const eventos = useEventosDoJob(orgId, slug, job?.id ?? null, !!job)
  const progressoReposto = useMemo(() => {
    let maior: Progresso | undefined
    const texto = eventos.filter((ev) => ev.tipo === 'agent_text')
      .map((ev) => typeof ev.payload?.texto === 'string' ? ev.payload.texto : '').join('')
    for (const m of texto.matchAll(/PROGRESSO:\s*(\d{1,3})\s*%\s*(?:[—–-]\s*)?([^\r\n]*?)(?=PROGRESSO:|[\r\n]|$)/gi)) {
      const pct = Math.min(100, Math.max(0, Number(m[1])))
      if (!maior || pct >= maior.pct) maior = { pct, rotulo: umaLinha(m[2] || '', 90) || null }
    }
    return maior
  }, [eventos])

  const temExecucao = (emAndamento ?? totalEmAndamento) > 0 || ativos.some(j => j.finalizando) || job?.finalizando === true

  // ---- Qual tarefa está rodando (título/quando começou) ----
  useEffect(() => {
    if (!escopoPermitido) return
    // Com "ver cada passo" aberto, o fim da execução NÃO derruba a placa:
    // sumir com o diário no instante em que o trabalho acaba era a pessoa
    // nunca ver o "Tarefa concluída" — a mesma lição da falha que "sumia
    // sem uma palavra".
    if (!temExecucao && !verPassosRef.current) {
      setJob(null)
      setLog(null)
      setProgresso({})
    }
    let vivo = true
    const buscar = () => {
      const consulta = ++consultaAtividadeRef.current
      api
        .get<unknown>(`/predios/${orgId}/${slug}/atividade${conversaId === undefined ? '' : `?conversa_id=${conversaId}`}`)
        .then((d) => {
          if (!vivo || consulta !== consultaAtividadeRef.current) return
          const jobs = asList<Job>(d, 'jobs').filter(j => conversaId === undefined || j.conversa_id === conversaId)
          ultimosJobsRef.current = new Map(jobs.map(j => [j.id, j]))
          const rodando = jobs.filter((j) => j.status === 'running' || j.finalizando)
          const fila = jobs.filter((j) => j.status === 'queued')
          setAtivos([...rodando, ...fila].sort((a, b) => a.status === b.status ? a.id - b.id : a.status === 'running' ? -1 : 1))
          setTotalEmAndamento(rodando.length + fila.length)
          // A escondida é PULADA, não some da contagem: o botão continua
          // dizendo quantas existem, e a placa segue a próxima que aparecer.
          const visivel = (j: Job) => !escondidasRef.current.has(j.id)
          const seguido = emAndamento == null || temExecucao || rodando.some(j => j.finalizando)
            ? (rodando.find(visivel) ?? fila.find(visivel) ?? null)
            : null
          // Falha das últimas 2h: some sozinha depois, mas não some em silêncio.
          const falhasRecentes = jobs.filter(
            (j) =>
              j.status === 'failed' &&
              !dispensadas.current.has(j.id) &&
              j.finalizado_em &&
              Date.now() - new Date(j.finalizado_em).getTime() < 2 * 60 * 60 * 1000,
          )
          // FALHA CUMPRIDA DEPOIS NÃO É PENDÊNCIA (24/08/2026, o dono numa
          // pilha de fósseis): se um job POSTERIOR da MESMA CONVERSA terminou
          // 'done', aquela tentativa falhada virou história — a retomada fez
          // o trabalho. O cartão se auto-resolve em vez de cobrar um "ok" por
          // cadáver.
          const cumpridaDepois = (j: Job) =>
            j.conversa_id != null &&
            jobs.some(
              (o) =>
                o.id !== j.id &&
                o.status === 'done' &&
                o.conversa_id === j.conversa_id &&
                !!o.finalizado_em && !!j.finalizado_em &&
                new Date(o.finalizado_em) > new Date(j.finalizado_em),
            )
          const vivas = falhasRecentes.filter((j) => !cumpridaDepois(j))
          falhasVivasRef.current = vivas.map((j) => j.id)
          setFalhou(vivas[0] ?? null)
          setJob((prev) => {
            if (seguido) {
              return prev && prev.id === seguido.id && prev.status === seguido.status
                ? prev
                : seguido
            }
            // Sem execução mas com o painel aberto: segura o job e atualiza
            // para o status FINAL (o JobStream mostra "Tarefa concluída").
            if (verPassosRef.current && prev) {
              const final = jobs.find((j) => j.id === prev.id)
              return final ?? prev
            }
            return null
          })
        })
        .catch(() => undefined)
    }
    atualizarAtividadeRef.current = buscar
    buscar()
    const timer = window.setInterval(() => { if (!document.hidden) buscar() }, 10000)
    const off = wsClient.on('job_status', (msg) => {
      const st = msg as WsJobStatus
      if (st.org_id === orgId && st.office_slug === slug) buscar()
    })
    return () => {
      vivo = false
      if (atualizarAtividadeRef.current === buscar) atualizarAtividadeRef.current = () => undefined
      window.clearInterval(timer)
      off()
    }
    // "Voltar a ver" atualiza imediatamente. O poll recupera eventos perdidos
    // quando o socket reconecta; não depende das estatísticas da shell antiga.
  }, [orgId, slug, conversaId, escopoPermitido, temExecucao, emAndamento, escondidas])

  // ---- Log ao vivo + marcadores de progresso (eventos do prédio) ----
  useEffect(() => {
    setLog(null)
    setProgresso({})
    const off = wsClient.on('job_event', (msg) => {
      const ev = msg as WsJobEvent
      if (ev.org_id !== orgId || ev.office_slug !== slug) return
      if (conversaId !== undefined && !jobRef.current) return
      // Com dois trabalhos no mesmo prédio, o log de um vazava para o título
      // do outro ("gerando a newsletter" embaixo de "Post do Instagram").
      if (jobRef.current && ev.job_id !== jobRef.current.id) return
      const p = ev.payload || {}
      let texto =
        typeof p.texto === 'string' ? p.texto : typeof p.text === 'string' ? p.text : ''
      // Antes só `texto` entrava, então tool_use/subagente/entrega eram jogados
      // fora e a placa mostrava um fragmento cru de streaming (às vezes com
      // caminho de servidor). As traduções de leigo já existiam em
      // office-state — aqui elas passam a ser usadas.
      if (!texto) {
        if (ev.tipo === 'tool_use') {
          const ferramenta = typeof p.ferramenta === 'string' ? p.ferramenta : ''
          const resumo = typeof p.resumo === 'string' ? p.resumo : ''
          if (ferramenta) setLog({ texto: '', ferramenta, resumo })
          return
        }
        if (ev.tipo === 'subagente') {
          const acao = typeof p.acao === 'string' ? p.acao : ''
          setLog({
            icone: 'pessoa',
            texto: acao === 'stop' ? 'Especialista concluiu.' : 'Um especialista entrou em cena.',
            ingles: acao === 'stop' ? 'The specialist finished.' : 'A specialist started working.',
          })
          return
        }
        if (ev.tipo === 'entrega_registrada') {
          const nome = typeof p.nome === 'string' ? p.nome : ''
          setLog({ icone: 'entregas', texto: nome ? `${nome} ficou pronto` : 'uma peça ficou pronta', ingles: nome ? `${nome} is ready` : 'a deliverable is ready' })
          return
        }
        return
      }
      texto = semPrefixoWorkspace(texto)
      // Marcadores PROGRESSO: N% — pega o ÚLTIMO do lote e nunca regride.
      let m: RegExpMatchArray | null = null
      for (const linha of texto.split('\n')) {
        const tenta = linha.match(RE_PROGRESSO)
        if (tenta) m = tenta
      }
      if (m) {
        const pct = Math.min(100, Math.max(0, Number(m[1])))
        const rotulo = umaLinha(m[2] ?? '', 90) || null
        setProgresso((prev) => {
          const atual = prev[ev.job_id]
          if (atual && atual.pct >= pct) return prev
          return { ...prev, [ev.job_id]: { pct, rotulo } }
        })
      }
      // Log: a última linha "de verdade" (sem o próprio marcador cru).
      const linhas = texto
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !RE_PROGRESSO.test(l))
      const ultima = linhas[linhas.length - 1]
      // ultimaFrase evita mostrar meia frase de um delta de streaming.
      // Prosa do agente: entra SEM ícone (ver LinhaLog) — o que ele diz não
      // tem um "tipo de ação" para sinalizar.
      if (ultima) setLog({ texto: umaLinha(ultimaFrase(ultima) || ultima) })
    })
    return off
  }, [orgId, slug, conversaId])

  // A última linha de um trabalho não pertence ao próximo.
  useEffect(() => {
    setLog(null)
  }, [job?.id])

  // ---- Cronômetro (1s) enquanto a tarefa seguida está em execução ----
  const rodandoAgora = job?.status === 'running'
  const concluido = job?.status === 'done' && !job.finalizando
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!rodandoAgora) return
    const t = window.setInterval(() => {
      // Aba escondida não redesenha o cronômetro (guard de Page Visibility):
      // o re-render por segundo em 2º plano era candidato a congelar o
      // renderer nas sessões longas.
      if (!document.hidden) setTick((v) => v + 1)
    }, 1000)
    return () => window.clearInterval(t)
  }, [rodandoAgora, job?.id])

  // Escondeu tudo, mas ainda há trabalho: em vez de sumir, vira um botão.
  const escondeuComTrabalho = !job && temExecucao && escondidas.size > 0

  function fecharConfirmacao() {
    if (cancelandoRef.current) return
    setConfirmarParada(null)
  }

  async function cancelar(alvo: Job) {
    if (cancelandoRef.current) return
    const atual = ultimosJobsRef.current.get(alvo.id)
    if (!atual || !['queued', 'running'].includes(atual.status)) return
    cancelandoRef.current = true
    setCancelandoId(alvo.id)
    setErroAcao(null)
    try {
      await api.post(`/jobs/${alvo.id}/cancelar`, {})
      if (!vivaRef.current) return
      // Uma leitura iniciada antes do aceite não pode ressuscitar o job.
      // A consulta nova recupera também mudanças legítimas dos outros trabalhos.
      consultaAtividadeRef.current += 1
      setAtivos(items => items.filter(item => item.id !== alvo.id))
      const aindaAtivo = ['queued', 'running'].includes(ultimosJobsRef.current.get(alvo.id)?.status || '')
      if (aindaAtivo) setTotalEmAndamento(total => Math.max(0, total - 1))
      ultimosJobsRef.current.set(alvo.id, { ...alvo, status: 'cancelled' })
      setJob(current => current?.id === alvo.id ? null : current)
      setConfirmarParada(null)
      grupoRef.current?.focus()
      atualizarAtividadeRef.current()
    } catch {
      if (vivaRef.current) setErroAcao(tr(`Não foi possível parar “${alvo.titulo || `Tarefa #${alvo.id}`}”. Confira o estado e tente novamente.`, `Could not stop “${alvo.titulo || `Task #${alvo.id}`}”. Check its status and try again.`))
    } finally { cancelandoRef.current = false; if (vivaRef.current) setCancelandoId(null) }
  }

  if (!escopoPermitido || (!temExecucao && pendentes === 0 && !falhou && !(verPassos && job) && !confirmarParada && !erroAcao)) return null
  const estadoParada = confirmarParada ? ultimosJobsRef.current.get(confirmarParada.id)?.status : undefined
  const podeParar = estadoParada === 'running' || estadoParada === 'queued'

  const aoVivo = job ? progresso[job.id] : undefined
  const prog = progressoReposto && (!aoVivo || progressoReposto.pct > aoVivo.pct) ? progressoReposto : aoVivo
  const ms = job ? msDesde(job.iniciado_em || job.criado_em) : null
  const decorrido = rodandoAgora && ms !== null ? formatDuracao(ms, idioma) : null
  const outras = Math.max(0, (emAndamento ?? totalEmAndamento) - 1)

  return (
    <div className="doca-placa-grupo" ref={grupoRef} tabIndex={-1}>
      {contextoAtividade && <div className="atividade-empresa-contexto">
        <strong>{conversaId === undefined ? tr('Pedidos da empresa', 'Organization requests') : tr('Pedidos desta conversa', 'Requests in this conversation')}</strong>
        <span>{contextoAtividade.empresa} · {contextoAtividade.area}</span>
        {conversaId === undefined && <small>{tr('Este acompanhamento pode incluir pedidos de outras conversas.', 'This activity may include requests from other conversations.')}</small>}
      </div>}
      {erroAcao && <p role="alert">{erroAcao} <button type="button" className="botao-texto" onClick={() => setErroAcao(null)}>{tr('Fechar aviso', 'Dismiss notice')}</button></p>}
      {confirmarParada && <section className="doca-confirmar-parada" role="dialog" aria-label={tr('Confirmar parada do trabalho', 'Confirm stopping the task')}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); fecharConfirmacao() } }}>
        <strong>{tr('Parar este trabalho?', 'Stop this task?')}</strong>
        <p>{confirmarParada.titulo || tr(`Tarefa #${confirmarParada.id}`, `Task #${confirmarParada.id}`)} · #{confirmarParada.id}</p>
        <p role="status">{estadoParada === 'running' ? tr('Em produção', 'Running') : estadoParada === 'queued' ? tr('Na fila', 'Queued') : estadoParada === 'done' ? tr('Este trabalho já foi concluído.', 'This task has already finished.') : estadoParada === 'cancelled' ? tr('Este trabalho já foi parado.', 'This task has already stopped.') : tr('Este trabalho não está mais na fila de produção.', 'This task is no longer in the production queue.')}</p>
        <p>{tr('O que já foi produzido continua salvo nas entregas.', 'Completed work stays saved in Deliverables.')}</p>
        <p>{tr('Se fizer parte de um plano, as próximas etapas que ainda não começaram também serão interrompidas.', 'If this task belongs to a plan, its later steps that have not started will also be stopped.')}</p>
        <div><button ref={manterTrabalhoRef} type="button" className="botao botao-fantasma" disabled={cancelandoId !== null} onClick={fecharConfirmacao}>{tr('Manter trabalho', 'Keep task')}</button>
          <button type="button" className="botao botao-primario" disabled={cancelandoId !== null || !podeParar} onClick={() => void cancelar(confirmarParada)}>{cancelandoId !== null ? tr('Parando…', 'Stopping…') : tr('Parar trabalho', 'Stop task')}</button></div>
      </section>}
      {ativos.length > 1 && <details className="doca-fila papel">
        <summary>{tr('Todos os trabalhos em andamento', 'All active tasks')} · {ativos.length}</summary>
        <ul>{ativos.map(item => <li key={item.id}>
          <span><strong>{item.titulo || tr(`Tarefa #${item.id}`, `Task #${item.id}`)}</strong><small>{item.status === 'queued' ? tr('Na fila', 'Queued') : tr('Em produção', 'Running')}</small></span>
          <button type="button" className="botao-texto" disabled={cancelandoId !== null || confirmarParada !== null} aria-haspopup="dialog" onClick={e => { origemParadaRef.current = e.currentTarget; setConfirmarParada(item) }} aria-label={tr(`Parar ${item.titulo || item.id}`, `Stop ${item.titulo || item.id}`)}>{cancelandoId === item.id ? tr('Parando…', 'Stopping…') : tr('Parar', 'Stop')}</button>
        </li>)}</ul>
      </details>}
      {/* VOLTAR A VER. Dispensar esconde o acompanhamento, mas o trabalho
          continua — e sem esta porta o dono ficava sem saber quantas tarefas
          estão rodando nem como reabrir o diário. Só existe enquanto HÁ
          trabalho: terminando tudo, ele some sozinho. */}
      {escondeuComTrabalho && (
        <button
          type="button"
          /* Classe própria: o balão de "entrega pendente" usa as mesmas
             `doca-balao doca-balao-btn`, e sem um nome distinto os dois viram
             o mesmo alvo — para quem lê o código, para o CSS e para teste. */
          className="doca-balao papel doca-balao-btn doca-balao-voltar"
          onClick={() => setEscondidas(new Set())}
          title={tr('Voltar a acompanhar os pedidos', 'Show request progress again')}
        >
          <span className="doca-balao-led" aria-hidden="true" />
          <span className="doca-balao-texto">
            <strong>
              {totalEmAndamento > 1
                ? tr(`${totalEmAndamento} pedidos em andamento`, `${totalEmAndamento} requests in progress`)
                : tr('1 pedido em andamento', '1 request in progress')}
            </strong>
            <small>{tr('toque para acompanhar', 'tap to follow progress')}</small>
          </span>
        </button>
      )}
      {/* Coral: algo espera o SEU OK — prioridade visual sobre tudo */}
      {pendentes > 0 && (
        <button type="button" className="doca-balao papel needs-you doca-balao-btn" onClick={() => aoAbrirEntregas()}>
          <span className="doca-balao-led" aria-hidden="true" />
          <span className="doca-balao-texto">
            {pendentes === 1
              ? tr('Uma entrega espera o seu OK — abrir Entregas', 'One deliverable awaits your approval — open Deliverables')
              : tr(`${pendentes} entregas esperam o seu OK — abrir Entregas`, `${pendentes} deliverables await your approval — open Deliverables`)}
          </span>
        </button>
      )}

      {/* Coral: a tarefa que não terminou — com o técnico atrás de um clique */}
      {falhou && (
        <div className="doca-placa papel doca-placa-falha" role="status">
          <div className="doca-placa-topo">
            <span className="doca-balao-led" aria-hidden="true" />
            <strong className="doca-placa-titulo">
              {tr('Não consegui terminar', 'I could not finish')} “{falhou.titulo || tr(`Tarefa #${falhou.id}`, `Task #${falhou.id}`)}”
            </strong>
            <span className="doca-placa-tempo">
              <button
                type="button"
                className="botao-texto"
                disabled={continuando}
                onClick={async () => {
                  if (continuando) return
                  const sessao = getSessionIdentity()
                  setContinuando(true)
                  setErroAcao(null)
                  try {
                    const novo = await api.post<Job>(`/jobs/${falhou.id}/continuar`, {})
                    if (!vivaRef.current || getSessionIdentity() !== sessao) return
                    if (novo?.id != null && novo.conversa_id != null) {
                      try {
                        await api.put(`/conversas/${novo.conversa_id}/trabalho`, { job_id: novo.id })
                      } catch { /* a retomada já existe; o evento ainda atualiza a conversa aberta */ }
                      if (!vivaRef.current || getSessionIdentity() !== sessao) return
                      window.dispatchEvent(new CustomEvent('offiz:trabalho-retomado', {
                        detail: { orgId, slug, conversaId: novo.conversa_id, origemId: falhou.id, jobId: novo.id },
                      }))
                    }
                    // A continuação assumiu: o cartão da falha já cumpriu o
                    // papel — dispensa persistida, e a nova corrida aparece
                    // na placa azul pelo job_status.
                    dispensadas.current.add(falhou.id)
                    salvarFalhasOk(orgId, slug, dispensadas.current)
                    setFalhou(null)
                  } catch {
                    if (vivaRef.current && getSessionIdentity() === sessao) setErroAcao(tr('Não foi possível continuar o trabalho. Tente novamente.', 'Could not resume the task. Please try again.'))
                  } finally {
                    if (vivaRef.current && getSessionIdentity() === sessao) setContinuando(false)
                  }
                }}
              >
                {continuando ? (
                  tr('continuando…', 'resuming…')
                ) : (
                  <>
                    <Icone nome="play" tamanho={13} /> {tr('continuar de onde parou', 'resume where it stopped')}
                  </>
                )}
              </button>
              {' · '}
              <button
                type="button"
                className="botao-texto"
                onClick={() => setVerErro((v) => !v)}
              >
                {verErro ? tr('esconder', 'hide') : tr('ver detalhes', 'view details')}
              </button>
              {' · '}
              <button
                type="button"
                className="botao-texto"
                onClick={() => {
                  // "Entendi" é sobre a SITUAÇÃO, não sobre um id: dispensar
                  // uma falha por vez virava whack-a-mole quando várias
                  // tentativas do mesmo pedido falharam em sequência (o dono
                  // clicava e "o mesmo" cartão voltava — era o próximo
                  // fóssil idêntico da pilha). Um clique limpa a pilha.
                  for (const id of falhasVivasRef.current) dispensadas.current.add(id)
                  dispensadas.current.add(falhou.id)
                  salvarFalhasOk(orgId, slug, dispensadas.current)
                  setFalhou(null)
                }}
              >
                {tr('ok, entendi', 'understood')}
              </button>
            </span>
          </div>
          <p className="doca-placa-log">
            {orientacaoFalha(falhou.erro, tr)}{' '}
            {tr('Uma nova execução também consome seu saldo de IA.', 'A new run also consumes your AI balance.')}
          </p>
          {verErro && <pre className="doca-placa-erro">{falhou.erro || tr('sem detalhe técnico', 'no technical details')}</pre>}
        </div>
      )}

      {/* A atividade pertence à área da empresa, não necessariamente à
          conversa aberta. Expandir só revela os eventos da tarefa seguida. */}
      {job && (temExecucao || verPassos) && (
        <div className="doca-placa-conjunto atividade-chat">
          <div className="doca-placa">
            <div className="doca-placa-topo">
              <span className="doca-balao-led" aria-hidden="true" />
              {contextoAtividade
                ? <button type="button" className="doca-placa-titulo botao-texto" aria-label={tr(`Abrir pedido: ${job.titulo || `Tarefa #${job.id}`}`, `Open request: ${job.titulo || `Task #${job.id}`}`)} onClick={() => aoAbrirEntregas(job.id)}>{job.titulo || tr(`Tarefa #${job.id}`, `Task #${job.id}`)}</button>
                : <strong className="doca-placa-titulo">{job.titulo || tr(`Tarefa #${job.id}`, `Task #${job.id}`)}</strong>}
              <span className="atividade-chat-estado">
                {job.finalizando
                  ? tr('Organizando arquivos', 'Organizing files')
                  : rodandoAgora
                  ? tr('Trabalhando', 'Working')
                  : job.status === 'done'
                    ? tr('concluída', 'completed')
                    : job.status === 'failed'
                      ? tr('não terminou', 'not finished')
                      : job.status === 'cancelled'
                        ? tr('cancelada', 'cancelled')
                        : tr('na fila', 'queued')}
                {outras > 0 && ` · +${outras}`}
                {decorrido && <span className="atividade-chat-tempo">{decorrido}</span>}
                {!job.finalizando && (prog || concluido) && (
                  <span className="doca-placa-pct" title={tr('Progresso informado pelo agente', 'Progress reported by the agent')}>
                    {concluido ? 100 : prog?.pct}%
                  </span>
                )}
              </span>
              <span className="doca-placa-tempo">
                <button
                  type="button"
                  className="botao-texto"
                  aria-expanded={verPassos}
                  aria-controls={detalhesId}
                  onClick={() =>
                    setVerPassos((v) => {
                      const novo = !v
                      // Fechou o diário de um trabalho já encerrado: a placa
                      // não tem mais o que segurar.
                      if (!novo && !temExecucao) {
                        setJob(null)
                        setLog(null)
                        setProgresso({})
                      }
                      return novo
                    })
                  }
                >
                  <span aria-hidden="true">{verPassos ? '⌄' : '›'}</span>{' '}
                  {verPassos ? tr('Recolher atividade', 'Collapse activity') : tr('Ver atividade', 'View activity')}
                </button>
                {' · '}
                {/* DISPENSAR: some com a placa AGORA, mesmo com a tarefa
                    rodando. "Fechar os passos" só recolhe o diário e, com o
                    trabalho em andamento, a barra continuava ocupando o topo —
                    quem queria a tela limpa durante uma tarefa de 5 minutos
                    não tinha saída. O trabalho segue: quando terminar, o aviso
                    de entrega chega igual. */}
                <button
                  type="button"
                  className="botao-texto"
                  title={tr('Ocultar o acompanhamento não interrompe o pedido.', 'Hiding progress does not stop the request.')}
                  onClick={() => {
                    setEscondidas((s) => new Set(s).add(job.id))
                    setJob(null)
                    setLog(null)
                    setProgresso({})
                    setVerPassos(false)
                  }}
                >
                  {tr('Ocultar acompanhamento', 'Hide progress')}
                </button>
                {/* PARAR: a tarefa que ninguém consegue interromper vira zumbi
                    até o relógio — na madrugada de 05/09 um job que a nuvem
                    pegou sem crédito ficou 2h "rodando" sem saída na tela. O
                    backend já sabia cancelar (POST /jobs/{id}/cancelar); só
                    não havia porta. Pede confirmação: é irreversível. */}
                {(rodandoAgora || job.status === 'queued') && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="botao-texto"
                      title={tr('Interromper esta tarefa agora (o que já foi salvo fica em Entregas)', 'Stop this task now (saved work remains in Deliverables)')}
                      disabled={cancelandoId !== null || confirmarParada !== null}
                      aria-haspopup="dialog"
                      onClick={e => { origemParadaRef.current = e.currentTarget; setConfirmarParada(job) }}
                    >
                      {tr('parar', 'stop')}
                    </button>
                  </>
                )}
              </span>
            </div>
            <div
              className={`doca-placa-barra ${!job.finalizando && (prog || concluido) ? '' : 'indeterminada'}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.finalizando ? undefined : concluido ? 100 : prog?.pct}
              aria-label={tr('Progresso da tarefa', 'Task progress')}
            >
              <span
                className="doca-placa-fill"
                style={
                  job.finalizando ? undefined : concluido
                    ? { width: '100%' }
                    : prog
                      ? { width: `${prog.pct}%` }
                      : undefined
                }
              />
            </div>
            <span className="doca-placa-log">
              {job.finalizando ? (
                tr('Organizando os arquivos da entrega…', 'Organizing deliverable files…')
              ) : concluido ? (
                tr('Pronto — o resultado está em Entregas.', 'Ready. The result is in Deliverables.')
              ) : prog?.rotulo ? (
                prog.rotulo
              ) : log ? (
                <>
                  {log.icone && (
                    <Icone nome={log.icone} tamanho={14} className="doca-placa-log-icone" />
                  )}
                  {log.texto}
                </>
              ) : (
                tr('Acompanhando o escritório ao vivo…', 'Following the office live…')
              )}
            </span>
          </div>

          {verPassos && (
            <div id={detalhesId} className="doca-placa-passos" role="region" aria-label={tr('Atividade do trabalho', 'Task activity')}>
              <JobStream job={job} eventos={eventos} aoVerEntregas={() => aoAbrirEntregas(job.id)} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
