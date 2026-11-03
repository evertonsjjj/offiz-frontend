import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, getSessionIdentity } from '../lib/api'
import { formatBRL, formatData, formatDataHora, toDate } from '../lib/format'
import { useIdioma } from '../lib/i18n'
import { EVENTO_SALDO_IA_MUDOU } from '../lib/saldo-eventos'
import { wsClient } from '../lib/ws'
import type { OrgResumo } from '../lib/types'
import './ContratosIA.css'

const nomes = { openai: 'OpenAI · conversas, tarefas e imagens', falai: 'fal.ai · imagens e vídeos', elevenlabs: 'ElevenLabs · narração' }
const nomesEn = { openai: 'OpenAI · conversations, tasks and images', falai: 'fal.ai · images and videos', elevenlabs: 'ElevenLabs · narration' }
type Provedor = keyof typeof nomes
const provedores = Object.keys(nomes) as Provedor[]
interface Contas { configuradas: Record<Provedor, boolean>; usd_brl: number; margem_custo_pct: number; elevenlabs_usd_mil_caracteres: number }
interface Contrato { tipo: 'byok' | 'pf_gerenciado'; mensalidade_brl: number | null; limite_brl_mes: number | null; servicos: Provedor[]; periodo: string; consumido_brl: number; reservado_brl: number; disponivel_brl: number; conexoes: Partial<Record<Provedor, boolean>>; inicio: string | null; fim: string | null; vigencia: 'vigente' | 'aguardando_inicio' | 'encerrado'; vozes_elevenlabs?: string[] }
interface TesteConexao { ok: boolean; mensagem: string; testado_em: string; duracao_ms: number }
interface Ferramenta { provedor: Provedor; operacao: string; modelo: string; chamadas: number; consumido_brl: number; reservado_brl: number; pendente_offiz_brl: number; unidades: Record<string, number>; historico_sem_detalhe: boolean; tarifas?: { usd_brl: number; margem_pct: number; usd_unidade?: number; usd_milhao_tokens?: number[]; usd_busca?: number }[] }
interface Contrato { ferramentas?: Ferramenta[]; credito_brl?: number; preparacao_brl?: number }
const operacoes: Record<string, string> = { texto: 'Conversas e tarefas', texto_pesquisa: 'Texto e pesquisa', imagens: 'Imagens', videos: 'Vídeos', narracao: 'Narração' }
const unidades: Record<string, string> = { input_tokens: 'tokens de entrada', prompt_tokens: 'tokens de entrada', output_tokens: 'tokens de saída', completion_tokens: 'tokens de saída', cached_tokens: 'tokens reutilizados', cache_write_tokens: 'tokens gravados em cache', image_tokens: 'tokens de imagem', buscas: 'buscas verificadas', imagens: 'imagens solicitadas', segundos: 'segundos de vídeo', caracteres: 'caracteres narrados' }
const mensagemErro = (e: unknown) => e instanceof ApiError ? e.detail : 'Não foi possível carregar ou salvar. Tente novamente.'
const numeroConfirmado = (valor: unknown): valor is number => typeof valor === 'number' && Number.isFinite(valor)
function saldoConfirmado(contrato: Contrato): boolean {
  return [contrato.limite_brl_mes, contrato.consumido_brl, contrato.reservado_brl, contrato.disponivel_brl].every(numeroConfirmado)
}
function estruturaContrato(contrato: Contrato): boolean {
  return !!contrato && ['byok', 'pf_gerenciado'].includes(contrato.tipo)
    && Array.isArray(contrato.servicos) && contrato.servicos.every(p => provedores.includes(p))
    && !!contrato.conexoes && typeof contrato.conexoes === 'object'
    && (contrato.mensalidade_brl === null || numeroConfirmado(contrato.mensalidade_brl))
    && (contrato.limite_brl_mes === null || numeroConfirmado(contrato.limite_brl_mes))
    && typeof contrato.periodo === 'string' && ['vigente', 'aguardando_inicio', 'encerrado'].includes(contrato.vigencia)
    && (contrato.inicio === null || typeof contrato.inicio === 'string') && (contrato.fim === null || typeof contrato.fim === 'string')
    && (contrato.vozes_elevenlabs === undefined || (Array.isArray(contrato.vozes_elevenlabs) && contrato.vozes_elevenlabs.every(voz => typeof voz === 'string')))
}
function contasConfirmadas(contas: Contas): boolean {
  return !!contas?.configuradas && provedores.every(p => typeof contas.configuradas[p] === 'boolean')
    && [contas.usd_brl, contas.margem_custo_pct, contas.elevenlabs_usd_mil_caracteres].every(numeroConfirmado)
}

// A financial refresh must update confirmed amounts without replacing edits
// made after the previous saved snapshot.
function preservarEdicoes<T extends object>(atual: T | null, anterior: T | null, recebido: T, campos: (keyof T)[]): T {
  if (!atual || !anterior) return recebido
  const atualizado = { ...recebido }
  for (const campo of campos) {
    if (JSON.stringify(atual[campo]) !== JSON.stringify(anterior[campo])) atualizado[campo] = atual[campo]
  }
  return atualizado
}

function Vigencia({ contrato }: { contrato: Contrato }) {
  const { t, idioma } = useIdioma()
  return <div>
    <p><strong>{contrato.vigencia === 'encerrado' ? t('Contrato encerrado', 'Plan ended') : contrato.vigencia === 'aguardando_inicio' ? t('Contrato aguardando início', 'Plan awaiting start') : contrato.vigencia === 'vigente' ? t('Contrato vigente', 'Active plan') : t('Vigência não informada', 'Plan dates unavailable')}</strong> · {contrato.inicio ? t(`Desde ${formatData(contrato.inicio, idioma)}`, `From ${formatData(contrato.inicio, idioma)}`) : t('Início não definido', 'Start date not set')} · {contrato.fim ? t(`Até ${formatData(contrato.fim, idioma)}`, `Until ${formatData(contrato.fim, idioma)}`) : t('Sem término definido', 'No end date set')}.</p>
    {['encerrado', 'aguardando_inicio'].includes(contrato.vigencia) && <p role="status" className="alerta">{t('O acesso do cliente ao escritório está bloqueado. O administrador pode ajustar ou renovar a vigência.', 'Customer access to the office is blocked. An administrator can adjust or renew the plan dates.')}</p>}
  </div>
}

function Saldo({ contrato, mostrarCredito = false }: { contrato: Contrato; mostrarCredito?: boolean }) {
  const { t, idioma } = useIdioma()
  if (!saldoConfirmado(contrato)) return <p role="alert">{t('Saldo indisponível. Atualize os dados para consultar os valores confirmados.', 'Credit unavailable. Refresh the data to view confirmed amounts.')}</p>
  const brl = (valor: number | undefined | null) => formatBRL(valor, idioma)
  const operacoesEn: Record<string, string> = { texto: 'Conversations and tasks', texto_pesquisa: 'Text and research', imagens: 'Images', videos: 'Videos', narracao: 'Narration' }
  const unidadesEn: Record<string, string> = { input_tokens: 'input tokens', prompt_tokens: 'input tokens', output_tokens: 'output tokens', completion_tokens: 'output tokens', cached_tokens: 'reused tokens', cache_write_tokens: 'cached tokens written', image_tokens: 'image tokens', buscas: 'verified searches', imagens: 'requested images', segundos: 'video seconds', caracteres: 'narrated characters' }
  const rotulosOperacoes = idioma === 'en' ? operacoesEn : operacoes
  const rotulosUnidades = idioma === 'en' ? unidadesEn : unidades
  const detalhes = <>
    <p className="texto-suave">{t('Consumo:', 'Usage:')} {brl(contrato.consumido_brl)} · {t('Em processamento ou conferência:', 'Processing or under review:')} {brl(contrato.reservado_brl)}. {t('O saldo renova no primeiro dia do mês, às 00h UTC, sem acumular.', 'Credit resets on the first day of each month at 00:00 UTC and does not roll over.')}</p>
    <p className="texto-suave">{t('O consumo é calculado pelas tarifas de IA, câmbio e margem de segurança definidos pelo Offiz.', 'Usage is calculated with AI rates, the exchange rate and the cost margin set by Offiz.')}</p>
    {mostrarCredito && !!contrato.credito_brl && <p><strong>{t('Crédito concedido:', 'Credit granted:')} {brl(contrato.credito_brl)}</strong>. {t('Compensa o consumo neste mês, preservando seu histórico. Não acumula no mês seguinte.', 'Offsets usage for this month while keeping your history. It does not roll over.')}</p>}
    {mostrarCredito && !!contrato.preparacao_brl && <p>{brl(contrato.preparacao_brl)} {t('deste consumo corresponde à preparação custeada pelo Offiz. Os registros e o crédito permanecem neste histórico; o extrato do cliente mostra apenas o uso dele.', 'of this usage is preparation paid by Offiz. Records and credit stay in this history; the customer statement shows only their own usage.')}</p>}
    {contrato.reservado_brl > 0 && <p>{t('O valor reservado ainda não é consumo confirmado. Ele reduz temporariamente o disponível até a conclusão ou conferência da chamada.', 'Reserved funds are not confirmed usage. They temporarily reduce available credit until the call completes or is reviewed.')}</p>}
    {!!contrato.ferramentas?.length && <details open><summary>{t('Consumo por ferramenta', 'Usage by tool')}</summary>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left' }}>
        <thead><tr><th scope="col">{t('Ferramenta', 'Tool')}</th><th scope="col">{t('Consumo confirmado', 'Confirmed usage')}</th><th scope="col">{t('Reservado', 'Reserved')}</th></tr></thead>
        <tbody>{contrato.ferramentas.map(f => <tr key={`${f.provedor}-${f.operacao}-${f.modelo}`}>
          <th scope="row" style={{ padding: '12px 8px 12px 0', fontWeight: 400 }}><strong>{nomes[f.provedor].split(' · ')[0]} · {rotulosOperacoes[f.operacao] || f.operacao}</strong><br /><small>{f.modelo} · {f.chamadas} {t('chamadas', 'calls')}</small>
            <details><summary>{t('Como foi calculado', 'How it was calculated')}</summary>
              <p className="texto-suave">{Object.entries(f.unidades).map(([k, v]) => `${v.toLocaleString(idioma)} ${rotulosUnidades[k] || k}`).join(' · ') || t('Quantidades indisponíveis neste histórico.', 'Quantities are unavailable for these records.')}</p>
              {f.tarifas?.map((tarifa, i) => <p className="texto-suave" key={i}>
                {tarifa.usd_milhao_tokens ? t(`US$ ${tarifa.usd_milhao_tokens.join(' / ')} por milhão de tokens de entrada / cache / saída. Escrita em cache: 1,25× entrada. `, `US$ ${tarifa.usd_milhao_tokens.join(' / ')} per million input / cached / output tokens. Cache writes: 1.25× input. `) : tarifa.usd_unidade != null ? t(`US$ ${tarifa.usd_unidade.toFixed(6)} por unidade solicitada. `, `US$ ${tarifa.usd_unidade.toFixed(6)} per requested unit. `) : t('Tarifa de tokens de imagem. ', 'Image token rate. ')}
                {!!tarifa.usd_busca && t(`US$ ${tarifa.usd_busca} por busca verificada. `, `US$ ${tarifa.usd_busca} per verified search. `)}{t('Câmbio:', 'Exchange rate:')} {brl(tarifa.usd_brl)} {t('por US$ 1; margem de custo:', 'per US$ 1; cost margin:')} {tarifa.margem_pct}%.
              </p>)}
              {f.historico_sem_detalhe && <p className="texto-suave">{t('Chamadas antigas têm o custo registrado, sem todas as quantidades para separar a conta. Nenhum consumo foi estimado para completar esse histórico.', 'Older calls have a recorded cost without all quantities needed for a breakdown. No estimated usage was added to fill these records.')}</p>}
              {f.pendente_offiz_brl > 0 && <p>{brl(f.pendente_offiz_brl)} {t('em conferência sob responsabilidade do Offiz, sem reduzir seu saldo.', 'under review and covered by Offiz, without reducing your available credit.')}</p>}
            </details>
          </th><td>{brl(f.consumido_brl)}</td><td>{brl(f.reservado_brl)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="texto-suave">{t('Saldo disponível = limite mensal + créditos − consumo confirmado − reservado. Texto pelo motor local usa os limites da sua conta e não entra nesta cobrança de API.', 'Available credit = monthly allowance + credits − confirmed usage − reserved funds. Text using the local engine follows your account limits and is not included in this API charge.')}</p>
    </details>}
    {!contrato.ferramentas?.length && !contrato.consumido_brl && !contrato.reservado_brl && <p>{t('Seu consumo aparecerá aqui conforme você usar o escritório.', 'Your usage will appear here as you use the office.')}</p>}
  </>
  return <div>
    <p><strong>{brl(contrato.disponivel_brl)} {t('disponíveis', 'available')}</strong>{mostrarCredito && <> {t('de', 'of')} {brl(contrato.limite_brl_mes || 0)} {t('em', 'in')} {contrato.periodo}.</>}</p>
    {mostrarCredito ? detalhes : <details><summary>{t('Ver consumo', 'View usage')}</summary>{detalhes}</details>}
  </div>
}

export function MeuContrato({ orgId }: { orgId: number }) {
  const [conta, setConta] = useState(getSessionIdentity)
  useEffect(() => {
    const mudou = () => setConta(getSessionIdentity())
    window.addEventListener('offiz:token-changed', mudou)
    window.addEventListener('storage', mudou)
    return () => { window.removeEventListener('offiz:token-changed', mudou); window.removeEventListener('storage', mudou) }
  }, [])
  return <ContratoDaConta key={`${conta}:${orgId}`} orgId={orgId} conta={conta} />
}

function ContratoDaConta({ orgId, conta }: { orgId: number; conta: string | null }) {
  const { t, idioma } = useIdioma()
  const [contrato, setContrato] = useState<Contrato | null>(null)
  const [erro, setErro] = useState('')
  const [consultadoEm, setConsultadoEm] = useState<string>()
  const [atualizando, setAtualizando] = useState(true)
  const [versao, atualizar] = useState(0)
  useEffect(() => {
    let ativo = true
    let sequencia = 0
    let requisicao: AbortController | undefined
    let debounce: ReturnType<typeof setTimeout> | undefined
    let ultimaConsulta = 0
    let consultaPendente = false
    const atual = () => ativo && getSessionIdentity() === conta
    const carregar = async () => {
      if (!atual()) return
      consultaPendente = false
      requisicao?.abort()
      const controller = new AbortController()
      requisicao = controller
      const numero = ++sequencia
      const valida = () => atual() && !controller.signal.aborted && numero === sequencia
      setAtualizando(true)
      try {
        const recebido = await api.get<Contrato>(`/orgs/${orgId}/contrato`, controller.signal)
        if (!valida()) return
        if (!estruturaContrato(recebido)) throw new Error('Invalid plan response')
        if (recebido.tipo === 'pf_gerenciado' && !saldoConfirmado(recebido)) throw new ApiError(0, t('Saldo indisponível. Atualize os dados para consultar os valores confirmados.', 'Credit unavailable. Refresh the data to view confirmed amounts.'))
        setContrato(recebido)
        ultimaConsulta = Date.now()
        setConsultadoEm(new Date(ultimaConsulta).toISOString())
        setErro('')
      } catch (e) {
        if (valida()) setErro(e instanceof ApiError ? e.detail : t('Não foi possível carregar o plano. Tente novamente.', 'Could not load your plan. Try again.'))
      } finally {
        if (valida()) setAtualizando(false)
      }
    }
    const agendar = () => {
      if (!atual()) return
      // Um aviso invalida a consulta em voo também na aba oculta. A leitura
      // fica pendente até a volta, sem aceitar o snapshot anterior como novo.
      consultaPendente = true
      requisicao?.abort()
      setAtualizando(true)
      clearTimeout(debounce)
      if (document.hidden) return
      debounce = setTimeout(() => void carregar(), 250)
    }
    const aoMudar = (evento: Event) => {
      const alvo = (evento as CustomEvent<{ orgId?: number }>).detail?.orgId
      if (alvo == null || alvo === orgId) agendar()
    }
    const aoRetornar = () => { if (!document.hidden && (consultaPendente || Date.now() - ultimaConsulta > 2000)) agendar() }
    void carregar()
    const offJob = wsClient.on('job_status', mensagem => { if ('org_id' in mensagem && mensagem.org_id === orgId) agendar() })
    const offConectado = wsClient.on('_conectado', agendar)
    window.addEventListener(EVENTO_SALDO_IA_MUDOU, aoMudar)
    window.addEventListener('focus', aoRetornar)
    document.addEventListener('visibilitychange', aoRetornar)
    return () => {
      ativo = false
      requisicao?.abort(); clearTimeout(debounce); offJob(); offConectado()
      window.removeEventListener(EVENTO_SALDO_IA_MUDOU, aoMudar)
      window.removeEventListener('focus', aoRetornar)
      document.removeEventListener('visibilitychange', aoRetornar)
    }
  }, [orgId, conta, versao, t])
  return <section className="cartao contrato-cliente" aria-label={t('Meu plano de IA', 'My AI plan')}>
    <h2 className="secao-titulo">{t('Seu plano de inteligência', 'Your AI plan')}</h2>
    {erro && <p role="alert" className="alerta alerta-erro">{erro}{contrato && <> {t('Os valores abaixo são da última consulta.', 'The amounts below are from the last check.')}</>}</p>}
    {atualizando && contrato && <p role="status" className="texto-suave">{t('Atualizando seu plano e saldo…', 'Refreshing your plan and credit…')}</p>}
    {contrato ? <>
      {contrato.tipo === 'byok' ? <>
        <p><strong>{t('IA pela sua conta', 'AI with your own account')}</strong></p>
        <p>{t('O consumo de API é cobrado diretamente pelo fornecedor. O saldo dessa conta não é consultado pelo Offiz; confira os créditos e a cobrança no painel do serviço conectado.', 'API usage is billed directly by the provider. Offiz does not check this account’s balance; check credits and billing in the connected service’s dashboard.')}</p>
        <p className="texto-suave">{t('Ao usar o motor local, conversas e tarefas seguem os limites da conta conectada no computador. Imagens, vídeos e narração podem usar APIs separadas.', 'With the local engine, conversations and tasks follow the limits of the account connected on your computer. Images, videos and narration may use separate APIs.')}</p>
        <Vigencia contrato={contrato} />
      </> : contrato.tipo === 'pf_gerenciado' ? <>
        <Saldo contrato={contrato} />
        {contrato.vigencia && contrato.vigencia !== 'vigente' && <Vigencia contrato={contrato} />}
        <details className="contrato-servicos"><summary>{t('Serviços do seu contrato', 'Services in your plan')}</summary>
          <ul>{provedores.map(p => <li key={p}><strong>{idioma === 'en' ? nomesEn[p] : nomes[p]}</strong><span>{!contrato.servicos.includes(p) ? t('Não incluído neste contrato', 'Not included in this plan') : contrato.conexoes[p] ? t('Conexão cadastrada', 'Connection saved') : t('Aguardando configuração pelo Offiz', 'Awaiting setup by Offiz')}</span></li>)}</ul>
          <p className="texto-suave">{t('Conexão cadastrada indica a configuração do serviço. Cada produção também depende do saldo, da vigência e da resposta do fornecedor.', 'A saved connection indicates service configuration. Each production also depends on available credit, plan validity and the provider’s response.')}</p>
        </details>
      </> : <p role="alert">{t('A modalidade de IA não foi reconhecida. Atualize o plano ou peça ao responsável para verificar a configuração.', 'The AI plan type was not recognized. Refresh your plan or ask your administrator to check its settings.')}</p>}
    </> : !erro && <p role="status">{t('Carregando seu saldo…', 'Loading your credit…')}</p>}
    {consultadoEm && <p className="texto-suave">{t('Última consulta:', 'Last checked:')} <time dateTime={consultadoEm}>{formatDataHora(consultadoEm, idioma)}</time></p>}
    <button type="button" className="botao botao-fantasma" disabled={atualizando} onClick={() => atualizar(v => v + 1)}>{contrato?.tipo === 'byok' ? t('Atualizar plano', 'Refresh plan') : t('Atualizar saldo', 'Refresh credit')}</button>
  </section>
}

function EditorContrato({ orgId, aoSalvar }: { orgId: number; aoSalvar: () => void }) {
  const [contrato, setContrato] = useState<Contrato | null>(null)
  const [contratoSalvo, setContratoSalvo] = useState<Contrato | null>(null)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [versao, atualizar] = useState(0)
  const [vozesTexto, setVozesTexto] = useState('')
  const [vozesEditadas, setVozesEditadas] = useState(false)
  const enviandoRef = useRef(false)
  const montado = useRef(true)
  const consultaRef = useRef(0)
  const salvoRef = useRef<Contrato | null>(null)
  const vozesEditadasRef = useRef(false)
  useEffect(() => { montado.current = true; return () => { montado.current = false } }, [])
  useEffect(() => {
    let ativo = true
    const consulta = ++consultaRef.current
    setErro('')
    api.get<Contrato>(`/orgs/${orgId}/contrato`).then(c => {
      if (!ativo || consulta !== consultaRef.current) return
      if (!estruturaContrato(c) || (c.tipo === 'pf_gerenciado' && !saldoConfirmado(c))) throw new Error('Invalid contract snapshot')
      const anterior = salvoRef.current
      setContrato(atual => preservarEdicoes(atual, anterior, c, ['tipo', 'mensalidade_brl', 'limite_brl_mes', 'servicos', 'inicio', 'fim']))
      salvoRef.current = c; setContratoSalvo(c)
      if (!vozesEditadasRef.current) { setVozesTexto((c.vozes_elevenlabs ?? []).join('\n')); setVozesEditadas(false) }
    }).catch(e => { if (ativo && consulta === consultaRef.current) setErro(mensagemErro(e)) })
    return () => { ativo = false }
  }, [orgId, versao])
  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!contrato || enviandoRef.current) return
    enviandoRef.current = true
    consultaRef.current += 1
    setSalvando(true); setErro(''); setSucesso('')
    try {
      const { tipo, mensalidade_brl, limite_brl_mes, servicos, inicio, fim } = contrato
      const vozes = vozesEditadas ? { vozes_elevenlabs: vozesTexto.split(/[\s,]+/).filter(Boolean) } : {}
      const salvo = await api.put<Contrato>(`/admin/orgs/${orgId}/contrato`, { tipo, mensalidade_brl: mensalidade_brl ?? 0, limite_brl_mes: limite_brl_mes ?? 0, servicos, inicio: inicio || null, fim: fim || null, ...vozes })
      if (!montado.current) return
      if (!estruturaContrato(salvo) || (salvo.tipo === 'pf_gerenciado' && !saldoConfirmado(salvo))) throw new Error('Invalid contract response')
      consultaRef.current += 1; salvoRef.current = salvo; vozesEditadasRef.current = false
      setContrato(salvo); setContratoSalvo(salvo)
      setVozesTexto((salvo.vozes_elevenlabs ?? []).join('\n')); setVozesEditadas(false)
      setSucesso('Contrato salvo.'); aoSalvar()
    } catch (e) { if (montado.current) setErro(mensagemErro(e)) } finally { enviandoRef.current = false; if (montado.current) setSalvando(false) }
  }
  return <>
    {erro && <p role="alert" className="alerta alerta-erro">{erro} <button type="button" onClick={() => atualizar(v => v + 1)}>Tentar novamente</button></p>}
    {sucesso && <p role="status">{sucesso}</p>}
    {!contrato ? !erro && <p role="status">Carregando contrato…</p> : <form onSubmit={salvar}>
      <fieldset disabled={salvando} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="campo"><span>Modalidade</span><select value={contrato.tipo} onChange={e => setContrato({ ...contrato, tipo: e.target.value as Contrato['tipo'], mensalidade_brl: contrato.mensalidade_brl ?? 100, limite_brl_mes: contrato.limite_brl_mes ?? 100, servicos: contrato.servicos.includes('openai') ? contrato.servicos : ['openai'] })}>
          <option value="byok">Empresa · contas próprias do cliente</option><option value="pf_gerenciado">Pessoa física · IA incluída pelo Offiz</option>
        </select></label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <label className="campo"><span>Início do contrato</span><input type="date" value={contrato.inicio ?? ''} max={contrato.fim || undefined} onChange={e => setContrato({ ...contrato, inicio: e.target.value || null })} /></label>
          <label className="campo"><span>Término do contrato</span><input type="date" value={contrato.fim ?? ''} min={contrato.inicio || undefined} onChange={e => setContrato({ ...contrato, fim: e.target.value || null })} /></label>
        </div>
        <p className="texto-suave">Datas opcionais, no horário de Brasília. O contrato vale até o fim do último dia. Antes do início e após o término, o cliente perde o acesso ao escritório, inclusive histórico e acervo. O administrador mantém acesso para renovar. Deixe o término vazio para prazo indeterminado.</p>
        <p className="texto-suave">Situação salva: {contrato.vigencia === 'encerrado' ? 'encerrado · acesso bloqueado' : contrato.vigencia === 'aguardando_inicio' ? 'aguardando início · acesso bloqueado' : 'vigente'}.</p>
        <label className="campo"><span>Mensalidade do contrato (R$)</span><input type="number" min="0" max="1000000" step="0.01" required value={contrato.mensalidade_brl ?? 100} onChange={e => setContrato({ ...contrato, mensalidade_brl: e.target.valueAsNumber })} /></label>
        <label className="campo"><span>Saldo mensal para IA (R$)</span><input type="number" min="0" max="1000000" step="0.01" required value={contrato.limite_brl_mes ?? 100} onChange={e => setContrato({ ...contrato, limite_brl_mes: e.target.valueAsNumber })} /></label>
        {contrato.tipo === 'pf_gerenciado' && <>
          <p>OpenAI atende conversas, tarefas e imagens. Libere os complementos conforme o contrato. A cliente usa a web e não configura chaves.</p>
          {provedores.map(p => <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}><input type="checkbox" style={{ width: 18, height: 18, flexShrink: 0 }} checked={contrato.servicos.includes(p)} disabled={p === 'openai'} onChange={e => setContrato({ ...contrato, servicos: e.target.checked ? [...contrato.servicos, p] : contrato.servicos.filter(v => v !== p) })} /> {nomes[p]}</label>)}
          {contrato.servicos.includes('elevenlabs') && <label className="campo">
            <span>Vozes privadas deste cliente (ElevenLabs)</span>
            <textarea aria-label="Vozes privadas deste cliente (ElevenLabs)" rows={2} value={vozesTexto} onChange={e => { setVozesTexto(e.target.value); setVozesEditadas(true); vozesEditadasRef.current = true }} aria-describedby="vozes-contrato-ajuda" />
            <small id="vozes-contrato-ajuda">Cadastre os IDs autorizados para este cliente, separados por linha ou vírgula. Vozes privadas de outros clientes ficam bloqueadas; vozes padrão do ElevenLabs continuam disponíveis. Este cadastro não clona a voz.</small>
          </label>}
          {(contrato.limite_brl_mes ?? 0) >= (contrato.mensalidade_brl ?? 0) && <p className="alerta">O saldo liberado é igual ou maior que a mensalidade. Revise os custos de infraestrutura, suporte e impostos antes de definir sua margem comercial.</p>}
          {contratoSalvo && <><p className="texto-suave">Últimos valores confirmados do contrato. As alterações acima só valem depois de salvar.</p><Saldo contrato={contratoSalvo} mostrarCredito /></>}
        </>}
        <button className="botao botao-primario" type="submit">{salvando ? 'Salvando…' : 'Salvar contrato'}</button>
      </fieldset>
    </form>}
    {contrato?.tipo === 'pf_gerenciado' && <><CreditoCliente orgId={orgId} aoConceder={() => atualizar(v => v + 1)} /><ReservasPendentes orgId={orgId} aoConferir={() => atualizar(v => v + 1)} /></>}
  </>
}

function valorFinanceiro(texto: string, permiteZero: boolean, casas = 6): number | null {
  const limpo = texto.trim()
  if (!/^\d+(?:[,.]\d{1,6})?$/.test(limpo)) return null
  if ((limpo.split(/[,.]/)[1]?.length ?? 0) > casas) return null
  const valor = Number(limpo.replace(',', '.'))
  return Number.isFinite(valor) && valor <= 1_000_000 && (permiteZero ? valor >= 0 : valor > 0) ? valor : null
}

function motivoFinanceiro(texto: string): string | null {
  const motivo = texto.trim()
  return motivo.length >= 5 && motivo.length <= 500 ? motivo : null
}

function CreditoCliente({ orgId, aoConceder }: { orgId: number; aoConceder: () => void }) {
  const [pedido, setPedido] = useState<{ id: string; valor_brl: number; motivo: string } | null>(null)
  const [aberto, setAberto] = useState(false)
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const enviandoRef = useRef(false)
  const montado = useRef(true)
  useEffect(() => { montado.current = true; return () => { montado.current = false } }, [])

  function revisar(e: FormEvent) {
    e.preventDefault()
    const valor_brl = valorFinanceiro(valor, false, 2)
    const justificativa = motivoFinanceiro(motivo)
    if (valor_brl === null) { setErro('Informe um crédito positivo de até R$ 1.000.000, com até duas casas decimais.'); return }
    if (!justificativa) { setErro('Informe um motivo de 5 a 500 caracteres.'); return }
    setPedido({ id: crypto.randomUUID().replace(/-/g, ''), valor_brl, motivo: justificativa })
    setErro('')
  }

  async function conceder() {
    if (!pedido || enviandoRef.current) return
    enviandoRef.current = true
    setOcupado(true); setErro(''); setEnviado(true)
    try {
      await api.post(`/admin/orgs/${orgId}/creditos-ia`, pedido)
      if (!montado.current) return
      setSucesso(`Crédito de ${formatBRL(pedido.valor_brl)} registrado.`)
      setPedido(null); setAberto(false); setValor(''); setMotivo(''); setEnviado(false); aoConceder()
    } catch (e) { if (montado.current) setErro(mensagemErro(e)) }
    finally { enviandoRef.current = false; if (montado.current) setOcupado(false) }
  }

  return <div className="contrato-operacao">
    {!aberto ? <button className="botao botao-fantasma" type="button" onClick={() => { setAberto(true); setErro(''); setSucesso('') }}>Conceder crédito neste mês</button> : <section className="contrato-confirmacao" aria-label="Crédito adicional">
      <h3>Crédito adicional neste mês</h3>
      <p className="texto-suave">O crédito compensa o consumo neste mês, preservando o histórico. O valor não acumula no mês seguinte.</p>
      {!pedido ? <form onSubmit={revisar}>
        <label className="campo"><span>Valor do crédito (R$)</span><input inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} autoFocus /></label>
        <label className="campo"><span>Motivo do crédito</span><textarea value={motivo} maxLength={500} rows={2} onChange={e => setMotivo(e.target.value)} /></label>
        <div className="contrato-operacao-acoes"><button className="botao botao-primario" type="submit">Revisar crédito</button><button className="botao botao-fantasma" type="button" onClick={() => { setAberto(false); setErro('') }}>Cancelar</button></div>
      </form> : <>
        <dl className="contrato-confirmacao-dados"><dt>Crédito a conceder</dt><dd>{formatBRL(pedido.valor_brl)}</dd><dt>Motivo</dt><dd>{pedido.motivo}</dd></dl>
        {enviado && erro && <p className="texto-suave">A confirmação não foi recebida. Reenviar mantém a mesma identificação do crédito, para evitar duplicidade.</p>}
        <div className="contrato-operacao-acoes"><button className="botao botao-primario" type="button" disabled={ocupado} onClick={conceder}>{ocupado ? 'Registrando crédito…' : enviado ? 'Reenviar o mesmo crédito' : 'Confirmar crédito'}</button>
          {!enviado && <><button className="botao botao-fantasma" type="button" onClick={() => setPedido(null)}>Corrigir valores</button><button className="botao botao-fantasma" type="button" onClick={() => { setPedido(null); setAberto(false); setErro('') }}>Cancelar</button></>}
        </div>
      </>}
    </section>}
    {erro && <p role="alert">{erro}</p>}
    {sucesso && <p role="status">{sucesso}</p>}
  </div>
}

interface Reserva { id: string; provedor: string; modelo: string; periodo: string; reserva_brl: number; criado_em: string; estado?: string; custo_confirmado_brl?: number; request_id?: string | null }
function ReservasPendentes({ orgId, aoConferir }: { orgId: number; aoConferir: () => void }) {
  const [reservas, setReservas] = useState<Reserva[] | null>(null)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [versao, atualizar] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [leituraAtual, setLeituraAtual] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [acao, setAcao] = useState<{ tipo: 'conferir' | 'assumir'; reserva: Reserva; custo: string; motivo: string; revisada: boolean; enviada: boolean; conferidaAposErro: boolean } | null>(null)
  const enviandoRef = useRef(false)
  const montado = useRef(true)
  useEffect(() => { montado.current = true; return () => { montado.current = false } }, [])
  useEffect(() => {
    let ativo = true
    setCarregando(true); setLeituraAtual(false)
    api.get<Reserva[]>(`/admin/orgs/${orgId}/reservas-ia`).then(r => {
      if (!ativo) return
      if (!Array.isArray(r) || !r.every(reserva => reserva && typeof reserva.id === 'string' && !!reserva.id
        && typeof reserva.provedor === 'string' && typeof reserva.modelo === 'string' && typeof reserva.periodo === 'string'
        && numeroConfirmado(reserva.reserva_brl) && reserva.reserva_brl >= 0 && typeof reserva.criado_em === 'string'
        && (reserva.custo_confirmado_brl === undefined || (numeroConfirmado(reserva.custo_confirmado_brl) && reserva.custo_confirmado_brl >= 0)))) throw new Error('Invalid reservation list')
      setReservas(r); setErro(''); setLeituraAtual(true)
      setAcao(atual => {
        if (!atual?.enviada) return atual
        const pendente = r.find(reserva => reserva.id === atual.reserva.id)
        if (!pendente || (atual.tipo === 'assumir' && pendente.estado === 'assumido_offiz')) return null
        return { ...atual, conferidaAposErro: true }
      })
    }).catch(e => { if (ativo) setErro(mensagemErro(e)) }).finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [orgId, versao])

  function preparar(r: Reserva, tipo: 'conferir' | 'assumir') {
    if (!leituraAtual || carregando || ocupado) return
    setAcao({ tipo, reserva: r, custo: String(Math.round((r.reserva_brl + (r.custo_confirmado_brl ?? 0)) * 1_000_000) / 1_000_000), motivo: '', revisada: false, enviada: false, conferidaAposErro: false })
    setErro(''); setSucesso('')
  }

  function revisar(e: FormEvent) {
    e.preventDefault()
    if (!acao) return
    if (acao.tipo === 'conferir' && valorFinanceiro(acao.custo, true) === null) { setErro('Informe um custo de R$ 0 a R$ 1.000.000, com até seis casas decimais.'); return }
    const motivo = motivoFinanceiro(acao.motivo)
    if (!motivo) { setErro('Informe o motivo e a referência da conferência, de 5 a 500 caracteres.'); return }
    setAcao({ ...acao, motivo, revisada: true }); setErro('')
  }

  async function confirmar() {
    if (!acao?.revisada || !leituraAtual || carregando || enviandoRef.current || (acao.enviada && !acao.conferidaAposErro)) return
    const { reserva, tipo, motivo } = acao
    enviandoRef.current = true; setOcupado(true); setErro('')
    setAcao({ ...acao, enviada: true, conferidaAposErro: false })
    try {
      if (tipo === 'conferir') await api.put(`/admin/orgs/${orgId}/reservas-ia/${reserva.id}`, { custo_brl: valorFinanceiro(acao.custo, true), motivo })
      else await api.post(`/admin/orgs/${orgId}/reservas-ia/${reserva.id}/assumir`, { motivo })
      if (!montado.current) return
      setSucesso(tipo === 'conferir' ? 'Custo da chamada conferido.' : 'Pendência assumida pelo Offiz.')
      setAcao(null); atualizar(v => v + 1); aoConferir()
    } catch (e) { if (montado.current) setErro(mensagemErro(e)) }
    finally { enviandoRef.current = false; if (montado.current) setOcupado(false) }
  }

  return <details className="contrato-operacao"><summary>Chamadas em processamento ou conferência{reservas !== null ? ` (${reservas.length})` : ''}</summary>
    <p className="texto-suave">Falhas de conexão mantêm o saldo reservado. Depois de seis horas, confira a cobrança no fornecedor antes de liberar ou registrar o custo.</p>
    {erro && <p role="alert">{erro}</p>}
    {sucesso && <p role="status">{sucesso}</p>}
    {carregando && <p role="status">Carregando chamadas…</p>}
    {!carregando && !leituraAtual && reservas !== null && <p className="texto-suave">Lista anterior, sem atualização confirmada. Atualize as chamadas antes de alterar custos.</p>}
    <button type="button" className="botao-texto" disabled={carregando || ocupado} onClick={() => atualizar(v => v + 1)}>Atualizar chamadas</button>
    {reservas?.length === 0 && !carregando && !erro && <p className="texto-suave">Nenhuma chamada pendente de conferência.</p>}
    <ul className="contrato-reservas">{reservas?.map(r => <li key={r.id}>{r.provedor} · {r.modelo} · {r.periodo} · {formatBRL(r.reserva_brl)} em conferência
      {r.estado === 'assumido_offiz' && <strong> · responsabilidade do Offiz, sem reduzir o saldo do cliente</strong>}
      {!!r.custo_confirmado_brl && <> · {formatBRL(r.custo_confirmado_brl)} já contabilizados</>}
      {r.request_id && <small> · Comprovante: {r.request_id}</small>}
      {' '}<button type="button" className="botao-texto" disabled={ocupado || acao !== null || carregando || !leituraAtual || !toDate(r.criado_em) || Date.now() - toDate(r.criado_em)!.getTime() < 6 * 3600000} onClick={() => preparar(r, 'conferir')}>Conferir custo</button>
      {r.estado !== 'assumido_offiz' && <button type="button" className="botao-texto" disabled={ocupado || acao !== null || carregando || !leituraAtual} onClick={() => preparar(r, 'assumir')}>Offiz assume a pendência</button>}</li>)}</ul>
    {acao && <section className="contrato-confirmacao" aria-label={acao.tipo === 'conferir' ? 'Conferência de custo' : 'Assumir pendência'}>
      <h3>{acao.tipo === 'conferir' ? 'Conferir custo da chamada' : 'Assumir pendência pelo Offiz'}</h3>
      <p>{acao.reserva.provedor} · {acao.reserva.modelo} · {acao.reserva.periodo}</p>
      {acao.tipo === 'conferir' ? <p className="texto-suave">Informe o custo total conferido no fornecedor, com câmbio e margem do contrato. A parte já contabilizada não será cobrada novamente. Use zero somente se não houve cobrança.</p> : <p className="texto-suave">O Offiz assumirá até {formatBRL(acao.reserva.reserva_brl)} de cobrança incerta. O saldo reservado do cliente será liberado; o consumo confirmado permanece.</p>}
      {!acao.revisada ? <form onSubmit={revisar}>
        {acao.tipo === 'conferir' && <label className="campo"><span>Custo total conferido (R$)</span><input inputMode="decimal" value={acao.custo} autoFocus onChange={e => setAcao({ ...acao, custo: e.target.value })} /></label>}
        <label className="campo"><span>Motivo e referência da conferência</span><textarea value={acao.motivo} rows={2} autoFocus={acao.tipo === 'assumir'} maxLength={500} onChange={e => setAcao({ ...acao, motivo: e.target.value })} /></label>
        <div className="contrato-operacao-acoes"><button className="botao botao-primario" type="submit">Revisar alteração</button><button className="botao botao-fantasma" type="button" onClick={() => { setAcao(null); setErro('') }}>Cancelar</button></div>
      </form> : <>
        <dl className="contrato-confirmacao-dados"><dt>{acao.tipo === 'conferir' ? 'Custo total conferido (R$)' : 'Pendência a assumir'}</dt><dd>{acao.tipo === 'conferir' ? acao.custo : formatBRL(acao.reserva.reserva_brl)}</dd><dt>Motivo</dt><dd>{acao.motivo}</dd></dl>
        {acao.enviada && !acao.conferidaAposErro && !ocupado && <p className="texto-suave">A confirmação não foi recebida. Atualize as chamadas para conferir a situação antes de tentar novamente.</p>}
        <div className="contrato-operacao-acoes"><button className="botao botao-primario" type="button" disabled={ocupado || carregando || !leituraAtual || (acao.enviada && !acao.conferidaAposErro)} onClick={confirmar}>{ocupado ? 'Registrando…' : acao.tipo === 'conferir' ? 'Confirmar custo conferido' : 'Confirmar responsabilidade do Offiz'}</button>
          {!acao.enviada && <><button className="botao botao-fantasma" type="button" onClick={() => setAcao({ ...acao, revisada: false })}>Corrigir valores</button><button className="botao botao-fantasma" type="button" onClick={() => { setAcao(null); setErro('') }}>Cancelar</button></>}
        </div>
      </>}
    </section>}
  </details>
}

export function AdminContratos({ orgs, aoSalvar }: { orgs: OrgResumo[] | null; aoSalvar: () => void }) {
  const [contas, setContas] = useState<Contas | null>(null)
  const [chaves, setChaves] = useState<Partial<Record<Provedor, string>>>({})
  const [orgId, setOrgId] = useState<number | null>(null)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState<Provedor | null>(null)
  const [testes, setTestes] = useState<Partial<Record<Provedor, TesteConexao>>>({})
  const [versao, atualizar] = useState(0)
  const bloqueio = useRef(false)
  const montado = useRef(true)
  const consultaRef = useRef(0)
  const contasSalvasRef = useRef<Contas | null>(null)
  useEffect(() => { montado.current = true; return () => { montado.current = false } }, [])
  useEffect(() => {
    let ativo = true
    const consulta = ++consultaRef.current
    setErro('')
    api.get<Contas>('/admin/contas-ia').then(c => {
      if (!ativo || consulta !== consultaRef.current) return
      if (!contasConfirmadas(c)) throw new Error('Invalid account snapshot')
      const anteriores = contasSalvasRef.current
      setContas(atuais => preservarEdicoes(atuais, anteriores, c, ['usd_brl', 'margem_custo_pct', 'elevenlabs_usd_mil_caracteres']))
      contasSalvasRef.current = c
    }).catch(e => { if (ativo && consulta === consultaRef.current) setErro(mensagemErro(e)) })
    return () => { ativo = false }
  }, [versao])
  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!contas || bloqueio.current) return
    bloqueio.current = true
    consultaRef.current += 1
    setSalvando(true); setErro(''); setSucesso('')
    try {
      const { usd_brl, margem_custo_pct, elevenlabs_usd_mil_caracteres } = contas
      const salvas = await api.put<Contas>('/admin/contas-ia', { chaves, usd_brl, margem_custo_pct, elevenlabs_usd_mil_caracteres })
      if (!montado.current) return
      if (!contasConfirmadas(salvas)) throw new Error('Invalid account response')
      consultaRef.current += 1; contasSalvasRef.current = salvas
      setContas(salvas)
      setChaves({}); setTestes({}); setSucesso('Contas compartilhadas salvas.'); aoSalvar()
    } catch (e) { if (montado.current) setErro(mensagemErro(e)) } finally { bloqueio.current = false; if (montado.current) setSalvando(false) }
  }
  async function testar(provedor: Provedor) {
    if (bloqueio.current || !contas?.configuradas[provedor] || chaves[provedor] !== undefined) return
    bloqueio.current = true
    setTestando(provedor)
    setTestes(atuais => ({ ...atuais, [provedor]: undefined }))
    try {
      const resultado = await api.post<TesteConexao>(`/admin/contas-ia/${provedor}/testar`, {})
      if (!montado.current) return
      if (!resultado || typeof resultado.ok !== 'boolean' || typeof resultado.mensagem !== 'string'
        || typeof resultado.testado_em !== 'string' || (resultado.ok && !toDate(resultado.testado_em))
        || !numeroConfirmado(resultado.duracao_ms) || resultado.duracao_ms < 0) throw new Error('Invalid connection test response')
      setTestes(atuais => ({ ...atuais, [provedor]: resultado }))
    } catch (e) {
      if (montado.current) setTestes(atuais => ({ ...atuais, [provedor]: { ok: false, mensagem: mensagemErro(e), testado_em: '', duracao_ms: 0 } }))
    } finally { bloqueio.current = false; if (montado.current) setTestando(null) }
  }
  return <div className="config-grid">
    <section className="cartao"><h2 className="secao-titulo">Contas compartilhadas de IA</h2>
      <p>Cadastre cada chave uma vez. Todos os contratos de pessoa física usam essas conexões, com saldo e permissões separados por cliente.</p>
      <p className="texto-suave">O teste consulta a chave salva, sem gerar conteúdo nem descontar saldo. Ele verifica conexão e permissão de consulta; crédito e geração são verificados ao produzir.</p>
      {erro && <p role="alert" className="alerta alerta-erro">{erro} <button type="button" onClick={() => atualizar(v => v + 1)}>Tentar novamente</button></p>}
      {sucesso && <p role="status">{sucesso}</p>}
      {!contas ? !erro && <p role="status">Carregando conexões…</p> : <form onSubmit={salvar}>
        <fieldset disabled={salvando || testando !== null} style={{ border: 0, padding: 0, margin: 0 }}>
          {provedores.map(p => <div key={p} style={{ marginBottom: 20 }}><label className="campo"><span>{nomes[p]} · {contas.configuradas[p] ? 'chave cadastrada' : 'sem chave'}</span><input type="password" autoComplete="new-password" value={chaves[p] ?? ''} placeholder="Cole para cadastrar ou substituir" onChange={e => { setChaves({ ...chaves, [p]: e.target.value || undefined }); setTestes({ ...testes, [p]: undefined }) }} /></label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="botao botao-pequeno botao-fantasma" type="button" aria-label={`Testar conexão ${nomes[p].split(' · ')[0]}`} disabled={!contas.configuradas[p] || chaves[p] !== undefined} onClick={() => testar(p)}>{testando === p ? 'Testando…' : 'Testar conexão'}</button>
              {contas.configuradas[p] && <button className="botao botao-pequeno botao-fantasma" type="button" onClick={() => { setChaves({ ...chaves, [p]: chaves[p] === '' ? undefined : '' }); setTestes({ ...testes, [p]: undefined }) }}>{chaves[p] === '' ? 'Cancelar remoção' : 'Remover ao salvar'}</button>}
            </div>
            {chaves[p] !== undefined && <p className="texto-suave">Salve as alterações antes de testar esta conexão.</p>}
            {testes[p] && <p role="status" className={testes[p]?.ok ? 'texto-suave' : 'alerta'}><strong>{testes[p]?.ok ? 'Conexão confirmada. ' : 'Conexão não confirmada. '}</strong>{testes[p]?.mensagem}{testes[p]?.testado_em && ` Teste às ${new Date(testes[p]!.testado_em).toLocaleTimeString('pt-BR')}.`}</p>}
          </div>)}
          <label className="campo"><span>Câmbio de custo: US$ 1 em R$</span><input type="number" min="0.01" max="100" step="0.01" required value={contas.usd_brl} onChange={e => setContas({ ...contas, usd_brl: e.target.valueAsNumber })} /></label>
          <label className="campo"><span>Margem de segurança sobre o custo (%)</span><input type="number" min="0" max="300" step="1" required value={contas.margem_custo_pct} onChange={e => setContas({ ...contas, margem_custo_pct: e.target.valueAsNumber })} /></label>
          <label className="campo"><span>ElevenLabs: US$ por mil caracteres, conforme sua conta</span><input type="number" min="0.001" max="100" step="0.001" required value={contas.elevenlabs_usd_mil_caracteres} onChange={e => setContas({ ...contas, elevenlabs_usd_mil_caracteres: e.target.valueAsNumber })} /></label>
          <p className="texto-suave">Ajuste o câmbio e a tarifa da sua conta. A margem ajuda a cobrir variações e taxas. Operações sem tarifa ficam bloqueadas.</p>
          <button className="botao botao-primario" type="submit">{salvando ? 'Salvando…' : 'Salvar contas de IA'}</button>
        </fieldset>
      </form>}
    </section>
    <section className="cartao"><h2 className="secao-titulo">Contrato de cada cliente</h2>
      <label className="campo"><span>Cliente</span><select value={orgId ?? ''} onChange={e => setOrgId(e.target.value ? Number(e.target.value) : null)}><option value="">Selecione o cliente</option>{orgs?.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></label>
      {orgId !== null && <EditorContrato key={orgId} orgId={orgId} aoSalvar={aoSalvar} />}
    </section>
  </div>
}
