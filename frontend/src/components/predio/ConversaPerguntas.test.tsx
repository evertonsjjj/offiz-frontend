import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ConversaTab } from './ConversaTab'
import { api, setTokens } from '../../lib/api'
import { perguntaPendente } from '../../lib/perguntasConversa'
import type { ConversaMensagem } from '../../lib/types'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
const office = { slug: 'predio', nome: 'Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const user = { id: 1, role: 'user', conteudo: 'Quero conversar sobre esse post.', criado_em: '2026-10-10T00:00:00Z' }
const question = { id: 2, role: 'assistant', conteudo: 'Você prefere um exemplo da rotina ou sinais gerais?', criado_em: '2026-10-10T00:00:01Z', sugestao_tarefa: { perguntas: ['Prefiro exemplo da rotina', 'Prefiro sinais gerais'] } }
const task = { ...question, sugestao_tarefa: { ...question.sugestao_tarefa, titulo: 'Post', prompt: 'Preparar post para revisão.', andar: 'conteudo' } }
const profile = { id: 3, role: 'assistant', conteudo: 'Revise também estas informações antes de guardá-las no perfil.', criado_em: '2026-10-10T00:00:02Z', sugestao_tarefa: { tipo: 'canon', resumo: 'Preferência confirmada', secoes: [{ secao: 'Tom', conteudo: 'Prefiro textos diretos sem clichês.' }] } }
const finish = { id: 3, role: 'assistant', conteudo: 'O trabalho anterior terminou e pode ser revisto.', criado_em: '2026-10-10T00:00:02Z', sugestao_tarefa: { tipo: 'desfecho', job_id: 31, status: 'done', titulo: 'Trabalho anterior', qualidade: 'aguardando_aprovacao', correcao_job_id: null, pendencias: [], entregas: [] } }

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  setTokens('synthetic', 'synthetic')
})

async function show(messages: unknown[], iniciadas: number[] = []) {
  const conversa = { id: 42, organization_id: 1, office_slug: null, titulo: 'Pergunta em aberto', atualizado_em: '2026-10-10T00:00:03Z', total_mensagens: messages.length, mensagens: messages, anexos: [], tarefas_iniciadas: iniciadas }
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/conversas/42') return conversa
    if (path.endsWith('/conhecimento/canon')) return { conteudo: '' }
    return { conversas: [conversa] }
  })
  let view!: ReturnType<typeof render>
  await act(async () => { view = render(<StrictMode><MemoryRouter initialEntries={['/app?org=1&conversa=42']}><ConversaTab orgId={1} slug="predio" office={office} nivelPredio /></MemoryRouter></StrictMode>) })
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBeEnabled())
  await screen.findByText(question.conteudo)
  return view
}

function pending(expected: boolean) {
  for (const name of question.sugestao_tarefa.perguntas) {
    if (expected) expect(screen.getByRole('button', { name })).toBeInTheDocument()
    else expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
  expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled(); expect(api.postForm).not.toHaveBeenCalled()
}

it.each([['cartão de perfil da mesma resposta', task, profile], ['conclusão técnica de trabalho anterior', question, finish]])('conserva opções não respondidas após %s', async (_name, original, subsequent) => {
  await show([user, original, subsequent])
  pending(true)
})

it('o grupo único fica depois do cartão e Ver a pergunta focaliza o texto original sem enviar', async () => {
  await show([user, task, profile])
  const group = screen.getByRole('group', { name: 'Respostas à pergunta em aberto' })
  const card = screen.getByRole('region', { name: 'Confira o perfil' })
  expect(card.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getAllByText(question.conteudo)).toHaveLength(1)
  expect(screen.getAllByRole('group', { name: 'Respostas à pergunta em aberto' })).toHaveLength(1)
  const original = screen.getByText(question.conteudo).closest('.conversa-grupo')!
  const scroll = vi.fn()
  Object.defineProperty(original, 'scrollIntoView', { value: scroll })
  fireEvent.click(screen.getByRole('button', { name: 'Ver a pergunta' }))
  expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
  expect(document.activeElement).toBe(original)
  pending(true)
})

it('pergunta sem cartão posterior oferece só respostas, sem navegação redundante', async () => {
  await show([user, question])
  pending(true)
  expect(screen.queryByRole('button', { name: 'Ver a pergunta' })).not.toBeInTheDocument()
})

it('uma resposta humana encerra as opções antigas mesmo seguida de cartão', async () => {
  await show([user, question, { ...user, id: 3, conteudo: 'Quero exemplo da rotina.' }, { ...profile, id: 4 }])
  pending(false)
})

it('a pergunta mais nova substitui as opções da anterior', async () => {
  await show([user, question, { ...question, id: 3, conteudo: 'Qual situação importa mais?', sugestao_tarefa: { perguntas: ['Quero falar sobre o trabalho'] } }, { ...profile, id: 4 }])
  pending(false)
  expect(screen.getByRole('button', { name: 'Quero falar sobre o trabalho' })).toBeInTheDocument()
})

it('uma resposta comum sem opções interrompe a busca', async () => {
  await show([user, question, { id: 3, role: 'assistant', conteudo: 'Vamos reformular a proposta antes de decidir.', criado_em: '2026-10-10T00:00:02Z' }, { ...profile, id: 4 }])
  pending(false)
})

it('conclusão técnica não reabre opção de produção ou escopo', async () => {
  await show([user, task, finish])
  pending(false)
})

it.each(['iniciada', 'dispensada'])('proposta %s não reapresenta opções', async estado => {
  if (estado === 'dispensada') localStorage.setItem('offiz:sugestoes:1:42', JSON.stringify({ 2: estado }))
  await show([user, task], estado === 'iniciada' ? [2] : [])
  pending(false)
})

it('erro após resposta humana não ressuscita opções anteriores', async () => {
  await show([user, question, { ...user, id: 3, conteudo: 'Prefiro exemplo da rotina' }, { id: 4, role: 'assistant', conteudo: 'Não consegui responder agora. Seu pedido ficou salvo.', criado_em: '2026-10-10T00:00:04Z' }])
  pending(false)
})

it('nova sessão com falha de leitura não conserva a pergunta anterior', async () => {
  const first = await show([user, question])
  pending(true)
  first.unmount()
  setTokens('another-synthetic-session', 'another-refresh')
  vi.mocked(api.get).mockRejectedValue(new Error('synthetic read failure'))
  await act(async () => { render(<StrictMode><MemoryRouter initialEntries={['/app?org=1&conversa=42']}><ConversaTab orgId={1} slug="predio" office={office} nivelPredio /></MemoryRouter></StrictMode>) })
  pending(false)
})

it.each([
  { tipo: 'outro', resumo: 'Não é cartão auxiliar' },
  { tipo: 'canon', resumo: 'Perfil inválido', secoes: [] },
  { tipo: 'canon', resumo: 'Perfil inválido', secoes: [{ secao: 'Tom', conteudo: null }] },
  { tipo: 'desfecho', job_id: 31, status: 'done' },
  { ...finish.sugestao_tarefa, status: 'running' },
  { ...finish.sugestao_tarefa, status: ['done'] },
  { ...finish.sugestao_tarefa, qualidade: ['aguardando_aprovacao'] },
  { ...finish.sugestao_tarefa, job_id: '31' },
  { ...finish.sugestao_tarefa, entregas: [{ id: -1, nome: 'arte.png', tipo: 'imagem' }] },
])('metadado desconhecido ou malformado não torna mensagem transparente: %j', meta => {
  const messages = [user, question, { ...finish, sugestao_tarefa: meta }] as unknown as ConversaMensagem[]
  expect(perguntaPendente(messages)).toBeNull()
})

it('lista de respostas malformada não faz a busca reapresentar pergunta mais antiga', () => {
  const messages = [user, question, { ...question, id: 3, sugestao_tarefa: { perguntas: ['Sim', { texto: 'Não' }] } }] as unknown as ConversaMensagem[]
  expect(perguntaPendente(messages)).toBeNull()
})
