import { useIdioma, type Idioma } from '../../lib/i18n'
import { useTextoEscritorio } from '../../lib/i18nEscritorios'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { api, asList, baixarArquivo, ApiError, getSessionIdentity } from '../../lib/api'
import { Icone, iconeDoArquivo } from '../Icone'
import { useToasts } from '../Toasts'
import { useConfirmacao } from '../useConfirmacao'
import { formatBytes } from '../../lib/format'

/* ------------------------------------------------------------------ */
/* Tipos (contrato Fase E: backend /predios/{org}/{slug}/meses)        */
/* ------------------------------------------------------------------ */

/** Um mês de trabalho — uma pasta entrada/<AAAA-MM>/ no workspace. */
interface Mes {
  /** Período no formato AAAA-MM (ex.: "2026-06"). */
  periodo: string
  /** Rótulo pronto do backend (ex.: "junho de 2026"). */
  rotulo: string
  total_arquivos: number
}

/** Um arquivo dentro de um mês. */
interface MesArquivo {
  nome: string
  tamanho_bytes: number
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/** Rótulo de fallback caso o backend não mande um (ex.: "junho de 2026"). */
function rotuloDe(periodo: string, idioma: Idioma): string {
  if (idioma === 'en' && /^\d{4}-\d{2}$/.test(periodo)) {
    const data = new Date(periodo + '-01T12:00:00Z')
    if (!Number.isNaN(data.getTime())) return data.toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }
  const [ano, mes] = periodo.split('-')
  const i = Number(mes) - 1
  const nome = MESES[i]
  if (!nome || !ano) return periodo
  return `${nome.toLowerCase()} de ${ano}`
}

/* ------------------------------------------------------------------ */
/* Criar um mês novo (seletor mês/ano, default o mês atual)            */
/* ------------------------------------------------------------------ */

function NovoMes({ aoAdicionar }: { aoAdicionar: (periodo: string) => Promise<void> }) {
  const tx = useTextoEscritorio()
  const agora = new Date()
  const [ano, setAno] = useState(agora.getFullYear())
  const [mes, setMes] = useState(agora.getMonth() + 1)
  const [salvando, setSalvando] = useState(false)

  async function adicionar() {
    const periodo = `${ano}-${String(mes).padStart(2, '0')}`
    setSalvando(true)
    try {
      await aoAdicionar(periodo)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="linha-campos" style={{ alignItems: 'flex-end' }}>
      <label className="campo">
        <span>{tx("Mês")}</span>
        <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
          {MESES.map((m, i) => (
            <option key={i + 1} value={i + 1}>
              {tx(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="campo">
        <span>{tx("Ano")}</span>
        <input
          type="number"
          value={ano}
          min={2000}
          max={2200}
          onChange={(e) => setAno(Number(e.target.value))}
        />
      </label>
      <button type="button" className="botao botao-primario" onClick={adicionar} disabled={salvando}>
        {salvando ? (
          'Criando…'
        ) : (
          <>
            <Icone nome="mais" tamanho={15} /> {tx("Criar mês")} </>
        )}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Card de um mês (lazy: busca os arquivos no primeiro expandir)       */
/* ------------------------------------------------------------------ */

function MesCard({
  orgId,
  slug,
  mes,
  aoAtualizarContagem,
}: {
  orgId: number
  slug: string
  mes: Mes
  /** Repropaga a contagem real de arquivos para o resumo da lista. */
  aoAtualizarContagem: (periodo: string, total: number) => void
}) {
  const { idioma, t } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const [arquivos, setArquivos] = useState<MesArquivo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [removendo, setRemovendo] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const buscouRef = useRef(false)
  const sessaoRef = useRef(getSessionIdentity())
  const vivoRef = useRef(true)
  const leituraRef = useRef<AbortController | null>(null)
  const enviandoRef = useRef(false)
  const removendoRef = useRef(false)
  const base = `/predios/${orgId}/${slug}/meses/${encodeURIComponent(mes.periodo)}/arquivos`
  const { confirmar, dialogo } = useConfirmacao(`${sessaoRef.current}:${orgId}:${slug}:${mes.periodo}`)
  const telaAtual = useCallback(() => vivoRef.current && getSessionIdentity() === sessaoRef.current, [])
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; leituraRef.current?.abort() } }, [])

  const carregar = useCallback(async () => {
    if (!telaAtual()) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    const atual = () => telaAtual() && !controller.signal.aborted
    setCarregando(true)
    setErro(null)
    try {
      const data = await api.get<unknown>(base, controller.signal)
      if (!atual()) return
      const lista = asList<MesArquivo>(data, 'arquivos')
      setArquivos(lista)
      aoAtualizarContagem(mes.periodo, lista.length)
    } catch (e) {
      if (!atual()) return
      setErro(e instanceof ApiError ? e.detail : tx("Não foi possível carregar os arquivos deste mês."))
    } finally {
      if (atual()) setCarregando(false)
    }
  }, [base, mes.periodo, aoAtualizarContagem, telaAtual, tx])

  async function enviar(e: ChangeEvent<HTMLInputElement>) {
    const escolhidos = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (escolhidos.length === 0 || !telaAtual() || enviandoRef.current) return
    enviandoRef.current = true
    setEnviando(true)
    let enviados = 0
    try {
      for (const arquivo of escolhidos) {
        if (!telaAtual()) break
        const fd = new FormData()
        fd.append('file', arquivo, arquivo.name)
        await api.postForm(base, fd)
        enviados += 1
      }
      if (!telaAtual()) return
      sucesso(escolhidos.length === 1 ? tx("Arquivo enviado.") : tx("{0} arquivos enviados.", escolhidos.length))
      await carregar()
    } catch (err) {
      if (!telaAtual()) return
      falha(err instanceof ApiError ? err.detail : tx("Não foi possível enviar o arquivo."))
      if (enviados > 0) await carregar()
    } finally {
      enviandoRef.current = false
      if (telaAtual()) setEnviando(false)
    }
  }

  async function removerArquivo(nome: string) {
    if (!telaAtual() || removendoRef.current) return
    const rotulo = idioma === 'en' ? rotuloDe(mes.periodo, idioma) : mes.rotulo || rotuloDe(mes.periodo, idioma)
    if (!await confirmar({ titulo: t('Remover arquivo do mês', 'Remove monthly file'), mensagem: t(`Remover “${nome}” de ${rotulo}? O arquivo é apagado do servidor.`, `Remove “${nome}” from ${rotulo}? The file will be deleted from the server.`), acao: t('Remover arquivo', 'Remove file') }) || !telaAtual() || removendoRef.current) return
    removendoRef.current = true
    setRemovendo(nome)
    leituraRef.current?.abort()
    try {
      await api.del(`${base}/${encodeURIComponent(nome)}`)
      if (!telaAtual()) return
      const restantes = (arquivos ?? []).filter(arquivo => arquivo.nome !== nome)
      setArquivos(restantes)
      aoAtualizarContagem(mes.periodo, restantes.length)
      await carregar()
    } catch (err) {
      if (telaAtual()) falha(err instanceof ApiError ? err.detail : tx("Não foi possível remover o arquivo."))
    } finally { removendoRef.current = false; if (telaAtual()) setRemovendo(null) }
  }

  function baixar(nome: string) {
    if (!telaAtual()) return
    baixarArquivo(`${base}/${encodeURIComponent(nome)}`, nome).catch(() =>
      { if (telaAtual()) falha(tx("Não foi possível baixar o arquivo.")) },
    )
  }

  // Resumo do summary: usa a contagem já buscada; antes disso, a do backend.
  const total = arquivos !== null ? arquivos.length : mes.total_arquivos

  return (
    <details
      className="cliente-grupo"
      onToggle={(e) => {
        // Lazy: só busca no PRIMEIRO expandir (o "tentar de novo" cobre o erro).
        if ((e.target as HTMLDetailsElement).open && !buscouRef.current) {
          buscouRef.current = true
          carregar()
        }
      }}
    >
      {dialogo}
      <summary>
        <span className="cliente-grupo-titulo">
          <Icone nome="meses" tamanho={15} /> {idioma === 'en' ? rotuloDe(mes.periodo, idioma) : mes.rotulo || rotuloDe(mes.periodo, idioma)}
        </span>
        <span className="cliente-grupo-resumo">
          {total === 1 ? tx('1 arquivo') : tx("{0} arquivos", total)}
        </span>
      </summary>

      <div className="secao-cabecalho" style={{ marginTop: '0.4rem' }}>
        <p className="texto-suave" style={{ margin: 0 }}> {tx("Seus documentos de")} {idioma === 'en' ? rotuloDe(mes.periodo, idioma) : mes.rotulo || rotuloDe(mes.periodo, idioma)}.
        </p>
        <button
          type="button"
          className="botao botao-fantasma botao-pequeno"
          onClick={() => inputRef.current?.click()}
          disabled={enviando}
        >
          {enviando ? (
            tx("Enviando…")
          ) : (
            <>
              <Icone nome="mais" tamanho={15} /> {tx("Arquivos")} </>
          )}
        </button>
        <input ref={inputRef} type="file" multiple hidden onChange={enviar} />
      </div>

      {carregando && (
        <div className="esqueleto esqueleto-card" style={{ minHeight: 60 }} aria-hidden="true" />
      )}

      {erro && !carregando && (
        <p className="alerta alerta-erro" role="alert">
          {tx(erro)}{' '}
          <button type="button" className="botao-texto" onClick={carregar}> {tx("tentar de novo")} </button>
        </p>
      )}

      {arquivos !== null && !carregando && (
        arquivos.length === 0 ? (
          <p className="texto-suave"> {tx("Nenhum arquivo neste mês. Suba extratos, planilhas e documentos.")} </p>
        ) : (
          <ul className="lista-arquivos">
            {arquivos.map((a) => (
              <li key={a.nome}>
                <button
                  type="button"
                  className="arquivo-nome botao-texto"
                  title={tx("Baixar arquivo")}
                  onClick={() => baixar(a.nome)}
                >
                  <Icone nome={iconeDoArquivo(a.nome)} tamanho={15} /> {a.nome}
                </button>
                <span className="caso-doc-meta">
                  <span className="arquivo-tamanho">{formatBytes(a.tamanho_bytes ?? 0, idioma)}</span>
                  <button type="button" className="botao-texto" onClick={() => baixar(a.nome)}> {tx("baixar")} </button>
                  <button type="button" className="botao-texto perigo" disabled={removendo !== null} onClick={() => removerArquivo(a.nome)}> {removendo === a.nome ? t('Removendo…', 'Removing…') : tx("remover")} </button>
                </span>
              </li>
            ))}
          </ul>
        )
      )}
    </details>
  )
}

/* ------------------------------------------------------------------ */
/* Aba principal                                                       */
/* ------------------------------------------------------------------ */

export function MesesTab({ orgId, slug }: { orgId: number; slug: string }) {
  return <MesesConteudo key={`${orgId}:${slug}:${getSessionIdentity()}`} orgId={orgId} slug={slug} />
}

function MesesConteudo({ orgId, slug }: { orgId: number; slug: string }) {
  const { idioma } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const [meses, setMeses] = useState<Mes[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const sessaoRef = useRef(getSessionIdentity())
  const vivoRef = useRef(true)
  const leituraRef = useRef<AbortController | null>(null)
  const criandoRef = useRef(false)
  const telaAtual = useCallback(() => vivoRef.current && getSessionIdentity() === sessaoRef.current, [])
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; leituraRef.current?.abort() } }, [])

  const carregar = useCallback(async () => {
    if (!telaAtual()) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    const atual = () => telaAtual() && !controller.signal.aborted
    try {
      const data = await api.get<unknown>(`/predios/${orgId}/${slug}/meses`, controller.signal)
      if (!atual()) return
      setMeses(asList<Mes>(data, 'meses'))
      setErro(null)
    } catch (e) {
      if (atual()) setErro(e instanceof ApiError ? e.detail : tx("Não foi possível carregar os meses."))
    }
  }, [orgId, slug, telaAtual, tx])

  useEffect(() => {
    carregar()
  }, [carregar])

  // Mantém o resumo do card em sincronia com a contagem real, sem refazer
  // a lista inteira toda vez que um upload/remoção acontece.
  const atualizarContagem = useCallback((periodo: string, total: number) => {
    setMeses((atual) =>
      atual === null
        ? atual
        : atual.map((m) => (m.periodo === periodo ? { ...m, total_arquivos: total } : m)),
    )
  }, [])

  async function criarMes(periodo: string) {
    if (!telaAtual() || criandoRef.current) return
    criandoRef.current = true
    try {
      const criado = await api.post<Mes>(`/predios/${orgId}/${slug}/meses`, { periodo })
      if (!telaAtual()) return
      sucesso(tx("Mês {0} criado.", idioma === 'en' ? rotuloDe(periodo, idioma) : criado.rotulo || rotuloDe(periodo, idioma)))
      // Insere e reordena desc (mais recente primeiro), evitando duplicar se
      // o mês já existia na lista.
      setMeses((atual) => {
        const base = (atual ?? []).filter((m) => m.periodo !== criado.periodo)
        return [...base, criado].sort((a, b) => b.periodo.localeCompare(a.periodo))
      })
    } catch (e) {
      if (!telaAtual()) return
      if (e instanceof ApiError && e.status === 409) {
        falha(tx("Esse mês já existe."))
      } else {
        falha(e instanceof ApiError ? e.detail : tx("Não foi possível criar o mês."))
      }
    } finally { criandoRef.current = false }
  }

  return (
    <div className="casos">
      <section className="cartao">
        <div className="secao-cabecalho">
          <h2 className="secao-titulo">{tx("Novo mês")}</h2>
        </div>
        <p className="texto-suave" style={{ marginTop: 0 }}> {tx("Cada mês é uma pasta sua — suba aqui os documentos daquele período para os agentes trabalharem.")} </p>
        <NovoMes aoAdicionar={criarMes} />
      </section>

      {erro && <p className="alerta alerta-erro" role="alert">{tx(erro)}{' '}<button type="button" className="botao-texto" onClick={() => void carregar()}>{tx('tentar de novo')}</button></p>}

      {meses === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-card" />
          <div className="esqueleto esqueleto-card" />
        </div>
      )}

      {meses !== null && meses.length === 0 && (
        <div className="estado-vazio">
          <div className="estado-vazio-arte" aria-hidden="true">
            <Icone nome="meses" tamanho={44} traco={1.3} />
          </div>
          <h2>{tx("Nenhum mês ainda")}</h2>
          <p>{tx("Crie o primeiro mês acima e suba os documentos daquele período.")}</p>
        </div>
      )}

      {meses !== null && meses.length > 0 && (
        <div className="cliente-grupos" style={{ marginTop: '1rem' }}>
          {meses.map((m) => (
            <MesCard
              key={m.periodo}
              orgId={orgId}
              slug={slug}
              mes={m}
              aoAtualizarContagem={atualizarContagem}
            />
          ))}
        </div>
      )}
    </div>
  )
}
