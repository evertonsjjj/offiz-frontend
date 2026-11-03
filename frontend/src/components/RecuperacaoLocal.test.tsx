import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RecuperacaoLocal } from './RecuperacaoLocal'
vi.mock('../lib/i18n', () => ({ useIdioma: () => ({ t: (pt: string) => pt }) }))
afterEach(() => { cleanup(); delete window.offizMotor })
const action = () => screen.getByRole('button', { name: 'Recuperar arquivos de um trabalho interrompido' })

it('só consulta por pedido e abre a cópia na empresa atual, sem reexecutar', async () => {
  const list = vi.fn().mockResolvedValue([{ id:'job-7-test',jobId:7,office:'conteudo',date:'2026-09-11' }])
  const open = vi.fn().mockResolvedValue(undefined)
  window.offizMotor = { recuperacoes:list, abrirRecuperacao:open } as unknown as NonNullable<typeof window.offizMotor>
  render(<RecuperacaoLocal orgId={24} />)
  expect(list).not.toHaveBeenCalled()
  fireEvent.click(action())
  fireEvent.click(await screen.findByRole('button', { name:'Abrir arquivos do trabalho #7' }))
  expect(list).toHaveBeenCalledWith(24)
  expect(open).toHaveBeenCalledWith(24,'job-7-test')
  expect(screen.getByText(/anexá-los à conversa/)).toBeInTheDocument()
})

it('permite repetir uma consulta recusada e informa ausência de cópias', async () => {
  const list = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
  window.offizMotor = { recuperacoes:list, abrirRecuperacao:vi.fn() } as unknown as NonNullable<typeof window.offizMotor>
  render(<RecuperacaoLocal orgId={25} />)
  fireEvent.click(action())
  expect(await screen.findByRole('alert')).toHaveTextContent('Entre na sua conta')
  await waitFor(()=>expect(action()).not.toBeDisabled())
  fireEvent.click(action())
  expect(await screen.findByText(/Não há cópias pendentes/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('resposta tardia de uma empresa desmontada não aparece na seguinte', async () => {
  let finish!: (value: unknown[]) => void
  const list = vi.fn().mockReturnValue(new Promise(resolve => { finish=resolve }))
  window.offizMotor = { recuperacoes:list, abrirRecuperacao:vi.fn() } as unknown as NonNullable<typeof window.offizMotor>
  const first=render(<RecuperacaoLocal orgId={24} key={24} />)
  fireEvent.click(action());expect(action()).toBeDisabled()
  first.rerender(<RecuperacaoLocal orgId={25} key={25} />)
  await act(async()=>finish([{id:'old',jobId:7}]))
  expect(screen.queryByRole('button',{name:/#7/})).not.toBeInTheDocument()
  expect(action()).not.toBeDisabled()
})

it('não oferece recuperação em navegador ou aplicativo antigo', () => {
  const {container}=render(<RecuperacaoLocal orgId={24} />)
  expect(container).toBeEmptyDOMElement()
})
