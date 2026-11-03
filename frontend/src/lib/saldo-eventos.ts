/** Invalida a leitura do saldo; não altera a carteira nem inicia geração. */
export const EVENTO_SALDO_IA_MUDOU = 'offiz:saldo-ia-mudou'

export function notificarSaldoIA(orgId?: number): void {
  window.dispatchEvent(new CustomEvent(EVENTO_SALDO_IA_MUDOU, { detail: { orgId } }))
}

export function podeAlterarConsumo(path: string): boolean {
  return /^\/conversas\/\d+\/(mensagens|contrato)(?:\/|$)/.test(path)
    || /^\/jobs(?:\/|$)/.test(path)
    || /^\/predios\/\d+\/[^/]+\/(jobs|agenda|editorial|pecas)(?:\/|$)/.test(path)
    || /^\/orgs\/\d+\/predio\/planos(?:\/|$)/.test(path)
    || /^\/admin\/orgs\/\d+\/(contrato|creditos-ia|reservas-ia|consumos-ia)(?:\/|$)/.test(path)
}
