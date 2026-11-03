import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { OffizInicio } from './Ceo'
import { api } from '../lib/api'

const modulo = vi.hoisted(() => ({ iniciou: false, liberar: undefined as (() => void) | undefined }))
vi.mock('../components/predio/BibliotecaProjetos', async () => {
  modulo.iniciou = true
  await new Promise<void>(resolve => { modulo.liberar = resolve })
  return { default: () => <p>Biblioteca carregada</p> }
})
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))
vi.mock('../components/Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))

it('carrega a biblioteca só ao abrir e mantém a conversa enquanto o módulo chega', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/orgs/3/inicio' ? {
    org_id: 3, org_nome: 'Empresa de teste', org_status: 'ativa', meu_papel: 'member', tem_chave: true,
    andares: [{ slug: 'financeiro', nome: 'Financeiro', descricao: '' }], solucoes: [], outras_solucoes: [], solucoes_ocultas: [],
    sabatina: { estado: 'contextualizado', pergunta: 'Por onde quer começar?', opcoes: [], permite_livre: true },
  } : path.includes('/biblioteca') ? { resumo: { prontos: 0, precisa_de_voce: 0, em_producao: 0, aprovados: 0 } } : { conversas: [] })
  render(<MemoryRouter><OffizInicio orgId={3} /></MemoryRouter>)
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  expect(modulo.iniciou).toBe(false)
  fireEvent.change(campo, { target: { value: 'Rascunho antes de abrir' } })
  fireEvent.click(screen.getByRole('link', { name: 'Pedidos e entregas' }))
  await screen.findByText('Abrindo sua biblioteca…')
  await waitFor(() => expect(modulo.iniciou).toBe(true))
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  fireEvent.change(campo, { target: { value: 'Continuo escrevendo durante o carregamento' } })
  await act(async () => modulo.liberar!())
  await screen.findByText('Biblioteca carregada')
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toBe(campo)
  expect(campo).toHaveValue('Continuo escrevendo durante o carregamento')
  fireEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }))
  expect(campo).toHaveValue('Continuo escrevendo durante o carregamento')
})
