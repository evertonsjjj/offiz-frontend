import { appDownloadMacBase, appDownloadMacNativeBase } from '../lib/downloadsApp'
import { useIdioma } from '../lib/i18n'

export function DownloadsMac() {
  const { t } = useIdioma()
  if (appDownloadMacNativeBase) return <div className="downloads-mac">
    <p>{t('Mac · aplicativo em ZIP. Extraia o arquivo e siga o guia da sua versão para a primeira abertura.', 'Mac · app in a ZIP archive. Extract the file and follow your version’s guide for the first launch.')}</p>
    <div className="linha-form" style={{ flexWrap: 'wrap' }}>
      <a className="botao botao-fantasma botao-pequeno" href={`${appDownloadMacNativeBase}/Offiz-mac-arm64.zip`} download>{t('Mac Apple Silicon (ZIP)', 'Mac Apple Silicon (ZIP)')}</a>
      <a href={`${appDownloadMacNativeBase}/LEIA-ME-MAC-APPLE-SILICON.txt`} download>{t('Guia Apple Silicon (TXT)', 'Apple Silicon guide (TXT)')}</a>
      <a className="botao botao-fantasma botao-pequeno" href={`${appDownloadMacNativeBase}/Offiz-mac-x64.zip`} download>{t('Mac Intel (ZIP)', 'Mac Intel (ZIP)')}</a>
      <a href={`${appDownloadMacNativeBase}/LEIA-ME-MAC-INTEL.txt`} download>{t('Guia Intel (TXT)', 'Intel guide (TXT)')}</a>
    </div>
    <p className="texto-suave">{t('Para identificar o seu Mac, abra o menu Apple → Sobre Este Mac. “Chip” indica Apple Silicon; “Processador Intel” indica Intel.', 'To identify your Mac, open the Apple menu → About This Mac. “Chip” means Apple Silicon; “Intel processor” means Intel.')}</p>
  </div>
  if (!appDownloadMacBase) return null
  return <div className="downloads-mac">
    <p>{t('Mac · pacote de preparação. Inclui código e Node; baixa dependências no primeiro início. Ainda requer teste no Mac.', 'Mac · setup package. Includes source and Node; downloads dependencies on first launch. Mac testing is still required.')}</p>
    <div className="linha-form" style={{ flexWrap: 'wrap' }}>
      <a className="botao botao-fantasma botao-pequeno" href={`${appDownloadMacBase}/Offiz-Mac-arm64-preparacao.zip`} download>{t('Preparação · Mac Apple Silicon (ZIP)', 'Setup · Mac Apple Silicon (ZIP)')}</a>
      <a className="botao botao-fantasma botao-pequeno" href={`${appDownloadMacBase}/Offiz-Mac-x64-preparacao.zip`} download>{t('Preparação · Mac Intel (ZIP)', 'Setup · Mac Intel (ZIP)')}</a>
      <a href={`${appDownloadMacBase}/LEIA-ME-MAC.txt`} download>{t('Guia completo para Mac (TXT)', 'Full Mac guide (TXT)')}</a>
    </div>
  </div>
}
