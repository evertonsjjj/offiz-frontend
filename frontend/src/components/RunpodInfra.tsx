import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import { formatBRL, formatDataHora } from '../lib/format'
import { useIdioma, type Traduzir } from '../lib/i18n'

interface ConfigRunpod {
  chave_configurada: boolean
  chave_runtime_configurada: boolean
  habilitado: boolean
  limite_brl_mes: number
  usd_brl: number
  endpoint_id: string
  image: string
  periodo: string
  consumido_brl: number
  reservado_brl: number
  disponivel_brl: number
  limite_usd_por_job: number
  allowed_org_ids: number[]
  max_usd_per_second: number | string
  ultima_verificacao: VerificacaoRunpod | null
}

interface ContratoGPU {
  id: number
  nome: string
  modalidade: string
  contrato_ativo: boolean
  incluido: boolean
}

interface OperacaoGPU {
  id: string
  org_id: number | null
  job_id: number | null
  state: string
  reserva_brl: number
  custo_brl: number | null
  criado_em: string
  aguardando_conferencia: boolean
}

interface OperacoesGPU {
  total: number
  itens: OperacaoGPU[]
  periodo: string
  consumido_brl: number
  reservado_brl: number
  disponivel_brl: number
}

interface CobrancaRunpod {
  consultado_em: string
  periodo: string
  endpoint_id: string
  registros: number
  totais_usd: { cpuAmount: number; diskAmount: number; feeAmount: number; gpuAmount: number; totalAmount: number }
  total_brl_observado: number
  cambio: number
  comprovante_sha256: string
  por_tarefa: false
  consolidacao_confirmada: false
}

interface VerificacaoRunpod {
  conectado: boolean
  verificado_em: string
  saldo_usd: number | null
  consumo_usd_hora: number | null
  recarga_automatica: boolean | null
  tarifas: Array<{
    gpu: string
    pool: string
    vram_gb: number
    usd_hora: number
    usd_segundo: number
    disponibilidade: string | null
  }>
  endpoint: {
    id: string
    configuracao_segura: boolean
    execucao_disponivel: boolean
    pausado: boolean | null
    motivo: string | null
  } | null
}

interface Formulario {
  limite: string
  cambio: string
  endpoint: string
  imagem: string
  limiteJob: string
  tarifa: string
  habilitado: boolean
  contratos: number[]
}

const objeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === 'object' && valor !== null && !Array.isArray(valor)
const numero = (valor: unknown): valor is number => typeof valor === 'number' && Number.isFinite(valor)
const valorNaoNegativo = (valor: unknown): valor is number => numero(valor) && valor >= 0
const dataConsulta = (valor: unknown): valor is string => typeof valor === 'string' && !!valor && Number.isFinite(Date.parse(valor))
const periodoValido = (valor: unknown): valor is string => typeof valor === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(valor)
const contratoElegivel = (contrato: ContratoGPU) => contrato.modalidade === 'pf_gerenciado' && contrato.contrato_ativo === true

function verificacaoValida(valor: unknown, endpoint?: string): valor is VerificacaoRunpod {
  if (!objeto(valor) || valor.conectado !== true || !dataConsulta(valor.verificado_em)
    || !(valor.saldo_usd === null || numero(valor.saldo_usd))
    || !(valor.consumo_usd_hora === null || valorNaoNegativo(valor.consumo_usd_hora))
    || !(valor.recarga_automatica === null || typeof valor.recarga_automatica === 'boolean')
    || !Array.isArray(valor.tarifas) || !valor.tarifas.every(tarifa => objeto(tarifa)
      && typeof tarifa.gpu === 'string' && typeof tarifa.pool === 'string'
      && valorNaoNegativo(tarifa.vram_gb) && valorNaoNegativo(tarifa.usd_hora) && valorNaoNegativo(tarifa.usd_segundo))) return false
  return valor.endpoint === null || (objeto(valor.endpoint) && typeof valor.endpoint.id === 'string'
    && (!endpoint || valor.endpoint.id === endpoint) && typeof valor.endpoint.configuracao_segura === 'boolean'
    && typeof valor.endpoint.execucao_disponivel === 'boolean'
    && (valor.endpoint.pausado === null || typeof valor.endpoint.pausado === 'boolean'))
}

function configValida(valor: unknown): valor is ConfigRunpod {
  return objeto(valor) && ['chave_configurada', 'chave_runtime_configurada', 'habilitado'].every(campo => typeof valor[campo] === 'boolean')
    && [valor.limite_brl_mes, valor.usd_brl, valor.limite_usd_por_job, valor.consumido_brl, valor.reservado_brl, valor.disponivel_brl].every(valorNaoNegativo)
    && typeof valor.endpoint_id === 'string' && typeof valor.image === 'string' && periodoValido(valor.periodo)
    && Array.isArray(valor.allowed_org_ids) && valor.allowed_org_ids.every(id => Number.isSafeInteger(id) && id > 0)
    && (numero(valor.max_usd_per_second) || (typeof valor.max_usd_per_second === 'string' && !!valor.max_usd_per_second.trim()))
    && Number.isFinite(Number(valor.max_usd_per_second)) && Number(valor.max_usd_per_second) >= 0
    && (valor.ultima_verificacao === null || verificacaoValida(valor.ultima_verificacao, valor.endpoint_id))
}

function cobrancaValida(valor: unknown, endpoint: string): valor is CobrancaRunpod {
  return objeto(valor) && dataConsulta(valor.consultado_em) && periodoValido(valor.periodo) && valor.endpoint_id === endpoint
    && Number.isSafeInteger(valor.registros) && numero(valor.registros) && valor.registros >= 0
    && objeto(valor.totais_usd) && ['cpuAmount', 'diskAmount', 'feeAmount', 'gpuAmount', 'totalAmount'].every(campo => valorNaoNegativo((valor.totais_usd as Record<string, unknown>)[campo]))
    && valorNaoNegativo(valor.total_brl_observado) && numero(valor.cambio) && valor.cambio > 0
    && typeof valor.comprovante_sha256 === 'string' && /^[a-f0-9]{64}$/.test(valor.comprovante_sha256)
    && valor.por_tarefa === false && valor.consolidacao_confirmada === false
}

const formularioDe = (config: ConfigRunpod): Formulario => ({
  limite: String(config.limite_brl_mes),
  cambio: String(config.usd_brl),
  endpoint: config.endpoint_id,
  imagem: config.image,
  limiteJob: String(config.limite_usd_por_job),
  tarifa: String(config.max_usd_per_second ?? 0),
  habilitado: config.habilitado,
  contratos: [...(config.allowed_org_ids ?? [])].sort((a, b) => a - b),
})

// Do not render provider response bodies: an upstream error may contain credentials.
function mensagemErro(erro: unknown, t: Traduzir): string {
  if (erro instanceof ApiError) {
    if (erro.status === 401 || erro.status === 403) return t('A sessão precisa de acesso de administrador. Entre novamente e tente outra vez.', 'An administrator session is required. Sign in again and retry.')
    if (erro.status === 409) return t('Há uma operação pendente ou a configuração mudou. Atualize os dados antes de tentar novamente.', 'An operation is pending or the configuration changed. Refresh the data before retrying.')
    if (erro.status === 422) return t('Revise a chave, os limites e os campos avançados antes de salvar.', 'Review the key, limits, and advanced fields before saving.')
    if (erro.status === 429) return t('Aguarde um momento antes de verificar novamente.', 'Wait a moment before checking again.')
  }
  return t('Não foi possível concluir a consulta ou salvar a configuração. Tente novamente.', 'Could not complete the request or save the settings. Please retry.')
}

export function RunpodInfra() {
  const { t, idioma } = useIdioma()
  const [config, setConfig] = useState<ConfigRunpod | null>(null)
  const [form, setForm] = useState<Formulario | null>(null)
  const [chave, setChave] = useState('')
  const [chaveRuntime, setChaveRuntime] = useState('')
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [verificacao, setVerificacao] = useState<VerificacaoRunpod | null>(null)
  const [ocupado, setOcupado] = useState<'salvar' | 'verificar' | 'cobranca' | null>(null)
  const [cobranca, setCobranca] = useState<CobrancaRunpod | null>(null)
  const [erroCobranca, setErroCobranca] = useState('')
  const [versao, atualizar] = useState(0)
  const [contratos, setContratos] = useState<ContratoGPU[] | null>(null)
  const [erroContratos, setErroContratos] = useState('')
  const [versaoContratos, atualizarContratos] = useState(0)
  const [operacoes, setOperacoes] = useState<OperacoesGPU | null>(null)
  const [erroOperacoes, setErroOperacoes] = useState('')
  const [carregandoOperacoes, setCarregandoOperacoes] = useState(false)
  const [paginaOperacoes, setPaginaOperacoes] = useState(0)
  const [versaoOperacoes, atualizarOperacoes] = useState(0)
  const bloqueio = useRef(false)
  const montado = useRef(true)
  const traduzirRef = useRef(t)
  useEffect(() => { traduzirRef.current = t }, [t])

  useEffect(() => {
    montado.current = true
    return () => { montado.current = false }
  }, [])

  useEffect(() => {
    let ativo = true
    setErro('')
    api.get<ConfigRunpod>('/admin/gpu').then(dados => {
      if (!ativo) return
      if (!configValida(dados)) throw new Error('Invalid GPU configuration snapshot')
      setConfig(dados)
      setForm(formularioDe(dados))
      setVerificacao(dados.ultima_verificacao)
    }).catch(e => { if (ativo) setErro(mensagemErro(e, traduzirRef.current)) })
    return () => { ativo = false }
  }, [versao])

  useEffect(() => {
    let ativo = true
    setErroContratos(''); setContratos(null)
    api.get<{ itens: ContratoGPU[] }>('/admin/gpu/contratos').then(dados => {
      if (!Array.isArray(dados.itens) || !dados.itens.every(contrato => objeto(contrato) && Number.isSafeInteger(contrato.id)
        && contrato.id > 0 && typeof contrato.nome === 'string' && typeof contrato.modalidade === 'string'
        && typeof contrato.contrato_ativo === 'boolean' && typeof contrato.incluido === 'boolean')) throw new Error('Invalid contract list')
      if (ativo) setContratos(dados.itens)
    }).catch(() => { if (ativo) setErroContratos(traduzirRef.current('Não foi possível consultar os contratos. Tente carregar novamente antes de habilitar.', 'Could not load contracts. Retry before enabling GPU.')) })
    return () => { ativo = false }
  }, [versaoContratos])

  useEffect(() => {
    let ativo = true
    setCarregandoOperacoes(true); setErroOperacoes('')
    api.get<OperacoesGPU>(`/admin/gpu/operacoes?limit=20&offset=${paginaOperacoes * 20}`).then(dados => {
      if (!Array.isArray(dados.itens) || !periodoValido(dados.periodo) || !Number.isSafeInteger(dados.total) || dados.total < 0
        || ![dados.consumido_brl, dados.reservado_brl, dados.disponivel_brl].every(valorNaoNegativo)
        || !dados.itens.every(op => objeto(op) && typeof op.id === 'string' && !!op.id
          && (op.org_id === null || (Number.isSafeInteger(op.org_id) && op.org_id > 0))
          && (op.job_id === null || (Number.isSafeInteger(op.job_id) && op.job_id > 0))
          && typeof op.state === 'string' && typeof op.criado_em === 'string' && typeof op.aguardando_conferencia === 'boolean'
          && valorNaoNegativo(op.reserva_brl) && (op.custo_brl === null || valorNaoNegativo(op.custo_brl)))) {
        throw new Error('Invalid operation budget snapshot')
      }
      if (ativo) setOperacoes(dados)
    }).catch(() => { if (ativo) { setOperacoes(null); setErroOperacoes(traduzirRef.current('Não foi possível consultar as operações GPU.', 'Could not load GPU operations.')) } })
      .finally(() => { if (ativo) setCarregandoOperacoes(false) })
    return () => { ativo = false }
  }, [paginaOperacoes, versaoOperacoes])

  const alterado = !!config && !!form && (
    chave !== '' || chaveRuntime !== '' || form.limite !== String(config.limite_brl_mes)
    || form.cambio !== String(config.usd_brl) || form.endpoint !== config.endpoint_id
    || form.imagem !== config.image
    || form.limiteJob !== String(config.limite_usd_por_job)
    || form.tarifa !== String(config.max_usd_per_second ?? 0)
    || form.habilitado !== config.habilitado
    || JSON.stringify(form.contratos) !== JSON.stringify([...(config.allowed_org_ids ?? [])].sort((a, b) => a - b))
  )

  function mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]) {
    if (!form) return
    setForm({ ...form, [campo]: valor })
    setSucesso('')
    setVerificacao(null)
    setCobranca(null); setErroCobranca('')
  }

  function selecionarContrato(id: number, incluir: boolean) {
    if (!form) return
    mudar('contratos', (incluir ? [...new Set([...form.contratos, id])] : form.contratos.filter(valor => valor !== id)).sort((a, b) => a - b))
  }

  async function salvar(evento: FormEvent) {
    evento.preventDefault()
    if (!form || !config || bloqueio.current) return
    const limite = Number(form.limite), cambio = Number(form.cambio), limiteJob = Number(form.limiteJob)
    if (!form.limite.trim() || !Number.isFinite(limite) || limite < 0 || limite > 1_000_000
      || !form.cambio.trim() || !Number.isFinite(cambio) || cambio <= 0 || cambio > 100) {
      setErro(t('Informe teto de R$ 0 a R$ 1.000.000 e câmbio maior que zero, até R$ 100.', 'Enter a BRL 0–1,000,000 limit and an exchange rate greater than zero, up to BRL 100.'))
      return
    }
    if (!form.limiteJob.trim() || !Number.isFinite(limiteJob) || limiteJob < 0 || limiteJob > 1000) {
      setErro(t('Informe um limite por operação de US$ 0 a US$ 1.000.', 'Enter a per-operation limit from USD 0 to USD 1,000.'))
      return
    }
    const tarifa = Number(form.tarifa)
    if (!form.tarifa.trim() || !Number.isFinite(tarifa) || tarifa < 0 || tarifa > 0.001) {
      setErro(t('Informe a tarifa máxima entre US$ 0 e US$ 0,001 por segundo.', 'Enter a maximum rate between USD 0 and USD 0.001 per second.'))
      return
    }
    if (!/^[A-Za-z0-9_-]{0,80}$/.test(form.endpoint.trim())
      || (form.imagem.trim() && !/^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/.test(form.imagem.trim()))) {
      setErro(t('Informe um ID de endpoint válido e uma imagem fixada por @sha256 com 64 caracteres, ou deixe ambos vazios.', 'Enter a valid endpoint ID and an image pinned with a 64-character @sha256 digest, or leave them blank.'))
      return
    }
    if ([chave, chaveRuntime].some(valor => valor && (!valor.trim() || valor.length > 4096 || /[\r\n\0]/.test(valor)))) {
      setErro(t('As chaves Runpod não podem conter apenas espaços ou quebras de linha.', 'Runpod keys cannot contain only whitespace or include line breaks.'))
      return
    }
    if (form.habilitado && (!contratos || erroContratos || !form.contratos.length
      || form.contratos.some(id => !contratos.some(contrato => contrato.id === id && contratoElegivel(contrato))))) {
      setErro(contratos?.some(contrato => form.contratos.includes(contrato.id) && contrato.modalidade !== 'pf_gerenciado')
        ? t('Selecione somente contratos ativos e gerenciados pelo Offiz antes de habilitar GPU.', 'Select only active plans managed by Offiz before enabling GPU.')
        : t('Selecione somente contratos ativos antes de habilitar GPU.', 'Select only active contracts before enabling GPU.'))
      return
    }
    if (form.habilitado && (limite <= 0 || limiteJob <= 0 || tarifa <= 0 || !form.endpoint.trim() || !form.imagem.trim()
      || !(chave.trim() || config.chave_configurada) || !(chaveRuntime.trim() || config.chave_runtime_configurada))) {
      setErro(t('Para habilitar, configure as duas chaves, endpoint, imagem e limites positivos, incluindo a tarifa.', 'To enable GPU, configure both keys, the endpoint, image, and positive limits, including the rate.'))
      return
    }
    bloqueio.current = true
    setOcupado('salvar'); setErro(''); setSucesso(''); setCobranca(null); setErroCobranca('')
    try {
      const dados = await api.put<ConfigRunpod>('/admin/gpu', {
        habilitado: form.habilitado,
        allowed_org_ids: form.contratos,
        max_usd_per_second: form.tarifa.trim(),
        limite_brl_mes: limite,
        usd_brl: cambio,
        limite_usd_por_job: limiteJob,
        endpoint_id: form.endpoint.trim(),
        image: form.imagem.trim(),
        ...(chave ? { api_key: chave.trim() } : {}),
        ...(chaveRuntime ? { runtime_api_key: chaveRuntime.trim() } : {}),
      })
      if (!montado.current) return
      if (!configValida(dados)) throw new Error('Invalid GPU save response')
      setConfig(dados); setForm(formularioDe(dados)); setChave(''); setChaveRuntime('')
      setVerificacao(dados.ultima_verificacao)
      atualizarOperacoes(v => v + 1)
      setSucesso(dados.habilitado
        ? t('Configuração Runpod salva. GPU habilitada somente para os contratos selecionados.', 'Runpod settings saved. GPU enabled only for the selected contracts.')
        : t('Configuração Runpod salva. Geração permanece desabilitada.', 'Runpod settings saved. Generation remains disabled.'))
    } catch (e) { if (montado.current) setErro(form.habilitado && e instanceof ApiError && e.status === 409
      ? t('A ativação não foi confirmada. Confira saldo, tarifa, chaves, endpoint pronto e recarga automática desligada. Uma operação pendente ou alteração simultânea também pode bloquear o salvamento.', 'Activation was not confirmed. Check balance, rate, keys, a ready endpoint, and disabled automatic top-up. A pending operation or concurrent change may also block saving.')
      : mensagemErro(e, t)) }
    finally { bloqueio.current = false; if (montado.current) setOcupado(null) }
  }

  async function verificar() {
    if (bloqueio.current || !config?.chave_configurada || alterado) return
    bloqueio.current = true
    setOcupado('verificar'); setErro(''); setSucesso(''); setVerificacao(null)
    try {
      const dados = await api.post<VerificacaoRunpod>('/admin/gpu/verificar', {})
      if (!verificacaoValida(dados, config.endpoint_id)) throw new Error('Invalid GPU query response')
      if (montado.current) setVerificacao(dados)
    } catch (e) { if (montado.current) setErro(mensagemErro(e, t)) }
    finally { bloqueio.current = false; if (montado.current) setOcupado(null) }
  }

  async function consultarCobranca() {
    if (bloqueio.current || !config?.chave_configurada || !config.endpoint_id || alterado) return
    bloqueio.current = true
    setOcupado('cobranca'); setCobranca(null); setErroCobranca('')
    try {
      const dados = await api.post<CobrancaRunpod>('/admin/gpu/cobranca', {})
      if (!cobrancaValida(dados, config.endpoint_id)) throw new Error('Invalid GPU billing response')
      if (montado.current) setCobranca(dados)
    } catch (e) { if (montado.current) setErroCobranca(mensagemErro(e, t)) }
    finally { bloqueio.current = false; if (montado.current) setOcupado(null) }
  }

  const usd = (valor: number | null | undefined, casas = 2) => typeof valor === 'number' && Number.isFinite(valor)
    ? `US$ ${valor.toLocaleString(idioma, { minimumFractionDigits: casas, maximumFractionDigits: casas })}`
    : t('Não informado', 'Not available')

  const estadoOperacao = (op: OperacaoGPU) => op.aguardando_conferencia ? t('Aguardando conferência', 'Awaiting reconciliation') : ({
    reservado: t('Reservado', 'Reserved'), enviando: t('Enviando', 'Submitting'), executando: t('Em execução', 'Running'),
    incerto: t('Execução incerta', 'Execution uncertain'), encerramento_pendente: t('Encerramento pendente', 'Shutdown pending'),
    encerrado: t('Encerrado', 'Ended'), concluido: t('Custo conciliado', 'Cost reconciled'), cancelado_sem_envio: t('Cancelado antes do envio', 'Cancelled before submission'),
  }[op.state] ?? t('Estado desconhecido', 'Unknown state'))

  return <section className="cartao" aria-label={t('Infraestrutura Runpod', 'Runpod infrastructure')}>
    <h2 className="secao-titulo">{t('Runpod · infraestrutura de vídeo', 'Runpod · video infrastructure')}</h2>
    <p>{t('Incluído no contrato — custo do Offiz, sem desconto no saldo do cliente.', 'Included in the contract — an Offiz expense, with no deduction from the client balance.')}</p>
    <p className="texto-suave">{t('Salvar ou verificar não inicia um trabalho. Habilitar permite que tarefas dos contratos selecionados usem GPU dentro dos limites.', 'Saving or checking does not start a job. Enabling GPU allows tasks from selected contracts to use it within the configured limits.')}</p>
    {config && <p><strong>{config.habilitado ? t('GPU habilitada para contratos selecionados', 'GPU enabled for selected contracts') : t('Geração por GPU desabilitada', 'GPU generation disabled')}</strong></p>}
    {erro && <p role="alert" className="alerta alerta-erro">{erro}</p>}
    {sucesso && <p role="status">{sucesso}</p>}
    {!config || !form ? <>
      {!erro && <p role="status">{t('Carregando conexão Runpod…', 'Loading Runpod connection…')}</p>}
      {erro && <button type="button" className="botao botao-fantasma" onClick={() => atualizar(v => v + 1)}>{t('Tentar novamente', 'Retry')}</button>}
    </> : <>
      <form onSubmit={salvar} aria-label={t('Configuração Runpod', 'Runpod settings')}>
        <fieldset disabled={ocupado !== null} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <label className="campo"><span>{t('Chave Runpod de consulta da conta', 'Runpod account query key')} · {config.chave_configurada ? t('cadastrada', 'saved') : t('não cadastrada', 'not saved')}</span>
            <input type="password" autoComplete="new-password" spellCheck={false} maxLength={4096} value={chave} onChange={e => { setChave(e.target.value); setSucesso(''); setVerificacao(null); setCobranca(null); setErroCobranca('') }} placeholder={t('Cole para cadastrar ou substituir', 'Paste to add or replace')} aria-describedby="runpod-chave-ajuda" />
          </label>
          <p id="runpod-chave-ajuda" className="texto-suave">{t('Use uma chave de leitura para consultar saldo e tarifas. Ela fica no servidor e não é exibida novamente. Deixe vazio para manter a chave salva.', 'Use a read-only key to query balance and rates. It is stored on the server and is never displayed again. Leave blank to keep the saved key.')}</p>
          <div className="uso-cards">
            <label className="campo"><span>{t('Teto mensal do dono para GPU (R$)', 'Owner monthly GPU limit (BRL)')}</span><input type="number" min="0" max="1000000" step="0.01" required value={form.limite} onChange={e => mudar('limite', e.target.value)} /></label>
            <label className="campo"><span>{t('Câmbio de custo: US$ 1 em R$', 'Cost exchange rate: USD 1 in BRL')}</span><input type="number" min="0.0001" max="100" step="0.0001" required value={form.cambio} onChange={e => mudar('cambio', e.target.value)} /></label>
            <label className="campo"><span>{t('Limite por operação GPU (US$)', 'Per-operation GPU limit (USD)')}</span><input type="number" min="0" max="1000" step="0.01" required value={form.limiteJob} onChange={e => mudar('limiteJob', e.target.value)} /></label>
          </div>
          <p className="texto-suave">{t('O teto começa em zero e não adiciona crédito à conta Runpod.', 'The limit starts at zero and does not add credit to the Runpod account.')}</p>
          <fieldset style={{ border: '1px solid var(--borda)', borderRadius: 8, padding: 12, margin: '16px 0' }}>
            <legend>{t('Incluído no contrato', 'Included in the contract')}</legend>
            <p className="texto-suave">{t('Escolha os clientes atendidos pela infraestrutura GPU do Offiz. Nenhum contrato novo é selecionado automaticamente.', 'Choose which clients can use Offiz GPU infrastructure. New contracts are never selected automatically.')}</p>
            {erroContratos ? <p role="alert">{erroContratos} <button type="button" className="botao botao-fantasma" onClick={() => atualizarContratos(v => v + 1)}>{t('Recarregar contratos', 'Reload contracts')}</button></p>
              : !contratos ? <p>{t('Carregando contratos…', 'Loading contracts…')}</p>
                : !contratos.length ? <p>{t('Nenhum contrato gerenciado disponível.', 'No managed contracts available.')}</p>
                  : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {contratos.map(contrato => <label key={contrato.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="checkbox" style={{ width: 'auto' }} checked={form.contratos.includes(contrato.id)} disabled={!contratoElegivel(contrato) && !form.contratos.includes(contrato.id)} onChange={e => selecionarContrato(contrato.id, e.target.checked)} />
                      <span>{contrato.nome} · {contrato.modalidade !== 'pf_gerenciado' ? t('contrato não gerenciado; remova antes de habilitar', 'unmanaged plan; remove before enabling') : contrato.contrato_ativo ? t('contrato ativo', 'active contract') : t('contrato inativo', 'inactive contract')}</span>
                    </label>)}
                  </div>}
            {contratos && (config.allowed_org_ids ?? []).filter(id => !contratos.some(contrato => contrato.id === id)).map(id => <label key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.contratos.includes(id)} disabled={!form.contratos.includes(id)} onChange={() => selecionarContrato(id, false)} />
              <span>{t('Cliente', 'Client')} #{id} · {t('contrato indisponível; remova antes de habilitar', 'contract unavailable; remove before enabling')}</span>
            </label>)}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.habilitado} onChange={e => mudar('habilitado', e.target.checked)} />
              <span>{t('Habilitar GPU para os contratos selecionados', 'Enable GPU for selected contracts')}</span>
            </label>
            <p className="texto-suave">{t('A alteração só vale após salvar e passar pela validação do servidor. Desabilitar impede novos envios; não cancela uma operação em andamento.', 'Changes apply only after saving and server validation. Disabling blocks new submissions; it does not cancel an ongoing operation.')}</p>
          </fieldset>
          <details><summary>{t('Configuração avançada de execução (opcional)', 'Advanced execution settings (optional)')}</summary>
            <label className="campo"><span>{t('Tarifa máxima da GPU (US$ por segundo)', 'Maximum GPU rate (USD per second)')}</span><input type="number" min="0" max="0.001" step="0.000000001" required value={form.tarifa} onChange={e => mudar('tarifa', e.target.value)} /></label>
            <p className="texto-suave">{t('Use a tarifa consultada para o conjunto de GPUs do endpoint. Zero bloqueia a ativação; esse valor limita a reserva e não é uma fatura.', 'Use the queried rate for the endpoint GPU pool. Zero blocks activation; this value limits the reservation and is not an invoice.')}</p>
            <label className="campo"><span>{t('ID do endpoint Runpod', 'Runpod endpoint ID')}</span><input type="text" maxLength={80} value={form.endpoint} onChange={e => mudar('endpoint', e.target.value)} /></label>
            <label className="campo"><span>{t('Imagem do worker com digest SHA-256', 'Worker image with SHA-256 digest')}</span><input type="text" maxLength={300} value={form.imagem} onChange={e => mudar('imagem', e.target.value)} /></label>
            <p className="texto-suave">{t('Preencha somente quando houver um worker preparado. Esses campos não são necessários para consultar saldo e tarifas.', 'Fill in only when a worker has been prepared. These fields are not required to query balance and rates.')}</p>
            <label className="campo"><span>{t('Chave Runpod de execução (opcional)', 'Runpod execution key (optional)')} · {config.chave_runtime_configurada ? t('cadastrada', 'saved') : t('não cadastrada', 'not saved')}</span>
              <input type="password" autoComplete="new-password" spellCheck={false} maxLength={4096} value={chaveRuntime} onChange={e => { setChaveRuntime(e.target.value); setSucesso(''); setVerificacao(null); setCobranca(null); setErroCobranca('') }} placeholder={t('Cole para cadastrar ou substituir', 'Paste to add or replace')} aria-describedby="runpod-chave-runtime-ajuda" />
            </label>
            <p id="runpod-chave-runtime-ajuda" className="texto-suave">{t('No Runpod, crie uma chave Restricted com Read/Write somente no endpoint acima. Ela fica separada da chave de consulta e não é exibida novamente. Deixe vazio para manter a chave salva.', 'In Runpod, create a Restricted key with Read/Write only for the endpoint above. It is kept separate from the query key and is never displayed again. Leave blank to keep the saved key.')}</p>
            <p className="texto-suave">{t('Verificar conexão consulta apenas a conta; não testa a chave de execução nem inicia uma GPU.', 'Checking the connection only queries the account; it does not test the execution key or start a GPU.')}</p>
          </details>
          {alterado && <p className="texto-suave">{t('Salve as alterações antes de verificar a conexão.', 'Save changes before checking the connection.')}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <button type="submit" className="botao botao-primario">{ocupado === 'salvar' ? t('Salvando…', 'Saving…') : t('Salvar configuração Runpod', 'Save Runpod settings')}</button>
            <button type="button" className="botao botao-fantasma" disabled={!config.chave_configurada || alterado} onClick={verificar}>{ocupado === 'verificar' ? t('Verificando…', 'Checking…') : t('Verificar conexão Runpod', 'Check Runpod connection')}</button>
          </div>
        </fieldset>
      </form>
      <section aria-label={t('Orçamento do dono no Offiz', 'Owner budget in Offiz')}>
        <h3>{t('Orçamento do dono no Offiz', 'Owner budget in Offiz')}</h3>
        {carregandoOperacoes ? <p role="status">{t('Atualizando orçamento e operações…', 'Refreshing budget and operations…')}</p>
          : operacoes ? <>
            <p className="texto-suave">{t('Mês de referência', 'Reference month')}: {operacoes.periodo}</p>
            <div className="uso-cards">
              <div className="uso-card"><span className="uso-rotulo">{t('Limite mensal salvo', 'Saved monthly limit')}</span><strong className="uso-valor">{formatBRL(config.limite_brl_mes, idioma)}</strong></div>
              <div className="uso-card"><span className="uso-rotulo">{t('Consumo confirmado', 'Confirmed usage')}</span><strong className="uso-valor">{formatBRL(operacoes.consumido_brl, idioma)}</strong></div>
              <div className="uso-card"><span className="uso-rotulo">{t('Reservado ou em conferência', 'Reserved or under review')}</span><strong className="uso-valor">{formatBRL(operacoes.reservado_brl, idioma)}</strong></div>
              <div className="uso-card"><span className="uso-rotulo">{t('Disponível no orçamento', 'Available budget')}</span><strong className="uso-valor">{formatBRL(operacoes.disponivel_brl, idioma)}</strong></div>
            </div>
          </> : <p>{t('Orçamento indisponível. Atualize as operações GPU para tentar novamente.', 'Budget unavailable. Refresh GPU operations to retry.')}</p>}
      </section>
      <h3>{t('Conta no Runpod (US$)', 'Runpod account (USD)')}</h3>
      {verificacao?.conectado && verificacao.verificado_em ? <div aria-label={t('Última consulta Runpod', 'Latest Runpod query')}>
        <p role="status"><strong>{t('Conexão de consulta confirmada', 'Query connection confirmed')}</strong> · {formatDataHora(verificacao.verificado_em, idioma)}</p>
        <div className="uso-cards">
          <div className="uso-card"><span className="uso-rotulo">{t('Saldo no fornecedor', 'Provider balance')}</span><strong className="uso-valor">{usd(verificacao.saldo_usd)}</strong></div>
          <div className="uso-card"><span className="uso-rotulo">{t('Taxa de gasto atual da conta por hora', 'Current account spend rate per hour')}</span><strong className="uso-valor">{usd(verificacao.consumo_usd_hora, 4)}</strong></div>
        </div>
        <p>{t('Recarga automática', 'Automatic top-up')}: {verificacao.recarga_automatica === null ? t('não informada', 'not available') : verificacao.recarga_automatica ? t('ativada no Runpod', 'enabled in Runpod') : t('desativada no Runpod', 'disabled in Runpod')}.</p>
        <p className="texto-suave">{t('O saldo do fornecedor e o orçamento mensal do Offiz são controles separados. A consulta não transfere créditos nem comprova uma execução de vídeo.', 'Provider balance and the Offiz monthly budget are separate controls. This query does not transfer credit or prove that video execution works.')}</p>
        {!!verificacao.tarifas.length && <div className="tabela-scroll"><table className="tabela">
          <caption>{t('Tarifas Serverless consultadas', 'Queried Serverless rates')}</caption>
          <thead><tr><th>GPU</th><th>VRAM</th><th>{t('US$ por segundo', 'USD per second')}</th><th>{t('US$ por hora', 'USD per hour')}</th></tr></thead>
          <tbody>{verificacao.tarifas.map((tarifa, indice) => <tr key={`${tarifa.pool}-${tarifa.gpu}-${indice}`}>
            <th scope="row">{tarifa.gpu} <small className="texto-suave">({tarifa.pool})</small></th><td>{tarifa.vram_gb} GB</td><td>{usd(tarifa.usd_segundo, 6)}</td><td>{usd(tarifa.usd_hora, 4)}</td>
          </tr>)}</tbody>
        </table></div>}
        {!verificacao.tarifas.length && <p>{t('O fornecedor não informou tarifas nesta consulta.', 'The provider did not return rates for this query.')}</p>}
        <p className="texto-suave">{t('Fonte: API Runpod, consultada no horário acima.', 'Source: Runpod API, queried at the time shown above.')} <a href="https://docs.runpod.io/api-reference-v2/catalog/list-gpu-types" target="_blank" rel="noreferrer">{t('Referência do catálogo', 'Catalog reference')}</a></p>
        <p className="texto-suave">{t('Inicialização, execução e espera ociosa podem ser cobradas. A tarifa não é o custo confirmado de uma tarefa; a cobrança do fornecedor é agregada e pode chegar com atraso.', 'Initialization, execution, and idle time may be charged. A rate is not a task’s confirmed cost; provider billing is aggregated and may be delayed.')}</p>
        {verificacao.endpoint && <p>{!verificacao.endpoint.configuracao_segura
          ? t('O endpoint precisa de ajuste antes de executar.', 'The endpoint needs adjustment before execution.')
          : verificacao.endpoint.pausado === true
            ? t('Endpoint pausado: limite de workers em zero.', 'Endpoint paused: worker limit is zero.')
            : verificacao.endpoint.execucao_disponivel
              ? t('Endpoint preparado para até um worker sob demanda.', 'Endpoint configured for up to one on-demand worker.')
              : t('Configuração do endpoint conferida.', 'Endpoint configuration checked.')}</p>}
      </div> : <p className="texto-suave">{t('Verifique a conexão salva para consultar saldo, tarifas e horário da consulta.', 'Check the saved connection to view balance, rates, and query time.')}</p>}
      <section aria-label={t('Extrato agregado do fornecedor', 'Aggregated provider statement')}>
        <h3>{t('Cobrança do fornecedor no mês', 'Provider billing for the month')}</h3>
        <p className="texto-suave">{t('Consulta somente o extrato do endpoint salvo, sem iniciar GPU. O fornecedor pode registrar cobranças com atraso; o total agregado não identifica o custo de cada cliente ou tarefa. Esta consulta não libera reservas nem debita a carteira do cliente.', 'Only queries the saved endpoint statement without starting a GPU. Provider charges may be delayed; the aggregate total does not identify each client or task cost. This query does not release reservations or debit the client wallet.')}</p>
        <button type="button" className="botao botao-fantasma" disabled={ocupado !== null || !config.chave_configurada || !config.endpoint_id || alterado} onClick={consultarCobranca}>{ocupado === 'cobranca' ? t('Consultando cobrança…', 'Querying billing…') : t('Consultar cobrança do fornecedor', 'Query provider billing')}</button>
        {(!config.endpoint_id || alterado) && <p className="texto-suave">{t('Salve a conexão e o endpoint antes de consultar o extrato.', 'Save the connection and endpoint before querying the statement.')}</p>}
        {erroCobranca && <p role="alert">{erroCobranca}</p>}
        {cobranca && <>
          <p role="status">{t('Extrato consultado em', 'Statement queried at')} {formatDataHora(cobranca.consultado_em, idioma)} · {t('Mês', 'Month')}: {cobranca.periodo} · Endpoint: {cobranca.endpoint_id} · {t('Registros', 'Records')}: {cobranca.registros}</p>
          {cobranca.registros === 0 ? <p><strong>{t('Extrato ainda sem registros; não comprova custo zero.', 'The statement has no records yet; this does not prove zero cost.')}</strong></p> : <div className="uso-cards">
            <div className="uso-card"><span className="uso-rotulo">{t('Total agregado observado no endpoint', 'Observed endpoint aggregate total')}</span><strong className="uso-valor">{usd(cobranca.totais_usd.totalAmount, 6)}</strong></div>
            <div className="uso-card"><span className="uso-rotulo">{t('Conversão do total observado (R$)', 'Converted observed total (BRL)')}</span><strong className="uso-valor">{cobranca.total_brl_observado.toLocaleString(idioma, { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 })}</strong></div>
          </div>}
          <p className="texto-suave">{t('Câmbio usado', 'Exchange rate used')}: US$ 1 = {cobranca.cambio.toLocaleString(idioma, { style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 4 })}. {t('Consolidação não confirmada; os custos por tarefa e as reservas abaixo permanecem separados.', 'Consolidation is not confirmed; task costs and reservations below remain separate.')}</p>
        </>}
      </section>
      <h3>{t('Custo do Offiz por cliente', 'Offiz cost by client')}</h3>
      <p className="texto-suave">{t('Infraestrutura incluída na mensalidade. Reserva é estimativa; o custo só aparece confirmado após conferência. Nada é descontado da carteira do cliente.', 'Infrastructure included in the monthly fee. Reservations are estimates; costs are confirmed only after reconciliation. Nothing is deducted from the client wallet.')}</p>
      <button type="button" className="botao botao-fantasma" disabled={carregandoOperacoes} onClick={() => atualizarOperacoes(v => v + 1)}>{carregandoOperacoes ? t('Carregando operações…', 'Loading operations…') : t('Atualizar operações GPU', 'Refresh GPU operations')}</button>
      {erroOperacoes && <p role="alert">{erroOperacoes}</p>}
      {operacoes && !carregandoOperacoes && <>
        {!operacoes.itens.length ? <p>{t('Nenhuma operação GPU registrada nesta página.', 'No GPU operations recorded on this page.')}</p>
          : <div className="tabela-scroll"><table className="tabela">
            <caption>{t('Operações GPU — custo do Offiz', 'GPU operations — Offiz cost')}</caption>
            <thead><tr><th>{t('Cliente / tarefa', 'Client / task')}</th><th>{t('Criada em', 'Created')}</th><th>{t('Estado', 'State')}</th><th>{t('Reserva estimada', 'Estimated reservation')}</th><th>{t('Custo confirmado', 'Confirmed cost')}</th></tr></thead>
            <tbody>{operacoes.itens.map(op => <tr key={op.id}>
              <th scope="row">{op.org_id === null ? t('Infraestrutura', 'Infrastructure') : contratos?.find(contrato => contrato.id === op.org_id)?.nome ?? `${t('Cliente', 'Client')} #${op.org_id}`}{' '}<br /><small className="texto-suave">{op.job_id === null ? t('Sem tarefa vinculada', 'No linked task') : `${t('Tarefa', 'Task')} #${op.job_id}`}</small></th>
              <td>{formatDataHora(op.criado_em, idioma)}</td><td>{estadoOperacao(op)}</td><td>{formatBRL(op.reserva_brl, idioma)}</td>
              <td>{op.custo_brl === null ? t('Não conciliado', 'Not reconciled') : op.custo_brl.toLocaleString(idioma, { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 })}</td>
            </tr>)}</tbody>
          </table></div>}
        {(operacoes.total > 20 || paginaOperacoes > 0) && <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <button type="button" className="botao botao-fantasma" disabled={paginaOperacoes === 0} onClick={() => setPaginaOperacoes(p => Math.max(0, p - 1))}>{t('Anterior', 'Previous')}</button>
          <span>{t('Página', 'Page')} {paginaOperacoes + 1}</span>
          <button type="button" className="botao botao-fantasma" disabled={(paginaOperacoes + 1) * 20 >= operacoes.total} onClick={() => setPaginaOperacoes(p => p + 1)}>{t('Próxima', 'Next')}</button>
        </div>}
      </>}
    </>}
  </section>
}
