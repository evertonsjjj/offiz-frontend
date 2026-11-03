/** Synthetic metering response for the built-UI tests. No provider is called.
 * Each caller must still match its own exact GET endpoint and fixture identity.
 */
export function consumoSemRegistros(meses = 0) {
  const totais = {
    tokens: 0, estimado_api_brl: 0, consumido_gerenciado_brl: 0,
    equivalente_assinatura_brl: 0, estimativa_legada_brl: 0, reservado_brl: 0,
    sem_medicao: 0, sem_medicao_api: 0, sem_medicao_assinatura: 0,
    sem_medicao_gerenciado: 0,
  }
  const hoje = new Date()
  return {
    totais,
    meses: Array.from({ length: meses }, (_, i) => ({
      ...totais,
      periodo: new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - i, 1)).toISOString().slice(0, 7),
    })),
    conexoes: [],
    cobertura: ['Dados sintéticos desta prova de interface; nenhuma chamada de IA.'],
  }
}
