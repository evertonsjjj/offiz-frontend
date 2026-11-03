import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import VisorArquivo from './VisorArquivo'
import { clearTokens, setTokens } from '../../lib/api'

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
afterEach(() => { localStorage.clear(); sessionStorage.clear() })

function Tela({ erro = null, url = null }: { erro?: string | null; url?: string | null }) {
  const [aberto, setAberto] = useState(false)
  return <><button onClick={() => setAberto(true)}>Ver a cena</button>{aberto && <VisorArquivo titulo="Cena original" caminho="assets/cena.webm" midia="video" url={url} erro={erro} aoFechar={() => setAberto(false)} />}</>
}

it('fecha somente a prévia com Esc, retorna à cena e anuncia o carregamento', () => {
  render(<Tela />)
  const origem = screen.getByRole('button', { name: 'Ver a cena' })
  origem.focus(); fireEvent.click(origem)
  const dialogo = screen.getByRole('dialog', { name: 'Ver Cena original' })
  expect(dialogo).toHaveAttribute('open')
  expect(screen.getByRole('status')).toHaveTextContent('Abrindo…')
  expect(screen.getByRole('button', { name: 'fechar' })).toHaveFocus()
  const fecharEstudio = vi.fn()
  const aoTeclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape' && !evento.defaultPrevented) fecharEstudio() }
  window.addEventListener('keydown', aoTeclar)
  try { fireEvent.keyDown(screen.getByRole('button', { name: 'fechar' }), { key: 'Escape' }) }
  finally { window.removeEventListener('keydown', aoTeclar) }
  expect(fecharEstudio).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(origem).toHaveFocus()
})

it('erro continua visível e a prévia fecha por cancelamento nativo, sem fechar por clique dentro', () => {
  render(<Tela erro="Não foi possível abrir a cena." />)
  const origem = screen.getByRole('button', { name: 'Ver a cena' })
  origem.focus(); fireEvent.click(origem)
  const dialogo = screen.getByRole('dialog')
  fireEvent.click(screen.getByRole('alert'))
  expect(dialogo).toBeInTheDocument()
  const cancelar = new Event('cancel', { cancelable: true })
  fireEvent(dialogo, cancelar)
  expect(cancelar.defaultPrevented).toBe(true)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(origem).toHaveFocus()
})

it.each(['imagem', 'video', 'audio'] as const)('falha do decoder de %s aparece na tela, com retry opt-in e original preservado', midia => {
  const tela = render(<VisorArquivo titulo="Arquivo sintético" caminho="assets/original" midia={midia} url="blob:arquivo-sintetico-k" erro={null} aoFechar={vi.fn()} />)
  const elemento = tela.container.querySelector(midia === 'imagem' ? 'img' : midia)!
  fireEvent.error(elemento)
  expect(screen.getByRole('alert')).toHaveTextContent(/prévia deste arquivo/i)
  expect(tela.container.querySelector(midia === 'imagem' ? 'img' : midia)).not.toBeInTheDocument()
  expect(screen.getByText('assets/original')).toBeVisible()
  const tentar = screen.getByRole('button', { name: 'Tentar a prévia novamente' })
  tentar.focus(); fireEvent.click(tentar)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  const novo = tela.container.querySelector(midia === 'imagem' ? 'img' : midia)!
  expect(novo).not.toBe(elemento)
  expect(novo).toHaveAttribute('src', 'blob:arquivo-sintetico-k')
})

it('erro de decodificação não acompanha outro arquivo nem impede fechar e retornar ao foco', () => {
  const fechar = vi.fn()
  const tela = render(<VisorArquivo titulo="Arquivo A" caminho="a.png" midia="imagem" url="blob:a" erro={null} aoFechar={fechar} />)
  fireEvent.error(screen.getByRole('img'))
  expect(screen.getByRole('alert')).toBeVisible()
  tela.rerender(<VisorArquivo titulo="Arquivo B" caminho="b.png" midia="imagem" url="blob:b" erro={null} aoFechar={fechar} />)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:b')
  fireEvent.keyDown(screen.getByRole('button', { name: 'fechar' }), { key: 'Escape' })
  expect(fechar).toHaveBeenCalledTimes(1)
})

it('carregar a URL depois de abrir preserva o diálogo e retorna foco à origem após falha', () => {
  const tela = render(<Tela />)
  const origem = screen.getByRole('button', { name: 'Ver a cena' })
  origem.focus(); fireEvent.click(origem)
  const dialogo = screen.getByRole('dialog')
  tela.rerender(<Tela url="blob:cena-recebida" />)
  expect(screen.getByRole('dialog')).toBe(dialogo)
  fireEvent.error(tela.container.querySelector('video')!)
  expect(screen.getByRole('alert')).toBeVisible()
  fireEvent.keyDown(screen.getByRole('button', { name: 'fechar' }), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(origem).toHaveFocus()
})

function adiado() {
  let resolver!: () => void, rejeitar!: (erro: Error) => void
  const promessa = new Promise<void>((resolve, reject) => { resolver = resolve; rejeitar = reject })
  return { promessa, resolver, rejeitar }
}

it('documento oferece download explícito e leitura pendente não repete com clique duplo', async () => {
  setTokens('access-sintetico', 'refresh-sintetico')
  const leitura = adiado(), baixar = vi.fn(() => leitura.promessa)
  render(<VisorArquivo titulo="Plano" caminho="plano.md" midia="documento" url="blob:previa" erro={null} aoBaixar={baixar} aoFechar={vi.fn()} />)
  expect(screen.getByText(/Use “Baixar arquivo”/)).toBeVisible()
  expect(baixar).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  fireEvent.click(screen.getByRole('button', { name: 'Baixando…' }))
  expect(baixar).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent('Baixando arquivo…')
  await act(async () => leitura.resolver())
  expect(screen.getByRole('button', { name: 'Baixar arquivo' })).toBeEnabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('download permanece disponível após erro do decoder e falha permite retry sem remontar a prévia', async () => {
  setTokens('access-sintetico', 'refresh-sintetico')
  const baixar = vi.fn().mockRejectedValueOnce(new Error('Falha sintética')).mockResolvedValueOnce(undefined)
  render(<VisorArquivo titulo="Cena" caminho="cena.mp4" midia="video" url="blob:privado" erro={null} aoBaixar={baixar} aoFechar={vi.fn()} />)
  const dialogo = screen.getByRole('dialog')
  fireEvent.error(dialogo.querySelector('video')!)
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  await screen.findByText('Não consegui baixar este arquivo agora. Tente novamente.')
  expect(baixar).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('dialog')).toBe(dialogo)
  expect(screen.getByRole('button', { name: 'Tentar a prévia novamente' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Baixar arquivo' })).toBeEnabled())
  expect(baixar).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('Não consegui baixar este arquivo agora. Tente novamente.')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Não consegui exibir a prévia')
})

it('fechar pelo teclado cancela o download e ignora falha tardia preservando foco', async () => {
  setTokens('access-sintetico', 'refresh-sintetico')
  const leitura = adiado()
  let signal!: AbortSignal, vigente!: () => boolean
  const baixar = vi.fn((s: AbortSignal, v: () => boolean) => { signal = s; vigente = v; return leitura.promessa })
  function TelaDownload() {
    const [aberto, setAberto] = useState(false)
    return <><button onClick={() => setAberto(true)}>Abrir arquivo</button>{aberto && <VisorArquivo titulo="Plano" caminho="plano.md" midia="documento" url="blob:previa" erro={null} aoBaixar={baixar} aoFechar={() => setAberto(false)} />}</>
  }
  render(<TelaDownload />)
  const origem = screen.getByRole('button', { name: 'Abrir arquivo' })
  origem.focus(); fireEvent.click(origem)
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  expect(vigente()).toBe(true)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(signal.aborted).toBe(true); expect(vigente()).toBe(false)
  expect(origem).toHaveFocus()
  await act(async () => leitura.rejeitar(new Error('Falha tardia')))
  fireEvent.click(origem)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Baixar arquivo' })).toBeEnabled()
  expect(baixar).toHaveBeenCalledTimes(1)
})

it.each(['arquivo', 'reabertura', 'sessão'] as const)('troca de %s cancela somente a intenção antiga de download', async tipo => {
  setTokens('access-sintetico', 'refresh-sintetico')
  const leitura = adiado()
  let signal!: AbortSignal, vigente!: () => boolean
  const baixar = vi.fn((s: AbortSignal, v: () => boolean) => { signal = s; vigente = v; return leitura.promessa })
  const p = { titulo: 'Arquivo', caminho: 'a.png', midia: 'imagem' as const, url: 'blob:a', erro: null, identidadeArquivo: 1, aoBaixar: baixar, aoFechar: vi.fn() }
  const tela = render(<VisorArquivo {...p} />)
  const dialogo = screen.getByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  if (tipo === 'sessão') setTokens('outra-conta', 'outro-refresh')
  tela.rerender(<VisorArquivo {...p} caminho={tipo === 'arquivo' ? 'b.png' : p.caminho} identidadeArquivo={tipo === 'reabertura' ? 2 : 1} />)
  expect(signal.aborted).toBe(true); expect(vigente()).toBe(false)
  expect(screen.getByRole('dialog')).toBe(dialogo)
  await act(async () => leitura.rejeitar(new Error('Falha antiga')))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Baixar arquivo' })).toBeEnabled()
})

it('logout antes do clique não chama o download e não reutiliza URL privada da prévia', () => {
  setTokens('access-sintetico', 'refresh-sintetico')
  const baixar = vi.fn(async () => {})
  render(<VisorArquivo titulo="Arquivo" caminho="a.png" midia="imagem" url="blob:privado" erro={null} aoBaixar={baixar} aoFechar={vi.fn()} />)
  clearTokens()
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  expect(baixar).not.toHaveBeenCalled()
})

it('prévia que chega durante o download não cancela nem repete a intenção vigente', async () => {
  setTokens('access-sintetico', 'refresh-sintetico')
  const leitura = adiado()
  let signal!: AbortSignal, vigente!: () => boolean
  const baixar = vi.fn((s: AbortSignal, v: () => boolean) => { signal = s; vigente = v; return leitura.promessa })
  const p = { titulo: 'Cena', caminho: 'cena.mp4', midia: 'video' as const, erro: null, identidadeArquivo: 1, aoBaixar: baixar, aoFechar: vi.fn() }
  const tela = render(<VisorArquivo {...p} url={null} />)
  const dialogo = screen.getByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  tela.rerender(<VisorArquivo {...p} url="blob:previa-tardia" />)
  expect(screen.getByRole('dialog')).toBe(dialogo)
  expect(signal.aborted).toBe(false); expect(vigente()).toBe(true)
  expect(tela.container.querySelector('video')).toHaveAttribute('src', 'blob:previa-tardia')
  expect(screen.getByRole('button', { name: 'Baixando…' })).toBeDisabled()
  expect(baixar).toHaveBeenCalledTimes(1)
  await act(async () => leitura.resolver())
  expect(screen.getByRole('button', { name: 'Baixar arquivo' })).toBeEnabled()
})
