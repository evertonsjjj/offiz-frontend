import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { IdiomaProvider } from '../../lib/i18n'
import { api } from '../../lib/api'
import { instalarDialogoDeTeste } from '../../test/dialog'
import { MesaTab } from './MesaTab'

const contexto = vi.hoisted(() => ({ sessao: 'conta-a', sucesso: vi.fn(), falha: vi.fn() }))
const dispositivosOriginais = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), getSessionIdentity: () => contexto.sessao, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn() } }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('../Toasts', () => ({ useToasts: () => contexto }))
vi.mock('../../lib/useBrasao', () => ({ useBrasao: () => null }))
vi.mock('../../lib/ws', () => ({ wsClient: { on: () => () => {}, subscribe: () => () => {}, connect: vi.fn(), close: vi.fn() } }))
instalarDialogoDeTeste()
const conversas = [{ id: 41, titulo: 'Conversa anterior' }, { id: 42, titulo: 'Conversa escolhida' }]
const acervo = { entrada: [], produto: [{ nome: 'foto.png', sub: '' }, { nome: 'foto.png', sub: 'campanha/jogo' }], marca: [], exemplos: [], aprovados: [] }
const entrega = { id: 71, job_id: 61, nome: 'arte.png', tipo: 'arquivo', caminho_rel: 'outputs/arte.png', tamanho_bytes: 20, criado_em: '2026-10-09T12:00:00', status: 'pendente', job_titulo: 'Arte aprovada para revisar' }
const plano = (slug: string) => ({ slug, titulo: `Plano ${slug}`, estado: 'planejada', tem_plano: true, cenas: [{ id: 'c1', rotulo: `Cena ${slug}`, travado: false, origem: 'acervo', material: [{ caminho: 'memoria/brand/acervo/foto.png', nome: 'foto.png', existe: true }], gera: true, custo_usd: 0.1 }], origem_resumo: {}, falta: [], narracao: { vozes: [] }, custo_pendente: 0.1, trilha_falta: false, pode_gerar: true, travas_abertas: 0, motor: { modo_org: 'api' } })
const mensagem = (texto: string, id = 1) => ({ mensagens: [{ id, role: 'assistant', conteudo: texto }] })
const baseGet = async (url: string): Promise<unknown> => url.endsWith('/conversas') ? { conversas }
  : url.endsWith('/pecas') ? { pecas: [{ slug: 'a', titulo: 'Produção A' }, { slug: 'b', titulo: 'Produção B' }] }
  : /\/pecas\/([ab])\/mesa$/.test(url) ? plano(url.includes('/pecas/a/') ? 'a' : 'b')
  : url.endsWith('/arquivos') ? acervo
  : url.endsWith('/entregas') ? [entrega]
  : url.endsWith('/partida') ? { tem_motor: true, tem_chave: true, sabatina_pendente: false }
  : url === '/conversas/41' ? mensagem('Texto da conversa anterior', 11)
  : url === '/conversas/42' ? mensagem('Texto da conversa escolhida', 12) : []
const tela = (orgId = 3, slug = 'juridico', painelInicial?: { qual: 'entregas'; n: number }) => <MemoryRouter><IdiomaProvider><MesaTab orgId={orgId} slug={slug} orgNome="Aurora" painelInicial={painelInicial} /></IdiomaProvider></MemoryRouter>
function arquivoInput(container: HTMLElement, n = 0) { return container.querySelectorAll<HTMLInputElement>('input[type=file]')[n] }
function apagarAnterior() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Opções da conversa' })[0])
  fireEvent.click(screen.getByRole('menuitem', { name: 'Apagar' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Apagar mesmo? Não volta.' }))
}
beforeEach(() => {
  vi.clearAllMocks(); contexto.sessao = 'conta-a'; localStorage.clear(); localStorage.setItem('offiz:idioma:visitante', 'pt-BR'); Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(api.get).mockImplementation(url => baseGet(url) as never)
  vi.mocked(api.post).mockImplementation(async url => url.endsWith('/conversas') ? { id: 43 } : {})
  vi.mocked(api.postForm).mockResolvedValue({}); vi.mocked(api.patch).mockResolvedValue({}); vi.mocked(api.del).mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(false); vi.spyOn(window, 'prompt').mockReturnValue(null)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (dispositivosOriginais) Object.defineProperty(navigator, 'mediaDevices', dispositivosOriginais); else Reflect.deleteProperty(navigator, 'mediaDevices') })

it('Mesa identifica custo fal parcial e não inicia narração de custo externo desconhecido com teto positivo', async () => {
  vi.mocked(api.get).mockImplementation(url => url.endsWith('/pecas/a/mesa') ? Promise.resolve({ ...plano('a'), custo_pendente: 0, custo_total_estimado: false, custo_pendente_escopo: 'estimativa_fal', custos_fora_fal: [{ etapa: 'narracao', custo_usd: null, via: 'elevenlabs', fora_fal: true }], pendencias: ['Confira o custo da narração.'], aviso_custo_externo: 'Narração ElevenLabs direta: custo externo não estimado.', orcamento: { teto_usd: 5 } }) as never : baseGet(url) as never)
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: /Produção A/ })); await screen.findByText('Plano a')
  expect(screen.getByText(/Estimativa fal.ai:/)).toHaveTextContent(/0,00/)
  expect(screen.getByText(/custo externo não estimado/)).toBeVisible()
  expect(screen.getByText('Confira o custo da narração.')).toBeVisible()
  const gerar = screen.getByRole('button', { name: 'Pode gerar' })
  expect(gerar).toBeDisabled(); fireEvent.click(gerar); expect(api.post).not.toHaveBeenCalled()
})

it('Mesa conserva geração sem limite com teto zero e identifica o custo externo', async () => {
  vi.mocked(api.get).mockImplementation(url => url.endsWith('/pecas/a/mesa') ? Promise.resolve({ ...plano('a'), custo_pendente: 0, custo_total_estimado: false, custos_fora_fal: [{ etapa: 'narracao', custo_usd: null, fora_fal: true }], aviso_custo_externo: 'Narração ElevenLabs direta: custo externo não estimado.', orcamento: { teto_usd: 0 } }) as never : baseGet(url) as never)
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: /Produção A/ })); await screen.findByText('Plano a')
  expect(screen.getByRole('button', { name: 'Pode gerar' })).toBeEnabled()
  expect(screen.getByText(/Teto zero não limita o gasto/)).toBeVisible(); expect(api.post).not.toHaveBeenCalled()
})

it('Mesa mostra indisponibilidade de custo, preserva documento e repete consulta sem produzir', async () => {
  vi.mocked(api.get).mockImplementation(url => url.endsWith('/pecas/a/mesa') ? Promise.resolve({ ...plano('a'), custo_pendente: null, custo_consulta_confirmada: false, pode_gerar: false, aviso_custo_consulta: 'Não foi possível conferir o custo. Atualize o plano para tentar novamente.' }) as never : baseGet(url) as never)
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: /Produção A/ })); await screen.findByText('Plano a')
  expect(screen.getByText(/Custo indisponível/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Pode gerar' })).toBeDisabled()
  expect(screen.getByText(/Não foi possível conferir o custo/)).toBeVisible(); expect(api.post).not.toHaveBeenCalled()
})

it('Mesa distingue voz padrão ativa de Sem narração e conserva texto ao escolher o padrão', async () => {
  vi.mocked(api.get).mockImplementation(url => url.endsWith('/pecas/a/mesa') ? Promise.resolve({ ...plano('a'), narracao: { texto: 'Um texto da peça.', porta_voz: null, vozes: [] } }) as never : baseGet(url) as never)
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: /Produção A/ })); await screen.findByText('Plano a')
  expect(screen.getByRole('heading', { name: 'Narração' })).toBeVisible()
  const padrao = screen.getByRole('button', { name: 'Voz padrão' })
  expect(padrao).toHaveAttribute('aria-current', 'true')
  fireEvent.click(padrao)
  await waitFor(() => expect(api.patch).toHaveBeenCalledExactlyOnceWith('/predios/3/juridico/estudio/pecas/a/narracao', { ligada: true, porta_voz: '' }))
  expect(screen.getByText('“Um texto da peça.”')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('resposta antiga do histórico não substitui a conversa escolhida depois', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(url => url === '/conversas/41' ? new Promise(resolve => { resolver = resolve }) as never : baseGet(url) as never)
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Conversa anterior' }))
  fireEvent.click(screen.getByRole('button', { name: 'Conversa escolhida' })); await screen.findByText('Texto da conversa escolhida')
  await act(async () => resolver(mensagem('Histórico atrasado', 13)))
  expect(screen.queryByText('Histórico atrasado')).not.toBeInTheDocument(); expect(screen.getByText('Texto da conversa escolhida')).toBeInTheDocument()
})

it('falha de envio anterior não leva seu texto ao rascunho da nova conversa', async () => {
  let rejeitar!: (reason: Error) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise((_, reject) => { rejeitar = reject }) as never)
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Conversa anterior' })); await screen.findByText('Texto da conversa anterior')
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem' }), { target: { value: 'Pedido da conversa anterior' } }); fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Conversa escolhida' })); await screen.findByText('Texto da conversa escolhida')
  await act(async () => rejeitar(new Error('Desconectado')))
  expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveValue(''); expect(contexto.falha).not.toHaveBeenCalled()
})

it('troca de empresa descarta a lista e o rascunho da empresa anterior', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(url => url === '/predios/3/juridico/conversas' ? new Promise(resolve => { resolver = resolve }) as never : url === '/predios/4/juridico/conversas' ? Promise.resolve({ conversas: [{ id: 51, titulo: 'Conversa da empresa atual' }] }) as never : baseGet(url) as never)
  const view = render(tela()); fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem' }), { target: { value: 'Rascunho antigo' } })
  view.rerender(tela(4)); await screen.findByRole('button', { name: 'Conversa da empresa atual' })
  await act(async () => resolver({ conversas }))
  expect(screen.queryByRole('button', { name: 'Conversa anterior' })).not.toBeInTheDocument(); expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveValue('')
})

it('lote de anexos para quando a pessoa escolhe outra conversa', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.postForm).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Conversa anterior' })); await screen.findByText('Texto da conversa anterior')
  fireEvent.change(arquivoInput(view.container), { target: { files: [new File(['a'], 'primeiro.pdf'), new File(['b'], 'segundo.pdf')] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Conversa escolhida' })); await screen.findByText('Texto da conversa escolhida')
  await act(async () => resolver({}))
  expect(api.postForm).toHaveBeenCalledTimes(1); expect(screen.queryByText('primeiro.pdf')).not.toBeInTheDocument(); expect(screen.queryByText('segundo.pdf')).not.toBeInTheDocument()
})

it('remoção de anexo com erro conserva o chip para repetir', async () => {
  vi.mocked(api.del).mockRejectedValueOnce(new Error('Sem conexão'))
  const view = render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Conversa anterior' })); await screen.findByText('Texto da conversa anterior')
  fireEvent.change(arquivoInput(view.container), { target: { files: [new File(['a'], 'anexo.pdf')] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Remover anexo.pdf' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não deu para remover do servidor'))
  expect(screen.getByRole('button', { name: 'Remover anexo.pdf' })).toBeEnabled()
})

it('apagar conversa usa confirmação interna com aviso e cancelamento', async () => {
  render(tela()); await screen.findByRole('button', { name: 'Conversa anterior' }); apagarAnterior()
  const dialogo = screen.getByRole('dialog'); expect(dialogo).toHaveTextContent('Conversa anterior'); expect(dialogo).toHaveTextContent('entregas e o histórico')
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' })); expect(api.del).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled()
})

it('apagamento atrasado da conversa anterior conserva a conversa escolhida', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.del).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Conversa anterior' })); await screen.findByText('Texto da conversa anterior'); apagarAnterior()
  const botao = within(screen.getByRole('dialog')).getByRole('button', { name: 'Apagar conversa' }); fireEvent.click(botao); fireEvent.click(botao)
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/conversas/41'))
  fireEvent.click(screen.getByRole('button', { name: 'Conversa escolhida' })); await screen.findByText('Texto da conversa escolhida')
  await act(async () => resolver(undefined)); expect(screen.getByText('Texto da conversa escolhida')).toBeInTheDocument()
})

it('exclusão do acervo distingue o arquivo de mesma pasta pelo caminho completo', async () => {
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: /^Acervo/ }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Excluir foto.png' }))[1])
  const dialogo = screen.getByRole('dialog'); expect(dialogo).toHaveTextContent('produto/campanha/jogo/foto.png')
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Excluir arquivo' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/predios/3/juridico/arquivos/produto/foto.png?sub=campanha%2Fjogo'))
})

it('upload totalmente falho do acervo não mostra mensagem de sucesso', async () => {
  vi.mocked(api.postForm).mockRejectedValue(new Error('Sem conexão'))
  const view = render(tela()); fireEvent.click(await screen.findByRole('button', { name: /^Acervo/ })); fireEvent.click(await screen.findByRole('button', { name: /^Fotos e vídeos/ }))
  fireEvent.change(arquivoInput(view.container, 1), { target: { files: [new File(['a'], 'falhou.png')] } })
  await waitFor(() => expect(contexto.falha).toHaveBeenCalled()); expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('cancelar recusa de entrega não chama API', async () => {
  render(tela(3, 'juridico', { qual: 'entregas', n: 1 })); fireEvent.click(await screen.findByRole('button', { name: 'Recusar' }))
  const dialogo = screen.getByRole('dialog'); expect(dialogo).toHaveTextContent('arte.png'); expect(dialogo).toHaveTextContent('lição')
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' })); expect(api.post).not.toHaveBeenCalled(); expect(window.prompt).not.toHaveBeenCalled()
})

it('recusa sem motivo usa feedback nulo e não anuncia uma lição inexistente', async () => {
  render(tela(3, 'juridico', { qual: 'entregas', n: 1 })); fireEvent.click(await screen.findByRole('button', { name: 'Recusar' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Recusar entrega' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/entregas/71/rejeitar', { feedback: null }))
  expect(contexto.sucesso).toHaveBeenCalledWith('Entrega recusada.'); expect(contexto.sucesso).not.toHaveBeenCalledWith(expect.stringContaining('lição'))
})

it('resposta da produção anterior não reabre seu plano após escolher outro', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: /Produção A/ })); await screen.findByText('Plano a')
  fireEvent.click(screen.getByRole('button', { name: 'Pode gerar' })); await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/predios/3/juridico/estudio/pecas/a/gerar', { conversa_id: undefined }))
  fireEvent.click(screen.getByRole('button', { name: /Produção B/ })); await screen.findByText('Plano b')
  await act(async () => resolver({})); expect(screen.getByText('Plano b')).toBeInTheDocument(); expect(screen.queryByText('Plano a')).not.toBeInTheDocument()
})

it('troca de material conserva a subpasta e envia o caminho exato', async () => {
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: /Produção A/ })); await screen.findByText('Plano a'); fireEvent.click(screen.getByRole('button', { name: /Cena a/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Trocar material' }))
  fireEvent.click(await screen.findByRole('button', { name: 'campanha/jogo/foto.png' }))
  await waitFor(() => expect(api.patch).toHaveBeenCalledExactlyOnceWith('/predios/3/juridico/estudio/pecas/a/cenas/c1', { material: 'memoria/brand/acervo/campanha/jogo/foto.png' }))
})

it('anexo que termina em outra conversa fica recebido ao voltar à conversa original', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.postForm).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Conversa anterior' })); await screen.findByText('Texto da conversa anterior')
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem' }), { target: { value: 'Rascunho desta conversa' } })
  fireEvent.change(arquivoInput(view.container), { target: { files: [new File(['a'], 'recebido.pdf')] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Conversa escolhida' })); await screen.findByText('Texto da conversa escolhida')
  await act(async () => resolver({})); fireEvent.click(screen.getByRole('button', { name: 'Conversa anterior' })); await screen.findByText('Texto da conversa anterior')
  expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveValue('Rascunho desta conversa')
  expect(screen.getByRole('button', { name: 'Remover recebido.pdf' })).toBeEnabled()
})

it('envio aceito com falha ao reler histórico não devolve o pedido como se tivesse falhado', async () => {
  let leituras = 0
  vi.mocked(api.get).mockImplementation(url => url === '/conversas/41' && ++leituras > 1 ? Promise.reject(new Error('Falha de consulta')) : baseGet(url) as never)
  vi.mocked(api.post).mockResolvedValue({ mensagem: { id: 21, role: 'assistant', conteudo: 'Seu pedido foi recebido' } })
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Conversa anterior' })); await screen.findByText('Texto da conversa anterior')
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem' }), { target: { value: 'Pedido aceito' } }); fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled())
  expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveValue(''); expect(screen.getByRole('alert')).toHaveTextContent('atualizar a conversa')
  expect(screen.getByText('Seu pedido foi recebido')).toBeInTheDocument(); expect(api.post).toHaveBeenCalledTimes(1)
})

it('falha inicial nas entregas mostra opção para repetir sem afirmar que estão vazias', async () => {
  let leituras = 0
  vi.mocked(api.get).mockImplementation(url => url.endsWith('/entregas') && ++leituras === 1 ? Promise.reject(new Error('Sem conexão')) : baseGet(url) as never)
  render(tela(3, 'juridico', { qual: 'entregas', n: 1 }))
  const alerta = await screen.findByRole('alert'); expect(alerta).toHaveTextContent('carregar as entregas')
  fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByText('Arte aprovada para revisar')
  // A consulta da lista e o carregamento da prévia têm falhas independentes.
  // O ambiente de teste não precisa decodificar mídia para provar o retry.
  await waitFor(() => expect(alerta).not.toBeInTheDocument())
  expect(screen.queryByText(/carregar as entregas/)).not.toBeInTheDocument()
})

it('voltar à mesma peça não aceita o resultado de uma geração iniciada na seleção anterior', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: /Produção A/ })); await screen.findByText('Plano a')
  fireEvent.click(screen.getByRole('button', { name: 'Pode gerar' })); await waitFor(() => expect(api.post).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: /Produção B/ })); await screen.findByText('Plano b')
  fireEvent.click(screen.getByRole('button', { name: /Produção A/ })); await screen.findByText('Plano a')
  const leituras = vi.mocked(api.get).mock.calls.length
  await act(async () => resolver({}))
  expect(api.get).toHaveBeenCalledTimes(leituras); expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('soltar a tela durante o arrasto do painel restaura o cursor sem esperar um mouseup', async () => {
  const view = render(tela()); fireEvent.click(await screen.findByRole('button', { name: /Produção A/ })); await screen.findByText('Plano a')
  fireEvent.mouseDown(view.container.querySelector('.mesa-divisor')!)
  expect(document.body.style.cursor).toBe('col-resize')
  view.unmount(); expect(document.body.style.cursor).toBe(''); expect(document.body.style.userSelect).toBe('')
})

it('alteração de narração antiga não reabre a peça deixada para trás', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.patch).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  vi.mocked(api.get).mockImplementation(url => url.endsWith('/pecas/a/mesa') ? Promise.resolve({ ...plano('a'), narracao: { texto: 'Um texto', vozes: [{ nome: 'Locutor', pronta: true }] } }) as never : baseGet(url) as never)
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: /Produção A/ })); await screen.findByText('Plano a')
  fireEvent.click(screen.getByRole('button', { name: 'Sem narração' })); await waitFor(() => expect(api.patch).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: /Produção B/ })); await screen.findByText('Plano b')
  await act(async () => resolver({})); expect(screen.getByText('Plano b')).toBeInTheDocument(); expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('trocar login durante a confirmação cancela a intenção de excluir', async () => {
  const view = render(tela()); await screen.findByRole('button', { name: 'Conversa anterior' }); apagarAnterior(); expect(screen.getByRole('dialog')).toBeInTheDocument()
  contexto.sessao = 'conta-b'; view.rerender(tela())
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(api.del).not.toHaveBeenCalled()
})

it('falha de recusa conserva a entrega e permite repetir com o motivo exato', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error('Sem conexão'))
  render(tela(3, 'juridico', { qual: 'entregas', n: 1 })); fireEvent.click(await screen.findByRole('button', { name: 'Recusar' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Recusar entrega' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não deu para recusar')); expect(screen.getByText('Arte aprovada para revisar')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Recusar' })); const dialogo = screen.getByRole('dialog')
  fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Motivo (opcional)' }), { target: { value: 'Não usar texto sobre o rosto.' } })
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Recusar entrega' }))
  await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/entregas/71/rejeitar', { feedback: 'Não usar texto sobre o rosto.' }))
  expect(contexto.sucesso).toHaveBeenCalledWith('Recusada — o motivo virou lição.')
})

it('falha da lista de conversas oferece repetir sem falso estado de primeira conversa', async () => {
  let leituras = 0
  vi.mocked(api.get).mockImplementation(url => url.endsWith('/conversas') && ++leituras === 1 ? Promise.reject(new Error('Sem conexão')) : baseGet(url) as never)
  render(tela()); const alerta = await screen.findByRole('alert'); expect(alerta).toHaveTextContent('carregar as conversas')
  expect(screen.queryByText('A primeira conversa nasce quando você escrever.')).not.toBeInTheDocument()
  fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar novamente' })); await screen.findByRole('button', { name: 'Conversa anterior' })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('anexar e enviar enquanto nasce a conversa compartilham a criação e aguardam os anexos', async () => {
  let criar!: (value: unknown) => void, receber!: (value: unknown) => void
  vi.mocked(api.post).mockImplementation(url => url.endsWith('/conversas') ? new Promise(resolve => { criar = resolve }) as never : Promise.resolve({}) as never)
  vi.mocked(api.postForm).mockImplementationOnce(() => new Promise(resolve => { receber = resolve }))
  const view = render(tela()); fireEvent.change(arquivoInput(view.container), { target: { files: [new File(['a'], 'referencia.pdf')] } })
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem' }), { target: { value: 'Use este arquivo no trabalho' } }); fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  expect(api.post).toHaveBeenCalledTimes(1)
  await act(async () => criar({ id: 43 })); await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  expect(api.post).toHaveBeenCalledTimes(1)
  await act(async () => receber({})); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
  expect(api.post).toHaveBeenNthCalledWith(1, '/predios/3/juridico/conversas', {})
  expect(api.post).toHaveBeenNthCalledWith(2, '/conversas/43/mensagens', { conteudo: 'Use este arquivo no trabalho' })
})

it('lotes de anexos acionados separadamente continuam sequenciais na mesma conversa', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.postForm).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Conversa anterior' })); await screen.findByText('Texto da conversa anterior')
  fireEvent.change(arquivoInput(view.container), { target: { files: [new File(['a'], 'primeiro.pdf')] } }); await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  fireEvent.change(arquivoInput(view.container), { target: { files: [new File(['b'], 'segundo.pdf')] } }); await act(async () => {})
  expect(api.postForm).toHaveBeenCalledTimes(1)
  await act(async () => resolver({})); await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('button', { name: 'Remover primeiro.pdf' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Remover segundo.pdf' })).toBeEnabled()
})

it('falha ao criar gravador libera a trilha recebida do microfone sintético', async () => {
  const stop = vi.fn(); const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  vi.stubGlobal('MediaRecorder', class { constructor() { throw new Error('Codec indisponível') } })
  vi.mocked(api.get).mockImplementation(url => url.endsWith('/partida') ? Promise.resolve({ tem_motor: true, tem_chave: true, sabatina_pendente: false, voz_ditado: 'ligado' }) as never : baseGet(url) as never)
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Falar em vez de escrever' }))
  await waitFor(() => expect(stop).toHaveBeenCalledTimes(1)); expect(api.postForm).not.toHaveBeenCalled()
})

it('permissão tardia de microfone não inicia gravação depois de trocar de conversa', async () => {
  let resolver!: (value: unknown) => void
  const stop = vi.fn(); const gravador = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => new Promise(resolve => { resolver = resolve })) } })
  vi.stubGlobal('MediaRecorder', gravador)
  vi.mocked(api.get).mockImplementation(url => url.endsWith('/partida') ? Promise.resolve({ tem_motor: true, tem_chave: true, sabatina_pendente: false, voz_ditado: 'ligado' }) as never : baseGet(url) as never)
  render(tela()); fireEvent.click(await screen.findByRole('button', { name: 'Falar em vez de escrever' })); fireEvent.click(screen.getByRole('button', { name: 'Conversa escolhida' }))
  await screen.findByText('Texto da conversa escolhida'); await act(async () => resolver({ getTracks: () => [{ stop }] }))
  expect(stop).toHaveBeenCalledTimes(1); expect(gravador).not.toHaveBeenCalled(); expect(api.postForm).not.toHaveBeenCalled()
})

it.each([true, false])('[estado confirmado] aviso de saldo %s registra histórico e retomada condicional', async semSaldo => {
  vi.mocked(api.get).mockImplementation(url => url.endsWith('/partida') ? Promise.resolve({ tem_motor: true, tem_chave: true, sabatina_pendente: false, sem_saldo: semSaldo }) as never : baseGet(url) as never)
  render(tela())
  await screen.findByRole('button', { name: 'Conversa anterior' })
  if (semSaldo) {
    expect(await screen.findByText('Foi registrada uma falha por saldo ou cota da conexão de IA.')).toBeVisible()
    expect(screen.getByText(/A retomada automática pode ser tentada/)).toBeVisible()
    expect(screen.queryByText(/elas continuam de onde pararam, sozinhas/)).not.toBeInTheDocument()
  } else expect(screen.queryByText(/Foi registrada uma falha por saldo/)).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled(); expect(api.postForm).not.toHaveBeenCalled()
})
