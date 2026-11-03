import { useIdioma, type Idioma } from '../../lib/i18n'
import { useTextoEscritorio } from '../../lib/i18nEscritorios'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { api, asList, ApiError, getSessionIdentity } from '../../lib/api'
import { Icone } from '../Icone'
import type { NomeIcone } from '../Icone'
import { useToasts } from '../Toasts'
import { useConfirmacao } from '../useConfirmacao'
import { AREA_DIREITO_LABEL, formatDataHora } from '../../lib/format'
import type { BibliotecaItem, PecaTipo, TipoBiblioteca } from '../../lib/types'

/* ------------------------------------------------------------------ */
/* Aba "Doutrina & Modelos" — biblioteca org×office do escritório juris */
/*                                                                      */
/* MODELOS: templates de peça reutilizados na geração (PecasCaso).      */
/* DOUTRINAS: livros/obras (texto extraído) citáveis pela IA.           */
/* ------------------------------------------------------------------ */

/** Limites do contrato de API: 20MB por arquivo, 50 itens por tipo. */
const MAX_MB = 20
const MAX_ITENS_POR_TIPO = 50

const AREAS_DIREITO = Object.keys(AREA_DIREITO_LABEL)

/** O sinal de cada tipo da biblioteca (chaves do set em components/Icone). */
const ABAS: { id: TipoBiblioteca; rotulo: string; icone: NomeIcone }[] = [
  { id: 'modelo', rotulo: 'Modelos de Peça', icone: 'arq-documento' },
  { id: 'doutrina', rotulo: 'Doutrinas (livros)', icone: 'guia' },
]

/** O mesmo sinal nos cartões, nos modais e no estado vazio — uma fonte só.
 *  Tipado como `NomeIcone` (e não `string`) de propósito: chave errada quebra
 *  no tsc, não em silêncio na tela. */
function iconeDoTipo(tipo?: string): NomeIcone {
  return tipo === 'doutrina' ? 'guia' : 'arq-documento'
}

/** "12345" → "12,3 mil caracteres" — tamanho legível do texto do item. */
function formatChars(n: number | undefined, idioma: Idioma): string {
  if (!n) return '—'
  const total = new Intl.NumberFormat(idioma, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  return idioma === 'en' ? total + ' characters' : total + ' caracteres'
}

function mensagemErro(e: unknown, padrao: string): string {
  return e instanceof ApiError ? e.detail || padrao : padrao
}

/** Estado do formulário de criação/edição (modal). */
interface FormItem {
  titulo: string
  descricao: string
  tipo_peca: string
  area_direito: string
  tags: string
  conteudo: string
}

const FORM_VAZIO: FormItem = { titulo: '', descricao: '', tipo_peca: '', area_direito: '', tags: '', conteudo: '' }

function tagsParaLista(texto: string): string[] {
  return texto
    .split(',')
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* Modal de criar/editar (textarea grande)                             */
/* ------------------------------------------------------------------ */

function EditorModal({
  aba,
  tipos,
  itemInicial,
  salvando,
  aoFechar,
  aoSalvar,
}: {
  aba: TipoBiblioteca
  tipos: PecaTipo[]
  /** null = criação; com item (JÁ com conteudo) = edição. */
  itemInicial: BibliotecaItem | null
  salvando: boolean
  aoFechar: () => void
  aoSalvar: (form: FormItem) => void
}) {
  const tx = useTextoEscritorio()
  const [form, setForm] = useState<FormItem>(() =>
    itemInicial
      ? {
          titulo: itemInicial.titulo ?? '',
          descricao: itemInicial.descricao ?? '',
          tipo_peca: itemInicial.tipo_peca ?? '',
          area_direito: itemInicial.area_direito ?? '',
          tags: (itemInicial.tags ?? []).join(', '),
          conteudo: itemInicial.conteudo ?? '',
        }
      : FORM_VAZIO,
  )
  const [erroForm, setErroForm] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !salvando) aoFechar()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [aoFechar, salvando])

  const eDoutrina = aba === 'doutrina'
  const rotulo = tx(eDoutrina ? 'doutrina' : 'modelo')

  function salvar() {
    if (!form.titulo.trim()) {
      setErroForm(tx("Dê um título ao item."))
      return
    }
    if (!form.conteudo.trim()) {
      setErroForm(tx("O conteúdo d{0} {1} não pode ficar vazio — cole o texto ou use “Importar arquivo”.", eDoutrina ? 'a' : 'o', rotulo))
      return
    }
    setErroForm(null)
    aoSalvar(form)
  }

  return (
    <div className="biblioteca-overlay" role="dialog" aria-modal="true" aria-label={itemInicial ? tx("Editar {0}", rotulo) : tx("Nov{0} {1}", eDoutrina ? 'a' : 'o', rotulo)}>
      <div className="biblioteca-modal">
        <div className="biblioteca-modal-cabecalho">
          <h3 className="secao-titulo">
            {itemInicial ? (
              <>
                <Icone nome="lapis" /> {tx("Editar {0}", rotulo)}
              </>
            ) : (
              <>
                <Icone nome={iconeDoTipo(aba)} />{' '}
                {eDoutrina ? tx("Nova doutrina") : tx("Novo modelo")}
              </>
            )}
          </h3>
          <button
            type="button"
            className="biblioteca-fechar"
            style={{ display: 'inline-flex', alignItems: 'center' }}
            onClick={aoFechar}
            aria-label={tx("Fechar")}
            disabled={salvando}
          >
            <Icone nome="fechar" />
          </button>
        </div>

        <div className="biblioteca-modal-corpo">
          <div className="biblioteca-form-linha">
            <label className="campo">
              <span>{tx("Título *")}</span>
              <input
                type="text"
                value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                placeholder={eDoutrina ? tx("Ex.: Curso de Direito Previdenciário — Autor") : tx("Ex.: Petição inicial — danos morais")}
                disabled={salvando}
              />
            </label>
            <label className="campo">
              <span>{tx("Descrição")}</span>
              <input
                type="text"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder={tx("Breve descrição (opcional)")}
                disabled={salvando}
              />
            </label>
          </div>
          <div className="biblioteca-form-linha">
            {!eDoutrina && (
              <label className="campo">
                <span>{tx("Tipo de peça")}</span>
                <select
                  value={form.tipo_peca}
                  onChange={(e) => setForm({ ...form, tipo_peca: e.target.value })}
                  disabled={salvando}
                >
                  <option value="">{tx("Sem tipo específico")}</option>
                  {tipos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="campo">
              <span>{tx("Área do direito")}</span>
              <select
                value={form.area_direito}
                onChange={(e) => setForm({ ...form, area_direito: e.target.value })}
                disabled={salvando}
              >
                <option value="">{tx("Sem área específica")}</option>
                {AREAS_DIREITO.map((a) => (
                  <option key={a} value={a}>
                    {tx(AREA_DIREITO_LABEL[a])}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>{tx("Tags (separadas por vírgula)")}</span>
              <input
                type="text"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder={tx("Ex.: dano_moral, consumidor")}
                disabled={salvando}
              />
            </label>
          </div>
          <label className="campo biblioteca-campo-conteudo">
            <span>{tx("Conteúdo *")}</span>
            <textarea
              rows={14}
              value={form.conteudo}
              onChange={(e) => setForm({ ...form, conteudo: e.target.value })}
              placeholder={
                eDoutrina
                  ? tx("Cole aqui o texto da obra (ou use “Importar arquivo” para extrair de um PDF)…")
                  : tx("Cole aqui o texto do seu modelo/template…")
              }
              disabled={salvando}
            />
          </label>
          {erroForm && (
            <p className="alerta alerta-erro" role="alert">
              {erroForm}
            </p>
          )}
        </div>

        <div className="biblioteca-modal-rodape">
          <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoFechar} disabled={salvando}> {tx("Cancelar")} </button>
          <button type="button" className="botao botao-primario" onClick={salvar} disabled={salvando}>
            {salvando ? tx("Salvando…") : itemInicial ? tx("Salvar alterações") : eDoutrina ? tx("Adicionar à biblioteca") : tx("Criar modelo")}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Modal de visualização (conteúdo completo + copiar)                  */
/* ------------------------------------------------------------------ */

function VerModal({ item, aoFechar }: { item: BibliotecaItem; aoFechar: () => void }) {
  const { idioma } = useIdioma()
  const tx = useTextoEscritorio()
  const { falha } = useToasts()
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [aoFechar])

  async function copiar() {
    try {
      await navigator.clipboard.writeText(item.conteudo ?? '')
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      falha(tx("Não foi possível copiar — selecione o texto e copie manualmente."))
    }
  }

  return (
    <div className="biblioteca-overlay" role="dialog" aria-modal="true" aria-label={tx("Conteúdo: {0}", item.titulo)}>
      <div className="biblioteca-modal">
        <div className="biblioteca-modal-cabecalho">
          <h3 className="secao-titulo">
            <Icone nome={iconeDoTipo(item.tipo)} /> {item.titulo}
          </h3>
          <button
            type="button"
            className="biblioteca-fechar"
            style={{ display: 'inline-flex', alignItems: 'center' }}
            onClick={aoFechar}
            aria-label={tx("Fechar")}
          >
            <Icone nome="fechar" />
          </button>
        </div>
        <div className="biblioteca-modal-corpo">
          <div className="biblioteca-ver-acoes">
            <button type="button" className={`botao botao-fantasma botao-pequeno ${copiado ? 'biblioteca-copiado' : ''}`} onClick={copiar}>
              {copiado ? (
                <>
                  <Icone nome="visto" tamanho={15} /> {tx("Copiado")} </>
              ) : (
                <>
                  <Icone nome="copiar" tamanho={15} /> {tx("Copiar conteúdo")} </>
              )}
            </button>
            {!!item.tamanho_chars && <span className="texto-suave">{formatChars(item.tamanho_chars, idioma)}</span>}
          </div>
          <pre className="biblioteca-conteudo">{item.conteudo || tx("Este item ainda não tem conteúdo.")}</pre>
        </div>
        <div className="biblioteca-modal-rodape">
          <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoFechar}> {tx("Fechar")} </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Aba principal                                                       */
/* ------------------------------------------------------------------ */

export function BibliotecaTab({ orgId, slug }: { orgId: number; slug: string }) {
  return <BibliotecaConteudo key={`${orgId}:${slug}:${getSessionIdentity()}`} orgId={orgId} slug={slug} />
}

function BibliotecaConteudo({ orgId, slug }: { orgId: number; slug: string }) {
  const { idioma, t } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const base = `/predios/${orgId}/${slug}`

  const [aba, setAba] = useState<TipoBiblioteca>('modelo')
  const abaRef = useRef(aba)
  abaRef.current = aba
  const [itens, setItens] = useState<BibliotecaItem[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // Filtros
  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [filtroTipoPeca, setFiltroTipoPeca] = useState('')
  const [filtroArea, setFiltroArea] = useState('')

  // Catálogo de tipos de peça (mesmo da geração de peças).
  const [tipos, setTipos] = useState<PecaTipo[]>([])

  // Modal criar/editar
  const [editorAberto, setEditorAberto] = useState(false)
  const [itemEdicao, setItemEdicao] = useState<BibliotecaItem | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Importar PDF/TXT
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [importando, setImportando] = useState(false)
  const [arrastando, setArrastando] = useState(false)

  // Visualizar/copiar (a lista é leve — o conteúdo vem do GET /{id})
  const [verItem, setVerItem] = useState<BibliotecaItem | null>(null)
  const [ocupadoId, setOcupadoId] = useState<number | null>(null)
  const [carregando, setCarregando] = useState(false)
  const sessaoRef = useRef(getSessionIdentity())
  const vivoRef = useRef(true)
  const leituraRef = useRef<AbortController | null>(null)
  const excluindoRef = useRef(new Set<number>())
  const { confirmar, dialogo } = useConfirmacao(`${sessaoRef.current}:${orgId}:${slug}:${aba}`)
  const telaAtual = useCallback((tipo?: TipoBiblioteca) => vivoRef.current && getSessionIdentity() === sessaoRef.current && (!tipo || abaRef.current === tipo), [])
  useEffect(() => {
    vivoRef.current = true
    return () => { vivoRef.current = false; leituraRef.current?.abort() }
  }, [])

  const carregar = useCallback(async () => {
    if (!telaAtual()) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    const atual = () => telaAtual(aba) && !controller.signal.aborted
    setCarregando(true)
    try {
      const qs = new URLSearchParams({ tipo: aba })
      if (buscaAplicada) qs.set('busca', buscaAplicada)
      if (aba === 'modelo' && filtroTipoPeca) qs.set('tipo_peca', filtroTipoPeca)
      if (filtroArea) qs.set('area', filtroArea)
      const data = await api.get<unknown>(`${base}/biblioteca?${qs.toString()}`, controller.signal)
      if (!atual()) return
      setItens(asList<BibliotecaItem>(data, 'itens'))
      setErro(null)
    } catch (e) {
      if (!atual()) return
      setErro(mensagemErro(e, tx("Não foi possível carregar a biblioteca.")))
    } finally { if (atual()) setCarregando(false) }
  }, [base, aba, buscaAplicada, filtroTipoPeca, filtroArea, telaAtual, tx])

  useEffect(() => {
    setItens(null)
    setErro(null)
    carregar()
    return () => leituraRef.current?.abort()
  }, [carregar])

  // Debounce da busca livre (mesmo padrão da aba Casos).
  useEffect(() => {
    const t = window.setTimeout(() => setBuscaAplicada(busca.trim()), 350)
    return () => window.clearTimeout(t)
  }, [busca])

  // Catálogo de tipos de peça — 1x, para selects e rótulos.
  useEffect(() => {
    let ativo = true
    api
      .get<{ tipos: PecaTipo[] }>(`${base}/pecas-tipos`)
      .then((res) => {
        if (ativo) setTipos(res?.tipos ?? [])
      })
      .catch(() => {
        if (ativo) setTipos([])
      })
    return () => {
      ativo = false
    }
  }, [base])

  function nomeTipoPeca(id?: string | null): string {
    if (!id) return ''
    return tipos.find((t) => t.id === id)?.nome ?? id.replace(/_/g, ' ')
  }

  function trocarAba(nova: TipoBiblioteca) {
    if (nova === aba) return
    setAba(nova)
    setFiltroTipoPeca('')
    setFiltroArea('')
    setBusca('')
    setBuscaAplicada('')
  }

  /* ── Criar / editar ── */

  async function abrirEdicao(item: BibliotecaItem) {
    if (!telaAtual()) return
    const tipo = aba
    setOcupadoId(item.id)
    try {
      const res = await api.get<{ item: BibliotecaItem }>(`${base}/biblioteca/${item.id}`)
      if (!telaAtual(tipo)) return
      setItemEdicao(res?.item ?? item)
      setEditorAberto(true)
    } catch (e) {
      if (telaAtual(tipo)) falha(mensagemErro(e, tx("Não foi possível abrir o item para edição.")))
    } finally {
      if (telaAtual()) setOcupadoId(atual => atual === item.id ? null : atual)
    }
  }

  async function salvarEditor(form: FormItem) {
    if (!telaAtual() || salvando) return
    const tipo = aba
    leituraRef.current?.abort()
    setSalvando(true)
    const corpo = {
      titulo: form.titulo.trim(),
      descricao: form.descricao.trim() || undefined,
      tipo_peca: form.tipo_peca || undefined,
      area_direito: form.area_direito || undefined,
      tags: tagsParaLista(form.tags),
      conteudo: form.conteudo,
    }
    try {
      if (itemEdicao) {
        await api.put<{ item: BibliotecaItem }>(`${base}/biblioteca/${itemEdicao.id}`, corpo)
        if (!telaAtual(tipo)) return
        sucesso(tx("Item atualizado."))
      } else {
        await api.post<{ item: BibliotecaItem }>(`${base}/biblioteca`, { tipo: aba, ...corpo })
        if (!telaAtual(tipo)) return
        sucesso(aba === 'doutrina' ? tx("Doutrina adicionada à biblioteca.") : tx("Modelo criado."))
      }
      setEditorAberto(false)
      setItemEdicao(null)
      carregar()
    } catch (e) {
      if (telaAtual(tipo)) falha(mensagemErro(e, tx("Não foi possível salvar o item.")))
    } finally {
      if (telaAtual()) setSalvando(false)
    }
  }

  /* ── Importar PDF/TXT ── */

  async function importarArquivo(arquivo: File) {
    if (!telaAtual() || importando) return
    const tipo = aba
    const ext = arquivo.name.toLowerCase()
    if (!ext.endsWith('.pdf') && !ext.endsWith('.txt')) {
      falha(tx("Formato não suportado — envie um PDF ou TXT."))
      return
    }
    if (arquivo.size > MAX_MB * 1024 * 1024) {
      falha(tx("Arquivo grande demais — o limite é {0}MB.", MAX_MB))
      return
    }
    setImportando(true)
    try {
      const fd = new FormData()
      fd.append('arquivo', arquivo)
      fd.append('tipo', aba)
      const res = await api.postForm<{ item: BibliotecaItem }>(`${base}/biblioteca/importar`, fd)
      if (!telaAtual(tipo)) return
      sucesso(tx("“{0}” importado — o texto foi extraído do arquivo.", res?.item?.titulo ?? arquivo.name))
      carregar()
    } catch (e) {
      // 422 do backend (PDF ilegível/escaneado) traz mensagem amigável.
      if (telaAtual(tipo)) falha(mensagemErro(e, tx("Não foi possível importar o arquivo.")))
    } finally {
      if (telaAtual()) {
        setImportando(false)
        if (importInputRef.current) importInputRef.current.value = ''
      }
    }
  }

  function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    if (arquivo) importarArquivo(arquivo)
  }

  function aoSoltar(e: DragEvent<HTMLElement>) {
    e.preventDefault()
    setArrastando(false)
    const arquivo = e.dataTransfer.files?.[0]
    if (arquivo) importarArquivo(arquivo)
  }

  /* ── Ver / copiar / excluir ── */

  async function abrirVer(item: BibliotecaItem) {
    if (!telaAtual()) return
    const tipo = aba
    setOcupadoId(item.id)
    try {
      const res = await api.get<{ item: BibliotecaItem }>(`${base}/biblioteca/${item.id}`)
      if (!telaAtual(tipo)) return
      setVerItem(res?.item ?? item)
    } catch (e) {
      if (telaAtual(tipo)) falha(mensagemErro(e, tx("Não foi possível abrir o conteúdo.")))
    } finally {
      if (telaAtual()) setOcupadoId(atual => atual === item.id ? null : atual)
    }
  }

  async function copiarConteudo(item: BibliotecaItem) {
    if (!telaAtual()) return
    const tipo = aba
    setOcupadoId(item.id)
    try {
      const res = await api.get<{ item: BibliotecaItem }>(`${base}/biblioteca/${item.id}`)
      if (!telaAtual(tipo)) return
      await navigator.clipboard.writeText(res?.item?.conteudo ?? '')
      if (!telaAtual(tipo)) return
      sucesso(tx("Conteúdo copiado."))
    } catch (e) {
      if (telaAtual(tipo)) falha(mensagemErro(e, tx("Não foi possível copiar o conteúdo.")))
    } finally {
      if (telaAtual()) setOcupadoId(atual => atual === item.id ? null : atual)
    }
  }

  async function excluir(item: BibliotecaItem) {
    if (!telaAtual() || excluindoRef.current.has(item.id)) return
    const rotulo = tx(item.tipo === 'doutrina' ? 'a doutrina' : 'o modelo')
    if (!await confirmar({ titulo: t('Excluir item da biblioteca', 'Delete library item'), mensagem: tx("Excluir {0} “{1}”? Isso não pode ser desfeito.", rotulo, item.titulo), acao: t('Excluir item', 'Delete item') }) || !telaAtual()) return
    excluindoRef.current.add(item.id)
    leituraRef.current?.abort()
    setOcupadoId(item.id)
    try {
      await api.del(`${base}/biblioteca/${item.id}`)
      if (!telaAtual()) return
      leituraRef.current?.abort()
      setItens((prev) => (prev ? prev.filter((x) => x.id !== item.id) : prev))
      sucesso(tx("Item excluído."))
    } catch (e) {
      if (telaAtual()) falha(mensagemErro(e, tx("Não foi possível excluir o item.")))
    } finally {
      excluindoRef.current.delete(item.id)
      if (telaAtual()) setOcupadoId(atual => atual === item.id ? null : atual)
    }
  }

  /* ── Render ── */

  const lista = itens ?? []
  const temFiltro = !!(buscaAplicada || filtroTipoPeca || filtroArea)
  const eDoutrina = aba === 'doutrina'
  const cheio = itens !== null && !temFiltro && itens.length >= MAX_ITENS_POR_TIPO

  return (
    <div className="biblioteca">
      {dialogo}
      <div className="biblioteca-topo">
        <div>
          <h2 className="secao-titulo">
            <Icone nome="biblioteca" /> {tx("Doutrina & Modelos")} </h2>
          <p className="texto-suave biblioteca-sub"> {tx("Biblioteca do escritório — modelos de peça e doutrinas que a IA usa na geração de peças e nas conversas.")} </p>
        </div>
        <div className="biblioteca-topo-acoes">
          <button
            type="button"
            className="botao botao-fantasma"
            onClick={() => importInputRef.current?.click()}
            disabled={importando}
          >
            {importando ? (
              tx("Extraindo o texto…")
            ) : (
              <>
                <Icone nome="subir" tamanho={15} /> {tx("Importar PDF/TXT")} </>
            )}
          </button>
          <button
            type="button"
            className="botao botao-primario"
            onClick={() => {
              setItemEdicao(null)
              setEditorAberto(true)
            }}
            disabled={importando}
          >
            <Icone nome="mais" tamanho={15} /> {eDoutrina ? tx("Nova doutrina") : tx("Novo modelo")}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".pdf,.txt"
            className="sr-only"
            aria-label={tx("Importar arquivo PDF ou TXT")}
            tabIndex={-1}
            onChange={aoEscolherArquivo}
          />
        </div>
      </div>

      <div className="biblioteca-tabs" role="tablist" aria-label={tx("Tipo de item da biblioteca")}>
        {ABAS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={aba === t.id}
            className={aba === t.id ? 'biblioteca-tab ativa' : 'biblioteca-tab'}
            onClick={() => trocarAba(t.id)}
          >
            <Icone nome={t.icone} tamanho={15} /> {tx(t.rotulo)}
            {aba === t.id && itens !== null && !temFiltro && (
              <span className="biblioteca-tab-conta">
                {itens.length}/{MAX_ITENS_POR_TIPO}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="biblioteca-filtros">
        <div className="campo-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={tx("Buscar por título…")}
            aria-label={tx("Buscar na biblioteca")}
          />
        </div>
        {!eDoutrina && (
          <select value={filtroTipoPeca} onChange={(e) => setFiltroTipoPeca(e.target.value)} aria-label={tx("Filtrar por tipo de peça")}>
            <option value="">{tx("Todos os tipos de peça")}</option>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        )}
        <select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)} aria-label={tx("Filtrar por área do direito")}>
          <option value="">{tx("Todas as áreas")}</option>
          {AREAS_DIREITO.map((a) => (
            <option key={a} value={a}>
              {tx(AREA_DIREITO_LABEL[a])}
            </option>
          ))}
        </select>
      </div>

      {importando && (
        <p className="alerta alerta-aviso" role="status">
          <span className="cursor-piscando" aria-hidden="true" /> {tx("Enviando e extraindo o texto do arquivo — isso pode levar alguns segundos…")} </p>
      )}
      {cheio && (
        <p className="alerta alerta-aviso" role="note"> {tx("Limite de")} {MAX_ITENS_POR_TIPO} {eDoutrina ? tx("doutrinas") : tx("modelos")} {tx("atingido — exclua itens antigos para adicionar novos.")} </p>
      )}
      {erro && (
        <p className="alerta alerta-erro" role="alert">
          {tx(erro)}{' '}
          <button type="button" className="botao-texto" disabled={carregando} onClick={() => void carregar()}>{t('Tentar novamente', 'Try again')}</button>
        </p>
      )}

      {itens === null && !erro && (
        <div className="biblioteca-grid" aria-hidden="true">
          <div className="esqueleto esqueleto-card" style={{ minHeight: 140 }} />
          <div className="esqueleto esqueleto-card" style={{ minHeight: 140 }} />
          <div className="esqueleto esqueleto-card" style={{ minHeight: 140 }} />
        </div>
      )}

      {itens !== null && !erro && lista.length === 0 && (
        <div
          className={arrastando ? 'biblioteca-vazio arrastando' : 'biblioteca-vazio'}
          onDragOver={(e) => {
            e.preventDefault()
            setArrastando(true)
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={aoSoltar}
        >
          <div className="biblioteca-vazio-arte" aria-hidden="true">
            <Icone nome={iconeDoTipo(aba)} tamanho={44} traco={1.3} />
          </div>
          <h3>{temFiltro ? tx("Nada encontrado com esses filtros") : eDoutrina ? tx("Nenhuma doutrina ainda") : tx("Nenhum modelo ainda")}</h3>
          <p className="texto-suave">
            {temFiltro ? (
              tx("Tente ajustar a busca ou os filtros.")
            ) : (
              <> {tx("Crie")} {eDoutrina ? tx("a primeira doutrina") : tx("o primeiro modelo")} {tx("ou arraste um")} <strong>PDF/TXT</strong> {tx("aqui para importar — a IA passa a usar a biblioteca na geração de peças.")} </>
            )}
          </p>
        </div>
      )}

      {itens !== null && lista.length > 0 && (
        <div className="biblioteca-grid">
          {lista.map((item) => (
            <article key={item.id} className="biblioteca-card">
              <div className="biblioteca-card-topo">
                <Icone nome={iconeDoTipo(item.tipo)} tamanho={15} />
                <strong className="biblioteca-card-titulo">{item.titulo}</strong>
              </div>
              {(item.tipo_peca || item.area_direito) && (
                <div className="biblioteca-card-badges">
                  {item.tipo_peca && <span className="biblioteca-badge">{nomeTipoPeca(item.tipo_peca)}</span>}
                  {item.area_direito && (
                    <span className="biblioteca-badge biblioteca-badge-area">
                      {tx(AREA_DIREITO_LABEL[item.area_direito] ?? item.area_direito)}
                    </span>
                  )}
                </div>
              )}
              {item.descricao && <p className="biblioteca-card-desc">{item.descricao}</p>}
              {(item.tags ?? []).length > 0 && (
                <div className="biblioteca-tags">
                  {(item.tags ?? []).map((t) => (
                    <span key={t} className="biblioteca-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="biblioteca-card-meta">
                {!!item.tamanho_chars && <span>{formatChars(item.tamanho_chars, idioma)}</span>}
                {item.atualizado_em && <span>{tx("atualizado em")} {formatDataHora(item.atualizado_em, idioma)}</span>}
              </div>
              <div className="biblioteca-card-acoes">
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={() => abrirVer(item)}
                  disabled={ocupadoId === item.id}
                >
                  {ocupadoId === item.id ? (
                    '…'
                  ) : (
                    <>
                      <Icone nome="olho" tamanho={15} /> {tx("Ver")} </>
                  )}
                </button>
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={() => copiarConteudo(item)}
                  disabled={ocupadoId === item.id}
                >
                  <Icone nome="copiar" tamanho={15} /> {tx("Copiar")} </button>
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={() => abrirEdicao(item)}
                  disabled={ocupadoId === item.id}
                >
                  <Icone nome="lapis" tamanho={15} /> {tx("Editar")} </button>
                <button
                  type="button"
                  className="botao botao-perigo botao-pequeno"
                  onClick={() => excluir(item)}
                  disabled={ocupadoId === item.id}
                >
                  <Icone nome="lixeira" tamanho={15} /> {tx("Excluir")} </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editorAberto && (
        <EditorModal
          key={itemEdicao?.id ?? 'novo'}
          aba={aba}
          tipos={tipos}
          itemInicial={itemEdicao}
          salvando={salvando}
          aoFechar={() => {
            if (!salvando) {
              setEditorAberto(false)
              setItemEdicao(null)
            }
          }}
          aoSalvar={salvarEditor}
        />
      )}

      {verItem && <VerModal item={verItem} aoFechar={() => setVerItem(null)} />}
    </div>
  )
}
