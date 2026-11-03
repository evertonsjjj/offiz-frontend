import { useIdioma } from '../lib/i18n'
import type { PreferenciaIdioma } from '../lib/i18n'
import './seletor-idioma.css'

export function SeletorIdioma({ compacto = false }: { compacto?: boolean }) {
  const { preferencia, definirPreferencia, salvando, erro, t } = useIdioma()
  return <div className={compacto ? 'seletor-idioma seletor-idioma--compacto' : 'seletor-idioma'}>
    <label className="campo" style={{ marginBottom: 0 }}>
      <span>{t('Idioma da interface', 'Interface language')}</span>
      <select aria-label={t('Idioma da interface', 'Interface language')} value={preferencia} disabled={salvando}
        onChange={(ev) => void definirPreferencia(ev.target.value as PreferenciaIdioma)}>
        <option value="auto">{compacto ? t('Automático', 'Automatic') : t('Automático (navegador ou sistema)', 'Automatic (browser or system)')}</option>
        <option value="pt-BR">{compacto ? 'Português' : 'Português (Brasil)'}</option>
        <option value="en">English</option>
      </select>
    </label>
    {salvando && <p className="texto-suave" role="status">{t('Salvando idioma…', 'Saving language…')}</p>}
    {erro && <p className="alerta alerta-erro" role="alert">{erro}</p>}
  </div>
}
