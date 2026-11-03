import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { instalarDialogoDeTeste } from '../../test/dialog'
import { ClientesTab } from './ClientesTab'

const contexto = vi.hoisted(() => ({ sessao: 'conta-a', sucesso: vi.fn(), falha: vi.fn() }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), getSessionIdentity: () => contexto.sessao, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn(), del: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => contexto }))
instalarDialogoDeTeste()
const arquivo = { id: 61, nome: 'extrato.pdf', nome_original: 'Extrato de setembro.pdf', tamanho_bytes: 100, criado_em: null }
const periodo = { id: 71, ano: 2026, mes: 9, rotulo: 'Setembro/2026', total_arquivos: 1, arquivos: [arquivo] }
const cliente = { id: 51, nome: 'Cliente da empresa', email: null, celular: null, tipo: null, site: null, consentimento_pentest: false, perfil_investidor: null, granularidade: 'mensal', status: 'ativo', notificacao: 'nenhuma', envio_dia: null, envio_hora: '09:00', envio_email: false, total_periodos: 1, criado_em: null, observacoes: null, periodos: [periodo] }
const office = { slug: 'financeiro', nome: 'Financeiro', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' }, upload_mensal: true }
let ficha = cliente
function Rota() {
  const [params, setParams] = useSearchParams(); const location = useLocation()
  return <><output data-testid="rota">{location.search}</output><button onClick={() => { const next = new URLSearchParams(params); next.set('cliente', '52'); setParams(next) }}>Cliente seguinte</button></>
}
const tela = (orgId = 3) => <MemoryRouter initialEntries={['/app?org=3&cliente=51']}><Rota /><ClientesTab orgId={orgId} slug="financeiro" office={office} /></MemoryRouter>
function abrirPeriodos() {
  const grupo = screen.getByText('Períodos e arquivos').closest('details')!
  grupo.open = true
  return within(grupo)
}
beforeEach(() => {
  vi.clearAllMocks(); contexto.sessao = 'conta-a'; ficha = cliente
  vi.mocked(api.get).mockImplementation(async url => /\/clientes\/\d+$/.test(url) ? ficha as never : { clientes: [ficha], entregas: [] } as never)
  vi.mocked(api.post).mockResolvedValue({}); vi.mocked(api.put).mockResolvedValue({}); vi.mocked(api.postForm).mockResolvedValue({})
  vi.mocked(api.del).mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('remover arquivo pede confirmação do nome e do período antes da exclusão exata', async () => {
  // A leitura monta o cartão e seus efeitos; aguarde ambos antes de interagir.
  await act(async () => { render(tela()) })
  expect(screen.getByRole('heading', { name: cliente.nome })).toBeInTheDocument()
  const remover = abrirPeriodos().getByRole('button', { name: `Remover ${arquivo.nome_original}` })
  expect(remover).toBeEnabled()
  fireEvent.click(remover)
  const dialogo = screen.getByRole('dialog')
  expect(dialogo).toHaveTextContent('Extrato de setembro.pdf'); expect(dialogo).toHaveTextContent('Setembro/2026')
  expect(api.del).not.toHaveBeenCalled()
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Remover arquivo' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/predios/3/financeiro/clientes/51/arquivos/61'))
})

it('cancelar remoção de período conserva arquivos e não chama API', async () => {
  render(tela()); await screen.findByRole('heading', { name: cliente.nome })
  const origem = abrirPeriodos().getAllByRole('button', { name: /remover/i })[0]; origem.focus(); fireEvent.click(origem)
  expect(screen.getByRole('dialog')).toHaveTextContent('Setembro/2026 e seus arquivos')
  fireEvent.keyDown(screen.getByRole('button', { name: 'Cancelar' }), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.del).not.toHaveBeenCalled(); expect(origem).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Extrato de setembro.pdf' })).toBeInTheDocument()
})

it('excluir cliente confirma todos os períodos e arquivos e não duplica chamada', async () => {
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Excluir cliente' }))
  const dialogo = screen.getByRole('dialog')
  expect(dialogo).toHaveTextContent(cliente.nome); expect(dialogo).toHaveTextContent('todos os períodos/arquivos')
  const confirmar = within(dialogo).getByRole('button', { name: 'Excluir cliente' })
  fireEvent.click(confirmar); fireEvent.click(confirmar)
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/predios/3/financeiro/clientes/51'))
  expect(window.confirm).not.toHaveBeenCalled()
})

it('falha ao excluir cliente conserva a ficha e permite repetir', async () => {
  vi.mocked(api.del).mockRejectedValueOnce(new Error('Sem conexão'))
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Excluir cliente' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir cliente' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não foi possível excluir o cliente.'))
  expect(screen.getByRole('heading', { name: cliente.nome })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Excluir cliente' })).toBeEnabled()
})

it('ficha antiga não substitui o cliente escolhido depois na mesma empresa', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/clientes/51') ? new Promise(resolve => { resolver = resolve }) as never : url.endsWith('/clientes/52') ? { ...cliente, id: 52, nome: 'Cliente seguinte correto' } as never : { clientes: [cliente] } as never)
  render(tela()); fireEvent.click(screen.getByRole('button', { name: 'Cliente seguinte' }))
  await screen.findByRole('heading', { name: 'Cliente seguinte correto' })
  await act(async () => resolver(cliente))
  expect(screen.queryByRole('heading', { name: cliente.nome })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Cliente seguinte correto' })).toBeInTheDocument()
})

it('lista antiga não reaparece depois da troca de empresa', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url === '/predios/3/financeiro/clientes' ? new Promise(resolve => { resolver = resolve }) as never : /\/clientes\/\d+$/.test(url) ? ficha as never : { clientes: [{ ...cliente, nome: 'Cliente da empresa atual' }] } as never)
  const view = render(tela())
  fireEvent.click(await screen.findByRole('button', { name: '← Voltar à lista' }))
  view.rerender(tela(4))
  await screen.findByRole('button', { name: /Cliente da empresa atual/ })
  await act(async () => resolver({ clientes: [cliente] }))
  expect(screen.queryByText(cliente.nome, { selector: 'strong' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Cliente da empresa atual/ })).toBeInTheDocument()
})

it('exclusão atrasada do cliente anterior não navega para a lista da outra empresa', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.del).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Excluir cliente' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir cliente' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledTimes(1))
  ficha = { ...cliente, nome: 'Cliente atual' }; view.rerender(tela(4))
  await screen.findByRole('heading', { name: 'Cliente atual' })
  await act(async () => resolver(undefined))
  expect(screen.getByRole('heading', { name: 'Cliente atual' })).toBeInTheDocument()
  expect(screen.getByTestId('rota')).toHaveTextContent('cliente=51'); expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('falha inicial da ficha explica e tem retry no mesmo cliente', async () => {
  let falhar = true
  vi.mocked(api.get).mockImplementation(async url => { if (url.endsWith('/clientes/51') && falhar) throw new Error('Sem conexão'); return /\/clientes\/\d+$/.test(url) ? cliente as never : { clientes: [cliente] } as never })
  render(tela())
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o cliente.')
  falhar = false; fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByRole('heading', { name: cliente.nome })).toBeInTheDocument()
})

it('falha ao editar ficha mantém rascunho e não afirma sucesso', async () => {
  vi.mocked(api.put).mockRejectedValueOnce(new Error('Sem conexão'))
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Editar ficha' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome *' }), { target: { value: 'Meu nome revisado' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar ficha' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não foi possível atualizar o cliente.'))
  expect(screen.getByDisplayValue('Meu nome revisado')).toBeInTheDocument()
  expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('upload interrompido pela troca de empresa não envia o segundo arquivo nem mostra sucesso antigo', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.postForm).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(tela()); await screen.findByRole('heading', { name: cliente.nome }); abrirPeriodos()
  const campo = view.container.querySelector('input[type=file]')!
  fireEvent.change(campo, { target: { files: [new File(['a'], 'um.pdf'), new File(['b'], 'dois.pdf')] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  view.rerender(tela(4)); await screen.findByRole('heading', { name: cliente.nome })
  await act(async () => resolver({}))
  expect(api.postForm).toHaveBeenCalledTimes(1); expect(contexto.sucesso).not.toHaveBeenCalled()
})
