import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ConversaTab } from './ConversaTab'
import { api } from '../../lib/api'
import type { ReferenciaConversa } from '../../lib/types'

vi.mock('../../lib/api', async (original) => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() },
}))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
const office = { slug: 'predio', nome: 'Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const conversa = { id: 42, organization_id: 1, office_slug: null, titulo: 'Nova conversa', mensagens: [], anexos: [] }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.put).mockResolvedValue({})
  localStorage.clear()
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/conversas/42') return conversa
    if (path.endsWith('/inicio')) return { andares: [{ slug: 'conteudo' }] }
    if (path.endsWith('/arquivos')) return { produto: [{ nome: 'foto.png', sub: 'campanha', legenda: 'Nossa equipe' }] }
    return { conversas: [] }
  })
  vi.mocked(api.post).mockImplementation(async (path) => {
    if (path.endsWith('/mensagens')) return { mensagem: { id: 9, role: 'assistant', conteudo: 'Envie o objetivo e os materiais.' } }
    if (path.endsWith('/acervo')) return { anexos: ['foto.png'] }
    return conversa
  })
})
const tela = (rascunho?: { texto: string; chave: number; referencia?: ReferenciaConversa }) => <MemoryRouter><ConversaTab orgId={1} slug="predio" office={office} nivelPredio rascunhoInicial={rascunho} inicioConteudo={<h1>Comece por uma entrega</h1>} /></MemoryRouter>

it('remove só a validação do pedido vazio ao escrever uma mensagem e conserva erros de envio', async () => {
  render(tela())
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Escreva sua mensagem antes de enviar.')
  fireEvent.change(campo, { target: { value: '   ' } })
  expect(screen.getByRole('alert')).toBeInTheDocument()
  fireEvent.change(campo, { target: { value: 'Faz a chamada do jogo.' } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await screen.findByRole('alert')
  const erro = screen.getByRole('alert').textContent
  fireEvent.change(campo, { target: { value: 'Faz a chamada do jogo com essas fotos.' } })
  expect(screen.getByRole('alert')).toHaveTextContent(erro!)
})

it('primeiro acesso abre a conversa fixada e leva ao lote correto sem gerar novamente', async () => {
  const detalhe = { ...conversa, fixada: true, titulo: 'Seus posts', trabalhos: [{
    id: 77, titulo: 'Cinco posts', status: 'done', entregas: Array.from({ length: 15 }, (_, i) => ({
      id: i + 1, nome: ['arte.png', 'legenda.docx', 'post.html'][i % 3], tipo: 'arquivo', status: 'pendente',
    })),
  }] }
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42'
    ? detalhe : path.endsWith('/conversas') ? { conversas: [detalhe] } : path === '/jobs/77' ? { id: 77, titulo: 'Cinco posts', status: 'done' } : { arquivos: [] })
  render(tela())
  expect(await screen.findByText('Pronto para revisar')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Meu próximo pedido ainda em rascunho.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ver entrega' }))
  expect(await screen.findByRole('complementary', { name: 'A entrega desta conversa' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Meu próximo pedido ainda em rascunho.')
  expect(screen.getAllByText('arte.png')).toHaveLength(1)
  expect(screen.getByText('+ 12 arquivos')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  expect(await screen.findByRole('heading', { name: 'Comece por uma entrega' })).toBeInTheDocument()
})

it('conversa preparada não toma o lugar de um novo pedido explícito', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/conversas')
    ? { conversas: [{ ...conversa, fixada: true, titulo: 'Seus posts' }] } : conversa)
  render(tela({ texto: 'Quero planejar a próxima semana.', chave: 1 }))
  await screen.findByText('Seus posts')
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Quero planejar a próxima semana.')
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/conversas/42')).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it('falha aparece uma vez, sem expor retorno técnico e com acesso ao trabalho', async () => {
  const detalhe = { ...conversa, titulo: 'Minhas pautas', trabalhos: [{
    id: 77, titulo: 'Pesquisa de pautas', status: 'failed', entregas: [],
    erro: 'unexpected status 413 Payload Too Large https://api.exemplo/segredo',
  }], mensagens: [
    { id: 1, role: 'user', conteudo: 'Quero cinco pautas.', criado_em: '2026-09-20T12:00:00' },
    { id: 2, role: 'assistant', conteudo: 'Poxa erro técnico https://api.exemplo/segredo',
      criado_em: '2026-09-20T12:01:00', sugestao_tarefa: { tipo: 'desfecho', status: 'failed', job_id: 77 } },
  ] }
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42'
    ? detalhe : path.endsWith('/conversas') ? { conversas: [detalhe] } : {})
  const verFluxo = vi.fn()
  render(<MemoryRouter><ConversaTab orgId={1} slug="predio" office={office} nivelPredio aoVerFluxo={verFluxo} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Minhas pautas'))
  expect(await screen.findByText('Quero cinco pautas.')).toBeInTheDocument()
  expect(screen.getAllByText('Não concluído')).toHaveLength(1)
  expect(screen.queryByText(/Payload Too Large|api.exemplo|Poxa erro/)).not.toBeInTheDocument()
  expect(screen.getByText(/A equipe Offiz precisa ajustar/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes do trabalho' }))
  expect(verFluxo).toHaveBeenCalledWith(77)
  expect(api.post).not.toHaveBeenCalled()
})

it.each([
  ['pendente', undefined, undefined, 'Pontos a revisar'],
  ['em_correcao', 78, undefined, 'Correção encaminhada'],
  ['em_correcao', 78, 'done', 'Correção encaminhada'],
  ['em_correcao', 78, 'running', 'Em correção'],
] as const)('desfecho %s apresenta conferência sem sinal verde indevido (%s/%s)', async (qualidade, correcaoId, statusCorrecao, rotulo) => {
  const detalhe = { ...conversa, fixada: true, titulo: 'Post da clínica', trabalhos: [{
    id: 77, titulo: 'Post sobre terapia', status: 'done', entregas: [
      { id: 1, nome: 'post.html', tipo: 'arquivo', status: 'pendente' },
    ],
  }, ...(statusCorrecao ? [{ id: 78, titulo: 'Corrigir a entrega', status: statusCorrecao, entregas: [] }] : [])], mensagens: [{
    id: 2, role: 'assistant', criado_em: '2026-10-03T12:00:00',
    conteudo: 'Pronto para revisar! copy.txt ausente; laudos sem hash.',
    sugestao_tarefa: { tipo: 'desfecho', status: 'done', job_id: 77, qualidade,
      correcao_job_id: correcaoId, pendencias: [{ nome: 'Post', detalhe: 'copy.txt ausente; laudos sem hash.' }] },
  }] }
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42'
    ? detalhe : path.endsWith('/conversas') ? { conversas: [detalhe] } : {})
  const verFluxo = vi.fn()
  render(<MemoryRouter><ConversaTab orgId={1} slug="predio" office={office} nivelPredio aoVerFluxo={verFluxo} /></MemoryRouter>)
  const pill = await screen.findByText(rotulo)
  expect(pill).not.toHaveClass('status-done')
  expect(screen.queryByText('Pronto para revisar')).not.toBeInTheDocument()
  const detalhes = screen.getByText('Detalhes da conferência').closest('details')!
  expect(detalhes).not.toHaveAttribute('open')
  expect(within(detalhes).getByText(/copy.txt ausente/)).not.toBeVisible()
  expect(screen.getByRole('button', { name: 'Ver entrega' })).toBeInTheDocument()
  if (correcaoId) {
    fireEvent.click(screen.getByRole('button', { name: 'Ver correção #78' }))
    expect(verFluxo).toHaveBeenCalledWith(78)
    expect(screen.getByText(/foi encaminhada no trabalho #78/)).toBeInTheDocument()
  }
  expect(api.post).not.toHaveBeenCalled()
})

it('aprovação humana permanece reconhecida mesmo com pendência histórica', async () => {
  const detalhe = { ...conversa, fixada: true, titulo: 'Post aprovado', trabalhos: [{
    id: 77, titulo: 'Post sobre terapia', status: 'done', entregas: [
      { id: 1, nome: 'post.html', tipo: 'arquivo', status: 'aprovada' },
    ],
  }], mensagens: [{ id: 2, role: 'assistant', criado_em: '2026-10-03T12:00:00', conteudo: 'Laudo antigo',
    sugestao_tarefa: { tipo: 'desfecho', status: 'done', job_id: 77, qualidade: 'pendente',
      pendencias: [{ detalhe: 'Conferência anterior à aprovação humana' }] },
  }] }
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42'
    ? detalhe : path.endsWith('/conversas') ? { conversas: [detalhe] } : {})
  render(tela())
  expect(await screen.findByText('Aprovado')).toHaveClass('status-done')
  expect(screen.getByRole('button', { name: 'Ver entrega' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('o pedido da biblioteca vincula a versão e a intenção antes de conversar', async () => {
  render(tela({ texto: 'Prepare um teste desta campanha.', chave: 1, referencia: { jobId: 77, entregaId: 88, intencao: 'testar' } }))
  fireEvent.click(await screen.findByRole('button', { name: 'Enviar' }))
  await screen.findByText('Envie o objetivo e os materiais.')
  expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', { job_id: 77, entrega_id: 88, intencao: 'testar' })
  const chamadasFoco = vi.mocked(api.put).mock.invocationCallOrder
  const foco = chamadasFoco[chamadasFoco.length - 1]
  const mensagem = vi.mocked(api.post).mock.calls.findIndex(([path]) => path.endsWith('/mensagens'))
  expect(foco).toBeLessThan(vi.mocked(api.post).mock.invocationCallOrder[mensagem])
})

it('falha no vínculo preserva o pedido e não conversa sobre outra entrega', async () => {
  vi.mocked(api.put).mockRejectedValue(new Error('Trabalho indisponível'))
  render(tela({ texto: 'Sobre a campanha selecionada.', chave: 1, referencia: { jobId: 77, intencao: 'discutir' } }))
  fireEvent.click(await screen.findByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Sobre a campanha selecionada.'))
  expect(vi.mocked(api.post).mock.calls.some(([path]) => path.endsWith('/mensagens'))).toBe(false)
})

it('trocar de conversa preserva a referência junto do rascunho', async () => {
  const getOriginal = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/orgs/1/predio/conversas') return { conversas: [{ ...conversa, id: 44, titulo: 'Outro assunto' }] }
    if (path === '/conversas/44') return { ...conversa, id: 44, titulo: 'Outro assunto' }
    return getOriginal(path)
  })
  render(tela({ texto: 'Prepare um teste desta campanha.', chave: 1, referencia: { jobId: 77, entregaId: 88, intencao: 'testar' } }))
  fireEvent.click(await screen.findByText('Outro assunto'))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue(''))
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Prepare um teste desta campanha.')
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await screen.findByText('Envie o objetivo e os materiais.')
  expect(api.put).toHaveBeenCalledWith('/conversas/42/trabalho', { job_id: 77, entrega_id: 88, intencao: 'testar' })
})

it('o material do acervo mostra o nome original e desambigua a pasta sem hash', async () => {
  vi.mocked(api.post).mockImplementation(async (path) => path.endsWith('/acervo') ? {
    anexos: ['conteudo-hash111-aurora.png', 'conteudo-hash222-aurora.png'],
    anexos_detalhes: [
      { nome: 'conteudo-hash111-aurora.png', nome_exibicao: 'aurora.png', origem_exibicao: 'conteudo / campanha' },
      { nome: 'conteudo-hash222-aurora.png', nome_exibicao: 'aurora.png', origem_exibicao: 'conteudo / equipe' },
    ],
  } : conversa)
  render(tela())
  fireEvent.click(await screen.findByRole('button', { name: 'Do acervo' }))
  fireEvent.click(await screen.findByRole('button', { name: /Nossa equipe/ }))
  const chips = within(await screen.findByLabelText('Arquivos anexados à conversa'))
  expect(chips.getAllByText('aurora.png')).toHaveLength(2)
  expect(chips.getByText(/conteudo \/ campanha/)).toBeInTheDocument()
  expect(chips.getByText(/conteudo \/ equipe/)).toBeInTheDocument()
  expect(chips.queryByText(/hash111|hash222/)).not.toBeInTheDocument()
})

it('a seleção de acervo também é registrada na conversa de área', async () => {
  render(<MemoryRouter><ConversaTab orgId={1} slug="conteudo" office={{ ...office, slug: 'conteudo' }} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Do acervo' }))
  fireEvent.click(await screen.findByRole('button', { name: /Nossa equipe/ }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/conversas/42/acervo', { andar: 'conteudo', pasta: 'produto', nome: 'foto.png', sub: 'campanha' }))
})

it('pedido de ajuste abre o contexto da entrega sem reiniciar a apresentação da empresa', async () => {
  vi.mocked(api.get).mockImplementation(async (path) => path === '/jobs/77'
    ? { id: 77, status: 'done', titulo: 'Kit Aurora', office_slug: 'conteudo' }
    : { conversas: [], entregas: [] })
  render(<MemoryRouter initialEntries={['/?ajustejob=77&ajustepeca=Kit%20Aurora']}><ConversaTab orgId={1} slug="predio" office={office} nivelPredio inicioConteudo={<h1>Comece por uma entrega</h1>} /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Ajustar esta entrega' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Comece por uma entrega' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Sobre a entrega “Kit Aurora”, o que eu gostaria de ajustar: ')
  expect(screen.getByRole('complementary', { name: 'Suas conversas' })).toBeInTheDocument()
  expect(screen.getByRole('complementary', { name: 'A entrega desta conversa' })).toHaveTextContent('Kit Aurora')
  expect(api.post).not.toHaveBeenCalled()
})

it('escolher solução prepara o pedido e preserva o texto escrito pelo cliente', async () => {
  const { rerender } = render(tela())
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Para minha reunião amanhã.' } })
  rerender(tela({ texto: 'Quero uma apresentação.', chave: 1 }))
  expect(campo).toHaveValue('Para minha reunião amanhã.\n\nQuero uma apresentação.')
  rerender(tela({ texto: '', chave: 2 }))
  expect(campo).toHaveValue('Para minha reunião amanhã.\n\nQuero uma apresentação.')
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await screen.findByText('Envie o objetivo e os materiais.')
  expect(vi.mocked(api.post).mock.calls.some(([path]) => path.includes('/jobs'))).toBe(false)
})

it('chat geral aceita arquivo antes de escolher a especialidade', async () => {
  vi.mocked(api.postForm).mockResolvedValue({ nome: 'brief.txt', legivel: true, anexos: ['brief.txt'] })
  const { container } = render(tela())
  await screen.findByRole('button', { name: 'Anexar' })
  const input = container.querySelector('input[type="file"][accept*=".mp4"]')!
  fireEvent.change(input, { target: { files: [new File(['Objetivo da campanha'], 'brief.txt', { type: 'text/plain' })] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalledWith('/conversas/42/anexos', expect.any(FormData)))
  expect(api.post).toHaveBeenCalledWith('/orgs/1/predio/conversas', undefined)
})

it('selecionar acervo mantém a origem e a subpasta sem executar trabalho', async () => {
  render(tela())
  fireEvent.click(await screen.findByRole('button', { name: 'Do acervo' }))
  fireEvent.click(await screen.findByRole('button', { name: /Nossa equipe/ }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/conversas/42/acervo', { andar: 'conteudo', pasta: 'produto', nome: 'foto.png', sub: 'campanha' }))
  expect(vi.mocked(api.post).mock.calls.some(([path]) => path.includes('/jobs'))).toBe(false)
})

it('seletor do acervo recebe foco e Escape devolve ao pedido sem apagar seu texto', async () => {
  render(tela())
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Use a identidade visual da campanha.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Do acervo' }))
  const busca = await screen.findByRole('searchbox', { name: 'Buscar no acervo' })
  expect(busca).toHaveFocus()
  fireEvent.keyDown(busca, { key: 'Escape' })
  expect(screen.queryByRole('region', { name: 'Anexar do acervo' })).not.toBeInTheDocument()
  expect(campo).toHaveFocus()
  expect(campo).toHaveValue('Use a identidade visual da campanha.')
})

it('permite escolher entre homônimos da mesma categoria pela subpasta visível', async () => {
  const getOriginal = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async (path) => path.endsWith('/arquivos')
    ? { produto: [
      { nome: 'aurora.png', sub: 'catalogo-a', legenda: 'Embalagem Aurora' },
      { nome: 'aurora.png', sub: 'catalogo-b', legenda: 'Embalagem Aurora' },
    ] }
    : getOriginal(path))
  render(tela())
  fireEvent.change(await screen.findByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Faz um post com essa foto.' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Do acervo' }))
  expect(await screen.findByRole('button', { name: /aurora\.png.*Embalagem Aurora.*O produto \/ catalogo-a/ })).toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar no acervo' }), { target: { value: 'catalogo-b' } })
  expect(screen.queryByRole('button', { name: /catalogo-a/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /aurora\.png.*Embalagem Aurora.*O produto \/ catalogo-b/ }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/conversas/42/acervo', {
    andar: 'conteudo', pasta: 'produto', nome: 'aurora.png', sub: 'catalogo-b',
  }))
  expect(screen.getByRole('textbox', { name: 'Seu pedido' })).toHaveValue('Faz um post com essa foto.\nUse o material aurora.png do meu acervo.')
  expect(vi.mocked(api.post).mock.calls.some(([path]) => path.endsWith('/mensagens'))).toBe(false)
  expect(vi.mocked(api.post).mock.calls.some(([path]) => path.includes('/jobs'))).toBe(false)
})

it('reabrir o seletor limpa só a busca; pesquisar com Enter não envia nem anexa', async () => {
  render(tela())
  const campo = await screen.findByRole('textbox', { name: 'Seu pedido' })
  fireEvent.change(campo, { target: { value: 'Faz uma chamada bonita pro jogo.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Do acervo' }))
  const busca = await screen.findByRole('searchbox', { name: 'Buscar no acervo' })
  fireEvent.change(busca, { target: { value: 'sem resultado' } })
  fireEvent.keyDown(busca, { key: 'Enter' })
  expect(api.post).not.toHaveBeenCalled()
  fireEvent.keyDown(busca, { key: 'Escape' })
  expect(campo).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Do acervo' }))
  expect(await screen.findByRole('searchbox', { name: 'Buscar no acervo' })).toHaveValue('')
  await screen.findByRole('button', { name: /foto.png.*Nossa equipe/ })
  expect(campo).toHaveValue('Faz uma chamada bonita pro jogo.')
  expect(api.post).not.toHaveBeenCalled()
})

it('trocar de empresa fecha o seletor e não apresenta resultados ou busca do contexto anterior', async () => {
  const getOriginal = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async path => path === '/predios/2/conteudo/arquivos'
    ? { marca: [{ nome: 'manual-da-outra-empresa.pdf', legenda: 'Outra identidade' }] }
    : getOriginal(path))
  const componente = (orgId: number) => <MemoryRouter><ConversaTab orgId={orgId} slug="predio" office={office} nivelPredio /></MemoryRouter>
  const view = render(componente(1))
  fireEvent.click(await screen.findByRole('button', { name: 'Do acervo' }))
  await screen.findByRole('button', { name: /foto.png.*Nossa equipe/ })
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar no acervo' }), { target: { value: 'Nossa equipe' } })
  view.rerender(componente(2))
  expect(screen.queryByRole('region', { name: 'Anexar do acervo' })).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'Do acervo' }))
  expect(await screen.findByRole('searchbox', { name: 'Buscar no acervo' })).toHaveValue('')
  await screen.findByRole('button', { name: /manual-da-outra-empresa.pdf/ })
  expect(screen.queryByRole('button', { name: /foto.png.*Nossa equipe/ })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('atualiza as sugestões quando o chat informa novos aprendizados', async () => {
  const aoContextoAtualizado = vi.fn()
  vi.mocked(api.post).mockImplementation(async (path) => path.endsWith('/mensagens')
    ? { mensagem: { id: 10, role: 'assistant', conteudo: 'Guardei esse ponto de partida.' }, solucoes_atualizadas: ['aprendida-1'] }
    : conversa)
  render(<MemoryRouter><ConversaTab orgId={1} slug="predio" office={office} nivelPredio aoContextoAtualizado={aoContextoAtualizado} /></MemoryRouter>)
  fireEvent.change(await screen.findByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Toda segunda preparo a apresentação da equipe.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await screen.findByText('Guardei esse ponto de partida.')
  expect(aoContextoAtualizado).toHaveBeenCalledTimes(1)
})

it('mostra perfil e tarefa do mesmo turno, sem salvar nem produzir automaticamente', async () => {
  const extra = { id: 12, role: 'assistant', conteudo: 'Confira o perfil que organizei.', sugestao_tarefa: { tipo: 'canon', resumo: 'Perfil da clínica', secoes: [{ secao: 'Tom de voz', conteudo: 'Direto e acolhedor.' }] } }
  vi.mocked(api.post).mockImplementation(async path => path.endsWith('/mensagens') ? {
    mensagem: { id: 11, role: 'assistant', conteudo: 'Posso preparar o post.', sugestao_tarefa: { office_slug: 'conteudo', titulo: 'Post da semana', prompt: 'Produzir post sobre ansiedade.' } },
    mensagens_extras: [extra, extra],
  } : conversa)
  const getOriginal = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/conhecimento/canon') ? { conteudo: '## Tom de voz\nFormal.' } : getOriginal(path))
  render(<MemoryRouter><ConversaTab orgId={1} slug="predio" office={office} nivelPredio meuPapel="owner" /></MemoryRouter>)
  fireEvent.change(await screen.findByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Sou psicóloga. Faz um post sobre ansiedade.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  expect(await screen.findByText('Posso preparar o post.')).toBeInTheDocument()
  expect(await screen.findByText('Formal.')).toBeInTheDocument()
  expect(screen.getAllByRole('region', { name: 'Confira o perfil' })).toHaveLength(1)
  expect(screen.getByRole('textbox', { name: 'Texto de Tom de voz' })).toHaveValue('Direto e acolhedor.')
  expect(vi.mocked(api.post).mock.calls.every(([path]) => !path.endsWith('/confirmar') && !path.includes('/jobs'))).toBe(true)
  expect(api.put).not.toHaveBeenCalled()
})
