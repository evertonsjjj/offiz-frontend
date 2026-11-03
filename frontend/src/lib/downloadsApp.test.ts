import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE', '')
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE_WINDOWS', '')
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE_MAC', '')
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE_MAC_NATIVE', '')
})
afterEach(() => vi.unstubAllEnvs())

it('aponta para a versão Windows publicada', async () => {
  const links = await import('./downloadsApp')
  expect(links.appDownloadWindowsBase).toBe('https://github.com/evertonsjjj/offiz-app/releases/download/v0.2.15')
})

it('preserva o override geral de downloads', async () => {
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE', 'https://downloads.example/cliente/')
  const links = await import('./downloadsApp')
  expect(links.appDownloadWindowsBase).toBe('https://downloads.example/cliente')
})

it('override Windows prevalece sobre o geral', async () => {
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE', 'https://downloads.example/estavel/')
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE_WINDOWS', 'https://downloads.example/windows///')
  const links = await import('./downloadsApp')
  expect(links.appDownloadWindowsBase).toBe('https://downloads.example/windows')
})

it('não inventa downloads Mac nem reutiliza a base geral Windows', async () => {
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE', 'https://downloads.example/windows')
  const links = await import('./downloadsApp')
  expect(links.appDownloadMacBase).toBe('')
  expect(links.appDownloadMacNativeBase).toBe('')
})

it('mantém canais Mac de preparação e aplicativo separados', async () => {
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE_MAC', '/downloads/mac/')
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE_MAC_NATIVE', ' https://downloads.example/mac-app/// ')
  const links = await import('./downloadsApp')
  expect(links.appDownloadMacBase).toBe('/downloads/mac')
  expect(links.appDownloadMacNativeBase).toBe('https://downloads.example/mac-app')
  expect(links.appDownloadWindowsBase).toBe('https://github.com/evertonsjjj/offiz-app/releases/download/v0.2.15')
})

it('configuração nativa em branco não substitui preparação', async () => {
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE_MAC', '/downloads/mac')
  vi.stubEnv('VITE_APP_DOWNLOAD_BASE_MAC_NATIVE', '   ')
  const links = await import('./downloadsApp')
  expect(links.appDownloadMacNativeBase).toBe('')
  expect(links.appDownloadMacBase).toBe('/downloads/mac')
})
