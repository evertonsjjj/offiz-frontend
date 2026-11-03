import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ConversaTab } from './ConversaTab'
import { api, setTokens } from '../../lib/api'
import { escopoRascunhos, guardarRascunho, lerRascunhos } from '../../lib/rascunhosConversa'
import { guardarPedidoLanding } from '../../lib/pedidoLanding'
import type { ReferenciaConversa } from '../../lib/types'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
const office = { slug: 'predio', nome: 'Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const conversa = { id: 42, titulo: 'Campanha original', atualizado_em: '2026-09-13T00:00:00Z', total_mensagens: 0, mensagens: [], anexos: [] }
const tela = (orgId = 1, slug = 'predio', referencia?: ReferenciaConversa) => <StrictMode><MemoryRouter><ConversaTab orgId={orgId} slug={slug} office={office} nivelPredio={slug === 'predio'}
  rascunhoInicial={referencia ? { texto: 'Preparar próximo teste.', chave: 1, referencia } : undefined} /></MemoryRouter></StrictMode>
const montar = (orgId = 1, slug = 'predio', referencia?: ReferenciaConversa) => render(tela(orgId, slug, referencia))
const campo = () => screen.getByRole('textbox', { name: 'Seu pedido' })
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  setTokens('sintetico', 'sintetico')
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42' ? conversa : { conversas: [conversa] })
  vi.mocked(api.post).mockImplementation(async path => path.endsWith('/mensagens') ? { mensagem: { id: 9, role: 'assistant', conteudo: 'Resposta recebida.' } } : conversa)
  vi.mocked(api.put).mockResolvedValue({})
})

it('restaura novo assunto depois de remount em StrictMode e permite apagar sem ressuscitar', async () => {
  const primeira = montar()
  await screen.findByText('Campanha original')
  fireEvent.change(campo(), { target: { value: 'Briefing ainda não enviado.' } })
  primeira.unmount()
  const segunda = montar()
  await waitFor(() => expect(campo()).toHaveValue('Briefing ainda não enviado.'))
  fireEvent.change(campo(), { target: { value: '' } })
  segunda.unmount()
  montar()
  await screen.findByText('Campanha original')
  expect(campo()).toHaveValue('')
  expect(api.post).not.toHaveBeenCalled()
})

it('restaura conversa selecionada e mantém novo assunto separado depois de reload', async () => {
  const primeira = montar()
  await screen.findByText('Campanha original')
  fireEvent.change(campo(), { target: { value: 'Outro assunto.' } })
  fireEvent.click(screen.getByText('Campanha original'))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/conversas/42', expect.any(AbortSignal)))
  fireEvent.change(campo(), { target: { value: 'Rascunho da campanha.' } })
  primeira.unmount()
  montar()
  await waitFor(() => expect(campo()).toHaveValue('Rascunho da campanha.'))
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  expect(campo()).toHaveValue('Outro assunto.')
})

it('restaura referência estruturada com o texto e a confirma antes da mensagem', async () => {
  const primeira = montar(1, 'predio', { jobId: 77, entregaId: 88, intencao: 'testar' })
  await waitFor(() => expect(campo()).toHaveValue('Preparar próximo teste.'))
  primeira.unmount()
  montar()
  await waitFor(() => expect(campo()).toHaveValue('Preparar próximo teste.'))
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await screen.findByText('Resposta recebida.')
  expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', { job_id: 77, entrega_id: 88, intencao: 'testar' })
  expect(lerRascunhos(escopoRascunhos(1, 'predio', true))).toEqual({})
})

it.each(['predio', 'conteudo'])('a opção da IA em %s preserva o foco da conversa e a referência do rascunho não enviado', async slug => {
  const texto = 'Mude somente a cor da arte da entrega escolhida.'
  const referencia: ReferenciaConversa = { jobId: 77, entregaId: 88, intencao: 'ajustar' }
  const escopo = escopoRascunhos(1, slug, slug === 'predio')
  guardarRascunho(escopo, '42', texto, referencia)
  const comPergunta = {
    ...conversa, organization_id: 1, office_slug: slug === 'predio' ? null : slug,
    trabalho_job_id: 31, anexos: [{ nome: 'camisa.png' }], total_mensagens: 1,
    mensagens: [{ id: 8, role: 'assistant', conteudo: 'Você prefere um exemplo cotidiano?', criado_em: '2026-09-13T00:00:00Z', sugestao_tarefa: { perguntas: ['Você decide'] } }],
  }
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/conversas/42') return comPergunta
    if (/^\/jobs\/\d+$/.test(path)) return { id: Number(path.split('/')[2]), org_id: 1, office_slug: 'conteudo', titulo: 'Trabalho da pergunta', status: 'running' }
    return { conversas: [comPergunta] }
  })
  const montarPergunta = () => render(<StrictMode><MemoryRouter initialEntries={['/app?org=1&conversa=42']}>
    <ConversaTab orgId={1} slug={slug} office={office} nivelPredio={slug === 'predio'} />
  </MemoryRouter></StrictMode>)
  const primeira = montarPergunta()
  await waitFor(() => expect(campo()).toHaveValue(texto))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Você decide' })) })
  await screen.findByText('Resposta recebida.')
  expect(api.post).toHaveBeenCalledWith('/conversas/42/mensagens', { conteudo: 'Você decide' })
  expect.soft(api.put).not.toHaveBeenCalled()
  expect.soft(lerRascunhos(escopo)['42']).toMatchObject({ texto, referencia })
  expect(campo()).toHaveValue(texto)
  expect(screen.getByText('camisa.png')).toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalledWith('/jobs/31')
  expect(screen.getByRole('button', { name: 'Ver aqui do lado' })).toBeInTheDocument()
  expect(api.postForm).not.toHaveBeenCalled()

  primeira.unmount()
  montarPergunta()
  await waitFor(() => expect(campo()).toHaveValue(texto))
  vi.mocked(api.put).mockClear()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enviar' })) })
  await screen.findByText('Resposta recebida.')
  expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', { job_id: 77, entrega_id: 88, intencao: 'ajustar' })
  expect(api.post).toHaveBeenCalledWith('/conversas/42/mensagens', { conteudo: texto })
  expect(lerRascunhos(escopo)).toEqual({})
})

it.each(['empresa', 'area', 'conta'])('não transfere rascunho ao mudar %s', async mudanca => {
  const primeira = montar()
  await screen.findByText('Campanha original')
  fireEvent.change(campo(), { target: { value: 'Conteúdo privado da origem.' } })
  primeira.unmount()
  if (mudanca === 'conta') setTokens('outra-conta', 'outro-refresh')
  montar(mudanca === 'empresa' ? 2 : 1, mudanca === 'area' ? 'conteudo' : 'predio')
  await screen.findByText('Campanha original')
  expect(campo()).toHaveValue('')
})

it('mantém o texto persistido enquanto aguarda envio e não apaga a próxima digitação', async () => {
  let resolver!: (valor: unknown) => void
  const resposta = new Promise(resolve => { resolver = resolve })
  vi.mocked(api.post).mockImplementation(async path => path.endsWith('/mensagens') ? resposta : conversa)
  montar()
  await screen.findByText('Campanha original')
  fireEvent.change(campo(), { target: { value: 'Pedido em envio.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(lerRascunhos(escopoRascunhos(1, 'predio', true))['42']?.texto).toBe('Pedido em envio.'))
  expect(campo()).toHaveValue('')
  fireEvent.change(campo(), { target: { value: 'Minha próxima observação.' } })
  await act(async () => { resolver({ mensagem: { id: 9, role: 'assistant', conteudo: 'Resposta recebida.' } }) })
  expect(campo()).toHaveValue('Minha próxima observação.')
  expect(lerRascunhos(escopoRascunhos(1, 'predio', true))['42']?.texto).toBe('Minha próxima observação.')
})

it('falha de envio continua recuperável depois de recarregar', async () => {
  vi.mocked(api.post).mockImplementation(async path => { if (path.endsWith('/mensagens')) throw new Error('Rede indisponível'); return conversa })
  const primeira = montar()
  await screen.findByText('Campanha original')
  fireEvent.change(campo(), { target: { value: 'Não perder em falha.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(campo()).toHaveValue('Não perder em falha.'))
  primeira.unmount()
  montar()
  await waitFor(() => expect(campo()).toHaveValue('Não perder em falha.'))
})

it('storage bloqueado não trava digitação e informa que o texto está só na tela', async () => {
  montar()
  await screen.findByText('Campanha original')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
  fireEvent.change(campo(), { target: { value: 'Texto na tela.' } })
  expect(campo()).toHaveValue('Texto na tela.')
  expect(screen.getByText(/Este rascunho está só na tela/)).toBeInTheDocument()
})

it('pedido consumido da landing continua como rascunho depois de um segundo reload', async () => {
  guardarPedidoLanding('nonce', 'Briefing que começou na página inicial.', 7)
  const primeira = render(<StrictMode><MemoryRouter initialEntries={['/app?org=1&pedido-inicial=nonce']}><ConversaTab orgId={1} slug="predio" office={office} nivelPredio /></MemoryRouter></StrictMode>)
  await waitFor(() => expect(campo()).toHaveValue('Briefing que começou na página inicial.'))
  primeira.unmount()
  montar()
  await waitFor(() => expect(campo()).toHaveValue('Briefing que começou na página inicial.'))
  expect(api.post).not.toHaveBeenCalled()
})

it('próxima digitação perde só a referência já consumida após sucesso e reload', async () => {
  let resolver!: (valor: unknown) => void
  const resposta = new Promise(resolve => { resolver = resolve })
  vi.mocked(api.post).mockImplementation(async path => path.endsWith('/mensagens') ? resposta : conversa)
  const primeira = montar(1, 'predio', { jobId: 77, entregaId: 88, intencao: 'testar' })
  await waitFor(() => expect(campo()).toHaveValue('Preparar próximo teste.'))
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', { job_id: 77, entrega_id: 88, intencao: 'testar' }))
  fireEvent.change(campo(), { target: { value: 'Uma pergunta nova, sem ajuste.' } })
  await act(async () => { resolver({ mensagem: { id: 9, role: 'assistant', conteudo: 'Resposta recebida.' } }) })
  const guardado = lerRascunhos(escopoRascunhos(1, 'predio', true))['42']
  expect(guardado.texto).toBe('Uma pergunta nova, sem ajuste.')
  expect(guardado.referencia).toBeUndefined()
  primeira.unmount()
  montar()
  await waitFor(() => expect(campo()).toHaveValue('Uma pergunta nova, sem ajuste.'))
  vi.mocked(api.put).mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await screen.findByText('Resposta recebida.')
  expect(api.put).not.toHaveBeenCalled()
})

it('texto idêntico com referência diferente persiste a nova versão escolhida', async () => {
  const primeira = montar(1, 'predio', { jobId: 77, entregaId: 88, intencao: 'testar' })
  await waitFor(() => expect(campo()).toHaveValue('Preparar próximo teste.'))
  primeira.rerender(tela(1, 'predio', { jobId: 99, entregaId: 100, intencao: 'ajustar' }))
  expect(campo()).toHaveValue('Preparar próximo teste.')
  primeira.unmount()
  montar()
  await waitFor(() => expect(campo()).toHaveValue('Preparar próximo teste.'))
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await screen.findByText('Resposta recebida.')
  expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', { job_id: 99, entrega_id: 100, intencao: 'ajustar' })
})

it.each([false, true])('a resposta anterior mantém a nova referência durante o envio, com texto anterior repetido=%s', async repetirTexto => {
  let resolver!: (valor: unknown) => void
  const resposta = new Promise(resolve => { resolver = resolve })
  vi.mocked(api.post).mockImplementation(async path => path.endsWith('/mensagens') ? resposta : conversa)
  const primeira = montar(1, 'predio', { jobId: 77, entregaId: 88, intencao: 'testar' })
  await waitFor(() => expect(campo()).toHaveValue('Preparar próximo teste.'))
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.put).toHaveBeenCalled())
  if (!repetirTexto) fireEvent.change(campo(), { target: { value: 'Sobre outra campanha.' } })
  primeira.rerender(tela(1, 'predio', { jobId: 99, entregaId: 100, intencao: 'ajustar' }))
  await act(async () => { resolver({ mensagem: { id: 9, role: 'assistant', conteudo: 'Resposta recebida.' } }) })
  expect(lerRascunhos(escopoRascunhos(1, 'predio', true))['42'].referencia).toEqual({ jobId: 99, entregaId: 100, intencao: 'ajustar' })
  primeira.unmount()
  montar()
  await waitFor(() => expect(campo()).toHaveValue(repetirTexto ? 'Preparar próximo teste.' : 'Sobre outra campanha.\n\nPreparar próximo teste.'))
})
