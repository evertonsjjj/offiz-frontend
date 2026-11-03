import { sequenciaCarrossel } from '../../lib/carrosselEntrega'
import { useIdioma } from '../../lib/i18n'
import type { Entrega } from '../../lib/types'

export default function SequenciaCarrossel({ arquivos, selecionadaId, escolher }: {
  arquivos: Entrega[]; selecionadaId: number; escolher: (id: number) => void
}) {
  const { t } = useIdioma()
  const cards = sequenciaCarrossel(arquivos)
  const indice = cards.findIndex(card => card.id === selecionadaId)
  if (indice < 0) return null
  return <nav className="resultado-entrega__sequencia" aria-label={t('Sequência do carrossel', 'Carousel sequence')}>
    <button type="button" className="botao botao-fantasma botao-pequeno" disabled={indice === 0} onClick={() => escolher(cards[indice - 1].id)} aria-label={t('Imagem anterior', 'Previous image')}>‹</button>
    <span aria-live="polite">{t(`Imagem ${indice + 1} de ${cards.length}`, `Image ${indice + 1} of ${cards.length}`)}</span>
    <button type="button" className="botao botao-fantasma botao-pequeno" disabled={indice === cards.length - 1} onClick={() => escolher(cards[indice + 1].id)} aria-label={t('Próxima imagem', 'Next image')}>›</button>
  </nav>
}
