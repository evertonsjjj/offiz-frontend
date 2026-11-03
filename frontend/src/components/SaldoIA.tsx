import { useEffect, useRef, useState } from 'react'
import { useIdioma } from '../lib/i18n'
import { formatBRL, formatDataHora } from '../lib/format'
import { useSaldoIA } from '../lib/useSaldoIA'
import { getSessionIdentity } from '../lib/api'
import './saldo-ia.css'

export interface ModalidadeSaldoConfirmada { orgId: number; sessao: string | null; tipo: 'byok' | 'pf_gerenciado' }

export function SaldoIA({ orgId, motorLocal = false, compacto = false, verConsumo, aoConfirmarModalidade }: { orgId: number; motorLocal?: boolean; compacto?: boolean; verConsumo: () => void; aoConfirmarModalidade?: (modalidade: ModalidadeSaldoConfirmada) => void }) {
  const { t, idioma } = useIdioma()
  const { dados, erro, atualizando, atualizar } = useSaldoIA(orgId)
  const sessao = getSessionIdentity()
  const [aberto, setAberto] = useState(false)
  const detalheRef = useRef<HTMLDetailsElement>(null)
  const resumoRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (dados && !erro && !atualizando && sessao === getSessionIdentity()) aoConfirmarModalidade?.({ orgId, sessao, tipo: dados.tipo })
  }, [dados, erro, atualizando, orgId, sessao, aoConfirmarModalidade])
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => { if (e.target instanceof Node && !detalheRef.current?.contains(e.target)) setAberto(false) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAberto(false); resumoRef.current?.focus() } }
    document.addEventListener('pointerdown', fora)
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('pointerdown', fora); document.removeEventListener('keydown', tecla) }
  }, [aberto])
  useEffect(() => { setAberto(false) }, [orgId])

  const proprio = dados?.tipo === 'byok'
  const ultimaConsulta = !!dados && (atualizando || !!erro)
  const valor = dados ? proprio ? t('Conta própria', 'Own account') : formatBRL(dados.disponivel_brl, idioma) : erro ? t('Indisponível', 'Unavailable') : '—'
  const rotulo = dados && atualizando ? t('Atualizando saldo…', 'Updating balance…') : erro ? t('Consulta pendente', 'Update needed') : dados?.estado === 'baixo' ? t('Saldo baixo', 'Low balance') : dados?.estado === 'esgotado' ? t('Sem saldo disponível', 'No available balance') : dados?.estado === 'fora_vigencia' ? t('Fora da vigência', 'Outside contract term') : dados ? proprio ? t('Cobrança na sua conexão', 'Billed by your connection') : t('Disponível para usar', 'Available to use') : t('Consultando saldo…', 'Checking balance…')
  const abrirConsumo = () => { setAberto(false); verConsumo() }
  const avisoCompacto = erro ? t('Consultar', 'Check') : dados?.estado === 'baixo' ? t('Saldo baixo', 'Low balance') : dados?.estado === 'esgotado' ? t('Sem saldo', 'No balance') : dados?.estado === 'fora_vigencia' ? t('Fora da vigência', 'Outside term') : ''
  return <details ref={detalheRef} className={`saldo-ia${compacto ? ' saldo-ia--compacto' : ''}${erro || dados && atualizando ? ' saldo-ia--desatualizado' : ''}`} data-estado={dados?.estado || 'carregando'} open={aberto}>
    <summary ref={resumoRef} tabIndex={0} onClick={e => { e.preventDefault(); setAberto(v => !v) }} aria-expanded={aberto} aria-label={`${t('Saldo de IA', 'AI balance')}: ${valor}. ${rotulo}`} title={`${t('Saldo de IA', 'AI balance')}: ${valor}. ${rotulo}`}>
      <span className="saldo-ia__titulo">{compacto ? t('Saldo', 'Balance') : t('Saldo de IA', 'AI balance')}</span>
      <strong className="saldo-ia__valor">{valor}</strong>
      <span className="saldo-ia__estado"><i aria-hidden="true" /><span>{compacto ? avisoCompacto : rotulo}</span></span>
      <span className="saldo-ia__seta" aria-hidden="true">⌄</span>
    </summary>
    <section className="saldo-ia__painel" aria-label={t('Resumo do saldo de IA', 'AI balance summary')}>
      <header><h2>{!dados ? t('Saldo de IA', 'AI balance') : proprio ? t('Sua conta de IA', 'Your AI account') : t('IA incluída no contrato', 'AI included in your contract')}</h2><button type="button" className="botao-texto" onClick={atualizar} disabled={atualizando}>{atualizando ? t('Atualizando…', 'Updating…') : t('Atualizar saldo', 'Refresh balance')}</button></header>
      {erro && <p className="saldo-ia__aviso" role="alert">{erro === 'acesso' ? t('Não foi possível acessar o saldo desta empresa.', 'Could not access this organization’s balance.') : t('Não foi possível atualizar o saldo. Tente novamente.', 'Could not refresh the balance. Try again.')}{dados && <> {t('Os valores abaixo são da última consulta.', 'The amounts below are from the last check.')}</>}</p>}
      {dados && atualizando && <p role="status">{t('Atualizando saldo. Os valores são da última consulta.', 'Updating balance. The amounts are from the last check.')}</p>}
      {!dados && !erro && <p role="status">{t('Consultando o saldo da sua empresa…', 'Checking your organization’s balance…')}</p>}
      {dados && (proprio ? <p>{t('O consumo é cobrado pela conta conectada. O saldo do fornecedor não é consultado nesta tela.', 'Usage is billed by your connected account. The provider’s balance is not checked on this screen.')}</p> : <>
        {dados.estado === 'fora_vigencia' && <p className="saldo-ia__aviso">{t('O contrato está fora da vigência. Os valores são apenas para consulta; novos trabalhos dependem da renovação pelo responsável.', 'The contract is outside its term. These amounts are for reference; new work requires renewal by the administrator.')}</p>}
        <p className="saldo-ia__disponivel"><strong>{formatBRL(dados.disponivel_brl, idioma)}</strong><span>{ultimaConsulta ? t('saldo da última consulta', 'balance from the last check') : dados.estado === 'fora_vigencia' ? t('saldo registrado neste mês', 'balance recorded this month') : t('disponíveis neste mês', 'available this month')}</span></p>
        {dados.total_brl != null && dados.total_brl > 0 && <div className="saldo-ia__medidor" role="meter" aria-label={ultimaConsulta ? t('Saldo na última consulta', 'Balance at the last check') : t('Saldo disponível', 'Available balance')} aria-valuemin={0} aria-valuemax={dados.total_brl} aria-valuenow={dados.disponivel_brl ?? 0} aria-valuetext={`${formatBRL(dados.disponivel_brl, idioma)} ${t('de', 'of')} ${formatBRL(dados.total_brl, idioma)}`}><span style={{ width: `${Math.max(0, Math.min(100, dados.percentual_disponivel ?? 0))}%` }} /></div>}
        <dl className="saldo-ia__valores">
          <div><dt>{t('Liberado no mês', 'Monthly allowance')}</dt><dd>{formatBRL(dados.total_brl, idioma)}</dd></div>
          <div><dt>{t('Consumido', 'Used')}</dt><dd>{formatBRL(dados.consumido_brl, idioma)}</dd></div>
          <div><dt>{t('Reservado', 'Reserved')}</dt><dd>{formatBRL(dados.reservado_brl, idioma)}</dd></div>
        </dl>
        {dados.reservado_brl != null && dados.reservado_brl > 0 && <p>{t('Reservado é o valor de chamadas em processamento ou conferência. Ainda não é consumo confirmado.', 'Reserved amounts cover requests being processed or reviewed. They are not confirmed usage yet.')}</p>}
        {dados.estado === 'baixo' && <p className="saldo-ia__aviso">{t('O saldo está perto do limite. Confira o consumo antes de iniciar um trabalho maior.', 'Your balance is near its limit. Review usage before starting a larger project.')}</p>}
        {dados.estado === 'esgotado' && <p className="saldo-ia__aviso">{t('Novas chamadas pelo contrato dependem de saldo disponível. Confira as reservas e fale com o responsável pelo seu plano.', 'New contract requests need available balance. Check reservations and contact the person managing your plan.')}</p>}
        {motorLocal && <p>{t('Texto pelo motor local usa os limites da sua conta. Geração de imagens, vídeos e narração pode consumir este saldo.', 'Local text uses your account’s limits. Image, video and voice generation may use this balance.')}</p>}
        {dados.renovacao_em && <p className="saldo-ia__renovacao">{t('Próxima renovação:', 'Next renewal:')} <strong>{formatDataHora(dados.renovacao_em, idioma)}</strong><br />{t('Horário local. O saldo mensal não acumula.', 'Local time. Monthly allowance does not roll over.')}</p>}
      </>)}
      <footer>{dados && <small>{t('Consultado em', 'Checked at')} {formatDataHora(dados.consultado_em, idioma)}</small>}<button type="button" className="botao-texto" onClick={abrirConsumo}>{t('Ver plano e consumo', 'View plan and usage')}</button></footer>
    </section>
  </details>
}
