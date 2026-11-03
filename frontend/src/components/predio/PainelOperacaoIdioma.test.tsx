import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { api } from '../../lib/api'
import { IdiomaProvider, useIdioma } from '../../lib/i18n'
import { DashboardTab } from './DashboardTab'
import { MARCADOR_SABATINA, SetupSabatina } from './SetupSabatina'
import { ConhecimentoSimples } from './ConhecimentoSimples'
import { AgendaTab } from './AgendaTab'

vi.mock('../../lib/api', async (original) => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() },
  carregarArquivo: vi.fn(), baixarArquivo: vi.fn(),
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn() }) }))
vi.mock('../../lib/ws', () => ({ wsClient: { on: () => () => undefined } }))
vi.mock('./PortaVozes', () => ({ default: () => null }))

const office = { slug: 'conteudo', nome: 'Conteúdo da Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
function TrocarIdioma() {
  const { definirPreferencia } = useIdioma()
  return <><button onClick={() => void definirPreferencia('en')}>English</button><button onClick={() => void definirPreferencia('pt-BR')}>Português</button></>
}
const montar = (children: ReactNode) => render(<IdiomaProvider><TrocarIdioma />{children}</IdiomaProvider>)
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  localStorage.setItem('offiz:idioma:visitante', 'en')
  vi.mocked(api.get).mockResolvedValue({})
  vi.mocked(api.put).mockResolvedValue({})
  vi.mocked(api.post).mockResolvedValue({})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('entrevista traduz o roteiro já visível e mantém respostas e seções do cânon ao trocar idioma', async () => {
  vi.useFakeTimers()
  localStorage.setItem('offiz:idioma:visitante', 'pt-BR')
  const concluir = vi.fn()
  vi.mocked(api.get).mockResolvedValue({ conteudo: '## Regra anterior\n- Preservar meu texto.' })
  montar(<SetupSabatina orgId={1} slug="juris" canonAtual={'## Regra anterior\n- Preservar meu texto.'} aoConcluir={concluir} aoFechar={vi.fn()} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  const campo = screen.getByRole('textbox', { name: 'Pra começar: o que a sua empresa faz?' })
  fireEvent.change(campo, { target: { value: 'Somos a empresa do João. Nunca traduzir esta resposta.' } })
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByRole('textbox', { name: 'To start: what does your company do?' })).toBe(campo)
  expect(campo).toHaveValue('Somos a empresa do João. Nunca traduzir esta resposta.')
  expect(screen.getByText(/^Let’s get to know your work/)).toBeInTheDocument()
  expect(screen.queryByText(/^Vamos conhecer seu trabalho/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(700) })
  for (let i = 1; i < 7; i++) {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: `Resposta original ${i}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
  }
  expect(api.post).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Text for O que a empresa faz' })).toHaveValue('Somos a empresa do João. Nunca traduzir esta resposta.')
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have reviewed the profile and want to finish this setup.' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(700) })
  expect(api.post).toHaveBeenCalledTimes(1)
  const [path, corpo] = vi.mocked(api.post).mock.calls[0]
  expect(path).toBe('/predios/1/juris/conhecimento/canon/confirmar')
  expect(corpo).toMatchObject({ secoes: expect.arrayContaining([{ secao: 'O que a empresa faz', conteudo: 'Somos a empresa do João. Nunca traduzir esta resposta.' }]) })
  expect(corpo).toMatchObject({ base: '## Regra anterior\n- Preservar meu texto.', concluir: true })
  expect(JSON.stringify(corpo)).not.toContain(MARCADOR_SABATINA)
  expect(JSON.stringify(corpo)).not.toContain('## What the company does')
  expect(concluir).toHaveBeenCalledTimes(1)
  expect(api.put).not.toHaveBeenCalled()
})

it('dashboard localiza contadores, status e atividade sem mudar nomes das entregas', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const agora = new Date().toISOString()
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path.endsWith('/stats')) return { tarefas_mes: 2, concluidas_mes: 1, entregas_pendentes: 1, rodando: false }
    if (path.includes('/jobs?')) return { jobs: [{ id: 77, status: 'cancelled', titulo: 'Pedido da Aurora', criado_em: agora }] }
    if (path.endsWith('/entregas')) return { entregas: [{ id: 1, nome: 'apresentação-da-equipe.pdf', tipo: 'arquivo', status: 'pendente', criado_em: agora }] }
    if (path.includes('/metricas/')) throw new Error('no metrics fixture')
    return {}
  })
  montar(<DashboardTab orgId={1} slug="conteudo" office={office} aoNavegar={vi.fn()} />)
  expect(await screen.findByText('1 deliverable awaiting your approval.')).toBeInTheDocument()
  expect(screen.getByText('Tasks this month')).toBeInTheDocument()
  expect(screen.getByText('Pedido da Aurora')).toBeInTheDocument()
  expect(screen.getByText('Cancelled')).toBeInTheDocument()
  expect(screen.getByText('apresentação-da-equipe.pdf')).toBeInTheDocument()
  expect(screen.getByText('awaiting your approval')).toBeInTheDocument()
  expect(screen.getByText('cancelled')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('conhecimento traduz moldura e preserva regras e edição de premissas', async () => {
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path.endsWith('/canon')) return { conteudo: '## Regras da Aurora\n- Nunca publicar sem nossa revisão.' }
    if (path.endsWith('/premissas')) return { conteudo: '## Objetivos\nPreservar a identidade em português.' }
    if (path.endsWith('/licoes')) return []
    return {}
  })
  montar(<ConhecimentoSimples orgId={1} slug="conteudo" acervoSeparado aoAbrirAcervo={vi.fn()} />)
  await screen.findByRole('heading', { name: 'Rules you gave me' })
  expect(screen.getByText('Nunca publicar sem nossa revisão.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Library' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Fill in / edit' }))
  const campo = screen.getByRole('textbox')
  fireEvent.change(campo, { target: { value: 'Novo objetivo que ainda não salvei.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Português' }))
  expect(await screen.findByRole('heading', { name: 'Regras que você me deu' })).toBeInTheDocument()
  expect(campo).toHaveValue('Novo objetivo que ainda não salvei.')
  expect(api.put).not.toHaveBeenCalled()
})

it('agenda traduz dias e estados sem mudar rascunho, fuso ou payload de produção', async () => {
  vi.mocked(api.get).mockResolvedValue({ atividades: [{ id: 10, titulo: 'Rotina da equipe', prompt: 'Escreva em português.', recorrencia: 'semanal', dia: 0, hora: '09:00', ativo: false, proxima_execucao: null }] })
  vi.mocked(api.post).mockResolvedValue({ id: 11 })
  montar(<AgendaTab orgId={1} slug="conteudo" podeEditar />)
  await screen.findByText('Monday at 09:00')
  expect(screen.getByText('paused')).toBeInTheDocument()
  expect(screen.getByText('Escreva em português.')).toBeInTheDocument()
  const nome = screen.getByRole('textbox', { name: 'Name (shown in deliverables)' })
  const campo = screen.getByRole('textbox', { name: 'Work to be done' })
  fireEvent.change(nome, { target: { value: 'Agenda do João' } })
  fireEvent.change(campo, { target: { value: 'Relatório em português com dados originais.' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Day of the week' }), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Português' }))
  expect(screen.getByRole('textbox', { name: 'O que deve ser feito' })).toBe(campo)
  expect(campo).toHaveValue('Relatório em português com dados originais.')
  fireEvent.click(screen.getByRole('button', { name: 'Agendar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/1/conteudo/agenda', expect.objectContaining({ titulo: 'Agenda do João', prompt: 'Relatório em português com dados originais.', recorrencia: 'semanal', dia: 2, hora: '09:00' })))
})
