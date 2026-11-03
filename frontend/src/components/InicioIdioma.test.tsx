import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IdiomaProvider } from '../lib/i18n'
import { localizarInicio } from '../lib/i18nInicio'
import type { InicioOrganizacao, SolucaoInicio } from '../lib/inicio'
import { LandingSolucoes } from './LandingSolucoes'
import { SolucoesInicio } from './SolucoesInicio'
import { SeletorIdioma } from './SeletorIdioma'
import Login from '../pages/Login'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ usuario: null, carregando: false, login: vi.fn(), atualizarIdiomaInterface: vi.fn() }) }))
vi.mock('./FachadaAuth', () => ({ FachadaAuth: () => null }))
vi.mock('./ToggleTema', () => ({ ToggleTema: () => null }))
beforeEach(() => { localStorage.clear(); vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US') })
afterEach(() => vi.restoreAllMocks())

const solucao: SolucaoInicio = { id: 'capacidade:conteudo:video-material', origem: 'catalogo', andar: 'conteudo', tipo: 'video', titulo: 'Montar vídeo', descricao: 'Transforme suas fotos e clipes em um vídeo com a mensagem e o formato combinados.', prompt: 'Quero transformar minhas fotos e vídeos em um vídeo pronto para revisar. Vamos combinar a mensagem e o formato.', entrega: 'Vídeo MP4 para revisão', etapas: ['Material e objetivo', 'Roteiro e edição', 'Prévia para aprovar'], insumos: ['Fotos ou clipes utilizáveis'] }
const inicio: InicioOrganizacao = { org_id: 1, org_nome: 'Minha marca', meu_papel: 'owner', org_status: 'ativa', tem_chave: true, andares: [], solucoes: [solucao], outras_solucoes: [], sabatina: { estado: 'inicial', pergunta: 'Qual resultado você precisa primeiro?', permite_livre: true, opcoes: [{ id: solucao.id, label: solucao.titulo, prompt: solucao.prompt }] } }

it('login acompanha idioma do navegador e permite escolher português sem apagar o formulário', () => {
  render(<MemoryRouter><IdiomaProvider><Login /></IdiomaProvider></MemoryRouter>)
  const email = screen.getByRole('textbox', { name: 'Email' })
  fireEvent.change(email, { target: { value: 'joao@example.test' } })
  expect(screen.getByRole('heading', { name: 'Sign in to Offiz' })).toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pt-BR' } })
  expect(screen.getByRole('heading', { name: 'Entrar no Offiz' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'E-mail' })).toBe(email)
  expect(email).toHaveValue('joao@example.test')
})

it('vitrine traduz opções e preserva pedido livre ao mudar idioma', () => {
  render(<MemoryRouter><IdiomaProvider><SeletorIdioma /><LandingSolucoes logado /></IdiomaProvider></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Your material. A video that feels like you.' })).toBeInTheDocument()
  const campo = screen.getByRole('textbox')
  fireEvent.click(screen.getByRole('button', { name: 'Video and content' }))
  expect(campo).toHaveValue('I want to turn my materials into a video.')
  fireEvent.change(campo, { target: { value: 'Cliente João: preservar este texto.' } })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pt-BR' } })
  expect(screen.getByRole('heading', { name: 'Seu material. Um vídeo com a sua cara.' })).toBeInTheDocument()
  expect(screen.getByRole('textbox')).toBe(campo)
  fireEvent.click(screen.getByRole('button', { name: 'Outro pedido' }))
  expect(campo).toHaveValue('Cliente João: preservar este texto.')
})

it('início traduz capacidade, sabatina e rótulos de acessibilidade, sem criar trabalho', () => {
  const escolher = vi.fn()
  render(<IdiomaProvider><SolucoesInicio inicio={inicio} aoEscolher={escolher} /></IdiomaProvider>)
  expect(screen.getByRole('heading', { name: 'Let’s start with what you need.' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Next steps' })).toBeInTheDocument()
  expect(screen.queryByText('What result do you need first?')).not.toBeInTheDocument()
  expect(escolher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Start: Make a video' }))
  expect(escolher).toHaveBeenCalledWith(expect.stringContaining('I want to turn my photos and videos into a video'))
})

it('tradução do catálogo não altera dados originais nem título/pedido aprendidos ou modelos personalizados', () => {
  const aprendida = { ...solucao, id: 'aprendida:1', base_id: solucao.id, origem: 'aprendida' as const, motivo: 'Rotina de João' }
  const personalizada = { ...solucao, id: 'template:conteudo:0' }
  const original = { ...inicio, solucoes: [aprendida, personalizada] }
  const antes = JSON.stringify(original)
  const traduzido = localizarInicio(original, 'en')
  for (const item of traduzido.solucoes) {
    expect(item.titulo).toBe(solucao.titulo)
    expect(item.prompt).toBe(solucao.prompt)
    expect(item.entrega).toBe('MP4 video for review')
  }
  expect(traduzido.solucoes[0].motivo).toBe('Rotina de João')
  expect(JSON.stringify(original)).toBe(antes)
  expect(localizarInicio(original, 'pt-BR')).toBe(original)
})
