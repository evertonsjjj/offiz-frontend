import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, asList, getSessionIdentity } from '../lib/api'
import { useIdioma } from '../lib/i18n'
import { formatDataHora } from '../lib/format'
import { useToasts } from './Toasts'

type DestinoAcesso = { id: number; nome: string; email?: string; role?: string }
type LinkAcesso = { email: string; link: string; aviso: string | null; email_enviado: boolean; expira_em_dias: number }
type ConvitePendente = { id: number; organization_id: number; org_nome: string; email: string; role: string; expira_em: string }

/** O token só existe na resposta de criação; reabrir um convite exige gerar outro. */
type DialogoProps = {
  destino: DestinoAcesso; aoFechar: () => void; aoGerar: () => void
}
export function DialogoLinkAcesso(props: DialogoProps) {
  return <DialogoAcessoConteudo key={`${getSessionIdentity()}:${props.destino.id}:${props.destino.email ?? ''}:${props.destino.role ?? ''}`} {...props} />
}
function DialogoAcessoConteudo({ destino, aoFechar, aoGerar }: DialogoProps) {
  const { t } = useIdioma()
  const { sucesso, falha } = useToasts()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const emCurso = useRef(false)
  const montado = useRef(false)
  const sessao = useRef(getSessionIdentity())
  const copiandoRef = useRef(false)
  const campoLink = useRef<HTMLInputElement>(null)
  const [copiando, setCopiando] = useState(false)
  const [email, setEmail] = useState(destino.email ?? '')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [link, setLink] = useState<LinkAcesso | null>(null)

  useEffect(() => {
    montado.current = true
    const dialog = dialogRef.current
    const anterior = document.activeElement
    dialog?.showModal()
    return () => {
      montado.current = false
      dialog?.close()
      if (anterior instanceof HTMLElement && anterior.isConnected && !anterior.closest('[hidden]')) anterior.focus()
    }
  }, [])

  const atual = () => montado.current && getSessionIdentity() === sessao.current

  async function gerar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!atual() || emCurso.current || link || !e.currentTarget.reportValidity()) return
    emCurso.current = true
    setEnviando(true)
    setErro(null)
    try {
      const resultado = await api.post<LinkAcesso>(`/admin/orgs/${destino.id}/convite-acesso`, {
        email: email.trim().toLowerCase(),
        ...(destino.role ? { role: destino.role } : {}),
      })
      if (!atual()) return
      setLink(resultado)
      aoGerar()
    } catch (e) {
      if (!atual()) return
      setErro(e instanceof ApiError ? e.detail : t('Não foi possível gerar o link.', 'Could not generate the link.'))
    } finally {
      emCurso.current = false
      if (atual()) setEnviando(false)
    }
  }

  return <dialog ref={dialogRef} className="conta-dialogo admin-acesso-dialogo"
    aria-label={t('Link de acesso', 'Access link')}
    onCancel={e => { e.preventDefault(); if (!emCurso.current) aoFechar() }}>
    <h2 className="secao-titulo">{t('Link de acesso', 'Access link')}</h2>
    <p><strong>{destino.nome}</strong></p>
    {link ? <>
      <p role="status">{t('Convite pronto para', 'Invitation ready for')} <strong>{link.email}</strong>.</p>
      <p>{link.aviso ?? t('Abra o convite para criar a senha e concluir o cadastro.', 'Open the invitation to create a password and finish registration.')}</p>
      <div className="campo">
        <label htmlFor="admin-acesso-link">{t('Link do convite', 'Invitation link')}</label>
        <input ref={campoLink} id="admin-acesso-link" value={link.link} readOnly onFocus={e => e.currentTarget.select()} />
      </div>
      <p className="texto-suave">{link.email_enviado ? t('Também enviado por e-mail.', 'Also sent by email.') : t('O e-mail não foi enviado. Copie o link para abrir ou compartilhar.', 'Email was not sent. Copy the link to open or share it.')}</p>
      <p className="texto-suave">{t(`Válido por ${link.expira_em_dias} dias. Copie antes de fechar; para obter outro link, use Gerar novo link em Pessoas e acessos.`, `Valid for ${link.expira_em_dias} days. Copy before closing; to get another link, use Generate new link in People and access.`)}</p>
      <div className="linha-conceder admin-acesso-acoes">
        <button type="button" className="botao botao-fantasma" onClick={aoFechar}>{t('Fechar', 'Close')}</button>
        <button type="button" className="botao botao-primario" disabled={copiando} onClick={async () => {
          if (!atual() || copiandoRef.current) return
          copiandoRef.current = true
          setCopiando(true)
          try {
            if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
            await navigator.clipboard.writeText(link.link)
            if (atual()) sucesso(t('Link copiado.', 'Link copied.'))
          } catch {
            if (atual()) {
              campoLink.current?.focus(); campoLink.current?.select()
              falha(t('Não consegui copiar. Selecione o link e copie manualmente.', 'Could not copy. Select the link and copy it manually.'))
            }
          } finally {
            copiandoRef.current = false
            if (atual()) setCopiando(false)
          }
        }}>{t('Copiar link', 'Copy link')}</button>
      </div>
    </> : <form onSubmit={gerar} aria-busy={enviando}>
      <p>{t('Informe o e-mail de quem vai entrar. A conta aparece em Usuários após aceitar o convite.', 'Enter the email of the person joining. The account appears under Users after accepting the invitation.')}</p>
      <div className="campo">
        <label htmlFor="admin-acesso-email">{t('E-mail de acesso', 'Access email')}</label>
        <input id="admin-acesso-email" type="email" required autoFocus autoComplete="email"
          value={email} onChange={e => setEmail(e.target.value)} readOnly={!!destino.email} disabled={enviando} />
      </div>
      <p className="texto-suave">{t('Se já houver um convite pendente para esse e-mail neste cliente, o novo link substitui o anterior. A senha de uma conta existente não muda.', 'If this client already has a pending invitation for this email, the new link replaces it. An existing account’s password does not change.')}</p>
      {erro && <p className="alerta alerta-erro" role="alert">{erro}</p>}
      <div className="linha-conceder admin-acesso-acoes">
        <button type="button" className="botao botao-fantasma" disabled={enviando} onClick={aoFechar}>{t('Cancelar', 'Cancel')}</button>
        <button type="submit" className="botao botao-primario" disabled={enviando || !email.trim()}>{enviando ? t('Gerando…', 'Generating…') : t('Gerar link', 'Generate link')}</button>
      </div>
    </form>}
  </dialog>
}

type ConvitesProps = { ativo: boolean; revisao: number; aoMudar: () => void }
export function ConvitesPendentesAdmin(props: ConvitesProps) {
  return <ConvitesPendentesConteudo key={getSessionIdentity()} {...props} />
}
function ConvitesPendentesConteudo({ ativo, revisao, aoMudar }: ConvitesProps) {
  const { t, idioma } = useIdioma()
  const [convites, setConvites] = useState<ConvitePendente[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [destino, setDestino] = useState<DestinoAcesso | null>(null)
  const [carregando, setCarregando] = useState(false)
  const leitura = useRef<AbortController | null>(null)
  const sessao = useRef(getSessionIdentity())
  const carregar = useCallback(async () => {
    if (!ativo) return
    leitura.current?.abort()
    const controller = new AbortController()
    leitura.current = controller
    setCarregando(true)
    try {
      const dados = await api.get('/admin/convites', controller.signal)
      if (controller.signal.aborted || getSessionIdentity() !== sessao.current) return
      setConvites(asList<ConvitePendente>(dados, 'convites'))
      setErro(null)
    } catch (e) {
      if (!controller.signal.aborted && getSessionIdentity() === sessao.current) setErro(e instanceof ApiError ? e.detail : t('Não foi possível listar os convites.', 'Could not list invitations.'))
    } finally {
      if (!controller.signal.aborted && getSessionIdentity() === sessao.current) setCarregando(false)
    }
  }, [t, ativo])
  useEffect(() => {
    if (ativo) void carregar()
    else setDestino(null)
    return () => { leitura.current?.abort() }
  }, [ativo, revisao, carregar])
  const termo = busca.trim().toLowerCase()
  const visiveis = (convites ?? []).filter(c => `${c.email} ${c.org_nome}`.toLowerCase().includes(termo))
  const papeis: Record<string, string> = { owner: t('dono', 'owner'), admin: t('administrador', 'administrator'), member: t('membro', 'member') }
  return <section className="cartao admin-convites" aria-label={t('Convites pendentes', 'Pending invitations')}>
    <h2 className="secao-titulo">{t('Convites pendentes', 'Pending invitations')}</h2>
    <p className="texto-suave">{t('Estas pessoas ainda não aceitaram o convite. Após o aceite, aparecem em Usuários e na contagem de pessoas do cliente.', 'These people have not accepted their invitation yet. After acceptance, they appear under Users and in the client’s member count.')}</p>
    {erro && <p className="alerta alerta-erro" role="alert">{erro} {convites !== null && t('A lista abaixo é da última consulta confirmada.', 'The list below is from the last confirmed check.')} <button type="button" className="botao-texto" disabled={carregando} onClick={carregar}>{t(carregando ? 'Consultando…' : 'Tentar novamente', carregando ? 'Checking…' : 'Try again')}</button></p>}
    {convites === null && !erro && <p>{t('Carregando…', 'Loading…')}</p>}
    {convites !== null && <>
      <input type="search" aria-label={t('Filtrar convites', 'Filter invitations')} placeholder={t('Filtrar por e-mail ou cliente…', 'Filter by email or client…')} value={busca} onChange={e => setBusca(e.target.value)} />
      {visiveis.length === 0 ? <p className="texto-suave">{t('Nenhum convite pendente encontrado.', 'No pending invitations found.')}</p> : <div className="tabela-scroll"><table className="tabela">
        <thead><tr><th>E-mail</th><th>{t('Cliente', 'Client')}</th><th>{t('Papel', 'Role')}</th><th>{t('Expira em', 'Expires')}</th><th>{t('Ações', 'Actions')}</th></tr></thead>
        <tbody>{visiveis.map(c => <tr key={c.id}>
          <td>{c.email}</td><td>{c.org_nome}</td><td>{papeis[c.role] ?? c.role}</td><td>{formatDataHora(c.expira_em, idioma)}</td>
          <td><button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => setDestino({ id: c.organization_id, nome: c.org_nome, email: c.email, role: c.role })}>{t('Gerar novo link', 'Generate new link')}</button></td>
        </tr>)}</tbody>
      </table></div>}
    </>}
    {ativo && destino && <DialogoLinkAcesso destino={destino} aoFechar={() => setDestino(null)} aoGerar={aoMudar} />}
  </section>
}
