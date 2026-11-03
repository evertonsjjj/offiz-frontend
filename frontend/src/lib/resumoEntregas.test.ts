import { expect, it } from 'vitest'
import { resumoEntregas } from './resumoEntregas'
import type { Entrega } from './types'
import type { PecaEditorial } from '../components/predio/ConteudoEditorial'

it('counts editorial pieces and ordinary jobs once, across revisions and files', () => {
  const entrega = (job: number, editorial?: number) => ({ job_id: job, editorial_peca_id: editorial, criado_em: '2026-09-10', status: 'aprovada', tipo: 'arquivo' }) as Entrega
  const peca = (id: number, date: string, pending = false) => ({ id, revisao_aprovada_id: id * 10, estado: 'aprovado', nova_revisao: pending, revisoes: [{ id: id * 10, criado_em: date }, { id: id * 10 + 1, criado_em: date }] }) as PecaEditorial
  const result = resumoEntregas([entrega(1), entrega(1), entrega(2, 12)], [peca(12, '2026-09-10', true), peca(13, '2026-08-01')], new Date(2026, 8, 10))
  expect(result).toEqual({ entreguesNoMes: 2, aprovadasNoMes: 2, aguardando: 1, recusadasNoMes: 0 })
})
