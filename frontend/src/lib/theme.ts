import { useCallback, useEffect, useState } from 'react'

export type Tema = 'light' | 'dark'

// O padrão do produto é CLARO (decisão do dono, 12/08/2026 — visão KORÁ:
// design limpo, chat em tela cheia, base clara). Já foi escuro (04/08) e
// claro antes disso; a regra de convivência é sempre a mesma, invertida a
// cada troca de padrão: quem ALTERNOU para o escuro tem 'dark' gravado e
// continua no escuro. O padrão muda; a escolha de quem escolheu é respeitada.
// O bootstrap do index.html aplica a MESMA regra antes do React montar (sem
// flash) — os dois têm que dizer a mesma coisa.
const CHAVE = 'offiz-theme'

/** Lê o tema salvo; o padrão é CLARO (só 'dark' explícito vira escuro). */
function temaSalvo(): Tema {
  try {
    return localStorage.getItem(CHAVE) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Aplica o tema no <html> (data-theme). Não persiste — só a escolha persiste. */
export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset.theme = tema
  void window.offizMotor?.definirTema?.(tema).catch(() => undefined)
}

/** Hook: tema atual + alternador. Persiste só ao alternar; sincroniza entre abas. */
export function useTema(): [Tema, () => void] {
  const [tema, setTema] = useState<Tema>(temaSalvo)

  useEffect(() => {
    aplicarTema(tema)
  }, [tema])

  useEffect(() => {
    function aoMudar(e: StorageEvent) {
      if (e.key === CHAVE) setTema(e.newValue === 'dark' ? 'dark' : 'light')
    }
    window.addEventListener('storage', aoMudar)
    return () => window.removeEventListener('storage', aoMudar)
  }, [])

  const alternar = useCallback(() => {
    setTema((t) => {
      const novo: Tema = t === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(CHAVE, novo)
      } catch {
        /* localStorage indisponível — vale só nesta sessão */
      }
      return novo
    })
  }, [])

  return [tema, alternar]
}
