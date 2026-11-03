import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError } from '../lib/api'
import { AdminContratos, MeuContrato } from './ContratosIA'

vi.mock('../lib/api', async original => ({
  ...await original<typeof import('../lib/api')>(),
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}))

const contas = { configuradas: { openai: true, falai: false, elevenlabs: false }, usd_brl: 5.5, margem_custo_pct: 20, elevenlabs_usd_mil_caracteres: 0.3 }
const contrato = { tipo: 'pf_gerenciado', mensalidade_brl: 150, limite_brl_mes: 100, servicos: ['openai'], periodo: '2026-10', consumido_brl: 8, reservado_brl: 2, disponivel_brl: 90, conexoes: { openai: true }, inicio: null, fim: null, vigencia: 'vigente' }
const orgs = [{ id: 7, nome: 'Cliente A', slug: 'a', status: 'ativa' }, { id: 8, nome: 'Cliente B', slug: 'b', status: 'ativa' }]
const reserva = { id: 'reserva-fixture', provedor: 'falai', modelo: 'modelo-fixture', periodo: '2026-10', reserva_brl: 2, criado_em: '2026-01-01T00:00:00Z', estado: 'reservado' }
function pendente<T>() {
  let resolver!: (valor: T) => void
  const promise = new Promise<T>(resolve => { resolver = resolve })
  return { promise, resolver }
}
async function abrirAdmin(aoSalvar = vi.fn()) {
  render(<AdminContratos orgs={orgs} aoSalvar={aoSalvar} />)
  fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: '7' } })
  await screen.findByRole('button', { name: 'Salvar contrato' })
  return aoSalvar
}
beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async path => path === '/admin/contas-ia' ? contas : path.endsWith('/reservas-ia') ? [] : contrato)
  vi.mocked(api.put).mockResolvedValue(contrato)
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('limite em edição não altera o extrato confirmado antes de salvar', async () => {
  await abrirAdmin()
  fireEvent.change(screen.getByLabelText('Saldo mensal para IA (R$)'), { target: { value: '20' } })
  expect(screen.getByLabelText('Saldo mensal para IA (R$)')).toHaveValue(20)
  expect(screen.getByText(/disponíveis/).parentElement).toHaveTextContent(/90,00 disponíveis de R\$\s*100,00/)
  expect(api.put).not.toHaveBeenCalled()
  vi.mocked(api.put).mockResolvedValue({ ...contrato, limite_brl_mes: 20, disponivel_brl: 10 })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }))
  await screen.findByText('Contrato salvo.')
  expect(screen.getByText(/disponíveis/).parentElement).toHaveTextContent(/10,00 disponíveis de R\$\s*20,00/)
})

it.each(['disponivel_brl', 'consumido_brl', 'reservado_brl'])('campo financeiro %s ausente não vira saldo zero', async campo => {
  vi.mocked(api.get).mockResolvedValue({ ...contrato, [campo]: undefined })
  render(<MeuContrato orgId={7} />)
  expect(await screen.findByText(/Saldo indisponível/)).toBeVisible()
  expect(screen.queryByText(/disponíveis/)).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('um saldo confirmado realmente zerado continua sendo informado', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...contrato, consumido_brl: 100, reservado_brl: 0, disponivel_brl: 0 })
  render(<MeuContrato orgId={7} />)
  expect(await screen.findByText(/0,00 disponíveis/)).toBeVisible()
  expect(screen.queryByText(/Saldo indisponível/)).not.toBeInTheDocument()
})

it('dois submits do contrato durante o mesmo envio fazem uma única alteração', async () => {
  await abrirAdmin()
  const resposta = pendente<typeof contrato>()
  vi.mocked(api.put).mockReturnValue(resposta.promise)
  const form = screen.getByRole('button', { name: 'Salvar contrato' }).closest('form')!
  act(() => { fireEvent.submit(form); fireEvent.submit(form) })
  expect(api.put).toHaveBeenCalledTimes(1)
  await act(async () => { resposta.resolver(contrato) })
  expect(await screen.findByText('Contrato salvo.')).toBeVisible()
})

it('salvamento da empresa anterior não confirma nem atualiza a empresa atual', async () => {
  const aoSalvar = await abrirAdmin()
  const resposta = pendente<typeof contrato>()
  vi.mocked(api.put).mockReturnValue(resposta.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }))
  fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: '8' } })
  await screen.findByRole('button', { name: 'Salvar contrato' })
  await act(async () => { resposta.resolver({ ...contrato, disponivel_brl: 1 }) })
  expect(aoSalvar).not.toHaveBeenCalled()
  expect(screen.queryByText('Contrato salvo.')).not.toBeInTheDocument()
  expect(screen.getByText(/90,00 disponíveis/)).toBeVisible()
})

it('falha ao atualizar reservas suspende ações antigas até uma nova leitura válida', async () => {
  let leituras = 0
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/admin/contas-ia') return contas
    if (!path.endsWith('/reservas-ia')) return contrato
    leituras += 1
    if (leituras === 2) throw new ApiError(503, 'Consulta de chamadas indisponível')
    return [reserva]
  })
  await abrirAdmin()
  fireEvent.click(screen.getByText(/Chamadas em processamento ou conferência \(1\)/))
  expect(screen.getByRole('button', { name: 'Conferir custo' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar chamadas' }))
  await screen.findByText('Consulta de chamadas indisponível')
  expect(screen.getByRole('button', { name: 'Conferir custo' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Offiz assume a pendência' })).toBeDisabled()
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar chamadas' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir custo' })).toBeEnabled())
})

it('dois submits de contas compartilhadas fazem uma única alteração', async () => {
  render(<AdminContratos orgs={orgs} aoSalvar={vi.fn()} />)
  const button = await screen.findByRole('button', { name: 'Salvar contas de IA' })
  const resposta = pendente<typeof contas>()
  vi.mocked(api.put).mockReturnValue(resposta.promise)
  act(() => { fireEvent.submit(button.closest('form')!); fireEvent.submit(button.closest('form')!) })
  expect(api.put).toHaveBeenCalledTimes(1)
  await act(async () => { resposta.resolver(contas) })
  expect(await screen.findByText('Contas compartilhadas salvas.')).toBeVisible()
})

it('crédito confirmado atualiza o saldo sem apagar o limite ainda em edição', async () => {
  await abrirAdmin()
  fireEvent.change(screen.getByLabelText('Saldo mensal para IA (R$)'), { target: { value: '120' } })
  vi.mocked(api.get).mockImplementation(async path => path === '/admin/contas-ia' ? contas : path.endsWith('/reservas-ia') ? [] : { ...contrato, credito_brl: 25, disponivel_brl: 115 })
  vi.mocked(api.post).mockResolvedValue({ ...contrato, credito_brl: 25, disponivel_brl: 115 })
  fireEvent.click(screen.getByRole('button', { name: 'Conceder crédito neste mês' }))
  fireEvent.change(screen.getByLabelText('Valor do crédito (R$)'), { target: { value: '25' } })
  fireEvent.change(screen.getByLabelText('Motivo do crédito'), { target: { value: 'Crédito de teste da interface' } })
  fireEvent.click(screen.getByRole('button', { name: 'Revisar crédito' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar crédito' }))
  await screen.findByText(/115,00 disponíveis/)
  expect(screen.getByLabelText('Saldo mensal para IA (R$)')).toHaveValue(120)
  expect(api.put).not.toHaveBeenCalled()
})

it('resposta incompleta do contrato não confirma salvamento nem apaga valores editados', async () => {
  const aoSalvar = await abrirAdmin()
  vi.mocked(api.put).mockResolvedValue({ ...contrato, disponivel_brl: undefined })
  fireEvent.change(screen.getByLabelText('Saldo mensal para IA (R$)'), { target: { value: '120' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível/i)
  expect(screen.queryByText('Contrato salvo.')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Saldo mensal para IA (R$)')).toHaveValue(120)
  expect(screen.getByText(/90,00 disponíveis/)).toBeVisible()
  expect(aoSalvar).not.toHaveBeenCalled()
})

it('reserva sem valor confirmado na consulta não apresenta custo zero nem libera ações', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/admin/contas-ia' ? contas : path.endsWith('/reservas-ia') ? [{ ...reserva, reserva_brl: undefined }] : contrato)
  await abrirAdmin()
  fireEvent.click(screen.getByText(/Chamadas em processamento ou conferência/))
  expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível/i)
  expect(screen.queryByRole('button', { name: 'Conferir custo' })).not.toBeInTheDocument()
  expect(screen.queryByText(/0,00 em conferência/)).not.toBeInTheDocument()
})

it('resposta sem modalidade do contrato não anuncia que o contrato foi salvo', async () => {
  await abrirAdmin()
  vi.mocked(api.put).mockResolvedValue({ ...contrato, tipo: undefined })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível/i)
  expect(screen.queryByText('Contrato salvo.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Salvar contrato' })).toBeVisible()
})

it('resposta de teste sem booleano de confirmação não confirma a conexão', async () => {
  render(<AdminContratos orgs={orgs} aoSalvar={vi.fn()} />)
  vi.mocked(api.post).mockResolvedValue({ ok: 'false', mensagem: 'Resposta incompleta', testado_em: '2026-10-09T14:00:00Z', duracao_ms: 0 })
  fireEvent.click(await screen.findByRole('button', { name: 'Testar conexão OpenAI' }))
  expect(await screen.findByText(/Conexão não confirmada/)).toBeVisible()
  expect(screen.queryByText(/Conexão confirmada/)).not.toBeInTheDocument()
})

it('leitura anterior ao salvamento não substitui o novo saldo confirmado', async () => {
  await abrirAdmin()
  vi.mocked(api.put).mockRejectedValueOnce(new ApiError(503, 'Salvamento indisponível'))
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }))
  await screen.findByText('Salvamento indisponível')
  const leitura = pendente<typeof contrato>()
  vi.mocked(api.get).mockReturnValue(leitura.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  fireEvent.change(screen.getByLabelText('Saldo mensal para IA (R$)'), { target: { value: '120' } })
  vi.mocked(api.put).mockResolvedValue({ ...contrato, limite_brl_mes: 120, disponivel_brl: 110 })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }))
  await screen.findByText('Contrato salvo.')
  await act(async () => { leitura.resolver(contrato) })
  expect(screen.getByLabelText('Saldo mensal para IA (R$)')).toHaveValue(120)
  expect(screen.getByText(/110,00 disponíveis/)).toBeVisible()
})

it('leitura anterior ao salvamento das contas não substitui o câmbio confirmado', async () => {
  render(<AdminContratos orgs={orgs} aoSalvar={vi.fn()} />)
  vi.mocked(api.put).mockRejectedValueOnce(new ApiError(503, 'Salvamento indisponível'))
  fireEvent.click(await screen.findByRole('button', { name: 'Salvar contas de IA' }))
  await screen.findByText('Salvamento indisponível')
  const leitura = pendente<typeof contas>()
  vi.mocked(api.get).mockReturnValue(leitura.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  fireEvent.change(screen.getByLabelText('Câmbio de custo: US$ 1 em R$'), { target: { value: '6' } })
  vi.mocked(api.put).mockResolvedValue({ ...contas, usd_brl: 6 })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contas de IA' }))
  await screen.findByText('Contas compartilhadas salvas.')
  await act(async () => { leitura.resolver(contas) })
  expect(screen.getByLabelText('Câmbio de custo: US$ 1 em R$')).toHaveValue(6)
})
