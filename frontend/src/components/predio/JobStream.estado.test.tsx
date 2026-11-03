import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Job, JobEvent, JobStatus } from '../../lib/types'
import { JobStream } from './JobStream'

const contexto = vi.hoisted(() => ({ idioma: 'pt-BR' as 'pt-BR' | 'en' }))
vi.mock('../../lib/i18n', () => ({ useIdioma: () => ({
  idioma: contexto.idioma,
  t: (pt: string, en: string) => contexto.idioma === 'pt-BR' ? pt : en,
}) }))

beforeEach(() => { contexto.idioma = 'pt-BR'; vi.clearAllMocks() })
const resultado: JobEvent = { seq: 1, tipo: 'resultado', payload: { duracao_ms: 4000, custo_brl: 1.25 } }
const arquivo: JobEvent = { seq: 2, tipo: 'entrega_registrada', payload: { nome: 'arte.png', caminho_rel: 'outputs/arte.png' } }
function pedido(status: JobStatus): Job {
  return { id: 18, titulo: 'Pedido sintético', prompt: 'Fixture', effort: 'high', status, criado_em: '2026-10-09T12:00:00Z' }
}

it.each(['pt-BR', 'en'] as const)('claim e modelo em %s não afirmam que o agente executou antes das primeiras atualizações', idioma => {
  contexto.idioma = idioma
  const eventos: JobEvent[] = [
    { seq: 1, tipo: 'iniciado', payload: {} },
    { seq: 2, tipo: 'modelo_selecionado', payload: { motor: 'codex', modelo: 'modelo-sintetico' } },
  ]
  const view = render(<JobStream job={pedido('running')} eventos={eventos} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText(idioma === 'pt-BR' ? 'O escritório recebeu o trabalho.' : 'The office received the task.')).toBeInTheDocument()
  expect(screen.getByText(idioma === 'pt-BR' ? /aguardando as primeiras atualizações/ : /waiting for the first updates/)).toBeInTheDocument()
  expect(screen.queryByText(/agente começou|agent has started|o agente está trabalhando|the agent is working/)).not.toBeInTheDocument()

  view.rerender(<JobStream job={pedido('running')} eventos={[
    ...eventos, { seq: 3, tipo: 'tool_use', payload: { ferramenta: 'Read', resumo: 'memoria/referencia.md' } },
  ]} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText(idioma === 'pt-BR' ? /o agente está trabalhando/ : /the agent is working/)).toBeInTheDocument()
  expect(screen.queryByText(/aguardando as primeiras atualizações|waiting for the first updates/)).not.toBeInTheDocument()
})

it('falha no preparo sem atividade não vira execução confirmada do agente', () => {
  render(<JobStream job={{ ...pedido('failed'), erro: 'Falha no preparo do workspace' }} eventos={[
    { seq: 1, tipo: 'iniciado', payload: {} },
    { seq: 2, tipo: 'modelo_selecionado', payload: { motor: 'codex', modelo: 'modelo-sintetico' } },
  ]} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText('O escritório recebeu o trabalho.')).toBeInTheDocument()
  expect(screen.queryByText(/agente começou|o agente está trabalhando/)).not.toBeInTheDocument()
  expect(screen.getByText('ver detalhes técnicos')).toBeInTheDocument()
})

it('nova tentativa espera atividade própria e conserva as ferramentas anteriores no diário', () => {
  const eventos: JobEvent[] = [
    { seq: 1, tipo: 'iniciado', payload: {} },
    { seq: 2, tipo: 'tool_use', payload: { ferramenta: 'Read', resumo: 'memoria/anterior.md' } },
    { seq: 3, tipo: 'agent_text', payload: { texto: 'Texto da tentativa anterior.' } },
    { seq: 4, tipo: 'iniciado', payload: {} },
    { seq: 5, tipo: 'modelo_selecionado', payload: { motor: 'codex', modelo: 'modelo-sintetico' } },
  ]
  const view = render(<JobStream job={pedido('running')} eventos={eventos} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText('Texto da tentativa anterior.')).toBeInTheDocument()
  expect(screen.getByText('lendo anterior.md')).toBeInTheDocument()
  expect(screen.getByText(/aguardando as primeiras atualizações/)).toBeInTheDocument()
  expect(screen.queryByText(/o agente está trabalhando/)).not.toBeInTheDocument()
  view.rerender(<JobStream job={pedido('running')} eventos={[
    ...eventos, { seq: 6, tipo: 'agent_text', payload: { texto: 'Conferindo a nova referência.' } },
  ]} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText('Texto da tentativa anterior.')).toBeInTheDocument()
  expect(screen.getByText(/o agente está trabalhando/)).toBeInTheDocument()
})

it.each(['queued', 'running'] as const)('resultado do agente em %s aguarda o estado final sem declarar falta de arquivo', status => {
  render(<JobStream job={pedido(status)} eventos={[resultado]} aoVerEntregas={vi.fn()} />)
  expect(screen.queryByText('Terminou sem gerar arquivo')).not.toBeInTheDocument()
  expect(screen.queryByText('Tarefa concluída')).not.toBeInTheDocument()
  expect(screen.getByText('Conferindo conclusão do trabalho')).toBeInTheDocument()
  expect(screen.queryByText(/Este trabalho não salvou um arquivo/)).not.toBeInTheDocument()
})

it.each(['failed', 'cancelled'] as const)('arquivo recebido em %s é parcial e não transforma o trabalho em concluído', status => {
  const abrir = vi.fn()
  render(<JobStream job={pedido(status)} eventos={[resultado, arquivo]} aoVerEntregas={abrir} />)
  expect(screen.queryByText('Tarefa concluída')).not.toBeInTheDocument()
  expect(screen.getByText('Arquivos parciais recebidos')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ver arquivos recebidos →' }))
  expect(abrir).toHaveBeenCalledOnce()
})

it.each(['failed', 'cancelled'] as const)('resultado em %s sem arquivo não oferece conclusão nem produção adicional', status => {
  render(<JobStream job={pedido(status)} eventos={[resultado]} aoVerEntregas={vi.fn()} />)
  expect(screen.queryByText('Tarefa concluída')).not.toBeInTheDocument()
  expect(screen.queryByText('Terminou sem gerar arquivo')).not.toBeInTheDocument()
  expect(screen.getByText('Execução interrompida')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Ver entregas|Ver arquivos recebidos/ })).not.toBeInTheDocument()
})

it('o recebimento dos arquivos e do estado final atualiza o mesmo acompanhamento', () => {
  const abrir = vi.fn()
  const view = render(<JobStream job={pedido('running')} eventos={[resultado]} aoVerEntregas={abrir} />)
  expect(screen.queryByText('Terminou sem gerar arquivo')).not.toBeInTheDocument()
  view.rerender(<JobStream job={pedido('running')} eventos={[resultado, arquivo]} aoVerEntregas={abrir} />)
  expect(screen.getByText('Conferindo conclusão do trabalho')).toBeInTheDocument()
  expect(screen.queryByText('Tarefa concluída')).not.toBeInTheDocument()
  view.rerender(<JobStream job={pedido('done')} eventos={[resultado, arquivo]} aoVerEntregas={abrir} />)
  expect(screen.getByText('Tarefa concluída')).toBeInTheDocument()
  expect(screen.queryByText('Conferindo conclusão do trabalho')).not.toBeInTheDocument()
})

it('done sem arquivo mantém o aviso existente, sem ocultar o custo informado', () => {
  render(<JobStream job={pedido('done')} eventos={[resultado]} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText('Terminou sem gerar arquivo')).toBeInTheDocument()
  expect(screen.getByText(/Este trabalho não salvou um arquivo/)).toBeInTheDocument()
  expect(screen.getByText(/1,25/)).toBeInTheDocument()
})

it('done durante consolidação não anuncia ausência de arquivo nem conclusão antecipada', () => {
  const view = render(<JobStream job={{ ...pedido('done'), finalizando: true }} eventos={[resultado]} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText('Organizando arquivos')).toBeInTheDocument()
  expect(screen.queryByText('Terminou sem gerar arquivo')).not.toBeInTheDocument()
  expect(screen.queryByText(/Este trabalho não salvou um arquivo/)).not.toBeInTheDocument()
  expect(screen.queryByText('o agente está trabalhando')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Ver entregas →' })).not.toBeInTheDocument()
  expect(screen.getByText(/1,25/)).toBeInTheDocument()
  view.rerender(<JobStream job={{ ...pedido('done'), finalizando: true }} eventos={[resultado, arquivo]} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText('Organizando arquivos')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ver arquivos recebidos →' })).not.toHaveClass('botao-ok')
  view.rerender(<JobStream job={{ ...pedido('done'), finalizando: false }} eventos={[resultado, arquivo]} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText('Tarefa concluída')).toBeInTheDocument()
  expect(screen.queryByText('Organizando arquivos')).not.toBeInTheDocument()
})

it('estado e arquivos parciais também ficam claros na interface em inglês', () => {
  contexto.idioma = 'en'
  const view = render(<JobStream job={pedido('running')} eventos={[resultado]} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText('Checking task completion')).toBeInTheDocument()
  expect(screen.queryByText('Finished without creating a file')).not.toBeInTheDocument()
  view.rerender(<JobStream job={pedido('failed')} eventos={[resultado, arquivo]} aoVerEntregas={vi.fn()} />)
  expect(screen.getByText('Partial files received')).toBeInTheDocument()
  expect(screen.queryByText('Task completed')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'View received files →' })).toBeInTheDocument()
})

it('arquivo registrado antes do finish continua recebido, sem sinal visual de conclusão', () => {
  const abrir = vi.fn()
  render(<JobStream job={pedido('running')} eventos={[resultado, arquivo]} aoVerEntregas={abrir} />)
  expect(screen.getByText('Arquivo recebido:')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ver arquivos recebidos →' })).not.toHaveClass('botao-ok')
  fireEvent.click(screen.getByRole('button', { name: 'Ver arquivo recebido →' }))
  expect(abrir).toHaveBeenCalledOnce()
})
