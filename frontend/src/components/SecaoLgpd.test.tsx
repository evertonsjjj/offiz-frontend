import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { SecaoLgpd } from './SecaoLgpd'
import { api } from '../lib/api'

const contexto = vi.hoisted(() => ({ sair: vi.fn(), sucesso: vi.fn(), falha: vi.fn() }))
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), del: vi.fn() } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ sair: contexto.sair }) }))
vi.mock('./Toasts', () => ({ useToasts: () => ({ sucesso: contexto.sucesso, falha: contexto.falha }) }))
function Destino() { return <p data-testid="destino">{useLocation().pathname}</p> }
beforeEach(() => { vi.clearAllMocks() })

it('encerra a sessão mesmo quando a exclusão deixa limpeza de anexos pendente', async () => {
  let desconectar!: () => void
  vi.mocked(api.del).mockResolvedValue({ limpeza_anexos_pendente: true })
  contexto.sair.mockImplementation(() => new Promise<void>(resolve => { desconectar = resolve }))
  render(<MemoryRouter initialEntries={['/app']}><SecaoLgpd /><Destino /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Excluir minha conta' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'EXCLUIR' } })
  fireEvent.click(screen.getByRole('button', { name: 'Excluir minha conta em definitivo' }))
  await waitFor(() => expect(contexto.sair).toHaveBeenCalledOnce())
  expect(screen.getByTestId('destino')).toHaveTextContent('/app')
  await act(async () => desconectar())
  expect(screen.getByTestId('destino').textContent).toBe('/')
  expect(contexto.falha).toHaveBeenCalledWith(expect.stringContaining('Conta encerrada. A remoção dos anexos privados ficou pendente'))
  expect(api.del).toHaveBeenCalledExactlyOnceWith('/lgpd/excluir-conta', { confirmo: true })
})
