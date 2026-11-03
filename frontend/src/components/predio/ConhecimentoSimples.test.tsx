import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { ConhecimentoSimples } from './ConhecimentoSimples'
import { ApiError, api, baixarArquivo, carregarArquivo } from '../../lib/api'
import { IdiomaProvider } from '../../lib/i18n'

const contexto = vi.hoisted(() => ({ sessao: 'conta-a', sucesso: vi.fn(), falha: vi.fn(), eventos: new Map<string, (evento: unknown) => void>() }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), getSessionIdentity: () => contexto.sessao, api: { get: vi.fn(), post: vi.fn(), postForm: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() }, baixarArquivo: vi.fn(), carregarArquivo: vi.fn() }))
vi.mock('../Toasts', () => ({ useToasts: () => contexto }))
vi.mock('../../lib/ws', () => ({ wsClient: { on: (evento: string, fn: (evento: unknown) => void) => { contexto.eventos.set(evento, fn); return () => contexto.eventos.delete(evento) } } }))
vi.mock('./PortaVozes', () => ({ default: () => <div>Fotos e vozes</div> }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, atualizarIdiomaInterface: vi.fn() }) }))

const material = (sub = '', nome = 'documento.pdf') => ({ nome, sub, tamanho_bytes: 20, legenda: sub ? 'Documento da conversa' : 'Documento original', tags: ['referência'] })
let materiais = [material(), material('conversa-11/lote-a')]
let canon = '## Regras\nNunca inventar preços.'
let falharCanon = false
const dialogoPrototype = HTMLDialogElement.prototype
const dialogoMethods = Object.fromEntries(['showModal', 'close'].map(name => [name, Object.getOwnPropertyDescriptor(dialogoPrototype, name)]))
beforeAll(() => Object.defineProperties(dialogoPrototype, {
  showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } },
  close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } },
}))
afterAll(() => { for (const [name, descriptor] of Object.entries(dialogoMethods)) { if (descriptor) Object.defineProperty(dialogoPrototype, name, descriptor); else Reflect.deleteProperty(dialogoPrototype, name) } })
const resposta = (url: string) => {
  if (url.endsWith('/arquivos')) return { entrada: materiais, exemplos: [], produto: [] }
  if (url.endsWith('/canon')) { if (falharCanon) throw new Error('Sem conexão'); return { conteudo: canon } }
  if (url.endsWith('/licoes')) return []
  if (url.endsWith('/premissas')) return { conteudo: 'Objetivo confirmado da empresa.' }
  if (url.endsWith('/substituicoes')) return { substituicoes: [] }
  if (url.endsWith('/tarefas')) return { tarefas: [] }
  return { atividades: [] }
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); contexto.sessao = 'conta-a'; contexto.eventos.clear()
  materiais = [material(), material('conversa-11/lote-a')]; canon = '## Regras\nNunca inventar preços.'; falharCanon = false
  vi.mocked(api.get).mockImplementation(async url => resposta(url) as never)
  vi.mocked(api.del).mockResolvedValue(undefined)
  vi.mocked(api.patch).mockResolvedValue({ nome: 'atualizado.pdf' })
  vi.mocked(api.put).mockResolvedValue({})
  vi.mocked(baixarArquivo).mockResolvedValue(undefined)
  vi.mocked(carregarArquivo).mockResolvedValue('blob:material')
  vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const montar = () => render(<ConhecimentoSimples orgId={3} slug="juridico" />)

it('download do homônimo aninhado leva o sub completo sem atingir a raiz', async () => {
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Baixar conversa-11/lote-a/documento.pdf' }))
  expect(baixarArquivo).toHaveBeenCalledExactlyOnceWith('/predios/3/juridico/arquivos/entrada/documento.pdf?sub=conversa-11%2Flote-a', 'documento.pdf')
  expect(screen.getByRole('button', { name: 'Baixar documento.pdf' })).toBeInTheDocument()
})

it('miniaturas de imagens iguais usam os caminhos individuais', async () => {
  materiais = [material('', 'foto.jpg'), material('caso/ações', 'foto.jpg')]
  montar()
  await screen.findByRole('button', { name: 'Baixar caso/ações/foto.jpg' })
  expect(carregarArquivo).toHaveBeenCalledWith('/predios/3/juridico/arquivos/entrada/foto.jpg')
  expect(carregarArquivo).toHaveBeenCalledWith('/predios/3/juridico/arquivos/entrada/foto.jpg?sub=caso%2Fa%C3%A7%C3%B5es')
})

it('renomear abre um formulário revisável e atualiza só o homônimo escolhido', async () => {
  const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('Host sem prompt') })
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Renomear conversa-11/lote-a/documento.pdf' }))
  const campo = screen.getByRole('textbox', { name: 'Novo nome do arquivo' })
  expect(campo).toHaveValue('documento.pdf'); expect(campo).toHaveFocus()
  fireEvent.change(campo, { target: { value: 'atualizado.pdf' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nome' }))
  await waitFor(() => expect(api.patch).toHaveBeenCalledExactlyOnceWith('/predios/3/juridico/arquivos/entrada/documento.pdf?sub=conversa-11%2Flote-a', { novo_nome: 'atualizado.pdf' }))
  expect(screen.getByRole('button', { name: 'Baixar documento.pdf' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Baixar conversa-11/lote-a/atualizado.pdf' })).toBeInTheDocument()
  expect(prompt).not.toHaveBeenCalled()
})

it('salvar o novo nome devolve o foco ao arquivo renomeado', async () => {
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Renomear documento.pdf' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Novo nome do arquivo' }), { target: { value: 'atualizado.pdf' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nome' }))
  expect(await screen.findByRole('button', { name: 'Renomear atualizado.pdf' })).toHaveFocus()
})

it('Escape na renomeação conserva o nome e devolve foco ao controle de origem', async () => {
  montar()
  const origem = await screen.findByRole('button', { name: 'Renomear documento.pdf' })
  fireEvent.click(origem)
  fireEvent.change(screen.getByRole('textbox', { name: 'Novo nome do arquivo' }), { target: { value: 'outro.pdf' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Novo nome do arquivo' }), { key: 'Escape' })
  expect(screen.queryByRole('textbox', { name: 'Novo nome do arquivo' })).not.toBeInTheDocument()
  expect(origem).toHaveFocus(); expect(api.patch).not.toHaveBeenCalled()
})

it('erro de renomeação guarda a correção para tentar novamente', async () => {
  vi.mocked(api.patch).mockRejectedValueOnce(new Error('Sem conexão'))
  montar(); fireEvent.click(await screen.findByRole('button', { name: 'Renomear documento.pdf' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Novo nome do arquivo' }), { target: { value: 'atualizado.pdf' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nome' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui renomear')
  expect(screen.getByRole('textbox', { name: 'Novo nome do arquivo' })).toHaveValue('atualizado.pdf')
})

it('falha isolada do cânon não afirma que o usuário não tem regras', async () => {
  falharCanon = true
  montar()
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível')
  expect(screen.queryByText('A estante ainda está vazia.')).not.toBeInTheDocument()
  falharCanon = false
  fireEvent.click(screen.getByRole('button', { name: /Tentar de novo|Tentar novamente/ }))
  expect(await screen.findByText('Nunca inventar preços.')).toBeInTheDocument()
})

it('falha parcial na atualização conserva as regras e os materiais anteriores', async () => {
  montar(); await screen.findByText('Nunca inventar preços.')
  falharCanon = true
  act(() => contexto.eventos.get('job_status')?.({ org_id: 3 }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível')
  expect(screen.getByText('Nunca inventar preços.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Baixar conversa-11/lote-a/documento.pdf' })).toBeInTheDocument()
})

const consultasConhecimento = [
  { caminho: '/canon', pt: 'perfil', en: 'profile' },
  { caminho: '/licoes', pt: 'aprendizados', en: 'lessons' },
  { caminho: '/atividades', pt: 'atividades', en: 'activities' },
  { caminho: '/premissas', pt: 'objetivos e regras', en: 'goals and rules' },
  { caminho: '/tarefas', pt: 'pedidos', en: 'requests' },
  { caminho: '/substituicoes', pt: 'regras substituídas', en: 'replaced rules' },
  { caminho: '/arquivos', pt: 'materiais', en: 'materials' },
]
it.each(['pt-BR', 'en'] as const)('identifica cada leitura indisponível em %s sem revelar seu erro e recupera pelo retry', async idioma => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(idioma)
  for (const consulta of consultasConhecimento) {
    let indisponivel = true
    vi.mocked(api.get).mockImplementation(async url => {
      if (indisponivel && url.endsWith(consulta.caminho)) throw new ApiError(500, 'DETALHE_PRIVADO: endereco-interno/token-de-teste')
      return resposta(url) as never
    })
    const tela = render(<IdiomaProvider><ConhecimentoSimples orgId={3} slug="juridico" /></IdiomaProvider>)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(`${idioma === 'en' ? 'Could not read:' : 'Não foi possível ler:'} ${idioma === 'en' ? consulta.en : consulta.pt}.`)
    expect(tela.container).not.toHaveTextContent('DETALHE_PRIVADO')
    expect(screen.queryByText('Nunca inventar preços.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Baixar|Download) documento.pdf$/ })).not.toBeInTheDocument()
    indisponivel = false
    fireEvent.click(screen.getByRole('button', { name: idioma === 'en' ? 'Try again' : 'Tentar de novo' }))
    await screen.findByText('Nunca inventar preços.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${idioma === 'en' ? 'Download' : 'Baixar'} documento.pdf` })).toBeInTheDocument()
    tela.unmount()
  }
})

it('diagnóstico de atualização parcial lista só as falhas, preserva materiais e limpa o aviso após recuperar', async () => {
  montar(); await screen.findByText('Nunca inventar preços.')
  canon = '## Regras\nRegra atualizada da empresa.'
  let falhas = true
  vi.mocked(api.get).mockImplementation(async url => {
    if (falhas && (url.endsWith('/licoes') || url.endsWith('/arquivos'))) throw new Error('mensagem que não deve aparecer')
    return resposta(url) as never
  })
  act(() => contexto.eventos.get('job_status')?.({ org_id: 3 }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível ler: aprendizados, materiais.')
  expect(screen.getByRole('alert')).toHaveTextContent('Os dados da última consulta foram preservados.')
  expect(screen.getByText('Regra atualizada da empresa.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Baixar conversa-11/lote-a/documento.pdf' })).toBeInTheDocument()
  expect(screen.queryByText('mensagem que não deve aparecer')).not.toBeInTheDocument()
  falhas = false; materiais = [material('', 'novo.pdf')]
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByRole('button', { name: 'Baixar novo.pdf' })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Baixar documento.pdf' })).not.toBeInTheDocument()
})

it('falha atrasada de leitura da empresa antiga não aparece no painel atual', async () => {
  let rejeitar!: (motivo: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url.startsWith('/predios/3/') && url.endsWith('/licoes')
    ? new Promise((_resolve, reject) => { rejeitar = reject }) as never
    : resposta(url) as never)
  const tela = montar()
  tela.rerender(<ConhecimentoSimples orgId={4} slug="juridico" />)
  await screen.findByText('Nunca inventar preços.')
  await act(async () => rejeitar(new ApiError(500, 'erro antigo privado')))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Baixar documento.pdf' })).toBeInTheDocument()
})

it('consulta atrasada da outra empresa não substitui os dados atuais', async () => {
  let responder!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url.startsWith('/predios/3/') && url.endsWith('/canon') ? new Promise(resolve => { responder = resolve }) as never : url.endsWith('/canon') ? { conteudo: '## Regras\nRegra da empresa atual.' } as never : resposta(url) as never)
  const tela = montar()
  tela.rerender(<ConhecimentoSimples orgId={4} slug="juridico" />)
  await screen.findByText('Regra da empresa atual.')
  await act(async () => responder({ conteudo: '## Regras\nRegra antiga.' }))
  expect(screen.queryByText('Regra antiga.')).not.toBeInTheDocument()
  expect(screen.getByText('Regra da empresa atual.')).toBeInTheDocument()
})

it('erro ao salvar premissas é visível e conserva o texto editado', async () => {
  vi.mocked(api.put).mockRejectedValueOnce(new Error('Sem conexão'))
  montar(); fireEvent.click(await screen.findByRole('button', { name: 'Preencher / editar' }))
  const campo = screen.getByRole('textbox', { name: 'Objetivos e regras deste trabalho' })
  fireEvent.change(campo, { target: { value: 'Novo objetivo que ainda não foi salvo.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui salvar')
  expect(campo).toHaveValue('Novo objetivo que ainda não foi salvo.')
})

it('remoção confirma o caminho completo e só exclui o arquivo aninhado', async () => {
  const nativo = vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('Host sem confirmação') })
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Excluir conversa-11/lote-a/documento.pdf' }))
  const dialogo = screen.getByRole('dialog', { name: 'Remover arquivo do escritório' })
  expect(dialogo).toHaveTextContent('conversa-11/lote-a/documento.pdf')
  expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  expect(api.del).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Remover arquivo' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/predios/3/juridico/arquivos/entrada/documento.pdf?sub=conversa-11%2Flote-a'))
  expect(screen.getByRole('button', { name: 'Baixar documento.pdf' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Baixar conversa-11/lote-a/documento.pdf' })).not.toBeInTheDocument()
  expect(nativo).not.toHaveBeenCalled()
})

it.each(['botao', 'Escape'])('cancelar a remoção por %s não escreve e devolve foco ao arquivo', async modo => {
  montar()
  const origem = await screen.findByRole('button', { name: 'Excluir conversa-11/lote-a/documento.pdf' })
  origem.focus(); fireEvent.click(origem)
  if (modo === 'Escape') fireEvent.keyDown(screen.getByRole('button', { name: 'Cancelar' }), { key: 'Escape' })
  else fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.del).not.toHaveBeenCalled(); expect(origem).toHaveFocus()
})

it('falha de remoção conserva o arquivo e informa o motivo', async () => {
  vi.mocked(api.del).mockRejectedValueOnce(new Error('Sem conexão'))
  montar(); fireEvent.click(await screen.findByRole('button', { name: 'Excluir conversa-11/lote-a/documento.pdf' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remover arquivo' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith(expect.stringContaining('Não consegui excluir')))
  expect(screen.getByRole('button', { name: 'Baixar conversa-11/lote-a/documento.pdf' })).toBeInTheDocument()
})

it('trocar de empresa com confirmação aberta cancela a exclusão anterior', async () => {
  const tela = montar(); fireEvent.click(await screen.findByRole('button', { name: 'Excluir documento.pdf' }))
  tela.rerender(<ConhecimentoSimples orgId={4} slug="juridico" />)
  await screen.findByRole('button', { name: 'Baixar documento.pdf' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(api.del).not.toHaveBeenCalled()
})

it('atualização manual antiga não sobrescreve a empresa atual', async () => {
  const tela = montar(); await screen.findByText('Nunca inventar preços.')
  let responder!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url.startsWith('/predios/3/') && url.endsWith('/canon') ? new Promise(resolve => { responder = resolve }) as never : url.endsWith('/canon') ? { conteudo: '## Regras\nRegra da empresa atual.' } as never : resposta(url) as never)
  act(() => contexto.eventos.get('job_status')?.({ org_id: 3 }))
  tela.rerender(<ConhecimentoSimples orgId={4} slug="juridico" />)
  await screen.findByText('Regra da empresa atual.')
  await act(async () => responder({ conteudo: '## Regras\nRegra da empresa antiga.' }))
  expect(screen.queryByText('Regra da empresa antiga.')).not.toBeInTheDocument()
  expect(screen.getByText('Regra da empresa atual.')).toBeInTheDocument()
})

it('renomeação antiga não anuncia nem altera o material da empresa nova', async () => {
  let responder!: (valor: unknown) => void
  vi.mocked(api.patch).mockImplementationOnce(() => new Promise(resolve => { responder = resolve }))
  const tela = montar(); fireEvent.click(await screen.findByRole('button', { name: 'Renomear documento.pdf' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Novo nome do arquivo' }), { target: { value: 'atualizado.pdf' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nome' }))
  tela.rerender(<ConhecimentoSimples orgId={4} slug="juridico" />)
  await screen.findByRole('button', { name: 'Baixar documento.pdf' })
  await act(async () => responder({ nome: 'atualizado.pdf' }))
  expect(screen.queryByRole('button', { name: 'Baixar atualizado.pdf' })).not.toBeInTheDocument()
  expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('consulta iniciada antes de renomear não restaura o nome antigo', async () => {
  montar()
  await screen.findByRole('button', { name: 'Renomear documento.pdf' })
  let responder!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/arquivos')
    ? new Promise(resolve => { responder = resolve }) as never
    : resposta(url) as never)
  act(() => contexto.eventos.get('job_status')?.({ org_id: 3 }))
  fireEvent.click(screen.getByRole('button', { name: 'Renomear documento.pdf' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Novo nome do arquivo' }), { target: { value: 'atualizado.pdf' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nome' }))
  await screen.findByRole('button', { name: 'Baixar atualizado.pdf' })
  await act(async () => responder({ entrada: materiais, exemplos: [], produto: [] }))
  expect(screen.getByRole('button', { name: 'Baixar atualizado.pdf' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Baixar documento.pdf' })).not.toBeInTheDocument()
})

it('trocar de empresa interrompe o lote de uploads antes do próximo arquivo', async () => {
  let responder!: (valor: unknown) => void
  vi.mocked(api.postForm).mockImplementationOnce(() => new Promise(resolve => { responder = resolve }))
  const tela = montar()
  await screen.findByRole('button', { name: 'Baixar documento.pdf' })
  fireEvent.change(tela.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(['um'], 'primeiro.txt'), new File(['dois'], 'segundo.txt')] },
  })
  expect(api.postForm).toHaveBeenCalledTimes(1)
  tela.rerender(<ConhecimentoSimples orgId={4} slug="juridico" />)
  await screen.findByRole('button', { name: 'Baixar documento.pdf' })
  await act(async () => responder({}))
  expect(api.postForm).toHaveBeenCalledTimes(1)
  expect(contexto.sucesso).not.toHaveBeenCalled()
  expect(contexto.falha).not.toHaveBeenCalled()
})

it('conclusão de tarefa antiga não anuncia sucesso na empresa nova', async () => {
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/tarefas')
    ? { tarefas: [{ chave: 'apurar-conhecimento', titulo: 'Aprender com os materiais', descricao: 'Organizar o conhecimento.' }] } as never
    : resposta(url) as never)
  let responder!: (valor: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { responder = resolve }))
  const tela = montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Pode começar' }))
  tela.rerender(<ConhecimentoSimples orgId={4} slug="juridico" />)
  await screen.findByRole('button', { name: 'Pode começar' })
  await act(async () => responder({}))
  expect(contexto.sucesso).not.toHaveBeenCalled()
  expect(contexto.falha).not.toHaveBeenCalled()
})
