import { consumoDaConversa } from '../../test/consumoFixture'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, AUTH_CREDENTIALS_KEY, clearTokens, getSessionIdentity, setTokens } from '../../lib/api'
import type { AnexoConversa } from '../../lib/types'
import { ConversaTab } from './ConversaTab'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn(), del: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
vi.mock('./PainelTrabalho', () => ({ PainelTrabalho: () => <aside>Pedido de teste</aside> }))
const office = { slug: 'predio', nome: 'Cliente de teste', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const anexo: AnexoConversa = { nome: 'conteudo-1234567890-foto á.png', nome_exibicao: 'foto á.png', origem_exibicao: 'conteudo / ensaio' }
const detalhe = (id: number) => ({ id, organization_id: 1, office_slug: null, titulo: `Pedido ${id}`, atualizado_em: '2026-10-08T00:00:00Z', total_mensagens: 0, mensagens: [], anexos: [anexo] })
let dados: Record<number, ReturnType<typeof detalhe>>
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear()
  dados = { 42: detalhe(42), 43: detalhe(43) }
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (/^\/conversas\/\d+$/.test(path) ? dados[Number(path.split('/').pop())] : { conversas: Object.values(dados) }))
  vi.mocked(api.post).mockResolvedValue({})
  vi.mocked(api.put).mockResolvedValue({})
  vi.mocked(api.del).mockResolvedValue(undefined)
})
const montar = () => render(<MemoryRouter initialEntries={['/app?org=1&conversa=42']}><ConversaTab orgId={1} slug="predio" office={office} nivelPredio /></MemoryRouter>)
const remover = () => screen.getByRole('button', { name: 'Remover foto á.png (conteudo / ensaio) da conversa' })
const campo = () => screen.getByRole('textbox', { name: 'Seu pedido' })
const aguardarConversa = async (id: number) => {
  await screen.findByRole('heading', { name: `Pedido ${id}` })
  await screen.findByRole('textbox', { name: 'Seu pedido' })
  await waitFor(() => expect(screen.getByRole('region', { name: 'Conversa atual' })).toHaveAttribute('aria-busy', 'false'))
}

it('remove somente o vínculo confirmado pelo servidor, preserva o pedido e a recarga não o ressuscita', async () => {
  vi.mocked(api.del).mockImplementation(async () => { dados[42] = { ...dados[42], anexos: [] } })
  const view = montar()
  await aguardarConversa(42)
  fireEvent.change(campo(), { target: { value: 'Meu próximo pedido.' } })
  fireEvent.click(remover())
  await waitFor(() => expect(screen.queryByRole('button', { name: /Remover foto á/ })).not.toBeInTheDocument())
  expect(api.del).toHaveBeenCalledExactlyOnceWith('/conversas/42/anexos/conteudo-1234567890-foto%20%C3%A1.png')
  expect(campo()).toHaveValue('Meu próximo pedido.')
  expect(campo()).toHaveFocus()
  view.unmount(); montar()
  await aguardarConversa(42)
  expect(screen.queryByRole('button', { name: /Remover foto á/ })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('falha de remoção mantém o anexo e permite tentar de novo', async () => {
  vi.mocked(api.del).mockRejectedValueOnce(new Error('offline'))
  montar(); await aguardarConversa(42)
  fireEvent.click(remover())
  expect(await screen.findByRole('alert')).toHaveTextContent('Ele continua nesta conversa')
  expect(remover()).toBeEnabled()
  fireEvent.click(remover())
  await waitFor(() => expect(screen.queryByRole('button', { name: /Remover foto á/ })).not.toBeInTheDocument())
  expect(api.del).toHaveBeenCalledTimes(2)
})

it.each(['sucesso', 'falha'])('retorno de %s após trocar de conversa não remove o homônimo nem altera o novo pedido', async resultado => {
  let concluir!: () => void
  vi.mocked(api.del).mockImplementationOnce(() => new Promise((resolve, reject) => { concluir = () => resultado === 'sucesso' ? resolve(undefined) : reject(new Error('offline')) }))
  montar(); await aguardarConversa(42)
  fireEvent.click(remover())
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /^Pedido 43/ }))
  await aguardarConversa(43)
  fireEvent.change(campo(), { target: { value: 'Pedido da outra conversa.' } })
  expect(remover()).toBeEnabled()
  await act(async () => concluir())
  expect(remover()).toBeEnabled()
  expect(campo()).toHaveValue('Pedido da outra conversa.')
  expect(screen.queryByText(/Ele continua nesta conversa/)).not.toBeInTheDocument()
  expect(api.del).toHaveBeenCalledTimes(1)
})

it.each(['queued', 'running'])('protege anexos usados por pedido %s', async status => {
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path === '/conversas/42' ? { ...dados[42], trabalhos: [{ id: 77, titulo: 'Produção de teste', status, entregas: [] }] } : { conversas: Object.values(dados) }))
  montar(); await aguardarConversa(42)
  expect(remover()).toBeDisabled()
  fireEvent.click(remover())
  expect(api.del).not.toHaveBeenCalled()
})

it('X do upload recebido remove a identidade retornada e o chip, sem só esconder o aviso', async () => {
  dados[42] = { ...dados[42], anexos: [] }
  vi.mocked(api.postForm).mockResolvedValue({ ok: true, nome: 'foto-renomeada.png', caracteres: 0, legivel: false, anexos: ['foto-renomeada.png'] })
  montar(); await aguardarConversa(42)
  fireEvent.change(screen.getByLabelText('Anexar arquivos à conversa'), { target: { files: [new File(['fixture'], 'foto.png', { type: 'image/png' })] } })
  const fechar = await screen.findByRole('button', { name: 'Remover o anexo foto.png' })
  expect(screen.getByRole('button', { name: 'Remover foto-renomeada.png da conversa' })).toBeInTheDocument()
  fireEvent.click(fechar)
  await waitFor(() => expect(screen.queryByRole('button', { name: /Remover.*foto/ })).not.toBeInTheDocument())
  expect(api.del).toHaveBeenCalledExactlyOnceWith('/conversas/42/anexos/foto-renomeada.png')
  expect(screen.queryByText('recebido — vou usar quando fizer o trabalho')).not.toBeInTheDocument()
})

it.each(['logout', 'novo login'] as const)('remover após %s antes do próximo render não inicia intenção da tela antiga', async mudanca => {
  setTokens('access-inicial-sintetico', 'refresh-inicial-sintetico')
  montar(); await aguardarConversa(42)
  const tirar = remover()
  fireEvent.change(campo(), { target: { value: 'Meu pedido preservado.' } })
  if (mudanca === 'logout') clearTokens(); else setTokens('access-novo-sintetico', 'refresh-novo-sintetico')
  // O estado da conta pode mudar antes da renderização seguinte do pai.
  fireEvent.click(tirar)
  expect(api.del).not.toHaveBeenCalled()
  expect(remover()).toBeVisible(); expect(campo()).toHaveValue('Meu pedido preservado.')
})

it('expõe leitura parcial depois de reabrir a conversa sem afirmar que leu o arquivo inteiro', async () => {
  const parcial: AnexoConversa = { nome: 'campanha.csv', legivel: true, leitura_parcial: true, leitura_aviso: 'Leitura parcial: Foi lida uma amostra das linhas e colunas.' }
  dados[42] = { ...dados[42], anexos: [parcial] }
  const view = montar()
  expect(await screen.findByRole('status', { name: 'Leitura dos anexos' })).toHaveTextContent('campanha.csv · Leitura parcial: Foi lida uma amostra das linhas e colunas.')
  fireEvent.change(campo(), { target: { value: 'Use a primeira campanha.' } })
  view.unmount(); montar()
  expect(await screen.findByRole('status', { name: 'Leitura dos anexos' })).toHaveTextContent('Leitura parcial')
  expect(api.post).not.toHaveBeenCalled()
})

it('aceita CSV e TSV e mostra o aviso retornado no upload sem produzir nada', async () => {
  dados[42] = { ...dados[42], anexos: [] }
  const parcial: AnexoConversa = { nome: 'campanha.csv', legivel: true, leitura_parcial: true, leitura_aviso: 'Foi lida uma amostra das linhas e colunas.' }
  vi.mocked(api.postForm).mockResolvedValue({ ok: true, nome: parcial.nome, caracteres: 850, legivel: true, leitura_parcial: true, leitura_aviso: parcial.leitura_aviso, anexos: [parcial.nome], anexos_detalhes: [parcial] })
  montar(); await aguardarConversa(42)
  const input = screen.getByLabelText('Anexar arquivos à conversa')
  const formatos = input.getAttribute('accept')?.split(',')
  expect(formatos).toContain('.csv'); expect(formatos).toContain('.tsv'); expect(formatos).not.toContain('.xlsx')
  fireEvent.change(campo(), { target: { value: 'Crie uma campanha.' } })
  fireEvent.change(input, { target: { files: [new File(['tema;data\nTeste;2026-10-09'], 'campanha.csv', { type: 'text/csv' })] } })
  expect(await screen.findByRole('status', { name: 'Leitura dos anexos' })).toHaveTextContent('Leitura parcial')
  expect(screen.getByText('recebido — leitura parcial')).toBeInTheDocument()
  expect(campo()).toHaveValue('Crie uma campanha.')
  expect(api.post).not.toHaveBeenCalled()
})

it('aviso de texto não legível persiste, é texto puro e some junto com o vínculo removido', async () => {
  const aviso = 'Não foi possível extrair texto. <img src=x onerror=alert(1)>'
  dados[42] = { ...dados[42], anexos: [{ nome: 'scan.pdf', legivel: false, leitura_parcial: false, leitura_aviso: aviso }] }
  vi.mocked(api.del).mockImplementation(async () => { dados[42] = { ...dados[42], anexos: [] } })
  montar(); await aguardarConversa(42)
  const status = await screen.findByRole('status', { name: 'Leitura dos anexos' })
  expect(status).toHaveTextContent(aviso)
  expect(status.querySelector('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Remover scan.pdf da conversa' }))
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Leitura dos anexos' })).not.toBeInTheDocument())
  expect(api.post).not.toHaveBeenCalled()
})

it('recupera no foco um anexo recebido cuja resposta de upload se perdeu, sem reenviar nem perder rascunho', async () => {
  let recebido = false, mensagem = ''
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path === '/conversas/42'
    ? { ...dados[42], anexos: recebido ? [{ nome: 'briefing.txt' }] : [], mensagens: mensagem ? [{ id: 100, role: 'assistant', conteudo: mensagem }] : [] }
    : { conversas: Object.values(dados) }))
  vi.mocked(api.postForm).mockImplementationOnce(async () => { recebido = true; throw new ApiError(0, 'Não foi possível confirmar o envio.') })
  montar(); await aguardarConversa(42)
  fireEvent.change(campo(), { target: { value: 'Use o material desta campanha.' } })
  fireEvent.change(screen.getByLabelText('Anexar arquivos à conversa'), { target: { files: [new File(['Material sintético'], 'briefing.txt', { type: 'text/plain' })] } })
  await screen.findByText('Não foi possível confirmar o envio.')
  mensagem = 'Consulta concluída: o arquivo foi recebido.'
  act(() => window.dispatchEvent(new Event('focus')))
  await screen.findByText(mensagem)
  expect(screen.getByRole('button', { name: 'Remover briefing.txt da conversa' })).toBeVisible()
  expect(campo()).toHaveValue('Use o material desta campanha.')
  expect(api.postForm).toHaveBeenCalledTimes(1)
  expect(api.post).not.toHaveBeenCalled()
})

it('releitura confirmada remove o vínculo apagado noutra aba sem alterar o rascunho', async () => {
  let mensagem = ''
  vi.mocked(api.get).mockImplementation(async path => consumoDaConversa(path) ?? (path === '/conversas/42'
    ? { ...dados[42], mensagens: mensagem ? [{ id: 100, role: 'assistant', conteudo: mensagem }] : [] }
    : { conversas: Object.values(dados) }))
  montar(); await screen.findByRole('button', { name: /Remover foto á/ })
  fireEvent.change(campo(), { target: { value: 'Meu pedido continua em rascunho.' } })
  dados[42] = { ...dados[42], anexos: [] }; mensagem = 'Consulta concluída: o vínculo não existe mais.'
  act(() => window.dispatchEvent(new Event('focus')))
  await screen.findByText(mensagem)
  expect(screen.queryByRole('button', { name: /Remover foto á/ })).not.toBeInTheDocument()
  expect(campo()).toHaveValue('Meu pedido continua em rascunho.')
  expect(api.postForm).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled()
})

it('falha do seletor não afirma acervo vazio e permite repetir somente a leitura por ação explícita', async () => {
  let consultas = 0
  vi.mocked(api.get).mockImplementation(async path => {
    const consumo = consumoDaConversa(path)
    if (consumo) return consumo
    if (path === '/orgs/1/inicio') return { andares: [{ slug: 'conteudo' }] }
    if (path === '/predios/1/conteudo/arquivos') {
      consultas++
      if (consultas === 1) throw new ApiError(503, 'Armazenamento temporariamente indisponível.')
      return { entrada: [{ nome: 'campanha.txt', sub: 'briefings' }] }
    }
    return /^\/conversas\/\d+$/.test(path) ? dados[Number(path.split('/').pop())] : { conversas: Object.values(dados) }
  })
  montar(); await aguardarConversa(42)
  fireEvent.change(campo(), { target: { value: 'Meu pedido com material.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Do acervo' }))
  const picker = screen.getByRole('region', { name: 'Anexar do acervo' })
  await waitFor(() => expect(picker).toHaveTextContent('Armazenamento temporariamente indisponível.'))
  expect(picker).not.toHaveTextContent('Nada guardado ainda')
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByRole('button', { name: /campanha.txt/ })).toBeVisible()
  expect(picker).not.toHaveTextContent('Armazenamento temporariamente indisponível.')
  expect(consultas).toBe(2); expect(campo()).toHaveValue('Meu pedido com material.')
  expect(api.postForm).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled()
})

it.each(['upload', 'remoção'])('GET iniciado antes da %s não substitui os anexos confirmados pela alteração', async operacao => {
  montar(); await aguardarConversa(42)
  fireEvent.change(campo(), { target: { value: 'Preserve meu pedido.' } })
  let concluir!: (detalhe: unknown) => void
  const antigo = { ...dados[42], mensagens: [{ id: 100, role: 'assistant', conteudo: 'A consulta antiga terminou.' }] }
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { concluir = resolve }))
  act(() => window.dispatchEvent(new Event('focus')))
  if (operacao === 'upload') {
    vi.mocked(api.postForm).mockResolvedValueOnce({ nome: 'novo.txt', anexos: [anexo.nome, 'novo.txt'], legivel: true })
    fireEvent.change(screen.getByLabelText('Anexar arquivos à conversa'), { target: { files: [new File(['Novo material'], 'novo.txt', { type: 'text/plain' })] } })
    await screen.findByRole('button', { name: 'Remover novo.txt da conversa' })
  } else {
    fireEvent.click(remover())
    await waitFor(() => expect(screen.queryByRole('button', { name: /Remover foto á/ })).not.toBeInTheDocument())
  }
  await act(async () => concluir(antigo))
  await screen.findByText('A consulta antiga terminou.')
  if (operacao === 'upload') expect(screen.getByRole('button', { name: 'Remover novo.txt da conversa' })).toBeVisible()
  else expect(screen.queryByRole('button', { name: /Remover foto á/ })).not.toBeInTheDocument()
  expect(campo()).toHaveValue('Preserve meu pedido.')
  expect(api.post).not.toHaveBeenCalled()
})

it('GET iniciado enquanto o upload está em andamento não apaga sua confirmação tardia', async () => {
  montar(); await aguardarConversa(42)
  let terminarUpload!: () => void, terminarLeitura!: () => void
  vi.mocked(api.postForm).mockImplementationOnce(() => new Promise(resolve => { terminarUpload = () => resolve({ nome: 'novo.txt', anexos: ['novo.txt'], legivel: true }) }))
  fireEvent.change(screen.getByLabelText('Anexar arquivos à conversa'), { target: { files: [new File(['Novo material'], 'novo.txt', { type: 'text/plain' })] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { terminarLeitura = () => resolve({ ...dados[42], mensagens: [{ id: 100, role: 'assistant', conteudo: 'Leitura iniciada durante o upload.' }] }) }))
  act(() => window.dispatchEvent(new Event('focus')))
  await act(async () => terminarUpload())
  await screen.findByRole('button', { name: 'Remover novo.txt da conversa' })
  await act(async () => terminarLeitura())
  await screen.findByText('Leitura iniciada durante o upload.')
  expect(screen.getByRole('button', { name: 'Remover novo.txt da conversa' })).toBeVisible()
  expect(api.postForm).toHaveBeenCalledTimes(1); expect(api.post).not.toHaveBeenCalled()
})

it('leitura de anexos que falha mantém os vínculos já confirmados e o pedido', async () => {
  montar(); await aguardarConversa(42)
  fireEvent.change(campo(), { target: { value: 'Meu rascunho.' } })
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(503, 'Consulta indisponível.'))
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(remover()).toBeVisible(); expect(campo()).toHaveValue('Meu rascunho.')
  expect(api.postForm).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled()
})

it.each(['conversa', 'fechar'])('retorno do acervo após %s é descartado, abortado e não perde o pedido', async destino => {
  let concluir!: () => void, signal: AbortSignal | undefined
  vi.mocked(api.get).mockImplementation(async (path, pedidoSignal) => {
    const consumo = consumoDaConversa(path)
    if (consumo) return consumo
    if (path === '/orgs/1/inicio') return { andares: [{ slug: 'conteudo' }] }
    if (path === '/predios/1/conteudo/arquivos') {
      signal = pedidoSignal
      return new Promise(resolve => { concluir = () => resolve({ entrada: [{ nome: 'antigo.txt' }] }) })
    }
    return /^\/conversas\/\d+$/.test(path) ? dados[Number(path.split('/').pop())] : { conversas: Object.values(dados) }
  })
  montar(); await aguardarConversa(42)
  fireEvent.change(campo(), { target: { value: 'Pedido original.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Do acervo' }))
  await waitFor(() => expect(signal).toBeDefined())
  if (destino === 'conversa') {
    fireEvent.click(screen.getByRole('button', { name: /^Pedido 43/ }))
    await aguardarConversa(43)
    fireEvent.change(campo(), { target: { value: 'Pedido da outra conversa.' } })
  } else fireEvent.keyDown(screen.getByRole('region', { name: 'Anexar do acervo' }), { key: 'Escape' })
  expect(signal?.aborted).toBe(true)
  await act(async () => concluir())
  expect(screen.queryByRole('region', { name: 'Anexar do acervo' })).not.toBeInTheDocument()
  expect(screen.queryByText('antigo.txt')).not.toBeInTheDocument()
  expect(campo()).toHaveValue(destino === 'conversa' ? 'Pedido da outra conversa.' : 'Pedido original.')
  if (destino === 'fechar') expect(campo()).toHaveFocus()
  expect(api.post).not.toHaveBeenCalled()
})

it('duplo clique no seletor deduplica a consulta e distingue acervo vazio confirmado', async () => {
  let concluir!: () => void
  vi.mocked(api.get).mockImplementation(async path => {
    const consumo = consumoDaConversa(path)
    if (consumo) return consumo
    if (path === '/orgs/1/inicio') return { andares: [{ slug: 'conteudo' }] }
    if (path === '/predios/1/conteudo/arquivos') return new Promise(resolve => { concluir = () => resolve({ entrada: [] }) })
    return /^\/conversas\/\d+$/.test(path) ? dados[Number(path.split('/').pop())] : { conversas: Object.values(dados) }
  })
  montar(); await aguardarConversa(42)
  const abrir = screen.getByRole('button', { name: 'Do acervo' })
  fireEvent.click(abrir); fireEvent.click(abrir)
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/predios/1/conteudo/arquivos')).toHaveLength(1))
  await act(async () => concluir())
  expect(await screen.findByText(/Nada guardado ainda/)).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('refresh antigo não traz anexos nem mensagens para a outra conversa e os dois rascunhos persistem', async () => {
  montar(); await aguardarConversa(42)
  fireEvent.change(campo(), { target: { value: 'Meu pedido original.' } })
  let concluir!: () => void, signal: AbortSignal | undefined
  vi.mocked(api.get).mockImplementationOnce((_path, pedidoSignal) => {
    signal = pedidoSignal
    return new Promise(resolve => { concluir = () => resolve({ ...dados[42], anexos: [{ nome: 'somente-antiga.txt' }], mensagens: [{ id: 100, role: 'assistant', conteudo: 'Texto da conversa antiga.' }] }) })
  })
  act(() => window.dispatchEvent(new Event('focus')))
  fireEvent.click(screen.getByRole('button', { name: /^Pedido 43/ }))
  await aguardarConversa(43)
  fireEvent.change(campo(), { target: { value: 'Pedido da outra conversa.' } })
  expect(signal?.aborted).toBe(true)
  await act(async () => concluir())
  expect(screen.queryByText('Texto da conversa antiga.')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remover somente-antiga.txt da conversa' })).not.toBeInTheDocument()
  expect(remover()).toBeVisible(); expect(campo()).toHaveValue('Pedido da outra conversa.')
  fireEvent.click(screen.getByRole('button', { name: /^Pedido 42/ }))
  await aguardarConversa(42)
  expect(campo()).toHaveValue('Meu pedido original.')
  expect(api.postForm).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled()
})

it.each(['sucesso', 'falha'])('reabrir acervo descarta %s de uma consulta fechada sem substituir a nova consulta', async resultado => {
  let consultas = 0, concluir!: () => void
  vi.mocked(api.get).mockImplementation(async path => {
    const consumo = consumoDaConversa(path)
    if (consumo) return consumo
    if (path === '/orgs/1/inicio') return { andares: [{ slug: 'conteudo' }] }
    if (path === '/predios/1/conteudo/arquivos') {
      consultas++
      if (consultas === 1) return new Promise((resolve, reject) => { concluir = () => resultado === 'sucesso' ? resolve({ entrada: [{ nome: 'antigo.txt' }] }) : reject(new ApiError(503, 'Erro da consulta fechada.')) })
      return { entrada: [{ nome: 'atual.txt' }] }
    }
    return /^\/conversas\/\d+$/.test(path) ? dados[Number(path.split('/').pop())] : { conversas: Object.values(dados) }
  })
  montar(); await aguardarConversa(42)
  fireEvent.click(screen.getByRole('button', { name: 'Do acervo' }))
  await waitFor(() => expect(consultas).toBe(1))
  fireEvent.click(screen.getByRole('button', { name: 'Fechar seletor do acervo' }))
  fireEvent.click(screen.getByRole('button', { name: 'Do acervo' }))
  await screen.findByRole('button', { name: /atual.txt/ })
  await act(async () => concluir())
  expect(screen.getByRole('button', { name: /atual.txt/ })).toBeVisible()
  expect(screen.queryByText('Erro da consulta fechada.')).not.toBeInTheDocument()
  expect(screen.queryByText('antigo.txt')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

const arquivosDoLote = () => [new File(['primeiro'], 'primeiro.txt', { type: 'text/plain' }), new File(['segundo'], 'segundo.txt', { type: 'text/plain' })]
const respostaDoLote = { ok: true, nome: 'primeiro.txt', caracteres: 8, legivel: true, anexos: ['primeiro.txt'] }
function lotePendente() {
  let resolve!: (valor: typeof respostaDoLote) => void, reject!: (erro: Error) => void
  const promise = new Promise<typeof respostaDoLote>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const enviarLote = () => fireEvent.change(screen.getByLabelText('Anexar arquivos à conversa'), { target: { files: arquivosDoLote() } })

it.each(['sucesso', 'falha'])('trocar de conversa interrompe arquivos não enviados após %s do arquivo em trânsito', async resultado => {
  dados[42] = { ...dados[42], anexos: [] }
  const primeiro = lotePendente()
  vi.mocked(api.postForm).mockImplementationOnce(() => primeiro.promise)
  montar(); await aguardarConversa(42)
  fireEvent.change(campo(), { target: { value: 'Pedido original.' } })
  enviarLote(); await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: /^Pedido 43/ }))
  await aguardarConversa(43)
  fireEvent.change(campo(), { target: { value: 'Outro pedido.' } })
  await act(async () => resultado === 'sucesso' ? primeiro.resolve(respostaDoLote) : primeiro.reject(new ApiError(0, 'Resposta incerta do pedido antigo.')))
  expect(api.postForm).toHaveBeenCalledExactlyOnceWith('/conversas/42/anexos', expect.any(FormData))
  expect(campo()).toHaveValue('Outro pedido.'); expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  expect(screen.queryByText('Resposta incerta do pedido antigo.')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remover primeiro.txt da conversa' })).not.toBeInTheDocument()
  expect(api.del).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /^Pedido 42/ }))
  await aguardarConversa(42); expect(campo()).toHaveValue('Pedido original.')
})

it.each(['empresa', 'desmontagem'])('interrompe o restante do lote após mudar %s', async mudanca => {
  const primeiro = lotePendente()
  vi.mocked(api.postForm).mockImplementationOnce(() => primeiro.promise)
  const view = montar(); await aguardarConversa(42)
  enviarLote(); await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  if (mudanca === 'desmontagem') view.unmount()
  else {
    view.rerender(<MemoryRouter key="empresa-nova" initialEntries={['/app?org=2&conversa=nova']}><ConversaTab orgId={2} slug="predio" office={office} nivelPredio /></MemoryRouter>)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Seu pedido' }), { target: { value: 'Rascunho da empresa nova.' } })
  }
  await act(async () => primeiro.resolve(respostaDoLote))
  expect(api.postForm).toHaveBeenCalledTimes(1)
  if (mudanca === 'empresa') expect(campo()).toHaveValue('Rascunho da empresa nova.')
  expect(api.post).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled()
})

it('criação de conversa atrasada não inicia upload depois de selecionar outro pedido', async () => {
  let concluir!: () => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { concluir = () => resolve({ ...dados[42], id: 44, anexos: [] }) }))
  montar(); await aguardarConversa(42)
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  enviarLote(); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: /^Pedido 43/ }))
  await aguardarConversa(43)
  fireEvent.change(campo(), { target: { value: 'Vou usar esta conversa.' } })
  await act(async () => concluir())
  expect(api.postForm).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled()
  expect(campo()).toHaveValue('Vou usar esta conversa.')
})

it('troca de sessão durante o primeiro upload não envia os arquivos restantes com as credenciais novas', async () => {
  setTokens('conta-A', 'refresh-A')
  const primeiro = lotePendente()
  vi.mocked(api.postForm).mockImplementationOnce(() => primeiro.promise)
  montar(); await aguardarConversa(42)
  enviarLote(); await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  setTokens('conta-B', 'refresh-B')
  await act(async () => primeiro.reject(new ApiError(409, 'A sessão mudou.')))
  expect(api.postForm).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('A sessão mudou.')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled()
})

it.each([401, 403, 409, 'abort'] as const)('erro terminal %s interrompe o lote sem repetir ou desfazer o arquivo em trânsito', async status => {
  const erro = status === 'abort' ? new DOMException('Envio interrompido.', 'AbortError') : new ApiError(status, 'Acesso indisponível.')
  vi.mocked(api.postForm).mockRejectedValueOnce(erro)
  montar(); await aguardarConversa(42)
  fireEvent.change(campo(), { target: { value: 'Meu pedido continua aqui.' } })
  enviarLote()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled())
  expect(api.postForm).toHaveBeenCalledTimes(1); expect(api.del).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled()
  expect(campo()).toHaveValue('Meu pedido continua aqui.')
})

it('renovação dos tokens conserva a sessão e permite concluir o lote na conversa original', async () => {
  setTokens('access-inicial', 'refresh-inicial')
  const sessao = getSessionIdentity(), primeiro = lotePendente()
  vi.mocked(api.postForm).mockImplementationOnce(() => primeiro.promise)
    .mockResolvedValueOnce({ ...respostaDoLote, nome: 'segundo.txt', anexos: ['primeiro.txt', 'segundo.txt'] })
  montar(); await aguardarConversa(42)
  enviarLote(); await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  localStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ versao: 1, sessao, access: 'access-renovado', refresh: 'refresh-renovado' }))
  await act(async () => primeiro.resolve(respostaDoLote))
  await screen.findByRole('button', { name: 'Remover segundo.txt da conversa' })
  expect(screen.getByRole('button', { name: 'Remover primeiro.txt da conversa' })).toBeVisible()
  expect(api.postForm).toHaveBeenCalledTimes(2); expect(api.del).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled()
})

it('falha no segundo arquivo conserva confirmação e leitura parcial do primeiro, com o rascunho', async () => {
  const aviso = 'Só uma parte do conteúdo foi lida.'
  vi.mocked(api.postForm).mockResolvedValueOnce({ ...respostaDoLote, leitura_parcial: true, leitura_aviso: aviso,
    anexos_detalhes: [{ nome: 'primeiro.txt', legivel: true, leitura_parcial: true, leitura_aviso: aviso }] })
    .mockRejectedValueOnce(new ApiError(503, 'Segundo arquivo sem confirmação.'))
  montar(); await aguardarConversa(42)
  fireEvent.change(campo(), { target: { value: 'Pedido com as duas referências.' } })
  enviarLote(); await screen.findByText('Segundo arquivo sem confirmação.')
  expect(screen.getByRole('button', { name: 'Remover primeiro.txt da conversa' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Remover segundo.txt da conversa' })).not.toBeInTheDocument()
  expect(screen.getByRole('status', { name: 'Leitura dos anexos' })).toHaveTextContent(aviso)
  expect(campo()).toHaveValue('Pedido com as duas referências.')
  expect(api.postForm).toHaveBeenCalledTimes(2); expect(api.del).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled()
})

it('seleção repetida durante um lote não duplica uploads nem envia o pedido', async () => {
  const primeiro = lotePendente()
  vi.mocked(api.postForm).mockImplementationOnce(() => primeiro.promise).mockResolvedValueOnce({ ...respostaDoLote, nome: 'segundo.txt', anexos: ['primeiro.txt', 'segundo.txt'] })
  montar(); await aguardarConversa(42)
  fireEvent.change(campo(), { target: { value: 'Usar os anexos depois.' } })
  enviarLote(); await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  enviarLote(); fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await act(async () => primeiro.resolve(respostaDoLote))
  await screen.findByRole('button', { name: 'Remover segundo.txt da conversa' })
  expect(api.postForm).toHaveBeenCalledTimes(2); expect(api.post).not.toHaveBeenCalled(); expect(api.del).not.toHaveBeenCalled()
  expect(campo()).toHaveValue('Usar os anexos depois.')
})

it('fim do lote antigo não libera nem limpa os controles de um upload na conversa nova', async () => {
  const primeiro = lotePendente(), novo = lotePendente()
  vi.mocked(api.postForm).mockImplementationOnce(() => primeiro.promise).mockImplementationOnce(() => novo.promise)
  montar(); await aguardarConversa(42)
  enviarLote(); await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: /^Pedido 43/ }))
  await aguardarConversa(43)
  const entrada = screen.getByLabelText('Anexar arquivos à conversa') as HTMLInputElement
  fireEvent.change(entrada, { target: { files: [new File(['novo'], 'novo.txt', { type: 'text/plain' })] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(2))
  const limparInput = vi.fn()
  Object.defineProperty(entrada, 'value', { configurable: true, get: () => '', set: limparInput })
  await act(async () => primeiro.resolve(respostaDoLote))
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  expect(limparInput).not.toHaveBeenCalled(); expect(api.postForm).toHaveBeenCalledTimes(2)
  await act(async () => novo.resolve({ ...respostaDoLote, nome: 'novo.txt', anexos: ['novo.txt'] }))
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  expect(limparInput).toHaveBeenCalledExactlyOnceWith('')
  expect(screen.getByRole('button', { name: 'Remover novo.txt da conversa' })).toBeVisible()
})


const respostaComUploads = { mensagem: { id: 701, role: 'assistant', conteudo: 'Pedido recebido com os anexos.', criado_em: '2026-10-15T18:00:00Z' } }
async function receberFotoParaPedido(nome = 'foto.png') {
  vi.mocked(api.postForm).mockResolvedValueOnce({ nome, legivel: false, anexos: [nome] })
  fireEvent.change(screen.getByLabelText('Anexar arquivos à conversa'), { target: { files: [new File(['fixture'], nome, { type: 'image/png' })] } })
  await screen.findByRole('button', { name: `Remover o anexo ${nome}` })
}

it('envio confirmado limpa só os receipts concluídos, mantendo anexos reais, leitura parcial e erro de upload', async () => {
  dados[42] = { ...dados[42], anexos: [] }
  const aviso = 'Leitura parcial: somente a primeira página foi lida.'
  vi.mocked(api.postForm).mockResolvedValueOnce({ nome: 'foto.png', legivel: false, anexos: ['foto.png'] })
    .mockResolvedValueOnce({ nome: 'scan.pdf', legivel: true, leitura_parcial: true, leitura_aviso: aviso,
      anexos_detalhes: [{ nome: 'foto.png', legivel: false }, { nome: 'scan.pdf', legivel: true, leitura_parcial: true, leitura_aviso: aviso }] })
    .mockRejectedValueOnce(new ApiError(503, 'Não foi possível confirmar terceiro.zip.'))
  let confirmar!: (value: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { confirmar = resolve }))
  montar(); await aguardarConversa(42)
  fireEvent.change(screen.getByLabelText('Anexar arquivos à conversa'), { target: { files: [
    new File(['foto'], 'foto.png', { type: 'image/png' }), new File(['scan'], 'scan.pdf', { type: 'application/pdf' }), new File(['zip'], 'terceiro.zip'),
  ] } })
  await screen.findByText('Não foi possível confirmar terceiro.zip.')
  fireEvent.change(campo(), { target: { value: 'Usa as fotos para a campanha.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('button', { name: 'Remover o anexo foto.png' })).toBeVisible()
  await act(async () => confirmar(respostaComUploads))
  await screen.findByText('Pedido recebido com os anexos.')
  expect(screen.queryByRole('button', { name: 'Remover o anexo foto.png' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remover o anexo scan.pdf' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remover foto.png da conversa' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Remover scan.pdf da conversa' })).toBeVisible()
  expect(screen.getByRole('status', { name: 'Leitura dos anexos' })).toHaveTextContent(aviso)
  expect(screen.getByText('Não foi possível confirmar terceiro.zip.')).toBeVisible()
  expect(api.del).not.toHaveBeenCalled(); expect(api.postForm).toHaveBeenCalledTimes(3)
})

it.each(['falha', 'resposta sem mensagem'] as const)('envio com %s conserva receipt recebido e o rascunho seguinte', async resultado => {
  dados[42] = { ...dados[42], anexos: [] }
  let resolver!: (value: unknown) => void, rejeitar!: (error: Error) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise((resolve, reject) => { resolver = resolve; rejeitar = reject }))
  montar(); await aguardarConversa(42); await receberFotoParaPedido()
  fireEvent.change(campo(), { target: { value: 'Faz a chamada com esta foto.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  fireEvent.change(campo(), { target: { value: 'Meu próximo pedido continua aqui.' } })
  await act(async () => resultado === 'falha' ? rejeitar(new ApiError(503, 'Mensagem sem confirmação.')) : resolver({}))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled())
  expect(screen.getByRole('button', { name: 'Remover o anexo foto.png' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Remover foto.png da conversa' })).toBeVisible()
  expect(campo()).toHaveValue('Meu próximo pedido continua aqui.')
  if (resultado === 'falha') expect(screen.getByRole('alert')).toHaveTextContent('Mensagem sem confirmação.')
  expect(api.del).not.toHaveBeenCalled(); expect(api.postForm).toHaveBeenCalledTimes(1)
})

it.each(['pendente', 'recebido'] as const)('confirmação do pedido não limpa upload novo %s nem o próximo rascunho', async estadoNovo => {
  dados[42] = { ...dados[42], anexos: [] }
  let confirmar!: (value: unknown) => void, terminarUpload!: (value: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { confirmar = resolve }))
  montar(); await aguardarConversa(42); await receberFotoParaPedido('primeira.png')
  fireEvent.change(campo(), { target: { value: 'Usa a primeira foto.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  fireEvent.change(campo(), { target: { value: 'Depois usa esta segunda foto.' } })
  vi.mocked(api.postForm).mockImplementationOnce(() => new Promise(resolve => { terminarUpload = resolve }))
  fireEvent.change(screen.getByLabelText('Anexar arquivos à conversa'), { target: { files: [new File(['segunda'], 'segunda.png', { type: 'image/png' })] } })
  await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(2))
  const recebido = { nome: 'segunda.png', legivel: false, anexos: ['primeira.png', 'segunda.png'] }
  if (estadoNovo === 'recebido') await act(async () => terminarUpload(recebido))
  await act(async () => confirmar(respostaComUploads))
  await screen.findByText('Pedido recebido com os anexos.')
  expect(screen.queryByRole('button', { name: 'Remover o anexo primeira.png' })).not.toBeInTheDocument()
  if (estadoNovo === 'pendente') {
    expect(screen.getByText('enviando…')).toBeVisible()
    await act(async () => terminarUpload(recebido))
  }
  expect(screen.getByRole('button', { name: 'Remover o anexo segunda.png' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Remover primeira.png da conversa' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Remover segunda.png da conversa' })).toBeVisible()
  expect(campo()).toHaveValue('Depois usa esta segunda foto.')
  expect(api.del).not.toHaveBeenCalled(); expect(api.post).toHaveBeenCalledTimes(1)
})

it('resposta do pedido antigo não limpa o receipt homônimo da conversa nova', async () => {
  dados[42] = { ...dados[42], anexos: [] }
  let confirmar!: (value: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { confirmar = resolve }))
  montar(); await aguardarConversa(42); await receberFotoParaPedido()
  fireEvent.change(campo(), { target: { value: 'Pedido da conversa42.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: /^Pedido 43/ }))
  await aguardarConversa(43); await receberFotoParaPedido()
  fireEvent.change(campo(), { target: { value: 'Rascunho da conversa43.' } })
  await act(async () => confirmar(respostaComUploads))
  expect(screen.getByRole('button', { name: 'Remover o anexo foto.png' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Remover foto.png da conversa' })).toBeVisible()
  expect(campo()).toHaveValue('Rascunho da conversa43.')
  expect(screen.queryByText('Pedido recebido com os anexos.')).not.toBeInTheDocument()
  expect(api.del).not.toHaveBeenCalled(); expect(api.postForm).toHaveBeenCalledTimes(2)
})
