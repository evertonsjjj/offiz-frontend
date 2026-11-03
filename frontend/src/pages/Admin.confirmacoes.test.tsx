import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AdminPage from './Admin'
import { api } from '../lib/api'
import { instalarDialogoDeTeste } from '../test/dialog'

const toast = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn() }))
const sessao = vi.hoisted(() => ({ atual: 'admin-fixture-1' }))
vi.mock('../components/Toasts', () => ({ useToasts: () => toast }))
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(),
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), del: vi.fn() },
  getSessionIdentity: () => sessao.atual,
}))
instalarDialogoDeTeste()
const org = { id: 3, nome: 'Cliente de teste', slug: 'cliente-teste', status: 'ativa', assentos: 5, membros: 2, offices: ['conteudo'] }
const usuario = { id: 7, nome: 'Pessoa de teste', email: 'pessoa@example.invalid', pode_excluir: true, orgs: [] }
const reset = { nome: usuario.nome, email: usuario.email, link: 'https://example.invalid/redefinir/fixture', email_enviado: false, expira_em_horas: 24 }
const clipboardAnterior = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  if (clipboardAnterior) Object.defineProperty(navigator, 'clipboard', clipboardAnterior)
  else Reflect.deleteProperty(navigator, 'clipboard')
})
beforeEach(() => {
  vi.clearAllMocks()
  sessao.atual = 'admin-fixture-1'
  vi.mocked(api.get).mockImplementation(async caminho => caminho === '/admin/orgs' ? [org]
    : caminho === '/admin/usuarios' ? [usuario] : [])
  vi.mocked(api.put).mockResolvedValue({})
  vi.mocked(api.post).mockResolvedValue(reset)
  vi.mocked(api.del).mockResolvedValue({})
})
async function clientes() {
  render(<AdminPage />)
  await screen.findByText(org.nome)
  fireEvent.click(screen.getByText('Gerenciar'))
}
async function pessoas() {
  render(<AdminPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Pessoas e acessos' }))
  await screen.findByText(usuario.nome)
}
it('cancelar o motivo da suspensão não suspende o cliente', async () => {
  await clientes()
  fireEvent.click(screen.getByRole('button', { name: 'Suspender' }))
  const dialogo = screen.getByRole('dialog', { name: `Suspender ${org.nome}` })
  expect(dialogo).toHaveTextContent('nenhuma tarefa nova é aceita')
  fireEvent.change(within(dialogo).getByRole('textbox'), { target: { value: 'motivo que não autorizei' } })
  await act(async () => fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' })))
  expect(api.put).not.toHaveBeenCalled()
  expect(toast.sucesso).not.toHaveBeenCalled()
})
it('confirma a suspensão sem inventar motivo e impede repetir enquanto salva', async () => {
  let resolver!: (resposta: unknown) => void
  vi.mocked(api.put).mockImplementation(() => new Promise(r => { resolver = r }))
  await clientes()
  fireEvent.click(screen.getByRole('button', { name: 'Suspender' }))
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspender' })))
  expect(api.put).toHaveBeenCalledExactlyOnceWith('/admin/orgs/3/status', { status: 'suspensa', motivo: undefined })
  expect(screen.getByRole('button', { name: 'Suspender' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Suspender' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => resolver({ tarefas_na_fila: 2 }))
  expect(toast.sucesso).toHaveBeenCalledWith(expect.stringContaining('2 tarefa(s) ficaram paradas'))
})
it('valida assentos na mesma tela sem remover pessoas nem aceitar frações', async () => {
  await clientes()
  fireEvent.click(screen.getByRole('button', { name: '2/5' }))
  const dialogo = screen.getByRole('dialog')
  expect(dialogo).toHaveTextContent('ninguém é removido')
  const campo = within(dialogo).getByRole('spinbutton')
  fireEvent.change(campo, { target: { value: '1.5' } })
  fireEvent.submit(campo.closest('form')!)
  expect(within(dialogo).getByRole('alert')).toHaveTextContent('número inteiro')
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.change(campo, { target: { value: '1' } })
  await act(async () => fireEvent.submit(campo.closest('form')!))
  expect(api.put).toHaveBeenCalledExactlyOnceWith('/admin/orgs/3/assentos', { assentos: 1 })
})
it('excluir conta exige o e-mail exato e permite corrigir sem perder o texto', async () => {
  await pessoas()
  fireEvent.click(within(screen.getByText(usuario.nome).closest('tr')!).getByRole('button', { name: 'Excluir' }))
  const campo = screen.getByRole('textbox', { name: 'E-mail para confirmar a exclusão' })
  expect(screen.getByRole('dialog')).toHaveTextContent('as participações em organizações e as conversas')
  fireEvent.change(campo, { target: { value: 'outra@example.invalid' } })
  fireEvent.submit(campo.closest('form')!)
  expect(screen.getByRole('alert')).toHaveTextContent('E-mail não confere')
  expect(api.del).not.toHaveBeenCalled()
  fireEvent.change(campo, { target: { value: ' PESSOA@EXAMPLE.INVALID ' } })
  await act(async () => fireEvent.submit(campo.closest('form')!))
  expect(api.del).toHaveBeenCalledExactlyOnceWith('/admin/usuarios/7')
})
it('troca de e-mail explica perda do admin e cancelar não altera o login', async () => {
  await pessoas()
  fireEvent.click(screen.getByRole('button', { name: 'Trocar e-mail' }))
  const dialogo = screen.getByRole('dialog')
  expect(dialogo).toHaveTextContent('perde o admin global IMEDIATAMENTE')
  expect(within(dialogo).getByRole('textbox', { name: 'Novo e-mail de login' })).toHaveValue(usuario.email)
  await act(async () => fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' })))
  expect(api.put).not.toHaveBeenCalled()
})
it('trocar de seção cancela a intenção e voltar não a reabre', async () => {
  await clientes()
  fireEvent.click(screen.getByRole('button', { name: 'Suspender' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pessoas e acessos' })))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clientes e demos' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.put).not.toHaveBeenCalled()
})
it('falha ao copiar mantém o link selecionável e não afirma que copiou', async () => {
  const copiar = vi.fn().mockRejectedValue(new Error('Área de transferência indisponível'))
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copiar } })
  await pessoas()
  fireEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('invalida qualquer link anterior')
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gerar link' })))
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/admin/usuarios/7/reset-senha')
  toast.sucesso.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }))
  await waitFor(() => expect(toast.falha).toHaveBeenCalledWith(expect.stringContaining('copie manualmente')))
  expect(screen.getByDisplayValue(reset.link)).toHaveFocus()
  expect(screen.getByDisplayValue(reset.link)).toBeVisible()
  expect(toast.sucesso).not.toHaveBeenCalled()
})

it('cancelar a exigência de banco próprio não bloqueia a organização', async () => {
  await clientes()
  fireEvent.click(screen.getByRole('button', { name: /central/ }))
  const dialogo = screen.getByRole('dialog')
  expect(dialogo).toHaveTextContent('a organização PARA de trabalhar')
  await act(async () => fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' })))
  expect(api.put).not.toHaveBeenCalled()
})

it('um reset pendente impede outro reset ou alteração da mesma conta', async () => {
  let concluir!: (valor: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { concluir = r }))
  await pessoas()
  fireEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gerar link' })))
  expect(screen.getByRole('button', { name: 'Redefinir senha' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Trocar e-mail' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))
  expect(api.post).toHaveBeenCalledTimes(1)
  await act(async () => concluir(reset))
  expect(screen.getByRole('button', { name: 'Redefinir senha' })).toBeEnabled()
  expect(screen.getByDisplayValue(reset.link)).toBeVisible()
})

it('mudar de sessão descarta link privado e resposta de reset pendente', async () => {
  let concluir!: (valor: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { concluir = r }))
  const tela = render(<AdminPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Pessoas e acessos' }))
  await screen.findByText(usuario.nome)
  fireEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gerar link' })))
  sessao.atual = 'admin-fixture-2'
  await act(async () => tela.rerender(<AdminPage />))
  await act(async () => concluir(reset))
  expect(screen.queryByDisplayValue(reset.link)).not.toBeInTheDocument()
  expect(toast.sucesso).not.toHaveBeenCalled()
})

it('carrega usuários apenas ao abrir a seção e oferece nova leitura após falha', async () => {
  let falhou = false
  vi.mocked(api.get).mockImplementation(async caminho => {
    if (caminho === '/admin/usuarios') {
      if (!falhou) { falhou = true; throw new Error('rede indisponível') }
      return [usuario]
    }
    return caminho === '/admin/orgs' ? [org] : []
  })
  render(<AdminPage />)
  await screen.findByText(org.nome)
  expect(vi.mocked(api.get).mock.calls.some(([rota]) => rota === '/admin/usuarios')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Pessoas e acessos' }))
  const aviso = await screen.findByRole('alert')
  expect(aviso).toHaveTextContent('Não foi possível listar os usuários')
  fireEvent.click(within(aviso).getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText(usuario.nome)).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('resposta antiga de usuários não substitui a lista depois de voltar à seção', async () => {
  let concluir!: (valor: unknown) => void
  let pedidos = 0
  vi.mocked(api.get).mockImplementation(async caminho => {
    if (caminho !== '/admin/usuarios') return caminho === '/admin/orgs' ? [org] : []
    if (++pedidos === 1) return new Promise(r => { concluir = r })
    return [usuario]
  })
  render(<AdminPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Pessoas e acessos' }))
  await waitFor(() => expect(pedidos).toBe(1))
  fireEvent.click(screen.getByRole('button', { name: 'Clientes e demos' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pessoas e acessos' }))
  expect(await screen.findByText(usuario.nome)).toBeVisible()
  await act(async () => concluir([{ ...usuario, nome: 'Resposta antiga' }]))
  expect(screen.getByText(usuario.nome)).toBeVisible()
  expect(screen.queryByText('Resposta antiga')).not.toBeInTheDocument()
})

it('o custo do período novo não é substituído pela consulta atrasada do período anterior', async () => {
  let concluir!: (valor: unknown) => void
  vi.mocked(api.get).mockImplementation(async caminho => {
    if (caminho === '/admin/stats?dias=30') return new Promise(r => { concluir = r })
    if (caminho === '/admin/stats?dias=7') return { jobs_total: 3, custo_brl: 12.34, jobs_por_status: { done: 3 } }
    if (caminho === '/admin/storage') return { orgs: [], total_bytes: 0, orfaos_bytes: 0 }
    return caminho === '/admin/orgs' ? [org] : []
  })
  render(<AdminPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Operação e histórico' }))
  await waitFor(() => expect(concluir).toBeTypeOf('function'))
  fireEvent.click(screen.getByRole('button', { name: '7 dias' }))
  expect(await screen.findByText('R$ 12,34')).toBeVisible()
  await act(async () => concluir({ jobs_total: 30, custo_brl: 987.65, jobs_por_status: { done: 30 } }))
  expect(screen.getByText('R$ 12,34')).toBeVisible()
  expect(screen.queryByText('R$ 987,65')).not.toBeInTheDocument()
})

it('uma consulta de estatísticas que falha pode ser refeita sem trocar de período', async () => {
  let tentativas = 0
  vi.mocked(api.get).mockImplementation(async caminho => {
    if (caminho === '/admin/stats?dias=30') {
      if (++tentativas === 1) throw new Error('temporário')
      return { jobs_total: 3, custo_brl: 12.34, jobs_por_status: { done: 3 } }
    }
    if (caminho === '/admin/storage') return { orgs: [], total_bytes: 0, orfaos_bytes: 0 }
    return caminho === '/admin/orgs' ? [org] : []
  })
  render(<AdminPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Operação e histórico' }))
  const secao = screen.getByRole('heading', { name: 'Visão geral' }).closest('section')!
  expect(await within(secao).findByRole('alert')).toHaveTextContent('Não foi possível carregar as estatísticas')
  fireEvent.click(within(secao).getByRole('button', { name: 'Tentar novamente' }))
  expect(await within(secao).findByText('R$ 12,34')).toBeVisible()
  expect(tentativas).toBe(2)
})

it('erro no log permite repetir só a consulta sem reenviar o trabalho', async () => {
  let consultas = 0
  vi.mocked(api.get).mockImplementation(async caminho => {
    if (caminho === '/admin/stats?dias=30') return { jobs_total: 1, jobs_por_status: { failed: 1 } }
    if (String(caminho).startsWith('/admin/jobs?')) return { jobs: [{ id: 19, org_id: 3, org_nome: org.nome,
      office_slug: 'conteudo', status: 'failed', criado_em: null, erro: null, custo_brl: 0, prompt_resumo: 'Pedido de teste' }] }
    if (caminho === '/jobs/19/events') {
      if (++consultas === 1) throw new Error('temporário')
      return { events: [{ tipo: 'agent_text', payload: { texto: 'Registro recuperado sem executar IA.' } }] }
    }
    if (caminho === '/admin/storage') return { orgs: [], total_bytes: 0, orfaos_bytes: 0 }
    return caminho === '/admin/orgs' ? [org] : []
  })
  render(<AdminPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Operação e histórico' }))
  fireEvent.click(await screen.findByRole('button', { name: /Falhou: 1/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Pedido de teste/ }))
  const aviso = await screen.findByText('Não consegui ler o log desta tarefa.')
  fireEvent.click(within(aviso.parentElement!).getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('Registro recuperado sem executar IA.')).toBeVisible()
  expect(consultas).toBe(2)
  expect(api.post).not.toHaveBeenCalled()
})

it('uma cópia que termina em outra seção não toma o foco nem anuncia sucesso', async () => {
  let rejeitar!: (erro: Error) => void
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: vi.fn(() => new Promise<void>((_, rejeita) => { rejeitar = rejeita })),
  } })
  await pessoas()
  fireEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gerar link' })))
  toast.sucesso.mockClear(); toast.falha.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }))
  const clientes = screen.getByRole('button', { name: 'Clientes e demos' })
  fireEvent.click(clientes); clientes.focus()
  await act(async () => rejeitar(new Error('clipboard indisponível')))
  expect(clientes).toHaveFocus()
  expect(toast.falha).not.toHaveBeenCalled()
  expect(toast.sucesso).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Pessoas e acessos' }))
  expect(screen.getByDisplayValue(reset.link)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Copiar link' })).toBeEnabled()
})

it('a lista antiga não desfaz na tela uma consulta mais nova de assentos', async () => {
  let concluirAntiga!: (resposta: unknown) => void
  let consultas = 0
  vi.mocked(api.get).mockImplementation(async caminho => {
    if (caminho !== '/admin/orgs') return []
    consultas++
    if (consultas === 2) return new Promise(r => { concluirAntiga = r })
    return [{ ...org, assentos: consultas === 1 ? 5 : 7 }]
  })
  await clientes()
  async function salvarAssentos(valor: string) {
    fireEvent.click(screen.getByRole('button', { name: '2/5' }))
    const campo = screen.getByRole('spinbutton', { name: 'Quantidade de assentos' })
    fireEvent.change(campo, { target: { value: valor } })
    await act(async () => fireEvent.submit(campo.closest('form')!))
  }
  await salvarAssentos('6')
  await waitFor(() => expect(consultas).toBe(2))
  await salvarAssentos('7')
  expect(await screen.findByRole('button', { name: '2/7' })).toBeVisible()
  await act(async () => concluirAntiga([{ ...org, assentos: 6 }]))
  expect(screen.getByRole('button', { name: '2/7' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '2/6' })).not.toBeInTheDocument()
})

it('catálogo indisponível aparece como falha recuperável em vez de nenhuma área', async () => {
  let consultas = 0
  vi.mocked(api.get).mockImplementation(async caminho => {
    if (caminho === '/offices') {
      if (++consultas === 1) throw new Error('temporário')
      return [{ slug: 'conteudo', nome: 'Conteúdo e marca' }]
    }
    return caminho === '/admin/orgs' ? [org] : []
  })
  render(<AdminPage />)
  const aviso = await screen.findByRole('alert')
  expect(aviso).toHaveTextContent('Não foi possível carregar as áreas')
  fireEvent.click(within(aviso).getByRole('button', { name: 'Tentar novamente' }))
  await waitFor(() => expect(consultas).toBe(2))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})

it('falha na lista de clientes permite repetir a leitura sem criar nem alterar clientes', async () => {
  let consultas = 0
  vi.mocked(api.get).mockImplementation(async caminho => {
    if (caminho === '/admin/orgs') {
      if (++consultas === 1) throw new Error('temporário')
      return [org]
    }
    return []
  })
  render(<AdminPage />)
  const aviso = await screen.findByRole('alert')
  expect(aviso).toHaveTextContent('Não foi possível listar as organizações')
  expect(screen.queryByText('Nenhuma organização criada ainda.')).not.toBeInTheDocument()
  fireEvent.click(within(aviso).getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText(org.nome)).toBeVisible()
  expect(consultas).toBe(2)
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
  expect(api.del).not.toHaveBeenCalled()
})

it('sair da seção encerra a confirmação de exclusão da organização sem aceitar a intenção antiga', async () => {
  await clientes()
  fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
  const dialogo = screen.getByRole('dialog', { name: 'Excluir organização' })
  fireEvent.change(within(dialogo).getByRole('textbox'), { target: { value: org.slug } })
  fireEvent.click(screen.getByRole('button', { name: 'Pessoas e acessos' }))
  expect(screen.queryByRole('dialog', { name: 'Excluir organização' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clientes e demos' }))
  expect(screen.queryByRole('dialog', { name: 'Excluir organização' })).not.toBeInTheDocument()
  expect(api.del).not.toHaveBeenCalled()
})

it('resposta de exclusão após sair da seção não reabre erro nem toma a nova tela', async () => {
  let rejeitar!: (erro: Error) => void
  vi.mocked(api.del).mockImplementation(() => new Promise((_, rejeita) => { rejeitar = rejeita }))
  await clientes()
  fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
  const dialogo = screen.getByRole('dialog', { name: 'Excluir organização' })
  fireEvent.change(within(dialogo).getByRole('textbox'), { target: { value: org.slug } })
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Excluir definitivamente' }))
  expect(api.del).toHaveBeenCalledExactlyOnceWith('/admin/orgs/3', { confirmar_slug: org.slug })
  fireEvent.click(screen.getByRole('button', { name: 'Pessoas e acessos' }))
  await act(async () => rejeitar(new Error('resposta tardia')))
  fireEvent.click(screen.getByRole('button', { name: 'Clientes e demos' }))
  expect(screen.queryByRole('dialog', { name: 'Excluir organização' })).not.toBeInTheDocument()
  expect(screen.queryByText('Não foi possível excluir a organização.')).not.toBeInTheDocument()
  expect(toast.sucesso).not.toHaveBeenCalled()
})
