import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ArmazenamentoOrg } from './ArmazenamentoOrg'
import { api, setTokens } from '../lib/api'

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn() } }))
const dados = { limite_bytes: 10e9, unidade_bytes: 1e9, bytes_centrais_reais: 2e9, bytes_alocados_centrais: 3e9, medicao_completa: true, excedido: false, disponivel_bytes: 8e9, pode_incrementar: true, destino: 'compartilhado', residencia_integral_verificada: false, requisitos: { postgres_configurado_testado: false, s3_configurado_testado: false, infraestrutura_externa_verificada: false }, pendencias_residencia: [] }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); setTokens('fixture-storage', 'fixture-refresh'); vi.mocked(api.get).mockResolvedValue(dados) })

it('mostra cota decimal, uso e alocação separados, sem afirmar residência integral', async () => {
  render(<ArmazenamentoOrg orgId={22} />)
  expect(await screen.findByText(/10 GB/)).toBeInTheDocument()
  expect(screen.getByText(/Uso contabilizado:/).closest('p')).toHaveTextContent('2 GB')
  expect(screen.getByText(/Espaço ocupado em disco:/)).toHaveTextContent('3 GB')
  expect(screen.getByText(/Disponível:/)).toHaveTextContent('8 GB')
  expect(screen.getByText(/residência integral fora do Offiz ainda não foi verificada/)).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledWith('/orgs/22/armazenamento', expect.any(AbortSignal))
})

it.each([{}, { ...dados, bytes_centrais_reais: -1 }, { ...dados, medicao_completa: undefined }])('não converte resposta inválida em uso zero', async invalido => {
  vi.mocked(api.get).mockResolvedValueOnce(invalido)
  render(<ArmazenamentoOrg orgId={22} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('O uso não foi considerado zero')
  expect(screen.queryByText('0 GB')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Medir novamente' }))
  await screen.findByText(/10 GB/)
})

it('medição incompleta e configuração externa parcial permanecem pendentes', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...dados, medicao_completa: false, pode_incrementar: false, bytes_centrais_reais: null, bytes_alocados_centrais: null, disponivel_bytes: null, excedido: null, destino: 'externo_pendente', requisitos: { ...dados.requisitos, postgres_configurado_testado: true }, pendencias_residencia: ['Validar os arquivos externos.'] })
  render(<ArmazenamentoOrg orgId={22} />)
  await screen.findByText('Medição incompleta')
  expect(screen.getByText(/Destino atual:/).closest('p')).toHaveTextContent('Configuração externa pendente')
  expect(screen.getByRole('status')).toHaveTextContent('Novos arquivos aguardam uma medição completa')
  expect(screen.queryByText('0 GB')).not.toBeInTheDocument()
})

it('trocar empresa descarta medição atrasada da anterior', async () => {
  let concluir!: (data: unknown) => void
  vi.mocked(api.get).mockReturnValueOnce(new Promise(resolve => { concluir = resolve })).mockResolvedValue({ ...dados, bytes_centrais_reais: 4e9 })
  const tela = render(<ArmazenamentoOrg orgId={22} />)
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1))
  tela.rerender(<ArmazenamentoOrg orgId={33} />)
  await screen.findByText(/10 GB/)
  await act(async () => concluir(dados))
  expect(screen.getByText(/Uso contabilizado:/).closest('p')).toHaveTextContent('4 GB')
  expect(api.get).toHaveBeenCalledWith('/orgs/33/armazenamento', expect.any(AbortSignal))
})

it('atingir exatamente 10 GB informa limite sem atribuir o bloqueio a uma medição incompleta', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...dados, bytes_centrais_reais: 10e9, disponivel_bytes: 0, pode_incrementar: false, excedido: false })
  render(<ArmazenamentoOrg orgId={22} />)
  expect(await screen.findByText(/O limite foi atingido/)).toHaveAttribute('role', 'status')
  expect(screen.queryByText(/Novos arquivos aguardam uma medição completa/)).not.toBeInTheDocument()
})
