import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, baixarArquivo, carregarArquivo, setTokens } from '../../lib/api'
import QuadroFluxo from './QuadroFluxo'
import { instalarDialogoDeTeste } from '../../test/dialog'

const toasts = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn() }, carregarArquivo: vi.fn(), baixarArquivo: vi.fn() }))
vi.mock('../Toasts', () => ({ useToasts: () => toasts }))
vi.mock('./ComentariosFluxo', () => ({ useComentarios: () => ({ lista: [], criar: vi.fn(), agir: vi.fn(), apagar: vi.fn() }), BotaoComentar: () => null, ListaComentarios: () => null }))
vi.mock('./JobStream', () => ({ JobStream: ({ job }: {job: {id: number}}) => <p>História do pedido #{job.id}</p> }))
instalarDialogoDeTeste()
const revogarOriginal = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

const fluxo = (id: number) => ({ job: { id, titulo: `Pedido sintético ${id}`, status: 'done' }, derivado: true, tem_eventos: true, colunas: [{ titulo: 'o que entrou', nos: [] }, { titulo: 'quem mexeu', nos: [] }, { titulo: 'o que saiu', nos: [] }], arestas: [] })
function adiado<T>() { let resolver!: (valor: T) => void; let rejeitar!: (motivo: Error) => void; const promessa = new Promise<T>((resolve, reject) => { resolver = resolve; rejeitar = reject }); return { promessa, resolver, rejeitar } }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); setTokens('sessao-sintetica-k', 'refresh-sintetico-k')
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.mocked(baixarArquivo).mockReset().mockResolvedValue(undefined)
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/71/fluxo') ? fluxo(71) : path.endsWith('/72/fluxo') ? fluxo(72) : path.endsWith('/events?after=0') ? { events: [] } : path === '/jobs/71' ? { id: 71 } : path === '/jobs/72' ? { id: 72 } : {})
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear()
  if (revogarOriginal) Object.defineProperty(URL, 'revokeObjectURL', revogarOriginal)
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
})

it('resposta antiga do quadro não substitui pedido atual nem deixa ação baseada no título errado', async () => {
  const antiga = adiado<ReturnType<typeof fluxo>>()
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/71/fluxo') ? antiga.promessa : path.endsWith('/72/fluxo') ? fluxo(72) : {})
  const tela = render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} />)
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([path]) => path.endsWith('/71/fluxo'))).toBe(true))
  tela.rerender(<QuadroFluxo orgId={3} slug="conteudo" jobId={72} />)
  await screen.findByText('Pedido sintético 72')
  await act(async () => antiga.resolver(fluxo(71)))
  expect(screen.getByText('Pedido sintético 72')).toBeVisible()
  expect(screen.queryByText('Pedido sintético 71')).not.toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.find(([path]) => path.endsWith('/71/fluxo'))?.[1]?.aborted).toBe(true)
  expect(api.post).not.toHaveBeenCalled()
})

it('trocar pedido também consulta sua história em vez de manter o replay do anterior', async () => {
  const tela = render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} />)
  fireEvent.click(await screen.findByRole('button', { name: /diário de execução/ }))
  await screen.findByText('História do pedido #71')
  tela.rerender(<QuadroFluxo orgId={3} slug="conteudo" jobId={72} />)
  await screen.findByText('Pedido sintético 72')
  expect(screen.queryByText('História do pedido #71')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /diário de execução/ }))
  expect(await screen.findByText('História do pedido #72')).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
})

it('falha da consulta da história oferece retry explícito e não fica carregando para sempre', async () => {
  let falhar = true
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/71/fluxo') ? fluxo(71) : path === '/jobs/71' ? falhar ? Promise.reject(new Error('Falha sintética')) : { id: 71 } : path.endsWith('/events?after=0') ? { events: [] } : {})
  render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} />)
  fireEvent.click(await screen.findByRole('button', { name: /diário de execução/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/história/i)
  expect(screen.queryByText('Abrindo a história…')).not.toBeInTheDocument()
  falhar = false
  fireEvent.click(screen.getByRole('button', { name: 'Tentar a história novamente' }))
  expect(await screen.findByText('História do pedido #71')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['empresa', 'área', 'sessão'] as const)('trocar %s fecha a prévia e descarta seu download tardio mesmo com mesmo job', async tipo => {
  const antiga = adiado<string>(), perguntar = vi.fn()
  const comSaida = { ...fluxo(71), colunas: [{ titulo: 'o que entrou', nos: [] }, { titulo: 'quem mexeu', nos: [] }, { titulo: 'o que saiu', nos: [{ id: 's:93', titulo: 'arte-original.png', entrega_id: 93 }] }] }
  vi.mocked(api.get).mockResolvedValue(comSaida)
  vi.mocked(carregarArquivo).mockReturnValue(antiga.promessa)
  const tela = render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} aoPerguntar={perguntar} />)
  fireEvent.click(await screen.findByRole('button', { name: /arte-original.png/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ver a entrega' }))
  expect(await screen.findByRole('dialog', { name: 'Ver arte-original.png' })).toBeVisible()
  if (tipo === 'sessão') setTokens('outra-sessao-k', 'outro-refresh-k')
  tela.rerender(<QuadroFluxo orgId={tipo === 'empresa' ? 4 : 3} slug={tipo === 'área' ? 'financeiro' : 'conteudo'} jobId={71} aoPerguntar={perguntar} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => antiga.resolver('blob:arquivo-tardio'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:arquivo-tardio')
  expect(perguntar).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled()
})

it('consulta do quadro que falha oferece recuperação sem trocar por outro trabalho', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('Falha sintética'))
  render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui montar o fluxo deste trabalho.')
  fireEvent.click(screen.getByRole('button', { name: 'Tentar o quadro novamente' }))
  expect(await screen.findByText('Pedido sintético 71')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('resposta que identifica outro pedido é recusada em vez de exibir seus arquivos', async () => {
  vi.mocked(api.get).mockResolvedValue(fluxo(72))
  render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui confirmar o quadro deste trabalho.')
  expect(screen.queryByText('Pedido sintético 72')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('fechar e reabrir a mesma entrega descarta o primeiro download tardio', async () => {
  const antiga = adiado<string>()
  const comSaida = { ...fluxo(71), colunas: [{ titulo: 'o que entrou', nos: [] }, { titulo: 'quem mexeu', nos: [] }, { titulo: 'o que saiu', nos: [{ id: 's:93', titulo: 'arte.png', entrega_id: 93 }] }] }
  vi.mocked(api.get).mockResolvedValue(comSaida)
  vi.mocked(carregarArquivo).mockReturnValueOnce(antiga.promessa).mockResolvedValueOnce('blob:arquivo-atual')
  render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} aoPerguntar={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /arte.png/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ver a entrega' }))
  fireEvent.click(screen.getByRole('button', { name: 'fechar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Ver a entrega' }))
  await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:arquivo-atual'))
  await act(async () => antiga.resolver('blob:arquivo-antigo'))
  expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:arquivo-atual')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:arquivo-antigo')
})

it('cancelar a troca enquanto upload está em trânsito não prepara pedido depois da resposta', async () => {
  const upload = adiado<{ nome: string }>(), perguntar = vi.fn()
  const comFonte = { ...fluxo(71), colunas: [{ titulo: 'o que entrou', nos: [{ id: 'f:ref', titulo: 'Referência original', selo: 'material', caminho: 'entrada/ref.txt', porta: { pasta: 'entrada', nome: 'ref.txt' } }] }, { titulo: 'quem mexeu', nos: [] }, { titulo: 'o que saiu', nos: [] }] }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/fluxo') ? comFonte : { entrada: [] })
  vi.mocked(api.postForm).mockReturnValue(upload.promessa)
  const tela = render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} aoPerguntar={perguntar} />)
  fireEvent.click(await screen.findByRole('button', { name: /Referência original/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Trocar esta fonte' }))
  await screen.findByText('O acervo está vazio — envie o arquivo novo abaixo.')
  fireEvent.change(tela.container.querySelector('input[type="file"]')!, { target: { files: [new File(['fixture'], 'nova.txt')] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'cancelar' }))
  await act(async () => upload.resolver({ nome: 'nova.txt' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(perguntar).not.toHaveBeenCalled()
})

it('falha ao consultar o acervo não vira acervo vazio e retry permanece na fonte escolhida', async () => {
  let falhar = true
  const comFonte = { ...fluxo(71), colunas: [{ titulo: 'o que entrou', nos: [{ id: 'f:ref', titulo: 'Referência original', selo: 'material', caminho: 'entrada/ref.txt', porta: { pasta: 'entrada', nome: 'ref.txt' } }] }, { titulo: 'quem mexeu', nos: [] }, { titulo: 'o que saiu', nos: [] }] }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/fluxo') ? comFonte : falhar ? Promise.reject(new Error('Falha sintética')) : { entrada: [{ nome: 'confirmada.txt' }] })
  render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} aoPerguntar={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /Referência original/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Trocar esta fonte' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui consultar o acervo.')
  expect(screen.queryByText('O acervo está vazio — envie o arquivo novo abaixo.')).not.toBeInTheDocument()
  falhar = false
  fireEvent.click(screen.getByRole('button', { name: 'Tentar o acervo novamente' }))
  expect(await screen.findByRole('button', { name: /confirmada.txt/ })).toBeVisible()
  expect(screen.getByRole('dialog', { name: 'Trocar a fonte' })).toHaveTextContent('Referência original')
  expect(api.post).not.toHaveBeenCalled()
})

const tiposDownload = ['fonte', 'entrega'] as const
type TipoDownload = typeof tiposDownload[number]
const arquivoFonte = {
  id: 'f:arquivo-download', titulo: 'registro-do-catálogo.pdf', legenda: 'A legenda reconhecível da fonte',
  selo: 'material', caminho: 'rastro-informativo/referencia-original.pdf', media: 'documento',
  porta: { pasta: 'entrada', nome: 'Marca/Relatório ação #1+.pdf' },
}
const arquivoEntrega = {
  id: 's:93', titulo: 'arte final #1+.png', legenda: 'A legenda da entrega pronta', entrega_id: 93,
}
function fluxoComArquivo(tipo: TipoDownload, id = 71, imagem = false) {
  return { ...fluxo(id), colunas: [
    { titulo: 'o que entrou', nos: tipo === 'fonte' ? [{ ...arquivoFonte, media: imagem ? 'imagem' : arquivoFonte.media }] : [] },
    { titulo: 'quem mexeu', nos: [] },
    { titulo: 'o que saiu', nos: tipo === 'entrega' ? [arquivoEntrega] : [] },
  ] }
}
function destinoDownload(tipo: TipoDownload) {
  return tipo === 'fonte'
    ? { path: '/predios/3/conteudo/arquivos/entrada/Marca%2FRelat%C3%B3rio%20a%C3%A7%C3%A3o%20%231%2B.pdf', nome: arquivoFonte.porta.nome }
    : { path: '/entregas/93/download', nome: arquivoEntrega.titulo }
}
async function abrirArquivoDoQuadro(tipo: TipoDownload) {
  fireEvent.click(await screen.findByRole('button', { name: tipo === 'fonte' ? /A legenda reconhecível da fonte/ : /A legenda da entrega pronta/ }))
  fireEvent.click(screen.getByRole('button', { name: tipo === 'fonte' ? 'Ver o arquivo' : 'Ver a entrega' }))
  return screen.findByRole('dialog', { name: `Ver ${tipo === 'fonte' ? arquivoFonte.legenda : arquivoEntrega.legenda}` })
}
function controleDoDownload(indice = 0) {
  const opcoes = vi.mocked(baixarArquivo).mock.calls[indice][2]!
  expect(opcoes.signal).toBeDefined()
  expect(opcoes.vigente).toBeTypeOf('function')
  return { signal: opcoes.signal!, vigente: opcoes.vigente! }
}

it.each(tiposDownload)('download da %s usa a porta e o nome reais só após clique, com uma leitura enquanto pendente', async tipo => {
  const download = adiado<void>()
  vi.mocked(api.get).mockResolvedValue(fluxoComArquivo(tipo))
  vi.mocked(carregarArquivo).mockResolvedValue('blob:previa-sintetica')
  vi.mocked(baixarArquivo).mockReturnValue(download.promessa)
  render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} aoPerguntar={vi.fn()} />)
  expect(baixarArquivo).not.toHaveBeenCalled()
  const dialogo = await abrirArquivoDoQuadro(tipo)
  expect(baixarArquivo).not.toHaveBeenCalled()
  const baixar = within(dialogo).getByRole('button', { name: 'Baixar arquivo' })
  fireEvent.click(baixar)
  fireEvent.click(baixar)
  expect(baixarArquivo).toHaveBeenCalledTimes(1)
  const destino = destinoDownload(tipo)
  expect(baixarArquivo).toHaveBeenCalledWith(destino.path, destino.nome, expect.objectContaining({ signal: expect.anything(), vigente: expect.any(Function) }))
  const controle = controleDoDownload()
  expect(controle.signal.aborted).toBe(false)
  expect(controle.vigente()).toBe(true)
  expect(within(dialogo).getByRole('button', { name: 'Baixando…' })).toBeDisabled()
  await act(async () => download.resolver(undefined))
  expect(within(dialogo).getByRole('button', { name: 'Baixar arquivo' })).toBeEnabled()
  expect(dialogo).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
})

it.each(tiposDownload)('a prévia da %s que chega depois não cancela nem duplica o download já iniciado', async tipo => {
  const previa = adiado<string>(), download = adiado<void>()
  vi.mocked(api.get).mockResolvedValue(fluxoComArquivo(tipo))
  vi.mocked(carregarArquivo).mockReturnValue(previa.promessa)
  vi.mocked(baixarArquivo).mockReturnValue(download.promessa)
  render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} aoPerguntar={vi.fn()} />)
  const dialogo = await abrirArquivoDoQuadro(tipo)
  expect(within(dialogo).getByRole('status')).toHaveTextContent('Abrindo…')
  expect(baixarArquivo).not.toHaveBeenCalled()
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Baixar arquivo' }))
  const controle = controleDoDownload()
  await act(async () => previa.resolver('blob:previa-recebida-durante-download'))
  expect(screen.getByRole('dialog')).toBe(dialogo)
  expect(controle.signal.aborted).toBe(false)
  expect(controle.vigente()).toBe(true)
  const baixar = within(dialogo).getByRole('button', { name: 'Baixando…' })
  expect(baixar).toBeDisabled()
  fireEvent.click(baixar)
  expect(baixarArquivo).toHaveBeenCalledTimes(1)
  await act(async () => download.resolver(undefined))
  expect(within(dialogo).getByRole('button', { name: 'Baixar arquivo' })).toBeEnabled()
})

it.each(tiposDownload)('fechar e reabrir a mesma %s cancela o download anterior e preserva a nova abertura', async tipo => {
  const antigo = adiado<void>(), atual = adiado<void>()
  vi.mocked(api.get).mockResolvedValue(fluxoComArquivo(tipo))
  vi.mocked(carregarArquivo).mockResolvedValue('blob:mesma-previa')
  vi.mocked(baixarArquivo).mockReturnValueOnce(antigo.promessa).mockReturnValueOnce(atual.promessa)
  render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} aoPerguntar={vi.fn()} />)
  const primeiro = await abrirArquivoDoQuadro(tipo)
  fireEvent.click(within(primeiro).getByRole('button', { name: 'Baixar arquivo' }))
  const controleAntigo = controleDoDownload()
  fireEvent.click(within(primeiro).getByRole('button', { name: 'fechar' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(controleAntigo.signal.aborted).toBe(true)
  expect(controleAntigo.vigente()).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: tipo === 'fonte' ? 'Ver o arquivo' : 'Ver a entrega' }))
  const novo = await screen.findByRole('dialog')
  expect(baixarArquivo).toHaveBeenCalledTimes(1)
  fireEvent.click(within(novo).getByRole('button', { name: 'Baixar arquivo' }))
  const controleAtual = controleDoDownload(1)
  expect(controleAtual.signal).not.toBe(controleAntigo.signal)
  expect(controleAtual.vigente()).toBe(true)
  await act(async () => antigo.rejeitar(new Error('Download antigo falhou tarde')))
  expect(screen.getByRole('dialog')).toBe(novo)
  expect(within(novo).queryByRole('alert')).not.toBeInTheDocument()
  expect(within(novo).getByRole('button', { name: 'Baixando…' })).toBeDisabled()
  expect(controleAntigo.vigente()).toBe(false)
  expect(controleAtual.signal.aborted).toBe(false)
  await act(async () => atual.resolver(undefined))
  expect(within(novo).getByRole('button', { name: 'Baixar arquivo' })).toBeEnabled()
})

const trocasDuranteDownload = (['empresa', 'área', 'pedido', 'sessão'] as const)
  .flatMap(contexto => tiposDownload.map(tipo => ({ contexto, tipo })))
it.each(trocasDuranteDownload)('trocar $contexto aborta o download da $tipo e invalida sua entrega tardia', async ({ contexto, tipo }) => {
  const download = adiado<void>()
  vi.mocked(api.get).mockImplementation(async path => fluxoComArquivo(tipo, path.includes('/72/fluxo') ? 72 : 71))
  vi.mocked(carregarArquivo).mockResolvedValue('blob:previa-sintetica')
  vi.mocked(baixarArquivo).mockReturnValue(download.promessa)
  const tela = render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} aoPerguntar={vi.fn()} />)
  const dialogo = await abrirArquivoDoQuadro(tipo)
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Baixar arquivo' }))
  const controle = controleDoDownload()
  expect(controle.vigente()).toBe(true)
  if (contexto === 'sessão') {
    setTokens('nova-sessao-download', 'novo-refresh-download')
    expect(controle.vigente()).toBe(false)
  }
  tela.rerender(<QuadroFluxo orgId={contexto === 'empresa' ? 4 : 3} slug={contexto === 'área' ? 'financeiro' : 'conteudo'} jobId={contexto === 'pedido' ? 72 : 71} aoPerguntar={vi.fn()} />)
  expect(controle.signal.aborted).toBe(true)
  expect(controle.vigente()).toBe(false)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => download.rejeitar(new Error('Resposta tardia de contexto anterior')))
  await screen.findByText(contexto === 'pedido' ? 'Pedido sintético 72' : 'Pedido sintético 71')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(baixarArquivo).toHaveBeenCalledTimes(1)
  expect(api.post).not.toHaveBeenCalled()
})

it.each(tiposDownload)('falha de decoder da %s mantém o visor e permite baixar o original sem repetir a prévia', async tipo => {
  const download = adiado<void>()
  vi.mocked(api.get).mockResolvedValue(fluxoComArquivo(tipo, 71, true))
  vi.mocked(carregarArquivo).mockResolvedValue('blob:arquivo-decodificador')
  vi.mocked(baixarArquivo).mockReturnValue(download.promessa)
  render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} aoPerguntar={vi.fn()} />)
  const dialogo = await abrirArquivoDoQuadro(tipo)
  const imagem = await within(dialogo).findByRole('img')
  const leituras = vi.mocked(carregarArquivo).mock.calls.length
  fireEvent.error(imagem)
  expect(within(dialogo).getByRole('alert')).toHaveTextContent('Não consegui exibir a prévia deste arquivo.')
  expect(baixarArquivo).not.toHaveBeenCalled()
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Baixar arquivo' }))
  const destino = destinoDownload(tipo)
  expect(baixarArquivo).toHaveBeenCalledWith(destino.path, destino.nome, expect.any(Object))
  await act(async () => download.resolver(undefined))
  expect(screen.getByRole('dialog')).toBe(dialogo)
  expect(within(dialogo).getByRole('alert')).toBeVisible()
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Tentar a prévia novamente' }))
  expect(within(dialogo).getByRole('img')).toHaveAttribute('src', 'blob:arquivo-decodificador')
  expect(carregarArquivo).toHaveBeenCalledTimes(leituras)
  expect(baixarArquivo).toHaveBeenCalledTimes(1)
})

it.each(tiposDownload)('falha do download da %s mantém a prévia e só tenta novamente por outro clique', async tipo => {
  const primeiro = adiado<void>(), retry = adiado<void>()
  vi.mocked(api.get).mockResolvedValue(fluxoComArquivo(tipo))
  vi.mocked(carregarArquivo).mockResolvedValue('blob:previa-preservada')
  vi.mocked(baixarArquivo).mockReturnValueOnce(primeiro.promessa).mockReturnValueOnce(retry.promessa)
  render(<QuadroFluxo orgId={3} slug="conteudo" jobId={71} aoPerguntar={vi.fn()} />)
  const dialogo = await abrirArquivoDoQuadro(tipo)
  const conteudo = tipo === 'entrega'
    ? await within(dialogo).findByRole('img')
    : await within(dialogo).findByText(/Este tipo de arquivo não tem prévia aqui/)
  const leituras = vi.mocked(carregarArquivo).mock.calls.length
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Baixar arquivo' }))
  await act(async () => primeiro.rejeitar(new Error('Falha sintética ao baixar')))
  expect(screen.getByRole('dialog')).toBe(dialogo)
  expect(within(dialogo).getByRole('alert')).toHaveTextContent('Não consegui baixar este arquivo agora. Tente novamente.')
  expect(within(dialogo).getByRole('button', { name: 'Baixar arquivo' })).toBeEnabled()
  expect(baixarArquivo).toHaveBeenCalledTimes(1)
  expect(dialogo).toContainElement(conteudo)
  if (tipo === 'entrega') expect(within(dialogo).getByRole('img')).toHaveAttribute('src', 'blob:previa-preservada')
  else expect(within(dialogo).getByText(/Este tipo de arquivo não tem prévia aqui/)).toBeVisible()
  const destino = destinoDownload(tipo)
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Baixar arquivo' }))
  expect(baixarArquivo).toHaveBeenCalledTimes(2)
  expect(baixarArquivo).toHaveBeenNthCalledWith(2, destino.path, destino.nome, expect.any(Object))
  expect(within(dialogo).queryByRole('alert')).not.toBeInTheDocument()
  await act(async () => retry.resolver(undefined))
  expect(screen.getByRole('dialog')).toBe(dialogo)
  expect(dialogo).toContainElement(conteudo)
  expect(within(dialogo).getByRole('button', { name: 'Baixar arquivo' })).toBeEnabled()
  expect(carregarArquivo).toHaveBeenCalledTimes(leituras)
  expect(api.post).not.toHaveBeenCalled()
})
