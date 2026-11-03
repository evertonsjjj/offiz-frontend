import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { IdiomaProvider, useIdioma } from '../lib/i18n'
import PrediosPage from './Predios'

vi.mock('../lib/api', async (original) => ({
  ...await original<typeof import('../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('../lib/ws', () => ({ wsClient: { on: () => () => undefined } }))
vi.mock('../lib/useBrasao', () => ({ useBrasao: () => null }))

function TrocarIdioma() {
  const { definirPreferencia } = useIdioma()
  return <button onClick={() => void definirPreferencia('pt-BR')}>Português</button>
}
const montar = () => render(<MemoryRouter><IdiomaProvider><TrocarIdioma /><PrediosPage /></IdiomaProvider></MemoryRouter>)
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  localStorage.setItem('offiz:idioma:visitante', 'en')
  vi.mocked(api.get).mockResolvedValue([])
})

it('lista empresas e status em inglês preservando os nomes reais e a busca ao trocar idioma', async () => {
  const predios = ['Jurídico', 'Conteúdo', 'Operações', 'Financeiro', 'Engenharia'].map((nome, i) => ({
    org_id: i === 4 ? 2 : 1, org_nome: i === 4 ? 'Empresa São João' : 'Aurora',
    office_slug: `office-${i}`, office: { nome, descricao: `Equipe de ${nome}` }, nao_lidas: 2,
    ultimo_job: i === 0 ? { status: 'running', criado_em: new Date().toISOString() } : null,
  }))
  vi.mocked(api.get).mockImplementation(async (path) => path === '/predios' ? { predios } : [])
  montar()
  expect(await screen.findByRole('heading', { name: 'Empresa São João' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Your companies' })).toBeInTheDocument()
  expect(screen.getByText('Running')).toBeInTheDocument()
  expect(screen.getByText('just now')).toBeInTheDocument()
  expect(screen.getAllByText('No tasks yet')).toHaveLength(4)
  const busca = screen.getByRole('searchbox', { name: 'Search offices' })
  fireEvent.change(busca, { target: { value: 'Jurídico' } })
  expect(screen.getByText('Jurídico')).toBeInTheDocument()
  expect(screen.getByText('1 area · 1 specialty')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Português' }))
  expect(await screen.findByRole('searchbox', { name: 'Buscar escritórios' })).toBe(busca)
  expect(busca).toHaveValue('Jurídico')
  expect(screen.getByText('1 área · 1 especialidade')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('explica o estado vazio em inglês sem criar empresa ou prometer capacidade existente', async () => {
  montar()
  expect(await screen.findByRole('heading', { name: 'Your company has no offices yet' })).toBeInTheDocument()
  expect(screen.getByText(/When a type of work is enabled for you/)).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})
