import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AUTH_CREDENTIALS_KEY, baixarArquivo, clearTokens, getSessionIdentity, setTokens } from './api'

let nomes: string[]
beforeEach(() => {
  vi.restoreAllMocks(); vi.useFakeTimers(); localStorage.clear(); setTokens('fixture-access', 'fixture-refresh')
  nomes = []
  URL.createObjectURL = vi.fn(() => 'blob:arquivo-sintetico')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { nomes.push(this.download) })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No real network') }))
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('usa o nome Word efetivo informado pelo servidor em vez do nome antigo Markdown da entrega', async () => {
  const nome = 'Pré-produção — peça 🎬.docx'
  const response = new Response('Word sintético', { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `attachment; filename="pre-producao.docx"; filename*=utf-8''${encodeURIComponent(nome)}`,
  } })
  vi.mocked(fetch).mockResolvedValueOnce(response)
  await baixarArquivo('/entregas/501/download', 'pre-producao.md')
  expect(nomes).toEqual([nome])
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer fixture-access')
  expect(document.querySelector('a[download]')).toBeNull()
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  vi.advanceTimersByTime(10_000)
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:arquivo-sintetico')
})

it('respeita filename simples seguro do pacote em vez do título fornecido pelo chamador', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('ZIP sintético', { headers: { 'Content-Disposition': 'attachment; filename="trabalho-321.zip"' } }))
  await baixarArquivo('/orgs/3/biblioteca/321/download', 'Campanha')
  expect(nomes).toEqual(['trabalho-321.zip'])
})

it('fallback sem cabeçalho mantém extensão de um nome longo e neutraliza caminho/dispositivo reservado', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('Bytes sintéticos'))
  await baixarArquivo('/entregas/502/download', `C:\\pasta\\${'🎬'.repeat(70)}.mp4`)
  expect(nomes[0]).toMatch(/\.mp4$/)
  expect(new TextEncoder().encode(nomes[0]).length).toBeLessThanOrEqual(200)
  expect(nomes[0]).not.toMatch(/[\\/:]/)
})

it.each([
  ['attachment; FILENAME=arte.png', 'caller.md', 'arte.png'],
  ['inline; filename="camisa; edição.pdf"', 'caller.md', 'camisa; edição.pdf'],
  ['attachment; filename="edição \\"A\\".png"', 'caller.md', 'edição _A_.png'],
  ["attachment; filename*=UTF-8'pt'%C3%81udio%20%2B%20voz.mp3", 'caller.md', 'Áudio + voz.mp3'],
  ['attachment; filename="literal%20.png"', 'caller.md', 'literal%20.png'],
  ['attachment; filename=".gitignore"', 'caller.md', '.gitignore'],
  ['attachment; filename="NUL.docx"', 'caller.md', '_NUL.docx'],
  ["attachment; filename*=utf-8''..%2Farte%00%3F.png", 'caller.md', 'arte__.png'],
  ["attachment; filename*=utf-8''%E9; filename=seguro.docx", 'caller.md', 'seguro.docx'],
  ["attachment; filename*=iso-8859-1''caf%E9.pdf; filename=cafe.pdf", 'caller.md', 'cafe.pdf'],
  ['attachment; filename="um.png"; FILENAME="outro.png"', 'fallback.png', 'fallback.png'],
  ['attachment; filename="sem fim.png', 'fallback.png', 'fallback.png'],
  ['attachment; teste="texto; filename=errado.exe"', 'fallback.docx', 'fallback.docx'],
  ['attachment; filename=""', 'fallback.docx', 'fallback.docx'],
  ['', 'C:\\pasta\\AUX.docx', '_AUX.docx'],
  ['', '.env', '.env'],
  ['', '', 'arquivo'],
] as const)('apresenta nome seguro e previsível para %s', async (header, fallback, esperado) => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('Bytes sintéticos', { headers: header ? { 'Content-Disposition': header } : {} }))
  await baixarArquivo('/entregas/503/download', fallback)
  expect(nomes).toEqual([esperado]); expect(fetch).toHaveBeenCalledTimes(1)
})

it('recusa HTTP de erro sem criar blob, link ou falso download', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ detail: 'Arquivo indisponível.' }, { status: 404 }))
  await expect(baixarArquivo('/entregas/504/download', 'arte.png')).rejects.toMatchObject({ status: 404, detail: 'Arquivo indisponível.' })
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(nomes).toEqual([])
})

it('falha de leitura do corpo não cria link nem inicia download', async () => {
  const response = new Response('')
  Object.defineProperty(response, 'blob', { configurable: true, value: vi.fn(async () => { throw new Error('Leitura interrompida.') }) })
  vi.mocked(fetch).mockResolvedValueOnce(response)
  await expect(baixarArquivo('/entregas/505/download', 'arte.png')).rejects.toThrow('Leitura interrompida.')
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(nomes).toEqual([])
})

it.each(['outra conta', 'sair'])('corpo tardio após %s não inicia download da sessão anterior', async destino => {
  let concluir!: () => void, iniciou!: () => void
  const iniciado = new Promise<void>(resolve => { iniciou = resolve })
  const response = new Response('')
  Object.defineProperty(response, 'blob', { configurable: true, value: () => { iniciou(); return new Promise(resolve => { concluir = () => resolve(new Blob(['Privado sintético'])) }) } })
  vi.mocked(fetch).mockResolvedValueOnce(response)
  const pedido = baixarArquivo('/entregas/506/download', 'arte.png')
  await iniciado
  if (destino === 'sair') clearTokens(); else setTokens('outra-conta', 'outro-refresh')
  const rejeicao = expect(pedido).rejects.toMatchObject({ status: 409 })
  concluir(); await rejeicao
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(nomes).toEqual([])
})

it('renovação de tokens da mesma sessão durante o corpo preserva o download autorizado', async () => {
  let concluir!: () => void, iniciou!: () => void
  const iniciado = new Promise<void>(resolve => { iniciou = resolve })
  const response = new Response('', { headers: { 'Content-Disposition': 'attachment; filename="atual.docx"' } })
  Object.defineProperty(response, 'blob', { configurable: true, value: () => { iniciou(); return new Promise(resolve => { concluir = () => resolve(new Blob(['Sintético'])) }) } })
  vi.mocked(fetch).mockResolvedValueOnce(response)
  const pedido = baixarArquivo('/entregas/507/download', 'anterior.md')
  await iniciado
  localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ versao: 1, sessao: getSessionIdentity(), access: 'renovado', refresh: 'refresh-renovado' }))
  concluir(); await pedido
  expect(nomes).toEqual(['atual.docx']); expect(fetch).toHaveBeenCalledTimes(1)
})
