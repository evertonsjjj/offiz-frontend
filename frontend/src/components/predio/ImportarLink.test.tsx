import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ImportarLink from './ImportarLink'
import { ApiError, api, clearTokens, getSessionIdentity, setTokens } from '../../lib/api'

const idioma = vi.hoisted(() => ({ atual: 'pt-BR', pt: (pt: string) => pt, en: (_pt: string, en: string) => en }))
vi.mock('../../lib/i18n', () => ({ useIdioma: () => ({ idioma: idioma.atual, t: idioma.atual === 'en' ? idioma.en : idioma.pt }) }))
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } }
})
const url = 'https://www.youtube.com/watch?v=7fE3ShzZZ_Y'
const base = '/predios/1/conteudo/arquivos/importacoes-youtube'
const uuid = '73be275b-7be9-4bac-87ee-ef1b4d216d9e'
const tentativa = { id: uuid, url, pasta: 'entrada' }
const resposta = (estado = 'na_fila', origem = tentativa, resto: object = {}) => ({
  ...origem, status: estado, nome: null, tamanho_bytes: null, duracao_segundos: null, erro: null, ...resto,
})
const callbacks = { aoImportar: vi.fn(), aoEnviarArquivo: vi.fn() }
const props = { orgId: 1, slug: 'conteudo', pasta: 'entrada' as const, disponivel: true, ...callbacks }
const chave = () => `offiz.importacao-link:${getSessionIdentity()}:1:conteudo`
const abrir = () => fireEvent.click(screen.getByRole('button', { name: 'Importar por link' }))
const preencher = (valor = url) => fireEvent.change(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' }), { target: { value: valor } })
const iniciar = () => fireEvent.click(screen.getByRole('button', { name: 'Importar arquivos' }))
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear(); sessionStorage.clear()
  setTokens('access-sintetico', 'refresh-sintetico')
  idioma.atual = 'pt-BR'
  vi.mocked(api.post).mockImplementation(async (_path, body) => {
    const enviado = body as { chave_importacao: string; url: string; pasta: string }
    return resposta('na_fila', { id: enviado.chave_importacao, url: enviado.url, pasta: enviado.pasta })
  })
  vi.mocked(api.get).mockImplementation(async path => {
    const atual = JSON.parse(sessionStorage.getItem(chave()) || 'null') as typeof tentativa | null
    return resposta('em_andamento', { ...tentativa, ...(atual || {}), id: path.split('/').pop() || uuid })
  })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('colar um link e fechar o painel não importa nem transforma a referência em arquivo', () => {
  render(<ImportarLink {...props} />)
  abrir(); preencher()
  expect(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' })).toHaveFocus()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.get).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar importação' }))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Importar por link' })).toHaveFocus()
  abrir()
  expect(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' })).toHaveValue(url)
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['http://youtube.com/watch?v=abc', 'https://youtube.com.evil.example/watch?v=abc', 'https://youtube.com@evil.example/video', 'https://www.youtube.com:123/watch?v=abc', 'https://example.com/video'])('recusa link %s antes da chamada', valor => {
  render(<ImportarLink {...props} />)
  abrir(); preencher(valor); iniciar()
  expect(screen.getByRole('button', { name: 'Importar arquivos' })).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
})

it('guarda UUID antes do único POST e bloqueia clique duplo e edição enquanto aguarda', async () => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  render(<ImportarLink {...props} />)
  abrir(); preencher(` ${url} `); iniciar()
  const [path, body] = vi.mocked(api.post).mock.calls[0]
  const enviado = body as { chave_importacao: string }
  expect(path).toBe(base)
  expect(body).toEqual({ url, pasta: 'entrada', chave_importacao: expect.stringMatching(/^[0-9a-f-]{36}$/) })
  expect(JSON.parse(sessionStorage.getItem(chave())!)).toEqual({ id: enviado.chave_importacao, url, pasta: 'entrada' })
  fireEvent.submit(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' }).closest('form')!)
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' })).toBeDisabled()
  expect(api.get).not.toHaveBeenCalled()
  await act(async () => resolver(resposta('na_fila', { ...tentativa, id: enviado.chave_importacao })))
  expect(screen.getByRole('status')).toHaveTextContent('Na fila')
})

it('consultar uma resposta perdida usa o UUID original e recupera o arquivo sem outro POST', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(0, 'Sem conexão'))
  vi.mocked(api.get).mockImplementationOnce(async path => resposta('concluido', { ...tentativa, id: path.split('/').pop()! }, { nome: 'entrevista.mp4', tamanho_bytes: 9000, duracao_segundos: 2075 }))
  render(<ImportarLink {...props} />)
  abrir(); preencher(); iniciar()
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Vídeo guardado no Acervo: entrevista.mp4'))
  const body = vi.mocked(api.post).mock.calls[0][1] as { chave_importacao: string }
  expect(api.get).toHaveBeenCalledExactlyOnceWith(`${base}/${body.chave_importacao}`, expect.any(AbortSignal))
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(callbacks.aoImportar).toHaveBeenCalledTimes(1)
  expect(sessionStorage.getItem(chave())).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('Duração: 34:35')
  expect(screen.getByRole('link', { name: 'Origem no YouTube' })).toHaveAttribute('href', url)
  expect(screen.queryByRole('button', { name: 'Importar arquivos' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Importar outro link' }))
  expect(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' })).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Importar arquivos' })).toBeDisabled()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('404 após resposta perdida preserva a incerteza, URL e tentativa para consulta manual', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(0, 'Sem conexão'))
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(404, 'Não encontrada'))
  render(<ImportarLink {...props} />)
  abrir(); preencher(); iniciar()
  expect(await screen.findByRole('alert')).toHaveTextContent('A importação não foi encontrada')
  expect(screen.queryByRole('button', { name: 'Importar arquivos' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' })).toHaveValue(url)
  expect(sessionStorage.getItem(chave())).not.toBeNull()
  const id = JSON.parse(sessionStorage.getItem(chave())!).id as string
  fireEvent.click(screen.getByRole('button', { name: 'Verificar importação' }))
  await screen.findByText('Importando e conferindo os arquivos…')
  expect(api.get).toHaveBeenLastCalledWith(`${base}/${id}`, expect.any(AbortSignal))
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('nova solicitação humana após GET404 reaproveita o mesmo UUID, URL e destino', async () => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativa))
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(404, 'Não encontrada'))
  const tela = render(<ImportarLink {...props} />)
  const solicitar = await screen.findByRole('button', { name: 'Solicitar esta importação' })
  expect(api.post).not.toHaveBeenCalled()
  // Mudar a aba de destino não modifica a tentativa que já está em consulta.
  tela.rerender(<ImportarLink {...props} pasta="produto" />)
  fireEvent.click(solicitar)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Na fila'))
  expect(api.post).toHaveBeenCalledExactlyOnceWith(base, { url, pasta: 'entrada', chave_importacao: uuid })
  expect(JSON.parse(sessionStorage.getItem(chave())!)).toEqual(tentativa)
})

it('GET incerto não permite solicitar de novo nem transforma falha de rede em ausência', async () => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativa))
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(503, 'Indisponível'))
  render(<ImportarLink {...props} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('não repete o download')
  expect(screen.queryByRole('button', { name: 'Solicitar esta importação' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(chave())).not.toBeNull()
})

it('reabrir a tela consulta a tentativa pendente sem reenviar ou apagar o servidor', async () => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativa))
  vi.mocked(api.get).mockResolvedValue(resposta('em_andamento'))
  const tela = render(<ImportarLink {...props} />)
  expect(await screen.findByRole('status')).toHaveTextContent('Importando')
  fireEvent.click(screen.getByRole('button', { name: 'Fechar importação' }))
  expect(api.del).not.toHaveBeenCalled()
  tela.unmount()
  render(<ImportarLink {...props} />)
  expect(await screen.findByRole('status')).toHaveTextContent('Importando')
  expect(api.post).not.toHaveBeenCalled()
  expect(api.get).toHaveBeenCalledTimes(2)
})

it.each(['falhou', 'interrompido'])('estado terminal %s expõe motivo e upload alternativo sem repetir', async estado => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativa))
  vi.mocked(api.get).mockResolvedValue(resposta(estado, tentativa, { erro: 'O YouTube bloqueou o vídeo. Envie o arquivo.' }))
  render(<ImportarLink {...props} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('O YouTube bloqueou o vídeo')
  fireEvent.click(screen.getByRole('button', { name: 'Enviar arquivo do computador' }))
  expect(callbacks.aoEnviarArquivo).toHaveBeenCalledOnce()
  expect(api.post).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(chave())).toBeNull()
  expect(screen.getByRole('button', { name: 'Importar arquivos' })).toBeEnabled()
})

it('consulta periodicamente apenas enquanto servidor confirma estado ativo e para ao concluir', async () => {
  vi.useFakeTimers()
  sessionStorage.setItem(chave(), JSON.stringify(tentativa))
  vi.mocked(api.get).mockResolvedValueOnce(resposta('na_fila')).mockResolvedValueOnce(resposta('em_andamento'))
    .mockResolvedValue(resposta('concluido', tentativa, { nome: 'entrevista.mp4', tamanho_bytes: 1024 }))
  render(<ImportarLink {...props} />)
  await act(async () => {})
  expect(api.get).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(api.get).toHaveBeenCalledTimes(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.getByRole('status')).toHaveTextContent('entrevista.mp4')
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(api.get).toHaveBeenCalledTimes(3)
  expect(callbacks.aoImportar).toHaveBeenCalledOnce()
})

it('falha de consulta interrompe o polling e permite conferir sem mutação nova', async () => {
  vi.useFakeTimers()
  sessionStorage.setItem(chave(), JSON.stringify(tentativa))
  vi.mocked(api.get).mockResolvedValueOnce(resposta('na_fila')).mockRejectedValueOnce(new ApiError(502, 'Indisponível'))
  render(<ImportarLink {...props} />)
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.getByRole('alert')).toHaveTextContent('não repete o download')
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['outra empresa', 'outro andar', 'novo login'])('resposta atrasada depois de %s não atualiza o Acervo errado', async mudanca => {
  let resolver!: (valor: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const tela = render(<ImportarLink {...props} />)
  abrir(); preencher(); iniciar()
  const enviado = vi.mocked(api.post).mock.calls[0][1] as { chave_importacao: string }
  if (mudanca === 'novo login') setTokens('access-novo', 'refresh-novo')
  tela.rerender(<ImportarLink {...props} orgId={mudanca === 'outra empresa' ? 2 : 1} slug={mudanca === 'outro andar' ? 'juridico' : 'conteudo'} />)
  await act(async () => resolver(resposta('concluido', { ...tentativa, id: enviado.chave_importacao }, { nome: 'antiga.mp4', tamanho_bytes: 2000 })))
  expect(callbacks.aoImportar).not.toHaveBeenCalled()
  expect(screen.queryByText(/antiga.mp4/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Importar por link' })).toBeEnabled()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('sessão trocada antes do render impede iniciar a ação da tela anterior', () => {
  render(<ImportarLink {...props} />)
  abrir(); preencher()
  clearTokens()
  iniciar()
  expect(api.post).not.toHaveBeenCalled()
  expect(sessionStorage.length).toBe(0)
})

it('não afirma conclusão nem libera repetição diante de recibo incompleto ou de outra operação', async () => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativa))
  vi.mocked(api.get).mockResolvedValueOnce(resposta('concluido', tentativa, { nome: 'arquivo.mp4', tamanho_bytes: null }))
  render(<ImportarLink {...props} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui confirmar a importação')
  expect(callbacks.aoImportar).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(chave())).not.toBeNull()
  vi.mocked(api.get).mockResolvedValueOnce(resposta('concluido', { ...tentativa, id: 'outro-id' }, { nome: 'arquivo.mp4', tamanho_bytes: 9000 }))
  fireEvent.click(screen.getByRole('button', { name: 'Verificar importação' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Verificar importação' })).toBeEnabled())
  expect(callbacks.aoImportar).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
})

it('recusa explícita do POST mantém o link e apresenta upload alternativo', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(413, 'Vídeo acima do limite. Envie o arquivo.'))
  render(<ImportarLink {...props} />)
  abrir(); preencher(); iniciar()
  expect(await screen.findByRole('alert')).toHaveTextContent('Vídeo acima do limite')
  expect(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' })).toHaveValue(url)
  expect(sessionStorage.getItem(chave())).toBeNull()
  expect(api.get).not.toHaveBeenCalled()
})

it('tradução preserva o URL e destino produto no contrato de importação', async () => {
  idioma.atual = 'en'
  render(<ImportarLink {...props} pasta="produto" />)
  fireEvent.click(screen.getByRole('button', { name: 'Import from link' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Video or post link' }), { target: { value: url } })
  fireEvent.click(screen.getByRole('button', { name: 'Import files' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Queued'))
  expect(api.post).toHaveBeenCalledWith(base, { url, pasta: 'produto', chave_importacao: expect.any(String) })
})

const instagram = 'https://www.instagram.com/p/DeZLx9YgY6K/'
const baseInstagram = '/predios/1/conteudo/arquivos/importacoes-instagram'
const tentativaInstagram = { ...tentativa, url: instagram }
const arquivoInstagram = (ordem: number, tipo_midia = 'imagem') => ({ nome: `${String(ordem).padStart(2, '0')}-${tipo_midia}.jpg`, tamanho_bytes: 12000, ordem, tipo_midia, duracao_segundos: tipo_midia === 'video' ? 7 : null })
const concluidaInstagram = (origem = tentativaInstagram) => resposta('concluido', origem, {
  arquivos: [arquivoInstagram(2, 'video'), arquivoInstagram(1)], qtd_arquivos: 2, total_arquivos: 2,
})

it.each([
  'https://www.instagram.com/p/DeZLx9YgY6K/?igsh=origem',
  'https://instagram.com/reel/DeZLx9YgY6K/',
  'https://www.instagram.com/tv/DeZLx9YgY6K/',
])('importa publicação pública %s somente depois do clique, usando o endpoint correto', async publicacao => {
  render(<ImportarLink {...props} />)
  abrir(); preencher(publicacao)
  expect(api.post).not.toHaveBeenCalled()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.getByText(/Fotos, Reel ou carrossel com até 20 arquivos/)).toBeInTheDocument()
  iniciar()
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Na fila'))
  expect(api.post).toHaveBeenCalledExactlyOnceWith(baseInstagram, { url: publicacao, pasta: 'entrada', chave_importacao: expect.any(String) })
})

it.each([
  'https://www.instagram.com/liverpoolfc/',
  'https://www.instagram.com/stories/liverpoolfc/1234/',
  'https://www.instagram.com.evil.example/p/DeZLx9YgY6K/',
  'https://www.instagram.com@evil.example/p/DeZLx9YgY6K/',
  'http://www.instagram.com/p/DeZLx9YgY6K/',
  'https://www.instagram.com:9000/p/DeZLx9YgY6K/',
  'https://www.youtube.com/playlist?list=PL123',
  'https://www.youtube.com/watch?v=7fE3ShzZZ_Y&list=PL123',
])('recusa perfil, story, playlist ou origem indevida %s sem transferir', valor => {
  render(<ImportarLink {...props} />)
  abrir(); preencher(valor); iniciar()
  expect(screen.getByRole('button', { name: 'Importar arquivos' })).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
})

it('recupera carrossel em ordem e atualiza o Acervo uma vez sem depender de nome único', async () => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativaInstagram))
  vi.mocked(api.get).mockResolvedValue(concluidaInstagram())
  render(<ImportarLink {...props} />)
  expect(await screen.findByRole('status')).toHaveTextContent('2 arquivos guardados no Acervo')
  const itens = screen.getAllByRole('listitem')
  expect(itens[0]).toHaveTextContent('01-imagem.jpg')
  expect(itens[1]).toHaveTextContent('02-video.jpg')
  expect(itens[1]).toHaveTextContent('0:07')
  expect(screen.getByRole('link', { name: 'Origem no Instagram' })).toHaveAttribute('href', instagram)
  expect(api.get).toHaveBeenCalledExactlyOnceWith(`${baseInstagram}/${uuid}`, expect.any(AbortSignal))
  expect(callbacks.aoImportar).toHaveBeenCalledOnce()
  expect(api.post).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(chave())).toBeNull()
})

it('resposta perdida do Instagram recupera o resultado sem abrir outro download', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(0, 'Sem conexão'))
  vi.mocked(api.get).mockImplementationOnce(async path => concluidaInstagram({ ...tentativaInstagram, id: path.split('/').pop()! }))
  render(<ImportarLink {...props} />)
  abrir(); preencher(instagram); iniciar()
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 arquivos guardados'))
  expect(api.post).toHaveBeenCalledOnce()
  const id = (vi.mocked(api.post).mock.calls[0][1] as { chave_importacao: string }).chave_importacao
  expect(api.get).toHaveBeenCalledExactlyOnceWith(`${baseInstagram}/${id}`, expect.any(AbortSignal))
})

it('mantém carrossel interrompido e seu UUID para conferir arquivos sem duplicar a transferência', async () => {
  const incompleta = resposta('interrompido', tentativaInstagram, { arquivos: [arquivoInstagram(1)], qtd_arquivos: 1, total_arquivos: 2, erro: 'Confira os arquivos no Acervo antes de repetir.' })
  sessionStorage.setItem(chave(), JSON.stringify(tentativaInstagram))
  vi.mocked(api.get).mockResolvedValue(incompleta)
  const tela = render(<ImportarLink {...props} />)
  expect(await screen.findByRole('status')).toHaveTextContent('a importação não foi confirmada por inteiro')
  expect(screen.queryByText(/guardados no Acervo/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Importar arquivos' })).not.toBeInTheDocument()
  expect(sessionStorage.getItem(chave())).not.toBeNull()
  expect(callbacks.aoImportar).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Verificar importação' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  expect(callbacks.aoImportar).toHaveBeenCalledOnce()
  tela.unmount()
  render(<ImportarLink {...props} />)
  expect(await screen.findByRole('status')).toHaveTextContent('Confira 1 arquivo')
  expect(api.post).not.toHaveBeenCalled()
  expect(api.get).toHaveBeenCalledTimes(3)
})

it.each([
  { arquivos: [], qtd_arquivos: 0, total_arquivos: 0 },
  { arquivos: [arquivoInstagram(1)], qtd_arquivos: 1, total_arquivos: 2 },
  { arquivos: [arquivoInstagram(2)], qtd_arquivos: 1, total_arquivos: 1 },
  { arquivos: [arquivoInstagram(1), arquivoInstagram(1)], qtd_arquivos: 2, total_arquivos: 2 },
  { arquivos: [{ ...arquivoInstagram(1), tamanho_bytes: 0 }], qtd_arquivos: 1, total_arquivos: 1 },
])('não anuncia conclusão diante de recibo incompleto ou lista inválida %#', async resto => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativaInstagram))
  vi.mocked(api.get).mockResolvedValue(resposta('concluido', tentativaInstagram, resto))
  render(<ImportarLink {...props} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui confirmar a importação')
  expect(callbacks.aoImportar).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(chave())).not.toBeNull()
  expect(api.post).not.toHaveBeenCalled()
})

it('não aceita uma publicação diferente mesmo quando o UUID e destino parecem iguais', async () => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativaInstagram))
  vi.mocked(api.get).mockResolvedValue(concluidaInstagram({ ...tentativaInstagram, url: 'https://www.instagram.com/p/OutraOrigem/' }))
  render(<ImportarLink {...props} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui confirmar a importação')
  expect(callbacks.aoImportar).not.toHaveBeenCalled()
})

it('recupera o UUID de YouTube da versão anterior somente por consulta e limpa a chave legada ao concluir', async () => {
  const legado = `offiz.youtube:${getSessionIdentity()}:1:conteudo`
  sessionStorage.setItem(legado, JSON.stringify(tentativa))
  vi.mocked(api.get).mockResolvedValue(resposta('concluido', tentativa, { nome: 'entrevista.mp4', tamanho_bytes: 1000 }))
  render(<ImportarLink {...props} />)
  expect(await screen.findByRole('status')).toHaveTextContent('Vídeo guardado no Acervo')
  expect(api.get).toHaveBeenCalledExactlyOnceWith(`${base}/${uuid}`, expect.any(AbortSignal))
  expect(api.post).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(legado)).toBeNull()
})

it('nova solicitação após GET404 mantém origem Instagram e destino aceito apesar da troca de aba', async () => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativaInstagram))
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(404, 'Não encontrada'))
  const tela = render(<ImportarLink {...props} />)
  const solicitar = await screen.findByRole('button', { name: 'Solicitar esta importação' })
  tela.rerender(<ImportarLink {...props} pasta="produto" />)
  fireEvent.click(solicitar)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Na fila'))
  expect(api.post).toHaveBeenCalledExactlyOnceWith(baseInstagram, { url: instagram, pasta: 'entrada', chave_importacao: uuid })
})

it('YouTube com arquivo conhecido e commit incerto conserva o aviso, sem anunciar conclusão ou repetir', async () => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativa))
  vi.mocked(api.get).mockResolvedValue(resposta('interrompido', tentativa, { nome: 'entrevista.mp4', tamanho_bytes: 1000, erro: 'Confira o Acervo antes de repetir.' }))
  render(<ImportarLink {...props} />)
  expect(await screen.findByRole('status')).toHaveTextContent('a importação não foi confirmada por inteiro: entrevista.mp4')
  expect(screen.queryByText(/Vídeo guardado/)).not.toBeInTheDocument()
  expect(sessionStorage.getItem(chave())).not.toBeNull()
  expect(callbacks.aoImportar).toHaveBeenCalledOnce()
  expect(api.post).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Importar arquivos' })).not.toBeInTheDocument()
})

it('encerrar aviso após conferir o Acervo só limpa o estado local e permite escolher outro link', async () => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativaInstagram))
  vi.mocked(api.get).mockResolvedValue(resposta('interrompido', tentativaInstagram, { arquivos: [arquivoInstagram(1)], erro: 'Confira os arquivos.' }))
  render(<ImportarLink {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Conferi o Acervo — encerrar aviso' }))
  expect(sessionStorage.getItem(chave())).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' })).toHaveValue('')
  expect(screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' })).toHaveFocus()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.del).not.toHaveBeenCalled()
  preencher(url); iniciar()
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Na fila'))
  expect(api.post).toHaveBeenCalledExactlyOnceWith(base, { url, pasta: 'entrada', chave_importacao: expect.not.stringContaining(uuid) })
})

it('consulta antiga depois de encerrar aviso não reabre resultado nem atualiza o Acervo', async () => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativaInstagram))
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockResolvedValueOnce(resposta('interrompido', tentativaInstagram, { arquivos: [arquivoInstagram(1)] }))
    .mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  render(<ImportarLink {...props} />)
  await screen.findByRole('button', { name: 'Conferi o Acervo — encerrar aviso' })
  fireEvent.click(screen.getByRole('button', { name: 'Verificar importação' }))
  expect(api.get).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: 'Conferi o Acervo — encerrar aviso' }))
  await act(async () => resolver(concluidaInstagram()))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(callbacks.aoImportar).toHaveBeenCalledOnce()
  expect(api.post).not.toHaveBeenCalled()
})

it('depois de falha confirmada mostra a nova fonte e destino que serão enviados', async () => {
  sessionStorage.setItem(chave(), JSON.stringify(tentativa))
  vi.mocked(api.get).mockResolvedValue(resposta('falhou', tentativa, { erro: 'Não consegui baixar.' }))
  const tela = render(<ImportarLink {...props} />)
  await screen.findByRole('alert')
  tela.rerender(<ImportarLink {...props} pasta="produto" />)
  preencher(instagram)
  expect(screen.getByText(/Destino: O produto\. Fotos, Reel ou carrossel/)).toBeInTheDocument()
  iniciar()
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Na fila'))
  expect(api.post).toHaveBeenCalledExactlyOnceWith(baseInstagram, { url: instagram, pasta: 'produto', chave_importacao: expect.any(String) })
})

it('orienta quem cola o perfil sobre o link da publicação sem importar ou bloquear a correção', () => {
  render(<ImportarLink {...props} />)
  abrir(); preencher('https://www.instagram.com/liverpoolfc/')
  const campo = screen.getByRole('textbox', { name: 'Link do vídeo ou publicação' })
  expect(campo).toHaveAttribute('aria-invalid', 'true')
  expect(campo).toHaveAccessibleDescription('Use o link de um vídeo do YouTube ou de uma publicação ou Reel do Instagram. Perfis, stories e playlists não são importados.')
  expect(screen.getByRole('button', { name: 'Importar arquivos' })).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
  preencher(instagram)
  expect(campo).toHaveAttribute('aria-invalid', 'false')
  expect(screen.queryByText(/Perfis, stories e playlists não são importados/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Importar arquivos' })).toBeEnabled()
})
