import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { useConfirmacao } from './useConfirmacao'

const resposta = vi.fn()
const dialogPrototype = HTMLDialogElement.prototype
const metodos = Object.fromEntries(['showModal', 'close'].map(nome => [nome, Object.getOwnPropertyDescriptor(dialogPrototype, nome)]))
beforeAll(() => Object.defineProperties(dialogPrototype, {
  showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } },
  close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } },
}))
afterAll(() => {
  for (const [nome, descriptor] of Object.entries(metodos)) {
    if (descriptor) Object.defineProperty(dialogPrototype, nome, descriptor)
    else Reflect.deleteProperty(dialogPrototype, nome)
  }
})
afterEach(() => vi.restoreAllMocks())

function Tela({ escopo = 'cliente:1' }: { escopo?: string }) {
  const { confirmar, dialogo } = useConfirmacao(escopo)
  return <><button onClick={async () => resposta(await confirmar({ titulo: 'Remover arquivo', mensagem: 'Remover pasta/arquivo.txt do acervo?', acao: 'Remover arquivo' }))}>Abrir confirmação</button>{dialogo}</>
}

it('mostra a ação e o arquivo sem depender de confirmação nativa; cancelar devolve o foco', async () => {
  const nativo = vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('Host sem confirmação nativa') })
  resposta.mockClear()
  render(<Tela />)
  const abrir = screen.getByRole('button', { name: 'Abrir confirmação' })
  abrir.focus()
  fireEvent.click(abrir)
  expect(screen.getByRole('dialog', { name: 'Remover arquivo' })).toHaveTextContent('pasta/arquivo.txt')
  expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })))
  expect(resposta).toHaveBeenCalledWith(false)
  expect(abrir).toHaveFocus()
  expect(nativo).not.toHaveBeenCalled()
})

it('só confirma uma vez e não abre uma segunda intenção sobre a primeira', async () => {
  resposta.mockClear()
  render(<Tela />)
  const abrir = screen.getByRole('button', { name: 'Abrir confirmação' })
  fireEvent.click(abrir)
  await act(async () => fireEvent.click(abrir))
  expect(resposta).toHaveBeenCalledWith(false)
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  const aceitar = screen.getByRole('button', { name: 'Remover arquivo' })
  await act(async () => { fireEvent.click(aceitar); fireEvent.click(aceitar) })
  expect(resposta.mock.calls.filter(([valor]) => valor === true)).toHaveLength(1)
})

it('Tab mantém o foco nas ações do diálogo nos dois sentidos', () => {
  render(<Tela />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir confirmação' }))
  const cancelar = screen.getByRole('button', { name: 'Cancelar' })
  const aceitar = screen.getByRole('button', { name: 'Remover arquivo' })
  cancelar.focus()
  fireEvent.keyDown(cancelar, { key: 'Tab', shiftKey: true })
  expect(aceitar).toHaveFocus()
  fireEvent.keyDown(aceitar, { key: 'Tab' })
  expect(cancelar).toHaveFocus()
})

it('Escape e clique fora cancelam sem realizar a ação', async () => {
  resposta.mockClear()
  render(<Tela />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir confirmação' }))
  await act(async () => fireEvent.keyDown(window, { key: 'Escape' }))
  expect(resposta).toHaveBeenLastCalledWith(false)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Abrir confirmação' }))
  await act(async () => fireEvent.click(screen.getByRole('dialog')))
  expect(resposta.mock.calls).toEqual([[false], [false]])
})

it('trocar de cliente cancela a intenção antiga e permite abrir outra', async () => {
  resposta.mockClear()
  const tela = render(<Tela />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir confirmação' }))
  await act(async () => tela.rerender(<Tela escopo="cliente:2" />))
  expect(resposta).toHaveBeenCalledWith(false)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Abrir confirmação' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remover arquivo' })))
  expect(resposta.mock.calls).toEqual([[false], [true]])
})

it('desmontar cancela a intenção pendente', async () => {
  resposta.mockClear()
  const tela = render(<Tela />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir confirmação' }))
  await act(async () => tela.unmount())
  expect(resposta).toHaveBeenCalledOnce()
  expect(resposta).toHaveBeenCalledWith(false)
})

function TelaTexto({ escopo = 'cliente:1', opcional = false }: { escopo?: string; opcional?: boolean }) {
  const { solicitarTexto, dialogo } = useConfirmacao(escopo)
  return <><button onClick={async () => resposta(await solicitarTexto({ titulo: 'Confirmar alteração',
    mensagem: 'Esta alteração afeta a conta selecionada.', acao: 'Salvar alteração', rotulo: 'Identificador',
    aceitarVazio: opcional, validar: valor => opcional || valor === 'conta-certa' ? null : 'Identificador incorreto.',
  }))}>Abrir formulário</button>{dialogo}</>
}

it('mantém o texto e explica o erro até a confirmação exata', async () => {
  resposta.mockClear()
  render(<TelaTexto />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir formulário' }))
  const campo = screen.getByRole('textbox', { name: 'Identificador' })
  expect(campo).toHaveFocus()
  fireEvent.change(campo, { target: { value: 'outra-conta' } })
  fireEvent.submit(campo.closest('form')!)
  expect(screen.getByRole('alert')).toHaveTextContent('Identificador incorreto.')
  expect(campo).toHaveAccessibleDescription('Identificador incorreto.')
  expect(campo).toHaveValue('outra-conta')
  expect(resposta).not.toHaveBeenCalled()
  fireEvent.change(campo, { target: { value: '  conta-certa  ' } })
  await act(async () => fireEvent.submit(campo.closest('form')!))
  expect(resposta).toHaveBeenCalledExactlyOnceWith('conta-certa')
})

it('campo obrigatório vazio não confirma; cancelar devolve null', async () => {
  resposta.mockClear()
  render(<TelaTexto />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir formulário' }))
  fireEvent.submit(screen.getByRole('textbox').closest('form')!)
  expect(screen.getByRole('alert')).toHaveTextContent('Preencha o campo')
  expect(resposta).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })))
  expect(resposta).toHaveBeenCalledExactlyOnceWith(null)
})

it('distingue confirmação sem motivo de cancelamento', async () => {
  resposta.mockClear()
  render(<TelaTexto opcional />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir formulário' }))
  await act(async () => fireEvent.submit(screen.getByRole('textbox').closest('form')!))
  expect(resposta).toHaveBeenCalledExactlyOnceWith('')
})

it('o teclado circula pelo campo e pelas ações sem sair do diálogo', () => {
  render(<TelaTexto />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir formulário' }))
  const campo = screen.getByRole('textbox')
  const salvar = screen.getByRole('button', { name: 'Salvar alteração' })
  campo.focus()
  fireEvent.keyDown(campo, { key: 'Tab', shiftKey: true })
  expect(salvar).toHaveFocus()
  fireEvent.keyDown(salvar, { key: 'Tab' })
  expect(campo).toHaveFocus()
})

it('voltar ao cliente anterior não ressuscita um formulário cancelado pela troca', async () => {
  resposta.mockClear()
  const tela = render(<TelaTexto />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir formulário' }))
  await act(async () => tela.rerender(<TelaTexto escopo="cliente:2" />))
  await act(async () => tela.rerender(<TelaTexto escopo="cliente:1" />))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(resposta).toHaveBeenCalledExactlyOnceWith(null)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir formulário' }))
  expect(screen.getByRole('textbox')).toHaveValue('')
})
