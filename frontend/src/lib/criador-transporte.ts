/**
 * Transporte do CRIADOR — o contrato entre a página /criador e quem executa
 * a sessão de edição.
 *
 * Dois transportes, um contrato:
 *
 * - **Desktop** (`window.offizMotor.criador`): o de verdade. O app spawna o
 *   Claude Code CLI local multi-turno sobre a cópia do escritório — é o
 *   "quase um Claude Code" que o dono pediu. Só existe no app baixável.
 * - **Simulação** (web): NÃO tem Claude nenhum — um interpretador de comandos
 *   determinístico que edita o manifesto e publica pelo PUT /manifesto que já
 *   existe. Serve para (1) validar/demonstrar a interface sem o app e
 *   (2) edições rápidas de manifesto pela web. A página DIZ qual transporte
 *   está ativo; a simulação nunca finge ser a IA.
 */

import { api } from './api'
import type { AbaManifesto, AreaOffice, PromptPronto } from './types'
import type { Idioma, Traduzir } from './i18n'

/** A função acompanha a preferência sem recriar a sessão nem o manifesto. */
type IdiomaCriador = Idioma | (() => Idioma)
function tradutorCriador(idioma: IdiomaCriador): Traduzir {
  return (pt, en) => (typeof idioma === 'function' ? idioma() : idioma) === 'en' ? en : pt
}

/** O office.json da pasta de trabalho, como a sessão o vê (shape tolerante —
 *  o manifesto tem chaves que a página não conhece e PRESERVA). */
export interface ManifestoCriador {
  slug: string
  nome?: string
  descricao?: string
  tema?: Record<string, string>
  vendavel?: boolean
  area?: AreaOffice | null
  arquivado?: boolean
  prompts_prontos?: PromptPronto[]
  abas?: Array<AbaManifesto | string>
  [k: string]: unknown
}

export interface ArquivoAlterado {
  caminho: string
  acao: 'novo' | 'alterado' | 'removido'
}

export type EventoCriador =
  | { tipo: 'agent_text'; payload: { texto: string } }
  | { tipo: 'tool_use'; payload: { ferramenta: string; resumo: string } }
  | { tipo: 'subagente'; payload: { nome: string; acao: 'start' | 'stop' } }
  | { tipo: 'resultado'; payload: { custo_brl?: number; duracao_ms?: number } }
  | { tipo: 'erro'; payload: { mensagem: string } }
  | { tipo: 'status'; payload: { ocupado: boolean } }
  | {
      tipo: 'manifesto'
      payload: { manifesto: ManifestoCriador | null; alterados: ArquivoAlterado[] }
    }

export interface EstadoCriador {
  aberta: boolean
  slug: string | null
  ocupado: boolean
  turnos: number
  manifesto: ManifestoCriador | null
  alterados: ArquivoAlterado[]
}

/** Um arquivo a anexar à bancada (áudio, briefing, planilha — o material que
 *  explica o escritório pedido). Vai em base64 porque atravessa IPC. */
export interface AnexoEnvio {
  nome: string
  base64: string
}

/** Um arquivo do escritório na bancada (painel Arquivos). */
export interface ArquivoBancada {
  caminho: string
  tamanho: number
}

export interface ConteudoArquivo {
  ok: boolean
  binario?: boolean
  tamanho?: number
  conteudo?: string
  aviso?: string
  error?: string
}

export interface CriadorTransporte {
  /** 'desktop' (CLI local, o real) ou 'simulacao' (web, sem IA). */
  readonly tipo: 'desktop' | 'simulacao'
  abrir(slug: string): Promise<EstadoCriador>
  /** Fire-and-forget: o turno chega pelos eventos (status ocupado=false no fim). */
  enviar(texto: string): Promise<void>
  /** Grava os arquivos em `anexos/` na bancada — a sessão lê de lá. */
  anexar(arquivos: AnexoEnvio[]): Promise<{ ok: boolean; salvos?: string[]; error?: string }>
  /** Painel Arquivos: o escritório da bancada, para LER prompt e skills. */
  arquivos(): Promise<{ ok: boolean; arquivos?: ArquivoBancada[]; error?: string }>
  arquivo(caminho: string): Promise<ConteudoArquivo>
  cancelar(): Promise<void>
  publicar(): Promise<{ ok: boolean; error?: string }>
  fechar(): Promise<void>
  onEvento(cb: (ev: EventoCriador) => void): () => void
}

/* ─── Desktop: a ponte do app (window.offizMotor.criador) ─────────────────── */

interface RespostaIpc {
  ok: boolean
  error?: string
  estado?: EstadoCriador
}

/** A ponte do criador existe nesta janela? (app desktop com a versão nova). */
export function temCriadorDesktop(): boolean {
  return typeof window !== 'undefined'
    && typeof window.offizMotor?.criador?.abrir === 'function'
}

export function transporteDesktop(idioma: IdiomaCriador = 'pt-BR'): CriadorTransporte {
  const traduzir = tradutorCriador(idioma)
  const ponte = window.offizMotor!.criador!
  return {
    tipo: 'desktop',
    async abrir(slug) {
      const r = (await ponte.abrir(slug)) as RespostaIpc
      if (!r.ok || !r.estado) throw new Error(r.error || traduzir('O app não conseguiu abrir o escritório.', 'The app could not open the office.'))
      return r.estado
    },
    async enviar(texto) {
      const r = (await ponte.enviar({ texto })) as RespostaIpc
      if (!r.ok) throw new Error(r.error || traduzir('O app recusou a mensagem.', 'The app rejected the message.'))
    },
    async anexar(arquivos) {
      if (typeof ponte.anexar !== 'function') {
        // App 0.2.0: tem o criador mas ainda não tem anexos — pedir update é
        // mais honesto do que os arquivos sumirem em silêncio.
        return { ok: false, error: traduzir('Anexos pedem o app 0.2.1+ — baixe a atualização.', 'Attachments require app version 0.2.1 or later. Download the update.') }
      }
      const r = (await ponte.anexar(arquivos)) as RespostaIpc & { salvos?: string[] }
      return { ok: r.ok, salvos: r.salvos, error: r.error }
    },
    async arquivos() {
      if (typeof ponte.arquivos !== 'function') {
        return { ok: false, error: traduzir('O painel Arquivos pede o app 0.2.2+ — baixe a atualização.', 'The Files panel requires app version 0.2.2 or later. Download the update.') }
      }
      return (await ponte.arquivos()) as { ok: boolean; arquivos?: ArquivoBancada[]; error?: string }
    },
    async arquivo(caminho) {
      if (typeof ponte.arquivo !== 'function') {
        return { ok: false, error: traduzir('O painel Arquivos pede o app 0.2.2+ — baixe a atualização.', 'The Files panel requires app version 0.2.2 or later. Download the update.') }
      }
      return (await ponte.arquivo(caminho)) as ConteudoArquivo
    },
    async cancelar() { await ponte.cancelar() },
    async publicar() {
      const r = (await ponte.publicar()) as RespostaIpc
      return { ok: r.ok, error: r.error }
    },
    async fechar() { await ponte.fechar() },
    onEvento(cb) { return ponte.onEvento((ev) => cb(ev as EventoCriador)) },
  }
}

/* ─── Simulação: comandos determinísticos sobre o manifesto (sem IA) ──────── */

const ajudaSimulacao = (traduzir: Traduzir) => traduzir([
  'Simulação sem IA — comandos que eu entendo, um por mensagem:',
  '• renomear para <nome>',
  '• descrição: <texto>',
  '• cor primária #rrggbb  ·  ícone <emoji>',
  '• adicionar aba <painel>  ·  remover aba <painel>',
  '• renomear aba <painel> para <rótulo>',
  '• adicionar tarefa "<título>" na seção "<seção>": <prompt>',
  '',
  'No app Offiz Desktop esta mesma tela conversa com o Claude de verdade.',
].join('\n'), [
  'Simulation without AI. Send one command at a time:',
  '• renomear para <name>',
  '• descrição: <text>',
  '• cor primária #rrggbb  ·  ícone <emoji>',
  '• adicionar aba <panel>  ·  remover aba <panel>',
  '• renomear aba <panel> para <label>',
  '• adicionar tarefa "<title>" na seção "<section>": <prompt>',
  '',
  'Commands use Portuguese keywords. Names and content keep the language you enter.',
  'In Offiz Desktop, this screen connects to the real Claude.',
].join('\n'))

const PAINEIS = [
  'inicio', 'conversa', 'entregas', 'meses', 'clientes', 'pentest',
  'casos', 'monitor', 'biblioteca', 'oficina', 'agenda', 'estudio',
]

/** Normaliza `abas` para a forma de objeto (a simulação edita em cima). */
function abasComoObjetos(m: ManifestoCriador): AbaManifesto[] {
  return (m.abas ?? []).map((a) => (typeof a === 'string' ? { id: a } : { ...a }))
}

/** Aplica UM comando; devolve a resposta “do agente” (ou null = não entendi). */
function aplicarComando(m: ManifestoCriador, texto: string, traduzir: Traduzir): string | null {
  const t = texto.trim()

  let x = t.match(/^renomear\s+para\s+(.+)$/i)
  if (x) { m.nome = x[1].trim(); return traduzir(`Nome trocado para “${m.nome}”.`, `Name changed to “${m.nome}”.`) }

  x = t.match(/^descri[cç][aã]o:\s*(.+)$/is)
  if (x) { m.descricao = x[1].trim(); return traduzir('Descrição atualizada.', 'Description updated.') }

  x = t.match(/^cor\s+prim[aá]ria\s+(#[0-9a-f]{6})$/i)
  if (x) {
    m.tema = { ...(m.tema ?? {}), cor_primaria: x[1].toLowerCase() }
    return traduzir(`Cor primária agora é ${x[1].toLowerCase()}.`, `Primary color is now ${x[1].toLowerCase()}.`)
  }

  x = t.match(/^[ií]cone\s+(\S+)$/i)
  if (x) { m.tema = { ...(m.tema ?? {}), icone: x[1] }; return traduzir(`Ícone trocado para ${x[1]}.`, `Icon changed to ${x[1]}.`) }

  x = t.match(/^adicionar\s+aba\s+([a-z]+)$/i)
  if (x) {
    const id = x[1].toLowerCase()
    if (!PAINEIS.includes(id)) return traduzir(`Não existe o painel “${id}” — os disponíveis são: ${PAINEIS.join(', ')}.`, `The “${id}” panel does not exist. Available panels: ${PAINEIS.join(', ')}.`)
    const abas = abasComoObjetos(m)
    if (abas.length === 0) {
      // Menu automático → declarar é o primeiro passo; declaro o esqueleto e
      // a aba pedida de uma vez (é o que a pessoa quis dizer).
      m.abas = [{ id: 'inicio' }, { id: 'conversa' }, { id: 'entregas' }, { id }]
      return traduzir(`Este escritório usava o menu automático — declarei o menu com o esqueleto padrão (inicio, conversa, entregas) mais a aba “${id}”.`, `This office used an automatic menu. The menu now includes the standard panels (inicio, conversa, entregas) plus “${id}”.`)
    }
    if (abas.some((a) => a.id === id)) return traduzir(`A aba “${id}” já está no menu.`, `The “${id}” tab is already in the menu.`)
    abas.push({ id })
    m.abas = abas
    return traduzir(`Aba “${id}” acrescentada ao fim do menu.`, `The “${id}” tab was added at the end of the menu.`)
  }

  x = t.match(/^remover\s+aba\s+([a-z]+)$/i)
  if (x) {
    const id = x[1].toLowerCase()
    const abas = abasComoObjetos(m).filter((a) => a.id !== id)
    if (abas.length === 0) return traduzir('Não posso deixar o menu sem nenhuma aba.', 'The menu must have at least one tab.')
    m.abas = abas
    return traduzir(`Aba “${id}” removida.`, `The “${id}” tab was removed.`)
  }

  x = t.match(/^renomear\s+aba\s+([a-z]+)\s+para\s+(.+)$/i)
  if (x) {
    const id = x[1].toLowerCase()
    const abas = abasComoObjetos(m)
    const alvo = abas.find((a) => a.id === id)
    if (!alvo) return traduzir(`A aba “${id}” não está no menu declarado.`, `The “${id}” tab is not in the declared menu.`)
    alvo.rotulo = x[2].trim()
    m.abas = abas
    return traduzir(`A aba “${id}” agora se chama “${alvo.rotulo}”.`, `The “${id}” tab is now called “${alvo.rotulo}”.`)
  }

  x = t.match(/^adicionar\s+tarefa\s+"([^"]+)"(?:\s+na\s+se[cç][aã]o\s+"([^"]+)")?\s*:\s*(.+)$/is)
  if (x) {
    const prompts = [...(m.prompts_prontos ?? [])]
    prompts.push({
      titulo: x[1].trim(),
      escopo: (x[2] ?? '').trim(),
      descricao: `Tarefa criada pela simulação do criador.`,
      prompt: x[3].trim(),
    })
    m.prompts_prontos = prompts
    return traduzir(`Tarefa “${x[1].trim()}” criada${x[2] ? ` na seção “${x[2].trim()}”` : ''} — posição ${prompts.length}.`, `Task “${x[1].trim()}” created${x[2] ? ` in section “${x[2].trim()}”` : ''} at position ${prompts.length}.`)
  }

  return null
}

export function transporteSimulacao(idioma: IdiomaCriador = 'pt-BR'): CriadorTransporte {
  const traduzir = tradutorCriador(idioma)
  let manifesto: ManifestoCriador | null = null
  let original = ''
  let slugAberto: string | null = null
  const ouvintes = new Set<(ev: EventoCriador) => void>()
  const emitir = (ev: EventoCriador) => ouvintes.forEach((cb) => cb(ev))

  const alterados = (): ArquivoAlterado[] =>
    manifesto && JSON.stringify(manifesto) !== original
      ? [{ caminho: 'office.json', acao: 'alterado' }]
      : []

  /** Texto “streamado” em pedaços — a UI exercita o MESMO caminho do CLI. */
  const streamar = async (texto: string) => {
    for (const pedaco of texto.match(/.{1,24}/gs) ?? []) {
      emitir({ tipo: 'agent_text', payload: { texto: pedaco } })
      await new Promise((r) => setTimeout(r, 30))
    }
  }

  return {
    tipo: 'simulacao',
    async abrir(slug) {
      const r = await api.get<{ completo?: ManifestoCriador } & ManifestoCriador>(
        `/admin/offices/${slug}/manifesto`,
      )
      // O manifesto COMPLETO (com upload_mensal, usa_clientes, etapas…): sem
      // ele o fallback de abas do preview divergiria da shell real. O campo
      // `origem` é derivado do catálogo — sai do estado editável.
      const base = r.completo ?? r
      const { origem: _o, ...doArquivo } = base
      manifesto = doArquivo as ManifestoCriador
      original = JSON.stringify(manifesto)
      slugAberto = slug
      return {
        aberta: true, slug, ocupado: false, turnos: 0,
        manifesto, alterados: [],
      }
    },
    async enviar(texto) {
      if (!manifesto) throw new Error(traduzir('Nenhum escritório aberto.', 'No office is open.'))
      emitir({ tipo: 'status', payload: { ocupado: true } })
      const resposta = aplicarComando(manifesto, texto, traduzir)
      await streamar(resposta ?? ajudaSimulacao(traduzir))
      if (resposta) {
        emitir({ tipo: 'tool_use', payload: { ferramenta: 'Edit', resumo: 'office.json' } })
      }
      // SEMPRE um clone: o transporte desktop entrega objetos novos a cada
      // evento (IPC serializa), e a página memoiza por identidade — emitir o
      // MESMO objeto mutado deixaria o preview mostrando o menu velho.
      emitir({
        tipo: 'manifesto',
        payload: {
          manifesto: JSON.parse(JSON.stringify(manifesto)) as ManifestoCriador,
          alterados: alterados(),
        },
      })
      emitir({ tipo: 'status', payload: { ocupado: false } })
    },
    async anexar(arquivos) {
      // A simulação não tem bancada em disco — registra os nomes e avisa que
      // quem LÊ anexo é o Claude do app. Os chips aparecem na UI mesmo assim
      // (é a interface sendo validada, não o conteúdo sendo usado).
      return { ok: true, salvos: arquivos.map((a) => a.nome) }
    },
    async arquivos() {
      // Sem bancada em disco, o único arquivo enxergável é o manifesto.
      return { ok: true, arquivos: [{ caminho: 'office.json', tamanho: original.length }] }
    },
    async arquivo(caminho) {
      if (caminho !== 'office.json' || !manifesto) {
        return {
          ok: false,
          error: traduzir('Na simulação só o office.json é legível — CLAUDE.md, skills e agents abrem no app Offiz Desktop.', 'Simulation can only read office.json. Open CLAUDE.md, skills and agents in Offiz Desktop.'),
        }
      }
      const texto = JSON.stringify(manifesto, null, 2)
      return { ok: true, binario: false, tamanho: texto.length, conteudo: texto }
    },
    async cancelar() { /* a simulação é síncrona — nada a cancelar */ },
    async publicar() {
      if (!manifesto || !slugAberto) return { ok: false, error: traduzir('Nenhum escritório aberto.', 'No office is open.') }
      try {
        // A simulação só sabe editar manifesto → publica pelo PUT que valida
        // campo a campo (o zip é para o transporte desktop, que edita TUDO).
        // O `tema` vai FILTRADO às chaves editáveis: o manifesto completo
        // carrega outras (`estilo`) que o PUT rejeita por design — e ele
        // preserva as não-enviadas por mescla, então nada se perde.
        const tema: Record<string, string> = {}
        for (const k of ['cor_primaria', 'cor_acento', 'cor_fundo', 'icone']) {
          const v = manifesto.tema?.[k]
          if (typeof v === 'string' && v) tema[k] = v
        }
        await api.put(`/admin/offices/${slugAberto}/manifesto`, {
          nome: manifesto.nome,
          descricao: manifesto.descricao,
          ...(Object.keys(tema).length > 0 ? { tema } : {}),
          ...(typeof manifesto.vendavel === 'boolean' ? { vendavel: manifesto.vendavel } : {}),
          // Organização é editada nos controles do catálogo. Uma bancada
          // antiga não pode desfazer um arquivamento ao publicar textos.
          ...(manifesto.prompts_prontos ? { prompts_prontos: manifesto.prompts_prontos } : {}),
          ...(manifesto.abas ? { abas: manifesto.abas } : {}),
        })
        original = JSON.stringify(manifesto)
        emitir({ tipo: 'manifesto', payload: { manifesto, alterados: [] } })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : traduzir('Falha ao publicar.', 'Publishing failed.') }
      }
    },
    async fechar() { manifesto = null; slugAberto = null },
    onEvento(cb) {
      ouvintes.add(cb)
      return () => ouvintes.delete(cb)
    },
  }
}
