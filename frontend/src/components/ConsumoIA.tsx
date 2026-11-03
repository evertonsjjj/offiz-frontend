import { useEffect, useState } from 'react'
import { api, getSessionIdentity } from '../lib/api'
import { useIdioma } from '../lib/i18n'
import './consumo-ia.css'

type Totais = { tokens: number; estimado_api_brl: number; consumido_gerenciado_brl: number; equivalente_assinatura_brl: number; estimativa_legada_brl: number; reservado_brl: number; sem_medicao: number; sem_medicao_api?: number; sem_medicao_assinatura?: number; sem_medicao_gerenciado?: number }
type Historico = { totais: Totais; meses: Array<Totais & { periodo: string }>; conexoes: Array<Totais & { periodo: string; provedor: string; modalidade: string; operacao: string; registros: number }>; cobertura: string[] }

function receberHistorico(valor: unknown): Historico {
  const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  const numero = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  const totais = (v: unknown) => objeto(v)
    && ['tokens', 'estimado_api_brl', 'consumido_gerenciado_brl', 'equivalente_assinatura_brl', 'estimativa_legada_brl', 'reservado_brl', 'sem_medicao'].every(k => numero(v[k]))
    && ['sem_medicao_api', 'sem_medicao_assinatura', 'sem_medicao_gerenciado'].every(k => v[k] === undefined || numero(v[k]))
  if (!objeto(valor) || !totais(valor.totais)
    || !Array.isArray(valor.meses) || !valor.meses.every(v => objeto(v) && typeof v.periodo === 'string' && totais(v))
    || !Array.isArray(valor.conexoes) || !valor.conexoes.every(v => objeto(v) && totais(v) && numero(v.registros)
      && ['periodo', 'provedor', 'modalidade', 'operacao'].every(k => typeof v[k] === 'string'))
    || !Array.isArray(valor.cobertura) || !valor.cobertura.every(v => typeof v === 'string')) {
    throw new Error('Resposta de consumo incompatível')
  }
  return valor as Historico
}

export function ConsumoIA({ endpoint, mensal = false, atualizacao = 0, inicialmenteAberto = false }: { endpoint: string; mensal?: boolean; atualizacao?: number; inicialmenteAberto?: boolean }) {
  const { t, idioma } = useIdioma()
  const [sessao, setSessao] = useState(getSessionIdentity)
  const [consulta, setConsulta] = useState<{ chave: string; dados?: Historico; erro?: boolean } | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const chave = `${sessao}:${endpoint}`
  useEffect(() => {
    const atualizar = () => setSessao(getSessionIdentity())
    window.addEventListener('offiz:token-changed', atualizar)
    window.addEventListener('storage', atualizar)
    return () => { window.removeEventListener('offiz:token-changed', atualizar); window.removeEventListener('storage', atualizar) }
  }, [])
  useEffect(() => {
    let ativo = true
    api.get<unknown>(endpoint).then(receberHistorico).then(dados => { if (ativo) setConsulta({ chave, dados }) })
      .catch(() => { if (ativo) setConsulta({ chave, erro: true }) })
    return () => { ativo = false }
  }, [endpoint, chave, atualizacao, tentativa])
  const atual = consulta?.chave === chave ? consulta : null
  const dados = atual?.dados
  const brl = (v: number) => new Intl.NumberFormat(idioma === 'en' ? 'en-US' : 'pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 }).format(v)
  const valor = (v: number, incompleto: number) => v === 0 ? (incompleto ? t('Não informado', 'Not reported') : '—') : brl(v) + (incompleto ? '*' : '')
  function tabela(linhas: Array<Totais & { periodo: string }>) {
    return <div className="consumo-ia-tabela"><table><thead><tr><th>{t('Período', 'Period')}</th><th>{t('API estimada', 'Estimated API')}</th><th>{t('Gerenciado', 'Managed')}</th><th>{t('Equivalente assinatura', 'Subscription equivalent')}</th><th>{t('Estimativa legada', 'Legacy estimate')}</th><th>{t('Sem medição completa', 'Incomplete metering')}</th></tr></thead><tbody>{linhas.map((m, i) => <tr key={i}><td>{m.periodo}</td><td>{valor(m.estimado_api_brl, m.sem_medicao_api ?? m.sem_medicao)}</td><td>{valor(m.consumido_gerenciado_brl, m.sem_medicao_gerenciado ?? m.sem_medicao)}</td><td>{valor(m.equivalente_assinatura_brl, m.sem_medicao_assinatura ?? m.sem_medicao)}</td><td>{m.estimativa_legada_brl ? brl(m.estimativa_legada_brl) : '—'}</td><td>{m.sem_medicao}</td></tr>)}</tbody></table></div>
  }
  return <details className="consumo-ia" open={mensal || inicialmenteAberto || undefined}>
    <summary>{mensal ? t('Histórico mensal de custo de IA', 'Monthly AI cost history') : t('Custo deste chat e seus trabalhos', 'Cost of this chat and its work')}
      {!mensal && dados && <small> · {t('API estimada', 'Estimated API')}: {dados.totais.estimado_api_brl ? brl(dados.totais.estimado_api_brl) : '—'} · {t('Gerenciado', 'Managed')}: {dados.totais.consumido_gerenciado_brl ? brl(dados.totais.consumido_gerenciado_brl) : '—'}</small>}
    </summary>
    {!atual && <p role="status">{t('Consultando consumo…', 'Loading usage…')}</p>}
    {atual?.erro && <p role="alert">{t('Não foi possível consultar o custo.', 'Unable to load cost.')} <button onClick={() => setTentativa(n => n + 1)}>{t('Tentar novamente', 'Try again')}</button></p>}
    {dados && <>
      <p>{t('Valores em reais. Estimativas, consumo gerenciado e assinatura têm bases diferentes e não formam uma fatura única.', 'Amounts in BRL. Estimates, managed consumption and subscriptions have different bases and do not form a single invoice.')}</p>
      {tabela(mensal ? dados.meses : [{ ...dados.totais, periodo: t('Todo o chat', 'Entire chat') }])}
      <p>{dados.totais.tokens.toLocaleString()} {t('tokens registrados', 'recorded tokens')} · {t('Reserva pendente', 'Pending reservation')}: {brl(dados.totais.reservado_brl)}</p>
      <p>{t('Assinatura: o equivalente de API não é cobrança. Mensalidade não informada pelo motor.', 'Subscription: API equivalent is not a charge. Subscription fee not provided by the engine.')}</p>
      {!!dados.totais.sem_medicao && <p role="status">{t('O total é parcial: existem registros sem medição completa.', 'Totals are partial: some records lack complete metering.')}</p>}
      {!!dados.totais.estimativa_legada_brl && <p>{t('Histórico sem identificação de conexão:', 'History without connection identity:')} {brl(dados.totais.estimativa_legada_brl)}</p>}
      <details><summary>{t('Ver conexões e cobertura', 'View connections and coverage')}</summary>
        {!dados.conexoes.length && <p>{t('Nenhum consumo vinculado foi registrado. Isso não comprova custo zero.', 'No linked consumption was recorded. This does not establish zero cost.')}</p>}
        {tabela(dados.conexoes.map(c => ({ ...c, periodo: `${c.periodo} · ${c.provedor} · ${c.modalidade} · ${c.operacao}` })))}
        <ul>{dados.cobertura.map(c => <li key={c}>{c}</li>)}</ul>
        <p>{t('Meses de calendário em UTC.', 'Calendar months in UTC.')}</p>
      </details>
      <button type="button" onClick={() => setTentativa(n => n + 1)}>{t('Atualizar consumo', 'Refresh usage')}</button>
    </>}
  </details>
}
