import type { InicioOrganizacao } from './inicio'
import type { OffizMotorBridge } from './motor-bridge'

export type OrigemIA = 'local' | 'contrato' | 'api'
export type EstadoIA = 'verificando' | 'conectado' | 'configurada' | 'sem-configuracao' | 'sem-saldo' | 'parear' | 'desligado' | 'instalar' | 'autenticar' | 'suspensa' | 'erro'
export interface ConexaoIA { origem: OrigemIA; estado: EstadoIA; pronto: boolean; motor?: 'codex' | 'claude' }

/** A origem é a desta conversa: o navegador usa API mesmo com tarefas em CLI. */
export function origemIA(dados: InicioOrganizacao, bridge?: OffizMotorBridge): OrigemIA {
  return bridge?.chatDeviceId && dados.motor_modo === 'cli' ? 'local' : dados.contrato_gerenciado ? 'contrato' : 'api'
}

export async function consultarConexaoIA(dados: InicioOrganizacao, bridge?: OffizMotorBridge): Promise<ConexaoIA> {
  const origem = origemIA(dados, bridge)
  if (dados.org_status === 'suspensa') return { origem, estado: 'suspensa', pronto: false }
  if (origem !== 'local') {
    // sem_saldo é o aviso de um trabalho anterior, inclusive de outro
    // fornecedor de mídia. Não consulta o crédito nem a conexão deste chat.
    // A carteira atual e os limites continuam conferidos pelo backend.
    const estado = dados.tem_chave ? 'configurada' : 'sem-configuracao'
    return { origem, estado, pronto: estado === 'configurada' }
  }
  const local = await bridge!.estado()
  const motor = local.config.localEngine === 'codex' ? 'codex' : 'claude'
  const resultado = (estado: EstadoIA): ConexaoIA => ({ origem, motor, estado, pronto: estado === 'conectado' })
  if (!local.pareado || local.config.orgId !== dados.org_id) return resultado('parear')
  if (local.worker.estado === 'parado') return resultado('desligado')
  if (!['ocioso', 'executando'].includes(local.worker.estado)) return resultado('erro')
  if (motor === 'codex') {
    const conta = await bridge!.codexStatus?.()
    if (!conta || conta.error) return resultado('erro')
    if (!conta.installed) return resultado('instalar')
    return resultado(conta.authenticated ? 'conectado' : 'autenticar')
  }
  const conta = await bridge!.claudeStatus()
  if (conta.error) return resultado('erro')
  if (!conta.installed) return resultado('instalar')
  return resultado(conta.loggedIn === true && conta.tokenExpired !== true ? 'conectado' : 'autenticar')
}
