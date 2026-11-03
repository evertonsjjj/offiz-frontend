import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MenuUsuario } from './MenuUsuario'

const contexto = vi.hoisted(() => ({ sair: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ usuario: { id: 11, nome: 'Pessoa de teste', email: 'pessoa@example.invalid' }, sair: contexto.sair }) }))

beforeEach(() => { vi.clearAllMocks() })

it('Escape fecha preferências e devolve foco ao avatar, sem encerrar a sessão', () => {
  render(<MenuUsuario acoes={[{ titulo: 'Ver plano', executar: vi.fn() }]} />)
  const avatar = screen.getByRole('button', { name: 'Sua conta' })
  fireEvent.click(avatar)
  const menu = screen.getByRole('dialog', { name: 'Preferências da sua conta' })
  within(menu).getByRole('button', { name: 'Ver plano' }).focus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(avatar).toHaveFocus()
  expect(avatar).toHaveAttribute('aria-expanded', 'false')
  expect(contexto.sair).not.toHaveBeenCalled()
})

it('fechar por clique fora conserva o foco da ação escolhida', () => {
  render(<><MenuUsuario /><button type="button">Continuar meu pedido</button></>)
  fireEvent.click(screen.getByRole('button', { name: 'Sua conta' }))
  const externo = screen.getByRole('button', { name: 'Continuar meu pedido' })
  externo.focus()
  fireEvent.mouseDown(externo)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(externo).toHaveFocus()
  expect(contexto.sair).not.toHaveBeenCalled()
})

it('a ferramenta escolhida é executada uma vez e fecha as preferências', () => {
  const executar = vi.fn()
  render(<MenuUsuario acoes={[{ titulo: 'Ver plano', executar }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sua conta' }))
  fireEvent.click(screen.getByRole('button', { name: 'Ver plano' }))
  expect(executar).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(contexto.sair).not.toHaveBeenCalled()
})
