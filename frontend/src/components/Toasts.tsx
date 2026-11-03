import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

import { Icone } from './Icone'
import { traduzirForaDoProvider } from '../lib/idiomaBase'

export type TipoToast = 'ok' | 'erro' | 'info'

interface Toast {
  id: number
  tipo: TipoToast
  texto: string
  saindo: boolean
}

interface ToastsContextValue {
  notificar: (tipo: TipoToast, texto: string) => void
  sucesso: (texto: string) => void
  falha: (texto: string) => void
}

const ToastsContext = createContext<ToastsContextValue | null>(null)

const DURACAO_MS = 5000
const SAIDA_MS = 220

/** Chaves do set de traço (o `ℹ` do informativo não tem desenho no set — o
 *  <Icone> devolve como texto o que não for chave conhecida). */
const ICONE: Record<TipoToast, string> = { ok: 'check', erro: 'erro', info: 'ℹ' }

/** Toasts de sucesso/erro para ações (aprovar, salvar, testar conexão…). */
export function ToastsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const proximoId = useRef(1)

  const remover = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, saindo: true } : t)))
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, SAIDA_MS)
  }, [])

  const notificar = useCallback(
    (tipo: TipoToast, texto: string) => {
      const id = proximoId.current++
      // No máximo 4 na tela; os antigos saem primeiro.
      setToasts((prev) => [...prev.slice(-3), { id, tipo, texto, saindo: false }])
      window.setTimeout(() => remover(id), DURACAO_MS)
    },
    [remover],
  )

  const value = useMemo<ToastsContextValue>(
    () => ({
      notificar,
      sucesso: (texto: string) => notificar('ok', texto),
      falha: (texto: string) => notificar('erro', texto),
    }),
    [notificar],
  )

  return (
    <ToastsContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tipo}${t.saindo ? ' toast-saindo' : ''}`}>
            <Icone nome={ICONE[t.tipo]} tamanho={15} className="toast-icone" />
            <span className="toast-texto">{t.texto}</span>
            <button type="button" className="toast-fechar" aria-label={traduzirForaDoProvider('Fechar aviso', 'Dismiss notification')} onClick={() => remover(t.id)}>
              <Icone nome="fechar" tamanho={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastsContext.Provider>
  )
}

export function useToasts(): ToastsContextValue {
  const ctx = useContext(ToastsContext)
  if (!ctx) throw new Error('useToasts deve ser usado dentro de <ToastsProvider>')
  return ctx
}
