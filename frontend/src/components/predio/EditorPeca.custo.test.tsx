import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import EditorPeca from './EditorPeca'
import { api } from '../../lib/api'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }))
const toast = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn() }))
vi.mock('../Toasts', () => ({ useToasts: () => toast }))
const editor = { slug: 'aviso', titulo: 'Aviso de campanha', blocos: [], montagem: [], audio: { trilha: { existe: false, arquivo: '' }, narracao: { existe: false, arquivo: '' }, ducking: true }, final: { existe: false, master: '' }, custo_pendente: 0, trilha_falta: false }
const externo = { custo_total_estimado: false, custo_pendente_escopo: 'estimativa_fal', custos_fora_fal: [{ etapa: 'narracao', custo_usd: null, via: 'elevenlabs', fora_fal: true }], etapas_pendentes: [{ etapa: 'narracao', custo_usd: null, via: 'elevenlabs', fora_fal: true }], aviso_custo_externo: 'Narração ElevenLabs direta: custo externo não estimado.', pendencias: ['Confira a narração anterior antes de gerar.'] }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.mocked(api.get).mockImplementation(async path => path.endsWith('/editor') ? editor : { picos: [] }); vi.mocked(api.post).mockResolvedValue({}) })
afterEach(cleanup)
const montar = (aoPreencher = vi.fn()) => render(<EditorPeca orgId={3} officeSlug="conteudo" pecaSlug="aviso" aoFechar={vi.fn()} aoPreencher={aoPreencher} />)

it('composição gratuita fica disponível, mas não afirma produzir narração externa pendente', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/editor') ? { ...editor, ...externo } : { picos: [] })
  const preencher = vi.fn(); montar(preencher)
  expect(await screen.findByText(/custo externo não estimado/)).toBeVisible()
  expect(screen.getByText(/A composição local não gera a narração pendente/)).toBeVisible()
  expect(screen.getByText(/Estimativa fal.ai:/)).toHaveTextContent(/0,00/)
  fireEvent.click(screen.getByRole('button', { name: 'Ver como fica de verdade — US$ 0,00' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/predios/3/conteudo/estudio/pecas/aviso/recompor'))
  expect(preencher).not.toHaveBeenCalled()
})

it('geração pelo chat informa que a estimativa fal não é custo total quando há etapa externa', async () => {
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/editor') ? { ...editor, ...externo, custo_pendente: 1.25 } : { picos: [] })
  const preencher = vi.fn(); montar(preencher)
  fireEvent.click(await screen.findByRole('button', { name: /Gerar pendências/ }))
  expect(preencher).toHaveBeenCalledWith(expect.stringMatching(/estimativa fal.ai.*custo externo não estimado/i))
  expect(api.post).not.toHaveBeenCalled()
})

it('editor mantém custo confirmado de motor legado e não inventa custo externo', async () => {
  montar()
  expect(await screen.findByRole('button', { name: 'Ver como fica de verdade — US$ 0,00' })).toBeEnabled()
  expect(screen.queryByText(/custo externo/)).not.toBeInTheDocument()
})
