import { useTextoInicio } from '../lib/i18nInicio'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { destinoLogin } from '../lib/destinoLogin'
import { vincularPedidoLandingNoLogin } from '../lib/pedidoLanding'
import { useAuth } from '../context/AuthContext'
import { FachadaAuth } from '../components/FachadaAuth'
import { SeletorIdioma } from '../components/SeletorIdioma'
import { ToggleTema } from '../components/ToggleTema'
import { LogoMark } from '../components/LogoMark'
import { mailtoLink, temContato, temEmail, temWhatsapp, whatsappLink } from '../lib/contato'

export default function LoginPage() {
  const { texto } = useTextoInicio()
  const { usuario, carregando, login } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const solicitado = (location.state as { de?: unknown } | null)?.de
  if (!carregando && usuario && !enviando) return <Navigate to={destinoLogin(solicitado, usuario.is_admin)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!email.trim() || !senha) {
      setErro(texto("Informe e-mail e senha para entrar."))
      return
    }
    setEnviando(true)
    try {
      const me = await login(email.trim().toLowerCase(), senha)
      vincularPedidoLandingNoLogin(solicitado, me.id)
      // O início resolve a empresa, mesmo sem andares. Só um link explícito
      // deve levar diretamente ao acervo, a um trabalho ou a uma área.
      navigate(destinoLogin(solicitado, me.is_admin), { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setErro(texto("E-mail ou senha incorretos."))
      } else if (err instanceof ApiError) {
        setErro(err.detail)
      } else {
        setErro(texto("Algo deu errado. Tente novamente."))
      }
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="auth-tela">
      <Link to="/" className="auth-brand-flutuante" aria-label={texto("Offiz — página inicial")}>
        <LogoMark size={24} />
        <span>Offiz</span>
      </Link>
      <ToggleTema className="toggle-tema-flutuante" />
      <FachadaAuth />
      <div className="auth-painel">
        <div className="auth-card">
          <SeletorIdioma compacto />
          <h1 className="auth-titulo">{texto("Entrar no Offiz")}</h1>
          <p className="auth-subtitulo">{texto("Seus escritórios de IA estão de portas abertas.")}</p>
          <form onSubmit={onSubmit} noValidate>
            <label className="campo">
              <span>{texto("E-mail")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={texto("voce@empresa.com.br")}
                autoComplete="email"
                autoFocus
              />
            </label>
            <label className="campo">
              <span>{texto("Senha")}</span>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder={texto("Sua senha")}
                autoComplete="current-password"
              />
            </label>
            {erro && (
              <p className="alerta alerta-erro" role="alert">
                {erro}
              </p>
            )}
            <button type="submit" className="botao botao-primario botao-largo" disabled={enviando}>
              {enviando ? texto("Entrando…") : texto("Entrar")}
            </button>
          </form>
          <p className="auth-troca">
            {texto("Acesso sob demanda, montado para cada escritório.")}{/* Canais de contato só quando configurados por env (lib/contato.ts)
                — sem eles, nada de link quebrado na tela de login. */}
            {temContato ? (
              <>
                {' '}{texto("Sem convite ainda?")}{' '}
                {temWhatsapp && (
                  <a
                    href={whatsappLink()}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={texto("Falar com o time do Offiz pelo WhatsApp")}
                  >
                    WhatsApp
                  </a>
                )}
                {temWhatsapp && temEmail && texto(" ou ")}
                {temEmail && (
                  <a href={mailtoLink()} aria-label={texto("Enviar e-mail para o time do Offiz")}>e-mail</a>
                )}
                .
              </>
            ) : (
              <> {texto("Sem convite ainda? Fale com o administrador da sua organização.")}</>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
