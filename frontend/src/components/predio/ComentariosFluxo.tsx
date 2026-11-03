import { useIdioma, type Traduzir } from '../../lib/i18n'
/**
 * COMENTÁRIOS ANCORADOS NO "COMO FOI FEITA" (07/09/2026 — pedido do Felipe na
 * demo do Clube Aurora: "se puder fazer comentários como se fosse um docs, isso
 * tudo vira feedback específico").
 *
 * O dono comenta em cima de um ponto exato do fluxo — uma fonte, uma cena, o
 * prompt, uma etapa do raciocínio, o áudio, o filme — e cada comentário tem
 * duas saídas: VIRA TAREFA (a retomada com o pedido já escrito e a âncora
 * citada) ou VIRA LIÇÃO (entra no conhecimento do escritório, como a recusa).
 * Resolver fecha sem ação. A Mesa lista os abertos.
 *
 * Três peças, para os dois quadros (peça e trabalho) e para a Mesa:
 *   useComentarios  — carrega/cria/age;
 *   BotaoComentar   — o balão em cada nó, com o formulário inline;
 *   ListaComentarios — a lista com as ações.
 */

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { Icone } from '../Icone'
import { useToasts } from '../Toasts'
import { formatDataHora } from '../../lib/format'

export type AncoraTipo = 'fonte' | 'cena' | 'prompt' | 'etapa' | 'audio' | 'final' | 'trabalho'
export type Ancora = { tipo: AncoraTipo; ref: string; rotulo: string }

export type Comentario = {
  id: number
  peca_slug?: string | null
  job_id?: number | null
  ancora: Ancora
  texto: string
  autor_nome: string
  criado_em?: string | null
  estado: 'aberto' | 'tarefa' | 'licao' | 'resolvido'
  destino_job_id?: number | null
}

function ROTULO_ESTADO_local(tr: Traduzir): Record<Comentario['estado'], string> { return {
  aberto: tr("aberto","open"),
  tarefa: tr("virou tarefa","became a task"),
  licao: tr("virou lição","saved as lesson"),
  resolvido: tr("resolvido","resolved"),
} }

function ROTULO_ANCORA_local(tr: Traduzir): Record<AncoraTipo, string> { return {
  fonte: tr("fonte","source"),
  cena: tr("cena","scene"),
  prompt: 'prompt',
  etapa: tr("etapa","step"),
  audio: tr("áudio","audio"),
  final: tr("filme","video"),
  trabalho: tr("trabalho","task"),
} }

export function useComentarios(
  orgId: number,
  slug: string,
  alvo: { peca?: string; job?: number; estado?: string },
) {
  const { t: tr } = useIdioma()
  const base = `/predios/${orgId}/${slug}/estudio/comentarios`
  const [lista, setLista] = useState<Comentario[]>([])
  const [erro, setErro] = useState('')
  const { sucesso, falha } = useToasts()

  const recarregar = useCallback(() => {
    const q = new URLSearchParams()
    if (alvo.peca) q.set('peca', alvo.peca)
    if (alvo.job != null) q.set('job_id', String(alvo.job))
    if (alvo.estado) q.set('estado', alvo.estado)
    const qs = q.toString()
    api
      .get<{ comentarios: Comentario[] }>(`${base}${qs ? `?${qs}` : ''}`)
      .then((r) => {
        setLista(r.comentarios)
        setErro('')
      })
      .catch((e) => setErro(e instanceof ApiError ? e.detail : tr("Não consegui carregar os comentários.", "I could not load the comments.")))
  }, [base, alvo.peca, alvo.job, alvo.estado])

  useEffect(() => {
    recarregar()
  }, [recarregar])

  const criar = useCallback(
    async (ancora: Ancora, texto: string) => {
      try {
        await api.post<Comentario>(base, {
          texto,
          ancora,
          peca_slug: alvo.peca ?? null,
          job_id: alvo.job ?? null,
        })
        sucesso(tr("Comentário guardado — vira tarefa ou lição quando você quiser.", "Comment saved. Turn it into a task or lesson whenever you want."))
        recarregar()
        return true
      } catch (e) {
        falha(e instanceof ApiError ? e.detail : tr("Não consegui guardar o comentário.", "I could not save the comment."))
        return false
      }
    },
    [base, alvo.peca, alvo.job, recarregar, sucesso, falha],
  )

  const agir = useCallback(
    async (id: number, acao: 'tarefa' | 'licao' | 'resolver') => {
      try {
        const r = await api.post<{ ok: boolean; job?: { id: number; titulo?: string } }>(
          `${base}/${id}/${acao}`,
          acao === 'tarefa' ? {} : undefined,
        )
        if (acao === 'tarefa') sucesso(tr(`Tarefa nº ${r.job?.id} criada — acompanhe na placa.`, `Task no. ${r.job?.id} created. Follow its progress in the panel.`))
        else if (acao === 'licao') sucesso(tr("Virou lição do escritório.", "Saved as an office lesson."))
        else sucesso(tr("Comentário resolvido.", "Comment resolved."))
        recarregar()
      } catch (e) {
        falha(e instanceof ApiError ? e.detail : tr("Não consegui aplicar.", "I could not apply this."))
      }
    },
    [base, recarregar, sucesso, falha],
  )

  const apagar = useCallback(
    async (id: number) => {
      try {
        await api.del(`${base}/${id}`)
        recarregar()
      } catch (e) {
        falha(e instanceof ApiError ? e.detail : tr("Não consegui apagar.", "I could not delete this."))
      }
    },
    [base, recarregar, falha],
  )

  return { lista, erro, recarregar, criar, agir, apagar }
}

/** O balão em cada nó do quadro. Abre um formulário inline; o texto vai com a
 *  âncora — o comentário nasce preso ao ponto exato. */
export function BotaoComentar({
  ancora,
  quantos = 0,
  aoCriar,
}: {
  ancora: Ancora
  quantos?: number
  aoCriar: (ancora: Ancora, texto: string) => Promise<boolean>
}) {
  const { t: tr } = useIdioma()
  const ROTULO_ANCORA = ROTULO_ANCORA_local(tr)
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar() {
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true)
    const ok = await aoCriar(ancora, t)
    setEnviando(false)
    if (ok) {
      setTexto('')
      setAberto(false)
    }
  }

  return (
    <span className="coment-botao">
      <button
        type="button"
        className={`botao-texto${quantos > 0 ? ' coment-tem' : ''}`}
        title={tr(`Comentar aqui (${ROTULO_ANCORA[ancora.tipo]}: ${ancora.rotulo || ancora.ref}) — vira feedback específico`, `Comment here (${ROTULO_ANCORA[ancora.tipo]}: ${ancora.rotulo || ancora.ref}) to give specific feedback`)}
        aria-label={tr(`Comentar em ${ancora.rotulo || ancora.ref}`, `Comment on ${ancora.rotulo || ancora.ref}`)}
        onClick={() => setAberto((v) => !v)}
      >
        <Icone nome="comentario" tamanho={15} />
        {quantos > 0 && <b className="coment-contador">{quantos}</b>}
      </button>
      {aberto && (
        <div className="coment-form" role="dialog" aria-label={tr(`Comentar em ${ancora.rotulo || ancora.ref}`, `Comment on ${ancora.rotulo || ancora.ref}`)}>
          <small className="texto-suave">
            {ROTULO_ANCORA[ancora.tipo]}: <b>{ancora.rotulo || ancora.ref}</b>
          </small>
          <textarea
            autoFocus
            rows={3}
            maxLength={2000}
            placeholder={tr("O que está errado, o que faltou ou o que você quer diferente aqui", "What is wrong, missing, or should be different here")}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAberto(false)
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void enviar()
            }}
          />
          <div className="coment-form-acoes">
            <button type="button" className="botao botao-pequeno" disabled={!texto.trim() || enviando} onClick={() => void enviar()}>
              {tr("Comentar", "Comment")}</button>
            <button type="button" className="botao-texto" onClick={() => setAberto(false)}>
              {tr("cancelar", "cancel")}</button>
          </div>
        </div>
      )}
    </span>
  )
}

/** A lista dos comentários com as duas saídas (tarefa / lição) e o resolver. */
export function ListaComentarios({
  lista,
  agir,
  apagar,
  titulo: tituloDefinido,
  aoAbrirJob,
}: {
  lista: Comentario[]
  agir: (id: number, acao: 'tarefa' | 'licao' | 'resolver') => Promise<void>
  apagar?: (id: number) => Promise<void>
  titulo?: string
  aoAbrirJob?: (jobId: number) => void
}) {
  const { t: tr, idioma } = useIdioma()
  const ROTULO_ANCORA = ROTULO_ANCORA_local(tr)
  const ROTULO_ESTADO = ROTULO_ESTADO_local(tr)
  const [mostrarFechados, setMostrarFechados] = useState(false)
  const titulo = tituloDefinido ?? tr('Comentários', 'Comments')
  const abertos = lista.filter((c) => c.estado === 'aberto')
  const fechados = lista.filter((c) => c.estado !== 'aberto')
  if (lista.length === 0) return null
  const visiveis = mostrarFechados ? lista : abertos
  return (
    <section className="coment-lista" aria-label={titulo}>
      <header className="coment-lista-topo">
        <strong>
          <Icone nome="comentario" tamanho={15} /> {titulo}
          {abertos.length > 0 && <span className="coment-contador">{abertos.length}</span>}
        </strong>
        {fechados.length > 0 && (
          <button type="button" className="botao-texto" onClick={() => setMostrarFechados((v) => !v)}>
            {mostrarFechados ? tr("só os abertos", "open only") : tr(`ver os ${fechados.length} decididos`, `show ${fechados.length} resolved comments`)}
          </button>
        )}
      </header>
      {visiveis.length === 0 && (
        <p className="texto-suave coment-vazio">{tr("Nenhum comentário aberto.", "No open comments.")}</p>
      )}
      <ul>
        {visiveis.map((c) => (
          <li key={c.id} className={`coment-item coment-${c.estado}`}>
            <div className="coment-cabeca">
              <span className="coment-ancora" title={c.ancora.ref}>
                {ROTULO_ANCORA[c.ancora.tipo]} · {c.ancora.rotulo || c.ancora.ref}
              </span>
              <span className="coment-estado">{ROTULO_ESTADO[c.estado]}</span>
            </div>
            <p className="coment-texto">{c.texto}</p>
            <small className="texto-suave">
              {c.autor_nome}
              {c.criado_em ? ` · ${formatDataHora(c.criado_em, idioma)}` : ''}
              {c.peca_slug ? tr(` · peça ${c.peca_slug}`, ` · production ${c.peca_slug}`) : c.job_id ? tr(` · trabalho nº ${c.job_id}`, ` · task no. ${c.job_id}`) : ''}
            </small>
            <div className="coment-acoes">
              {c.estado === 'aberto' && (
                <>
                  <button
                    type="button"
                    className="botao botao-pequeno"
                    title={tr("Cria a retomada com este pedido já escrito e a âncora citada", "Resume work with this request and its linked context")}
                    onClick={() => void agir(c.id, 'tarefa')}
                  >
                    <Icone nome="entregas" tamanho={14} /> {tr("Vira tarefa", "Make a task")}</button>
                  <button
                    type="button"
                    className="botao botao-fantasma botao-pequeno"
                    title={tr("Entra no conhecimento do escritório, como a recusa de uma entrega", "Add to office knowledge, like feedback on a rejected deliverable")}
                    onClick={() => void agir(c.id, 'licao')}
                  >
                    <Icone nome="ideia" tamanho={14} /> {tr("Vira lição", "Save as lesson")}</button>
                  <button type="button" className="botao-texto" onClick={() => void agir(c.id, 'resolver')}>
                    {tr("resolvido", "resolved")}</button>
                </>
              )}
              {c.estado === 'tarefa' && c.destino_job_id != null && aoAbrirJob && (
                <button type="button" className="botao-texto" onClick={() => aoAbrirJob(c.destino_job_id as number)}>
                  <Icone nome="fluxo" tamanho={14} /> {tr("ver a tarefa nº ", "view task no. ")}{c.destino_job_id}
                </button>
              )}
              {apagar && (
                <button type="button" className="botao-texto coment-apagar" onClick={() => void apagar(c.id)}>
                  {tr("apagar", "delete")}</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** O bloco da MESA: os comentários abertos do escritório, com a porta para o
 *  ponto do fluxo onde cada um mora. */
export function ComentariosAbertosMesa({
  orgId,
  slug,
  aoVerPeca,
  aoVerTrabalho,
}: {
  orgId: number
  slug: string
  aoVerPeca?: (pecaSlug: string) => void
  aoVerTrabalho?: (jobId: number) => void
}) {
  const { t: tr } = useIdioma()
  const ROTULO_ANCORA = ROTULO_ANCORA_local(tr)
  const { lista, agir } = useComentarios(orgId, slug, { estado: 'aberto' })
  if (lista.length === 0) return null
  return (
    <div className="mesa-falta coment-mesa">
      <div className="mesa-secao">
        <h4>{tr("Comentários abertos", "Open comments")}</h4>
        <span className="mesa-suave">{lista.length}</span>
      </div>
      <ul className="coment-mesa-lista">
        {lista.slice(0, 8).map((c) => (
          <li key={c.id}>
            <div>
              <strong>{c.peca_slug || (c.job_id ? tr(`trabalho nº ${c.job_id}`, `task no. ${c.job_id}`) : '')}</strong>
              <span className="mesa-suave"> · {ROTULO_ANCORA[c.ancora.tipo]} {c.ancora.rotulo || c.ancora.ref}</span>
              <p>{c.texto}</p>
            </div>
            <div className="coment-acoes">
              <button className="mesa-btn" onClick={() => void agir(c.id, 'tarefa')}>
                {tr("Vira tarefa", "Make a task")}</button>
              <button className="mesa-link" onClick={() => void agir(c.id, 'licao')}>
                {tr("Vira lição", "Save as lesson")}</button>
              {c.peca_slug && aoVerPeca && (
                <button className="mesa-link" onClick={() => aoVerPeca(c.peca_slug as string)}>
                  {tr("Ver no fluxo", "View in workflow")}</button>
              )}
              {!c.peca_slug && c.job_id != null && aoVerTrabalho && (
                <button className="mesa-link" onClick={() => aoVerTrabalho(c.job_id as number)}>
                  {tr("Ver no fluxo", "View in workflow")}</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
