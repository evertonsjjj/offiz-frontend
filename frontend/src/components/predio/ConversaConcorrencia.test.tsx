import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversaTab } from './ConversaTab'
import { api, ApiError, setTokens } from '../../lib/api'
import type { ConversaDetalhe, SugestaoDaConversa } from '../../lib/types'
import { consumoDaConversa } from '../../test/consumoFixture'

vi.mock('../../lib/api', async (original) => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() },
}))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
vi.mock('./PainelTrabalho', () => ({ PainelTrabalho: ({ jobId }: { jobId: number }) => <aside>Entrega #{jobId}</aside> }))

const office = { slug: 'predio', nome: 'Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const detalhe = (id: number): ConversaDetalhe => ({ id, titulo: id === 42 ? 'Campanha original' : 'Reunião seguinte', atualizado_em: '2026-09-09T12:00:00Z', total_mensagens: 0, mensagens: [], anexos: [] })
let originais: Record<number, ConversaDetalhe>
const montar = () => render(<MemoryRouter><ConversaTab orgId={1} slug="predio" office={office} nivelPredio /></MemoryRouter>)
function pendente<T>() {
  let resolve!: (valor: T) => void
  let reject!: (erro: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const abrir = async (nome: string) => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${nome}`) }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled())
}
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  originais = { 42: detalhe(42), 43: detalhe(43) }
  vi.mocked(api.get).mockImplementation(async (path) => {
    const consumo = consumoDaConversa(path)
    if (consumo) return consumo
    if (/^\/conversas\/\d+$/.test(path)) return originais[Number(path.split('/').pop())]
    return { conversas: Object.values(originais) }
  })
  vi.mocked(api.post).mockImplementation(async (path) => path.endsWith('/mensagens')
    ? { mensagem: { id: 9, role: 'assistant', conteudo: 'Resposta recebida.', criado_em: '2026-09-09T12:10:00Z' } }
    : detalhe(42))
  vi.mocked(api.put).mockResolvedValue({})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['sucesso', 'falha', 'outra conversa'] as const)('envio próprio controla a rolagem somente após ACK na mesma conversa: %s', async resultado => {
  let altura = 600
  vi.spyOn(HTMLDivElement.prototype, 'scrollHeight', 'get').mockImplementation(() => altura)
  vi.spyOn(HTMLDivElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  const envio = pendente<unknown>()
  vi.mocked(api.post).mockImplementation(() => envio.promise)
  montar()
  await abrir('Campanha original')
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  const thread = document.querySelector<HTMLDivElement>('.conversa-thread')!
  thread.scrollTop = 20
  fireEvent.scroll(thread)
  campo.focus()
  fireEvent.change(campo, { target: { value: 'Deixa o horário maior.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce())
  expect(thread.scrollTop).toBe(20)
  if (resultado === 'outra conversa') {
    await abrir('Reunião seguinte')
    thread.scrollTop = 20
    fireEvent.scroll(thread)
  } else {
    fireEvent.change(campo, { target: { value: 'Meu próximo pedido.' } })
  }
  altura = 900
  await act(async () => {
    if (resultado === 'falha') envio.reject(new ApiError(503, 'Sem resposta'))
    else envio.resolve({ mensagem: { id: 9, role: 'assistant', conteudo: 'Resposta confirmada.', criado_em: '2026-09-09T12:10:00Z' } })
  })
  expect(thread.scrollTop).toBe(resultado === 'sucesso' ? 900 : 20)
  if (resultado !== 'outra conversa') expect(campo).toHaveValue('Meu próximo pedido.')
  expect(api.post).toHaveBeenCalledOnce()
})

it('histórico indisponível tem retry e preserva o pedido sem mostrar vazio falso', async () => {
  vi.mocked(api.get).mockRejectedValue(new ApiError(503, 'offline'))
  montar()
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o histórico')
  expect(screen.queryByText(/Nenhuma conversa ainda/)).not.toBeInTheDocument()
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' }); fireEvent.change(campo, { target: { value: 'Preciso de um post' } })
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? { conversas: Object.values(originais) })
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByRole('button', { name: /^Campanha original/ })
  expect(campo).toHaveValue('Preciso de um post'); expect(api.post).not.toHaveBeenCalled()
})

it('polling sem rede encerra a espera no prazo e não reenvia mensagem', async () => {
  originais[42].mensagens = [{ id: 1, role: 'user', conteudo: 'Quero uma campanha', criado_em: '2026-10-03T12:00:00Z' }]
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.useFakeTimers()
  montar(); await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  fireEvent.click(screen.getByRole('button', { name: /^Campanha original/ }))
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(screen.getByText('Quero uma campanha')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Pensando…' })).toBeDisabled()
  vi.mocked(api.get).mockRejectedValue(new ApiError(0, 'offline'))
  await act(async () => { await vi.advanceTimersByTimeAsync(153000) })
  expect(screen.getByRole('alert')).toHaveTextContent('Seu pedido já foi enviado')
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  expect(api.post).not.toHaveBeenCalled()
})

it('reabrir restaura a conversa e o trabalho; Nova conversa limpa a preferência', async () => {
  setTokens('access-ficticio', 'refresh-ficticio')
  originais[42].trabalho_job_id = 77
  const primeira = montar()
  await abrir('Campanha original')
  expect(screen.queryByText('Entrega #77')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ver aqui do lado' }))
  await screen.findByText('Entrega #77')
  primeira.unmount()
  const segunda = montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Ver aqui do lado' }))
  await screen.findByText('Entrega #77')
  expect(screen.getByRole('button', { name: /^Campanha original/ })).toHaveAttribute('aria-current', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  segunda.unmount()
  montar()
  await screen.findByRole('button', { name: /^Campanha original/ })
  expect(screen.queryByText('Entrega #77')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['login', 'empresa', 'removida', 'pedido'])('não restaura a conversa antiga após mudar %s', async (mudanca) => {
  setTokens('access-ficticio', 'refresh-ficticio')
  const primeira = montar()
  await abrir('Campanha original')
  primeira.unmount()
  vi.mocked(api.get).mockClear()
  if (mudanca === 'login') setTokens('outro-access', 'outro-refresh')
  if (mudanca === 'removida') delete originais[42]
  render(<MemoryRouter initialEntries={[mudanca === 'pedido' ? '/?pergunta=Um%20pedido%20novo' : '/']}><ConversaTab orgId={mudanca === 'empresa' ? 2 : 1} slug="predio" office={office} nivelPredio /></MemoryRouter>)
  await screen.findByRole('button', { name: /^Reunião seguinte/ })
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/conversas/42')).toBe(false)
  if (mudanca === 'pedido') expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Um pedido novo')
})

it('primeiro envio de ajuste na empresa vincula o trabalho antes da mensagem', async () => {
  render(<MemoryRouter initialEntries={['/app?org=1&ajustejob=8&ajustepeca=Apresentação']}><ConversaTab orgId={1} slug="predio" office={office} nivelPredio /></MemoryRouter>)
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Corrija a apresentação mantendo as cores.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', { job_id: 8, entrega_id: null, intencao: 'ajustar' }))
  await waitFor(() => expect(vi.mocked(api.post).mock.calls.some(([url]) => url.endsWith('/mensagens'))).toBe(true))
  const ordemPost = vi.mocked(api.post).mock.invocationCallOrder
  expect(vi.mocked(api.put).mock.invocationCallOrder[0]).toBeLessThan(ordemPost[ordemPost.length - 1])
})

it('mantém um rascunho por conversa e preserva o pedido novo ao navegar no histórico', async () => {
  montar()
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Rascunho livre ainda sem conversa.' } })
  await abrir('Campanha original')
  expect(campo).toHaveValue('')
  fireEvent.change(campo, { target: { value: 'Ajustar a campanha.' } })
  await abrir('Reunião seguinte')
  fireEvent.change(campo, { target: { value: 'Levar os números atualizados.' } })
  await abrir('Campanha original')
  expect(campo).toHaveValue('Ajustar a campanha.')
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  expect(campo).toHaveValue('Rascunho livre ainda sem conversa.')
  expect(api.post).not.toHaveBeenCalled()
})

it('falha tardia no envio não invade outro histórico e recupera o pedido na origem', async () => {
  const envio = pendente<unknown>()
  vi.mocked(api.post).mockImplementation(() => envio.promise)
  montar()
  await abrir('Campanha original')
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Pedido da campanha.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalled())
  await abrir('Reunião seguinte')
  fireEvent.change(campo, { target: { value: 'Rascunho da reunião.' } })
  await act(async () => envio.reject(new ApiError(503, 'Sem conexão agora.')))
  expect(campo).toHaveValue('Rascunho da reunião.')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await abrir('Campanha original')
  expect(campo).toHaveValue('Pedido da campanha.')
})

it('criação lenta da conversa não apaga texto digitado depois de enviar', async () => {
  const criacao = pendente<ConversaDetalhe>()
  vi.mocked(api.post).mockImplementation(async (path) => path.endsWith('/mensagens')
    ? { mensagem: { id: 9, role: 'assistant', conteudo: 'Resposta recebida.', criado_em: '2026-09-09T12:10:00Z' } }
    : criacao.promise)
  montar()
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Meu primeiro pedido.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  expect(campo).toHaveValue('')
  fireEvent.change(campo, { target: { value: 'Já estou escrevendo a próxima observação.' } })
  await act(async () => criacao.resolve(detalhe(42)))
  await screen.findByText('Resposta recebida.')
  expect(campo).toHaveValue('Já estou escrevendo a próxima observação.')
  expect(api.post).toHaveBeenCalledWith('/conversas/42/mensagens', expect.objectContaining({ conteudo: 'Meu primeiro pedido.' }))
})

it.each([
  { nome: 'tarefa', sugestao: { andar: 'conteudo', titulo: 'Vídeo da campanha', prompt: 'Prepare o vídeo aprovado.' }, botao: 'Sim, iniciar tarefa', caminho: '/predios/1/conteudo/jobs', resultado: { id: 77 } },
  { nome: 'plano', sugestao: { titulo: 'Campanha completa', prompt: 'Prepare as peças.', etapas: [{ andar: 'conteudo', titulo: 'Roteiro', prompt: 'Escreva o roteiro.' }, { andar: 'video', titulo: 'Filme', prompt: 'Prepare o vídeo.' }] }, botao: 'Sim, iniciar o plano', caminho: '/orgs/1/predio/planos', resultado: { etapas: [{ job_id: 77 }] } },
  { nome: 'retomada', sugestao: { tipo: 'devolutiva', job_id: 50 }, botao: 'Já enviei — retomar a tarefa', caminho: '/jobs/50/continuar', resultado: { id: 77 } },
])('$nome iniciada antes da troca continua vinculada à conversa original', async ({ sugestao, botao, caminho, resultado }) => {
  originais[42].mensagens = [{ id: 100, role: 'assistant', criado_em: '2026-09-09T12:00:00Z', conteudo: 'Preparei a proposta para sua aprovação.', sugestao_tarefa: sugestao as SugestaoDaConversa }]
  const criacao = pendente<unknown>()
  vi.mocked(api.post).mockImplementation(() => criacao.promise)
  montar()
  await abrir('Campanha original')
  fireEvent.click(await screen.findByRole('button', { name: botao }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(caminho, expect.anything()))
  await abrir('Reunião seguinte')
  await act(async () => criacao.resolve(resultado))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', expect.objectContaining({ job_id: 77 })))
  expect(api.put).not.toHaveBeenCalledWith('/conversas/43/trabalho', expect.anything())
  expect(screen.queryByText('Entrega #77')).not.toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem('offiz:sugestoes:1:42')!)).toMatchObject({ 100: 'iniciada' })
  expect(localStorage.getItem('offiz:sugestoes:1:43')).not.toContain('100')
})

it('anexo concluído depois de trocar conversa não aparece como material da outra', async () => {
  const upload = pendente<unknown>()
  vi.mocked(api.postForm).mockImplementation(() => upload.promise)
  const { container } = montar()
  await abrir('Campanha original')
  fireEvent.change(container.querySelector('input[type="file"][accept*=".mp4"]')!, { target: { files: [new File(['briefing'], 'brief-campanha.txt', { type: 'text/plain' })] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalledWith('/conversas/42/anexos', expect.any(FormData)))
  await abrir('Reunião seguinte')
  await act(async () => upload.resolve({ nome: 'brief-campanha.txt', legivel: true, anexos: ['brief-campanha.txt'] }))
  expect(screen.queryByText('brief-campanha.txt')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
})

it('libera o microfone se a permissão chegar depois de trocar a conversa', async () => {
  const permissao = pendente<MediaStream>()
  const pararTrilha = vi.fn()
  const criarGravador = vi.fn()
  const mediaDevicesOriginal = navigator.mediaDevices
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => permissao.promise) } })
  vi.stubGlobal('MediaRecorder', criarGravador)
  try {
    montar()
    await abrir('Campanha original')
    fireEvent.click(screen.getByRole('button', { name: 'Falar em vez de escrever' }))
    await abrir('Reunião seguinte')
    await act(async () => permissao.resolve({ getTracks: () => [{ stop: pararTrilha }] } as unknown as MediaStream))
    expect(pararTrilha).toHaveBeenCalledOnce()
    expect(criarGravador).not.toHaveBeenCalled()
    expect(api.postForm).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('')
  } finally {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevicesOriginal })
  }
})
