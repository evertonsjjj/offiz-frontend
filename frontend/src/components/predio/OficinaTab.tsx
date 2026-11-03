import { useIdioma } from '../../lib/i18n'
import { useTextoEscritorio } from '../../lib/i18nEscritorios'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError, asList } from '../../lib/api'
import { Icone } from '../Icone'
import { useToasts } from '../Toasts'
import { formatDataHora, STATUS_JOB_LABEL } from '../../lib/format'
import type { ContratoLoop, Job, RascunhoLoopResposta, TipoLoop, TiposLoopResposta } from '../../lib/types'

/**
 * Fase 8 — aba "Oficina" da Oficina de Código (office `dev`).
 *
 * O fluxo do LOOP EDITÁVEL em 3 passos:
 *  1. Tipo      — escolher o tipo de loop (GET .../loops/tipos).
 *  2. Descreva  — descrever o objetivo (+ repo opcional) e pedir o rascunho
 *                 do contrato à IA (POST .../loops/rascunho, ~5–20s).
 *  3. Contrato  — editar TUDO (objetivo, critérios, plano, teto de voltas)
 *                 e iniciar (POST .../loops → 201 job).
 *
 * O loop vira um job normal do prédio (título começando com 🔁) — por isso o
 * rodapé lista os loops filtrando os jobs pelo prefixo do título.
 */

/* ------------------------------------------------------------------ */
/* Estado editável do contrato (strings amigáveis a formulário)        */
/* ------------------------------------------------------------------ */

interface CriterioForm {
  descricao: string
  comando: string
}

interface ContratoForm {
  tipo: string
  objetivo: string
  criterios: CriterioForm[]
  plano: string[]
  /** Guardado como string para o input numérico não "brigar" ao digitar. */
  maxVoltas: string
}

/** O backend aceita no máximo 12 critérios — o botão "+ critério" respeita o teto. */
const MAX_CRITERIOS = 12

function contratoParaForm(c: ContratoLoop): ContratoForm {
  return {
    tipo: c.tipo,
    objetivo: c.objetivo,
    criterios: c.criterios.map((cr) => ({ descricao: cr.descricao, comando: cr.comando ?? '' })),
    plano: [...c.plano],
    maxVoltas: String(c.max_voltas),
  }
}

// A URL do repo fica FORA do ContratoForm de propósito: é um estado único
// compartilhado entre os passos 2 e 3 — dois campos, uma fonte de verdade
// (editar num passo nunca diverge do outro).
function formParaContrato(f: ContratoForm, repoUrl: string): ContratoLoop {
  return {
    tipo: f.tipo,
    objetivo: f.objetivo.trim(),
    criterios: f.criterios
      .filter((cr) => cr.descricao.trim() !== '')
      .map((cr) => ({ descricao: cr.descricao.trim(), comando: cr.comando.trim() === '' ? null : cr.comando.trim() })),
    plano: f.plano.map((p) => p.trim()).filter((p) => p !== ''),
    max_voltas: Number(f.maxVoltas),
    repo_url: repoUrl.trim() === '' ? null : repoUrl.trim(),
  }
}

/* ------------------------------------------------------------------ */
/* Erros amigáveis                                                     */
/* ------------------------------------------------------------------ */

interface ErroLoop {
  msg: string
  /** 412 — falta a API key da org: a UI mostra o link de configuração. */
  semChave: boolean
}

function mensagemErroLoop(e: unknown, fallback: string): ErroLoop {
  if (e instanceof ApiError) {
    if (e.status === 412) {
      return {
        msg: 'A organização ainda não configurou a API key da Anthropic — sem ela a oficina não pode trabalhar.',
        semChave: true,
      }
    }
    if (e.status === 429) return { msg: e.detail, semChave: false }
    if (e.status === 400 || e.status === 422) {
      return { msg: `O contrato não passou na validação: ${e.detail}`, semChave: false }
    }
    return { msg: e.detail, semChave: false }
  }
  return { msg: fallback, semChave: false }
}

/* ------------------------------------------------------------------ */
/* A aba                                                               */
/* ------------------------------------------------------------------ */

type Passo = 1 | 2 | 3

const ROTULOS_PASSOS: Record<Passo, string> = { 1: 'Tipo', 2: 'Descreva', 3: 'Contrato' }

export function OficinaTab({ orgId, slug }: { orgId: number; slug: string }) {
  const { idioma } = useIdioma()
  const tx = useTextoEscritorio()
  const base = `/predios/${orgId}/${slug}`
  const { falha } = useToasts()
  const [searchParams, setSearchParams] = useSearchParams()

  // ---- Passo 1: catálogo de tipos ----
  const [tipos, setTipos] = useState<TipoLoop[] | null>(null)
  const [erroTipos, setErroTipos] = useState<string | null>(null)
  const [tipoSel, setTipoSel] = useState<TipoLoop | null>(null)

  // ---- Passo 2: descrição + rascunho ----
  const [descricao, setDescricao] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [rascunhando, setRascunhando] = useState(false)
  const [erroRascunho, setErroRascunho] = useState<ErroLoop | null>(null)

  // ---- Passo 3: contrato editável ----
  const [contrato, setContrato] = useState<ContratoForm | null>(null)
  // Contexto livre que segue JUNTO do contrato (vira a seção "Contexto do
  // usuário" do prompt): nasce da descrição do passo 2 e é editável no passo 3.
  const [contexto, setContexto] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [iniciando, setIniciando] = useState(false)
  const [erroIniciar, setErroIniciar] = useState<ErroLoop | null>(null)

  // ---- Pós-início + rodapé ----
  const [jobCriado, setJobCriado] = useState<Job | null>(null)
  const [loops, setLoops] = useState<Job[] | null>(null)
  const [erroLoops, setErroLoops] = useState<string | null>(null)

  const [passo, setPasso] = useState<Passo>(1)

  const carregarTipos = useCallback(async () => {
    setErroTipos(null)
    setTipos(null)
    try {
      const data = await api.get<TiposLoopResposta>(`${base}/loops/tipos`)
      setTipos(Array.isArray(data?.tipos) ? data.tipos : [])
    } catch (e) {
      setErroTipos(e instanceof ApiError ? e.detail : tx("Não foi possível carregar os tipos de loop."))
    }
  }, [base])

  const carregarLoops = useCallback(async () => {
    try {
      // per_page=100 é o teto do endpoint — sem isso, loops antigos somem da
      // lista assim que 20 jobs comuns chegam na frente.
      const data = await api.get<unknown>(`${base}/jobs?per_page=100`)
      // Decisão de design: o loop é um job normal — a lista filtra pelo 🔁 do título.
      setLoops(asList<Job>(data, 'items').filter((j) => (j.titulo || '').startsWith('🔁')))
      setErroLoops(null)
    } catch {
      // Falhou: mantém a última lista boa. O banner de erro só aparece quando
      // ainda não há lista nenhuma (senão seria o vazio definitivo mentiroso).
      setErroLoops(tx("Não foi possível carregar os loops desta oficina."))
    }
  }, [base])

  useEffect(() => {
    carregarTipos()
  }, [carregarTipos])

  useEffect(() => {
    carregarLoops()
    // Rede de segurança: mantém os status dos loops vivos sem depender do WS.
    const t = window.setInterval(() => {
      if (!document.hidden) carregarLoops()
    }, 20000)
    return () => clearInterval(t)
  }, [carregarLoops])

  /** Troca de aba preservando os params (padrão trocarAba do Predio.tsx). */
  function irParaAba(aba: string) {
    const params = new URLSearchParams(searchParams)
    if (aba === 'predio') params.delete('aba')
    else params.set('aba', aba)
    setSearchParams(params, { replace: true })
  }

  function resetarWizard() {
    setTipoSel(null)
    setDescricao('')
    setRepoUrl('')
    setContrato(null)
    setContexto('')
    setAviso(null)
    setErroRascunho(null)
    setErroIniciar(null)
    setJobCriado(null)
    setPasso(1)
  }

  function escolherTipo(t: TipoLoop) {
    if (tipoSel && tipoSel.id !== t.id) {
      // Trocou de tipo — o rascunho anterior não vale mais.
      setContrato(null)
      setAviso(null)
    }
    setTipoSel(t)
    setPasso(2)
  }

  async function rascunhar() {
    if (!tipoSel) return
    if (descricao.trim() === '') {
      falha(tx("Descreva o que você quer antes de pedir o rascunho."))
      return
    }
    setRascunhando(true)
    setErroRascunho(null)
    try {
      const res = await api.post<RascunhoLoopResposta>(`${base}/loops/rascunho`, {
        tipo: tipoSel.id,
        descricao: descricao.trim(),
        ...(repoUrl.trim() !== '' ? { repo_url: repoUrl.trim() } : {}),
      })
      setContrato(contratoParaForm(res.contrato))
      // A descrição vira o contexto do agente (seção "Contexto do usuário" do
      // prompt) — editável no passo 3; sem ela, restrições que a IA não
      // destilou para o contrato se perderiam em silêncio.
      setContexto(descricao.trim())
      if (res.contrato.repo_url) setRepoUrl(res.contrato.repo_url)
      setAviso(res.aviso ?? null)
      setErroIniciar(null)
      setPasso(3)
    } catch (e) {
      setErroRascunho(mensagemErroLoop(e, tx("Não foi possível rascunhar o contrato — tente de novo.")))
    } finally {
      setRascunhando(false)
    }
  }

  async function iniciarLoop(e: FormEvent) {
    e.preventDefault()
    if (!contrato) return
    // Critério com comando mas sem descrição NÃO pode ser descartado em
    // silêncio — o usuário escreveu um comando de verificação de propósito.
    const orfao = contrato.criterios.findIndex(
      (c) => c.descricao.trim() === '' && c.comando.trim() !== '',
    )
    if (orfao >= 0) {
      falha(tx("O critério {0} tem comando mas falta a descrição — complete ou remova.", orfao + 1))
      return
    }
    const corpo = formParaContrato(contrato, repoUrl)
    if (corpo.objetivo === '') {
      falha(tx("O contrato precisa de um objetivo."))
      return
    }
    if (corpo.criterios.length === 0) {
      falha(tx("Adicione pelo menos um critério de aceite com descrição."))
      return
    }
    if (corpo.criterios.length > MAX_CRITERIOS) {
      falha(tx("O contrato aceita no máximo {0} critérios.", MAX_CRITERIOS))
      return
    }
    if (!Number.isInteger(corpo.max_voltas) || corpo.max_voltas < 1 || corpo.max_voltas > 10) {
      falha(tx("O teto de voltas vai de 1 a 10."))
      return
    }
    setIniciando(true)
    setErroIniciar(null)
    try {
      const job = await api.post<Job>(`${base}/loops`, {
        contrato: corpo,
        ...(contexto.trim() !== '' ? { contexto: contexto.trim() } : {}),
      })
      setJobCriado(job)
      carregarLoops()
    } catch (err) {
      setErroIniciar(mensagemErroLoop(err, tx("Não foi possível iniciar o loop — tente de novo.")))
    } finally {
      setIniciando(false)
    }
  }

  /* ---------- Edição do contrato (passo 3) ---------- */

  function editarContrato(patch: Partial<ContratoForm>) {
    setContrato((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  function editarCriterio(i: number, patch: Partial<CriterioForm>) {
    setContrato((prev) =>
      prev ? { ...prev, criterios: prev.criterios.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) } : prev,
    )
  }

  function removerCriterio(i: number) {
    setContrato((prev) => (prev ? { ...prev, criterios: prev.criterios.filter((_, idx) => idx !== i) } : prev))
  }

  function adicionarCriterio() {
    setContrato((prev) => (prev ? { ...prev, criterios: [...prev.criterios, { descricao: '', comando: '' }] } : prev))
  }

  function editarPasso(i: number, valor: string) {
    setContrato((prev) => (prev ? { ...prev, plano: prev.plano.map((p, idx) => (idx === i ? valor : p)) } : prev))
  }

  function removerPasso(i: number) {
    setContrato((prev) => (prev ? { ...prev, plano: prev.plano.filter((_, idx) => idx !== i) } : prev))
  }

  function adicionarPasso() {
    setContrato((prev) => (prev ? { ...prev, plano: [...prev.plano, ''] } : prev))
  }

  /* ---------- Render ---------- */

  const passoAlcancavel: Record<Passo, boolean> = {
    1: true,
    2: tipoSel !== null,
    3: contrato !== null,
  }

  return (
    <div className="oficina-tab">
      <div className="oficina-intro">
        <p> {tx("A Oficina roda")} <strong>{tx("loops editáveis")}</strong>{tx(": você descreve o que quer, a IA rascunha um contrato — objetivo, critérios de aceite e plano — e")} <strong>{tx("você edita tudo")}</strong> {tx("antes de apertar o play. A cada volta, os critérios com comando são")} <strong>{tx("verificados de verdade")}</strong> {tx("(o comando roda; não vale confiar na palavra da IA). O contrato manda: o loop termina ao passar em tudo ou ao bater o teto de voltas, e o relatório final diz o que passou e o que faltou.")} </p>
      </div>

      {jobCriado ? (
        <section className="cartao oficina-sucesso" role="status">
          <div className="oficina-sucesso-icone" aria-hidden="true">
            <Icone nome="loop" tamanho={44} traco={1.3} />
          </div>
          <h3>{tx("Loop iniciado!")}</h3>
          <p className="texto-suave">
            “{jobCriado.titulo}{tx("” já entrou na oficina — acompanhe cada volta ao vivo na aba Tarefas.")} </p>
          <div className="oficina-sucesso-acoes">
            <button
              type="button"
              className="botao botao-primario"
              onClick={() => {
                resetarWizard()
                irParaAba('chat')
              }}
            >
              <Icone nome="setup" tamanho={15} /> {tx("Acompanhar na aba Tarefas")} </button>
            <button type="button" className="botao botao-fantasma" onClick={resetarWizard}> {tx("Montar outro loop")} </button>
          </div>
        </section>
      ) : (
        <section className="cartao oficina-wizard">
          <ol className="oficina-passos" aria-label={tx("Passos do loop")}>
            {([1, 2, 3] as Passo[]).map((p) => (
              <li key={p}>
                <button
                  type="button"
                  className={`oficina-passo-chip${passo === p ? ' ativo' : ''}${passo > p ? ' feito' : ''}`}
                  disabled={!passoAlcancavel[p] || rascunhando || iniciando}
                  onClick={() => setPasso(p)}
                  aria-current={passo === p ? 'step' : undefined}
                >
                  <span className="oficina-passo-num" aria-hidden="true">{p}</span>
                  {tx(ROTULOS_PASSOS[p])}
                </button>
              </li>
            ))}
          </ol>

          {/* ---------------- Passo 1 — Tipo ---------------- */}
          {passo === 1 && (
            <div className="oficina-passo-corpo">
              <h3 className="secao-titulo">{tx("Que tipo de loop você quer rodar?")}</h3>
              {erroTipos ? (
                <div>
                  <p className="alerta alerta-erro" role="alert">{erroTipos}</p>
                  <button type="button" className="botao botao-fantasma botao-pequeno" onClick={carregarTipos}>
                    <Icone nome="loop" tamanho={15} /> {tx("Tentar de novo")} </button>
                </div>
              ) : tipos === null ? (
                <div className="oficina-tipos" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="oficina-tipo-card esqueleto" style={{ minHeight: 130 }} />
                  ))}
                </div>
              ) : tipos.length === 0 ? (
                <p className="texto-suave">{tx("O catálogo de loops ainda não chegou do servidor — volte daqui a pouco.")}</p>
              ) : (
                <div className="oficina-tipos">
                  {tipos.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`oficina-tipo-card${tipoSel?.id === t.id ? ' selecionado' : ''}`}
                      onClick={() => escolherTipo(t)}
                    >
                      <span className="oficina-tipo-icone" aria-hidden="true">{t.icone}</span>
                      <strong className="oficina-tipo-nome">{t.nome}</strong>
                      <p className="oficina-tipo-descricao">{t.descricao}</p>
                      <em className="oficina-tipo-exemplo">{t.exemplo}</em>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ---------------- Passo 2 — Descreva ---------------- */}
          {passo === 2 && tipoSel && (
            <div className="oficina-passo-corpo">
              <div className="oficina-tipo-escolhido">
                <span aria-hidden="true">{tipoSel.icone}</span>
                <strong>{tipoSel.nome}</strong>
                <button
                  type="button"
                  className="botao-texto"
                  onClick={() => setPasso(1)}
                  disabled={rascunhando}
                > {tx("trocar tipo")} </button>
              </div>
              <label className="campo">
                <span>{tx("Descreva o que você quer construir/corrigir/melhorar")}</span>
                <textarea
                  rows={6}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder={tx("ex.: uma API em FastAPI com cadastro e login de usuários, com testes cobrindo os fluxos principais…")}
                  disabled={rascunhando}
                />
              </label>
              <label className="campo">
                <span>{tx("URL do repositório git (opcional)")}</span>
                <input
                  type="url"
                  className="oficina-comando"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/sua-conta/seu-projeto.git"
                  disabled={rascunhando}
                />
              </label>
              <p className="oficina-dica"> {tx("💡 Tem arquivos ou um zip do projeto? Envie na aba")} <strong>{tx("Tarefas")}</strong> {tx("— tudo o que sobe lá cai em")} <code>entrada/</code> {tx("e fica à mão do loop.")} </p>
              {rascunhando && (
                <div className="oficina-rascunhando" role="status">
                  <span className="oficina-spinner" aria-hidden="true" />
                  <span>{tx("A IA está rascunhando o contrato do loop… isso leva alguns segundos.")}</span>
                </div>
              )}
              {erroRascunho && (
                <p className="alerta alerta-erro" role="alert">
                  {erroRascunho.msg}
                  {erroRascunho.semChave && (
                    <>
                      {' '}
                      <Link to={`/config/org/${orgId}`}>{tx("Configurar API key →")}</Link>
                    </>
                  )}
                </p>
              )}
              <div className="linha-form oficina-acoes">
                <button type="button" className="botao botao-fantasma" onClick={() => setPasso(1)} disabled={rascunhando}> {tx("◀ Voltar")} </button>
                {contrato && (
                  <button type="button" className="botao botao-fantasma" onClick={() => setPasso(3)} disabled={rascunhando}> {tx("Continuar com o rascunho")} <Icone nome="play" tamanho={15} />
                  </button>
                )}
                <button type="button" className="botao botao-primario" onClick={rascunhar} disabled={rascunhando}>
                  {rascunhando ? (
                    'Rascunhando…'
                  ) : (
                    <>
                      <Icone nome="lapis" tamanho={15} /> {tx("Rascunhar contrato")} </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ---------------- Passo 3 — Contrato editável ---------------- */}
          {passo === 3 && contrato && (
            <form className="oficina-passo-corpo" onSubmit={iniciarLoop}>
              <h3 className="secao-titulo">{tx("O contrato do loop — edite à vontade antes de iniciar")}</h3>
              {aviso && (
                <p className="alerta alerta-aviso" role="note">
                  ⚠️ {aviso}
                </p>
              )}

              <label className="campo">
                <span>{tx("Objetivo")}</span>
                <textarea
                  rows={3}
                  value={contrato.objetivo}
                  onChange={(e) => editarContrato({ objetivo: e.target.value })}
                  disabled={iniciando}
                />
              </label>

              <div className="oficina-secao">
                <h4 className="oficina-secao-titulo">{tx("Critérios de aceite")}</h4>
                <p className="texto-suave"> {tx("Critérios com comando são verificados rodando o comando a cada volta; sem comando, ficam para a sua revisão manual na entrega.")} </p>
                {contrato.criterios.map((c, i) => (
                  <div key={i} className="oficina-criterio">
                    <input
                      type="text"
                      value={c.descricao}
                      onChange={(e) => editarCriterio(i, { descricao: e.target.value })}
                      placeholder={tx("ex.: todos os testes passam")}
                      aria-label={tx("Critério {0} — descrição", i + 1)}
                      disabled={iniciando}
                    />
                    <input
                      type="text"
                      className="oficina-comando"
                      value={c.comando}
                      onChange={(e) => editarCriterio(i, { comando: e.target.value })}
                      placeholder={tx("pytest -q · npm test · (vazio = revisão manual)")}
                      aria-label={tx("Critério {0} — comando de verificação", i + 1)}
                      disabled={iniciando}
                    />
                    <button
                      type="button"
                      className="botao-texto perigo"
                      onClick={() => removerCriterio(i)}
                      aria-label={tx("Remover critério {0}", i + 1)}
                      disabled={iniciando}
                    > {tx("remover")} </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={adicionarCriterio}
                  disabled={iniciando || contrato.criterios.length >= MAX_CRITERIOS}
                  title={
                    contrato.criterios.length >= MAX_CRITERIOS
                      ? tx("O contrato aceita no máximo {0} critérios.", MAX_CRITERIOS)
                      : undefined
                  }
                >
                  <Icone nome="mais" tamanho={15} /> {tx("critério")} </button>
              </div>

              <div className="oficina-secao">
                <h4 className="oficina-secao-titulo">{tx("Plano inicial")}</h4>
                <p className="texto-suave"> {tx("O ponto de partida da primeira volta — o agente pode se replanejar no caminho, mas o contrato manda.")} </p>
                {contrato.plano.map((p, i) => (
                  <div key={i} className="oficina-plano-passo">
                    <span className="oficina-plano-num" aria-hidden="true">{i + 1}.</span>
                    <input
                      type="text"
                      value={p}
                      onChange={(e) => editarPasso(i, e.target.value)}
                      aria-label={tx("Passo {0} do plano", i + 1)}
                      disabled={iniciando}
                    />
                    <button
                      type="button"
                      className="botao-texto perigo"
                      onClick={() => removerPasso(i)}
                      aria-label={tx("Remover passo {0} do plano", i + 1)}
                      disabled={iniciando}
                    > {tx("remover")} </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={adicionarPasso}
                  disabled={iniciando}
                >
                  <Icone nome="mais" tamanho={15} /> {tx("passo")} </button>
              </div>

              <div className="oficina-linha-final">
                <label className="campo oficina-voltas">
                  <span>{tx("Teto de voltas")}</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={contrato.maxVoltas}
                    onChange={(e) => editarContrato({ maxVoltas: e.target.value })}
                    disabled={iniciando}
                  />
                </label>
                <p className="texto-suave oficina-voltas-nota"> {tx("O loop para ao passar em tudo ou ao atingir o teto — o relatório diz o que passou e o que faltou.")} </p>
              </div>

              <label className="campo">
                <span>{tx("URL do repositório git (opcional)")}</span>
                <input
                  type="url"
                  className="oficina-comando"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/sua-conta/seu-projeto.git"
                  disabled={iniciando}
                />
              </label>

              <label className="campo">
                <span>{tx("Contexto para o agente (segue junto do contrato)")}</span>
                <textarea
                  rows={3}
                  value={contexto}
                  onChange={(e) => setContexto(e.target.value)}
                  placeholder={tx("restrições, branch, versões, 'não toque no módulo X'…")}
                  disabled={iniciando}
                />
              </label>

              {erroIniciar && (
                <p className="alerta alerta-erro" role="alert">
                  {erroIniciar.msg}
                  {erroIniciar.semChave && (
                    <>
                      {' '}
                      <Link to={`/config/org/${orgId}`}>{tx("Configurar API key →")}</Link>
                    </>
                  )}
                </p>
              )}

              <div className="linha-form oficina-acoes">
                <button type="button" className="botao botao-fantasma" onClick={() => setPasso(2)} disabled={iniciando}> {tx("◀ Voltar")} </button>
                <button type="submit" className="botao botao-primario" disabled={iniciando}>
                  {iniciando ? (
                    tx("Iniciando…")
                  ) : (
                    <>
                      <Icone nome="play" tamanho={15} /> {tx("Iniciar loop")} </>
                  )}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* ---------------- Loops recentes ---------------- */}
      <section className="oficina-recentes">
        <h3 className="secao-titulo">{tx("Loops desta oficina")}</h3>
        {loops === null && erroLoops ? (
          <div>
            <p className="alerta alerta-erro" role="alert">{erroLoops}</p>
            <button type="button" className="botao botao-fantasma botao-pequeno" onClick={carregarLoops}>
              <Icone nome="loop" tamanho={15} /> {tx("Tentar de novo")} </button>
          </div>
        ) : loops === null ? (
          <div className="esqueleto" style={{ minHeight: 56, borderRadius: 'var(--raio-s)' }} aria-hidden="true" />
        ) : loops.length === 0 ? (
          <p className="texto-suave">{tx("Nenhum loop rodou por aqui ainda — monte o primeiro contrato aí em cima. 🔧")}</p>
        ) : (
          <ul className="oficina-lista-loops">
            {loops.map((j) => (
              <li key={j.id} className="oficina-loop-item">
                <span className="oficina-loop-titulo">{j.titulo}</span>
                <span className={`status-pill status-${j.status}`}>{tx(STATUS_JOB_LABEL[j.status] ?? j.status)}</span>
                <span className="oficina-loop-data">{formatDataHora(j.criado_em, idioma)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
