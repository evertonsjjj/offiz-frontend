import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../../lib/api'
import { instalarDialogoDeTeste } from '../../test/dialog'
import { BibliotecaTab } from './BibliotecaTab'
import { EntregasTab } from './EntregasTab'
import { MesesTab } from './MesesTab'

const contexto = vi.hoisted(() => ({ sessao: 'conta-a', sucesso: vi.fn(), falha: vi.fn(), eventos: new Map<string, (evento: unknown) => void>() }))
vi.mock('../../lib/api', async original => ({
  ...await original<typeof import('../../lib/api')>(),
  getSessionIdentity: () => contexto.sessao,
  api: { get: vi.fn(), post: vi.fn(), postForm: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
}))
vi.mock('../Toasts', () => ({ useToasts: () => contexto }))
vi.mock('../../lib/ws', () => ({ wsClient: { on: (evento: string, fn: (evento: unknown) => void) => { contexto.eventos.set(evento, fn); return () => contexto.eventos.delete(evento) } } }))
vi.mock('./ConteudoEditorial', () => ({ default: () => null }))
instalarDialogoDeTeste()

const modelo = { id: 12, tipo: 'modelo', titulo: 'Modelo confirmado', tags: [], conteudo: 'Texto aprovado.' }
const entrega = {
  id: 51, job_id: 80, job_titulo: 'Relatório mensal', nome: 'relatório.bin', caminho_rel: 'outputs/relatório.bin',
  tamanho_bytes: 20, mime: 'application/octet-stream', status: 'pendente', criado_em: '2026-10-08T12:00:00Z',
}
const mes = { periodo: '2026-09', rotulo: 'setembro de 2026', total_arquivos: 1 }
let modelos = [modelo]
let entregas = [entrega]
let arquivosMes = [{ nome: 'extrato com espaço.pdf', tamanho_bytes: 40 }]
const resposta = (url: string) => {
  if (url.includes('/biblioteca?')) return { itens: modelos }
  if (url.endsWith('/pecas-tipos')) return { tipos: [] }
  if (url.endsWith('/entregas')) return entregas
  if (url.endsWith('/melhorias')) return { melhorias: [] }
  if (url.endsWith('/meses')) return { meses: [mes] }
  if (url.endsWith('/arquivos')) return { arquivos: arquivosMes }
  return {}
}
beforeEach(() => {
  vi.clearAllMocks()
  contexto.sessao = 'conta-a'; contexto.eventos.clear()
  modelos = [modelo]; entregas = [entrega]; arquivosMes = [{ nome: 'extrato com espaço.pdf', tamanho_bytes: 40 }]
  vi.mocked(api.get).mockImplementation(async url => resposta(url) as never)
  vi.mocked(api.del).mockImplementation(async url => {
    if (url.endsWith('/biblioteca/12')) modelos = []
    if (url.startsWith('/entregas/51')) entregas = []
    if (url.endsWith('/entregas/decididas')) { entregas = entregas.filter(e => e.status === 'pendente'); return { removidas: 1 } }
    if (url.includes('/meses/') && url.includes('/arquivos/')) arquivosMes = []
    return undefined
  })
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('modelo confirma o item escolhido e Escape cancela sem API', async () => {
  render(<BibliotecaTab orgId={3} slug="juridico" />)
  const origem = await screen.findByRole('button', { name: 'Excluir' })
  origem.focus(); fireEvent.click(origem)
  expect(screen.getByRole('dialog', { name: 'Excluir item da biblioteca' })).toHaveTextContent('Modelo confirmado')
  const cancelar = screen.getByRole('button', { name: 'Cancelar' })
  expect(cancelar).toHaveFocus()
  fireEvent.keyDown(cancelar, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(origem).toHaveFocus(); expect(api.del).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled()
})

it('modelo confirmado duas vezes envia uma exclusão exata', async () => {
  render(<BibliotecaTab orgId={3} slug="juridico" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
  const confirmar = screen.getByRole('button', { name: 'Excluir item' })
  fireEvent.click(confirmar); fireEvent.click(confirmar)
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/predios/3/juridico/biblioteca/12'))
  expect(screen.queryByText('Modelo confirmado')).not.toBeInTheDocument()
})

it('erro de exclusão do modelo conserva o item e permite tentar novamente', async () => {
  vi.mocked(api.del).mockRejectedValueOnce(new Error('Sem conexão'))
  render(<BibliotecaTab orgId={3} slug="juridico" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
  fireEvent.click(screen.getByRole('button', { name: 'Excluir item' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não foi possível excluir o item.'))
  expect(screen.getByText('Modelo confirmado')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Excluir' })).toBeEnabled()
})

it('trocar de empresa cancela a confirmação da biblioteca anterior', async () => {
  const tela = render(<BibliotecaTab orgId={3} slug="juridico" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
  tela.rerender(<BibliotecaTab orgId={4} slug="juridico" />)
  await screen.findByText('Modelo confirmado')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(api.del).not.toHaveBeenCalled()
})

it('consulta antiga da biblioteca não expõe o item na empresa nova', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url.startsWith('/predios/3/') && url.includes('/biblioteca?')
    ? new Promise(resolve => { resolver = resolve }) as never
    : url.includes('/biblioteca?') ? { itens: [{ ...modelo, titulo: 'Modelo da empresa atual' }] } as never : resposta(url) as never)
  const tela = render(<BibliotecaTab orgId={3} slug="juridico" />)
  tela.rerender(<BibliotecaTab orgId={4} slug="juridico" />)
  await screen.findByText('Modelo da empresa atual')
  await act(async () => resolver({ itens: [modelo] }))
  expect(screen.queryByText('Modelo confirmado')).not.toBeInTheDocument()
  expect(screen.getByText('Modelo da empresa atual')).toBeInTheDocument()
})

it('falha inicial da biblioteca permite retomar sem afirmar que faltam modelos', async () => {
  vi.mocked(api.get).mockImplementationOnce(async () => { throw new Error('Sem conexão') })
  render(<BibliotecaTab orgId={3} slug="juridico" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar a biblioteca.')
  expect(screen.queryByText('Nenhum modelo ainda')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('Modelo confirmado')).toBeInTheDocument()
})

it('entrega pendente informa a ausência de aprendizado e usa forçar só para ela', async () => {
  render(<MemoryRouter><EntregasTab orgId={3} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByTitle('Excluir sem decidir (apaga o arquivo; nenhuma lição é gravada)'))
  expect(screen.getByRole('dialog', { name: 'Excluir entrega' })).toHaveTextContent('NÃO aprende nada')
  fireEvent.click(screen.getByRole('button', { name: 'Excluir entrega' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/entregas/51?forcar=true'))
  expect(window.confirm).not.toHaveBeenCalled()
})

it('cancelar a exclusão da entrega não aprova, rejeita nem apaga', async () => {
  render(<MemoryRouter><EntregasTab orgId={3} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByTitle('Excluir sem decidir (apaga o arquivo; nenhuma lição é gravada)'))
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.del).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled()
  expect(screen.getByText('Relatório mensal')).toBeInTheDocument()
})

it('limpeza em lote confirma o escritório inteiro e mantém pendentes', async () => {
  entregas = [{ ...entrega, status: 'aprovada' }, { ...entrega, id: 52, job_id: 81, job_titulo: 'Ainda pendente' }]
  render(<MemoryRouter><EntregasTab orgId={3} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Limpar histórico' }))
  expect(screen.getByRole('dialog', { name: 'Limpar histórico do escritório' })).toHaveTextContent('As pendentes ficam')
  const confirmar = screen.getByRole('button', { name: 'Excluir entregas decididas' })
  fireEvent.click(confirmar); fireEvent.click(confirmar)
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/predios/3/financeiro/entregas/decididas'))
  expect(await screen.findByText('Ainda pendente')).toBeInTheDocument()
  expect(screen.queryByText('Relatório mensal')).not.toBeInTheDocument()
})

it('consulta atrasada de entregas não substitui o histórico da empresa atual', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url === '/predios/3/financeiro/entregas'
    ? new Promise(resolve => { resolver = resolve }) as never
    : url === '/predios/4/financeiro/entregas' ? [{ ...entrega, job_titulo: 'Entrega atual' }] as never : resposta(url) as never)
  const tela = render(<MemoryRouter><EntregasTab orgId={3} slug="financeiro" /></MemoryRouter>)
  tela.rerender(<MemoryRouter><EntregasTab orgId={4} slug="financeiro" /></MemoryRouter>)
  await screen.findByText('Entrega atual')
  await act(async () => resolver([entrega]))
  expect(screen.queryByText('Relatório mensal')).not.toBeInTheDocument()
  expect(screen.getByText('Entrega atual')).toBeInTheDocument()
})

async function abrirMes() {
  const resumo = await screen.findByText('setembro de 2026')
  const detalhes = resumo.closest('details')!
  detalhes.open = true
  fireEvent(detalhes, new Event('toggle'))
  await within(detalhes).findByRole('button', { name: 'remover' })
  return detalhes
}

it('remoção mensal confirma mês e nome, e envia a rota com nome codificado', async () => {
  render(<MesesTab orgId={3} slug="financeiro" />)
  const detalhes = await abrirMes()
  fireEvent.click(within(detalhes).getByRole('button', { name: 'remover' }))
  const dialogo = screen.getByRole('dialog', { name: 'Remover arquivo do mês' })
  expect(dialogo).toHaveTextContent('extrato com espaço.pdf'); expect(dialogo).toHaveTextContent('setembro de 2026')
  const confirmar = screen.getByRole('button', { name: 'Remover arquivo' })
  fireEvent.click(confirmar); fireEvent.click(confirmar)
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/predios/3/financeiro/meses/2026-09/arquivos/extrato%20com%20espa%C3%A7o.pdf'))
  expect(await screen.findByText('Nenhum arquivo neste mês. Suba extratos, planilhas e documentos.')).toBeInTheDocument()
})

it('falha ao remover arquivo mensal conserva o arquivo e permite tentar novamente', async () => {
  vi.mocked(api.del).mockRejectedValueOnce(new Error('Sem conexão'))
  render(<MesesTab orgId={3} slug="financeiro" />)
  const detalhes = await abrirMes()
  fireEvent.click(within(detalhes).getByRole('button', { name: 'remover' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remover arquivo' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não foi possível remover o arquivo.'))
  expect(within(detalhes).getByRole('button', { name: 'extrato com espaço.pdf' })).toBeInTheDocument()
  expect(within(detalhes).getByRole('button', { name: 'remover' })).toBeEnabled()
})

it('trocar de empresa fecha a confirmação mensal sem apagar nada', async () => {
  const tela = render(<MesesTab orgId={3} slug="financeiro" />)
  const detalhes = await abrirMes()
  fireEvent.click(within(detalhes).getByRole('button', { name: 'remover' }))
  tela.rerender(<MesesTab orgId={4} slug="financeiro" />)
  await screen.findByText('setembro de 2026')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(api.del).not.toHaveBeenCalled()
})

it('exclusão de entrega sem resposta conserva o arquivo e permite retomar', async () => {
  vi.mocked(api.del).mockRejectedValueOnce(new Error('Sem conexão'))
  render(<MemoryRouter><EntregasTab orgId={3} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByTitle('Excluir sem decidir (apaga o arquivo; nenhuma lição é gravada)'))
  fireEvent.click(screen.getByRole('button', { name: 'Excluir entrega' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não foi possível excluir.'))
  expect(screen.getByText('Relatório mensal')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Excluir relatório.bin' })).toBeEnabled()
})

it('falha da limpeza em lote conserva o histórico e não muda a decisão', async () => {
  entregas = [{ ...entrega, status: 'aprovada' }]
  vi.mocked(api.del).mockRejectedValueOnce(new Error('Sem conexão'))
  render(<MemoryRouter><EntregasTab orgId={3} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Limpar histórico' }))
  fireEvent.click(screen.getByRole('button', { name: 'Excluir entregas decididas' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não foi possível limpar o histórico.'))
  expect(screen.getByText('Relatório mensal')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Limpar histórico' })).toBeEnabled()
  expect(api.post).not.toHaveBeenCalled()
})

it('a confirmação pendente da entrega é cancelada ao trocar a sessão', async () => {
  const tela = render(<MemoryRouter><EntregasTab orgId={3} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByTitle('Excluir sem decidir (apaga o arquivo; nenhuma lição é gravada)'))
  contexto.sessao = 'conta-b'
  tela.rerender(<MemoryRouter><EntregasTab orgId={3} slug="financeiro" /></MemoryRouter>)
  await screen.findByText('Relatório mensal')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.del).not.toHaveBeenCalled()
})

it('exclusão confirmada na empresa antiga não anuncia nem apaga o homônimo atual', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.del).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const tela = render(<MemoryRouter><EntregasTab orgId={3} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByTitle('Excluir sem decidir (apaga o arquivo; nenhuma lição é gravada)'))
  fireEvent.click(screen.getByRole('button', { name: 'Excluir entrega' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledTimes(1))
  tela.rerender(<MemoryRouter><EntregasTab orgId={4} slug="financeiro" /></MemoryRouter>)
  await screen.findByText('Relatório mensal')
  await act(async () => resolver(undefined))
  expect(screen.getByText('Relatório mensal')).toBeInTheDocument()
  expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('aprovação antiga não mostra um sucesso na empresa nova', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const tela = render(<MemoryRouter><EntregasTab orgId={3} slug="financeiro" /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Está bom' }))
  tela.rerender(<MemoryRouter><EntregasTab orgId={4} slug="financeiro" /></MemoryRouter>)
  await screen.findByText('Relatório mensal')
  await act(async () => resolver({}))
  expect(contexto.sucesso).not.toHaveBeenCalled()
  expect(contexto.falha).not.toHaveBeenCalled()
})

it('abrir modelo antigo não exibe o editor na empresa nova', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url === '/predios/3/juridico/biblioteca/12'
    ? new Promise(resolve => { resolver = resolve }) as never : resposta(url) as never)
  const tela = render(<BibliotecaTab orgId={3} slug="juridico" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
  tela.rerender(<BibliotecaTab orgId={4} slug="juridico" />)
  await screen.findByText('Modelo confirmado')
  await act(async () => resolver({ item: modelo }))
  expect(screen.queryByRole('dialog', { name: 'Editar modelo' })).not.toBeInTheDocument()
})

it('importação tardia de modelo não substitui a aba atual de doutrinas', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.postForm).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  vi.mocked(api.get).mockImplementation(async url => url.includes('tipo=doutrina')
    ? { itens: [{ ...modelo, tipo: 'doutrina', titulo: 'Doutrina atual' }] } as never : resposta(url) as never)
  render(<BibliotecaTab orgId={3} slug="juridico" />)
  await screen.findByText('Modelo confirmado')
  fireEvent.change(screen.getByLabelText('Importar arquivo PDF ou TXT'), { target: { files: [new File(['Texto'], 'modelo.txt')] } })
  fireEvent.click(screen.getByRole('tab', { name: 'Doutrinas (livros)' }))
  await screen.findByText('Doutrina atual')
  await act(async () => resolver({ item: modelo }))
  expect(screen.getByText('Doutrina atual')).toBeInTheDocument()
  expect(screen.queryByText('Modelo confirmado')).not.toBeInTheDocument()
})
