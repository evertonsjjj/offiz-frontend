import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { useIdioma } from '../../lib/i18n'
import { formatUSD } from '../../lib/i18nProducao'
import { wsClient } from '../../lib/ws'

type Plano = {
  tem_plano: boolean
  pode_gerar: boolean
  custo_pendente: number | null
  custo_consulta_confirmada?: boolean
  custo_pendente_escopo?: string
  custo_total_estimado?: boolean
  custos_fora_fal?: Array<{ etapa: string; custo_usd: number | null; via?: string; fora_fal?: boolean }>
  etapas_pendentes?: Array<{ etapa: string; custo_usd: number | null; via?: string; fora_fal?: boolean }>
  aviso_custo_externo?: string
  aviso_custo_consulta?: string
  pendencias?: string[]
  orcamento?: { teto_usd?: number; gasto_usd?: number }
  dur_total?: number | null
  referencia?: { fonte?: string; de_onde?: string; copiei?: string; recusei?: string; acrescentei?: string } | null
  cenas: Array<{ id: string; rotulo: string; roteiro?: string; origem: string; nota_origem?: string; custo_usd: number; material: Array<{ nome: string; legenda?: string; existe: boolean }> }>
  falta: Array<{ item: string; porque?: string; se_nao_vier?: string; trava: boolean; resolvido: boolean }>
  critica?: { itens: Array<{ achado: string; correcao?: string; gravidade: string; resolvido: boolean }> } | null
  narracao?: { texto?: string; porta_voz?: string; voz_direta?: boolean; vozes?: Array<{ nome: string; pronta: boolean }> } | null
  job_ativo?: { id: number; status: string; erro?: string | null } | null
}

/** A aprovação fica junto da peça; pedidos de mudança usam a conversa aberta. */
export default function PlanoDaPeca({ base, peca, conversaId, perguntar, antesDeGerar }: {
  base: string; peca: string; conversaId?: number | null
  perguntar: (texto: string) => void
  antesDeGerar?: () => Promise<boolean>
}) {
  const { t, idioma } = useIdioma()
  const [plano, setPlano] = useState<Plano | null>(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [gerando, setGerando] = useState(false)
  const [iniciado, setIniciado] = useState(false)
  const [salvandoVoz, setSalvandoVoz] = useState(false)
  const gravandoVoz = useRef(false)
  const enviando = useRef(false)
  const leitura = useRef<AbortController | null>(null)
  const montado = useRef(false)
  const url = `${base}/pecas/${encodeURIComponent(peca)}`
  const urlAtual = useRef(url)
  urlAtual.current = url
  const carregar = useCallback(async () => {
    leitura.current?.abort()
    const controller = new AbortController()
    leitura.current = controller
    setCarregando(true)
    try {
      const resposta = await api.get<Plano>(`${url}/mesa`, controller.signal)
      if (!controller.signal.aborted) { setPlano(resposta); setErro(''); setIniciado(false) }
    } catch (e) {
      if (!controller.signal.aborted) {
        setPlano(null)
        setErro(e instanceof ApiError ? e.detail : t('Não consegui conferir o plano. Tente novamente.', 'I could not check the plan. Please try again.'))
      }
    } finally {
      if (!controller.signal.aborted) setCarregando(false)
    }
  }, [url, t])

  useEffect(() => {
    montado.current = true
    void carregar()
    const scope = /^\/predios\/(\d+)\/([^/]+)\//.exec(base)
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const off = wsClient.on('job_status', event => {
      // Apenas o fim de um trabalho desta área pode ter alterado seu plano.
      if (event.t !== 'job_status' || !('org_id' in event) || !('office_slug' in event) || !('status' in event)
        || !scope || event.org_id !== Number(scope[1]) || event.office_slug !== scope[2]
        || ['queued', 'running'].includes(String(event.status)) || enviando.current) return
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => { void carregar() }, 500)
    })
    return () => { montado.current = false; leitura.current?.abort(); off(); clearTimeout(refreshTimer) }
  }, [carregar, base])

  const emVoo = iniciado || ['queued', 'running'].includes(plano?.job_ativo?.status || '')
  const custoIndisponivel = plano?.custo_consulta_confirmada === false || plano?.custo_pendente == null
  const custoExterno = plano?.custo_total_estimado === false || (plano?.custos_fora_fal?.length ?? 0) > 0
  const tetoPositivo = (plano?.orcamento?.teto_usd ?? 0) > 0
  const podeGerar = !!plano?.pode_gerar && !custoIndisponivel && !(custoExterno && tetoPositivo)
  const vozPadrao = '__voz_padrao__'
  const vozDireta = '__voz_direta__'
  async function escolherVoz(nome: string) {
    if (gravandoVoz.current || emVoo || gerando || carregando) return
    const padrao = nome === vozPadrao
    if (nome === vozDireta || (padrao && (!plano?.narracao?.texto || plano.narracao.voz_direta))) return
    const voz = plano?.narracao?.vozes?.find(v => v.nome === nome)
    if (voz && !voz.pronta) {
      perguntar(t(`Quero preparar a voz de ${nome} para narrar a peça "${peca}". Qual material preciso enviar?`, `I want to prepare ${nome}’s voice to narrate production “${peca}”. What material should I provide?`))
      return
    }
    gravandoVoz.current = true
    setSalvandoVoz(true)
    setErro('')
    try {
      await api.patch(`${url}/narracao`, padrao ? { ligada: true, porta_voz: '' } : nome ? { porta_voz: nome } : { ligada: false })
      if (montado.current && urlAtual.current === url) await carregar()
    } catch (e) {
      if (montado.current && urlAtual.current === url) setErro(e instanceof ApiError ? e.detail : t('Não consegui salvar a voz. Tente novamente.', 'I could not save the voice. Please try again.'))
    } finally {
      gravandoVoz.current = false
      if (montado.current) setSalvandoVoz(false)
    }
  }
  async function gerar() {
    if (enviando.current || gravandoVoz.current || carregando || !podeGerar || emVoo) return
    enviando.current = true
    setGerando(true)
    setErro('')
    try {
      if (antesDeGerar && !await antesDeGerar()) return
      if (!montado.current || urlAtual.current !== url) return
      // O servidor reconfere plano, pendências, acesso e trabalho já em andamento.
      await api.post(`${url}/gerar`, { conversa_id: conversaId ?? undefined })
      if (montado.current && urlAtual.current === url) { setIniciado(true); void carregar() }
    } catch (e) {
      if (montado.current && urlAtual.current === url) {
        setPlano(null)
        setErro(e instanceof ApiError ? e.detail : t('Não consegui iniciar a geração. Confira o plano antes de tentar novamente.', 'I could not start generation. Check the plan before trying again.'))
      }
    } finally {
      enviando.current = false
      if (montado.current) setGerando(false)
    }
  }

  const origens: Record<string, string> = { acervo: t('Seu acervo', 'Your assets'), mix: t('Acervo + IA', 'Assets + AI'), gerada: t('Gerada por IA', 'AI generated'), codigo: t('Composição', 'Composition'), slot: t('Material a completar', 'Material to provide') }
  const pendencias = plano?.falta.filter(p => !p.resolvido) || []
  const criticas = plano?.critica?.itens.filter(p => !p.resolvido) || []
  return <section className="estudio-plano sabe-card" aria-label={t('Plano da peça', 'Production plan')} aria-busy={carregando || gerando}>
    <header><h3>{t('Antes de gerar', 'Before generating')}</h3><button type="button" className="botao-texto" disabled={carregando || gerando} onClick={() => void carregar()}>{t('Atualizar', 'Refresh')}</button></header>
    {erro && <p className="alerta alerta-erro" role="alert">{erro}</p>}
    {carregando && !plano && <p role="status">{t('Conferindo o plano…', 'Checking the plan…')}</p>}
    {plano && <>
      {!plano.tem_plano ? <p>{t('Vamos preparar o plano e conferir o custo antes de gerar.', 'Let’s prepare the plan and check the cost before generating.')}</p> : <>
        <p><strong>{custoIndisponivel ? t('Custo indisponível', 'Cost unavailable') : <>{custoExterno ? t('Estimativa fal.ai:', 'fal.ai estimate:') : t('Geração pendente:', 'Pending generation:')} {formatUSD(plano.custo_pendente!, idioma)}</>}</strong>{plano.orcamento?.teto_usd != null && <span className="texto-suave"> · {t('Teto da peça:', 'Production budget:')} {formatUSD(plano.orcamento.teto_usd, idioma)}</span>}</p>
        {custoIndisponivel ? <p role="alert">{plano.aviso_custo_consulta || t('Não foi possível conferir o custo. Atualize o plano para tentar novamente.', 'Could not check the cost. Refresh the plan to try again.')}</p> : <>
          <p className="texto-suave">{t('Estimativa de mídia. O uso da IA da conversa e da produção é cobrado pela sua conta.', 'Media estimate. Conversation and production AI usage is billed to your account.')}</p>
          {custoExterno && <p role="status">{plano.aviso_custo_externo || t('Há custo externo não estimado. O valor acima não é o custo total.', 'There is an unestimated external cost. The amount above is not the total cost.')} {' '}{tetoPositivo ? t('A equipe precisa conferir esse custo antes de começar.', 'The team needs to check this cost before starting.') : t('Teto zero não limita o gasto. Confira a autorização da conexão antes de gerar.', 'A zero budget does not limit spending. Check the connection’s authorization before generating.')}</p>}
        </>}
        {(plano.pendencias?.length ?? 0) > 0 && <ul>{plano.pendencias!.map((p, i) => <li key={`motor-${i}`}>{p}</li>)}</ul>}
        <details><summary>{t('Ver o que será criado', 'See what will be created')} · {plano.cenas.length} {t('cenas', 'scenes')}</summary>
          {plano.referencia?.fonte && <p>{t('Referência:', 'Reference:')} {plano.referencia.fonte}</p>}
          {plano.referencia?.copiei && <p>{t('O que vamos aproveitar:', 'What we will use:')} {plano.referencia.copiei}</p>}
          {plano.referencia?.recusei && <p>{t('O que fica de fora:', 'What we will leave out:')} {plano.referencia.recusei}</p>}
          {plano.referencia?.acrescentei && <p>{t('O que vamos acrescentar:', 'What we will add:')} {plano.referencia.acrescentei}</p>}
          <ol>{plano.cenas.map(c => <li key={c.id}><strong>{c.rotulo || c.id}</strong> · {origens[c.origem] || c.origem} · {formatUSD(c.custo_usd, idioma)}
            {c.roteiro && <p>{c.roteiro}</p>}{c.nota_origem && <p className="texto-suave">{c.nota_origem}</p>}
            {c.material.length > 0 && <p>{c.material.map(m => `${m.legenda || m.nome}${m.existe ? '' : t(' (falta enviar)', ' (not provided yet)')}`).join(' · ')}</p>}
          </li>)}</ol>
          {plano.narracao?.texto && <p>{t('Narração:', 'Narration:')} {plano.narracao.texto}</p>}
        </details>
      </>}
      {plano.narracao && ((plano.narracao.vozes?.length ?? 0) > 0 || plano.narracao.texto || plano.narracao.porta_voz || plano.narracao.voz_direta) && <div className="estudio-plano-voz">
        <label>{t('Voz da narração', 'Narration voice')} <select value={plano.narracao.voz_direta ? vozDireta : plano.narracao.porta_voz || (plano.narracao.texto ? vozPadrao : '')} disabled={salvandoVoz || emVoo || gerando || carregando} onChange={e => void escolherVoz(e.target.value)}>
          <option value="">{t('Sem narração', 'No narration')}</option>
          {plano.narracao.voz_direta ? <option value={vozDireta} disabled>{t('Voz selecionada', 'Selected voice')}</option> : plano.narracao.texto && <option value={vozPadrao}>{t('Voz padrão', 'Default voice')}</option>}
          {plano.narracao.porta_voz && !plano.narracao.vozes?.some(v => v.nome === plano.narracao?.porta_voz) && <option value={plano.narracao.porta_voz}>{plano.narracao.porta_voz}</option>}
          {plano.narracao.vozes?.map(v => <option key={v.nome} value={v.nome}>{v.nome}{!v.pronta && t(' · preparar voz', ' · prepare voice')}</option>)}
        </select></label>
        {salvandoVoz && <small role="status">{t('Salvando voz…', 'Saving voice…')}</small>}
      </div>}
      {(pendencias.length > 0 || criticas.length > 0) && <div className="estudio-plano-pendencias"><strong>{t('O que precisa de atenção', 'What needs attention')}</strong>
        <ul>{pendencias.map((p, i) => <li key={`p${i}`}>{p.item}{p.porque && ` — ${p.porque}`}{p.trava && <strong> · {t('necessário para começar', 'required to start')}</strong>}{p.se_nao_vier && <p className="texto-suave">{p.se_nao_vier}</p>}</li>)}
          {criticas.map((p, i) => <li key={`c${i}`}>{p.achado}{p.correcao && ` — ${p.correcao}`}{p.gravidade === 'trava' && <strong> · {t('necessário para começar', 'required to start')}</strong>}</li>)}</ul>
      </div>}
      {emVoo ? <p role="status">{t('Geração em andamento. Acompanhe pela conversa.', 'Generation in progress. Follow it in the conversation.')}</p> : <div className="estudio-plano-acoes">
        {plano.tem_plano && <button type="button" className="botao botao-primario botao-pequeno" disabled={!podeGerar || carregando || gerando || salvandoVoz} onClick={() => void gerar()}>{gerando ? t('Iniciando…', 'Starting…') : t('Pode gerar', 'Generate')}</button>}
        <button type="button" className="botao botao-fantasma botao-pequeno" disabled={gerando} onClick={() => perguntar(plano.tem_plano ? t(`Quero mudar o plano da peça "${peca}": `, `I want to change the plan for production “${peca}”: `) : t(`Prepare o plano da peça "${peca}", com custo e materiais necessários, para eu revisar antes de gerar.`, `Prepare the plan for production “${peca}”, including cost and required materials, so I can review it before generating.`))}>{plano.tem_plano ? t('Pedir ajuste no plano', 'Request plan changes') : t('Preparar o plano', 'Prepare the plan')}</button>
      </div>}
    </>}
  </section>
}
