import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { IdiomaProvider } from '../lib/i18n'
import type { OfficeInfo, Predio } from '../lib/types'
import PrediosPage from './Predios'

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('../lib/ws', () => ({ wsClient: { on: () => () => undefined } }))
vi.mock('../lib/useBrasao', () => ({ useBrasao: () => null }))

const tema = { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'predio' }
const office = (slug: string, nome: string, extras: Partial<OfficeInfo> = {}): OfficeInfo => ({ slug, nome, descricao: '', tema, ...extras })
const conteudo = office('conteudo', 'Conteúdo & Marca')
const midia = office('midia', 'Mídia & Performance')
const pessoal = office('assistente-pf', 'Assistente Financeiro Pessoal')
const empresa = office('assistente-pme', 'Assistente Financeiro Empresarial')
const planejamento = office('financeiro', 'Consultoria Financeira')
const lgpd = office('lgpd', 'Conformidade LGPD', { arquivado: true })
const dev = office('dev', 'Oficina de Código', { vendavel: false })
const outracoisa = office('outracoisa', 'OUTRAI — Estúdio de Produto', { vendavel: false })
const teste = office('teste', 'teste', { arquivado: true })
const predio = (o: OfficeInfo): Predio => ({ org_id: 7, org_nome: 'Aurora', office_slug: o.slug, office: o, nao_lidas: 0, ultimo_job: null })
const preparar = (concedidos: OfficeInfo[], catalogo: OfficeInfo[]) => vi.mocked(api.get).mockImplementation(async path => path === '/predios' ? concedidos.map(predio) : catalogo)
const montar = () => render(<MemoryRouter><IdiomaProvider><PrediosPage /></IdiomaProvider></MemoryRouter>)

beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); localStorage.setItem('offiz:idioma:visitante', 'pt-BR') })

it('agrupa acessos concedidos e mantém especialidades arquivadas e internas sem abrir outros módulos', async () => {
  preparar([conteudo, pessoal, lgpd, dev], [conteudo, midia, pessoal, empresa, planejamento, lgpd, dev, outracoisa, teste])
  montar()
  const marketing = await screen.findByRole('region', { name: 'Marketing & Conteúdo' })
  expect(within(marketing).getByRole('link', { name: /Produção de conteúdo/ })).toHaveAttribute('href', '/app?org=7&slug=conteudo')
  expect(within(marketing).queryByRole('link', { name: /Campanhas/ })).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Finanças' })).getAllByRole('link')).toHaveLength(1)
  expect(within(screen.getByRole('region', { name: 'Jurídico & Conformidade' })).getByRole('link', { name: /Conformidade LGPD/ })).toHaveAttribute('href', '/app?org=7&slug=lgpd')
  expect(within(screen.getByRole('region', { name: 'Produto & Tecnologia' })).getByRole('link', { name: /Desenvolvimento/ })).toHaveAttribute('href', '/app?org=7&slug=dev')
  expect(screen.getByText('4 áreas · 4 especialidades')).toBeInTheDocument()
  expect(screen.queryByText('teste')).not.toBeInTheDocument()
  expect(screen.queryByText('Design de produto')).not.toBeInTheDocument()
  const contato = screen.getByRole('link', { name: 'Conversar sobre Finanças' })
  expect(new URL(contato.getAttribute('href')!).searchParams.get('text')).toContain('Empresa · Planejamento')
  expect(screen.queryByRole('link', { name: 'Conversar sobre Jurídico & Conformidade' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Conversar sobre Produto & Tecnologia' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it('busca pela área sem acento e não oferece novamente o que a busca ocultou', async () => {
  preparar([conteudo, pessoal, planejamento, lgpd, dev], [conteudo, midia, pessoal, planejamento, lgpd, dev])
  montar()
  fireEvent.change(await screen.findByRole('searchbox', { name: 'Buscar escritórios' }), { target: { value: 'financas' } })
  const financas = screen.getByRole('region', { name: 'Finanças' })
  expect(within(financas).getAllByRole('link')).toHaveLength(2)
  expect(screen.queryByRole('region', { name: 'Marketing & Conteúdo' })).not.toBeInTheDocument()
  const mensagem = new URL(screen.getByRole('link', { name: 'Conversar sobre Marketing & Conteúdo' }).getAttribute('href')!).searchParams.get('text')
  expect(mensagem).toContain('Campanhas e resultados')
  expect(mensagem).not.toContain('Produção de conteúdo')
})

it('traduz áreas e módulos conhecidos preservando o nome de um serviço personalizado', async () => {
  localStorage.setItem('offiz:idioma:visitante', 'en')
  preparar([pessoal, planejamento, office('analise', 'Relatório Aurora', { area: 'financas' })], [])
  montar()
  const area = await screen.findByRole('region', { name: 'Finance' })
  expect(within(area).getByRole('link', { name: /Personal/ })).toHaveAttribute('href', '/app?org=7&slug=assistente-pf')
  expect(within(area).getByRole('link', { name: /Planning/ })).toHaveAttribute('href', '/app?org=7&slug=financeiro')
  expect(within(area).getByRole('link', { name: /Relatório Aurora/ })).toHaveAttribute('href', '/app?org=7&slug=analise')
  expect(screen.getByText('1 area · 3 specialties')).toBeInTheDocument()
})

it('conserva o atalho ao único escritório mesmo depois de arquivado', async () => {
  preparar([lgpd], [])
  render(<MemoryRouter initialEntries={['/predios']}><Routes><Route path="/predios" element={<PrediosPage />} /><Route path="/app" element={<p>Acesso mantido</p>} /></Routes></MemoryRouter>)
  expect(await screen.findByText('Acesso mantido')).toBeInTheDocument()
})
