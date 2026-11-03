import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BibliotecaProjetos from './BibliotecaProjetos'
import { api, API_V1, ApiError, baixarArquivo, setTokens } from '../../lib/api'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() }, baixarArquivo: vi.fn() }))
vi.mock('./ResultadoEntrega', () => ({ default: ({ entregaId }: { entregaId: number }) => <p data-testid={`previa-${entregaId}`}>Prévia da versão</p>, temResultadoVisivel: () => false }))
vi.mock('./AgendaTab', () => ({ AgendaTab: () => <p>Agenda da equipe</p> }))
const projeto = (id: number) => ({ id, nome: `Projeto ${id}`, office_slug: 'conteudo', objetivo: '', dados: {}, formatos: [], arquivado: false, versao: 1 })
const trabalho = { id: 35, office_slug: 'conteudo', criado_em: '2026-09-12T12:00:00Z', titulo: 'Campanha aprovada', projeto_id: 1, projeto_nome: 'Projeto 1', referencia_job_id: null, estado: 'aprovado', status: 'done', favorito: false, aprovado: true, arquivos: [], desatualizados: [] }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') ? Array.from({ length: 80 }, (_, i) => projeto(i + 1)) : path.endsWith('/padroes') ? [] : path.endsWith('/impacto') ? { versao: 1, itens: [] } : { itens: [trabalho], total: 1 })
  vi.mocked(api.put).mockResolvedValue({})
})
const montar = (orgId = 1) => render(<MemoryRouter><BibliotecaProjetos orgId={orgId} andares={[{ slug: 'conteudo', nome: 'Conteúdo' }]} pedirNaConversa={vi.fn()} /></MemoryRouter>)

it('consolidação sem arquivo mostra espera explícita, sem pedir material ou aprovação', async () => {
  const pendente = { ...trabalho, estado: 'em_producao', aprovado: false, finalizando: true }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? pendente : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [pendente], total: 1 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(await screen.findByText('Organizando arquivos')).toBeInTheDocument()
  expect(screen.getByText(/Os arquivos da entrega estão sendo organizados/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aprovar esta versão' })).not.toBeInTheDocument()
  expect(screen.queryByText('Precisa de você', { selector: '.biblioteca-estado' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('seleção individual e da página deixam o lote em consolidação fora da organização', async () => {
  const pendente = { ...trabalho, estado: 'em_producao', aprovado: false, finalizando: true }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [pendente], total: 1 })
  montar()
  expect(await screen.findByRole('checkbox', { name: 'Selecionar Campanha aprovada' })).toBeDisabled()
  fireEvent.click(screen.getByText('Organizar vários trabalhos'))
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar esta página' }))
  expect(screen.getByRole('checkbox', { name: 'Selecionar Campanha aprovada' })).not.toBeChecked()
  expect(screen.queryByRole('button', { name: 'Guardar 1 trabalhos' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

function bancadaAjusteSeguro(sufixo: string, orgId = 1, conversaOrigem?: number | null, conversaAtiva?: number) {
  localStorage.clear(); sessionStorage.clear(); setTokens(`ajuste-seguro-${sufixo}`, 'refresh-fixture')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Rede externa proibida nesta prova') }))
  const detalhe = { ...trabalho, ...(conversaOrigem !== undefined ? { conversa_id: conversaOrigem, conversa_office_slug: 'conteudo' } : {}), arquivos: [{ id: 92, nome: 'arte.png', mime: 'image/png', status: 'aprovada' }, { id: 93, nome: 'outra.png', mime: 'image/png', status: 'aprovada' }] }
  vi.mocked(api.get).mockImplementation(async path => path === '/auth/me' ? { id: 7 } : path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/biblioteca/36') ? { ...trabalho, id: 36, titulo: 'Nova versão confirmada', arquivos: [] } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  return render(<MemoryRouter initialEntries={[`/?trabalho=35&arquivo=92${conversaAtiva ? `&conversa=${conversaAtiva}` : ''}`]}><EnderecoBiblioteca /><BibliotecaProjetos orgId={orgId} conversaId={conversaAtiva} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
}
async function preencherAjusteSeguro() {
  const abrir = await screen.findByRole('button', { name: 'Pedir ajuste' })
  await act(async () => {})
  fireEvent.click(abrir)
  const campo = screen.getByRole('textbox', { name: 'O que você quer mudar?' })
  await waitFor(() => expect(campo).toBeEnabled())
  fireEvent.change(campo, { target: { value: 'Clareie só o fundo, preservando a pessoa.' } })
  return screen.getByRole('button', { name: 'Aplicar ajuste' }).closest('form')!
}
function idDoAjusteSeguro() { const chamadas = vi.mocked(api.post).mock.calls; return (chamadas[chamadas.length - 1][1] as { request_id: string }).request_id }
function recibosDeAjuste() { return Object.keys(localStorage).filter(k => k.startsWith('offiz:producao:')) }

it.each([123, null])('ajuste da Biblioteca conserva conversa original %s e usa a ativa só sem vínculo confirmado', async conversaOrigem => {
  bancadaAjusteSeguro(`conversa-original-${conversaOrigem}`, 1, conversaOrigem, 125)
  const form = await preencherAjusteSeguro()
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('conversa=125')
  vi.mocked(api.post).mockImplementation(() => new Promise(() => {}))
  fireEvent.submit(form)
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/orgs/1/biblioteca/35/ajustes', expect.objectContaining({
    entrega_id: 92, conversa_id: conversaOrigem ?? 125,
    request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
  }))
})

it('ajuste da conversa original conserva corpo e UUID na repetição após mudar o chat ativo', async () => {
  const { rerender } = bancadaAjusteSeguro('conversa-original-retry', 1, 123, 125)
  const form = await preencherAjusteSeguro()
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  fireEvent.submit(form)
  await screen.findByRole('alert')
  const original = vi.mocked(api.post).mock.calls[0][1]
  const requestId = idDoAjusteSeguro()
  expect(original).toEqual(expect.objectContaining({ conversa_id: 123 }))
  const antigoGet = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path, signal) => {
    if (path === `/orgs/1/biblioteca/35/ajustes/${requestId}`) throw new ApiError(404, 'Ainda não recebido')
    return antigoGet(path, signal)
  })
  rerender(<MemoryRouter><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} conversaId={126} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir envio' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reenviar pedido' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual(original)
  expect(idDoAjusteSeguro()).toBe(requestId)
})

const uuidAjusteAntigo = '11111111-1111-4111-8111-111111111111'
function guardarAjusteAntigo(requestId = uuidAjusteAntigo, conversaId: number | null = 17, arquivoId = 92, autorId = 7) {
  const chave = `offiz:producao:${API_V1}:${autorId}:/orgs/1:${JSON.stringify(['ajuste', 'conteudo', 35, arquivoId, conversaId])}:operacao:/orgs/1/biblioteca/35/ajustes:intencao:${requestId}`
  localStorage.setItem(chave, JSON.stringify({ versao: 1, request_id: requestId, criado_em: '2026-10-10T12:00:00Z' }))
  return chave
}

it('o primeiro clique no botão visível de ajuste não é apagado pela seleção inicial do arquivo', async () => {
  localStorage.clear(); sessionStorage.clear(); setTokens('ajuste-primeiro-clique', 'refresh-fixture')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Rede externa proibida nesta prova') }))
  guardarAjusteAntigo()
  let resolver!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async path => path === '/auth/me' ? { id: 7 }
    : path.endsWith('/biblioteca/35') ? new Promise(resolve => { resolver = resolve })
    : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  let clicou = false
  // Dispatch the real click when the button enters the DOM, before waiting
  // for passive effects. This also occurs with a fast click in the browser.
  const observer = new MutationObserver(() => {
    const botao = [...document.querySelectorAll('button')].find(el => el.textContent === 'Pedir ajuste' && !el.disabled)
    if (!botao || clicou) return
    clicou = true; botao.click(); observer.disconnect()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  try {
    render(<MemoryRouter initialEntries={['/?trabalho=35&arquivo=92']}><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
    resolver({ ...trabalho, arquivos: [{ id: 92, nome: 'arte.png', mime: 'image/png', status: 'aprovada' }] })
    await screen.findByRole('button', { name: 'Pedir ajuste' })
    await act(async () => {})
    expect(clicou).toBe(true)
    expect(screen.getByRole('button', { name: 'Pedir ajuste' })).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('button', { name: 'Conferir envio' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeDisabled()
    expect(api.post).not.toHaveBeenCalled()
  } finally { observer.disconnect() }
})

function prepararFormularioPadrao() {
  localStorage.clear(); sessionStorage.clear(); setTokens('form-padrao-A', 'refresh-sintetico')
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35')
    ? { ...trabalho, arquivos: [{ id: 90, nome: 'fixture.zip', mime: 'application/zip', status: 'aprovada' }] }
    : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
}
async function abrirFormularioPadrao() {
  fireEvent.click(await screen.findByRole('button', { name: 'Usar como padrão' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome do padrão' }), { target: { value: 'Padrão A' } })
  return screen.getByRole('button', { name: 'Guardar padrão' }).closest('form')!
}
function prometerCriacao() {
  let concluir!: (value: unknown) => void
  let recusar!: (reason: Error) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise((resolve, reject) => { concluir = resolve; recusar = reject }))
  return { concluir: (value: unknown) => concluir(value), recusar: (reason: Error) => recusar(reason) }
}
function prepararFormularioProjeto() {
  localStorage.clear(); sessionStorage.clear(); setTokens('form-projeto-A', 'refresh-sintetico')
  return montar()
}
function abrirFormularioProjeto() {
  fireEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome do projeto' }), { target: { value: 'Projeto A' } })
  return screen.getByRole('button', { name: 'Salvar projeto' }).closest('form')!
}

it('o ACK de guardar padrão conserva uma edição posterior no mesmo formulário', async () => {
  prepararFormularioPadrao(); const resposta = prometerCriacao()
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  const form = await abrirFormularioPadrao(); fireEvent.submit(form)
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome do padrão' }), { target: { value: 'Padrão B ainda não enviado' } })
  await act(async () => resposta.concluir({ id: 91 }))
  expect(screen.getByRole('textbox', { name: 'Nome do padrão' })).toHaveValue('Padrão B ainda não enviado')
  expect(screen.getByRole('button', { name: 'Guardar padrão' })).toBeEnabled()
  expect(screen.queryByText('Padrão guardado em Meus padrões.')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/orgs/1/padroes', expect.objectContaining({ nome: 'Padrão A' }))
})

it.each(['sucesso', 'falha'])('cancelar e reabrir um padrão conserva B depois da %s de A', async resultado => {
  prepararFormularioPadrao(); const resposta = prometerCriacao()
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.submit(await abrirFormularioPadrao())
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Usar como padrão' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome do padrão' }), { target: { value: 'Padrão B reaberto' } })
  await act(async () => resultado === 'sucesso' ? resposta.concluir({ id: 91 }) : resposta.recusar(new Error('Falha antiga de A')))
  expect(screen.getByRole('textbox', { name: 'Nome do padrão' })).toHaveValue('Padrão B reaberto')
  expect(screen.getByRole('button', { name: 'Guardar padrão' })).toBeEnabled()
  expect(screen.queryByText(/Falha antiga de A|Padrão guardado em Meus padrões/)).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each(['projeto', 'padrão'])('a sessão trocada antes do envio de %s não envia o rascunho da conta anterior', async tipo => {
  if (tipo === 'projeto') prepararFormularioProjeto()
  else { prepararFormularioPadrao(); render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>) }
  const form = tipo === 'projeto' ? abrirFormularioProjeto() : await abrirFormularioPadrao()
  setTokens('form-nova-conta-B', 'refresh-sintetico-B')
  fireEvent.submit(form)
  expect(api.post).not.toHaveBeenCalled()
  expect(await screen.findByText(/Sua conta mudou/)).toBeInTheDocument()
})

it('o projeto enviado usa um snapshot e não fecha a edição posterior ao ACK', async () => {
  prepararFormularioProjeto(); const resposta = prometerCriacao(); const form = abrirFormularioProjeto()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Imagem' })); fireEvent.submit(form)
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome do projeto' }), { target: { value: 'Projeto B ainda não enviado' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Vídeo' }))
  await act(async () => resposta.concluir({ ...projeto(81), nome: 'Projeto A' }))
  expect(screen.getByRole('textbox', { name: 'Nome do projeto' })).toHaveValue('Projeto B ainda não enviado')
  expect(screen.getByRole('button', { name: 'Salvar projeto' })).toBeEnabled()
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/orgs/1/projetos', expect.objectContaining({ nome: 'Projeto A', formatos: ['imagem'] }))
})

it('a falha de salvar projeto A não ocupa nem mostra erro no formulário B reaberto', async () => {
  prepararFormularioProjeto(); const resposta = prometerCriacao(); fireEvent.submit(abrirFormularioProjeto())
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })); abrirFormularioProjeto()
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome do projeto' }), { target: { value: 'Projeto B reaberto' } })
  await act(async () => resposta.recusar(new Error('Erro de A encerrado')))
  expect(screen.getByRole('textbox', { name: 'Nome do projeto' })).toHaveValue('Projeto B reaberto')
  expect(screen.getByRole('button', { name: 'Salvar projeto' })).toBeEnabled()
  expect(screen.queryByText(/Erro de A encerrado/)).not.toBeInTheDocument()
})

it.each(['projeto', 'padrão'])('o ACK de %s recebido depois de trocar a sessão não altera o formulário atual', async tipo => {
  if (tipo === 'projeto') prepararFormularioProjeto()
  else { prepararFormularioPadrao(); render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>) }
  const resposta = prometerCriacao(); const form = tipo === 'projeto' ? abrirFormularioProjeto() : await abrirFormularioPadrao()
  fireEvent.submit(form); setTokens('form-ACK-conta-B', 'refresh-sintetico-B')
  await act(async () => resposta.concluir(tipo === 'projeto' ? projeto(81) : { id: 91 }))
  expect(screen.getByRole('textbox', { name: tipo === 'projeto' ? 'Nome do projeto' : 'Nome do padrão' })).toHaveValue(tipo === 'projeto' ? 'Projeto A' : 'Padrão A')
  expect(screen.queryByText('Padrão guardado em Meus padrões.')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('trocar empresa com padrão A em voo conserva o formulário B e não anuncia A', async () => {
  prepararFormularioPadrao(); const resposta = prometerCriacao()
  const view = render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.submit(await abrirFormularioPadrao())
  view.rerender(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={2} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await abrirFormularioPadrao(); fireEvent.change(screen.getByRole('textbox', { name: 'Nome do padrão' }), { target: { value: 'Empresa B' } })
  await act(async () => resposta.concluir({ id: 91 }))
  expect(screen.getByRole('textbox', { name: 'Nome do padrão' })).toHaveValue('Empresa B')
  expect(screen.getByRole('button', { name: 'Guardar padrão' })).toBeEnabled()
  expect(screen.queryByText('Padrão guardado em Meus padrões.')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/orgs/1/padroes', expect.anything())
})

it.each(['projeto', 'padrão'])('a resposta perdida de %s orienta conferir registros e não repete POST', async tipo => {
  if (tipo === 'projeto') prepararFormularioProjeto()
  else { prepararFormularioPadrao(); render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>) }
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(0, 'Resposta perdida'))
  fireEvent.submit(tipo === 'projeto' ? abrirFormularioProjeto() : await abrirFormularioPadrao())
  await screen.findByText(/Antes de tentar novamente, confira/)
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(screen.queryByText(/nada foi salvo/i)).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: tipo === 'projeto' ? 'Nome do projeto' : 'Nome do padrão' })).toHaveValue(tipo === 'projeto' ? 'Projeto A' : 'Padrão A')
})

it.each(['projeto', 'padrão'])('StrictMode e dois submits DOM de %s em voo continuam com um POST', async tipo => {
  localStorage.clear(); sessionStorage.clear(); setTokens('form-strict-A', 'refresh-sintetico')
  if (tipo === 'padrão') prepararFormularioPadrao()
  const resposta = prometerCriacao()
  render(<StrictMode><MemoryRouter initialEntries={[tipo === 'padrão' ? '/?trabalho=35' : '/']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter></StrictMode>)
  const form = tipo === 'projeto' ? abrirFormularioProjeto() : await abrirFormularioPadrao()
  fireEvent.submit(form); fireEvent.submit(form); expect(api.post).toHaveBeenCalledTimes(1)
  await act(async () => resposta.concluir(tipo === 'projeto' ? projeto(81) : { id: 91 }))
  expect(screen.queryByRole('textbox', { name: tipo === 'projeto' ? 'Nome do projeto' : 'Nome do padrão' })).not.toBeInTheDocument()
})

it.each(['projeto', 'padrão'])('a resposta HTTP 408 de %s orienta conferir o salvamento incerto', async tipo => {
  if (tipo === 'projeto') prepararFormularioProjeto()
  else { prepararFormularioPadrao(); render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>) }
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(408, 'Tempo de resposta esgotado'))
  fireEvent.submit(tipo === 'projeto' ? abrirFormularioProjeto() : await abrirFormularioPadrao())
  await screen.findByText(/Antes de tentar novamente, confira/)
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(screen.queryByText(/nada foi salvo/i)).not.toBeInTheDocument()
})

it.each(['projeto', 'padrão'])('o ACK vazio de %s não confirma salvamento nem fecha o rascunho', async tipo => {
  if (tipo === 'projeto') prepararFormularioProjeto()
  else { prepararFormularioPadrao(); render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>) }
  vi.mocked(api.post).mockResolvedValueOnce({})
  fireEvent.submit(tipo === 'projeto' ? abrirFormularioProjeto() : await abrirFormularioPadrao())
  await screen.findByText(/Antes de tentar novamente, confira/)
  expect(screen.getByRole('textbox', { name: tipo === 'projeto' ? 'Nome do projeto' : 'Nome do padrão' })).toHaveValue(tipo === 'projeto' ? 'Projeto A' : 'Padrão A')
  expect(screen.queryByText('Padrão guardado em Meus padrões.')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each([1, 2])('editar projeto 1 aceita somente ACK do projeto enviado, ID recebido %s', async id => {
  localStorage.clear(); sessionStorage.clear(); setTokens('form-edicao-A', 'refresh-sintetico')
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') ? [projeto(1)] : path.endsWith('/padroes') ? [] : path.endsWith('/impacto') ? { versao: 1, itens: [] } : { itens: [], total: 0 })
  vi.mocked(api.put).mockResolvedValueOnce({ ...projeto(id), nome: 'Projeto 1 editado' })
  render(<MemoryRouter initialEntries={['/?projeto=1']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Organizar projeto' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome do projeto' }), { target: { value: 'Projeto 1 editado' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar projeto' }))
  await act(async () => {})
  expect(api.put).toHaveBeenCalledExactlyOnceWith('/orgs/1/projetos/1', expect.objectContaining({ nome: 'Projeto 1 editado', versao: 1 }))
  if (id === 1) expect(screen.queryByRole('textbox', { name: 'Nome do projeto' })).not.toBeInTheDocument()
  else { expect(screen.getByRole('textbox', { name: 'Nome do projeto' })).toHaveValue('Projeto 1 editado'); expect(screen.getByRole('alert')).toHaveTextContent('Antes de tentar novamente, confira') }
})

it('o conflito HTTP 409 de projeto conserva a explicação específica e o rascunho', async () => {
  prepararFormularioProjeto(); vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, 'Versão do projeto mudou'))
  fireEvent.submit(abrirFormularioProjeto())
  expect(await screen.findByRole('alert')).toHaveTextContent('Versão do projeto mudou')
  expect(screen.queryByText(/Antes de tentar novamente, confira/)).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Nome do projeto' })).toHaveValue('Projeto A')
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('recupera o ajuste antigo com conversa 17 mesmo quando o histórico da conversa ainda não foi confirmado', async () => {
  bancadaAjusteSeguro('historico-pendente')
  const chave = guardarAjusteAntigo()
  fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste' }))
  const conferir = await screen.findByRole('button', { name: 'Conferir envio' })
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/ajustes/'))).toBe(false)
  const antigoGet = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path, signal) => path === `/orgs/1/biblioteca/35/ajustes/${uuidAjusteAntigo}` ? { job_id: 36, comentario_id: 81, office_slug: 'conteudo', request_id: uuidAjusteAntigo, replayed: true } : antigoGet(path, signal))
  fireEvent.click(conferir)
  await screen.findByRole('heading', { name: 'Nova versão confirmada' })
  expect(api.get).toHaveBeenCalledWith(`/orgs/1/biblioteca/35/ajustes/${uuidAjusteAntigo}`)
  expect(localStorage.getItem(chave)).toBeNull()
  expect(api.post).not.toHaveBeenCalled()
})

it('a conversa transitória não separa um envio incerto nem apaga seu rascunho', async () => {
  const { rerender } = bancadaAjusteSeguro('conversa-transitoria')
  rerender(<MemoryRouter initialEntries={['/?trabalho=35&arquivo=92&conversa=17']}><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} conversaId={17} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  const form = await preencherAjusteSeguro()
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  fireEvent.submit(form)
  await screen.findByRole('alert')
  const requestId = idDoAjusteSeguro()
  rerender(<MemoryRouter initialEntries={['/?trabalho=35&arquivo=92&conversa=17']}><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} conversaId={null} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(await screen.findByRole('button', { name: 'Conferir envio' })).toBeEnabled()
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toHaveValue('Clareie só o fundo, preservando a pessoa.')
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeDisabled()
  expect(recibosDeAjuste()).toHaveLength(1)
  expect(localStorage.getItem(recibosDeAjuste()[0])).toContain(requestId)
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/orgs/1/biblioteca/35/ajustes', expect.objectContaining({ conversa_id: 17, request_id: requestId }))
})

it('a repetição de um ajuste não muda seu vínculo original quando a conversa passa de 17 para desconhecida', async () => {
  const { rerender } = bancadaAjusteSeguro('conversa-retry')
  const tela = (conversaId: number | null) => <MemoryRouter initialEntries={['/?trabalho=35&arquivo=92&conversa=17']}><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} conversaId={conversaId} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>
  rerender(tela(17))
  const form = await preencherAjusteSeguro()
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  fireEvent.submit(form)
  await screen.findByRole('alert')
  const requestId = idDoAjusteSeguro()
  const original = vi.mocked(api.post).mock.calls[0][1]
  const antigoGet = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path, signal) => {
    if (path === `/orgs/1/biblioteca/35/ajustes/${requestId}`) throw new ApiError(404, 'Ainda não recebido')
    return antigoGet(path, signal)
  })
  rerender(tela(null))
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir envio' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reenviar pedido' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual(original)
  expect(idDoAjusteSeguro()).toBe(requestId)
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar outro pedido' }))
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar ajuste' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3))
  expect(idDoAjusteSeguro()).not.toBe(requestId)
  expect(vi.mocked(api.post).mock.calls[2][1]).toEqual(expect.objectContaining({ conversa_id: null }))
  expect(recibosDeAjuste()).toHaveLength(2)
})

it('arquivos com nomes iguais descobrem somente o recibo da entrega selecionada e ignoram seu GET tardio', async () => {
  bancadaAjusteSeguro('homonimos')
  const chave = guardarAjusteAntigo()
  const antigoGet = vi.mocked(api.get).getMockImplementation()!
  let concluir!: (v: unknown) => void
  vi.mocked(api.get).mockImplementation(async (path, signal) => {
    if (path === '/orgs/1/biblioteca/35') return { ...trabalho, arquivos: [92, 93].map(id => ({ id, nome: 'arte.png', mime: 'image/png', status: 'aprovada' })) }
    if (path === `/orgs/1/biblioteca/35/ajustes/${uuidAjusteAntigo}`) return new Promise(resolve => { concluir = resolve })
    return antigoGet(path, signal)
  })
  await screen.findByRole('button', { name: 'Pedir ajuste' })
  act(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'arte.png' })).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir envio' }))
  await waitFor(() => expect(concluir).toBeTypeOf('function'))
  fireEvent.click(screen.getAllByRole('button', { name: 'arte.png' })[1])
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeEnabled())
  const campo = screen.getByRole('textbox', { name: 'O que você quer mudar?' })
  fireEvent.change(campo, { target: { value: 'Pedido independente para o segundo arquivo.' } })
  await act(async () => concluir({ job_id: 36, comentario_id: 81, office_slug: 'conteudo', request_id: uuidAjusteAntigo, replayed: true }))
  expect(screen.getByText('Entrega #93 · arte.png')).toBeInTheDocument()
  expect(campo).toHaveValue('Pedido independente para o segundo arquivo.')
  expect(localStorage.getItem(chave)).toContain(uuidAjusteAntigo)
  expect(screen.queryByRole('button', { name: 'Conferir envio' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Nova versão confirmada' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('vários recibos antigos do mesmo arquivo exigem escolha e recuperam apenas a intenção escolhida', async () => {
  bancadaAjusteSeguro('varios-antigos')
  const primeiro = guardarAjusteAntigo()
  const requestId = '22222222-2222-4222-8222-222222222222'
  const segundo = guardarAjusteAntigo(requestId, null)
  fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste' }))
  fireEvent.click(await screen.findByRole('button', { name: /Selecionar envio 2/ }))
  expect(api.post).not.toHaveBeenCalled()
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/ajustes/'))).toBe(false)
  const antigoGet = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path, signal) => path === `/orgs/1/biblioteca/35/ajustes/${requestId}` ? { job_id: 36, comentario_id: 82, office_slug: 'conteudo', request_id: requestId, replayed: true } : antigoGet(path, signal))
  fireEvent.click(screen.getByRole('button', { name: 'Conferir envio' }))
  await screen.findByRole('heading', { name: 'Nova versão confirmada' })
  expect(localStorage.getItem(primeiro)).toContain(uuidAjusteAntigo)
  expect(localStorage.getItem(segundo)).toBeNull()
  expect(api.get).toHaveBeenCalledWith(`/orgs/1/biblioteca/35/ajustes/${requestId}`)
  expect(api.post).not.toHaveBeenCalled()
})

it.each([
  ['outro autor', 7, ['ajuste', 'conteudo', 35, 92, 17], API_V1, '/orgs/1', '/orgs/1/biblioteca/35/ajustes', 8],
  ['outra API', 7, ['ajuste', 'conteudo', 35, 92, 17], `${API_V1}/outra`, '/orgs/1', '/orgs/1/biblioteca/35/ajustes', 7],
  ['outra empresa', 7, ['ajuste', 'conteudo', 35, 92, 17], API_V1, '/orgs/2', '/orgs/2/biblioteca/35/ajustes', 7],
  ['outra área', 7, ['ajuste', 'financeiro', 35, 92, 17], API_V1, '/orgs/1', '/orgs/1/biblioteca/35/ajustes', 7],
  ['outro pedido', 7, ['ajuste', 'conteudo', 36, 92, 17], API_V1, '/orgs/1', '/orgs/1/biblioteca/35/ajustes', 7],
  ['outro arquivo', 7, ['ajuste', 'conteudo', 35, 93, 17], API_V1, '/orgs/1', '/orgs/1/biblioteca/35/ajustes', 7],
  ['outra operação', 7, ['ajuste', 'conteudo', 35, 92, 17], API_V1, '/orgs/1', '/orgs/1/biblioteca/36/ajustes', 7],
  ['conversa malformada', 7, ['ajuste', 'conteudo', 35, 92, '17'], API_V1, '/orgs/1', '/orgs/1/biblioteca/35/ajustes', 7],
] as const)('não descobre recibo de %s pelo endereço de conversa', async (_nome, autorSalvo, alvo, apiSalva, baseSalva, rotaSalva, autorAtual) => {
  bancadaAjusteSeguro(`isolamento-${_nome}`)
  const chave = `offiz:producao:${apiSalva}:${autorSalvo}:${baseSalva}:${JSON.stringify(alvo)}:operacao:${rotaSalva}:intencao:${uuidAjusteAntigo}`
  localStorage.setItem(chave, JSON.stringify({ versao: 1, request_id: uuidAjusteAntigo }))
  const antigoGet = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path, signal) => path === '/auth/me' ? { id: autorAtual } : antigoGet(path, signal))
  fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeEnabled())
  expect(screen.queryByRole('button', { name: 'Conferir envio' })).not.toBeInTheDocument()
  expect(localStorage.getItem(chave)).toContain(uuidAjusteAntigo)
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/ajustes/'))).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it('dois submits de ajuste no mesmo turno iniciam uma única intenção durável', async () => {
  bancadaAjusteSeguro('burst')
  const form = await preencherAjusteSeguro()
  vi.mocked(api.post).mockImplementation(() => new Promise(() => {}))
  act(() => { fireEvent.submit(form); fireEvent.submit(form) })
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(idDoAjusteSeguro()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeDisabled()
  expect(recibosDeAjuste()).toHaveLength(1)
})
afterEach(() => vi.unstubAllGlobals())

it('resposta de ajuste perdida exige consulta e recupera o mesmo trabalho sem repetir produção', async () => {
  bancadaAjusteSeguro('resposta-perdida')
  const form = await preencherAjusteSeguro()
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  fireEvent.submit(form)
  expect(await screen.findByRole('alert')).toHaveTextContent(/Confira sua situação/)
  const requestId = idDoAjusteSeguro()
  expect(requestId).toBeTypeOf('string')
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeDisabled()
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toHaveValue('Clareie só o fundo, preservando a pessoa.')
  const antigoGet = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path, signal) => path === `/orgs/1/biblioteca/35/ajustes/${requestId}` ? { job_id: 36, comentario_id: 81, office_slug: 'conteudo', request_id: requestId, replayed: true } : antigoGet(path, signal))
  fireEvent.click(screen.getByRole('button', { name: 'Conferir envio' }))
  await screen.findByRole('heading', { name: 'Nova versão confirmada' })
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(api.get).toHaveBeenCalledWith(`/orgs/1/biblioteca/35/ajustes/${requestId}`)
  expect(fetch).not.toHaveBeenCalled()
})

it('fechar e reabrir ajuste incerto mantém só UUID e recupera com rascunho vazio', async () => {
  bancadaAjusteSeguro('reabrir')
  const form = await preencherAjusteSeguro()
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  fireEvent.submit(form)
  await screen.findByRole('alert')
  const requestId = idDoAjusteSeguro()
  expect(recibosDeAjuste()).toHaveLength(1)
  const recibo = JSON.parse(localStorage.getItem(recibosDeAjuste()[0])!)
  expect(recibo).toEqual({ versao: 1, request_id: requestId, criado_em: expect.any(String) })
  expect(JSON.stringify(recibo)).not.toContain('Clareie')
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  const conferir = await screen.findByRole('button', { name: 'Conferir envio' })
  expect(conferir).toHaveAttribute('type', 'button')
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toHaveValue('')
  const antigoGet = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path, signal) => path === `/orgs/1/biblioteca/35/ajustes/${requestId}` ? { job_id: 36, comentario_id: 81, office_slug: 'conteudo', request_id: requestId, replayed: true } : antigoGet(path, signal))
  fireEvent.click(conferir)
  await screen.findByRole('heading', { name: 'Nova versão confirmada' })
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('consulta de ajuste ainda ausente reenvia com o mesmo UUID e nunca troca de intenção automaticamente', async () => {
  bancadaAjusteSeguro('ausente')
  const form = await preencherAjusteSeguro()
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  fireEvent.submit(form)
  await screen.findByRole('alert')
  const requestId = idDoAjusteSeguro()
  const antigoGet = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path, signal) => {
    if (path === `/orgs/1/biblioteca/35/ajustes/${requestId}`) throw new ApiError(404, 'Ainda não recebido')
    return antigoGet(path, signal)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Conferir envio' }))
  const reenviar = await screen.findByRole('button', { name: 'Reenviar pedido' })
  vi.mocked(api.post).mockImplementation(async (_path, body) => ({ job_id: 36, comentario_id: 81, office_slug: 'conteudo', request_id: (body as { request_id: string }).request_id, replayed: true }))
  fireEvent.click(reenviar)
  await screen.findByRole('heading', { name: 'Nova versão confirmada' })
  expect(api.post).toHaveBeenCalledTimes(2)
  expect(vi.mocked(api.post).mock.calls.map(([, body]) => (body as { request_id: string }).request_id)).toEqual([requestId, requestId])
})

it('ajuste removido exige intenção nova explícita e preserva o rascunho sem recriar o trabalho', async () => {
  bancadaAjusteSeguro('removido')
  const form = await preencherAjusteSeguro()
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  fireEvent.submit(form)
  await screen.findByRole('alert')
  const requestId = idDoAjusteSeguro()
  const antigoGet = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path, signal) => {
    if (path === `/orgs/1/biblioteca/35/ajustes/${requestId}`) throw new ApiError(410, 'Trabalho excluído')
    return antigoGet(path, signal)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Conferir envio' }))
  await screen.findByRole('button', { name: 'Preparar um novo pedido' })
  expect(screen.getByRole('alert')).toHaveTextContent('não será recriado')
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Preparar um novo pedido' }))
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toHaveValue('Clareie só o fundo, preservando a pessoa.')
  vi.mocked(api.post).mockImplementation(async (_path, body) => ({ job_id: 36, comentario_id: 82, office_slug: 'conteudo', request_id: (body as { request_id: string }).request_id, replayed: false }))
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar ajuste' }))
  await screen.findByRole('heading', { name: 'Nova versão confirmada' })
  expect(idDoAjusteSeguro()).not.toBe(requestId)
  expect(api.post).toHaveBeenCalledTimes(2)
})

it('trocar de arquivo mantém o recibo incerto associado à entrega anterior', async () => {
  bancadaAjusteSeguro('arquivo')
  const form = await preencherAjusteSeguro()
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  fireEvent.submit(form)
  await screen.findByRole('alert')
  const requestId = idDoAjusteSeguro()
  fireEvent.click(screen.getByRole('button', { name: 'outra.png' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeEnabled())
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toHaveValue('')
  expect(screen.queryByRole('button', { name: 'Conferir envio' })).not.toBeInTheDocument()
  expect(recibosDeAjuste()).toHaveLength(1)
  expect(localStorage.getItem(recibosDeAjuste()[0])).toContain(requestId)
  fireEvent.click(screen.getByRole('button', { name: 'arte.png' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  await screen.findByRole('button', { name: 'Conferir envio' })
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/ajustes/'))).toBe(false)
})
function EnderecoBiblioteca() { return <output aria-label="Endereço da biblioteca">{useLocation().search}</output> }
function VoltarNoHistorico() { const navegar = useNavigate(); return <button onClick={() => navegar(-1)}>Voltar no histórico</button> }
function OutroPedido() { const navegar = useNavigate(); return <button onClick={() => navegar('/?trabalho=36&arquivo=94')}>Abrir outro pedido da prova</button> }

it('o link da conversa abre o arquivo exato e a seleção acompanha voltar no histórico', async () => {
  const arquivos = [
    { id: 91, nome: 'post.html', mime: 'text/html', status: 'aprovada', editorial_peca_id: 1 },
    { id: 92, nome: 'arte.png', mime: 'image/png', status: 'aprovada', editorial_peca_id: 1 },
    { id: 93, nome: 'post.html', mime: 'text/html', status: 'aprovada', editorial_peca_id: 2 },
    { id: 94, nome: 'arte.png', mime: 'image/png', status: 'aprovada', editorial_peca_id: 2 },
  ]
  const pecas_editoriais = [1, 2].map(id => ({ id, titulo: `Tema ${id}`, revisao_id: id, legendas: [], aprovada: true, pendencias: [] }))
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, arquivos, pecas_editoriais } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35&arquivo=93&filtro-pedidos=favoritos']}><VoltarNoHistorico /><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(await screen.findByText('Entrega #93 · post.html')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tema 1' }))
  expect(screen.getByText('Entrega #92 · arte.png')).toBeInTheDocument()
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('arquivo=92')
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('filtro-pedidos=favoritos')
  fireEvent.click(screen.getByRole('button', { name: 'Voltar no histórico' }))
  expect(await screen.findByText('Entrega #93 · post.html')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledWith('/entregas/93/download', 'post.html'))
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['999', '-1', '9007199254740992'])('não busca um arquivo externo ou inválido do link %s e mantém os arquivos disponíveis', async id => {
  const arquivos = [{ id: 92, nome: 'arte.png', mime: 'image/png', status: 'aprovada' }]
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, arquivos } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={[`/?trabalho=35&arquivo=${id}`]}><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(await screen.findByText(/O arquivo deste link não está disponível nesta entrega/)).toHaveAttribute('role', 'status')
  expect(screen.queryByText('Entrega #92 · arte.png')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'arte.png' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByRole('button', { name: 'Baixar arquivo' })).not.toBeInTheDocument()
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/entregas/'))).toBe(false)
  expect(screen.queryByRole('button', { name: 'Baixar todos os arquivos' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Voltar à biblioteca/ }))
  expect(screen.getByLabelText('Endereço da biblioteca')).not.toHaveTextContent('arquivo=')
  expect(api.post).not.toHaveBeenCalled()
})

it('resultado abre o arquivo exato utilizado no lote e mantém o contexto do endereço', async () => {
  const arquivos = [{ id: 92, nome: 'primeira-arte.png', mime: 'image/png', status: 'aprovada' }, { id: 93, nome: 'segunda-arte.png', mime: 'image/png', status: 'aprovada' }]
  const resultado = { id: 9, entrega_id: 93, job_id: 35, trabalho: trabalho.titulo, arquivo: 'segunda-arte.png', metrica: 'salvamentos', valor: '42', fonte: 'Relatório sintético', inicio: '2026-10-01', fim: '2026-10-08' }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, arquivos } : path.includes('/resultados?') ? { itens: [resultado], total: 1 } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?org=1&vista=biblioteca&conversa=109&projeto=1&filtro-pedidos=favoritos&biblioteca-aba=resultados']}><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver a versão utilizada' }))
  expect(await screen.findByText('Entrega #93 · segunda-arte.png')).toBeInTheDocument()
  const endereco = screen.getByLabelText('Endereço da biblioteca')
  for (const parametro of ['trabalho=35', 'arquivo=93', 'org=1', 'conversa=109', 'projeto=1', 'filtro-pedidos=favoritos']) expect(endereco).toHaveTextContent(parametro)
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledWith('/entregas/93/download', 'segunda-arte.png'))
  expect(api.post).not.toHaveBeenCalled()
})

it('arquivo utilizado ausente não seleciona outro do lote; a escolha manual é explícita', async () => {
  const arquivos = [{ id: 92, nome: 'primeira-arte.png', mime: 'image/png', status: 'aprovada' }]
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, arquivos } : path.includes('/resultados?') ? { itens: [{ id: 9, entrega_id: 93, job_id: 35, trabalho: trabalho.titulo, arquivo: 'segunda-arte.png', metrica: 'salvamentos', valor: '42', fonte: 'Relatório', inicio: '2026-10-01', fim: '2026-10-08' }], total: 1 } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?org=1&biblioteca-aba=resultados']}><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver a versão utilizada' }))
  expect(await screen.findByText(/O arquivo deste link não está disponível/)).toBeInTheDocument()
  expect(screen.queryByText('Entrega #92 · primeira-arte.png')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Pedir ajuste' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('arquivo=93')
  fireEvent.click(screen.getByRole('button', { name: 'primeira-arte.png' }))
  expect(screen.getByText('Entrega #92 · primeira-arte.png')).toBeInTheDocument()
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('arquivo=92')
  expect(screen.queryByText(/O arquivo deste link não está disponível/)).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('arquivo explícito removido após abrir fecha o ajuste sem selecionar outra peça', async () => {
  let arquivos = [{ id: 92, nome: 'primeira-arte.png', mime: 'image/png', status: 'aprovada' }, { id: 93, nome: 'segunda-arte.png', mime: 'image/png', status: 'aprovada' }]
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, arquivos } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35&arquivo=93']}><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'O que você quer mudar?' }), { target: { value: 'Comentário reservado à segunda arte.' } })
  arquivos = arquivos.filter(a => a.id !== 93)
  act(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
  expect(await screen.findByText(/O arquivo deste link não está disponível/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aplicar ajuste' })).not.toBeInTheDocument()
  expect(screen.queryByText('Entrega #92 · primeira-arte.png')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('arquivo=93')
  fireEvent.click(screen.getByRole('button', { name: 'primeira-arte.png' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toHaveValue('')
  expect(api.post).not.toHaveBeenCalled()
})

it('outro pedido e arquivo não herdam o ajuste ou uma atualização tardia do alvo anterior', async () => {
  const anterior = { ...trabalho, arquivos: [{ id: 93, nome: 'anterior.pdf', status: 'aprovada' }] }
  const proximo = { ...trabalho, id: 36, arquivos: [{ id: 94, nome: 'proximo.pdf', status: 'aprovada' }] }
  let atrasar = false
  let resolver!: (value: typeof anterior) => void
  let sinal!: AbortSignal
  vi.mocked(api.get).mockImplementation((path, signal) => path.endsWith('/biblioteca/35') ? atrasar ? new Promise(resolve => { resolver = resolve; sinal = signal! }) : Promise.resolve(anterior) : path.endsWith('/biblioteca/36') ? Promise.resolve(proximo) : Promise.resolve(path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 }))
  render(<MemoryRouter initialEntries={['/?trabalho=35&arquivo=93']}><OutroPedido /><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'O que você quer mudar?' }), { target: { value: 'Ajuste apenas do pedido anterior.' } })
  atrasar = true
  act(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
  fireEvent.click(screen.getByRole('button', { name: 'Abrir outro pedido da prova' }))
  expect(await screen.findByText('Entrega #94 · proximo.pdf')).toBeInTheDocument()
  expect(sinal.aborted).toBe(true)
  await act(async () => resolver(anterior))
  expect(screen.queryByText('Entrega #93 · anterior.pdf')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aplicar ajuste' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toHaveValue('')
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['empresa', 'conta', 'área'] as const)('mudança de %s revalida o arquivo e descarta prévia/ajuste e resposta antiga', async contexto => {
  setTokens('autor-sintetico-anterior', 'refresh-anterior')
  const anterior = { ...trabalho, arquivos: [{ id: 93, nome: 'anterior.pdf', status: 'aprovada' }] }
  let atrasar = false
  let novoContexto = false
  let resolver!: (value: typeof anterior) => void
  let sinal!: AbortSignal
  vi.mocked(api.get).mockImplementation((path, signal) => {
    if (path.endsWith('/biblioteca/35')) {
      if (novoContexto) return contexto === 'área' ? Promise.resolve(anterior) : Promise.reject(new ApiError(404, 'Este pedido não está disponível nesta conta.'))
      if (atrasar) return new Promise(resolve => { resolver = resolve; sinal = signal! })
      return Promise.resolve(anterior)
    }
    return Promise.resolve(path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  })
  const montarContexto = (orgId = 1, areaSlug = 'conteudo') => <MemoryRouter initialEntries={['/?trabalho=35&arquivo=93']}><BibliotecaProjetos orgId={orgId} areaSlug={areaSlug} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>
  const view = render(montarContexto())
  fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'O que você quer mudar?' }), { target: { value: 'Texto exclusivo da conta/área anterior.' } })
  atrasar = true
  act(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
  novoContexto = true
  if (contexto === 'conta') act(() => setTokens('autor-sintetico-atual', 'refresh-atual'))
  view.rerender(montarContexto(contexto === 'empresa' ? 2 : 1, contexto === 'área' ? 'financeiro' : 'conteudo'))
  await screen.findByText(contexto === 'área' ? /Este trabalho pertence a outra área/ : 'Este pedido não está disponível nesta conta.')
  expect(sinal.aborted).toBe(true)
  await act(async () => resolver(anterior))
  expect(screen.queryByText('Entrega #93 · anterior.pdf')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aplicar ajuste' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Baixar arquivo' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('um post simples começa pela arte e mantém a leitura do HTML como escolha explícita', async () => {
  const arquivos = [{ id: 91, nome: 'post.html', status: 'aprovada' }, { id: 92, nome: 'arte.png', mime: 'image/png', status: 'aprovada' }]
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, arquivos } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(await screen.findByText('Entrega #92 · arte.png')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'post.html' }))
  expect(screen.getByText('Entrega #91 · post.html')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Baixar todos os arquivos' })).toBeInTheDocument()
})

it.each([
  [{ job_id: 35 }, 'Versão aprovada. A proposta foi aplicada à configuração.'],
  [null, 'Versão aprovada. A aplicação à configuração não foi confirmada; a equipe Offiz precisa verificar a proposta.'],
])('aprovação de configuração explica o efeito e informa somente a aplicação confirmada %j', async (conhecimento_aplicado, mensagem) => {
  let detalhe = { ...trabalho, aprovado: false, origem: 'conhecimento', qualidade: { estado: 'conferida', avisos: [], conferencias: [] }, arquivos: [{ id: 92, nome: 'proposta.pdf', status: 'pendente' }] }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  vi.mocked(api.post).mockImplementationOnce(async () => {
    detalhe = { ...detalhe, aprovado: true, arquivos: [{ id: 92, nome: 'proposta.pdf', status: 'aprovada' }] }
    return { ok: true, aprovadas: [92], conhecimento_aplicado }
  })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar e aplicar à configuração' }))
  expect(await screen.findByRole('status')).toHaveTextContent(mensagem as string)
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/35/entregas/aprovar', {})
})

it('mostra o primeiro card original e mantém a sequência, download e ajuste ligados ao card escolhido', async () => {
  const arquivos = ['card-03.png', 'post.html', 'card-01.png', 'card-02.png'].map((nome, i) => ({ id: i + 50, nome, mime: nome.endsWith('.png') ? 'image/png' : 'text/html', status: 'aprovada' }))
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, arquivos } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(await screen.findByText('Imagem 1 de 3')).toBeInTheDocument()
  expect(screen.getByText('Entrega #52 · card-01.png')).toBeInTheDocument()
  expect([...document.querySelectorAll('.biblioteca-arquivos button')].map(botao => botao.textContent)).toEqual(['post.html', 'card-01.png', 'card-02.png', 'card-03.png'])
  fireEvent.click(screen.getByRole('button', { name: 'Próxima imagem' }))
  expect(screen.getByText('Entrega #53 · card-02.png')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledWith('/entregas/53/download', 'card-02.png'))
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  expect(screen.getByText('O ajuste usa este arquivo como referência e cria uma nova versão para revisar.')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('abre filtros e página do endereço compartilhado sem perder o contexto', async () => {
  render(<MemoryRouter initialEntries={['/?org=1&vista=biblioteca&busca-pedidos=Campanha&filtro-pedidos=favoritos&formato-pedidos=imagem&versoes-pedidos=1&pagina-pedidos=2&estado=pronto']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(screen.getByRole('searchbox', { name: 'Buscar projetos e entregas' })).toHaveValue('Campanha')
  expect(screen.getByRole('combobox', { name: 'Filtrar trabalhos' })).toHaveValue('favoritos')
  expect(screen.getByRole('combobox', { name: 'Formato' })).toHaveValue('imagem')
  expect(screen.getByRole('checkbox', { name: 'Incluir versões anteriores' })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Para revisar' })).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([path]) => {
    if (!path.includes('/biblioteca?')) return false
    const q = new URLSearchParams(path.split('?')[1])
    return q.get('busca') === 'Campanha' && q.get('filtro') === 'favoritos' && q.get('formato') === 'imagem' && q.get('versoes') === 'true' && q.get('offset') === '24' && q.get('estado') === 'pronto'
  })).toBe(true))
})

it('mostra a situação aplicada e permite limpar filtros preservando o projeto', async () => {
  render(<MemoryRouter initialEntries={['/?projeto=1&estado=pronto&formato-pedidos=imagem&pagina-pedidos=2']}><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'Para revisar' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Em produção' }))
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('estado=em_producao')
  expect(screen.getByLabelText('Endereço da biblioteca')).not.toHaveTextContent('pagina-pedidos=')
  expect(screen.getByRole('combobox', { name: 'Formato' })).toHaveValue('imagem')
  fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('projeto=1')
  expect(screen.getByLabelText('Endereço da biblioteca')).not.toHaveTextContent('estado=')
  expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('combobox', { name: 'Formato' })).toHaveValue('')
  expect(api.post).not.toHaveBeenCalled()
})

it('uma situação desconhecida no link não causa uma consulta inválida nem filtra silenciosamente', async () => {
  render(<MemoryRouter initialEntries={['/?estado=desconhecido']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/biblioteca?') && new URLSearchParams(path.split('?')[1]).get('estado') === '')).toBe(true))
})

it('abrir e fechar uma versão preserva filtros e página; alterar filtro volta à primeira página', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? trabalho : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [trabalho], total: 60 })
  render(<MemoryRouter initialEntries={['/?org=1&busca-pedidos=Campanha&filtro-pedidos=favoritos&pagina-pedidos=2']}><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /Campanha aprovada/ }))
  await waitFor(() => expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('trabalho=35'))
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('pagina-pedidos=2')
  fireEvent.click(await screen.findByRole('button', { name: /Voltar à biblioteca/ }))
  expect(await screen.findByRole('button', { name: /Campanha aprovada/ })).toBeInTheDocument()
  expect(screen.getByRole('searchbox', { name: 'Buscar projetos e entregas' })).toHaveValue('Campanha')
  expect(screen.getByLabelText('Endereço da biblioteca')).not.toHaveTextContent('trabalho=')
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('pagina-pedidos=2')
  fireEvent.change(screen.getByRole('combobox', { name: 'Formato' }), { target: { value: 'imagem' } })
  expect(screen.getByLabelText('Endereço da biblioteca')).not.toHaveTextContent('pagina-pedidos=')
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('filtro-pedidos=favoritos')
  expect(screen.getByLabelText('Endereço da biblioteca')).toHaveTextContent('formato-pedidos=imagem')
})

it.each(['-1', '35.5', '9007199254740992'])('não consulta o detalhe com identificador inválido %s', async id => {
  render(<MemoryRouter initialEntries={[`/?trabalho=${id}`]}><EnderecoBiblioteca /><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(screen.getByRole('alert')).toHaveTextContent('Este link de pedido ou projeto é inválido.')
  await screen.findByRole('button', { name: /Campanha aprovada/ })
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.endsWith(`/biblioteca/${id}`))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Ver os pedidos disponíveis' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Endereço da biblioteca')).not.toHaveTextContent('trabalho=')
})

it('a lista identifica interrupção sem mudar o rótulo das outras pendências', async () => {
  const itens = [
    { ...trabalho, titulo: 'Campanha interrompida', status: 'cancelled', estado: 'precisa_de_voce', aprovado: false },
    { ...trabalho, id: 36, titulo: 'Campanha com falha', status: 'failed', estado: 'precisa_de_voce', aprovado: false },
  ]
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens, total: 2 })
  montar()
  expect(await screen.findByText('Interrompido')).toBeInTheDocument()
  expect(screen.getByText('Precisa de você', { selector: '.biblioteca-estado' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('voltar no navegador fecha um ajuste para outro arquivo sem enviar o texto ao arquivo errado', async () => {
  const arquivos = [{ id: 9, nome: 'primeira.pdf', status: 'aprovada' }, { id: 10, nome: 'segunda.pdf', status: 'aprovada' }]
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, arquivos } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35&arquivo=9']}><VoltarNoHistorico /><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'segunda.pdf' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'O que você quer mudar?' }), { target: { value: 'Texto para a segunda versão.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Voltar no histórico' }))
  expect(await screen.findByText('Entrega #9 · primeira.pdf')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aplicar ajuste' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toHaveValue('')
  expect(api.post).not.toHaveBeenCalled()
})

it('uma atualização que muda o arquivo inicial encerra o ajuste e descarta o comentário do alvo anterior', async () => {
  let arquivos = [{ id: 9, nome: 'primeira.pdf', status: 'aprovada' }]
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, arquivos } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'O que você quer mudar?' }), { target: { value: 'Texto reservado para a primeira versão.' } })
  arquivos = [{ id: 10, nome: 'segunda.pdf', status: 'aprovada' }]
  act(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
  expect(await screen.findByText('Entrega #10 · segunda.pdf')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aplicar ajuste' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toHaveValue('')
  expect(api.post).not.toHaveBeenCalled()
})

it('detalhe interrompido explica preservação e mantém arquivo e versões acessíveis', async () => {
  const detalhe = { ...trabalho, titulo: 'Campanha interrompida', status: 'cancelled', estado: 'precisa_de_voce', aprovado: false,
    arquivos: [{ id: 1, nome: 'roteiro.pdf', status: 'pendente' }],
    versoes_anteriores: [{ id: 34, titulo: 'Versão anterior aprovada', criado_em: trabalho.criado_em }] }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(await screen.findByText('Interrompido')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Este trabalho foi interrompido. Os arquivos já salvos e as versões anteriores continuam guardados.')
  expect(screen.getByRole('button', { name: 'Baixar arquivo' })).toBeEnabled()
  fireEvent.click(screen.getByText('Projeto e versões anteriores'))
  expect(screen.getByRole('button', { name: /Versão anterior aprovada/ })).toBeEnabled()
  expect(api.post).not.toHaveBeenCalled()
})

it.each([false, true])('ao finalizar revisão remove só a confirmação da fila, preservando outra ação: %s', async outraAcao => {
  let estado = 'parcial'
  const detalhe = () => ({ ...trabalho, arquivos: [{ id: 1, nome: 'post.png', status: 'aprovada' }], qualidade: { estado, avisos: [], conferencias: [], revisao_automatica: { estado, limites: estado === 'parcial' ? 'Laudo parcial concluído.' : '' } } })
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? detalhe() : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  vi.mocked(api.post).mockImplementation(async () => { estado = 'em_fila'; return { job_id: 36 } })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Conferência desta versão'))
  fireEvent.click(screen.getByRole('button', { name: 'Conferir novamente' }))
  await screen.findByText('Conferência na fila. Os arquivos desta versão permanecem guardados.')
  if (outraAcao) {
    fireEvent.click(screen.getByRole('button', { name: 'Baixar arquivo' }))
    await screen.findByText('Download iniciado.')
  }
  estado = 'parcial'
  await act(async () => { window.dispatchEvent(new Event('offiz:biblioteca-mudou')) })
  await screen.findByText('Laudo parcial concluído.')
  expect(screen.getByRole('button', { name: 'Conferir novamente' })).toBeInTheDocument()
  expect(screen.queryByText('Conferência na fila. Os arquivos desta versão permanecem guardados.')).not.toBeInTheDocument()
  if (outraAcao) expect(screen.getByText('Download iniciado.')).toBeInTheDocument()
})

it('datas invertidas explicam a correção sem enviar nem apagar o formulário', async () => {
  const detalhe = { ...trabalho, arquivos: [{ id: 1, nome: 'post.png', status: 'aprovada' }], resultados: [] }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  vi.mocked(api.post).mockResolvedValue({})
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Resultados desta entrega'))
  fireEvent.change(screen.getByLabelText('Métrica'), { target: { value: 'Cliques' } })
  fireEvent.change(screen.getByLabelText('Valor observado'), { target: { value: '10' } })
  fireEvent.change(screen.getByLabelText('Fonte ou relatório'), { target: { value: 'Relatório sintético' } })
  fireEvent.change(screen.getByLabelText('Início do período'), { target: { value: '2026-09-10' } })
  fireEvent.change(screen.getByLabelText('Fim do período'), { target: { value: '2026-09-01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Registrar resultado' }))
  expect(screen.getByRole('alert')).toHaveTextContent('O fim do período precisa ser igual ou posterior ao início.')
  expect(api.post).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Métrica')).toHaveValue('Cliques')
  expect(screen.getByLabelText('Fonte ou relatório')).toHaveValue('Relatório sintético')
  fireEvent.change(screen.getByLabelText('Fim do período'), { target: { value: '2026-09-10' } })
  fireEvent.click(screen.getByRole('button', { name: 'Registrar resultado' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orgs/1/resultados', expect.objectContaining({ inicio: '2026-09-10', fim: '2026-09-10' })))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('criar projeto na aba Resultados abre as entregas do projeto salvo', async () => {
  let criado = false
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') ? (criado ? [projeto(9)] : []) : path.endsWith('/padroes') ? [] : path.endsWith('/impacto') ? { itens: [] } : { itens: [], total: 0 })
  vi.mocked(api.post).mockImplementation(async () => { criado = true; return projeto(9) })
  montar()
  fireEvent.click(screen.getByRole('button', { name: 'Resultados' }))
  await screen.findByText('Ainda precisamos dos seus resultados.')
  fireEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))
  fireEvent.change(screen.getByLabelText('Nome do projeto'), { target: { value: 'Projeto 9' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar projeto' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Todos os pedidos' })).toHaveAttribute('aria-current', 'page'))
  expect(screen.queryByText('Ainda precisamos dos seus resultados.')).not.toBeInTheDocument()
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('projeto_id=9'))).toBe(true))
})

it('repete somente a conferência da versão e mostra evidências', async () => {
  const detalhe = { ...trabalho, arquivos: [{ id: 1, nome: 'post.png', status: 'aprovada' }],
    qualidade: { estado: 'parcial', avisos: ['Faltou renderizar'], conferencias: [],
      verificacoes: [{ nome: 'post.png', estado: 'nao_verificado', detalhe: 'Cobertura parcial', evidencias: ['Hash conferido pelo revisor'] }],
      revisao_automatica: { estado: 'parcial', limites: 'Sem análise de imagem nesta tentativa' } } }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  vi.mocked(api.post).mockResolvedValue({ job_id: 100 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Conferência desta versão (1 pendência)'))
  fireEvent.click(screen.getByText('Como foi conferido'))
  expect(screen.getByText('Hash conferido pelo revisor')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Conferir novamente' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orgs/1/biblioteca/35/revisar', {}))
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('muitos projetos ficam compactos e a busca encontra os que não aparecem nos atalhos', async () => {
  montar()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Escolher projeto ▾' })).toBeEnabled())
  expect(screen.queryByRole('button', { name: 'Projeto 80' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Escolher projeto ▾' }))
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar um projeto' }), { target: { value: 'Projeto 80' } })
  fireEvent.click(screen.getByRole('button', { name: 'Projeto 80' }))
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('projeto_id=80'))).toBe(true))
  expect(api.post).not.toHaveBeenCalled()
})

it('guardar favorito não aprova nem inicia uma nova produção', async () => {
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Guardar nos favoritos' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/orgs/1/biblioteca/35/favorito', { favorito: true }))
  expect(api.post).not.toHaveBeenCalled()
})

it('uma resposta tardia não mostra entregas da empresa anterior', async () => {
  let concluir!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(path => path.startsWith('/orgs/1/biblioteca') ? new Promise(resolve => { concluir = resolve }) : Promise.resolve(path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 }))
  const { rerender } = montar()
  rerender(<MemoryRouter><BibliotecaProjetos orgId={2} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await act(async () => concluir({ itens: [trabalho], total: 1 }))
  expect(screen.queryByText('Campanha aprovada')).not.toBeInTheDocument()
})


it('o detalhe indisponível permite voltar à biblioteca sem recarregar o app', async () => {
  vi.mocked(api.get).mockImplementation(async path => {
    if (path.endsWith('/biblioteca/35')) throw new Error('Entrega indisponível')
    return path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [trabalho], total: 1 }
  })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: /Voltar à biblioteca/ }))
  expect(await screen.findByRole('button', { name: /Campanha aprovada/ })).toBeInTheDocument()
})

it('um padrão não herda dados de um projeto de outra equipe', async () => {
  localStorage.clear(); sessionStorage.clear(); setTokens('fixture-padrao', 'fixture-refresh')
  vi.mocked(api.get).mockImplementation(async path => path === '/auth/me' ? { id: 7 } : path.endsWith('/biblioteca/40') ? { ...trabalho, id: 40 } : path.endsWith('/projetos') ? [{ ...projeto(1), office_slug: 'financeiro', dados: { Receita: 'Dado privado de contexto' } }] : path.endsWith('/padroes') ? [{ id: 1, nome: 'Post aprovado', office_slug: 'conteudo', campos: ['Produto'], preservar: 'As cores' }] : path.endsWith('/impacto') ? { itens: [] } : { itens: [], total: 0 })
  vi.mocked(api.post).mockImplementation(async (_path, body) => ({ id: 40, office_slug: 'conteudo', request_id: (body as { request_id: string }).request_id, replayed: false }))
  render(<MemoryRouter initialEntries={['/?projeto=1']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Meus padrões' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Fazer o próximo assim' }))
  expect(screen.queryByRole('textbox', { name: 'Receita' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Produto' })).toBeEnabled())
  fireEvent.change(screen.getByRole('textbox', { name: 'Produto' }), { target: { value: 'Café' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Qual resultado você precisa?' }), { target: { value: 'Próximo post' } })
  fireEvent.click(screen.getByRole('button', { name: 'Pode produzir' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orgs/1/producao', expect.objectContaining({ projeto_id: null, dados: { Produto: 'Café' }, office_slug: 'conteudo' })))
})

it('a identificação da conta tem mensagem e retry, sem habilitar produção antes da confirmação', async () => {
  localStorage.clear(); sessionStorage.clear(); setTokens('fixture-identificacao', 'fixture-refresh')
  let recusar!: (e: Error) => void
  const identificacao = new Promise((_resolve, reject) => { recusar = reject })
  let recuperou = false
  vi.mocked(api.get).mockImplementation(async path => path === '/auth/me' ? recuperou ? { id: 7 } : identificacao : path.endsWith('/projetos') ? [projeto(1)] : path.endsWith('/padroes') ? [] : path.endsWith('/impacto') ? { itens: [] } : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?projeto=1']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Novo trabalho neste projeto' }))
  expect(screen.getByText('Conferindo a conta e os pedidos já enviados…')).toHaveAttribute('role', 'status')
  const campo = screen.getByRole('textbox', { name: 'Qual resultado você precisa?' })
  expect(campo).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Preparando…' })).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
  await act(async () => recusar(new Error('Consulta da conta indisponível')))
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível verificar a conta')
  expect(campo).toBeDisabled()
  recuperou = true
  fireEvent.click(screen.getByRole('button', { name: 'Tentar verificar a conta' }))
  await waitFor(() => expect(campo).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('reabrir envio perdido permite conferir com campos obrigatórios vazios, sem nova produção', async () => {
  localStorage.clear(); sessionStorage.clear(); setTokens('fixture-recuperacao', 'fixture-refresh')
  let requestId = ''
  vi.mocked(api.get).mockImplementation(async path => path === '/auth/me' ? { id: 7 } : path.endsWith('/projetos') ? [] : path.endsWith('/padroes') ? [{ id: 1, nome: 'Post aprovado', office_slug: 'conteudo', campos: ['Produto'], preservar: 'As cores' }] : path === `/orgs/1/producao/${requestId}` ? { id: 40, office_slug: 'conteudo', request_id: requestId, replayed: true } : path.endsWith('/biblioteca/40') ? { ...trabalho, id: 40 } : { itens: [], total: 0 })
  vi.mocked(api.post).mockImplementation(async (_path, body) => { requestId = (body as { request_id: string }).request_id; throw new Error('Resposta perdida') })
  render(<MemoryRouter initialEntries={['/?biblioteca-aba=padroes']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Fazer o próximo assim' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Produto' })).toBeEnabled())
  fireEvent.change(screen.getByRole('textbox', { name: 'Produto' }), { target: { value: 'Camisa' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Qual resultado você precisa?' }), { target: { value: 'Faça o post com essa camisa.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Pode produzir' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Confira sua situação')
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Fazer o próximo assim' }))
  const conferir = await screen.findByRole('button', { name: 'Conferir envio' })
  expect(conferir).toHaveAttribute('type', 'button')
  expect(screen.getByRole('textbox', { name: 'Produto' })).toHaveValue('')
  expect(screen.getByRole('textbox', { name: 'Qual resultado você precisa?' })).toHaveValue('')
  fireEvent.click(conferir)
  await screen.findByRole('heading', { name: 'Campanha aprovada' })
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.includes('/producao/'))).toEqual([[`/orgs/1/producao/${requestId}`]])
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('vários envios pendentes exigem escolha e só a consulta escolhida abre o trabalho', async () => {
  localStorage.clear(); setTokens('fixture-escolha', 'fixture-refresh')
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
  const raiz = `offiz:producao:${API_V1}:7:/orgs/1:["conteudo",1,null,null,null]`
  ids.forEach((id, i) => localStorage.setItem(`${raiz}:intencao:${id}`, JSON.stringify({ versao: 1, request_id: id, criado_em: `2026-10-09T12:0${i}:00Z` })))
  vi.mocked(api.get).mockImplementation(async path => path === '/auth/me' ? { id: 7 } : path === `/orgs/1/producao/${ids[1]}` ? { id: 40, office_slug: 'conteudo', request_id: ids[1], replayed: true } : path.endsWith('/biblioteca/40') ? { ...trabalho, id: 40 } : path.endsWith('/projetos') ? [projeto(1)] : path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?projeto=1']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Novo trabalho neste projeto' }))
  const escolha = await screen.findByRole('group', { name: 'Qual envio você quer conferir?' })
  expect(within(escolha).getAllByRole('button')).toHaveLength(2)
  expect(screen.getByRole('textbox', { name: 'Qual resultado você precisa?' })).toBeDisabled()
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/producao/'))).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(within(escolha).getByRole('button', { name: /Selecionar envio 2/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Conferir envio' }))
  await screen.findByRole('heading', { name: 'Campanha aprovada' })
  expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.includes('/producao/'))).toEqual([[`/orgs/1/producao/${ids[1]}`]])
  expect(localStorage.getItem(`${raiz}:intencao:${ids[0]}`)).not.toBeNull()
  expect(localStorage.getItem(`${raiz}:intencao:${ids[1]}`)).toBeNull()
})

it('dois formulários já abertos preservam seus textos e enviam pedidos independentes', async () => {
  localStorage.clear(); setTokens('fixture-independentes', 'fixture-refresh')
  vi.mocked(api.get).mockImplementation(async path => path === '/auth/me' ? { id: 7 } : path.endsWith('/projetos') ? [projeto(1)] : path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  vi.mocked(api.post).mockRejectedValue(new Error('Resposta perdida'))
  const a = render(<MemoryRouter initialEntries={['/?projeto=1']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  const b = render(<MemoryRouter initialEntries={['/?projeto=1']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await within(a.container).findByRole('button', { name: 'Novo trabalho neste projeto' }))
  fireEvent.click(await within(b.container).findByRole('button', { name: 'Novo trabalho neste projeto' }))
  const textoA = within(a.container).getByRole('textbox', { name: 'Qual resultado você precisa?' })
  const textoB = within(b.container).getByRole('textbox', { name: 'Qual resultado você precisa?' })
  await waitFor(() => { expect(textoA).toBeEnabled(); expect(textoB).toBeEnabled() })
  fireEvent.change(textoA, { target: { value: 'Arte para anunciar o jogo.' } })
  fireEvent.change(textoB, { target: { value: 'Vídeo para agradecer à torcida.' } })
  fireEvent.click(within(a.container).getByRole('button', { name: 'Pode produzir' }))
  await within(a.container).findByRole('alert')
  fireEvent.click(within(b.container).getByRole('button', { name: 'Pode produzir' }))
  await within(b.container).findByRole('alert')
  expect(api.post).toHaveBeenCalledTimes(2)
  const corpos = vi.mocked(api.post).mock.calls.map(([, body]) => body as { pedido: string; request_id: string })
  expect(corpos.map(c => c.pedido)).toEqual(['Arte para anunciar o jogo.', 'Vídeo para agradecer à torcida.'])
  expect(corpos[1].request_id).not.toBe(corpos[0].request_id)
  expect(textoA).toHaveValue('Arte para anunciar o jogo.'); expect(textoB).toHaveValue('Vídeo para agradecer à torcida.')
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/producao/'))).toBe(false)
})

it('a confirmação das pendências vale somente para a peça escolhida', async () => {
  const detalhe = { ...trabalho, aprovado: false, qualidade: { estado: 'parcial', avisos: ['Conferência parcial'], conferencias: [] }, pecas_editoriais: [1, 2].map(id => ({ id, revisao_id: id, titulo: `Peça ${id}`, aprovada: false, pendencias: ['Falta revisar'], legendas: [{ nome: 'Principal', texto: `Legenda ${id}` }] })) }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  const confirmacoes = await screen.findAllByRole('checkbox', { name: 'Conferi esta versão e suas pendências.' })
  fireEvent.click(confirmacoes[0])
  const aprovar = screen.getAllByRole('button', { name: 'Aprovar esta peça' })
  expect(aprovar[0]).toBeEnabled()
  expect(aprovar[1]).toBeDisabled()
  expect(confirmacoes[1]).not.toBeChecked()
})

it('agrupa um lote por peça e aprova somente a legenda e a revisão selecionadas', async () => {
  const pecas = [1, 2].map(id => ({ id, revisao_id: id + 10, titulo: `Tema ${id}`, aprovada: false, pendencias: [], legendas: [{ nome: 'Principal', texto: `Legenda do tema ${id}` }] }))
  const arquivos = pecas.flatMap(p => [
    { id: p.id * 10, nome: 'arte.png', tipo: 'imagem', editorial_peca_id: p.id, status: 'pendente' },
    { id: p.id * 10 + 1, nome: 'legenda.docx', editorial_peca_id: p.id, status: 'pendente' },
    { id: p.id * 10 + 2, nome: 'post.html', editorial_peca_id: p.id, status: 'pendente' },
  ])
  const detalhe = { ...trabalho, aprovado: false, arquivos, qualidade: { estado: 'conferida', avisos: [], conferencias: [] }, pecas_editoriais: pecas }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  const copiar = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copiar } })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(await screen.findByRole('button', { name: 'Tema 1' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByRole('button', { name: /^Arte$/ })).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Arte' })).toHaveAttribute('aria-pressed', 'true')
  expect([...document.querySelectorAll('.biblioteca-arquivos button')].map(b => b.textContent)).toEqual(['Ler post', 'Arte', 'Legenda em Word'])
  expect(screen.queryByRole('button', { name: 'Apontar um ajuste na entrega' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Baixar todos os arquivos' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledWith('/orgs/1/biblioteca/35/download', 'trabalho-35.zip'))
  expect(screen.getByText('Legenda do tema 1')).toBeInTheDocument()
  expect(screen.queryByText('Legenda do tema 2')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tema 2' }))
  expect(screen.queryByText('Legenda do tema 1')).not.toBeInTheDocument()
  expect(screen.getByText('Legenda do tema 2')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Legenda em Word' }))
  expect(screen.getByRole('button', { name: 'Baixar Word' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Copiar legenda' }))
  await waitFor(() => expect(copiar).toHaveBeenCalledWith('Legenda do tema 2'))
  fireEvent.click(screen.getByRole('button', { name: 'Aprovar esta peça' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/predios/1/conteudo/editorial/2/aprovar', { revisao_id: 12, variante: 0, ciente_pendencias: false }))
})

it('mantém acessíveis os arquivos comuns de um lote sem mostrar a aprovação de outra peça', async () => {
  const pecas = [1, 2].map(id => ({ id, revisao_id: id, titulo: `Tema ${id}`, aprovada: false, pendencias: [], legendas: [{ nome: 'Principal', texto: `Legenda ${id}` }] }))
  const detalhe = { ...trabalho, arquivos: [...pecas.map(p => ({ id: p.id, nome: 'arte.png', tipo: 'imagem', editorial_peca_id: p.id })), { id: 3, nome: 'Pesquisa.docx', editorial_peca_id: null }], pecas_editoriais: pecas }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Arquivos do lote' }))
  expect(screen.getByRole('button', { name: 'Pesquisa.docx' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aprovar esta peça' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tema 1' }))
  expect(screen.queryByRole('button', { name: 'Pesquisa.docx' })).not.toBeInTheDocument()
  expect(screen.getByText('Legenda 1')).toBeInTheDocument()
})

it('na conversa de uma área, busca, padrões e rotinas usam a mesma equipe', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') ? [projeto(1), { ...projeto(2), office_slug: 'financeiro' }] : path.endsWith('/padroes') ? [{ id: 1, nome: 'Padrão de conteúdo', office_slug: 'conteudo', campos: [], preservar: '' }, { id: 2, nome: 'Padrão financeiro', office_slug: 'financeiro', campos: [], preservar: '' }] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?org=1&slug=conteudo']}><BibliotecaProjetos orgId={1} areaSlug="conteudo" andares={[{ slug: 'conteudo', nome: 'Conteúdo' }, { slug: 'financeiro', nome: 'Financeiro' }]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('office_slug=conteudo'))).toBe(true))
  expect(screen.getByRole('link', { name: 'Ver pedidos de todas as áreas' })).toHaveAttribute('href', '/app?org=1&vista=biblioteca')
  fireEvent.click(screen.getByRole('button', { name: 'Meus padrões' }))
  expect(await screen.findByRole('heading', { name: 'Padrão de conteúdo' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Padrão financeiro' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Rotinas' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/orgs/1/rotinas-material?office_slug=conteudo', expect.any(AbortSignal)))
})

it('um destino que ficou incompatível com a seleção em lote não é enviado', async () => {
  const outro = { ...trabalho, id: 36, titulo: 'Relatório', office_slug: 'financeiro' }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') ? [projeto(1)] : path.endsWith('/padroes') ? [] : { itens: [trabalho, outro], total: 2 })
  vi.mocked(api.post).mockResolvedValue({})
  montar()
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Campanha aprovada' }))
  fireEvent.click(screen.getByText('Organizar vários trabalhos · 1'))
  fireEvent.change(screen.getByRole('combobox', { name: 'Destino dos trabalhos selecionados' }), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Relatório' }))
  expect(screen.getByRole('combobox', { name: 'Destino dos trabalhos selecionados' })).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: 'Guardar 2 trabalhos' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orgs/1/biblioteca/organizar', { jobs: [35, 36], projeto_id: null }))
})

it('o formulário de resultado não acompanha outro arquivo sem ser preenchido novamente', async () => {
  const detalhe = { ...trabalho, arquivos: [1, 2].map(id => ({ id, nome: `Entrega ${id}.pdf`, status: 'aprovada' })), resultados: [] }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Resultados desta entrega'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Métrica' }), { target: { value: 'Cliques do arquivo 1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Entrega 2.pdf' }))
  expect(screen.getByRole('textbox', { name: 'Métrica' })).toHaveValue('')
})

it('apontar em um documento sem prévia abre um ajuste vinculado ao arquivo', async () => {
  localStorage.clear(); setTokens('fixture-ajuste-documento', 'fixture-refresh')
  const detalhe = { ...trabalho, arquivos: [{ id: 1, nome: 'Planilha.xlsx', status: 'aprovada' }] }
  vi.mocked(api.get).mockImplementation(async path => path === '/auth/me' ? { id: 7 } : path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste' }))
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'O que precisa mudar aqui?' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Aplicar ajuste' })).toBeDisabled()
  vi.mocked(api.post).mockImplementation(async (_path, body) => ({ job_id: 35, comentario_id: 81, office_slug: 'conteudo', request_id: (body as { request_id: string }).request_id, replayed: false }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeEnabled())
  fireEvent.change(screen.getByRole('combobox', { name: 'O que pode mudar neste ajuste?' }), { target: { value: 'texto' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'O que você quer mudar?' }), { target: { value: 'Corrija o nome do produto.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar ajuste' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orgs/1/biblioteca/35/ajustes', expect.objectContaining({ entrega_id: 1, escopo: 'texto', texto: 'Corrija o nome do produto.' })))
})

it('conversar sobre o trabalho envia sua versão inteira sem limitar ao arquivo aberto', async () => {
  const pedir = vi.fn()
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, arquivos: [{ id: 90, nome: 'Oferta.pdf', status: 'aprovada' }] } : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35&arquivo=90']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={pedir} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Conversar sobre este trabalho' }))
  expect(pedir).toHaveBeenCalledWith(expect.any(String), { jobId: 35, intencao: 'discutir' })
  expect(api.post).not.toHaveBeenCalled()
})


it('a seleção em páginas diferentes respeita o máximo de 60 trabalhos', async () => {
  const trabalhos = Array.from({ length: 61 }, (_, i) => ({ ...trabalho, id: i + 1, titulo: `Trabalho ${i + 1}` }))
  vi.mocked(api.get).mockImplementation(async path => {
    if (path.endsWith('/projetos') || path.endsWith('/padroes')) return []
    const offset = Number(new URL(path, 'https://example.test').searchParams.get('offset'))
    return { itens: trabalhos.slice(offset, offset + 24), total: 61 }
  })
  montar()
  for (let pagina = 0; pagina < 3; pagina++) {
    const inicio = pagina * 24 + 1
    await screen.findByRole('checkbox', { name: `Selecionar Trabalho ${inicio}` })
    // Consulta a página uma vez, conservando as 60 interações reais. Buscar
    // a árvore inteira a cada clique fazia esta prova expirar sob a suíte.
    const caixas = screen.getAllByRole('checkbox', { name: /^Selecionar Trabalho / })
    for (const caixa of caixas.slice(0, Math.min(24, 61 - inicio))) fireEvent.click(caixa)
    if (pagina < 2) fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
  }
  expect(screen.getByRole('checkbox', { name: 'Selecionar Trabalho 61' })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: 'Selecionar Trabalho 61' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Selecionar Trabalho 60' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Selecionar Trabalho 60' })).toBeEnabled()
})

it('um projeto terminado depois de sair do formulário não muda a navegação atual', async () => {
  let concluir!: (value: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  montar()
  fireEvent.click(screen.getByRole('button', { name: 'Novo projeto' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome do projeto' }), { target: { value: 'Projeto novo' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar projeto' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Meus padrões' }))
  await act(async () => concluir({ ...projeto(81), nome: 'Projeto novo' }))
  expect(screen.getByRole('button', { name: 'Meus padrões' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('heading', { name: 'Projeto novo' })).not.toBeInTheDocument()
})

it('importar CSV distingue resultados novos dos já registrados', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  vi.mocked(api.postForm).mockResolvedValue({ registros: 3, adicionados: 1, repetidos: 2 })
  montar()
  fireEvent.click(screen.getByRole('button', { name: 'Resultados' }))
  fireEvent.click(screen.getByText('Importar resultados de um relatório CSV'))
  const campo = screen.getByLabelText('Relatório de resultados')
  fireEvent.change(campo, { target: { files: [new File(['entrega_id,metrica'], 'resultados.csv', { type: 'text/csv' })] } })
  expect(await screen.findByRole('status')).toHaveTextContent('Novos resultados: 1. Já registrados: 2.')
  expect(campo).toHaveValue('')
})


it('uma peça aprovada mostra a legenda exata escolhida na aprovação', async () => {
  const detalhe = { ...trabalho, pecas_editoriais: [{ id: 1, revisao_id: 1, titulo: 'Peça aprovada', aprovada: true, variante_aprovada: 1, pendencias: [], legendas: [{ nome: 'Curta', texto: 'Legenda descartada' }, { nome: 'Detalhada', texto: 'Texto aprovado pelo cliente' }] }] }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  expect(await screen.findByText('Texto aprovado pelo cliente')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Texto que acompanha a peça' })).toHaveValue('1')
  expect(screen.getByRole('combobox', { name: 'Texto que acompanha a peça' })).toBeDisabled()
  expect(screen.queryByText('Legenda descartada')).not.toBeInTheDocument()
})


it('ajuste usa o post escolhido mesmo na prévia e trocar de post limpa o rascunho', async () => {
  localStorage.clear(); setTokens('fixture-ajuste-post', 'fixture-refresh')
  const pecas = [1, 2].map(id => ({ id, revisao_id: id + 10, titulo: `Tema ${id}`, aprovada: false, pendencias: [], legendas: [{ nome: 'Principal', texto: `Legenda ${id}` }] }))
  const arquivos = pecas.flatMap(p => ['arte.png', 'legenda.docx', 'post.html'].map((nome, i) => ({ id: p.id * 10 + i, nome, editorial_peca_id: p.id, status: 'pendente' })))
  const detalhe = { ...trabalho, aprovado: false, arquivos, pecas_editoriais: pecas, fontes: [{ id: 29, titulo: 'Pesquisa das cinco pautas' }] }
  vi.mocked(api.get).mockImplementation(async path => path === '/auth/me' ? { id: 7 } : path.endsWith('/biblioteca/35') ? detalhe : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  vi.mocked(api.post).mockImplementation(async (_path, body) => ({ job_id: 35, comentario_id: 81, office_slug: 'conteudo', request_id: (body as { request_id: string }).request_id, replayed: false }))
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste neste post' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'O que você quer mudar?' }), { target: { value: 'Rascunho do primeiro post' } })
  fireEvent.click(screen.getByRole('button', { name: 'Tema 2' }))
  expect(screen.queryByRole('textbox', { name: 'O que você quer mudar?' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste neste post' }))
  expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toHaveValue('')
  expect(screen.getByRole('heading', { name: 'Ajustar: Tema 2' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Aplicar ajuste' })).toBeDisabled()
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'O que você quer mudar?' })).toBeEnabled())
  fireEvent.change(screen.getByRole('textbox', { name: 'O que você quer mudar?' }), { target: { value: 'Clarear o fundo da imagem mostrada no HTML' } })
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar ajuste' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orgs/1/biblioteca/35/ajustes', { entrega_id: 20, escopo: 'completo', texto: 'Clarear o fundo da imagem mostrada no HTML', conversa_id: null, request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) }))
  expect(api.post).not.toHaveBeenCalledWith('/orgs/1/producao', expect.anything())
  expect(screen.getByRole('button', { name: 'Pesquisa das cinco pautas' })).toBeVisible()
})

it('falha ao atualizar conserva a entrega e o rascunho da nova versão até confirmar a próxima consulta', async () => {
  localStorage.clear(); sessionStorage.clear(); setTokens('fixture-nova-versao', 'fixture-refresh')
  let falhar = false
  const detalhe = { ...trabalho, arquivos: [{ id: 92, nome: 'arte.png', status: 'aprovada' }], desatualizados: ['Data da partida'] }
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/auth/me') return { id: 7 }
    if (path.endsWith('/biblioteca/35')) {
      if (falhar) throw new Error('Sem conexão')
      return detalhe
    }
    return path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 }
  })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar versão atualizada' }))
  const campo = screen.getByRole('textbox', { name: 'Qual resultado você precisa?' })
  await waitFor(() => expect(campo).toBeEnabled())
  fireEvent.change(campo, { target: { value: 'Corrija somente a data e mantenha a composição.' } })
  falhar = true
  act(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
  const aviso = await screen.findByRole('alert')
  expect(aviso).toHaveTextContent('Exibindo a última consulta confirmada')
  expect(aviso.querySelector('time')).toHaveAttribute('dateTime')
  expect(screen.getByText('Entrega #92 · arte.png')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Qual resultado você precisa?' })).toBe(campo)
  expect(campo).toHaveValue('Corrija somente a data e mantenha a composição.')
  falhar = false
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(campo).toHaveValue('Corrija somente a data e mantenha a composição.')
  expect(api.post).not.toHaveBeenCalled()
})

it('uma consulta inicial falha mostra retry sem afirmar que a biblioteca está vazia', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.includes('/biblioteca?') ? Promise.reject(new Error('Sem conexão')) : [])
  montar()
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão')
  expect(screen.queryByText('Um lugar para o seu próximo trabalho')).not.toBeInTheDocument()
  expect(screen.queryByText(/Exibindo a última consulta confirmada/)).not.toBeInTheDocument()
})

it('a resposta da rotina anterior não fecha o novo formulário nem apaga o novo rascunho', async () => {
  let concluir!: (value: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') ? [projeto(1)] : path.endsWith('/padroes') ? [] : { itens: [], total: 0, agendador_ativo: true })
  render(<MemoryRouter initialEntries={['/?biblioteca-aba=rotinas']}><BibliotecaProjetos orgId={1} andares={[]} podeConfigurar pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Nova rotina por material' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Nova rotina por material' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome da rotina' }), { target: { value: 'Rotina A' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome exato do arquivo na Entrada' }), { target: { value: 'relatorio-a.csv' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'O que o Offiz deve preparar?' }), { target: { value: 'Resuma o relatório A.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ativar rotina' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/orgs/1/rotinas-material', { projeto_id: 1, nome: 'Rotina A', arquivo_nome: 'relatorio-a.csv', pedido: 'Resuma o relatório A.' }))
  fireEvent.click(screen.getByRole('button', { name: 'Nova rotina por material' }))
  fireEvent.click(screen.getByRole('button', { name: 'Nova rotina por material' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome da rotina' }), { target: { value: 'Rotina B' } })
  const pedido = screen.getByRole('textbox', { name: 'O que o Offiz deve preparar?' })
  fireEvent.change(pedido, { target: { value: 'Pedido do novo formulário B.' } })
  await act(async () => concluir({ id: 1 }))
  expect(screen.getByRole('textbox', { name: 'Nome da rotina' })).toHaveValue('Rotina B')
  expect(screen.getByRole('textbox', { name: 'O que o Offiz deve preparar?' })).toBe(pedido)
  expect(pedido).toHaveValue('Pedido do novo formulário B.')
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each(['rotinas', 'resultados'])('sinaliza os dados confirmados da aba %s quando sua consulta falha e oferece retry', async aba => {
  let falhar = false
  const rota = aba === 'rotinas' ? '/rotinas-material' : '/resultados'
  vi.mocked(api.get).mockImplementation(async path => {
    if (path.includes(rota)) {
      if (falhar) throw new Error('Sem conexão')
      return aba === 'rotinas' ? { itens: [{ id: 1, nome: 'Rotina confirmada', projeto_id: 1, projeto_nome: 'Projeto 1', arquivo_nome: 'arquivo.csv', pedido: 'Pedido confirmado', ativo: true, eventos: [] }], agendador_ativo: true } : { itens: [{ id: 1, job_id: 35, entrega_id: 92, trabalho: 'Resultado confirmado', valor: '12', metrica: 'cliques', inicio: '2026-10-01', fim: '2026-10-02', fonte: 'Relatório fornecido' }], total: 1 }
    }
    return path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 }
  })
  render(<MemoryRouter initialEntries={[`/?biblioteca-aba=${aba}`]}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  const nome = aba === 'rotinas' ? 'Rotina confirmada' : 'Resultado confirmado'
  expect(await screen.findByText(nome)).toBeInTheDocument()
  falhar = true
  act(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
  const aviso = await screen.findByRole('alert')
  expect(aviso).toHaveTextContent('Exibindo a última consulta confirmada')
  expect(screen.getByText(nome)).toBeInTheDocument()
  falhar = false
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})

it('uma falha de consulta do impacto preserva a seleção sem afirmar que os dados estão atualizados', async () => {
  let falhar = false
  vi.mocked(api.get).mockImplementation(async path => {
    if (path.endsWith('/impacto')) {
      if (falhar) throw new Error('Impacto indisponível')
      return { versao: 1, itens: [{ id: 35, titulo: 'Pedido para atualizar', campos: ['Data'] }] }
    }
    return path.endsWith('/projetos') ? [projeto(1)] : path.endsWith('/padroes') ? [] : { itens: [], total: 0 }
  })
  render(<MemoryRouter initialEntries={['/?projeto=1']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  const resumo = await screen.findByText('1 trabalho usa informações que mudaram')
  const grupo = resumo.closest('details')!; grupo.open = true
  const selecionado = screen.getByRole('checkbox', { name: /Pedido para atualizar/ })
  fireEvent.click(selecionado)
  falhar = true
  act(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
  expect(await screen.findByRole('alert')).toHaveTextContent('Exibindo a última consulta confirmada')
  expect(screen.getByRole('checkbox', { name: /Pedido para atualizar/ })).toBe(selecionado)
  expect(selecionado).toBeChecked()
  expect(api.post).not.toHaveBeenCalled()
})

it('falha ao ativar conserva o formulário e uma repetição por duplo clique não envia duas vezes', async () => {
  let rejeitar!: (reason: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise((_, reject) => { rejeitar = reject }))
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/projetos') ? [projeto(1)] : path.endsWith('/padroes') ? [] : { itens: [], total: 0, agendador_ativo: true })
  render(<MemoryRouter initialEntries={['/?biblioteca-aba=rotinas']}><BibliotecaProjetos orgId={1} andares={[]} podeConfigurar pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Nova rotina por material' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Nova rotina por material' }))
  const nome = screen.getByRole('textbox', { name: 'Nome da rotina' })
  fireEvent.change(nome, { target: { value: 'Minha rotina' } })
  const formulario = nome.closest('form')!
  fireEvent.submit(formulario); fireEvent.submit(formulario)
  expect(api.post).toHaveBeenCalledTimes(1)
  await act(async () => rejeitar(new Error('Sem conexão')))
  expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão')
  expect(nome).toHaveValue('Minha rotina')
  expect(screen.getByRole('button', { name: 'Ativar rotina' })).toBeEnabled()
})

const orientacao = { id: 901, job_id: 35, organization_id: 1, office_slug: 'conteudo', nome: 'orientacoes.md', mime: 'text/markdown', tamanho_bytes: 100, tipo: 'devolutiva', status: 'aprovada' }

it('pedido sem arquivos finais apresenta as orientações reais, sem aprovar ou retomar a tarefa', async () => {
  const pedir = vi.fn()
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, aprovado: false, estado: 'precisa_de_voce', devolutivas: [orientacao] }
    : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={pedir} /></MemoryRouter>)
  const abrir = await screen.findByRole('button', { name: 'Abrir orientações: orientacoes.md' })
  expect(screen.queryByTestId('previa-901')).not.toBeInTheDocument()
  fireEvent.click(abrir)
  expect(screen.getByTestId('previa-901')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Aprovar|Pedir ajuste|retomar/i })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Conversar sobre este trabalho' }))
  expect(pedir).toHaveBeenCalledWith(expect.any(String), { jobId: 35, entregaId: undefined, intencao: 'discutir' })
  expect(api.post).not.toHaveBeenCalled()
})

it('orientações permanecem separadas das peças e o download conserva o ID exato e erro recuperável', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, arquivos: [{ id: 92, nome: 'arte.png', status: 'aprovada' }], devolutivas: [orientacao] }
    : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  vi.mocked(baixarArquivo).mockRejectedValueOnce(new ApiError(503, 'Orientações indisponíveis agora.')).mockResolvedValueOnce(undefined)
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Baixar orientações: orientacoes.md' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Orientações indisponíveis agora.')
  expect(baixarArquivo).toHaveBeenCalledExactlyOnceWith('/entregas/901/download', 'orientacoes.md')
  fireEvent.click(screen.getByRole('button', { name: 'Baixar orientações: orientacoes.md' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByText('Entrega #92 · arte.png')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'orientacoes.md' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('a biblioteca não apresenta orientações de outro pedido, empresa, área ou tipo', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? { ...trabalho, devolutivas: [orientacao,
    { ...orientacao, id: 902, job_id: 36, nome: 'outra-tarefa.md' }, { ...orientacao, id: 903, organization_id: 2, nome: 'outra-empresa.md' },
    { ...orientacao, id: 904, office_slug: 'juris', nome: 'outra-area.md' }, { ...orientacao, id: 905, tipo: 'interno', nome: 'interno.md' }] }
    : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await screen.findByRole('button', { name: 'Abrir orientações: orientacoes.md' })
  expect(screen.queryByText(/outra-tarefa|outra-empresa|outra-area|interno.md/)).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('orientações antigas não reaparecem na biblioteca após mudar de empresa durante a consulta', async () => {
  let concluir!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(path => path === '/orgs/1/biblioteca/35' ? new Promise(resolve => { concluir = resolve })
    : Promise.resolve(path.endsWith('/biblioteca/35') ? { ...trabalho, titulo: 'Pedido da empresa atual', devolutivas: [] }
      : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 }))
  const { rerender } = render(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={1} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/orgs/1/biblioteca/35', expect.any(AbortSignal)))
  rerender(<MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={2} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Pedido da empresa atual' })
  await act(async () => concluir({ ...trabalho, devolutivas: [orientacao] }))
  expect(screen.queryByText('orientacoes.md')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Pedido da empresa atual' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

// Batch updates have no receipt endpoint: checking impact is a read, not an ACK.
function esperaLote<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
type ImpactoLote = { versao: number; itens: { id: number; titulo: string; campos: string[] }[] }
function OutroProjetoLote() {
  const navegar = useNavigate()
  return <button onClick={() => navegar('/?projeto=2')}>Outro projeto do lote</button>
}
function bancadaLote(sufixo: string, quantidade = 2) {
  localStorage.clear(); sessionStorage.clear(); setTokens(`lote-${sufixo}`, 'refresh-fixture')
  localStorage.setItem('offiz:idioma:visitante', 'pt-BR')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Rede externa proibida nesta prova de lote') }))
  vi.stubGlobal('WebSocket', class { constructor() { throw new Error('WebSocket externo proibido') } })
  const fonte = { impacto: { versao: 1, itens: Array.from({ length: quantidade }, (_, i) => ({ id: 35 + i, titulo: `Fonte atual ${i + 1}`, campos: ['Data'] })) } as ImpactoLote,
    ler: undefined as undefined | ((path: string, signal?: AbortSignal) => Promise<unknown>) }
  vi.mocked(api.post).mockReset().mockResolvedValue({ jobs: [101] })
  vi.mocked(api.get).mockImplementation(async (path, signal) => {
    if (path.endsWith('/impacto')) return fonte.ler ? fonte.ler(path, signal) : JSON.parse(JSON.stringify(fonte.impacto))
    if (path.endsWith('/projetos')) return [projeto(1), projeto(2)]
    if (path.endsWith('/padroes')) return []
    return { itens: [], total: 0, resumo: { prontos: 0, precisa_de_voce: 0, em_producao: 0, aprovados: 0 } }
  })
  const view = (org = 1, conversa: number | null = 17) => <MemoryRouter initialEntries={['/?projeto=1']}><OutroProjetoLote /><BibliotecaProjetos orgId={org} conversaId={conversa} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>
  return { fonte, view, ...render(view()) }
}
async function abrirLote() {
  const resumo = await screen.findByText(/trabalhos? usa(?:m)? informações que mudaram/)
  resumo.closest('details')!.open = true
  return screen.getAllByRole('checkbox', { name: /Fonte atual/ })
}
const botaoLote = () => screen.getByRole('button', { name: /Pode atualizar \d+ trabalhos?/ })
async function perderAckLote() {
  const checks = await abrirLote()
  fireEvent.click(checks[0])
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(0, 'ACK sintético perdido'))
  fireEvent.click(botaoLote())
  await screen.findByText('A confirmação do envio não chegou. Confira a atualização antes de preparar outra.')
}

it('lote: clique duplo sincronizado faz um POST e não libera o primeiro envio pendente', async () => {
  bancadaLote('duplo')
  const pending = esperaLote<unknown>()
  vi.mocked(api.post).mockImplementation(() => pending.promise)
  const checks = await abrirLote(); fireEvent.click(checks[0]); fireEvent.click(checks[1])
  const enviar = botaoLote()
  act(() => { enviar.click(); enviar.click() })
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/orgs/1/projetos/1/atualizar', { versao: 1, jobs: [35, 36], conversa_id: 17 })
  expect(enviar).toBeDisabled(); expect(checks.every(c => c.hasAttribute('disabled'))).toBe(true)
  await act(async () => pending.resolve({ jobs: [101, 102] }))
  expect(screen.getByText('2 novas versões na fila.')).toBeInTheDocument()
  expect(checks.every(c => !(c as HTMLInputElement).checked)).toBe(true)
})

it('lote: ACK perdido exige GET explícito e conserva os controles quando a lista está vazia', async () => {
  const b = bancadaLote('incerto-vazio')
  await perderAckLote()
  expect(botaoLote()).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: /Fonte atual 1/ })).toBeChecked()
  const reads = vi.mocked(api.get).mock.calls.length
  b.fonte.impacto.itens = []
  fireEvent.click(screen.getByRole('button', { name: 'Conferir atualização' }))
  await screen.findByText(/Esta consulta não confirma o envio anterior nem recupera os IDs do lote/)
  expect(vi.mocked(api.get).mock.calls.length).toBe(reads + 1)
  expect(api.get).toHaveBeenLastCalledWith('/orgs/1/projetos/1/impacto', expect.any(AbortSignal))
  expect(screen.queryByRole('checkbox', { name: /Fonte atual/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Conferir atualização' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Preparar nova atualização' }))
  expect(screen.getByText(/Nova atualização preparada/)).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('lote: uma nova atualização escolhe fontes atuais e nunca reenvia o snapshot incerto automaticamente', async () => {
  const b = bancadaLote('fontes-novas')
  await perderAckLote()
  b.fonte.impacto.itens = [{ id: 77, titulo: 'Fonte atual nova', campos: ['Data'] }]
  fireEvent.click(screen.getByRole('button', { name: 'Conferir atualização' }))
  await screen.findByRole('button', { name: 'Preparar nova atualização' })
  expect(botaoLote()).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Preparar nova atualização' }))
  expect(api.post).toHaveBeenCalledTimes(1)
  fireEvent.click((await abrirLote())[0]); fireEvent.click(botaoLote())
  await screen.findByText('1 nova versão na fila.')
  expect(vi.mocked(api.post).mock.calls.map(([, body]) => body)).toEqual([
    { versao: 1, jobs: [35], conversa_id: 17 }, { versao: 1, jobs: [77], conversa_id: 17 },
  ])
})

it.each([
  ['sem resposta', null], ['sem IDs', {}], ['negativo', { jobs: [-1] }], ['zero', { jobs: [0] }],
  ['fracionário', { jobs: [1.5] }], ['inteiro inseguro', { jobs: [Number.MAX_SAFE_INTEGER + 1] }],
  ['repetidos', { jobs: [101, 101] }], ['lista curta', { jobs: [] }], ['lista longa', { jobs: [101, 102] }],
])('lote: confirmação %s não confirma o envio nem permite POST novo', async (_, resposta) => {
  bancadaLote(`ack-${_}`)
  const mudou = vi.fn(); window.addEventListener('offiz:biblioteca-mudou', mudou)
  try {
    const checks = await abrirLote(); fireEvent.click(checks[0])
    vi.mocked(api.post).mockResolvedValueOnce(resposta)
    fireEvent.click(botaoLote())
    await screen.findByRole('button', { name: 'Conferir atualização' })
    expect(botaoLote()).toBeDisabled(); expect(checks[0]).toBeChecked()
    expect(screen.queryByText(/novas? vers(?:ão|ões) na fila/)).not.toBeInTheDocument()
    expect(mudou).not.toHaveBeenCalled(); expect(api.post).toHaveBeenCalledTimes(1)
  } finally { window.removeEventListener('offiz:biblioteca-mudou', mudou) }
})

it.each([401, 403, 409, 422])('lote: recusa HTTP %i conserva o motivo e não vira confirmação incerta', async status => {
  bancadaLote(`recusa-${status}`)
  fireEvent.click((await abrirLote())[0])
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(status, `Recusa confirmada ${status}`))
  fireEvent.click(botaoLote())
  expect(await screen.findByText(`Recusa confirmada ${status}`)).toBeInTheDocument()
  expect(screen.queryByText(/A confirmação do envio não chegou/)).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each([
  ['versão', { versao: 0, itens: [] }], ['negativo', { versao: 1, itens: [{ id: -1, titulo: 'Fonte inválida', campos: [] }] }],
  ['duplicado', { versao: 1, itens: [{ id: 1, titulo: 'Fonte', campos: [] }, { id: 1, titulo: 'Fonte', campos: [] }] }],
  ['campos', { versao: 1, itens: [{ id: 1, titulo: 'Fonte', campos: [2] }] }],
])('lote: GET com %s inválido mantém a incerteza e não prepara novo envio', async (_, resposta) => {
  const b = bancadaLote(`get-${_}`); await perderAckLote()
  b.fonte.ler = async () => resposta
  fireEvent.click(screen.getByRole('button', { name: 'Conferir atualização' }))
  await screen.findByText('Não foi possível conferir a lista recebida. Tente a consulta novamente.')
  expect(botaoLote()).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Preparar nova atualização' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each([new ApiError(401, 'Acesso revogado na consulta'), new ApiError(503, 'Consulta indisponível'), new Error('Leitura perdida')])('lote: falha de GET conserva o bloqueio (%s)', async erro => {
  const b = bancadaLote(`get-erro-${erro.message}`); await perderAckLote()
  b.fonte.ler = async () => { throw erro }
  fireEvent.click(screen.getByRole('button', { name: 'Conferir atualização' }))
  expect(await screen.findByText(erro.message)).toBeInTheDocument()
  expect(botaoLote()).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Conferir atualização' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Preparar nova atualização' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each(['empresa', 'sessão', 'projeto', 'conversa', 'desmontagem'])('lote: ACK antigo após troca de %s não limpa a seleção nem libera a operação atual', async contexto => {
  const b = bancadaLote(`tarde-${contexto}`)
  const old = esperaLote<unknown>(), current = esperaLote<unknown>()
  vi.mocked(api.post).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
  fireEvent.click((await abrirLote())[0]); fireEvent.click(botaoLote())
  const corpoAnterior = JSON.parse(JSON.stringify(vi.mocked(api.post).mock.calls[0][1]))
  if (contexto === 'empresa') b.rerender(b.view(2))
  else if (contexto === 'sessão') { setTokens('lote-sessao-nova', 'refresh-fixture'); b.rerender(b.view()) }
  else if (contexto === 'projeto') fireEvent.click(screen.getByRole('button', { name: 'Outro projeto do lote' }))
  else if (contexto === 'conversa') b.rerender(b.view(1, 18))
  else { b.unmount(); render(b.view()) }
  const checks = await abrirLote(); fireEvent.click(checks[1]); fireEvent.click(botaoLote())
  expect(api.post).toHaveBeenCalledTimes(2)
  const mudou = vi.fn(); window.addEventListener('offiz:biblioteca-mudou', mudou)
  try {
    await act(async () => old.resolve({ jobs: [101] }))
    expect(mudou).not.toHaveBeenCalled(); expect(checks[1]).toBeChecked(); expect(botaoLote()).toBeDisabled()
    expect(screen.queryByText(/novas? vers(?:ão|ões) na fila/)).not.toBeInTheDocument()
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual(corpoAnterior)
    await act(async () => current.resolve({ jobs: [102] }))
    expect(screen.getByText('1 nova versão na fila.')).toBeInTheDocument()
    expect(mudou).toHaveBeenCalledTimes(1)
  } finally { window.removeEventListener('offiz:biblioteca-mudou', mudou) }
})

it('lote: notificação durante o POST não descarta um ACK válido do mesmo projeto e versão', async () => {
  bancadaLote('revisao-post')
  const pending = esperaLote<unknown>(); vi.mocked(api.post).mockImplementation(() => pending.promise)
  fireEvent.click((await abrirLote())[0]); fireEvent.click(botaoLote())
  act(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
  await act(async () => pending.resolve({ jobs: [101] }))
  expect(screen.getByText('1 nova versão na fila.')).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('lote: mudança de sessão sem remontagem impede confirmação e novo envio no DOM antigo', async () => {
  bancadaLote('sessao-sem-remontagem')
  const pending = esperaLote<unknown>(); vi.mocked(api.post).mockImplementation(() => pending.promise)
  fireEvent.click((await abrirLote())[0]); fireEvent.click(botaoLote())
  setTokens('sessao-alterada-sem-render', 'refresh-fixture')
  const mudou = vi.fn(); window.addEventListener('offiz:biblioteca-mudou', mudou)
  try {
    await act(async () => pending.resolve({ jobs: [101] }))
    fireEvent.click(botaoLote())
    expect(screen.queryByText(/novas? vers(?:ão|ões) na fila/)).not.toBeInTheDocument()
    expect(mudou).not.toHaveBeenCalled(); expect(api.post).toHaveBeenCalledTimes(1)
  } finally { window.removeEventListener('offiz:biblioteca-mudou', mudou) }
})

it('lote: outra versão do projeto não recebe o ACK da versão anterior', async () => {
  const b = bancadaLote('versao-alterada')
  const pending = esperaLote<unknown>(); vi.mocked(api.post).mockImplementation(() => pending.promise)
  fireEvent.click((await abrirLote())[0]); fireEvent.click(botaoLote())
  const getAnterior = vi.mocked(api.get).getMockImplementation()!
  b.fonte.impacto.versao = 2
  vi.mocked(api.get).mockImplementation((path, signal) => path.endsWith('/projetos') ? Promise.resolve([{ ...projeto(1), versao: 2 }]) : getAnterior(path, signal))
  act(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
  await waitFor(() => expect(botaoLote()).toHaveTextContent('Pode atualizar 0 trabalhos'))
  fireEvent.click(screen.getByRole('checkbox', { name: /Fonte atual 2/ }))
  const mudou = vi.fn(); window.addEventListener('offiz:biblioteca-mudou', mudou)
  try {
    await act(async () => pending.resolve({ jobs: [101] }))
    expect(screen.getByRole('checkbox', { name: /Fonte atual 2/ })).toBeChecked()
    expect(screen.queryByText(/novas? vers(?:ão|ões) na fila/)).not.toBeInTheDocument()
    expect(mudou).not.toHaveBeenCalled(); expect(api.post).toHaveBeenCalledTimes(1)
  } finally { window.removeEventListener('offiz:biblioteca-mudou', mudou) }
})

it('lote: GET antigo não substitui fontes novas após notificação nem libera a seleção', async () => {
  const b = bancadaLote('revisao-get'); await perderAckLote()
  const old = esperaLote<unknown>(); let consultas = 0
  b.fonte.ler = async () => ++consultas === 1 ? old.promise : { versao: 1, itens: [{ id: 88, titulo: 'Fonte atual depois da notificação', campos: ['Data'] }] }
  fireEvent.click(screen.getByRole('button', { name: 'Conferir atualização' }))
  act(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
  await screen.findByText('Fonte atual depois da notificação')
  await act(async () => old.resolve({ versao: 1, itens: [{ id: 77, titulo: 'Fonte antiga da consulta', campos: [] }] }))
  expect(screen.getByText('A lista mudou durante a consulta. Confira novamente.')).toBeInTheDocument()
  expect(screen.queryByText('Fonte antiga da consulta')).not.toBeInTheDocument()
  expect(botaoLote()).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Preparar nova atualização' })).not.toBeInTheDocument()
})

it.each(['empresa', 'desmontagem'])('lote: GET explícito é cancelado após %s e sua resposta não reaparece', async contexto => {
  const b = bancadaLote(`abortar-${contexto}`); await perderAckLote()
  const old = esperaLote<unknown>(); let signal!: AbortSignal
  b.fonte.ler = async (_, s) => { signal = s!; return old.promise }
  fireEvent.click(screen.getByRole('button', { name: 'Conferir atualização' }))
  await waitFor(() => expect(signal).toBeDefined())
  b.fonte.ler = undefined
  if (contexto === 'empresa') b.rerender(b.view(2)); else { b.unmount(); render(b.view()) }
  await abrirLote()
  expect(signal.aborted).toBe(true)
  await act(async () => old.resolve({ versao: 1, itens: [] }))
  expect(screen.queryByText(/Situação atual consultada/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Preparar nova atualização' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('lote: seleção limita o corpo a vinte IDs únicos e conserva conversa e versão', async () => {
  bancadaLote('limite', 21)
  const checks = await abrirLote()
  for (const campo of checks.slice(0, 20)) fireEvent.click(campo)
  expect(checks[20]).toBeDisabled()
  vi.mocked(api.post).mockResolvedValueOnce({ jobs: Array.from({ length: 20 }, (_, i) => 101 + i) })
  fireEvent.click(botaoLote())
  await screen.findByText('20 novas versões na fila.')
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/orgs/1/projetos/1/atualizar', { versao: 1, jobs: Array.from({ length: 20 }, (_, i) => 35 + i), conversa_id: 17 })
})

function bancadaAprovacaoVersao(sufixo: string) {
  localStorage.clear(); sessionStorage.clear(); setTokens(`aprovacao-versao-${sufixo}`, 'refresh-sintetico')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Rede externa proibida nesta prova') }))
  const fonte = {
    detalhe: { ...trabalho, aprovado: false, estado: 'pronto', qualidade: { estado: 'conferida', avisos: [], conferencias: [] }, arquivos: [
      { id: 92, nome: 'pendente.pdf', status: 'pendente' },
      { id: 93, nome: 'rejeitada.pdf', status: 'rejeitada' },
    ] },
    ler: undefined as undefined | (() => Promise<unknown>),
  }
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/biblioteca/35') ? fonte.ler ? fonte.ler() : fonte.detalhe
    : path.endsWith('/projetos') || path.endsWith('/padroes') ? [] : { itens: [], total: 0 })
  const view = (orgId = 1) => <MemoryRouter initialEntries={['/?trabalho=35']}><BibliotecaProjetos orgId={orgId} andares={[]} pedirNaConversa={vi.fn()} /></MemoryRouter>
  return { fonte, view, ...render(view()) }
}

it('aprovação da versão: o ACK parcial conserva a rejeição e não anuncia aprovação integral', async () => {
  const b = bancadaAprovacaoVersao('parcial')
  vi.mocked(api.post).mockImplementationOnce(async () => {
    b.fonte.detalhe = { ...b.fonte.detalhe, arquivos: [{ id: 92, nome: 'pendente.pdf', status: 'aprovada' }, b.fonte.detalhe.arquivos[1]] }
    return { ok: true, aprovadas: [92] }
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar esta versão' }))
  expect(await screen.findByText('Aprovação parcial. Os arquivos rejeitados ou pendentes permanecem sem aprovação.')).toBeInTheDocument()
  expect(screen.queryByText('Versão aprovada.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'rejeitada.pdf' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aprovar esta versão' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/35/entregas/aprovar', {})
})

it('aprovação da versão: só anuncia aprovação integral depois da releitura autoritativa', async () => {
  const b = bancadaAprovacaoVersao('integral'); const leitura = esperaLote<unknown>()
  b.fonte.detalhe = { ...b.fonte.detalhe, arquivos: [b.fonte.detalhe.arquivos[0]] }
  vi.mocked(api.post).mockImplementationOnce(async () => {
    b.fonte.ler = () => leitura.promise
    return { ok: true, aprovadas: [92] }
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar esta versão' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/orgs/1/biblioteca/35', expect.any(AbortSignal)))
  await act(async () => {})
  expect(screen.queryByText('Versão aprovada.')).not.toBeInTheDocument()
  const aprovado = { ...b.fonte.detalhe, aprovado: true, estado: 'aprovado', arquivos: [{ id: 92, nome: 'pendente.pdf', status: 'aprovada' }] }
  b.fonte.detalhe = aprovado; b.fonte.ler = undefined
  await act(async () => leitura.resolve(aprovado))
  expect(await screen.findByText('Versão aprovada.')).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('aprovação da versão: uma falha de GET após ACK oferece só releitura e conserva a decisão', async () => {
  const b = bancadaAprovacaoVersao('get-perdido')
  vi.mocked(api.post).mockImplementationOnce(async () => {
    b.fonte.detalhe = { ...b.fonte.detalhe, arquivos: [{ id: 92, nome: 'pendente.pdf', status: 'aprovada' }, b.fonte.detalhe.arquivos[1]] }
    b.fonte.ler = async () => { throw new ApiError(503, 'Consulta indisponível') }
    return { ok: true, aprovadas: [92] }
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar esta versão' }))
  expect(await screen.findByText(/Consulta indisponível.*Não foi possível confirmar a aprovação/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Aprovar esta versão' })).toBeDisabled()
  expect(screen.queryByText('Versão aprovada.')).not.toBeInTheDocument()
  b.fonte.ler = undefined
  fireEvent.click(screen.getByRole('button', { name: 'Conferir aprovação' }))
  await screen.findByText('Aprovação parcial. Os arquivos rejeitados ou pendentes permanecem sem aprovação.')
  expect(screen.queryByRole('button', { name: 'Conferir aprovação' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('aprovação da versão: falha na atualização da biblioteca conserva o detalhe confirmado sem restaurar a pendência anterior', async () => {
  const b = bancadaAprovacaoVersao('refresh-perdido'); let consultas = 0
  vi.mocked(api.post).mockImplementationOnce(async () => {
    const confirmado = { ...b.fonte.detalhe, arquivos: [{ id: 92, nome: 'pendente.pdf', status: 'aprovada' }, b.fonte.detalhe.arquivos[1]] }
    b.fonte.ler = async () => {
      if (++consultas === 1) return confirmado
      throw new ApiError(503, 'Atualização da biblioteca indisponível')
    }
    return { ok: true, aprovadas: [92] }
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar esta versão' }))
  await screen.findByText('Aprovação parcial. Os arquivos rejeitados ou pendentes permanecem sem aprovação.')
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Aprovar esta versão' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Conferir aprovação' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'rejeitada.pdf' })).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each([new Error('ACK perdido'), new ApiError(408, 'Envio interrompido'), new ApiError(502, 'Resposta indisponível')])('aprovação da versão: resposta perdida exige GET explícito sem repetir POST (%s)', async erro => {
  const b = bancadaAprovacaoVersao('ack-perdido')
  vi.mocked(api.post).mockRejectedValueOnce(erro)
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar esta versão' }))
  await screen.findByRole('button', { name: 'Conferir aprovação' })
  expect(screen.getByRole('button', { name: 'Aprovar esta versão' })).toBeDisabled()
  expect(screen.queryByText('Versão aprovada.')).not.toBeInTheDocument()
  b.fonte.detalhe = { ...b.fonte.detalhe, aprovado: true, estado: 'aprovado', arquivos: b.fonte.detalhe.arquivos.map(a => ({ ...a, status: 'aprovada' })) }
  fireEvent.click(screen.getByRole('button', { name: 'Conferir aprovação' }))
  await screen.findByText('Versão aprovada.')
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/35/entregas/aprovar', {})
})

it.each([
  { id: 36 },
  { office_slug: 'juris' },
  { aprovado: true },
  { arquivos: [] },
  { arquivos: [{ id: 92, nome: 'incompleto.pdf' }] },
  { arquivos: [{ id: 92, nome: 'um.pdf', status: 'aprovada' }, { id: 92, nome: 'duplicado.pdf', status: 'pendente' }] },
])('aprovação da versão: uma releitura incompleta ou contraditória não confirma o resultado %j', async invalido => {
  const b = bancadaAprovacaoVersao('leitura-invalida')
  vi.mocked(api.post).mockImplementationOnce(async () => {
    b.fonte.ler = async () => ({ ...b.fonte.detalhe, ...invalido })
    return { ok: true, aprovadas: [92] }
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar esta versão' }))
  await screen.findByText(/A consulta da aprovação está incompleta/)
  expect(screen.getByRole('button', { name: 'Conferir aprovação' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Aprovar esta versão' })).toBeDisabled()
  expect(screen.queryByText('Versão aprovada.')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('aprovação da versão: a releitura sem aprovação não transforma o ACK em sucesso', async () => {
  bancadaAprovacaoVersao('sem-aprovacao')
  vi.mocked(api.post).mockResolvedValueOnce({ ok: true, aprovadas: [92] })
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar esta versão' }))
  await screen.findByText('A aprovação desta versão não foi confirmada. Confira o estado de cada arquivo.')
  expect(screen.queryByText('Versão aprovada.')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each(['empresa', 'sessão', 'desmontagem'])('aprovação da versão: o ACK depois de trocar %s não inicia consulta nem confirma na tela nova', async contexto => {
  const b = bancadaAprovacaoVersao(`ack-${contexto}`); const ack = esperaLote<unknown>()
  vi.mocked(api.post).mockImplementationOnce(() => ack.promise)
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar esta versão' }))
  const leituras = vi.mocked(api.get).mock.calls.length
  if (contexto === 'empresa') b.rerender(b.view(2))
  else if (contexto === 'sessão') setTokens('aprovacao-outra-conta', 'refresh-sintetico')
  else b.unmount()
  await act(async () => {})
  const novasLeituras = vi.mocked(api.get).mock.calls.length - leituras
  await act(async () => ack.resolve({ ok: true, aprovadas: [92] }))
  expect(api.get).toHaveBeenCalledTimes(leituras + novasLeituras)
  expect(screen.queryByText(/Versão aprovada\.|Aprovação parcial/)).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each(['empresa', 'sessão', 'desmontagem'])('aprovação da versão: a confirmação antiga depois de trocar %s não aparece na tela nova', async contexto => {
  const b = bancadaAprovacaoVersao(`get-${contexto}`); const leitura = esperaLote<unknown>(); let signal!: AbortSignal
  vi.mocked(api.post).mockImplementationOnce(async () => {
    b.fonte.ler = () => leitura.promise
    return { ok: true, aprovadas: [92] }
  })
  const original = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path, s) => { if (b.fonte.ler && path === '/orgs/1/biblioteca/35') signal = s!; return original(path, s) })
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar esta versão' }))
  await waitFor(() => expect(signal).toBeDefined())
  b.fonte.ler = undefined
  if (contexto === 'empresa') b.rerender(b.view(2))
  else if (contexto === 'sessão') setTokens('aprovacao-outra-conta', 'refresh-sintetico')
  else b.unmount()
  await act(async () => leitura.resolve({ ...b.fonte.detalhe, aprovado: true, estado: 'aprovado', arquivos: b.fonte.detalhe.arquivos.map(a => ({ ...a, status: 'aprovada' })) }))
  expect(screen.queryByText(/Versão aprovada\.|Aprovação parcial/)).not.toBeInTheDocument()
  if (contexto !== 'sessão') expect(signal.aborted).toBe(true)
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('aprovação da versão: dois cliques sincronizados só registram uma decisão', async () => {
  bancadaAprovacaoVersao('duplo-clique'); const ack = esperaLote<unknown>()
  vi.mocked(api.post).mockImplementationOnce(() => ack.promise)
  const botao = await screen.findByRole('button', { name: 'Aprovar esta versão' })
  act(() => { botao.click(); botao.click() })
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/35/entregas/aprovar', {})
  await act(async () => ack.reject(new Error('ACK perdido')))
  expect(await screen.findByRole('button', { name: 'Conferir aprovação' })).toBeEnabled()
})
