import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./context/AuthContext', () => ({ useAuth: () => ({ usuario: null, carregando: false }) }))
vi.mock('./pages/Landing', () => ({ default: () => null }))
vi.mock('./pages/Login', () => ({ default: function LoginDestino() { const l = useLocation(); return <h1>{l.state?.de}</h1> } }))

it.each(['/app?org=7&slug=conteudo&f=entregas&job=12#arquivo', '/ceo/7?conversa=3', '/config/org/7?aba=membros', '/admin?aba=clientes'])('guarda endereço completo antes do login: %s', async (endereco) => {
  render(<MemoryRouter initialEntries={[endereco]}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: endereco })).toBeInTheDocument()
})

it('link antigo conserva trabalho, filtro e âncora além da aba', async () => {
  render(<MemoryRouter initialEntries={['/predios/7/conteudo?f=entregas&job=12#arquivo']}><App /></MemoryRouter>)
  const heading = await screen.findByRole('heading')
  const destino = new URL(heading.textContent!, 'https://offiz.invalid')
  expect(destino.pathname).toBe('/app')
  expect(Object.fromEntries(destino.searchParams)).toEqual({ org: '7', slug: 'conteudo', f: 'entregas', job: '12' })
  expect(destino.hash).toBe('#arquivo')
})
