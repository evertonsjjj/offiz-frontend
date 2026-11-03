import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError } from '../lib/api'
import { RunpodInfra } from './RunpodInfra'

vi.mock('../lib/api', async original => ({
  ...await original<typeof import('../lib/api')>(),
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}))

const config = {
  chave_configurada: true, chave_runtime_configurada: false, habilitado: false, limite_brl_mes: 0, usd_brl: 5.5995,
  endpoint_id: '', image: '', periodo: '2026-09', consumido_brl: 0, reservado_brl: 0,
  disponivel_brl: 0, limite_usd_por_job: 1, ultima_verificacao: null,
  allowed_org_ids: [] as number[], max_usd_per_second: 0,
}
const contratos = { itens: [
  { id: 29, nome: 'Demo Moda', modalidade: 'pf_gerenciado', contrato_ativo: true, incluido: false },
  { id: 30, nome: 'Outro cliente', modalidade: 'pf_gerenciado', contrato_ativo: true, incluido: false },
  { id: 31, nome: 'Contrato vencido', modalidade: 'pf_gerenciado', contrato_ativo: false, incluido: false },
] }
const semOperacoes = { total: 0, itens: [] }
function mockConfig(dados: unknown, op: unknown = semOperacoes) {
  const resumo = dados as typeof config
  vi.mocked(api.get).mockImplementation(async endpoint => {
    if (endpoint === '/admin/gpu') return dados
    if (endpoint === '/admin/gpu/contratos') return contratos
    if (endpoint.startsWith('/admin/gpu/operacoes?')) return {
      periodo: resumo.periodo, consumido_brl: resumo.consumido_brl,
      reservado_brl: resumo.reservado_brl, disponivel_brl: resumo.disponivel_brl,
      ...op as typeof semOperacoes,
    }
    throw new Error(`Unexpected GET ${endpoint}`)
  })
}
const consulta = {
  conectado: true, verificado_em: '2026-09-24T20:15:00Z', saldo_usd: 10,
  consumo_usd_hora: 0, recarga_automatica: false, endpoint: null,
  tarifas: [{ gpu: 'NVIDIA L4', pool: 'AMPERE_24', vram_gb: 24, usd_hora: 0.684, usd_segundo: 0.00019, disponibilidade: 'HIGH' }],
}
const campoChave = () => screen.getByLabelText(/Chave Runpod de consulta da conta/)
const campoChaveRuntime = () => screen.getByLabelText(/Chave Runpod de execução/)
const salvar = () => screen.getByRole('button', { name: 'Salvar configuração Runpod' })
const verificar = () => screen.getByRole('button', { name: 'Verificar conexão Runpod' })
const form = () => screen.getByRole('form', { name: 'Configuração Runpod' })
const habilitar = () => screen.getByRole('checkbox', { name: 'Habilitar GPU para os contratos selecionados' })

beforeEach(() => {
  mockConfig(config)
  vi.mocked(api.put).mockResolvedValue(config)
  vi.mocked(api.post).mockResolvedValue(consulta)
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('separa saldo do fornecedor de orçamento do dono sem consultar nem ativar GPU ao abrir', async () => {
  render(<RunpodInfra />)
  await screen.findByLabelText(/Chave Runpod de consulta da conta/)
  expect(screen.getByLabelText('Teto mensal do dono para GPU (R$)')).toHaveValue(0)
  expect(screen.getByLabelText('Câmbio de custo: US$ 1 em R$')).toHaveValue(5.5995)
  expect(screen.getByLabelText('Limite por operação GPU (US$)')).toHaveValue(1)
  expect(screen.getByText('Geração por GPU desabilitada')).toBeVisible()
  expect(screen.getByText('Incluído no contrato — custo do Offiz, sem desconto no saldo do cliente.')).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Demo Moda · contrato ativo' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Habilitar GPU para os contratos selecionados' })).not.toBeChecked()
  expect(screen.getByRole('heading', { name: 'Conta no Runpod (US$)' })).toBeVisible()
  expect(screen.queryByText('US$ 10,00')).not.toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it('não preenche nenhuma chave retornada indevidamente, envia ambas uma vez e limpa os dois campos após salvar', async () => {
  mockConfig({ ...config, chave_runtime_configurada: true, api_key: 'segredo-retornado-get', runtime_api_key: 'segredo-runtime-get' })
  let resolver!: (valor: unknown) => void
  vi.mocked(api.put).mockImplementation(() => new Promise(r => { resolver = r }))
  render(<RunpodInfra />)
  await screen.findByLabelText(/Chave Runpod de consulta da conta/)
  fireEvent.click(screen.getByText('Configuração avançada de execução (opcional)'))
  expect(campoChave()).toHaveValue('')
  expect(campoChave()).toHaveAttribute('type', 'password')
  expect(campoChaveRuntime()).toHaveValue('')
  expect(campoChaveRuntime()).toHaveAttribute('type', 'password')
  expect(campoChaveRuntime()).toHaveAccessibleName('Chave Runpod de execução (opcional) · cadastrada')
  fireEvent.change(campoChave(), { target: { value: 'nova-chave-sintetica' } })
  fireEvent.change(campoChaveRuntime(), { target: { value: ' nova-chave-runtime ' } })
  expect(verificar()).toBeDisabled()
  fireEvent.submit(form())
  fireEvent.submit(form())
  expect(api.put).toHaveBeenCalledTimes(1)
  expect(api.put).toHaveBeenCalledWith('/admin/gpu', {
    api_key: 'nova-chave-sintetica', runtime_api_key: 'nova-chave-runtime', habilitado: false, limite_brl_mes: 0,
    usd_brl: 5.5995, limite_usd_por_job: 1, endpoint_id: '', image: '', allowed_org_ids: [], max_usd_per_second: '0',
  })
  expect(campoChave()).toBeDisabled()
  expect(campoChaveRuntime()).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled()
  await act(async () => { resolver({ ...config, chave_runtime_configurada: true, api_key: 'segredo-retornado-put', runtime_api_key: 'segredo-runtime-put' }) })
  await screen.findByText('Configuração Runpod salva. Geração permanece desabilitada.')
  expect(campoChave()).toHaveValue('')
  expect(campoChaveRuntime()).toHaveValue('')
  expect(document.body).not.toHaveTextContent('segredo-retornado')
  expect(document.body).not.toHaveTextContent('segredo-runtime')
  fireEvent.click(salvar())
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2))
  expect(vi.mocked(api.put).mock.calls[1][1]).not.toHaveProperty('api_key')
  expect(vi.mocked(api.put).mock.calls[1][1]).not.toHaveProperty('runtime_api_key')
  await act(async () => { resolver(config) })
  expect(api.post).not.toHaveBeenCalled()
})

it('preserva chave salva com campo vazio e não envia campos financeiros ocultos ou dados da resposta', async () => {
  mockConfig({ ...config, chave_runtime_configurada: true, allowed_org_ids: [29], api_key: 'nunca-reenviar', runtime_api_key: 'nunca-reenviar-runtime', max_usd_per_second: 0.00019, fixed_margin_usd: 0.05 })
  render(<RunpodInfra />)
  await screen.findByLabelText(/Chave Runpod de consulta da conta/)
  fireEvent.change(screen.getByLabelText('Teto mensal do dono para GPU (R$)'), { target: { value: '30' } })
  fireEvent.click(salvar())
  await screen.findByText(/Configuração Runpod salva/)
  const corpo = vi.mocked(api.put).mock.calls[0][1]
  expect(corpo).toMatchObject({ limite_brl_mes: 30, habilitado: false })
  expect(corpo).not.toHaveProperty('api_key')
  expect(corpo).not.toHaveProperty('runtime_api_key')
  expect(corpo).toHaveProperty('allowed_org_ids', [29])
  expect(corpo).toHaveProperty('max_usd_per_second', '0.00019')
  expect(corpo).not.toHaveProperty('fixed_margin_usd')
})

it('salva somente a chave de execução alterada e distingue consulta da conta de permissão de execução', async () => {
  mockConfig({ ...config, ultima_verificacao: consulta })
  vi.mocked(api.put).mockResolvedValue({ ...config, chave_runtime_configurada: true })
  render(<RunpodInfra />)
  await screen.findByText('Conexão de consulta confirmada')
  fireEvent.click(screen.getByText('Configuração avançada de execução (opcional)'))
  expect(campoChaveRuntime()).toHaveAccessibleName('Chave Runpod de execução (opcional) · não cadastrada')
  expect(screen.getByText('Verificar conexão consulta apenas a conta; não testa a chave de execução nem inicia uma GPU.')).toBeVisible()
  fireEvent.change(campoChaveRuntime(), { target: { value: 'chave-restrita-endpoint' } })
  expect(verificar()).toBeDisabled()
  expect(screen.queryByText('Conexão de consulta confirmada')).not.toBeInTheDocument()
  fireEvent.click(salvar())
  await screen.findByText(/Configuração Runpod salva/)
  const corpo = vi.mocked(api.put).mock.calls[0][1]
  expect(corpo).toMatchObject({ runtime_api_key: 'chave-restrita-endpoint', habilitado: false })
  expect(corpo).not.toHaveProperty('api_key')
  expect(campoChaveRuntime()).toHaveValue('')
  expect(campoChaveRuntime()).toHaveAccessibleName('Chave Runpod de execução (opcional) · cadastrada')
  expect(screen.getByText('Geração por GPU desabilitada')).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(verificar())
  await screen.findByText('Conexão de consulta confirmada')
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/admin/gpu/verificar', {})
})

it('recusa chave de execução só com espaços sem transmitir nenhuma credencial', async () => {
  render(<RunpodInfra />)
  await screen.findByLabelText(/Chave Runpod de consulta da conta/)
  fireEvent.click(screen.getByText('Configuração avançada de execução (opcional)'))
  fireEvent.change(campoChave(), { target: { value: 'chave-consulta' } })
  fireEvent.change(campoChaveRuntime(), { target: { value: '   ' } })
  fireEvent.submit(form())
  expect(await screen.findByRole('alert')).toHaveTextContent('As chaves Runpod não podem conter apenas espaços')
  expect(api.put).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
  expect(campoChave()).toHaveValue('chave-consulta')
})

it('consulta somente configuração salva, bloqueia duplicação e apresenta tarifa com data e fonte', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { resolver = r }))
  render(<RunpodInfra />)
  await screen.findByLabelText(/Chave Runpod de consulta da conta/)
  const botao = verificar()
  fireEvent.click(botao)
  fireEvent.click(botao)
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/admin/gpu/verificar', {})
  expect(screen.getByRole('button', { name: 'Verificando…' })).toBeDisabled()
  expect(salvar()).toBeDisabled()
  expect(campoChave()).toBeDisabled()
  await act(async () => { resolver(consulta) })
  await screen.findByText('Conexão de consulta confirmada')
  expect(screen.getByText(/24\/09\/2026/)).toBeVisible()
  expect(screen.getByText('US$ 10,00')).toBeVisible()
  expect(screen.getByRole('rowheader', { name: /NVIDIA L4/ })).toBeVisible()
  expect(screen.getByRole('cell', { name: 'US$ 0,000190' })).toBeVisible()
  expect(screen.getByRole('cell', { name: 'US$ 0,6840' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Referência do catálogo' })).toHaveAttribute('href', 'https://docs.runpod.io/api-reference-v2/catalog/list-gpu-types')
  fireEvent.change(campoChave(), { target: { value: 'substituicao' } })
  expect(verificar()).toBeDisabled()
  expect(screen.queryByText('Conexão de consulta confirmada')).not.toBeInTheDocument()
  expect(screen.queryByText('US$ 10,00')).not.toBeInTheDocument()
})

it('mantém o formulário após erro, sem exibir corpo de erro que ecoa segredo', async () => {
  vi.mocked(api.put).mockRejectedValueOnce(new ApiError(502, 'Authorization: Bearer segredo-eco e segredo-runtime-eco'))
  render(<RunpodInfra />)
  await screen.findByLabelText(/Chave Runpod de consulta da conta/)
  fireEvent.click(screen.getByText('Configuração avançada de execução (opcional)'))
  fireEvent.change(campoChave(), { target: { value: 'segredo-eco' } })
  fireEvent.change(campoChaveRuntime(), { target: { value: 'segredo-runtime-eco' } })
  fireEvent.click(salvar())
  expect(await screen.findByRole('alert')).not.toHaveTextContent('segredo-eco')
  expect(campoChave()).toHaveValue('segredo-eco')
  expect(screen.getByRole('alert')).not.toHaveTextContent('segredo-runtime-eco')
  expect(campoChaveRuntime()).toHaveValue('segredo-runtime-eco')
  expect(salvar()).toBeEnabled()
  fireEvent.click(salvar())
  await screen.findByText(/Configuração Runpod salva/)
  expect(campoChave()).toHaveValue('')
  expect(campoChaveRuntime()).toHaveValue('')
})

it('descarta prova anterior ao falhar nova consulta e não transforma dados ausentes em saldo zero', async () => {
  mockConfig({ ...config, ultima_verificacao: { ...consulta, saldo_usd: null, consumo_usd_hora: null, recarga_automatica: null, tarifas: [] } })
  vi.mocked(api.post).mockRejectedValue(new ApiError(502, 'segredo-do-fornecedor'))
  render(<RunpodInfra />)
  const prova = await screen.findByLabelText('Última consulta Runpod')
  expect(within(prova).getAllByText('Não informado')).toHaveLength(2)
  expect(prova).not.toHaveTextContent('US$ 0,00')
  fireEvent.click(verificar())
  expect(await screen.findByRole('alert')).not.toHaveTextContent('segredo-do-fornecedor')
  expect(screen.queryByLabelText('Última consulta Runpod')).not.toBeInTheDocument()
  expect(verificar()).toBeEnabled()
})

it.each([
  { seguro: true, pausado: true, disponivel: false, mensagem: 'Endpoint pausado: limite de workers em zero.' },
  { seguro: true, pausado: false, disponivel: true, mensagem: 'Endpoint preparado para até um worker sob demanda.' },
  { seguro: false, pausado: null, disponivel: false, mensagem: 'O endpoint precisa de ajuste antes de executar.' },
])('distingue estado do endpoint sem ativar execução: $mensagem', async ({ seguro, pausado, disponivel, mensagem }) => {
  mockConfig({ ...config, ultima_verificacao: { ...consulta, endpoint: {
    id: 'endpoint-demo', configuracao_segura: seguro, execucao_disponivel: disponivel, pausado, motivo: 'detalhe-que-nao-deve-ser-exibido',
  } } })
  render(<RunpodInfra />)
  await screen.findByText(texto => texto.startsWith(mensagem))
  expect(screen.getByText('Geração por GPU desabilitada')).toBeVisible()
  expect(screen.queryByText(/detalhe-que-nao-deve-ser-exibido/)).not.toBeInTheDocument()
  if (seguro) expect(screen.queryByText(/O endpoint precisa de ajuste/)).not.toBeInTheDocument()
  if (!pausado) expect(screen.queryByText(/Endpoint pausado/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /ativar|executar|gerar/i })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it('valida valores e imagem sem transmitir chave quando o formulário é inválido', async () => {
  render(<RunpodInfra />)
  await screen.findByLabelText(/Chave Runpod de consulta da conta/)
  const limite = screen.getByLabelText('Teto mensal do dono para GPU (R$)')
  fireEvent.change(limite, { target: { value: '-1' } })
  fireEvent.submit(form())
  expect(await screen.findByRole('alert')).toHaveTextContent('Informe teto')
  fireEvent.change(limite, { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText('Câmbio de custo: US$ 1 em R$'), { target: { value: '' } })
  fireEvent.submit(form())
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Câmbio de custo: US$ 1 em R$'), { target: { value: '5.5995' } })
  fireEvent.click(screen.getByText('Configuração avançada de execução (opcional)'))
  fireEvent.change(screen.getByLabelText('Imagem do worker com digest SHA-256'), { target: { value: 'repo/imagem:latest' } })
  fireEvent.submit(form())
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('SHA'.toLowerCase()))
  expect(api.put).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
})

it('não oferece conexão sem chave e permite recarregar após falha de autorização', async () => {
  mockConfig({ ...config, chave_configurada: false })
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(403, 'detalhes internos'))
  render(<RunpodInfra />)
  expect(await screen.findByRole('alert')).toHaveTextContent('acesso de administrador')
  expect(screen.queryByRole('form')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByLabelText(/Chave Runpod de consulta da conta/)
  expect(verificar()).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
})

const configPronta = { ...config, chave_runtime_configurada: true, limite_brl_mes: 200,
  endpoint_id: 'endpoint-demo', image: `repo/worker@sha256:${'a'.repeat(64)}`, max_usd_per_second: '0.00019' }

const extrato = { consultado_em: '2026-09-24T22:00:00Z', periodo: '2026-09', endpoint_id: 'endpoint-demo', registros: 2,
  totais_usd: { cpuAmount: 0, diskAmount: 0.001, feeAmount: 0, gpuAmount: 0.009, totalAmount: 0.01 },
  total_brl_observado: 0.055995, cambio: 5.5995, comprovante_sha256: 'a'.repeat(64), por_tarefa: false, consolidacao_confirmada: false }
const consultarCobranca = () => screen.getByRole('button', { name: 'Consultar cobrança do fornecedor' })

it('consulta extrato agregado sem enviar credenciais nem duplicar pedido ou reconciliar tarefas', async () => {
  mockConfig(configPronta, { total: 1, itens: [{ id: 'op1', org_id: 29, job_id: 298, state: 'encerrado', reserva_brl: 5,
    custo_brl: null, criado_em: '2026-09-24T20:00:00Z', aguardando_conferencia: true }] })
  let resolver!: (valor: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { resolver = r }))
  render(<RunpodInfra />)
  const botao = await screen.findByRole('button', { name: 'Consultar cobrança do fornecedor' })
  fireEvent.click(botao); fireEvent.click(botao)
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/admin/gpu/cobranca', {})
  expect(screen.getByRole('button', { name: 'Consultando cobrança…' })).toBeDisabled()
  expect(salvar()).toBeDisabled()
  expect(campoChave()).toBeDisabled()
  await act(async () => { resolver({ ...extrato, observacao: 'segredo-do-corpo-nao-exibir' }) })
  const area = screen.getByRole('region', { name: 'Extrato agregado do fornecedor' })
  expect(within(area).getByText('US$ 0,010000')).toBeVisible()
  expect(within(area).getByText(/0,055995/)).toBeVisible()
  expect(area).toHaveTextContent('Mês: 2026-09 · Endpoint: endpoint-demo · Registros: 2')
  expect(area).toHaveTextContent('registrar cobranças com atraso')
  expect(area).toHaveTextContent('Consolidação não confirmada')
  expect(area).not.toHaveTextContent('segredo-do-corpo-nao-exibir')
  expect(screen.getByRole('table', { name: 'Operações GPU — custo do Offiz' })).toHaveTextContent('Não conciliado')
  expect(api.put).not.toHaveBeenCalled()
})

it('extrato sem registros não comprova custo zero e mudança de conexão descarta consulta anterior', async () => {
  mockConfig(configPronta)
  vi.mocked(api.post).mockResolvedValue({ ...extrato, registros: 0, total_brl_observado: 0,
    totais_usd: { cpuAmount: 0, diskAmount: 0, feeAmount: 0, gpuAmount: 0, totalAmount: 0 } })
  render(<RunpodInfra />)
  fireEvent.click(await screen.findByRole('button', { name: 'Consultar cobrança do fornecedor' }))
  await screen.findByText('Extrato ainda sem registros; não comprova custo zero.')
  const area = screen.getByRole('region', { name: 'Extrato agregado do fornecedor' })
  expect(area).not.toHaveTextContent('US$ 0,000000')
  expect(within(area).queryByText('Total agregado observado no endpoint')).not.toBeInTheDocument()
  expect(area).toHaveTextContent('não libera reservas nem debita a carteira do cliente')
  fireEvent.change(campoChave(), { target: { value: 'nova-chave-sintetica' } })
  expect(consultarCobranca()).toBeDisabled()
  expect(screen.queryByText('Extrato ainda sem registros; não comprova custo zero.')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('falha do extrato remove resultado anterior, preserva reservas e esconde erros que ecoam segredo', async () => {
  mockConfig(configPronta)
  vi.mocked(api.post).mockResolvedValueOnce(extrato).mockRejectedValueOnce(new ApiError(502, 'Authorization: segredo-fornecedor'))
  render(<RunpodInfra />)
  fireEvent.click(await screen.findByRole('button', { name: 'Consultar cobrança do fornecedor' }))
  await screen.findByText('US$ 0,010000')
  fireEvent.click(consultarCobranca())
  const area = screen.getByRole('region', { name: 'Extrato agregado do fornecedor' })
  expect(await within(area).findByRole('alert')).not.toHaveTextContent('segredo-fornecedor')
  expect(within(area).queryByText('US$ 0,010000')).not.toBeInTheDocument()
  expect(consultarCobranca()).toBeEnabled()
  expect(api.put).not.toHaveBeenCalled()
  expect(vi.mocked(api.post).mock.calls.every(([url]) => url === '/admin/gpu/cobranca')).toBe(true)
})

it('habilita somente o contrato marcado após confirmação do servidor, sem iniciar trabalho', async () => {
  mockConfig(configPronta)
  let resolver!: (valor: unknown) => void
  vi.mocked(api.put).mockImplementation(() => new Promise(r => { resolver = r }))
  render(<RunpodInfra />)
  const contrato = await screen.findByRole('checkbox', { name: 'Demo Moda · contrato ativo' })
  expect(contrato).not.toBeChecked()
  fireEvent.click(contrato)
  fireEvent.click(habilitar())
  expect(screen.getByText('Geração por GPU desabilitada')).toBeVisible()
  fireEvent.submit(form())
  expect(api.put).toHaveBeenCalledExactlyOnceWith('/admin/gpu', expect.objectContaining({ habilitado: true, allowed_org_ids: [29], max_usd_per_second: '0.00019' }))
  expect(screen.queryByText('GPU habilitada para contratos selecionados')).not.toBeInTheDocument()
  expect(habilitar()).toBeDisabled()
  await act(async () => { resolver({ ...configPronta, habilitado: true, allowed_org_ids: [29] }) })
  expect(await screen.findByText('GPU habilitada para contratos selecionados')).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Outro cliente · contrato ativo' })).not.toBeChecked()
  expect(api.post).not.toHaveBeenCalled()
})

it('recusa ativação sem contrato explícito, com contrato inativo ou tarifa zero', async () => {
  mockConfig({ ...configPronta, max_usd_per_second: 0 })
  render(<RunpodInfra />)
  await screen.findByRole('checkbox', { name: 'Demo Moda · contrato ativo' })
  expect(screen.getByRole('checkbox', { name: 'Contrato vencido · contrato inativo' })).toBeDisabled()
  fireEvent.click(habilitar())
  fireEvent.submit(form())
  expect(screen.getByRole('alert')).toHaveTextContent('Selecione somente contratos ativos')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Demo Moda · contrato ativo' }))
  fireEvent.submit(form())
  expect(screen.getByRole('alert')).toHaveTextContent('limites positivos, incluindo a tarifa')
  expect(api.put).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
})

it('não transforma recusa de ativação em habilitação salva e não expõe resposta do fornecedor', async () => {
  mockConfig({ ...configPronta, allowed_org_ids: [29] })
  vi.mocked(api.put).mockRejectedValue(new ApiError(409, 'Authorization: chave-fornecedor-secreta'))
  render(<RunpodInfra />)
  await screen.findByRole('checkbox', { name: 'Demo Moda · contrato ativo' })
  fireEvent.click(habilitar())
  fireEvent.submit(form())
  expect(await screen.findByRole('alert')).toHaveTextContent('A ativação não foi confirmada')
  expect(screen.getByRole('alert')).not.toHaveTextContent('chave-fornecedor-secreta')
  expect(screen.getByText('Geração por GPU desabilitada')).toBeVisible()
  expect(habilitar()).toBeChecked()
  expect(salvar()).toBeEnabled()
})

it('desabilita sem perder os contratos salvos nem reenviar segredos', async () => {
  mockConfig({ ...configPronta, habilitado: true, allowed_org_ids: [29] })
  render(<RunpodInfra />)
  await screen.findByText('GPU habilitada para contratos selecionados')
  fireEvent.click(habilitar())
  fireEvent.click(salvar())
  await screen.findByText('Configuração Runpod salva. Geração permanece desabilitada.')
  expect(api.put).toHaveBeenCalledWith('/admin/gpu', expect.objectContaining({ habilitado: false, allowed_org_ids: [29] }))
  expect(vi.mocked(api.put).mock.calls[0][1]).not.toHaveProperty('api_key')
  expect(vi.mocked(api.put).mock.calls[0][1]).not.toHaveProperty('runtime_api_key')
})

it('mostra custo do Offiz por cliente sem apresentar reserva ou custo ausente como cobrança confirmada', async () => {
  const op = { id: 'a'.repeat(32), org_id: 29, job_id: 298, state: 'encerrado', reserva_brl: 5,
    custo_brl: null, criado_em: '2026-09-24T20:00:00Z', aguardando_conferencia: true }
  mockConfig(config, { total: 21, itens: [op,
    { ...op, id: 'b'.repeat(32), org_id: 30, job_id: 299, state: 'concluido', custo_brl: 0.047748, aguardando_conferencia: false },
  ] })
  render(<RunpodInfra />)
  const table = await screen.findByRole('table', { name: 'Operações GPU — custo do Offiz' })
  const linha = within(table).getByRole('rowheader', { name: 'Demo Moda Tarefa #298' }).closest('tr')!
  expect(linha).toHaveTextContent('Aguardando conferência')
  expect(linha).toHaveTextContent('Não conciliado')
  const celulas = within(linha).getAllByRole('cell')
  expect(celulas[celulas.length - 1]).not.toHaveTextContent('R$')
  expect(within(table).getByText(/0,047748/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/gpu/operacoes?limit=20&offset=20'))
  expect(api.put).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
})

it('atualiza orçamento e operações no mesmo retorno sem substituir formulário ou chaves não salvos', async () => {
  mockConfig({ ...configPronta, disponivel_brl: 200 })
  render(<RunpodInfra />)
  const atualizar = await screen.findByRole('button', { name: 'Atualizar operações GPU' })
  const orcamento = screen.getByRole('region', { name: 'Orçamento do dono no Offiz' })
  expect(within(orcamento).getByText('Disponível no orçamento').parentElement).toHaveTextContent('200,00')
  fireEvent.click(screen.getByText('Configuração avançada de execução (opcional)'))
  fireEvent.change(campoChave(), { target: { value: 'consulta-nao-salva' } })
  fireEvent.change(campoChaveRuntime(), { target: { value: 'execucao-nao-salva' } })
  const campos = [
    ['Teto mensal do dono para GPU (R$)', '250'],
    ['Câmbio de custo: US$ 1 em R$', '6'],
    ['Limite por operação GPU (US$)', '2'],
    ['ID do endpoint Runpod', 'outro-endpoint'],
    ['Imagem do worker com digest SHA-256', `repo/outro@sha256:${'b'.repeat(64)}`],
  ]
  for (const [nome, valor] of campos) fireEvent.change(screen.getByLabelText(nome), { target: { value: valor } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Demo Moda · contrato ativo' }))
  fireEvent.click(habilitar())
  let resolver!: (valor: unknown) => void
  const leitura = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(endpoint => endpoint.startsWith('/admin/gpu/operacoes?')
    ? new Promise(r => { resolver = r }) : leitura(endpoint))
  fireEvent.click(atualizar)
  expect(within(orcamento).getByRole('status')).toHaveTextContent('Atualizando orçamento e operações')
  expect(within(orcamento).queryByText('Disponível no orçamento')).not.toBeInTheDocument()
  await act(async () => { resolver({ total: 1, periodo: '2026-10', consumido_brl: 5, reservado_brl: 2.3, disponivel_brl: 192.7,
    itens: [{ id: 'a'.repeat(32), org_id: 29, job_id: 299, state: 'executando', reserva_brl: 2.3,
      custo_brl: null, criado_em: '2026-10-01T00:00:00Z', aguardando_conferencia: false }],
  }) })
  expect(orcamento).toHaveTextContent('Mês de referência: 2026-10')
  expect(within(orcamento).getByText('Consumo confirmado').parentElement).toHaveTextContent('5,00')
  expect(within(orcamento).getByText('Reservado ou em conferência').parentElement).toHaveTextContent('2,30')
  expect(within(orcamento).getByText('Disponível no orçamento').parentElement).toHaveTextContent('192,70')
  expect(within(orcamento).getByText('Limite mensal salvo').parentElement).toHaveTextContent('200,00')
  expect(screen.getByRole('table', { name: 'Operações GPU — custo do Offiz' })).toHaveTextContent('2,30')
  expect(campoChave()).toHaveValue('consulta-nao-salva')
  expect(campoChaveRuntime()).toHaveValue('execucao-nao-salva')
  for (const [nome, valor] of campos) expect(screen.getByLabelText(nome)).toHaveValue(nome.includes('endpoint') || nome.includes('Imagem') ? valor : Number(valor))
  expect(habilitar()).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Demo Moda · contrato ativo' })).toBeChecked()
  expect(verificar()).toBeDisabled()
  expect(vi.mocked(api.get).mock.calls.filter(([endpoint]) => endpoint === '/admin/gpu')).toHaveLength(1)
  expect(api.put).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['erro', 'resumo ausente'])('não mantém orçamento antigo como atual quando a atualização falha: %s', async falha => {
  mockConfig({ ...configPronta, reservado_brl: 2.3, disponivel_brl: 197.7 })
  render(<RunpodInfra />)
  const atualizar = await screen.findByRole('button', { name: 'Atualizar operações GPU' })
  const orcamento = screen.getByRole('region', { name: 'Orçamento do dono no Offiz' })
  expect(within(orcamento).getByText('Reservado ou em conferência').parentElement).toHaveTextContent('2,30')
  fireEvent.change(campoChave(), { target: { value: 'manter-chave' } })
  if (falha === 'erro') vi.mocked(api.get).mockRejectedValueOnce(new ApiError(502, 'segredo-do-fornecedor'))
  else vi.mocked(api.get).mockResolvedValueOnce(semOperacoes)
  fireEvent.click(atualizar)
  await within(orcamento).findByText('Orçamento indisponível. Atualize as operações GPU para tentar novamente.')
  expect(within(orcamento).queryByText('Reservado ou em conferência')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).not.toHaveTextContent('segredo-do-fornecedor')
  expect(campoChave()).toHaveValue('manter-chave')
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar operações GPU' }))
  await within(orcamento).findByText('Reservado ou em conferência')
  expect(api.put).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
})

it('falha de leitura dos contratos não libera ativação nem apaga a seleção salva', async () => {
  const dados = { ...configPronta, allowed_org_ids: [29] }
  mockConfig(dados)
  const leitura = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async endpoint => {
    if (endpoint === '/admin/gpu/contratos') throw new ApiError(502, 'segredo-na-resposta')
    return leitura(endpoint)
  })
  render(<RunpodInfra />)
  expect(await screen.findByText(/Não foi possível consultar os contratos/)).not.toHaveTextContent('segredo-na-resposta')
  fireEvent.click(habilitar())
  fireEvent.submit(form())
  expect(screen.getByText('Selecione somente contratos ativos antes de habilitar GPU.')).toBeVisible()
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.click(habilitar())
  fireEvent.submit(form())
  await screen.findByText(/Configuração Runpod salva/)
  expect(api.put).toHaveBeenCalledWith('/admin/gpu', expect.objectContaining({ habilitado: false, allowed_org_ids: [29] }))
})

it('mantém cliente ausente da lista visível para remoção explícita, sem conceder contratos novos', async () => {
  mockConfig({ ...configPronta, allowed_org_ids: [99] })
  render(<RunpodInfra />)
  const indisponivel = await screen.findByRole('checkbox', { name: 'Cliente #99 · contrato indisponível; remova antes de habilitar' })
  expect(indisponivel).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Demo Moda · contrato ativo' })).not.toBeChecked()
  fireEvent.click(indisponivel)
  expect(indisponivel).toBeDisabled()
  fireEvent.click(salvar())
  await screen.findByText(/Configuração Runpod salva/)
  expect(api.put).toHaveBeenCalledWith('/admin/gpu', expect.objectContaining({ allowed_org_ids: [], habilitado: false }))
})
