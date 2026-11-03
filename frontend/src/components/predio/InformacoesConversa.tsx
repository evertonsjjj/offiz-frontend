import { useState } from 'react'
import { useIdioma } from '../../lib/i18n'
import { ConsumoIA } from '../ConsumoIA'
import DialogoArquivo from './DialogoArquivo'
import { GuiaPrimeiraPeca } from './GuiaPrimeiraPeca'

/** Auxiliary reports open above the conversation without shrinking its scroll area. */
export function InformacoesConversa({ orgId, conversaId, mostrarGuia, atualizacao }: {
  orgId: number; conversaId: number | null; mostrarGuia: boolean; atualizacao: number
}) {
  const { t } = useIdioma()
  const [aberto, setAberto] = useState<'custo' | 'guia' | null>(null)
  if (conversaId == null && !mostrarGuia) return null
  const titulo = aberto === 'custo'
    ? t('Custo deste chat e seus trabalhos', 'Cost of this chat and its work')
    : t('O que preciso para a primeira peça?', 'What do I need for the first deliverable?')
  return <div className="conversa-informacoes">
    {conversaId != null && <button type="button" className="botao-texto" aria-haspopup="dialog" onClick={() => setAberto('custo')}>
      {t('Custo do chat', 'Chat cost')}
    </button>}
    {mostrarGuia && <button type="button" className="botao-texto" aria-haspopup="dialog" onClick={() => setAberto('guia')}>
      {t('Guia da peça', 'Deliverable guide')}
    </button>}
    {aberto && <DialogoArquivo nome={titulo} className="cff-visor" aoFechar={() => setAberto(null)}>
      <div className="cff-visor-caixa conversa-informacoes-caixa" onClick={e => e.stopPropagation()}>
        <header><strong>{titulo}</strong><button type="button" className="botao-texto" autoFocus onClick={() => setAberto(null)}>{t('Fechar', 'Close')}</button></header>
        {aberto === 'custo' && conversaId != null
          ? <ConsumoIA endpoint={`/conversas/${conversaId}/uso`} atualizacao={atualizacao} inicialmenteAberto />
          : <GuiaPrimeiraPeca orgId={orgId} inicialmenteAberto />}
      </div>
    </DialogoArquivo>}
  </div>
}
