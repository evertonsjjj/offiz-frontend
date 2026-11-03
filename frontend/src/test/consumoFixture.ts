/** Resposta válida para a leitura adicional de consumo em testes de conversa.
 * Outras rotas seguem para a fixture de anexos/recuperação do próprio teste.
 */
export function consumoDaConversa(path: string) {
  if (!/^\/conversas\/\d+\/uso$/.test(path)) return null
  return {
    totais: {
      tokens: 0,
      estimado_api_brl: 0,
      consumido_gerenciado_brl: 0,
      equivalente_assinatura_brl: 0,
      estimativa_legada_brl: 0,
      reservado_brl: 0,
      sem_medicao: 0,
      sem_medicao_api: 0,
      sem_medicao_assinatura: 0,
      sem_medicao_gerenciado: 0,
    },
    meses: [],
    conexoes: [],
    cobertura: [],
  }
}
