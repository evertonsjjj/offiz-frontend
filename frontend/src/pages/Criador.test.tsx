import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../lib/api'
import { prepararDemoCriador } from '../lib/criador-demo'
import { instalarDialogoDeTeste } from '../test/dialog'
import CriadorPage from './Criador'

const contexto = vi.hoisted(() => ({ sessao: 'conta-a', sucesso: vi.fn(), falha: vi.fn(), traduzir: (pt: string) => pt,
  transporte: { tipo: 'simulacao', abrir: vi.fn(), enviar: vi.fn(), onEvento: vi.fn(), arquivos: vi.fn(), arquivo: vi.fn(), publicar: vi.fn(), fechar: vi.fn(), cancelar: vi.fn(), anexar: vi.fn() },
}))
vi.mock('../lib/i18n', () => ({ useIdioma: () => ({ t: contexto.traduzir, idioma: 'pt-BR' }) }))
vi.mock('../components/Toasts', () => ({ useToasts: () => contexto }))
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), getSessionIdentity: () => contexto.sessao, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }))
vi.mock('../lib/criador-demo', () => ({ prepararDemoCriador: vi.fn() }))
vi.mock('../lib/criador-transporte', () => ({ temCriadorDesktop: () => false, transporteSimulacao: () => contexto.transporte, transporteDesktop: () => contexto.transporte }))
instalarDialogoDeTeste()
const office = { slug: 'conteudo', nome: 'Conteúdo do clube', tema: {}, origem: 'personalizado', orgs_ativas: 2 }
const estado = { aberta: true, slug: office.slug, ocupado: false, turnos: 0, alterados: [{ caminho: 'office.json', acao: 'alterado' }], manifesto: { ...office, prompts_prontos: [] } }
const tela = () => <MemoryRouter><CriadorPage /></MemoryRouter>
const dispositivosOriginais = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
beforeEach(() => {
  vi.resetAllMocks(); contexto.sessao = 'conta-a'
  Element.prototype.scrollIntoView = vi.fn()
  contexto.transporte.onEvento.mockReturnValue(() => {})
  contexto.transporte.abrir.mockResolvedValue(estado)
  contexto.transporte.publicar.mockResolvedValue({ ok: true })
  contexto.transporte.fechar.mockResolvedValue(undefined)
  contexto.transporte.arquivos.mockResolvedValue({ ok: true, arquivos: [{ caminho: 'CLAUDE.md', tamanho: 1 }, { caminho: 'office.json', tamanho: 1 }] })
  contexto.transporte.arquivo.mockResolvedValue({ ok: true, conteudo: 'Arquivo atual' })
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/versoes') ? { versoes: [{ nome: '20260921-120000.zip', bytes: 100 }] } as never : [office] as never)
  vi.mocked(api.del).mockResolvedValue(undefined)
  vi.mocked(api.post).mockResolvedValue({})
  vi.mocked(prepararDemoCriador).mockResolvedValue('/app?org=31&slug=conteudo')
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  vi.spyOn(window, 'open').mockReturnValue(null)
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (dispositivosOriginais) Object.defineProperty(navigator, 'mediaDevices', dispositivosOriginais)
  else Reflect.deleteProperty(navigator, 'mediaDevices')
})
async function abrirBancada() {
  fireEvent.click(await screen.findByRole('button', { name: /Conteúdo do clube conteudo/ }))
  await screen.findByRole('button', { name: 'Publicar (1)' })
}

it('excluir a versão personalizada usa diálogo, conserva o aviso e permite cancelar', async () => {
  // O catálogo chega após o GET: conclui a montagem e os efeitos dos diálogos
  // antes de clicar no botão que apareceu nessa atualização assíncrona.
  await act(async () => { render(tela()) })
  const origem = await screen.findByRole('button', { name: 'excluir' }); origem.focus(); fireEvent.click(origem)
  expect(screen.getByRole('dialog')).toHaveTextContent('Se existir a versão embutida')
  expect(screen.getByRole('dialog')).toHaveTextContent('Uma cópia fica guardada nas versões')
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.del).not.toHaveBeenCalled(); expect(origem).toHaveFocus(); expect(window.confirm).not.toHaveBeenCalled()
})

it('restaurar preserva o impacto para todos os clientes e envia somente a versão escolhida', async () => {
  render(tela())
  fireEvent.click(await screen.findByRole('button', { name: '↩ versões' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Restaurar' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('todos os clientes')
  expect(screen.getByRole('dialog')).toHaveTextContent('A versão atual também fica guardada')
  fireEvent.click(screen.getByRole('button', { name: 'Restaurar versão' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/admin/offices/conteudo/versoes/20260921-120000.zip/restaurar'))
})

it('falha ao ler versões não inventa lista vazia e permite tentar novamente', async () => {
  vi.mocked(api.get).mockResolvedValueOnce([office]).mockRejectedValueOnce(new Error('Sem conexão')).mockResolvedValueOnce({ versoes: [{ nome: '20260921-120000.zip', bytes: 100 }] })
  render(tela())
  fireEvent.click(await screen.findByRole('button', { name: '↩ versões' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível ler as versões')
  expect(screen.queryByText(/Nenhuma versão guardada ainda/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByRole('button', { name: 'Restaurar' })).toBeInTheDocument()
})

it('publicar mostra impacto e arquivos e confirma uma única vez mesmo com clique duplo', async () => {
  render(tela()); await abrirBancada()
  fireEvent.click(screen.getByRole('button', { name: 'Publicar (1)' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('todos os clientes')
  expect(screen.getByRole('dialog')).toHaveTextContent('office.json (alterado)')
  const publicar = within(screen.getByRole('dialog')).getByRole('button', { name: 'Publicar escritório' })
  fireEvent.click(publicar); fireEvent.click(publicar)
  await waitFor(() => expect(contexto.transporte.publicar).toHaveBeenCalledTimes(1))
})

it('falha de publicação é explicada e conserva a bancada para tentar novamente', async () => {
  contexto.transporte.publicar.mockRejectedValueOnce(new Error('Falha do transporte'))
  render(tela()); await abrirBancada()
  fireEvent.click(screen.getByRole('button', { name: 'Publicar (1)' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publicar escritório' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Falha do transporte'))
  expect(screen.getByRole('button', { name: 'Publicar (1)' })).toBeEnabled()
  expect(screen.getByText(/office\.json/, { selector: 'code' })).toBeInTheDocument()
})

it('descartar confirma os arquivos perdidos e cancelar mantém o texto digitado', async () => {
  render(tela()); await abrirBancada()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Meu rascunho' } })
  fireEvent.click(screen.getByRole('button', { name: 'Descartar bancada' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('1 arquivo(s) editados serão perdidos')
  fireEvent.keyDown(screen.getByRole('button', { name: 'Cancelar' }), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByDisplayValue('Meu rascunho')).toBeInTheDocument(); expect(contexto.transporte.fechar).not.toHaveBeenCalled()
})

it('falha ao descartar é explicada e conserva a bancada', async () => {
  contexto.transporte.fechar.mockRejectedValueOnce(new Error('Não fechou a sessão'))
  render(tela()); await abrirBancada()
  fireEvent.click(screen.getByRole('button', { name: 'Descartar bancada' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Descartar alterações' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não fechou a sessão'))
  expect(screen.getByRole('button', { name: 'Publicar (1)' })).toBeInTheDocument()
})

it('a demo mantém o aviso da versão publicada e cancelar não cria empresa nem abre janela', async () => {
  render(tela()); await abrirBancada()
  fireEvent.click(screen.getByRole('button', { name: 'Ver demo real' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('versão PUBLICADA')
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(prepararDemoCriador).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled()
})

it('uma abertura atrasada não entra na bancada de outra conta', async () => {
  let resolver!: (value: unknown) => void
  contexto.transporte.abrir.mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(tela())
  fireEvent.click(await screen.findByRole('button', { name: /Conteúdo do clube conteudo/ }))
  contexto.sessao = 'conta-b'; view.rerender(tela())
  await act(async () => resolver(estado))
  expect(screen.queryByRole('button', { name: 'Publicar (1)' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Criador de escritórios' })).toBeInTheDocument()
})

it('a leitura antiga não aparece sob o nome do arquivo selecionado depois', async () => {
  let resolver!: (value: unknown) => void
  contexto.transporte.arquivo.mockImplementationOnce(() => new Promise(resolve => { resolver = resolve })).mockResolvedValueOnce({ ok: true, conteudo: 'Arquivo JSON correto' })
  render(tela()); await abrirBancada()
  fireEvent.click(screen.getByRole('tab', { name: 'Arquivos' }))
  fireEvent.click(await screen.findByRole('button', { name: 'CLAUDE.md' }))
  fireEvent.click(screen.getByRole('button', { name: 'office.json' }))
  await screen.findByText('Arquivo JSON correto')
  await act(async () => resolver({ ok: true, conteudo: 'Prompt antigo' }))
  expect(screen.queryByText('Prompt antigo')).not.toBeInTheDocument()
  expect(screen.getByText('Arquivo JSON correto')).toBeInTheDocument()
})

it('falha de leitura de arquivo é mostrada e permite repetir a leitura', async () => {
  contexto.transporte.arquivo.mockRejectedValueOnce(new Error('Leitura interrompida'))
  render(tela()); await abrirBancada()
  fireEvent.click(screen.getByRole('tab', { name: 'Arquivos' }))
  fireEvent.click(await screen.findByRole('button', { name: 'CLAUDE.md' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Leitura interrompida')
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('Arquivo atual')).toBeInTheDocument()
})

it('uma demo atrasada não abre depois de sair da bancada', async () => {
  let resolver!: (value: string) => void
  vi.mocked(prepararDemoCriador).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(tela()); await abrirBancada()
  fireEvent.click(screen.getByRole('button', { name: 'Ver demo real' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir versão publicada' }))
  await waitFor(() => expect(prepararDemoCriador).toHaveBeenCalledTimes(1))
  view.unmount()
  await act(async () => resolver('/app?org=31&slug=conteudo'))
  expect(window.open).not.toHaveBeenCalled(); expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('permissão de microfone pendente é pedida uma vez e a resposta tardia libera o dispositivo', async () => {
  let resolver!: (value: unknown) => void
  const parar = vi.fn(), criar = vi.fn()
  const obter = vi.fn(() => new Promise(resolve => { resolver = resolve }))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: obter } })
  vi.stubGlobal('MediaRecorder', criar)
  const view = render(tela()); await abrirBancada()
  const falar = screen.getByRole('button', { name: 'Falar' })
  fireEvent.click(falar); fireEvent.click(falar)
  expect(obter).toHaveBeenCalledTimes(1)
  view.unmount()
  await act(async () => resolver({ getTracks: () => [{ stop: parar }] }))
  expect(parar).toHaveBeenCalledTimes(1); expect(criar).not.toHaveBeenCalled(); expect(contexto.transporte.anexar).not.toHaveBeenCalled()
})

it('sair com microfone gravando para dispositivo e gravador sem anexar áudio', async () => {
  const parar = vi.fn(), pararGravador = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: parar }] }) } })
  vi.stubGlobal('MediaRecorder', class {
    state = 'inactive'; onstop: (() => void) | null = null; ondataavailable = null; mimeType = 'audio/webm'
    start() { this.state = 'recording' }
    stop() { pararGravador(); this.state = 'inactive'; this.onstop?.() }
  })
  const view = render(tela()); await abrirBancada()
  fireEvent.click(screen.getByRole('button', { name: 'Falar' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Falar' })).toHaveAttribute('title', 'Gravando — clique para parar e anexar o áudio'))
  view.unmount()
  expect(parar).toHaveBeenCalledTimes(1); expect(pararGravador).toHaveBeenCalledTimes(1); expect(contexto.transporte.anexar).not.toHaveBeenCalled()
})

it('falha ao criar gravador libera o microfone e permite repetir', async () => {
  const parar = vi.fn(), obter = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: parar }] })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: obter } })
  vi.stubGlobal('MediaRecorder', class { constructor() { throw new Error('Formato indisponível') } })
  render(tela()); await abrirBancada()
  fireEvent.click(screen.getByRole('button', { name: 'Falar' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledTimes(1))
  expect(parar).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Falar' }))
  await waitFor(() => expect(obter).toHaveBeenCalledTimes(2))
})

it('criação de escritório da conta anterior não mostra sucesso nem abre na conta nova', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(tela())
  await screen.findByRole('option', { name: 'Clone de Conteúdo do clube' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome' }), { target: { value: 'Novo serviço' } })
  fireEvent.click(screen.getByRole('button', { name: 'Criar e abrir' }))
  contexto.sessao = 'conta-b'; view.rerender(tela())
  await act(async () => resolver({ slug: 'novo-servico', arquivos: 4 }))
  expect(contexto.sucesso).not.toHaveBeenCalled(); expect(contexto.transporte.abrir).not.toHaveBeenCalled()
})

it('arquivo binário informa a limitação de preview sem tratar como falha de leitura', async () => {
  contexto.transporte.arquivo.mockResolvedValueOnce({ ok: true, binario: true, tamanho: 2, aviso: 'Imagem sem visualização nesta bancada.' })
  render(tela()); await abrirBancada()
  fireEvent.click(screen.getByRole('tab', { name: 'Arquivos' }))
  fireEvent.click(await screen.findByRole('button', { name: 'CLAUDE.md' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Imagem sem visualização nesta bancada.')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument()
})
