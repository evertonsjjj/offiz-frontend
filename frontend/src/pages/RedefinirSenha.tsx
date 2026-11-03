import { useTextoAuth } from '../lib/i18nAuth'
import { SeletorIdioma } from '../components/SeletorIdioma'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useToasts } from '../components/Toasts'
import { FachadaAuth } from '../components/FachadaAuth'
import { ToggleTema } from '../components/ToggleTema'
import { LogoMark } from '../components/LogoMark'

/** Espelha as regras do backend (auth.py → _validar_senha). */
function validarSenha(senha: string): string | null {
  if (senha.length < 8) return 'A senha deve ter pelo menos 8 caracteres.'
  if (!/[A-Z]/.test(senha)) return 'A senha deve conter pelo menos 1 letra maiúscula.'
  if (!/\d/.test(senha)) return 'A senha deve conter pelo menos 1 número.'
  return null
}

interface ResetInfo {
  email: string
  nome: string
  expira_em: string
}

/**
 * Página PÚBLICA de redefinição (/redefinir-senha/:token) — fora do guard de
 * auth, porque quem esqueceu a senha não consegue logar para provar quem é.
 * Quem prova é o token: curto, de USO ÚNICO e conferido pelo hash no servidor.
 *
 * Depois de trocar, a pessoa vai para o login e digita a senha nova — não
 * entramos automaticamente. É meio segundo a mais e vale por dois motivos: ela
 * confirma para si mesma que a senha funciona, e um link que caiu na mão
 * errada não vira sessão aberta só por ter sido clicado.
 */
export default function RedefinirSenhaPage() {
  const { token: tokenParam } = useParams<{ token: string }>()
  const token = tokenParam ?? window.location.hash.slice(1)
  return <RedefinirSenhaConteudo key={token} token={token} />
}

function RedefinirSenhaConteudo({ token }: { token: string }) {
  const texto = useTextoAuth()
  const { sucesso } = useToasts()
  const navigate = useNavigate()

  const [info, setInfo] = useState<ResetInfo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)

  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const vivoRef = useRef(true)
  const aplicandoRef = useRef(false)
  const navegarRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let vivo = true
    vivoRef.current = true
    api
      .post<ResetInfo>('/auth/reset-senha/consultar', { token })
      .then((d) => vivo && setInfo(d))
      .catch((e) =>
        vivo &&
        setErroCarga(
          e instanceof ApiError
            ? e.detail
            : 'Não foi possível abrir este link. Peça um novo a quem cuida do seu escritório.',
        ),
      )
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
      vivoRef.current = false
      if (navegarRef.current !== null) clearTimeout(navegarRef.current)
    }
  }, [token])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!vivoRef.current || carregando || !info || erroCarga || pronto || aplicandoRef.current) return
    setErro(null)
    const problema = validarSenha(senha)
    if (problema) {
      setErro(problema)
      return
    }
    if (senha !== confirmar) {
      setErro('As duas senhas não são iguais.')
      return
    }
    aplicandoRef.current = true
    setEnviando(true)
    try {
      await api.post('/auth/reset-senha/aplicar', { token, senha })
      if (!vivoRef.current) return
      setPronto(true)
      sucesso(texto('Senha alterada. Entre com a nova.'))
      navegarRef.current = setTimeout(() => { if (vivoRef.current) navigate('/login') }, 2500)
    } catch (err) {
      if (!vivoRef.current) return
      setErro(
        err instanceof ApiError
          ? err.detail
          : 'Não foi possível alterar a senha. Tente de novo.',
      )
    } finally {
      aplicandoRef.current = false
      if (vivoRef.current) setEnviando(false)
    }
  }

  return (
    <div className="auth-tela">
      <Link to="/" className="auth-brand-flutuante" aria-label={texto("Offiz — página inicial")}>
        <LogoMark size={24} />
        <span>{texto("Offiz")}</span>
      </Link>
      <ToggleTema className="toggle-tema-flutuante" />
      <FachadaAuth />
      <div className="auth-painel">
        <div className="auth-card">
          <SeletorIdioma compacto />
          {carregando && (
            <div aria-hidden="true">
              <div className="esqueleto esqueleto-linha" />
              <div className="esqueleto esqueleto-linha" />
            </div>
          )}

          {!carregando && erroCarga && (
            <>
              <h1 className="auth-titulo">{texto("Link indisponível")}</h1>
              <p className="alerta alerta-erro" role="alert">
                {texto(erroCarga)}
              </p>
              <p className="auth-troca"> {texto("Já lembrou a senha?")} <Link to="/login">{texto("Entrar no Offiz")}</Link>
              </p>
            </>
          )}

          {!carregando && info && pronto && (
            <>
              <h1 className="auth-titulo">{texto("Senha alterada!")}</h1>
              <p className="auth-subtitulo"> {texto("Pronto,")} {info.nome.split(' ')[0]}{texto(". Entre com a senha nova — este link não funciona mais.")} </p>
              <Link to="/login" className="botao botao-primario botao-largo"> {texto("Entrar")} </Link>
            </>
          )}

          {!carregando && info && !pronto && (
            <>
              <h1 className="auth-titulo">{texto("Crie uma senha nova")}</h1>
              <p className="auth-subtitulo"> {texto("Você está criando a senha da conta")} <strong>{info.email}</strong>{texto(". Ninguém mais vê o que você digitar aqui.")} </p>
              <form onSubmit={enviar}>
                <label className="campo">
                  <span>{texto("Senha nova")}</span>
                  <input
                    type="password"
                    value={senha}
                    disabled={enviando}
                    onChange={(ev) => setSenha(ev.target.value)}
                    autoComplete="new-password"
                    autoFocus
                    placeholder={texto("Mín. 8 caracteres")}
                  />
                  <small className="texto-suave"> {texto("Pelo menos 8 caracteres, com 1 letra maiúscula e 1 número.")} </small>
                </label>
                <label className="campo">
                  <span>{texto("Repita a senha")}</span>
                  <input
                    type="password"
                    value={confirmar}
                    disabled={enviando}
                    onChange={(ev) => setConfirmar(ev.target.value)}
                    autoComplete="new-password"
                    placeholder={texto("Digite de novo")}
                  />
                </label>
                {erro && (
                  <p className="alerta alerta-erro" role="alert">
                    {texto(erro)}
                  </p>
                )}
                <button
                  type="submit"
                  className="botao botao-primario botao-largo"
                  disabled={enviando}
                >
                  {texto(enviando ? 'Salvando…' : 'Salvar senha e entrar')}
                </button>
              </form>
              <p className="texto-suave"> {texto("Este link serve")} <strong>{texto("uma vez só")}</strong>{texto(". Se você fechar sem salvar, peça outro a quem cuida do seu escritório.")} </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
