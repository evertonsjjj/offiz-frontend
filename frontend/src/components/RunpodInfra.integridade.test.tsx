import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { IdiomaProvider } from '../lib/i18n'
import { AuthProvider } from '../context/AuthContext'
import { ToastsProvider } from './Toasts'
import { RunpodInfra } from './RunpodInfra'

vi.mock('../lib/api', async original => ({
  ...await original<typeof import('../lib/api')>(),
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}))
const config = { chave_configurada: true, chave_runtime_configurada: true, habilitado: false, limite_brl_mes: 200, usd_brl: 5.5995, endpoint_id: 'endpoint-demo', image: `repo/worker@sha256:${'a'.repeat(64)}`, periodo: '2026-10', consumido_brl: 8, reservado_brl: 2, disponivel_brl: 190, limite_usd_por_job: 1, allowed_org_ids: [] as number[], max_usd_per_second: '0.00019', ultima_verificacao: null }
const gerenciado = { id: 29, nome: 'Contrato gerenciado', modalidade: 'pf_gerenciado', contrato_ativo: true, incluido: false }
const consulta = { conectado: true, verificado_em: '2026-10-09T14:00:00Z', saldo_usd: 10, consumo_usd_hora: 0, recarga_automatica: false, endpoint: null, tarifas: [] }
const extrato = { consultado_em: '2026-10-09T14:00:00Z', periodo: '2026-10', endpoint_id: 'endpoint-demo', registros: 2, totais_usd: { cpuAmount: 0, diskAmount: 0, feeAmount: 0, gpuAmount: 0.01, totalAmount: 0.01 }, total_brl_observado: 0.055995, cambio: 5.5995, comprovante_sha256: 'b'.repeat(64), por_tarefa: false, consolidacao_confirmada: false }
function preparar(contratos = [gerenciado]) {
  vi.mocked(api.get).mockImplementation(async path => path === '/admin/gpu' ? config : path === '/admin/gpu/contratos' ? { itens: contratos } : { total: 0, itens: [], periodo: config.periodo, consumido_brl: 8, reservado_brl: 2, disponivel_brl: 190 })
}
function idioma() {
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'offiz:idioma:visitante', newValue: 'en' })))
}
function abrirComIdioma() {
  render(<ToastsProvider><AuthProvider><IdiomaProvider><RunpodInfra /></IdiomaProvider></AuthProvider></ToastsProvider>)
}
beforeEach(() => { localStorage.clear(); localStorage.setItem('offiz:idioma:visitante', 'pt-BR'); preparar(); vi.mocked(api.put).mockResolvedValue(config); vi.mocked(api.post).mockResolvedValue(consulta) })
afterEach(() => { cleanup(); vi.resetAllMocks(); localStorage.clear() })

it('trocar idioma preserva o limite em edição e não consulta novamente a configuração', async () => {
  abrirComIdioma()
  await screen.findByRole('form', { name: 'Configuração Runpod' })
  fireEvent.change(screen.getByLabelText('Teto mensal do dono para GPU (R$)'), { target: { value: '180' } })
  idioma()
  await screen.findByRole('form', { name: 'Runpod settings' })
  await act(async () => undefined)
  expect(screen.getByLabelText('Owner monthly GPU limit (BRL)')).toHaveValue(180)
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/admin/gpu')).toHaveLength(1)
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/admin/gpu/contratos')).toHaveLength(1)
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.startsWith('/admin/gpu/operacoes?'))).toHaveLength(1)
  expect(api.put).not.toHaveBeenCalled()
})

it('contrato de contas próprias não é elegível para ativar a GPU incluída', async () => {
  preparar([{ ...gerenciado, nome: 'Conta própria', modalidade: 'byok' }])
  render(<RunpodInfra />)
  const cliente = await screen.findByRole('checkbox', { name: /Conta própria/ })
  expect(cliente).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Habilitar GPU para os contratos selecionados' }))
  fireEvent.submit(screen.getByRole('form', { name: 'Configuração Runpod' }))
  expect(api.put).not.toHaveBeenCalled()
})

it('contrato próprio já selecionado pode ser removido, mas não usado para ativação', async () => {
  preparar([{ ...gerenciado, nome: 'Conta própria', modalidade: 'byok' }])
  vi.mocked(api.get).mockImplementation(async path => path === '/admin/gpu' ? { ...config, allowed_org_ids: [29] } : path === '/admin/gpu/contratos' ? { itens: [{ ...gerenciado, nome: 'Conta própria', modalidade: 'byok' }] } : { total: 0, itens: [], periodo: config.periodo, consumido_brl: 8, reservado_brl: 2, disponivel_brl: 190 })
  render(<RunpodInfra />)
  const cliente = await screen.findByRole('checkbox', { name: /Conta própria/ })
  expect(cliente).toBeChecked()
  expect(cliente).toBeEnabled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Habilitar GPU para os contratos selecionados' }))
  fireEvent.submit(screen.getByRole('form', { name: 'Configuração Runpod' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/contratos.*gerenciados/i)
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.click(cliente)
  expect(cliente).not.toBeChecked()
})

it('resposta incompleta ao salvar não anuncia sucesso nem descarta o rascunho', async () => {
  vi.mocked(api.put).mockResolvedValue({})
  render(<RunpodInfra />)
  await screen.findByRole('form', { name: 'Configuração Runpod' })
  fireEvent.change(screen.getByLabelText('Teto mensal do dono para GPU (R$)'), { target: { value: '180' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Configuração Runpod' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível/i)
  expect(screen.queryByText(/Configuração Runpod salva/)).not.toBeInTheDocument()
  expect(screen.getByLabelText('Teto mensal do dono para GPU (R$)')).toHaveValue(180)
})

it('recarga automática ausente não é exibida como desligada', async () => {
  vi.mocked(api.post).mockResolvedValue({ ...consulta, recarga_automatica: undefined })
  render(<RunpodInfra />)
  fireEvent.click(await screen.findByRole('button', { name: 'Verificar conexão Runpod' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  await act(async () => undefined)
  expect(screen.queryByText(/desativada no Runpod/)).not.toBeInTheDocument()
  expect(screen.queryByText('Conexão de consulta confirmada')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toBeVisible()
})

it('extrato de outro endpoint não aparece como cobrança da conexão salva', async () => {
  vi.mocked(api.post).mockResolvedValue({ ...extrato, endpoint_id: 'outro-endpoint' })
  render(<RunpodInfra />)
  fireEvent.click(await screen.findByRole('button', { name: 'Consultar cobrança do fornecedor' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível/i)
  expect(screen.queryByText(/Extrato consultado em/)).not.toBeInTheDocument()
  expect(screen.queryByText(/outro-endpoint/)).not.toBeInTheDocument()
})

it('configuração salva incompleta não libera edição de limites inventados', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/admin/gpu' ? { ...config, limite_brl_mes: undefined } : path === '/admin/gpu/contratos' ? { itens: [gerenciado] } : { total: 0, itens: [], periodo: config.periodo, consumido_brl: 8, reservado_brl: 2, disponivel_brl: 190 })
  render(<RunpodInfra />)
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.queryByRole('form', { name: 'Configuração Runpod' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeVisible()
  expect(api.put).not.toHaveBeenCalled()
})

it('operação com custo ausente não aparece como custo confirmado ou interrompe a tela', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/admin/gpu' ? config : path === '/admin/gpu/contratos' ? { itens: [gerenciado] } : { total: 1, itens: [{ id: 'operacao-fixture', org_id: 29, job_id: 50, state: 'concluido', reserva_brl: 2, criado_em: '2026-10-09T14:00:00Z', aguardando_conferencia: false }], periodo: config.periodo, consumido_brl: 8, reservado_brl: 2, disponivel_brl: 190 })
  render(<RunpodInfra />)
  expect(await screen.findByRole('alert')).toHaveTextContent(/operações GPU/)
  expect(screen.queryByText('Custo conciliado')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Atualizar operações GPU' })).toBeVisible()
})
