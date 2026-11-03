import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AUTH_CREDENTIALS_KEY, api, baixarArquivo, carregarArquivo, clearTokens, getSessionIdentity, setTokens } from '../../lib/api'
import { instalarDialogoDeTeste } from '../../test/dialog'
import ComoFoiFeita from './ComoFoiFeita'
import { wsClient } from '../../lib/ws'
import type { WsMessage } from '../../lib/types'
import { StrictMode } from 'react'

vi.mock('../../lib/api', async original => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn() },
  carregarArquivo: vi.fn(),
  baixarArquivo: vi.fn(),
}))
vi.mock('./ComentariosFluxo', () => ({
  useComentarios: () => ({ lista: [], criar: vi.fn(), agir: vi.fn(), apagar: vi.fn() }),
  BotaoComentar: () => null,
  ListaComentarios: () => null,
}))
instalarDialogoDeTeste()
const revogarOriginal = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
const fluxo = {
  slug: 'prova', titulo: 'Peça sintética', estado: 'pronta', gasto_usd: 0, teto_usd: 0,
  fontes: [], cenas: [], audio: { narracao: { existe: true, arquivo: 'assets/narracao.wav' } },
  final: { master: 'master.mp4', existe: false, montagem: [] }, tem_rastro: true,
}
function adiado<T>() {
  let resolver!: (valor: T) => void, rejeitar!: (erro: Error) => void
  const promessa = new Promise<T>((resolve, reject) => { resolver = resolve; rejeitar = reject })
  return { promessa, resolver, rejeitar }
}
const props = { orgId: 3, officeSlug: 'conteudo', pecaSlug: 'prova', aoPreencher: vi.fn() }
const ouvir = () => screen.getByRole('button', { name: 'Ouvir só a narração' })
const audio = () => screen.getByRole('dialog', { name: 'Ver Narração' }).querySelector('audio')

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear()
  setTokens('access-sintetico', 'refresh-sintetico')
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.mocked(api.get).mockResolvedValue(fluxo)
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear()
  if (revogarOriginal) Object.defineProperty(URL, 'revokeObjectURL', revogarOriginal)
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
})

it('reabrir a mesma narração conserva a leitura nova e revoga a primeira resposta tardia', async () => {
  const antiga = adiado<string>()
  vi.mocked(carregarArquivo).mockReturnValueOnce(antiga.promessa).mockResolvedValueOnce('blob:atual')
  render(<ComoFoiFeita {...props} />)
  const abrir = await screen.findByRole('button', { name: 'Ouvir só a narração' })
  abrir.focus(); fireEvent.click(abrir)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(abrir).toHaveFocus()
  fireEvent.click(abrir)
  await waitFor(() => expect(audio()).toHaveAttribute('src', 'blob:atual'))
  await act(async () => antiga.resolver('blob:antigo'))
  expect(audio()).toHaveAttribute('src', 'blob:atual')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:antigo')
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:atual')
  expect(vi.mocked(carregarArquivo).mock.calls[0][1]?.aborted).toBe(true)
  expect(api.post).not.toHaveBeenCalled(); expect(props.aoPreencher).not.toHaveBeenCalled()
})

it('falha da abertura anterior não apaga a narração já carregada na reabertura', async () => {
  const antiga = adiado<string>()
  vi.mocked(carregarArquivo).mockReturnValueOnce(antiga.promessa).mockResolvedValueOnce('blob:atual')
  render(<ComoFoiFeita {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir só a narração' }))
  fireEvent.click(screen.getByRole('button', { name: 'fechar' }))
  fireEvent.click(ouvir())
  await waitFor(() => expect(audio()).toHaveAttribute('src', 'blob:atual'))
  await act(async () => antiga.rejeitar(new Error('Falha sintética da primeira abertura')))
  expect(audio()).toHaveAttribute('src', 'blob:atual')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:atual')
})

it.each(['empresa', 'área', 'peça', 'sessão'] as const)('troca de %s fecha a prévia e rejeita a resposta do contexto anterior', async tipo => {
  const antiga = adiado<string>()
  vi.mocked(carregarArquivo).mockReturnValueOnce(antiga.promessa).mockResolvedValueOnce('blob:novo-contexto')
  const tela = render(<ComoFoiFeita {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir só a narração' }))
  if (tipo === 'sessão') setTokens('outro-access-sintetico', 'outro-refresh-sintetico')
  tela.rerender(<ComoFoiFeita {...props} orgId={tipo === 'empresa' ? 8 : 3} officeSlug={tipo === 'área' ? 'financeiro' : 'conteudo'} pecaSlug={tipo === 'peça' ? 'outra' : 'prova'} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir só a narração' }))
  await waitFor(() => expect(audio()).toHaveAttribute('src', 'blob:novo-contexto'))
  await act(async () => antiga.resolver('blob:contexto-anterior'))
  expect(audio()).toHaveAttribute('src', 'blob:novo-contexto')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:contexto-anterior')
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:novo-contexto')
  expect(vi.mocked(carregarArquivo).mock.calls[0][1]?.aborted).toBe(true)
  expect(api.post).not.toHaveBeenCalled()
})

it('sair durante a leitura rejeita o blob mesmo antes da tela receber outro render', async () => {
  const antiga = adiado<string>()
  vi.mocked(carregarArquivo).mockReturnValueOnce(antiga.promessa)
  render(<ComoFoiFeita {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir só a narração' }))
  clearTokens()
  await act(async () => antiga.resolver('blob:sessao-encerrada'))
  expect(audio()).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:sessao-encerrada')
})

it('renovar tokens da mesma sessão conserva a leitura autorizada', async () => {
  const atual = adiado<string>()
  vi.mocked(carregarArquivo).mockReturnValueOnce(atual.promessa)
  const tela = render(<ComoFoiFeita {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir só a narração' }))
  const sessao = getSessionIdentity()
  localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ versao: 1, sessao, access: 'access-renovado-sintetico', refresh: 'refresh-renovado-sintetico' }))
  tela.rerender(<ComoFoiFeita {...props} />)
  await act(async () => atual.resolver('blob:sessao-vigente'))
  expect(audio()).toHaveAttribute('src', 'blob:sessao-vigente')
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:sessao-vigente')
  expect(vi.mocked(carregarArquivo).mock.calls[0][1]?.aborted).toBe(false)
})

it('fechar uma leitura aceita revoga somente seu blob e a próxima abertura continua funcionando', async () => {
  vi.mocked(carregarArquivo).mockResolvedValueOnce('blob:primeira').mockResolvedValueOnce('blob:segunda')
  render(<ComoFoiFeita {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir só a narração' }))
  await waitFor(() => expect(audio()).toHaveAttribute('src', 'blob:primeira'))
  fireEvent.click(screen.getByRole('button', { name: 'fechar' }))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:primeira')
  fireEvent.click(ouvir())
  await waitFor(() => expect(audio()).toHaveAttribute('src', 'blob:segunda'))
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:segunda')
})

it('desmontar cancela a leitura em voo e revoga um resultado tardio não cooperativo', async () => {
  const antiga = adiado<string>()
  vi.mocked(carregarArquivo).mockReturnValueOnce(antiga.promessa)
  const tela = render(<ComoFoiFeita {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir só a narração' }))
  tela.unmount()
  await act(async () => antiga.resolver('blob:fora-da-tela'))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fora-da-tela')
  expect(vi.mocked(carregarArquivo).mock.calls[0][1]?.aborted).toBe(true)
})

it('falha da abertura vigente oferece a orientação existente sem esconder outro arquivo', async () => {
  vi.mocked(carregarArquivo).mockRejectedValueOnce(new Error('Falha sintética vigente'))
  render(<ComoFoiFeita {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir só a narração' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui abrir a prévia agora. Você pode baixar o arquivo.')
  expect(audio()).toBeNull()
  expect(api.post).not.toHaveBeenCalled()
})

it('download da narração usa uma intenção separada com rota e nome reais após falha da prévia', async () => {
  vi.mocked(carregarArquivo).mockRejectedValueOnce(new Error('Decoder indisponível'))
  vi.mocked(baixarArquivo).mockResolvedValueOnce(undefined)
  render(<ComoFoiFeita {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir só a narração' }))
  await screen.findByRole('alert')
  expect(baixarArquivo).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledTimes(1))
  const [path, nome, opcoes] = vi.mocked(baixarArquivo).mock.calls[0]
  expect(path).toBe('/predios/3/conteudo/estudio/pecas/prova/arquivo?caminho=assets%2Fnarracao.wav')
  expect(nome).toBe('narracao.wav')
  expect(opcoes?.signal).toBeInstanceOf(AbortSignal)
  expect(screen.getByRole('dialog', { name: 'Ver Narração' })).toBeVisible()
  expect(api.post).not.toHaveBeenCalled(); expect(props.aoPreencher).not.toHaveBeenCalled()
})

it.each(['fechar', 'empresa', 'área', 'peça', 'sessão'] as const)('%s durante o download invalida a intenção anterior da peça', async tipo => {
  const leitura = adiado<void>()
  vi.mocked(carregarArquivo).mockResolvedValue('blob:previa')
  vi.mocked(baixarArquivo).mockReturnValue(leitura.promessa)
  const tela = render(<ComoFoiFeita {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir só a narração' }))
  await waitFor(() => expect(audio()).toHaveAttribute('src', 'blob:previa'))
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  const opcoes = vi.mocked(baixarArquivo).mock.calls[0][2]!
  expect(opcoes.vigente?.()).toBe(true)
  if (tipo === 'fechar') fireEvent.click(screen.getByRole('button', { name: 'fechar' }))
  else {
    if (tipo === 'sessão') setTokens('outra-conta', 'outro-refresh')
    tela.rerender(<ComoFoiFeita {...props} orgId={tipo === 'empresa' ? 8 : 3} officeSlug={tipo === 'área' ? 'financeiro' : 'conteudo'} pecaSlug={tipo === 'peça' ? 'outra' : 'prova'} />)
  }
  expect(opcoes.signal?.aborted).toBe(true); expect(opcoes.vigente?.()).toBe(false)
  await act(async () => leitura.rejeitar(new Error('Resposta anterior')))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('master pendente abre uma única leitura e volta a permitir retry após falha', async () => {
  const leitura = adiado<string>()
  vi.mocked(api.get).mockResolvedValue({ ...fluxo, final: { ...fluxo.final, existe: true } })
  vi.mocked(carregarArquivo).mockReturnValueOnce(leitura.promessa).mockResolvedValueOnce('blob:master-atual')
  const tela = render(<ComoFoiFeita {...props} />)
  const assistir = await screen.findByRole('button', { name: 'Assistir aqui' })
  fireEvent.click(assistir); fireEvent.click(assistir)
  expect(carregarArquivo).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Abrindo filme…' })).toBeDisabled()
  await act(async () => leitura.rejeitar(new Error('Falha sintética')))
  expect(screen.getByRole('alert')).toHaveTextContent('Não consegui abrir o filme agora.')
  fireEvent.click(screen.getByRole('button', { name: 'Assistir aqui' }))
  await waitFor(() => expect(tela.container.querySelector('video')).toHaveAttribute('src', 'blob:master-atual'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(carregarArquivo).toHaveBeenCalledTimes(2)
  tela.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:master-atual')
})

it.each(['desmontagem', 'empresa', 'sessão', 'logout'] as const)('master tardio após %s é revogado e não vira prévia', async tipo => {
  const leitura = adiado<string>()
  vi.mocked(api.get).mockResolvedValue({ ...fluxo, final: { ...fluxo.final, existe: true } })
  vi.mocked(carregarArquivo).mockReturnValueOnce(leitura.promessa)
  const tela = render(<ComoFoiFeita {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Assistir aqui' }))
  const signal = vi.mocked(carregarArquivo).mock.calls[0][1]
  if (tipo === 'desmontagem') tela.unmount()
  else if (tipo === 'logout') clearTokens()
  else {
    if (tipo === 'sessão') setTokens('outra-conta', 'outro-refresh')
    tela.rerender(<ComoFoiFeita {...props} orgId={tipo === 'empresa' ? 8 : 3} />)
  }
  if (tipo !== 'logout') expect(signal?.aborted).toBe(true)
  await act(async () => leitura.resolver('blob:master-tardio'))
  expect(tela.container.querySelector('video')).not.toBeInTheDocument()
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:master-tardio')
  expect(api.post).not.toHaveBeenCalled()
})

it.each([true, false])('fluxo atualizado por atividade conserva master existente=%s diante de resposta anterior atrasada', async existe => {
  const anterior = adiado<typeof fluxo>()
  let atualizar!: (msg: WsMessage) => void
  vi.spyOn(wsClient, 'on').mockImplementation((_tipo, callback) => {
    atualizar = callback
    return vi.fn()
  })
  vi.mocked(api.get).mockReturnValueOnce(anterior.promessa).mockResolvedValueOnce({
    ...fluxo, final: { ...fluxo.final, existe },
  })
  render(<ComoFoiFeita {...props} />)
  act(() => atualizar({ t: 'job_status' } as WsMessage))
  await screen.findByRole('region', { name: 'Como foi feita — o fluxo da peça' })
  await act(async () => anterior.resolver({ ...fluxo, final: { ...fluxo.final, existe: !existe } }))
  if (existe) expect(screen.getByRole('button', { name: 'Assistir aqui' })).toBeInTheDocument()
  else expect(screen.queryByRole('button', { name: 'Assistir aqui' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(carregarArquivo).not.toHaveBeenCalled()
})

it('o ciclo duplo de efeitos conserva a leitura atual do fluxo e cancela a primeira', async () => {
  render(<StrictMode><ComoFoiFeita {...props} /></StrictMode>)
  await screen.findByRole('region', { name: 'Como foi feita — o fluxo da peça' })
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(vi.mocked(api.get).mock.calls[0][1]?.aborted).toBe(true)
  expect(vi.mocked(api.get).mock.calls[1][1]?.aborted).toBe(false)
})

it('atividade recebida após novo login não inicia leitura da peça da sessão anterior', async () => {
  let atualizar!: (msg: WsMessage) => void
  vi.spyOn(wsClient, 'on').mockImplementation((_tipo, callback) => {
    atualizar = callback
    return vi.fn()
  })
  render(<ComoFoiFeita {...props} />)
  await screen.findByRole('region', { name: 'Como foi feita — o fluxo da peça' })
  setTokens('novo-access', 'novo-refresh')
  act(() => atualizar({ t: 'job_status' } as WsMessage))
  expect(api.get).toHaveBeenCalledTimes(1)
})
