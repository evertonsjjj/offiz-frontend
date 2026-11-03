import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api, AUTH_CREDENTIALS_KEY, clearTokens, getAccessToken, getSessionIdentity, setTokens } from '../lib/api'
import { wsClient } from '../lib/ws'
import { useToasts } from '../components/Toasts'
import { traduzirForaDoProvider } from '../lib/idiomaBase'
import type { IdiomaInterface, Usuario } from '../lib/types'

interface LoginResponse {
  access_token: string
  refresh_token: string
  usuario: Usuario
}

interface AuthContextValue {
  usuario: Usuario | null
  carregando: boolean
  login: (email: string, senha: string) => Promise<Usuario>
  sair: () => Promise<void>
  /** Refaz /auth/me e atualiza o cache — use depois de mudar uma preferência
   *  que decide a interface (modo avançado), senão a shell só troca no F5. */
  recarregarUsuario: () => Promise<void>
  atualizarIdiomaInterface: (usuarioId: number, idioma: IdiomaInterface) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/* Cache do usuário logado: permite BOOT OTIMISTA — com token + usuário
 * cacheado a UI renderiza na hora, sem tela de loading esperando /auth/me
 * (importante no app desktop, que abre e fecha por dias). A validação de
 * verdade roda em background e só derruba para o login quando o refresh
 * falha de vez. */
const USUARIO_KEY = 'offiz_usuario'

function usuarioCacheado(): Usuario | null {
  try {
    const raw = localStorage.getItem(USUARIO_KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as Usuario & { __offiz_sessao?: string }
    return u && typeof u.id === 'number' && typeof u.email === 'string' && u.__offiz_sessao === getSessionIdentity() ? u : null
  } catch {
    return null
  }
}

function guardarUsuario(u: Usuario | null, identidade = getSessionIdentity()): void {
  try {
    if (u) {
      if (!identidade || getSessionIdentity() !== identidade) return
      localStorage.setItem(USUARIO_KEY, JSON.stringify({ ...u, __offiz_sessao: identidade }))
    } else localStorage.removeItem(USUARIO_KEY)
  } catch {
    /* storage cheio/indisponível: segue sem cache (boot volta a bloquear) */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { falha } = useToasts()
  // Boot otimista: token + cache → sessão vale já (carregando nasce false).
  // Token sem cache (sessões antigas) → comportamento clássico: bloqueia até
  // o /auth/me responder. Sem token → deslogado direto.
  const [usuario, setUsuario] = useState<Usuario | null>(() =>
    getAccessToken() ? usuarioCacheado() : null,
  )
  const [carregando, setCarregando] = useState(() => !!getAccessToken() && !usuarioCacheado())
  const usuarioRef = useRef<Usuario | null>(usuario)
  usuarioRef.current = usuario
  const sessaoRef = useRef(0)
  const identidadeRef = useRef(getSessionIdentity())
  const encerrandoRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    let ativo = true
    async function validar() {
      const sessao = sessaoRef.current
      const identidade = getSessionIdentity()
      const atual = () => ativo && sessaoRef.current === sessao && getSessionIdentity() === identidade
      if (!getAccessToken()) return
      // Sessão otimista já conecta o WS; o /auth/me abaixo só confirma.
      if (usuarioRef.current) wsClient.connect()
      try {
        const me = await api.get<Usuario>('/auth/me')
        if (!atual()) return
        setUsuario(me)
        guardarUsuario(me, identidade)
        wsClient.connect()
      } catch {
        if (!atual()) return
        // 401 definitivo (refresh também falhou): o api client já limpou os
        // tokens e disparou offiz:sessao-expirada — o listener abaixo derruba
        // a sessão com o toast. Outros erros (rede fora, backend caído) NÃO
        // deslogam a sessão otimista; sem cache não há o que renderizar e o
        // guard manda para o login, como antes.
        if (!usuarioRef.current) setUsuario(null)
      } finally {
        if (atual()) setCarregando(false)
      }
    }
    validar()
    return () => {
      ativo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onExpirada = () => {
      sessaoRef.current += 1
      // Toast só quando HAVIA sessão — evita alarde em requests soltos de
      // telas públicas. O guard das rotas redireciona para /login sozinho.
      if (usuarioRef.current) falha(traduzirForaDoProvider('Sua sessão expirou — entre novamente.', 'Your session expired. Please sign in again.'))
      usuarioRef.current = null
      guardarUsuario(null)
      setUsuario(null)
      setCarregando(false)
      wsClient.close()
    }
    window.addEventListener('offiz:sessao-expirada', onExpirada)
    return () => window.removeEventListener('offiz:sessao-expirada', onExpirada)
  }, [falha])

  useEffect(() => {
    let ativo = true
    const sincronizar = () => {
      const identidade = getSessionIdentity()
      if (identidade === identidadeRef.current) return
      identidadeRef.current = identidade
      const sessao = ++sessaoRef.current
      // Outra aba compartilha os tokens, mas não o estado React. Esconder a
      // conta anterior antes de validar evita usar a UI antiga com outra conta.
      usuarioRef.current = null
      setUsuario(null)
      setCarregando(!!identidade)
      wsClient.close()
      if (!identidade) return
      void api.get<Usuario>('/auth/me').then(me => {
        if (!ativo || sessaoRef.current !== sessao || getSessionIdentity() !== identidade) return
        usuarioRef.current = me
        guardarUsuario(me, identidade)
        setUsuario(me)
        wsClient.connect()
      }).catch(() => { /* continua sem dados da conta anterior */ }).finally(() => {
        if (ativo && sessaoRef.current === sessao) setCarregando(false)
      })
    }
    const aoStorage = (e: StorageEvent) => {
      if (e.storageArea === localStorage && (e.key === null || e.key === AUTH_CREDENTIALS_KEY || e.key === 'offiz_auth_session')) sincronizar()
    }
    window.addEventListener('storage', aoStorage)
    window.addEventListener('focus', sincronizar)
    return () => { ativo = false; window.removeEventListener('storage', aoStorage); window.removeEventListener('focus', sincronizar) }
  }, [])

  /** Devolve o usuário logado — quem chama precisa dele para decidir o destino
   *  (admin vai para a Administração), e o estado do contexto ainda não
   *  atualizou dentro do mesmo callback. */
  const login = useCallback(async (email: string, senha: string): Promise<Usuario> => {
    await encerrandoRef.current
    const sessao = ++sessaoRef.current
    const res = await api.postPublic<LoginResponse>('/auth/login', { email, senha })
    if (sessaoRef.current !== sessao) throw new Error(traduzirForaDoProvider('Login cancelado.', 'Sign-in cancelled.'))
    setTokens(res.access_token, res.refresh_token)
    const identidade = getSessionIdentity()
    identidadeRef.current = identidade
    const me = res.usuario ?? (await api.get<Usuario>('/auth/me'))
    if (sessaoRef.current !== sessao || getSessionIdentity() !== identidade) throw new Error(traduzirForaDoProvider('Login cancelado.', 'Sign-in cancelled.'))
    usuarioRef.current = me
    setUsuario(me)
    guardarUsuario(me, identidade)
    wsClient.connect()
    return me
  }, [])

  const recarregarUsuario = useCallback(async () => {
    const sessao = sessaoRef.current
    const identidade = getSessionIdentity()
    const id = usuarioRef.current?.id
    const me = await api.get<Usuario>('/auth/me')
    if (sessaoRef.current !== sessao || getSessionIdentity() !== identidade || usuarioRef.current?.id !== id || me.id !== id) return
    usuarioRef.current = me
    setUsuario(me)
    guardarUsuario(me, identidade)
  }, [])

  const atualizarIdiomaInterface = useCallback((usuarioId: number, idioma: IdiomaInterface) => {
    if (usuarioRef.current?.id !== usuarioId || identidadeRef.current !== getSessionIdentity()) return
    sessaoRef.current += 1
    const atualizado = { ...usuarioRef.current, idioma_interface: idioma }
    usuarioRef.current = atualizado
    setUsuario(atualizado)
    guardarUsuario(atualizado)
  }, [])

  const sair = useCallback((): Promise<void> => {
    if (encerrandoRef.current) return encerrandoRef.current
    const identidade = getSessionIdentity()
    sessaoRef.current += 1
    const closing = (async () => {
      try { await window.offizMotor?.desparear() } catch { /* a saída continua; o motor reconfere a credencial */ }
      finally {
        // Outra aba pode ter entrado em uma conta enquanto o motor encerrava.
        // O refresh mantém esta identidade: renovar os tokens não cancela a saída.
        if (getSessionIdentity() === identidade) {
          usuarioRef.current = null
          clearTokens()
          identidadeRef.current = null
          guardarUsuario(null)
          setUsuario(null)
          wsClient.close()
        }
        encerrandoRef.current = null
      }
    })()
    encerrandoRef.current = closing
    return closing
  }, [])

  const value = useMemo(
    () => ({ usuario, carregando, login, sair, recarregarUsuario, atualizarIdiomaInterface }),
    [usuario, carregando, login, sair, recarregarUsuario, atualizarIdiomaInterface],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
