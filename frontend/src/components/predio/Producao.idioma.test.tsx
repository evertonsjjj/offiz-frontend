import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { IdiomaProvider } from '../../lib/i18n'
import { SeletorIdioma } from '../SeletorIdioma'
import { api } from '../../lib/api'
import { MesaTab } from './MesaTab'
import EstudioTab from './EstudioTab'
import { JobStream } from './JobStream'
import type { Job, JobEvent, WsMessage } from '../../lib/types'
import { PlacaExecucao } from '../../predio/PlacaExecucao'
import { wsClient } from '../../lib/ws'

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('../../lib/api', async (original) => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))
vi.mock('../../lib/ws', () => ({ wsClient: { on: vi.fn(), subscribe: () => () => {}, connect: vi.fn(), close: vi.fn() } }))
vi.mock('../../lib/useBrasao', () => ({ useBrasao: () => null }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn() }) }))

beforeEach(() => {
  vi.resetAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(wsClient.on).mockImplementation(() => () => {})
  localStorage.clear()
  localStorage.setItem('offiz:idioma:visitante', 'en')
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path.endsWith('/pecas')) return { pecas: [] }
    if (path.endsWith('/conversas')) return { conversas: [] }
    if (path.endsWith('/partida')) return { tem_motor: true, tem_chave: true, motor_local: false, sabatina_pendente: false }
    if (path.endsWith('/arquivos')) return { entrada: [], produto: [], marca: [], exemplos: [], aprovados: [] }
    return []
  })
})
function montar(children: ReactNode) {
  return render(<MemoryRouter><IdiomaProvider><SeletorIdioma />{children}</IdiomaProvider></MemoryRouter>)
}
function mudarParaPt() {
  fireEvent.change(screen.getByRole('combobox', { name: 'Interface language' }), { target: { value: 'pt-BR' } })
}

it('Mesa troca a interface e mantém o mesmo rascunho sem criar conversa ou tarefa', async () => {
  montar(<MesaTab orgId={1} slug="conteudo" orgNome="Aurora" />)
  const campo = await screen.findByRole('textbox', { name: 'Message' })
  fireEvent.change(campo, { target: { value: 'Anúncio da João & Maria, preservar 2026' } })
  mudarParaPt()
  expect(screen.getByRole('textbox', { name: 'Mensagem' })).toBe(campo)
  expect(campo).toHaveValue('Anúncio da João & Maria, preservar 2026')
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it('Estúdio preserva os dois rascunhos quando muda o idioma', async () => {
  montar(<EstudioTab orgId={1} slug="conteudo" />)
  await screen.findByText('No productions yet.')
  const pedido = screen.getByPlaceholderText(/Describe what you want: video/)
  const conversa = screen.getByPlaceholderText(/Describe the production or ask for the next step/)
  fireEvent.change(pedido, { target: { value: 'Vídeo da equipe João & Maria' } })
  fireEvent.change(conversa, { target: { value: 'Manter texto: Até amanhã' } })
  mudarParaPt()
  expect(screen.getByPlaceholderText(/Descreva a peça que você quer/)).toBe(pedido)
  expect(screen.getByPlaceholderText(/Descreva a peça, ou peça o próximo passo/)).toBe(conversa)
  expect(pedido).toHaveValue('Vídeo da equipe João & Maria')
  expect(conversa).toHaveValue('Manter texto: Até amanhã')
  expect(api.post).not.toHaveBeenCalled()
})

it('log traduz eventos do sistema e ferramentas, mantendo a resposta e os nomes originais', () => {
  const job: Job = { id: 1, titulo: 'Relatório João', prompt: 'Olá', effort: 'high', status: 'done', criado_em: '2026-09-09T12:00:00' }
  const eventos: JobEvent[] = [
    { seq: 1, tipo: 'iniciado', payload: {} },
    { seq: 2, tipo: 'tool_use', payload: { ferramenta: 'Read', resumo: 'memoria/João.md' } },
    { seq: 3, tipo: 'agent_text', payload: { texto: 'Texto original do agente em português.' } },
    { seq: 4, tipo: 'resultado', payload: { duracao_ms: 45000, custo_brl: 3.25 } },
  ]
  montar(<JobStream job={job} eventos={eventos} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText('The office received the task.')).toBeInTheDocument()
  expect(screen.getByText('reading João.md')).toBeInTheDocument()
  expect(screen.getByText('Finished without creating a file')).toBeInTheDocument()
  expect(screen.getByText(/Texto original do agente em português/)).toBeInTheDocument()
  mudarParaPt()
  expect(screen.getByText('lendo João.md')).toBeInTheDocument()
  expect(screen.getByText('Terminou sem gerar arquivo')).toBeInTheDocument()
  expect(screen.getByText(/Texto original do agente em português/)).toBeInTheDocument()
})

it('placa traduz o último evento recebido sem perder acompanhamento nem refazer requisições', async () => {
  const ouvintes = new Map<string, Array<(msg: WsMessage) => void>>()
  vi.mocked(wsClient.on).mockImplementation((tipo, callback) => {
    ouvintes.set(tipo, [...(ouvintes.get(tipo) || []), callback])
    return () => ouvintes.set(tipo, (ouvintes.get(tipo) || []).filter((fn) => fn !== callback))
  })
  const job: Job = { id: 17, titulo: 'Relatório João', prompt: 'Olá', effort: 'high', status: 'running', criado_em: '2026-09-09T12:00:00' }
  vi.mocked(api.get).mockResolvedValue([job])
  montar(<PlacaExecucao orgId={1} slug="conteudo" emAndamento={1} pendentes={0} aoAbrirEntregas={vi.fn()} />)
  await screen.findByText('Relatório João')
  act(() => {
    for (const fn of ouvintes.get('job_event') || []) fn({ t: 'job_event', org_id: 1, office_slug: 'conteudo', job_id: 17, seq: 1, tipo: 'tool_use', payload: { ferramenta: 'Read', resumo: 'memoria/João.md' } })
  })
  expect(screen.getByText('reading João.md')).toBeInTheDocument()
  const chamadas = vi.mocked(api.get).mock.calls.length
  mudarParaPt()
  expect(screen.getByText('lendo João.md')).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'Progresso da tarefa' })).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledTimes(chamadas)
  expect(api.post).not.toHaveBeenCalled()
})

it('Mesa mostra os cartões adicionais do envio sem duplicar o histórico nem confirmar o perfil', async () => {
  const extra = { id: 12, role: 'assistant', conteudo: 'Confira seu perfil.', sugestao_tarefa: { tipo: 'canon', resumo: 'Perfil da clínica', secoes: [{ secao: 'Tom de voz', conteudo: 'Direto e acolhedor.' }] } }
  const getOriginal = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42' ? { mensagens: [extra] }
    : path.endsWith('/conhecimento/canon') ? { conteudo: '## Tom de voz\nFormal.' } : getOriginal(path))
  vi.mocked(api.post).mockImplementation(async path => path.endsWith('/mensagens') ? {
    mensagem: { id: 11, role: 'assistant', conteudo: 'Posso preparar o post.', sugestao_tarefa: { titulo: 'Post da semana', prompt: 'Produzir post sobre ansiedade.' } }, mensagens_extras: [extra, extra],
  } : { id: 42 })
  montar(<MesaTab orgId={1} slug="conteudo" orgNome="Aurora" configHref="/config/org/1" />)
  fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Faz um post sobre ansiedade.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(await screen.findByText('Formal.')).toBeInTheDocument()
  expect(screen.getByText('Posso preparar o post.')).toBeInTheDocument()
  expect(screen.getAllByRole('region', { name: 'Review your profile' })).toHaveLength(1)
  expect(vi.mocked(api.post).mock.calls.every(([path]) => !path.endsWith('/confirmar') && !path.includes('/jobs'))).toBe(true)
  expect(api.put).not.toHaveBeenCalled()
})

it('Mesa sem perfil não cria entrevista ao entrar; completar só prepara o pedido', async () => {
  const getOriginal = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/partida')
    ? { tem_motor: true, tem_chave: true, sabatina_pendente: true } : getOriginal(path))
  montar(<MesaTab orgId={1} slug="conteudo" orgNome="Aurora" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Complete my profile' }))
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('I want to complete my company profile.')
  expect(api.post).not.toHaveBeenCalled()
})

it('produção fica no fio da Mesa e substitui o convite inicial enquanto trabalha', async () => {
  montar(<MesaTab orgId={1} slug="conteudo" emExecucao acompanhamento={<div role="status">Produzindo o kit Aferia</div>} />)
  const andamento = screen.getByRole('status')
  expect(andamento.closest('.mesa-fio')).not.toBeNull()
  await screen.findByRole('textbox', { name: 'Message' })
  expect(screen.queryByText(/Describe the deliverable, paste a reference/)).not.toBeInTheDocument()
})

it('restaura progresso, recolhe eventos sem parar e ignora eventos de outro trabalho', async () => {
  const ouvintes = new Map<string, Array<(msg: WsMessage) => void>>()
  vi.mocked(wsClient.on).mockImplementation((tipo, callback) => {
    ouvintes.set(tipo, [...(ouvintes.get(tipo) || []), callback])
    return () => ouvintes.set(tipo, (ouvintes.get(tipo) || []).filter((fn) => fn !== callback))
  })
  const job: Job = { id: 254, titulo: 'Kit Aferia', prompt: 'Kit', effort: 'high', status: 'running', criado_em: new Date().toISOString() }
  vi.mocked(api.get).mockImplementation(async (path) => path.endsWith('/events') ? { events: [
    { seq: 1, tipo: 'modelo_selecionado', payload: { motor: 'codex', modelo: 'gpt-5.6-sol' } },
    { seq: 2, tipo: 'agent_text', payload: { texto: 'PROGRESSO: 15% — Contexto pronto.\nPROGRES' } },
    { seq: 3, tipo: 'agent_text', payload: { texto: 'SO: 40% — Roteiro pronto.\n' } },
    { seq: 4, tipo: 'agent_text', payload: { texto: 'Conferindo os arquivos.' } },
  ] } : [job])
  montar(<PlacaExecucao orgId={1} slug="conteudo" emAndamento={1} pendentes={0} aoAbrirEntregas={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40'))
  const toggle = screen.getByRole('button', { name: 'View activity' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('region', { name: 'Task activity' })).not.toBeInTheDocument()
  fireEvent.click(toggle)
  expect(screen.getByRole('region', { name: 'Task activity' })).toHaveTextContent('OpenAI Codex · gpt-5.6-sol')
  fireEvent.click(screen.getByRole('button', { name: 'Collapse activity' }))
  act(() => {
    for (const fn of ouvintes.get('job_event') || []) fn({ t: 'job_event', org_id: 1, office_slug: 'conteudo', job_id: 999, seq: 5, tipo: 'agent_text', payload: { texto: 'PROGRESSO: 99% — Outra tarefa.' } })
  })
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
  expect(screen.getByRole('button', { name: 'stop' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})
