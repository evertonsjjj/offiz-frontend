import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, setTokens } from '../../lib/api'
import { consumoDaConversa } from '../../test/consumoFixture'
import { ConversaTab } from './ConversaTab'

vi.mock('../../lib/api', async original => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() },
}))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
vi.mock('./ResultadoEntrega', () => ({ default: ({ nome }: { nome: string }) => <p>Prévia de {nome}</p> }))

const office = { slug: 'predio', nome: 'Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const entrega = { id: 9, job_id: 3, nome: 'post.png', mime: 'image/png', status: 'pendente', tipo: 'arquivo' }
const conversa = {
  id: 5, organization_id: 1, office_slug: null, titulo: 'Campanha Aurora', atualizado_em: '2026-11-02T18:00:00Z',
  total_mensagens: 1, mensagens: [{ id: 51, role: 'assistant', conteudo: 'A peça está pronta para revisão.' }], anexos: [],
  trabalho_job_id: 3, trabalhos: [{ id: 3, titulo: 'Post da campanha', status: 'done', entregas: [entrega] }],
}
const job = { id: 3, organization_id: 1, office_slug: 'conteudo', status: 'done', titulo: 'Post da campanha' }
const fluxo = {
  job, derivado: true, tem_eventos: true,
  colunas: [
    { titulo: 'O que entrou', nos: [{ id: 'f1', titulo: 'Arquivo original Aurora', selo: 'material' }] },
    { titulo: 'Quem mexeu', nos: [] },
    { titulo: 'O que saiu', nos: [] },
  ], arestas: [],
}

function Endereco() { return <output aria-label="Endereço atual">{useLocation().search}</output> }
function montar() {
  return render(<MemoryRouter initialEntries={['/app?conversa=5']}>
    <Endereco /><ConversaTab orgId={1} slug="predio" office={office} nivelPredio />
  </MemoryRouter>)
}
async function abrirOrigem() {
  const grupo = (await screen.findByText('Como foi feito · referências e arquivos')).closest('details')!
  // JSDOM precisa do estado/evento nativo de details para disparar onToggle.
  grupo.open = true
  fireEvent(grupo, new Event('toggle'))
}

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear()
  setTokens('sessao-local-sintetica', 'refresh-local-sintetico')
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/orgs/1/predio/conversas') return { conversas: [conversa] }
    if (path === '/conversas/5') return conversa
    if (path === '/conversas/5/uso') return consumoDaConversa(path)
    if (path === '/jobs/3') return job
    if (path === '/orgs/1/biblioteca/3') return { arquivos: [entrega] }
    if (path === '/predios/1/conteudo/estudio/trabalhos/3/fluxo') return fluxo
    if (path === '/predios/1/conteudo/estudio/comentarios?job_id=3') return { comentarios: [] }
    throw new ApiError(404, 'Prédio não encontrado')
  })
  vi.mocked(api.put).mockResolvedValue({})
})
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

it('CEO sem org na URL abre a origem no escritório autorizado do trabalho e mantém a navegação da empresa', async () => {
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Ver entrega' }))
  await abrirOrigem()
  expect(await screen.findByText('Arquivo original Aurora')).toBeVisible()
  expect(screen.queryByText('Prédio não encontrado')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('?conversa=5')
  expect(screen.getByRole('link', { name: 'Ver entrega completa' })).toHaveAttribute('href', '/app?org=1&vista=biblioteca&trabalho=3&arquivo=9')
  expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toContain('/predios/1/conteudo/estudio/trabalhos/3/fluxo')
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.startsWith('/predios/1/predio/'))).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it('aguarda a identidade do trabalho antes de consultar sua origem e não usa predio como fallback', async () => {
  let resolver!: (valor: typeof job) => void
  const pendente = new Promise<typeof job>(resolve => { resolver = resolve })
  const get = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation((path, signal) => path === '/jobs/3' ? pendente : get(path, signal))
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Ver entrega' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/jobs/3'))
  expect(screen.queryByText('Como foi feito · referências e arquivos')).not.toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/fluxo'))).toBe(false)
  await act(async () => resolver(job))
  await abrirOrigem()
  expect(await screen.findByText('Arquivo original Aurora')).toBeVisible()
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.startsWith('/predios/1/predio/'))).toBe(false)
})
