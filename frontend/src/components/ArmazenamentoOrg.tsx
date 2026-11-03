import { useEffect, useState } from 'react'
import { api, getSessionIdentity } from '../lib/api'
import { useIdioma } from '../lib/i18n'

interface Armazenamento {
  limite_bytes: number
  unidade_bytes: number
  bytes_centrais_reais: number | null
  bytes_alocados_centrais: number | null
  medicao_completa: boolean
  excedido: boolean | null
  disponivel_bytes: number | null
  pode_incrementar: boolean
  destino: 'compartilhado' | 'externo_pendente'
  residencia_integral_verificada: boolean
  requisitos: { postgres_configurado_testado: boolean; s3_configurado_testado: boolean; infraestrutura_externa_verificada: boolean }
  pendencias_residencia: string[]
}
function validar(value: unknown): Armazenamento {
  if (!value || typeof value !== 'object') throw new Error('Resposta inválida')
  const d = value as Armazenamento
  const bytes = (n: unknown) => n === null || typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
  if (!Number.isSafeInteger(d.limite_bytes) || d.limite_bytes <= 0 || d.unidade_bytes !== 1e9
    || !bytes(d.bytes_centrais_reais) || !bytes(d.bytes_alocados_centrais) || !bytes(d.disponivel_bytes)
    || typeof d.medicao_completa !== 'boolean' || typeof d.pode_incrementar !== 'boolean'
    || ![true, false, null].includes(d.excedido) || !['compartilhado', 'externo_pendente'].includes(d.destino)
    || typeof d.residencia_integral_verificada !== 'boolean' || !d.requisitos
    || typeof d.requisitos.postgres_configurado_testado !== 'boolean' || typeof d.requisitos.s3_configurado_testado !== 'boolean'
    || typeof d.requisitos.infraestrutura_externa_verificada !== 'boolean'
    || !Array.isArray(d.pendencias_residencia) || !d.pendencias_residencia.every(p => typeof p === 'string')) throw new Error('Resposta inválida')
  return d
}

export function ArmazenamentoOrg({ orgId }: { orgId: number }) {
  return <ArmazenamentoDaSessao key={`${getSessionIdentity()}:${orgId}`} orgId={orgId} />
}
function ArmazenamentoDaSessao({ orgId }: { orgId: number }) {
  const { t, idioma } = useIdioma()
  const sessao = getSessionIdentity()
  const [dados, setDados] = useState<Armazenamento | null>(null)
  const [erro, setErro] = useState(false)
  const [versao, setVersao] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setErro(false); setDados(null)
    api.get<unknown>(`/orgs/${orgId}/armazenamento`, controller.signal).then(value => {
      if (!controller.signal.aborted && getSessionIdentity() === sessao) setDados(validar(value))
    }).catch(() => { if (!controller.signal.aborted && getSessionIdentity() === sessao) setErro(true) })
    return () => controller.abort()
  }, [orgId, sessao, versao])
  const gb = (bytes: number) => `${new Intl.NumberFormat(idioma === 'en' ? 'en-US' : 'pt-BR', { maximumFractionDigits: 3 }).format(bytes / 1e9)} GB`
  return <section className="cartao" aria-label={t('Armazenamento da empresa', 'Company storage')}>
    <h2 className="secao-titulo">{t('Armazenamento da empresa', 'Company storage')}</h2>
    {erro ? <p role="alert">{t('Não foi possível medir o armazenamento. O uso não foi considerado zero.', 'Could not measure storage. Usage was not counted as zero.')} <button type="button" className="botao-texto" onClick={() => setVersao(v => v + 1)}>{t('Medir novamente', 'Measure again')}</button></p> : !dados ? <p role="status">{t('Consultando o armazenamento…', 'Checking storage…')}</p> : <>
      <p><strong>{t('Limite no serviço:', 'Service limit:')}</strong> {gb(dados.limite_bytes)} {t('(GB decimal)', '(decimal GB)')}</p>
      <p><strong>{t('Uso contabilizado:', 'Counted usage:')}</strong> {dados.medicao_completa && dados.bytes_centrais_reais !== null ? gb(dados.bytes_centrais_reais) : t('Medição incompleta', 'Incomplete measurement')}</p>
      {dados.medicao_completa && dados.disponivel_bytes !== null && <p>{t('Disponível:', 'Available:')} {gb(dados.disponivel_bytes)}</p>}
      {dados.medicao_completa && dados.bytes_alocados_centrais !== null && <p className="texto-suave">{t('Espaço ocupado em disco:', 'Allocated disk space:')} {gb(dados.bytes_alocados_centrais)}</p>}
      {!dados.pode_incrementar && <p role="status">{dados.excedido || dados.disponivel_bytes === 0 ? t('O limite foi atingido. Libere espaço ou configure e valide o armazenamento externo antes de adicionar arquivos.', 'The limit was reached. Free space or configure and validate external storage before adding files.') : t('Novos arquivos aguardam uma medição completa do espaço disponível.', 'New files require a complete measurement of available space.')}</p>}
      <p><strong>{t('Destino atual:', 'Current destination:')}</strong> {dados.destino === 'externo_pendente' ? t('Configuração externa pendente', 'External setup pending') : t('Serviço Offiz compartilhado', 'Shared Offiz service')}</p>
      <p className="texto-suave">{t('Banco do cliente:', 'Customer database:')} {dados.requisitos.postgres_configurado_testado ? t('configurado e testado', 'configured and tested') : t('pendente', 'pending')}. {t('Arquivos em S3 próprio:', 'Files in customer S3:')} {dados.requisitos.s3_configurado_testado ? t('configurado e testado', 'configured and tested') : t('pendente', 'pending')}.</p>
      {!dados.residencia_integral_verificada && <p>{t('A residência integral fora do Offiz ainda não foi verificada. Configurar banco e arquivos externos, ou escolher uma pasta no computador, não confirma essa migração.', 'Complete storage outside Offiz has not been verified. Configuring external database and files, or selecting a computer folder, does not confirm that migration.')}</p>}
      {dados.pendencias_residencia.length > 0 && <details><summary>{t('O que falta verificar', 'What still needs verification')}</summary><ul>{dados.pendencias_residencia.map((p, i) => <li key={i}>{p}</li>)}</ul></details>}
      <button type="button" className="botao-texto" onClick={() => setVersao(v => v + 1)}>{t('Atualizar medição', 'Refresh measurement')}</button>
    </>}
  </section>
}
