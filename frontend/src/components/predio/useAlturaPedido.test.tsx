import { useRef, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAlturaPedido } from './useAlturaPedido'

let largura = 320
let observer: (() => void) | undefined
const disconnect = vi.fn()
function Pedido({ inicial = '', visivel = true }: { inicial?: string; visivel?: boolean }) {
  const campo = useRef<HTMLTextAreaElement>(null)
  const [texto, mudar] = useState(inicial)
  useAlturaPedido(campo, texto, visivel)
  return visivel ? <textarea ref={campo} aria-label="Pedido" value={texto} onChange={e => mudar(e.target.value)} style={{ minHeight: 52, maxHeight: 160 }} /> : null
}
beforeEach(() => {
  largura = 320; observer = undefined; disconnect.mockReset()
  vi.spyOn(HTMLTextAreaElement.prototype, 'clientWidth', 'get').mockImplementation(() => largura)
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
    return 28 * (this.value.split('\n').length + Math.floor(this.value.length / largura)) + 8
  })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { observer = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const campo = () => screen.getByRole('textbox', { name: 'Pedido' }) as HTMLTextAreaElement

it('começa compacto, cresce com o texto e devolve espaço quando o rascunho é apagado', () => {
  render(<Pedido />)
  expect(campo().style.height).toBe('52px')
  fireEvent.change(campo(), { target: { value: 'Uma linha\nOutra linha\nMais uma linha' } })
  expect(campo().style.height).toBe('92px')
  expect(campo().style.overflowY).toBe('hidden')
  fireEvent.change(campo(), { target: { value: '' } })
  expect(campo().style.height).toBe('52px')
})

it('limita o campo longo sem cortar conteúdo, foco ou seleção', () => {
  render(<Pedido />)
  const pedido = 'Pode ajustar essa legenda?\n'.repeat(20)
  campo().focus()
  fireEvent.change(campo(), { target: { value: pedido } })
  campo().setSelectionRange(7, 14)
  expect(campo().style.height).toBe('160px')
  expect(campo().style.overflowY).toBe('auto')
  expect(campo()).toHaveValue(pedido)
  expect(campo()).toHaveFocus()
  expect(campo().selectionStart).toBe(7)
  expect(campo().selectionEnd).toBe(14)
})

it('refaz as linhas ao estreitar a coluna e mantém o resize manual se só a altura mudou', () => {
  render(<Pedido inicial={'Um ajuste de enquadramento com descrição completa. '.repeat(3)} />)
  const antes = Number.parseFloat(campo().style.height)
  largura = 150
  act(() => observer?.())
  expect(Number.parseFloat(campo().style.height)).toBeGreaterThan(antes)
  campo().style.height = '140px'
  act(() => observer?.())
  expect(campo().style.height).toBe('140px')
})

it('encolher manualmente libera a rolagem sem desfazer a altura ao aparecer scrollbar', () => {
  vi.spyOn(HTMLTextAreaElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
    return largura - (this.style.overflowY === 'auto' ? 16 : 0)
  })
  render(<Pedido inicial={'Primeira linha\nSegunda linha\nTerceira linha'} />)
  expect(campo().style.height).toBe('92px')
  expect(campo().style.overflowY).toBe('hidden')
  campo().style.height = '52px'
  act(() => observer?.())
  expect(campo().style.height).toBe('52px')
  expect(campo().style.overflowY).toBe('auto')
  act(() => observer?.())
  expect(campo().style.height).toBe('52px')
  expect(campo()).toHaveValue('Primeira linha\nSegunda linha\nTerceira linha')
  campo().style.height = '140px'
  act(() => observer?.())
  expect(campo().style.height).toBe('140px')
  expect(campo().style.overflowY).toBe('hidden')
})

it('recalcula o rascunho quando o campo reaparece depois do seletor de modo', () => {
  const view = render(<Pedido inicial={'Quero revisar uma peça.\nSó trocar o horário.'} visivel={false} />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  view.rerender(<Pedido inicial={'Quero revisar uma peça.\nSó trocar o horário.'} />)
  expect(campo().style.height).toBe('64px')
  expect(campo()).toHaveValue('Quero revisar uma peça.\nSó trocar o horário.')
})

it('não mede uma área oculta e recupera a altura quando volta a ter largura', () => {
  largura = 0
  render(<Pedido inicial={'Meu pedido\n'.repeat(8)} />)
  expect(campo().style.height).toBe('')
  largura = 320
  act(() => observer?.())
  expect(campo().style.height).toBe('160px')
})

it('remove observer e resize listener ao sair da conversa', () => {
  const remove = vi.spyOn(window, 'removeEventListener')
  const view = render(<Pedido />)
  view.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
})

it('continua funcionando sem ResizeObserver', () => {
  vi.stubGlobal('ResizeObserver', undefined)
  render(<Pedido inicial={'Pedido\n'.repeat(4)} />)
  expect(campo().style.height).toBe('148px')
  largura = 150
  act(() => window.dispatchEvent(new Event('resize')))
  expect(Number.parseFloat(campo().style.height)).toBeLessThanOrEqual(160)
})
