import { useTema } from '../lib/theme'
import { useIdioma } from '../lib/i18n'

/** Alterna entre tema claro (padrão) e escuro. Persiste em localStorage. */
export function ToggleTema({ className = '' }: { className?: string }) {
  const { t } = useIdioma()
  const [tema, alternar] = useTema()
  const escuro = tema === 'dark'

  return (
    <button
      type="button"
      className={`toggle-tema ${className}`.trim()}
      onClick={alternar}
      aria-label={escuro ? t('Mudar para tema claro', 'Switch to light theme') : t('Mudar para tema escuro', 'Switch to dark theme')}
      title={escuro ? t('Tema claro', 'Light theme') : t('Tema escuro', 'Dark theme')}
    >
      {escuro ? (
        // Sol — ir para o claro
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.7 5.3l-1.7 1.7M7 17l-1.7 1.7M18.7 18.7 17 17M7 7 5.3 5.3" />
          </g>
        </svg>
      ) : (
        // Lua — ir para o escuro
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M20 14.2A8 8 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2Z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  )
}
