import { appDownloadWindowsBase } from '../lib/downloadsApp'
import { useIdioma } from '../lib/i18n'

export const VERSAO_MINIMA_TAREFAS = '0.2.14'

/** A conversa local pode continuar conectada; novas tarefas exigem o motor
 * que envia a credencial privada de cada tentativa. Não troca o modo de IA. */
export function motorSuportaTentativas(versao: string): boolean {
  const partes = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/.exec(versao)
  if (!partes) return false
  const [maior, menor, revisao] = partes.slice(1, 4).map(Number)
  if (![maior, menor, revisao].every(Number.isSafeInteger)) return false
  return maior > 0 || menor > 2 || (menor === 2 && revisao >= 14)
}

export function AtualizacaoMotor({ versao }: { versao?: string }) {
  const { t } = useIdioma()
  if (versao === undefined || motorSuportaTentativas(versao)) return null
  return <div className="alerta alerta-aviso" role="status">
    <strong>{t('Atualize o aplicativo para iniciar novas tarefas.', 'Update the app to start new tasks.')}</strong>
    <p>{t(`Este computador usa o Offiz ${versao || 'sem versão identificada'}. As novas tarefas precisam da versão ${VERSAO_MINIMA_TAREFAS} ou superior. Seus arquivos e sua conta continuam disponíveis.`, `This computer uses Offiz ${versao || 'with an unidentified version'}. New tasks require version ${VERSAO_MINIMA_TAREFAS} or later. Your files and account remain available.`)}</p>
    <p>{t('Se há um trabalho em andamento, aguarde o encerramento antes de instalar a atualização.', 'If work is in progress, wait until it ends before installing the update.')}</p>
    <a className="botao botao-fantasma" href={`${appDownloadWindowsBase}/Offiz-Setup.exe`}>{t('Baixar atualização para Windows', 'Download Windows update')}</a>
  </div>
}
