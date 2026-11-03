import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversaTab } from './ConversaTab'
import { api } from '../../lib/api'
import type { ConversaDetalhe, ConversaMensagem, RespostaMensagem } from '../../lib/types'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))
const avisos = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }))
vi.mock('../Toasts', () => ({ useToasts: () => avisos }))
vi.mock('./PainelTrabalho', () => ({ PainelTrabalho: ({ jobId, aoFechar }: { jobId: number; aoFechar: () => void }) => <aside aria-label="Painel do trabalho">Trabalho #{jobId}<button onClick={aoFechar}>Voltar à conversa</button></aside> }))

const office = { slug: 'predio', nome: 'Clube Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const criadaEm = '2026-10-07T22:00:00Z'
const proposta: ConversaMensagem = { id: 99, role: 'assistant', conteudo: 'Vou produzir o post da camisa.', criado_em: criadaEm,
  sugestao_tarefa: { titulo: 'Post da camisa', prompt: 'Produzir o post com a camisa oficial.', andar: 'conteudo' } }
const inicio: RespostaMensagem = { mensagem: proposta, tarefas_iniciadas: [99], trabalho_iniciado: { id: 77, titulo: 'Post da camisa', status: 'queued', org_id: 1, office_slug: 'conteudo' } }
let conversas: Record<number, ConversaDetalhe>
const montar = (area = false) => render(<MemoryRouter initialEntries={['/app?org=1&conversa=42']}><ConversaTab orgId={1} slug={area ? 'conteudo' : 'predio'} office={{ ...office, slug: area ? 'conteudo' : 'predio' }} nivelPredio={!area} /></MemoryRouter>)
const campo = () => screen.getByRole('textbox', { name: 'Seu pedido' })
const enviar = async () => {
  await screen.findByRole('heading', { name: 'Campanha da camisa' })
  fireEvent.change(await screen.findByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Faz um post da nossa camisa para o Instagram.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  conversas = {
    42: { id: 42, organization_id: 1, office_slug: null, titulo: 'Campanha da camisa', atualizado_em: criadaEm, total_mensagens: 0, mensagens: [] },
    43: { id: 43, organization_id: 1, office_slug: null, titulo: 'Outro pedido', atualizado_em: criadaEm, total_mensagens: 0, mensagens: [] },
  }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/conversas') ? { conversas: Object.values(conversas) } : /^\/conversas\/\d+$/.test(path) ? conversas[Number(path.split('/').pop())] : {})
  vi.mocked(api.post).mockResolvedValue(inicio)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('pedido autorizado mostra o mesmo trabalho e dispensa nova confirmação sem criar job no cliente', async () => {
  montar(); await enviar()
  expect(await screen.findByText('Na fila')).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Painel do trabalho' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ver aqui do lado' }))
  expect(screen.getByRole('complementary', { name: 'Painel do trabalho' })).toHaveTextContent('Trabalho #77')
  expect(screen.getByText(/Pedido criado/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Sim, iniciar tarefa' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/conversas/42/mensagens', { conteudo: 'Faz um post da nossa camisa para o Instagram.' })
  expect(api.put).not.toHaveBeenCalled()
})

it('uma ideia ainda oferece a proposta sem iniciar produção por conta própria', async () => {
  vi.mocked(api.post).mockResolvedValue({ mensagem: proposta })
  montar(); await enviar()
  expect(await screen.findByRole('button', { name: 'Sim, iniciar tarefa' })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Painel do trabalho' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('fechar a prévia durante produção é respeitado quando a entrega chega pelo refresh', async () => {
  montar(); await enviar()
  await screen.findByText('Na fila')
  fireEvent.click(screen.getByRole('button', { name: 'Ver aqui do lado' }))
  fireEvent.change(campo(), { target: { value: 'Meu ajuste ainda não enviado.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }))
  conversas[42] = { ...conversas[42], mensagens: [proposta], trabalho_job_id: 77,
    trabalhos: [{ id: 77, titulo: 'Post da camisa', status: 'done', entregas: [{ id: 88, nome: 'arte.png', tipo: 'imagem', status: 'pendente' }] }] }
  await act(async () => window.dispatchEvent(new Event('focus')))
  await screen.findByRole('button', { name: 'Ver entrega' })
  expect(screen.queryByRole('complementary', { name: 'Painel do trabalho' })).not.toBeInTheDocument()
  expect(campo()).toHaveValue('Meu ajuste ainda não enviado.')
  expect(api.post).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Ver entrega' }))
  expect(screen.getByRole('complementary', { name: 'Painel do trabalho' })).toHaveTextContent('#77')
})

it('reabrir usa o vínculo e as mensagens iniciadas do servidor sem ressuscitar confirmação', async () => {
  conversas[42] = { ...conversas[42], mensagens: [proposta], tarefas_iniciadas: [99], trabalho_job_id: 77,
    trabalhos: [{ id: 77, titulo: 'Post da camisa', status: 'running', entregas: [] }] }
  montar()
  expect(await screen.findByText('trabalho rodando')).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Painel do trabalho' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Sim, iniciar tarefa' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('resposta idempotente preserva os arquivos de um trabalho já visível na conversa', async () => {
  conversas[42].trabalhos = [{ id: 77, titulo: 'Post da camisa', status: 'done', criado_em: criadaEm,
    entregas: [{ id: 88, nome: 'post-da-camisa.png', tipo: 'imagem', status: 'pendente' }] }]
  vi.mocked(api.post).mockResolvedValue({ ...inicio, trabalho_iniciado: { ...inicio.trabalho_iniciado!, status: 'done' } })
  montar(); await enviar()
  await screen.findByText(/Pedido criado/)
  expect(screen.getByText('post-da-camisa.png')).toBeInTheDocument()
  expect(screen.getAllByText('Post da camisa')).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Ver entrega' })).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('trabalho interrompido não recebe o status visual de produção', async () => {
  conversas[42].trabalhos = [{ id: 77, titulo: 'Post da camisa', status: 'cancelled', entregas: [] }]
  montar()
  expect(await screen.findByText('Interrompido')).toHaveClass('status-cancelled')
  expect(screen.queryByText('trabalho rodando')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('polling de resposta pendente reconhece a produção que começou depois de sair da conversa', async () => {
  conversas[42].mensagens = [{ id: 98, role: 'user', conteudo: 'Faz um post da camisa.', criado_em: criadaEm }]
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.useFakeTimers()
  montar(); await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  conversas[42] = { ...conversas[42], mensagens: [...conversas[42].mensagens, proposta], tarefas_iniciadas: [99], trabalho_job_id: 77,
    trabalhos: [{ id: 77, titulo: 'Post da camisa', status: 'queued', entregas: [] }] }
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.queryByRole('complementary', { name: 'Painel do trabalho' })).not.toBeInTheDocument()
  expect(screen.getByText('Na fila')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Sim, iniciar tarefa' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('resposta atrasada de produção não troca o painel nem o rascunho de outro assunto', async () => {
  let concluir!: (valor: RespostaMensagem) => void
  vi.mocked(api.post).mockReturnValue(new Promise(resolve => { concluir = resolve }))
  montar(); await enviar()
  fireEvent.click(screen.getByRole('button', { name: /^Outro pedido/ }))
  await screen.findByRole('heading', { name: 'Outro pedido' })
  // O título identifica a seleção antes de a consulta confirmar os insumos.
  // Só escreve quando o composer da conversa nova estiver disponível.
  fireEvent.change(await screen.findByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Rascunho de outra campanha' } })
  await act(async () => concluir(inicio))
  expect(campo()).toHaveValue('Rascunho de outra campanha')
  expect(screen.queryByRole('complementary', { name: 'Painel do trabalho' })).not.toBeInTheDocument()
  expect(screen.queryByText('Vou produzir o post da camisa.')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each(['empresa', 'area', 'id'])('não abre um trabalho cuja resposta contradiz %s da conversa', async tipo => {
  const job = { ...inicio.trabalho_iniciado!, ...(tipo === 'empresa' ? { org_id: 2 } : tipo === 'area' ? { office_slug: 'financeiro' } : { id: -1 }) }
  if (tipo === 'area') Object.values(conversas).forEach(c => { c.office_slug = 'conteudo' })
  vi.mocked(api.post).mockResolvedValue({ ...inicio, trabalho_iniciado: job })
  montar(tipo === 'area'); await enviar()
  await screen.findByText('Vou produzir o post da camisa.')
  expect(screen.queryByRole('complementary', { name: 'Painel do trabalho' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each([true, false])('impedimento de saldo aparece uma única vez quando a orientação já está na resposta: %s', async incluido => {
  const orientacao = 'O saldo disponível não cobre este trabalho.'
  vi.mocked(api.post).mockResolvedValue({ mensagem: { ...proposta, conteudo: incluido ? orientacao : 'Não consegui iniciar agora.' }, inicio_impedido: orientacao })
  montar(); await enviar()
  await waitFor(() => expect(screen.getAllByText(orientacao)).toHaveLength(1))
  expect(screen.queryByRole('complementary', { name: 'Painel do trabalho' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each([false, true])('[estado confirmado] criação de pedido/plano (%s) não promete que a execução começou', async plano => {
  const sugestao = plano ? { ...proposta.sugestao_tarefa!, etapas: [
    { titulo: 'Primeiro', andar: 'conteudo', prompt: 'Primeiro pedido sintético' },
    { titulo: 'Segundo', andar: 'conteudo', prompt: 'Segundo pedido sintético' },
  ] } : proposta.sugestao_tarefa
  conversas[42] = { ...conversas[42], mensagens: [{ ...proposta, sugestao_tarefa: sugestao }] }
  vi.mocked(api.post).mockResolvedValue(plano ? { etapas: [{ job_id: 77, status: 'queued' }, { job_id: 78, status: 'queued' }] } : inicio.trabalho_iniciado)
  vi.mocked(api.put).mockResolvedValue({ ok: true })
  montar()
  fireEvent.click(await screen.findByRole('button', { name: plano ? 'Sim, iniciar o plano' : 'Sim, iniciar tarefa' }))
  await waitFor(() => expect(avisos.sucesso).toHaveBeenCalledWith(plano
    ? 'O plano “Post da camisa” foi criado — as 2 etapas entram na fila em sequência. Acompanhe o andamento e as entregas disponíveis.'
    : 'Pedido “Post da camisa” criado — acompanhe o andamento e as entregas disponíveis.'))
  expect(api.post).toHaveBeenCalledOnce()
})
