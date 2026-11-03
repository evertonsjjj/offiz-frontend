import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ConversaTab } from './ConversaTab'
import { api, getSessionIdentity, setTokens } from '../../lib/api'
import { escopoRascunhos, guardarRascunho, lerRascunhos } from '../../lib/rascunhosConversa'
import type { PreparacaoNaConversa } from '../../lib/perfilSabatina'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), postForm: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn(), notificar: vi.fn() }) }))
const office = { slug: 'predio', nome: 'Aurora', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const conversa = { id: 42, titulo: 'Campanha da consulta', atualizado_em: '2026-09-13T00:00:00Z', total_mensagens: 0, mensagens: [], anexos: [] }
const campo = () => screen.getByRole('textbox', { name: 'Seu pedido' })
const dados = (conversaId: number | null = null): PreparacaoNaConversa => ({ orgId: 1, slug: 'conteudo', sessao: getSessionIdentity(), origem: 'preparacao', destino: { slug: 'predio', conversaId }, textos: ['Sou psicóloga clínica.', 'Atendo adultos online.'] })
const tela = (preparacao?: PreparacaoNaConversa, rota = '/app?org=1&conversa=nova', orgId = 1, slug = 'predio') => <StrictMode><MemoryRouter initialEntries={[rota]}><ConversaTab orgId={orgId} slug={slug} office={office} nivelPredio={slug === 'predio'} rascunhoInicial={preparacao ? { texto: preparacao.textos.join('\n\n'), chave: 1, preparacao } : undefined} /></MemoryRouter></StrictMode>
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  setTokens('sintetico', 'sintetico')
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42' ? conversa : { conversas: [conversa] })
})
function semEscritas() {
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
  expect(api.postForm).not.toHaveBeenCalled()
}

it('leva os textos literais à nova conversa e distingue rascunho de perfil guardado, sem enviar', async () => {
  render(tela(dados()))
  await waitFor(() => expect(campo()).toHaveValue('Sou psicóloga clínica.\n\nAtendo adultos online.'))
  expect(screen.getByRole('status', { name: 'Informações da preparação' })).toHaveTextContent('ainda não foram guardadas no perfil')
  await waitFor(() => expect(lerRascunhos(escopoRascunhos(1, 'predio', true)).nova.texto).toBe('Sou psicóloga clínica.\n\nAtendo adultos online.'))
  semEscritas()
})

it.each(['acrescentar', 'descartar'])('preserva o pedido e sua referência até a escolha explícita de %s as informações', async escolha => {
  const referencia = { jobId: 77, entregaId: 88, intencao: 'ajustar' as const }
  const escopo = escopoRascunhos(1, 'predio', true)
  guardarRascunho(escopo, '42', 'Melhora a campanha existente.', referencia)
  render(tela(dados(42), '/app?org=1&conversa=42'))
  const aviso = await screen.findByRole('status', { name: 'Informações da preparação' })
  expect(campo()).toHaveValue('Melhora a campanha existente.')
  expect(aviso).toHaveTextContent('Seu rascunho atual foi preservado.')
  expect(lerRascunhos(escopo)['42'].referencia).toEqual(referencia)
  semEscritas()
  fireEvent.click(screen.getByRole('button', { name: escolha === 'acrescentar' ? 'Acrescentar estas informações' : 'Manter só meu rascunho' }))
  const esperado = escolha === 'acrescentar' ? 'Melhora a campanha existente.\n\nSou psicóloga clínica.\n\nAtendo adultos online.' : 'Melhora a campanha existente.'
  await waitFor(() => expect(campo()).toHaveValue(esperado))
  await waitFor(() => expect(lerRascunhos(escopo)['42']).toMatchObject({ texto: esperado, referencia }))
  if (escolha === 'acrescentar') expect(campo()).toHaveFocus()
  else expect(screen.queryByRole('status', { name: 'Informações da preparação' })).not.toBeInTheDocument()
  semEscritas()
})

it.each(['sessao', 'empresa', 'area', 'assunto'])('não aceita informações cujo destino mudou em %s', async mudanca => {
  const preparacao = dados()
  if (mudanca === 'sessao') setTokens('outra-conta', 'outro-refresh')
  render(tela(preparacao, mudanca === 'assunto' ? '/app?org=1&conversa=42' : '/app?org=1&conversa=nova', mudanca === 'empresa' ? 2 : 1, mudanca === 'area' ? 'juris' : 'predio'))
  await screen.findByRole('button', { name: /^Campanha da consulta/ })
  expect(campo()).toHaveValue('')
  expect(screen.queryByRole('status', { name: 'Informações da preparação' })).not.toBeInTheDocument()
  semEscritas()
})

it('uma consulta atrasada não incorpora o texto ao outro assunto nem ao voltar depois', async () => {
  let resolver!: (value: unknown) => void
  const consulta = new Promise(resolve => { resolver = resolve })
  vi.mocked(api.get).mockImplementation(async path => path === '/conversas/42' ? consulta : { conversas: [conversa] })
  render(tela(dados(42), '/app?org=1&conversa=42'))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/conversas/42', expect.any(AbortSignal)))
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  fireEvent.change(campo(), { target: { value: 'Meu outro pedido.' } })
  await act(async () => { resolver(conversa) })
  expect(campo()).toHaveValue('Meu outro pedido.')
  expect(screen.queryByRole('status', { name: 'Informações da preparação' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Campanha da consulta'))
  await waitFor(() => expect(campo()).toHaveValue(''))
  expect(screen.queryByRole('status', { name: 'Informações da preparação' })).not.toBeInTheDocument()
  semEscritas()
})
