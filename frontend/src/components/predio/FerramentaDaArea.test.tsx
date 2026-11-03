import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { OfficeInfo } from '../../lib/types'
import { FerramentaDaArea, ferramentasDaArea } from './FerramentaDaArea'

const carga = vi.hoisted(() => ({ importados: [] as string[], suspenderCasos: false,
  concluirCasos: null as (() => void) | null }))
vi.mock('./DashboardTab', () => { carga.importados.push('inicio'); return { DashboardTab: () => <p>Visão geral</p> } })
vi.mock('./MesesTab', () => { carga.importados.push('meses'); return { MesesTab: () => <p>Meses</p> } })
vi.mock('./ClientesTab', () => { carga.importados.push('clientes'); return { ClientesTab: () => <p>Clientes</p> } })
vi.mock('./PentestTab', () => { carga.importados.push('pentest'); return { PentestTab: () => <p>Segurança</p> } })
vi.mock('./CasosTab', async () => {
  carga.importados.push('casos')
  if (carga.suspenderCasos) await new Promise<void>(resolve => { carga.concluirCasos = resolve })
  return { CasosTab: ({ orgId, slug }: { orgId: number; slug: string }) => <p>Casos da empresa {orgId} · {slug}</p> }
})
vi.mock('./MonitorTab', () => { carga.importados.push('monitor'); return { MonitorTab: () => <p>Monitor</p> } })
vi.mock('./BibliotecaTab', () => { carga.importados.push('biblioteca'); return { BibliotecaTab: () => <p>Modelos</p> } })
vi.mock('./OficinaTab', () => { carga.importados.push('oficina'); return { OficinaTab: () => <p>Oficina</p> } })
vi.mock('./AgendaTab', () => { carga.importados.push('agenda'); return { AgendaTab: () => <p>Agenda</p> } })
vi.mock('./GuiaTab', () => { carga.importados.push('guia'); return { GuiaTab: () => <p>Guia aberto</p> } })
vi.mock('./ConhecimentoSimples', () => { carga.importados.push('conhecimento'); return { ConhecimentoSimples: () => <p>Conhecimento</p> } })
vi.mock('./EstudioTab', () => { carga.importados.push('estudio'); return { default: () => <p>Estúdio</p> } })
afterEach(cleanup)
const office: OfficeInfo = { slug: 'conteudo', nome: 'Conteúdo', descricao: '',
  tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const props = { orgId: 3, slug: 'conteudo', office, meuPapel: 'owner', navegar: vi.fn(), perguntar: vi.fn(), peca: null, trabalho: null }

it('carrega só a ferramenta autorizada ao abri-la, mantendo a empresa atual durante a espera', async () => {
  expect(ferramentasDaArea(office, 'conteudo', true).some(a => a.id === 'estudio')).toBe(true)
  const { container, rerender } = render(<FerramentaDaArea {...props} vista="conversa" />)
  expect(container).toBeEmptyDOMElement()
  expect(carga.importados).toEqual([])
  rerender(<FerramentaDaArea {...props} vista="casos" />)
  expect(container).toBeEmptyDOMElement()
  rerender(<FerramentaDaArea {...props} meuPapel="member" vista="conhecimento" />)
  expect(container).toBeEmptyDOMElement()
  expect(carga.importados).toEqual([])

  carga.suspenderCasos = true
  const juridico = { ...office, slug: 'juris', nome: 'Jurídico' }
  rerender(<FerramentaDaArea {...props} office={juridico} slug="juris" vista="casos" />)
  expect(await screen.findByRole('status')).toHaveTextContent('Abrindo')
  await waitFor(() => expect(carga.concluirCasos).toBeTypeOf('function'))
  rerender(<FerramentaDaArea {...props} orgId={8} office={juridico} slug="juris" vista="casos" />)
  await act(async () => carga.concluirCasos!())
  expect(await screen.findByText('Casos da empresa 8 · juris')).toBeVisible()
  expect(screen.queryByText('Casos da empresa 3 · juris')).not.toBeInTheDocument()
  expect(carga.importados).toEqual(['casos'])

  rerender(<FerramentaDaArea {...props} meuPapel="member" vista="guia" />)
  expect(await screen.findByText('Guia aberto')).toBeVisible()
  expect(carga.importados).toEqual(['casos', 'guia'])
})
