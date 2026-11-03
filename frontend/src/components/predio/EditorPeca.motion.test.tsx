import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import EditorPeca from './EditorPeca'
import { api } from '../../lib/api'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }))
const toast = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn() }))
vi.mock('../Toasts', () => ({ useToasts: () => toast }))
const bloco = { id: 'abertura', tipo: 'cartela', rotulo: 'Chamada', entrada_s: 0, saida_s: 5, dur: 5, direcao: '', travado: false, nota: '', letreiro: ['ÀS 20H — É HOJE'], fontes: [], takes: [], gera: false, custo_usd: 0, recompoe: true, comp: null, motion: true }
const editor = { slug: 'chamada', titulo: 'Chamada de jogo', blocos: [bloco], montagem: ['abertura'], audio: { trilha: { existe: false, arquivo: '' }, narracao: { existe: false, arquivo: '' }, ducking: true }, final: { existe: false, master: '' }, custo_pendente: 0, trilha_falta: false, composicao_local_disponivel: false }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.mocked(api.get).mockImplementation(async path => path.endsWith('/editor') ? editor : { picos: [] }) })
afterEach(cleanup)
const montar = (preencher = vi.fn()) => render(<EditorPeca orgId={3} officeSlug="conteudo" pecaSlug="chamada" aoFechar={vi.fn()} aoPreencher={preencher} />)

it('encaminha a atualização indisponível para um rascunho no chat sem render ou geração automática', async () => {
  const preencher = vi.fn(); montar(preencher)
  fireEvent.click(await screen.findByRole('button', { name: 'Aplicar ajustes pela conversa' }))
  expect(preencher).toHaveBeenCalledWith(expect.stringMatching(/chamada.*ajustes salvos.*não gere nova mídia paga/))
  expect(api.post).not.toHaveBeenCalled()
  expect(api.patch).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Ver como fica de verdade — US$ 0,00' })).not.toBeInTheDocument()
})

it('mostra os textos reais da animação e omite controles de geração que não a alteram', async () => {
  montar()
  expect(await screen.findByRole('list', { name: 'Textos da animação' })).toHaveTextContent('ÀS 20H — É HOJE')
  expect(screen.queryByLabelText('seed')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Salvar direção' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '💬 Falar com este bloco' })).toBeEnabled()
})

it('não esconde geração paga pendente de outro bloco atrás do caminho de composição', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/editor') ? { ...editor, custo_pendente: 1.5 } : { picos: [] })
  const preencher = vi.fn(); montar(preencher)
  fireEvent.click(await screen.findByRole('button', { name: /Gerar pendências/ }))
  expect(preencher).toHaveBeenCalledWith(expect.stringMatching(/custo estimado/))
  expect(screen.queryByRole('button', { name: 'Aplicar ajustes pela conversa' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('preserva recomposição direta quando a capacidade está disponível', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/editor') ? { ...editor, composicao_local_disponivel: true } : { picos: [] })
  montar()
  expect(await screen.findByRole('button', { name: 'Ver como fica de verdade — US$ 0,00' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Aplicar ajustes pela conversa' })).not.toBeInTheDocument()
})

it('identifica o arquivo da fonte sem oferecer um visor de imagem incompatível', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/editor') ? { ...editor, blocos: [{ ...bloco, fontes: ['acervo/logo.png', 'acervo/Marca.ttf'] }] } : { picos: [] })
  montar()
  expect(await screen.findByText('Marca.ttf')).toHaveAttribute('title', 'Fonte tipográfica usada na animação')
  expect(screen.queryByRole('button', { name: /Marca.ttf/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /logo.png/ })).toBeEnabled()
})

it('resume os recursos da animação presentes sem oferecer controles técnicos ou executar alterações', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/editor') ? { ...editor, blocos: [{ ...bloco, motion_features: ['keyframes', 'gradient', 'shadow', 'unknown', 'shadow'] }] } : { picos: [] })
  montar()
  const features = await screen.findByRole('list', { name: 'Recursos da animação' })
  expect(features).toHaveTextContent('Movimento personalizado')
  expect(features).toHaveTextContent('Degradê')
  expect(features).toHaveTextContent('Sombra')
  expect(features.querySelectorAll('li')).toHaveLength(3)
  expect(features.querySelector('button, input, textarea')).toBeNull()
  expect(screen.queryByLabelText('seed')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.patch).not.toHaveBeenCalled()
})

it('conserva respostas antigas sem inventar recursos da animação', async () => {
  montar()
  await screen.findByRole('list', { name: 'Textos da animação' })
  expect(screen.queryByRole('list', { name: 'Recursos da animação' })).not.toBeInTheDocument()
})

it('não apresenta recursos motion em um bloco de mídia comum', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/editor') ? { ...editor, blocos: [{ ...bloco, motion: false, motion_features: ['shadow'] }] } : { picos: [] })
  montar()
  await screen.findByLabelText('seed')
  expect(screen.queryByRole('list', { name: 'Recursos da animação' })).not.toBeInTheDocument()
})

it.each([
  { name: 'nomes do protótipo', value: ['constructor', 'toString', '__proto__'], expected: [] },
  { name: 'elementos não textuais', value: [null, {}, [], ['shadow'], 1, true], expected: [] },
  { name: 'elementos misturados', value: ['constructor', {}, ['gradient'], 'shadow', null, 'toString'], expected: ['Sombra'] },
  { name: 'objeto', value: { shadow: true }, expected: [] },
  { name: 'string', value: 'shadow', expected: [] },
  { name: 'null', value: null, expected: [] },
  { name: 'número', value: 1, expected: [] },
])('ignora payload inesperado de recursos: $name', async ({ value, expected }) => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/editor') ? { ...editor, blocos: [{ ...bloco, motion_features: value }] } : { picos: [] })
  montar()
  await screen.findByRole('list', { name: 'Textos da animação' })
  const features = screen.queryByRole('list', { name: 'Recursos da animação' })
  if (expected.length) {
    expect(features).toHaveTextContent(expected[0])
    expect(features?.querySelectorAll('li')).toHaveLength(expected.length)
  } else {
    expect(features).not.toBeInTheDocument()
  }
  expect(api.post).not.toHaveBeenCalled()
  expect(api.patch).not.toHaveBeenCalled()
})
