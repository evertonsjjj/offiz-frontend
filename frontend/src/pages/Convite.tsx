import { useTextoAuth } from '../lib/i18nAuth'
import { SeletorIdioma } from '../components/SeletorIdioma'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import type { ConvitePublico } from '../lib/types'
import { useAuth } from '../context/AuthContext'
import { useToasts } from '../components/Toasts'
import { FachadaAuth } from '../components/FachadaAuth'
import { ToggleTema } from '../components/ToggleTema'
import { LogoMark } from '../components/LogoMark'

const PAPEL_LABEL: Record<string, string> = {
  owner: 'Dono',
  admin: 'Administrador',
  member: 'Membro',
}

const MSG_NAO_ENCONTRADO = 'Convite não encontrado ou revogado.'
const MSG_EXPIRADO = 'Este convite expirou ou já foi usado — peça um novo a quem convidou você.'

/** Espelha as regras de senha do backend (auth.py → _validar_senha). */
function validarSenha(senha: string): string | null {
  if (senha.length < 8) return 'A senha deve ter pelo menos 8 caracteres.'
  if (!/[A-Z]/.test(senha)) return 'A senha deve conter pelo menos 1 letra maiúscula.'
  if (!/\d/.test(senha)) return 'A senha deve conter pelo menos 1 número.'
  return null
}

/**
 * Página PÚBLICA do convite (/convite/:token) — fora do guard de auth.
 * O convidado confere org/e-mail/papel e: com conta, só aceita; sem conta,
 * cria nome + senha no próprio aceite e entra direto.
 */
export default function ConvitePage() {
  const texto = useTextoAuth()
  const { token: tokenParam } = useParams<{ token: string }>()
  const token = tokenParam ?? window.location.hash.slice(1)
  const { login } = useAuth()
  const { notificar } = useToasts()
  const navigate = useNavigate()

  const [convite, setConvite] = useState<ConvitePublico | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)

  const [nome, setNome] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [aceito, setAceito] = useState(false)

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    setErroCarga(null)
    setConvite(null)
    if (!token) {
      setErroCarga(MSG_NAO_ENCONTRADO)
      setCarregando(false)
      return
    }
    api
      .post<ConvitePublico>('/convites/consultar', { token })
      .then((dados) => {
        if (ativo) setConvite(dados)
      })
      .catch((e) => {
        if (!ativo) return
        if (e instanceof ApiError && e.status === 404) setErroCarga(MSG_NAO_ENCONTRADO)
        else if (e instanceof ApiError && e.status === 410) setErroCarga(MSG_EXPIRADO)
        else if (e instanceof ApiError) setErroCarga(e.detail)
        else setErroCarga('Não foi possível carregar o convite. Tente novamente em instantes.')
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => {
      ativo = false
    }
  }, [token])

  function traduzErroAceite(e: unknown): string {
    if (e instanceof ApiError && e.status === 404) return MSG_NAO_ENCONTRADO
    if (e instanceof ApiError && e.status === 410) return MSG_EXPIRADO
    if (e instanceof ApiError) return e.detail
    return 'Algo deu errado ao aceitar o convite. Tente novamente.'
  }

  /** Conta já existe: aceitar sem mexer em nada — a senha atual segue valendo. */
  async function aceitarComContaExistente() {
    setEnviando(true)
    setErro(null)
    try {
      await api.postPublic('/convites/aceitar', { token })
      setAceito(true)
    } catch (e) {
      setErro(traduzErroAceite(e))
    } finally {
      setEnviando(false)
    }
  }

  /** Sem conta: cria nome + senha no aceite e tenta entrar automaticamente. */
  async function aceitarCriandoConta(ev: FormEvent) {
    ev.preventDefault()
    setErro(null)
    const nomeLimpo = nome.trim()
    if (!nomeLimpo) {
      setErro('Informe seu nome.')
      return
    }
    const erroSenha = validarSenha(senha)
    if (erroSenha) {
      setErro(erroSenha)
      return
    }
    if (senha !== confirmar) {
      setErro('As senhas não conferem — digite a mesma senha nos dois campos.')
      return
    }
    setEnviando(true)
    let criado = false
    try {
      const r = await api.postPublic<{ ok: boolean; criado: boolean }>(
        '/convites/aceitar',
        { token, nome: nomeLimpo, senha },
      )
      criado = !!r?.criado
    } catch (e) {
      setErro(traduzErroAceite(e))
      setEnviando(false)
      return
    }
    // Se a conta já EXISTIA (criada em outra aba entre o carregamento e o
    // submit), o backend ignora a senha digitada — não tente logar com ela.
    if (!criado) {
      notificar('info', texto('Este e-mail já tinha conta no Offiz — o convite foi aceito. Entre com a sua senha de sempre.'))
      navigate('/login', { replace: true })
      return
    }
    // Conta criada — tenta o login automático (mesmo fluxo da tela de login).
    try {
      await login(convite!.email, senha)
      navigate('/predios', { replace: true })
    } catch {
      notificar('info', texto('Sua conta foi criada! Entre com seu e-mail e a senha que você acabou de definir.'))
      navigate('/login', { replace: true })
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
              <h1 className="auth-titulo">{texto("Convite indisponível")}</h1>
              <p className="alerta alerta-erro" role="alert">
                {texto(erroCarga)}
              </p>
              <p className="auth-troca"> {texto("Já tem conta?")} <Link to="/login">{texto("Entrar no Offiz")}</Link>
              </p>
            </>
          )}

          {!carregando && convite && aceito && (
            <>
              <h1 className="auth-titulo">{texto("Convite aceito!")}</h1>
              <p className="auth-subtitulo"> {texto("Você agora faz parte da")} {convite.org_nome || texto('organização')}{texto(". Entre com sua conta para começar.")} </p>
              <Link to="/login" className="botao botao-primario botao-largo"> {texto("Entrar")} </Link>
            </>
          )}

          {!carregando && convite && !aceito && (
            <>
              <h1 className="auth-titulo"> {texto("Você foi convidado para a")} {convite.org_nome || texto('sua nova equipe')} {texto("no Offiz")} </h1>
              <p className="auth-subtitulo">{texto("Confira os dados do convite para concluir sua entrada.")}</p>
              <div className="convite-resumo">
                <span>
                  <strong>{texto("E-mail:")}</strong> {convite.email}
                </span>
                <span>
                  <strong>{texto("Papel:")}</strong> {texto(PAPEL_LABEL[convite.role] ?? convite.role)}
                </span>
              </div>

              {convite.usuario_existe ? (
                <>
                  <p className="texto-suave"> {texto("Este e-mail já tem conta no Offiz. Aceite o convite e entre com a sua senha de sempre — nada muda na sua conta.")} </p>
                  {erro && (
                    <p className="alerta alerta-erro" role="alert">
                      {texto(erro)}
                    </p>
                  )}
                  <button
                    type="button"
                    className="botao botao-primario botao-largo"
                    onClick={aceitarComContaExistente}
                    disabled={enviando}
                  >
                    {texto(enviando ? 'Aceitando…' : 'Aceitar convite')}
                  </button>
                </>
              ) : (
                <form onSubmit={aceitarCriandoConta} noValidate>
                  <label className="campo">
                    <span>{texto("Seu nome")}</span>
                    <input
                      type="text"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder={texto("Como devemos te chamar")}
                      autoComplete="name"
                      autoFocus
                    />
                  </label>
                  <label className="campo">
                    <span>{texto("Crie uma senha")}</span>
                    <input
                      type="password"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      placeholder={texto("Mínimo de 8 caracteres")}
                      autoComplete="new-password"
                    />
                  </label>
                  <p className="texto-suave convite-dica-senha"> {texto("Pelo menos 8 caracteres, com 1 letra maiúscula e 1 número.")} </p>
                  <label className="campo">
                    <span>{texto("Confirmar senha")}</span>
                    <input
                      type="password"
                      value={confirmar}
                      onChange={(e) => setConfirmar(e.target.value)}
                      placeholder={texto("Repita a senha")}
                      autoComplete="new-password"
                    />
                  </label>
                  {erro && (
                    <p className="alerta alerta-erro" role="alert">
                      {texto(erro)}
                    </p>
                  )}
                  <button type="submit" className="botao botao-primario botao-largo" disabled={enviando}>
                    {texto(enviando ? 'Criando sua conta…' : 'Criar senha e entrar')}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
