import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { transporteDesktop, transporteSimulacao, type EventoCriador } from './criador-transporte'
import type { Idioma } from './i18n'

vi.mock('./api', () => ({ api: { get: vi.fn(), put: vi.fn() } }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.mocked(api.get).mockResolvedValue({
    slug: 'relacoes', nome: 'Relações', descricao: 'Atendimento em português.',
    tema: { cor_primaria: '#112233', estilo: 'original-do-cliente' },
    abas: [{ id: 'conversa', rotulo: 'Nossas conversas' }],
    prompts_prontos: [],
  })
  vi.mocked(api.put).mockResolvedValue({})
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('simulação muda idioma na mesma sessão e publica exatamente os textos originais', async () => {
  let idioma: Idioma = 'pt-BR'
  const transporte = transporteSimulacao(() => idioma)
  const eventos: EventoCriador[] = []
  transporte.onEvento((ev) => eventos.push(ev))
  await transporte.abrir('relacoes')
  const primeiro = transporte.enviar('renomear para Relações da Mônica')
  await vi.runAllTimersAsync()
  await primeiro
  const texto = () => eventos.filter((ev) => ev.tipo === 'agent_text').map((ev) => ev.payload.texto).join('')
  expect(texto()).toBe('Nome trocado para “Relações da Mônica”.')

  idioma = 'en'
  eventos.length = 0
  const proximo = transporte.enviar('adicionar tarefa "Acolhimento" na seção "Relacionamento": Escreva à Mônica em português.')
  await vi.runAllTimersAsync()
  await proximo
  expect(texto()).toBe('Task “Acolhimento” created in section “Relacionamento” at position 1.')
  expect(await transporte.publicar()).toEqual({ ok: true })
  expect(api.get).toHaveBeenCalledExactlyOnceWith('/admin/offices/relacoes/manifesto')
  expect(api.put).toHaveBeenCalledExactlyOnceWith('/admin/offices/relacoes/manifesto', {
    nome: 'Relações da Mônica', descricao: 'Atendimento em português.', tema: { cor_primaria: '#112233' },
    abas: [{ id: 'conversa', rotulo: 'Nossas conversas' }],
    prompts_prontos: [{ titulo: 'Acolhimento', escopo: 'Relacionamento', descricao: 'Tarefa criada pela simulação do criador.', prompt: 'Escreva à Mônica em português.' }],
  })
  eventos.length = 0
  const ajuda = transporte.enviar('help')
  await vi.runAllTimersAsync()
  await ajuda
  expect(texto()).toContain('Simulation without AI.')
  expect(texto()).toContain('renomear para <name>')
  expect(texto()).toContain('Commands use Portuguese keywords.')
})

it('fallbacks desktop acompanham idioma e preservam erros reais e mensagens para o CLI', async () => {
  let idioma: Idioma = 'en'
  const enviar = vi.fn().mockResolvedValue({ ok: false })
  vi.stubGlobal('offizMotor', { criador: { enviar } })
  const transporte = transporteDesktop(() => idioma)
  expect(await transporte.arquivos()).toEqual({ ok: false, error: 'The Files panel requires app version 0.2.2 or later. Download the update.' })
  await expect(transporte.enviar('Olá, Mônica.')).rejects.toThrow('The app rejected the message.')
  expect(enviar).toHaveBeenCalledExactlyOnceWith({ texto: 'Olá, Mônica.' })
  idioma = 'pt-BR'
  expect(await transporte.anexar([])).toEqual({ ok: false, error: 'Anexos pedem o app 0.2.1+ — baixe a atualização.' })
  enviar.mockResolvedValue({ ok: false, error: 'Erro original do cliente.' })
  await expect(transporte.enviar('Outra mensagem.')).rejects.toThrow('Erro original do cliente.')
})
