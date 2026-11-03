import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MiniaturaArquivo from './MiniaturaArquivo'
import { ApiError, carregarArquivo, clearTokens, setTokens } from '../lib/api'

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), carregarArquivo: vi.fn() }))
const observadores: Array<{ mostrar: () => void; disconnect: ReturnType<typeof vi.fn> }> = []
const caminho = '/predios/33/conteudo/arquivos/produto/foto.jpg/miniatura?sub=colecao-a'

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); setTokens('synthetic-access', 'synthetic-refresh')
  observadores.length = 0
  vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn() })
  vi.stubGlobal('IntersectionObserver', class {
    disconnect = vi.fn()
    constructor(callback: IntersectionObserverCallback) {
      observadores.push({ mostrar: () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver), disconnect: this.disconnect })
    }
    observe() {}
  })
  vi.mocked(carregarArquivo).mockReset().mockResolvedValue('blob:compacto')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

it('só lê a miniatura compacta quando visível, sem tocar no original', async () => {
  const { container, unmount } = render(<MiniaturaArquivo caminho={caminho} nome="foto.jpg" className="acv-thumb" />)
  expect(carregarArquivo).not.toHaveBeenCalled()
  act(() => observadores[0].mostrar())
  await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'blob:compacto'))
  expect(carregarArquivo).toHaveBeenCalledExactlyOnceWith(caminho, expect.any(AbortSignal))
  expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy')
  expect(container.querySelector('img')).toHaveAttribute('decoding', 'async')
  act(() => observadores[0].mostrar())
  expect(carregarArquivo).toHaveBeenCalledOnce()
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:compacto')
})

it.each(['video.mp4', 'manual.pdf'])('vídeo e PDF usam a imagem compacta: %s', async nome => {
  const { container } = render(<MiniaturaArquivo caminho="/entregas/100/miniatura" nome={nome} />)
  act(() => observadores[0].mostrar())
  await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument())
  expect(container.querySelector('video,iframe')).not.toBeInTheDocument()
  expect(carregarArquivo).toHaveBeenCalledExactlyOnceWith('/entregas/100/miniatura', expect.any(AbortSignal))
})

it.each(['logo.svg', 'texto.txt', 'planilha.xlsx'])('formato sem miniatura conserva ícone sem HTTP: %s', nome => {
  const { container } = render(<MiniaturaArquivo caminho={caminho} nome={nome} />)
  expect(container.querySelector('svg')).toBeInTheDocument()
  expect(observadores).toHaveLength(0)
  expect(carregarArquivo).not.toHaveBeenCalled()
})

it('indisponibilidade não repete a leitura nem tenta baixar o original', async () => {
  vi.mocked(carregarArquivo).mockRejectedValueOnce(new ApiError(404, 'Detalhe privado que não aparece'))
  const { container } = render(<MiniaturaArquivo caminho={caminho} nome="foto.jpg" />)
  act(() => observadores[0].mostrar())
  await act(async () => {})
  expect(container.querySelector('svg')).toBeInTheDocument()
  expect(container).not.toHaveTextContent('Detalhe privado')
  expect(carregarArquivo).toHaveBeenCalledOnce()
})

it('falha de decodificação libera o blob e volta ao ícone sem retry', async () => {
  const { container, unmount } = render(<MiniaturaArquivo caminho={caminho} nome="foto.jpg" />)
  act(() => observadores[0].mostrar())
  await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument())
  fireEvent.error(container.querySelector('img')!)
  expect(container.querySelector('svg')).toBeInTheDocument()
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:compacto')
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
  expect(carregarArquivo).toHaveBeenCalledOnce()
})

it('troca de empresa aborta a leitura antiga e descarta seu resultado tardio', async () => {
  let concluir!: (url: string) => void
  vi.mocked(carregarArquivo).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  const tela = render(<MiniaturaArquivo caminho={caminho} nome="foto.jpg" />)
  act(() => observadores[0].mostrar())
  const signal = vi.mocked(carregarArquivo).mock.calls[0][1]!
  tela.rerender(<MiniaturaArquivo caminho="/predios/34/conteudo/arquivos/produto/foto.jpg/miniatura?sub=colecao-b" nome="foto.jpg" />)
  expect(signal.aborted).toBe(true)
  act(() => observadores[1].mostrar())
  await act(async () => concluir('blob:empresa-antiga'))
  await waitFor(() => expect(tela.container.querySelector('img')).toHaveAttribute('src', 'blob:compacto'))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:empresa-antiga')
})

it('sair da conta aborta a leitura e não mostra a resposta tardia', async () => {
  let concluir!: (url: string) => void
  vi.mocked(carregarArquivo).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  const { container } = render(<MiniaturaArquivo caminho={caminho} nome="foto.jpg" />)
  act(() => observadores[0].mostrar())
  const signal = vi.mocked(carregarArquivo).mock.calls[0][1]!
  act(() => clearTokens())
  expect(signal.aborted).toBe(true)
  await act(async () => concluir('blob:conta-antiga'))
  expect(container.querySelector('img')).not.toBeInTheDocument()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:conta-antiga')
})

it('trocar a sessão também libera uma miniatura já carregada', async () => {
  const { container } = render(<MiniaturaArquivo caminho={caminho} nome="foto.jpg" />)
  act(() => observadores[0].mostrar())
  await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument())
  act(() => setTokens('other-synthetic-access', 'other-synthetic-refresh'))
  expect(container.querySelector('img')).not.toBeInTheDocument()
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:compacto')
})

it('limita a duas leituras e remove miniaturas pendentes ao sair da tela', async () => {
  const conclusoes: Array<(url: string) => void> = []
  vi.mocked(carregarArquivo).mockImplementation(() => new Promise(resolve => conclusoes.push(resolve)))
  const tela = render(<>{[1, 2, 3].map(id => <MiniaturaArquivo key={id} caminho={`/entregas/${id}/miniatura`} nome="foto.jpg" />)}</>)
  act(() => observadores.forEach(observer => observer.mostrar()))
  expect(carregarArquivo).toHaveBeenCalledTimes(2)
  tela.unmount()
  expect(vi.mocked(carregarArquivo).mock.calls.every(([, signal]) => signal?.aborted)).toBe(true)
  await act(async () => conclusoes.forEach((concluir, i) => concluir(`blob:cancelado-${i}`)))
  expect(carregarArquivo).toHaveBeenCalledTimes(2)
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
})

it('sem IntersectionObserver lê só o endpoint compacto e recusa URL externa', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  const { container } = render(<MiniaturaArquivo caminho={caminho} nome="foto.jpg" />)
  await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument())
  render(<MiniaturaArquivo caminho="https://externo.example/foto.jpg" nome="foto.jpg" />)
  render(<MiniaturaArquivo caminho="//externo.example/foto.jpg" nome="foto.jpg" />)
  expect(carregarArquivo).toHaveBeenCalledExactlyOnceWith(caminho, expect.any(AbortSignal))
})
