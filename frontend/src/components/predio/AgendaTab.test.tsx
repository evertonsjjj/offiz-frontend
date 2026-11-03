import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgendaTab } from './AgendaTab'
import { api, ApiError } from '../../lib/api'
import { instalarDialogoDeTeste } from '../../test/dialog'

instalarDialogoDeTeste()

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(async () => []), post: vi.fn(async () => ({})), postForm: vi.fn(), del: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn() }) }))

beforeEach(() => {
  localStorage.clear()
  vi.mocked(api.get).mockResolvedValue([])
  vi.mocked(api.post).mockResolvedValue({})
  vi.mocked(api.del).mockResolvedValue(undefined)
})

it('agenda a instrução completa do manifesto mesmo quando a sugestão tem resumo curto', async () => {
  const prompt = 'Produza cinco posts usando o acervo da empresa. Inclua fontes e mantenha o material para revisão.'
  render(<AgendaTab orgId={1} slug="financeiro" podeEditar office={{ slug:'financeiro',nome:'Financeiro',descricao:'',tema:{cor_primaria:'#000',cor_acento:'#000',cor_fundo:'#fff',icone:'conversa'},sugestoes_agenda:[{titulo:'Conteúdo semanal',descricao:'Cinco posts',prompt}] }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Conteúdo semanal' }))
  fireEvent.click(screen.getByRole('button', { name: 'Agendar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/1/financeiro/agenda', expect.objectContaining({ prompt })))
})


afterEach(() => { cleanup(); vi.clearAllMocks() })

it('envia arquivos antes de agendar e mantém referências ao salvar', async () => {
  let concluir!: (valor: { nome: string; referencia: string }) => void
  vi.mocked(api.postForm).mockImplementation(() => new Promise(resolve => { concluir = resolve }) as never)
  render(<AgendaTab orgId={1} slug="conteudo" podeEditar />)
  fireEvent.change(screen.getByLabelText('Nome (aparece nas entregas)'), { target: { value: 'Editar meu vídeo' } })
  fireEvent.change(screen.getByLabelText('O que deve ser feito'), { target: { value: 'Corte pausas e inclua legendas.' } })
  const arquivo = new File(['video'], 'gravacao.mp4', { type: 'video/mp4' })
  fireEvent.change(screen.getByLabelText('Arquivos da atividade'), { target: { files: [arquivo] } })
  expect(screen.getByRole('button', { name: 'Agendar' })).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
  concluir({ nome: arquivo.name, referencia: 'a'.repeat(32) + '_gravacao.mp4' })
  await screen.findByText('gravacao.mp4')
  fireEvent.click(screen.getByRole('button', { name: 'Agendar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/1/conteudo/agenda', expect.objectContaining({ anexos: ['a'.repeat(32) + '_gravacao.mp4'] })))
})

it('falha de upload avisa sem fingir que o arquivo foi anexado', async () => {
  vi.mocked(api.postForm).mockRejectedValue(new Error('offline'))
  render(<AgendaTab orgId={1} slug="conteudo" podeEditar />)
  fireEvent.change(screen.getByLabelText('Arquivos da atividade'), { target: { files: [new File(['x'], 'foto.jpg')] } })
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível enviar todos os arquivos')
  expect(screen.queryByText('foto.jpg')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

const atividade = { id: 8, titulo: 'Relatório semanal', prompt: 'Prepare o relatório.', recorrencia: 'semanal', dia: 0, hora: '09:00', ativo: true, ultima_execucao_em: null, ultimo_job_id: null, proxima_execucao: '2026-10-05T09:00:00-03:00', pendente: false }

it('confirma remoção no app, cancelar preserva a agenda e aceitar envia uma única exclusão', async () => {
  const nativo = vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('Confirmação não suportada pelo host') })
  vi.mocked(api.get).mockResolvedValue([atividade])
  let concluir!: () => void
  vi.mocked(api.del).mockImplementation(() => new Promise<void>(resolve => { concluir = resolve }))
  render(<AgendaTab orgId={1} slug="financeiro" podeEditar />)
  const abrir = await screen.findByRole('button', { name: 'Remover' })
  fireEvent.click(abrir)
  expect(screen.getByRole('dialog')).toHaveTextContent('Relatório semanal')
  expect(screen.getByRole('dialog')).toHaveTextContent('trabalhos já iniciados permanecem')
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.del).not.toHaveBeenCalled()
  fireEvent.click(abrir)
  fireEvent.click(screen.getByRole('button', { name: 'Remover atividade' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledWith('/predios/1/financeiro/agenda/8'))
  expect(abrir).toBeDisabled()
  fireEvent.click(abrir)
  expect(api.del).toHaveBeenCalledOnce()
  concluir()
  await waitFor(() => expect(abrir).not.toBeDisabled())
  expect(nativo).not.toHaveBeenCalled()
  nativo.mockRestore()
})

it('membro acompanha agenda sem ter ação de remoção', async () => {
  vi.mocked(api.get).mockResolvedValue([atividade])
  render(<AgendaTab orgId={1} slug="financeiro" podeEditar={false} />)
  await screen.findByText('Relatório semanal')
  expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument()
  expect(api.del).not.toHaveBeenCalled()
})

it('trava o duplo clique enquanto a intenção manual está sendo confirmada', async () => {
  vi.mocked(api.get).mockResolvedValueOnce([atividade]).mockResolvedValue([{ ...atividade, ultimo_job_id: 40 }])
  let concluir!: (v: { job: { id: number } }) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { concluir = resolve }) as never)
  const primeiraTela = render(<AgendaTab orgId={1} slug="financeiro" podeEditar />)
  const agora = await screen.findByRole('button', { name: 'Agora' })
  fireEvent.click(agora)
  fireEvent.click(agora)
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Confirmando…' })).toBeDisabled()
  expect(api.post).toHaveBeenCalledWith('/predios/1/financeiro/agenda/8/executar', { chave_execucao: expect.stringMatching(/^[\da-f-]{36}$/) })
  concluir({ job: { id: 40 } })
  expect(await screen.findByRole('link', { name: 'Acompanhar trabalho #40' })).toHaveAttribute('href', '/app?org=1&vista=biblioteca&area=financeiro&trabalho=40')
  primeiraTela.unmount()
  render(<AgendaTab orgId={1} slug="financeiro" podeEditar />)
  expect(await screen.findByRole('link', { name: 'Acompanhar trabalho #40' })).toHaveAttribute('href', '/app?org=1&vista=biblioteca&area=financeiro&trabalho=40')
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('resposta incerta conserva a chave depois de reabrir e só confere por clique', async () => {
  vi.mocked(api.get).mockResolvedValueOnce([atividade]).mockResolvedValueOnce([atividade]).mockResolvedValue([{ ...atividade, ultimo_job_id: 40 }])
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(0, 'offline'))
  const primeiro = render(<AgendaTab orgId={1} slug="financeiro" podeEditar />)
  fireEvent.click(await screen.findByRole('button', { name: 'Agora' }))
  await screen.findByRole('button', { name: 'Conferir tentativa' })
  const primeiraChave = vi.mocked(api.post).mock.calls[0][1]
  primeiro.unmount()
  render(<AgendaTab orgId={1} slug="financeiro" podeEditar />)
  const conferir = await screen.findByRole('button', { name: 'Conferir tentativa' })
  expect(api.post).toHaveBeenCalledTimes(1)
  vi.mocked(api.post).mockResolvedValue({ job: { id: 40 } })
  fireEvent.click(conferir)
  await screen.findByRole('link', { name: 'Acompanhar trabalho #40' })
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual(primeiraChave)
  fireEvent.click(screen.getByRole('button', { name: 'Agora' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3))
  expect(vi.mocked(api.post).mock.calls[2][1]).not.toEqual(primeiraChave)
})

it.each([
  { recorrencia: 'semanal', ativo: true, proxima_execucao: atividade.proxima_execucao },
  { recorrencia: 'uma_vez', ativo: false, proxima_execucao: null },
])('mostra o trabalho persistido de uma atividade $recorrencia sem exigir nova execução', async dados => {
  vi.mocked(api.get).mockResolvedValue([{ ...atividade, ...dados, data: '2026-10-05', ultima_execucao_em: '2026-10-05T12:00:00', ultimo_job_id: 71 }])
  render(<AgendaTab orgId={3} slug="conteudo" podeEditar={false} />)
  expect(await screen.findByRole('link', { name: 'Acompanhar trabalho #71' })).toHaveAttribute('href', '/app?org=3&vista=biblioteca&area=conteudo&trabalho=71')
  expect(api.post).not.toHaveBeenCalled()
  if (dados.recorrencia === 'uma_vez') expect(screen.getByText('feita ✓')).toBeInTheDocument()
})

it('exibe a próxima execução em Brasília mesmo se o computador estiver em Lisboa', async () => {
  const original = Date.prototype.toLocaleString
  const fusoDoComputador = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (this: Date, idioma, opcoes) {
    return original.call(this, idioma, { timeZone: 'Europe/Lisbon', ...opcoes })
  })
  try {
    vi.mocked(api.get).mockResolvedValue([{ ...atividade, hora: '23:30', proxima_execucao: '2026-10-05T23:30:00-03:00' }])
    render(<AgendaTab orgId={1} slug="financeiro" podeEditar />)
    expect(await screen.findByText(/05\/10.*23:30/)).toBeInTheDocument()
    expect(screen.queryByText(/06\/10.*03:30/)).not.toBeInTheDocument()
    expect(screen.getByText('Os horários seguem o fuso de Brasília.')).toBeInTheDocument()
  } finally {
    fusoDoComputador.mockRestore()
  }
})

it('falha inicial da agenda oferece nova tentativa sem fingir agenda vazia', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(503, 'Agenda indisponível'))
  render(<AgendaTab orgId={1} slug="financeiro" podeEditar />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Agenda indisponível')
  expect(screen.queryByText('Nada agendado ainda.')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText(/Nada agendado ainda/)).toBeInTheDocument()
})
