import { useEffect, useState } from 'react'
import { useIdioma } from '../../lib/i18n'
import { getSessionIdentity } from '../../lib/api'
import { formatDataHora } from '../../lib/format'
import { wsClient } from '../../lib/ws'
import { useBiblioteca } from './useBiblioteca'
import './biblioteca-projetos.css'

export function ResumoTrabalho({ orgId, areaSlug, abrir }: { orgId: number; areaSlug?: string; abrir: (estado: string) => void }) {
  const [conta, setConta] = useState(getSessionIdentity)
  useEffect(() => {
    const mudou = () => setConta(getSessionIdentity())
    window.addEventListener('offiz:token-changed', mudou)
    window.addEventListener('storage', mudou)
    return () => { window.removeEventListener('offiz:token-changed', mudou); window.removeEventListener('storage', mudou) }
  }, [])
  return <ResumoDaConta key={`${conta}:${orgId}:${areaSlug ?? ''}`} orgId={orgId} areaSlug={areaSlug} abrir={abrir} />
}

function ResumoDaConta({ orgId, areaSlug, abrir }: { orgId: number; areaSlug?: string; abrir: (estado: string) => void }) {
  const { t, idioma } = useIdioma()
  const [revisao, setRevisao] = useState(0)
  useEffect(() => {
    const atualizar = () => setRevisao(r => r + 1)
    window.addEventListener('offiz:biblioteca-mudou', atualizar)
    window.addEventListener('offiz:entregas-mudou', atualizar)
    const off = wsClient.on('job_status', e => { if ('org_id' in e && e.org_id === orgId) atualizar() })
    return () => { off(); window.removeEventListener('offiz:biblioteca-mudou', atualizar); window.removeEventListener('offiz:entregas-mudou', atualizar) }
  }, [orgId])
  const { dados, erro, consultadoEm } = useBiblioteca<{ resumo: Record<string, number> }>(`/orgs/${orgId}/biblioteca?limite=1${areaSlug ? `&office_slug=${encodeURIComponent(areaSlug)}` : ''}`, revisao)
  const carregando = !dados && !erro
  // A consulta não pode inserir um bloco acima do campo em que a pessoa já
  // está trabalhando. Os placeholders usam a mesma geometria dos contadores.
  return <section className="resumo-trabalho" aria-label={t('Seu trabalho hoje', 'Your work today')} aria-busy={carregando}>
    <div className="biblioteca-resumo">
      {dados?.resumo ? <>
        <button onClick={() => abrir('pronto')}><strong>{dados.resumo.prontos}</strong>{t('Pronto para você', 'Ready for you')}</button>
        <button onClick={() => abrir('precisa_de_voce')}><strong>{dados.resumo.precisa_de_voce}</strong>{t('Precisa de você', 'Needs your input')}</button>
        <button onClick={() => abrir('em_producao')}><strong>{dados.resumo.em_producao}</strong>{t('O Offiz está cuidando', 'Offiz is working on it')}</button>
      </> : [t('Pronto para você', 'Ready for you'), t('Precisa de você', 'Needs your input'), t('O Offiz está cuidando', 'Offiz is working on it')].map(rotulo => <div key={rotulo} className="resumo-trabalho__pendente" aria-hidden="true">
        <span className="resumo-trabalho__numero-pendente" />{rotulo}
      </div>)}
    </div>
    <div className="resumo-trabalho__retorno">
      {erro ? <div role="alert" className="resumo-trabalho__aviso">
        <div>
          <p>{dados ? t('Não foi possível atualizar. Números da última consulta.', 'Could not refresh. Numbers are from the last check.') : t('Não foi possível consultar seus trabalhos.', 'Could not check your work.')}</p>
          {consultadoEm && <p className="texto-suave">{t('Última consulta:', 'Last checked:')} <time dateTime={consultadoEm}>{formatDataHora(consultadoEm, idioma)}</time></p>}
        </div>
        <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => setRevisao(r => r + 1)}>{t('Tentar novamente', 'Try again')}</button>
      </div> : carregando && <span role="status" className="texto-suave">{t('Consultando seus trabalhos…', 'Checking your work…')}</span>}
    </div>
  </section>
}
