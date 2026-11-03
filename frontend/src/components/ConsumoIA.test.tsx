import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { ConsumoIA } from './ConsumoIA'

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn() } }))
const total = { tokens: 10, estimado_api_brl: 0, consumido_gerenciado_brl: 0, equivalente_assinatura_brl: 0, estimativa_legada_brl: 0, reservado_brl: 0, sem_medicao: 1 }
const data = (valor = 0) => ({ totais: { ...total, estimado_api_brl: valor }, meses: [], conexoes: [], cobertura: [] })
beforeEach(() => vi.clearAllMocks())

it('resposta incompatível informa falha sem derrubar a conversa e permite tentar novamente', async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ conversas: [] }).mockResolvedValueOnce(data(.5))
  render(<ConsumoIA endpoint="/conversas/7/uso" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar o custo.')
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await waitFor(() => expect(screen.getAllByText(/0,50/).length).toBeGreaterThan(0))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('não apresenta medição ausente como cobrança zero', async () => {
  vi.mocked(api.get).mockResolvedValue(data())
  render(<ConsumoIA endpoint="/conversas/7/uso" />)
  expect((await screen.findAllByText('Não informado')).length).toBe(3)
  expect(screen.getByText(/O total é parcial/)).toBeInTheDocument()
  expect(screen.queryByText(/^R\$\s*0[,.]00$/)).not.toBeInTheDocument()
})

it('histórico mensal exibe estimativas legadas separadas das modalidades identificadas', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...data(), meses: [{ ...total, periodo: '2026-09', estimativa_legada_brl: 2.75 }] })
  render(<ConsumoIA endpoint="/orgs/3/uso/historico" mensal />)
  expect(await screen.findByText('2026-09')).toBeInTheDocument()
  expect(screen.getAllByRole('columnheader', { name: 'Estimativa legada' }).length).toBeGreaterThan(0)
  expect(screen.getByRole('cell', { name: /2,75/ })).toBeInTheDocument()
})

it('relatório aberto pelo diálogo mostra todo o chat sem virar histórico mensal', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...data(.5), meses: [{ ...total, periodo: '2026-09' }] })
  render(<ConsumoIA endpoint="/conversas/7/uso" inicialmenteAberto />)
  const resumo = screen.getByText('Custo deste chat e seus trabalhos', { exact: false })
  expect(resumo.closest('details')).toHaveAttribute('open')
  expect(await screen.findByRole('cell', { name: 'Todo o chat' })).toBeVisible()
  expect(screen.queryByText('Histórico mensal de custo de IA')).not.toBeInTheDocument()
  expect(screen.queryByText('2026-09')).not.toBeInTheDocument()
})

it('trocar de chat esconde dados antigos e ignora resposta atrasada', async () => {
  let concluir: (value: unknown) => void = () => {}
  vi.mocked(api.get).mockImplementation(endpoint => endpoint === '/conversas/1/uso'
    ? new Promise(resolve => { concluir = resolve }) : Promise.resolve(data(.1234)))
  const ui = render(<ConsumoIA endpoint="/conversas/1/uso" />)
  ui.rerender(<ConsumoIA endpoint="/conversas/2/uso" />)
  await waitFor(() => expect(screen.getAllByText(/0,1234/).length).toBeGreaterThan(0))
  await act(async () => concluir(data(999)))
  expect(screen.queryByText(/999/)).not.toBeInTheDocument()
})
