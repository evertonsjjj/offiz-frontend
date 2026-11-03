import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, getSessionIdentity } from './api'
import { wsClient } from './ws'
import { EVENTO_SALDO_IA_MUDOU } from './saldo-eventos'

export interface ResumoSaldoIA {
  tipo: 'byok' | 'pf_gerenciado'
  vigencia: 'vigente' | 'aguardando_inicio' | 'encerrado'
  periodo: string
  consultado_em: string
  renovacao_em: string | null
  estado: 'conta_propria' | 'disponivel' | 'baixo' | 'esgotado' | 'fora_vigencia'
  limite_brl_mes: number | null
  credito_brl: number | null
  total_brl: number | null
  consumido_brl: number | null
  reservado_brl: number | null
  disponivel_brl: number | null
  percentual_disponivel: number | null
}

function resumoValido(valor: ResumoSaldoIA): boolean {
  if (!valor || !['byok', 'pf_gerenciado'].includes(valor.tipo)
    || !['vigente', 'aguardando_inicio', 'encerrado'].includes(valor.vigencia)
    || !['conta_propria', 'disponivel', 'baixo', 'esgotado', 'fora_vigencia'].includes(valor.estado)
    || typeof valor.consultado_em !== 'string' || !Number.isFinite(Date.parse(valor.consultado_em))) return false
  if (valor.renovacao_em !== null && (typeof valor.renovacao_em !== 'string' || !Number.isFinite(Date.parse(valor.renovacao_em)))) return false
  const quantias = [valor.limite_brl_mes, valor.credito_brl, valor.total_brl, valor.consumido_brl, valor.reservado_brl, valor.disponivel_brl, valor.percentual_disponivel]
  if (valor.tipo === 'byok') return valor.estado === 'conta_propria' && quantias.every(n => n === null)
  return valor.estado !== 'conta_propria' && quantias.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)
    && valor.percentual_disponivel! <= 100
}

export function useSaldoIA(orgId: number) {
  const [sessao, setSessao] = useState(() => getSessionIdentity())
  const [leitura, setLeitura] = useState<{ orgId: number; sessao: string | null; dados: ResumoSaldoIA | null; erro: string; atualizando: boolean }>({ orgId, sessao, dados: null, erro: '', atualizando: true })
  const carregarRef = useRef<(() => void) | null>(null)
  const atualizar = useCallback(() => carregarRef.current?.(), [])
  useEffect(() => {
    const mudou = () => setSessao(getSessionIdentity())
    window.addEventListener('offiz:token-changed', mudou)
    return () => window.removeEventListener('offiz:token-changed', mudou)
  }, [])

  useEffect(() => {
    let ativo = true
    let requisicao: AbortController | null = null
    let repetir = false
    let consultaPendente = false
    let debounce: ReturnType<typeof setTimeout> | undefined
    let ultimaConsulta = 0
    setLeitura({ orgId, sessao, dados: null, erro: '', atualizando: true })
    const vigente = () => ativo && getSessionIdentity() === sessao

    async function carregar() {
      if (!vigente()) return
      if (requisicao) { repetir = true; return }
      const controller = new AbortController()
      requisicao = controller
      setLeitura(anterior => ({ orgId, sessao, dados: anterior.orgId === orgId && anterior.sessao === sessao ? anterior.dados : null, erro: anterior.orgId === orgId && anterior.sessao === sessao ? anterior.erro : '', atualizando: true }))
      try {
        const dados = await api.get<ResumoSaldoIA>(`/orgs/${orgId}/saldo`, controller.signal)
        if (!resumoValido(dados)) throw new Error('Resumo de saldo inválido')
        if (vigente() && !controller.signal.aborted) {
          ultimaConsulta = Date.now()
          consultaPendente = false
          setLeitura({ orgId, sessao, dados, erro: '', atualizando: false })
        }
      } catch (e) {
        if (!vigente() || controller.signal.aborted) return
        const erro = e instanceof ApiError && e.status === 403 ? 'acesso' : 'consulta'
        setLeitura(anterior => ({ orgId, sessao, dados: anterior.orgId === orgId && anterior.sessao === sessao ? anterior.dados : null, erro, atualizando: false }))
      } finally {
        if (requisicao === controller) {
          requisicao = null
          if (vigente() && repetir) { repetir = false; void carregar() }
        }
      }
    }
    const agendar = () => {
      if (!vigente()) return
      // O aviso invalida a consulta que começou antes dele, mesmo quando a
      // aba está oculta. O último valor confirmado continua identificado.
      requisicao?.abort()
      requisicao = null
      repetir = false
      consultaPendente = true
      setLeitura(anterior => ({ ...anterior, atualizando: true }))
      clearTimeout(debounce)
      if (document.hidden) return
      debounce = setTimeout(() => void carregar(), 250)
    }
    const aoRetornar = () => { if (!document.hidden && (consultaPendente || Date.now() - ultimaConsulta > 2000)) agendar() }
    const aoMudar = (evento: Event) => {
      const alvo = (evento as CustomEvent<{ orgId?: number }>).detail?.orgId
      if (alvo == null || alvo === orgId) agendar()
    }
    carregarRef.current = () => { void carregar() }
    void carregar()
    const offJob = wsClient.on('job_status', mensagem => {
      if ('org_id' in mensagem && mensagem.org_id === orgId) agendar()
    })
    const offConectado = wsClient.on('_conectado', agendar)
    const timer = window.setInterval(() => { if (!document.hidden) void carregar() }, 30000)
    window.addEventListener(EVENTO_SALDO_IA_MUDOU, aoMudar)
    window.addEventListener('focus', aoRetornar)
    document.addEventListener('visibilitychange', aoRetornar)
    return () => {
      ativo = false
      requisicao?.abort()
      carregarRef.current = null
      clearTimeout(debounce)
      window.clearInterval(timer)
      offJob(); offConectado()
      window.removeEventListener(EVENTO_SALDO_IA_MUDOU, aoMudar)
      window.removeEventListener('focus', aoRetornar)
      document.removeEventListener('visibilitychange', aoRetornar)
    }
  }, [orgId, sessao])

  const atual = leitura.orgId === orgId && leitura.sessao === getSessionIdentity()
  return { dados: atual ? leitura.dados : null, erro: atual ? leitura.erro : '', atualizando: !atual || leitura.atualizando, atualizar }
}
