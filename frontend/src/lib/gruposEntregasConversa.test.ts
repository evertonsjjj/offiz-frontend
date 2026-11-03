import { expect, it } from 'vitest'
import { enderecoConversaEntrega, gruposEntregasConversa, mesclarPedidosCarregados, type VinculoConversaEntrega } from './gruposEntregasConversa'

it('reúne o vínculo real mesmo com trabalhos intercalados e não reúne títulos iguais de conversas distintas', () => {
  const itens = [{ id: 301, conversa_id: 7, conversa_titulo: 'Patrocinador' }, { id: 7, conversa_id: 8, conversa_titulo: 'Patrocinador' }, { id: 400, conversa_id: 7, conversa_titulo: 'Patrocinador' }]
  const resultado = gruposEntregasConversa(itens)
  expect(resultado.map(g => [g.conversaId, g.pedidos.map(p => p.id)])).toEqual([[7, [301, 400]], [8, [7]]])
  expect(itens.map(i => i.id)).toEqual([301, 7, 400])
})

it.each([undefined, null, 0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '17', {}, true])('vínculo inválido %j conserva pedido no grupo sem conversa sem aproveitar título privado', valor => {
  const item = { id: 17, conversa_id: valor, conversa_titulo: 'Não pode atribuir por título', conversa_office_slug: 'financeiro' } as unknown as VinculoConversaEntrega
  expect(gruposEntregasConversa([item])).toEqual([{ chave: 'sem-conversa', conversaId: null, titulo: null, officeSlug: null, pedidos: [item] }])
})

it('reconhece título vazio e conserva o primeiro título textual do próprio ID', () => {
  const resultado = gruposEntregasConversa([{ conversa_id: 4, conversa_titulo: '  ' }, { conversa_id: 4, conversa_titulo: ' Campanha de outubro ' }, { conversa_id: 4, conversa_titulo: 'Outro título' }])
  expect(resultado[0].titulo).toBe('Campanha de outubro')
})

it('páginas extras não duplicam o mesmo pedido e o retrato novo vence sem alterar entradas', () => {
  const inicio = [{ id: 1, nome: 'Primeiro' }, { id: 2, nome: 'Antigo' }], novos = [{ id: 2, nome: 'Confirmado' }, { id: 3, nome: 'Terceiro' }]
  expect(mesclarPedidosCarregados(inicio, novos)).toEqual([{ id: 1, nome: 'Primeiro' }, { id: 2, nome: 'Confirmado' }, { id: 3, nome: 'Terceiro' }])
  expect(inicio[1].nome).toBe('Antigo')
})

it('o link da conversa fixa empresa, ID e área próprios sem arquivo, pedido ou filtro herdado', () => {
  expect(enderecoConversaEntrega(33, 17, null)).toBe('/app?org=33&conversa=17&vista=conversa')
  expect(enderecoConversaEntrega(33, 17, 'conteudo')).toBe('/app?org=33&conversa=17&vista=conversa&slug=conteudo')
})
