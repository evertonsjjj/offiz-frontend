import { useIdioma } from '../../lib/i18n'
import { useTextoEscritorio } from '../../lib/i18nEscritorios'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, asList, ApiError, getSessionIdentity } from '../../lib/api'
import { useToasts } from '../Toasts'
import { Icone, iconeDoArquivo } from '../Icone'
import { PecasCaso } from './PecasCaso'
import {
  AREA_DIREITO_LABEL,
  CONFIANCA_LABEL,
  POLO_CLIENTE_LABEL,
  STATUS_CASO_CLASSE,
  STATUS_CASO_LABEL,
  TIPO_CLIENTE_LABEL,
  formatBytes,
  formatData,
  formatDataHora,
} from '../../lib/format'
import type {
  Caso,
  CasoDocumento,
  CasoResumo,
  CampoExtraido,
  PreviewExtracao,
  StatusCaso,
} from '../../lib/types'

/* ------------------------------------------------------------------ */
/* Constantes de domínio                                               */
/* ------------------------------------------------------------------ */

/** Valores EXATOS de `StatusCaso` no backend (models/caso.py). */
const STATUS_OPCOES: StatusCaso[] = [
  'ativo',
  'em_analise',
  'aguardando_documentos',
  'aguardando_pericia',
  'protocolado',
  'em_andamento',
  'aprovado',
  'negado',
  'recurso',
  'concluido',
  'arquivado',
]

/** Valores EXATOS de `AreaDireito` no backend (a chave é o que vai para a API). */
const AREAS_DIREITO: string[] = [
  'previdenciario',
  'trabalhista',
  'civil',
  'consumidor',
  'familia',
  'tributario',
  'penal',
  'empresarial',
  'administrativo',
  'imobiliario',
]

const MAX_ARQUIVOS_PREVIEW = 5

/** Campos do formulário de caso na ordem em que aparecem. */
interface FormCaso {
  cliente_nome: string
  tipo_cliente: string
  polo_cliente: string
  area_direito: string
  status: string
  numero_processo: string
  descricao: string
}

const FORM_VAZIO: FormCaso = {
  cliente_nome: '',
  tipo_cliente: 'PF',
  polo_cliente: 'autor',
  area_direito: 'previdenciario',
  status: 'ativo',
  numero_processo: '',
  descricao: '',
}

/** Mapeia chaves de campo do preview-extracao para o formulário. */
const CHAVE_PARA_CAMPO: Record<string, keyof FormCaso> = {
  cliente_nome: 'cliente_nome',
  tipo_cliente: 'tipo_cliente',
  polo_cliente: 'polo_cliente',
  area_direito: 'area_direito',
  numero_processo: 'numero_processo',
  descricao: 'descricao',
}

function classeConfianca(c: string | undefined): string {
  if (c === 'alta') return 'confianca-alta'
  if (c === 'media') return 'confianca-media'
  return 'confianca-baixa'
}

/* ------------------------------------------------------------------ */
/* Badge de confiança                                                  */
/* ------------------------------------------------------------------ */

function BadgeConfianca({ confianca }: { confianca?: string }) {
  const tx = useTextoEscritorio()
  if (!confianca) return null
  const rotulo = tx(CONFIANCA_LABEL[confianca] ?? confianca)
  return (
    <span className={`confianca-badge ${classeConfianca(confianca)}`} title={rotulo}>
      {confianca === 'alta' ? '●' : confianca === 'media' ? '◐' : '○'} {rotulo}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Formulário de novo caso (com dropzone + autofill por IA)            */
/* ------------------------------------------------------------------ */

interface ArquivoPendente {
  arquivo: File
  nome: string
  tamanho: number
}

type DocumentoComLeitura = CasoDocumento & {
  texto_disponivel?: boolean
  leitura_parcial?: boolean
  leitura_aviso?: string | null
}

function NovoCaso({
  orgId,
  slug,
  aoCancelar,
  aoCriar,
}: {
  orgId: number
  slug: string
  aoCancelar: () => void
  aoCriar: (caso: Caso) => void
}) {
  const { idioma } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const [form, setForm] = useState<FormCaso>(FORM_VAZIO)
  const [confiancas, setConfiancas] = useState<Partial<Record<keyof FormCaso, string>>>({})
  const [arquivos, setArquivos] = useState<ArquivoPendente[]>([])
  const [extraindo, setExtraindo] = useState(false)
  const [avisoIA, setAvisoIA] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const previewPedido = useRef(0)
  const revisaoForm = useRef(0)
  const previewOcupado = useRef(false)
  const cadastroOcupado = useRef(false)
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => { montado.current = false; previewPedido.current++; previewOcupado.current = false }
  }, [orgId, slug])

  function atualizar<K extends keyof FormCaso>(campo: K, valor: string) {
    revisaoForm.current++
    setForm((f) => ({ ...f, [campo]: valor }))
    // Editar um campo remove o badge de confiança (agora é dado do humano).
    setConfiancas((c) => (c[campo] ? { ...c, [campo]: undefined } : c))
  }

  const adicionarArquivos = useCallback(
    (lista: File[]) => {
      if (lista.length === 0) return
      revisaoForm.current++
      setArquivos((prev) => {
        const combinados = [...prev]
        for (const arquivo of lista) {
          if (combinados.length >= MAX_ARQUIVOS_PREVIEW) break
          if (combinados.some((a) => a.nome === arquivo.name && a.tamanho === arquivo.size)) continue
          combinados.push({ arquivo, nome: arquivo.name, tamanho: arquivo.size })
        }
        return combinados
      })
    },
    [],
  )

  function onEscolher(e: ChangeEvent<HTMLInputElement>) {
    adicionarArquivos(Array.from(e.target.files ?? []))
    e.target.value = ''
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setArrastando(false)
    adicionarArquivos(Array.from(e.dataTransfer.files ?? []))
  }

  function removerArquivo(alvo: ArquivoPendente) {
    revisaoForm.current++
    setArquivos((prev) => prev.filter((a) => a !== alvo))
  }

  async function extrair() {
    if (arquivos.length === 0 || previewOcupado.current) return
    previewOcupado.current = true
    const pedido = ++previewPedido.current
    const revisao = revisaoForm.current
    const sessao = getSessionIdentity()
    const vigente = () => pedido === previewPedido.current && sessao === getSessionIdentity()
    setExtraindo(true)
    setAvisoIA(null)
    try {
      const fd = new FormData()
      arquivos.slice(0, MAX_ARQUIVOS_PREVIEW).forEach((a) => fd.append('arquivos', a.arquivo, a.nome))
      if (window.offizMotor?.chatDeviceId) fd.append('motor_local', window.offizMotor.chatDeviceId)
      const res = await api.postForm<PreviewExtracao>(`/predios/${orgId}/${slug}/casos/preview-extracao`, fd)
      if (!vigente()) return
      if (revisao !== revisaoForm.current) {
        setAvisoIA(tx("Os dados ou documentos mudaram durante a leitura. Suas alterações foram preservadas; confira e extraia novamente."))
        return
      }
      const campos = res?.campos ?? {}
      if (res?.aviso) setAvisoIA(res.aviso)

      const novoForm: FormCaso = { ...form }
      const novasConf: Partial<Record<keyof FormCaso, string>> = {}
      let preenchidos = 0
      for (const [chave, dado] of Object.entries(campos)) {
        const campo = CHAVE_PARA_CAMPO[chave]
        const info = dado as CampoExtraido
        if (!campo || !info || typeof info.valor !== 'string' || !info.valor.trim()) continue
        novoForm[campo] = info.valor
        if (info.confianca) novasConf[campo] = info.confianca
        preenchidos++
      }
      if (res?.numero_processo_detectado && !novoForm.numero_processo) {
        novoForm.numero_processo = res.numero_processo_detectado
      }
      setForm(novoForm)
      setConfiancas(novasConf)
      if (preenchidos > 0) {
        sucesso(tx("{0} campo(s) pré-preenchido(s) pela IA — revise e ajuste antes de salvar.", preenchidos))
      } else if (!res?.aviso) {
        setAvisoIA(tx("A IA não conseguiu extrair campos destes documentos. Preencha manualmente."))
      }
    } catch (e) {
      if (vigente()) falha(e instanceof ApiError ? e.detail : tx("Não foi possível extrair os dados dos documentos."))
    } finally {
      if (pedido === previewPedido.current) {
        previewOcupado.current = false
        setExtraindo(false)
      }
    }
  }

  async function salvar() {
    if (cadastroOcupado.current || !montado.current) return
    const sessao = getSessionIdentity()
    const vigente = () => montado.current && sessao === getSessionIdentity()
    const nome = form.cliente_nome.trim()
    if (!nome) {
      falha(tx("Informe o nome do cliente/parte antes de salvar."))
      return
    }
    cadastroOcupado.current = true
    setSalvando(true)
    try {
      const caso = await api.post<Caso>(`/predios/${orgId}/${slug}/casos`, {
        cliente_nome: nome,
        tipo_cliente: form.tipo_cliente,
        polo_cliente: form.polo_cliente,
        area_direito: form.area_direito,
        status: form.status,
        numero_processo: form.numero_processo.trim() || undefined,
        descricao: form.descricao.trim() || undefined,
      })
      if (!vigente()) return
      // Os anexos do preview também pertencem ao caso criado. Uma falha de
      // anexo não deve repetir a criação nem esconder o caso já salvo.
      try {
        for (const pendente of arquivos) {
          if (!vigente()) return
          const fd = new FormData()
          fd.append('arquivo', pendente.arquivo, pendente.nome)
          const leitura = await api.postForm<DocumentoComLeitura>(`/predios/${orgId}/${slug}/casos/${caso.id}/documentos`, fd)
          if (!vigente()) return
          if (leitura.leitura_aviso) falha(tx('Documento salvo. {0}: {1}', pendente.nome, leitura.leitura_aviso))
        }
      } catch (e) {
        if (!vigente()) return
        falha(e instanceof ApiError ? tx('Caso salvo, mas há anexo pendente: {0}', e.detail) : tx('Caso salvo, mas nem todos os anexos foram enviados. Anexe os arquivos restantes no caso.'))
      }
      if (!vigente()) return
      sucesso(tx("Caso de “{0}” criado.", nome))
      aoCriar(caso)
    } catch (e) {
      if (vigente()) falha(e instanceof ApiError ? e.detail : tx("Não foi possível criar o caso."))
    } finally {
      cadastroOcupado.current = false
      if (vigente()) setSalvando(false)
    }
  }

  const temConfianca = Object.values(confiancas).some(Boolean)

  return (
    <section className="cartao caso-form">
      <div className="secao-cabecalho">
        <h2 className="secao-titulo">{tx("Novo caso")}</h2>
        <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoCancelar}> {tx("← Voltar à lista")} </button>
      </div>

      <p className="texto-suave"> {tx("Arraste os documentos do cliente (procuração, laudos, extratos) e deixe a IA pré-preencher o cadastro — ou preencha manualmente. Os badges indicam a")} <strong>{tx("confiança")}</strong> {tx("de cada campo extraído.")} </p>
      <p className="texto-suave">{tx("No motor local, a assinatura usa o texto de PDF, TXT ou DOCX. Imagens e páginas digitalizadas sem texto precisam de transcrição; esta etapa não aplica OCR. Revise os campos antes de salvar.")}</p>

      <div
        className={arrastando ? 'dropzone arrastando' : 'dropzone'}
        onDragOver={(e) => {
          e.preventDefault()
          setArrastando(true)
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
      >
        <input ref={inputRef} type="file" multiple hidden onChange={onEscolher} accept=".pdf,.docx,.png,.jpg,.jpeg,.txt" />
        <span className="dropzone-icone" aria-hidden="true">
          <Icone nome="anexo" tamanho={30} traco={1.4} />
        </span>
        <span className="dropzone-texto"> {tx("Arraste até")} {MAX_ARQUIVOS_PREVIEW} {tx("documentos aqui ou")} <u>{tx("clique para escolher")}</u>
        </span>
      </div>

      {arquivos.length > 0 && (
        <ul className="lista-uploads caso-arquivos-preview">
          {arquivos.map((a, i) => (
            <li key={i} className="upload-item">
              <span className="upload-nome">{a.nome}</span>
              <span className="upload-tamanho">{formatBytes(a.tamanho, idioma)}</span>
              <button type="button" className="botao-texto perigo" onClick={() => removerArquivo(a)}> {tx("remover")} </button>
            </li>
          ))}
        </ul>
      )}

      {arquivos.length > 0 && (
        <div className="caso-form-extrair">
          <button type="button" className="botao botao-primario" onClick={extrair} disabled={extraindo}>
            {extraindo ? tx("Lendo documentos…") : <><Icone nome="ia" tamanho={15} /> {tx("Extrair dados com IA")}</>}
          </button>
          {temConfianca && <span className="texto-suave">{tx("Campos com badge foram sugeridos pela IA — confira.")}</span>}
        </div>
      )}

      {avisoIA && (
        <p className="alerta alerta-aviso" role="note">
          {avisoIA}
        </p>
      )}

      <div className="caso-form-campos">
        <label className="campo">
          <span> {tx("Cliente / parte *")} <BadgeConfianca confianca={confiancas.cliente_nome} />
          </span>
          <input
            type="text"
            value={form.cliente_nome}
            onChange={(e) => atualizar('cliente_nome', e.target.value)}
            placeholder={tx("Nome completo ou razão social")}
          />
        </label>

        <div className="linha-campos">
          <label className="campo">
            <span> {tx("Tipo de cliente")} <BadgeConfianca confianca={confiancas.tipo_cliente} />
            </span>
            <select value={form.tipo_cliente} onChange={(e) => atualizar('tipo_cliente', e.target.value)}>
              {Object.entries(TIPO_CLIENTE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {tx(l)}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span> {tx("Polo")} <BadgeConfianca confianca={confiancas.polo_cliente} />
            </span>
            <select value={form.polo_cliente} onChange={(e) => atualizar('polo_cliente', e.target.value)}>
              {Object.entries(POLO_CLIENTE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {tx(l)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="linha-campos">
          <label className="campo">
            <span> {tx("Área do direito")} <BadgeConfianca confianca={confiancas.area_direito} />
            </span>
            <select value={form.area_direito} onChange={(e) => atualizar('area_direito', e.target.value)}>
              {AREAS_DIREITO.map((a) => (
                <option key={a} value={a}>
                  {tx(AREA_DIREITO_LABEL[a] ?? a)}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Status</span>
            <select value={form.status} onChange={(e) => atualizar('status', e.target.value)}>
              {STATUS_OPCOES.map((s) => (
                <option key={s} value={s}>
                  {tx(STATUS_CASO_LABEL[s] ?? s)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="campo">
          <span> {tx("Número do processo")} <BadgeConfianca confianca={confiancas.numero_processo} />
          </span>
          <input
            type="text"
            value={form.numero_processo}
            onChange={(e) => atualizar('numero_processo', e.target.value)}
            placeholder={tx("0000000-00.0000.0.00.0000 (opcional)")}
          />
        </label>

        <label className="campo">
          <span> {tx("Descrição / observações")} <BadgeConfianca confianca={confiancas.descricao} />
          </span>
          <textarea
            rows={4}
            value={form.descricao}
            onChange={(e) => atualizar('descricao', e.target.value)}
            placeholder={tx("Resumo do caso, pedidos, contexto…")}
          />
        </label>
      </div>

      <div className="caso-form-rodape">
        <button type="button" className="botao botao-fantasma" onClick={aoCancelar}> {tx("Cancelar")} </button>
        <button type="button" className="botao botao-primario" onClick={salvar} disabled={salvando}>
          {salvando ? tx("Salvando…") : tx("Salvar caso")}
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Detalhe do caso                                                     */
/* ------------------------------------------------------------------ */

function DetalheCaso({
  orgId,
  slug,
  casoId,
  aoVoltar,
  aoAtualizarLista,
}: {
  orgId: number
  slug: string
  casoId: number
  aoVoltar: () => void
  aoAtualizarLista: () => void
}) {
  const { idioma } = useIdioma()
  const tx = useTextoEscritorio()
  const navigate = useNavigate()
  const { sucesso, falha } = useToasts()
  const [caso, setCaso] = useState<Caso | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pergunta, setPergunta] = useState('')
  const [perguntando, setPerguntando] = useState(false)
  const [enviandoDoc, setEnviandoDoc] = useState(false)
  const inputDocRef = useRef<HTMLInputElement | null>(null)

  const carregar = useCallback(async () => {
    try {
      const data = await api.get<Caso>(`/predios/${orgId}/${slug}/casos/${casoId}`)
      setCaso(data)
      setErro(null)
    } catch (e) {
      setErro(e instanceof ApiError ? e.detail : tx("Não foi possível carregar o caso."))
    }
  }, [orgId, slug, casoId])

  useEffect(() => {
    setCaso(null)
    carregar()
  }, [carregar])

  async function mudarStatus(status: string) {
    if (!caso) return
    const anterior = caso.status
    setCaso({ ...caso, status })
    try {
      await api.patch(`/predios/${orgId}/${slug}/casos/${caso.id}/status`, { status })
      sucesso(tx("Status alterado para “{0}”.", tx(STATUS_CASO_LABEL[status] ?? status)))
      aoAtualizarLista()
    } catch (e) {
      setCaso((c) => (c ? { ...c, status: anterior } : c))
      falha(e instanceof ApiError ? e.detail : tx("Não foi possível alterar o status."))
    }
  }

  async function enviarDocumento(e: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (arquivos.length === 0 || !caso) return
    setEnviandoDoc(true)
    try {
      for (const arquivo of arquivos) {
        const fd = new FormData()
        fd.append('arquivo', arquivo, arquivo.name)
        const leitura = await api.postForm<DocumentoComLeitura>(`/predios/${orgId}/${slug}/casos/${caso.id}/documentos`, fd)
        if (leitura.leitura_aviso) falha(tx('Documento salvo. {0}: {1}', arquivo.name, leitura.leitura_aviso))
      }
      sucesso(arquivos.length === 1 ? tx("Documento vinculado ao caso.") : tx("{0} documentos vinculados.", arquivos.length))
      await carregar()
    } catch (err) {
      falha(err instanceof ApiError ? err.detail : tx("Não foi possível anexar o documento."))
    } finally {
      setEnviandoDoc(false)
    }
  }

  async function perguntarIA() {
    const texto = pergunta.trim()
    if (!texto || !caso) return
    setPerguntando(true)
    try {
      const res = await api.post<{ job_id: number }>(`/predios/${orgId}/${slug}/casos/${caso.id}/ai`, {
        pergunta: texto,
      })
      setPergunta('')
      // A pergunta vira TAREFA, e o lugar de acompanhar tarefa na shell viva é
      // a Visão geral (a placa de execução mostra o que está rodando).
      // Antes daqui saía um navigate para `/predios/{org}/{slug}?aba=tarefas`:
      // a rota da shell ANTERIOR, com abas no topo. Quem perguntava sobre um
      // caso era cuspido para fora da interface do produto, numa tela com
      // outro menu — e sem caminho de volta óbvio. A rota nem existe mais.
      sucesso(tx("Pergunta enviada ao escritório — acompanhe na Visão geral."))
      if (res?.job_id) {
        navigate(`/app?org=${orgId}&slug=${slug}&f=inicio`)
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        falha(tx("Este prédio já está trabalhando — aguarde a tarefa atual terminar para perguntar."))
      } else {
        falha(e instanceof ApiError ? e.detail : tx("Não foi possível enviar a pergunta."))
      }
    } finally {
      setPerguntando(false)
    }
  }

  if (erro) {
    return (
      <section className="cartao">
        <p className="alerta alerta-erro">{tx(erro)}</p>
        <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoVoltar}> {tx("← Voltar à lista")} </button>
      </section>
    )
  }

  if (!caso) {
    return (
      <div aria-hidden="true">
        <div className="esqueleto esqueleto-card" style={{ minHeight: 220 }} />
      </div>
    )
  }

  const documentos: DocumentoComLeitura[] = caso.documentos ?? []
  const temPrazo = caso.proximo_prazo || caso.data_audiencia

  return (
    <div className="caso-detalhe">
      <div className="caso-detalhe-topo">
        <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoVoltar}> {tx("← Voltar à lista")} </button>
        <span className={`status-pill ${STATUS_CASO_CLASSE[caso.status] ?? 'status-queued'}`}>
          {tx(STATUS_CASO_LABEL[caso.status] ?? caso.status)}
        </span>
      </div>

      <section className="cartao">
        <div className="caso-detalhe-cabecalho">
          <div>
            <h2 className="secao-titulo">{caso.cliente_nome}</h2>
            <p className="texto-suave caso-detalhe-sub">
              {caso.area_direito ? AREA_DIREITO_LABEL[caso.area_direito] ?? caso.area_direito : tx("Área não informada")}
              {caso.tipo_cliente && <> · {tx(TIPO_CLIENTE_LABEL[caso.tipo_cliente] ?? caso.tipo_cliente)}</>}
              {caso.polo_cliente && <> · {tx(POLO_CLIENTE_LABEL[caso.polo_cliente] ?? caso.polo_cliente)}</>}
            </p>
          </div>
          <label className="campo caso-status-select">
            <span>Status</span>
            <select value={caso.status} onChange={(e) => mudarStatus(e.target.value)}>
              {STATUS_OPCOES.map((s) => (
                <option key={s} value={s}>
                  {tx(STATUS_CASO_LABEL[s] ?? s)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <dl className="sobre-detalhes">
          {caso.numero_processo && (
            <div>
              <dt>{tx("Número do processo")}</dt>
              <dd>
                <code>{caso.numero_processo}</code>
              </dd>
            </div>
          )}
          {caso.criado_em && (
            <div>
              <dt>{tx("Aberto em")}</dt>
              <dd>{formatDataHora(caso.criado_em, idioma)}</dd>
            </div>
          )}
        </dl>

        {temPrazo && (
          <div className="caso-prazos">
            {caso.proximo_prazo && (
              <div className="caso-prazo caso-prazo-destaque">
                <span className="caso-prazo-rotulo"><Icone nome="relogio" tamanho={15} /> {tx("Próximo prazo")}</span>
                <strong>{formatData(caso.proximo_prazo, idioma)}</strong>
              </div>
            )}
            {caso.data_audiencia && (
              <div className="caso-prazo caso-prazo-destaque">
                <span className="caso-prazo-rotulo"><Icone nome="casos" tamanho={15} /> {tx("Audiência")}</span>
                <strong>{formatData(caso.data_audiencia, idioma)}</strong>
              </div>
            )}
          </div>
        )}

        {caso.descricao && <p className="caso-descricao">{caso.descricao}</p>}
      </section>

      <section className="cartao">
        <div className="secao-cabecalho">
          <h3 className="secao-titulo"> {tx("Documentos")} {documentos.length > 0 && <span className="contador">{documentos.length}</span>}
          </h3>
          <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            onClick={() => inputDocRef.current?.click()}
            disabled={enviandoDoc}
          >
            {enviandoDoc ? tx("Enviando…") : <><Icone nome="anexo" tamanho={15} /> {tx("Anexar")}</>}
          </button>
          <input ref={inputDocRef} type="file" multiple hidden onChange={enviarDocumento} />
        </div>
        {documentos.length === 0 && (
          <p className="texto-suave">{tx("Nenhum documento vinculado. Anexe procurações, laudos e petições.")}</p>
        )}
        {documentos.length > 0 && (
          <ul className="lista-arquivos caso-docs">
            {documentos.map((d) => (
              <li key={d.id}>
                <span className="arquivo-nome">
                  <Icone nome={iconeDoArquivo(d.nome)} tamanho={15} /> {d.nome}
                </span>
                <span className="caso-doc-meta">
                  {d.ocr_processado && <span className="status-pill status-done">OCR</span>}
                  {d.texto_disponivel && <span className="status-pill status-done">{tx(d.leitura_parcial ? 'Texto parcial' : 'Texto disponível')}</span>}
                  {d.leitura_aviso && <span className="texto-suave">{tx(d.leitura_aviso)}</span>}
                  <span className="arquivo-tamanho">{formatBytes(d.tamanho_bytes ?? 0, idioma)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PecasCaso orgId={orgId} slug={slug} casoId={caso.id} />

      <section className="cartao">
        <h3 className="secao-titulo">{tx("Perguntar à IA sobre este caso")}</h3>
        <p className="texto-suave"> {tx("A pergunta vai ao escritório já com o contexto do caso (cliente, área, documentos). A resposta aparece na aba")} <strong> {tx("Tarefas")}</strong>.
        </p>
        <textarea
          rows={3}
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          placeholder={tx("Ex.: elabore a petição inicial com base nos documentos anexados…")}
        />
        <div className="caso-form-rodape">
          <button type="button" className="botao botao-primario" onClick={perguntarIA} disabled={perguntando || !pergunta.trim()}>
            {perguntando ? tx("Enviando…") : <><Icone nome="ia" tamanho={15} /> {tx("Perguntar à IA")}</>}
          </button>
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Card de caso na lista                                               */
/* ------------------------------------------------------------------ */

function CardCaso({ caso, aoAbrir }: { caso: CasoResumo; aoAbrir: () => void }) {
  const { idioma } = useIdioma()
  const tx = useTextoEscritorio()
  const prazo = caso.proximo_prazo || caso.data_audiencia
  const prazoRotulo = caso.data_audiencia && !caso.proximo_prazo ? tx("Audiência") : tx("Próximo prazo")
  return (
    <button type="button" className="caso-card" onClick={aoAbrir}>
      <div className="caso-card-topo">
        <strong className="caso-card-nome">{caso.cliente_nome}</strong>
        <span className={`status-pill ${STATUS_CASO_CLASSE[caso.status] ?? 'status-queued'}`}>
          {tx(STATUS_CASO_LABEL[caso.status] ?? caso.status)}
        </span>
      </div>
      <div className="caso-card-meta">
        {caso.area_direito && (
          <span className="caso-area">{tx(AREA_DIREITO_LABEL[caso.area_direito] ?? caso.area_direito)}</span>
        )}
        {caso.polo_cliente && <span>{tx(POLO_CLIENTE_LABEL[caso.polo_cliente] ?? caso.polo_cliente)}</span>}
        {typeof caso.total_documentos === 'number' && caso.total_documentos > 0 && (
          <span><Icone nome="anexo" tamanho={15} /> {caso.total_documentos}</span>
        )}
      </div>
      {caso.numero_processo && (
        <code className="caso-card-processo">{caso.numero_processo}</code>
      )}
      {prazo && (
        <div className="caso-card-prazo">
          {prazoRotulo === tx("Audiência")
            ? <Icone nome="casos" tamanho={15} />
            : <Icone nome="relogio" tamanho={15} />}{' '}
          {prazoRotulo}: <strong>{formatData(prazo, idioma)}</strong>
        </div>
      )}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Aba principal                                                       */
/* ------------------------------------------------------------------ */

type Vista = { modo: 'lista' } | { modo: 'novo' } | { modo: 'detalhe'; id: number }

export function CasosTab({ orgId, slug }: { orgId: number; slug: string }) {
  const tx = useTextoEscritorio()
  const [searchParams, setSearchParams] = useSearchParams()
  const [casos, setCasos] = useState<CasoResumo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroArea, setFiltroArea] = useState('')
  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')

  // Vista derivada do query param `caso` (permite deep-link).
  const casoParam = searchParams.get('caso')
  const novoParam = searchParams.get('novo')
  const vista: Vista = novoParam
    ? { modo: 'novo' }
    : casoParam && /^\d+$/.test(casoParam)
      ? { modo: 'detalhe', id: Number(casoParam) }
      : { modo: 'lista' }

  function irPara(v: Vista) {
    const params = new URLSearchParams(searchParams)
    params.delete('caso')
    params.delete('novo')
    if (v.modo === 'novo') params.set('novo', '1')
    else if (v.modo === 'detalhe') params.set('caso', String(v.id))
    setSearchParams(params, { replace: true })
  }

  const carregar = useCallback(async () => {
    try {
      const qs = new URLSearchParams()
      if (filtroStatus) qs.set('status', filtroStatus)
      if (filtroArea) qs.set('area', filtroArea)
      if (buscaAplicada) qs.set('q', buscaAplicada)
      const sufixo = qs.toString() ? `?${qs.toString()}` : ''
      const data = await api.get<unknown>(`/predios/${orgId}/${slug}/casos${sufixo}`)
      setCasos(asList<CasoResumo>(data, 'itens', 'casos'))
      setErro(null)
    } catch (e) {
      setErro(e instanceof ApiError ? e.detail : tx("Não foi possível carregar os casos."))
    }
  }, [orgId, slug, filtroStatus, filtroArea, buscaAplicada])

  useEffect(() => {
    if (vista.modo === 'lista') carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregar, vista.modo])

  // Debounce da busca livre.
  useEffect(() => {
    const t = window.setTimeout(() => setBuscaAplicada(busca.trim()), 350)
    return () => window.clearTimeout(t)
  }, [busca])

  if (vista.modo === 'novo') {
    return (
      <NovoCaso
        key={`${orgId}/${slug}`}
        orgId={orgId}
        slug={slug}
        aoCancelar={() => irPara({ modo: 'lista' })}
        aoCriar={(caso) => irPara({ modo: 'detalhe', id: caso.id })}
      />
    )
  }

  if (vista.modo === 'detalhe') {
    return (
      <DetalheCaso
        orgId={orgId}
        slug={slug}
        casoId={vista.id}
        aoVoltar={() => irPara({ modo: 'lista' })}
        aoAtualizarLista={carregar}
      />
    )
  }

  const lista = casos ?? []
  const temFiltro = !!(filtroStatus || filtroArea || buscaAplicada)

  return (
    <div className="casos">
      <div className="casos-barra">
        <div className="campo-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={tx("Buscar por cliente ou processo…")}
            aria-label={tx("Buscar casos")}
          />
        </div>
        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} aria-label={tx("Filtrar por status")}>
          <option value="">{tx("Todos os status")}</option>
          {STATUS_OPCOES.map((s) => (
            <option key={s} value={s}>
              {tx(STATUS_CASO_LABEL[s] ?? s)}
            </option>
          ))}
        </select>
        <select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)} aria-label={tx("Filtrar por área")}>
          <option value="">{tx("Todas as áreas")}</option>
          {AREAS_DIREITO.map((a) => (
            <option key={a} value={a}>
              {tx(AREA_DIREITO_LABEL[a] ?? a)}
            </option>
          ))}
        </select>
        <button type="button" className="botao botao-primario" onClick={() => irPara({ modo: 'novo' })}>
          <Icone nome="mais" tamanho={15} /> {tx("Novo caso")} </button>
      </div>

      {erro && <p className="alerta alerta-erro">{tx(erro)}</p>}

      {casos === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-card" />
          <div className="esqueleto esqueleto-card" />
        </div>
      )}

      {casos !== null && lista.length === 0 && (
        <div className="estado-vazio">
          <div className="estado-vazio-arte" aria-hidden="true">
            <Icone nome="casos" tamanho={44} traco={1.3} />
          </div>
          <h2>{temFiltro ? tx("Nenhum caso com esses filtros") : tx("Nenhum caso ainda")}</h2>
          <p>
            {temFiltro
              ? tx("Ajuste ou limpe os filtros para ver todos os casos.")
              : tx("Cadastre o primeiro caso — arraste os documentos do cliente e a IA pré-preenche o cadastro.")}
          </p>
          {!temFiltro && (
            <p>
              <button type="button" className="botao botao-primario" onClick={() => irPara({ modo: 'novo' })}>
                <Icone nome="mais" tamanho={15} /> {tx("Novo caso")} </button>
            </p>
          )}
        </div>
      )}

      {lista.length > 0 && (
        <div className="casos-grid">
          {lista.map((c) => (
            <CardCaso key={c.id} caso={c} aoAbrir={() => irPara({ modo: 'detalhe', id: c.id })} />
          ))}
        </div>
      )}
    </div>
  )
}
