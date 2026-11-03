import { useState } from 'react'
import { useIdioma } from '../../lib/i18n'
import QuadroFluxo from './QuadroFluxo'
import './origem-entrega.css'
import { GuiaPrimeiraPeca } from './GuiaPrimeiraPeca'

/** The same authenticated history in the preview and in the delivery library. */
export function OrigemEntrega({ orgId, slug, jobId }: { orgId: number; slug: string; jobId: number }) {
  const { t } = useIdioma()
  const [aberto, setAberto] = useState(false)
  return <details className="origem-entrega" onToggle={e => setAberto(e.currentTarget.open)}>
    <summary>{t('Como foi feito · referências e arquivos', 'How it was made · references and files')}</summary>
    <p>{t('Confira as fontes registradas, os arquivos consultados, as etapas e as pendências desta entrega. Um perfil do Instagram não identifica um post específico. Quando a origem não foi registrada, não é possível confirmá-la retroativamente.', 'Review recorded sources, consulted files, steps and outstanding issues. An Instagram profile does not identify a specific post. Unrecorded provenance cannot be confirmed retroactively.')}</p>
    {aberto && <QuadroFluxo orgId={orgId} slug={slug} jobId={jobId} />}
    {aberto && slug === 'conteudo' && <GuiaPrimeiraPeca key={orgId} orgId={orgId} />}
  </details>
}
