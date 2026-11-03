import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, asList, getSessionIdentity } from '../../lib/api'
import { Icone } from '../Icone'
import { useToasts } from '../Toasts'
import { useConfirmacao } from '../useConfirmacao'
import { useIdioma, type Idioma, type Traduzir } from '../../lib/i18n'
import type { OfficeInfo } from '../../lib/types'

/**
 * Aba Agenda — o andar trabalha SOZINHO, no dia e hora combinados.
 *
 * O relatório sai toda segunda às 9h sem ninguém abrir o navegador; o aviso
 * chega por e-mail (o canal que já existe). Criar/editar é de dono/admin —
 * atividade agendada gasta a chave do cliente todo período, sem clique.
 */

interface Atividade {
  id: number
  criado_em?: string
  titulo: string
  prompt: string
  anexos?: string[]
  /** uma_vez (27/08): dia MARCADO — `data` manda; depois de rodar, o ciclo
   *  desativa a atividade sozinho e ela fica como registro. */
  recorrencia: 'semanal' | 'mensal' | 'uma_vez'
  dia: number
  hora: string
  /** uma_vez: 'AAAA-MM-DD' (fuso de SP). */
  data?: string | null
  /** A peça do estúdio ligada ('posta a peça X quinta'). */
  peca_slug?: string | null
  ativo: boolean
  ultima_execucao_em: string | null
  ultimo_job_id: number | null
  proxima_execucao: string | null
  pendente: boolean
}

const identidadeAtividade = (a: Atividade) => `${a.id}:${a.criado_em || ''}`
const FUSO_AGENDA = 'America/Sao_Paulo'

/** 0=segunda … 6=domingo — o MESMO contrato do backend (e da newsletter). */
const DIAS_SEMANA = [
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
  'Domingo',
]

const DIAS_SEMANA_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function resumoQuando(a: Atividade, traduzir: Traduzir): string {
  const hora = traduzir(`às ${a.hora}`, `at ${a.hora}`)
  if (a.recorrencia === 'uma_vez') {
    // 'AAAA-MM-DD' → 'dd/mm', sem passar por Date (fuso trocaria o dia).
    const [, mes, dia] = (a.data ?? '').split('-')
    return dia && mes ? traduzir(`dia ${dia}/${mes} ${hora} · uma vez`, `on ${mes}/${dia} ${hora} · once`) : traduzir(`${hora} · uma vez`, `${hora} · once`)
  }
  if (a.recorrencia === 'semanal') return `${traduzir(DIAS_SEMANA[a.dia] ?? '?', DIAS_SEMANA_EN[a.dia] ?? '?')} ${hora}`
  return traduzir(`todo dia ${a.dia} ${hora}`, `on day ${a.dia} of every month ${hora}`)
}

/** Hoje na régua do produto (Brasília) — 'en-CA' já formata AAAA-MM-DD, e a
 *  comparação de datas ISO é lexicográfica. */
function hojeEmSP(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: FUSO_AGENDA })
}

/** uma_vez cujo dia marcado passou sem ela rodar: o ciclo a desativa e avisa;
 *  aqui ela deixa de oferecer "Reativar" (a data velha só devolveria 422).
 *
 *  A RÉGUA É A DO BACKEND, não a do calendário: o serviço dá uma folga de um
 *  ciclo depois do alvo (a peça das 23:58 ainda dispara depois da meia-noite)
 *  e publica isso em `proxima_execucao` — que só vem nulo quando ele desistiu
 *  de verdade. Cortar aqui na virada seca do dia declarava morta, por duas
 *  horas, a peça que o ciclo ainda ia postar — e escondia o Pausar, a única
 *  forma não-destrutiva de impedir o disparo. */
function umaVezVencida(a: Atividade): boolean {
  return (
    a.recorrencia === 'uma_vez' &&
    !a.ultima_execucao_em &&
    !a.proxima_execucao &&
    (a.data ?? '') < hojeEmSP()
  )
}

function proximaLegivel(a: Atividade, traduzir: Traduzir, idioma: Idioma): string {
  // uma_vez que já rodou fica na lista como registro — não como "pausada".
  if (a.recorrencia === 'uma_vez' && a.ultima_execucao_em) return traduzir('feita ✓', 'completed ✓')
  // Vale para a que o ciclo desativou E para a que o dono pausou: "não rodou
  // na data" acusaria o escritório de ter falhado quando quem pausou foi ele.
  if (umaVezVencida(a)) return traduzir('o dia marcado passou', 'the scheduled date has passed')
  if (!a.ativo) return traduzir('pausada', 'paused')
  if (a.pendente) return traduzir('em instantes (pendente)', 'shortly (pending)')
  if (!a.proxima_execucao) return '—'
  const d = new Date(a.proxima_execucao)
  return d.toLocaleString(idioma, {
    timeZone: FUSO_AGENDA,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function OpcoesDia({ recorrencia }: { recorrencia: 'semanal' | 'mensal' }) {
  const { t: traduzir } = useIdioma()
  if (recorrencia === 'semanal') {
    return (
      <>
        {DIAS_SEMANA.map((nome, i) => (
          <option key={i} value={i}>
            {traduzir(nome, DIAS_SEMANA_EN[i])}
          </option>
        ))}
      </>
    )
  }
  return (
    <>
      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
        <option key={d} value={d}>
          {traduzir('Dia', 'Day')} {d}
        </option>
      ))}
    </>
  )
}

export function AgendaTab({
  orgId,
  slug,
  podeEditar,
  office,
}: {
  orgId: number
  slug: string
  /** O manifesto do andar — traz as sugestões de atividade deste ofício.
   *  Sem ele (ou sem sugestões), valem os exemplos genéricos de antes. */
  office?: OfficeInfo | null
  /** owner/admin editam; membro só acompanha. */
  podeEditar: boolean
}) {
  const { t: traduzir, idioma } = useIdioma()
  const { sucesso, falha } = useToasts()
  const { confirmar, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}:${slug}`)
  const [atividades, setAtividades] = useState<Atividade[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const removendoRef = useRef(new Set<number>())
  const [removendo, setRemovendo] = useState<number[]>([])
  const chaveTentativas = `offiz:agenda-tentativas:${getSessionIdentity()}:${orgId}:${slug}`
  const [tentativas, setTentativas] = useState<Record<string, string>>(() => {
    try {
      const salvas: unknown = JSON.parse(localStorage.getItem(chaveTentativas) || '{}')
      if (!salvas || typeof salvas !== 'object' || Array.isArray(salvas)) return {}
      return Object.fromEntries(Object.entries(salvas).filter(([id, chave]) => /^\d+:/.test(id) && id.length < 100 && typeof chave === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(chave)))
    } catch { return {} }
  })
  const tentativasRef = useRef(tentativas)
  const executandoRef = useRef(new Set<number>())
  const [executando, setExecutando] = useState<number[]>([])
  const [avisosExecucao, setAvisosExecucao] = useState<Record<number, string>>({})
  const telaAtiva = useRef(true)
  useEffect(() => { telaAtiva.current = true; return () => { telaAtiva.current = false } }, [])

  function guardarTentativa(id: string, chave?: string) {
    const novas = { ...tentativasRef.current }
    if (chave) novas[id] = chave
    else delete novas[id]
    tentativasRef.current = novas
    setTentativas(novas)
    try { localStorage.setItem(chaveTentativas, JSON.stringify(novas)) } catch { /* O replay ainda funciona nesta tela. */ }
  }

  // Formulário de criação
  const [titulo, setTitulo] = useState('')
  const [prompt, setPrompt] = useState('')
  const [recorrencia, setRecorrencia] = useState<'semanal' | 'mensal' | 'uma_vez'>('semanal')
  const [dia, setDia] = useState(0)
  const [hora, setHora] = useState('09:00')
  const [data, setData] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [anexos, setAnexos] = useState<Array<{ nome: string; referencia: string }>>([])
  const [subindo, setSubindo] = useState(false)
  const [erroAnexo, setErroAnexo] = useState<string | null>(null)

  // As sugestões do manifesto do andar; sem elas, os exemplos genéricos de
  // antes continuam valendo como placeholder (nada regride).
  const sugestoes = useMemo(() => office?.sugestoes_agenda ?? [], [office])
  const exemploTitulo = sugestoes[0]?.titulo || (slug === 'conteudo' ? traduzir('Pesquisar pautas da semana', 'Research this week’s post ideas') : traduzir('Preparar o trabalho da semana', 'Prepare this week’s work'))
  const exemploPrompt =
    sugestoes[0]?.prompt ||
    traduzir('Descreva o resultado que espera e como os arquivos devem ser usados.', 'Describe the result you expect and how the files should be used.')

  const base = `/predios/${orgId}/${slug}/agenda`

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const data = await api.get<unknown>(base)
      if (!telaAtiva.current) return
      setAtividades(asList<Atividade>(data, 'atividades'))
      setErro(null)
    } catch (e) {
      if (!telaAtiva.current) return
      setErro(e instanceof ApiError ? e.detail : traduzir('Não foi possível carregar a agenda.', 'Could not load the schedule.'))
    } finally { if (telaAtiva.current) setCarregando(false) }
  }, [base, traduzir])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function criar(e: FormEvent) {
    e.preventDefault()
    if (subindo || enviando) return
    if (!titulo.trim() || !prompt.trim()) {
      falha(traduzir('Dê um nome e descreva o que deve ser feito.', 'Add a name and describe the work.'))
      return
    }
    if (recorrencia === 'uma_vez' && !data) {
      falha(traduzir('Escolha a data do dia marcado.', 'Choose the scheduled date.'))
      return
    }
    setEnviando(true)
    try {
      await api.post(base, {
        titulo,
        prompt,
        recorrencia,
        dia,
        hora,
        data: recorrencia === 'uma_vez' ? data : undefined,
        anexos: anexos.map(a => a.referencia),
      })
      sucesso(traduzir('Atividade agendada — o escritório cuida do resto.', 'Activity scheduled — the office will handle the rest.'))
      setTitulo('')
      setPrompt('')
      setAnexos([])
      setErroAnexo(null)
      carregar()
    } catch (err) {
      falha(err instanceof ApiError ? err.detail : traduzir('Não foi possível agendar.', 'Could not schedule this activity.'))
    } finally {
      setEnviando(false)
    }
  }

  async function enviarArquivos(arquivos: File[]) {
    if (subindo || enviando || !arquivos.length) return
    if (anexos.length + arquivos.length > 20) {
      setErroAnexo(traduzir('Anexe no máximo 20 arquivos por atividade.', 'Attach up to 20 files per activity.'))
      return
    }
    setSubindo(true)
    setErroAnexo(null)
    try {
      for (const arquivo of arquivos) {
        const fd = new FormData()
        fd.append('arquivo', arquivo)
        const recebido = await api.postForm<{ nome: string; referencia: string }>(`${base}/anexos`, fd)
        setAnexos(atuais => [...atuais, recebido])
      }
    } catch (err) {
      setErroAnexo(err instanceof ApiError ? err.detail : traduzir('Não foi possível enviar todos os arquivos. Os que já chegaram estão na lista abaixo.', 'Some files could not be uploaded. Completed uploads are listed below.'))
    } finally { setSubindo(false) }
  }

  async function alternarAtivo(a: Atividade) {
    try {
      await api.put(`${base}/${a.id}`, { ativo: !a.ativo })
      sucesso(a.ativo ? traduzir(`“${a.titulo}” pausada.`, `“${a.titulo}” paused.`) : traduzir(`“${a.titulo}” reativada.`, `“${a.titulo}” resumed.`))
      carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : traduzir('Não foi possível mudar a atividade.', 'Could not update this activity.'))
    }
  }

  async function rodarAgora(a: Atividade) {
    if (executandoRef.current.has(a.id)) return
    executandoRef.current.add(a.id)
    setExecutando([...executandoRef.current])
    const identidade = identidadeAtividade(a)
    let chave = tentativasRef.current[identidade]
    if (!chave) {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
      chave = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
      guardarTentativa(identidade, chave)
    }
    setAvisosExecucao(v => ({ ...v, [a.id]: '' }))
    try {
      const resposta = await api.post<{ job: { id: number } }>(`${base}/${a.id}/executar`, { chave_execucao: chave, ...(a.criado_em ? { atividade_criada_em: a.criado_em } : {}) })
      if (!telaAtiva.current) return
      guardarTentativa(identidade)
      setAtividades(atuais => atuais?.map(atividade => atividade.id === a.id
        ? { ...atividade, ultimo_job_id: resposta.job.id }
        : atividade) ?? atuais)
      sucesso(traduzir(`“${a.titulo}” está na lista de trabalhos.`, `“${a.titulo}” is in your work list.`))
      carregar()
    } catch (e) {
      if (!telaAtiva.current) return
      // 412 sem chave / 429 teto chegam aqui com a mensagem do backend —
      // os MESMOS avisos do clique normal, porque é o mesmo caminho.
      const incerta = !(e instanceof ApiError) || e.status === 0 || e.status >= 500
      if (!incerta) guardarTentativa(identidade)
      const mensagem = incerta
        ? traduzir('Não consegui confirmar a resposta. Confira a mesma tentativa abaixo para evitar criar outro trabalho.', 'Could not confirm the response. Check the same attempt below to avoid creating another job.')
        : e.detail
      setAvisosExecucao(v => ({ ...v, [a.id]: mensagem }))
      falha(mensagem)
    } finally {
      executandoRef.current.delete(a.id)
      if (telaAtiva.current) setExecutando([...executandoRef.current])
    }
  }

  async function remover(a: Atividade) {
    if (removendoRef.current.has(a.id)) return
    removendoRef.current.add(a.id)
    try {
      if (!await confirmar({
        titulo: traduzir('Remover atividade da agenda', 'Remove scheduled activity'),
        mensagem: traduzir(`Remover a atividade “${a.titulo}” da agenda? As próximas execuções serão canceladas. Os trabalhos já iniciados permanecem.`, `Remove “${a.titulo}” from the schedule? Future runs will be cancelled. Jobs already started will remain.`),
        acao: traduzir('Remover atividade', 'Remove activity'),
      })) return
      setRemovendo(atuais => [...atuais, a.id])
      await api.del(`${base}/${a.id}`)
      sucesso(traduzir('Atividade removida.', 'Activity removed.'))
      carregar()
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : traduzir('Não foi possível remover.', 'Could not remove this activity.'))
    } finally {
      removendoRef.current.delete(a.id)
      setRemovendo(atuais => atuais.filter(id => id !== a.id))
    }
  }

  return (
    <div className="agenda-aba">
      {dialogo}
      <section className="cartao">
        <h2 className="secao-titulo">
          <Icone nome="agenda" /> {traduzir('Atividades agendadas', 'Scheduled activities')}
        </h2>
        <p className="texto-suave">
          {traduzir('Combine o que fazer e quando começar. As entregas ficam disponíveis para sua revisão em Projetos e entregas.', 'Choose the work and when to start. Review the results in Projects and deliverables.')}
        </p>
        <p className="texto-suave">{traduzir('Os horários seguem o fuso de Brasília.', 'Times follow the Brasília time zone.')}</p>
        {erro && <p className="alerta alerta-erro" role="alert">{erro}{' '}<button type="button" className="botao-texto" disabled={carregando} onClick={carregar}>{carregando ? traduzir('Carregando…', 'Loading…') : traduzir('Tentar novamente', 'Try again')}</button></p>}
        {atividades === null && !erro && <p className="texto-suave" role="status">{traduzir('Carregando…', 'Loading…')}</p>}
        {atividades !== null && atividades.length === 0 && (
          <p className="texto-suave">
            {traduzir('Nada agendado ainda.', 'Nothing scheduled yet.')}
            {podeEditar ? ' Crie a primeira atividade abaixo.' : ''}
          </p>
        )}
        {atividades !== null && atividades.length > 0 && (
          <div className="tabela-scroll">
            <table className="tabela">
              <thead>
                <tr>
                  <th>{traduzir('Atividade', 'Activity')}</th>
                  <th>{traduzir('Quando', 'When')}</th>
                  <th>{traduzir('Próxima', 'Next run')}</th>
                  {podeEditar && <th aria-label={traduzir('Ações', 'Actions')} />}
                </tr>
              </thead>
              <tbody>
                {atividades.map((a) => (
                  <tr key={a.id} style={a.ativo ? undefined : { opacity: 0.55 }}>
                    <td>
                      <strong>{a.titulo}</strong>
                      {a.peca_slug && (
                        <span className="texto-suave"> {traduzir('· peça:', '· deliverable:')} {a.peca_slug}</span>
                      )}
                      <details><summary>{traduzir("Ver instruções", "View instructions")}</summary><div className="texto-suave agenda-prompt">{a.prompt}</div></details>
                      {!!a.anexos?.length && <ul className="agenda-materiais">{a.anexos.map(nome => <li key={nome}><Icone nome="anexo" tamanho={13} /> {nome.slice(33)}</li>)}</ul>}
                      {avisosExecucao[a.id] && <p role="alert">{avisosExecucao[a.id]}</p>}
                      {tentativas[identidadeAtividade(a)] && !executando.includes(a.id) && !avisosExecucao[a.id] && <p>{traduzir('Há uma tentativa sem resposta confirmada. Confira antes de iniciar outro trabalho.', 'An attempt has no confirmed response. Check it before starting another job.')}</p>}
                      {a.ultimo_job_id && <a href={`/app?org=${orgId}&vista=biblioteca&area=${encodeURIComponent(slug)}&trabalho=${a.ultimo_job_id}`}>{traduzir('Acompanhar trabalho', 'View job')} #{a.ultimo_job_id}</a>}
                    </td>
                    <td>{resumoQuando(a, traduzir)}</td>
                    <td title={a.proxima_execucao ?? ''}>{proximaLegivel(a, traduzir, idioma)}</td>
                    {podeEditar && (
                      <td>
                        <span className="linha-conceder">
                          <button
                            type="button"
                            className="botao botao-fantasma botao-pequeno"
                            disabled={executando.includes(a.id)}
                            onClick={() => rodarAgora(a)}
                            title={
                              // Três histórias diferentes, e o botão precisa
                              // contar a certa: numa uma_vez já cumprida não
                              // há dia a consumir (o clique começa trabalho
                              // NOVO); numa marcada para hoje o clique
                              // consome (senão o ciclo posta de novo); numa
                              // marcada para a frente é só um teste.
                              a.recorrencia === 'uma_vez' &&
                              (a.ultima_execucao_em || umaVezVencida(a))
                                ? traduzir('Rodar de novo — o dia marcado já foi cumprido (ou passou); isto começa um trabalho novo', 'Run again — the scheduled date is complete or has passed; this starts new work')
                                : a.recorrencia === 'uma_vez' &&
                                    (a.data ?? '') <= hojeEmSP()
                                  ? traduzir('Executar agora — isto CONSOME o dia marcado (não roda de novo)', 'Run now — this uses the scheduled occurrence (it will not run again)')
                                  : a.recorrencia === 'uma_vez'
                                    ? traduzir('Executar agora, como um teste — o dia marcado continua valendo', 'Run now as a test — the scheduled occurrence remains active')
                                    : traduzir('Executar agora, fora do horário (não mexe na agenda)', 'Run now outside the schedule (the schedule stays unchanged)')
                            }
                          >
                            <Icone nome="play" tamanho={15} /> {executando.includes(a.id) ? traduzir('Confirmando…', 'Confirming…') : tentativas[identidadeAtividade(a)] ? traduzir('Conferir tentativa', 'Check attempt') : traduzir('Agora', 'Now')}
                          </button>
                          {/* Uma uma_vez que já rodou (ou cujo dia passou) não
                              tem o que reativar: a data velha só devolveria
                              "essa data já passou". Quem quer de novo usa
                              "Agora" ou marca uma data nova. */}
                          {!(
                            a.recorrencia === 'uma_vez' &&
                            (a.ultima_execucao_em || umaVezVencida(a))
                          ) && (
                            <button
                              type="button"
                              className="botao botao-fantasma botao-pequeno"
                              onClick={() => alternarAtivo(a)}
                            >
                              {a.ativo ? traduzir('Pausar', 'Pause') : traduzir('Reativar', 'Resume')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="botao botao-fantasma botao-pequeno"
                            disabled={removendo.includes(a.id)}
                            onClick={() => remover(a)}
                          >
                            {traduzir('Remover', 'Remove')}
                          </button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {podeEditar && (
        <section className="cartao">
          <h2 className="secao-titulo">{traduzir('Agendar uma atividade', 'Schedule an activity')}</h2>
          {/* O que ESTE andar sabe fazer sozinho. Sem isto, o formulário
              genérico pedia que o usuário de conteúdo inventasse do zero a
              rotina do escritório dele — e o exemplo na tela era do
              financeiro, de outro ofício. Um clique preenche os dois campos;
              a pessoa ajusta o texto como quiser. */}
          {sugestoes.length > 0 && (
            <div className="agenda-sugestoes">
              <p className="texto-suave">
                {traduzir('Sugestões deste escritório — clique para usar e edite à vontade:', 'Suggestions from this office — choose one and edit it as needed:')}
              </p>
              <span className="linha-conceder">
                {sugestoes.map((s) => (
                  <button
                    key={s.titulo}
                    type="button"
                    className="botao botao-fantasma botao-pequeno"
                    title={s.descricao || s.prompt}
                    onClick={() => {
                      setTitulo(s.titulo)
                      setPrompt(s.prompt || s.descricao || s.titulo)
                    }}
                  >
                    <Icone nome="mais" tamanho={15} /> {s.titulo}
                  </button>
                ))}
              </span>
            </div>
          )}
          <form onSubmit={criar}>
            <label className="campo">
              <span>{traduzir('Nome (aparece nas entregas)', 'Name (shown in deliverables)')}</span>
              <input
                type="text"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder={exemploTitulo}
                maxLength={120}
              />
            </label>
            <label className="campo">
              <span>{traduzir('O que deve ser feito', 'Work to be done')}</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={exemploPrompt}
              />
            </label>
            <div className="agenda-anexos">
              <label className="botao botao-fantasma">
                <Icone nome="anexo" tamanho={16} /> {subindo ? traduzir('Enviando arquivos…', 'Uploading files…') : traduzir('Anexar arquivos', 'Attach files')}
                <input type="file" multiple className="sr-only" aria-label={traduzir('Arquivos da atividade', 'Activity files')} disabled={subindo || enviando} onChange={e => { void enviarArquivos(Array.from(e.target.files || [])); e.target.value = '' }} />
              </label>
              <p className="texto-suave">{traduzir('Envie fotos, vídeos, áudios ou documentos para esta atividade. Eles acompanham cada execução.', 'Upload photos, videos, audio or documents for this activity. They accompany each run.')}</p>
              {erroAnexo && <p role="alert" className="alerta alerta-erro">{erroAnexo}</p>}
              {anexos.length > 0 && <ul className="agenda-materiais">{anexos.map(a => <li key={a.referencia}><span>{a.nome}</span><button type="button" className="botao-texto" disabled={subindo || enviando} aria-label={`${traduzir('Retirar', 'Remove')} ${a.nome}`} onClick={() => setAnexos(atuais => atuais.filter(item => item.referencia !== a.referencia))}>{traduzir('Retirar', 'Remove')}</button></li>)}</ul>}
            </div>
            <div className="linha-campos">
              <label className="campo">
                <span>{traduzir('Repetir', 'Repeat')}</span>
                <select
                  value={recorrencia}
                  onChange={(e) => {
                    const r = e.target.value as 'semanal' | 'mensal' | 'uma_vez'
                    setRecorrencia(r)
                    // Troca de régua: segunda-feira (0) não é um dia do mês
                    // válido, e dia 15 não é um dia da semana. uma_vez ignora
                    // o dia (quem manda é a data).
                    setDia(r === 'mensal' ? 1 : 0)
                  }}
                >
                  <option value="semanal">{traduzir('Toda semana', 'Every week')}</option>
                  <option value="mensal">{traduzir('Todo mês', 'Every month')}</option>
                  <option value="uma_vez">{traduzir('Uma vez (dia marcado)', 'Once (scheduled date)')}</option>
                </select>
              </label>
              {recorrencia === 'uma_vez' ? (
                <label className="campo">
                  <span>{traduzir('Data', 'Date')}</span>
                  <input
                    type="date"
                    value={data}
                    // A régua é a de BRASÍLIA (é o que o backend valida e o
                    // que o campo de hora ao lado promete) — não o fuso do
                    // aparelho: em Manaus o picker deixaria escolher um dia
                    // que já é ontem em SP e o salvar levaria 422.
                    // 'en-CA' formata exatamente AAAA-MM-DD.
                    min={new Date().toLocaleDateString('en-CA', {
                      timeZone: 'America/Sao_Paulo',
                    })}
                    onChange={(e) => setData(e.target.value)}
                  />
                </label>
              ) : (
                <label className="campo">
                  <span>{recorrencia === 'semanal' ? traduzir('Dia da semana', 'Day of the week') : traduzir('Dia do mês', 'Day of the month')}</span>
                  <select value={dia} onChange={(e) => setDia(Number(e.target.value))}>
                    <OpcoesDia recorrencia={recorrencia} />
                  </select>
                </label>
              )}
              <label className="campo">
                <span>{traduzir('Hora (de Brasília)', 'Time (Brasília)')}</span>
                <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
              </label>
            </div>
            <button type="submit" className="botao botao-primario" disabled={enviando || subindo}>
              {enviando ? traduzir('Agendando…', 'Scheduling…') : traduzir('Agendar', 'Schedule')}
            </button>
            <p className="texto-suave agenda-nota">
              {traduzir('Cada execução usa o saldo e os limites do seu plano. Se usar a IA local no aplicativo, mantenha o computador e a IA ligados no horário escolhido.', 'Each run uses your plan’s balance and limits. If you use local AI in the desktop app, keep the computer and AI running at the scheduled time.')}
            </p>
          </form>
        </section>
      )}
    </div>
  )
}
