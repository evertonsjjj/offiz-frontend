import { consumoDaConversa } from '../../test/consumoFixture'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Profiler } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversaTab } from './ConversaTab'
import { api, setTokens } from '../../lib/api'
import { escopoRascunhos, guardarRascunho, lerRascunhos } from '../../lib/rascunhosConversa'
import type { ConversaDetalhe } from '../../lib/types'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn(), del: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
vi.mock('./PainelTrabalho', () => ({ PainelTrabalho: ({ jobId }: { jobId: number }) => <aside aria-label="Entrega da conversa">Entrega #{jobId}</aside> }))

const office = { slug: 'predio', nome: 'Clube Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const detalhe: ConversaDetalhe = { id: 42, organization_id: 1, office_slug: null, titulo: 'Campanha da camisa', atualizado_em: '2026-10-08T12:00:00Z', total_mensagens: 1,
  mensagens: [{ id: 99, role: 'assistant', conteudo: 'Vou produzir o post da camisa.', criado_em: '2026-10-08T12:00:00Z', sugestao_tarefa: { titulo: 'Post da camisa', prompt: 'Produzir o post com a camisa oficial.', andar: 'conteudo' } }],
  tarefas_iniciadas: [99], anexos: [{ nome: 'camisa.png', chars: 0, nome_exibicao: 'Camisa oficial.png' }], trabalho_job_id: 77 }
const outra = { ...detalhe, id: 43, titulo: 'Outra campanha', mensagens: [{ id: 100, role: 'assistant' as const, conteudo: 'Outro assunto.' }], anexos: [], trabalho_job_id: null }
const tela = (orgId = 1, query = '?org=1&conversa=42') => <MemoryRouter initialEntries={[`/app${query}`]}><ConversaTab orgId={orgId} slug="predio" office={office} nivelPredio /></MemoryRouter>
const campo = () => screen.getByRole('textbox', { name: 'Seu pedido' })
const aguardarCampo = () => screen.findByRole('textbox', { name: 'Seu pedido' })
const retry = () => screen.getByRole('button', { name: 'Carregar conversa novamente' })

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  setTokens('sintetico', 'sintetico')
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path.endsWith('/conversas') ? { conversas: [detalhe, outra] } : path === '/conversas/42' ? detalhe : outra))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('conclusão contábil ainda organizando arquivos não vira sucesso vazio no chat', async () => {
  const consolidando: ConversaDetalhe = { ...detalhe, trabalhos: [
    { id: 77, titulo: 'Chamada de jogo', status: 'done', finalizando: true,
      entregas: [{ id: 88, nome: 'post.png', tipo: 'imagem', status: 'pendente' }] },
  ] }
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path.endsWith('/conversas') ? { conversas: [consolidando] } : consolidando))
  render(tela())
  expect(await screen.findByText('Organizando arquivos')).toBeInTheDocument()
  expect(screen.queryByText('Concluído')).not.toBeInTheDocument()
  expect(screen.queryByText('Pronto para revisar')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Ver entrega' })).not.toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Entrega da conversa' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('fallback da conversa acompanha consolidação quando o último evento websocket se perde', async () => {
  vi.useFakeTimers()
  try {
    let finalizando = true
    let consultas = 0
    const atual = (): ConversaDetalhe => ({ ...detalhe, trabalhos: [
      { id: 77, titulo: 'Chamada de jogo', status: 'done', finalizando,
        entregas: finalizando ? [] : [{ id: 88, nome: 'post.png', tipo: 'imagem', status: 'pendente' }] },
    ] })
    vi.mocked(api.get).mockImplementation(async path => {
      const consumo = consumoDaConversa(path)
      if (consumo) return consumo
      if (path.endsWith('/conversas')) return { conversas: [atual()] }
      consultas += 1
      return atual()
    })
    render(tela())
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText('Organizando arquivos')).toBeInTheDocument()
    finalizando = false
    const antes = consultas
    await act(async () => vi.advanceTimersByTimeAsync(10000))
    expect(consultas).toBeGreaterThan(antes)
    expect(screen.queryByText('Organizando arquivos')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver entrega' })).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})

it('título longo conserva o nome acessível e completo sem alterar o pedido ao trocar de assunto', async () => {
  const titulo = 'Faz a chamada do Clube Aurora x Clube Horizonte, dia 17/10 às 18h no Estádio Central. Usa nossas fotos do acervo. Preciso de post e story com a identidade do clube.'
  const conversaLonga = { ...detalhe, titulo }
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path.endsWith('/conversas')
    ? { conversas: [conversaLonga, outra] }
    : path === '/conversas/42' ? conversaLonga : outra))
  render(tela())
  await screen.findByText('Vou produzir o post da camisa.')
  const assunto = screen.getByRole('heading', { level: 1, name: titulo })
  expect(assunto.textContent).toBe(titulo)
  expect(assunto).toHaveAttribute('title', titulo)
  expect(assunto).toHaveAttribute('tabindex', '-1')
  assunto.focus()
  expect(assunto).toHaveFocus()
  fireEvent.change(await aguardarCampo(), { target: { value: 'Meu ajuste ainda não enviado.' } })
  fireEvent.click(screen.getByRole('button', { name: /^Outra campanha/ }))
  await screen.findByText('Outro assunto.')
  const outroAssunto = screen.getByRole('heading', { level: 1, name: 'Outra campanha' })
  expect(outroAssunto).toHaveAttribute('title', 'Outra campanha')
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${titulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }))
  await screen.findByText('Vou produzir o post da camisa.')
  expect(screen.getByRole('heading', { level: 1, name: titulo })).toHaveAttribute('title', titulo)
  expect(await aguardarCampo()).toHaveValue('Meu ajuste ainda não enviado.')
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it.each([false, true])('devolutiva formal distingue falta de material de arte parcial disponível (%s)', async temArte => {
  const bloqueada: ConversaDetalhe = { ...detalhe,
    mensagens: [...detalhe.mensagens, { id: 103, role: 'assistant', conteudo: 'Envie a foto original para continuar.', criado_em: '2026-10-08T12:05:00Z',
      sugestao_tarefa: { tipo: 'devolutiva', job_id: 77, entrega_id: 88, titulo: 'Chamada de jogo' } }],
    trabalhos: [{ id: 77, titulo: 'Chamada de jogo', status: 'done', entregas: temArte
      ? [{ id: 89, nome: 'post.png', tipo: 'imagem', status: 'pendente' }] : [] }] }
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path.endsWith('/conversas') ? { conversas: [bloqueada] } : bloqueada))
  render(tela())
  await screen.findByText('Envie a foto original para continuar.')
  if (temArte) {
    expect(screen.getByText('Pronto para revisar')).toBeInTheDocument()
    expect(screen.getByText('post.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver entrega' })).toBeInTheDocument()
    expect(screen.queryByText('Falta material')).not.toBeInTheDocument()
  } else {
    expect(screen.getByText('Falta material')).toBeInTheDocument()
    expect(screen.queryByText('Pronto para revisar')).not.toBeInTheDocument()
    expect(screen.queryByText('Concluído')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver entrega' })).not.toBeInTheDocument()
  }
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it.each(['outro-job', 'fala-humana', 'texto-sem-cartao'] as const)('não infere bloqueio de material por %s', async origem => {
  const mensagem = { id: 103, role: origem === 'fala-humana' ? 'user' as const : 'assistant' as const,
    conteudo: 'Falta material para continuar.', criado_em: '2026-10-08T12:05:00Z', sugestao_tarefa: origem === 'texto-sem-cartao' ? undefined
      : { tipo: 'devolutiva' as const, job_id: origem === 'outro-job' ? 999 : 77, entrega_id: 88, titulo: 'Chamada de jogo' } }
  const semCartaoValido: ConversaDetalhe = { ...detalhe, mensagens: [...detalhe.mensagens, mensagem],
    trabalhos: [{ id: 77, titulo: 'Chamada de jogo', status: 'done', entregas: [] }] }
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path.endsWith('/conversas') ? { conversas: [semCartaoValido] } : semCartaoValido))
  render(tela())
  await screen.findByText('Falta material para continuar.')
  expect(screen.queryByText('Falta material', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByText('Concluído')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('link existente aguarda autorização sem exibir nem misturar o rascunho de novo assunto', async () => {
  const escopo = escopoRascunhos(1, 'predio', true)
  guardarRascunho(escopo, 'nova', 'Pedido de outro assunto ainda não enviado.')
  guardarRascunho(escopo, '42', 'Ajuste ainda não enviado da camisa.')
  let autorizar!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path.endsWith('/conversas') ? new Promise(resolve => { autorizar = resolve }) : detalhe))
  render(tela())
  expect(screen.getByRole('status')).toHaveTextContent('Carregando mensagens e anexos desta conversa')
  expect(screen.queryByRole('textbox', { name: 'Seu pedido' })).not.toBeInTheDocument()
  expect(screen.queryByText(/é aqui que o trabalho começa/)).not.toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/conversas/42')).toBe(false)
  await act(async () => autorizar({ conversas: [detalhe] }))
  await screen.findByText('Vou produzir o post da camisa.')
  expect(await aguardarCampo()).toHaveValue('Ajuste ainda não enviado da camisa.')
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  expect(campo()).toHaveValue('Pedido de outro assunto ainda não enviado.')
  expect(api.post).not.toHaveBeenCalled()
})

it('falha inicial deixa assunto identificado e recupera todos os insumos sem reenviar nem perder rascunho', async () => {
  let consultas = 0
  vi.mocked(api.get).mockImplementation(async path => {
    const consumo = consumoDaConversa(path)
    if (consumo) return consumo
    if (path.endsWith('/conversas')) return { conversas: [detalhe] }
    if (path === '/conversas/42' && ++consultas === 1) throw new Error('Rede indisponível')
    return detalhe
  })
  render(tela())
  await screen.findByText('Não foi possível abrir a conversa.')
  expect(screen.getByRole('heading', { name: 'Campanha da camisa' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Abrindo conversa…' })).not.toBeInTheDocument()
  fireEvent.change(await aguardarCampo(), { target: { value: 'Conservar este ajuste durante a consulta.' } })
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Anexar' })).toBeDisabled()
  fireEvent.keyDown(campo(), { key: 'Enter' })
  fireEvent.change(screen.getByLabelText('Anexar arquivos à conversa'), { target: { files: [new File(['fixture'], 'novo.png', { type: 'image/png' })] } })
  expect(api.post).not.toHaveBeenCalled()
  expect(api.postForm).not.toHaveBeenCalled()
  fireEvent.click(retry())
  await screen.findByText('Vou produzir o post da camisa.')
  expect(screen.getByRole('button', { name: 'Remover Camisa oficial.png da conversa' })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Entrega da conversa' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ver aqui do lado' }))
  expect(screen.getByRole('complementary', { name: 'Entrega da conversa' })).toHaveTextContent('#77')
  expect(screen.queryByRole('button', { name: 'Sim, iniciar tarefa' })).not.toBeInTheDocument()
  expect(screen.queryByText('Não foi possível abrir a conversa.')).not.toBeInTheDocument()
  expect(await aguardarCampo()).toHaveValue('Conservar este ajuste durante a consulta.')
  expect(lerRascunhos(escopoRascunhos(1, 'predio', true))['42'].texto).toBe('Conservar este ajuste durante a consulta.')
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  await waitFor(() => expect(campo()).toHaveFocus())
  expect(api.post).not.toHaveBeenCalled()
})

it('resumo autorizado conserva o assunto durante leitura lenta e falha posterior', async () => {
  let falhar!: (erro: Error) => void
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path.endsWith('/conversas')
    ? { conversas: [detalhe] }
    : new Promise((_resolve, reject) => { falhar = reject })))
  render(tela())
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/conversas/42')).toBe(true))
  expect(screen.getByRole('region', { name: 'Conversa atual' })).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('heading', { name: 'Campanha da camisa' })).toBeInTheDocument()
  expect(screen.queryByText('Vou produzir o post da camisa.')).not.toBeInTheDocument()
  await act(async () => falhar(new Error('Rede sintética indisponível')))
  await screen.findByText('Não foi possível abrir a conversa.')
  expect(screen.getByRole('heading', { name: 'Campanha da camisa' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Conversa atual' })).toHaveAttribute('aria-busy', 'false')
  expect(api.post).not.toHaveBeenCalled()
})

it('cada commit após autorizar o link identifica o assunto, inclusive com falha imediata na leitura', async () => {
  let autorizar!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async path => {
    const consumo = consumoDaConversa(path)
    if (consumo) return consumo
    if (path.endsWith('/conversas')) return new Promise(resolve => { autorizar = resolve })
    throw new Error('Rede sintética indisponível')
  })
  const commits: { titulo: string | null; autorizado: boolean; erro: boolean; ocupado: string | null; carregando: boolean }[] = []
  render(<Profiler id="selecionar-assunto" onRender={() => {
    commits.push({
      titulo: document.querySelector('h1')?.textContent ?? null,
      autorizado: screen.queryByRole('button', { name: /^Campanha da camisa/ }) != null,
      erro: screen.queryByText('Não foi possível abrir a conversa.') != null,
      ocupado: screen.getByRole('region', { name: 'Conversa atual' }).getAttribute('aria-busy'),
      carregando: screen.queryByText('Carregando mensagens e anexos desta conversa…') != null,
    })
  }}>{tela()}</Profiler>)
  expect(screen.getByRole('heading', { name: 'Abrindo conversa…' })).toBeInTheDocument()
  await act(async () => autorizar({ conversas: [detalhe] }))
  await screen.findByText('Não foi possível abrir a conversa.')
  const autorizados = commits.filter(c => c.autorizado)
  expect(autorizados.length).toBeGreaterThan(0)
  expect(autorizados.every(c => c.titulo === 'Campanha da camisa')).toBe(true)
  const falhados = autorizados.filter(c => c.erro)
  expect(falhados.length).toBeGreaterThan(0)
  expect(falhados.every(c => c.ocupado === 'false' && !c.carregando)).toBe(true)
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Anexar' })).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.postForm).not.toHaveBeenCalled()
})

it('retorno à janela recupera leitura falhada incluindo anexos e confirmação já iniciada', async () => {
  let consultas = 0
  vi.mocked(api.get).mockImplementation(async path => {
    const consumo = consumoDaConversa(path)
    if (consumo) return consumo
    if (path.endsWith('/conversas')) return { conversas: [detalhe] }
    if (++consultas === 1) throw new Error('Rede indisponível')
    return detalhe
  })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  render(tela())
  await screen.findByText('Não foi possível abrir a conversa.')
  fireEvent.change(await aguardarCampo(), { target: { value: 'Rascunho para quando a rede voltar.' } })
  fireEvent.focus(window)
  await screen.findByText('Vou produzir o post da camisa.')
  expect(screen.getByRole('button', { name: 'Remover Camisa oficial.png da conversa' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Sim, iniciar tarefa' })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(await aguardarCampo()).toHaveValue('Rascunho para quando a rede voltar.')
  expect(api.post).not.toHaveBeenCalled()
})

it('não duplica consulta durante carregamento e descarta resposta recuperada de outra seleção', async () => {
  let consultas = 0
  let concluir!: (valor: ConversaDetalhe) => void
  let signal!: AbortSignal
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.mocked(api.get).mockImplementation(async (path, s) => {
    const consumo = consumoDaConversa(path)
    if (consumo) return consumo
    if (path.endsWith('/conversas')) return { conversas: [detalhe, outra] }
    if (path === '/conversas/43') return outra
    if (++consultas === 1) throw new Error('Rede indisponível')
    signal = s!
    return new Promise(resolve => { concluir = resolve })
  })
  render(tela())
  await screen.findByText('Não foi possível abrir a conversa.')
  fireEvent.click(retry())
  fireEvent.focus(window); fireEvent.focus(window)
  expect(consultas).toBe(2)
  fireEvent.click(screen.getByRole('button', { name: /^Outra campanha/ }))
  await screen.findByText('Outro assunto.')
  expect(signal.aborted).toBe(true)
  fireEvent.change(await aguardarCampo(), { target: { value: 'Rascunho da outra campanha.' } })
  await act(async () => concluir(detalhe))
  expect(screen.getByRole('heading', { name: 'Outra campanha' })).toBeInTheDocument()
  expect(screen.queryByText('Camisa oficial.png')).not.toBeInTheDocument()
  expect(screen.queryByText('Vou produzir o post da camisa.')).not.toBeInTheDocument()
  expect(campo()).toHaveValue('Rascunho da outra campanha.')
})

it('refresh após falha de envio não apaga o aviso nem o pedido para tentar novamente', async () => {
  let atualizarHistorico = false
  const historicoAtualizado: ConversaDetalhe = { ...detalhe, mensagens: [...detalhe.mensagens, { id: 101, role: 'assistant', conteudo: 'Histórico atualizado após recuperar a conexão.', criado_em: '2026-10-08T12:05:00Z' }] }
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path.endsWith('/conversas')
    ? { conversas: [detalhe, outra] }
    : path === '/conversas/42' ? atualizarHistorico ? historicoAtualizado : detalhe : outra))
  vi.mocked(api.post).mockRejectedValue(new Error('Rede indisponível'))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  render(tela())
  await screen.findByText('Vou produzir o post da camisa.')
  // O histórico pode aparecer antes de a seleção terminar de montar o composer.
  // Esperar os controles reais, em vez de inferir prontidão pela mensagem.
  await aguardarCampo()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled())
  fireEvent.change(campo(), { target: { value: 'Meu ajuste ainda precisa ser enviado.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  const alerta = await screen.findByRole('alert')
  const textoErro = alerta.textContent
  const chamadas = vi.mocked(api.get).mock.calls.length
  atualizarHistorico = true
  fireEvent.focus(window)
  await screen.findByText('Histórico atualizado após recuperar a conexão.')
  expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(chamadas)
  expect(screen.getByRole('alert')).toHaveTextContent(textoErro!)
  expect(campo()).toHaveValue('Meu ajuste ainda precisa ser enviado.')
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('trocar empresa remove insumos e painel anteriores e usa o contexto atual na recuperação', async () => {
  let falhar = true
  const destino: ConversaDetalhe = { ...outra, id: 44, organization_id: 2, titulo: 'Campanha da outra empresa', mensagens: [{ id: 104, role: 'assistant', conteudo: 'Histórico autorizado da outra empresa.', criado_em: '2026-10-08T12:00:00Z' }], anexos: [{ nome: 'destino.png', chars: 0 }] }
  vi.mocked(api.get).mockImplementation(async path => {
    const consumo = consumoDaConversa(path)
    if (consumo) return consumo
    if (path === '/orgs/1/predio/conversas') return { conversas: [detalhe] }
    if (path === '/orgs/2/predio/conversas') return { conversas: [destino] }
    if (path === '/conversas/44') { if (falhar) throw new Error('Rede indisponível'); return destino }
    return detalhe
  })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const view = render(tela(1, '?org=1&conversa=nova'))
  fireEvent.click(await screen.findByRole('button', { name: /^Campanha da camisa/ }))
  await screen.findByText('Vou produzir o post da camisa.')
  view.rerender(tela(2, '?org=2&conversa=nova'))
  await screen.findByText('Campanha da outra empresa')
  expect(screen.queryByText('Camisa oficial.png')).not.toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Entrega da conversa' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^Campanha da outra empresa/ }))
  await screen.findByText('Não foi possível abrir a conversa.')
  falhar = false
  fireEvent.focus(window)
  await screen.findByText('Histórico autorizado da outra empresa.')
  expect(screen.getByRole('button', { name: 'Remover destino.png da conversa' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('detalhe de outro assunto na mesma empresa não entra no lugar da seleção autorizada', async () => {
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path.endsWith('/conversas') ? { conversas: [detalhe] } : outra))
  render(tela())
  await screen.findByText('Não foi possível abrir a conversa.')
  expect(screen.queryByText('Outro assunto.')).not.toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Enviar' })).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
})

it('atalho de pedido conserva o texto que o cliente já escreveu e não inicia trabalho', async () => {
  render(<MemoryRouter initialEntries={['/app?org=1&conversa=nova']}><ConversaTab orgId={1} slug="predio" office={{ ...office, prompts_prontos: [{ id: 1, titulo: 'Faz um post da camisa.', descricao: 'Use a camisa do acervo.' }] }} nivelPredio /></MemoryRouter>)
  await screen.findByText('Campanha da camisa')
  fireEvent.change(await aguardarCampo(), { target: { value: 'Para a campanha de amanhã, mantenha nossa identidade.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Faz um post da camisa.' }))
  expect(campo()).toHaveValue('Para a campanha de amanhã, mantenha nossa identidade.\nFaz um post da camisa.')
  expect(campo()).toHaveFocus()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.postForm).not.toHaveBeenCalled()
})

it('consulta que não termina libera recuperação sem perder texto nem aceitar retorno vencido', async () => {
  vi.useFakeTimers()
  let concluir!: (valor: ConversaDetalhe) => void
  let sinal!: AbortSignal
  let consultas = 0
  vi.mocked(api.get).mockImplementation(async (path, signal) => {
    const consumo = consumoDaConversa(path)
    if (consumo) return consumo
    if (path.endsWith('/conversas')) return { conversas: [detalhe] }
    if (++consultas === 1) { sinal = signal!; return new Promise(resolve => { concluir = resolve }) }
    return detalhe
  })
  render(tela())
  await act(async () => vi.advanceTimersByTimeAsync(0))
  fireEvent.change(campo(), { target: { value: 'Rascunho escrito durante a consulta.' } })
  await act(async () => vi.advanceTimersByTimeAsync(30_000))
  expect(sinal.aborted).toBe(true)
  expect(screen.getByRole('alert')).toHaveTextContent('A consulta demorou demais.')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(campo()).toHaveValue('Rascunho escrito durante a consulta.')
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  fireEvent.click(retry())
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(screen.getByText('Vou produzir o post da camisa.')).toBeInTheDocument()
  await act(async () => concluir({ ...detalhe, mensagens: [], anexos: [] }))
  expect(screen.getByRole('button', { name: 'Remover Camisa oficial.png da conversa' })).toBeInTheDocument()
  expect(campo()).toHaveValue('Rascunho escrito durante a consulta.')
  expect(api.post).not.toHaveBeenCalled()
})
