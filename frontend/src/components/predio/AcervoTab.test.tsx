import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { AcervoTab } from './AcervoTab'
import { ApiError, api, baixarArquivo, carregarArquivo } from '../../lib/api'

const avisos = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn() }))
const traducao = vi.hoisted(() => ({
  idioma: 'pt-BR' as 'pt-BR' | 'en',
  pt: (pt: string) => pt,
  en: (_pt: string, en: string) => en,
}))
vi.mock('../../lib/i18n', () => ({ useIdioma: () => ({ idioma: traducao.idioma, t: traducao.idioma === 'en' ? traducao.en : traducao.pt }) }))
vi.mock('../Toasts', () => ({ useToasts: () => avisos }))
vi.mock('./PortaVozes', () => ({ default: () => <div>Pessoas</div> }))
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn() }, baixarArquivo: vi.fn(), carregarArquivo: vi.fn() }
})

const material = (sub: string, nome = 'arquivo.txt') => ({ nome, sub, tamanho_bytes: 10, legenda: 'Material enviado', tags: ['campanha'] })
const listar = (entrada = [material('conversa-11/lote-a'), material('conversa-12/lote-b')], exemplos: object[] = []) => {
  vi.mocked(api.get).mockResolvedValue({ entrada, exemplos, marca: [], produto: [], aprovados: [] })
}
const base = '/predios/1/conteudo/arquivos/entrada/arquivo.txt'
const miniaturasVisiveis: Array<() => void> = []
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

beforeEach(() => {
  traducao.idioma = 'pt-BR'
  vi.clearAllMocks()
  localStorage.clear(); sessionStorage.clear()
  vi.mocked(api.post).mockResolvedValue({})
  vi.mocked(api.patch).mockResolvedValue({})
  vi.mocked(api.del).mockResolvedValue(undefined)
  vi.mocked(baixarArquivo).mockResolvedValue(undefined)
  vi.mocked(carregarArquivo).mockResolvedValue('blob:material')
  vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn() })
  miniaturasVisiveis.length = 0
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { miniaturasVisiveis.push(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)) }
    observe() {} disconnect() {}
  })
  listar()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('importação concluída aparece como arquivo real no Acervo sem alterar ou criar conversa', async () => {
  let importado = false
  vi.mocked(api.get).mockImplementation(async path => {
    expect(path).toBe('/predios/1/conteudo/arquivos')
    return { entrada: importado ? [material('youtube/qa', 'entrevista.mp4')] : [], exemplos: [], marca: [], produto: [], aprovados: [] }
  })
  vi.mocked(api.post).mockImplementation(async (_path, body) => {
    const pedido = body as { url: string; pasta: string; chave_importacao: string }
    importado = true
    return { id: pedido.chave_importacao, url: pedido.url, pasta: pedido.pasta, status: 'concluido', nome: 'entrevista.mp4', tamanho_bytes: 1024 }
  })
  render(<AcervoTab orgId={1} slug="conteudo" />)
  fireEvent.click(screen.getByRole('button', { name: 'Importar por link' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' }), { target: { value: 'https://www.youtube.com/watch?v=7fE3ShzZZ_Y' } })
  fireEvent.click(screen.getByRole('button', { name: 'Importar arquivos' }))
  expect(await screen.findByRole('button', { name: 'Baixar youtube/qa/entrevista.mp4' })).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/predios/1/conteudo/arquivos/importacoes-youtube', {
    url: 'https://www.youtube.com/watch?v=7fE3ShzZZ_Y', pasta: 'entrada', chave_importacao: expect.any(String),
  })
  expect(api.get).toHaveBeenCalledTimes(2)
})

it('upload alternativo mantém a aba atual e guarda em Chegou agora sem confundir destino', async () => {
  listar([])
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(403, 'Vídeo indisponível. Envie o arquivo.'))
  vi.mocked(api.postForm).mockResolvedValue({})
  render(<AcervoTab orgId={1} slug="conteudo" />)
  fireEvent.click(screen.getByRole('button', { name: 'Importar por link' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' }), { target: { value: 'https://www.youtube.com/watch?v=7fE3ShzZZ_Y' } })
  fireEvent.click(screen.getByRole('button', { name: 'Importar arquivos' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('tab', { name: /O produto/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Enviar arquivo do computador' }))
  fireEvent.change(screen.getByLabelText('Enviar arquivo alternativo ao Acervo'), { target: { files: [new File(['fixture'], 'video.mp4')] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalledOnce())
  expect(api.postForm).toHaveBeenCalledWith('/predios/1/conteudo/arquivos?pasta=entrada', expect.any(FormData))
  expect(screen.getByRole('tab', { name: /O produto/ })).toHaveAttribute('aria-selected', 'true')
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('carrossel importado mostra os arquivos na ordem original sem gerar conversa ou trabalho', async () => {
  let importado = false
  const arquivos = [1, 2].map(ordem => ({ nome: `${ordem}-foto.jpg`, tamanho_bytes: 12000, ordem, tipo_midia: 'imagem', duracao_segundos: null }))
  vi.mocked(api.get).mockImplementation(async path => {
    expect(path).toBe('/predios/1/conteudo/arquivos')
    return { entrada: importado ? arquivos.map(item => material('instagram/qa', item.nome)) : [], exemplos: [], marca: [], produto: [], aprovados: [] }
  })
  vi.mocked(api.post).mockImplementation(async (_path, body) => {
    const pedido = body as { url: string; pasta: string; chave_importacao: string }
    importado = true
    return { id: pedido.chave_importacao, url: pedido.url, pasta: pedido.pasta, status: 'concluido', arquivos, qtd_arquivos: 2, total_arquivos: 2 }
  })
  render(<AcervoTab orgId={1} slug="conteudo" />)
  fireEvent.click(screen.getByRole('button', { name: 'Importar por link' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' }), { target: { value: 'https://www.instagram.com/p/DeZLx9YgY6K/' } })
  fireEvent.click(screen.getByRole('button', { name: 'Importar arquivos' }))
  expect(await screen.findByRole('button', { name: 'Baixar instagram/qa/1-foto.jpg' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Baixar instagram/qa/2-foto.jpg' })).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/predios/1/conteudo/arquivos/importacoes-instagram', {
    url: 'https://www.instagram.com/p/DeZLx9YgY6K/', pasta: 'entrada', chave_importacao: expect.any(String),
  })
  expect(api.get).toHaveBeenCalledTimes(2)
})

it('move apenas o homônimo selecionado e mantém o contrato de destino', async () => {
  render(<AcervoTab orgId={1} slug="conteudo" />)
  const select = await screen.findByRole('combobox', { name: 'Mover conversa-12/lote-b/arquivo.txt' })
  fireEvent.change(select, { target: { value: 'produto' } })
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(`${base}/mover?sub=conversa-12%2Flote-b`, { para: 'produto' }))
  expect(screen.getByRole('combobox', { name: 'Mover conversa-11/lote-a/arquivo.txt' })).toBeInTheDocument()
})

it('excluir confirma o caminho completo e envia a subpasta correta', async () => {
  const nativo = vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('Host sem confirmação nativa') })
  render(<AcervoTab orgId={1} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Excluir conversa-12/lote-b/arquivo.txt' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('conversa-12/lote-b/arquivo.txt')
  expect(api.del).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Remover arquivo' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledWith(`${base}?sub=conversa-12%2Flote-b`))
  expect(nativo).not.toHaveBeenCalled()
})

it('cancelar a remoção preserva o arquivo e o foco', async () => {
  render(<AcervoTab orgId={1} slug="conteudo" />)
  const abrir = await screen.findByRole('button', { name: 'Excluir conversa-12/lote-b/arquivo.txt' })
  abrir.focus()
  fireEvent.click(abrir)
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(abrir).toHaveFocus()
  expect(api.del).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Excluir conversa-12/lote-b/arquivo.txt' })).toBeInTheDocument()
})

it('resposta antiga não substitui o acervo de outra empresa', async () => {
  let antiga!: (valor: object) => void
  vi.mocked(api.get).mockImplementation(async url => url.startsWith('/predios/1/')
    ? new Promise(resolve => { antiga = resolve })
    : { entrada: [material('', 'empresa-dois.txt')], exemplos: [], marca: [], produto: [], aprovados: [] })
  const tela = render(<AcervoTab orgId={1} slug="conteudo" />)
  await waitFor(() => expect(api.get).toHaveBeenCalled())
  tela.rerender(<AcervoTab orgId={2} slug="conteudo" />)
  await screen.findByRole('button', { name: 'Baixar empresa-dois.txt' })
  await act(async () => antiga({ entrada: [material('', 'empresa-um.txt')], exemplos: [], marca: [], produto: [], aprovados: [] }))
  expect(screen.getByRole('button', { name: 'Baixar empresa-dois.txt' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Baixar empresa-um.txt' })).not.toBeInTheDocument()
})

it('refresh antigo não desfaz a listagem mais recente depois de mover arquivos', async () => {
  const inicial = { entrada: [material('conversa-11/lote-a'), material('conversa-12/lote-b')], exemplos: [], marca: [], produto: [], aprovados: [] }
  let antiga!: (valor: object) => void
  vi.mocked(api.get).mockResolvedValueOnce(inicial)
    .mockImplementationOnce(() => new Promise(resolve => { antiga = resolve }))
    .mockResolvedValue({ ...inicial, entrada: [] })
  render(<AcervoTab orgId={1} slug="conteudo" />)
  fireEvent.change(await screen.findByRole('combobox', { name: 'Mover conversa-11/lote-a/arquivo.txt' }), { target: { value: 'produto' } })
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  fireEvent.change(screen.getByRole('combobox', { name: 'Mover conversa-12/lote-b/arquivo.txt' }), { target: { value: 'produto' } })
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Mover conversa-12/lote-b/arquivo.txt' })).not.toBeInTheDocument())
  await act(async () => antiga(inicial))
  expect(screen.queryByRole('combobox', { name: 'Mover conversa-11/lote-a/arquivo.txt' })).not.toBeInTheDocument()
})

it('trocar empresa durante upload encerra o lote sem enviar o próximo arquivo nem toast antigo', async () => {
  let concluir!: () => void
  vi.mocked(api.postForm).mockImplementation(() => new Promise<void>(resolve => { concluir = resolve }))
  const tela = render(<AcervoTab orgId={1} slug="conteudo" />)
  await screen.findByRole('button', { name: 'Baixar conversa-11/lote-a/arquivo.txt' })
  fireEvent.change(screen.getByLabelText('Enviar arquivo ao acervo'), { target: { files: [new File(['a'], 'primeiro.txt'), new File(['b'], 'segundo.txt')] } })
  expect(api.postForm).toHaveBeenCalledOnce()
  tela.rerender(<AcervoTab orgId={2} slug="conteudo" />)
  await act(async () => concluir())
  expect(api.postForm).toHaveBeenCalledOnce()
  expect(avisos.sucesso).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Enviar arquivo ao acervo')).not.toBeDisabled()
})

it('renomeia dentro da subpasta sem trocar a identidade do homônimo', async () => {
  const promptNativo = vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('Host sem prompt nativo') })
  render(<AcervoTab orgId={1} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Renomear conversa-11/lote-a/arquivo.txt' }))
  expect(screen.getByRole('form', { name: 'Renomear conversa-11/lote-a/arquivo.txt' })).toBeInTheDocument()
  const campo = screen.getByRole('textbox', { name: 'Novo nome do arquivo' })
  expect(campo).toHaveFocus()
  expect(campo).toHaveValue('arquivo.txt')
  expect(screen.getByRole('button', { name: 'Salvar nome' })).toBeDisabled()
  fireEvent.change(campo, { target: { value: 'campanha.txt' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nome' }))
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`${base}?sub=conversa-11%2Flote-a`, { novo_nome: 'campanha.txt' }))
  expect(promptNativo).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
  expect(screen.getByRole('textbox', { name: 'Buscar no acervo' })).toHaveFocus()
})

it('cancelar ou Escape fecha a renomeação sem gravar e devolve o foco à origem', async () => {
  render(<AcervoTab orgId={1} slug="conteudo" />)
  const abrir = await screen.findByRole('button', { name: 'Renomear conversa-12/lote-b/arquivo.txt' })
  fireEvent.click(abrir)
  fireEvent.change(screen.getByRole('textbox', { name: 'Novo nome do arquivo' }), { target: { value: 'outro.txt' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Novo nome do arquivo' }), { key: 'Escape' })
  expect(screen.queryByRole('form')).not.toBeInTheDocument()
  expect(abrir).toHaveFocus()
  fireEvent.click(abrir)
  expect(screen.getByRole('textbox', { name: 'Novo nome do arquivo' })).toHaveValue('arquivo.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(abrir).toHaveFocus()
  expect(api.patch).not.toHaveBeenCalled()
})

it('erro de renomeação mantém nome e busca para corrigir ou tentar novamente', async () => {
  vi.mocked(api.patch).mockRejectedValueOnce(new Error('Falha temporária'))
  render(<AcervoTab orgId={1} slug="conteudo" />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar no acervo' }), { target: { value: 'lote-b' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Renomear conversa-12/lote-b/arquivo.txt' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Novo nome do arquivo' }), { target: { value: 'campanha.txt' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nome' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui renomear agora')
  expect(screen.getByRole('textbox', { name: 'Novo nome do arquivo' })).toHaveValue('campanha.txt')
  expect(screen.getByRole('textbox', { name: 'Buscar no acervo' })).toHaveValue('lote-b')
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nome' }))
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
  expect(api.patch).toHaveBeenLastCalledWith(`${base}?sub=conversa-12%2Flote-b`, { novo_nome: 'campanha.txt' })
})

it('miniaturas e download usam caminhos distintos para imagens de mesmo nome', async () => {
  listar([material('ensaio-a', 'foto.jpg'), material('ensaio-b', 'foto.jpg')])
  render(<AcervoTab orgId={1} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Baixar ensaio-b/foto.jpg' }))
  expect(carregarArquivo).not.toHaveBeenCalled()
  act(() => miniaturasVisiveis.forEach(mostrar => mostrar()))
  await waitFor(() => expect(carregarArquivo).toHaveBeenCalledTimes(2))
  expect(baixarArquivo).toHaveBeenCalledWith('/predios/1/conteudo/arquivos/entrada/foto.jpg?sub=ensaio-b', 'foto.jpg')
  expect(carregarArquivo).toHaveBeenCalledWith('/predios/1/conteudo/arquivos/entrada/foto.jpg/miniatura?sub=ensaio-a', expect.any(AbortSignal))
  expect(carregarArquivo).toHaveBeenCalledWith('/predios/1/conteudo/arquivos/entrada/foto.jpg/miniatura?sub=ensaio-b', expect.any(AbortSignal))
})

it('prévia atrasada não substitui o homônimo aberto depois', async () => {
  listar([material('ensaio-a', 'video.mp4'), material('ensaio-b', 'video.mp4')])
  let resolverA!: (url: string) => void
  let resolverB!: (url: string) => void
  vi.mocked(carregarArquivo).mockImplementation((url) => new Promise<string>((resolve) => {
    if (url.endsWith('ensaio-a')) resolverA = resolve
    else resolverB = resolve
  }))
  render(<AcervoTab orgId={1} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir ensaio-a/video.mp4' }))
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Abrir ensaio-b/video.mp4' }))
  await act(async () => { resolverB('blob:video-b'); resolverA('blob:video-a') })
  const dialogo = screen.getByRole('dialog', { name: 'ensaio-b/video.mp4' })
  expect(dialogo.querySelector('video')).toHaveAttribute('src', 'blob:video-b')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video-a')
})

it('arquivar referência conserva a subpasta no pedido', async () => {
  listar([], [{ ...material('campanha-a'), em_uso: true }])
  render(<AcervoTab orgId={1} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('tab', { name: /Referências/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Arquivar campanha-a/arquivo.txt' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/1/conteudo/arquivos/exemplos/arquivo.txt/uso?sub=campanha-a', { em_uso: false }))
})

it('prévia modal fecha com Escape e retorna ao arquivo sem perder busca ou baixar de novo', async () => {
  listar([material('ensaio-a', 'video.mp4'), material('ensaio-b', 'video.mp4')])
  render(<AcervoTab orgId={1} slug="conteudo" />)
  const busca = screen.getByRole('textbox', { name: 'Buscar no acervo' })
  fireEvent.change(busca, { target: { value: 'ensaio-b' } })
  const origem = await screen.findByRole('button', { name: 'Abrir ensaio-b/video.mp4' })
  origem.focus()
  fireEvent.click(origem)
  const dialogo = await screen.findByRole('dialog', { name: 'ensaio-b/video.mp4' })
  expect(dialogo.tagName).toBe('DIALOG')
  expect(dialogo).toHaveAttribute('open')
  expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus()
  await waitFor(() => expect(dialogo.querySelector('video')).toHaveAttribute('src', 'blob:material'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'Fechar' }), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(origem).toHaveFocus()
  expect(busca).toHaveValue('ensaio-b')
  expect(carregarArquivo).toHaveBeenCalledTimes(1)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:material')
  expect(api.post).not.toHaveBeenCalled()
})

it('homônimos em subpastas diferentes contam para o teto de referências', async () => {
  listar([], [...Array.from({ length: 5 }, (_, i) => ({ ...material(`campanha-${i}`), em_uso: true })), { ...material('nova'), em_uso: false }])
  render(<AcervoTab orgId={1} slug="conteudo" />)
  fireEvent.click(await screen.findByRole('tab', { name: /Referências/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Usar nova/arquivo.txt' }))
  expect(avisos.falha).toHaveBeenCalledWith(expect.stringContaining('Já são 5 referências'))
  expect(api.post).not.toHaveBeenCalled()
})

it('inglês traduz controles e preserva nome, legenda, tags e identidade do arquivo selecionado', async () => {
  traducao.idioma = 'en'
  const original = { ...material('campanha-joão', 'ação.jpg'), legenda: 'Foto original do lançamento', tags: ['coleção-verão'], destino_sugerido: 'acervo' }
  listar([original])
  render(<AcervoTab orgId={1} slug="conteudo" />)
  const mover = await screen.findByRole('combobox', { name: 'Move campanha-joão/ação.jpg' })
  expect(screen.getByRole('heading', { name: 'Your materials' })).toBeInTheDocument()
  expect(screen.getByText('Foto original do lançamento')).toBeInTheDocument()
  expect(screen.getByText('coleção-verão')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save in Product' })).toBeInTheDocument()
  fireEvent.change(mover, { target: { value: 'produto' } })
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/1/conteudo/arquivos/entrada/a%C3%A7%C3%A3o.jpg/mover?sub=campanha-jo%C3%A3o', { para: 'produto' }))
  fireEvent.click(screen.getByRole('button', { name: 'Download campanha-joão/ação.jpg' }))
  expect(baixarArquivo).toHaveBeenCalledWith('/predios/1/conteudo/arquivos/entrada/a%C3%A7%C3%A3o.jpg?sub=campanha-jo%C3%A3o', 'ação.jpg')
  expect(original).toMatchObject({ nome: 'ação.jpg', legenda: 'Foto original do lançamento', tags: ['coleção-verão'], destino_sugerido: 'acervo' })
})

it('acervo cheio busca além dos primeiros 24 arquivos e preserva o caminho ao baixar', async () => {
  listar(Array.from({ length: 120 }, (_, i) => material(`lote-${i}`, i === 119 ? 'ação-final.txt' : `arquivo-${i}.txt`)))
  render(<AcervoTab orgId={1} slug="conteudo" />)
  await screen.findByRole('button', { name: 'Baixar lote-0/arquivo-0.txt' })
  expect(screen.queryByRole('button', { name: 'Baixar lote-24/arquivo-24.txt' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar mais arquivos' }))
  expect(screen.getByRole('button', { name: 'Baixar lote-24/arquivo-24.txt' })).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar no acervo' }), { target: { value: 'acao-final' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Baixar lote-119/ação-final.txt' }))
  expect(baixarArquivo).toHaveBeenCalledWith('/predios/1/conteudo/arquivos/entrada/a%C3%A7%C3%A3o-final.txt?sub=lote-119', 'ação-final.txt')
})

it('nome legível mantém o arquivo completo no tooltip e a identidade ao abrir', async () => {
  listar([material('conversa-12/3bc63fad8333', 'BFR-Manual-da-Marca-2024-FINAL.pdf')])
  render(<AcervoTab orgId={1} slug="conteudo" />)
  const nome = await screen.findByRole('button', { name: 'Ver conversa-12/3bc63fad8333/BFR-Manual-da-Marca-2024-FINAL.pdf' })
  expect(nome).toHaveTextContent('BFR Manual da Marca 2024 FINAL')
  expect(nome).toHaveAttribute('title', 'conversa-12/3bc63fad8333/BFR-Manual-da-Marca-2024-FINAL.pdf')
  expect(screen.queryByText('entrada/')).not.toBeInTheDocument()
  expect(carregarArquivo).not.toHaveBeenCalled()
  fireEvent.click(nome)
  expect(screen.getByRole('dialog', { name: 'conversa-12/3bc63fad8333/BFR-Manual-da-Marca-2024-FINAL.pdf' })).toBeInTheDocument()
})

it('nome opaco não vira título inventado e continua encontrável pelo arquivo original', async () => {
  const arquivo = '3bc63fad83334caabb11223344556677.jpg'
  listar([{ ...material('conversa-12/3bc63fad83334caabb11223344556677', arquivo), legenda: 'Foto da arquibancada', tags: ['torcida'] }])
  render(<AcervoTab orgId={1} slug="conteudo" />)
  const abrir = await screen.findByRole('button', { name: `Ver conversa-12/3bc63fad83334caabb11223344556677/${arquivo}` })
  expect(abrir).toHaveTextContent(/^Imagem$/)
  expect(screen.getByText('Foto da arquibancada')).toBeInTheDocument()
  expect(screen.getByText(/Conversa 12/)).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar no acervo' }), { target: { value: '11223344556677' } })
  expect(screen.getByRole('button', { name: `Baixar conversa-12/3bc63fad83334caabb11223344556677/${arquivo}` })).toBeInTheDocument()
})

it('vídeo importado deixa o ID técnico no tooltip e conserva o nome de download', async () => {
  listar([material('entrevistas', 'entrevista-tite-ge-7fE3ShzZZ_Y.mp4')])
  render(<AcervoTab orgId={1} slug="conteudo" />)
  const nome = await screen.findByRole('button', { name: 'Ver entrevistas/entrevista-tite-ge-7fE3ShzZZ_Y.mp4' })
  expect(nome).toHaveTextContent(/^entrevista tite ge$/)
  expect(nome).toHaveAttribute('title', 'entrevistas/entrevista-tite-ge-7fE3ShzZZ_Y.mp4')
  fireEvent.click(screen.getByRole('button', { name: 'Baixar entrevistas/entrevista-tite-ge-7fE3ShzZZ_Y.mp4' }))
  expect(baixarArquivo).toHaveBeenCalledWith('/predios/1/conteudo/arquivos/entrada/entrevista-tite-ge-7fE3ShzZZ_Y.mp4?sub=entrevistas', 'entrevista-tite-ge-7fE3ShzZZ_Y.mp4')
})
