import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { InicioOrganizacao, SolucaoInicio } from '../lib/inicio'
import { SolucoesInicio } from './SolucoesInicio'

afterEach(cleanup)

const video: SolucaoInicio = {
  id: 'conteudo:7', andar: 'conteudo', prompt_pronto_id: 7, tipo: 'video',
  titulo: 'Um vídeo a partir do seu material', descricao: 'Cortes e legendas para revisão.',
  prompt: 'Quero editar um vídeo com meu material. Me ajude a definir formato e objetivo.',
  entrega: 'Vídeo para revisão', etapas: ['Conferir material', 'Editar', 'Revisar'],
  insumos: ['vídeo original', 'objetivo'],
}
const inicio: InicioOrganizacao = {
  org_id: 3, org_nome: 'Minha empresa', org_status: 'ativa', meu_papel: 'member', tem_chave: true,
  andares: [{ slug: 'conteudo', nome: 'Conteúdo', descricao: '', acervo_de_marca: true }],
  solucoes: [video], outras_solucoes: [],
  sabatina: {
    estado: 'inicial', pergunta: 'O que você precisa primeiro?', permite_livre: true,
    opcoes: [{ id: 'marca', label: 'Apresentar minha marca', prompt: 'Quero apresentar minha marca e entender o que podemos fazer.' }],
  },
}

it('escolher solução passa o briefing correto sem disparar uma entrega', () => {
  const aoEscolher = vi.fn()
  render(<SolucoesInicio inicio={inicio} aoEscolher={aoEscolher} />)
  expect(aoEscolher).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: `Começar: ${video.titulo}` })).toBeVisible()
  expect(screen.queryByText('Ver ideias de pedidos')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: `Começar: ${video.titulo}` }))
  expect(aoEscolher).toHaveBeenCalledExactlyOnceWith(video.prompt)
  expect(screen.queryByText('Fluxo previsto')).not.toBeInTheDocument()
})

it('oferece preparação inicial sem duplicar as sugestões', () => {
  const aoEscolher = vi.fn()
  render(<SolucoesInicio inicio={inicio} aoEscolher={aoEscolher} />)
  const opcao = screen.getByRole('button', { name: 'Apresentar minha marca' })
  fireEvent.click(opcao)
  expect(opcao).toHaveAttribute('aria-pressed', 'true')
  expect(aoEscolher).toHaveBeenLastCalledWith(inicio.sabatina.opcoes[0].prompt)
  expect(screen.queryByText('O que vamos resolver agora?')).not.toBeInTheDocument()
})

it('empresa sem capacidades continua com entrevista livre sem prometer entregas', () => {
  render(<SolucoesInicio inicio={{ ...inicio, andares: [], solucoes: [], outras_solucoes: [] }} aoEscolher={vi.fn()} />)
  expect(screen.getByText('Seu primeiro pedido ajuda a montar o escritório.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Apresentar minha marca' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Começar:/ })).not.toBeInTheDocument()
})

it('outras soluções preservam o briefing associado ao ID mesmo após reordenação', () => {
  const extra = { ...video, id: 'conteudo:2', prompt_pronto_id: 2, titulo: 'Planejar uma campanha', prompt: 'Quero planejar uma campanha.' }
  const aoEscolher = vi.fn()
  render(<SolucoesInicio inicio={{ ...inicio, outras_solucoes: [extra] }} aoEscolher={aoEscolher} />)
  expect(screen.getByText('Outros pedidos').closest('details')).not.toHaveAttribute('open')
  fireEvent.click(screen.getByText('Outros pedidos'))
  fireEvent.click(screen.getByRole('button', { name: extra.titulo }))
  expect(aoEscolher).toHaveBeenCalledExactlyOnceWith(extra.prompt)
})

it('não oferece controles pessoais para cartões do catálogo', () => {
  render(<SolucoesInicio inicio={{ ...inicio, solucoes: [{ ...video, origem: 'catalogo', fixada: true }] }} aoEscolher={vi.fn()} aoAtualizarSolucao={vi.fn()} />)
  expect(screen.queryByRole('button', { name: /Fixar:|Desfixar:|Ocultar:/ })).not.toBeInTheDocument()
  expect(screen.queryByText('Aprendido na conversa')).not.toBeInTheDocument()
})

it('área preparada evita reiniciar sabatina mesmo com entrevista geral pendente', () => {
  render(<SolucoesInicio inicio={{ ...inicio, sabatina: { ...inicio.sabatina, perfil_preparado: true } }} aoEscolher={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'O que vamos fazer hoje?' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Apresentar minha marca' })).not.toBeInTheDocument()
  expect(screen.queryByText('Ver ideias de pedidos')).not.toBeInTheDocument()
})

it('delegar a pauta prepara um pedido comum sem instruções técnicas', () => {
  const aoEscolher = vi.fn()
  render(<SolucoesInicio inicio={{ ...inicio, sabatina: { ...inicio.sabatina, perfil_preparado: true } }} aoEscolher={aoEscolher} />)
  expect(aoEscolher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Escolher uma pauta por mim' }))
  expect(aoEscolher).toHaveBeenCalledExactlyOnceWith('Faz um post para esta semana. Pode escolher o tema.')
})

it('rever o perfil é opcional e só preenche o pedido', () => {
  const aoEscolher = vi.fn()
  render(<SolucoesInicio inicio={{ ...inicio, sabatina: { ...inicio.sabatina, perfil_preparado: true } }} aoEscolher={aoEscolher} />)
  expect(aoEscolher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Rever meu perfil' }))
  expect(aoEscolher).toHaveBeenCalledExactlyOnceWith('Quero rever o que você sabe sobre minha empresa.')
})

it.each([
  { ...inicio },
  { ...inicio, andares: [], sabatina: { ...inicio.sabatina, perfil_preparado: true } },
  { ...inicio, andares: [{ ...inicio.andares[0], arquivado: true }], sabatina: { ...inicio.sabatina, perfil_preparado: true } },
])('não oferece produção delegada sem perfil ou área ativa de conteúdo', (dados) => {
  render(<SolucoesInicio inicio={dados} aoEscolher={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Escolher uma pauta por mim' })).not.toBeInTheDocument()
})
