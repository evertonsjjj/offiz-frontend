/** Published Windows distribution and explicitly configured Mac archives. */
const REPOSITORIO_RELEASES = 'https://github.com/evertonsjjj/offiz-app/releases'
const baseConfigurada = import.meta.env.VITE_APP_DOWNLOAD_BASE as string | undefined

export const appDownloadWindowsBase = (
  (import.meta.env.VITE_APP_DOWNLOAD_BASE_WINDOWS as string | undefined)
  || baseConfigurada
  || `${REPOSITORIO_RELEASES}/download/v0.2.15`
).replace(/\/+$/, '')

// No default release URL: don't offer files that have not been hosted yet.
export const appDownloadMacBase = ((import.meta.env.VITE_APP_DOWNLOAD_BASE_MAC as string | undefined) || '').replace(/\/+$/, '')

// A native app is a separate channel: preparation archives never imply a .app release.
export const appDownloadMacNativeBase = ((import.meta.env.VITE_APP_DOWNLOAD_BASE_MAC_NATIVE as string | undefined) || '').trim().replace(/\/+$/, '')
