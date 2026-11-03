import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError } from '../../lib/api'
import PlanoDaPeca from './PlanoDaPeca'
import EstudioTab from './EstudioTab'
import { wsClient } from '../../lib/ws'

vi.mock('../../lib/api', async (original) => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))
vi.mock('../../lib/ws', () => ({ wsClient: { on: vi.fn(() => () => {}) } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn() }) }))

const base = '/predios/3/conteudo/estudio'
const plano = {
  tem_plano: true, pode_gerar: true, custo_pendente: 1.25, orcamento: { teto_usd: 5 },
  cenas: [{ id: 'c1', rotulo: 'Apresentar a empresa', roteiro: 'Conheça nosso trabalho.', origem: 'acervo', custo_usd: 0, material: [{ nome: 'marca.png', existe: true }] }],
  falta: [], critica: null, job_ativo: null,
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.mocked(api.get).mockResolvedValue(plano) })
afterEach(() => { cleanup(); vi.useRealTimers() })
const montar = (perguntar = vi.fn(), antesDeGerar?: () => Promise<boolean>) => render(<PlanoDaPeca base={base} peca="apresentacao" conversaId={17} perguntar={perguntar} antesDeGerar={antesDeGerar} />)

const custoExterno = {
  custo_pendente: 0, custo_pendente_escopo: 'estimativa_fal', custo_total_estimado: false,
  custo_consulta_confirmada: true,
  custos_fora_fal: [{ etapa: 'narracao', id: 'narracao', custo_usd: null, via: 'elevenlabs', fora_fal: true }],
  etapas_pendentes: [{ etapa: 'narracao', id: 'narracao', custo_usd: null, via: 'elevenlabs', fora_fal: true }],
  aviso_custo_externo: 'Narração ElevenLabs direta: custo externo não estimado.',
  pendencias: ['Confira a narração anterior antes de gerar.'],
}

it('custo fal zero não vira total grátis e teto positivo impede narração externa desconhecida', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...plano, ...custoExterno })
  montar()
  const gerar = await screen.findByRole('button', { name: 'Pode gerar' })
  expect(gerar).toBeDisabled()
  expect(screen.getByText(/Estimativa fal.ai:/)).toHaveTextContent(/0,00/)
  expect(screen.getByText(/custo externo não estimado/)).toBeVisible()
  expect(screen.getByText('Confira a narração anterior antes de gerar.')).toBeVisible()
  fireEvent.click(gerar)
  expect(api.post).not.toHaveBeenCalled()
})

it('teto zero mantém geração permitida, avisando que não limita o custo externo', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...plano, ...custoExterno, orcamento: { teto_usd: 0 } })
  montar()
  expect(await screen.findByRole('button', { name: 'Pode gerar' })).toBeEnabled()
  expect(screen.getByText(/Teto zero não limita o gasto/)).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
})

it('consulta de custo indisponível conserva plano, não mostra zero e pode ser repetida', async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ ...plano, custo_pendente: null, custo_consulta_confirmada: false, pode_gerar: false, aviso_custo_consulta: 'Não foi possível conferir o custo. Atualize o plano para tentar novamente.' }).mockResolvedValue(plano)
  montar()
  expect(await screen.findByRole('button', { name: 'Pode gerar' })).toBeDisabled()
  expect(screen.getByText(/Custo indisponível/)).toBeVisible()
  expect(screen.getByText(/Não foi possível conferir o custo/)).toBeVisible()
  expect(screen.queryByText(/Geração pendente:/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pode gerar' })).toBeEnabled())
  expect(screen.queryByText(/Custo indisponível/)).not.toBeInTheDocument()
})

it('narração genérica ativa mostra Voz padrão e desligar é uma escolha explícita', async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ ...plano, narracao: { texto: 'Texto da narração.', porta_voz: null, vozes: [] } }).mockResolvedValue({ ...plano, narracao: { texto: null, porta_voz: null, vozes: [] } })
  montar()
  const voz = await screen.findByRole('combobox', { name: 'Voz da narração' })
  expect(voz).toHaveDisplayValue('Voz padrão')
  fireEvent.change(voz, { target: { value: '' } })
  await waitFor(() => expect(api.patch).toHaveBeenCalledExactlyOnceWith(`${base}/pecas/apresentacao/narracao`, { ligada: false }))
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Voz da narração' })).not.toBeInTheDocument())
  expect(api.post).not.toHaveBeenCalled()
})

it('voltar à voz padrão conserva texto e não envia valor interno como porta-voz', async () => {
  const narracao = { texto: 'Texto próprio da narração.', porta_voz: 'Ana', vozes: [{ nome: 'Ana', pronta: true }] }
  vi.mocked(api.get).mockResolvedValueOnce({ ...plano, narracao }).mockResolvedValue({ ...plano, narracao: { ...narracao, porta_voz: null } })
  montar()
  const voz = await screen.findByRole('combobox', { name: 'Voz da narração' })
  fireEvent.change(voz, { target: { value: screen.getByRole('option', { name: 'Voz padrão' }).getAttribute('value') } })
  await waitFor(() => expect(api.patch).toHaveBeenCalledExactlyOnceWith(`${base}/pecas/apresentacao/narracao`, { ligada: true, porta_voz: '' }))
  await waitFor(() => expect(voz).toHaveDisplayValue('Voz padrão'))
  expect(api.post).not.toHaveBeenCalled()
})

it('voz configurada por identificador não aparece como padrão nem é removida implicitamente', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...plano, narracao: { texto: 'Texto próprio.', porta_voz: null, voz_direta: true, vozes: [] } })
  montar()
  const voz = await screen.findByRole('combobox', { name: 'Voz da narração' })
  expect(voz).toHaveDisplayValue('Voz selecionada')
  expect(screen.queryByRole('option', { name: 'Voz padrão' })).not.toBeInTheDocument()
  expect(api.patch).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
})

it('escolhe voz pronta, orienta voz pendente na conversa e permite desligar narração', async () => {
  const narracao = { texto: 'Olá', porta_voz: 'Ana', vozes: [{ nome: 'Ana', pronta: true }, { nome: 'Bia', pronta: false }] }
  vi.mocked(api.get).mockResolvedValue({ ...plano, narracao })
  const perguntar = vi.fn(); montar(perguntar)
  const voz = await screen.findByRole('combobox', { name: 'Voz da narração' })
  fireEvent.change(voz, { target: { value: 'Bia' } })
  expect(perguntar).toHaveBeenCalledWith(expect.stringContaining('voz de Bia'))
  expect(api.patch).not.toHaveBeenCalled()
  vi.mocked(api.get).mockResolvedValue({ ...plano, narracao: { ...narracao, porta_voz: '', texto: '' } })
  fireEvent.change(voz, { target: { value: '' } })
  await waitFor(() => expect(voz).toBeEnabled())
  expect(api.patch).toHaveBeenCalledWith(`${base}/pecas/apresentacao/narracao`, { ligada: false })
  fireEvent.change(voz, { target: { value: 'Ana' } })
  await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith(`${base}/pecas/apresentacao/narracao`, { porta_voz: 'Ana' }))
  expect(api.post).not.toHaveBeenCalled()
})

it('atualiza somente ao terminar trabalho da mesma área e reúne eventos próximos', async () => {
  const view = montar()
  await screen.findByRole('button', { name: 'Pode gerar' })
  const listener = vi.mocked(wsClient.on).mock.calls.find(([type]) => type === 'job_status')![1]
  vi.useFakeTimers()
  await act(async () => {
    listener({ t: 'job_status', org_id: 9, office_slug: 'conteudo', status: 'done' })
    listener({ t: 'job_status', org_id: 3, office_slug: 'financeiro', status: 'done' })
    listener({ t: 'job_status', org_id: 3, office_slug: 'conteudo', status: 'running' })
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(api.get).toHaveBeenCalledTimes(1)
  await act(async () => {
    listener({ t: 'job_status', org_id: 3, office_slug: 'conteudo', status: 'done' })
    listener({ t: 'job_status', org_id: 3, office_slug: 'conteudo', status: 'failed' })
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(api.get).toHaveBeenCalledTimes(2)
  act(() => listener({ t: 'job_status', org_id: 3, office_slug: 'conteudo', status: 'done' }))
  view.unmount()
  await vi.advanceTimersByTimeAsync(500)
  expect(api.get).toHaveBeenCalledTimes(2)
})

it('mostra custo e materiais e aprova uma única vez na conversa atual', async () => {
  let terminar!: (value: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { terminar = r }))
  montar()
  const gerar = await screen.findByRole('button', { name: 'Pode gerar' })
  expect(screen.getByText(/Geração pendente:/)).toHaveTextContent(/1,25/)
  fireEvent.click(screen.getByText(/Ver o que será criado/))
  expect(screen.getByText('marca.png')).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(gerar); fireEvent.click(gerar)
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(api.post).toHaveBeenCalledWith(`${base}/pecas/apresentacao/gerar`, { conversa_id: 17 })
  vi.mocked(api.get).mockResolvedValue({ ...plano, job_ativo: { id: 41, status: 'queued' } })
  await act(async () => { terminar({ ok: true, job: { id: 41 } }) })
  expect(await screen.findByText(/Geração em andamento/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Pode gerar' })).not.toBeInTheDocument()
})

it('pendência bloqueia geração e deixa pedir ajuste na mesma conversa', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...plano, pode_gerar: false, falta: [{ item: 'Logo da empresa', porque: 'identificar a marca', trava: true, resolvido: false }] })
  const perguntar = vi.fn(); montar(perguntar)
  expect(await screen.findByRole('button', { name: 'Pode gerar' })).toBeDisabled()
  expect(screen.getByText(/Logo da empresa/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste no plano' }))
  expect(perguntar).toHaveBeenCalledWith('Quero mudar o plano da peça "apresentacao": ')
  expect(api.post).not.toHaveBeenCalled()
})

it('sem plano só prepara o pedido e motor desconectado não gera', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...plano, tem_plano: false, pode_gerar: false })
  const perguntar = vi.fn(); const view = montar(perguntar)
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar o plano' }))
  expect(perguntar.mock.calls[0][0]).toContain('antes de gerar')
  expect(screen.queryByRole('button', { name: 'Pode gerar' })).not.toBeInTheDocument()
  view.unmount()
  vi.mocked(api.get).mockResolvedValue(plano)
  montar(vi.fn(), async () => false)
  fireEvent.click(await screen.findByRole('button', { name: 'Pode gerar' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pode gerar' })).toBeEnabled())
  expect(api.post).not.toHaveBeenCalled()
})

it('erro no servidor exige atualizar o plano e não repete a geração', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(409, 'O plano mudou. Confira novamente.'))
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Pode gerar' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('O plano mudou.')
  expect(screen.queryByRole('button', { name: 'Pode gerar' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
  expect(await screen.findByRole('button', { name: 'Pode gerar' })).toBeEnabled()
})

it('Estúdio embutido usa o chat principal e descarta documento atrasado de outra peça', async () => {
  let devolverAntiga!: (value: unknown) => void
  const perguntar = vi.fn()
  localStorage.setItem('offiz:estudio-conversa:3:conteudo', '98')
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === `${base}/pecas`) return { pecas: [] }
    if (path.endsWith('/entregas')) return []
    if (path === `${base}/pecas/antiga`) return new Promise(r => { devolverAntiga = r })
    if (path === `${base}/pecas/atual`) return { peca: { slug: 'atual', titulo: 'Apresentação atual', cenas: [] } }
    if (path.endsWith('/mesa')) return plano
    throw new Error(`Consulta inesperada: ${path}`)
  })
  const props = { orgId: 3, slug: 'conteudo', aoPerguntar: perguntar, conversaAtual: 17 }
  const view = render(<EstudioTab {...props} pecaInicial={{ slug: 'antiga', n: 1 }} />)
  await waitFor(() => expect(devolverAntiga).toBeDefined())
  view.rerender(<EstudioTab {...props} pecaInicial={{ slug: 'atual', n: 2 }} />)
  expect(await screen.findByText('Apresentação atual')).toBeVisible()
  await act(async () => { devolverAntiga({ peca: { slug: 'antiga', titulo: 'Documento antigo', cenas: [] } }) })
  expect(screen.queryByText('Documento antigo')).not.toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Conversa do Estúdio' })).not.toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalledWith('/conversas/98')
  fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste no plano' }))
  expect(perguntar).toHaveBeenCalledWith('Quero mudar o plano da peça "atual": ')
})
