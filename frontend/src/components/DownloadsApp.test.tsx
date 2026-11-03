import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DownloadsMac } from './DownloadsMac'
import { DownloadsWindowsZIP } from './DownloadsWindowsZIP'

const contexto = vi.hoisted(() => ({ idioma: 'pt-BR' }))
const bases = vi.hoisted(() => ({ appDownloadWindowsBase: 'https://downloads.example/windows', appDownloadMacBase: '', appDownloadMacNativeBase: '' }))
vi.mock('../lib/downloadsApp', () => bases)
vi.mock('../lib/i18n', () => ({ useIdioma: () => ({ t: (pt: string, en: string) => contexto.idioma === 'en' ? en : pt }) }))

beforeEach(() => {
  contexto.idioma = 'pt-BR'
  bases.appDownloadMacBase = ''
  bases.appDownloadMacNativeBase = ''
})
afterEach(cleanup)

it('omite Mac sem arquivos configurados, mantendo Windows ZIP disponível', () => {
  render(<><DownloadsWindowsZIP /><DownloadsMac /></>)
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(screen.getByRole('link', { name: 'Windows (ZIP)' })).toHaveAttribute('href', 'https://downloads.example/windows/Offiz-win.zip')
})

it('identifica preparação e oferece os dois chips e seu guia sem sugerir aplicativo pronto', () => {
  bases.appDownloadMacBase = '/downloads/mac'
  render(<DownloadsMac />)
  expect(screen.getByText(/Inclui código e Node/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Preparação · Mac Apple Silicon (ZIP)' })).toHaveAttribute('href', '/downloads/mac/Offiz-Mac-arm64-preparacao.zip')
  expect(screen.getByRole('link', { name: 'Preparação · Mac Intel (ZIP)' })).toHaveAttribute('href', '/downloads/mac/Offiz-Mac-x64-preparacao.zip')
  expect(screen.getByRole('link', { name: 'Guia completo para Mac (TXT)' })).toHaveAttribute('href', '/downloads/mac/LEIA-ME-MAC.txt')
  expect(screen.queryByText(/aplicativo em ZIP/)).not.toBeInTheDocument()
})

it('prefere aplicativos nativos configurados e associa cada chip ao guia correto', () => {
  bases.appDownloadMacBase = '/downloads/mac'
  bases.appDownloadMacNativeBase = 'https://downloads.example/mac-app'
  render(<DownloadsMac />)
  expect(screen.getByText(/Mac · aplicativo em ZIP/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Mac Apple Silicon (ZIP)' })).toHaveAttribute('href', 'https://downloads.example/mac-app/Offiz-mac-arm64.zip')
  expect(screen.getByRole('link', { name: 'Guia Apple Silicon (TXT)' })).toHaveAttribute('href', 'https://downloads.example/mac-app/LEIA-ME-MAC-APPLE-SILICON.txt')
  expect(screen.getByRole('link', { name: 'Mac Intel (ZIP)' })).toHaveAttribute('href', 'https://downloads.example/mac-app/Offiz-mac-x64.zip')
  expect(screen.getByRole('link', { name: 'Guia Intel (TXT)' })).toHaveAttribute('href', 'https://downloads.example/mac-app/LEIA-ME-MAC-INTEL.txt')
  expect(screen.queryByText(/pacote de preparação/)).not.toBeInTheDocument()
  expect(screen.getAllByRole('link')).toHaveLength(4)
})

it('traduz as instruções de aplicativos Mac e Windows para inglês', () => {
  contexto.idioma = 'en'
  bases.appDownloadMacNativeBase = '/downloads/native'
  render(<><DownloadsWindowsZIP /><DownloadsMac /></>)
  expect(screen.getByText(/Mac · app in a ZIP archive/)).toBeInTheDocument()
  expect(screen.getByText(/To identify your Mac/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Intel guide (TXT)' })).toHaveAttribute('download')
  expect(screen.getByRole('link', { name: 'Apple Silicon guide (TXT)' })).toHaveAttribute('download')
  expect(screen.getByRole('link', { name: 'Windows (ZIP)' })).toHaveAttribute('title', expect.stringContaining('Unblock before extracting'))
})

it('traduz a preparação Mac sem confundi-la com o aplicativo nativo', () => {
  contexto.idioma = 'en'
  bases.appDownloadMacBase = '/downloads/mac'
  render(<DownloadsMac />)
  expect(screen.getByText(/Mac · setup package/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Setup · Mac Apple Silicon (ZIP)' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Setup · Mac Intel (ZIP)' })).toBeInTheDocument()
})
