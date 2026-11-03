import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { PlacaExecucao } from './PlacaExecucao'
import { api } from '../lib/api'
import { wsClient } from '../lib/ws'
import type { Job, WsMessage } from '../lib/types'

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../lib/ws', () => ({ wsClient: { on: vi.fn() } }))
const idiomaTeste = vi.hoisted(() => ({ valor: 'pt-BR' }))
vi.mock('../lib/i18n', () => ({ useIdioma: () => ({ idioma: idiomaTeste.valor, t: (pt: string, en: string) => idiomaTeste.valor === 'en' ? en : pt }) }))
vi.mock('../components/predio/JobStream', () => ({ JobStream: ({ aoVerEntregas }: { aoVerEntregas: () => void }) => <div>Atividade<button onClick={aoVerEntregas}>Ver entregas da atividade</button></div> }))
const tarefa = (id: number, titulo: string, status: Job['status'] = 'running'): Job => ({ id, titulo, status, prompt: 'Pedido', effort: 'high', criado_em: new Date().toISOString() })
let jobs: Job[]
let ouvintes: Map<string, Array<(msg: WsMessage) => void>>
const tela = (orgId = 1) => <PlacaExecucao orgId={orgId} slug="conteudo" pendentes={0} aoAbrirEntregas={vi.fn()} />
async function atualizar() {
  await act(async () => { for (const fn of [...(ouvintes.get('job_status') || [])]) fn({ t: 'job_status', org_id: 1, office_slug: 'conteudo', job_id: 11, status: 'done' }) })
}
const dialogo = () => screen.getByRole('dialog', { name: 'Confirmar parada do trabalho' })
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear()
  idiomaTeste.valor = 'pt-BR'
  jobs = [tarefa(11, 'Campanha Aurora'), tarefa(12, 'Vídeo da outra campanha', 'queued')]
  ouvintes = new Map()
  vi.mocked(wsClient.on).mockImplementation((tipo, fn) => { ouvintes.set(tipo, [...(ouvintes.get(tipo) || []), fn]); return () => ouvintes.set(tipo, (ouvintes.get(tipo) || []).filter(f => f !== fn)) })
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/atividade') ? { jobs } : { events: [] })
  vi.mocked(api.post).mockImplementation(async path => {
    jobs = jobs.map(j => path === `/jobs/${j.id}/cancelar` ? { ...j, status: 'cancelled' } : j)
    return { status: 'cancelled' }
  })
})

it('atividade terminal em consolidação continua acompanhada mesmo com contador de execução zerado', async () => {
  jobs = [{ ...tarefa(11, 'Campanha Aurora', 'done'), finalizando: true }]
  render(<PlacaExecucao orgId={1} slug="conteudo" pendentes={0} emAndamento={0} aoAbrirEntregas={vi.fn()} />)
  expect(await screen.findByText('Organizando arquivos')).toBeInTheDocument()
  expect(screen.getByText('Organizando os arquivos da entrega…')).toBeInTheDocument()
  expect(screen.queryByText(/Pronto — o resultado está em Entregas/)).not.toBeInTheDocument()
  expect(screen.queryByText('100%')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'parar' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ver atividade' }))
  jobs = [{ ...jobs[0], finalizando: false }]
  await atualizar()
  expect(await screen.findByText('Pronto — o resultado está em Entregas.')).toBeInTheDocument()
  expect(screen.queryByText('Organizando arquivos')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('abrir entrega pela atividade identifica o trabalho atual mesmo depois de avançar a fila', async () => {
  const abrirEntregas = vi.fn()
  render(<PlacaExecucao orgId={1} slug="conteudo" pendentes={0} aoAbrirEntregas={abrirEntregas} contextoAtividade={{ empresa: 'Aurora', area: 'Produção de conteúdo' }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir pedido: Campanha Aurora' }))
  expect(abrirEntregas).toHaveBeenLastCalledWith(11)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver atividade' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Ver entregas da atividade' }))
  expect(abrirEntregas).toHaveBeenLastCalledWith(11)
  jobs = [tarefa(11, 'Campanha Aurora', 'done'), tarefa(12, 'Vídeo da outra campanha')]
  await atualizar()
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir pedido: Vídeo da outra campanha' }))
  expect(abrirEntregas).toHaveBeenLastCalledWith(12)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver entregas da atividade' }))
  expect(abrirEntregas).toHaveBeenLastCalledWith(12)
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['running', 'queued'] as const)('ocultar acompanhamento não para o pedido %s e permite voltar a acompanhá-lo', async status => {
  jobs = [tarefa(11, 'Campanha Aurora', status)]
  render(tela())
  const ocultar = await screen.findByRole('button', { name: 'Ocultar acompanhamento' })
  expect(ocultar).toHaveAttribute('title', 'Ocultar o acompanhamento não interrompe o pedido.')
  fireEvent.click(ocultar)
  expect(screen.queryByText('Campanha Aurora')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  await atualizar()
  expect(screen.queryByText('Campanha Aurora')).not.toBeInTheDocument()
  const reabrir = screen.getByRole('button', { name: /1 pedido em andamento/ })
  expect(reabrir).toHaveAttribute('title', 'Voltar a acompanhar os pedidos')
  fireEvent.click(reabrir)
  await screen.findByText('Campanha Aurora')
  expect(screen.getByRole('button', { name: 'Ocultar acompanhamento' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('ocultar execução e fila mantém a contagem dos dois pedidos sem alegar que os dois estão rodando', async () => {
  render(tela())
  fireEvent.click(await screen.findByRole('button', { name: 'Ocultar acompanhamento' }))
  await waitFor(() => expect(screen.getByText('Vídeo da outra campanha')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar acompanhamento' }))
  const reabrir = await screen.findByRole('button', { name: /2 pedidos em andamento/ })
  expect(reabrir).toHaveAttribute('title', 'Voltar a acompanhar os pedidos')
  expect(screen.queryByText(/tarefas rodando/)).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('localiza o escopo e as ações sem alterar o título ou o destino do pedido', async () => {
  idiomaTeste.valor = 'en'
  const abrirEntregas = vi.fn()
  render(<PlacaExecucao orgId={1} slug="conteudo" pendentes={0} aoAbrirEntregas={abrirEntregas} contextoAtividade={{ empresa: 'Aurora', area: 'Content production' }} />)
  expect(await screen.findByText('Organization requests')).toBeInTheDocument()
  expect(screen.getByText('Aurora · Content production')).toBeInTheDocument()
  expect(screen.getByText('This activity may include requests from other conversations.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Hide progress' })).toHaveAttribute('title', 'Hiding progress does not stop the request.')
  fireEvent.click(screen.getByRole('button', { name: 'Open request: Campanha Aurora' }))
  expect(abrirEntregas).toHaveBeenCalledExactlyOnceWith(11)
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['botao', 'Escape'])('a parada pode ser recusada por %s e devolve o foco sem usar confirm nativo', async metodo => {
  const confirmarNativo = vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('Host não oferece confirmação nativa') })
  render(tela())
  const abrir = await screen.findByRole('button', { name: 'parar' })
  fireEvent.click(abrir)
  expect(dialogo()).toHaveTextContent('Campanha Aurora · #11')
  expect(dialogo()).toHaveTextContent('Em produção')
  const manter = within(dialogo()).getByRole('button', { name: 'Manter trabalho' })
  expect(manter).toHaveFocus()
  if (metodo === 'Escape') fireEvent.keyDown(manter, { key: 'Escape' })
  else fireEvent.click(manter)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(abrir).toHaveFocus()
  expect(api.post).not.toHaveBeenCalled()
  expect(confirmarNativo).not.toHaveBeenCalled()
})

it('confirma o job escolhido na fila e ignora clique duplicado durante a requisição', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.post).mockReturnValue(new Promise(resolve => { resolver = resolve }))
  render(tela())
  fireEvent.click(await screen.findByRole('button', { name: 'Parar Vídeo da outra campanha' }))
  expect(dialogo()).toHaveTextContent('Vídeo da outra campanha · #12')
  expect(dialogo()).toHaveTextContent('Na fila')
  expect(dialogo()).toHaveTextContent('Se fizer parte de um plano, as próximas etapas que ainda não começaram também serão interrompidas.')
  const confirmar = within(dialogo()).getByRole('button', { name: 'Parar trabalho' })
  fireEvent.click(confirmar); fireEvent.click(confirmar)
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/12/cancelar', {})
  expect(within(dialogo()).getByRole('button', { name: 'Manter trabalho' })).toBeDisabled()
  await act(async () => { jobs = jobs.map(j => j.id === 12 ? { ...j, status: 'cancelled' } : j); resolver({ status: 'cancelled' }) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText('Campanha Aurora')).toBeInTheDocument()
})

it('job que termina antes da confirmação fica identificado e não cancela o próximo', async () => {
  render(tela())
  fireEvent.click(await screen.findByRole('button', { name: 'parar' }))
  jobs = [tarefa(11, 'Campanha Aurora', 'done'), tarefa(12, 'Vídeo da outra campanha')]
  await atualizar()
  expect(dialogo()).toHaveTextContent('Campanha Aurora · #11')
  expect(dialogo()).toHaveTextContent('Este trabalho já foi concluído.')
  expect(within(dialogo()).getByRole('button', { name: 'Parar trabalho' })).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
})

it('erro tardio continua visível quando o job já terminou e a fila ficou vazia', async () => {
  let rejeitar!: (motivo: Error) => void
  vi.mocked(api.post).mockReturnValue(new Promise((_resolve, reject) => { rejeitar = reject }))
  render(tela())
  fireEvent.click(await screen.findByRole('button', { name: 'parar' }))
  fireEvent.click(within(dialogo()).getByRole('button', { name: 'Parar trabalho' }))
  jobs = [tarefa(11, 'Campanha Aurora', 'done')]
  await atualizar()
  await act(async () => { rejeitar(new Error('Conexão perdida')) })
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível parar “Campanha Aurora”')
  expect(dialogo()).toHaveTextContent('Este trabalho já foi concluído.')
  fireEvent.click(within(dialogo()).getByRole('button', { name: 'Manter trabalho' }))
  expect(screen.getByRole('alert')).toBeInTheDocument()
})

it('sucesso tardio do job anterior preserva o trabalho que assumiu a placa', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.post).mockReturnValue(new Promise(resolve => { resolver = resolve }))
  render(tela())
  fireEvent.click(await screen.findByRole('button', { name: 'parar' }))
  fireEvent.click(within(dialogo()).getByRole('button', { name: 'Parar trabalho' }))
  jobs = [tarefa(11, 'Campanha Aurora', 'done'), tarefa(12, 'Vídeo da outra campanha')]
  await atualizar()
  await act(async () => { resolver({ status: 'cancelled' }) })
  expect(screen.getByText('Vídeo da outra campanha')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'parar' })).toBeEnabled()
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/11/cancelar', {})
})

it.each(['sucesso', 'falha'])('trocar de organização isola a confirmação e a resposta tardia de %s', async tipo => {
  let resolver!: (valor: unknown) => void
  let rejeitar!: (motivo: Error) => void
  vi.mocked(api.post).mockReturnValue(new Promise((resolve, reject) => { resolver = resolve; rejeitar = reject }))
  const primeira = render(tela())
  fireEvent.click(await screen.findByRole('button', { name: 'parar' }))
  fireEvent.click(within(dialogo()).getByRole('button', { name: 'Parar trabalho' }))
  jobs = [tarefa(21, 'Trabalho da empresa dois')]
  primeira.rerender(tela(2))
  await screen.findByText('Trabalho da empresa dois')
  await act(async () => { if (tipo === 'sucesso') resolver({ status: 'cancelled' }); else rejeitar(new Error('Falha da empresa anterior')) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByText('Trabalho da empresa dois')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'parar' })).toBeEnabled()
})

it('atividade iniciada antes da parada não ressuscita o job ao responder depois do sucesso', async () => {
  render(tela())
  await screen.findByRole('button', { name: 'parar' })
  const jobsAntigos = [...jobs]
  let devolverAntiga!: (valor: unknown) => void
  const respostaAntiga = new Promise(resolve => { devolverAntiga = resolve })
  let atrasar = true
  vi.mocked(api.get).mockImplementation(async path => {
    if (!path.endsWith('/atividade')) return { events: [] }
    if (atrasar) { atrasar = false; return respostaAntiga }
    return { jobs }
  })
  await atualizar()
  fireEvent.click(screen.getByRole('button', { name: 'parar' }))
  fireEvent.click(within(dialogo()).getByRole('button', { name: 'Parar trabalho' }))
  await waitFor(() => expect(screen.queryByText('Campanha Aurora')).not.toBeInTheDocument())
  await act(async () => { devolverAntiga({ jobs: jobsAntigos }) })
  expect(screen.queryByText('Campanha Aurora')).not.toBeInTheDocument()
  expect(screen.getByText('Vídeo da outra campanha')).toBeInTheDocument()
  expect(screen.queryByText(/Todos os trabalhos em andamento/)).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/11/cancelar', {})
})


it('a conversa acompanha somente seus jobs, mesmo se o transporte devolver outra conversa', async () => {
  jobs = [{ ...tarefa(11, 'Pedido desta conversa'), conversa_id: 121 },
    { ...tarefa(12, 'Pedido alheio'), conversa_id: 999 },
    { ...tarefa(13, 'Falha alheia', 'failed'), conversa_id: 999, finalizado_em: new Date().toISOString() }]
  vi.mocked(api.get).mockImplementation(async path => path.includes('/atividade') ? { jobs } : { events: [] })
  render(<PlacaExecucao orgId={1} slug="conteudo" conversaId={121} pendentes={0} aoAbrirEntregas={vi.fn()} contextoAtividade={{ empresa: 'Aurora', area: 'Conteúdo' }} />)
  expect(await screen.findByText('Pedido desta conversa')).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledWith('/predios/1/conteudo/atividade?conversa_id=121')
  expect(screen.queryByText('Pedido alheio')).not.toBeInTheDocument()
  expect(screen.queryByText('Falha alheia')).not.toBeInTheDocument()
  expect(screen.getByText('Pedidos desta conversa')).toBeInTheDocument()
  expect(screen.queryByText('Este acompanhamento pode incluir pedidos de outras conversas.')).not.toBeInTheDocument()
})

it('conversa nova não consulta nem herda contadores globais da área', async () => {
  const { container } = render(<PlacaExecucao orgId={1} slug="conteudo" conversaId={null} emAndamento={5} pendentes={3} aoAbrirEntregas={vi.fn()} />)
  await act(async () => {})
  expect(container).toBeEmptyDOMElement()
  expect(api.get).not.toHaveBeenCalled()
})

it('trocar a conversa descarta poll e eventos atrasados do escopo anterior', async () => {
  let devolverAntiga!: (valor: unknown) => void
  const antiga = new Promise(resolve => { devolverAntiga = resolve })
  const atual = { ...tarefa(22, 'Pedido atual'), conversa_id: 122 }
  vi.mocked(api.get).mockImplementation(async path => path.includes('conversa_id=121') ? antiga
    : path.includes('/atividade') ? { jobs: [atual] } : { events: [] })
  const view = render(<PlacaExecucao orgId={1} slug="conteudo" conversaId={121} pendentes={0} aoAbrirEntregas={vi.fn()} />)
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/predios/1/conteudo/atividade?conversa_id=121'))
  view.rerender(<PlacaExecucao orgId={1} slug="conteudo" conversaId={122} pendentes={0} aoAbrirEntregas={vi.fn()} />)
  await screen.findByText('Pedido atual')
  await act(async () => {
    devolverAntiga({ jobs: [{ ...tarefa(11, 'Pedido antigo'), conversa_id: 121 }] })
    for (const fn of [...(ouvintes.get('job_event') || [])]) fn({ t: 'job_event', org_id: 1, office_slug: 'conteudo', job_id: 11, tipo: 'agent_text', payload: { texto: 'Texto do pedido antigo' }, seq: 1 })
  })
  expect(screen.getByText('Pedido atual')).toBeInTheDocument()
  expect(screen.queryByText('Pedido antigo')).not.toBeInTheDocument()
  expect(screen.queryByText('Texto do pedido antigo')).not.toBeInTheDocument()
  view.rerender(<PlacaExecucao orgId={1} slug="conteudo" conversaId={null} pendentes={0} aoAbrirEntregas={vi.fn()} />)
  expect(screen.queryByText('Pedido atual')).not.toBeInTheDocument()
})
