import { afterEach, expect, it, vi } from 'vitest'
import { formatBRL, formatBytes, formatData, formatDataHora, formatTokens, statusEntregaLabel, statusJobLabel, tempoRelativo, tipoEntregaLabel } from './format'

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

it('locale altera apresentação de números e datas sem converter moeda ou deslocar data pura', () => {
  vi.stubEnv('TZ', 'America/Sao_Paulo')
  expect(formatData('2026-12-02')).toBe('02/12/2026')
  expect(formatData('2026-12-02', 'en')).toBe('12/02/2026')
  const instante = '2026-12-02T15:30:00Z'
  expect(formatDataHora(instante, 'en')).toBe(new Date(instante).toLocaleString('en', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }))
  expect(formatBRL(1234.5, 'en')).toBe((1234.5).toLocaleString('en', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  expect(formatBRL(1234.5, 'en')).toContain('R$')
  expect(formatTokens(1250, 'en')).toBe('1.3k')
  expect(formatTokens(1250)).toBe('1,3k')
  expect(formatBytes(1536, 'en')).toBe('1.5 KB')
  expect(formatBytes(1536)).toBe('1,5 KB')
})

it('rótulos e tempo relativo traduzem estados conhecidos e preservam valores desconhecidos', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-09T15:00:00Z'))
  expect(tempoRelativo('2026-09-09T14:59:50Z', 'en')).toBe('just now')
  expect(tempoRelativo('2026-09-09T14:55:00Z', 'en')).toBe('5 min ago')
  expect(tempoRelativo('2026-09-08T15:00:00Z', 'en')).toBe('yesterday')
  expect(tempoRelativo('2026-09-08T15:00:00Z')).toBe('ontem')
  expect(statusEntregaLabel('aprovada', 'en')).toBe('Approved')
  expect(statusEntregaLabel('aprovada')).toBe('Aprovada')
  expect(statusJobLabel('running', 'en')).toBe('Running')
  expect(tipoEntregaLabel('planilha', 'en')).toBe('Spreadsheets')
  expect(statusEntregaLabel('estado-do-cliente', 'en')).toBe('estado-do-cliente')
})
