import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useIdioma } from '../../lib/i18n'

type Guia = { niveis: Array<{ nome: string; descricao: string }>; tipos: Record<string, { nome: string; minimo: string[]; premium: string[] }> }
export function GuiaPrimeiraPeca({ orgId, inicialmenteAberto = false }: { orgId: number; inicialmenteAberto?: boolean }) {
  const { t } = useIdioma()
  const [aberto, setAberto] = useState(inicialmenteAberto)
  const [guia, setGuia] = useState<Guia | null>(null)
  const [erro, setErro] = useState(false)
  const [tipo, setTipo] = useState('teste')
  useEffect(() => {
    if (!aberto) return
    let ativo = true
    api.get<Guia>(`/predios/${orgId}/conteudo/estudio/prontidao`).then(g => { if (ativo) { setGuia(g); setErro(false) } }).catch(() => { if (ativo) setErro(true) })
    return () => { ativo = false }
  }, [orgId, aberto])
  const item = guia?.tipos[tipo]
  return <details className="origem-entrega" open={aberto} onToggle={e => setAberto(e.currentTarget.open)}>
    <summary>{t('O que preciso para a primeira peça?', 'What do I need for the first deliverable?')}</summary>
    {erro ? <p role="alert">{t('Não foi possível abrir o guia. Feche e abra para tentar novamente.', 'Unable to open the guide. Close and reopen to try again.')}</p> : !guia ? <p role="status">{t('Carregando…', 'Loading…')}</p> : <>
      <label>{t('Tipo de peça', 'Deliverable type')} <select value={tipo} onChange={e => setTipo(e.target.value)}>{Object.entries(guia.tipos).map(([id, g]) => <option key={id} value={id}>{g.nome}</option>)}</select></label>
      <p>{t('O que já foi confirmado no perfil ou na conversa pode ser reaproveitado. Este guia não atesta que seus materiais foram conferidos.', 'Confirmed profile or chat information can be reused. This guide does not certify that your materials have been reviewed.')}</p>
      <h4>{t('Mínimo para começar', 'Minimum to start')}</h4><ul>{item?.minimo.map(x => <li key={x}>{x}</li>)}</ul>
      <h4>{t('Para uma entrega de qualidade', 'For a quality deliverable')}</h4><ul>{item?.premium.map(x => <li key={x}>{x}</li>)}</ul>
      {guia.niveis.map(n => <p key={n.nome}><strong>{n.nome}:</strong> {n.descricao}</p>)}
    </>}
  </details>
}
