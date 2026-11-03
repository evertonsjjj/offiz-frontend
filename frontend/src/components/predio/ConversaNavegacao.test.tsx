import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ConversaTab } from './ConversaTab'
import { api, setTokens } from '../../lib/api'
import { escopoRascunhos, lerRascunhos } from '../../lib/rascunhosConversa'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
const office = { slug: 'predio', nome: 'Clube Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const conversas = [42, 43].map(id => ({ id, organization_id: 1, office_slug: null, titulo: `Campanha ${id}`, atualizado_em: '2026-10-07T12:00:00Z', total_mensagens: 1, mensagens: [{ id, role: 'assistant', conteudo: `Histórico ${id}` }], anexos: [] }))
function Endereco() {
  const { search } = useLocation()
  const navegar = useNavigate()
  return <div><output aria-label="Endereço atual">{search}</output><button onClick={() => navegar(-1)}>Voltar navegador</button><button onClick={() => navegar(1)}>Avançar navegador</button>
    <button onClick={() => navegar('/app?org=1&conversa=42&ajustepeca=Post%20da%20camisa&ajustejob=77')}>Ajuste por link</button>
    <button onClick={() => navegar('/app?org=1&conversa=42&pergunta=Quero%20entender%20minha%20marca')}>Pergunta por link</button></div>
}
const montar = (query = '?org=1&conversa=nova') => render(<MemoryRouter initialEntries={[`/app${query}`]}><Endereco /><ConversaTab orgId={1} slug="predio" office={office} nivelPredio /></MemoryRouter>)
const campo = () => screen.getByRole('textbox', { name: 'Seu pedido' })
const escolher = (id: number) => fireEvent.click(within(screen.getByRole('complementary', { name: 'Suas conversas' })).getByRole('button', { name: new RegExp(`^Campanha ${id}`) }))
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  setTokens('sintetico', 'sintetico')
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/conversas') ? { conversas } : conversas.find(c => path === `/conversas/${c.id}`) || {})
  vi.mocked(api.post).mockResolvedValue({})
})

it('deep link abre somente o assunto da lista autorizada e preserva o destino de entrega', async () => {
  montar('?org=1&vista=biblioteca&trabalho=77&conversa=42')
  expect(await screen.findByText('Histórico 42')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Campanha 42' })).toBeInTheDocument()
  expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('trabalho=77')
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['999', '-1', '9007199254740993', 'abc'])('não consulta uma conversa fora da lista ou inválida: %s', async id => {
  montar(`?org=1&conversa=${id}`)
  expect(await screen.findByText(/Esta conversa não está disponível nesta empresa e área/)).toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.filter(([p]) => p.startsWith('/conversas/'))).toEqual([])
  expect(api.post).not.toHaveBeenCalled()
})

it('Voltar e Avançar recuperam assunto e rascunho sem misturar pedidos', async () => {
  montar()
  await screen.findByText('Campanha 42')
  fireEvent.change(campo(), { target: { value: 'Pedido ainda novo' } })
  escolher(42)
  await screen.findByText('Histórico 42')
  fireEvent.change(campo(), { target: { value: 'Ajuste da campanha 42' } })
  escolher(43)
  await screen.findByText('Histórico 43')
  fireEvent.change(campo(), { target: { value: 'Observação da campanha 43' } })
  fireEvent.click(screen.getByRole('button', { name: 'Voltar navegador' }))
  await screen.findByText('Histórico 42')
  expect(campo()).toHaveValue('Ajuste da campanha 42')
  fireEvent.click(screen.getByRole('button', { name: 'Voltar navegador' }))
  await waitFor(() => expect(campo()).toHaveValue('Pedido ainda novo'))
  expect(screen.queryByText('Histórico 42')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Avançar navegador' }))
  await screen.findByText('Histórico 42')
  expect(campo()).toHaveValue('Ajuste da campanha 42')
  expect(api.post).not.toHaveBeenCalled()
})

it('fechar a entrega identifica a conversa sem focar edição e conserva texto e vínculo', async () => {
  const conversa = { ...conversas[0], trabalho_job_id: 77, trabalhos: [{ id: 77, status: 'done', titulo: 'Campanha pronta', entregas: [] }] }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/conversas') ? { conversas: [conversa] } : path === '/conversas/42' ? conversa : path === '/jobs/77' ? { id: 77, status: 'done', pedido: 'Campanha pronta' } : { arquivos: [] })
  montar('?org=1&conversa=42')
  await screen.findByText('Histórico 42')
  fireEvent.change(campo(), { target: { value: 'Quero ajustar a chamada sem perder esta versão.' } })
  expect(screen.queryByRole('complementary', { name: 'A entrega desta conversa' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ver aqui do lado' }))
  const painel = screen.getByRole('complementary', { name: 'A entrega desta conversa' })
  const voltar = within(painel).getByRole('button', { name: 'Voltar à conversa' })
  voltar.focus()
  fireEvent.click(voltar)
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Campanha 42' })).toHaveFocus())
  expect(campo()).not.toHaveFocus()
  expect(campo()).toHaveValue('Quero ajustar a chamada sem perder esta versão.')
  expect(screen.queryByRole('complementary', { name: 'A entrega desta conversa' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ver a entrega' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ver a entrega' }))
  expect(screen.getByRole('complementary', { name: 'A entrega desta conversa' })).toBeInTheDocument()
  expect(campo()).toHaveValue('Quero ajustar a chamada sem perder esta versão.')
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it('voltar de entrega vinculada a conversa nova foca a região sem abrir edição', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/conversas') ? { conversas } : path === '/jobs/77' ? { id: 77, status: 'done', pedido: 'Campanha pronta' } : { arquivos: [] })
  montar('?org=1&conversa=nova&ajustepeca=Campanha%20pronta&ajustejob=77')
  const painel = await screen.findByRole('complementary', { name: 'A entrega desta conversa' })
  fireEvent.click(within(painel).getByRole('button', { name: 'Voltar à conversa' }))
  expect(screen.getByRole('region', { name: 'Conversa atual' })).toHaveFocus()
  expect(campo()).not.toHaveFocus()
  expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('conversa=nova')
  expect(campo()).toHaveValue('Sobre a entrega “Campanha pronta”, o que eu gostaria de ajustar: ')
  fireEvent.click(screen.getByRole('button', { name: 'Ver a entrega' }))
  expect(screen.getByRole('complementary', { name: 'A entrega desta conversa' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('resposta atrasada de outra seleção não troca o assunto nem seu endereço', async () => {
  let resolver!: (v: unknown) => void
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/conversas') ? { conversas } : path === '/conversas/42' ? new Promise(resolve => { resolver = resolve }) : conversas[1])
  montar()
  await screen.findByText('Campanha 42')
  escolher(42)
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/conversas/42', expect.any(AbortSignal)))
  escolher(43)
  await screen.findByText('Histórico 43')
  await act(async () => resolver(conversas[0]))
  expect(screen.getByRole('heading', { name: 'Campanha 43' })).toBeInTheDocument()
  expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('conversa=43')
  expect(screen.queryByText('Histórico 42')).not.toBeInTheDocument()
})

it('busca o histórico pelo título e mostra estado do pedido sem enviar mensagem', async () => {
  vi.mocked(api.get).mockResolvedValue({ conversas: [{ ...conversas[0], sinal: 'trabalhando' }, conversas[1]] })
  montar()
  const busca = await screen.findByRole('searchbox', { name: 'Buscar conversa' })
  expect(screen.getByText('Em produção')).toBeInTheDocument()
  fireEvent.change(busca, { target: { value: '43' } })
  expect(screen.queryByText('Campanha 42')).not.toBeInTheDocument()
  expect(screen.getByText('Campanha 43')).toBeInTheDocument()
  fireEvent.change(busca, { target: { value: 'inexistente' } })
  expect(screen.getByText('Nenhuma conversa encontrada. Tente outro nome.')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('detalhe que contradiz a empresa da lista não é exibido', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/conversas') ? { conversas } : { ...conversas[0], organization_id: 2 })
  montar('?org=1&conversa=42')
  expect(await screen.findByText('Não foi possível abrir a conversa.')).toBeInTheDocument()
  expect(screen.queryByText('Histórico 42')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it.each([
  ['pergunta=Quero%20entender%20minha%20marca', 'Quero entender minha marca'],
  ['ajustepeca=Post%20da%20camisa&ajustejob=77', 'Sobre a entrega “Post da camisa”, o que eu gostaria de ajustar: '],
])('atalho legado %s abre um assunto novo sem restaurar o histórico indicado na URL antiga', async (atalho, semente) => {
  montar(`?org=1&conversa=42&${atalho}`)
  await screen.findByText('Campanha 42')
  await waitFor(() => expect(campo()).toHaveValue(semente))
  expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('conversa=nova')
  expect(screen.queryByText('Histórico 42')).not.toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/conversas/42')).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it.each([
  ['Ajuste por link', 'Sobre a entrega “Post da camisa”, o que eu gostaria de ajustar: '],
  ['Pergunta por link', 'Quero entender minha marca'],
])('%s durante upload pendente limpa os anexos e operações antigos sem perder os rascunhos', async (botao, semente) => {
  let concluir!: (resposta: unknown) => void
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/conversas') ? { conversas } : path === '/conversas/42' ? { ...conversas[0], anexos: [{ nome: 'foto-antiga.png' }] } : conversas.find(c => path === `/conversas/${c.id}`) || {})
  vi.mocked(api.postForm).mockImplementation(() => new Promise(resolve => { concluir = resolve }))
  montar()
  await screen.findByText('Campanha 42')
  fireEvent.change(campo(), { target: { value: 'Pedido novo ainda em rascunho.' } })
  escolher(42)
  await screen.findByText('Histórico 42')
  fireEvent.change(campo(), { target: { value: 'Rascunho da campanha antiga.' } })
  expect(screen.getByRole('button', { name: 'Remover foto-antiga.png da conversa' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Anexar arquivos à conversa'), { target: { files: [new File(['fixture'], 'upload-pendente.txt', { type: 'text/plain' })] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalledWith('/conversas/42/anexos', expect.any(FormData)))
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: botao }))
  const esperado = `Pedido novo ainda em rascunho.\n${semente}`
  await waitFor(() => expect(campo()).toHaveValue(esperado))
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: /Remover foto-antiga/ })).not.toBeInTheDocument()
  expect(screen.queryByText('upload-pendente.txt')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('conversa=nova')
  await act(async () => concluir({ nome: 'upload-pendente.txt', legivel: true, anexos: ['foto-antiga.png', 'upload-pendente.txt'] }))
  expect(screen.queryByText('upload-pendente.txt')).not.toBeInTheDocument()
  expect(screen.queryByText('foto-antiga.png')).not.toBeInTheDocument()
  expect(campo()).toHaveValue(esperado)
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  escolher(42); await screen.findByText('Histórico 42')
  expect(campo()).toHaveValue('Rascunho da campanha antiga.')
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  expect(campo()).toHaveValue(esperado)
  await waitFor(() => {
    const rascunho = lerRascunhos(escopoRascunhos(1, 'predio', true)).nova
    expect(rascunho.texto).toBe(esperado)
    expect(rascunho.referencia).toEqual(botao === 'Ajuste por link' ? { jobId: 77, intencao: 'ajustar' } : undefined)
  })
  expect(api.post).not.toHaveBeenCalled()
})

it('pergunta por link descarta o contrato da sessão antiga também ao voltar ao modo de contrato', async () => {
  const conversa = { ...conversas[0], office_slug: 'juris', modo: 'contrato' }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/conversas') ? { conversas: [conversa] } : path === '/conversas/42' ? conversa : [])
  vi.mocked(api.postForm).mockResolvedValue({ nome: 'contrato-anterior.pdf' })
  render(<MemoryRouter initialEntries={['/app?org=1&conversa=42']}><Endereco /><ConversaTab orgId={1} slug="juris" office={{ ...office, slug: 'juris' }} /></MemoryRouter>)
  await screen.findByText('Histórico 42')
  fireEvent.change(screen.getByLabelText('Arquivo do contrato'), { target: { files: [new File(['fixture'], 'contrato-anterior.pdf', { type: 'application/pdf' })] } })
  await screen.findByText('contrato-anterior.pdf')
  fireEvent.click(screen.getByRole('button', { name: 'Pergunta por link' }))
  await waitFor(() => expect(campo()).toHaveValue('Quero entender minha marca'))
  fireEvent.click(screen.getByRole('button', { name: '← Modos' }))
  fireEvent.click(screen.getByRole('button', { name: /Leitura de Contrato/ }))
  expect(screen.getByRole('button', { name: /Envie o contrato — arraste aqui ou clique/ })).toBeInTheDocument()
  expect(screen.queryByText('contrato-anterior.pdf')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
})

it.each([
  { sinal: 'trabalhando', resumo: 'Preparando as cenas', esperado: 'Preparando as cenas', fallback: 'Em produção' },
  { sinal: 'precisa_de_voce', resumo: 'Esperando o seu OK', esperado: 'Esperando o seu OK', fallback: 'Ver pedido' },
  { sinal: 'entregue', resumo: 'Entregue terça-feira', esperado: 'Entregue terça-feira', fallback: 'Entrega disponível' },
  { sinal: 'trabalhando', resumo: '', esperado: 'Em produção', fallback: null },
  { sinal: 'trabalhando', resumo: '  ', esperado: 'Em produção', fallback: null },
  { sinal: null, resumo: 'Parou no meio da execução', esperado: 'Parou no meio da execução', fallback: null },
])('o histórico mostra a etapa real "$esperado" e usa o sinal somente como fallback', async ({ sinal, resumo, esperado, fallback }) => {
  vi.mocked(api.get).mockResolvedValue({ conversas: [{ ...conversas[0], sinal, resumo }] })
  montar()
  const historico = screen.getByRole('complementary', { name: 'Suas conversas' })
  expect(await within(historico).findByText(esperado)).toBeInTheDocument()
  if (fallback) expect(within(historico).queryByText(fallback)).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})
