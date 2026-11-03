import type { Entrega } from './types'
import type { PecaEditorial } from '../components/predio/ConteudoEditorial'

/** Editorial pieces and ordinary jobs are distinct review units. Revisions
 * and multiple files must never multiply the number of completed pieces. */
export function resumoEntregas(entregas: Entrega[], pecas: PecaEditorial[], agora: Date) {
  const mes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`
  const noMes = (date?: string | null) => !!date?.startsWith(mes)
  const comuns = entregas.filter(e => !e.editorial_peca_id && e.tipo !== 'interno' && e.tipo !== 'devolutiva')
  const contar = (items: Entrega[]) => new Set(items.map(e => e.job_id)).size
  const doMes = comuns.filter(e => noMes(e.criado_em))
  const editoriaisEntregues = pecas.filter(p => p.revisoes.some(r => noMes(r.criado_em)))
  const editoriaisAprovadas = pecas.filter(p => p.revisoes.some(r => r.id === p.revisao_aprovada_id && noMes(r.criado_em)))
  return {
    entreguesNoMes: contar(doMes) + editoriaisEntregues.length,
    aprovadasNoMes: contar(doMes.filter(e => e.status === 'aprovada')) + editoriaisAprovadas.length,
    aguardando: contar(comuns.filter(e => e.status === 'pendente')) + pecas.filter(p => p.estado === 'em_revisao' || p.nova_revisao).length,
    recusadasNoMes: contar(doMes.filter(e => e.status === 'rejeitada')),
  }
}
