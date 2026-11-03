import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, setTokens } from '../../lib/api'
import type { ConversaDetalhe, Job, WsMessage } from '../../lib/types'
import { wsClient } from '../../lib/ws'
import { PlacaExecucao } from '../../predio/PlacaExecucao'
import { ConversaTab } from './ConversaTab'

vi.mock('../../lib/api', async original => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() },
}))
vi.mock('../../lib/ws', () => ({ wsClient: { on: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
vi.mock('./PainelTrabalho', () => ({ PainelTrabalho: ({ jobId }: { jobId: number }) => <aside>Entrega #{jobId}</aside> }))
vi.mock('./JobStream', () => ({ JobStream: () => <div>Atividade</div> }))

const office = { slug: 'conteudo', nome: 'Conteúdo', descricao: '', tema: { cor_primaria: '#000', cor_acento: '#fff', cor_fundo: '#fff', icone: 'conversa' } }
const tarefa = (id: number, status: Job['status']): Job => ({ id, status, titulo: 'Post da camisa', prompt: 'Crie o post.', effort: 'high', criado_em: new Date().toISOString(), finalizado_em: status === 'failed' ? new Date().toISOString() : null, conversa_id: 42, organization_id: 1, office_slug: 'conteudo' })
let conversas: Record<number, ConversaDetalhe>
let jobs: Job[]
let ouvintes: Map<string, Set<(msg: WsMessage) => void>>
const tela = (orgId = 1) => <MemoryRouter><ConversaTab orgId={orgId} slug="conteudo" office={office}
  atividadeConteudo={<PlacaExecucao orgId={orgId} slug="conteudo" pendentes={0} aoAbrirEntregas={vi.fn()} />} /></MemoryRouter>
const abrir = async (titulo = 'Camisa alvinegra') => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${titulo}`) }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled())
}
const emitir = async (overrides: Partial<WsMessage> = {}) => {
  await act(async () => {
    for (const fn of [...(ouvintes.get('job_status') || [])]) fn({ t: 'job_status', org_id: 1, office_slug: 'conteudo', job_id: 311, status: 'done', ...overrides } as WsMessage)
  })
}
function concluir() {
  jobs = jobs.map(j => j.id === 311 ? { ...j, status: 'done' } : j)
  conversas[42] = { ...conversas[42], mensagens: [{ id: 441, role: 'assistant', conteudo: 'Seu post está pronto para revisar.', criado_em: new Date().toISOString() }],
    trabalhos: [...(conversas[42].trabalhos || []).filter(j => j.id !== 311), { id: 311, titulo: 'Post retomado', status: 'done', entregas: [{ id: 858, nome: 'arte.png', tipo: 'imagem', status: 'pendente' }] }] }
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear()
  ouvintes = new Map()
  vi.mocked(wsClient.on).mockImplementation((tipo, fn) => {
    if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set())
    ouvintes.get(tipo)!.add(fn)
    return () => { ouvintes.get(tipo)!.delete(fn) }
  })
  jobs = [tarefa(308, 'failed')]
  conversas = {
    42: { id: 42, titulo: 'Camisa alvinegra', atualizado_em: new Date().toISOString(), total_mensagens: 0, mensagens: [], trabalho_job_id: 308, trabalhos: [{ id: 308, titulo: 'Post interrompido', status: 'failed', entregas: [] }] },
    43: { id: 43, titulo: 'Outra conversa', atualizado_em: new Date().toISOString(), total_mensagens: 0, mensagens: [], trabalhos: [] },
  }
  vi.mocked(api.get).mockImplementation(async path => {
    if (path.endsWith('/atividade')) return { jobs }
    if (path.endsWith('/events')) return { events: [] }
    if (/^\/conversas\/\d+$/.test(path)) return conversas[Number(path.split('/').pop())]
    if (path.endsWith('/conversas')) return { conversas: Object.values(conversas) }
    return {}
  })
  vi.mocked(api.post).mockImplementation(async path => {
    if (path === '/jobs/308/continuar') {
      const novo = tarefa(311, 'queued')
      jobs.push(novo)
      conversas[42] = { ...conversas[42], trabalhos: [...conversas[42].trabalhos!, { id: 311, titulo: novo.titulo, status: 'queued', entregas: [] }] }
      return novo
    }
    if (path.endsWith('/mensagens')) return { mensagem: { id: 450, role: 'assistant', conteudo: 'Versão confirmada.', criado_em: new Date().toISOString() } }
    return {}
  })
  vi.mocked(api.put).mockImplementation(async (path, body) => {
    if (path === '/conversas/42/trabalho') conversas[42] = { ...conversas[42], trabalho_job_id: (body as { job_id: number }).job_id }
    return {}
  })
})

it('retoma pela placa e mostra conclusão e painel novos sem recarregar a página', async () => {
  render(tela()); await abrir()
  expect(screen.queryByText('Entrega #308')).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'continuar de onde parou' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', { job_id: 311 }))
  expect(screen.queryByText('Entrega #311')).not.toBeInTheDocument()
  concluir(); await emitir()
  await screen.findByText('Seu post está pronto para revisar.')
  expect(screen.getByText('Pronto para revisar')).toBeInTheDocument()
  expect(screen.getByText('Entrega #311')).toBeInTheDocument()
  expect(screen.getByText('Post interrompido')).toBeInTheDocument()
})

it.each(['socket', 'foco'])('atualiza o resumo lateral ao concluir via %s sem apagar o rascunho', async origem => {
  conversas[42] = { ...conversas[42], sinal: 'trabalhando', resumo: 'Trabalhando agora' }
  render(tela()); await abrir()
  expect(screen.getByText('Trabalhando agora')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Meu próximo ajuste.' } })
  concluir()
  conversas[42] = { ...conversas[42], sinal: 'entregue', resumo: 'Entrega disponível' }
  if (origem === 'socket') await emitir()
  else await act(async () => window.dispatchEvent(new Event('focus')))
  await screen.findByText('Entrega disponível')
  expect(screen.queryByText('Trabalhando agora')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Meu próximo ajuste.')
  expect(api.post).not.toHaveBeenCalled()
})

it('atualiza o desfecho sem substituir uma versão antiga escolhida pelo usuário', async () => {
  conversas[42].trabalhos!.unshift({ id: 300, titulo: 'Versão anterior', status: 'done', entregas: [{ id: 850, nome: 'anterior.png', tipo: 'imagem', status: 'aprovada' }] })
  render(tela()); await abrir()
  fireEvent.click(screen.getByRole('button', { name: 'Ver entrega' }))
  expect(screen.getByText('Entrega #300')).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'continuar de onde parou' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', { job_id: 311 }))
  concluir(); await emitir()
  await screen.findByText('Seu post está pronto para revisar.')
  expect(screen.getByText('Entrega #300')).toBeInTheDocument()
  expect(screen.queryByText('Entrega #311')).not.toBeInTheDocument()
})

it.each(['conversa', 'empresa', 'desmontar'])('descarta e aborta refresh atrasado ao mudar %s', async mudanca => {
  const view = render(tela()); await abrir()
  const get = vi.mocked(api.get).getMockImplementation()!
  let resolver!: (valor: unknown) => void
  let signal: AbortSignal | undefined
  vi.mocked(api.get).mockImplementation((path, s) => path === '/conversas/42'
    ? new Promise(resolve => { signal = s; resolver = resolve }) : get(path, s))
  await emitir()
  await waitFor(() => expect(signal).toBeDefined())
  if (mudanca === 'conversa') await abrir('Outra conversa')
  else if (mudanca === 'empresa') view.rerender(tela(2))
  else view.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => resolver({ ...conversas[42], mensagens: [{ id: 999, role: 'assistant', conteudo: 'Mensagem da conversa antiga', criado_em: new Date().toISOString() }] }))
  expect(screen.queryByText('Mensagem da conversa antiga')).not.toBeInTheDocument()
})

it('ignora eventos de outro cliente e retomadas de outra conversa', async () => {
  render(tela()); await abrir()
  vi.mocked(api.get).mockClear()
  await emitir({ org_id: 2 })
  await emitir({ office_slug: 'juris' })
  await act(async () => window.dispatchEvent(new CustomEvent('offiz:trabalho-retomado', { detail: { orgId: 1, slug: 'conteudo', conversaId: 43, origemId: 308, jobId: 999 } })))
  expect(api.get).not.toHaveBeenCalled()
  expect(screen.queryByText('Entrega #308')).not.toBeInTheDocument()
  expect(screen.getByText('Post interrompido')).toBeInTheDocument()
})

it('citação explícita confirma o vínculo mesmo quando o painel já mostra a versão', async () => {
  conversas[42].trabalhos!.push({ id: 311, titulo: 'Post retomado', status: 'done', entregas: [{ id: 858, nome: 'arte.png', tipo: 'imagem', status: 'pendente' }] })
  render(tela()); await abrir()
  fireEvent.click(screen.getByRole('button', { name: 'Ver entrega' }))
  expect(screen.getByText('Entrega #311')).toBeInTheDocument()
  expect(conversas[42].trabalho_job_id).toBe(308)
  fireEvent.change(screen.getByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Na entrega #311, pode refinar a composição.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await screen.findByText('Versão confirmada.')
  expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', { job_id: 311 })
  expect(vi.mocked(api.put).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.post).mock.invocationCallOrder[0])
})

it.each([0, 403, 409, 503, 'rede'] as const)('citação não envia ao trabalho antigo se o vínculo falha com %s', async status => {
  render(tela()); await abrir()
  const texto = 'Sobre #311, a resposta é apenas para essa versão.'
  vi.mocked(api.put).mockRejectedValueOnce(status === 'rede' ? new Error('Rede indisponível') : new ApiError(status, 'Não foi possível confirmar o vínculo.'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Seu pedido' }), { target: { value: texto } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', { job_id: 311 }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled())
  expect(api.post).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue(texto)
  expect(conversas[42].trabalho_job_id).toBe(308)
  expect(screen.queryByText(texto, { selector: '.conversa-mensagem' })).not.toBeInTheDocument()
})

it('citação inexistente com 404 permanece texto comum da conversa', async () => {
  render(tela()); await abrir()
  const texto = 'O número #999999 estava no exemplo, não é uma entrega.'
  vi.mocked(api.put).mockRejectedValueOnce(new ApiError(404, 'Trabalho não encontrado'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Seu pedido' }), { target: { value: texto } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await screen.findByText('Versão confirmada.')
  expect(api.post).toHaveBeenCalledWith('/conversas/42/mensagens', { conteudo: texto })
  expect(conversas[42].trabalho_job_id).toBe(308)
})

it('desfecho durante o envio espera a resposta sem apagar a mensagem otimista', async () => {
  render(tela()); await abrir()
  let resolver!: (valor: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { resolver = resolve }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Estou conferindo a arte.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalled())
  vi.mocked(api.get).mockClear()
  concluir(); await emitir()
  expect(screen.getByText('Estou conferindo a arte.')).toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/conversas/42')).toBe(false)
  const resposta = { id: 450, role: 'assistant' as const, conteudo: 'Pode conferir.', criado_em: new Date().toISOString() }
  conversas[42].mensagens.push(resposta)
  await act(async () => resolver({ mensagem: resposta }))
  await screen.findByText('Seu post está pronto para revisar.')
  expect(screen.getByText('Pode conferir.')).toBeInTheDocument()
})

it.each(['durante', 'depois'] as const)('refresh iniciado antes do envio não substitui mensagens ao responder %s do POST', async ordem => {
  const historico: ConversaDetalhe['mensagens'] = [
    { id: 501, role: 'user', conteudo: 'Pedido anterior preservado.', criado_em: '2026-10-10T00:00:00Z' },
    { id: 502, role: 'assistant', conteudo: 'Resposta anterior preservada.', criado_em: '2026-10-10T00:00:01Z' },
  ]
  conversas[42] = { ...conversas[42], mensagens: historico }
  render(tela()); await abrir()
  const antiga = { ...conversas[42], mensagens: [...historico] }
  const get = vi.mocked(api.get).getMockImplementation()!
  let resolverGet!: (valor: unknown) => void
  let resolverPost!: (valor: unknown) => void
  let leituraIniciada = false
  vi.mocked(api.get).mockClear()
  vi.mocked(api.get).mockImplementation((path, signal) => {
    if (path === '/conversas/42' && !leituraIniciada) {
      leituraIniciada = true
      // O transporte pode entregar uma resposta já pronta mesmo após abort.
      return new Promise(resolve => { resolverGet = resolve })
    }
    return get(path, signal)
  })
  vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { resolverPost = resolve }))
  await emitir()
  await waitFor(() => expect(resolverGet).toBeDefined())
  const pedido = 'Nova conferência da foto inteira.'
  fireEvent.change(screen.getByRole('textbox', { name: 'Seu pedido' }), { target: { value: pedido } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  expect(screen.getByText(pedido)).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Meu próximo rascunho.' } })
  if (ordem === 'durante') {
    await act(async () => resolverGet(antiga))
    expect(screen.getByText(pedido)).toBeInTheDocument()
  }
  const resposta = { id: 504, role: 'assistant' as const, conteudo: 'Recebi a nova conferência.', criado_em: '2026-10-10T00:00:03Z' }
  conversas[42] = { ...conversas[42], mensagens: [...historico,
    { id: 503, role: 'user', conteudo: pedido, criado_em: '2026-10-10T00:00:02Z' },
    resposta,
    { id: 505, role: 'assistant', conteudo: 'A tarefa anterior terminou; seus arquivos estão preservados.', criado_em: '2026-10-10T00:00:04Z' },
  ] }
  await act(async () => resolverPost({ mensagem: resposta }))
  await screen.findByText(resposta.conteudo)
  if (ordem === 'depois') {
    await act(async () => resolverGet(antiga))
    expect(screen.getByText(resposta.conteudo)).toBeInTheDocument()
  }
  await screen.findByText('A tarefa anterior terminou; seus arquivos estão preservados.')
  expect(screen.getByText('Pedido anterior preservado.')).toBeInTheDocument()
  expect(screen.getByText('Resposta anterior preservada.')).toBeInTheDocument()
  expect(screen.getAllByText(pedido)).toHaveLength(1)
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Meu próximo rascunho.')
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(api.post).toHaveBeenCalledWith('/conversas/42/mensagens', { conteudo: pedido })
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/conversas/42')).toHaveLength(2)
})

it('retomada respondida depois de mudar login não vincula nem emite evento na nova sessão', async () => {
  setTokens('primeiro', 'primeiro-refresh')
  render(tela()); await abrir()
  let resolver!: (valor: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { resolver = resolve }))
  fireEvent.click(await screen.findByRole('button', { name: 'continuar de onde parou' }))
  setTokens('segundo', 'segundo-refresh')
  await act(async () => resolver(tarefa(311, 'queued')))
  expect(api.put).not.toHaveBeenCalled()
  expect(screen.queryByText('Entrega #308')).not.toBeInTheDocument()
  expect(screen.getByText('Post interrompido')).toBeInTheDocument()
})
