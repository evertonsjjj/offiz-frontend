import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import ResultadoEntrega, { temResultadoVisivel } from './ResultadoEntrega'
import { AUTH_CREDENTIALS_KEY, carregarArquivo, respostaAutenticada, setTokens } from '../../lib/api'
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), carregarArquivo: vi.fn(), respostaAutenticada: vi.fn() }))
const dialogPrototype = HTMLDialogElement.prototype
const dialogMethods = Object.fromEntries(['showModal', 'close'].map(name => [name, Object.getOwnPropertyDescriptor(dialogPrototype, name)]))
beforeAll(() => Object.defineProperties(dialogPrototype, {
  showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } },
  close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } },
}))
afterAll(() => {
  for (const [name, descriptor] of Object.entries(dialogMethods)) {
    if (descriptor) Object.defineProperty(dialogPrototype, name, descriptor)
    else Reflect.deleteProperty(dialogPrototype, name)
  }
})
beforeEach(() => { vi.clearAllMocks(); vi.mocked(carregarArquivo).mockReset(); vi.mocked(respostaAutenticada).mockReset(); localStorage.clear(); setTokens('fixture-preview', 'fixture-refresh') })
it('arquivo de vídeo grande abre apenas por escolha da pessoa e não começa a tocar sozinho', async () => {
  vi.mocked(carregarArquivo).mockResolvedValue('blob:video-grande')
  const { container } = render(<ResultadoEntrega entregaId={42} nome="campanha.mp4" tamanhoBytes={15 * 1024 * 1024 + 1} />)
  const abrir = screen.getByRole('button', { name: /Abrir prévia de vídeo/ })
  expect(abrir).toHaveTextContent('15 MB')
  expect(carregarArquivo).not.toHaveBeenCalled()
  fireEvent.click(abrir)
  await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:video-grande'))
  expect(carregarArquivo).toHaveBeenCalledOnce()
  expect(container.querySelector('video')).toHaveAttribute('controls')
  expect(container.querySelector('video')).not.toHaveAttribute('autoplay')
  expect(screen.queryByRole('button', { name: /Abrir prévia de vídeo/ })).not.toBeInTheDocument()
})

it.each(['botão', 'Escape'])('amplia o vídeo carregado sem nova transferência, conserva o instante e fecha por %s', async modo => {
  vi.mocked(carregarArquivo).mockResolvedValue('blob:video-original')
  const pausa = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const tocar = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const revogar = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: revogar }))
  const { container, unmount } = render(<ResultadoEntrega entregaId={42} nome="campanha.mp4" tamanhoBytes={30 * 1024 * 1024} />)
  try {
    expect(screen.queryByRole('button', { name: 'Ampliar vídeo' })).not.toBeInTheDocument()
    expect(carregarArquivo).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Abrir prévia de vídeo/ }))
    const ampliar = await screen.findByRole('button', { name: 'Ampliar vídeo' })
    const inline = container.querySelector('video')!
    inline.currentTime = 7.25
    ampliar.focus()
    fireEvent.click(ampliar)
    const dialogo = screen.getByRole('dialog', { name: 'Vídeo ampliado: campanha.mp4' })
    const ampliado = dialogo.querySelector('video')!
    expect(ampliar).toHaveAttribute('aria-haspopup', 'dialog')
    expect(pausa.mock.contexts).toContain(inline)
    expect(ampliado).toHaveAttribute('src', inline.getAttribute('src'))
    expect(ampliado).toHaveAttribute('controls')
    expect(ampliado).toHaveAttribute('playsinline')
    expect(ampliado).not.toHaveAttribute('autoplay')
    Object.defineProperty(ampliado, 'readyState', { value: HTMLMediaElement.HAVE_METADATA })
    fireEvent.loadedMetadata(ampliado)
    expect(ampliado.currentTime).toBe(7.25)
    ampliado.currentTime = 11.5
    if (modo === 'Escape') fireEvent(dialogo, new Event('cancel', { cancelable: true }))
    else fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(inline.currentTime).toBe(11.5)
    expect(pausa.mock.contexts).toContain(ampliado)
    expect(ampliar).toHaveFocus()
    expect(tocar).not.toHaveBeenCalled()
    expect(carregarArquivo).toHaveBeenCalledOnce()
    expect(revogar).not.toHaveBeenCalled()
    unmount()
    expect(revogar).toHaveBeenCalledExactlyOnceWith('blob:video-original')
    expect(vi.mocked(carregarArquivo).mock.calls[0][1]!.aborted).toBe(true)
  } finally { unmount(); pausa.mockRestore(); tocar.mockRestore(); vi.unstubAllGlobals() }
})

it('conserva o instante se a ampliação fecha antes dos metadados e permite voltar ao começo depois', async () => {
  vi.mocked(carregarArquivo).mockResolvedValue('blob:video-original')
  const pausa = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const { container, unmount } = render(<ResultadoEntrega entregaId={42} nome="campanha.mp4" />)
  try {
    const ampliar = await screen.findByRole('button', { name: 'Ampliar vídeo' })
    const inline = container.querySelector('video')!
    inline.currentTime = 7.25
    fireEvent.click(ampliar)
    expect(screen.getByRole('dialog').querySelector('video')!.readyState).toBe(HTMLMediaElement.HAVE_NOTHING)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(inline.currentTime).toBe(7.25)
    fireEvent.click(ampliar)
    const ampliado = screen.getByRole('dialog').querySelector('video')!
    Object.defineProperty(ampliado, 'readyState', { value: HTMLMediaElement.HAVE_METADATA })
    fireEvent.loadedMetadata(ampliado)
    expect(ampliado.currentTime).toBe(7.25)
    ampliado.currentTime = 0
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(inline.currentTime).toBe(0)
    expect(carregarArquivo).toHaveBeenCalledOnce()
  } finally { unmount(); pausa.mockRestore() }
})

it('trocar de vídeo fecha a ampliação e exige novo clique para ampliar a outra entrega', async () => {
  let concluir!: (url: string) => void
  vi.mocked(carregarArquivo).mockResolvedValueOnce('blob:video-antigo').mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  const pausa = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const revogar = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: revogar }))
  const { container, rerender, unmount } = render(<ResultadoEntrega entregaId={42} nome="antigo.mp4" />)
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Ampliar vídeo' }))
    const antigo = screen.getByRole('dialog').querySelector('video')!
    rerender(<ResultadoEntrega entregaId={43} nome="novo.mp4" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(pausa.mock.contexts).toContain(antigo)
    expect(vi.mocked(carregarArquivo).mock.calls[0][1]!.aborted).toBe(true)
    expect(revogar).toHaveBeenCalledExactlyOnceWith('blob:video-antigo')
    await act(async () => concluir('blob:video-novo'))
    expect(container.querySelector('video')).toHaveAttribute('src', 'blob:video-novo')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar vídeo' }))
    expect(screen.getByRole('dialog', { name: 'Vídeo ampliado: novo.mp4' }).querySelector('video')).toHaveAttribute('src', 'blob:video-novo')
    expect(carregarArquivo).toHaveBeenCalledTimes(2)
  } finally { unmount(); pausa.mockRestore(); vi.unstubAllGlobals() }
})

it('falha no vídeo ampliado fecha o modal e o retry não reabre nem toca a nova URL sozinho', async () => {
  vi.mocked(carregarArquivo).mockResolvedValueOnce('blob:video-invalido').mockResolvedValueOnce('blob:video-correto')
  const pausa = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const tocar = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const { container, unmount } = render(<ResultadoEntrega entregaId={42} nome="campanha.mp4" />)
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Ampliar vídeo' }))
    fireEvent.error(screen.getByRole('dialog').querySelector('video')!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Não consegui mostrar o resultado aqui')
    expect(carregarArquivo).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await screen.findByRole('button', { name: 'Ampliar vídeo' })
    expect(container.querySelector('video')).toHaveAttribute('src', 'blob:video-correto')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(tocar).not.toHaveBeenCalled()
    expect(carregarArquivo).toHaveBeenCalledTimes(2)
  } finally { unmount(); pausa.mockRestore(); tocar.mockRestore() }
})

it('resposta tardia de outro vídeo é revogada sem aparecer na prévia ou ampliação atual', async () => {
  let antigo!: (url: string) => void
  vi.mocked(carregarArquivo).mockImplementationOnce(() => new Promise(resolve => { antigo = resolve })).mockResolvedValueOnce('blob:video-atual')
  const pausa = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const revogar = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: revogar }))
  const { container, rerender, unmount } = render(<ResultadoEntrega entregaId={42} nome="antigo.mp4" />)
  try {
    const sinal = vi.mocked(carregarArquivo).mock.calls[0][1]!
    rerender(<ResultadoEntrega entregaId={43} nome="atual.mp4" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ampliar vídeo' }))
    await act(async () => antigo('blob:video-tardio'))
    expect(sinal.aborted).toBe(true)
    expect(container.querySelector('video')).toHaveAttribute('src', 'blob:video-atual')
    expect(screen.getByRole('dialog', { name: 'Vídeo ampliado: atual.mp4' }).querySelector('video')).toHaveAttribute('src', 'blob:video-atual')
    expect(revogar).toHaveBeenCalledWith('blob:video-tardio')
    expect(revogar).not.toHaveBeenCalledWith('blob:video-atual')
    expect(carregarArquivo).toHaveBeenCalledTimes(2)
  } finally { unmount(); pausa.mockRestore(); vi.unstubAllGlobals() }
})

it('carregamento da prévia tem estado legível e troca de arquivo cancela o carregamento anterior', async () => {
  vi.mocked(carregarArquivo).mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce('blob:imagem-nova')
  const { rerender } = render(<ResultadoEntrega entregaId={43} nome="imagem-antiga.png" />)
  expect(screen.getByRole('status')).toHaveTextContent('Abrindo prévia…')
  const sinal = vi.mocked(carregarArquivo).mock.calls[0][1]!
  rerender(<ResultadoEntrega entregaId={44} nome="imagem-nova.png" />)
  expect(sinal.aborted).toBe(true)
  expect(await screen.findByAltText('imagem-nova.png')).toHaveAttribute('src', 'blob:imagem-nova')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByAltText('imagem-antiga.png')).not.toBeInTheDocument()
})

it('Word abre a leitura autenticada sem tentar interpretar o arquivo binário', async () => {
  vi.mocked(respostaAutenticada).mockResolvedValue(new Response('# Pautas para escolher\n\nAguardando sua escolha.\n*Pesquisa recente*'))
  render(<ResultadoEntrega entregaId={38} nome="pautas.docx" />)
  expect(temResultadoVisivel('pautas.docx')).toBe(true)
  expect(await screen.findByRole('heading', { name: 'Pautas para escolher' })).toBeInTheDocument()
  expect(screen.getByText('Pesquisa recente').tagName).toBe('EM')
  expect(respostaAutenticada).toHaveBeenCalledWith('/entregas/38/leitura', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(carregarArquivo).not.toHaveBeenCalled()
})
it('pesquisa abre com títulos e fontes clicáveis sem executar HTML ou carregar imagens externas', async () => {
  vi.mocked(respostaAutenticada).mockResolvedValue(new Response('# Cinco pautas\n\n## Trabalho e relações\n- **Formato:** carrossel\n- Fonte: [OMS](https://www.who.int/)\nFonte direta: https://www.gov.br/inss.\n<script>window.alert(1)</script>\n![remota](https://example.invalid/tracker.png)\n[ruim](javascript:alert(1))'))
  const { container } = render(<ResultadoEntrega entregaId={36} nome="pautas.md" />)
  expect(temResultadoVisivel('pautas.md')).toBe(true)
  expect(await screen.findByRole('heading', { name: 'Cinco pautas' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Trabalho e relações' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'OMS' })).toHaveAttribute('href', 'https://www.who.int/')
  expect(screen.getByRole('link', { name: 'https://www.gov.br/inss' })).toHaveAttribute('href', 'https://www.gov.br/inss')
  expect(screen.getAllByRole('link')).toHaveLength(2)
  expect(container.querySelector('script, img, iframe')).toBeNull()
  expect(screen.getByText('Formato:')).toBeInTheDocument()
  expect(respostaAutenticada).toHaveBeenCalledWith('/entregas/36/download', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})
it('texto excessivo não bloqueia a página e mantém alternativa de download', async () => {
  vi.mocked(respostaAutenticada).mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1)))
  render(<ResultadoEntrega entregaId={37} nome="grande.md" />)
  expect(await screen.findByText(/use o Baixar/)).toBeInTheDocument()
})
it('trocar de entrega limpa erro e mantém sandbox sem scripts', async () => {
  vi.mocked(respostaAutenticada).mockRejectedValueOnce(new Error('rede')).mockResolvedValueOnce(new Response('<h1>Peça nova</h1>'))
  const { rerender } = render(<ResultadoEntrega entregaId={1} nome="velho.html" />)
  await screen.findByText('Tentar novamente')
  rerender(<ResultadoEntrega entregaId={2} nome="novo.html" />)
  const iframe = await screen.findByTitle('novo.html')
  expect(iframe).toHaveAttribute('sandbox', '')
  expect(iframe).toHaveAttribute('srcdoc', expect.stringContaining('<h1>Peça nova</h1>'))
  expect(screen.queryByText('Tentar novamente')).toBeNull()
})
it('tenta novamente após falha sem precisar trocar de trabalho', async () => {
  vi.mocked(respostaAutenticada).mockRejectedValueOnce(new Error('rede')).mockResolvedValueOnce(new Response('<p>Pronto</p>'))
  render(<ResultadoEntrega entregaId={1} nome="post.html" />)
  fireEvent.click(await screen.findByText('Tentar novamente'))
  await waitFor(() => expect(screen.getByTitle('post.html')).toHaveAttribute('srcdoc', expect.stringContaining('<p>Pronto</p>')))
})
it('HTML com imagem embutida acima de 2 MB pode abrir', async () => {
  const texto = '<p>' + 'x'.repeat(2200000) + '</p>'
  vi.mocked(respostaAutenticada).mockResolvedValue(new Response(texto))
  render(<ResultadoEntrega entregaId={3} nome="arte.html" />)
  expect(await screen.findByTitle('arte.html')).toHaveAttribute('srcdoc', expect.stringContaining(texto))
})

it('PDF mostra páginas da mesma entrega e ancora o comentário na página escolhida', async () => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf-teste'), revokeObjectURL: vi.fn() }))
  vi.mocked(respostaAutenticada).mockImplementation(async () => new Response('png-sintetico', { headers: { 'X-Total-Paginas': '2' } }))
  const apontar = vi.fn()
  const { unmount } = render(<ResultadoEntrega entregaId={33} nome="slides.pdf" aoApontar={apontar} />)
  await screen.findByAltText('slides.pdf — página 1')
  fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
  await screen.findByAltText('slides.pdf — página 2')
  fireEvent.click(screen.getByRole('button', { name: 'Comentar nesta página' }))
  expect(apontar).toHaveBeenCalledWith({ pagina: 2 })
  expect(respostaAutenticada).toHaveBeenLastCalledWith('/entregas/33/previa/2', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalled()
  vi.unstubAllGlobals()
})

it('PDF com página indecodificável mostra erro e repete somente por escolha da pessoa', async () => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn().mockReturnValueOnce('blob:pdf-invalido').mockReturnValueOnce('blob:pdf-correto'), revokeObjectURL: vi.fn() }))
  let terminar!: (resposta: Response) => void
  vi.mocked(respostaAutenticada).mockResolvedValueOnce(new Response('png-danificado', { headers: { 'X-Total-Paginas': '2' } })).mockImplementationOnce(() => new Promise(resolve => { terminar = resolve }))
  const apontar = vi.fn()
  try {
    render(<ResultadoEntrega entregaId={33} nome="slides.pdf" aoApontar={apontar} />)
    fireEvent.error(await screen.findByAltText('slides.pdf — página 1'))
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível mostrar esta página.')
    expect(screen.queryByAltText('slides.pdf — página 1')).not.toBeInTheDocument()
    expect(respostaAutenticada).toHaveBeenCalledOnce()
    const repetir = screen.getByRole('button', { name: 'Tentar novamente' })
    repetir.focus(); fireEvent.click(repetir)
    expect(screen.getByRole('region', { name: 'Prévia de slides.pdf' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Abrindo página…')
    expect(screen.queryByAltText('slides.pdf — página 1')).not.toBeInTheDocument()
    await act(async () => terminar(new Response('png-valido')))
    const imagem = await screen.findByAltText('slides.pdf — página 1')
    fireEvent.load(imagem)
    expect(imagem).toHaveAttribute('src', 'blob:pdf-correto')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(respostaAutenticada).toHaveBeenCalledTimes(2)
    expect(apontar).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf-invalido')
  } finally { vi.unstubAllGlobals() }
})

it('PDF informa falha HTTP e conserva a rota exata na tentativa manual', async () => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf-correto'), revokeObjectURL: vi.fn() }))
  vi.mocked(respostaAutenticada).mockRejectedValueOnce(new Error('422')).mockResolvedValueOnce(new Response('png-valido'))
  try {
    render(<ResultadoEntrega entregaId={35} nome="revisao.pdf" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('O arquivo original continua disponível para baixar.')
    expect(respostaAutenticada).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    const imagem = await screen.findByAltText('revisao.pdf — página 1')
    fireEvent.load(imagem)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(respostaAutenticada).toHaveBeenNthCalledWith(2, '/entregas/35/previa/1', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  } finally { vi.unstubAllGlobals() }
})

it('falha de decoder da página anterior não substitui a página escolhida', async () => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn().mockReturnValueOnce('blob:pagina-1').mockReturnValueOnce('blob:pagina-2'), revokeObjectURL: vi.fn() }))
  let terminar!: (resposta: Response) => void
  vi.mocked(respostaAutenticada).mockResolvedValueOnce(new Response('png-1', { headers: { 'X-Total-Paginas': '2' } })).mockImplementationOnce(() => new Promise(resolve => { terminar = resolve }))
  const apontar = vi.fn()
  try {
    render(<ResultadoEntrega entregaId={33} nome="slides.pdf" aoApontar={apontar} />)
    const antiga = await screen.findByAltText('slides.pdf — página 1')
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    expect(vi.mocked(respostaAutenticada).mock.calls[0][1]!.signal!.aborted).toBe(true)
    fireEvent.error(antiga)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => terminar(new Response('png-2', { headers: { 'X-Total-Paginas': '2' } })))
    expect(await screen.findByAltText('slides.pdf — página 2')).toHaveAttribute('src', 'blob:pagina-2')
    fireEvent.error(antiga)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Comentar nesta página' }))
    expect(apontar).toHaveBeenCalledWith({ pagina: 2 })
    expect(respostaAutenticada).toHaveBeenLastCalledWith('/entregas/33/previa/2', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  } finally { vi.unstubAllGlobals() }
})

it('trocar de entrega durante retry de PDF ignora resposta e erro da entrega anterior', async () => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn().mockReturnValueOnce('blob:pdf-antigo').mockReturnValueOnce('blob:pdf-novo'), revokeObjectURL: vi.fn() }))
  let terminar!: (resposta: Response) => void
  vi.mocked(respostaAutenticada).mockResolvedValueOnce(new Response('png-danificado')).mockImplementationOnce(() => new Promise(resolve => { terminar = resolve })).mockResolvedValueOnce(new Response('png-novo'))
  try {
    const { rerender } = render(<ResultadoEntrega entregaId={33} nome="antigo.pdf" />)
    const antiga = await screen.findByAltText('antigo.pdf — página 1')
    fireEvent.error(antiga)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    const sinal = vi.mocked(respostaAutenticada).mock.calls[1][1]!.signal!
    rerender(<ResultadoEntrega entregaId={34} nome="novo.pdf" />)
    expect(sinal.aborted).toBe(true)
    expect(await screen.findByAltText('novo.pdf — página 1')).toHaveAttribute('src', 'blob:pdf-novo')
    await act(async () => terminar(new Response('png-antigo-tardio')))
    fireEvent.error(antiga)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByAltText('antigo.pdf — página 1')).not.toBeInTheDocument()
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
  } finally { vi.unstubAllGlobals() }
})

it('PDF descarta corpo tardio de outro login sem impedir renovação da mesma sessão', async () => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf-atual'), revokeObjectURL: vi.fn() }))
  let terminar!: (blob: Blob) => void
  const resposta = new Response('png-sintetico')
  vi.spyOn(resposta, 'blob').mockImplementationOnce(() => new Promise(resolve => { terminar = resolve }))
  vi.mocked(respostaAutenticada).mockResolvedValueOnce(resposta)
  try {
    const { rerender } = render(<ResultadoEntrega entregaId={33} nome="antigo.pdf" />)
    await waitFor(() => expect(resposta.blob).toHaveBeenCalledOnce())
    setTokens('outra-conta-fixture', 'outro-refresh-fixture')
    await act(async () => terminar(new Blob(['png-tardio'])))
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(screen.queryByAltText('antigo.pdf — página 1')).not.toBeInTheDocument()
    let concluirAtual!: (blob: Blob) => void
    const respostaAtual = new Response('png-atual')
    vi.spyOn(respostaAtual, 'blob').mockImplementationOnce(() => new Promise(resolve => { concluirAtual = resolve }))
    vi.mocked(respostaAutenticada).mockResolvedValueOnce(respostaAtual)
    rerender(<ResultadoEntrega entregaId={34} nome="atual.pdf" />)
    await waitFor(() => expect(respostaAtual.blob).toHaveBeenCalledOnce())
    const credenciais = JSON.parse(localStorage.getItem(AUTH_CREDENTIALS_KEY)!)
    localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ ...credenciais, access: 'renovado-fixture', refresh: 'refresh-renovado-fixture' }))
    await act(async () => concluirAtual(new Blob(['png-atual'])))
    expect(await screen.findByAltText('atual.pdf — página 1')).toHaveAttribute('src', 'blob:pdf-atual')
  } finally { vi.unstubAllGlobals() }
})

it('falha tardia do retry não substitui outra página do mesmo PDF', async () => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn().mockReturnValueOnce('blob:pagina-1').mockReturnValueOnce('blob:pagina-2'), revokeObjectURL: vi.fn() }))
  let falhar!: (erro: Error) => void
  vi.mocked(respostaAutenticada).mockResolvedValueOnce(new Response('png-danificado', { headers: { 'X-Total-Paginas': '2' } })).mockImplementationOnce(() => new Promise((_, reject) => { falhar = reject })).mockResolvedValueOnce(new Response('png-2', { headers: { 'X-Total-Paginas': '2' } }))
  try {
    render(<ResultadoEntrega entregaId={33} nome="slides.pdf" />)
    fireEvent.error(await screen.findByAltText('slides.pdf — página 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    const sinal = vi.mocked(respostaAutenticada).mock.calls[1][1]!.signal!
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    expect(sinal.aborted).toBe(true)
    expect(await screen.findByAltText('slides.pdf — página 2')).toHaveAttribute('src', 'blob:pagina-2')
    await act(async () => falhar(new Error('Erro antigo sintético')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByAltText('slides.pdf — página 2')).toBeVisible()
  } finally { vi.unstubAllGlobals() }
})


it('o comentário de áudio usa o instante atual e pausa a reprodução', async () => {
  vi.mocked(carregarArquivo).mockResolvedValue('blob:audio-teste')
  const pausa = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const apontar = vi.fn()
  const { container } = render(<ResultadoEntrega entregaId={34} nome="narracao.mp3" aoApontar={apontar} />)
  const comentar = await screen.findByRole('button', { name: 'Comentar neste instante' })
  container.querySelector('audio')!.currentTime = 12.5
  fireEvent.click(comentar)
  expect(pausa).toHaveBeenCalledOnce()
  expect(apontar).toHaveBeenCalledWith({ segundo: 12.5 })
  pausa.mockRestore()
})


it('prévia HTML bloqueia recursos remotos antes de renderizar o conteúdo e orienta sobre o original', async () => {
  const original = '<!doctype html><html><head><link rel="stylesheet" href="https://example.invalid/style.css"></head><body><h1>Campanha</h1><img src="https://example.invalid/tracker.png"><img src="data:image/png;base64,teste"></body></html>'
  vi.mocked(respostaAutenticada).mockResolvedValue(new Response(original))
  render(<ResultadoEntrega entregaId={35} nome="pagina.html" />)
  const iframe = await screen.findByTitle('pagina.html')
  expect(iframe).toHaveAttribute('sandbox', '')
  expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
  const previa = new DOMParser().parseFromString(iframe.getAttribute('srcdoc')!, 'text/html')
  expect(previa.compatMode).toBe('CSS1Compat')
  expect(previa.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy')
  expect(previa.head.firstElementChild?.getAttribute('content')).toContain("default-src 'none'")
  expect(previa.head.firstElementChild?.getAttribute('content')).toContain("img-src data: blob:")
  expect(previa.querySelector('h1')?.textContent).toBe('Campanha')
  expect(previa.querySelector('img[src^="data:"]')).not.toBeNull()
  expect(screen.getByText(/Imagens e fontes externas não carregam nesta prévia/)).toBeInTheDocument()
  expect(original).not.toContain('Content-Security-Policy')
})

it('amplia a mesma imagem sem outra transferência, fecha pelo teclado e devolve o foco', async () => {
  const abrir = vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true })
  const fechar = vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false })
  vi.mocked(carregarArquivo).mockResolvedValue('blob:card-original')
  try {
    render(<ResultadoEntrega entregaId={40} nome="card-01.png" />)
    const ampliar = await screen.findByRole('button', { name: 'Ampliar imagem' })
    ampliar.focus()
    fireEvent.click(ampliar)
    const dialogo = screen.getByRole('dialog', { name: 'Imagem ampliada: card-01.png' })
    expect(dialogo.querySelector('img')).toHaveAttribute('src', 'blob:card-original')
    expect(carregarArquivo).toHaveBeenCalledOnce()
    fireEvent(dialogo, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(ampliar).toHaveFocus()
    expect(abrir).toHaveBeenCalledOnce()
    expect(fechar).toHaveBeenCalledOnce()
  } finally { abrir.mockRestore(); fechar.mockRestore() }
})

it('permite conferir detalhes da imagem reduzida e retornar sem transferir outro arquivo', async () => {
  vi.mocked(carregarArquivo).mockResolvedValue('blob:card-original')
  render(<ResultadoEntrega entregaId={40} nome="card-01.png" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ampliar imagem' }))
  const imagem = screen.getByRole('dialog').querySelector('img')!
  const corpo = screen.getByRole('region', { name: 'Imagem de card-01.png' })
  Object.defineProperty(imagem, 'naturalWidth', { value: 1080 })
  Object.defineProperty(corpo, 'clientWidth', { value: 364 })
  fireEvent.load(imagem)
  fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes' }))
  const detalhes = screen.getByRole('region', { name: 'Detalhes de card-01.png' })
  expect(detalhes).toHaveAttribute('tabindex', '0')
  expect(screen.getByRole('status')).toHaveTextContent('Role ou deslize a imagem')
  expect(imagem).toHaveAttribute('src', 'blob:card-original')
  detalhes.scrollLeft = 80
  detalhes.scrollTop = 320
  fireEvent.click(screen.getByRole('button', { name: 'Ver imagem inteira' }))
  expect(screen.getByRole('region', { name: 'Imagem de card-01.png' })).toBe(corpo)
  expect(corpo.scrollLeft).toBe(0)
  expect(corpo.scrollTop).toBe(0)
  expect(carregarArquivo).toHaveBeenCalledOnce()
})

it('omite detalhes quando o original já cabe e mantém a volta após aumentar a janela', async () => {
  vi.mocked(carregarArquivo).mockResolvedValue('blob:card-original')
  render(<ResultadoEntrega entregaId={40} nome="card-01.png" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ampliar imagem' }))
  const imagem = screen.getByRole('dialog').querySelector('img')!
  const corpo = screen.getByRole('region', { name: 'Imagem de card-01.png' })
  Object.defineProperty(imagem, 'naturalWidth', { value: 1080 })
  Object.defineProperty(corpo, 'clientWidth', { configurable: true, value: 1118 })
  fireEvent.load(imagem)
  expect(screen.queryByRole('button', { name: 'Ver detalhes' })).not.toBeInTheDocument()
  Object.defineProperty(corpo, 'clientWidth', { configurable: true, value: 364 })
  fireEvent(window, new Event('resize'))
  fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes' }))
  Object.defineProperty(corpo, 'clientWidth', { configurable: true, value: 1118 })
  fireEvent(window, new Event('resize'))
  fireEvent.click(screen.getByRole('button', { name: 'Ver imagem inteira' }))
  expect(screen.queryByRole('button', { name: 'Ver detalhes' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Ver imagem inteira' })).not.toBeInTheDocument()
  expect(corpo).toHaveFocus()
  expect(carregarArquivo).toHaveBeenCalledOnce()
})

it('oferece zoom para retrato que cabe na largura mas excede a altura, sem carregar novamente', async () => {
  vi.mocked(carregarArquivo).mockResolvedValue('blob:retrato')
  render(<ResultadoEntrega entregaId={40} nome="card-01.png" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ampliar imagem' }))
  const imagem = screen.getByRole('dialog').querySelector('img')!
  const corpo = screen.getByRole('region', { name: 'Imagem de card-01.png' })
  Object.defineProperty(imagem, 'naturalWidth', { value: 600 })
  Object.defineProperty(imagem, 'naturalHeight', { value: 2000 })
  Object.defineProperty(corpo, 'clientWidth', { value: 1000 })
  Object.defineProperty(corpo, 'clientHeight', { value: 600 })
  fireEvent.load(imagem)
  expect(corpo).not.toHaveClass('resultado-entrega__ampliada-corpo--detalhes')
  fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes' }))
  expect(corpo).toHaveClass('resultado-entrega__ampliada-corpo--detalhes')
  fireEvent.click(screen.getByRole('button', { name: 'Ver imagem inteira' }))
  expect(corpo).not.toHaveClass('resultado-entrega__ampliada-corpo--detalhes')
  expect(carregarArquivo).toHaveBeenCalledOnce()
})

it('trocar de card fecha a ampliação e não mantém a imagem anterior na nova versão', async () => {
  const abrir = vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true })
  const fechar = vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false })
  vi.mocked(carregarArquivo).mockResolvedValueOnce('blob:card-1').mockResolvedValueOnce('blob:card-2')
  try {
    const { rerender } = render(<ResultadoEntrega entregaId={40} nome="card-01.png" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ampliar imagem' }))
    rerender(<ResultadoEntrega entregaId={41} nome="card-02.png" />)
    await waitFor(() => expect(screen.getByAltText('card-02.png')).toHaveAttribute('src', 'blob:card-2'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByAltText('card-01.png')).not.toBeInTheDocument()
  } finally { abrir.mockRestore(); fechar.mockRestore() }
})

it.each([['documento.md', 2, 8], ['pagina.html', 32, 36]] as const)('%s interrompe bytes reais acima do teto sem depender de metadados', async (nome, limiteMB, totalMB) => {
  let recebidos = 0
  const cancelar = vi.fn()
  const bloco = new Uint8Array(1024 * 1024).fill(120)
  const body = new ReadableStream({
    pull(controller) { if (recebidos === totalMB) controller.close(); else { recebidos++; controller.enqueue(bloco) } },
    cancel: cancelar,
  })
  vi.mocked(respostaAutenticada).mockResolvedValue(new Response(body))
  render(<ResultadoEntrega entregaId={1} nome={nome} tamanhoBytes={10} />)
  await screen.findByRole('alert')
  expect(recebidos).toBeLessThanOrEqual(limiteMB + 2)
  expect(cancelar).toHaveBeenCalledOnce()
})

it('Content-Length excessivo cancela o corpo antes da leitura', async () => {
  const cancelar = vi.fn()
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([120])) }, cancel: cancelar })
  vi.mocked(respostaAutenticada).mockResolvedValue(new Response(body, { headers: { 'Content-Length': String(3 * 1024 * 1024) } }))
  render(<ResultadoEntrega entregaId={1} nome="documento.md" tamanhoBytes={10} />)
  await screen.findByRole('alert')
  expect(cancelar).toHaveBeenCalledOnce()
})

it.each(['imagem.png', 'video.mp4', 'voz.mp3'])('falha ao decodificar %s aparece com retry por escolha da pessoa', async nome => {
  vi.mocked(carregarArquivo).mockResolvedValueOnce('blob:midia-invalida').mockResolvedValueOnce('blob:retry')
  const { container } = render(<ResultadoEntrega entregaId={5} nome={nome} />)
  await waitFor(() => expect(container.querySelector('img,video,audio')).not.toBeNull())
  fireEvent.error(container.querySelector('img,video,audio')!)
  expect(screen.getByRole('alert')).toHaveTextContent('Não consegui mostrar o resultado aqui — use o Baixar.')
  expect(carregarArquivo).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await waitFor(() => expect(container.querySelector('img,video,audio')).toHaveAttribute('src', 'blob:retry'))
  expect(carregarArquivo).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
