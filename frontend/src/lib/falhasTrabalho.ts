import type { Traduzir } from './i18n'

/** Texto de orientação; o retorno técnico continua no registro do trabalho. */
export function orientacaoFalha(erro: string | null | undefined, t: Traduzir): string {
  const texto = (erro ?? '').toLowerCase()
  // Frases canônicas do diagnóstico confirmado pelo gateway. O HTTP 429
  // isolado continua sem origem inferida na regra genérica abaixo.
  if (texto.startsWith('o offiz interrompeu esta chamada porque o saldo disponível do contrato')) {
    return t('O saldo disponível do contrato não cobre a reserva necessária para continuar. A próxima chamada de IA não foi iniciada; o consumo das etapas anteriores permanece registrado. O administrador precisa conferir o limite e as reservas antes de retomar.', 'The available contract balance does not cover the reservation needed to continue. The next AI request was not started; earlier usage remains recorded. The administrator needs to check the limit and reservations before resuming.')
  }
  if (texto.startsWith('o serviço de ia recusou esta chamada com http 429. esta recusa veio do provedor')) {
    return t('O serviço de IA recusou esta chamada com HTTP 429. A recusa veio do provedor, não do limite do contrato no Offiz. O consumo anterior permanece registrado; o administrador precisa conferir a disponibilidade ou a cota do serviço.', 'The AI service rejected this request with HTTP 429. The rejection came from the provider, not the Offiz contract limit. Earlier usage remains recorded; the administrator needs to check service availability or quota.')
  }
  if (/413|payload too large|contexto.*limite|reserva máxima/.test(texto)) {
    return t('O contexto deste trabalho excedeu um limite. A equipe Offiz precisa ajustar a execução antes de retomar.', 'This task exceeded a context limit. The Offiz team needs to adjust the run before resuming.')
  }
  if (/429|saldo|credit|too many requests/.test(texto)) {
    return t('A conexão de IA atingiu um limite de uso. Confira o saldo e a disponibilidade da conexão antes de retomar.', 'The AI connection reached a usage limit. Check the balance and connection availability before resuming.')
  }
  if (/max_output_tokens/.test(texto)) {
    return t('A resposta atingiu o limite antes de terminar. A equipe Offiz precisa ajustar a execução.', 'The response reached its limit before finishing. The Offiz team needs to adjust the run.')
  }
  return t('Este trabalho parou antes de terminar. Os arquivos que chegaram a ser salvos continuam disponíveis.', 'This task stopped before finishing. Files that were saved remain available.')
}
