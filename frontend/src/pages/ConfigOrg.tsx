import { useConfirmacao } from '../components/useConfirmacao'
import { SecaoLgpd } from '../components/SecaoLgpd'
import { MeuContrato } from '../components/ContratosIA'
import { ConsumoIA } from '../components/ConsumoIA'
import { DownloadsMac } from '../components/DownloadsMac'
import { DownloadsWindowsZIP } from '../components/DownloadsWindowsZIP'
import { RecuperacaoLocal } from '../components/RecuperacaoLocal'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  api,
  asList,
  ApiError,
  carregarImagem,
  clearTokens,
  getSessionIdentity,
} from '../lib/api'
import { ehDesktop } from '../lib/desktop'
import { appDownloadWindowsBase } from '../lib/downloadsApp'
import { AtualizacaoMotor } from '../components/AtualizacaoMotor'
import { useIdioma } from '../lib/i18n'
import { SeletorIdioma } from '../components/SeletorIdioma'
import './ConfigOrg.css'
import {
  EVENTO_SETTINGS_LLM_MUDOU,
  temMotorBridge,
  type ClaudeStatus,
  type DepStatus,
  type MotorEstado,
  type ResultadoComTrocaDeMotor,
} from '../lib/motor-bridge'
import { useToasts } from '../components/Toasts'
import { Icone } from '../components/Icone'
import { formatBytes, formatData, formatDataHora, formatTokens, tempoRelativo, toDate } from '../lib/format'
import type {
  AssentosInfo,
  Convite,
  ConviteCriado,
  CredencialTribunal,
  Dispositivo,
  LlmSettings,
  McpKey,
  McpKeyCriada,
  Membro,
  MidiaKeysStatus,
  NotificacoesOrgSettings,
  NotificacoesUsuario,
  Predio,
  PromptPronto,
  TemaOffice,
  TipoCredencialTribunal,
  UsoResumo,
} from '../lib/types'

const ROLE_LABEL: Record<string, [string, string]> = {
  owner: ['Dono', 'Owner'],
  admin: ['Administrador', 'Administrator'],
  member: ['Membro', 'Member'],
}

/** Dias (arredondados para cima) até um ISO futuro; null se inválido/passado. */
function diasAte(iso: string | null | undefined): number | null {
  const d = toDate(iso)
  if (!d) return null
  const dias = Math.ceil((d.getTime() - Date.now()) / 86_400_000)
  return dias > 0 ? dias : null
}

/**
 * Quais ANDARES do prédio esta pessoa enxerga.
 *
 * Sem isto, todo membro ativo via todos os andares concedidos — num prédio de
 * vários, o estagiário do Financeiro enxergava o Jurídico inteiro. A restrição
 * é OPT-IN: nenhuma marcação = vê tudo (o comportamento de sempre).
 */
function AndaresDoMembro({
  orgId,
  membro,
  andaresDoPredio,
  podeGerenciar,
  aoSalvar,
}: {
  orgId: number
  membro: Membro
  andaresDoPredio: string[]
  podeGerenciar: boolean
  aoSalvar: () => void
}) {
  const { t } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [aberto, setAberto] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const restritos = membro.andares ?? []
  const restrito = restritos.length > 0

  // owner/admin administram o prédio inteiro — oferecer a escolha seria
  // prometer um efeito que o backend (corretamente) ignora.
  if (membro.restringivel === false) {
    return <span className="texto-suave" title={t("Quem administra a empresa enxerga todos os escritórios", "Company administrators can access every office")}>{t("todos", "all")}</span>
  }
  if (andaresDoPredio.length <= 1) {
    // Prédio de um andar: não há o que restringir, e a coluna viraria ruído.
    return <span className="texto-suave">—</span>
  }

  async function alternar(slug: string, marcar: boolean) {
    // A conta é feita sobre o que a pessoa enxerga HOJE, não sobre a lista
    // guardada: sem restrição, a lista guardada é vazia — e desmarcar um andar
    // partindo dela daria vazio de novo, ou seja, "vê tudo". O clique não
    // faria nada e pareceria um bug.
    const enxergaHoje = restrito ? restritos : andaresDoPredio
    let novos = marcar
      ? [...new Set([...enxergaHoje, slug])]
      : enxergaHoje.filter((s) => s !== slug)
    // Marcou todos de volta = não há mais exceção: grava lista vazia para a
    // pessoa voltar ao estado "sem restrição" (e receber andares futuros).
    if (novos.length === andaresDoPredio.length) novos = []
    setSalvando(true)
    try {
      await api.put(`/orgs/${orgId}/membros/${membro.usuario_id}/andares`, {
        andares: novos,
      })
      sucesso(
        novos.length === 0
          ? t(`${membro.nome || membro.email} volta a enxergar todos os escritórios.`, `${membro.nome || membro.email} can access every office again.`)
          : t(`${membro.nome || membro.email}: ${novos.length} escritório(s).`, `${membro.nome || membro.email}: ${novos.length} office(s).`),
      )
      aoSalvar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível mudar os escritórios.", "Could not change office access."))
    } finally {
      setSalvando(false)
    }
  }

  if (!podeGerenciar) {
    return (
      <span className="texto-suave">{restrito ? restritos.join(', ') : 'todos'}</span>
    )
  }

  return (
    <div className="andares-membro">
      <button
        type="button"
        className="botao botao-fantasma botao-pequeno"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        {restrito ? t(`${restritos.length} escritório(s)`, `${restritos.length} office(s)`) : 'todos'}
      </button>
      {aberto && (
        <div className="andares-membro-lista">
          {andaresDoPredio.map((slug) => (
            <label key={slug} className="check-inline">
              <input
                type="checkbox"
                disabled={salvando}
                checked={!restrito || restritos.includes(slug)}
                onChange={(e) => alternar(slug, e.target.checked)}
              />
              <span>{slug}</span>
            </label>
          ))}
          <p className="texto-suave andares-membro-dica">
            {t("Nada marcado como exceção = esta pessoa enxerga ", "No exceptions selected means this person can access ")}<strong>{t("todos", "all")}</strong> {t("os escritórios. Desmarque um escritório para escondê-lo dela.", "offices. Uncheck an office to hide it from this person.")}</p>
        </div>
      )}
    </div>
  )
}

function LimiteMembro({
  orgId,
  membro,
  aoSalvar,
}: {
  orgId: number
  membro: Membro
  aoSalvar: () => void
}) {
  const { t } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [valor, setValor] = useState(membro.limite_tokens_mes ? String(membro.limite_tokens_mes) : '')
  const [salvando, setSalvando] = useState(false)
  /* O TETO EM R$ SAIU DA TELA (16/08/2026, decisão do dono: "não quero menção
   * de valor mas sim controle por token"). O campo continua no backend e o
   * PUT manda `null` — quem tinha um teto em reais salvo o vê apagado ao
   * salvar aqui, que é o comportamento certo: dois freios para a mesma coisa,
   * um deles invisível, é pior que um freio só. Token é o que o produto MEDE
   * de verdade, e o único que vale em qualquer provedor. */

  async function salvar() {
    setSalvando(true)
    try {
      const n = valor.trim() ? Math.max(0, Math.floor(Number(valor))) : 0
      await api.put(`/orgs/${orgId}/membros/${membro.usuario_id}/limite`, {
        limite_tokens_mes: n,
        limite_brl_mes: null,
      })
      sucesso(
        n > 0
          ? t(`Limite de ${n.toLocaleString('pt-BR')} tokens/mês salvo.`, `Monthly limit of ${n.toLocaleString('en-US')} tokens saved.`)
          : t("Limite removido (ilimitado).", "Limit removed (unlimited)."),
      )
      aoSalvar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível salvar o limite.", "Could not save the limit."))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="linha-form" style={{ gap: '0.4rem', margin: 0, flexWrap: 'wrap' }}>
      <input
        type="number"
        min={0}
        step={1000}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder={t("tokens (ilimitado)", "tokens (unlimited)")}
        aria-label={t(`Limite mensal de tokens de ${membro.nome || membro.email || 'membro'}`, `Monthly token limit for ${membro.nome || membro.email || 'member'}`)}
        style={{ maxWidth: 130 }}
      />
      <button type="button" className="botao-texto" onClick={salvar} disabled={salvando}>
        {salvando ? '…' : 'salvar'}
      </button>
    </div>
  )
}

/**
 * O NOME de exibição de um membro, editável na própria linha.
 *
 * Existe porque o nome entra no cadastro e antes não havia como consertar em
 * lugar nenhum — nem aqui, nem no perfil. Um erro de digitação (ou o clássico
 * "colei a senha no campo do nome") ficava para sempre na tela que o cliente vê.
 *
 * Só o nome: o e-mail é a identidade de login e se troca no Admin global.
 */
function NomeMembro({
  orgId,
  membro,
  podeEditar,
  aoSalvar,
}: {
  orgId: number
  membro: Membro
  podeEditar: boolean
  aoSalvar: () => void
}) {
  const { t } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(membro.nome || '')
  const [salvando, setSalvando] = useState(false)

  if (!podeEditar) return <>{membro.nome || '—'}</>

  if (!editando) {
    return (
      <button
        type="button"
        className="botao-texto"
        style={{ padding: 0, textAlign: 'left' }}
        title={t("Clique para corrigir o nome", "Click to edit the name")}
        onClick={() => {
          setValor(membro.nome || '')
          setEditando(true)
        }}
      >
        {membro.nome || t("— definir nome", "— set name")}
      </button>
    )
  }

  async function salvar() {
    const nome = valor.trim()
    if (!nome) {
      falha(t("O nome não pode ficar vazio.", "Name cannot be empty."))
      return
    }
    setSalvando(true)
    try {
      await api.put(`/orgs/${orgId}/membros/${membro.usuario_id}/nome`, { nome })
      sucesso(t("Nome atualizado.", "Name updated."))
      setEditando(false)
      aoSalvar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível salvar o nome.", "Could not save the name."))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="linha-form" style={{ gap: '0.4rem', margin: 0, flexWrap: 'wrap' }}>
      <input
        type="text"
        value={valor}
        maxLength={120}
        autoFocus
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') salvar()
          if (e.key === 'Escape') setEditando(false)
        }}
        aria-label={t(`Nome de ${membro.email || 'membro'}`, `Name for ${membro.email || 'member'}`)}
        style={{ maxWidth: 190 }}
      />
      <button type="button" className="botao-texto" onClick={salvar} disabled={salvando}>
        {salvando ? '…' : 'salvar'}
      </button>
      <button type="button" className="botao-texto" onClick={() => setEditando(false)}>
        {t("cancelar", "cancel")}</button>
    </div>
  )
}

function SecaoMembros({ orgId }: { orgId: number }) {
  const { confirmar, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}`)

  const { t, idioma } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [membros, setMembros] = useState<Membro[] | null>(null)
  const [andaresDoPredio, setAndaresDoPredio] = useState<string[]>([])
  const [assentos, setAssentos] = useState<AssentosInfo | null>(null)
  const [convites, setConvites] = useState<Convite[] | null>(null)
  // O link copiável (token cru) SÓ vem na resposta do POST — o GET da lista
  // devolve link null. Guardamos por id os links criados NESTA sessão.
  const [linksSessao, setLinksSessao] = useState<Record<number, { link: string; email_enviado: boolean }>>({})
  // Membro comum não gerencia convites/limites/remoções: o GET de convites
  // responde 403 e escondemos as ações (em vez de deixar o submit estourar).
  const [podeGerenciar, setPodeGerenciar] = useState(true)
  const [erroConvites, setErroConvites] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [enviando, setEnviando] = useState(false)
  const [linkParaCopiar, setLinkParaCopiar] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const data = await api.get<unknown>(`/orgs/${orgId}/membros`)
      setMembros(asList<Membro>(data, 'membros'))
      const doPredio = (data as { andares_do_predio?: string[] })?.andares_do_predio
      setAndaresDoPredio(Array.isArray(doPredio) ? doPredio : [])
      setAssentos((data as { assentos?: AssentosInfo } | null)?.assentos ?? null)
      setErro(null)
    } catch (e) {
      setErro(e instanceof ApiError ? e.detail : t("Não foi possível listar os membros.", "Could not list members."))
    }
    try {
      setConvites(asList<Convite>(await api.get<unknown>(`/orgs/${orgId}/convites`), 'convites'))
      setPodeGerenciar(true)
      setErroConvites(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        // Sem permissão de gestão (membro comum): esconde form/ações, sem alarde.
        setPodeGerenciar(false)
        setConvites([])
        setErroConvites(null)
      } else {
        // Falha transitória para quem gerencia: avisa e oferece tentar de novo
        // (fingir lista vazia esconderia convites reais e travaria o reenvio).
        setConvites(null)
        setErroConvites(t("Não foi possível carregar os convites pendentes.", "Could not load pending invitations."))
      }
    }
  }, [orgId])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function convidar(e: FormEvent) {
    e.preventDefault()
    const alvo = email.trim().toLowerCase()
    if (!alvo) {
      setErro(t("Informe o e-mail de quem você quer convidar.", "Enter the email address of the person you want to invite."))
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      const criado = await api.post<ConviteCriado>(`/orgs/${orgId}/convites`, { email: alvo, role })
      setLinksSessao((prev) => ({ ...prev, [criado.id]: { link: criado.link, email_enviado: criado.email_enviado } }))
      sucesso(
        criado.email_enviado
          ? t(`Convite enviado por e-mail para ${criado.email}.`, `Invitation emailed to ${criado.email}.`)
          : t(`Convite criado para ${criado.email} — o e-mail não saiu, copie o link e envie você mesmo.`, `Invitation created for ${criado.email}. Email was not sent; copy and share the link yourself.`),
      )
      setEmail('')
      await carregar()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && /assento/i.test(err.detail)) {
        // Ex.: "Sem assentos livres (5 de 5 em uso)" — já vem com o número.
        setErro(`${err.detail}. Revogue um convite pendente ou remova um membro para liberar um assento.`)
      } else if (err instanceof ApiError) {
        setErro(err.detail)
      } else {
        setErro(t("Não foi possível criar o convite.", "Could not create the invitation."))
      }
    } finally {
      setEnviando(false)
    }
  }

  async function revogar(c: Convite) {
    if (!await confirmar({ titulo: t("Revogar convite", "Revoke invitation"), mensagem: t(`Revogar o convite de ${c.email}? O link deixa de funcionar e o assento é liberado.`, `Revoke the invitation for ${c.email}? The link will stop working and the seat will be released.`), acao: t("Revogar convite", "Revoke invitation") })) return
    try {
      await api.del(`/orgs/${orgId}/convites/${c.id}`)
      sucesso(t(`Convite de ${c.email} revogado.`, `Invitation for ${c.email} revoked.`))
      await carregar()
    } catch (err) {
      falha(err instanceof ApiError ? err.detail : t("Não foi possível revogar o convite.", "Could not revoke the invitation."))
    }
  }

  async function copiarLink(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      sucesso(t("Link do convite copiado.", "Invitation link copied."))
    } catch {
      // Sem clipboard (http/permissão): mostra o link para cópia manual.
      setLinkParaCopiar(link)
    }
  }

  async function remover(m: Membro) {
    // Anti-rotação de assentos: o acesso cai na hora, mas o assento não volta
    // já — o confirm avisa para o dono não estranhar o medidor "cheio".
    if (
      !await confirmar({ titulo: t("Remover pessoa da empresa", "Remove person from company"), mensagem: t(`Remover ${m.nome || m.email || t("este membro", "this member")} da organização?\n\n`, `Remove ${m.nome || m.email || 'this member'} from the organization?

`) +
          t("O acesso termina agora, mas o assento fica reservado por 30 dias ", "Access ends now, but the seat remains reserved for 30 days ") +
          t("(anti-rotação) antes de liberar para outra pessoa.", "before it can be assigned to someone else."), acao: t("Remover acesso", "Remove access") })
    )
      return
    try {
      await api.del(`/orgs/${orgId}/membros/${m.usuario_id}`)
      sucesso(t(`${m.nome || m.email || t("Membro", "Member")} removido da organização.`, `${m.nome || m.email || 'Member'} removed from the organization.`))
      await carregar()
    } catch (err) {
      falha(err instanceof ApiError ? err.detail : t("Não foi possível remover o membro.", "Could not remove the member."))
    }
  }

  // Toggle do OPERADOR: este e-mail recebe (ou não) os avisos desta org —
  // salva na hora, sem botão (decisão do dono: definir o e-mail por aqui).
  async function alternarAvisos(m: Membro, ligar: boolean) {
    try {
      await api.put(`/orgs/${orgId}/membros/${m.usuario_id}/notificacoes`, { notif_email: ligar })
      sucesso(
        ligar
          ? t(`Avisos por e-mail ligados para ${m.email}.`, `Email notifications enabled for ${m.email}.`)
          : t(`Avisos por e-mail desligados para ${m.email}.`, `Email notifications disabled for ${m.email}.`),
      )
      await carregar()
    } catch (err) {
      falha(err instanceof ApiError ? err.detail : t("Não foi possível salvar o aviso por e-mail.", "Could not save the email notification setting."))
    }
  }

  const totalAssentos = assentos ? Math.max(assentos.total, 1) : 1
  // Quarentena (anti-rotação): campos opcionais — backend antigo não os manda
  // e o medidor segue como sempre.
  const quarentena = assentos?.quarentena ?? 0
  const diasQuarentena = quarentena > 0 ? diasAte(assentos?.quarentena_libera_em) : null

  return <>{dialogo}{(
    <section className="cartao">
      <h2 className="secao-titulo">{t("Membros", "Members")}</h2>
      {linkParaCopiar && <div className="config-copia-manual" role="status">
        <label className="campo"><span>{t('Selecione e copie o link do convite', 'Select and copy the invitation link')}</span>
          <textarea readOnly value={linkParaCopiar} rows={2} autoFocus onFocus={e => e.currentTarget.select()} />
        </label>
        <button type="button" className="botao-texto" onClick={() => setLinkParaCopiar(null)}>{t('Fechar link', 'Close link')}</button>
      </div>}
      {assentos && (
        <div className="assentos-medidor" role="status">
          <span className="assentos-barra" aria-hidden="true">
            <span
              className="assentos-barra-usados"
              style={{ width: `${Math.min(100, (assentos.usados / totalAssentos) * 100)}%` }}
            />
            <span
              className="assentos-barra-pendentes"
              style={{ width: `${Math.min(100, (assentos.pendentes / totalAssentos) * 100)}%` }}
            />
            {quarentena > 0 && (
              <span
                className="assentos-barra-quarentena"
                style={{ width: `${Math.min(100, (quarentena / totalAssentos) * 100)}%` }}
              />
            )}
          </span>
          <span className="assentos-texto">
            <strong>
              {assentos.usados} {t("de ", "of ")}{assentos.total}
            </strong>{' '}
            {t("assentos em uso", "seats in use")}{assentos.pendentes > 0 &&
              t(` · ${assentos.pendentes} convite${assentos.pendentes === 1 ? '' : 's'} pendente${assentos.pendentes === 1 ? '' : 's'}`, ` · ${assentos.pendentes} pending invitation${assentos.pendentes === 1 ? '' : 's'}`)}
            {quarentena > 0 &&
              t(` · ${quarentena} em quarentena${
                diasQuarentena !== null
                  ? ` (libera em ${diasQuarentena} dia${diasQuarentena === 1 ? '' : 's'})`
                  : ''
              }`, ` · ${quarentena} reserved${diasQuarentena !== null ? ` (available in ${diasQuarentena} day${diasQuarentena === 1 ? '' : 's'})` : ''}`)}
          </span>
        </div>
      )}
      {erro && <p className="alerta alerta-erro" role="alert">{erro} <button type="button" className="botao-texto" onClick={carregar}>{t('Tentar novamente', 'Try again')}</button></p>}
      {membros === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-linha" />
          <div className="esqueleto esqueleto-linha" />
        </div>
      )}
      {membros !== null && (
        <div className="tabela-scroll">
          <table className="tabela">
            <thead>
              <tr>
                <th>{t("Nome", "Name")}</th>
                <th>{t("E-mail", "Email")}</th>
                <th>{t("Papel", "Role")}</th>
                <th title={t("Este e-mail recebe os avisos desta organização (entregas prontas etc.)", "This email receives this organization’s notifications, such as completed deliverables")}>{t("Avisos", "Notifications")}</th>
                <th title={t("Quais escritórios da empresa esta pessoa enxerga", "Which offices this person can access")}>{t("Escritórios", "Offices")}</th>
                <th>{t("Limite de tokens/mês", "Monthly token limit")}</th>
                <th aria-label={t("Ações", "Actions")} />
              </tr>
            </thead>
            <tbody>
              {membros.map((m) => (
                <tr key={m.usuario_id ?? m.id}>
                  <td>
                    <NomeMembro
                      orgId={orgId}
                      membro={m}
                      podeEditar={podeGerenciar && !!m.usuario_id}
                      aoSalvar={carregar}
                    />
                  </td>
                  <td>{m.email || '—'}</td>
                  <td>{ROLE_LABEL[m.role] ? t(...ROLE_LABEL[m.role]) : m.role}</td>
                  <td>
                    {podeGerenciar ? (
                      <label
                        className="check-inline"
                        title={t(`Enviar os avisos desta organização para ${m.email}`, `Send this organization’s notifications to ${m.email}`)}
                      >
                        <input
                          type="checkbox"
                          checked={m.notif_email !== false}
                          onChange={(e) => alternarAvisos(m, e.target.checked)}
                        />
                        <span className="texto-suave">{t("e-mail", "email")}</span>
                      </label>
                    ) : (
                      <span className="texto-suave">
                        {m.notif_email !== false ? (
                          <>
                            <Icone nome="email" tamanho={15} /> {t("sim", "yes")}</>
                        ) : (
                          '—'
                        )}
                      </span>
                    )}
                  </td>
                  <td>
                    <AndaresDoMembro
                      orgId={orgId}
                      membro={m}
                      andaresDoPredio={andaresDoPredio}
                      podeGerenciar={podeGerenciar}
                      aoSalvar={carregar}
                    />
                  </td>
                  <td>
                    {podeGerenciar ? (
                      <LimiteMembro orgId={orgId} membro={m} aoSalvar={carregar} />
                    ) : (
                      <span className="texto-suave">
                        {m.limite_tokens_mes
                          ? t(`${m.limite_tokens_mes.toLocaleString('pt-BR')} tokens/mês`, `${m.limite_tokens_mes.toLocaleString('en-US')} tokens/month`)
                          : 'ilimitado'}
                      </span>
                    )}
                  </td>
                  <td>
                    {podeGerenciar && m.role !== 'owner' && (
                      <button type="button" className="botao-texto perigo" onClick={() => remover(m)}>
                        {t("Remover", "Remove")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {podeGerenciar && (
      <>
      <h3 className="secao-titulo secao-subtitulo">{t("Convidar por e-mail", "Invite by email")}</h3>
      <form className="linha-form" onSubmit={convidar} style={{ marginTop: '0.4rem' }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("email@daconvidada.com.br", "invitee@example.com")}
          aria-label={t("E-mail de quem você quer convidar", "Email address of the person to invite")}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'member' | 'admin')}
          aria-label={t("Papel do convidado", "Invitee role")}
        >
          <option value="member">{t("Membro", "Member")}</option>
          <option value="admin">{t("Administrador", "Administrator")}</option>
        </select>
        <button type="submit" className="botao botao-primario" disabled={enviando}>
          {enviando ? t("Convidando…", "Inviting…") : t("Convidar", "Invite")}
        </button>
      </form>
      <p className="texto-suave">
        {t("O convidado recebe um link para criar a própria senha e entrar na organização. O convite vale 7 dias e ocupa 1 assento até ser aceito ou revogado.", "The invitee receives a link to create a password and join the organization. The invitation lasts 7 days and occupies one seat until accepted or revoked.")}</p>

      {erroConvites && (
        <p className="alerta alerta-erro">
          {erroConvites}{' '}
          <button type="button" className="botao-texto" onClick={() => carregar()}>
            {t("tentar de novo", "try again")}</button>
        </p>
      )}

      {convites !== null && convites.length > 0 && (
        <>
          <h3 className="secao-titulo secao-subtitulo">{t("Convites pendentes", "Pending invitations")}</h3>
          <div className="tabela-scroll">
            <table className="tabela">
              <thead>
                <tr>
                  <th>{t("E-mail", "Email")}</th>
                  <th>{t("Papel", "Role")}</th>
                  <th>{t("Expira em", "Expires in")}</th>
                  <th>{t("Link", "Link")}</th>
                  <th aria-label={t("Ações", "Actions")} />
                </tr>
              </thead>
              <tbody>
                {convites.map((c) => {
                  const sess = linksSessao[c.id]
                  return (
                    <tr key={c.id}>
                      <td>{c.email}</td>
                      <td>{ROLE_LABEL[c.role] ? t(...ROLE_LABEL[c.role]) : c.role}</td>
                      <td>
                        {formatDataHora(c.expira_em, idioma)}
                        {c.criado_em && <span className="texto-suave"> {t("· criado ", "· created ")}{tempoRelativo(c.criado_em, idioma)}</span>}
                      </td>
                      <td>
                        {sess ? (
                          <span className="convite-link-acao">
                            <button type="button" className="botao-texto" onClick={() => copiarLink(sess.link)}>
                              {t("Copiar link", "Copy link")}</button>
                            {!sess.email_enviado && (
                              <span className="texto-suave">{t("e-mail não saiu — envie o link você mesmo", "email not sent — share the link yourself")}</span>
                            )}
                          </span>
                        ) : c.email_enviado ? (
                          <span className="texto-suave">{t("enviado por e-mail", "sent by email")}</span>
                        ) : (
                          <span className="texto-suave">{t("se precisar do link, revogue e gere um novo", "if you need the link, revoke and create a new invitation")}</span>
                        )}
                      </td>
                      <td>
                        <button type="button" className="botao-texto perigo" onClick={() => revogar(c)}>
                          {t("Revogar", "Revoke")}</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      </>
      )}
    </section>
  )}</>
}

/** Sentinela do seletor de gateway: "eu tenho o meu endereço". Não é URL de
 *  propósito — nenhuma URL válida colide com ele. */
const OUTRO_ENDPOINT = '__outro__'

/** A MESMA normalização que o backend aplica ao gravar (`validar_base_url`:
 *  trim + sem barra final). Sem ela, a URL gravada nunca casaria com o preset
 *  na volta e todo mundo cairia em "Outro". */
function normalizarEndpoint(url: string): string {
  return (url || '').trim().replace(/\/+$/, '')
}

export function SecaoMotorIA({ orgId, prepararApi = false }: { orgId: number; prepararApi?: boolean }) {
  const { t } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [settings, setSettings] = useState<LlmSettings | null>(null)
  // PROVEDOR DE IA (16/08/2026): endpoint compatível + nomes dos modelos.
  const [provedor, setProvedor] = useState('anthropic')
  const [baseUrl, setBaseUrl] = useState('')
  /** O GATEWAY escolhido: a própria URL do preset, ou OUTRO_ENDPOINT quando o
   *  dono tem o dele (aí quem vale é o `baseUrl` digitado). Nunca um id — o
   *  que trafega e o que é gravado continua sendo uma URL, então nada muda
   *  para o backend, para o app desktop, nem para os testes de contrato. */
  const [endpointEscolhido, setEndpointEscolhido] = useState(OUTRO_ENDPOINT)
  /** QUAL CLI executa as tarefas: 'claude' (padrão, e o único caminho da
   *  Anthropic) ou 'codex' (o CLI da OpenAI — a chave dela vale direto, sem
   *  gateway). É o que faz a OpenAI deixar de pedir um endereço. */
  const [motorCli, setMotorCli] = useState('claude')
  /** Leitura em voz alta das respostas (Web Speech do NAVEGADOR de quem
   *  ouve — o servidor não gera áudio): 'desligada' (padrão, o botão nem
   *  aparece) | 'botao' | 'sempre'. */
  const [vozLeitura, setVozLeitura] = useState('desligada')
  const [vozDitado, setVozDitado] = useState('desligado')
  /** O MODELO escolhido no dropdown (17/08/2026, decisão do dono: escolher,
   *  não digitar). '' = AUTOMÁTICO — o roteador decide por tarefa (leve nas
   *  criativas e de rotina, premium nas pesadas, com o par do catálogo). Um
   *  id = manual: TUDO roda naquele modelo. */
  const [modeloEscolhido, setModeloEscolhido] = useState('')
  /** O par premium/leve como está GRAVADO — para reconhecer o estado atual e
   *  para oferecer "(configuração atual)" quando ele não bate com a lista. */
  const [modeloGravado, setModeloGravado] = useState<{ premium: string; leve: string }>({
    premium: '',
    leve: '',
  })
  const [erro, setErro] = useState<string | null>(null)
  const [novaChave, setNovaChave] = useState('')
  // Sem seletor de modelo/esforço/estratégia (decisão do dono, 2026-07): a
  // escolha é SEMPRE a inteligente — Sonnet nas tarefas leves, premium nas
  // pesadas — com os defaults do produto. Menos botão, menos erro.
  const [motorModo, setMotorModo] = useState<'api' | 'cli'>('api')
  const [limiteTokens, setLimiteTokens] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [resultadoTeste, setResultadoTeste] = useState<{ ok: boolean; erro?: string } | null>(null)

  const carregar = useCallback(async () => {
    try {
      const data = await api.get<LlmSettings>(`/orgs/${orgId}/settings/llm`)
      setSettings(data)
      setMotorModo(prepararApi ? 'api' : data.motor_modo || 'api')
      setMotorCli(data.motor_cli || 'claude')
      setVozLeitura(data.voz_leitura || 'desligada')
      setVozDitado(data.voz_ditado || 'desligado')
      setProvedor(data.llm_provedor || 'anthropic')
      setBaseUrl(data.llm_base_url || '')
      // Casa a URL gravada com um preset — normalizando dos DOIS lados, do
      // mesmo jeito que o backend grava (trim + sem barra final). Não bateu e
      // não está vazia? É gateway próprio: "Outro", com o valor preservado.
      {
        const catProv = (data.provedores ?? []).find(
          (p) => p.chave === (data.llm_provedor || 'anthropic'),
        )
        const gravada = normalizarEndpoint(data.llm_base_url || '')
        const preset = (catProv?.endpoints ?? []).find(
          (e) => normalizarEndpoint(e.url) === gravada,
        )
        if (preset) setEndpointEscolhido(preset.url)
        else if (gravada) setEndpointEscolhido(OUTRO_ENDPOINT)
        else setEndpointEscolhido((catProv?.endpoints ?? [])[0]?.url || OUTRO_ENDPOINT)
      }
      const premium = data.llm_modelo_premium || ''
      const leve = data.llm_modelo_leve || ''
      setModeloGravado({ premium, leve })
      // Reconhece o estado gravado: leve vazio ou o par igual ao automático
      // do provedor = Automático; premium==leve = manual naquele modelo;
      // qualquer outra combinação vira a opção "(configuração atual)".
      const cat = (data.provedores ?? []).find(
        (p) => p.chave === (data.llm_provedor || 'anthropic'),
      )
      // O prefixo do gateway (ex.: "openai/") é acrescentado ao SALVAR, então
      // some aqui para o dropdown reconhecer o modelo — sem isto, quem salvou
      // via preset reabria a tela vendo "(configuração atual)".
      const semPrefixo = (id: string) => {
        const p = (cat?.endpoints ?? []).find((e) => e.modelo_prefixo && id.startsWith(e.modelo_prefixo))
        return p ? id.slice(p.modelo_prefixo.length) : id
      }
      const premiumBase = semPrefixo(premium)
      const leveBase = semPrefixo(leve)
      if (
        !leve ||
        (cat?.auto && premiumBase === cat.auto.premium && leveBase === cat.auto.leve)
      ) {
        setModeloEscolhido('')
      } else if (
        premiumBase && premiumBase === leveBase &&
        (cat?.modelos ?? []).some((m) => m.id === premiumBase)
      ) {
        // manual num modelo que AINDA está na curadoria; um id que saiu da
        // lista (ex.: gpt-5.1, trocado pela família 5.6) cai no "(atual)" —
        // valor sem <option> deixaria o select em BRANCO.
        setModeloEscolhido(premiumBase)
      } else {
        setModeloEscolhido(`atual:${premium}|${leve}`)
      }
      setLimiteTokens(data.limite_tokens_mes ? String(data.limite_tokens_mes) : '')
      setErro(null)
    } catch (e) {
      setErro(e instanceof ApiError ? e.detail : t("Não foi possível carregar as configurações do motor de IA.", "Could not load AI engine settings."))
    }
  }, [orgId, prepararApi])

  useEffect(() => {
    carregar()
  }, [carregar])

  // O painel do Motor local (app desktop) troca o motor_modo da org por conta
  // própria (parear/desparear) e avisa por este evento — recarregamos para o
  // select "Motor de execução" refletir a troca sem a pessoa dar F5.
  useEffect(() => {
    const aoMudar = () => {
      carregar()
    }
    window.addEventListener(EVENTO_SETTINGS_LLM_MUDOU, aoMudar)
    return () => window.removeEventListener(EVENTO_SETTINGS_LLM_MUDOU, aoMudar)
  }, [carregar])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    setErro(null)
    setResultadoTeste(null)
    try {
      // Estratégia SEMPRE inteligente (convergência: org que um dia salvou
      // "premium" volta ao padrão ao salvar aqui). Modelo/esforço não são
      // enviados — valem os defaults do produto.
      const body: Record<string, string | number> = {
        motor_modo: motorModo,
        modelo_estrategia: 'inteligente',
        limite_tokens_mes: limiteTokens.trim() ? Math.max(0, Math.floor(Number(limiteTokens))) : 0,
      }
      if (novaChave.trim()) body.anthropic_api_key = novaChave.trim()
      // O provedor viaja em BLOCO — o backend valida junto e recusa junto,
      // para a org nunca ficar meio-configurada. E SÓ viaja quando é um
      // provedor do catálogo: numa org legada (Moonshot removido em 20/08),
      // mandar o gravado de volta seria 400 em TODO save — nem o limite de
      // tokens nem a chave salvariam até o dono migrar. Sem os campos llm_*,
      // o backend não toca no provedor e o resto grava normalmente.
      const provedorConhecido = (settings?.provedores ?? []).some((p) => p.chave === provedor)
      if (provedorConhecido) {
      body.llm_provedor = provedor
      // Motor: 'codex' só existe na OpenAI (o backend recusa a combinação
      // errada — aqui é só coerência de tela).
      // OpenAI é sempre o Codex direto — o seletor saiu da tela (26/08)
      body.motor_cli = provedor === 'openai' ? 'codex' : 'claude'
      body.voz_leitura = vozLeitura
      body.voz_ditado = vozDitado
      // O que trafega é SEMPRE uma URL: preset escolhido, ou a digitada em
      // "Outro". No Codex não há endpoint — manda vazio, e o backend descarta
      // (mesmo contrato de voltar para a Anthropic).
      body.llm_base_url =
        provedor === 'openai' && motorCli === 'codex'
          ? ''
          : endpointEscolhido === OUTRO_ENDPOINT
            ? baseUrl.trim()
            : endpointEscolhido
      // O dropdown decide o par premium/leve:
      // - Automático → o par do catálogo do provedor (o roteador escolhe por
      //   tarefa: leve nas criativas e rotina, premium nas pesadas);
      // - modelo específico → TUDO roda nele (premium = leve = o id);
      // - "(configuração atual)" → não mexe no que está gravado.
      const cat = (settings?.provedores ?? []).find((p) => p.chave === provedor)
      if (modeloEscolhido.startsWith('atual:')) {
        body.llm_modelo_premium = modeloGravado.premium
        body.llm_modelo_leve = modeloGravado.leve
      } else if (modeloEscolhido === '') {
        body.llm_modelo_premium = cat?.auto?.premium ?? ''
        body.llm_modelo_leve = cat?.auto?.leve ?? ''
      } else {
        body.llm_modelo_premium = modeloEscolhido
        body.llm_modelo_leve = modeloEscolhido
      }
      // Cada gateway nomeia o modelo do seu jeito: no OpenRouter é
      // `openai/gpt-5.6-sol`, no LiteLLM é o apelido do config.yaml dele. O
      // prefixo do preset entra AQUI, uma vez, em vez de o dono ter que saber
      // disso — sem ele o gateway responde "modelo desconhecido".
      // O prefixo segue o ENDEREÇO QUE VAI SER SALVO, não o preset que ficou
      // no estado da tela: no Codex mandamos endereço vazio, mas o preset
      // escolhido antes continuava aqui e reaplicava `openai/` a CADA save —
      // o dono trocava para Codex e o modelo voltava a nascer errado.
      const usaGateway = Boolean(String(body.llm_base_url ?? '').trim())
      const presetSel = usaGateway
        ? (cat?.endpoints ?? []).find((x) => x.url === endpointEscolhido)
        : undefined
      const prefixo = presetSel?.modelo_prefixo || ''
      if (prefixo) {
        for (const campo of ['llm_modelo_premium', 'llm_modelo_leve'] as const) {
          const valor = String(body[campo] ?? '')
          if (valor && !valor.includes('/')) body[campo] = prefixo + valor
        }
      }
      }
      await api.put(`/orgs/${orgId}/settings/llm`, body)
      window.dispatchEvent(new Event(EVENTO_SETTINGS_LLM_MUDOU))
      setNovaChave('')
      sucesso(novaChave.trim() ? t("Configurações salvas — a nova API key substituiu a anterior.", "Settings saved — the new API key replaced the previous one.") : t("Configurações salvas.", "Settings saved."))
      await carregar()
    } catch (err) {
      falha(err instanceof ApiError ? err.detail : t("Não foi possível salvar as configurações.", "Could not save settings."))
    } finally {
      setSalvando(false)
    }
  }

  async function testar() {
    setTestando(true)
    setResultadoTeste(null)
    setErro(null)
    try {
      const res = await api.post<{ ok: boolean; erro?: string }>(`/orgs/${orgId}/settings/llm/test`)
      setResultadoTeste(res)
      if (res.ok) sucesso((settings?.llm_provedor === "openai" ? t("Chave reconhecida e modelos acessíveis. Saldo e geração não foram verificados.", "Key recognized and models accessible. Credits and generation were not checked.") : t("Geração de teste concluída nos modelos configurados.", "Test generation completed with the configured models.")))
      else falha(t(`Falha na conexão: ${res.erro || t("chave inválida.", "invalid key.")}`, `Connection failed: ${res.erro || 'invalid key.'}`))
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : t("Falha ao testar a conexão.", "Connection test failed.")
      setResultadoTeste({ ok: false, erro: msg })
      falha(t(`Falha na conexão: ${msg}`, `Connection failed: ${msg}`))
    } finally {
      setTestando(false)
    }
  }

  if (settings?.gerenciado) return <MeuContrato orgId={orgId} />

  // Choosing the API at first use prepares a draft only. The existing save
  // handler applies it explicitly, preserving voice, usage limits and models.
  if (prepararApi) {
    const info = settings?.provedores?.find(p => p.chave === provedor)
    return <section className="cartao" aria-label={t('Conectar pela chave de API', 'Connect with an API key')}>
      <h2 className="secao-titulo">{t('Conectar pela chave de API', 'Connect with an API key')}</h2>
      <p className="texto-suave">{t('Ao salvar, a IA desta empresa passa a usar a API. O consumo será cobrado na sua conta do provedor.', 'Saving switches this company’s AI to the API. Usage will be billed to your provider account.')}</p>
      {erro && <p className="alerta alerta-erro" role="alert">{erro} <button type="button" className="botao-texto" onClick={carregar}>{t('Tentar novamente', 'Try again')}</button></p>}
      {!settings ? !erro && <p role="status">{t('Carregando conexão…', 'Loading connection…')}</p> : <form onSubmit={salvar}>
        <label className="campo"><span>{t('Provedor de IA', 'AI provider')}</span>
          <select value={provedor} onChange={e => {
            const novo = e.target.value
            setProvedor(novo)
            setModeloEscolhido('')
            setEndpointEscolhido((settings.provedores?.find(p => p.chave === novo)?.endpoints ?? [])[0]?.url || OUTRO_ENDPOINT)
            setBaseUrl('')
            setMotorCli(novo === 'openai' ? 'codex' : 'claude')
          }}>
            {(settings.provedores ?? []).map(p => <option key={p.chave} value={p.chave}>{p.nome}</option>)}
            {!info && <option value={provedor}>{provedor} {t('(configuração atual)', '(current setting)')}</option>}
          </select>
        </label>
        <label className="campo"><span>{t('Chave de API', 'API key')}</span>
          <input type="password" value={novaChave} onChange={e => setNovaChave(e.target.value)} autoComplete="off" placeholder={settings.anthropic_api_key_mascarada ? t('Chave já salva; cole outra para substituir', 'Key already saved; paste another to replace it') : t('Cole a chave do provedor escolhido', 'Paste the selected provider’s key')} />
        </label>
        <details style={{ marginBottom: '1rem' }}><summary>{t('Modelo e limite de uso', 'Model and usage limit')}</summary>
          {info && <label className="campo"><span>{t('Modelo', 'Model')}</span><select value={modeloEscolhido} onChange={e => setModeloEscolhido(e.target.value)}>
            <option value="">{t('Automático — escolher conforme a tarefa', 'Automatic — choose for each task')}</option>
            {info.modelos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
            {modeloEscolhido.startsWith('atual:') && <option value={modeloEscolhido}>{t('Manter configuração atual', 'Keep current settings')}</option>}
          </select></label>}
          <label className="campo"><span>{t('Limite mensal de tokens', 'Monthly token limit')}</span><input type="number" min={0} value={limiteTokens} onChange={e => setLimiteTokens(e.target.value)} placeholder={t('Sem limite', 'No limit')} /></label>
        </details>
        <button type="submit" className="botao botao-primario" disabled={salvando || (!novaChave.trim() && (!settings.anthropic_api_key_mascarada || provedor !== settings.llm_provedor))}>{salvando ? t('Salvando…', 'Saving…') : t('Salvar conexão', 'Save connection')}</button>
        <p className="texto-suave">{t('A chave fica protegida. Conectar não adiciona créditos à conta.', 'Your key is protected. Connecting does not add account credits.')}</p>
      </form>}
    </section>
  }

  return (
    <section className="cartao" id="motor-de-ia">
      <h2 className="secao-titulo">{t("Motor de IA", "AI engine")}</h2>
      <p className="texto-suave">
        {t("Chat e sabatina também usam a assinatura no app 0.2.9+ em modo local. No navegador, usam a chave de API. As tarefas podem usar essa chave na nuvem ou o login do CLI no computador, conforme o modo de execução. O consumo pela API é medido em tokens aqui e cobrado pelo provedor. A chave fica criptografada no servidor e nunca é exibida por inteiro.", "Chat and onboarding also use your subscription in app 0.2.9+ in local mode. In a browser, they use the API key. Tasks can use that key in the cloud or the CLI login on your computer, depending on execution mode. API usage is measured in tokens here and billed by the provider. The key is encrypted on the server and is never displayed in full.")}{' '}
        <strong>{t("A mesma chave vale para todos os escritórios da empresa.", "The same key works across all offices in the organization.")}</strong>
      </p>
      {erro && <p className="alerta alerta-erro" role="alert">{erro} <button type="button" className="botao-texto" onClick={carregar}>{t('Tentar novamente', 'Try again')}</button></p>}
      {settings === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-linha" />
          <div className="esqueleto esqueleto-linha" />
        </div>
      )}
      {settings !== null && (
        <form onSubmit={salvar}>
          {/* Na WEB não existe CLI: o modo CLI só aparece dentro do app
              desktop (onde o painel do motor mora). Exceção honesta: se a org
              JÁ está em CLI (trocada pelo app), a web mostra o estado real e
              permite voltar para API. */}
          {ehDesktop || motorModo === 'cli' ? (
            <label className="campo">
              <span>{t("Motor de execução", "Execution engine")}</span>
              <select value={motorModo} onChange={(e) => setMotorModo(e.target.value as 'api' | 'cli')}>
                <option value="api">{t("API do provedor (BYOK) — o consumo vai na conta da organização", "Provider API (BYOK) — billed to the organization")}</option>
                <option value="cli">{t("Motor local (CLI) — roda no computador de quem instalou o app Offiz Desktop", "Local engine (CLI) — runs on the computer with Offiz Desktop installed")}</option>
              </select>
            </label>
          ) : (
            <p className="texto-suave">
              {t("Motor de execução: ", "Execution engine: ")}<strong>{t("API do provedor (BYOK)", "Provider API (BYOK)")}</strong> {t("— o consumo vai na conta da organização.", "— billed to the organization.")}</p>
          )}
          {motorModo === 'cli' &&
            (provedor === 'anthropic' ? (
              <p className="alerta alerta-aviso" role="note">
                {t("As tarefas executadas no motor local usam o ", "Tasks executed by the local engine use the ")}<strong>{t("login do motor escolhido no app", "login of the engine selected in the app")}</strong>{' '}
                {t("e seguem os limites da conta conectada. A geração de imagens, vídeo ou voz usa as chaves de mídia configuradas; imagens OpenAI usam a chave OpenAI da empresa. Esse consumo é cobrado pelo provedor. ", "and follow the connected account’s limits. Image, video and voice generation uses configured media keys; OpenAI images use the company’s OpenAI key. This usage is billed by the provider. ")}<strong>{t("Chat e sabatina também usam a assinatura no app 0.2.9+ em modo local. No navegador, usam a chave de API.", "Chat and onboarding also use your subscription in app 0.2.9+ in local mode. In a browser, they use the API key.")}</strong>{' '}
                {t("Se o motor local estiver indisponível, a nuvem só pode assumir tarefas com uma chave configurada.", "If the local engine is unavailable, the cloud can only take over tasks when an API key is configured.")}</p>
            ) : (
              motorCli === 'codex' ? (
                // A VERDADE DO CODEX NO DESKTOP mudou em 29/08/2026: o app
                // EXECUTA o Codex (declara `motor_codex` e spawna o CLI), e o
                // backend deixou de mandar a chave da org para ele — roda no
                // `codex login` da máquina, como o Claude. A auditoria AI-09
                // mandava não prometer localidade errada; agora seria o
                // contrário: dizer "roda na nuvem" esconderia do dono que o
                // conteúdo dele é processado na própria máquina.
                <p className="alerta alerta-aviso" role="note">
                  {t("As tarefas executadas no motor local usam o ", "Tasks executed by the local engine use the ")}<strong>{t("login do motor escolhido no app", "login of the engine selected in the app")}</strong>{' '}
                  {t("e seguem os limites da conta conectada. A geração de imagens, vídeo ou voz usa as chaves de mídia configuradas; imagens OpenAI usam a chave OpenAI da empresa. Esse consumo é cobrado pelo provedor. ", "and follow the connected account’s limits. Image, video and voice generation uses configured media keys; OpenAI images use the company’s OpenAI key. This usage is billed by the provider. ")}<strong>{t("Chat e sabatina também usam a assinatura no app 0.2.9+ em modo local. No navegador, usam a chave de API.", "Chat and onboarding also use your subscription in app 0.2.9+ in local mode. In a browser, they use the API key.")}</strong>{' '}
                  {t("Se o motor local estiver indisponível, a nuvem só pode assumir tarefas com uma chave configurada.", "If the local engine is unavailable, the cloud can only take over tasks when an API key is configured.")}</p>
              ) : (
                <p className="alerta alerta-aviso" role="note">
                  {t("No motor local com", "The local engine with")}{' '}
                  <strong>
                    {(settings?.provedores ?? []).find((p) => p.chave === provedor)?.nome ?? provedor}
                  </strong>{' '}
                  {t("não existe login local: os trabalhos rodam no computador pareado", "does not support a local login: tasks run on the paired computer")}{' '}
                  <strong>{t("com a chave da organização", "using the organization’s key")}</strong>{t(", apontada para o endpoint configurado — o consumo vai na conta dela, como no modo API. Só motores pareados por dono ou administrador recebem a chave.", ", sent to the configured endpoint and billed to the organization, just like API mode. Only engines paired by an owner or administrator receive the key.")}</p>
              )
            ))}
          {/* ── PROVEDOR DE IA (17/08/2026, decisão do dono) ──────────
              Só Anthropic e OpenAI no seletor, e o MODELO escolhido num
              dropdown — não digitado. A primeira opção é o AUTOMÁTICO: o
              roteador escolhe o modelo conforme a tarefa (leve nas criativas
              e de rotina, o principal nas pesadas). A curadoria de ids vem do
              SERVIDOR (catálogo) — a tela nunca chumba nome de modelo. */}
          <label className="campo">
            <span>{t("Provedor de IA", "AI provider")}</span>
            <select
              value={provedor}
              onChange={(e) => {
                const novo = e.target.value
                setProvedor(novo)
                // O DEFAULT tem de ser um gateway que FUNCIONA. Sem isto, quem
                // troca para OpenAI cai em "Outro" com um campo de URL vazio —
                // exatamente a tela que fez o dono colar um e-mail ali. Já a
                // URL antiga não sobrevive à troca: ela pertencia ao provedor
                // anterior (o backend descarta, mas a tela mentiria mostrando).
                const info = (settings?.provedores ?? []).find((p) => p.chave === novo)
                setEndpointEscolhido((info?.endpoints ?? [])[0]?.url || OUTRO_ENDPOINT)
                setBaseUrl('')
                // OpenAI nasce no Codex (a chave dela vale direto); a
                // Anthropic só existe no Claude Code.
                setMotorCli(novo === 'openai' ? 'codex' : 'claude')
              }}
            >
              {(settings.provedores ?? []).map((p) => (
                <option key={p.chave} value={p.chave}>
                  {p.nome}
                </option>
              ))}
              {/* Org salva num provedor que saiu da tela (Moonshot etc.):
                  continua funcionando — aparece como o estado real, e o dono
                  pode migrar para um dos dois quando quiser. */}
              {settings.llm_provedor &&
                !(settings.provedores ?? []).some((p) => p.chave === settings.llm_provedor) && (
                  <option value={settings.llm_provedor}>
                    {settings.llm_provedor} {t("(configuração atual)", "(current setting)")}</option>
                )}
            </select>
          </label>
          {(() => {
            const info = (settings.provedores ?? []).find((p) => p.chave === provedor)
            if (!info) return null
            const trocouProvedor = provedor !== (settings.llm_provedor || 'anthropic')
            return (
              <>
                <p className="texto-suave" style={{ marginTop: '-0.4rem' }}>{info.ajuda}</p>
                {/* 26/08/2026 — decisão do dono: OpenAI é SEMPRE o Codex
                    direto (a chave de platform.openai.com, sem intermediário).
                    O seletor 'Como as tarefas rodam' saiu da tela; gateway
                    continua possível por org legada já gravada, só não é mais
                    oferecido. */}
                {info.exige_base_url && (
                  <p className="texto-suave" style={{ marginTop: '-0.4rem', fontSize: '0.8rem' }}>
                    {t("Nada para instalar nem endereço para preencher: cole a chave de platform.openai.com e pronto.", "No installation or endpoint needed: enter your platform.openai.com key.")}</p>
                )}
                <label className="campo">
                  <span>{t("Modelo", "Model")}</span>
                  <select
                    value={modeloEscolhido}
                    onChange={(e) => setModeloEscolhido(e.target.value)}
                  >
                    <option value="">
                      {t("Automático — eu escolho o modelo conforme a tarefa", "Automatic — I choose the model for each task")}</option>
                    {info.modelos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome} — {m.dica}
                      </option>
                    ))}
                    {/* O par gravado por uma versão antiga da tela (ids
                        digitados) não some: vira o estado atual, legível. */}
                    {modeloEscolhido.startsWith('atual:') && (
                      <option value={modeloEscolhido}>
                        {modeloGravado.premium} + {modeloGravado.leve} {t("(configuração atual)", "(current setting)")}</option>
                    )}
                  </select>
                </label>
                <label className="campo">
                  <span>{t("Leitura em voz alta das respostas", "Read responses aloud")}</span>
                  <select value={vozLeitura} onChange={(e) => setVozLeitura(e.target.value)}>
                    <option value="desligada">{t("Desligada — sem botão de ouvir (padrão)", "Off — no listen button (default)")}</option>
                    <option value="botao">{t("Botão de ouvir em cada resposta", "Listen button on each response")}</option>
                    <option value="sempre">{t("Sempre ler as respostas novas em voz alta", "Always read new responses aloud")}</option>
                  </select>
                  <span className="texto-suave" style={{ fontSize: '0.8rem' }}>
                    {t("A voz é a do navegador de quem ouve (grátis, local) — o servidor não gera áudio.", "Speech uses the listener’s browser voice (free, local); the server does not generate audio.")}</span>
                </label>
                <label className="campo">
                  <span>{t("Falar por microfone", "Speak using the microphone")}</span>
                  <select value={vozDitado} onChange={(e) => setVozDitado(e.target.value)}>
                    <option value="desligado">{t("Desligado — sem botão de falar (padrão)", "Off — no speak button (default)")}</option>
                    <option value="ligado">{t("Ligado — botão de falar no chat", "On — speak button in chat")}</option>
                  </select>
                  <span className="texto-suave" style={{ fontSize: '0.8rem' }}>
                    {t("O áudio vira texto no servidor (Whisper local, sem API paga) e cai no campo para revisar antes de mandar.", "Audio is transcribed on the server (local Whisper, no paid API), then placed in the input for you to review before sending.")}</span>
                </label>
                <p className="texto-suave" style={{ marginTop: '-0.5rem' }}>
                  {modeloEscolhido === '' ? (
                    <>
                      {t("No automático, as tarefas criativas e de rotina rodam no modelo", "In automatic mode, creative and routine tasks use the")}{' '}
                      <strong>{t("leve", "lightweight")}</strong> {t("e os trabalhos pesados no ", "model, while heavier work uses the ")}<strong>{t("principal", "primary model")}</strong> {t("— sem nada para configurar.", "— no setup needed.")}</>
                  ) : modeloEscolhido.startsWith('atual:') ? (
                    <>{t("É a configuração feita numa versão anterior desta tela — escolha uma opção da lista para trocar.", "This was configured in an earlier version of this screen. Choose an option from the list to change it.")}</>
                  ) : (
                    <>{t("Todos os trabalhos vão rodar neste modelo, do mais simples ao mais pesado.", "All tasks will use this model, from the simplest to the most demanding.")}</>
                  )}
                </p>
                {trocouProvedor && settings.anthropic_api_key_mascarada && (
                  <p className="alerta alerta-aviso" role="note">
                    {t("Trocar de provedor exige a chave ", "Switching providers requires a key ")}<strong>{t("daquele provedor", "from that provider")}</strong> {t("— digite-a no campo abaixo antes de salvar. A chave atual não é reaproveitada: ela seria enviada para o endereço novo.", "— enter it below before saving. The current key is not reused, because it would be sent to a different address.")}</p>
                )}
              </>
            )
          })()}

          <label className="campo">
            <span>{provedor === 'anthropic' ? t("API key da Anthropic", "Anthropic API key") : t("Chave de API do provedor", "Provider API key")}</span>
            <div className="campo-chave">
              <input
                type="password"
                value={novaChave}
                onChange={(e) => setNovaChave(e.target.value)}
                placeholder={
                  settings.anthropic_api_key_mascarada
                    ? t(`Configurada: ${settings.anthropic_api_key_mascarada} — digite para substituir`, `Configured: ${settings.anthropic_api_key_mascarada} — enter a value to replace it`)
                    : t("sk-ant-… (nenhuma chave configurada)", "Enter your provider’s API key (none configured)")
                }
                autoComplete="off"
              />
              <button type="button" className="botao botao-fantasma" onClick={testar} aria-describedby={`teste-conexao-custo-${orgId}`} disabled={testando || !settings.anthropic_api_key_mascarada}>
                {testando ? t("Testando…", "Testing…") : t("Testar conexão", "Test connection")}
              </button>
            </div>
          </label>
          <p id={`teste-conexao-custo-${orgId}`} className="texto-suave">{settings.llm_provedor === 'anthropic' ? t('Este teste gera uma resposta nos modelos salvos e pode consumir crédito na sua conta Anthropic.', 'This test generates a response with your saved models and may use credit in your Anthropic account.') : t('Este teste consulta a chave e os modelos salvos. Não gera conteúdo nem verifica o saldo do fornecedor.', 'This test checks your saved key and models. It does not generate content or check the provider’s balance.')}</p>
          {resultadoTeste && (
            <p className={resultadoTeste.ok ? 'alerta alerta-ok' : 'alerta alerta-erro'}>
              {resultadoTeste.ok ? (settings?.llm_provedor === "openai" ? t("Chave reconhecida e modelos acessíveis. Saldo e geração não foram verificados.", "Key recognized and models accessible. Credits and generation were not checked.") : t("Geração de teste concluída nos modelos configurados.", "Test generation completed with the configured models.")) : t(`Falha na conexão: ${resultadoTeste.erro || t("chave inválida.", "invalid key.")}`, `Connection failed: ${resultadoTeste.erro || 'invalid key.'}`)}
            </p>
          )}
          <label className="campo">
            <span>{t("Limite de tokens por mês — organização inteira (todos os usuários)", "Monthly token limit — entire organization (all users)")}</span>
            <input
              type="number"
              min={0}
              step={10000}
              value={limiteTokens}
              onChange={(e) => setLimiteTokens(e.target.value)}
              placeholder={t("ilimitado", "unlimited")}
            />
          </label>
          <button type="submit" className="botao botao-primario" disabled={salvando}>
            {salvando ? t("Salvando…", "Saving…") : t("Salvar configurações", "Save settings")}
          </button>
        </form>
      )}
    </section>
  )
}

function SecaoUso({ orgId }: { orgId: number }) {
  const { t, idioma } = useIdioma()
  const [periodo, setPeriodo] = useState<'hoje' | 'semana' | 'mes'>('mes')
  const [uso, setUso] = useState<UsoResumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // O TETO mensal de tokens: é ele que transforma o número em controle.
  // Buscado aqui (e não recebido por prop) porque o painel de configuração é
  // irmão deste, não pai — e um teto desatualizado seria pior que nenhum.
  const [limiteTokensMes, setLimiteTokensMes] = useState<number | null>(null)

  useEffect(() => {
    let ativo = true
    api
      .get<LlmSettings>(`/orgs/${orgId}/settings/llm`)
      .then((s) => ativo && setLimiteTokensMes(s.limite_tokens_mes ?? null))
      .catch(() => {
        /* sem o teto o painel mostra os números e explica que não há freio */
      })
    return () => {
      ativo = false
    }
  }, [orgId])

  useEffect(() => {
    let ativo = true
    setUso(null)
    api
      .get<UsoResumo>(`/orgs/${orgId}/uso?periodo=${periodo}`)
      .then((d) => {
        if (ativo) {
          setUso(d)
          setErro(null)
        }
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof ApiError ? e.detail : t("Não foi possível carregar o resumo de uso.", "Could not load usage summary."))
      })
    return () => {
      ativo = false
    }
  }, [orgId, periodo])

  /* CONTROLE POR TOKEN, não por dinheiro (16/08/2026, decisão do dono).
   *
   * O painel inteiro era orientado a valor: "custo estimado" em destaque,
   * colunas de custo por escritório e por membro, e uma tabela de preços por
   * MTok convertida em reais. Três problemas: o número em reais é ESTIMADO
   * (cotação de dólar chutada) e parecia fatura; a tabela de preços só valia
   * para a Anthropic — numa org apontada para outro provedor ela mentia; e
   * "quanto gastei" não é a pergunta que esta tela responde. A pergunta é
   * "quanto do meu teto eu já usei". Token é a unidade que o produto MEDE de
   * verdade e a única que vale em qualquer provedor. */
  // `?? 0`: os campos são opcionais no payload — período sem tarefa nenhuma
  // devolve o resumo sem eles, e NaN no lugar do total quebraria a barra.
  const totalTokens = uso ? (uso.tokens_entrada ?? 0) + (uso.tokens_saida ?? 0) : 0
  const teto = typeof limiteTokensMes === 'number' && limiteTokensMes > 0 ? limiteTokensMes : null
  const pctTeto = teto ? Math.min(100, Math.round((totalTokens / teto) * 100)) : null

  return (
    <section className="cartao">
      <div className="secao-cabecalho">
        <h2 className="secao-titulo">{t("Uso de IA", "AI usage")}</h2>
        <div className="seletor-esforco" role="radiogroup" aria-label={t("Período", "Period")}>
          {(
            [
              ['hoje', t("Hoje", "Today")],
              ['semana', t("Semana", "Week")],
              ['mes', t("Mês", "Month")],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={periodo === valor}
              className={periodo === valor ? 'esforco-opcao ativa' : 'esforco-opcao'}
              onClick={() => setPeriodo(valor)}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>
      {erro && <p className="alerta alerta-erro">{erro}</p>}
      {uso === null && !erro && (
        <div className="uso-cards" aria-hidden="true">
          <div className="esqueleto esqueleto-card" />
          <div className="esqueleto esqueleto-card" />
          <div className="esqueleto esqueleto-card" />
        </div>
      )}
      {uso !== null && (
        <>
          <div className="uso-cards">
            <div className="uso-card destaque">
              <span className="uso-valor">{formatTokens(totalTokens, idioma)}</span>
              <span className="uso-rotulo">{t("tokens no período", "tokens in this period")}</span>
            </div>
            <div className="uso-card">
              <span className="uso-valor">{formatTokens(uso.tokens_entrada, idioma)}</span>
              <span className="uso-rotulo">{t("de entrada", "input")}</span>
            </div>
            <div className="uso-card">
              <span className="uso-valor">{formatTokens(uso.tokens_saida, idioma)}</span>
              <span className="uso-rotulo">{t("de saída", "output")}</span>
            </div>
            {typeof uso.execucoes === 'number' && (
              <div className="uso-card">
                <span className="uso-valor">{uso.execucoes}</span>
                <span className="uso-rotulo">{t("tarefas", "tasks")}</span>
              </div>
            )}
          </div>

          {/* O TETO: é ele que transforma o número em CONTROLE. Sem teto
              definido, a tela diz isso em vez de mostrar barra vazia. */}
          {periodo === 'mes' && (
            <div className="uso-teto">
              {teto ? (
                <>
                  <div className="uso-teto-topo">
                    <strong>
                      {formatTokens(totalTokens, idioma)} {t("de ", "of ")}{formatTokens(teto, idioma)} {t("tokens do teto mensal", "tokens in the monthly limit")}</strong>
                    <span className={pctTeto! >= 90 ? 'uso-teto-pct alerta-alto' : 'uso-teto-pct'}>
                      {pctTeto}%
                    </span>
                  </div>
                  <div className="barra">
                    <i
                      style={{ width: `${pctTeto}%` }}
                      className={pctTeto! >= 90 ? 'cheio' : undefined}
                    />
                  </div>
                  <p className="texto-suave" style={{ margin: '6px 0 0' }}>
                    {pctTeto! >= 100
                      ? t("O teto do mês foi atingido — novas tarefas ficam bloqueadas até o mês virar ou o teto subir.", "The monthly limit has been reached. New tasks are blocked until next month or until the limit is raised.")
                      : t("Ao bater o teto, o escritório para de aceitar tarefas novas até o mês virar. O trabalho em andamento termina.", "When the limit is reached, the office stops accepting new tasks until next month. Work already in progress will finish.")}
                  </p>
                </>
              ) : (
                <p className="texto-suave" style={{ margin: 0 }}>
                  <strong>{t("Sem teto definido.", "No limit set.")}</strong> {t("Você pode limitar quantos tokens esta organização consome por mês no campo ", "You can limit the organization’s monthly token usage in the ")}<em>{t("Limite de tokens", "Token limit")}</em> {t("acima — é o freio que impede uma tarefa em loop de consumir a chave inteira.", "field above, preventing a looping task from consuming the entire allowance.")}</p>
              )}
            </div>
          )}

          {uso.por_office && uso.por_office.length > 0 && (
            <div className="tabela-scroll">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>{t("Escritório", "Office")}</th>
                    <th>{t("Entrada", "Input")}</th>
                    <th>{t("Saída", "Output")}</th>
                    <th>{t("Total", "Total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {uso.por_office.map((o, i) => (
                    <tr key={i}>
                      <td>{o.office_slug}</td>
                      <td>{formatTokens(o.tokens_entrada, idioma)}</td>
                      <td>{formatTokens(o.tokens_saida, idioma)}</td>
                      <td>{formatTokens((o.tokens_entrada ?? 0) + (o.tokens_saida ?? 0), idioma)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {uso.por_membro && uso.por_membro.length > 0 && (
            <div className="tabela-scroll">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>{t("Membro", "Member")}</th>
                    <th>{t("Entrada", "Input")}</th>
                    <th>{t("Saída", "Output")}</th>
                    <th>{t("Total", "Total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {uso.por_membro.map((m, i) => (
                    <tr key={i}>
                      <td>{m.nome || m.email || (m.usuario_id ? t(`Usuário #${m.usuario_id}`, `User #${m.usuario_id}`) : t("Ex-membro / usuário removido", "Former member / removed user"))}</td>
                      <td>{formatTokens(m.tokens_entrada, idioma)}</td>
                      <td>{formatTokens(m.tokens_saida, idioma)}</td>
                      <td>{formatTokens((m.tokens_entrada ?? 0) + (m.tokens_saida ?? 0), idioma)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="texto-suave" style={{ marginTop: '0.8rem' }}>
            {t("A conta de consumo é do provedor de IA da organização — o Offiz mede os tokens e respeita o teto, mas não fatura nada.", "AI usage is billed by the organization’s provider. Offiz measures tokens and respects the limit, but does not bill this usage.")}</p>
        </>
      )}
    </section>
  )
}

/** Storage S3 próprio da org (Fase 7, BYOS). No GET os segredos (access/
 *  secret key) vêm MASCARADOS — nunca por inteiro. */
interface StorageS3Info {
  configurado?: boolean
  s3_endpoint?: string | null
  s3_bucket?: string | null
  s3_access_key?: string | null
  s3_secret_key?: string | null
}

interface DbStatus {
  configurado: boolean
  database_ok: boolean
  database_validado_em: string | null
  database_erro: string | null
  schema_inicializado_em: string | null
  /** Esta organização pode usar o banco CENTRAL do Offiz? Quando é `false`, o
   *  banco próprio deixa de ser escolha e passa a ser condição de
   *  funcionamento — e o texto da tela muda com ela. */
  pode_usar_banco_central?: boolean
  /** Sub-config de storage S3 — o backend pode mandar aninhada… */
  storage?: StorageS3Info | null
  /** …ou achatada no próprio status (tolerância de contrato). */
  s3_endpoint?: string | null
  s3_bucket?: string | null
  s3_access_key?: string | null
  s3_secret_key?: string | null
}

/** Normaliza a config de storage do GET (aninhada ou achatada). */
function storageDoStatus(s: DbStatus | null): StorageS3Info {
  if (!s) return {}
  if (s.storage) return s.storage
  return {
    s3_endpoint: s.s3_endpoint,
    s3_bucket: s.s3_bucket,
    s3_access_key: s.s3_access_key,
    s3_secret_key: s.s3_secret_key,
  }
}

function SecaoDatabase({ orgId }: { orgId: number }) {
  const { confirmar, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}`)

  const { t } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [status, setStatus] = useState<DbStatus | null>(null)
  const [url, setUrl] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Storage S3 (opcional) — segredos nunca são reexibidos; endpoint/bucket
  // voltam do GET e preenchem o formulário.
  const [s3Endpoint, setS3Endpoint] = useState('')
  const [s3Bucket, setS3Bucket] = useState('')
  const [s3AccessKey, setS3AccessKey] = useState('')
  const [s3SecretKey, setS3SecretKey] = useState('')
  const [resultadoStorage, setResultadoStorage] = useState<{ ok: boolean; erro?: string } | null>(null)

  const carregar = useCallback(async () => {
    try {
      const s = await api.get<DbStatus>(`/orgs/${orgId}/database`)
      setStatus(s)
      const st = storageDoStatus(s)
      setS3Endpoint(st.s3_endpoint ?? '')
      setS3Bucket(st.s3_bucket ?? '')
      setErro(null)
    } catch (e) {
      setErro(e instanceof ApiError ? e.detail : t("Não foi possível carregar a configuração de banco.", "Could not load database settings."))
    }
  }, [orgId])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function salvar() {
    if (!url.trim()) {
      falha(t("Cole a string de conexão do banco antes de salvar.", "Enter the database connection string before saving."))
      return
    }
    setOcupado(true)
    try {
      await api.put(`/orgs/${orgId}/database`, { database_url: url.trim() })
      setUrl('')
      sucesso(t("Banco salvo — teste a conexão a seguir.", "Database saved — test the connection next."))
      await carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível salvar o banco.", "Could not save the database."))
    } finally {
      setOcupado(false)
    }
  }

  async function testar() {
    setOcupado(true)
    try {
      const r = await api.post<{ ok: boolean; erro?: string }>(`/orgs/${orgId}/database/test`)
      if (r.ok) sucesso(t("Conexão com o banco funcionando.", "Database connection is working."))
      else falha(t(`Falha na conexão: ${r.erro || t("verifique a string.", "check the connection string.")}`, `Connection failed: ${r.erro || 'check the connection string.'}`))
      await carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Falha ao testar o banco.", "Database test failed."))
    } finally {
      setOcupado(false)
    }
  }

  async function initSchema() {
    setOcupado(true)
    try {
      await api.post(`/orgs/${orgId}/database/init-schema`)
      sucesso(t("Schema criado no banco do cliente.", "Schema created in the client’s database."))
      await carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível criar o schema.", "Could not create the schema."))
    } finally {
      setOcupado(false)
    }
  }

  async function remover() {
    if (!await confirmar({ titulo: t("Remover conexão do banco", "Remove database connection"), mensagem: t("Remover o banco próprio? A organização volta a usar o banco padrão do Offiz.", "Remove the dedicated database? This organization will use Offiz’s default database again."), acao: t("Remover conexão", "Remove connection") })) return
    setOcupado(true)
    try {
      await api.del(`/orgs/${orgId}/database`)
      sucesso(t("Banco removido — usando o banco padrão.", "Database removed — using the default database."))
      await carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível remover o banco.", "Could not remove the database."))
    } finally {
      setOcupado(false)
    }
  }

  async function salvarStorage() {
    if (!s3Endpoint.trim() || !s3Bucket.trim() || !s3AccessKey.trim() || !s3SecretKey.trim()) {
      falha(t("Preencha endpoint, bucket, access key e secret key para salvar o storage.", "Enter the endpoint, bucket, access key, and secret key to save storage settings."))
      return
    }
    setOcupado(true)
    setResultadoStorage(null)
    try {
      await api.put(`/orgs/${orgId}/database/storage`, {
        s3_endpoint: s3Endpoint.trim(),
        s3_bucket: s3Bucket.trim(),
        s3_access_key: s3AccessKey.trim(),
        s3_secret_key: s3SecretKey.trim(),
      })
      setS3AccessKey('')
      setS3SecretKey('')
      sucesso(t("Storage S3 salvo — teste a conexão a seguir.", "S3 storage saved — test the connection next."))
      await carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível salvar o storage S3.", "Could not save S3 storage."))
    } finally {
      setOcupado(false)
    }
  }

  async function testarStorage() {
    setOcupado(true)
    setResultadoStorage(null)
    try {
      const r = await api.post<{ ok: boolean; erro?: string }>(`/orgs/${orgId}/database/test-storage`)
      setResultadoStorage(r)
      if (r.ok) sucesso(t("Conexão com o storage S3 funcionando.", "S3 storage connection is working."))
      else falha(t(`Falha no storage: ${r.erro || t("verifique endpoint, bucket e chaves.", "check the endpoint, bucket, and keys.")}`, `Storage failed: ${r.erro || 'check the endpoint, bucket, and keys.'}`))
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail : t("Falha ao testar o storage S3.", "S3 storage test failed.")
      setResultadoStorage({ ok: false, erro: msg })
      falha(msg)
    } finally {
      setOcupado(false)
    }
  }

  // `undefined` (backend antigo) vale como "pode usar o central" — o padrão
  // histórico. Só a negativa EXPLÍCITA muda o discurso da tela.
  const exigeBancoProprio = status?.pode_usar_banco_central === false
  const storage = storageDoStatus(status)
  const storageConfigurado = Boolean(
    storage.configurado || storage.s3_bucket || storage.s3_access_key,
  )

  return <>{dialogo}{(
    <section className="cartao">
      <h2 className="secao-titulo">{t("Banco de dados (BYOD)", "Database (BYOD)")}</h2>
      {/* O MESMO texto não serve para os dois casos. Para quem tem residência
          no contrato (sem autorização de banco central), chamar isto de
          "opcional" é a pior frase possível: sem o banco ligado o prédio não
          trabalha. Então a tela lê a autorização e fala de acordo. */}
      {exigeBancoProprio ? (
        <>
          <p className="alerta alerta-aviso">
            <strong>{t("Esta organização não usa o banco central do Offiz.", "This organization does not use Offiz’s central database.")}</strong> {t("O banco próprio não é opcional aqui: enquanto ele não estiver configurado e com a conexão testada, o escritório não executa tarefas.", "A dedicated database is required here. Tasks cannot run until it is configured and the connection has been tested.")}</p>
          <p className="texto-suave">
            {t("Aponte o seu PostgreSQL abaixo. Com a conexão ", "Enter your PostgreSQL connection below. Once the connection is ")}<strong>{t("testada", "tested")}</strong>{t(", os documentos dos seus clientes e a ", ", your clients’ documents and the ")}<strong>{t("chave de IA", "AI key")}</strong> {t("passam a ser gravados", "will be stored")}{' '}
            <strong>{t("no seu banco", "in your database")}</strong> {t("— nunca no armazenamento do Offiz (LGPD). A string de conexão fica criptografada e nunca é exibida.", "— never in Offiz storage (LGPD). The connection string is encrypted and never displayed.")}</p>
        </>
      ) : (
        <>
          <p className="texto-suave">
            {t("Com o banco próprio configurado e testado, os ", "With your own database configured and tested, the ")}<strong>{t("arquivos dos documentos", "document files")}</strong> {t("e a ", "and ")}<strong>{t("chave de IA", "AI key")}</strong> {t("desta organização moram no seu banco.", "for this organization are stored in your database.")}</p>
          <p className="texto-suave">
            {t("Opcional: aponte um banco PostgreSQL próprio da organização. Com a conexão", "Optional: connect the organization’s own PostgreSQL database. Once the connection is")}{' '}
            <strong>{t("testada", "tested")}</strong>{t(", os documentos dos seus clientes passam a ser gravados", ", your clients’ documents will be stored")}{' '}
            <strong>{t("no seu banco", "in your database")}</strong> {t("— nunca no armazenamento do Offiz (LGPD). A string de conexão fica criptografada e nunca é exibida. Sem ele, tudo fica no armazenamento do Offiz, que é o padrão.", "— never in Offiz storage (LGPD). The connection string is encrypted and never displayed. Without it, Offiz storage is used by default.")}</p>
        </>
      )}
      {erro && <p className="alerta alerta-erro">{erro}</p>}
      {status && (
        <>
          <div className="seletor-esforco" style={{ marginBottom: '0.6rem' }} aria-label={t("Status do banco", "Database status")}>
            <span className={`status-pill ${status.configurado ? 'status-done' : 'status-queued'}`}>
              {status.configurado ? t("Configurado", "Configured") : t("Padrão do Offiz", "Offiz default")}
            </span>
            {status.configurado && (
              <span className={`status-pill ${status.database_ok ? 'status-done' : 'status-error'}`}>
                {status.database_ok ? t("✓ Conexão OK", "✓ Connection OK") : t("Não testado", "Not tested")}
              </span>
            )}
            {status.schema_inicializado_em && <span className="status-pill status-done">{t("✓ Schema criado", "✓ Schema created")}</span>}
          </div>
          {status.database_erro && <p className="alerta alerta-erro">{status.database_erro}</p>}
          <label className="campo">
            <span>{t("String de conexão", "Connection string")}</span>
            <input
              type="password"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={status.configurado ? t("Configurada — digite para substituir", "Configured — enter a value to replace it") : 'postgresql://user:senha@host:5432/banco'}
              autoComplete="off"
            />
          </label>
          <div className="linha-form" style={{ margin: 0, flexWrap: 'wrap' }}>
            <button type="button" className="botao botao-primario" onClick={salvar} disabled={ocupado}>
              {t("Salvar banco", "Save database")}</button>
            <button type="button" className="botao botao-fantasma" onClick={testar} disabled={ocupado || !status.configurado}>
              {t("Testar conexão", "Test connection")}</button>
            <button type="button" className="botao botao-fantasma" onClick={initSchema} disabled={ocupado || !status.database_ok}>
              {t("Inicializar schema", "Initialize schema")}</button>
            {status.configurado && (
              <button type="button" className="botao-texto perigo" onClick={remover} disabled={ocupado}>
                {t("Remover", "Remove")}</button>
            )}
          </div>

          <div className="byos-bloco">
            <div className="byos-cabecalho">
              <h3 className="secao-titulo secao-subtitulo">{t("Storage S3", "S3 storage")}</h3>
              <span className={`status-pill ${storageConfigurado ? 'status-done' : 'status-queued'}`}>
                {storageConfigurado ? t("Configurado", "Configured") : t("Padrão do Offiz", "Offiz default")}
              </span>
            </div>
            <p className="texto-suave">
              {t("Aponte um bucket S3 próprio (AWS, MinIO, Backblaze…) para os ", "Connect your own S3 bucket (AWS, MinIO, Backblaze…) to keep your clients’ ")}<strong>{t("arquivos", "files")}</strong> {t("dos seus clientes ficarem no seu storage — complemento do banco próprio acima. As chaves ficam criptografadas e nunca são reexibidas.", "in your storage, complementing the database above. Keys are encrypted and never displayed again.")}</p>
            {/* Deixou de ser "opcional" sem ressalva quando o acervo passou a
                morar no cliente: o metadado vai para o banco dele, mas foto e
                vídeo precisam de bucket. Sem isso, o dono liga só o banco,
                acredita que o acervo foi com ele, e ele continua aqui. */}
            <p className="texto-suave">
              {t("O banco sozinho leva ", "The database alone stores ")}<strong>{t("entregas e documentos", "deliverables and documents")}</strong>{t(". O", ". The")}{' '}
              <strong>{t("acervo da marca", "brand asset library")}</strong> {t("(fotos, vídeos, vozes, brasão) só vai para a sua infraestrutura com ", "(photos, videos, voices, and logo) only moves to your infrastructure when both the ")}<strong>{t("banco e bucket", "database and bucket")}</strong> {t("configurados — vídeo guardado dentro do Postgres incharia o backup e deixaria o seu banco lento.", "are configured. Storing video inside PostgreSQL would enlarge backups and slow down the database.")}</p>
            <div className="linha-campos byos-campos">
              <label className="campo">
                <span>Endpoint</span>
                <input
                  type="text"
                  value={s3Endpoint}
                  onChange={(e) => setS3Endpoint(e.target.value)}
                  placeholder="https://s3.amazonaws.com"
                  autoComplete="off"
                />
              </label>
              <label className="campo">
                <span>Bucket</span>
                <input
                  type="text"
                  value={s3Bucket}
                  onChange={(e) => setS3Bucket(e.target.value)}
                  placeholder={t("meu-escritorio-docs", "my-office-documents")}
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="linha-campos byos-campos">
              <label className="campo">
                <span>Access key</span>
                <input
                  type="password"
                  value={s3AccessKey}
                  onChange={(e) => setS3AccessKey(e.target.value)}
                  placeholder={
                    storage.s3_access_key
                      ? t(`Configurada: ${storage.s3_access_key} — digite para substituir`, `Configured: ${storage.s3_access_key} — enter a value to replace it`)
                      : 'AKIA…'
                  }
                  autoComplete="off"
                />
              </label>
              <label className="campo">
                <span>Secret key</span>
                <input
                  type="password"
                  value={s3SecretKey}
                  onChange={(e) => setS3SecretKey(e.target.value)}
                  placeholder={
                    storage.s3_secret_key
                      ? t(`Configurada: ${storage.s3_secret_key} — digite para substituir`, `Configured: ${storage.s3_secret_key} — enter a value to replace it`)
                      : t("segredo do bucket", "bucket secret")
                  }
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="linha-form byos-acoes">
              <button type="button" className="botao botao-primario" onClick={salvarStorage} disabled={ocupado}>
                {t("Salvar storage", "Save storage")}</button>
              <button
                type="button"
                className="botao botao-fantasma"
                onClick={testarStorage}
                disabled={ocupado || !storageConfigurado}
                title={storageConfigurado ? undefined : t("Salve o storage primeiro", "Save storage first")}
              >
                {t("Testar storage", "Test storage")}</button>
            </div>
            {resultadoStorage && (
              <p className={resultadoStorage.ok ? 'alerta alerta-ok' : 'alerta alerta-erro'}>
                {resultadoStorage.ok
                  ? t("Conexão com o storage S3 funcionando.", "S3 storage connection is working.")
                  : t(`Falha no storage: ${resultadoStorage.erro || t("verifique endpoint, bucket e chaves.", "check the endpoint, bucket, and keys.")}`, `Storage failed: ${resultadoStorage.erro || 'check the endpoint, bucket, and keys.'}`)}
              </p>
            )}
          </div>
        </>
      )}
      <BlocoMigracao orgId={orgId} />
    </section>
  )}</>
}

/** O que sairia do disco do Offiz para a infra da org (GET .../database/migracao). */
interface InventarioMigracao {
  pronto: { byod: boolean; byos: boolean }
  pode_migrar: Record<string, boolean>
  por_categoria: Record<string, { arquivos: number; bytes: number }>
  total_arquivos: number
  total_bytes: number
  linhas_sem_arquivo: number
  fora_do_escopo: string[]
}

interface ResultadoLote {
  movidos: number
  movidos_por_categoria?: Record<string, number>
  falhas: { categoria: string; arquivo: string; motivo: string }[]
  restante: number | null
  restante_bytes?: number
  erro?: string
}

const ROTULO_CATEGORIA: Record<string, string> = {
  entregas: 'Entregas',
  documentos_clientes: 'Documentos de clientes',
  documentos_casos: 'Documentos de casos',
  acervo: 'Acervo da marca (fotos, vídeos, vozes, brasão)',
}
const CATEGORIA_INGLES: Record<string, string> = {
  entregas: 'Deliverables', documentos_clientes: 'Client documents',
  documentos_casos: 'Case documents', acervo: 'Brand assets (photos, videos, voices, and logo)',
}

/**
 * MIGRAÇÃO RETROATIVA: leva para a infra da org o que já está no disco do Offiz.
 *
 * Configurar o banco/storage só muda o que entra dali pra frente — o passado
 * fica aqui, e o cliente que contratou residência de dados não a recebe do que
 * já existe. Esta é a única porta que move o passado.
 *
 * A tela mostra o ORÇAMENTO antes de qualquer coisa (quantos arquivos, quantos
 * bytes, e o que NÃO entra), porque migração que promete tudo e move metade faz
 * o cliente acreditar que está com o dado dele. O botão chama o backend em
 * LOTES até `restante` chegar a zero, com um "parar" à mão: um cliente com
 * gigabytes de vídeo não cabe numa requisição.
 */
function BlocoMigracao({ orgId }: { orgId: number }) {
  const { confirmar, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}`)

  const { t, idioma } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [inv, setInv] = useState<InventarioMigracao | null>(null)
  const [rodando, setRodando] = useState(false)
  const [pararPedido, setPararPedido] = useState(false)
  const [movidos, setMovidos] = useState(0)
  const [falhas, setFalhas] = useState<ResultadoLote['falhas']>([])
  const [erro, setErro] = useState<string | null>(null)
  // 403 = membro comum ou owner: o inventário ele vê, o gatilho é do admin
  // global (a operação APAGA a cópia local). Esconde o botão em vez de deixar
  // o clique falhar.
  const [podeDisparar, setPodeDisparar] = useState(true)

  const carregar = useCallback(async () => {
    try {
      setInv(await api.get<InventarioMigracao>(`/orgs/${orgId}/database/migracao`))
      setErro(null)
    } catch (e) {
      setErro(e instanceof ApiError ? e.detail : t("Não foi possível ler o inventário.", "Could not read the inventory."))
    }
  }, [orgId])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function migrar() {
    if (!inv) return
    const total = inv.total_arquivos
    if (
      !await confirmar({ titulo: t("Mover arquivos da empresa", "Move company files"), mensagem: t(`Mover ${total} arquivo(s) para a infraestrutura desta organização?\n\n`, `Move ${total} file(s) to this organization’s infrastructure?

`) +
          t("Cada arquivo é enviado, CONFERIDO no destino e só então apagado do ", "Each file is uploaded and VERIFIED at the destination before being deleted from ") +
          t("disco do Offiz. Se o destino não confirmar, o arquivo fica aqui.", "Offiz’s disk. If the destination does not confirm receipt, the file stays here."), acao: t("Mover arquivos", "Move files") })
    )
      return
    setRodando(true)
    setPararPedido(false)
    setMovidos(0)
    setFalhas([])
    let movidosTotal = 0
    let parar = false
    try {
      // Loop de lotes: o estado vive na coluna `storage` de cada linha, então
      // parar no meio (ou fechar a aba) não deixa nada pela metade — a próxima
      // chamada continua de onde ficou.
      for (let volta = 0; volta < 500 && !parar; volta++) {
        const r = await api.post<ResultadoLote>(`/orgs/${orgId}/database/migracao`)
        if (r.erro) {
          falha(r.erro)
          break
        }
        movidosTotal += r.movidos
        setMovidos(movidosTotal)
        if (r.falhas?.length) setFalhas((antes) => [...antes, ...r.falhas])
        // Nada movido e nada falhou = não há mais o que fazer (ou o que resta
        // não tem destino pronto). Sair evita laço infinito.
        if (!r.movidos && !r.falhas?.length) break
        if (!r.restante) break
        parar = pararPedido
      }
      await carregar()
      if (movidosTotal) sucesso(t(`${movidosTotal} arquivo(s) agora vivem na infraestrutura da organização.`, `${movidosTotal} file(s) are now stored in the organization’s infrastructure.`))
      else if (!falhas.length) sucesso(t("Nada a migrar — tudo já está no lugar.", "Nothing to migrate — everything is already in place."))
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setPodeDisparar(false)
        falha(t("Só o administrador global pode disparar a migração.", "Only a global administrator can start migration."))
      } else {
        falha(e instanceof ApiError ? e.detail : t("A migração falhou.", "Migration failed."))
      }
    } finally {
      setRodando(false)
    }
  }

  if (erro) return <p className="alerta alerta-erro">{erro}</p>
  if (!inv) return null

  const semDestino = !inv.pronto.byod && !inv.pronto.byos
  const nada = inv.total_arquivos === 0

  return <>{dialogo}{(
    <div style={{ marginTop: '1.6rem', borderTop: '1px solid var(--borda)', paddingTop: '1.2rem' }}>
      <strong>{t("Levar o que já existe para a sua infraestrutura", "Move existing data to your infrastructure")}</strong>
      <p className="texto-suave" style={{ margin: '0.25rem 0 0.8rem' }}>
        {t("Configurar o banco e o storage vale para o que entra ", "Database and storage settings apply to data added ")}<em>{t("a partir de agora", "from now on")}</em>{t(". O que já está no disco do Offiz só sai daqui por esta porta.", ". Files already on Offiz’s disk only move through this process.")}</p>

      {semDestino ? (
        <p className="alerta">
          {t("Configure o banco (e o storage, se quiser) e clique em ", "Configure your database (and storage, if needed), then click ")}<strong>{t("Testar", "Test")}</strong> {t("antes de migrar — sem o teste, o Offiz continua gravando no armazenamento dele.", "before migrating. Without a successful test, Offiz continues using its own storage.")}</p>
      ) : nada ? (
        <p className="texto-suave">
          {t("Nada a migrar: nenhum arquivo desta organização está no disco do Offiz.", "Nothing to migrate: this organization has no files on Offiz’s disk.")}{inv.linhas_sem_arquivo > 0 &&
            t(` (${inv.linhas_sem_arquivo} registro(s) apontam para arquivo que já não existe.)`, ` (${inv.linhas_sem_arquivo} record(s) point to files that no longer exist.)`)}
        </p>
      ) : (
        <>
          <div className="tabela-scroll">
            <table className="tabela">
              <thead>
                <tr>
                  <th>{t("O que sai", "What moves")}</th>
                  <th>{t("Arquivos", "Files")}</th>
                  <th>{t("Tamanho", "Size")}</th>
                  <th>{t("Destino pronto?", "Destination ready?")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(inv.por_categoria).map(([cat, d]) => (
                  <tr key={cat}>
                    <td>{t(ROTULO_CATEGORIA[cat] ?? cat, CATEGORIA_INGLES[cat] ?? cat)}</td>
                    <td>{d.arquivos}</td>
                    <td>{formatBytes(d.bytes, idioma)}</td>
                    <td>
                      {inv.pode_migrar[cat] ? (
                        'sim'
                      ) : (
                        <span className="texto-suave">
                          {cat === 'acervo'
                            ? t("falta o banco e o storage", "database and storage are missing")
                            : cat === 'entregas'
                              ? t("falta o storage S3", "S3 storage is missing")
                              : t("falta o banco", "database is missing")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>{t("Total", "Total")}</strong>
                  </td>
                  <td>
                    <strong>{inv.total_arquivos}</strong>
                  </td>
                  <td>
                    <strong>{formatBytes(inv.total_bytes, idioma)}</strong>
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Dizer o que NÃO vai é parte do contrato desta tela. */}
          <p className="texto-suave" style={{ marginTop: '0.7rem' }}>
            <strong>{t("O que NÃO vai nesta migração:", "This migration does NOT include:")}</strong>
          </p>
          <ul className="texto-suave" style={{ margin: '0.2rem 0 0.9rem 1.1rem' }}>
            {inv.fora_do_escopo.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>

          {podeDisparar && (
            <div className="linha-form" style={{ flexWrap: 'wrap', gap: '0.6rem' }}>
              <button type="button" className="botao botao-primario" onClick={migrar} disabled={rodando}>
                {rodando
                  ? t(`Migrando… ${movidos} de ${inv.total_arquivos}`, `Migrating… ${movidos} of ${inv.total_arquivos}`)
                  : t("Migrar para a minha infraestrutura", "Migrate to my infrastructure")}
              </button>
              {rodando && (
                <button
                  type="button"
                  className="botao botao-fantasma"
                  onClick={() => setPararPedido(true)}
                >
                  {t("Parar depois deste lote", "Stop after this batch")}</button>
              )}
            </div>
          )}

          {falhas.length > 0 && (
            <div className="alerta alerta-erro" style={{ marginTop: '0.8rem' }}>
              <strong>{falhas.length} {t("arquivo(s) não foram movidos", "file(s) were not moved")}</strong> {t("— eles continuam no disco do Offiz, intactos:", "— they remain intact on Offiz’s disk:")}<ul style={{ margin: '0.4rem 0 0 1.1rem' }}>
                {falhas.slice(0, 8).map((f) => (
                  <li key={f.arquivo}>
                    <code>{f.arquivo}</code> — {f.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )}</>
}

interface WorkerTokenStatus {
  configurado: boolean
  key_prefix: string | null
  criado_em: string | null
}

/** Linha do GET /orgs/{id}/worker-token/todos (visão de owner/admin).
 *  usuario_id null = token do fluxo antigo, criado antes da conexão por
 *  pessoa — na tela aparece como "pareamento antigo". */
interface MaquinaConectada {
  usuario_id: number | null
  nome_usuario: string | null
  key_prefix: string
  criado_em: string | null
}

/** Quantas linhas do log do worker mostramos no passo "Motor". */
const LINHAS_LOG_MOTOR = 15
/** Teto do log ao vivo de instalação (evita <pre> infinito em builds longos). */
const LINHAS_LOG_INSTALACAO = 120

/**
 * Painel EMBUTIDO do Motor local — só aparece quando o app desktop injeta a
 * ponte `window.offizMotor` na janela do site (temMotorBridge). Guia a pessoa
 * pelos 4 passos: parear a org → conectar o Claude → dependências → ligar.
 *
 * Troca automática do motor da org: quando o app fica pareado E com o Claude
 * conectado, o main do app faz PUT motor_modo="cli" sozinho — aqui só reagimos
 * ao resultado (motorTrocado/avisoModo) com toasts e avisamos a SecaoMotorIA
 * pelo evento EVENTO_SETTINGS_LLM_MUDOU para o select refletir a troca.
 *
 * `aoMudarPareamento` recarrega a tabela "Máquinas conectadas" da seção.
 */
type PainelMotorProps = {
  orgId: number
  aoMudarPareamento: () => void
  podeConfigurarEmpresa?: boolean
  gerenciado?: boolean
}

export function PainelMotorEmbutido(props: PainelMotorProps) {
  return <PainelMotorDaSessao key={`${getSessionIdentity()}:${props.orgId}`} {...props} />
}

function PainelMotorDaSessao({
  orgId,
  aoMudarPareamento,
  podeConfigurarEmpresa = true,
  gerenciado = false,
}: PainelMotorProps) {
  const { confirmar, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}`)

  const { t } = useIdioma()
  const { sucesso, falha, notificar } = useToasts()
  const bridge = window.offizMotor
  const sessao = getSessionIdentity()
  const vivoRef = useRef(true)
  const leiturasRef = useRef({ motor: 0, claude: 0, codex: 0 })
  useEffect(() => {
    vivoRef.current = true
    return () => { vivoRef.current = false }
  }, [])
  const [motor, setMotor] = useState<MotorEstado | null>(null)
  const [erroMotor, setErroMotor] = useState<string | null>(null)
  const [verificandoMotor, setVerificandoMotor] = useState(false)
  const [acaoWorker, setAcaoWorker] = useState<'ligar' | 'desligar' | null>(null)
  const alterandoWorker = acaoWorker !== null
  const [claude, setClaude] = useState<ClaudeStatus | null>(null)
  const [codex, setCodex] = useState<{ installed: boolean; authenticated?: boolean; versao?: string; error?: string } | null | 'sem-ponte'>(null)
  const [verificandoCodex, setVerificandoCodex] = useState(false)
  /** Provedor/CLI da ORG — decide qual passo é o protagonista. */
  const [provedorOrg, setProvedorOrg] = useState<{ provedor: string; motorCli: string } | null>(null)
  const [deps, setDeps] = useState<DepStatus[] | null>(null)
  const [depsAbertas, setDepsAbertas] = useState(false)
  const [depsCarregando, setDepsCarregando] = useState(false)
  /** O que está instalando agora: 'claude' | nome da dependência | null. */
  const [instalando, setInstalando] = useState<string | null>(null)
  /** Dono do log ao vivo (o <pre> aparece junto do item certo). */
  const [logDe, setLogDe] = useState<string | null>(null)
  const [logInstalacao, setLogInstalacao] = useState<string[]>([])
  const [aguardandoLogin, setAguardandoLogin] = useState(false)
  const [verificandoClaude, setVerificandoClaude] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  // Cancelamento deliberado do login: o aguardarLoginClaude pendente resolve
  // com ok=false — sem este ref, mostraríamos um toast de erro desnecessário.
  const cancelouLoginRef = useRef(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const logMotorRef = useRef<HTMLPreElement | null>(null)

  const atualizarMotor = useCallback(async () => {
    if (!bridge || !vivoRef.current || getSessionIdentity() !== sessao) return
    const leitura = ++leiturasRef.current.motor
    const vigente = () => vivoRef.current && getSessionIdentity() === sessao && leiturasRef.current.motor === leitura
    setVerificandoMotor(true)
    try {
      const estado = await bridge.estado()
      if (!vigente()) return
      setMotor(estado)
      setErroMotor(null)
    } catch {
      if (vigente()) setErroMotor(t('Não foi possível verificar o motor desta máquina.', 'Could not check this computer’s engine.'))
    } finally { if (vigente()) setVerificandoMotor(false) }
  }, [bridge, sessao, t])

  // claudeStatus pode levar segundos (o app roda `claude --version`): fica
  // fora do onUpdate e só é refeito após instalar/conectar.
  const atualizarClaude = useCallback(async () => {
    if (!bridge || !vivoRef.current || getSessionIdentity() !== sessao) return
    const leitura = ++leiturasRef.current.claude
    const vigente = () => vivoRef.current && getSessionIdentity() === sessao && leiturasRef.current.claude === leitura
    setVerificandoClaude(true)
    try {
      const conta = await bridge.claudeStatus(true)
      if (vigente()) setClaude(conta)
    } catch {
      if (vigente()) setClaude({ installed: false, error: t("Não foi possível verificar o Claude CLI.", "Could not check Claude CLI.") })
    } finally {
      if (vigente()) setVerificandoClaude(false)
    }
  }, [bridge, sessao, t])

  const atualizarCodex = useCallback(async () => {
    if (!bridge || !vivoRef.current || getSessionIdentity() !== sessao) return
    const leitura = ++leiturasRef.current.codex
    const vigente = () => vivoRef.current && getSessionIdentity() === sessao && leiturasRef.current.codex === leitura
    if (typeof bridge.codexStatus !== 'function') {
      // App anterior ao 0.2.3: sem a ponte do Codex — o passo vira guia manual.
      setCodex('sem-ponte')
      return
    }
    setVerificandoCodex(true)
    try {
      const conta = await bridge.codexStatus(true)
      if (vigente()) setCodex(conta)
    } catch {
      if (vigente()) setCodex({ installed: false, error: t('Não foi possível verificar o Codex.', 'Could not check Codex.') })
    } finally { if (vigente()) setVerificandoCodex(false) }
  }, [bridge, sessao, t])

  // O provedor da org decide o protagonista dos passos (Claude × Codex).
  useEffect(() => {
    if (!podeConfigurarEmpresa) { setProvedorOrg(null); return }
    let vivo = true
    api
      .get<LlmSettings>(`/orgs/${orgId}/settings/llm`)
      .then((d) => {
        if (vivo)
          setProvedorOrg({
            provedor: d.llm_provedor || 'anthropic',
            motorCli: d.motor_cli || 'claude',
          })
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [orgId, podeConfigurarEmpresa])

  /* TROCAR DE MOTOR AQUI (30/08/2026, pedido do dono: "ligado, tem que ter
     como eu trocar entre Claude e Codex aqui"). Antes o painel mostrava os
     dois motores lado a lado e mandava o dono para OUTRA seção para trocar —
     e é justamente aqui que ele descobre que precisa: quando a janela de uso
     de um acabou e o outro está instalado e conectado logo abaixo.

     A troca é do PAR provedor+motor, não do motor sozinho: o backend recusa
     Codex fora da OpenAI, e o resto da tela já deriva um do outro. Mandar só
     `motor_cli` deixaria a org meio-configurada — o mesmo erro que o
     comentário do salvar principal descreve. */
  const [trocandoMotor, setTrocandoMotor] = useState<string | null>(null)

  const engineAtual = motor?.config.localEngine || (provedorOrg?.motorCli === 'codex' ? 'codex' : 'claude')
  const modeloAtual = (engineAtual === 'codex' ? motor?.config.codexModel : motor?.config.claudeModel) || ''
  const [conectandoCodex, setConectandoCodex] = useState(false)
  const loginCodexEmCurso = useRef(false)
  const cancelouCodexRef = useRef(false)

  async function usarMotor(alvo: 'claude' | 'codex', modelo?: string) {
    if (trocandoMotor) return
    if (!bridge?.escolherMotor) {
      falha(t('Atualize o app para trocar o motor sem alterar as chaves da empresa.', 'Update the app to switch engines while keeping company API keys.'))
      return
    }
    setTrocandoMotor(alvo)
    try {
      const fixado = modelo ?? (alvo === 'codex' ? motor?.config.codexModel : motor?.config.claudeModel) ?? ''
      const result = await bridge.escolherMotor(alvo, fixado)
      if (!result.ok) throw new Error(result.error || 'Não foi possível salvar a escolha.')
      await atualizarMotor()
      sucesso(t('Escolha salva para as próximas tarefas nesta máquina.', 'Choice saved for upcoming tasks on this computer.'))
    } catch (e) {
      falha(e instanceof Error ? e.message : t('Não deu para trocar o motor agora.', 'Could not switch engines right now.'))
    } finally {
      setTrocandoMotor(null)
    }
  }

  async function conectarCodex() {
    if (!bridge?.conectarCodex || !bridge.aguardarLoginCodex || loginCodexEmCurso.current) return
    loginCodexEmCurso.current = true
    cancelouCodexRef.current = false
    setConectandoCodex(true)
    try {
      const inicio = await bridge.conectarCodex()
      // O processo de OAuth sobrevive quando a pessoa fecha/reabre o painel.
      // Apps já instalados retornam esta mensagem; retome a espera e o cancelamento.
      if (!inicio.ok && inicio.error !== 'Já há um login em andamento.') throw new Error(inicio.error)
      const result = await bridge.aguardarLoginCodex()
      if (cancelouCodexRef.current) return
      if (!result.ok) throw new Error(result.error)
      aplicarTrocaDeMotor(result)
      await atualizarCodex()
      aoMudarPareamento()
    } catch (e) {
      if (!cancelouCodexRef.current) falha(e instanceof Error ? e.message : t('Login não concluído.', 'Login not completed.'))
    } finally { loginCodexEmCurso.current = false; setConectandoCodex(false) }
  }

  async function cancelarCodex() {
    if (!bridge?.cancelarLoginCodex) return
    cancelouCodexRef.current = true
    try {
      const result = await bridge.cancelarLoginCodex()
      if (!result.ok) throw new Error('Não foi possível cancelar o login.')
    } catch {
      cancelouCodexRef.current = false
      falha(t('Não foi possível cancelar o login. Aguarde a tentativa terminar.', 'Could not cancel login. Wait for the attempt to finish.'))
    }
  }

  useEffect(() => {
    atualizarMotor()
    atualizarClaude()
    atualizarCodex()
  }, [atualizarMotor, atualizarClaude, atualizarCodex])

  // Push do app a cada mudança do motor — SEMPRE com unsubscribe no unmount.
  useEffect(() => {
    if (!bridge) return
    return bridge.onUpdate(() => {
      atualizarMotor()
    })
  }, [bridge, atualizarMotor])

  // Stream ao vivo das instalações (Claude CLI e dependências).
  useEffect(() => {
    if (!bridge) return
    return bridge.onInstalarLinha((linha) => {
      setLogInstalacao((prev) => [...prev.slice(-(LINHAS_LOG_INSTALACAO - 1)), linha])
    })
  }, [bridge])

  // Autoscroll do log ao vivo para a última linha.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logInstalacao])

  // Autoscroll do log do WORKER: as linhas mais novas (atividade atual) devem
  // ficar visíveis — o <pre> de 180px comporta menos que as 15 linhas.
  useEffect(() => {
    if (logMotorRef.current) logMotorRef.current.scrollTop = logMotorRef.current.scrollHeight
  })

  /** Toasts + refetch da SecaoMotorIA quando o app trocou o motor da org. */
  const aplicarTrocaDeMotor = useCallback(
    (r: ResultadoComTrocaDeMotor) => {
      if (r.motorTrocado) {
        sucesso(
          t("Modo local configurado para as tarefas. Elas usam o login do CLI desta máquina quando o motor está ligado; ", "Local mode configured for tasks. They use this computer’s CLI login when the engine is running; ") +
            t("Chat e sabatina também usam a assinatura no app 0.2.9+ em modo local. No navegador, usam a chave de API.", "Chat and onboarding also use your subscription in app 0.2.9+ in local mode. In a browser, they use the API key."),
        )
        window.dispatchEvent(new CustomEvent(EVENTO_SETTINGS_LLM_MUDOU))
      } else if (r.avisoModo) {
        notificar('info', r.avisoModo)
      }
    },
    [sucesso, notificar],
  )

  async function parear() {
    if (!bridge) return
    setOcupado(true)
    try {
      // SEMPRE o orgId da página — a pessoa pode ter várias organizações.
      const r = await bridge.parear(orgId)
      if (r.ok) {
        sucesso(
          t(`Esta máquina foi pareada com ${r.orgNome || t("a organização", "the organization")}`, `This computer was paired with ${r.orgNome || 'the organization'}`) +
            (r.keyPrefix ? ` (${r.keyPrefix}…).` : '.'),
        )
        aplicarTrocaDeMotor(r)
        await atualizarMotor()
        aoMudarPareamento()
      } else {
        falha(r.error || t("Não foi possível parear esta máquina.", "Could not pair this computer."))
      }
    } catch {
      falha(t("Não foi possível parear esta máquina.", "Could not pair this computer."))
    } finally {
      setOcupado(false)
    }
  }

  async function desparear() {
    if (!bridge) return
    if (
      !await confirmar({ titulo: t("Desparear este computador", "Unpair this computer"), mensagem: t("Desparear esta máquina? Ela para de receber tarefas da organização até parear de novo.", "Unpair this computer? It will stop receiving the organization’s tasks until it is paired again."), acao: t("Desparear computador", "Unpair computer") })
    )
      return
    setOcupado(true)
    try {
      const r = await bridge.desparear()
      if (r.ok) {
        sucesso(t("Máquina despareada.", "Computer unpaired."))
        if (r.motorRestaurado) {
          sucesso(t("Motor de execução voltou para API — as tarefas voltam a usar a API key da organização.", "Execution switched back to API mode. Tasks will use the organization’s API key again."))
          window.dispatchEvent(new CustomEvent(EVENTO_SETTINGS_LLM_MUDOU))
        } else if (r.aviso) {
          notificar('info', r.aviso)
        }
        await atualizarMotor()
        aoMudarPareamento()
      } else {
        falha(r.aviso || t("Não foi possível desparear esta máquina.", "Could not unpair this computer."))
      }
    } catch {
      falha(t("Não foi possível desparear esta máquina.", "Could not unpair this computer."))
    } finally {
      setOcupado(false)
    }
  }

  async function instalarCodex() {
    if (!bridge || typeof bridge.instalarCodex !== 'function') return
    setInstalando('codex')
    setLogDe('codex')
    setLogInstalacao([])
    try {
      const r = await bridge.instalarCodex()
      if (r.ok) {
        sucesso(
          r.jaInstalado
            ? t(`O Codex CLI já estava instalado${r.versao ? ` (${r.versao})` : ''}.`, `Codex CLI was already installed${r.versao ? ` (${r.versao})` : ''}.`)
            : t(`Codex CLI instalado${r.versao ? ` (${r.versao})` : ''}.`, `Codex CLI installed${r.versao ? ` (${r.versao})` : ''}.`),
        )
        atualizarCodex()
      } else {
        falha(r.error || t("A instalação do Codex CLI falhou — veja o log.", "Codex CLI installation failed — check the log."))
      }
    } catch {
      falha(t("A instalação do Codex CLI falhou.", "Codex CLI installation failed."))
    } finally {
      setInstalando(null)
    }
  }

  async function instalarClaude() {
    if (!bridge) return
    setInstalando('claude')
    setLogDe('claude')
    setLogInstalacao([])
    try {
      const r = await bridge.instalarClaude()
      if (r.ok) {
        sucesso(
          r.jaInstalado
            ? t(`O Claude CLI já estava instalado${r.versao ? ` (${r.versao})` : ''}.`, `Claude CLI was already installed${r.versao ? ` (${r.versao})` : ''}.`)
            : t(`Claude CLI instalado${r.versao ? ` (${r.versao})` : ''}.`, `Claude CLI installed${r.versao ? ` (${r.versao})` : ''}.`),
        )
        atualizarClaude()
      } else {
        if (r.log && r.log.length > 0) {
          setLogInstalacao((prev) => [...prev, ...r.log!].slice(-LINHAS_LOG_INSTALACAO))
        }
        falha(r.error || t("A instalação do Claude CLI falhou — veja o log.", "Claude CLI installation failed — check the log."))
      }
    } catch {
      falha(t("A instalação do Claude CLI falhou.", "Claude CLI installation failed."))
    } finally {
      setInstalando(null)
    }
  }

  async function conectarClaude() {
    if (!bridge) return
    setOcupado(true)
    cancelouLoginRef.current = false
    try {
      const ini = await bridge.conectarClaude()
      if (!ini.ok) {
        falha(ini.error || t("Não foi possível abrir o login do Claude no navegador.", "Could not open Claude sign-in in your browser."))
        return
      }
      setAguardandoLogin(true)
      const fim = await bridge.aguardarLoginClaude()
      if (fim.ok) {
        sucesso(t("Claude conectado nesta máquina.", "Claude connected on this computer."))
        aplicarTrocaDeMotor(fim)
        atualizarClaude()
        atualizarMotor()
      } else if (!cancelouLoginRef.current) {
        falha(fim.error || t("O login do Claude não foi concluído — tente de novo.", "Claude sign-in was not completed. Try again."))
      }
    } catch {
      if (!cancelouLoginRef.current) falha(t("O login do Claude não foi concluído — tente de novo.", "Claude sign-in was not completed. Try again."))
    } finally {
      setAguardandoLogin(false)
      setOcupado(false)
    }
  }

  async function cancelarLogin() {
    if (!bridge) return
    cancelouLoginRef.current = true
    try {
      await bridge.cancelarLoginClaude()
    } catch {
      /* o aguardarLoginClaude pendente resolve de qualquer forma */
    }
  }

  const carregarDeps = useCallback(async () => {
    if (!bridge) return
    setDepsCarregando(true)
    try {
      // O guard de origem do app pode recusar ({ok:false, error} SEM deps —
      // ex.: redirect apex→www, siteUrl desatualizado): valide a forma antes
      // de setar, senão deps vira undefined e o .map estoura a seção inteira.
      const r = (await bridge.verificarDeps()) as { deps?: unknown; error?: string }
      if (!Array.isArray(r?.deps)) {
        falha(r?.error || t("Não foi possível verificar as dependências.", "Could not check dependencies."))
        return
      }
      setDeps(r.deps as DepStatus[])
    } catch {
      falha(t("Não foi possível verificar as dependências.", "Could not check dependencies."))
    } finally {
      setDepsCarregando(false)
    }
  }, [bridge, falha])

  function alternarDeps() {
    const abrir = !depsAbertas
    setDepsAbertas(abrir)
    // Verifica sob demanda, ao expandir pela 1ª vez (checagens podem demorar).
    if (abrir && deps === null && !depsCarregando) carregarDeps()
  }

  async function instalarDep(nome: string) {
    if (!bridge) return
    setInstalando(nome)
    setLogDe(nome)
    setLogInstalacao([])
    try {
      const r = await bridge.instalarDep(nome)
      if (r.ok) {
        sucesso(`${nome} instalado${r.versao ? ` (${r.versao})` : ''}.`)
        await carregarDeps()
      } else if (r.brewAusente) {
        falha(t(`Para instalar ${nome} é preciso o Homebrew (brew.sh) — instale-o primeiro e tente de novo.`, `Installing ${nome} requires Homebrew (brew.sh). Install it first, then try again.`))
      } else {
        falha(r.error || t(`Não foi possível instalar ${nome}.`, `Could not install ${nome}.`))
      }
    } catch {
      falha(t(`Não foi possível instalar ${nome}.`, `Could not install ${nome}.`))
    } finally {
      setInstalando(null)
    }
  }

  async function ligar() {
    if (!bridge || alterandoWorker || (motor?.worker.estado === 'parado' && motor.worker.jobAtual)) return
    if (!motor?.pareado || motor.config.orgId !== orgId || erroMotor) {
      falha(t('Conecte esta empresa e verifique o motor antes de ligá-lo.', 'Connect this company and check the engine before starting it.'))
      return
    }
    setAcaoWorker('ligar')
    try {
      if (gerenciado) {
        if (engineAtual === 'codex' && (!codex || codex === 'sem-ponte' || codex.error || !codex.authenticated)) {
          falha('Conecte sua conta do ChatGPT ao Codex antes de ligar o motor local.')
          return
        }
        if (engineAtual === 'claude' && (!claude?.installed || claude.error || claude.loggedIn !== true || claude.tokenExpired === true)) {
          falha('Conecte sua conta ao Claude Code antes de ligar o motor local.')
          return
        }
      }
      const resultado = await bridge.ligar()
      if (!resultado.ok) throw new Error('Motor não iniciado')
      await atualizarMotor()
    } catch {
      falha(t("Não foi possível ligar o motor.", "Could not start the engine."))
    } finally { setAcaoWorker(null) }
  }

  async function desligar() {
    if (!bridge || alterandoWorker) return
    setAcaoWorker('desligar')
    try {
      const resultado = await bridge.desligar()
      if (!resultado.ok) throw new Error('Motor não interrompido')
      await atualizarMotor()
    } catch {
      falha(t("Não foi possível desligar o motor.", "Could not stop the engine."))
    } finally { setAcaoWorker(null) }
  }

  if (!bridge) return null

  const pareadoAqui = Boolean(motor?.pareado && motor.config.orgId === orgId)
  const pareadoOutra = Boolean(motor?.pareado && motor.config.orgId != null && motor.config.orgId !== orgId)
  const worker = motor?.worker ?? null
  // O Desktop deixa de buscar tarefas antes de terminar a execução corrente.
  // `parado` com jobAtual ainda não confirma que o motor terminou de desligar.
  const encerrandoWorker = acaoWorker === 'desligar' || (worker?.estado === 'parado' && Boolean(worker.jobAtual))
  const logMotor = worker?.log ? worker.log.slice(-LINHAS_LOG_MOTOR) : []
  const logAoVivo = logInstalacao.length > 0 && logDe !== null
  const claudeConectado = claude?.installed && !claude.error && claude.loggedIn === true && claude.tokenExpired !== true

  return <>{dialogo}{(
    <div className="motor-emb" id="motor-local">
      <AtualizacaoMotor versao={bridge.versao} />
      {bridge.escolherMotor && <div className="motor-emb-passo">
        <h3>{t('IA nesta máquina', 'AI on this computer')}</h3>
        <div className="motor-emb-acoes" role="group" aria-label={t('Motor de IA', 'AI engine')}>
          {(['codex', 'claude'] as const).map(engine => <button key={engine} type="button"
            className={engineAtual === engine ? 'botao botao-primario' : 'botao botao-fantasma'}
            aria-pressed={engineAtual === engine} disabled={trocandoMotor !== null}
            onClick={() => usarMotor(engine)}>{engine === 'codex' ? 'OpenAI Codex' : 'Claude Code'}</button>)}
          <label>{t('Modelo', 'Model')} <select value={modeloAtual} disabled={trocandoMotor !== null}
            onChange={e => usarMotor(engineAtual, e.target.value)}>
            <option value="">{t('Automático — conforme a tarefa', 'Automatic — per task')}</option>
            {(Array.from(new Set([...(engineAtual === 'codex' ? ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] : ['claude-opus-5', 'claude-sonnet-5']), ...(modeloAtual ? [modeloAtual] : [])]))).map(model => <option key={model} value={model}>{model}</option>)}
          </select></label>
        </div>
        <p className="texto-suave">{t('Automático acompanha a complexidade da tarefa. A atividade mostra o modelo usado. Trocar aqui preserva as chaves de API da empresa.', 'Automatic follows task complexity. Activity shows the model used. Switching here preserves company API keys.')}</p>
        {engineAtual === 'codex' && <p className="texto-suave">{t('A disponibilidade e os limites dependem da conta conectada. A escolha vale para esta máquina; ela não muda o modelo nem o custo da API da empresa.', 'Availability and limits depend on the connected account. This choice applies to this computer; it does not change the company API model or cost.')}</p>}
      </div>}
      {/* Passo 1 — Organização */}
      <details className="motor-emb-passo" open={!pareadoAqui}><summary>{t('Conectar esta empresa', 'Connect this company')}</summary>
        <div className="motor-emb-passo-titulo">
          <span className="motor-emb-num" aria-hidden="true">1</span>
          <strong>{t("Organização", "Organization")}</strong>
          {motor === null ? (
            <span className="texto-suave">{t("verificando…", "checking…")}</span>
          ) : pareadoAqui ? (
            <span className="status-pill status-done">{t("✓ Pareado com ", "✓ Paired with ")}{motor.config.orgNome || t("esta organização", "this organization")}</span>
          ) : pareadoOutra ? (
            <span className="status-pill status-running">
              {t("Pareado com outra organização", "Paired with another organization")}{motor.config.orgNome ? ` (${motor.config.orgNome})` : ''}
            </span>
          ) : (
            <span className="status-pill status-queued">{t("Ainda não conectado", "Not paired")}</span>
          )}
        </div>
        <p className="texto-suave">
          {t("Este computador vai receber os trabalhos desta empresa.", "Pairing links this computer to the organization so it can receive tasks to run here.")}{motor?.pareadoPor && pareadoAqui ? t(` Pareada por ${motor.pareadoPor}.`, ` Paired by ${motor.pareadoPor}.`) : ''}
        </p>
        <div className="motor-emb-acoes">
          {pareadoAqui ? (
            <button type="button" className="botao-texto perigo" onClick={desparear} disabled={ocupado}>
              {t("Desparear", "Unpair")}</button>
          ) : (
            <button type="button" className="botao botao-primario botao-pequeno" onClick={parear} disabled={ocupado}>
              {ocupado ? t("Aguarde…", "Please wait…") : t("Conectar esta empresa", "Pair this organization")}
            </button>
          )}
          {pareadoOutra && (
            <span className="texto-suave">{t("parear aqui transfere a máquina para esta organização.", "pairing here transfers this computer to this organization.")}</span>
          )}
        </div>
      </details>

      {/* Passo 2 — Claude (assinatura de quem usa) */}
      <details className="motor-emb-passo" open={engineAtual === 'claude' && claude?.loggedIn !== true}><summary>{t('Conta Claude', 'Claude account')}</summary>
        <div className="motor-emb-passo-titulo">
          <span className="motor-emb-num" aria-hidden="true">2</span>
          <strong>{t("Claude — a assinatura é sua", "Claude — your account")}</strong>
          {engineAtual === 'codex' && (
            <span className="status-pill status-queued">{t("reserva — esta máquina usa o Codex", "standby — this computer uses Codex")}</span>
          )}
          {claude === null || verificandoClaude ? (
            <span className="texto-suave">{t("verificando…", "checking…")}</span>
          ) : claude.error ? <span className="status-pill status-queued">{t('Falha ao verificar', 'Could not check')}</span> : claude.installed ? (
            <span className={`status-pill ${claudeConectado ? 'status-done' : 'status-queued'}`}>
              {claudeConectado ? t('✓ Conectado', '✓ Connected')
                : claude.tokenExpired ? t('Sessão vencida — reconecte', 'Session expired — reconnect')
                : t('Instalado · conecte sua conta', 'Installed · connect your account')}
              {claude.versao ? ` — ${claude.versao}` : ''}
            </span>
          ) : (
            <span className="status-pill status-queued">{t("Não instalado", "Not installed")}</span>
          )}
        </div>
        <p className="texto-suave">
          {t("Conecte sua conta Claude e ligue o motor para conversar e produzir com os limites da sua assinatura.", "In local mode, tasks use the Claude login on this computer and that account’s limits. Connect Claude and start the engine after pairing. Chat and onboarding also use your subscription in app 0.2.9+ in local mode. In a browser, they use the API key.")}</p>
        {claude?.error && <p className="alerta alerta-aviso" role="alert">{claude.error}</p>}
        <div className="motor-emb-acoes">
          {/* Só oferece o que dá para usar AGORA: trocar para um motor que não
              está instalado troca a org e deixa a tarefa sem executor. */}
          {engineAtual === 'codex' && claude?.installed && (
            <button
              type="button"
              className="botao botao-primario botao-pequeno"
              onClick={() => usarMotor('claude')}
              disabled={trocandoMotor !== null}
            >
              {trocandoMotor === 'claude' ? t("Trocando…", "Switching…") : t("Usar Claude nesta máquina", "Use Claude on this computer")}
            </button>
          )}
          {claude !== null && !claude.installed && !claude.error && (
            <button
              type="button"
              className="botao botao-primario botao-pequeno"
              onClick={instalarClaude}
              disabled={instalando !== null}
            >
              {instalando === 'claude' ? t("Instalando…", "Installing…") : t("Instalar Claude CLI", "Install Claude CLI")}
            </button>
          )}
          {claude?.installed && !aguardandoLogin && (
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              onClick={conectarClaude}
              disabled={ocupado || instalando !== null}
            >
              {claudeConectado ? t('Reconectar Claude', 'Reconnect Claude') : t("Conectar Claude", "Connect Claude")}</button>
          )}
          {claude !== null && !aguardandoLogin && (
            <button type="button" className="botao-texto" disabled={verificandoClaude || ocupado}
              onClick={() => void atualizarClaude()}>
              {verificandoClaude ? t('Verificando…', 'Checking…') : t('Verificar conexão Claude', 'Check Claude connection')}
            </button>
          )}
          {aguardandoLogin && (
            <>
              <span className="status-pill status-running">{t("autorize no navegador…", "authorize in your browser…")}</span>
              <button type="button" className="botao-texto" onClick={cancelarLogin}>
                {t("cancelar", "cancel")}</button>
            </>
          )}
        </div>
        {logAoVivo && logDe === 'claude' && (
          <pre className="motor-emb-log" ref={logRef}>{logInstalacao.join('\n')}</pre>
        )}
      </details>

      {/* Passo 3 — Codex (OpenAI): as tarefas locais usam o login do CLI.
          A chave da organização atende chat, sabatina e execução na nuvem. */}
      <details className="motor-emb-passo" open={engineAtual === 'codex' && (codex === null || codex === 'sem-ponte' || !codex.authenticated)}><summary>{t('Conta ChatGPT / OpenAI', 'ChatGPT / OpenAI account')}</summary>
        <div className="motor-emb-passo-titulo">
          <span className="motor-emb-num" aria-hidden="true">3</span>
          <strong>{t("Codex — o motor OpenAI", "Codex — the OpenAI engine")}</strong>
          {engineAtual === 'codex' && (
            <span className="status-pill status-running">{t("motor desta máquina", "selected on this computer")}</span>
          )}
          {codex === null || verificandoCodex ? (
            <span className="texto-suave">{t("verificando…", "checking…")}</span>
          ) : codex === 'sem-ponte' ? (
            <span className="status-pill status-queued">{t("atualize o app p/ verificar daqui", "update the app to check here")}</span>
          ) : codex.error ? <span className="status-pill status-queued">{t('Falha ao verificar', 'Could not check')}</span> : codex.installed ? (
            <span className={`status-pill ${codex.authenticated ? 'status-done' : 'status-queued'}`}>{(codex.authenticated ? t("✓ Conectado", "✓ Connected") : t("Instalado · conecte sua conta", "Installed · connect your account"))}{codex.versao ? ` — ${codex.versao}` : ''}</span>
          ) : (
            <span className="status-pill status-queued">{t("Não instalado", "Not installed")}</span>
          )}
        </div>
        <p className="texto-suave">{gerenciado ? 'Conecte sua conta para conversar e produzir neste computador. No navegador, as contas de API são administradas pelo Offiz.' : t('Conecte sua conta para conversar e produzir neste computador. Para usar o navegador ou gerar imagens pela OpenAI, conecte também uma chave de API.', 'Connect your account to chat and produce on this computer. To use a browser or generate images with OpenAI, also connect an API key.')}</p>
        {codex !== null && codex !== 'sem-ponte' && codex.error && <p className="alerta alerta-aviso" role="alert">{codex.error}</p>}
        <div className="motor-emb-acoes">
          {engineAtual !== 'codex' && codex !== null && codex !== 'sem-ponte'
            && codex.installed && (
            <button
              type="button"
              className="botao botao-primario botao-pequeno"
              onClick={() => usarMotor('codex')}
              disabled={trocandoMotor !== null}
            >
              {trocandoMotor === 'codex' ? t("Trocando…", "Switching…") : t("Usar Codex nesta máquina", "Use Codex on this computer")}
            </button>
          )}
          {codex !== null && codex !== 'sem-ponte' && !codex.installed && !codex.error && (
            <button
              type="button"
              className="botao botao-primario botao-pequeno"
              onClick={instalarCodex}
              disabled={instalando !== null}
            >
              {instalando === 'codex' ? t("Instalando…", "Installing…") : t("Instalar Codex CLI", "Install Codex CLI")}
            </button>
          )}
          {bridge.conectarCodex && codex !== null && codex !== 'sem-ponte' && codex.installed && <>
            <button type="button" className="botao botao-fantasma" onClick={conectarCodex} disabled={conectandoCodex}>
              {conectandoCodex ? t('Autorize no navegador…', 'Authorize in your browser…') : codex.authenticated ? t('Reconectar OpenAI', 'Reconnect OpenAI') : t('Conectar OpenAI', 'Connect OpenAI')}
            </button>
            {conectandoCodex && <>
              <span role="status">{t('Login em andamento. Conclua a autorização no navegador. Se a janela não abriu, cancele e conecte novamente.', 'Login is in progress. Finish authorization in your browser. If no window opened, cancel and connect again.')}</span>
              {bridge.cancelarLoginCodex && <button type="button" className="botao-texto" onClick={cancelarCodex}>{t('Cancelar login', 'Cancel login')}</button>}
            </>}
          </>}
          {codex !== null && codex !== 'sem-ponte' && <button type="button" className="botao-texto" disabled={verificandoCodex || conectandoCodex} onClick={atualizarCodex}>{verificandoCodex ? t('Verificando…', 'Checking…') : t('Verificar conexão', 'Check connection')}</button>}
        </div>
        {logAoVivo && logDe === 'codex' && (
          <pre className="motor-emb-log">{logInstalacao.join('\n')}</pre>
        )}
      </details>

      {/* Passo 4 — Motor */}
      <div className="motor-emb-passo">
        <div className="motor-emb-passo-titulo">
          <span className="motor-emb-num" aria-hidden="true">5</span>
          <strong>{t("Motor", "Engine")}</strong>
          {verificandoMotor ? <span className="texto-suave" role="status">{t('verificando…', 'checking…')}</span> : erroMotor ? <span className="status-pill status-queued">{t('Falha ao verificar', 'Could not check')}</span> : worker === null ? (
            <span className="texto-suave">{t("verificando…", "checking…")}</span>
          ) : encerrandoWorker ? (
            <span className="status-pill status-running">{worker.jobAtual ? t('encerrando — aguardando tarefa', 'stopping — waiting for task') : t('desligando…', 'stopping…')}</span>
          ) : worker.estado === 'parado' ? (
            <span className="status-pill status-cancelled">{t("desligado", "off")}</span>
          ) : worker.estado === 'executando' ? (
            <span className="status-pill status-running">{t("executando tarefa", "executing task")}</span>
          ) : worker.estado === 'ocioso' ? (
            <span className="status-pill status-done">{t("ligado — aguardando tarefas", "running — waiting for tasks")}</span>
          ) : <span className="status-pill status-queued">{t('Estado indisponível', 'State unavailable')}</span>}
        </div>
        {erroMotor && <p className="alerta alerta-aviso" role="alert">{erroMotor} <button type="button" className="botao-texto" onClick={atualizarMotor}>{t('Verificar motor', 'Check engine')}</button></p>}
        {motor && (erroMotor || verificandoMotor) && <p className="texto-suave">{t('Os dados abaixo são da última consulta confirmada.', 'The information below is from the last confirmed check.')}</p>}
        {worker?.jobAtual && (
          <p className="texto-suave">
            {encerrandoWorker ? t('Aguardando o encerramento da tarefa', 'Waiting for task to finish') : t("Trabalhando em", "Working on")}{worker.jobAtual.id != null ? ` #${worker.jobAtual.id}` : ''}
            {worker.jobAtual.titulo ? ` — ${worker.jobAtual.titulo}` : ''}
          </p>
        )}
        {encerrandoWorker && <p className="texto-suave" role="status">{worker?.jobAtual ? t('O desligamento aguarda esta tarefa encerrar. Aguarde antes de ligar o motor novamente.', 'Stopping waits for this task to finish. Wait before starting the engine again.') : t('Aguarde o motor terminar de desligar.', 'Wait for the engine to finish stopping.')}</p>}
        {motor?.config.workerEnabled && (
          <p className="texto-suave">{t('Ao reabrir o Offiz nesta conta, o motor volta a ligar. Desligue abaixo para pausar essa retomada.', 'When you reopen Offiz with this account, the engine starts again. Stop it below to pause this behavior.')}</p>
        )}
        <div className="motor-emb-acoes">
          {encerrandoWorker ? (
            <button type="button" className="botao botao-fantasma botao-pequeno" disabled>{t('Aguarde…', 'Please wait…')}</button>
          ) : worker?.estado === 'parado' ? (
            <button
              type="button"
              className="botao botao-primario botao-pequeno"
              onClick={ligar}
              disabled={!pareadoAqui || Boolean(erroMotor) || verificandoMotor || alterandoWorker}
              title={pareadoAqui ? undefined : t("Conecte esta empresa para ligar a IA", "Connect this company to turn on AI")}
            >
              {acaoWorker === 'ligar' ? t('Ligando…', 'Starting…') : t("Ligar o motor", "Start engine")}</button>
          ) : (
            worker !== null && (
              <button type="button" className="botao botao-fantasma botao-pequeno" disabled={alterandoWorker} onClick={desligar}>
                {alterandoWorker ? t('Desligando…', 'Stopping…') : t("Desligar", "Stop")}</button>
            )
          )}
          {!motor?.pareado && worker?.estado === 'parado' && (
            <span className="texto-suave">{t("Primeiro, clique em Conectar esta empresa.", "First, click Connect this company.")}</span>
          )}
        </div>
        {logMotor.length > 0 && (
          <details><summary>{t("Ver atividade do motor", "View engine activity")}</summary><pre className="motor-emb-log" ref={logMotorRef}>{logMotor.join('\n')}</pre></details>
        )}
      </div>

      {/* Passo 4 — Dependências do escritório */}
      <div className="motor-emb-passo">
        <div className="motor-emb-passo-titulo">
          <span className="motor-emb-num" aria-hidden="true">4</span>
          <strong>{t("Este computador está pronto?", "Is this computer ready?")}</strong>
          <button type="button" className="botao-texto" onClick={alternarDeps}>
            {depsAbertas ? 'ocultar' : 'verificar'}
          </button>
        </div>
        {depsAbertas && (
          <>
            {depsCarregando && <p className="texto-suave">{t("Verificando o que já está instalado…", "Checking what is already installed…")}</p>}
            {!depsCarregando && deps !== null && deps.length === 0 && (
              <p className="texto-suave">{t("Nenhuma dependência extra — tudo pronto.", "No extra dependencies — everything is ready.")}</p>
            )}
            {deps !== null && deps.length > 0 && (
              <ul className="motor-emb-deps">
                {deps.map((d) => (
                  <li className="motor-emb-dep" key={d.nome}>
                    <span
                      className={d.instalada === true ? 'motor-emb-dep-ok' : d.opcional ? 'texto-suave' : 'motor-emb-dep-falta'}
                      aria-hidden="true"
                    >
                      {d.instalada === true ? '✓' : d.opcional ? '○' : '✗'}
                    </span>
                    <strong>{d.nome}</strong>
                    {d.opcional && <span className="texto-suave">{t("opcional", "optional")}</span>}
                    {d.instalada === true && d.versao && <span className="texto-suave">{d.versao}</span>}
                    {d.detalhe && <span className="texto-suave">{d.detalhe}</span>}
                    {d.instalada !== true && d.instalavel && (
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={() => instalarDep(d.nome)}
                        disabled={instalando !== null}
                      >
                        {instalando === d.nome ? t("Instalando…", "Installing…") : t("Instalar", "Install")}
                      </button>
                    )}
                    {d.instalada !== true && d.brewAusente && (
                      <span className="texto-suave">
                        {t("precisa do Homebrew — instale em", "requires Homebrew — install it at")}{' '}
                        <a href="https://brew.sh" target="_blank" rel="noreferrer">
                          brew.sh
                        </a>{' '}
                        {t("e verifique de novo", "and check again")}</span>
                    )}
                    {d.instalada !== true && !d.instalavel && !d.brewAusente && d.manual && (
                      <span className="texto-suave">{t("instalação manual: ", "manual installation: ")}{d.manual}</span>
                    )}
                    {logAoVivo && logDe === d.nome && (
                      <pre className="motor-emb-log" ref={logRef}>{logInstalacao.join('\n')}</pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!depsCarregando && deps !== null && (
              <div className="motor-emb-acoes">
                <button type="button" className="botao-texto" onClick={carregarDeps}>
                  {t("verificar de novo", "check again")}</button>
              </div>
            )}
          </>
        )}
        {!depsAbertas && (
          <p className="texto-suave">
            {t("Confira se este computador está pronto para produzir os arquivos que você precisa.", "Tools this office uses on your computer (such as ffmpeg). Click “check” to verify.")}</p>
        )}
      </div>

      <RecuperacaoLocal key={orgId} orgId={orgId} />
      <p className="texto-suave">{t("App Offiz Desktop v", "Offiz Desktop app v")}{bridge.versao}.</p>
    </div>
  )}</>
}

/** Motor local (app Offiz Desktop): a conexão agora é POR PESSOA — cada
 *  membro conecta a própria máquina dentro do app (Menu Offiz → Motor local),
 *  onde o token é gerado. Aqui na web:
 *   - todo membro vê e desconecta a PRÓPRIA máquina (GET/DELETE /worker-token);
 *   - owner/admin também enxerga a tabela "Máquinas conectadas" da organização
 *     (GET /worker-token/todos) e pode revogar qualquer linha
 *     (DELETE /worker-token/{usuario_id} ou /worker-token/legado).
 *  Se /todos responder 403/404 (membro comum ou backend antigo sem a rota),
 *  caímos em silêncio para a visão só do próprio pareamento.
 *
 *  App desktop NOVO (ponte window.offizMotor injetada no site): a seção vira
 *  o painel completo embutido (PainelMotorEmbutido) — parear, Claude, deps e
 *  ligar/desligar direto daqui, sem segunda janela. Feature-detect SEMPRE:
 *  na web e em apps antigos a ponte não existe e tudo fica como era. */
function SecaoMotorLocal({ orgId, gerenciado = false }: { orgId: number; gerenciado?: boolean }) {
  const { confirmar, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}`)

  const { t, idioma } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [status, setStatus] = useState<WorkerTokenStatus | null>(null)
  // Backend antigo responde 403 ao membro comum: sem o flag, o H3 "Sua
  // máquina" ficaria um título pendurado sem conteúdo nenhum.
  const [statusFalhou, setStatusFalhou] = useState(false)
  const [maquinas, setMaquinas] = useState<MaquinaConectada[] | null>(null)
  const [podeVerTodos, setPodeVerTodos] = useState(false)
  const [erroTodos, setErroTodos] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    try {
      setStatus(await api.get<WorkerTokenStatus>(`/orgs/${orgId}/worker-token`))
      setStatusFalhou(false)
    } catch {
      setStatus(null)
      setStatusFalhou(true)
    }
    try {
      const data = await api.get<unknown>(`/orgs/${orgId}/worker-token/todos`)
      // O backend responde {"pareamentos": [...]}; asList também cobre array puro.
      setMaquinas(asList<MaquinaConectada>(data, 'pareamentos', 'tokens'))
      setPodeVerTodos(true)
      setErroTodos(null)
    } catch (e) {
      setPodeVerTodos(false)
      setMaquinas(null)
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        // Membro comum (403) ou backend antigo sem a rota (404): sem alarde —
        // a seção segue funcionando só com o pareamento da própria pessoa.
        setErroTodos(null)
      } else {
        setErroTodos(t("Não foi possível listar as máquinas conectadas da organização.", "Could not list this organization’s connected computers."))
      }
    }
  }, [orgId])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function desconectarMinha() {
    if (
      !await confirmar({ titulo: t("Desconectar este computador", "Disconnect this computer"), mensagem: t("Desconectar a sua máquina? Ela para de receber tarefas até você conectar de novo pelo app (Menu Offiz → Motor local).", "Disconnect your computer? It will stop receiving tasks until you connect again through the app (Offiz menu → Local engine)."), acao: t("Desconectar computador", "Disconnect computer") })
    )
      return
    setOcupado(true)
    try {
      await api.del(`/orgs/${orgId}/worker-token`)
      sucesso(t("Sua máquina foi desconectada.", "Your computer was disconnected."))
      await carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível desconectar.", "Could not disconnect."))
    } finally {
      setOcupado(false)
    }
  }

  async function revogarMaquina(m: MaquinaConectada) {
    const quem = m.nome_usuario ? t(`a máquina de ${m.nome_usuario}`, `${m.nome_usuario}’s computer`) : t("o pareamento antigo", "the legacy pairing")
    if (
      !await confirmar({ titulo: t("Revogar acesso do computador", "Revoke computer access"), mensagem: t(`Revogar ${quem}? Ela para de receber tarefas até a pessoa conectar de novo pelo app.`, `Revoke ${quem}? It will stop receiving tasks until the person reconnects through the app.`), acao: t("Revogar acesso", "Revoke access") })
    )
      return
    setOcupado(true)
    try {
      await api.del(
        m.usuario_id != null
          ? `/orgs/${orgId}/worker-token/${m.usuario_id}`
          : `/orgs/${orgId}/worker-token/legado`,
      )
      sucesso(t("Máquina revogada.", "Computer access revoked."))
      // Recarrega tudo: revogar a própria linha também muda o status "Sua máquina".
      await carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível revogar.", "Could not revoke access."))
    } finally {
      setOcupado(false)
    }
  }

  // Ponte do app desktop novo (preload injeta window.offizMotor no site).
  // É estática na vida da página — sem estado/efeito para detectá-la.
  const temBridge = temMotorBridge()

  // Na web não existe CLI: o bloco "Sua máquina" (conectar/desconectar) só
  // faz sentido dentro do app desktop. A tabela "Máquinas conectadas" CONTINUA
  // na web quando há itens — é como o dono revoga a máquina de um
  // ex-funcionário sem precisar do app. Sem desktop, sem itens e sem erro
  // para reexibir, a seção inteira some.
  const temTabela = podeVerTodos && maquinas !== null && maquinas.length > 0
  if (!ehDesktop && !temTabela && !erroTodos) return null

  return <>{dialogo}{(
    <section className="cartao">
      <h2 className="secao-titulo">{t("Motor local (app Offiz Desktop)", "Local engine (Offiz Desktop app)")}</h2>
      {temBridge ? (
        <p className="texto-suave">
          {t("Você está no app Offiz Desktop: as tarefas da organização podem rodar", "You are using Offiz Desktop. This organization’s tasks can run")}{' '}
          <strong>{t("neste computador", "on this computer")}</strong>{t(". Escolha sua IA e mantenha o motor ligado.", ". Choose your AI and keep the engine on.")}</p>
      ) : ehDesktop ? (
        <p className="texto-suave">
          {t("Com o app Offiz Desktop instalado, as tarefas podem rodar no próprio computador, com o login do Claude ou Codex (modo CLI). Chat e sabatina também usam a assinatura no app 0.2.9+ em modo local. No navegador, usam a chave de API.", "With Offiz Desktop installed, tasks can run on your computer using the Claude or Codex login (CLI mode). Chat and onboarding also use your subscription in app 0.2.9+ in local mode. In a browser, they use the API key.")}{' '}
          <strong>{t("Cada pessoa conecta a própria máquina pelo app: Menu Offiz → Motor local.", "Each person connects their own computer in the app: Offiz menu → Local engine.")}</strong>
        </p>
      ) : (
        <p className="texto-suave">
          {t("Máquinas conectadas pelo app Offiz Desktop rodam tarefas no computador de cada pessoa (modo CLI). Aqui você revoga o acesso de máquinas que não devem mais receber tarefas.", "Computers connected through Offiz Desktop run tasks locally (CLI mode). Revoke access here for computers that should no longer receive tasks.")}</p>
      )}

      {temBridge && <PainelMotorEmbutido orgId={orgId} gerenciado={gerenciado} aoMudarPareamento={carregar} />}

      {ehDesktop && !temBridge && (
        <>
          <h3 className="secao-titulo secao-subtitulo">{t("Sua máquina", "Your computer")}</h3>
          {!status && statusFalhou && (
            <p className="texto-suave">{t("Status indisponível no momento.", "Status is currently unavailable.")}</p>
          )}
          {status && (
            <div className="linha-form" style={{ margin: 0, alignItems: 'center', flexWrap: 'wrap' }}>
              {status.configurado ? (
                <>
                  <span className="status-pill status-done">{t("✓ Conectada (", "✓ Connected (")}{status.key_prefix}…)</span>
                  {status.criado_em && (
                    // formatData/toDate tratam o timestamp naive-UTC do backend
                    // (new Date direto erraria o dia entre 21h e 0h no fuso BRT).
                    <span className="texto-suave">{t("desde ", "since ")}{formatData(status.criado_em, idioma)}</span>
                  )}
                  <button type="button" className="botao-texto perigo" onClick={desconectarMinha} disabled={ocupado}>
                    {t("Desconectar", "Disconnect")}</button>
                </>
              ) : (
                <>
                  <span className="status-pill status-queued">{t("Nenhuma máquina conectada", "No computer connected")}</span>
                  <span className="texto-suave">{t("abra o app no seu computador e use Menu Offiz → Motor local.", "open the app on your computer and choose Offiz menu → Local engine.")}</span>
                </>
              )}
            </div>
          )}
        </>
      )}

      {(podeVerTodos || erroTodos) && (
        <details open={!!erroTodos}>
          <summary>{t("Máquinas conectadas", "Connected computers")}</summary>
          {erroTodos && (
            <p className="alerta alerta-erro">
              {erroTodos}{' '}
              <button type="button" className="botao-texto" onClick={() => carregar()}>
                {t("tentar de novo", "try again")}</button>
            </p>
          )}
          {podeVerTodos && maquinas !== null && maquinas.length === 0 && (
            <p className="texto-suave">{t("Ninguém conectou uma máquina ainda.", "No computers have been connected yet.")}</p>
          )}
          {podeVerTodos && maquinas !== null && maquinas.length > 0 && (
            <div className="tabela-scroll">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>{t("Quem", "Who")}</th>
                    <th>{t("Identificação", "Identifier")}</th>
                    <th>{t("Conectada desde", "Connected since")}</th>
                    <th aria-label={t("Ações", "Actions")} />
                  </tr>
                </thead>
                <tbody>
                  {maquinas.map((m) => (
                    <tr key={m.usuario_id ?? `legado-${m.key_prefix}`}>
                      <td>
                        {m.nome_usuario || (
                          <span className="texto-suave" title={t("Token do fluxo antigo, criado antes da conexão por pessoa", "Legacy token created before individual connections were available")}>
                            {t("pareamento antigo", "legacy pairing")}</span>
                        )}
                      </td>
                      <td>{m.key_prefix}…</td>
                      <td>
                        {m.criado_em
                          ? `${formatData(m.criado_em, idioma)} · ${tempoRelativo(m.criado_em, idioma)}`
                          : '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="botao-texto perigo"
                          onClick={() => revogarMaquina(m)}
                          disabled={ocupado}
                        >
                          {t("Revogar", "Revoke")}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}
    </section>
  )}</>
}

/* ------------------------------------------------------------------ */
/* Notificações — só e-mail (WhatsApp saiu do produto em 2026-07)       */
/* ------------------------------------------------------------------ */

function SecaoNotificacoes() {
  const { t } = useIdioma()
  const { sucesso, falha } = useToasts()

  // SÓ E-MAIL (decisão do dono, 2026-07): WhatsApp saiu do produto — a config
  // da Meta (phone id/token/teste) foi removida da interface. O serviço e os
  // campos seguem dormentes no backend caso um dia volte; o PUT abaixo é
  // parcial e não toca nos campos de WhatsApp.
  const [prefs, setPrefs] = useState<NotificacoesUsuario | null>(null)
  const [erroPrefs, setErroPrefs] = useState<string | null>(null)
  const [recebeEmail, setRecebeEmail] = useState(true)
  const [salvandoPrefs, setSalvandoPrefs] = useState(false)

  const carregarPrefs = useCallback(async () => {
    try {
      const data = await api.get<NotificacoesUsuario>('/usuarios/me/notificacoes')
      setPrefs(data)
      setRecebeEmail(data.notif_email !== false)
      setErroPrefs(null)
    } catch (e) {
      setErroPrefs(e instanceof ApiError ? e.detail : t("Não foi possível carregar as suas preferências.", "Could not load your preferences."))
    }
  }, [])

  useEffect(() => {
    carregarPrefs()
  }, [carregarPrefs])

  async function salvarPrefs(e: FormEvent) {
    e.preventDefault()
    setSalvandoPrefs(true)
    try {
      await api.put('/usuarios/me/notificacoes', { notif_email: recebeEmail })
      sucesso(t("Preferências de notificação salvas.", "Notification preferences saved."))
      await carregarPrefs()
    } catch (err) {
      falha(err instanceof ApiError ? err.detail : t("Não foi possível salvar as suas preferências.", "Could not save your preferences."))
    } finally {
      setSalvandoPrefs(false)
    }
  }

  return (
    <section className="cartao">
      <h2 className="secao-titulo">
        <Icone nome="sino" />
        {t("Notificações", "Notifications")}</h2>
      <p className="texto-suave">
        {t("Os avisos chegam por ", "Notifications arrive by ")}<strong>{t("e-mail", "email")}</strong>{t(", no mesmo endereço do seu login — entregas prontas e o resumo dos eventos. Vale só para você, em todas as organizações.", ", at the address you use to sign in — completed deliverables and event summaries. This preference applies only to you, across all organizations.")}</p>
      {erroPrefs && (
        <p className="alerta alerta-erro">
          {erroPrefs}{' '}
          <button type="button" className="botao-texto" onClick={() => carregarPrefs()}>
            {t("tentar de novo", "try again")}</button>
        </p>
      )}
      {prefs === null && !erroPrefs && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-linha" />
          <div className="esqueleto esqueleto-linha" />
        </div>
      )}
      {prefs !== null && (
        <form onSubmit={salvarPrefs}>
          <label className="check-inline">
            <input type="checkbox" checked={recebeEmail} onChange={(e) => setRecebeEmail(e.target.checked)} />
            <span>{t("Receber notificações por e-mail", "Receive email notifications")}</span>
          </label>
          <button type="submit" className="botao botao-primario" disabled={salvandoPrefs} style={{ marginTop: '0.7rem' }}>
            {salvandoPrefs ? t("Salvando…", "Saving…") : t("Salvar preferências", "Save preferences")}
          </button>
        </form>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Fase B — Estúdio de mídia (chaves BYO fal.ai / ElevenLabs)          */
/* ------------------------------------------------------------------ */

/** Provedores do Estúdio de mídia — `id` = chave do status (GET de config);
 *  `campo` = nome EXATO do body do PUT /orgs/{id}/midia-keys (contrato
 *  congelado da Fase B — não renomear). */
const PROVEDORES_MIDIA: Array<{
  id: keyof MidiaKeysStatus
  campo: 'falai_api_key' | 'elevenlabs_api_key'
  nome: string
  uso: string
}> = [
  { id: 'falai', campo: 'falai_api_key', nome: 'fal.ai', uso: 'imagem e vídeo' },
  { id: 'elevenlabs', campo: 'elevenlabs_api_key', nome: 'ElevenLabs', uso: 'voz' },
]

const CHAVES_MIDIA_VAZIAS: Record<keyof MidiaKeysStatus, string> = {
  falai: '',
  elevenlabs: '',
}

export function SecaoEstudioMidia({ orgId }: { orgId: number }) {
  const { confirmar, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}`)

  const { t } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [status, setStatus] = useState<MidiaKeysStatus | null>(null)
  const [gerenciado, setGerenciado] = useState(false)
  // Membro comum não gerencia as chaves da org: o GET de config responde 403
  // e a seção inteira some — mesmo RBAC visual do bloco WhatsApp acima.
  const [podeGerenciar, setPodeGerenciar] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [chaves, setChaves] = useState<Record<keyof MidiaKeysStatus, string>>(CHAVES_MIDIA_VAZIAS)
  const [salvando, setSalvando] = useState(false)
  const [limpando, setLimpando] = useState<keyof MidiaKeysStatus | null>(null)

  const carregar = useCallback(async () => {
    try {
      // O status das chaves de mídia vem no MESMO GET de configuração que o
      // WhatsApp (campo `midia`) — booleans apenas, o segredo nunca volta.
      const data = await api.get<NotificacoesOrgSettings>(`/orgs/${orgId}/settings/notificacoes`)
      setStatus(data.midia ?? { falai: false, elevenlabs: false })
      setGerenciado(Boolean(data.gerenciado))
      setPodeGerenciar(true)
      setErro(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setPodeGerenciar(false)
        setErro(null)
      } else {
        setErro(e instanceof ApiError ? e.detail : t("Não foi possível carregar o status das chaves de mídia.", "Could not load media key status."))
      }
    }
  }, [orgId])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    // PUT parcial: SÓ os campos digitados entram no body — campo deixado em
    // branco NÃO mexe na chave já salva; remover é a ação "limpar" ao lado.
    const body: Record<string, string> = {}
    for (const p of PROVEDORES_MIDIA) {
      const v = chaves[p.id].trim()
      if (v) body[p.campo] = v
    }
    if (Object.keys(body).length === 0) {
      falha(t("Digite ao menos uma chave para salvar — campos em branco não alteram nada.", "Enter at least one key to save. Blank fields do not change existing keys."))
      return
    }
    setSalvando(true)
    try {
      const res = await api.put<{ midia: MidiaKeysStatus }>(`/orgs/${orgId}/midia-keys`, body)
      setStatus(res.midia)
      setChaves(CHAVES_MIDIA_VAZIAS)
      sucesso(t("Chaves do Estúdio de mídia salvas — ficam cifradas no servidor e nunca são reexibidas.", "Media studio keys saved. They are encrypted on the server and never displayed again."))
    } catch (err) {
      falha(err instanceof ApiError ? err.detail : t("Não foi possível salvar as chaves do Estúdio de mídia.", "Could not save media studio keys."))
    } finally {
      setSalvando(false)
    }
  }

  async function limpar(p: (typeof PROVEDORES_MIDIA)[number]) {
    if (
      !await confirmar({ titulo: t("Remover chave do provedor", "Remove provider key"), mensagem: t(`Limpar a chave da ${p.nome}? O Estúdio de mídia para de gerar ${p.uso} até uma nova chave ser salva.`, `Clear the ${p.nome} key? Media generation with this provider will stop until a new key is saved.`), acao: t("Remover chave", "Remove key") })
    )
      return
    setLimpando(p.id)
    try {
      // Contrato: string vazia = limpar a chave daquele provedor.
      const res = await api.put<{ midia: MidiaKeysStatus }>(`/orgs/${orgId}/midia-keys`, { [p.campo]: '' })
      setStatus(res.midia)
      setChaves((prev) => ({ ...prev, [p.id]: '' }))
      sucesso(t(`Chave da ${p.nome} removida.`, `${p.nome} key removed.`))
    } catch (err) {
      falha(err instanceof ApiError ? err.detail : t(`Não foi possível limpar a chave da ${p.nome}.`, `Could not clear the ${p.nome} key.`))
    } finally {
      setLimpando(null)
    }
  }

  if (!podeGerenciar) return <section className="cartao"><h2 className="secao-titulo">{t('Serviços de mídia', 'Media services')}</h2>
    <p>{t('O responsável pela empresa administra as conexões de imagem, vídeo e voz. Consulte seu plano em Inteligência ou peça a ele para verificar a disponibilidade.', 'Your company’s administrator manages image, video and voice connections. Check your plan under AI or ask them to confirm availability.')}</p>
  </section>
  if (gerenciado) return <section className="cartao config-ferramentas" aria-label={t('Serviços de mídia do contrato', 'Plan media services')}>
    <h2 className="secao-titulo">{t('Mídia do seu contrato', 'Your plan’s media')}</h2>
    <p className="texto-suave">{t('As conexões são administradas pelo Offiz. Os serviços liberados e o saldo disponível aparecem em Inteligência.', 'Offiz manages these connections. Enabled services and available credit are shown under AI.')}</p>
    <ul className="config-ferramentas-lista">{PROVEDORES_MIDIA.map(p => <li key={p.id}>
      <div><strong>{t(p.uso, p.id === 'falai' ? 'Images and video' : 'Voice and narration')}</strong><span>{p.nome}</span></div>
      <span className={`status-pill ${status?.[p.id] ? 'status-done' : 'status-queued'}`}>{status?.[p.id] ? t('Habilitado no contrato', 'Enabled for this plan') : t('Indisponível nesta configuração', 'Unavailable with current settings')}</span>
    </li>)}</ul>
    <p className="texto-suave">{t('Habilitado indica serviço liberado com conexão cadastrada. Cada geração também depende do saldo e da resposta do fornecedor.', 'Enabled means the service is allowed with a saved connection. Each generation also depends on available credit and the provider’s response.')}</p>
  </section>

  return <>{dialogo}{(
    <section className="cartao">
      <h2 className="secao-titulo">
        <Icone nome="estudio" />
        {t("Estúdio de mídia", "Media studio")}</h2>
      <p className="texto-suave">
        {t('Conecte somente o que precisar. Cada geração é cobrada na sua conta do serviço escolhido.', 'Connect only what you need. Each generation is billed to your account with the selected service.')}</p>
      <p className="texto-suave">{t('Uma chave cadastrada ainda não comprova saldo no fornecedor nem uma geração concluída.', 'A saved key does not confirm provider credit or a completed generation.')}</p>
      <ul className="texto-suave">
        <li>{t('Imagem simples: chave OpenAI, na aba Inteligência.', 'Simple image: OpenAI key in the Intelligence tab.')}</li>
        <li>{t('Imagem elaborada ou vídeo: fal.ai.', 'Elaborate image or video: fal.ai.')}</li>
        <li>{t('Voz e narração: ElevenLabs.', 'Voice and narration: ElevenLabs.')}</li>
      </ul>
      <details className="texto-suave" style={{ marginBottom: '1rem' }}>
        <summary>{t('Sobre as chaves e o login do ChatGPT', 'About keys and ChatGPT login')}</summary>
        <p>{t('O login do ChatGPT no aplicativo não substitui a chave de API para gerar imagens. As chaves ficam criptografadas e não são reexibidas.', 'ChatGPT login in the app does not replace an API key for image generation. Keys are encrypted and never displayed again.')}</p>
        <p>
        {t("As chaves vão para o motor que executa a tarefa: o da ", "Keys are sent to the engine that runs the task, either in the ")}<strong>{t("nuvem", "cloud")}</strong> {t("ou o", "or the organization’s")}{' '}
        <strong>{t("motor local", "local engine")}</strong> {t("desta organização — a máquina que vocês mesmos parearam pelo app. Em qualquer um dos dois, elas só entram nas tarefas do escritório que declara usar mídia, e nunca no motor de outra organização.", "— the computer you paired through the app. In both cases, keys are only provided to tasks in offices that declare media use, never to another organization’s engine.")}</p>
      </details>
      {erro && (
        <p className="alerta alerta-erro">
          {erro}{' '}
          <button type="button" className="botao-texto" onClick={() => carregar()}>
            {t("tentar de novo", "try again")}</button>
        </p>
      )}
      {status === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-linha" />
          <div className="esqueleto esqueleto-linha" />
        </div>
      )}
      {status !== null && (
        <form onSubmit={salvar}>
          {PROVEDORES_MIDIA.map((p) => {
            const configurada = status[p.id]
            return (
              <div key={p.id} className="notif-bloco">
                <div className="notif-bloco-cabecalho">
                  <h3 className="secao-titulo secao-subtitulo">
                    {p.nome} — {t(p.uso, p.id === 'falai' ? 'image and video' : 'voice')}
                  </h3>
                  <span className={`status-pill ${configurada ? 'status-done' : 'status-queued'}`}>
                    {configurada ? t("✓ Configurada", "✓ Configured") : t("Não configurada", "Not configured")}
                  </span>
                </div>
                <label className="campo">
                  <span id={`midia-chave-${orgId}-${p.id}`}>{t("API key da ", "API key for ")}{p.nome}</span>
                  <div className="campo-chave">
                    <input
                      type="password"
                      aria-labelledby={`midia-chave-${orgId}-${p.id}`}
                      value={chaves[p.id]}
                      onChange={(e) => setChaves((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder={
                        configurada
                          ? t("Configurada — digite para substituir (fica cifrada e nunca é reexibida)", "Configured — enter a value to replace it (encrypted and never displayed again)")
                          : t("Cole a chave — fica cifrada no servidor e nunca é reexibida", "Enter the key — encrypted on the server and never displayed again")
                      }
                      autoComplete="off"
                    />
                    {configurada && (
                      <button
                        type="button"
                        className="botao-texto perigo"
                        onClick={() => limpar(p)}
                        disabled={salvando || limpando !== null}
                      >
                        {limpando === p.id ? t("Limpando…", "Clearing…") : t("Limpar", "Clear")}
                      </button>
                    )}
                  </div>
                </label>
              </div>
            )
          })}
          <div className="linha-form notif-acoes">
            <button type="submit" className="botao botao-primario" disabled={salvando || limpando !== null}>
              {salvando ? t("Salvando…", "Saving…") : t("Salvar chaves de mídia", "Save media keys")}
            </button>
          </div>
          <p className="texto-suave">
            {t("Campo deixado em branco não mexe na chave já salva; para remover uma chave, use o", "Leaving a field blank keeps the saved key. To remove a key, click")}{' '}
            <strong>{t("limpar", "clear")}</strong> {t("ao lado dela.", "next to it.")}</p>
        </form>
      )}
    </section>
  )}</>
}

/* ------------------------------------------------------------------ */
/* Fase 5 — Credenciais de tribunais (BYOC)                             */
/* ------------------------------------------------------------------ */

/** `pronto` permite validar o arquivo PFX localmente. Não comprova acesso
 *  ao tribunal. Os outros sistemas apenas armazenam credenciais. */
const TRIBUNAIS_CATALOGO: Array<{ id: string; nome: string; pronto: boolean }> = [
  { id: 'pje', nome: 'PJe', pronto: true },
  { id: 'esaj', nome: 'e-SAJ', pronto: false },
  { id: 'eproc', nome: 'Eproc', pronto: false },
  { id: 'projudi', nome: 'Projudi', pronto: false },
]

type CredencialTribunalComSistema = CredencialTribunal & { sistema: string }
type ItemTribunal = { id: string; nome: string; pronto: boolean; sistema: string; tribunalId: string }
const TRIBUNAL_SLUG = /^(stf|stj|tst|stm|tse|trf[1-6]|trt([1-9]|1[0-9]|2[0-4])|tj[a-z]{2,3}|tre[a-z]{2})$/

const TIPO_CREDENCIAL_LABEL: Record<string, string> = {
  certificado_a1: 'Certificado A1',
  login_senha: 'Login e senha',
}

async function putMultipart<T>(path: string, formData: FormData): Promise<T> {
  return api.putForm<T>(path, formData)
}

/** Formulário de UMA credencial (dentro do item do tribunal): certificado A1
 *  (.pfx + senha) OU login/senha — o backend cifra tudo com Fernet. */
function FormCredencialTribunal({
  orgId,
  tribunal,
  aoSalvar,
  aoCancelar,
}: {
  orgId: number
  tribunal: ItemTribunal
  aoSalvar: () => void
  aoCancelar: () => void
}) {
  const { t } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [tipo, setTipo] = useState<TipoCredencialTribunal>(tribunal.sistema === 'pje' || tribunal.sistema === 'eproc' ? 'certificado_a1' : 'login_senha')
  const [tribunalId, setTribunalId] = useState(TRIBUNAL_SLUG.test(tribunal.tribunalId) ? tribunal.tribunalId : '')
  const [certificado, setCertificado] = useState<File | null>(null)
  const [senhaCertificado, setSenhaCertificado] = useState('')
  const [login, setLogin] = useState('')
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    const destino = tribunalId.trim().toLowerCase()
    if (!TRIBUNAL_SLUG.test(destino)) {
      falha(t("Informe a sigla do tribunal, como TRT2, TRF3 ou TJSP. O sistema (PJe, e-SAJ etc.) não identifica o tribunal.", "Enter the court code, such as TRT2, TRF3 or TJSP. The system (PJe, e-SAJ, etc.) does not identify the court."))
      return
    }
    if (tipo === 'certificado_a1') {
      if (!certificado) {
        falha(t("Selecione o arquivo .pfx do certificado A1.", "Select the A1 certificate .pfx file."))
        return
      }
      if (!senhaCertificado) {
        falha(t("Informe a senha do certificado.", "Enter the certificate password."))
        return
      }
    } else if (!login.trim() || !senha) {
      falha(t("Informe o login e a senha do tribunal.", "Enter the court username and password."))
      return
    }
    setSalvando(true)
    try {
      const fd = new FormData()
      fd.append('sistema', tribunal.sistema)
      fd.append('tipo', tipo)
      if (tipo === 'certificado_a1') {
        fd.append('certificado', certificado!)
        fd.append('senha_certificado', senhaCertificado)
      } else {
        fd.append('login', login.trim())
        fd.append('senha', senha)
      }
      await putMultipart(`/orgs/${orgId}/tribunais/${destino}`, fd)
      sucesso(tribunal.pronto
        ? t(`Credencial do ${tribunal.nome} salva. A validação do certificado é local e não confirma acesso ao tribunal.`, `${tribunal.nome} credential saved. Certificate validation is local and does not confirm court access.`)
        : t(`Credencial do ${tribunal.nome} guardada. A conexão com esse sistema ainda não está implementada.`, `${tribunal.nome} credential stored. The connection to this system is not implemented yet.`))
      aoSalvar()
    } catch (err) {
      falha(err instanceof ApiError ? err.detail : t(`Não foi possível salvar a credencial do ${tribunal.nome}.`, `Could not save the ${tribunal.nome} credential.`))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form className="tribunais-form" onSubmit={salvar}>
      {!tribunal.pronto && <p className="texto-suave">{t("Salvar apenas guarda a credencial criptografada; não conecta ao tribunal nem libera consulta autenticada.", "Saving only stores the encrypted credential; it does not connect to the court or enable authenticated queries.")}</p>}
      <label className="campo">
        <span>{t("Sigla do tribunal", "Court code")}</span>
        <input value={tribunalId} onChange={(e) => setTribunalId(e.target.value)} placeholder="TRT2, TRF3, TJSP…" required readOnly={TRIBUNAL_SLUG.test(tribunal.tribunalId)} />
      </label>
      <label className="campo">
        <span>{t("Tipo de credencial", "Credential type")}</span>
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoCredencialTribunal)}>
          {(tribunal.sistema === 'pje' || tribunal.sistema === 'eproc') && <option value="certificado_a1">{t("Certificado digital A1 (.pfx)", "A1 digital certificate (.pfx)")}</option>}
          {(tribunal.sistema === 'esaj' || tribunal.sistema === 'projudi') && <option value="login_senha">{t("Login e senha do tribunal", "Court username and password")}</option>}
        </select>
      </label>
      {tipo === 'certificado_a1' ? (
        <div className="linha-campos">
          <label className="campo">
            <span>{t("Arquivo do certificado (.pfx)", "Certificate file (.pfx)")}</span>
            <input
              type="file"
              accept=".pfx,.p12"
              onChange={(e) => setCertificado(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="campo">
            <span>{t("Senha do certificado", "Certificate password")}</span>
            <input
              type="password"
              value={senhaCertificado}
              onChange={(e) => setSenhaCertificado(e.target.value)}
              autoComplete="off"
            />
          </label>
        </div>
      ) : (
        <div className="linha-campos">
          <label className="campo">
            <span>{t("Login", "Username")}</span>
            <input
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder={t("CPF ou usuário do tribunal", "CPF or court username")}
              autoComplete="off"
            />
          </label>
          <label className="campo">
            <span>{t("Senha", "Password")}</span>
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" />
          </label>
        </div>
      )}
      <div className="linha-form tribunais-form-rodape">
        <button type="button" className="botao botao-fantasma" onClick={aoCancelar} disabled={salvando}>
          {t("Cancelar", "Cancel")}</button>
        <button type="submit" className="botao botao-primario" disabled={salvando}>
          {salvando ? t("Salvando…", "Saving…") : t("Salvar credencial", "Save credential")}
        </button>
      </div>
    </form>
  )
}

/** Seção "Credenciais de Tribunais" (owner/admin — 403 no GET esconde tudo):
 *  um item por sistema (PJe, e-SAJ, Eproc, Projudi) com status, formulário
 *  de upload, validação local e remoção. Os demais adapters não estão implementados. */
export function SecaoTribunais({ orgId }: { orgId: number }) {
  const { confirmar, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}`)

  const { t, idioma } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [credenciais, setCredenciais] = useState<CredencialTribunalComSistema[] | null>(null)
  const [podeGerenciar, setPodeGerenciar] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [testando, setTestando] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  /** Resultado do último teste NESTA sessão, por tribunal (o GET recarrega
   *  valido/testado_em, mas a mensagem de erro amigável mora aqui). */
  const [resultadoTeste, setResultadoTeste] = useState<Record<string, { ok: boolean; erro?: string }>>({})

  const carregar = useCallback(async () => {
    try {
      const data = await api.get<unknown>(`/orgs/${orgId}/tribunais`)
      setCredenciais(asList<CredencialTribunalComSistema>(data, 'credenciais'))
      setPodeGerenciar(true)
      setErro(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        // Membro comum não gerencia credenciais: a seção inteira some.
        setPodeGerenciar(false)
        setErro(null)
      } else {
        setErro(e instanceof ApiError ? e.detail : t("Não foi possível carregar as credenciais de tribunais.", "Could not load court credentials."))
      }
    }
  }, [orgId])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function testar(tribunal: { id: string; nome: string; pronto: boolean }) {
    if (!tribunal.pronto) return
    setTestando(tribunal.id)
    try {
      const r = await api.post<{ ok: boolean; erro?: string }>(`/orgs/${orgId}/tribunais/${tribunal.id}/testar`)
      setResultadoTeste((prev) => ({ ...prev, [tribunal.id]: r }))
      if (r.ok) sucesso(t(`Certificado do ${tribunal.nome} validado localmente. O acesso ao tribunal ainda depende de uma consulta real.`, `${tribunal.nome} certificate validated locally. Court access still requires an actual query.`))
      else falha(t(`Teste do ${tribunal.nome} falhou: ${r.erro || t("credencial inválida.", "invalid credential.")}`, `${tribunal.nome} test failed: ${r.erro || 'invalid credential.'}`))
      await carregar()
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail : t(`Não foi possível testar a credencial do ${tribunal.nome}.`, `Could not test the ${tribunal.nome} credential.`)
      setResultadoTeste((prev) => ({ ...prev, [tribunal.id]: { ok: false, erro: msg } }))
      falha(msg)
    } finally {
      setTestando(null)
    }
  }

  async function remover(tribunal: { id: string; nome: string }) {
    if (!await confirmar({ titulo: t("Remover credencial do tribunal", "Remove court credential"), mensagem: t(`Remover a credencial do ${tribunal.nome}? O monitor volta a usar só a base pública (DataJud).`, `Remove the ${tribunal.nome} credential? The monitor will only use the public DataJud service again.`), acao: t("Remover credencial", "Remove credential") }))
      return
    setOcupado(true)
    try {
      await api.del(`/orgs/${orgId}/tribunais/${tribunal.id}`)
      sucesso(t(`Credencial do ${tribunal.nome} removida.`, `${tribunal.nome} credential removed.`))
      setResultadoTeste((prev) => {
        const { [tribunal.id]: _descartado, ...resto } = prev
        return resto
      })
      await carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t(`Não foi possível remover a credencial do ${tribunal.nome}.`, `Could not remove the ${tribunal.nome} credential.`))
    } finally {
      setOcupado(false)
    }
  }

  if (!podeGerenciar) return null

  return <>{dialogo}{(
    <section className="cartao">
      <h2 className="secao-titulo">
        <Icone nome="casos" />
        {t("Credenciais de Tribunais", "Court credentials")}</h2>
      <p className="texto-suave">
        {t("As credenciais ficam criptografadas no servidor e nunca são reexibidas. No PJe, a validação verifica o arquivo do certificado localmente; não confirma conexão ou acesso ao tribunal. A consulta autenticada depende do tribunal e precisa ser conferida em uma consulta real.", "Credentials are encrypted on the server and never displayed again. For PJe, validation checks the certificate file locally; it does not confirm court connectivity or access. Authenticated queries depend on the court and must be verified with an actual query.")}{' '}
        <strong>{t("e-SAJ, Eproc e Projudi ainda não têm conexão implementada.", "e-SAJ, Eproc, and Projudi connections are not implemented yet.")}</strong>{' '}{t("Nesses sistemas, salvar apenas guarda a credencial. O monitor continua usando a consulta pública do DataJud, sujeita à disponibilidade e aos dados publicados.", "For those systems, saving only stores the credential. Monitoring continues to use public DataJud queries, subject to availability and published data.")}</p>
      {erro && (
        <p className="alerta alerta-erro">
          {erro}{' '}
          <button type="button" className="botao-texto" onClick={() => carregar()}>
            {t("tentar de novo", "try again")}</button>
        </p>
      )}
      {credenciais === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-linha" />
          <div className="esqueleto esqueleto-linha" />
        </div>
      )}
      {credenciais !== null && (
        <div className="tribunais-lista">
          {TRIBUNAIS_CATALOGO.flatMap((sistema) => [
            ...credenciais.filter((c) => c.sistema === sistema.id).map((cred) => ({
              ...sistema, id: cred.tribunal, nome: `${sistema.nome} · ${cred.tribunal.toUpperCase()}`,
              sistema: sistema.id, tribunalId: cred.tribunal,
            })),
            { ...sistema, id: `novo:${sistema.id}`, sistema: sistema.id, tribunalId: '' },
          ]).map((tribunal) => {
            const cred = credenciais.find((c) => c.tribunal === tribunal.tribunalId) ?? null
            const legadoSemTribunal = cred !== null && !TRIBUNAL_SLUG.test(cred.tribunal)
            const resultado = resultadoTeste[tribunal.id]
            return (
              <div className="tribunais-item" key={tribunal.id}>
                <div className="tribunais-cabecalho">
                  <strong className="tribunais-nome">{tribunal.nome}</strong>
                  {!tribunal.pronto && <span className="status-pill status-running">{t("conexão indisponível", "connection unavailable")}</span>}
                  {cred === null ? (
                    <span className="status-pill status-cancelled">{t("não configurado", "not configured")}</span>
                  ) : !tribunal.pronto || legadoSemTribunal ? (
                    <span className="status-pill status-queued">{t("credencial guardada", "credential stored")}</span>
                  ) : cred.valido === true ? (
                    <span className="status-pill status-done">{t("✓ Certificado validado localmente", "✓ Certificate validated locally")}</span>
                  ) : cred.valido === false ? (
                    <span className="status-pill status-failed">{t("falhou no teste", "test failed")}</span>
                  ) : (
                    <span className="status-pill status-queued">{t("configurado — não testado", "configured — not tested")}</span>
                  )}
                  <div className="tribunais-acoes">
                    {cred !== null && (
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={() => testar(tribunal)}
                        disabled={!tribunal.pronto || legadoSemTribunal || testando !== null || ocupado}
                      >
                        {testando === tribunal.id ? t("Validando…", "Validating…") : t("Validar certificado", "Validate certificate")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="botao botao-fantasma botao-pequeno"
                      onClick={() => setEditando((atual) => (atual === tribunal.id ? null : tribunal.id))}
                      disabled={ocupado}
                    >
                      {editando === tribunal.id ? t("Fechar", "Close") : cred ? t("Substituir", "Replace") : t("Configurar", "Configure")}
                    </button>
                    {cred !== null && (
                      <button
                        type="button"
                        className="botao-texto perigo"
                        onClick={() => remover(tribunal)}
                        disabled={ocupado || testando !== null}
                      >
                        {t("Remover", "Remove")}</button>
                    )}
                  </div>
                </div>
                {legadoSemTribunal && <p className="alerta">{t("Esta credencial antiga foi salva com o nome do sistema, sem identificar o tribunal. Use Substituir e informe a sigla correta para cadastrar uma credencial vinculada ao tribunal. O registro antigo permanece guardado até você removê-lo.", "This older credential was stored under the system name without identifying the court. Use Replace and enter the correct court code to register a court-specific credential. The old record remains stored until you remove it.")}</p>}
                {cred !== null && (
                  <p className="tribunais-meta">
                    {TIPO_CREDENCIAL_LABEL[cred.tipo] ?? cred.tipo}
                    {cred.testado_em && <> {t("· testada em ", "· tested on ")}{formatDataHora(cred.testado_em, idioma)}</>}
                    {!cred.testado_em && cred.criado_em && <> {t("· salva em ", "· saved on ")}{formatDataHora(cred.criado_em, idioma)}</>}
                  </p>
                )}
                {resultado && !resultado.ok && (
                  <p className="alerta alerta-erro tribunais-alerta">
                    {tribunal.pronto
                      ? t(`Teste falhou: ${resultado.erro || t("credencial inválida.", "invalid credential.")}`, `Test failed: ${resultado.erro || 'invalid credential.'}`)
                      : t(`A conexão do ${tribunal.nome} não está implementada. A credencial está apenas guardada.`, `The ${tribunal.nome} connection is not implemented. The credential is only stored.`)}
                  </p>
                )}
                {editando === tribunal.id && (
                  <FormCredencialTribunal
                    orgId={orgId}
                    tribunal={tribunal}
                    aoCancelar={() => setEditando(null)}
                    aoSalvar={() => {
                      setEditando(null)
                      carregar()
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )}</>
}

/* ------------------------------------------------------------------ */
/* Personalização white-label dos prédios                              */
/* ------------------------------------------------------------------ */

/** Campos personalizáveis do prédio (contrato de GET/PUT/DELETE
 *  /predios/{org}/{slug}/personalizacao). */
interface CamposPersonalizacao {
  nome: string
  tema: TemaOffice
  prompts_prontos: PromptPronto[]
}

interface PersonalizacaoResp {
  /** Override salvo da org (null = tudo no padrão). Campos internos null herdam. */
  personalizado: {
    nome: string | null
    tema: Partial<TemaOffice> | null
    prompts_prontos: PromptPronto[] | null
  } | null
  padrao: CamposPersonalizacao
  efetivo: CamposPersonalizacao
  /** Brasão da marca do cliente: um upload que serve a TELA (no lugar do
   *  emoji, no cabeçalho do prédio) e a PEÇA (mora no acervo da marca, onde a
   *  §6 da diretriz manda o agente buscar o logo). */
  brasao?: { existe: boolean; arquivo: string | null; atualizado_em: number | null }
}

const CORES_TEMA = [
  ['cor_primaria', 'Cor primária', 'Primary color'],
  ['cor_acento', 'Cor de acento', 'Accent color'],
  ['cor_fundo', 'Cor de fundo', 'Background color'],
] as const

type CorChave = (typeof CORES_TEMA)[number][0]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/** Bloco expansível de UM prédio: nome exibido, cores e ícone. Os prompts
 *  agênticos são o PRODUTO (feedback do dono, 2026-07) — não aparecem nem se
 *  editam aqui; um override antigo salvo no banco é preservado intacto. */
function BlocoPersonalizacao({
  orgId,
  slug,
  rotulo,
  ao403,
}: {
  orgId: number
  slug: string
  /** Nome efetivo atual do prédio (cabeçalho do bloco antes do GET). */
  rotulo: string
  /** PUT/DELETE devolveu 403 (membro comum) → a seção inteira se esconde. */
  ao403: () => void
}) {
  const { confirmar, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}:${slug}`)

  const { t } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [aberto, setAberto] = useState(false)
  const [dados, setDados] = useState<PersonalizacaoResp | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Form ('' = herda o padrão — o PUT manda null e o catálogo volta a valer).
  const [nome, setNome] = useState('')
  const [cores, setCores] = useState<Record<CorChave, string>>({
    cor_primaria: '',
    cor_acento: '',
    cor_fundo: '',
  })
  const [icone, setIcone] = useState('')
  // Brasão: o object URL da imagem carregada (autenticada) e o input de arquivo.
  const [brasaoUrl, setBrasaoUrl] = useState<string | null>(null)
  const inputBrasao = useRef<HTMLInputElement | null>(null)

  const aplicarResposta = useCallback((r: PersonalizacaoResp) => {
    setDados(r)
    setNome(r.personalizado?.nome ?? '')
    setCores({
      cor_primaria: r.personalizado?.tema?.cor_primaria ?? '',
      cor_acento: r.personalizado?.tema?.cor_acento ?? '',
      cor_fundo: r.personalizado?.tema?.cor_fundo ?? '',
    })
    setIcone(r.personalizado?.tema?.icone ?? '')
    setErro(null)
  }, [])

  const carregar = useCallback(async () => {
    try {
      aplicarResposta(
        await api.get<PersonalizacaoResp>(`/predios/${orgId}/${slug}/personalizacao`),
      )
    } catch (e) {
      setErro(e instanceof ApiError ? e.detail : t("Não foi possível carregar a personalização.", "Could not load appearance settings."))
    }
  }, [orgId, slug, aplicarResposta])

  // Carrega sob demanda, ao abrir o bloco (a org pode ter vários prédios).
  useEffect(() => {
    if (aberto && dados === null) carregar()
  }, [aberto, dados, carregar])

  // Busca a imagem do brasão quando o GET diz que existe. `atualizado_em` na
  // dependência é o que faz a tela trocar a imagem depois de um upload novo —
  // sem ele, o object URL antigo continuaria na tela.
  const brasaoStamp = dados?.brasao?.existe ? dados.brasao.atualizado_em : null
  useEffect(() => {
    if (!brasaoStamp) {
      setBrasaoUrl(null)
      return
    }
    let vivo = true
    let urlLocal: string | null = null
    carregarImagem(`/predios/${orgId}/${slug}/personalizacao/brasao`)
      .then((url) => {
        if (!vivo) {
          URL.revokeObjectURL(url) // desmontou durante o fetch: não vaza o blob
          return
        }
        urlLocal = url
        setBrasaoUrl(url)
      })
      .catch(() => setBrasaoUrl(null))
    return () => {
      vivo = false
      if (urlLocal) URL.revokeObjectURL(urlLocal)
    }
  }, [orgId, slug, brasaoStamp])

  function setCor(chave: CorChave, valor: string) {
    setCores((prev) => ({ ...prev, [chave]: valor }))
  }

  async function enviarBrasao(arquivo: File) {
    setOcupado(true)
    try {
      const fd = new FormData()
      fd.append('arquivo', arquivo)
      await api.putForm(`/predios/${orgId}/${slug}/personalizacao/brasao`, fd)
      await carregar()
      // O cabeçalho do prédio escuta este evento para trocar o logo na hora.
      window.dispatchEvent(new CustomEvent('offiz:personalizacao-mudou'))
      sucesso(t("Brasão atualizado — ele aparece no topo do escritório e nas peças.", "Logo updated. It will appear at the top of the office and in deliverables."))
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível enviar o brasão.", "Could not upload the logo."))
    } finally {
      setOcupado(false)
      if (inputBrasao.current) inputBrasao.current.value = ''
    }
  }

  async function removerBrasao() {
    if (!await confirmar({ titulo: t("Remover logo", "Remove logo"), mensagem: t("Remover o brasão? As peças voltam a sair sem o logo.", "Remove the logo? Deliverables will no longer include it."), acao: t("Remover logo", "Remove logo") })) return
    setOcupado(true)
    try {
      await api.del(`/predios/${orgId}/${slug}/personalizacao/brasao`)
      await carregar()
      window.dispatchEvent(new CustomEvent('offiz:personalizacao-mudou'))
      sucesso(t("Brasão removido.", "Logo removed."))
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível remover o brasão.", "Could not remove the logo."))
    } finally {
      setOcupado(false)
    }
  }

  async function salvar() {
    if (!dados) return
    // Valida antes do PUT: hex quebrado viraria 400 críptico.
    for (const [chave, rotuloCor, corEn] of CORES_TEMA) {
      const v = cores[chave].trim()
      if (v && !HEX_RE.test(v)) {
        falha(t(`${rotuloCor}: use o formato hex #rrggbb (ex.: #2f54c4).`, `${corEn}: use the hex format #rrggbb (e.g. #2f54c4).`))
        return
      }
    }
    setOcupado(true)
    try {
      const tema: Record<string, string> = {}
      for (const [chave] of CORES_TEMA) {
        if (cores[chave].trim()) tema[chave] = cores[chave].trim().toLowerCase()
      }
      if (icone.trim()) tema.icone = icone.trim()
      // Semântica de SUBSTITUIÇÃO do PUT: campo null herda o padrão do Offiz.
      // Prompts: a UI não os edita mais — reenvia o override existente (ou
      // null) para que salvar cores JAMAIS apague um override agêntico salvo.
      const r = await api.put<PersonalizacaoResp>(`/predios/${orgId}/${slug}/personalizacao`, {
        nome: nome.trim() || null,
        tema: Object.keys(tema).length > 0 ? tema : null,
        prompts_prontos: dados.personalizado?.prompts_prontos ?? null,
      })
      aplicarResposta(r)
      sucesso(t("Personalização do escritório salva.", "Office appearance saved."))
      // Avisa quem exibe o prédio (cards, cabeçalho) que a vitrine mudou.
      window.dispatchEvent(new CustomEvent('offiz:personalizacao-mudou'))
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        ao403()
        return
      }
      falha(e instanceof ApiError ? e.detail : t("Não foi possível salvar a personalização.", "Could not save appearance settings."))
    } finally {
      setOcupado(false)
    }
  }

  async function restaurar() {
    if (
      !await confirmar({ titulo: t("Restaurar aparência do escritório", "Restore office appearance"), mensagem: t("Restaurar o padrão do Offiz? Nome, cores e ícone personalizados deste escritório serão descartados.", "Restore Offiz defaults? This office’s custom name, colors, and icon will be discarded."), acao: t("Restaurar padrão", "Restore defaults") })
    )
      return
    setOcupado(true)
    try {
      const r = await api.del<PersonalizacaoResp>(`/predios/${orgId}/${slug}/personalizacao`)
      aplicarResposta(r)
      sucesso(t("Escritório de volta ao padrão do Offiz.", "Office restored to Offiz defaults."))
      window.dispatchEvent(new CustomEvent('offiz:personalizacao-mudou'))
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        ao403()
        return
      }
      falha(e instanceof ApiError ? e.detail : t("Não foi possível restaurar o padrão.", "Could not restore defaults."))
    } finally {
      setOcupado(false)
    }
  }

  // Preview da cor primária: o override em edição, senão o padrão.
  const corPreview =
    (HEX_RE.test(cores.cor_primaria) && cores.cor_primaria) ||
    dados?.padrao.tema.cor_primaria ||
    '#33415c'
  const personalizado = dados?.personalizado != null

  return <>{dialogo}{(
    <div className="pers-bloco">
      <button
        type="button"
        className="pers-bloco-cabecalho"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <span className="pers-swatch" style={{ background: corPreview }} aria-hidden="true" />
        <strong>{dados?.efetivo.nome || rotulo}</strong>
        {personalizado && <span className="status-pill status-done">{t("Personalizado", "Customized")}</span>}
        <span className="pers-bloco-seta" aria-hidden="true">{aberto ? '−' : '+'}</span>
      </button>

      {aberto && (
        <div className="pers-bloco-corpo">
          {erro && (
            <p className="alerta alerta-erro">
              {erro}{' '}
              <button type="button" className="botao-texto" onClick={() => carregar()}>
                {t("tentar de novo", "try again")}</button>
            </p>
          )}
          {dados === null && !erro && (
            <div aria-hidden="true">
              <div className="esqueleto esqueleto-linha" />
              <div className="esqueleto esqueleto-linha" />
            </div>
          )}
          {dados !== null && (
            <>
              <label className="campo">
                <span>{t("Nome exibido", "Display name")}</span>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder={dados.padrao.nome}
                  maxLength={80}
                />
              </label>

              <div className="pers-cores">
                {CORES_TEMA.map(([chave, rotuloCor, corEn]) => (
                  <label className="campo" key={chave}>
                    <span>{t(rotuloCor, corEn)}</span>
                    <span className="pers-cor-inputs">
                      <input
                        type="color"
                        value={
                          (HEX_RE.test(cores[chave]) && cores[chave]) ||
                          dados.padrao.tema[chave] ||
                          '#33415c'
                        }
                        onChange={(e) => setCor(chave, e.target.value)}
                        aria-label={t(`Selecionar ${rotuloCor.toLowerCase()}`, `Select ${corEn.toLowerCase()}`)}
                      />
                      <input
                        type="text"
                        value={cores[chave]}
                        onChange={(e) => setCor(chave, e.target.value)}
                        placeholder={dados.padrao.tema[chave] || '#rrggbb'}
                        maxLength={7}
                      />
                      {cores[chave] && (
                        <button type="button" className="botao-texto" onClick={() => setCor(chave, '')}>
                          {t("padrão", "default")}</button>
                      )}
                    </span>
                  </label>
                ))}
                <label className="campo">
                  <span>{t("Ícone", "Icon")}</span>
                  <input
                    type="text"
                    value={icone}
                    onChange={(e) => setIcone(e.target.value)}
                    placeholder={dados.padrao.tema.icone || '🏢'}
                    maxLength={16}
                    style={{ maxWidth: 90 }}
                  />
                </label>
              </div>

              {/* BRASÃO — um upload, dois usos: entra no lugar do ícone no topo
                  do prédio E é o logo que o escritório usa nas peças (ele mora
                  no acervo da marca, onde a diretriz manda buscar). */}
              <div style={{ marginTop: '1.1rem' }}>
                <strong>{t("Brasão da marca", "Brand logo")}</strong>
                <p className="texto-suave" style={{ margin: '0.2rem 0 0.6rem' }}>
                  {t("Aparece no topo do escritório (no lugar do ícone) e é o logo que ele usa nas peças. PNG, JPG, WEBP ou SVG, até 4 MB.", "Shown at the top of the office in place of the icon, and used in deliverables. PNG, JPG, WEBP, or SVG up to 4 MB.")}</p>
                <div className="linha-form" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                  {brasaoUrl ? (
                    <img
                      src={brasaoUrl}
                      alt={t(`Brasão de ${dados.efetivo.nome}`, `Logo for ${dados.efetivo.nome}`)}
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: 'contain',
                        borderRadius: 10,
                        background: 'var(--bg-1)',
                        padding: 6,
                      }}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      title={t("Sem brasão — o escritório usa o ícone", "No logo — the office uses its icon")}
                      style={{
                        width: 64,
                        height: 64,
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: '1.8rem',
                        borderRadius: 10,
                        background: 'var(--bg-1)',
                      }}
                    >
                      {icone || dados.efetivo.tema.icone || '🏢'}
                    </span>
                  )}
                  <input
                    ref={inputBrasao}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) enviarBrasao(f)
                    }}
                    disabled={ocupado}
                    aria-label={t("Escolher o arquivo do brasão", "Choose logo file")}
                  />
                  {dados.brasao?.existe && (
                    <button type="button" className="botao-texto perigo" onClick={removerBrasao} disabled={ocupado}>
                      {t("Remover brasão", "Remove logo")}</button>
                  )}
                </div>
              </div>

              <div className="linha-form" style={{ marginTop: '0.9rem', flexWrap: 'wrap' }}>
                <button type="button" className="botao botao-primario" onClick={salvar} disabled={ocupado}>
                  {ocupado ? t("Salvando…", "Saving…") : t("Salvar personalização", "Save appearance")}
                </button>
                {personalizado && (
                  <button type="button" className="botao-texto perigo" onClick={restaurar} disabled={ocupado}>
                    {t("Restaurar padrão do Offiz", "Restore Offiz defaults")}</button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )}</>
}

/** Seção "Personalização do escritório" (white-label, owner/admin): um bloco
 *  expansível por prédio da org. Membro comum não vê a seção — mesmo padrão
 *  podeGerenciar da SecaoMembros (aqui o papel vem de GET /predios; um 403 do
 *  PUT/DELETE também esconde). */
function SecaoPersonalizacao({ orgId }: { orgId: number }) {
  const { t } = useIdioma()
  const [predios, setPredios] = useState<Predio[] | null>(null)
  const [podeGerenciar, setPodeGerenciar] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    api
      .get<unknown>('/predios')
      .then((data) => {
        if (!ativo) return
        const meus = asList<Predio>(data, 'predios').filter((p) => p.org_id === orgId)
        setPredios(meus)
        // Só owner/admin edita o white-label (o PUT responde 403 para membro).
        if (meus.length > 0 && meus[0].meu_papel !== 'owner' && meus[0].meu_papel !== 'admin') {
          setPodeGerenciar(false)
        }
        setErro(null)
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof ApiError ? e.detail : t("Não foi possível listar os escritórios da organização.", "Could not list this organization’s offices."))
      })
    return () => {
      ativo = false
    }
  }, [orgId])

  if (!podeGerenciar) return null
  if (predios !== null && predios.length === 0) return null

  return (
    <section className="cartao">
      <h2 className="secao-titulo">{t("Personalização do escritório", "Office appearance")}</h2>
      <p className="texto-suave">
        {t("Renomeie cada escritório e ajuste cores e ícone. Vale só para a vitrine desta organização — o funcionamento interno do escritório não muda.", "Rename each office and adjust its colors and icon. This only changes its appearance in this organization; the office’s internal behavior stays the same.")}</p>
      {erro && <p className="alerta alerta-erro">{erro}</p>}
      {predios === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-linha" />
          <div className="esqueleto esqueleto-linha" />
        </div>
      )}
      {(predios ?? []).map((p) => (
        <BlocoPersonalizacao
          key={p.office_slug}
          orgId={orgId}
          slug={p.office_slug}
          rotulo={p.office?.nome || p.office_slug}
          ao403={() => setPodeGerenciar(false)}
        />
      ))}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Fase 7 — Meus dispositivos (limite de 2 por conta)                   */
/* ------------------------------------------------------------------ */

function SecaoDispositivos() {
  const { confirmar, dialogo } = useConfirmacao(getSessionIdentity() ?? '')

  const { t, idioma } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [dispositivos, setDispositivos] = useState<Dispositivo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [revogando, setRevogando] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    try {
      const data = await api.get<unknown>('/usuarios/me/dispositivos')
      setDispositivos(asList<Dispositivo>(data, 'dispositivos'))
      setErro(null)
    } catch (e) {
      setErro(e instanceof ApiError ? e.detail : t("Não foi possível listar os seus dispositivos.", "Could not list your devices."))
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function revogar(d: Dispositivo) {
    const nome = d.nome || t(`dispositivo #${d.id}`, `device #${d.id}`)
    const aviso = d.atual
      ? t(`Desconectar ${nome}?\n\nEste é o dispositivo DESTA sessão — você será deslogado agora e precisará entrar de novo.`, `Disconnect ${nome}?

This is the device for your CURRENT session. You will be signed out now and will need to sign in again.`)
      : t(`Desconectar ${nome}? A sessão dele termina na hora.`, `Disconnect ${nome}? Its session will end immediately.`)
    if (!await confirmar({ titulo: t("Desconectar dispositivo", "Disconnect device"), mensagem: aviso, acao: t("Desconectar dispositivo", "Disconnect device") })) return
    setRevogando(d.id)
    try {
      await api.del(`/usuarios/me/dispositivos/${d.id}`)
      if (d.atual) {
        // Revogou a própria sessão: tokens locais não valem mais.
        clearTokens()
        window.location.assign('/login')
        return
      }
      sucesso(`${nome} desconectado.`)
      await carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível desconectar o dispositivo.", "Could not disconnect the device."))
    } finally {
      setRevogando(null)
    }
  }

  return <>{dialogo}{(
    <section className="cartao">
      <h2 className="secao-titulo">
        <Icone nome="celular" />
        {t("Meus dispositivos", "My devices")}</h2>
      <p className="texto-suave">
        {t("A sua conta pode ficar conectada em ", "Your account can be signed in on ")}<strong>{t("até 2 dispositivos", "up to 2 devices")}</strong> {t("ao mesmo tempo. Para entrar em um terceiro, desconecte um dos daqui primeiro. Vale só para você — cada pessoa gerencia os próprios dispositivos.", "at once. To sign in on a third device, disconnect one first. This applies only to you; each person manages their own devices.")}</p>
      {erro && (
        <p className="alerta alerta-erro">
          {erro}{' '}
          <button type="button" className="botao-texto" onClick={() => carregar()}>
            {t("tentar de novo", "try again")}</button>
        </p>
      )}
      {dispositivos === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-linha" />
          <div className="esqueleto esqueleto-linha" />
        </div>
      )}
      {dispositivos !== null && dispositivos.length === 0 && (
        <p className="texto-suave">{t("Nenhum dispositivo registrado ainda.", "No devices registered yet.")}</p>
      )}
      {dispositivos !== null && dispositivos.length > 0 && (
        <ul className="devices-lista">
          {dispositivos.map((d) => (
            <li key={d.id} className="devices-item">
              <Icone nome="computador" className="devices-icone" />
              <span className="devices-info">
                <span className="devices-nome">
                  {d.nome || t(`Dispositivo #${d.id}`, `Device #${d.id}`)}
                  {d.atual && <span className="status-pill status-done devices-atual">{t("este dispositivo", "this device")}</span>}
                </span>
                <span className="devices-meta">
                  {d.criado_em && <>{t("conectado em ", "connected on ")}{formatData(d.criado_em, idioma)}</>}
                  {d.ultimo_uso_em && <> {t("· último uso ", "· last used ")}{tempoRelativo(d.ultimo_uso_em, idioma)}</>}
                </span>
              </span>
              <button
                type="button"
                className="botao-texto perigo"
                onClick={() => revogar(d)}
                disabled={revogando !== null}
              >
                {revogando === d.id ? t("Desconectando…", "Disconnecting…") : t("Desconectar", "Disconnect")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )}</>
}

/* ------------------------------------------------------------------ */
/* Fase 7 — Meus dados (LGPD): exportar + excluir conta                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Fase 7 — Chaves MCP (plugam as tools jurídicas no Claude do cliente) */
/* ------------------------------------------------------------------ */

/** Extrai a chave em claro da resposta do POST (tolerante a nomes). */
function chaveCriadaDe(res: unknown): McpKeyCriada | null {
  if (!res || typeof res !== 'object') return null
  const obj = res as Record<string, unknown>
  const candidato = (obj.mcp_key ?? obj.chave ?? obj) as Record<string, unknown>
  const key = candidato.key ?? candidato.plaintext ?? candidato.token
  if (typeof key !== 'string' || !key) return null
  return {
    id: typeof candidato.id === 'number' ? candidato.id : 0,
    key,
    key_prefix: typeof candidato.key_prefix === 'string' ? candidato.key_prefix : key.slice(0, 12),
    criado_em: typeof candidato.criado_em === 'string' ? candidato.criado_em : null,
    nome: typeof candidato.nome === 'string' ? candidato.nome : null,
  }
}

export function SecaoMcpKeys({ orgId }: { orgId: number }) {
  const { confirmar, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}`)

  const { t, idioma } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [keys, setKeys] = useState<McpKey[] | null>(null)
  const [podeGerenciar, setPodeGerenciar] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)
  const [revogando, setRevogando] = useState<number | null>(null)
  /** A chave em claro SÓ existe aqui, logo após o POST — modal de cópia. */
  const [chaveNova, setChaveNova] = useState<McpKeyCriada | null>(null)
  const [copiada, setCopiada] = useState(false)
  const [copiaManual, setCopiaManual] = useState(false)
  const campoChaveRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!chaveNova) return
    const focoAnterior = document.activeElement instanceof HTMLElement ? document.activeElement : null
    campoChaveRef.current?.focus()
    return () => { if (focoAnterior?.isConnected) focoAnterior.focus() }
  }, [chaveNova])

  const carregar = useCallback(async () => {
    try {
      const data = await api.get<unknown>(`/orgs/${orgId}/mcp-keys`)
      setKeys(asList<McpKey>(data, 'mcp_keys', 'keys', 'chaves'))
      setPodeGerenciar(true)
      setErro(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        // Membro comum não gerencia chaves MCP: a seção some sem alarde.
        setPodeGerenciar(false)
        setErro(null)
      } else {
        setErro(e instanceof ApiError ? e.detail : t("Não foi possível listar as chaves MCP.", "Could not list MCP keys."))
      }
    }
  }, [orgId])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function criar() {
    setCriando(true)
    try {
      const res = await api.post<unknown>(`/orgs/${orgId}/mcp-keys`)
      const criada = chaveCriadaDe(res)
      if (criada) {
        setChaveNova(criada)
        setCopiada(false)
        setCopiaManual(false)
      } else {
        falha(t("A chave foi criada, mas a resposta não trouxe o valor — revogue-a e crie outra.", "The key was created, but its value was missing from the response. Revoke it and create another."))
      }
      await carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível criar a chave MCP.", "Could not create the MCP key."))
    } finally {
      setCriando(false)
    }
  }

  async function copiarChave() {
    if (!chaveNova) return
    try {
      await navigator.clipboard.writeText(chaveNova.key)
      setCopiada(true)
      sucesso(t("Chave MCP copiada.", "MCP key copied."))
    } catch {
      setCopiaManual(true)
      campoChaveRef.current?.focus()
      campoChaveRef.current?.select()
    }
  }

  async function revogar(k: McpKey) {
    if (
      !await confirmar({ titulo: t("Revogar chave de acesso", "Revoke access key"), mensagem: t(`Revogar a chave ${k.key_prefix}…? Os Claude que a usam perdem o acesso às tools jurídicas na hora.`, `Revoke key ${k.key_prefix}…? Clients using it will immediately lose access to the legal tools.`), acao: t("Revogar chave", "Revoke key") })
    )
      return
    setRevogando(k.id)
    try {
      await api.del(`/orgs/${orgId}/mcp-keys/${k.id}`)
      sucesso(t("Chave MCP revogada.", "MCP key revoked."))
      await carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível revogar a chave.", "Could not revoke the key."))
    } finally {
      setRevogando(null)
    }
  }

  if (!podeGerenciar) return null

  return <>{dialogo}{(
    <section className="cartao">
      <div className="secao-cabecalho">
        <h2 className="secao-titulo">
          <Icone nome="conector" />
          {t("Chaves MCP", "MCP keys")}</h2>
        <button type="button" className="botao botao-primario botao-pequeno" onClick={criar} disabled={criando}>
          {criando ? (
            t("Criando…", "Creating…")
          ) : (
            <>
              <Icone nome="mais" tamanho={15} />
              {t("Criar chave", "Create key")}</>
          )}
        </button>
      </div>
      <p className="texto-suave">
        {t("Uma chave MCP pluga as ", "An MCP key connects ")}<strong>{t("tools jurídicas do Offiz", "Offiz’s legal tools")}</strong> {t("(casos, peças, monitor) direto no Claude de quem a usar — no app, no Claude Code ou em qualquer cliente MCP. A chave aparece", "(cases, documents, and monitoring) directly to the user’s Claude app, Claude Code, or any MCP client. The full key appears")}{' '}
        <strong>{t("uma única vez", "only once")}</strong>{t(", na criação: copie e guarde. Revogar corta o acesso na hora.", ", when created: copy it and store it safely. Revoking it removes access immediately.")}</p>
      {erro && (
        <p className="alerta alerta-erro">
          {erro}{' '}
          <button type="button" className="botao-texto" onClick={() => carregar()}>
            {t("tentar de novo", "try again")}</button>
        </p>
      )}
      {keys === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-linha" />
        </div>
      )}
      {keys !== null && keys.length === 0 && (
        <p className="texto-suave">{t("Nenhuma chave criada ainda.", "No keys created yet.")}</p>
      )}
      {keys !== null && keys.length > 0 && (
        <div className="tabela-scroll">
          <table className="tabela">
            <thead>
              <tr>
                <th>{t("Chave", "Key")}</th>
                <th>{t("Criada em", "Created on")}</th>
                <th aria-label={t("Ações", "Actions")} />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>
                    <code className="mcpk-prefixo">{k.key_prefix}…</code>
                    {k.nome && <span className="texto-suave"> · {k.nome}</span>}
                  </td>
                  <td>{k.criado_em ? `${formatData(k.criado_em, idioma)} · ${tempoRelativo(k.criado_em, idioma)}` : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="botao-texto perigo"
                      onClick={() => revogar(k)}
                      disabled={revogando !== null}
                    >
                      {revogando === k.id ? t("Revogando…", "Revoking…") : t("Revogar", "Revoke")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {chaveNova && (
        <div className="mcpk-overlay" role="dialog" aria-modal="true" aria-label={t("Nova chave MCP", "New MCP key")} onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); setChaveNova(null) }
          if (e.key !== 'Tab') return
          const campos = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('textarea, button'))
          const primeiro = campos[0], ultimo = campos[campos.length - 1]
          if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo?.focus() }
          else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro?.focus() }
        }}>
          <div className="mcpk-modal">
            <h3 className="secao-titulo">
              <Icone nome="chave" />
              {t("Chave criada — copie agora", "Key created — copy it now")}</h3>
            <p className="texto-suave">
              {t("Por segurança, esta é a ", "For security, this is the ")}<strong>{t("única vez", "only time")}</strong> {t("que a chave aparece por inteiro. Depois de fechar, só o prefixo ", "the entire key is displayed. After you close this dialog, only the prefix ")}<code>{chaveNova.key_prefix}…</code> {t("fica visível.", "remains visible.")}</p>
            <div className="mcpk-chave-caixa">
              <textarea className="config-chave-copiavel" aria-label={t('Chave MCP criada', 'Created MCP key')} readOnly value={chaveNova.key} ref={campoChaveRef} rows={2} onFocus={e => e.currentTarget.select()} />
              <button type="button" className="botao botao-primario botao-pequeno" onClick={copiarChave}>
                {copiada ? (
                  <>
                    <Icone nome="visto" tamanho={15} />
                    {t("Copiada", "Copied")}</>
                ) : (
                  <>
                    <Icone nome="copiar" tamanho={15} />
                    {t("Copiar", "Copy")}</>
                )}
              </button>
            </div>
            {copiaManual && <p role="status" className="texto-suave">{t('A cópia automática não está disponível. A chave está selecionada: copie pelo teclado ou pelo menu do campo.', 'Automatic copying is unavailable. The key is selected: copy it with your keyboard or the field’s menu.')}</p>}
            <div className="mcpk-modal-rodape">
              <span className="texto-suave">{t("Guarde num gerenciador de senhas ou no cliente MCP.", "Store it in a password manager or your MCP client.")}</span>
              <button
                type="button"
                className="botao botao-fantasma botao-pequeno"
                onClick={() => setChaveNova(null)}
              >
                {t("Fechar", "Close")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )}</>
}

/* ------------------------------------------------------------------ */
/* Offiz Desktop — download dentro da Sala das máquinas                 */
/* ------------------------------------------------------------------ */

const APP_INSTALL_URL =
  (import.meta.env.VITE_APP_INSTALL_URL as string) ||
  'https://github.com/evertonsjjj/offiz-app/releases/tag/v0.2.15'

/** Morava na página de prédios; veio para cá no enxugamento (a página de
 *  prédios é SÓ os escritórios). Dentro do próprio app seria redundante. */
export function SecaoAppDesktop({ gerenciado = false }: { gerenciado?: boolean }) {
  const { t } = useIdioma()
  if (ehDesktop) return null
  return (
    <section className="cartao">
      <h2 className="secao-titulo">
        <Icone nome="computador" />
        Offiz Desktop
      </h2>
      {gerenciado ? <div className="texto-suave">
        <p>{t('Use sua conta do ChatGPT com Codex ou do Claude com Claude Code no aplicativo para computador. Conversas e tarefas locais usam os limites da conta escolhida. No navegador, o Offiz usa a API e desconta do saldo do seu plano.', 'Use your ChatGPT account with Codex or your Claude account with Claude Code in the desktop app. Local chats and tasks use the selected account’s limits. In a browser, Offiz uses the API and deducts usage from your plan allowance.')}</p>
        <p>No modo local, apenas imagens e vídeos pelo fal.ai e narração pelo ElevenLabs consomem o saldo do Offiz, quando necessários. O aplicativo precisa ficar aberto e conectado; tarefas locais aguardam o computador, sem mudar para a API paga da OpenAI.</p>
        <ol><li>Instale o aplicativo e entre com seu login do Offiz.</li><li>Em Inteligência, conecte este escritório e selecione OpenAI Codex ou Claude Code.</li><li>Conecte sua conta no serviço escolhido e ligue o motor local.</li></ol>
        <details><summary>Qual conta posso usar?</summary><p>Codex: ChatGPT Free ou superior, conforme os limites e modelos disponíveis no seu plano. Claude Code: Claude Pro ou superior; o plano gratuito não inclui acesso. As assinaturas são contratadas separadamente do Offiz.</p><p><a href="https://learn.chatgpt.com/docs/pricing" target="_blank" rel="noreferrer">Planos do Codex</a> · <a href="https://code.claude.com/docs/en/setup#authenticate" target="_blank" rel="noreferrer">Planos do Claude Code</a></p></details>
      </div> : <p className="texto-suave">
        {t("Instale no seu computador — mesmo login, mesmos escritórios. Com o app, as tarefas podem usar o login local do Claude Code ou Codex, conforme o motor escolhido. Chat e sabatina também usam a assinatura no app 0.2.9+ em modo local. No navegador, usam a chave de API.", "Install on your computer with the same login and offices. Tasks can use the local Claude Code or Codex login, depending on the selected engine. Chat and onboarding also use your subscription in app 0.2.9+ in local mode. In a browser, they use the API key.")}</p>}
      <div className="linha-form" style={{ flexWrap: 'wrap' }}>
        <a
          className="botao botao-primario botao-pequeno"
          href={`${appDownloadWindowsBase}/Offiz-Setup.exe`}
        >
          <Icone nome="baixar" tamanho={15} />
          {t("Instalador Windows (.exe)", "Windows installer (.exe)")}</a>
        <DownloadsWindowsZIP />
        <a className="botao-texto" href={APP_INSTALL_URL} target="_blank" rel="noreferrer">
          {t("como instalar →", "installation guide →")}</a>
      </div>
      <DownloadsMac />
    </section>
  )
}


/* ------------------------------------------------------------------ */
/* Configurações por categoria: consultas sob demanda, sem perder      */
/* rascunhos das categorias já abertas nesta organização.               */
type CategoriaConfig = 'ia' | 'midia' | 'empresa' | 'dados' | 'conta'
function categoriaDoHash(): CategoriaConfig {
  const hash = window.location.hash.slice(1)
  return ['ia', 'midia', 'empresa', 'dados', 'conta'].includes(hash) ? hash as CategoriaConfig : 'ia'
}

export function ConfigOrgCorpo({ orgId, embutido = false }: { orgId: number; embutido?: boolean }) {
  // Empresa ou login novos não recebem chaves digitadas e links da conta anterior.
  return <ConfigOrgConteudo key={`${getSessionIdentity()}:${orgId}`} orgId={orgId} embutido={embutido} />
}

function ConfigOrgConteudo({
  orgId,
  embutido = false,
}: {
  orgId: number
  /** Dentro do painel da Mesa: sem breadcrumb e sem moldura de página. */
  embutido?: boolean
}) {
  const { t } = useIdioma()
  const [categoria, setCategoria] = useState<CategoriaConfig>(categoriaDoHash)
  const [visitadas, setVisitadas] = useState<CategoriaConfig[]>(() => [categoriaDoHash()])
  const selecionarCategoria = useCallback((nova: CategoriaConfig) => {
    setCategoria(nova)
    setVisitadas(atuais => atuais.includes(nova) ? atuais : [...atuais, nova])
  }, [])
  useEffect(() => {
    const aoMudarHash = () => selecionarCategoria(categoriaDoHash())
    window.addEventListener('hashchange', aoMudarHash)
    return () => window.removeEventListener('hashchange', aoMudarHash)
  }, [selecionarCategoria])
  const categorias = [['ia', t('Inteligência', 'AI')], ['midia', t('Imagem, vídeo e voz', 'Images, video and voice')], ['empresa', t('Empresa e equipe', 'Company and team')], ['dados', t('Dados e conexões', 'Data and connections')], ['conta', t('Minha conta', 'My account')]]

  // Perfil da org (via /predios): quais offices ela tem e se está no modo
  // simples — as seções irrelevantes nem aparecem. "Simplificar o cowork":
  // Tribunais e chaves MCP são ferramentas do jurídico; BYOD é operador raiz.
  const [officesDaOrg, setOfficesDaOrg] = useState<string[] | null>(null)
  const [contratoGerenciado, setContratoGerenciado] = useState<boolean | null>(null)
  const [erroContrato, setErroContrato] = useState<string | null>(null)
  const [versaoContrato, setVersaoContrato] = useState(0)

  useEffect(() => {
    let ativo = true
    setContratoGerenciado(null)
    setErroContrato(null)
    api.get<{ tipo: string }>(`/orgs/${orgId}/contrato`).then(c => {
      if (!ativo) return
      if (c.tipo !== 'pf_gerenciado' && c.tipo !== 'byok') throw new Error('Modalidade não reconhecida')
      setContratoGerenciado(c.tipo === 'pf_gerenciado')
    }).catch(e => {
      if (ativo) setErroContrato(e instanceof ApiError ? e.detail : t('Não foi possível confirmar a modalidade de IA desta empresa.', 'Could not confirm this company’s AI plan.'))
    })
    return () => { ativo = false }
  }, [orgId, versaoContrato])

  useEffect(() => {
    let ativo = true
    api
      .get<unknown>('/predios')
      .then((data) => {
        if (!ativo) return
        const meus = asList<Predio>(data, 'predios').filter((p) => p.org_id === orgId)
        setOfficesDaOrg(meus.map((p) => p.office_slug))
      })
      .catch(() => {
        // Sem a lista, não esconde nada — falha de rede não pode sumir com config.
        if (ativo) setOfficesDaOrg(null)
      })
    return () => {
      ativo = false
    }
  }, [orgId])

  const temJuris = officesDaOrg === null || officesDaOrg.includes('juris')
  const aguardandoPlano = erroContrato ? <section className="cartao config-plano-erro" role="alert">
    <h2 className="secao-titulo">{t('Não foi possível carregar seu plano', 'Could not load your plan')}</h2>
    <p>{erroContrato}</p><p className="texto-suave">{t('Confirme o plano para ver as conexões e os ajustes disponíveis.', 'Confirm your plan to see available connections and settings.')}</p>
    <button type="button" className="botao botao-fantasma" onClick={() => setVersaoContrato(v => v + 1)}>{t('Tentar novamente', 'Try again')}</button>
  </section> : <section className="cartao" role="status"><p>{t('Carregando seu plano…', 'Loading your plan…')}</p></section>

  return (
    <div className={`${embutido ? 'config-embutida' : 'pagina'} config-organizacao`}>
      {!embutido && (
        <nav className="predio-breadcrumb">
          <Link to="/app">{t('Início', 'Home')}</Link>
          <span aria-hidden="true">/</span>
          <span>{t('Configurações da organização', 'Organization settings')}</span>
        </nav>
      )}
      <div className="pagina-cabecalho">
        <div>
          <h1>{t('Configurações da organização', 'Organization settings')}</h1>
          <p className="pagina-sub">{t('Escolha o que deseja ajustar. Você pode voltar à conversa a qualquer momento.', 'Choose what to adjust. You can return to the conversation at any time.')}</p>
        </div>
      </div>
      <nav className="config-categorias" aria-label={t('Categorias de configuração', 'Settings categories')}>
        {categorias.map(([id, nome]) => <button type="button" key={id} aria-pressed={categoria === id} aria-controls={`config-categoria-${id}`} onClick={() => selecionarCategoria(id as CategoriaConfig)}>{nome}</button>)}
      </nav>
      <div id="config-categoria-ia" className="config-grid" hidden={categoria !== 'ia'}>
        {visitadas.includes('ia') && (contratoGerenciado === true ? <><MeuContrato orgId={orgId} /><SecaoAppDesktop gerenciado /><SecaoMotorLocal orgId={orgId} gerenciado /></> : contratoGerenciado === false ? <>
          {temMotorBridge() && <SecaoMotorLocal orgId={orgId} />}
          {temMotorBridge() ? <details className="cartao"><summary>{t('Conexão por chave de API', 'API key connection')}</summary><SecaoMotorIA orgId={orgId} /></details> : <><SecaoMotorIA orgId={orgId} /><SecaoAppDesktop /><SecaoMotorLocal orgId={orgId} /></>}
          <SecaoUso orgId={orgId} />
        </> : aguardandoPlano)}
        {visitadas.includes('ia') && contratoGerenciado !== null && <ConsumoIA key={orgId} endpoint={`/orgs/${orgId}/uso/historico`} mensal />}
      </div>
      <div id="config-categoria-midia" className="config-grid" hidden={categoria !== 'midia'}>
        {visitadas.includes('midia') && (contratoGerenciado === null ? aguardandoPlano : <SecaoEstudioMidia orgId={orgId} />)}
      </div>
      <div id="config-categoria-empresa" className="config-grid" hidden={categoria !== 'empresa'}>{visitadas.includes('empresa') && <><SecaoMembros orgId={orgId} /><SecaoPersonalizacao orgId={orgId} /></>}</div>
      <div id="config-categoria-dados" className="config-grid" hidden={categoria !== 'dados'}>{visitadas.includes('dados') && <>
        {contratoGerenciado === true ? <section className="cartao"><h2 className="secao-titulo">{t('Dados cuidados pelo Offiz', 'Data managed by Offiz')}</h2><p>{t('Seu plano inclui o armazenamento dos arquivos e o banco de dados administrados pelo Offiz. Você não precisa contratar ou configurar esses serviços.', 'Your plan includes file storage and a database managed by Offiz. You do not need to subscribe to or configure these services.')}</p></section> : contratoGerenciado === false ? <SecaoDatabase orgId={orgId} /> : aguardandoPlano}
        {temJuris && <><SecaoTribunais orgId={orgId} /><SecaoMcpKeys orgId={orgId} /></>}
      </>}</div>
      <div id="config-categoria-conta" className="config-grid" hidden={categoria !== 'conta'}>{visitadas.includes('conta') && <>
        <section className="cartao"><h2 className="secao-titulo">{t('Idioma', 'Language')}</h2><SeletorIdioma /></section>
        <SecaoNotificacoes /><SecaoDispositivos />
        <details className="cartao"><summary>{t('Exportar dados ou excluir minha conta', 'Export data or delete my account')}</summary><SecaoLgpd /></details>
      </>}</div>
    </div>
  )
}


export default function ConfigOrgPage() {
  const { id } = useParams<{ id: string }>()
  return <ConfigOrgCorpo orgId={Number(id)} />
}
