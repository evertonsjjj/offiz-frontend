import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, baixarArquivo, clearTokens, getSessionIdentity, setTokens, AUTH_CREDENTIALS_KEY } from '../../lib/api'
import { PainelTrabalho } from './PainelTrabalho'
import * as idioma from '../../lib/i18n'

vi.mock('../../lib/api', async (original) => ({
  ...await original<typeof import('../../lib/api')>(),
  api: { get: vi.fn(), post: vi.fn() }, baixarArquivo: vi.fn(),
}))
vi.mock('./ResultadoEntrega', () => ({ default: ({ nome, entregaId }: { nome: string; entregaId: number }) => <div data-testid={`previa-${entregaId}`}>Preview: {nome}</div> }))
const job = { id: 77, status: 'done', titulo: 'Vídeo da campanha', office_slug: 'conteudo' }
const entrega = { id: 9, job_id: 77, nome: 'campanha-com-legenda.mp4', mime: 'video/mp4', status: 'pendente', tipo: 'arquivo' }
const montar = () => render(<PainelTrabalho orgId={1} slug="predio" jobId={77} aoAjustar={vi.fn()} aoFechar={vi.fn()} />)

it('abre a imagem custom do mesmo post e conserva a escolha de texto durante refresh', async () => {
  const arquivos = [
    { ...entrega, id: 9, nome: 'feed-editavel.svg', mime: 'image/svg+xml', editorial_peca_id: 4 },
    { ...entrega, id: 10, nome: 'post.html', mime: 'text/html', editorial_peca_id: 4 },
    { ...entrega, id: 11, nome: 'feed.png', mime: 'image/png', editorial_peca_id: 4 },
    { ...entrega, id: 12, nome: 'story.png', mime: 'image/png', editorial_peca_id: 4 },
    { ...entrega, id: 13, nome: 'arte.png', mime: 'image/png', editorial_peca_id: 5 },
  ]
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos })
  montar()
  expect(await screen.findByTestId('previa-11')).toHaveTextContent('feed.png')
  expect(screen.getByRole('tab', { name: 'feed · editável' })).toHaveAttribute('aria-selected', 'false')
  fireEvent.click(screen.getByRole('tab', { name: 'Ler post' }))
  expect(screen.getByTestId('previa-10')).toHaveTextContent('post.html')
  await act(async () => window.dispatchEvent(new Event('offiz:entregas-mudou')))
  expect(screen.getByTestId('previa-10')).toBeInTheDocument()
  expect(screen.queryByTestId('previa-13')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('lote grande permite abrir todos os arquivos sem aprovar os que não foram revisados', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : {
    arquivos: Array.from({ length: 15 }, (_, i) => ({ ...entrega, id: i + 50, nome: `post-${i}.png`, mime: 'image/png' })),
  })
  montar()
  const abrir = await screen.findByRole('link', { name: 'Ver entrega completa' })
  expect(abrir).toHaveAttribute('href', '/app?org=1&vista=biblioteca&trabalho=77&arquivo=50')
  expect(screen.getByRole('link', { name: 'Revisar e aprovar as entregas' })).toHaveAttribute('href', '/app?org=1&vista=biblioteca&trabalho=77&arquivo=50')
  expect(screen.getByText('Preview: post-0.png')).toBeInTheDocument()
  const seletor = screen.getByRole('combobox', { name: 'Arquivo em exibição' })
  expect(within(seletor).getAllByRole('option')).toHaveLength(15)
  fireEvent.change(seletor, { target: { value: '64' } })
  expect(screen.getByText('Preview: post-14.png')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Baixar todos os arquivos' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledWith('/orgs/1/biblioteca/77/download', 'trabalho-77.zip'))
  expect(screen.queryByRole('button', { name: /Está bom/ })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['conteudo', 'juris', 'predio'])('abrir a entrega conserva o contexto %s sem inferir a área pelo executor', async slug => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? { ...job, office_slug: 'financeiro', conversa_id: 999 } : {
    arquivos: Array.from({ length: 7 }, (_, i) => ({ ...entrega, id: 50 + i, nome: `post-${i}.png`, mime: 'image/png' })),
  })
  render(<PainelTrabalho orgId={33} slug={slug} jobId={77} aoAjustar={vi.fn()} aoFechar={vi.fn()} />)
  const link = await screen.findByRole('link', { name: 'Ver entrega completa' })
  const endereco = new URL(link.getAttribute('href')!, 'https://test.invalid')
  expect(endereco.searchParams.get('org')).toBe('33')
  expect(endereco.searchParams.get('trabalho')).toBe('77')
  expect(endereco.searchParams.get('arquivo')).toBe('50')
  expect(endereco.searchParams.get('slug')).toBe(slug === 'predio' ? null : slug)
  expect(endereco.searchParams.has('conversa')).toBe(false)
  expect(endereco.searchParams.has('area')).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it('mantém o erro técnico recolhido e orienta antes de uma nova execução', async () => {
  const erro = 'unexpected status 413 Payload Too Large: https://api.offiz.com.br/managed/openai/v1/responses'
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? { ...job, status: 'failed', erro } : { arquivos: [] })
  montar()
  expect(await screen.findByText(/O contexto deste trabalho excedeu um limite/)).toBeVisible()
  expect(screen.getByText(erro)).not.toBeVisible()
  fireEvent.click(screen.getByText('Detalhes técnicos'))
  expect(screen.getByText(erro)).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
})

it('carrossel de cinco páginas e quatro apoios usa seletor compacto e conserva a escolha no refresh', async () => {
  const arquivos = ['post.html', 'legenda.docx', 'card-01.png', 'card-02.png', 'card-03.png', 'card-04.png', 'card-05.png', 'fontes.pdf', 'projeto.svg']
    .map((nome, i) => ({ ...entrega, id: 50 + i, nome, mime: nome.endsWith('.png') ? 'image/png' : 'application/octet-stream' }))
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos })
  montar()
  expect(await screen.findByTestId('previa-52')).toHaveTextContent('card-01.png')
  const seletor = screen.getByRole('combobox', { name: 'Arquivo em exibição' })
  expect(within(seletor).getAllByRole('option')).toHaveLength(9)
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Próxima imagem' }))
  expect(screen.getByTestId('previa-53')).toHaveTextContent('card-02.png')
  expect(seletor).toHaveValue('53')
  fireEvent.change(seletor, { target: { value: '51' } })
  expect(screen.getByRole('region', { name: 'Prévia: legenda.docx' })).toHaveTextContent('Preview: legenda.docx')
  expect(screen.queryByLabelText('Sequência do carrossel')).not.toBeInTheDocument()
  await act(async () => window.dispatchEvent(new Event('offiz:entregas-mudou')))
  expect(seletor).toHaveValue('51')
  expect(screen.getByTestId('previa-51')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('identifica arquivos de um kit mesmo quando todos terminam com o mesmo job', async () => {
  const nomes = ['apresentacao-aferia-kit-10-09-2026-job-77.pdf', 'apresentacao-aferia-kit-10-09-2026-job-77.pptx', 'post-01-aferia-10-09-2026-job-77.png', 'post-02-aferia-10-09-2026-job-77.png']
  vi.mocked(api.get).mockImplementation(async (path) => path === '/jobs/77' ? job : { arquivos: nomes.map((nome,i) => ({ ...entrega, id: i+50, nome, mime: 'application/octet-stream' })) })
  montar()
  const pdf = await screen.findByRole('tab', { name: 'apresentacao aferia kit · PDF' })
  expect(screen.getByRole('tab', { name: 'apresentacao aferia kit · PPTX' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'post 02 aferia · PNG' }))
  expect(screen.getByRole('tabpanel')).toHaveTextContent(nomes[3])
  expect(pdf).toHaveAttribute('aria-selected', 'false')
  expect(screen.queryByRole('tab', { name: 'job 77' })).not.toBeInTheDocument()
})
beforeEach(() => {
  vi.resetAllMocks()
  setTokens('fixture-access', 'fixture-refresh')
  vi.mocked(api.get).mockImplementation(async (path) => path === '/jobs/77' ? job : { arquivos: [entrega], qualidade: { estado: 'conferida', avisos: [] } })
})
afterEach(() => { clearTokens(); localStorage.clear() })

it('painel aberto aguarda consolidação e continua consultando sem depender do websocket', async () => {
  vi.useFakeTimers()
  try {
    let finalizando = true
    const saiu = vi.fn()
    vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? { ...job, finalizando }
      : { arquivos: [entrega], qualidade: { estado: 'conferida', avisos: [] } })
    render(<PainelTrabalho orgId={1} slug="predio" jobId={77} aoAjustar={vi.fn()} aoFechar={vi.fn()} aoSairDeVoo={saiu} />)
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText('Organizando arquivos')).toBeInTheDocument()
    expect(screen.queryByText(/Terminou sem gerar arquivo/)).not.toBeInTheDocument()
    expect(screen.queryByText('concluído')).not.toBeInTheDocument()
    expect(saiu).not.toHaveBeenCalled()
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/biblioteca/77'))).toBe(false)
    expect(screen.queryByRole('button', { name: /Está bom/ })).not.toBeInTheDocument()
    finalizando = false
    await act(async () => vi.advanceTimersByTimeAsync(4000))
    expect(screen.getByTestId('previa-9')).toBeInTheDocument()
    expect(screen.queryByText('Organizando arquivos')).not.toBeInTheDocument()
    expect(saiu).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'done', finalizando: false }))
    const consultas = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/jobs/77').length
    await act(async () => vi.advanceTimersByTimeAsync(8000))
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/jobs/77')).toHaveLength(consultas)
    expect(api.post).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})

it('percorre os cinco posts e seus três formatos com ajuste e download ligados ao arquivo escolhido', async () => {
  const pecas = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, titulo: `Tema ${i + 1}` }))
  const arquivos = pecas.flatMap(p => ['arte.png', 'legenda.docx', 'post.html'].map((nome, i) => ({ ...entrega, id: p.id * 10 + i, nome, mime: undefined, editorial_peca_id: p.id })))
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos, pecas_editoriais: pecas })
  const ajustar = vi.fn()
  render(<PainelTrabalho orgId={1} slug="predio" jobId={77} aoAjustar={ajustar} aoFechar={vi.fn()} />)
  const escolher = await screen.findByRole('combobox', { name: 'Escolher post' })
  expect(screen.getAllByRole('option')).toHaveLength(5)
  expect(screen.getAllByRole('tab').map(e => e.textContent)).toEqual(['Ler post', 'Arte', 'Legenda em Word'])
  expect(screen.getByRole('tablist', { name: 'Arquivos desta entrega' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Revisar e aprovar este post' })).toHaveAttribute('href', '/app?org=1&vista=biblioteca&trabalho=77&arquivo=10')
  expect(screen.getByRole('button', { name: 'Post anterior' })).toBeDisabled()
  for (let p = 1; p <= 5; p++) {
    fireEvent.change(escolher, { target: { value: String(p - 1) } })
    expect(screen.getByTestId(`previa-${p * 10}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Ler post' }))
    expect(screen.getByTestId(`previa-${p * 10 + 2}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Arte' }))
    expect(screen.getByTestId(`previa-${p * 10}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Legenda em Word' }))
    expect(screen.getByTestId(`previa-${p * 10 + 1}`)).toBeInTheDocument()
  }
  expect(screen.getByRole('button', { name: 'Próximo post' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste neste post' }))
  expect(ajustar).toHaveBeenCalledWith('Sobre o post “Tema 5” (legenda.docx), quero ajustar: ', 51)
  fireEvent.click(screen.getByRole('button', { name: 'Baixar Word' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledWith('/entregas/51/download', 'legenda.docx'))
  fireEvent.click(screen.getByRole('button', { name: 'Post anterior' }))
  expect(screen.getByTestId('previa-40')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Está bom/ })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('mantém arquivos extras acessíveis fora dos grupos de posts e não lista bastidores', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : {
    arquivos: [{ ...entrega, nome: 'arte.png', editorial_peca_id: 4 }, { ...entrega, id: 10, nome: 'pautas.docx' }, { ...entrega, id: 11, nome: 'interno.json', tipo: 'interno' }],
    pecas_editoriais: [{ id: 4, titulo: 'Post principal' }],
  })
  montar()
  fireEvent.change(await screen.findByRole('combobox', { name: 'Escolher post' }), { target: { value: '1' } })
  expect(screen.getByTestId('previa-10')).toBeInTheDocument()
  expect(screen.getByRole('option', { name: '2. Outros arquivos' })).toBeInTheDocument()
  expect(screen.queryByText(/interno.json/)).not.toBeInTheDocument()
})

it('permite recuperar falha inicial de status sem fechar a conversa nem iniciar outro trabalho', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(503, 'A conexão caiu.'))
  montar()
  expect(await screen.findByRole('alert')).toHaveTextContent('A conexão caiu.')
  expect(screen.getByText('Entrega')).toBeInTheDocument()
  expect(screen.queryByText('Produção em andamento')).not.toBeInTheDocument()
  expect(screen.queryByText('Consultando entrega…')).not.toBeInTheDocument()
  expect(screen.queryByText(/O escritório está trabalhando/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByText(`Preview: ${entrega.nome}`)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Voltar à conversa' })).toBeInTheDocument()
})

it('recupera falha de listagem de entregas em trabalho concluído', async () => {
  let falhar = true
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/jobs/77') return job
    if (falhar) throw new ApiError(503, 'Não consegui listar as peças.')
    return { arquivos: [entrega] }
  })
  montar()
  await screen.findByRole('alert')
  falhar = false
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByText(`Preview: ${entrega.nome}`)
  expect(api.post).not.toHaveBeenCalled()
})

it('erro de download fica explícito e permite tentar baixar novamente', async () => {
  vi.mocked(baixarArquivo).mockRejectedValueOnce(new ApiError(503, 'Não foi possível baixar agora.')).mockResolvedValue(undefined)
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Baixar' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível baixar agora.')
  fireEvent.click(screen.getByRole('button', { name: 'Baixar' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('troca de versão por teclado move seleção e foco para a peça correspondente', async () => {
  vi.mocked(api.get).mockImplementation(async (path) => path === '/jobs/77' ? job : { arquivos: [entrega, { ...entrega, id: 10, nome: 'campanha-sem-legenda.mp4' }] })
  montar()
  const primeira = await screen.findByRole('tab', { name: 'com legenda' })
  primeira.focus()
  fireEvent.keyDown(primeira, { key: 'ArrowRight' })
  const segunda = screen.getByRole('tab', { name: 'sem legenda' })
  expect(segunda).toHaveFocus()
  expect(segunda).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tabpanel')).toHaveTextContent('campanha-sem-legenda.mp4')
  expect(screen.queryByText('Preview: campanha-com-legenda.mp4')).not.toBeInTheDocument()
})

it('abre os cards originais do carrossel e percorre a ordem sem confundir ajuste ou download', async () => {
  const arquivos = ['card-03.png', 'post.html', 'card-01.png', 'card-02.png'].map((nome, i) => ({ ...entrega, id: i + 50, nome, mime: nome.endsWith('.png') ? 'image/png' : 'text/html' }))
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos })
  const ajustar = vi.fn()
  render(<PainelTrabalho orgId={1} slug="predio" jobId={77} aoAjustar={ajustar} aoFechar={vi.fn()} />)
  expect(await screen.findByTestId('previa-52')).toBeInTheDocument()
  expect(screen.getByText('Imagem 1 de 3')).toBeInTheDocument()
  expect(screen.getAllByRole('tab').map(aba => aba.getAttribute('title'))).toEqual(['card-01.png', 'post.html', 'card-02.png', 'card-03.png'])
  expect(screen.getByRole('button', { name: 'Imagem anterior' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Próxima imagem' }))
  expect(screen.getByTestId('previa-53')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Próxima imagem' }))
  expect(screen.getByTestId('previa-50')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Próxima imagem' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  expect(ajustar).toHaveBeenCalledWith('Sobre “card-03.png”, quero ajustar: ', 50)
  fireEvent.click(screen.getByRole('button', { name: 'Baixar' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledWith('/entregas/50/download', 'card-03.png'))
  fireEvent.click(screen.getByRole('tab', { name: 'post · HTML' }))
  expect(screen.queryByLabelText('Sequência do carrossel')).not.toBeInTheDocument()
  expect(screen.getByTestId('previa-51')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('mostra a arte do post primeiro e conserva o HTML escolhido durante uma atualização de arquivos', async () => {
  const arquivos = ['post.html', 'arte.png', 'legenda.docx'].map((nome, i) => ({ ...entrega, id: 90 + i, nome, mime: undefined, editorial_peca_id: 12 }))
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos, pecas_editoriais: [{ id: 12, titulo: 'A casa que canta' }] })
  const props = { orgId: 1, jobId: 77, aoAjustar: vi.fn(), aoFechar: vi.fn() }
  const { rerender } = render(<PainelTrabalho {...props} slug="predio" />)
  expect(await screen.findByTestId('previa-91')).toBeInTheDocument()
  expect(screen.getByText('Entrega para revisar')).toBeInTheDocument()
  expect(screen.getByText('Vídeo da campanha')).toBeInTheDocument()
  expect(screen.getByText('#77')).toBeInTheDocument()
  const revisar = screen.getByRole('link', { name: 'Revisar e aprovar este post' })
  expect(revisar).toHaveAttribute('href', '/app?org=1&vista=biblioteca&trabalho=77&arquivo=91')
  expect(revisar).toHaveAttribute('title', expect.stringContaining('A casa que canta'))
  fireEvent.click(screen.getByRole('tab', { name: 'Ler post' }))
  expect(screen.getByTestId('previa-90')).toBeInTheDocument()
  const consultasAntes = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/1/biblioteca/77').length
  rerender(<PainelTrabalho {...props} slug="conteudo" />)
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/1/biblioteca/77')).toHaveLength(consultasAntes + 1))
  expect(screen.getByTestId('previa-90')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Baixar' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledWith('/entregas/90/download', 'post.html'))
  expect(api.post).not.toHaveBeenCalled()
})

it('conserva o vídeo como primeira mídia quando um trabalho genérico também entrega arte.png', async () => {
  const arquivos = [
    { ...entrega, nome: 'video.mp4' },
    { ...entrega, id: 10, nome: 'arte.png', mime: 'image/png' },
  ]
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos })
  montar()
  expect(await screen.findByTestId('previa-9')).toHaveTextContent('Preview: video.mp4')
  expect(screen.queryByTestId('previa-10')).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'video · MP4' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('tab', { name: 'arte · PNG' }))
  expect(screen.getByTestId('previa-10')).toHaveTextContent('Preview: arte.png')
  expect(screen.queryByTestId('previa-9')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('priorizar a arte não troca o post inicialmente escolhido nem seu carrossel por outra peça', async () => {
  const arquivos = [
    { ...entrega, id: 50, nome: 'arte.png', editorial_peca_id: 2 },
    { ...entrega, id: 51, nome: 'post.html', editorial_peca_id: 1 },
    { ...entrega, id: 52, nome: 'arte.png', editorial_peca_id: 1 },
    { ...entrega, id: 53, nome: 'card-02.png', editorial_peca_id: 1 },
    { ...entrega, id: 54, nome: 'card-01.png', editorial_peca_id: 1 },
  ]
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos, pecas_editoriais: [{ id: 1, titulo: 'Primeiro post' }, { id: 2, titulo: 'Segundo post' }] })
  montar()
  expect(await screen.findByTestId('previa-54')).toBeInTheDocument()
  expect(screen.getByText('Imagem 1 de 2')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Escolher post' })).toHaveValue('1')
  fireEvent.click(screen.getByRole('button', { name: 'Imagem anterior' }))
  expect(screen.getByTestId('previa-54')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Próxima imagem' }))
  expect(screen.getByTestId('previa-53')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('uma entrega já aprovada não é apresentada como aguardando revisão', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos: [{ ...entrega, status: 'aprovada' }] })
  montar()
  expect(await screen.findByText('Entrega aprovada')).toBeInTheDocument()
  expect(screen.getByText('aprovada', { exact: true })).toHaveClass('status-done')
  expect(screen.queryByText('Entrega para revisar')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Revisar e aprovar/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Está bom/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Baixar' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Baixar todos os arquivos' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('conclusão técnica com entrega pendente mostra para revisar sem selo pronto', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : {
    arquivos: [entrega], qualidade: { estado: 'parcial', avisos: ['Confira o recorte.'] },
  })
  montar()
  await screen.findByText('Entrega para revisar')
  expect(screen.getByText('para revisar', { exact: true })).toHaveClass('entrega-pendente')
  expect(screen.queryByText('pronto', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Revisar esta entrega' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('aprovação direta mantém o endpoint original e atualiza o estado sem iniciar outro trabalho', async () => {
  vi.mocked(api.post).mockResolvedValue({ ok: true, aprovadas: [9], licao_registrada: false })
  let aprovada = false
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : {
    arquivos: [{ ...entrega, status: aprovada ? 'aprovada' : 'pendente' }], qualidade: { estado: 'conferida', avisos: [] },
  })
  montar()
  await screen.findByText('Entrega para revisar')
  const aprovar = screen.getByRole('button', { name: 'Está bom — aprovar' })
  const rodape = aprovar.closest('footer')!
  expect(rodape).toContainElement(screen.getByRole('button', { name: 'Baixar' }))
  expect(rodape).toContainElement(screen.getByRole('button', { name: 'Pedir ajuste' }))
  expect(screen.getAllByRole('button', { name: 'Pedir ajuste' })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Baixar todos os arquivos' })).not.toBeInTheDocument()
  aprovada = true
  fireEvent.click(aprovar)
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/77/entregas/aprovar', {}))
  expect(await screen.findByText('Entrega aprovada')).toBeInTheDocument()
  expect(screen.queryByText('Entrega para revisar')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Está bom/ })).not.toBeInTheDocument()
})

it('a consulta inicial não afirma que a produção começou antes de receber o trabalho', () => {
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}))
  montar()
  expect(screen.getByText('Consultando entrega…')).toBeInTheDocument()
  expect(screen.queryByText('Produção em andamento')).not.toBeInTheDocument()
  expect(screen.queryByText('Entrega para revisar')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it.each([
  ['sem conferência', undefined],
  ['conferência parcial', { estado: 'parcial', avisos: [] }],
  ['aviso registrado', { estado: 'conferida', avisos: ['Confira a leitura no celular.'] }],
  ['revisão pendente', { estado: 'conferida', avisos: [], revisao_automatica: { estado: 'em_fila' } }],
])('leva à revisão completa quando há %s, sem aprovar a versão', async (_nome, qualidade) => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos: [entrega], qualidade })
  montar()
  expect(await screen.findByRole('link', { name: 'Revisar esta entrega' })).toHaveAttribute('href', '/app?org=1&vista=biblioteca&trabalho=77&arquivo=9')
  expect(screen.queryByRole('button', { name: /Está bom/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Baixar' })).toBeEnabled()
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['newsletter', 'conhecimento'])('mostra a revisão completa antes da aprovação com efeito de %s', async origem => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos: [entrega], origem, qualidade: { estado: 'conferida', avisos: [] } })
  montar()
  await screen.findByRole('link', { name: 'Revisar esta entrega' })
  expect(screen.queryByRole('button', { name: /Está bom/ })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('trocar de trabalho oculta arquivo e aprovação antigos antes de chegar a nova consulta', async () => {
  let concluir!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(path => path === '/jobs/78' ? new Promise(resolve => { concluir = resolve }) : Promise.resolve(path === '/jobs/77' ? job : { arquivos: [entrega], qualidade: { estado: 'conferida', avisos: [] } }))
  const props = { orgId: 1, slug: 'predio', aoAjustar: vi.fn(), aoFechar: vi.fn() }
  const { rerender } = render(<PainelTrabalho {...props} jobId={77} />)
  await screen.findByRole('button', { name: 'Está bom — aprovar' })
  rerender(<PainelTrabalho {...props} jobId={78} />)
  expect(screen.queryByTestId('previa-9')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Está bom/ })).not.toBeInTheDocument()
  expect(screen.getByText('Consultando entrega…')).toBeInTheDocument()
  await act(async () => { concluir({ ...job, id: 78, status: 'failed' }) })
  expect(screen.queryByRole('button', { name: /Está bom/ })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('o vídeo principal mantém a prioridade sobre uma sequência auxiliar de cards', async () => {
  const arquivos = [entrega, ...['card-01.png', 'card-02.png'].map((nome, i) => ({ ...entrega, id: 20 + i, nome, mime: 'image/png' }))]
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos })
  montar()
  expect(await screen.findByTestId('previa-9')).toBeInTheDocument()
  expect(screen.queryByLabelText('Sequência do carrossel')).not.toBeInTheDocument()
})

it('o único pedido de ajuste usa o arquivo escolhido, enquanto o ZIP permanece restrito ao kit', async () => {
  const arquivos = [entrega, { ...entrega, id: 10, nome: 'campanha-sem-legenda.mp4' }]
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos })
  const ajustar = vi.fn()
  render(<PainelTrabalho orgId={1} slug="predio" jobId={77} aoAjustar={ajustar} aoFechar={vi.fn()} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'sem legenda' }))
  expect(screen.getAllByRole('button', { name: 'Pedir ajuste' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  expect(ajustar).toHaveBeenCalledExactlyOnceWith('Sobre “campanha-sem-legenda.mp4”, quero ajustar: ', 10)
  fireEvent.click(screen.getByRole('button', { name: 'Baixar' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledWith('/entregas/10/download', 'campanha-sem-legenda.mp4'))
  expect(screen.getByRole('button', { name: 'Baixar todos os arquivos' })).toBeEnabled()
  expect(api.post).not.toHaveBeenCalled()
})

const devolutiva = { id: 31, job_id: 77, nome: 'devolutiva.md', mime: 'text/markdown', tamanho_bytes: 100, status: 'aprovada', tipo: 'devolutiva' }

it('arquivo escolhido removido na consulta não é substituído por outro; a próxima escolha é explícita', async () => {
  let arquivos = [entrega, { ...entrega, id: 10, nome: 'campanha-sem-legenda.mp4' }]
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos })
  const ajustar = vi.fn()
  render(<PainelTrabalho orgId={1} slug="predio" jobId={77} aoAjustar={ajustar} aoFechar={vi.fn()} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'sem legenda' }))
  expect(screen.getByTestId('previa-10')).toBeInTheDocument()
  arquivos = [entrega]
  act(() => window.dispatchEvent(new Event('offiz:entregas-mudou')))
  expect(await screen.findByText(/O arquivo que você estava vendo não está mais disponível/)).toBeVisible()
  expect(screen.queryByTestId('previa-9')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Ver entrega completa' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Pedir ajuste' })).not.toBeInTheDocument()
  expect(ajustar).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Ver um arquivo disponível' }))
  expect(screen.getByTestId('previa-9')).toBeInTheDocument()
  expect(screen.getByRole('list', { name: 'Prévia: campanha-com-legenda.mp4' })).toHaveFocus()
  expect(screen.getByRole('link', { name: 'Ver entrega completa' })).toHaveAttribute('href', '/app?org=1&vista=biblioteca&trabalho=77&arquivo=9')
  expect(screen.queryByText(/O arquivo que você estava vendo não está mais disponível/)).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('homônimo de outra revisão não substitui a escolha removida, mesmo após nova consulta', async () => {
  let arquivos = [{ ...entrega, id: 10, nome: 'arte.png', mime: 'image/png' }]
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos })
  montar()
  await screen.findByTestId('previa-10')
  arquivos = []
  act(() => window.dispatchEvent(new Event('offiz:entregas-mudou')))
  await screen.findByText(/O arquivo que você estava vendo não está mais disponível/)
  expect(screen.queryByText(/Terminou sem gerar arquivo/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ver um arquivo disponível' })).toBeDisabled()
  arquivos = [{ ...entrega, id: 11, nome: 'arte.png', mime: 'image/png' }]
  act(() => window.dispatchEvent(new Event('offiz:entregas-mudou')))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ver um arquivo disponível' })).toBeEnabled())
  expect(screen.queryByTestId('previa-11')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ver um arquivo disponível' }))
  expect(screen.getByTestId('previa-11')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('a escolha feita durante uma consulta permanece quando o arquivo está disponível na resposta', async () => {
  let concluir!: (value: unknown) => void
  let aguardar = false
  const arquivos = [entrega, { ...entrega, id: 10, nome: 'campanha-sem-legenda.mp4' }]
  vi.mocked(api.get).mockImplementation(path => path === '/jobs/77' ? Promise.resolve(job)
    : aguardar ? new Promise(resolve => { concluir = resolve }) : Promise.resolve({ arquivos }))
  montar()
  await screen.findByTestId('previa-9')
  aguardar = true
  act(() => window.dispatchEvent(new Event('offiz:entregas-mudou')))
  await waitFor(() => expect(concluir).toBeTypeOf('function'))
  fireEvent.click(screen.getByRole('tab', { name: 'sem legenda' }))
  await act(async () => concluir({ arquivos: [...arquivos, { ...entrega, id: 11, nome: 'nova-revisao.mp4' }] }))
  expect(screen.getByTestId('previa-10')).toBeInTheDocument()
  expect(screen.queryByTestId('previa-11')).not.toBeInTheDocument()
  expect(screen.queryByText(/O arquivo que você estava vendo não está mais disponível/)).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('abrir outro trabalho após remoção não conserva aviso ou escolha da versão anterior', async () => {
  let arquivos = [entrega]
  vi.mocked(api.get).mockImplementation(async path => path.startsWith('/jobs/') ? { ...job, id: Number(path.split('/')[2]) }
    : { arquivos: path.includes('/78') ? [{ ...entrega, id: 12, job_id: 78, nome: 'nova-entrega.mp4' }] : arquivos })
  const props = { orgId: 1, slug: 'predio', aoAjustar: vi.fn(), aoFechar: vi.fn() }
  const { rerender } = render(<PainelTrabalho {...props} jobId={77} />)
  await screen.findByTestId('previa-9')
  arquivos = []
  act(() => window.dispatchEvent(new Event('offiz:entregas-mudou')))
  await screen.findByText(/O arquivo que você estava vendo não está mais disponível/)
  rerender(<PainelTrabalho {...props} jobId={78} />)
  expect(screen.queryByText(/O arquivo que você estava vendo não está mais disponível/)).not.toBeInTheDocument()
  await screen.findByTestId('previa-12')
  expect(screen.getByRole('link', { name: 'Ver entrega completa' })).toHaveAttribute('href', '/app?org=1&vista=biblioteca&trabalho=78&arquivo=12')
  expect(api.post).not.toHaveBeenCalled()
})

it('pedido de insumos abre orientações sem afirmar ausência de arquivo nem aprovar ou retomar', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : {
    arquivos: [], devolutivas: [devolutiva, { ...devolutiva, id: 32, nome: 'devolutiva.html', mime: 'text/html' }],
  })
  const fechar = vi.fn()
  render(<PainelTrabalho orgId={1} slug="predio" jobId={77} aoAjustar={vi.fn()} aoFechar={fechar} />)
  const abrir = await screen.findByRole('button', { name: 'Abrir orientações: devolutiva.md' })
  expect(screen.queryByText(/Terminou sem gerar arquivo/)).not.toBeInTheDocument()
  expect(screen.getByText('O escritório pediu material para continuar. Abra as orientações, envie na conversa o que falta e retome por lá.')).toBeInTheDocument()
  expect(screen.getByText('Precisa de você')).toBeInTheDocument()
  expect(screen.queryByTestId('previa-31')).not.toBeInTheDocument()
  fireEvent.click(abrir)
  expect(screen.getByTestId('previa-31')).toBeInTheDocument()
  expect(screen.queryByTestId('previa-32')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Está bom|Pedir ajuste|retomar/i })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }))
  expect(fechar).toHaveBeenCalledOnce()
  expect(api.post).not.toHaveBeenCalled()
})

it('download das orientações conserva alvo e erro recuperável sem alterar a tarefa', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos: [], devolutivas: [devolutiva] })
  vi.mocked(baixarArquivo).mockRejectedValueOnce(new ApiError(503, 'Não consegui baixar as orientações.')).mockResolvedValueOnce(undefined)
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Baixar orientações: devolutiva.md' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui baixar as orientações.')
  expect(baixarArquivo).toHaveBeenCalledWith('/entregas/31/download', 'devolutiva.md')
  fireEvent.click(screen.getByRole('button', { name: 'Baixar orientações: devolutiva.md' }))
  await waitFor(() => expect(baixarArquivo).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Abrir orientações: devolutiva.md' })).toBeEnabled()
  expect(api.post).not.toHaveBeenCalled()
})

it('peças e orientações ficam separadas no trabalho misto, sem incluir devolutiva nas decisões', async () => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : {
    arquivos: [entrega], devolutivas: [devolutiva], qualidade: { estado: 'conferida', avisos: [] },
  })
  montar()
  await screen.findByRole('button', { name: 'Abrir orientações: devolutiva.md' })
  expect(screen.getByTestId('previa-9')).toBeInTheDocument()
  expect(screen.queryByTestId('previa-31')).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /devolutiva/ })).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Orientações para continuar' })).queryByRole('button', { name: /aprovar|Pedir ajuste|retomar/i })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Pedir ajuste' })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Baixar todos os arquivos' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('orientação de outra tarefa é ignorada e resposta antiga não volta após mudar o trabalho', async () => {
  let finalizar!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(path => path === '/jobs/77' ? Promise.resolve(job)
    : path === '/jobs/78' ? Promise.resolve({ ...job, id: 78 })
    : path === '/orgs/1/biblioteca/77' ? new Promise(resolve => { finalizar = resolve })
    : Promise.resolve({ arquivos: [], devolutivas: [{ ...devolutiva, job_id: 99 }] }))
  const props = { orgId: 1, slug: 'predio', aoAjustar: vi.fn(), aoFechar: vi.fn() }
  const { rerender } = render(<PainelTrabalho {...props} jobId={77} />)
  await waitFor(() => expect(finalizar).toBeTypeOf('function'))
  rerender(<PainelTrabalho {...props} jobId={78} />)
  await screen.findByText(/Terminou sem gerar arquivo/)
  await act(async () => { finalizar({ arquivos: [], devolutivas: [devolutiva] }) })
  expect(screen.queryByRole('button', { name: /Abrir orientações/ })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

const conferir = { estado: 'conferida', avisos: [] }
const diferida = () => {
  let resolve!: (valor: unknown) => void
  let reject!: (erro: unknown) => void
  const promise = new Promise((sim, nao) => { resolve = sim; reject = nao })
  return { promise, resolve, reject }
}

it('aprovar o pendente de um lote misto conserva a rejeição e informa somente o arquivo aprovado', async () => {
  let arquivos = [{ ...entrega, id: 90, nome: 'arte-anterior.png', status: 'rejeitada' }, { ...entrega, id: 91, nome: 'arte-final.png' }]
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos, qualidade: conferir })
  vi.mocked(api.post).mockImplementation(async () => {
    arquivos = arquivos.map(e => e.id === 91 ? { ...e, status: 'aprovada' } : e)
    return { ok: true, aprovadas: [91], licao_registrada: false }
  })
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Está bom — aprovar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/jobs/77/entregas/aprovar', {}))
  expect(await screen.findByText(/1 arquivo aprovado: arte-final.png/)).toBeVisible()
  expect(screen.queryByText('Entrega aprovada')).not.toBeInTheDocument()
  expect(screen.queryByText('aprovada', { exact: true })).not.toBeInTheDocument()
  const antes = vi.mocked(api.get).mock.calls.length
  act(() => window.dispatchEvent(new Event('offiz:entregas-mudou')))
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(antes))
  fireEvent.click(screen.getByRole('tab', { name: 'arte anterior · PNG' }))
  expect(screen.getByTestId('previa-90')).toBeInTheDocument()
  expect(screen.queryByText('Entrega aprovada')).not.toBeInTheDocument()
  expect(screen.queryByText('aprovada', { exact: true })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('o ACK parcial não aprova pendentes omitidos nem arquivos já decididos', async () => {
  let arquivos = [entrega, { ...entrega, id: 10, nome: 'outra-versao.mp4' }, { ...entrega, id: 11, nome: 'versao-rejeitada.mp4', status: 'rejeitada' }]
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos, qualidade: conferir })
  vi.mocked(api.post).mockImplementation(async () => {
    arquivos = arquivos.map(e => e.id === 9 ? { ...e, status: 'aprovada' } : e)
    return { ok: true, aprovadas: [9], licao_registrada: false }
  })
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Está bom — aprovar (2)' }))
  await screen.findByText(/1 arquivo aprovado: campanha-com-legenda.mp4/)
  expect(screen.getByText('Entrega para revisar')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Está bom — aprovar' })).toBeEnabled()
  expect(screen.queryByText('Entrega aprovada')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'versao rejeitada · MP4' }))
  expect(screen.getByTestId('previa-11')).toBeInTheDocument()
  expect(screen.queryByText('aprovada', { exact: true })).not.toBeInTheDocument()
})

it('todos os pendentes confirmados podem receber o selo aprovado; uma consulta posterior continua autoritativa', async () => {
  let arquivos = [entrega, { ...entrega, id: 10, nome: 'outra-versao.mp4' }]
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos, qualidade: conferir })
  vi.mocked(api.post).mockImplementation(async () => {
    arquivos = arquivos.map(e => ({ ...e, status: 'aprovada' }))
    return { ok: true, aprovadas: [9, 10], licao_registrada: true }
  })
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Está bom — aprovar (2)' }))
  await screen.findByText('Entrega aprovada')
  expect(screen.getByText('aprovada', { exact: true })).toBeInTheDocument()
  expect(screen.getByText(/o escritório guardou isso como acerto/)).toBeInTheDocument()
  arquivos = [{ ...entrega, status: 'aprovada' }, { ...entrega, id: 10, nome: 'outra-versao.mp4', status: 'rejeitada' }]
  act(() => window.dispatchEvent(new Event('offiz:entregas-mudou')))
  await waitFor(() => expect(screen.queryByText('Entrega aprovada')).not.toBeInTheDocument())
  expect(screen.queryByText('aprovada', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByText(/1 arquivo aprovado: campanha-com-legenda.mp4/)).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it.each([
  ['ausente', { licao_registrada: false }],
  ['texto em vez de ID', { aprovadas: ['9'] }],
  ['duplicado', { aprovadas: [9, 9] }],
  ['zero', { aprovadas: [0] }],
  ['fracionário', { aprovadas: [9.5] }],
  ['vazio', { aprovadas: [] }],
  ['outro arquivo', { aprovadas: [88] }],
])('ACK %s requer consulta manual sem afirmar aprovação nem reenviar a decisão', async (_caso, retorno) => {
  vi.mocked(api.post).mockResolvedValue(retorno)
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Está bom — aprovar' }))
  const consultar = await screen.findByRole('button', { name: 'Conferir aprovação' })
  expect(screen.getByRole('alert')).toHaveTextContent('A aprovação não foi confirmada')
  expect(screen.queryByText('Entrega aprovada')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Está bom — aprovar' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos: [{ ...entrega, status: 'aprovada' }], qualidade: conferir })
  fireEvent.click(consultar)
  await screen.findByText('Entrega aprovada')
  expect(screen.queryByRole('button', { name: 'Conferir aprovação' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('POST perdido e consulta falha mantêm a decisão incerta; GET manual recupera sem nova aprovação', async () => {
  let falhaConsulta = false
  let status = 'pendente'
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/jobs/77') return job
    if (falhaConsulta) throw new ApiError(503, 'Não consegui conferir agora.')
    return { arquivos: [{ ...entrega, status }], qualidade: conferir }
  })
  vi.mocked(api.post).mockImplementation(async () => { status = 'aprovada'; throw new Error('Lost synthetic response') })
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Está bom — aprovar' }))
  const consultar = await screen.findByRole('button', { name: 'Conferir aprovação' })
  falhaConsulta = true
  fireEvent.click(consultar)
  expect(await screen.findByText('Não consegui conferir agora.')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Está bom — aprovar' })).not.toBeInTheDocument()
  expect(screen.queryByText('Entrega aprovada')).not.toBeInTheDocument()
  falhaConsulta = false
  fireEvent.click(screen.getByRole('button', { name: 'Conferir aprovação' }))
  await screen.findByText('Entrega aprovada')
  expect(screen.queryByText('Não consegui conferir agora.')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('consulta confirma pendentes após falha explícita sem aprovar automaticamente', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(409, 'A decisão mudou.'))
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Está bom — aprovar' }))
  const conferirAprovacao = await screen.findByRole('button', { name: 'Conferir aprovação' })
  expect(screen.getByRole('alert')).toHaveTextContent('A decisão mudou.')
  fireEvent.click(conferirAprovacao)
  expect(await screen.findByRole('button', { name: 'Está bom — aprovar' })).toBeEnabled()
  expect(screen.queryByText('Entrega aprovada')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('trava clique duplo síncrono e uma consulta anterior ao ACK não reverte a decisão confirmada', async () => {
  const ack = diferida(), leituraAntiga = diferida(), leituraAtual = diferida()
  let consultas = 0
  vi.mocked(api.get).mockImplementation(path => {
    if (path === '/jobs/77') return Promise.resolve(job)
    consultas++
    return consultas === 1 ? Promise.resolve({ arquivos: [entrega], qualidade: conferir }) : consultas === 2 ? leituraAntiga.promise : leituraAtual.promise
  })
  vi.mocked(api.post).mockReturnValue(ack.promise)
  montar()
  const aprovar = await screen.findByRole('button', { name: 'Está bom — aprovar' })
  act(() => window.dispatchEvent(new Event('offiz:entregas-mudou')))
  await waitFor(() => expect(consultas).toBe(2))
  act(() => { fireEvent.click(aprovar); fireEvent.click(aprovar) })
  expect(api.post).toHaveBeenCalledTimes(1)
  await act(async () => {
    ack.resolve({ ok: true, aprovadas: [9], licao_registrada: false })
    await Promise.resolve()
    leituraAntiga.resolve({ arquivos: [entrega], qualidade: conferir })
  })
  expect(screen.getByText('Entrega aprovada')).toBeInTheDocument()
  await act(async () => leituraAtual.resolve({ arquivos: [{ ...entrega, status: 'aprovada' }], qualidade: conferir }))
  expect(screen.getByText('Entrega aprovada')).toBeInTheDocument()
})

it.each(['org', 'slug', 'sessão'])('ACK antigo não aplica aprovação ao trocar %s', async troca => {
  const ack = diferida()
  vi.mocked(api.post).mockReturnValue(ack.promise)
  const props = { orgId: 1, slug: 'predio', jobId: 77, aoAjustar: vi.fn(), aoFechar: vi.fn() }
  const { rerender } = render(<PainelTrabalho {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Está bom — aprovar' }))
  if (troca === 'sessão') act(() => setTokens('fixture-other-access', 'fixture-other-refresh'))
  else rerender(<PainelTrabalho {...props} {...(troca === 'org' ? { orgId: 2 } : { slug: 'conteudo' })} />)
  await screen.findByTestId('previa-9')
  await act(async () => ack.resolve({ ok: true, aprovadas: [9], licao_registrada: true }))
  expect(screen.queryByText('Entrega aprovada')).not.toBeInTheDocument()
  expect(screen.queryByText(/o escritório guardou isso como acerto/)).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('falha antiga não substitui estado da nova sessão; renovação da mesma sessão conserva o ACK', async () => {
  const antigo = diferida(), atual = diferida()
  vi.mocked(api.post).mockReturnValueOnce(antigo.promise).mockReturnValueOnce(atual.promise)
  let status = 'pendente'
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos: [{ ...entrega, status }], qualidade: conferir })
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Está bom — aprovar' }))
  act(() => setTokens('fixture-other-access', 'fixture-other-refresh'))
  const aprovarNova = await screen.findByRole('button', { name: 'Está bom — aprovar' })
  fireEvent.click(aprovarNova)
  await act(async () => antigo.reject(new ApiError(503, 'Falha da conta anterior.')))
  expect(screen.queryByText('Falha da conta anterior.')).not.toBeInTheDocument()
  const sessao = getSessionIdentity()
  act(() => {
    localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ versao: 1, sessao, access: 'fixture-renewed', refresh: 'fixture-renewed-refresh' }))
    window.dispatchEvent(new Event('offiz:token-changed'))
  })
  status = 'aprovada'
  await act(async () => atual.resolve({ ok: true, aprovadas: [9], licao_registrada: false }))
  expect(screen.getByText('Entrega aprovada')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('GET de recuperação da conta anterior não aprova arquivos na conta atual nem descarta sua seleção', async () => {
  const antiga = diferida()
  let recuperar = false
  const arquivos = [entrega, { ...entrega, id: 10, nome: 'campanha-sem-legenda.mp4' }]
  vi.mocked(api.get).mockImplementation(path => path === '/jobs/77' ? Promise.resolve(job)
    : recuperar ? antiga.promise : Promise.resolve({ arquivos, qualidade: conferir }))
  vi.mocked(api.post).mockRejectedValue(new Error('Lost response'))
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Está bom — aprovar (2)' }))
  const consultar = await screen.findByRole('button', { name: 'Conferir aprovação' })
  recuperar = true
  fireEvent.click(consultar)
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/orgs/1/biblioteca/77')).toHaveLength(2))
  recuperar = false
  act(() => setTokens('fixture-other-access', 'fixture-other-refresh'))
  fireEvent.click(await screen.findByRole('tab', { name: 'sem legenda' }))
  await act(async () => antiga.resolve({ arquivos: arquivos.map(e => ({ ...e, status: 'aprovada' })), qualidade: conferir }))
  expect(screen.queryByText('Entrega aprovada')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Conferir aprovação' })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'sem legenda' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('previa-10')).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('a saída já registrada impede POST mesmo antes de o efeito ocultar o botão antigo', async () => {
  montar()
  const aprovar = await screen.findByRole('button', { name: 'Está bom — aprovar' })
  act(() => { clearTokens(); fireEvent.click(aprovar) })
  expect(api.post).not.toHaveBeenCalled()
  expect(screen.queryByText('Entrega aprovada')).not.toBeInTheDocument()
})

it.each([
  ['pendente', 'Para revisar'],
  ['aprovada', 'Aprovado'],
  ['rejeitada', 'Rejeitado'],
])('o arquivo selecionado informa sua decisão %s sem confundir o estado do lote', async (status, rotulo) => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : {
    arquivos: [{ ...entrega, id: 90, nome: 'arte-anterior.png', status }, { ...entrega, id: 91, nome: 'arte-final.png', status: 'pendente' }], qualidade: conferir,
  })
  montar()
  fireEvent.click(await screen.findByRole('tab', { name: 'arte anterior · PNG' }))
  expect(screen.getByLabelText('Status do arquivo: arte-anterior.png')).toHaveTextContent(rotulo)
  expect(screen.queryByText('Entrega aprovada')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'arte final · PNG' }))
  expect(screen.getByLabelText('Status do arquivo: arte-final.png')).toHaveTextContent('Para revisar')
  expect(screen.queryByLabelText('Status do arquivo: arte-anterior.png')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('a decisão do arquivo selecionado acompanha o idioma sem selar todo o lote', async () => {
  const linguagem = vi.spyOn(idioma, 'useIdioma').mockReturnValue({ idioma: 'en', preferencia: 'en', t: (_pt, en) => en, definirPreferencia: async () => undefined, salvando: false, erro: null })
  try {
    vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? job : { arquivos: [{ ...entrega, status: 'rejeitada' }], qualidade: conferir })
    montar()
    const estado = await screen.findByLabelText(`File status: ${entrega.nome}`)
    expect(estado).toHaveTextContent('Rejected')
    expect(screen.queryByText('Approved deliverable')).not.toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  } finally { linguagem.mockRestore() }
})

it.each(['queued', 'running'] as const)('[estado confirmado] painel distingue trabalho %s sem antecipar início', async status => {
  vi.mocked(api.get).mockImplementation(async path => path === '/jobs/77' ? { ...job, status } : { arquivos: [] })
  const view = montar()
  expect(await screen.findByText(status === 'queued' ? 'Trabalho na fila' : 'Produção em andamento')).toBeVisible()
  if (status === 'queued') {
    expect(screen.getByText(/O pedido está na fila/)).toBeVisible()
    expect(screen.queryByText(/O escritório está trabalhando nisso/)).not.toBeInTheDocument()
  } else expect(screen.getByText(/O escritório está trabalhando nisso/)).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
  view.unmount()
})
