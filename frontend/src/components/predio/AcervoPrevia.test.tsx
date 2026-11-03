import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AcervoTab } from './AcervoTab'
import { ApiError, AUTH_CREDENTIALS_KEY, api, baixarArquivo, carregarArquivo, clearTokens, setTokens } from '../../lib/api'
import { instalarDialogoDeTeste } from '../../test/dialog'

instalarDialogoDeTeste()
const avisos = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn() }))
const revogar = vi.hoisted(() => vi.fn())
const traducao = vi.hoisted(() => ({ idioma: 'pt-BR' as 'pt-BR' | 'en', pt: (pt: string) => pt, en: (_pt: string, en: string) => en }))
const miniaturasVisiveis: Array<() => void> = []
vi.mock('../../lib/i18n', () => ({ useIdioma: () => ({ idioma: traducao.idioma, t: traducao.idioma === 'en' ? traducao.en : traducao.pt }) }))
vi.mock('../Toasts', () => ({ useToasts: () => avisos }))
vi.mock('./PortaVozes', () => ({ default: () => <div>Pessoas</div> }))
vi.mock('../../lib/api', async original => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn() },
  carregarArquivo: vi.fn(), baixarArquivo: vi.fn(),
}))

function listar(nome = 'foto.png', sub = 'lote-a') {
  vi.mocked(api.get).mockResolvedValue({ entrada: [{ nome, sub, tamanho_bytes: 43, legenda: 'Material sintético' }], marca: [], produto: [], exemplos: [], aprovados: [] })
}

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); setTokens('synthetic-access', 'synthetic-refresh')
  traducao.idioma = 'pt-BR'
  vi.stubGlobal('URL', class extends URL { static revokeObjectURL = revogar })
  miniaturasVisiveis.length = 0
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { miniaturasVisiveis.push(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)) }
    observe() {} disconnect() {}
  })
  listar()
  vi.mocked(carregarArquivo).mockReset().mockResolvedValue('blob:viewer')
  vi.mocked(baixarArquivo).mockReset().mockResolvedValue(undefined)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

async function abrir(nome = 'foto.png', sub = 'lote-a') {
  const origem = await screen.findByRole('button', { name: `Abrir ${sub ? `${sub}/` : ''}${nome}` })
  origem.focus(); fireEvent.click(origem)
  const dialogo = screen.getByRole('dialog', { name: `${sub ? `${sub}/` : ''}${nome}` })
  if (/\.(png|mp4)$/.test(nome)) await waitFor(() => expect(dialogo.querySelector('img,video')).toHaveAttribute('src', 'blob:viewer'))
  return { origem, dialogo }
}

it('falha real da imagem informa o problema e oferece retry manual e download do original no diálogo', async () => {
  render(<AcervoTab orgId={3} slug="conteudo" />)
  const { dialogo } = await abrir()
  fireEvent.error(dialogo.querySelector('img')!)
  expect(within(dialogo).getByRole('alert')).toHaveTextContent('Não consegui mostrar a prévia deste arquivo.')
  expect(within(dialogo).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Baixar original' }))
  expect(baixarArquivo).toHaveBeenCalledWith('/predios/3/conteudo/arquivos/entrada/foto.png?sub=lote-a', 'foto.png')
  expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled()
})

it('formato sem prévia oferece o download indicado pela mensagem dentro do modal sem ler o arquivo inteiro', async () => {
  listar('relatorio.docx', 'lote-c')
  render(<AcervoTab orgId={3} slug="conteudo" />)
  const { dialogo } = await abrir('relatorio.docx', 'lote-c')
  expect(await within(dialogo).findByText('Este tipo de arquivo não abre aqui — use o botão de baixar.')).toBeInTheDocument()
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Baixar original' }))
  expect(baixarArquivo).toHaveBeenCalledWith('/predios/3/conteudo/arquivos/entrada/relatorio.docx?sub=lote-c', 'relatorio.docx')
  expect(carregarArquivo).not.toHaveBeenCalled()
})

it('player de vídeo informa falha de decodificação sem repetir chamadas automaticamente', async () => {
  listar('video.mp4')
  render(<AcervoTab orgId={3} slug="conteudo" />)
  const { dialogo } = await abrir('video.mp4')
  fireEvent.error(dialogo.querySelector('video')!)
  expect(within(dialogo).getByRole('alert')).toHaveTextContent('Não consegui mostrar a prévia deste arquivo.')
  expect(carregarArquivo).toHaveBeenCalledOnce()
  expect(baixarArquivo).not.toHaveBeenCalled()
})

it('falha HTTP mantém o arquivo escolhido e oferece leitura manual, sem afirmar arquivo ausente', async () => {
  listar('video.mp4')
  vi.mocked(carregarArquivo).mockRejectedValueOnce(new Error('Rede indisponível'))
  render(<AcervoTab orgId={3} slug="conteudo" />)
  const origem = await screen.findByRole('button', { name: 'Abrir lote-a/video.mp4' })
  origem.focus(); fireEvent.click(origem)
  await screen.findByRole('alert')
  const dialogo = screen.getByRole('dialog', { name: 'lote-a/video.mp4' })
  expect(within(dialogo).getByRole('alert')).toHaveTextContent('Não consegui abrir a prévia agora.')
  expect(dialogo).not.toHaveTextContent(/ausente|não existe/)
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Tentar novamente' }))
  await waitFor(() => expect(dialogo.querySelector('video')).toHaveAttribute('src', 'blob:viewer'))
  expect(within(dialogo).queryByRole('alert')).not.toBeInTheDocument()
  expect(within(dialogo).getByRole('button', { name: 'Fechar' })).toHaveFocus()
  fireEvent.keyDown(window, { key: 'Escape' }); expect(origem).toHaveFocus()
})

const falhasLeitura = [
  { status: 0, pt: 'Não consegui conectar ao servidor', en: 'Could not connect to the server' },
  { status: 401, pt: 'Não consegui confirmar seu acesso', en: 'Could not confirm your access' },
  { status: 403, pt: 'Não consegui confirmar seu acesso', en: 'Could not confirm your access' },
  { status: 404, pt: 'Este arquivo não está disponível para esta consulta', en: 'This file is not available for this request' },
  { status: 500, pt: 'O servidor não conseguiu abrir este arquivo agora', en: 'The server could not open this file right now' },
  { status: 503, pt: 'O servidor não conseguiu abrir este arquivo agora', en: 'The server could not open this file right now' },
  { status: 400, pt: 'Não consegui abrir a prévia agora', en: 'Could not open the preview right now' },
  { status: 429, pt: 'Não consegui abrir a prévia agora', en: 'Could not open the preview right now' },
]
it.each((['pt-BR', 'en'] as const).flatMap(idioma => falhasLeitura.map(falha => ({ ...falha, idioma }))))(
  'falha HTTP$status em $idioma explica a leitura sem revelar detalhes nem repetir chamadas e conserva a recuperação', async ({ status, pt, en, idioma }) => {
    traducao.idioma = idioma
    listar('video.mp4')
    const erro = new ApiError(status, 'DETALHE_PRIVADO https://interno.invalid/chave=segredo-de-teste')
    Object.defineProperty(erro, 'detail', { get: () => { throw new Error('A prévia não pode ler detalhes HTTP') } })
    vi.mocked(carregarArquivo).mockRejectedValueOnce(erro)
    render(<AcervoTab orgId={3} slug="conteudo" />)
    const origem = await screen.findByRole('button', { name: `${idioma === 'en' ? 'Open' : 'Abrir'} lote-a/video.mp4` })
    origem.focus(); fireEvent.click(origem)
    const dialogo = screen.getByRole('dialog', { name: 'lote-a/video.mp4' })
    const alerta = await within(dialogo).findByRole('alert')
    expect(alerta).toHaveTextContent(idioma === 'en' ? en : pt)
    expect(dialogo).toHaveTextContent('Material sintético')
    expect(dialogo).not.toHaveTextContent(/DETALHE_PRIVADO|interno\.invalid|segredo-de-teste/)
    expect(dialogo.querySelector('video')).toBeNull()
    expect(carregarArquivo).toHaveBeenCalledOnce()
    expect(baixarArquivo).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled()
    fireEvent.click(within(dialogo).getByRole('button', { name: idioma === 'en' ? 'Download original' : 'Baixar original' }))
    expect(baixarArquivo).toHaveBeenCalledExactlyOnceWith('/predios/3/conteudo/arquivos/entrada/video.mp4?sub=lote-a', 'video.mp4')
    fireEvent.click(within(dialogo).getByRole('button', { name: idioma === 'en' ? 'Try again' : 'Tentar novamente' }))
    await waitFor(() => expect(dialogo.querySelector('video')).toHaveAttribute('src', 'blob:viewer'))
    expect(carregarArquivo).toHaveBeenCalledTimes(2)
    expect(within(dialogo).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: idioma === 'en' ? 'Close' : 'Fechar' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' }); expect(origem).toHaveFocus()
  },
)

it('falha de acesso atrasada do arquivo anterior não substitui a nova prévia selecionada', async () => {
  vi.mocked(api.get).mockResolvedValue({ entrada: [
    { nome: 'video.mp4', sub: 'primeiro', tamanho_bytes: 12 }, { nome: 'video.mp4', sub: 'segundo', tamanho_bytes: 12 },
  ], marca: [], produto: [], exemplos: [], aprovados: [] })
  let rejeitar!: (erro: Error) => void
  vi.mocked(carregarArquivo).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeitar = reject }))
  render(<AcervoTab orgId={3} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir primeiro/video.mp4' }))
  const signal = vi.mocked(carregarArquivo).mock.calls[0][1]
  fireEvent.keyDown(window, { key: 'Escape' })
  const { dialogo } = await abrir('video.mp4', 'segundo')
  await act(async () => rejeitar(new ApiError(403, 'DETALHE_PRIVADO antigo')))
  expect(signal?.aborted).toBe(true)
  expect(within(dialogo).queryByRole('alert')).not.toBeInTheDocument()
  expect(dialogo.querySelector('video')).toHaveAttribute('src', 'blob:viewer')
  expect(carregarArquivo).toHaveBeenCalledTimes(2)
})

it('imagem válida conserva legenda, busca e foco ao fechar e libera somente o blob da prévia', async () => {
  vi.mocked(carregarArquivo).mockResolvedValueOnce('blob:thumbnail').mockResolvedValue('blob:viewer')
  render(<AcervoTab orgId={3} slug="conteudo" />)
  const busca = screen.getByRole('textbox', { name: 'Buscar no acervo' })
  fireEvent.change(busca, { target: { value: 'lote-a' } })
  await screen.findByRole('button', { name: 'Abrir lote-a/foto.png' })
  act(() => miniaturasVisiveis.forEach(mostrar => mostrar()))
  await waitFor(() => expect(carregarArquivo).toHaveBeenCalledOnce())
  const { origem, dialogo } = await abrir()
  fireEvent.load(dialogo.querySelector('img')!)
  expect(within(dialogo).queryByRole('alert')).not.toBeInTheDocument()
  expect(dialogo).toHaveTextContent('Material sintético')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(origem).toHaveFocus(); expect(busca).toHaveValue('lote-a')
  expect(revogar).toHaveBeenCalledWith('blob:viewer'); expect(revogar).not.toHaveBeenCalledWith('blob:thumbnail')
})

it('fechar durante leitura descarta o resultado tardio sem reabrir e aborta a consulta', async () => {
  listar('video.mp4')
  let concluir!: (url: string) => void
  vi.mocked(carregarArquivo).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  render(<AcervoTab orgId={3} slug="conteudo" />)
  const origem = await screen.findByRole('button', { name: 'Abrir lote-a/video.mp4' })
  origem.focus(); fireEvent.click(origem)
  const signal = vi.mocked(carregarArquivo).mock.calls[0][1]
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(signal?.aborted).toBe(true)
  await act(async () => concluir('blob:tardio'))
  expect(revogar).toHaveBeenCalledWith('blob:tardio'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(origem).toHaveFocus()
})

it('erro de decoder antigo não substitui a prévia depois do retry e dois cliques não duplicam a leitura', async () => {
  listar('video.mp4')
  let concluir!: (url: string) => void
  vi.mocked(carregarArquivo).mockResolvedValueOnce('blob:viewer').mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  render(<AcervoTab orgId={3} slug="conteudo" />)
  const { dialogo } = await abrir('video.mp4')
  const antigo = dialogo.querySelector('video')!
  fireEvent.error(antigo)
  const retry = within(dialogo).getByRole('button', { name: 'Tentar novamente' })
  fireEvent.click(retry); fireEvent.click(retry)
  expect(carregarArquivo).toHaveBeenCalledTimes(2)
  await act(async () => concluir('blob:novo'))
  expect(dialogo.querySelector('video')).toHaveAttribute('src', 'blob:novo')
  fireEvent.error(antigo)
  expect(within(dialogo).queryByRole('alert')).not.toBeInTheDocument()
  expect(revogar).toHaveBeenCalledWith('blob:viewer')
})

it('trocar empresa aborta leitura e descarta o blob anterior sem mostrar nome ou legenda antigos', async () => {
  listar('video.mp4')
  let concluir!: (url: string) => void
  vi.mocked(carregarArquivo).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  const tela = render(<AcervoTab orgId={3} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir lote-a/video.mp4' }))
  const signal = vi.mocked(carregarArquivo).mock.calls[0][1]
  listar('outro.docx', 'empresa-quatro')
  tela.rerender(<AcervoTab orgId={4} slug="conteudo" />)
  await screen.findByRole('button', { name: 'Abrir empresa-quatro/outro.docx' })
  await act(async () => concluir('blob:empresa-tres'))
  expect(signal?.aborted).toBe(true); expect(revogar).toHaveBeenCalledWith('blob:empresa-tres')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText('lote-a/video.mp4')).not.toBeInTheDocument()
})

it('sair da sessão durante leitura não atualiza a prévia nem autoriza download na sessão seguinte', async () => {
  listar('video.mp4')
  let concluir!: (url: string) => void
  vi.mocked(carregarArquivo).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  render(<AcervoTab orgId={3} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir lote-a/video.mp4' }))
  clearTokens(); setTokens('other-access', 'other-refresh')
  await act(async () => concluir('blob:sessao-antiga'))
  expect(revogar).toHaveBeenCalledWith('blob:sessao-antiga')
  expect(screen.getByRole('dialog').querySelector('video')).toBeNull()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Baixar original' }))
  expect(baixarArquivo).not.toHaveBeenCalled()
})

it('renovação de token da mesma sessão conserva a prévia e sua recuperação', async () => {
  listar('video.mp4')
  let concluir!: (url: string) => void
  vi.mocked(carregarArquivo).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  render(<AcervoTab orgId={3} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir lote-a/video.mp4' }))
  const credenciais = JSON.parse(localStorage.getItem(AUTH_CREDENTIALS_KEY)!)
  localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ ...credenciais, access: 'renewed-access', refresh: 'renewed-refresh' }))
  window.dispatchEvent(new CustomEvent('offiz:token-renovado'))
  await act(async () => concluir('blob:renovado'))
  expect(screen.getByRole('dialog').querySelector('video')).toHaveAttribute('src', 'blob:renovado')
  expect(revogar).not.toHaveBeenCalledWith('blob:renovado')
})

it('download do homônimo selecionado usa subpasta exata e falha preserva o diálogo sem falso sucesso', async () => {
  vi.mocked(api.get).mockResolvedValue({ entrada: [
    { nome: 'nota.docx', sub: '', tamanho_bytes: 12 }, { nome: 'nota.docx', sub: 'cliente b', tamanho_bytes: 12 },
  ], marca: [], produto: [], exemplos: [], aprovados: [] })
  vi.mocked(baixarArquivo).mockRejectedValueOnce(new Error('Rede indisponível'))
  render(<AcervoTab orgId={3} slug="conteudo" />)
  const { dialogo } = await abrir('nota.docx', 'cliente b')
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Baixar original' }))
  await waitFor(() => expect(avisos.falha).toHaveBeenCalled())
  expect(baixarArquivo).toHaveBeenCalledWith('/predios/3/conteudo/arquivos/entrada/nota.docx?sub=cliente%20b', 'nota.docx')
  expect(dialogo).toBeInTheDocument(); expect(avisos.sucesso).not.toHaveBeenCalled()
  expect(within(dialogo).getByRole('button', { name: 'Baixar original' })).not.toBeDisabled()
})

it('erro tardio do player fechado não altera o homônimo aberto depois', async () => {
  vi.mocked(api.get).mockResolvedValue({ entrada: [
    { nome: 'video.mp4', sub: 'primeiro', tamanho_bytes: 12 }, { nome: 'video.mp4', sub: 'segundo', tamanho_bytes: 12 },
  ], marca: [], produto: [], exemplos: [], aprovados: [] })
  render(<AcervoTab orgId={3} slug="conteudo" />)
  const { dialogo } = await abrir('video.mp4', 'primeiro')
  const antigo = dialogo.querySelector('video')!
  fireEvent.keyDown(window, { key: 'Escape' })
  const novo = (await abrir('video.mp4', 'segundo')).dialogo
  fireEvent.error(antigo)
  expect(within(novo).queryByRole('alert')).not.toBeInTheDocument()
  expect(novo.querySelector('video')).toHaveAttribute('src', 'blob:viewer')
  fireEvent.click(within(novo).getByRole('button', { name: 'Baixar original' }))
  expect(baixarArquivo).toHaveBeenCalledWith('/predios/3/conteudo/arquivos/entrada/video.mp4?sub=segundo', 'video.mp4')
})

it('download em andamento não duplica com dois cliques e sua falha antiga não aparece na empresa seguinte', async () => {
  listar('nota.docx')
  let rejeitar!: (erro: Error) => void
  vi.mocked(baixarArquivo).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeitar = reject }))
  const tela = render(<AcervoTab orgId={3} slug="conteudo" />)
  const { dialogo } = await abrir('nota.docx')
  const baixar = within(dialogo).getByRole('button', { name: 'Baixar original' })
  fireEvent.click(baixar); fireEvent.click(baixar)
  expect(baixarArquivo).toHaveBeenCalledOnce()
  expect(within(dialogo).getByRole('button', { name: 'Baixando…' })).toBeDisabled()
  tela.rerender(<AcervoTab orgId={4} slug="conteudo" />)
  await act(async () => rejeitar(new Error('Falha antiga')))
  expect(avisos.falha).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('inglês traduz aviso e recuperação sem alterar nome original, legenda ou caminho do download', async () => {
  traducao.idioma = 'en'
  render(<AcervoTab orgId={3} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Open lote-a/foto.png' }))
  const dialogo = screen.getByRole('dialog', { name: 'lote-a/foto.png' })
  const imagem = await within(dialogo).findByRole('img', { name: 'Material sintético' })
  fireEvent.error(imagem)
  expect(within(dialogo).getByRole('alert')).toHaveTextContent('Could not display this file preview.')
  expect(within(dialogo).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Download original' }))
  expect(baixarArquivo).toHaveBeenCalledWith('/predios/3/conteudo/arquivos/entrada/foto.png?sub=lote-a', 'foto.png')
})
