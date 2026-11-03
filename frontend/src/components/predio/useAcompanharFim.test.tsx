import { useRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAcompanharFim } from './useAcompanharFim'

let altura = 600
let resize: (() => void) | undefined
const disconnect = vi.fn()
function Thread({ contexto = '1:42' }: { contexto?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const { novaAtividade, irAoFim } = useAcompanharFim(ref, contexto, true)
  return <><textarea aria-label="Pedido" defaultValue="Rascunho intacto" />
    <div ref={ref} data-testid="thread"><div>Atividade</div></div>
    {novaAtividade && <button onClick={irAoFim}>Ver nova atividade</button>}</>
}
beforeEach(() => {
  altura = 600; resize = undefined; disconnect.mockReset()
  vi.useFakeTimers()
  vi.spyOn(HTMLDivElement.prototype, 'scrollHeight', 'get').mockImplementation(() => altura)
  vi.spyOn(HTMLDivElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe = vi.fn(); unobserve = vi.fn(); disconnect = disconnect
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const tick = () => act(() => { vi.runOnlyPendingTimers() })
it('crescimento da atividade segue o fim sem mudar rascunho ou foco', () => {
  render(<Thread />); tick()
  const thread = screen.getByTestId('thread'), pedido = screen.getByRole('textbox', { name: 'Pedido' })
  pedido.focus()
  altura = 900; act(() => resize?.()); tick()
  expect(thread.scrollTop).toBe(900)
  expect(pedido).toHaveFocus(); expect(pedido).toHaveValue('Rascunho intacto')
})
it('leitura acima mantém posição e permite voltar ao fim por escolha', () => {
  render(<Thread />); tick()
  const thread = screen.getByTestId('thread')
  thread.scrollTop = 20; fireEvent.scroll(thread)
  altura = 900; act(() => resize?.()); tick()
  expect(thread.scrollTop).toBe(20)
  fireEvent.click(screen.getByRole('button', { name: 'Ver nova atividade' }))
  expect(thread.scrollTop).toBe(900)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
it('troca de contexto cancela o callback anterior e desmontar desconecta observadores', () => {
  const view = render(<Thread />); tick()
  const antigo = resize!
  const anterior = screen.getByTestId('thread')
  anterior.scrollTop = 20; fireEvent.scroll(anterior)
  altura = 900; act(() => resize?.()); tick()
  expect(screen.getByRole('button', { name: 'Ver nova atividade' })).toBeInTheDocument()
  view.rerender(<Thread contexto="2:43" />)
  expect(screen.queryByRole('button', { name: 'Ver nova atividade' })).not.toBeInTheDocument()
  const thread = screen.getByTestId('thread')
  thread.scrollTop = 35
  act(() => antigo()); expect(thread.scrollTop).toBe(35)
  tick(); expect(disconnect).toHaveBeenCalledOnce()
  view.unmount(); act(() => resize?.()); tick()
  expect(disconnect).toHaveBeenCalledTimes(2)
})
