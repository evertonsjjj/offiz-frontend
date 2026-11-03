import { useIdioma, type Traduzir } from '../../lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatBRL, formatDuracao, msDesde } from '../../lib/format'
import { Icone } from '../Icone'
import { resumoTool, semPrefixoWorkspace } from '../../predio/log-agente'
import type { Job, JobEvent } from '../../lib/types'
import { orientacaoFalha } from '../../lib/falhasTrabalho'

interface ToolItem {
  ferramenta: string
  resumo: string
}

type ItemStream =
  | { kind: 'info'; texto: string }
  | { kind: 'texto'; texto: string }
  | { kind: 'tools'; tools: ToolItem[] }
  | { kind: 'subagente'; nome: string; ativo: boolean }
  | { kind: 'resultado'; tokens_entrada: number; tokens_saida: number; custo_brl: number; duracao_ms: number }
  | { kind: 'entrega'; nome: string; caminho_rel: string }
  | { kind: 'erro'; mensagem: string }

function str(v: unknown, padrao = ''): string {
  return typeof v === 'string' ? v : padrao
}

/** O texto do agente vem CRU: com os marcadores `PROGRESSO: N% — …` (protocolo
 *  da barra, não fala de gente) e markdown que este painel não renderiza
 *  (`## `, `**`). Para quem não conhece os símbolos, parece texto com defeito.
 *  Limpa na EXIBIÇÃO — nunca na acumulação, porque um marcador pode chegar
 *  fatiado em dois deltas de streaming e só existe inteiro no texto colado. */
const RE_LINHA_PROGRESSO = /PROGRESSO:\s*\d{1,3}\s*%/i

function textoParaDono(texto: string): string {
  return texto
    .split('\n')
    .filter((linha) => !RE_LINHA_PROGRESSO.test(linha))
    .join('\n')
    .replace(/\*\*/g, '')
    .replace(/^#{1,4}\s+/gm, '')
}

function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

function agruparEventos(eventos: JobEvent[], tr: Traduzir): ItemStream[] {
  const itens: ItemStream[] = []
  for (const ev of eventos) {
    const p = ev.payload || {}
    switch (ev.tipo) {
      case 'iniciado':
        // O claim pode chegar antes do download/extração do workspace local.
        itens.push({ kind: 'info', texto: tr('O escritório recebeu o trabalho.', 'The office received the task.') })
        break
      case 'modelo_selecionado':
        itens.push({ kind: 'info', texto: `${p.motor === 'codex' ? 'OpenAI Codex' : 'Claude Code'} · ${str(p.modelo)}` })
        break
      case 'agent_text': {
        const texto = str(p.texto)
        if (!texto) break
        const ultimo = itens[itens.length - 1]
        if (ultimo && ultimo.kind === 'texto') {
          ultimo.texto += texto
        } else {
          itens.push({ kind: 'texto', texto })
        }
        break
      }
      case 'tool_use': {
        const tool: ToolItem = { ferramenta: str(p.ferramenta, tr('ferramenta', 'tool')), resumo: str(p.resumo) }
        const ultimo = itens[itens.length - 1]
        if (ultimo && ultimo.kind === 'tools') {
          ultimo.tools.push(tool)
        } else {
          itens.push({ kind: 'tools', tools: [tool] })
        }
        break
      }
      case 'subagente': {
        const nome = str(p.nome, tr('subagente', 'specialist'))
        const acao = str(p.acao)
        if (acao === 'stop') {
          for (let i = itens.length - 1; i >= 0; i--) {
            const it = itens[i]
            if (it.kind === 'subagente' && it.nome === nome && it.ativo) {
              it.ativo = false
              break
            }
          }
        } else {
          itens.push({ kind: 'subagente', nome, ativo: true })
        }
        break
      }
      case 'resultado':
        itens.push({
          kind: 'resultado',
          tokens_entrada: num(p.tokens_entrada),
          tokens_saida: num(p.tokens_saida),
          custo_brl: num(p.custo_brl),
          duracao_ms: num(p.duracao_ms),
        })
        break
      case 'entrega_registrada':
        itens.push({ kind: 'entrega', nome: str(p.nome, tr('arquivo', 'file')), caminho_rel: str(p.caminho_rel) })
        break
      case 'erro':
        itens.push({ kind: 'erro', mensagem: str(p.mensagem, tr('Erro desconhecido.', 'Unknown error.')) })
        break
      default:
        break
    }
  }
  return itens
}

/** Cronômetro ao vivo enquanto o job está em execução. */
function useTempoDecorrido(job: Job, ativo: boolean): string | null {
  const { idioma } = useIdioma()
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!ativo) return
    const t = window.setInterval(() => {
      // Sem redesenho por segundo em aba escondida (Page Visibility, 27/08).
      if (!document.hidden) setTick((v) => v + 1)
    }, 1000)
    return () => window.clearInterval(t)
  }, [ativo, job.id])
  if (!ativo) return null
  const ms = msDesde(job.iniciado_em || job.criado_em)
  return ms === null ? null : formatDuracao(ms, idioma)
}

function BotaoCopiar({ texto }: { texto: string }) {
  const { t: tr } = useIdioma()
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* clipboard indisponível (http/permsize) */
    }
  }
  return (
    <button
      type="button"
      className={copiado ? 'botao-copiar copiado' : 'botao-copiar'}
      onClick={copiar}
      aria-label={tr("Copiar texto do agente", "Copy agent text")}
    >
      {copiado ? (
        <>
          <Icone nome="visto" tamanho={15} /> {tr("Copiado", "Copied")}</>
      ) : (
        tr("Copiar", "Copy")
      )}
    </button>
  )
}

/** Linha de ferramenta: a MESMA língua de gente em toda parte ("lendo x.md"),
 *  com o técnico cru ("Read caminho/x.md") no tooltip — um clique de
 *  curiosidade não pode revelar jargão em inglês. O sinal à esquerda é ícone
 *  de traço, então ele fica da cor da linha em vez de um emoji colorido no
 *  meio de um log em fonte mono. */
function LinhaFerramenta({ tool }: { tool: ToolItem }) {
  const { idioma } = useIdioma()
  const detalhe = semPrefixoWorkspace(tool.resumo)
  const linha = resumoTool(tool.ferramenta, tool.resumo, idioma)
  return (
    <p className="stream-tool" title={`${tool.ferramenta} ${detalhe}`.trim()}>
      {linha.icone && <Icone nome={linha.icone} tamanho={14} className="stream-tool-icone" />}
      {linha.texto}
    </p>
  )
}

/** Grupo de ferramentas consecutivas: colapsável quando fica comprido.
 *  A cara do grupo (linhas soltas e cabeçalho fechado) fala a língua do cliente
 *  ("🧮 calculando com financas.py"); o detalhe técnico fica no grupo expandido. */
function GrupoFerramentas({ tools, abertoInicial }: { tools: ToolItem[]; abertoInicial: boolean }) {
  const { t: tr, idioma } = useIdioma()
  const [aberto, setAberto] = useState(abertoInicial)
  if (tools.length <= 3) {
    return (
      <div className="stream-tools-plano">
        {tools.map((t, i) => (
          <LinhaFerramenta key={i} tool={t} />
        ))}
      </div>
    )
  }
  const ultima = tools[tools.length - 1]
  return (
    <details
      className="stream-tools"
      open={aberto}
      onToggle={(e) => setAberto((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <Icone nome="config" tamanho={14} className="stream-tool-icone" /> {tools.length} {tr("ações", "actions")}{!aberto && (
          <span className="stream-tool-resumo">
            {' '}{tr("· última: ", "· latest: ")}{resumoTool(ultima.ferramenta, ultima.resumo, idioma).texto}
          </span>
        )}
      </summary>
      <div className="stream-tools-lista">
        {tools.map((t, i) => (
          <LinhaFerramenta key={i} tool={t} />
        ))}
      </div>
    </details>
  )
}

export function JobStream({
  job,
  eventos,
  aoVerEntregas,
}: {
  job: Job
  eventos: JobEvent[]
  aoVerEntregas: () => void
}) {
  const { t: tr, idioma } = useIdioma()
  const itens = useMemo(() => agruparEventos(eventos, tr), [eventos, tr])
  const areaRef = useRef<HTMLDivElement | null>(null)
  const presoAoFimRef = useRef(true)
  const [presoAoFim, setPresoAoFim] = useState(true)

  const executando = job.status === 'queued' || job.status === 'running' || job.finalizando === true
  const concluido = job.status === 'done' && !job.finalizando
  const decorrido = useTempoDecorrido(job, job.status === 'running')

  useEffect(() => {
    const el = areaRef.current
    if (el && presoAoFimRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [itens, job.status])

  function onScroll() {
    const el = areaRef.current
    if (!el) return
    const preso = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    presoAoFimRef.current = preso
    setPresoAoFim(preso)
  }

  function irParaFim() {
    const el = areaRef.current
    if (!el) return
    presoAoFimRef.current = true
    setPresoAoFim(true)
    const semMovimento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: el.scrollHeight, behavior: semMovimento ? 'auto' : 'smooth' })
  }

  const idxUltimoTexto = (() => {
    for (let i = itens.length - 1; i >= 0; i--) {
      if (itens[i].kind === 'texto') return i
    }
    return -1
  })()
  const temEntrega = itens.some((i) => i.kind === 'entrega')
  const temAtividadeDoAgente = useMemo(() => {
    // Uma nova tentativa conserva o diário anterior, mas suas ferramentas
    // antigas não comprovam que o agente desta tentativa já começou.
    for (let i = eventos.length - 1; i >= 0; i--) {
      const evento = eventos[i]
      if (evento.tipo === 'iniciado') return false
      if (evento.tipo === 'tool_use' || evento.tipo === 'subagente' || evento.tipo === 'resultado'
        || evento.tipo === 'entrega_registrada'
        || (evento.tipo === 'agent_text' && textoParaDono(str(evento.payload?.texto)).trim().length > 0)) return true
    }
    return false
  }, [eventos])

  return (
    <div className="stream-wrapper">
      <div className="stream" ref={areaRef} onScroll={onScroll}>
        {itens.length === 0 && executando && (
          <p className="stream-info">
            {job.status === 'queued' ? tr("Na fila — aguardando o motor de IA…", "Queued, waiting for the AI engine…") : tr("Preparando o escritório…", "Preparing the office…")}
          </p>
        )}
        {itens.map((item, i) => {
          switch (item.kind) {
            case 'info':
              return (
                <p key={i} className="stream-info">
                  {item.texto}
                </p>
              )
            case 'texto': {
              const limpo = textoParaDono(item.texto)
              if (!limpo.trim()) return null
              return (
                <div key={i} className="stream-texto">
                  {limpo}
                  {i === idxUltimoTexto && !executando && <BotaoCopiar texto={limpo} />}
                </div>
              )
            }
            case 'tools':
              return (
                <GrupoFerramentas
                  key={`tools-${i}-${item.tools.length > 3 ? 'g' : 'p'}`}
                  tools={item.tools}
                  abertoInicial={false}
                />
              )
            case 'subagente':
              return (
                <span key={i} className={item.ativo && executando ? 'chip-subagente ativo' : 'chip-subagente'}>
                  <span className="chip-ponto" aria-hidden="true" />
                  {/* O nome vem do manifesto (guardiao-de-marca); os hífens
                      são detalhe de arquivo, não de gente. */}
                  {item.nome.replace(/-/g, ' ')}
                  {item.ativo && executando ? tr(" — trabalhando…", " — working…") : ''}
                </span>
              )
            case 'resultado':
              // Sem "tokens" aqui: quem lê este painel é o dono do escritório.
              // Tempo e custo em reais dizem tudo que ele precisa saber.
              return (
                <div
                  key={i}
                  className={`stream-resultado${temEntrega ? '' : ' stream-resultado-vazio'}`}
                >
                  {/* TERMINOU SEM ARQUIVO NENHUM não é sucesso.
                      A tela dizia "Tarefa concluída" e o dono ia para Entregas
                      procurar o que não existia — a chave foi gasta e o produto
                      afirmou que deu certo. O componente JÁ sabia disso
                      (`temEntrega`); só não falava. Isto não substitui a regra
                      no escritório (que manda salvar): é a rede embaixo dela,
                      porque instrução em prompt não é garantia mecânica. */}
                  {/* O resultado do CLI pode chegar antes dos uploads e do
                      finish. Arquivo parcial tampouco transforma falha em
                      conclusão: o estado confirmado do job tem precedência. */}
                  <strong>{job.finalizando
                    ? tr('Organizando arquivos', 'Organizing files')
                    : executando
                    ? tr('Conferindo conclusão do trabalho', 'Checking task completion')
                    : job.status !== 'done'
                      ? temEntrega ? tr('Arquivos parciais recebidos', 'Partial files received') : tr('Execução interrompida', 'Execution interrupted')
                      : temEntrega ? tr('Tarefa concluída', 'Task completed') : tr('Terminou sem gerar arquivo', 'Finished without creating a file')}</strong>
                  {item.duracao_ms > 0 && <span>{formatDuracao(item.duracao_ms, idioma)}</span>}
                  {item.custo_brl > 0 && <span>{formatBRL(item.custo_brl, idioma)}</span>}
                  {temEntrega ? (
                    <button type="button" className={`botao ${concluido ? 'botao-ok' : 'botao-fantasma'} botao-pequeno`} onClick={aoVerEntregas}>
                      {concluido ? tr('Ver entregas →', 'View deliverables →') : tr('Ver arquivos recebidos →', 'View received files →')}</button>
                  ) : concluido ? (
                    <span className="texto-suave">
                      {tr("Este trabalho não salvou um arquivo. Conte na conversa qual entrega você esperava receber.", "This task did not save a file. Tell us in the conversation what deliverable you expected.")}</span>
                  ) : null}
                </div>
              )
            case 'entrega':
              return (
                <div key={i} className="stream-entrega">
                  <Icone nome="entregas" tamanho={15} />
                  {/* Só o nome: o caminho de pastas é jargão (e quebra feio
                      em tela estreita) — fica no tooltip para quem quiser. */}
                  <span title={item.caminho_rel || undefined}>
                    {concluido ? tr('Nova entrega: ', 'New deliverable: ') : executando ? tr('Arquivo recebido: ', 'File received: ') : tr('Arquivo parcial recebido: ', 'Partial file received: ')}<strong>{item.nome}</strong>
                  </span>
                  <button type="button" className="botao-texto" onClick={aoVerEntregas}>
                    {concluido ? tr('Ver entregas →', 'View deliverables →') : tr('Ver arquivo recebido →', 'View received file →')}</button>
                </div>
              )
            case 'erro':
              // A falha terminal já tem orientação e detalhes abaixo. Os
              // retries do CLI não precisam repetir o mesmo aviso na tela.
              if (job.status === 'failed') return null
              return (
                <details key={i} className="alerta alerta-erro stream-erro">
                  <summary>{tr('Interrupção na execução', 'Execution interrupted')}</summary>
                  <pre>{item.mensagem}</pre>
                </details>
              )
          }
        })}
        {executando && (
          <p className="stream-digitando" aria-live="polite">
            <span className="cursor-piscando" aria-hidden="true" />
            {job.finalizando
              ? tr('organizando arquivos da entrega', 'organizing deliverable files')
              : job.status === 'queued'
              ? tr('aguardando na fila', 'waiting in queue')
              : temAtividadeDoAgente
                ? tr('o agente está trabalhando', 'the agent is working')
                : tr('aguardando as primeiras atualizações', 'waiting for the first updates')}
            {decorrido && <span className="stream-cronometro">· {decorrido}</span>}
          </p>
        )}
        {/* A placa ao lado acolhe a falha e esconde o técnico atrás de um
            clique — o diário não pode contar a MESMA história jogando o
            stack em inglês na cara de quem estava acompanhando. */}
        {job.status === 'failed' && (
          <div className="alerta alerta-erro stream-erro">
            <p>{orientacaoFalha(job.erro, tr)}</p>
            {job.erro && (
              <details>
                <summary>{tr("ver detalhes técnicos", "view technical details")}</summary>
                <pre>{job.erro}</pre>
              </details>
            )}
          </div>
        )}
        {job.status === 'cancelled' && <p className="stream-info">{tr("Tarefa cancelada.", "Task cancelled.")}</p>}
      </div>
      {!presoAoFim && (
        <button type="button" className="stream-ir-fim" onClick={irParaFim}>
          {tr("↓ Ir para o fim", "↓ Go to bottom")}</button>
      )}
    </div>
  )
}
