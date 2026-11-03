import { expect, it, vi } from 'vitest'
import { consultarConexaoIA, origemIA } from './conexao-ia'
import type { InicioOrganizacao } from './inicio'
import type { OffizMotorBridge } from './motor-bridge'

const dados = { org_id: 3, org_status: 'ativa', contrato_gerenciado: true, tem_chave: true, motor_modo: 'cli' } as InicioOrganizacao
function bridge() {
  return {
    chatDeviceId: 'maquina-teste',
    estado: vi.fn(async () => ({ config: { orgId: 3, localEngine: 'codex' }, pareado: true, worker: { estado: 'ocioso' } })),
    codexStatus: vi.fn(async () => ({ installed: true, authenticated: false })),
    claudeStatus: vi.fn(async () => ({ installed: true, loggedIn: true, tokenExpired: true })),
  }
}

it('navegador mostra contrato ou API, mesmo quando tarefas da empresa usam CLI', async () => {
  expect(origemIA(dados)).toBe('contrato')
  expect(await consultarConexaoIA(dados)).toEqual({ origem: 'contrato', estado: 'configurada', pronto: true })
  expect(origemIA({ ...dados, contrato_gerenciado: false })).toBe('api')
  expect((await consultarConexaoIA({ ...dados, tem_chave: false })).estado).toBe('sem-configuracao')
  expect((await consultarConexaoIA({ ...dados, sem_saldo: true })).pronto).toBe(true)
})

it('motor ligado sem login não é conectado e não cai na API do contrato', async () => {
  const local = bridge()
  expect(await consultarConexaoIA(dados, local as unknown as OffizMotorBridge)).toEqual({ origem: 'local', motor: 'codex', estado: 'autenticar', pronto: false })
  local.codexStatus.mockResolvedValue({ installed: true, authenticated: true })
  expect((await consultarConexaoIA(dados, local as unknown as OffizMotorBridge)).estado).toBe('conectado')
})

it('a máquina precisa pertencer à empresa atual e estar ligada', async () => {
  const local = bridge()
  local.estado.mockResolvedValue({ config: { orgId: 8, localEngine: 'codex' }, pareado: true, worker: { estado: 'ocioso' } })
  expect((await consultarConexaoIA(dados, local as unknown as OffizMotorBridge)).estado).toBe('parear')
  local.estado.mockResolvedValue({ config: { orgId: 3, localEngine: 'codex' }, pareado: true, worker: { estado: 'parado' } })
  expect((await consultarConexaoIA(dados, local as unknown as OffizMotorBridge)).estado).toBe('desligado')
  expect(local.codexStatus).not.toHaveBeenCalled()
})

it('token Claude expirado bloqueia envio mesmo com loggedIn e configuração de API', async () => {
  const local = bridge()
  local.estado.mockResolvedValue({ config: { orgId: 3, localEngine: 'claude' }, pareado: true, worker: { estado: 'ocioso' } })
  expect(await consultarConexaoIA(dados, local as unknown as OffizMotorBridge)).toEqual({ origem: 'local', motor: 'claude', estado: 'autenticar', pronto: false })
})

it('sem saldo de mídia não impede conversa local; suspensão impede qualquer origem', async () => {
  const local = bridge()
  local.codexStatus.mockResolvedValue({ installed: true, authenticated: true })
  expect((await consultarConexaoIA({ ...dados, sem_saldo: true }, local as unknown as OffizMotorBridge)).pronto).toBe(true)
  expect((await consultarConexaoIA({ ...dados, org_status: 'suspensa' }, local as unknown as OffizMotorBridge)).pronto).toBe(false)
})

it('falha de diagnóstico não aparece como IA ausente ou conexão pronta', async () => {
  const local = bridge()
  local.codexStatus.mockResolvedValue(Object.assign({ installed: false, authenticated: false }, { error: 'Falha ao consultar' }))
  expect((await consultarConexaoIA(dados, local as unknown as OffizMotorBridge)).estado).toBe('erro')
  local.estado.mockResolvedValue({ config: { orgId: 3, localEngine: 'claude' }, pareado: true, worker: { estado: 'ocioso' } })
  local.claudeStatus.mockResolvedValue(Object.assign({ installed: false, loggedIn: false, tokenExpired: false }, { error: 'Falha ao consultar' }))
  expect((await consultarConexaoIA(dados, local as unknown as OffizMotorBridge)).estado).toBe('erro')
})

it('estado desconhecido do motor não autoriza envio', async () => {
  const local = bridge()
  local.estado.mockResolvedValue({ config: { orgId: 3, localEngine: 'codex' }, pareado: true, worker: { estado: 'reiniciando' } })
  expect((await consultarConexaoIA(dados, local as unknown as OffizMotorBridge)).pronto).toBe(false)
  expect(local.codexStatus).not.toHaveBeenCalled()
})

const inicio: InicioOrganizacao = {
  org_id: 3, org_nome: 'Empresa sintética', meu_papel: 'member', org_status: 'ativa',
  tem_chave: true, motor_modo: 'api', sem_saldo: true, andares: [], solucoes: [], outras_solucoes: [],
  sabatina: { estado: 'contextualizado', pergunta: '', opcoes: [], permite_livre: true },
}

it.each([false, true])('alerta de trabalho anterior não comprova falta atual de crédito da conversa (contrato=%s)', async contrato => {
  expect(await consultarConexaoIA({ ...inicio, contrato_gerenciado: contrato })).toEqual({
    origem: contrato ? 'contrato' : 'api', estado: 'configurada', pronto: true,
  })
})

it('aviso histórico não libera uma conexão sem chave', async () => {
  expect(await consultarConexaoIA({ ...inicio, tem_chave: false })).toEqual({
    origem: 'api', estado: 'sem-configuracao', pronto: false,
  })
})

it('aviso histórico não libera uma empresa suspensa', async () => {
  expect(await consultarConexaoIA({ ...inicio, org_status: 'suspensa' })).toEqual({
    origem: 'api', estado: 'suspensa', pronto: false,
  })
})
