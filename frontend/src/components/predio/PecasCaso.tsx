import { useIdioma } from '../../lib/i18n'
import { useTextoEscritorio } from '../../lib/i18nEscritorios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, asList, ApiError, getSessionIdentity } from '../../lib/api'
import { Icone } from '../Icone'
import { useToasts } from '../Toasts'
import { useConfirmacao } from '../useConfirmacao'
import { formatBRL, formatDataHora, formatTokens } from '../../lib/format'
import type {
  BibliotecaItem,
  FeedbackConflito,
  FeedbackCriado,
  NotaFeedback,
  Peca,
  PecaComentario,
  PecaResumo,
  PecaTipo,
  PecaVersao,
  PreviewTokensPeca,
} from '../../lib/types'

/* ------------------------------------------------------------------ */
/* Helpers de domínio                                                  */
/* ------------------------------------------------------------------ */

function useTelaPeca() {
  const contaRef = useRef(getSessionIdentity())
  const montadoRef = useRef(true)
  const leituraRef = useRef<AbortController | null>(null)
  const telaAtual = useCallback(() => montadoRef.current && getSessionIdentity() === contaRef.current, [])
  useEffect(() => { montadoRef.current = true; return () => { montadoRef.current = false; leituraRef.current?.abort() } }, [])
  return { telaAtual, leituraRef, conta: contaRef.current }
}

/** Rótulos amigáveis para status de peça (tolerante a valores novos). */
const STATUS_PECA_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  gerada: 'Gerada',
  gerando: 'Gerando',
  em_revisao: 'Em revisão',
  revisao: 'Em revisão',
  pronta: 'Pronta',
  finalizada: 'Finalizada',
  concluida: 'Concluída',
  erro: 'Erro',
}

function classeStatusPeca(status: string): string {
  if (['pronta', 'finalizada', 'concluida', 'gerada'].includes(status)) return 'status-done'
  if (['erro', 'falha'].includes(status)) return 'status-failed'
  if (['gerando', 'em_revisao', 'revisao'].includes(status)) return 'status-running'
  return 'status-queued'
}

const STATUS_COMENTARIO_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  aceito: 'Aceito',
  recusado: 'Recusado',
  obsoleto: 'Obsoleto',
}

function classeStatusComentario(status: string): string {
  if (status === 'aceito') return 'status-done'
  if (status === 'recusado') return 'status-cancelled'
  if (status === 'obsoleto') return 'status-failed'
  return 'status-running'
}

/** Mensagem amigável para erros da API (429/502 têm tratamento especial). */
function mensagemErro(e: unknown, padrao: string): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Outra geração de IA está em andamento — aguarde um instante e tente de novo.'
    if (e.status === 404) return 'Peça ou caso não encontrado (pode ter sido excluído).'
    return e.detail || padrao
  }
  return padrao
}

/** Aceita tanto {peca: {...}} quanto o objeto direto — contrato tolerante. */
function unwrapPeca(data: unknown): Peca | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  const candidato = (obj.peca ?? obj) as Record<string, unknown>
  if (typeof candidato?.id === 'number') return candidato as unknown as Peca
  return null
}

function unwrapComentario(data: unknown): PecaComentario | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  const candidato = (obj.comentario ?? obj) as Record<string, unknown>
  if (typeof candidato?.id === 'number') return candidato as unknown as PecaComentario
  return null
}

/* ------------------------------------------------------------------ */
/* Download no cliente (.txt e .docx)                                  */
/* ------------------------------------------------------------------ */

function baixarBlob(blob: Blob, nomeArquivo: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function nomeArquivoSeguro(titulo: string): string {
  const limpo = titulo
    .normalize('NFD')
    // remove diacríticos (acentos) após decompor
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
  return limpo || 'peca'
}

/**
 * Exporta o conteúdo (markdown básico) como .docx no cliente.
 * Portado de portaljurisia/frontend/lib/export-docx.ts — usa o pacote "docx"
 * carregado sob demanda (import dinâmico) para não pesar o bundle inicial.
 */
async function exportarDocx(conteudo: string, nomeArquivo: string, podeBaixar: () => boolean): Promise<void> {
  const { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer } = await import('docx')
  if (!podeBaixar()) return

  type ParagraphType = InstanceType<typeof Paragraph>
  type TextRunType = InstanceType<typeof TextRun>

  /** Parse **negrito** e *itálico* para TextRuns. */
  function parseInlineRuns(texto: string): TextRunType[] {
    const runs: TextRunType[] = []
    const partes = texto.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
    for (const parte of partes) {
      if (!parte) continue
      if (parte.startsWith('**') && parte.endsWith('**')) {
        runs.push(new TextRun({ text: parte.slice(2, -2), bold: true, size: 24 }))
      } else if (parte.startsWith('*') && parte.endsWith('*')) {
        runs.push(new TextRun({ text: parte.slice(1, -1), italics: true, size: 24 }))
      } else {
        runs.push(new TextRun({ text: parte, size: 24 }))
      }
    }
    return runs
  }

  function parseMarkdown(texto: string): ParagraphType[] {
    const linhas = texto.split('\n')
    const paragrafos: ParagraphType[] = []
    for (const linha of linhas) {
      if (linha.startsWith('# ')) {
        paragrafos.push(
          new Paragraph({
            children: parseInlineRuns(linha.slice(2)),
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 240, after: 120 },
          }),
        )
        continue
      }
      if (linha.startsWith('## ')) {
        paragrafos.push(
          new Paragraph({
            children: parseInlineRuns(linha.slice(3)),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 },
          }),
        )
        continue
      }
      if (linha.startsWith('### ')) {
        paragrafos.push(
          new Paragraph({
            children: parseInlineRuns(linha.slice(4)),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 80 },
          }),
        )
        continue
      }
      const numerada = linha.match(/^(\d+)\.\s+(.*)$/)
      if (numerada) {
        paragrafos.push(
          new Paragraph({
            children: [new TextRun({ text: `${numerada[1]}. `, bold: true }), ...parseInlineRuns(numerada[2])],
            spacing: { before: 60, after: 60 },
            indent: { left: 360 },
          }),
        )
        continue
      }
      if (linha.startsWith('- ') || linha.startsWith('* ')) {
        paragrafos.push(
          new Paragraph({
            children: [new TextRun({ text: '•  ' }), ...parseInlineRuns(linha.replace(/^[-*]\s/, ''))],
            spacing: { before: 40, after: 40 },
            indent: { left: 360 },
          }),
        )
        continue
      }
      if (linha.trim() === '') {
        paragrafos.push(new Paragraph({ children: [], spacing: { before: 120 } }))
        continue
      }
      paragrafos.push(
        new Paragraph({
          children: parseInlineRuns(linha),
          spacing: { before: 60, after: 60 },
          alignment: AlignmentType.JUSTIFIED,
        }),
      )
    }
    return paragrafos
  }

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children: parseMarkdown(conteudo),
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  if (podeBaixar()) baixarBlob(blob, nomeArquivo.endsWith('.docx') ? nomeArquivo : `${nomeArquivo}.docx`)
}

/* ------------------------------------------------------------------ */
/* Diff de palavras (LCS) — comparação original × proposta da IA       */
/* ------------------------------------------------------------------ */

interface ParteDiff {
  valor: string
  tipo: 'igual' | 'add' | 'del'
}

function diffPalavras(original: string, proposta: string): ParteDiff[] {
  const a = original.split(/(\s+)/).filter((t) => t !== '')
  const b = proposta.split(/(\s+)/).filter((t) => t !== '')
  // Trechos gigantes: não vale a pena o O(n·m) — mostra antes/depois.
  if (a.length * b.length > 250_000) {
    return [
      { valor: original, tipo: 'del' },
      { valor: '  ', tipo: 'igual' },
      { valor: proposta, tipo: 'add' },
    ]
  }
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const partes: ParteDiff[] = []
  const push = (valor: string, tipo: ParteDiff['tipo']) => {
    const ultimo = partes[partes.length - 1]
    if (ultimo && ultimo.tipo === tipo) ultimo.valor += valor
    else partes.push({ valor, tipo })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(a[i], 'igual')
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(a[i], 'del')
      i++
    } else {
      push(b[j], 'add')
      j++
    }
  }
  while (i < n) push(a[i++], 'del')
  while (j < m) push(b[j++], 'add')
  return partes
}

function DiffTrecho({ original, proposta }: { original: string; proposta: string }) {
  const partes = useMemo(() => diffPalavras(original, proposta), [original, proposta])
  return (
    <div className="pecas-diff">
      {partes.map((p, i) =>
        p.tipo === 'add' ? (
          <ins key={i} className="pecas-diff-add">
            {p.valor}
          </ins>
        ) : p.tipo === 'del' ? (
          <del key={i} className="pecas-diff-del">
            {p.valor}
          </del>
        ) : (
          <span key={i}>{p.valor}</span>
        ),
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Seleção de texto dentro de um container (comentários de trecho)     */
/* ------------------------------------------------------------------ */

interface SelecaoTrecho {
  texto: string
  topo: number
  esquerda: number
}

function useSelecaoNoContainer(
  containerRef: React.RefObject<HTMLElement | null>,
  ativo: boolean,
): { selecao: SelecaoTrecho | null; limpar: () => void } {
  const [selecao, setSelecao] = useState<SelecaoTrecho | null>(null)

  useEffect(() => {
    if (!ativo) {
      setSelecao(null)
      return
    }
    const handler = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelecao(null)
        return
      }
      const range = sel.getRangeAt(0)
      const container = containerRef.current
      // Só ativa se a seleção estiver inteiramente dentro do conteúdo da peça.
      if (!container || !container.contains(range.commonAncestorContainer)) {
        setSelecao(null)
        return
      }
      const texto = sel.toString().trim()
      if (texto.length < 10) {
        // Seleção muito curta — ignora para não poluir.
        setSelecao(null)
        return
      }
      const rect = range.getBoundingClientRect()
      setSelecao({
        texto,
        topo: Math.max(8, rect.top - 44),
        esquerda: Math.max(8, rect.left + rect.width / 2 - 90),
      })
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [containerRef, ativo])

  return {
    selecao,
    limpar: () => {
      window.getSelection()?.removeAllRanges()
      setSelecao(null)
    },
  }
}

/* ------------------------------------------------------------------ */
/* Card de comentário (proposta da IA sobre um trecho)                 */
/* ------------------------------------------------------------------ */

function ComentarioCard({
  comentario,
  ocupado,
  aoAceitar,
  aoRecusar,
  aoRegenerar,
}: {
  comentario: PecaComentario
  ocupado: boolean
  aoAceitar: () => void
  aoRecusar: () => void
  aoRegenerar: (instrucao?: string) => void
}) {
  const { idioma } = useIdioma()
  const tx = useTextoEscritorio()
  const [regenerando, setRegenerando] = useState(false)
  const [novaInstrucao, setNovaInstrucao] = useState('')
  const status = String(comentario.status ?? 'pendente')
  const pendente = status === 'pendente'
  const podeRegenerar = pendente || status === 'recusado'

  return (
    <div className={`pecas-comentario ${pendente ? '' : 'pecas-comentario-resolvido'}`}>
      <div className="pecas-comentario-topo">
        <span className={`status-pill ${classeStatusComentario(status)}`}>
          {tx(STATUS_COMENTARIO_LABEL[status] ?? status)}
        </span>
        {comentario.criado_em && <span className="pecas-comentario-data">{formatDataHora(comentario.criado_em, idioma)}</span>}
      </div>

      <p className="pecas-comentario-instrucao">“{comentario.instrucao}”</p>

      {status === 'obsoleto' && (
        <p className="alerta alerta-aviso pecas-comentario-aviso" role="note"> {tx("O trecho original não existe mais na peça (outro ajuste foi aceito antes). Selecione o trecho atualizado e crie um novo comentário.")} </p>
      )}

      {comentario.proposta_atual && status !== 'obsoleto' && (
        <DiffTrecho original={comentario.trecho} proposta={comentario.proposta_atual} />
      )}

      {regenerando ? (
        <div className="pecas-comentario-regenerar">
          <input
            type="text"
            value={novaInstrucao}
            onChange={(e) => setNovaInstrucao(e.target.value)}
            placeholder={tx("Nova instrução (vazio repete: “{0}”)", comentario.instrucao)}
            disabled={ocupado}
          />
          <div className="pecas-comentario-acoes">
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              onClick={() => setRegenerando(false)}
              disabled={ocupado}
            > {tx("Cancelar")} </button>
            <button
              type="button"
              className="botao botao-primario botao-pequeno"
              onClick={() => {
                aoRegenerar(novaInstrucao.trim() || undefined)
                setRegenerando(false)
                setNovaInstrucao('')
              }}
              disabled={ocupado}
            >
              {ocupado ? (
                'Gerando…'
              ) : (
                <>
                  <Icone nome="ia" tamanho={15} /> {tx("Gerar nova proposta")} </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="pecas-comentario-acoes">
          {pendente && !!comentario.proposta_atual && (
            <button type="button" className="botao botao-ok botao-pequeno" onClick={aoAceitar} disabled={ocupado}>
              {ocupado ? (
                'Aplicando…'
              ) : (
                <>
                  <Icone nome="visto" tamanho={15} /> {tx("Aceitar")} </>
              )}
            </button>
          )}
          {pendente && (
            <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoRecusar} disabled={ocupado}>
              <Icone nome="fechar" tamanho={15} /> {tx("Recusar")} </button>
          )}
          {podeRegenerar && (
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              onClick={() => setRegenerando(true)}
              disabled={ocupado}
            >
              <Icone nome="loop" tamanho={15} /> {tx("Regenerar")} </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Modal de histórico de versões                                       */
/* ------------------------------------------------------------------ */

function HistoricoModal({
  base,
  peca,
  aoFechar,
  aoRestaurar,
}: {
  base: string
  peca: Peca
  aoFechar: () => void
  aoRestaurar: (pecaAtualizada: Peca) => void
}) {
  const { idioma, t } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const [versoes, setVersoes] = useState<PecaVersao[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [expandida, setExpandida] = useState<number | null>(null)
  const [restaurando, setRestaurando] = useState<number | null>(null)
  const restaurandoRef = useRef(false)
  const { telaAtual, leituraRef, conta } = useTelaPeca()
  const { confirmar, dialogo } = useConfirmacao(`${conta}:${base}:${peca.id}`)

  const carregar = useCallback(async () => {
    if (!telaAtual()) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    try {
      const res = await api.get<{ versoes: PecaVersao[] }>(`${base}/pecas/${peca.id}/versoes`, controller.signal)
      if (!telaAtual() || controller.signal.aborted) return
      setVersoes(res?.versoes ?? [])
      setErro(null)
    } catch (e) {
      if (telaAtual() && !controller.signal.aborted) setErro(mensagemErro(e, tx("Não foi possível carregar o histórico.")))
    }
  }, [base, peca.id, telaAtual, leituraRef, tx])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); aoFechar() } }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aoFechar])

  async function restaurar(versao: number) {
    if (!telaAtual() || restaurandoRef.current) return
    if (!await confirmar({ titulo: t('Restaurar versão', 'Restore version'), mensagem: tx("Restaurar a versão {0}? A versão atual fica guardada no histórico (não perde nada).", versao), acao: t('Restaurar versão', 'Restore version') }) || !telaAtual() || restaurandoRef.current) return
    restaurandoRef.current = true
    setRestaurando(versao)
    try {
      const res = await api.post<unknown>(`${base}/pecas/${peca.id}/versoes/${versao}/restaurar`)
      if (!telaAtual()) return
      const atualizada = unwrapPeca(res)
      sucesso(atualizada ? tx("Versão {0} restaurada (peça agora na v{1}).", versao, atualizada.versao) : tx("Versão restaurada."))
      if (atualizada) aoRestaurar(atualizada)
      aoFechar()
    } catch (e) {
      if (telaAtual()) falha(mensagemErro(e, tx("Não foi possível restaurar a versão.")))
    } finally {
      restaurandoRef.current = false
      if (telaAtual()) setRestaurando(null)
    }
  }

  return (
    <div className="pecas-overlay" role="dialog" aria-modal="true" aria-label={tx("Histórico de versões")}>
      {dialogo}
      <div className="pecas-modal pecas-modal-media">
        <div className="pecas-modal-cabecalho">
          <h3 className="secao-titulo">
            <Icone nome="relogio" /> {tx("Histórico de versões")} </h3>
          <span className="texto-suave">{tx("versão atual: v")}{peca.versao}</span>
          <button type="button" className="pecas-fechar" onClick={aoFechar} aria-label={tx("Fechar histórico")}>
            <Icone nome="fechar" />
          </button>
        </div>

        <div className="pecas-modal-corpo">
          {erro && <p className="alerta alerta-erro" role="alert">{tx(erro)}{' '}<button type="button" className="botao-texto" onClick={() => void carregar()}>{t('Tentar novamente', 'Try again')}</button></p>}
          {!erro && versoes === null && <p className="texto-suave">{tx("Carregando histórico…")}</p>}
          {versoes !== null && versoes.length === 0 && (
            <p className="texto-suave"> {tx("Sem versões anteriores ainda. Toda edição, “Refazer com IA” ou ajuste aceito guarda a versão anterior aqui.")} </p>
          )}
          {versoes !== null && versoes.length > 0 && (
            <ul className="pecas-versoes">
              {versoes.map((v) => (
                <li key={v.versao} className="pecas-versao-item">
                  <div className="pecas-versao-topo">
                    <span className="pecas-versao-badge">v{v.versao}</span>
                    {v.origem && <span className="texto-suave">{v.origem}</span>}
                    {v.criado_em && <span className="texto-suave">{formatDataHora(v.criado_em, idioma)}</span>}
                    <span className="pecas-versao-acoes">
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={() => setExpandida(expandida === v.versao ? null : v.versao)}
                      >
                        {expandida === v.versao ? 'Ocultar' : 'Visualizar'}
                      </button>
                      <button
                        type="button"
                        className="botao botao-ok botao-pequeno"
                        onClick={() => restaurar(v.versao)}
                        disabled={restaurando !== null}
                      >
                        {restaurando === v.versao ? (
                          tx("Restaurando…")
                        ) : (
                          <>
                            <Icone nome="desfazer" tamanho={14} /> {tx("Restaurar")} </>
                        )}
                      </button>
                    </span>
                  </div>
                  {expandida === v.versao && <div className="pecas-versao-conteudo">{v.conteudo}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pecas-modal-rodape">
          <span className="texto-suave">{tx("Restaurar: a versão escolhida vira a atual e a atual vai para o histórico.")}</span>
          <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoFechar}> {tx("Fechar")} </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Modal principal da peça (visualizar/editar/refazer/comentar)        */
/* ------------------------------------------------------------------ */

function PecaModal({
  base,
  pecaInicial,
  areaDireito,
  aoFechar,
  aoMudar,
  aoExcluir,
}: {
  base: string
  pecaInicial: Peca
  /** Área do direito do caso (Fase 4) — vai junto no feedback 👍/👎. */
  areaDireito?: string | null
  aoFechar: () => void
  /** Notifica o pai (lista) de que a peça mudou (versão/conteúdo/status). */
  aoMudar: (peca: Peca) => void
  aoExcluir: (pecaId: number) => void
}) {
  const { t } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const [peca, setPeca] = useState<Peca>(pecaInicial)
  const [comentarios, setComentarios] = useState<PecaComentario[]>(pecaInicial.comentarios ?? [])

  // Edição manual
  const [editando, setEditando] = useState(false)
  const [conteudoEdicao, setConteudoEdicao] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Refazer com IA
  const [refazerAberto, setRefazerAberto] = useState(false)
  const [refazerInstrucoes, setRefazerInstrucoes] = useState('')
  const [refazendo, setRefazendo] = useState(false)

  // Histórico
  const [historicoAberto, setHistoricoAberto] = useState(false)

  // Comentários de trecho
  const conteudoRef = useRef<HTMLDivElement | null>(null)
  const { selecao, limpar } = useSelecaoNoContainer(conteudoRef, !editando)
  const [novoComentario, setNovoComentario] = useState<{ trecho: string } | null>(null)
  const [novaInstrucao, setNovaInstrucao] = useState('')
  const [comentando, setComentando] = useState(false)
  const [comentarioOcupado, setComentarioOcupado] = useState<number | null>(null)

  const [copiado, setCopiado] = useState(false)
  const [exportandoDocx, setExportandoDocx] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  // Fase 4: feedback 👍/👎 do advogado sobre a peça (rodapé do modal).
  const [fbNota, setFbNota] = useState<NotaFeedback | null>(null)
  const [fbCaixaAberta, setFbCaixaAberta] = useState(false)
  const [fbComentario, setFbComentario] = useState('')
  const [fbEnviando, setFbEnviando] = useState(false)
  const [fbConflito, setFbConflito] = useState<FeedbackConflito | null>(null)
  const { telaAtual, conta } = useTelaPeca()
  const { confirmar, dialogo } = useConfirmacao(`${conta}:${base}:${peca.id}`)
  const excluindoRef = useRef(false)
  const mutandoRef = useRef(false)
  const feedbackRef = useRef(false)

  const conteudo = peca.conteudo ?? ''
  const titulo = peca.titulo || peca.tipo

  function aplicarPeca(nova: Peca) {
    if (!telaAtual()) return
    setPeca((atual) => ({ ...atual, ...nova }))
    if (Array.isArray(nova.comentarios)) setComentarios(nova.comentarios)
    aoMudar(nova)
  }

  // Fechar com Esc (só o modal mais "de cima").
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (historicoAberto) return
      if (refazerAberto) { if (!refazendo) setRefazerAberto(false); return }
      if (novoComentario) {
        setNovoComentario(null)
        return
      }
      aoFechar()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historicoAberto, novoComentario, refazerAberto, refazendo])

  async function copiar() {
    if (!telaAtual()) return
    try {
      await navigator.clipboard.writeText(conteudo)
      if (!telaAtual()) return
      setCopiado(true)
      window.setTimeout(() => { if (telaAtual()) setCopiado(false) }, 2000)
    } catch {
      if (telaAtual()) falha(tx("Não foi possível copiar — selecione o texto e copie manualmente."))
    }
  }

  function exportarTxt() {
    if (!telaAtual()) return
    baixarBlob(new Blob([conteudo], { type: 'text/plain;charset=utf-8' }), `${nomeArquivoSeguro(titulo)}.txt`)
  }

  async function exportarComoDocx() {
    if (!telaAtual() || exportandoDocx) return
    setExportandoDocx(true)
    try {
      await exportarDocx(conteudo, `${nomeArquivoSeguro(titulo)}.docx`, telaAtual)
    } catch {
      if (telaAtual()) falha(tx("Não foi possível exportar o .docx."))
    } finally {
      if (telaAtual()) setExportandoDocx(false)
    }
  }

  async function salvarEdicao() {
    if (!telaAtual() || mutandoRef.current || excluindoRef.current) return
    if (!conteudoEdicao.trim()) {
      falha(tx("O conteúdo da peça não pode ficar vazio."))
      return
    }
    mutandoRef.current = true
    setSalvando(true)
    try {
      const res = await api.put<unknown>(`${base}/pecas/${peca.id}`, { conteudo: conteudoEdicao })
      if (!telaAtual()) return
      const atualizada = unwrapPeca(res)
      aplicarPeca(atualizada ?? { ...peca, conteudo: conteudoEdicao, versao: peca.versao + 1 })
      setEditando(false)
      sucesso(tx("Edição salva — nova versão criada (a anterior ficou no histórico)."))
    } catch (e) {
      if (telaAtual()) falha(mensagemErro(e, tx("Não foi possível salvar a edição.")))
    } finally {
      mutandoRef.current = false
      if (telaAtual()) setSalvando(false)
    }
  }

  async function refazer() {
    if (!telaAtual() || mutandoRef.current || excluindoRef.current) return
    mutandoRef.current = true
    setRefazendo(true)
    try {
      const res = await api.post<unknown>(`${base}/pecas/${peca.id}/refazer`, {
        instrucoes: refazerInstrucoes.trim() || undefined,
        ...(window.offizMotor?.chatDeviceId ? { motor_local: window.offizMotor.chatDeviceId } : {}),
      })
      if (!telaAtual()) return
      const atualizada = unwrapPeca(res)
      if (atualizada) aplicarPeca(atualizada)
      setRefazerAberto(false)
      setRefazerInstrucoes('')
      sucesso(tx("Peça refeita pela IA — a versão anterior ficou no histórico."))
    } catch (e) {
      if (telaAtual()) falha(mensagemErro(e, tx("Não foi possível refazer a peça.")))
    } finally {
      mutandoRef.current = false
      if (telaAtual()) setRefazendo(false)
    }
  }

  async function excluir() {
    if (!telaAtual() || excluindoRef.current || mutandoRef.current) return
    if (!await confirmar({ titulo: t('Excluir peça', 'Delete document'), mensagem: tx("Excluir a peça “{0}” definitivamente? Esta ação não pode ser desfeita.", titulo), acao: t('Excluir peça', 'Delete document') }) || !telaAtual() || excluindoRef.current || mutandoRef.current) return
    excluindoRef.current = true
    setExcluindo(true)
    try {
      await api.del(`${base}/pecas/${peca.id}`)
      if (!telaAtual()) return
      sucesso(tx("Peça excluída."))
      aoExcluir(peca.id)
      aoFechar()
    } catch (e) {
      if (telaAtual()) falha(mensagemErro(e, tx("Não foi possível excluir a peça.")))
    } finally { excluindoRef.current = false; if (telaAtual()) setExcluindo(false) }
  }

  async function criarComentario() {
    if (!novoComentario || !telaAtual() || mutandoRef.current || excluindoRef.current) return
    const instrucao = novaInstrucao.trim()
    if (instrucao.length < 3) {
      falha(tx("Descreva o que mudar neste trecho (mínimo de 3 caracteres)."))
      return
    }
    mutandoRef.current = true
    setComentando(true)
    try {
      const res = await api.post<unknown>(`${base}/pecas/${peca.id}/comentarios`, {
        trecho: novoComentario.trecho,
        instrucao,
        ...(window.offizMotor?.chatDeviceId ? { motor_local: window.offizMotor.chatDeviceId } : {}),
      })
      if (!telaAtual()) return
      const criado = unwrapComentario(res)
      if (criado) setComentarios((cs) => [criado, ...cs])
      setNovoComentario(null)
      setNovaInstrucao('')
      limpar()
      sucesso(tx("Proposta da IA gerada — confira no painel de comentários."))
    } catch (e) {
      if (telaAtual()) falha(mensagemErro(e, tx("Não foi possível gerar a proposta para o trecho.")))
    } finally {
      mutandoRef.current = false
      if (telaAtual()) setComentando(false)
    }
  }

  function atualizarComentario(atualizado: PecaComentario) {
    if (!telaAtual()) return
    setComentarios((cs) => cs.map((c) => (c.id === atualizado.id ? { ...c, ...atualizado } : c)))
  }

  async function aceitarComentario(c: PecaComentario) {
    if (!telaAtual() || mutandoRef.current || excluindoRef.current) return
    mutandoRef.current = true
    setComentarioOcupado(c.id)
    try {
      const res = await api.post<{ peca?: unknown; comentario?: unknown }>(`${base}/comentarios/${c.id}/aceitar`)
      if (!telaAtual()) return
      const pecaAtualizada = unwrapPeca(res?.peca ?? null)
      if (pecaAtualizada) aplicarPeca(pecaAtualizada)
      atualizarComentario(unwrapComentario(res?.comentario ?? null) ?? { ...c, status: 'aceito' })
      sucesso(tx("Trecho atualizado na peça (nova versão criada)."))
    } catch (e) {
      if (telaAtual()) falha(mensagemErro(e, tx("Não foi possível aplicar a proposta.")))
    } finally {
      mutandoRef.current = false
      if (telaAtual()) setComentarioOcupado(null)
    }
  }

  async function recusarComentario(c: PecaComentario) {
    if (!telaAtual() || mutandoRef.current || excluindoRef.current) return
    mutandoRef.current = true
    setComentarioOcupado(c.id)
    try {
      const res = await api.post<unknown>(`${base}/comentarios/${c.id}/recusar`)
      if (!telaAtual()) return
      atualizarComentario(unwrapComentario(res) ?? { ...c, status: 'recusado' })
      sucesso(tx("Proposta recusada."))
    } catch (e) {
      if (telaAtual()) falha(mensagemErro(e, tx("Não foi possível recusar a proposta.")))
    } finally {
      mutandoRef.current = false
      if (telaAtual()) setComentarioOcupado(null)
    }
  }

  async function regenerarComentario(c: PecaComentario, instrucao?: string) {
    if (!telaAtual() || mutandoRef.current || excluindoRef.current) return
    mutandoRef.current = true
    setComentarioOcupado(c.id)
    try {
      const res = await api.post<unknown>(`${base}/comentarios/${c.id}/regenerar`, {
        instrucao: instrucao || undefined,
        ...(window.offizMotor?.chatDeviceId ? { motor_local: window.offizMotor.chatDeviceId } : {}),
      })
      if (!telaAtual()) return
      const atualizado = unwrapComentario(res)
      if (atualizado) atualizarComentario(atualizado)
      sucesso(tx("Nova proposta gerada."))
    } catch (e) {
      if (telaAtual()) falha(mensagemErro(e, tx("Não foi possível gerar nova proposta.")))
    } finally {
      mutandoRef.current = false
      if (telaAtual()) setComentarioOcupado(null)
    }
  }

  /** Fase 4: registra o 👍/👎 sobre a peça para revisão posterior. */
  async function enviarFeedbackPeca(nota: NotaFeedback, comentario?: string) {
    if (!telaAtual() || feedbackRef.current || fbNota) return
    feedbackRef.current = true
    setFbEnviando(true)
    try {
      const corpo: Record<string, unknown> = {
        origem: 'peca',
        referencia_id: peca.id,
        nota,
        contexto_trecho: conteudo.slice(0, 300),
        ...(window.offizMotor?.chatDeviceId ? { motor_local: window.offizMotor.chatDeviceId } : {}),
      }
      if (areaDireito) corpo.area_direito = areaDireito
      const texto = comentario?.trim()
      if (texto) corpo.comentario = texto
      const res = await api.post<FeedbackCriado>(`${base}/feedbacks`, corpo)
      if (!telaAtual()) return
      setFbNota(nota)
      setFbCaixaAberta(false)
      setFbComentario('')
      if (res?.conflito) setFbConflito(res.conflito)
      sucesso(
        res?.analise_conflito === 'nao_realizada'
          ? t('Feedback registrado. A análise pela IA não foi realizada; nenhuma API foi acionada.', 'Feedback saved. AI analysis was not performed; no API was used.')
          : nota === 'positivo'
          ? tx("Obrigado! Sua avaliação foi registrada.")
          : tx("Feedback registrado."),
      )
    } catch (e) {
      if (telaAtual()) falha(mensagemErro(e, tx("Não foi possível registrar o feedback.")))
    } finally {
      feedbackRef.current = false
      if (telaAtual()) setFbEnviando(false)
    }
  }

  const pendentes = comentarios.filter((c) => c.status === 'pendente').length
  const mutando = salvando || refazendo || comentando || excluindo || comentarioOcupado !== null

  return (
    <div className="pecas-overlay" role="dialog" aria-modal="true" aria-label={tx("Peça: {0}", titulo)}>
      {dialogo}
      <div className="pecas-modal pecas-modal-grande">
        <div className="pecas-modal-cabecalho">
          <div className="pecas-modal-titulo">
            <h3 className="secao-titulo">
              <Icone nome="arq-documento" /> {titulo}
            </h3>
            <span className="pecas-versao-badge">v{peca.versao}</span>
            <span className={`status-pill ${classeStatusPeca(peca.status)}`}>
              {tx(STATUS_PECA_LABEL[peca.status] ?? peca.status)}
            </span>
          </div>
          <button type="button" className="pecas-fechar" onClick={aoFechar} aria-label={tx("Fechar peça")}>
            <Icone nome="fechar" />
          </button>
        </div>

        <div className="pecas-modal-acoes">
          <button type="button" className={`botao botao-fantasma botao-pequeno ${copiado ? 'pecas-copiado' : ''}`} onClick={copiar}>
            {copiado ? (
              <>
                <Icone nome="visto" tamanho={15} /> {tx("Copiado")} </>
            ) : (
              <>
                <Icone nome="copiar" tamanho={15} /> {tx("Copiar")} </>
            )}
          </button>
          <button type="button" className="botao botao-fantasma botao-pequeno" onClick={exportarTxt}>
            <Icone nome="baixar" tamanho={15} /> .txt
          </button>
          <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            onClick={exportarComoDocx}
            disabled={exportandoDocx}
          >
            {exportandoDocx ? (
              'Exportando…'
            ) : (
              <>
                <Icone nome="baixar" tamanho={15} /> .docx
              </>
            )}
          </button>
          {!editando && (
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              disabled={mutando}
              onClick={() => {
                setConteudoEdicao(conteudo)
                setEditando(true)
              }}
            >
              <Icone nome="lapis" tamanho={15} /> {tx("Editar")} </button>
          )}
          <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            onClick={() => setRefazerAberto(true)}
            disabled={mutando}
          >
            {refazendo ? (
              'Refazendo…'
            ) : (
              <>
                <Icone nome="ia" tamanho={15} /> {tx("Refazer com IA")} </>
            )}
          </button>
          <button type="button" className="botao botao-fantasma botao-pequeno" disabled={mutando} onClick={() => setHistoricoAberto(true)}>
            <Icone nome="relogio" tamanho={15} /> {tx("Histórico")} </button>
          <button type="button" className="botao botao-perigo botao-pequeno" onClick={excluir} disabled={mutando}>
            {excluindo ? (
              tx("Excluindo…")
            ) : (
              <>
                <Icone nome="lixeira" tamanho={15} /> {tx("Excluir")} </>
            )}
          </button>
        </div>

        <div className="pecas-modal-corpo pecas-modal-corpo-duplo">
          {/* Coluna do conteúdo */}
          <div className="pecas-coluna-conteudo">
            {editando ? (
              <div className="pecas-edicao">
                <textarea
                  value={conteudoEdicao}
                  onChange={(e) => setConteudoEdicao(e.target.value)}
                  rows={22}
                  disabled={salvando}
                  aria-label={tx("Conteúdo da peça em edição")}
                />
                <div className="pecas-edicao-rodape">
                  <button
                    type="button"
                    className="botao botao-fantasma botao-pequeno"
                    onClick={() => setEditando(false)}
                    disabled={salvando}
                  > {tx("Cancelar")} </button>
                  <button type="button" className="botao botao-primario botao-pequeno" onClick={salvarEdicao} disabled={salvando}>
                    {salvando ? tx("Salvando…") : tx("Salvar edição")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="texto-suave pecas-dica-selecao"> {tx("💡 Selecione um trecho do texto para pedir um ajuste pontual à IA.")} </p>
                <div ref={conteudoRef} className="pecas-conteudo">
                  {conteudo || tx("Esta peça ainda não tem conteúdo.")}
                </div>
              </>
            )}

            {selecao && !novoComentario && !editando && (
              <button
                type="button"
                className="pecas-botao-flutuante"
                style={{ top: selecao.topo, left: selecao.esquerda }}
                onClick={() => {
                  setNovoComentario({ trecho: selecao.texto })
                  setNovaInstrucao('')
                }}
              >
                <Icone nome="conversa" tamanho={15} /> {tx("Pedir ajuste à IA")} </button>
            )}
          </div>

          {/* Coluna de comentários */}
          <aside className="pecas-coluna-comentarios">
            <div className="pecas-comentarios-cabecalho">
              <h4>{tx("Comentários da IA")}</h4>
              <span className="texto-suave">
                {comentarios.length} total{pendentes > 0 && tx(" · {0} pendente(s)", pendentes)}
              </span>
            </div>

            {novoComentario && (
              <div className="pecas-comentario pecas-comentario-novo">
                <p className="pecas-comentario-rotulo">{tx("Trecho selecionado")}</p>
                <blockquote className="pecas-comentario-trecho">{novoComentario.trecho}</blockquote>
                <p className="pecas-comentario-rotulo">{tx("O que mudar neste trecho?")}</p>
                <textarea
                  autoFocus
                  rows={3}
                  value={novaInstrucao}
                  onChange={(e) => setNovaInstrucao(e.target.value)}
                  placeholder={tx("Ex.: “deixe mais formal”, “adicione a Súmula 297/STJ”, “encurte este parágrafo”…")}
                  disabled={comentando}
                />
                <div className="pecas-comentario-sugestoes">
                  {['Deixe mais formal', 'Encurte para 1 parágrafo', 'Reescreva em tom mais firme'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="pecas-sugestao"
                      onClick={() => setNovaInstrucao(s)}
                      disabled={comentando}
                    >
                      {tx(s)}
                    </button>
                  ))}
                </div>
                <div className="pecas-comentario-acoes">
                  <button
                    type="button"
                    className="botao botao-fantasma botao-pequeno"
                    onClick={() => setNovoComentario(null)}
                    disabled={comentando}
                  > {tx("Cancelar")} </button>
                  <button
                    type="button"
                    className="botao botao-primario botao-pequeno"
                    onClick={criarComentario}
                    disabled={comentando || novaInstrucao.trim().length < 3}
                  >
                    {comentando ? (
                      tx("Gerando proposta…")
                    ) : (
                      <>
                        <Icone nome="ia" tamanho={15} /> {tx("Gerar proposta")} </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {comentarios.length === 0 && !novoComentario && (
              <p className="pecas-comentarios-vazio"> {tx("Nenhum comentário ainda.")} <br /> {tx("Selecione um trecho do texto para começar.")} </p>
            )}

            {comentarios.map((c) => (
              <ComentarioCard
                key={c.id}
                comentario={c}
                ocupado={mutando}
                aoAceitar={() => aceitarComentario(c)}
                aoRecusar={() => recusarComentario(c)}
                aoRegenerar={(inst) => regenerarComentario(c, inst)}
              />
            ))}
          </aside>
        </div>

        {/* Fase 4: rodapé de feedback — 👍/👎 viram conhecimento do escritório */}
        <div className="feedback-rodape-peca">
          <div className="feedback-rodape-linha">
            <span className="texto-suave">{tx("Esta peça atendeu ao padrão do escritório?")}</span>
            {fbNota ? (
              <span className="feedback-feito" title={tx("Feedback já registrado")}>
                <Icone
                  nome={fbNota === 'positivo' ? 'polegar-cima' : 'polegar-baixo'}
                  tamanho={15}
                />{' '} {tx("avaliada — obrigado!")} </span>
            ) : (
              <span className="feedback-acoes">
                <button
                  type="button"
                  className="feedback-botao"
                  title={tx("Avaliar peça como boa")}
                  aria-label={tx("Avaliar peça como boa")}
                  disabled={fbEnviando}
                  onClick={() => enviarFeedbackPeca('positivo')}
                >
                  <Icone nome="polegar-cima" tamanho={17} />
                </button>
                <button
                  type="button"
                  className="feedback-botao"
                  title={tx("Peça com problema — conte o porquê (opcional)")}
                  aria-label={tx("Avaliar peça como ruim")}
                  disabled={fbEnviando}
                  onClick={() => {
                    setFbCaixaAberta((v) => !v)
                    setFbComentario('')
                  }}
                >
                  <Icone nome="polegar-baixo" tamanho={17} />
                </button>
              </span>
            )}
          </div>
          {fbCaixaAberta && !fbNota && (
            <div className="feedback-caixa">
              <textarea
                autoFocus
                rows={2}
                value={fbComentario}
                onChange={(e) => setFbComentario(e.target.value)}
                placeholder={tx("O que estava errado ou faltou? (opcional — ajuda o escritório a aprender)")}
                disabled={fbEnviando}
              />
              <div className="feedback-caixa-acoes">
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={() => setFbCaixaAberta(false)}
                  disabled={fbEnviando}
                > {tx("Cancelar")} </button>
                <button
                  type="button"
                  className="botao botao-primario botao-pequeno"
                  onClick={() => enviarFeedbackPeca('negativo', fbComentario)}
                  disabled={fbEnviando}
                >
                  {fbEnviando ? tx("Enviando…") : tx("Enviar feedback")}
                </button>
              </div>
            </div>
          )}
          {fbConflito && (
            <div className="feedback-conflito" role="note">
              <p>
                <strong>{tx("⚠️ Isso conflita com o playbook do escritório:")}</strong> {fbConflito.descricao}
                {fbConflito.campo_playbook && (
                  <span className="feedback-conflito-campo"> {tx("(campo:")} {fbConflito.campo_playbook})</span>
                )}
              </p>
              <button type="button" className="botao-texto" onClick={() => setFbConflito(null)}> {tx("entendi")} </button>
            </div>
          )}
        </div>

        {/* Caixa de "Refazer com IA" */}
        {refazerAberto && (
          <div className="pecas-overlay pecas-overlay-interno" role="dialog" aria-modal="true" aria-label={tx("Refazer peça com IA")}>
            <div className="pecas-modal pecas-modal-pequena">
              <div className="pecas-modal-cabecalho">
                <h3 className="secao-titulo">
                  <Icone nome="ia" /> {tx("Refazer com IA")} </h3>
                <button
                  type="button"
                  className="pecas-fechar"
                  onClick={() => setRefazerAberto(false)}
                  aria-label={tx("Fechar")}
                  disabled={refazendo}
                >
                  <Icone nome="fechar" />
                </button>
              </div>
              <div className="pecas-modal-corpo">
                <p className="texto-suave"> {tx("A IA vai regerar")} <strong>{tx("toda")}</strong> {tx("a peça usando os dados do caso. A versão atual fica guardada no histórico. Pode demorar 1–2 minutos.")} </p>
                <textarea
                  rows={3}
                  value={refazerInstrucoes}
                  onChange={(e) => setRefazerInstrucoes(e.target.value)}
                  placeholder={tx("Instruções extras (opcional) — ex.: “foque em prescrição”, “tom mais firme”…")}
                  disabled={refazendo}
                />
              </div>
              <div className="pecas-modal-rodape">
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={() => setRefazerAberto(false)}
                  disabled={refazendo}
                > {tx("Cancelar")} </button>
                <button type="button" className="botao botao-primario botao-pequeno" onClick={refazer} disabled={refazendo}>
                  {refazendo ? tx("Refazendo (pode demorar)…") : tx("Refazer peça")}
                </button>
              </div>
            </div>
          </div>
        )}

        {historicoAberto && (
          <HistoricoModal
            base={base}
            peca={peca}
            aoFechar={() => setHistoricoAberto(false)}
            aoRestaurar={(atualizada) => aplicarPeca(atualizada)}
          />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Seção "Peças do caso" — lista + geração                             */
/* ------------------------------------------------------------------ */

/** Áreas do direito para o override opcional da geração (rótulos legíveis). */
const AREAS_DIREITO: { value: string; label: string }[] = [
  { value: 'civil', label: 'Cível' },
  { value: 'consumidor', label: 'Consumidor' },
  { value: 'trabalhista', label: 'Trabalhista' },
  { value: 'previdenciario', label: 'Previdenciário' },
  { value: 'familia', label: 'Família e Sucessões' },
  { value: 'penal', label: 'Penal' },
  { value: 'tributario', label: 'Tributário' },
  { value: 'administrativo', label: 'Administrativo' },
  { value: 'empresarial', label: 'Empresarial' },
  { value: 'imobiliario', label: 'Imobiliário' },
]

export function PecasCaso({ orgId, slug, casoId }: { orgId: number; slug: string; casoId: number }) {
  return <PecasConteudo key={`${getSessionIdentity()}:${orgId}:${slug}:${casoId}`} orgId={orgId} slug={slug} casoId={casoId} />
}

function PecasConteudo({ orgId, slug, casoId }: { orgId: number; slug: string; casoId: number }) {
  const { idioma, t } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const base = `/predios/${orgId}/${slug}`
  const { telaAtual, leituraRef } = useTelaPeca()
  const detalheRef = useRef<AbortController | null>(null)
  const gerandoRef = useRef(false)

  const [pecas, setPecas] = useState<PecaResumo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tipos, setTipos] = useState<PecaTipo[] | null>(null)
  const [erroTipos, setErroTipos] = useState<string | null>(null)
  const tiposRef = useRef<AbortController | null>(null)
  const tiposBuscandoRef = useRef(false)

  // Formulário de geração
  const [formAberto, setFormAberto] = useState(false)
  const [tipoSel, setTipoSel] = useState('')
  // Override opcional da área do direito só desta geração ('' = usa a do caso).
  const [areaOverride, setAreaOverride] = useState('')
  const [instrucoes, setInstrucoes] = useState('')
  const [premium, setPremium] = useState(false)
  const [gerando, setGerando] = useState(false)

  // Biblioteca "Doutrina & Modelos" (Fase 3): referências OPCIONAIS da geração.
  const [biblioModelos, setBiblioModelos] = useState<BibliotecaItem[] | null>(null)
  const [biblioDoutrinas, setBiblioDoutrinas] = useState<BibliotecaItem[] | null>(null)
  const [erroBiblio, setErroBiblio] = useState<string | null>(null)
  const bibliotecaRef = useRef<AbortController | null>(null)
  const bibliotecaBuscandoRef = useRef(false)
  const [modeloSel, setModeloSel] = useState('')
  const [doutrinasSel, setDoutrinasSel] = useState<number[]>([])

  // Fase 7: estimativa de tokens/custo ANTES de gerar (preview-tokens).
  // Best-effort: se a rota falhar, o preview some e o Gerar segue liberado.
  const [preview, setPreview] = useState<PreviewTokensPeca | null>(null)
  const [previewCarregando, setPreviewCarregando] = useState(false)
  const previewSeqRef = useRef(0)

  // Recalcula a estimativa (debounce 500ms) ao mudar tipo/instruções/modelo/
  // doutrinas com o formulário aberto. previewSeqRef descarta respostas
  // atrasadas (só a última requisição vale).
  useEffect(() => {
    const seq = ++previewSeqRef.current
    if (!formAberto || !tipoSel) {
      setPreview(null)
      setPreviewCarregando(false)
      return
    }
    setPreviewCarregando(true)
    const t = window.setTimeout(() => {
      api
        .post<PreviewTokensPeca>(`${base}/casos/${casoId}/pecas/preview-tokens`, {
          tipo: tipoSel,
          instrucoes: instrucoes || undefined,
          modelo_id: modeloSel ? Number(modeloSel) : undefined,
          doutrina_ids: doutrinasSel.length > 0 ? doutrinasSel : undefined,
        })
        .then((r) => {
          if (telaAtual() && previewSeqRef.current === seq) setPreview(r ?? null)
        })
        .catch(() => {
          if (telaAtual() && previewSeqRef.current === seq) setPreview(null)
        })
        .finally(() => {
          if (telaAtual() && previewSeqRef.current === seq) setPreviewCarregando(false)
        })
    }, 500)
    return () => { window.clearTimeout(t); previewSeqRef.current++ }
  }, [formAberto, tipoSel, instrucoes, modeloSel, doutrinasSel, base, casoId, telaAtual])

  // Peça aberta no modal
  const [pecaAberta, setPecaAberta] = useState<Peca | null>(null)
  const [carregandoPeca, setCarregandoPeca] = useState<number | null>(null)

  // Fase 4: área do direito do caso — vai junto no feedback 👍/👎 da peça.
  // Busca best-effort (sem área o feedback continua valendo).
  const [areaCaso, setAreaCaso] = useState<string | null>(null)
  useEffect(() => {
    let ativo = true
    setAreaCaso(null)
    api
      .get<unknown>(`${base}/casos/${casoId}`)
      .then((data) => {
        if (!ativo || !data || typeof data !== 'object') return
        const obj = data as Record<string, unknown>
        const caso = (obj.caso ?? obj) as Record<string, unknown>
        if (typeof caso?.area_direito === 'string' && caso.area_direito) setAreaCaso(caso.area_direito)
      })
      .catch(() => undefined)
    return () => {
      ativo = false
    }
  }, [base, casoId])

  const carregar = useCallback(async () => {
    if (!telaAtual()) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    try {
      const res = await api.get<{ pecas: PecaResumo[] }>(`${base}/casos/${casoId}/pecas`, controller.signal)
      if (!telaAtual() || controller.signal.aborted) return
      setPecas(res?.pecas ?? [])
      setErro(null)
    } catch (e) {
      if (telaAtual() && !controller.signal.aborted) setErro(mensagemErro(e, tx("Não foi possível carregar as peças do caso.")))
    }
  }, [base, casoId, telaAtual, leituraRef, tx])

  useEffect(() => {
    carregar()
  }, [carregar])

  // Catálogo de tipos — carrega quando o formulário abre pela 1ª vez.
  const carregarTipos = useCallback(async () => {
    if (!telaAtual() || tiposBuscandoRef.current) return
    tiposBuscandoRef.current = true
    tiposRef.current?.abort()
    const controller = new AbortController()
    tiposRef.current = controller
    setErroTipos(null)
    try {
      const res = await api.get<{ tipos: PecaTipo[] }>(`${base}/pecas-tipos`, controller.signal)
      if (!telaAtual() || controller.signal.aborted) return
      const lista = res?.tipos ?? []
      setTipos(lista)
      if (lista.length > 0) setTipoSel(atual => atual || lista[0].id)
    } catch (e) {
      if (telaAtual() && !controller.signal.aborted) setErroTipos(mensagemErro(e, tx("Não foi possível carregar os tipos de peça.")))
    } finally { tiposBuscandoRef.current = false }
  }, [base, telaAtual, tx])
  useEffect(() => { if (formAberto && tipos === null && !erroTipos) void carregarTipos() }, [formAberto, tipos, erroTipos, carregarTipos])
  useEffect(() => () => { tiposRef.current?.abort(); detalheRef.current?.abort() }, [])

  // Referências opcionais: uma falha conserva os itens recebidos e permite
  // repetir a leitura, sem afirmar que a biblioteca está vazia.
  const carregarBiblioteca = useCallback(async () => {
    if (!telaAtual() || bibliotecaBuscandoRef.current) return
    bibliotecaBuscandoRef.current = true
    bibliotecaRef.current?.abort()
    const controller = new AbortController()
    bibliotecaRef.current = controller
    setErroBiblio(null)
    try {
      const [modelos, doutrinas] = await Promise.allSettled([
        api.get<unknown>(`${base}/biblioteca?tipo=modelo`, controller.signal),
        api.get<unknown>(`${base}/biblioteca?tipo=doutrina`, controller.signal),
      ])
      if (!telaAtual() || controller.signal.aborted) return
      if (modelos.status === 'fulfilled') setBiblioModelos(asList<BibliotecaItem>(modelos.value, 'itens'))
      if (doutrinas.status === 'fulfilled') setBiblioDoutrinas(asList<BibliotecaItem>(doutrinas.value, 'itens'))
      if (modelos.status === 'rejected' || doutrinas.status === 'rejected') setErroBiblio(t('Não foi possível carregar parte das referências. Você pode tentar novamente ou continuar sem elas.', 'Some references could not be loaded. Try again or continue without them.'))
    } finally { bibliotecaBuscandoRef.current = false }
  }, [base, telaAtual, t])
  useEffect(() => { if (formAberto && biblioModelos === null && !erroBiblio) void carregarBiblioteca() }, [formAberto, biblioModelos, erroBiblio, carregarBiblioteca])
  useEffect(() => () => bibliotecaRef.current?.abort(), [])

  // Tipos agrupados por categoria (optgroup do select). Preserva a ordem em
  // que o backend enviou dentro de cada categoria.
  const tiposPorCategoria = useMemo(() => {
    const grupos = new Map<string, PecaTipo[]>()
    for (const t of tipos ?? []) {
      const cat = t.categoria || 'Outras'
      const lista = grupos.get(cat) ?? []
      lista.push(t)
      grupos.set(cat, lista)
    }
    return Array.from(grupos.entries())
  }, [tipos])

  // Modelos compatíveis com o tipo de peça escolhido aparecem primeiro.
  const modelosCompativeis = useMemo(
    () => (biblioModelos ?? []).filter((m) => !!tipoSel && m.tipo_peca === tipoSel),
    [biblioModelos, tipoSel],
  )
  const modelosOutros = useMemo(
    () => (biblioModelos ?? []).filter((m) => !tipoSel || m.tipo_peca !== tipoSel),
    [biblioModelos, tipoSel],
  )

  function alternarDoutrina(id: number) {
    setDoutrinasSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function gerar() {
    if (!telaAtual() || gerandoRef.current) return
    if (!tipoSel) {
      falha(tx("Escolha o tipo de peça a gerar."))
      return
    }
    gerandoRef.current = true
    setGerando(true)
    try {
      const res = await api.post<unknown>(`${base}/casos/${casoId}/pecas`, {
        tipo: tipoSel,
        ...(window.offizMotor?.chatDeviceId ? { motor_local: window.offizMotor.chatDeviceId } : {}),
        instrucoes: instrucoes.trim() || undefined,
        premium,
        // Override de área só desta geração (vazio = área do caso).
        ...(areaOverride ? { area_direito: areaOverride } : {}),
        // Referências opcionais da biblioteca (Fase 3) — o backend carrega o
        // conteúdo validando o escopo org×office.
        ...(modeloSel ? { modelo_id: Number(modeloSel) } : {}),
        ...(doutrinasSel.length > 0 ? { doutrina_ids: doutrinasSel } : {}),
      })
      if (!telaAtual()) return
      const peca = unwrapPeca(res)
      sucesso(tx("Peça “{0}” gerada.", peca?.titulo ?? tipoSel))
      setFormAberto(false)
      setInstrucoes('')
      setPremium(false)
      setAreaOverride('')
      setModeloSel('')
      setDoutrinasSel([])
      await carregar()
      if (peca) setPecaAberta(peca)
    } catch (e) {
      if (telaAtual()) falha(mensagemErro(e, tx("Não foi possível gerar a peça.")))
    } finally {
      gerandoRef.current = false
      if (telaAtual()) setGerando(false)
    }
  }

  async function abrir(p: PecaResumo) {
    if (!telaAtual()) return
    detalheRef.current?.abort()
    const controller = new AbortController()
    detalheRef.current = controller
    setCarregandoPeca(p.id)
    try {
      const res = await api.get<unknown>(`${base}/pecas/${p.id}`, controller.signal)
      if (!telaAtual() || controller.signal.aborted) return
      const detalhe = unwrapPeca(res)
      if (detalhe) setPecaAberta(detalhe)
      else falha(tx("Resposta inesperada ao abrir a peça."))
    } catch (e) {
      if (telaAtual() && !controller.signal.aborted) falha(mensagemErro(e, tx("Não foi possível abrir a peça.")))
    } finally {
      if (telaAtual() && !controller.signal.aborted) setCarregandoPeca(null)
    }
  }

  const nomeTipo = useCallback(
    (id: string) => tipos?.find((t) => t.id === id)?.nome ?? id.replace(/_/g, ' '),
    [tipos],
  )

  return (
    <section className="cartao pecas-secao">
      <div className="secao-cabecalho">
        <h3 className="secao-titulo"> {tx("Peças do caso")} {pecas !== null && pecas.length > 0 && <span className="contador">{pecas.length}</span>}
        </h3>
        {!formAberto && (
          <button type="button" className="botao botao-primario botao-pequeno" onClick={() => setFormAberto(true)}>
            <Icone nome="ia" tamanho={15} /> {tx("Gerar peça")} </button>
        )}
      </div>

      {formAberto && (
        <div className="pecas-form">
          {erroTipos && <p className="alerta alerta-erro" role="alert">{tx(erroTipos)}{' '}<button type="button" className="botao-texto" onClick={() => void carregarTipos()}>{t('Tentar novamente', 'Try again')}</button></p>}
          {erroBiblio && <p className="alerta alerta-erro" role="alert">{erroBiblio}{' '}<button type="button" className="botao-texto" onClick={() => void carregarBiblioteca()}>{t('Tentar novamente', 'Try again')}</button></p>}
          <div className="linha-campos">
            <label className="campo">
              <span>{tx("Tipo de peça")}</span>
              <select value={tipoSel} onChange={(e) => setTipoSel(e.target.value)} disabled={gerando || tipos === null}>
                {tipos === null && <option value="">{erroTipos ? tx('Não foi possível carregar os tipos de peça.') : tx("Carregando tipos…")}</option>}
                {tipos !== null && tipos.length === 0 && <option value="">{tx("Nenhum tipo disponível")}</option>}
                {tiposPorCategoria.map(([categoria, lista]) => (
                  <optgroup key={categoria} label={categoria}>
                    {lista.map((t) => (
                      <option key={t.id} value={t.id} title={t.descricao}>
                        {t.nome}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>{tx("Área do direito")}</span>
              <select value={areaOverride} onChange={(e) => setAreaOverride(e.target.value)} disabled={gerando}>
                <option value="">
                  {areaCaso
                    ? tx("Do caso — {0}", AREAS_DIREITO.find((a) => a.value === areaCaso)?.label ?? areaCaso)
                    : tx("Do caso")}
                </option>
                {AREAS_DIREITO.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            {preview?.modo_execucao === 'cli' ? <p className="texto-suave" role="note">
              {t('Motor local: usa a conta e o modelo selecionados no aplicativo. Não exige chave de API. A peça precisa de revisão jurídica.', 'Local engine: uses the account and model selected in the app. No API key is required. The document needs legal review.')}
            </p> : <div className="campo pecas-toggle-premium">
              <span>{tx("Modo premium")}</span>
              <label className="pecas-check">
                <input
                  type="checkbox"
                  checked={premium}
                  onChange={(e) => setPremium(e.target.checked)}
                  disabled={gerando}
                />
                <span>{tx("Usar o modelo mais forte (mais lento e mais caro)")}</span>
              </label>
            </div>}
          </div>
          {(biblioModelos ?? []).length > 0 && (
            <label className="campo">
              <span>{tx("Modelo de referência (opcional)")}</span>
              <select value={modeloSel} onChange={(e) => setModeloSel(e.target.value)} disabled={gerando}>
                <option value="">{tx("Sem modelo — padrão do escritório")}</option>
                {modelosCompativeis.length > 0 && (
                  <optgroup label="Compatíveis com o tipo escolhido">
                    {modelosCompativeis.map((m) => (
                      <option key={m.id} value={m.id} title={m.descricao ?? undefined}>
                        {m.titulo}
                      </option>
                    ))}
                  </optgroup>
                )}
                {modelosOutros.length > 0 && (
                  <optgroup label={modelosCompativeis.length > 0 ? tx("Outros modelos") : tx("Modelos da biblioteca")}>
                    {modelosOutros.map((m) => (
                      <option key={m.id} value={m.id} title={m.descricao ?? undefined}>
                        {m.titulo}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          )}
          {(biblioDoutrinas ?? []).length > 0 && (
            <div className="campo">
              <span>{tx("Doutrinas (opcional")}{doutrinasSel.length > 0 ? tx(" · {0} selecionada(s)", doutrinasSel.length) : ''})</span>
              <div style={{ maxHeight: 150, overflowY: 'auto', display: 'grid', gap: '0.25rem' }}>
                {(biblioDoutrinas ?? []).map((d) => (
                  <label key={d.id} className="pecas-check">
                    <input
                      type="checkbox"
                      checked={doutrinasSel.includes(d.id)}
                      onChange={() => alternarDoutrina(d.id)}
                      disabled={gerando}
                    />
                    <span title={d.descricao ?? undefined}>{d.titulo}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <label className="campo">
            <span>{tx("Instruções (opcional)")}</span>
            <textarea
              rows={3}
              value={instrucoes}
              onChange={(e) => setInstrucoes(e.target.value)}
              placeholder={tx("Ex.: “foque em prescrição”, “cite a Súmula 297/STJ”, “tom mais firme”…")}
              disabled={gerando}
            />
          </label>
          {gerando && (
            <p className="alerta alerta-aviso pecas-aviso-gerando" role="status">
              <span className="pecas-spinner" aria-hidden="true" /> {tx("Gerando a peça com IA — isso pode levar 1–2 minutos. Mantenha esta tela aberta.")} </p>
          )}
          <div className="pecas-form-rodape">
            {/* Fase 7: estimativa antes de gerar — best-effort, nunca bloqueia. */}
            {previewCarregando && (
              <span className="pecas-preview-tokens texto-suave">{tx("estimando…")}</span>
            )}
            {!previewCarregando && preview && (
              <span
                className="pecas-preview-tokens"
                title={preview.modo_execucao === 'cli'
                  ? t('Estimativa de tamanho. O consumo real usa os limites da sua assinatura.', 'Size estimate. Actual usage counts against your subscription limits.')
                  : tx("Estimativa local ({0}) — o custo real depende da resposta da IA", preview.tier)}
              >
                ≈ {formatTokens(preview.tokens_estimados, idioma)} tokens ·{' '}
                {preview.modo_execucao === 'cli'
                  ? t('assinatura · sem cobrança de API', 'subscription · no API charge')
                  : preview.custo_estimado_brl === null
                    ? t('custo não informado', 'cost unavailable')
                    : `~${formatBRL(preview.custo_estimado_brl, idioma)}`}
              </span>
            )}
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              onClick={() => setFormAberto(false)}
              disabled={gerando}
            > {tx("Cancelar")} </button>
            <button
              type="button"
              className="botao botao-primario"
              onClick={gerar}
              disabled={gerando || !tipoSel}
            >
              {gerando ? (
                'Gerando…'
              ) : (
                <>
                  <Icone nome="ia" tamanho={15} /> {tx("Gerar peça")} </>
              )}
            </button>
          </div>
        </div>
      )}

      {erro && <p className="alerta alerta-erro" role="alert">{tx(erro)}{' '}<button type="button" className="botao-texto" onClick={() => void carregar()}>{t('Tentar novamente', 'Try again')}</button></p>}

      {pecas === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-card" style={{ minHeight: 64 }} />
        </div>
      )}

      {pecas !== null && pecas.length === 0 && !formAberto && (
        <p className="texto-suave"> {tx("Nenhuma peça gerada ainda. Clique em")} <strong>{tx("Gerar peça")}</strong> {tx("— a IA usa os dados e documentos do caso.")} </p>
      )}

      {pecas !== null && pecas.length > 0 && (
        <ul className="pecas-lista">
          {pecas.map((p) => (
            <li key={p.id} className="pecas-item">
              <button
                type="button"
                className="pecas-item-principal"
                onClick={() => abrir(p)}
                disabled={carregandoPeca !== null}
              >
                <span className="pecas-item-topo">
                  <strong className="pecas-item-titulo">{p.titulo || nomeTipo(p.tipo)}</strong>
                  <span className="pecas-versao-badge">v{p.versao}</span>
                  {p.tem_comentarios_pendentes && (
                    <span className="status-pill status-running" title={tx("Há propostas de ajuste aguardando decisão")}>
                      <Icone nome="conversa" tamanho={15} /> {tx("pendências")} </span>
                  )}
                  <span className={`status-pill ${classeStatusPeca(p.status)}`}>
                    {tx(STATUS_PECA_LABEL[p.status] ?? p.status)}
                  </span>
                </span>
                <span className="pecas-item-meta">
                  {nomeTipo(p.tipo)}
                  {p.criado_em && <> {tx("· criada em")} {formatDataHora(p.criado_em, idioma)}</>}
                  {p.atualizado_em && p.atualizado_em !== p.criado_em && (
                    <> {tx("· atualizada em")} {formatDataHora(p.atualizado_em, idioma)}</>
                  )}
                  {carregandoPeca === p.id && <> {tx("· abrindo…")}</>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pecaAberta && (
        <PecaModal
          key={pecaAberta.id}
          base={base}
          pecaInicial={pecaAberta}
          areaDireito={areaCaso}
          aoFechar={() => setPecaAberta(null)}
          aoMudar={() => carregar()}
          aoExcluir={() => carregar()}
        />
      )}
    </section>
  )
}
