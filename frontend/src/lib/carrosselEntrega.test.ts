import { expect, it } from 'vitest'
import { ordenarArquivosCarrossel, primeiraImagemCarrossel, sequenciaCarrossel } from './carrosselEntrega'

const card = (numero: number, post?: number) => ({ id: numero + (post || 0) * 100, nome: `card-${String(numero).padStart(2, '0')}.png`, editorial_peca_id: post })
it('percorre o contrato de cards na ordem declarada, independente da ordem de entrega', () => {
  const arquivos = [card(3), { id: 99, nome: 'post.html' }, card(1), card(2)]
  expect(sequenciaCarrossel(arquivos).map(a => a.id)).toEqual([1, 2, 3])
  expect(primeiraImagemCarrossel(arquivos, arquivos[1])?.id).toBe(1)
})
it('ordena os botões dos cards sem mover os demais arquivos ou alterar a entrada', () => {
  const arquivos = [card(3), { id: 99, nome: 'post.html' }, card(1), { id: 98, nome: 'legenda.docx' }, card(2)]
  expect(ordenarArquivosCarrossel(arquivos).map(a => a.id)).toEqual([1, 99, 2, 98, 3])
  expect(arquivos.map(a => a.id)).toEqual([3, 99, 1, 98, 2])
})
it.each([
  [card(1)], [card(1), card(3)], [card(1), card(1), card(2)],
  [card(1, 1), card(2, 2)], [{ id: 1, nome: 'foto-01.png' }, { id: 2, nome: 'foto-02.png' }],
].map(arquivos => ({ arquivos })))('não inventa uma sequência para arquivos ambíguos ou incompletos: $arquivos', ({ arquivos }) => {
  expect(sequenciaCarrossel(arquivos)).toEqual([])
  expect(ordenarArquivosCarrossel(arquivos)).toBe(arquivos)
})
it('o card inicial pertence ao mesmo post da referência, sem misturar dois carrosseis', () => {
  const referencia = { id: 90, nome: 'post.html', editorial_peca_id: 2 }
  expect(primeiraImagemCarrossel([card(1, 1), card(2, 1), card(2, 2), referencia, card(1, 2)], referencia)?.id).toBe(201)
})
