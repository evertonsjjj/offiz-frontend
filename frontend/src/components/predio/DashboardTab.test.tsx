import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { IdiomaProvider } from '../../lib/i18n'
import { DashboardTab } from './DashboardTab'
import { MARCADOR_SABATINA } from './SetupSabatina'

const contexto = vi.hoisted(() => ({ sessao: 'conta-a' }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), getSessionIdentity: () => contexto.sessao, api: { get: vi.fn(), post: vi.fn(), postForm: vi.fn() } }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn() }) }))
vi.mock('../../lib/ws', () => ({ wsClient: { on: () => () => {} } }))
const office = { slug: 'conteudo', nome: 'Conteúdo', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const agora = new Date().toISOString()
const dados = (orgId = 1) => ({
  stats: { tarefas_mes: 2, concluidas_mes: 1, entregas_pendentes: 1, rodando: false },
  jobs: [{ id: orgId * 10, status: 'done', titulo: `Pedido da empresa ${orgId}`, criado_em: agora }],
  entregas: [{ id: orgId * 100, nome: `entrega-empresa-${orgId}.pdf`, tipo: 'arquivo', status: 'pendente', criado_em: agora }],
})
const getBase = async (path: string): Promise<unknown> => {
  const d = dados(Number(path.split('/')[2]))
  return path.endsWith('/stats') ? d.stats : path.includes('/jobs?') ? { jobs: d.jobs }
    : path.endsWith('/entregas') ? { entregas: d.entregas } : path.endsWith('/canon') ? { conteudo: '' }
    : path.endsWith('/arquivos') ? { entrada: [], exemplos: [], produto: [] }
    : path.endsWith('/partida') ? { sabatina_pendente: true, perfil_estado: 'inicial' } : null
}
const tela = (orgId = 1, meuPapel?: string, aoNavegar = vi.fn(), slug = 'conteudo') => <IdiomaProvider><DashboardTab orgId={orgId} slug={slug} office={{ ...office, slug }} meuPapel={meuPapel} aoNavegar={aoNavegar} /></IdiomaProvider>
const atualizar = () => act(() => { window.dispatchEvent(new Event('offiz:entregas-mudou')) })
beforeEach(() => {
  vi.resetAllMocks(); contexto.sessao = 'conta-a'; localStorage.clear(); localStorage.setItem('offiz:idioma:visitante', 'pt-BR')
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.mocked(api.get).mockImplementation(path => getBase(path) as never)
  vi.mocked(api.postForm).mockResolvedValue({ nome: 'referencia.pdf' })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([
  ['prédio confirmado, sem marcador no andar', ''],
  ['andar confirmado', `## O que a empresa faz\n- Produzimos conteúdo.\n${MARCADOR_SABATINA}`],
])('não reinicia a entrevista quando a partida confirma preparação: %s', async (_caso, canon) => {
  vi.useFakeTimers()
  vi.mocked(api.get).mockImplementation(path => path.endsWith('/partida') ? Promise.resolve({ sabatina_pendente: false, perfil_estado: 'contextualizado' })
    : path.endsWith('/canon') ? Promise.resolve({ conteudo: canon }) : getBase(path) as never)
  const navegar = vi.fn()
  render(tela(1, 'owner', navegar))
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  expect(screen.queryByRole('region', { name: 'Apresentar a sua empresa' })).not.toBeInTheDocument()
  expect(screen.queryByText(/O escritório ainda não conhece a sua empresa/)).not.toBeInTheDocument()
  expect(screen.getByText('entrega-empresa-1.pdf')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'pedir um trabalho →' }))
  expect(navegar).toHaveBeenCalledWith('conversa')
  expect(api.get).toHaveBeenCalledWith('/predios/1/conteudo/partida', expect.any(AbortSignal))
  expect(api.post).not.toHaveBeenCalled()
})

it('preparação pendente confirmada permite a entrevista ou começar pelo pedido', async () => {
  vi.useFakeTimers()
  const navegar = vi.fn()
  render(tela(1, 'owner', navegar))
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  expect(screen.getByRole('textbox', { name: 'Pra começar: o que a sua empresa faz?' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Prefiro começar pelo meu pedido' }))
  expect(navegar).toHaveBeenCalledWith('conversa')
  fireEvent.click(screen.getByRole('button', { name: 'deixar para depois e ver o painel' }))
  expect(screen.getByRole('button', { name: 'Completar meu perfil' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('perfil parcial permite pedir trabalho e completar informações apenas por escolha', async () => {
  vi.useFakeTimers()
  vi.mocked(api.get).mockImplementation(path => path.endsWith('/partida')
    ? Promise.resolve({ sabatina_pendente: true, perfil_estado: 'em_andamento' }) : getBase(path) as never)
  const navegar = vi.fn()
  render(tela(1, 'owner', navegar))
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  expect(screen.queryByRole('region', { name: 'Apresentar a sua empresa' })).not.toBeInTheDocument()
  expect(screen.queryByText(/O escritório ainda não conhece a sua empresa|Perfil atualizado|Perfil preparado/)).not.toBeInTheDocument()
  expect(screen.getByText('entrega-empresa-1.pdf')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'pedir um trabalho →' }))
  expect(navegar).toHaveBeenCalledWith('conversa')
  fireEvent.click(screen.getByRole('button', { name: 'Completar meu perfil' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  expect(screen.getByRole('textbox', { name: 'Pra começar: o que a sua empresa faz?' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['falha', 'sem estado', 'estado inválido', 'legado sem perfil', 'perfil inválido'])('leitura de preparação %s não impõe entrevista nem afirma perfil pronto', async caso => {
  vi.useFakeTimers()
  vi.mocked(api.get).mockImplementation(path => path.endsWith('/partida')
    ? caso === 'falha' ? Promise.reject(new Error('partida indisponível')) : Promise.resolve(caso === 'sem estado' ? {} : caso === 'legado sem perfil' ? { sabatina_pendente: true }
      : caso === 'perfil inválido' ? { sabatina_pendente: true, perfil_estado: 'preparado' } : { sabatina_pendente: 'false', perfil_estado: 'inicial' })
    : getBase(path) as never)
  render(tela(1, 'owner'))
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  expect(screen.queryByRole('region', { name: 'Apresentar a sua empresa' })).not.toBeInTheDocument()
  expect(screen.queryByText(/O escritório ainda não conhece a sua empresa|Perfil atualizado|Perfil preparado/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Completar meu perfil' })).not.toBeInTheDocument()
  expect(screen.getByText('entrega-empresa-1.pdf')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('estado de partida ainda desconhecido não abre entrevista antes da confirmação', async () => {
  vi.useFakeTimers()
  let confirmar!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(path => path.endsWith('/partida') ? new Promise(resolve => { confirmar = resolve }) as never : getBase(path) as never)
  render(tela(1, 'owner'))
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  expect(screen.queryByRole('region', { name: 'Apresentar a sua empresa' })).not.toBeInTheDocument()
  expect(screen.getByText('entrega-empresa-1.pdf')).toBeInTheDocument()
  await act(async () => confirmar({ sabatina_pendente: true, perfil_estado: 'inicial' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  expect(screen.getByRole('textbox', { name: 'Pra começar: o que a sua empresa faz?' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it.each([[2, 'conteudo'], [1, 'dev']])('descarta partida antiga depois de mudar para empresa %i/andar %s', async (orgId, slug) => {
  vi.useFakeTimers()
  let confirmarAntiga!: (value: unknown) => void
  let sinalAntigo: AbortSignal | undefined
  vi.mocked(api.get).mockImplementation((path, signal) => path === '/predios/1/conteudo/partida'
    ? new Promise(resolve => { confirmarAntiga = resolve; sinalAntigo = signal }) as never
    : path.endsWith('/partida') ? Promise.resolve({ sabatina_pendente: false, perfil_estado: 'contextualizado' }) : getBase(path) as never)
  const { rerender } = render(tela(1, 'owner'))
  await act(async () => {})
  rerender(tela(orgId, 'owner', vi.fn(), slug))
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  expect(sinalAntigo?.aborted).toBe(true)
  await act(async () => { confirmarAntiga({ sabatina_pendente: true, perfil_estado: 'inicial' }); await vi.advanceTimersByTimeAsync(1400) })
  expect(screen.queryByRole('region', { name: 'Apresentar a sua empresa' })).not.toBeInTheDocument()
  expect(screen.getByText(`entrega-empresa-${orgId}.pdf`)).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('falha inicial não afirma que o escritório está livre e permite consultar novamente', async () => {
  vi.mocked(api.get).mockRejectedValue(new Error('offline'))
  render(tela())
  expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível atualizar/)
  expect(screen.queryByText('Tudo em dia — nada esperando você.')).not.toBeInTheDocument()
  expect(screen.queryByText('Escritório ocioso')).not.toBeInTheDocument()
  expect(screen.queryByText(/Nenhuma entrega ainda/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Nenhuma tarefa nos últimos/)).not.toBeInTheDocument()
  vi.mocked(api.get).mockImplementation(path => getBase(path) as never)
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByText('entrega-empresa-1.pdf')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('falha no refresh preserva pedido e entrega confirmados com aviso de consulta antiga', async () => {
  render(tela()); await screen.findByText('entrega-empresa-1.pdf')
  vi.mocked(api.get).mockRejectedValue(new Error('offline')); atualizar()
  expect(await screen.findByRole('alert')).toHaveTextContent(/última consulta/)
  expect(screen.getByText('Pedido da empresa 1')).toBeInTheDocument()
  expect(screen.getByText('entrega-empresa-1.pdf')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '1 entrega esperando o seu OK.' })).toBeInTheDocument()
})

it('falha de uma lista não apaga as outras e não vira tarefa inexistente', async () => {
  vi.mocked(api.get).mockImplementation(path => path.includes('/jobs?') ? Promise.reject(new Error('jobs offline')) : getBase(path) as never)
  render(tela()); await screen.findByText('entrega-empresa-1.pdf')
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.queryByText('Escritório ocioso')).not.toBeInTheDocument()
  expect(screen.queryByText(/Nenhuma tarefa nos últimos/)).not.toBeInTheDocument()
})

it('falha inicial só nos contadores não transforma listas vazias em escritório confirmado livre', async () => {
  vi.mocked(api.get).mockImplementation(path => path.endsWith('/stats') ? Promise.reject(new Error('stats offline'))
    : path.includes('/jobs?') ? Promise.resolve({ jobs: [] }) : path.endsWith('/entregas') ? Promise.resolve({ entregas: [] }) : getBase(path) as never)
  render(tela()); await screen.findByRole('alert')
  expect(screen.queryByText('Tudo em dia — nada esperando você.')).not.toBeInTheDocument()
  expect(screen.queryByText('Escritório ocioso')).not.toBeInTheDocument()
  expect(screen.getByText(/Nenhuma entrega ainda/)).toBeInTheDocument()
})

it('consulta mais antiga não substitui o refresh já confirmado', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(path => path.endsWith('/entregas') ? new Promise(resolve => { resolver = resolve }) as never : getBase(path) as never)
  render(tela()); await waitFor(() => expect(resolver).toBeTypeOf('function'))
  vi.mocked(api.get).mockImplementation(path => getBase(path) as never); atualizar()
  await screen.findByText('entrega-empresa-1.pdf')
  await act(async () => resolver({ entregas: [{ ...dados().entregas[0], nome: 'entrega-antiga.pdf' }] }))
  expect(screen.queryByText('entrega-antiga.pdf')).not.toBeInTheDocument()
  expect(screen.getByText('entrega-empresa-1.pdf')).toBeInTheDocument()
})

it('troca de empresa limpa o painel e descarta a resposta da empresa anterior', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(path => path === '/predios/1/conteudo/entregas' ? new Promise(resolve => { resolver = resolve }) as never : getBase(path) as never)
  const { rerender } = render(tela()); await waitFor(() => expect(resolver).toBeTypeOf('function'))
  rerender(tela(2)); await screen.findByText('entrega-empresa-2.pdf')
  await act(async () => resolver({ entregas: dados().entregas }))
  expect(screen.queryByText('entrega-empresa-1.pdf')).not.toBeInTheDocument()
  expect(screen.getByText('Pedido da empresa 2')).toBeInTheDocument()
})

it('resposta depois da troca de login não altera o painel antigo', async () => {
  let resolver!: (value: unknown) => void
  render(tela()); await screen.findByText('entrega-empresa-1.pdf')
  vi.mocked(api.get).mockImplementation(path => path.endsWith('/entregas') ? new Promise(resolve => { resolver = resolve }) as never : getBase(path) as never)
  atualizar(); await waitFor(() => expect(resolver).toBeTypeOf('function'))
  contexto.sessao = 'conta-b'
  await act(async () => resolver({ entregas: [{ ...dados().entregas[0], nome: 'resultado-da-conta-anterior.pdf' }] }))
  expect(screen.queryByText('resultado-da-conta-anterior.pdf')).not.toBeInTheDocument()
})

it('métrica opcional lenta não impede mostrar tarefas e entregas já recebidas', async () => {
  vi.mocked(api.get).mockImplementation(path => path.includes('/metricas/') ? new Promise(() => {}) as never : getBase(path) as never)
  render(tela())
  expect(await screen.findByText('entrega-empresa-1.pdf')).toBeInTheDocument()
  expect(screen.getByText('Pedido da empresa 1')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('upload preserva uma resposta apenas digitada sem tornar a entrevista obrigatória', async () => {
  vi.useFakeTimers()
  const navegar = vi.fn()
  const { container } = render(tela(1, 'owner', navegar))
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  const campo = screen.getByRole('textbox', { name: 'Pra começar: o que a sua empresa faz?' })
  fireEvent.change(campo, { target: { value: 'Sou psicóloga, começando minha divulgação.' } })
  vi.mocked(api.get).mockImplementation(path => path.endsWith('/arquivos') ? Promise.resolve({ entrada: [{ nome: 'referencia.pdf' }] }) : getBase(path) as never)
  await act(async () => fireEvent.change(container.querySelector<HTMLInputElement>('input[type=file]')!, { target: { files: [new File(['referência sintética'], 'referencia.pdf')] } }))
  expect(screen.getByRole('textbox')).toBe(campo)
  expect(campo).toHaveValue('Sou psicóloga, começando minha divulgação.')
  fireEvent.click(screen.getByRole('button', { name: 'Prefiro começar pelo meu pedido' }))
  expect(navegar).toHaveBeenCalledWith('conversa'); expect(api.post).not.toHaveBeenCalled()
})

it.each(['confirmada', 'indisponível'])('upload preserva entrevista explícita e rascunho quando nova partida está %s', async partida => {
  vi.useFakeTimers()
  const { container } = render(tela(1, 'owner'))
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Minha empresa produz conteúdo.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(700) })
  const campo = screen.getByRole('textbox', { name: 'Qual serviço, produto ou trabalho é prioridade hoje?' })
  fireEvent.change(campo, { target: { value: 'Quero divulgar nosso novo produto.' } })
  vi.mocked(api.get).mockImplementation(path => path.endsWith('/arquivos') ? Promise.resolve({ entrada: [{ nome: 'referencia.pdf' }] })
    : path.endsWith('/partida') ? partida === 'confirmada' ? Promise.resolve({ sabatina_pendente: false, perfil_estado: 'contextualizado' }) : Promise.reject(new Error('partida indisponível'))
      : getBase(path) as never)
  await act(async () => fireEvent.change(container.querySelector<HTMLInputElement>('input[type=file]')!, { target: { files: [new File(['referência sintética'], 'referencia.pdf')] } }))
  expect(screen.getByRole('textbox')).toBe(campo)
  expect(campo).toHaveValue('Quero divulgar nosso novo produto.')
  expect(screen.getByRole('button', { name: 'Minha empresa produz conteúdo.' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'deixar para depois e ver o painel' }))
  expect(screen.queryByRole('region', { name: 'Apresentar a sua empresa' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('enviar só um arquivo continua permitindo começar sem entrevista', async () => {
  vi.useFakeTimers()
  const navegar = vi.fn()
  const { container } = render(tela(1, 'owner', navegar))
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
  vi.mocked(api.get).mockImplementation(path => path.endsWith('/arquivos') ? Promise.resolve({ entrada: [{ nome: 'referencia.pdf' }] }) : getBase(path) as never)
  await act(async () => fireEvent.change(container.querySelector<HTMLInputElement>('input[type=file]')!, { target: { files: [new File(['referência sintética'], 'referencia.pdf')] } }))
  expect(screen.queryByRole('region', { name: 'Apresentar a sua empresa' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'pedir um trabalho →' }))
  expect(navegar).toHaveBeenCalledWith('conversa'); expect(api.post).not.toHaveBeenCalled()
})
