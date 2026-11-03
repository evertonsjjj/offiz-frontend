import { appDownloadWindowsBase } from '../lib/downloadsApp'
import { useIdioma } from '../lib/i18n'
import { Icone } from './Icone'

export function DownloadsWindowsZIP() {
  const { t } = useIdioma()
  return <a
    className="botao botao-fantasma botao-pequeno"
    href={`${appDownloadWindowsBase}/Offiz-win.zip`}
    title={t('Dica: botão direito no ZIP → Propriedades → Desbloquear, antes de extrair', 'Tip: right-click the ZIP → Properties → Unblock before extracting')}
    download
  >
    <Icone nome="baixar" tamanho={15} />
    {t('Windows (ZIP)', 'Windows (ZIP)')}
  </a>
}
