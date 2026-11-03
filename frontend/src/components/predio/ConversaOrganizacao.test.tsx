import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversaTab } from './ConversaTab'
import { api, setTokens } from '../../lib/api'
import { instalarDialogoDeTeste } from '../../test/dialog'
import { IdiomaProvider } from '../../lib/i18n'

instalarDialogoDeTeste()
const avisos = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }))
vi.mock('../Toasts', () => ({ useToasts: () => avisos }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), postForm: vi.fn(), del: vi.fn() } }))
const office = { slug: 'predio', nome: 'Clube Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const resumo = (id: number, titulo: string, fixada = false, org = 1) => ({ id, organization_id: org, office_slug: null, titulo, fixada, atualizado_em: '2026-10-09T12:00:00Z', total_mensagens: 1 })
const primeiro = resumo(42, 'Camisa para a torcida'), segundo = resumo(43, 'Camisa para a torcida'), fixado = resumo(44, 'Referências da marca', true)
const detalhe = (id: number) => ({ ...[primeiro, segundo, fixado].find(c => c.id === id)!, mensagens: [{ id: id * 10, role: 'assistant', conteudo: `Histórico específico ${id}` }], anexos: [{ nome: `referencia-${id}.png`, tamanho_bytes: 10, legivel: true }] })
const tela = (orgId = 1) => <MemoryRouter initialEntries={['/?conversa=nova']}><ConversaTab orgId={orgId} slug="predio" office={office} nivelPredio /></MemoryRouter>
const diferido = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j }); return { promise, resolve, reject } }
async function opcoes(id = 42) {
  const historico = screen.getByRole('complementary', { name: 'Suas conversas' })
  const linha = [...historico.querySelectorAll('li')].find(li => li.querySelector('button.conversa-item')?.textContent?.includes(id === 44 ? 'Referências da marca' : 'Camisa para a torcida') && (id !== 43 || li === historico.querySelectorAll('li')[2]))!
  const botao = within(linha).getByRole('button', { name: /Opções da conversa/ })
  botao.focus(); fireEvent.click(botao)
  await screen.findByRole('menu')
  return botao
}
async function renomear(nome: string, id = 42) {
  const origem = await opcoes(id)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Renomear' }))
  const dialogo = screen.getByRole('dialog', { name: 'Renomear conversa' })
  fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Nome da conversa' }), { target: { value: nome } })
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar nome' }))
  return origem
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); setTokens('sintetico', 'sintetico')
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/1/predio/conversas' ? { conversas: [primeiro, segundo, fixado] } : path.startsWith('/conversas/') ? detalhe(Number(path.split('/').pop())) : { conversas: [resumo(52, 'Outra empresa', false, 2)] })
  vi.mocked(api.patch).mockImplementation(async (path, corpo) => ({ ...[primeiro, segundo, fixado].find(c => c.id === Number(path.split('/').pop()))!, ...corpo as object }))
})
afterEach(() => vi.restoreAllMocks())

it('agrupa fixadas primeiro sem mudar a ordem relativa e oferece ações só no menu', async () => {
  render(tela()); await screen.findByText('Referências da marca')
  const linhas = screen.getByRole('complementary', { name: 'Suas conversas' }).querySelectorAll('li')
  expect(linhas[0]).toHaveTextContent('Referências da marca')
  expect(linhas[1]).toHaveTextContent('Camisa para a torcida')
  expect(linhas[2]).toHaveTextContent('Camisa para a torcida')
  expect(screen.queryByRole('button', { name: /Excluir conversa/ })).not.toBeInTheDocument()
  const origem = await opcoes()
  expect(origem).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('menuitem', { name: 'Renomear' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' })
  expect(screen.getByRole('menuitem', { name: 'Excluir' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
  expect(screen.getByRole('menuitem', { name: 'Renomear' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(origem).toHaveFocus()
  expect(api.patch).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled()
})

it('renomeia só o assunto escolhido sem trocar mensagem, anexos ou rascunho', async () => {
  render(tela()); await screen.findByText('Referências da marca')
  const linhas = screen.getByRole('complementary', { name: 'Suas conversas' }).querySelectorAll('li')
  fireEvent.click(within(linhas[1]).getByRole('button', { name: /^Camisa para a torcida/ }))
  await screen.findByText('Histórico específico 42')
  fireEvent.change(screen.getByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Rascunho do meu pedido' } })
  await renomear('  Camisa — lançamento 2026  ')
  await screen.findByRole('heading', { name: 'Camisa — lançamento 2026' })
  expect(api.patch).toHaveBeenCalledExactlyOnceWith('/conversas/42', { titulo: 'Camisa — lançamento 2026' })
  expect(screen.getByText('Histórico específico 42')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Rascunho do meu pedido')
  expect(screen.getAllByText('referencia-42.png').length).toBeGreaterThan(0)
  expect(screen.queryByText('Histórico específico 43')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled()
})

it('cancelar nome preserva foco e pedido, clique fora não rouba o foco', async () => {
  render(tela()); await screen.findByText('Referências da marca')
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Sem enviar' } })
  const origem = await opcoes()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Renomear' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(origem).toHaveFocus(); expect(campo).toHaveValue('Sem enviar')
  fireEvent.click(origem); campo.focus(); fireEvent.pointerDown(campo)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(campo).toHaveFocus()
  expect(api.patch).not.toHaveBeenCalled()
})

it('fixa só o alvo e bloqueia clique duplo até confirmação, sem abandonar conversa atual', async () => {
  const resposta = diferido<typeof primeiro>()
  vi.mocked(api.patch).mockReturnValue(resposta.promise)
  render(tela()); await screen.findByText('Referências da marca')
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' }); fireEvent.change(campo, { target: { value: 'Pedido novo' } })
  const origem = await opcoes(); fireEvent.click(screen.getByRole('menuitem', { name: 'Fixar' }))
  await waitFor(() => expect(api.patch).toHaveBeenCalledExactlyOnceWith('/conversas/42', { fixada: true }))
  expect(origem).toBeDisabled(); fireEvent.click(origem); expect(api.patch).toHaveBeenCalledOnce()
  await act(async () => resposta.resolve({ ...primeiro, fixada: true }))
  expect(campo).toHaveValue('Pedido novo'); expect(screen.queryByRole('heading', { name: primeiro.titulo })).not.toBeInTheDocument()
  expect(origem).not.toBeDisabled()
  expect(screen.getByRole('complementary', { name: 'Suas conversas' }).querySelectorAll('li')[0]).toContainElement(origem)
})

it.each(['empresa', 'sessão'] as const)('descarta PATCH tardio após troca de %s inclusive ao voltar ao contexto', async tipo => {
  const resposta = diferido<typeof primeiro>(); vi.mocked(api.patch).mockReturnValue(resposta.promise)
  const montada = render(tela()); await screen.findByText('Referências da marca'); await renomear('Nome antigo tardio')
  await waitFor(() => expect(api.patch).toHaveBeenCalledOnce())
  if (tipo === 'empresa') { await act(async () => montada.rerender(tela(2))); await screen.findByText('Outra empresa'); await act(async () => montada.rerender(tela())) }
  else { setTokens('outro', 'outro'); await act(async () => montada.rerender(tela())) }
  await screen.findByText('Referências da marca')
  await act(async () => resposta.resolve({ ...primeiro, titulo: 'Nome antigo tardio' }))
  expect(screen.queryByText('Nome antigo tardio')).not.toBeInTheDocument(); expect(avisos.sucesso).not.toHaveBeenCalled()
})

it('resposta perdida mantém assunto e rascunho e conferir histórico faz só GET', async () => {
  vi.mocked(api.patch).mockRejectedValue(new Error('Resposta perdida'))
  render(tela()); await screen.findByText('Referências da marca')
  const campo = screen.getByRole('textbox', { name: 'Seu pedido' }); fireEvent.change(campo, { target: { value: 'Meu próximo pedido' } })
  await renomear('Campanha revista')
  await screen.findByRole('button', { name: 'Conferir histórico' })
  expect(screen.getAllByText('Camisa para a torcida').length).toBe(2); expect(campo).toHaveValue('Meu próximo pedido')
  vi.mocked(api.get).mockResolvedValue({ conversas: [{ ...primeiro, titulo: 'Campanha revista' }, segundo, fixado] })
  fireEvent.click(screen.getByRole('button', { name: 'Conferir histórico' }))
  await screen.findByText('Campanha revista')
  expect(screen.queryByRole('button', { name: 'Conferir histórico' })).not.toBeInTheDocument()
  expect(api.patch).toHaveBeenCalledOnce(); expect(api.post).not.toHaveBeenCalled(); expect(campo).toHaveValue('Meu próximo pedido')
})

it('leitura antiga do histórico não desfaz nome confirmado depois da consulta', async () => {
  const leitura = diferido<unknown>()
  render(tela()); await screen.findByText('Referências da marca')
  // A falha torna a releitura uma ação explícita; a segunda leitura fica pendente.
  vi.mocked(api.patch).mockRejectedValueOnce(new Error('Sem resposta'))
  await renomear('Tentativa sem resposta'); await screen.findByRole('button', { name: 'Conferir histórico' })
  vi.mocked(api.get).mockReturnValue(leitura.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Conferir histórico' }))
  vi.mocked(api.patch).mockResolvedValueOnce({ ...primeiro, titulo: 'Nome confirmado' })
  await renomear('Nome confirmado'); await screen.findByText('Nome confirmado')
  await act(async () => leitura.resolve({ conversas: [primeiro, segundo, fixado] }))
  expect(screen.getByText('Nome confirmado')).toBeInTheDocument()
})

it('leitura antiga do assunto não desfaz nome sem perder mensagens ou anexos', async () => {
  const leitura = diferido<unknown>()
  render(tela()); await screen.findByText('Referências da marca')
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42' ? leitura.promise : { conversas: [primeiro, segundo, fixado] })
  const linha = screen.getByRole('complementary', { name: 'Suas conversas' }).querySelectorAll('li')[1]
  fireEvent.click(within(linha).getByRole('button', { name: /^Camisa para a torcida/ }))
  await renomear('Nome mais claro'); await screen.findByRole('heading', { name: 'Nome mais claro' })
  await act(async () => leitura.resolve(detalhe(42)))
  expect(screen.getByRole('heading', { name: 'Nome mais claro' })).toBeInTheDocument()
  expect(screen.getByText('Histórico específico 42')).toBeInTheDocument()
  expect(screen.getAllByText('referencia-42.png').length).toBeGreaterThan(0)
})

it('mudar o assunto aberto durante PATCH conserva o novo rascunho e atualiza só a linha original', async () => {
  const resposta = diferido<typeof primeiro>(); vi.mocked(api.patch).mockReturnValue(resposta.promise)
  render(tela()); await screen.findByText('Referências da marca'); await renomear('Campanha 42')
  await waitFor(() => expect(api.patch).toHaveBeenCalledOnce())
  const linha43 = screen.getByRole('complementary', { name: 'Suas conversas' }).querySelectorAll('li')[2]
  fireEvent.click(within(linha43).getByRole('button', { name: /^Camisa para a torcida/ }))
  await screen.findByText('Histórico específico 43')
  fireEvent.change(screen.getByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Pedido da conversa 43' } })
  await act(async () => resposta.resolve({ ...primeiro, titulo: 'Campanha 42' }))
  expect(screen.getByRole('heading', { name: 'Camisa para a torcida' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Pedido da conversa 43')
  expect(screen.getByText('Campanha 42')).toBeInTheDocument()
  expect(screen.getAllByText('referencia-43.png').length).toBeGreaterThan(0)
  expect(screen.queryByText('Histórico específico 42')).not.toBeInTheDocument()
})

it('menu de uma sessão anterior não envia PATCH nem DELETE com o login novo antes de reagir', async () => {
  render(tela()); await screen.findByText('Referências da marca'); await opcoes()
  setTokens('outra-pessoa', 'outra-pessoa')
  fireEvent.click(screen.getByRole('menuitem', { name: 'Fixar' }))
  expect(api.patch).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled()
})

it('retorno com outro id não confirma nem renomeia conversa homônima', async () => {
  vi.mocked(api.patch).mockResolvedValue({ ...segundo, titulo: 'Nome esperado' })
  render(tela()); await screen.findByText('Referências da marca'); await renomear('Nome esperado')
  await screen.findByRole('button', { name: 'Conferir histórico' })
  expect(screen.queryByText('Nome esperado')).not.toBeInTheDocument()
  expect(screen.getAllByText('Camisa para a torcida')).toHaveLength(2)
  expect(avisos.sucesso).not.toHaveBeenCalled()
})

it('desafixar envia somente o booleano e conserva a ordem recebida das demais conversas', async () => {
  render(tela()); await screen.findByText('Referências da marca'); await opcoes(44)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Desafixar' }))
  await waitFor(() => expect(api.patch).toHaveBeenCalledExactlyOnceWith('/conversas/44', { fixada: false }))
  await waitFor(() => expect(screen.queryByText('Fixada')).not.toBeInTheDocument())
  const linhas = screen.getByRole('complementary', { name: 'Suas conversas' }).querySelectorAll('li')
  expect(linhas[2]).toHaveTextContent('Referências da marca')
  expect(screen.queryByRole('heading', { name: 'Referências da marca' })).not.toBeInTheDocument()
})

it('GET antigo de outra empresa não substitui lista após sair e voltar à mesma empresa', async () => {
  const antiga = diferido<unknown>(); let leituras1 = 0
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/1/predio/conversas'
    ? ++leituras1 === 1 ? antiga.promise : { conversas: [primeiro, segundo, fixado] }
    : { conversas: [resumo(52, 'Outra empresa', false, 2)] })
  const montada = render(tela())
  await waitFor(() => expect(api.get).toHaveBeenCalled())
  await act(async () => montada.rerender(tela(2))); await screen.findByText('Outra empresa')
  await act(async () => montada.rerender(tela())); await screen.findByText('Referências da marca')
  await act(async () => antiga.resolve({ conversas: [resumo(42, 'Lista antiga')] }))
  expect(screen.queryByText('Lista antiga')).not.toBeInTheDocument()
  expect(screen.getByText('Referências da marca')).toBeInTheDocument()
})

it('a rolagem que revela o controle não fecha imediatamente o menu ainda ancorado nele', async () => {
  render(tela()); await screen.findByText('Referências da marca')
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 100, left: 20, top: 100, right: 64, bottom: 144, width: 44, height: 44, toJSON: () => ({}) })
  await opcoes()
  fireEvent.scroll(window)
  expect(screen.getByRole('menuitem', { name: 'Renomear' })).toHaveFocus()
})

it('primeiro foco só é aplicado depois que o menu fica visível, como no navegador', async () => {
  const focar = HTMLElement.prototype.focus
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, opcoes) {
    if (this.closest<HTMLElement>('[role="menu"]')?.style.visibility === 'hidden') return
    focar.call(this, opcoes)
  })
  render(tela()); await screen.findByText('Referências da marca'); await opcoes()
  expect(screen.getByRole('menuitem', { name: 'Renomear' })).toHaveFocus()
})

it('a consulta confirmada mais recente do nome vence um detalhe iniciado antes de renomear', async () => {
  const antiga = diferido<unknown>()
  render(tela()); await screen.findByText('Referências da marca')
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42' ? antiga.promise : { conversas: [primeiro, segundo, fixado] })
  fireEvent.click(within(screen.getByRole('complementary', { name: 'Suas conversas' }).querySelectorAll('li')[1]).getByRole('button', { name: /^Camisa para a torcida/ }))
  await renomear('Nome salvo por mim'); await screen.findByRole('heading', { name: 'Nome salvo por mim' })
  vi.mocked(api.patch).mockRejectedValueOnce(new Error('Sem confirmação'))
  await opcoes(43); fireEvent.click(screen.getByRole('menuitem', { name: 'Fixar' }))
  await screen.findByRole('button', { name: 'Conferir histórico' })
  vi.mocked(api.get).mockResolvedValueOnce({ conversas: [{ ...primeiro, titulo: 'Nome atualizado em outra aba' }, segundo, fixado] })
  fireEvent.click(screen.getByRole('button', { name: 'Conferir histórico' }))
  await screen.findByRole('heading', { name: 'Nome atualizado em outra aba' })
  await act(async () => antiga.resolve(detalhe(42)))
  expect(screen.getByRole('heading', { name: 'Nome atualizado em outra aba' })).toBeInTheDocument()
  expect(screen.getByText('Histórico específico 42')).toBeInTheDocument()
})

it('organiza por teclado em inglês sem traduzir o assunto nem enviar ao cancelar', async () => {
  localStorage.setItem('offiz:idioma:visitante', 'en')
  render(<IdiomaProvider>{tela()}</IdiomaProvider>)
  const origem = await screen.findByRole('button', { name: 'Conversation options: Referências da marca' })
  origem.focus(); fireEvent.keyDown(origem, { key: 'ArrowUp' })
  expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
  expect(screen.getByRole('menuitem', { name: 'Unpin' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
  const dialogo = screen.getByRole('dialog', { name: 'Rename conversation' })
  expect(within(dialogo).getByRole('textbox', { name: 'Conversation name' })).toHaveValue('Referências da marca')
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(origem).toHaveFocus(); expect(api.patch).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled()
})
