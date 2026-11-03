import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import { setTokens } from '../lib/api'
import { lerPedidoLanding } from '../lib/pedidoLanding'
import { LandingSolucoes } from './LandingSolucoes'

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear() })

it('leva o texto customizado ao app sem colocá-lo na URL', () => {
  setTokens('sintetico', 'sintetico')
  abrir(true)
  fireEvent.change(screen.getByRole('textbox', { name: 'Qual resultado você precisa primeiro?' }), { target: { value: 'Dados privados para minha apresentação.' } })
  const abrirApp = screen.getByRole('link', { name: 'Abrir meu Offiz' })
  const destino = abrirApp.getAttribute('href')!
  expect(destino).not.toContain('Dados')
  fireEvent.click(abrirApp)
  expect(lerPedidoLanding(new URL(destino, 'http://offiz.test').searchParams.get('pedido-inicial')!)?.texto).toBe('Dados privados para minha apresentação.')
})

function abrir(logado = false) {
  render(<MemoryRouter><LandingSolucoes logado={logado} /></MemoryRouter>)
}

it('escolher uma demanda prepara o contato sem criar ou enviar trabalho', () => {
  abrir()
  fireEvent.click(screen.getAllByRole('link', { name: 'Começar por esta demanda' })[0])
  const pedido = screen.getByRole('textbox', { name: 'Qual resultado você precisa primeiro?' })
  expect(pedido).toHaveValue('Quero transformar meus materiais em um vídeo.')
  expect(screen.getByRole('button', { name: 'Vídeo e conteúdo' })).toHaveAttribute('aria-pressed', 'true')
  const contato = screen.getByRole('link', { name: 'Conversar sobre meu pedido' })
  expect(decodeURIComponent(contato.getAttribute('href') || '')).toContain('Quero transformar meus materiais em um vídeo.')
})

it('troca entre opção livre e guiada sem apagar o texto escrito', () => {
  abrir()
  const pedido = screen.getByRole('textbox', { name: 'Qual resultado você precisa primeiro?' })
  fireEvent.change(pedido, { target: { value: 'Preciso de um plano para o próximo mês.' } })
  expect(screen.getByRole('button', { name: 'Outro pedido' })).toHaveAttribute('aria-pressed', 'true')
  expect(decodeURIComponent(screen.getByRole('link', { name: 'Conversar sobre meu pedido' }).getAttribute('href') || '')).toContain('Preciso de um plano para o próximo mês.')
  fireEvent.click(screen.getByRole('button', { name: 'Outro pedido' }))
  expect(pedido).toHaveValue('Preciso de um plano para o próximo mês.')
  expect(pedido).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Apresentações' }))
  expect(pedido).toHaveValue('Preciso de um plano para o próximo mês.')
})

it('leva quem já tem acesso ao produto e identifica os previews como exemplos', () => {
  abrir(true)
  expect(screen.getByRole('link', { name: 'Abrir meu Offiz' })).toHaveAttribute('href', '/app')
  expect(screen.queryByRole('link', { name: 'Conversar sobre meu pedido' })).not.toBeInTheDocument()
  expect(screen.getAllByText('Exemplo de fluxo')).toHaveLength(3)
  expect(screen.getByText('Sua decisão de uso')).toBeInTheDocument()
})
