import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { api, ApiError } from './api'
import type { IdiomaInterface } from './types'

export type Idioma = 'pt-BR' | 'en'
export type PreferenciaIdioma = IdiomaInterface
export type Traduzir = (portugues: string, ingles: string) => string
interface IdiomaContexto {
  idioma: Idioma
  preferencia: PreferenciaIdioma
  t: Traduzir
  definirPreferencia: (valor: PreferenciaIdioma) => Promise<void>
  salvando: boolean
  erro: string | null
}

const CHAVE_VISITANTE = 'offiz:idioma:visitante'
function normalizar(valor: unknown): PreferenciaIdioma {
  return valor === 'pt-BR' || valor === 'en' ? valor : 'auto'
}
function idiomaVisitante(): PreferenciaIdioma {
  try { return normalizar(localStorage.getItem(CHAVE_VISITANTE)) } catch { return 'auto' }
}
export function resolverIdioma(preferencia: PreferenciaIdioma, linguagem = navigator.language): Idioma {
  if (preferencia !== 'auto') return preferencia
  return /^en(?:-|$)/i.test(linguagem) ? 'en' : 'pt-BR'
}
const IdiomaContext = createContext<IdiomaContexto>({
  idioma: 'pt-BR', preferencia: 'auto', t: (pt) => pt,
  definirPreferencia: async () => undefined, salvando: false, erro: null,
})

/** A conta guarda a escolha, nunca a língua detectada. O modo automático
 * acompanha o navegador/sistema em cada dispositivo sem trocar o conteúdo. */
export function IdiomaProvider({ children }: { children: ReactNode }) {
  const { usuario, atualizarIdiomaInterface } = useAuth()
  const [visitante, setVisitante] = useState(idiomaVisitante)
  const [linguagemSistema, setLinguagemSistema] = useState(() => navigator.language)
  const [operacao, setOperacao] = useState<{ usuarioId: number | null; pendente: boolean; erro: string | null } | null>(null)
  const sessaoRef = useRef<{ id: number | null; geracao: number }>({ id: usuario?.id ?? null, geracao: 0 })
  const usuarioId = usuario?.id ?? null
  if (sessaoRef.current.id !== usuarioId) sessaoRef.current = { id: usuarioId, geracao: sessaoRef.current.geracao + 1 }
  const preferencia = usuario ? normalizar(usuario.idioma_interface) : visitante
  const idioma = resolverIdioma(preferencia, linguagemSistema)
  // A previously registered listener may outlive a language change. It must
  // read the current language without forcing data loaders to run again.
  const idiomaAtualRef = useRef(idioma)
  idiomaAtualRef.current = idioma
  const t = useMemo<Traduzir>(() => (pt, en) => idiomaAtualRef.current === 'en' ? en : pt, [idioma])

  useEffect(() => () => { sessaoRef.current = { ...sessaoRef.current, geracao: sessaoRef.current.geracao + 1 } }, [])

  useEffect(() => {
    document.documentElement.lang = idioma
    void window.offizMotor?.definirIdioma?.(idioma).catch(() => undefined)
  }, [idioma])
  useEffect(() => {
    const atualizar = () => setLinguagemSistema(navigator.language)
    window.addEventListener('languagechange', atualizar)
    return () => window.removeEventListener('languagechange', atualizar)
  }, [])
  useEffect(() => {
    const sincronizar = (evento: StorageEvent) => {
      if (evento.key === CHAVE_VISITANTE) setVisitante(normalizar(evento.newValue))
    }
    window.addEventListener('storage', sincronizar)
    return () => window.removeEventListener('storage', sincronizar)
  }, [])

  const definirPreferencia = useCallback(async (valor: PreferenciaIdioma) => {
    const proxima = normalizar(valor)
    const sessao = sessaoRef.current
    if (sessao.id === null) {
      setVisitante(proxima)
      try { localStorage.setItem(CHAVE_VISITANTE, proxima) } catch { /* sem cache, vale nesta janela */ }
      return
    }
    setOperacao({ usuarioId: sessao.id, pendente: true, erro: null })
    try {
      const salva = await api.put<{ idioma_interface: PreferenciaIdioma }>('/usuarios/me/preferencias', { idioma_interface: proxima })
      if (sessaoRef.current !== sessao) return
      atualizarIdiomaInterface(sessao.id, normalizar(salva.idioma_interface))
      setOperacao(null)
    } catch (e) {
      if (sessaoRef.current !== sessao) return
      const detalhe = e instanceof ApiError ? e.detail : t('Não foi possível salvar o idioma. Tente novamente.', 'Could not save your language. Please try again.')
      setOperacao({ usuarioId: sessao.id, pendente: false, erro: detalhe })
    }
  }, [atualizarIdiomaInterface, t])
  const value = useMemo<IdiomaContexto>(() => ({
    idioma, preferencia, t, definirPreferencia,
    salvando: operacao?.usuarioId === usuarioId && operacao.pendente,
    erro: operacao?.usuarioId === usuarioId ? operacao.erro : null,
  }), [idioma, preferencia, t, definirPreferencia, operacao, usuarioId])
  return <IdiomaContext.Provider value={value}>{children}</IdiomaContext.Provider>
}

export function useIdioma(): IdiomaContexto { return useContext(IdiomaContext) }
