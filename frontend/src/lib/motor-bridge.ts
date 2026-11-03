/**
 * Ponte do Motor local — contrato de `window.offizMotor`, exposta pelo
 * preload da janela do SITE dentro do app Offiz Desktop (o app injeta a
 * ponte direto no site; não existe mais uma segunda janela do motor).
 *
 * IMPORTANTE: na web e em apps desktop antigos a ponte NÃO existe.
 * Feature-detect SEMPRE com temMotorBridge() — sem a ponte, a UI fica
 * exatamente como era ("cada pessoa conecta a própria máquina pelo app…").
 */

/** Config persistida do motor no app (o que ele guarda localmente). */
export interface MotorConfig {
  orgId: number | null
  orgNome: string | null
  pareadoUsuarioId?: number | null
  claudeBin: string | null
  backendUrl: string
  localEngine?: 'claude' | 'codex' | ''
  claudeModel?: string
  codexModel?: string
  workerEnabled?: boolean
}

/** Job em execução no worker local (shape tolerante — vem do app). */
export interface MotorJobAtual {
  id?: number
  office?: string
  titulo?: string
  [k: string]: unknown
}

export interface MotorWorkerEstado {
  /** 'parado' | 'ocioso' (ligado, aguardando tarefas) | 'executando'. */
  estado: 'parado' | 'ocioso' | 'executando' | string
  jobAtual: MotorJobAtual | null
  log: string[]
}

/** Resposta de estado(): tudo que o painel embutido precisa exibir. */
export interface MotorEstado {
  config: MotorConfig
  pareado: boolean
  pareadoPor: string | null
  worker: MotorWorkerEstado
}

export interface ClaudeStatus {
  installed: boolean
  loggedIn?: boolean | null
  tokenExpired?: boolean | null
  versao?: string
  bin?: string
  error?: string
}

/**
 * Resultado de parear/aguardarLoginClaude. Quando o app fica PAREADO numa
 * org E com o Claude conectado, o main tenta a troca automática do motor da
 * org (PUT motor_modo="cli" com o JWT do site) — quem completar a dupla
 * devolve motorTrocado=true. Um 403 (membro comum, sem poder de org) NÃO é
 * erro: vem motorTrocado=false + avisoModo pedindo a troca ao dono/admin.
 */
export interface ResultadoComTrocaDeMotor {
  ok: boolean
  motorTrocado?: boolean
  avisoModo?: string | null
  error?: string
}

export interface ParearResultado extends ResultadoComTrocaDeMotor {
  orgNome?: string
  keyPrefix?: string
}

export interface DespararResultado {
  ok: boolean
  aviso?: string | null
  /** PUT motor_modo="api" best-effort ao desparear (falha vira `aviso`). */
  motorRestaurado?: boolean
}

export interface InstalarClaudeResultado {
  ok: boolean
  versao?: string
  jaInstalado?: boolean
  error?: string
  /** Últimas linhas do instalador quando dá erro (além do stream ao vivo). */
  log?: string[]
}

/** Uma dependência do escritório vista pelo app (verificarDeps). */
export interface DepStatus {
  nome: string
  /** Capacidade opcional; sua ausência não impede os outros trabalhos. */
  opcional?: boolean
  detalhe?: string
  /** false = fora do mapa conhecido do app — só instrução manual. */
  conhecida: boolean
  /** null = não foi possível verificar. */
  instalada: boolean | null
  versao?: string | null
  /** O app sabe instalar sozinho (botão "Instalar"). */
  instalavel: boolean
  /** macOS sem Homebrew — instalar o brew primeiro (https://brew.sh). */
  brewAusente?: boolean
  /** Instrução de instalação manual (comando ou URL), quando houver. */
  manual?: string | null
}

export interface InstalarDepResultado {
  ok: boolean
  versao?: string
  error?: string
  brewAusente?: boolean
}

/** Contrato completo da ponte injetada pelo preload do app desktop. */
export interface OffizMotorBridge {
  /** Transcrição no computador, sem envio de áudio à API. */
  transcreverVoz?(wav: ArrayBuffer, idioma: 'pt-BR' | 'en'): Promise<{ ok: boolean; texto?: string; error?: string }>
  /** App 0.2.9+: conversa pela assinatura nesta janela. */
  chatDeviceId?: string
  /** App 0.2.6+: ajusta somente os rótulos nativos, sem dados da conta. */
  definirIdioma?(idioma: 'pt-BR' | 'en'): Promise<{ ok: boolean }>
  /** App 0.2.10+: aplica o mesmo tema aos menus e diálogos nativos. */
  definirTema?(tema: 'light' | 'dark'): Promise<{ ok: boolean }>
  /** Versão do app desktop (app.getVersion()). */
  versao: string
  estado(): Promise<MotorEstado>
  claudeStatus(force?: boolean): Promise<ClaudeStatus>
  parear(orgId: number): Promise<ParearResultado>
  desparear(): Promise<DespararResultado>
  ligar(): Promise<{ ok: boolean }>
  desligar(): Promise<{ ok: boolean }>
  recuperacoes?(orgId: number): Promise<{id: string;jobId: number;office: string;date: string}[]>
  abrirRecuperacao?(orgId: number, id: string): Promise<{ok: boolean}>
  /** Abre o OAuth do Claude no navegador padrão. */
  conectarClaude(): Promise<{ ok: boolean; error?: string }>
  /** Resolve quando o login no navegador termina (ou é cancelado). */
  aguardarLoginClaude(): Promise<ResultadoComTrocaDeMotor>
  cancelarLoginClaude(): Promise<{ ok: boolean }>
  instalarClaude(): Promise<InstalarClaudeResultado>
  /** Motor Codex (OpenAI) — app 0.2.3+; ausente em apps antigos. */
  codexStatus?(force?: boolean): Promise<{ installed: boolean; authenticated?: boolean; versao?: string; error?: string }>
  escolherMotor?(engine: 'claude' | 'codex', model: string): Promise<{ ok: boolean; error?: string }>
  conectarCodex?(): Promise<{ ok: boolean; error?: string }>
  aguardarLoginCodex?(): Promise<ResultadoComTrocaDeMotor>
  cancelarLoginCodex?(): Promise<{ ok: boolean }>
  instalarCodex?(): Promise<InstalarClaudeResultado>
  verificarDeps(): Promise<{ deps: DepStatus[] }>
  instalarDep(nome: string): Promise<InstalarDepResultado>
  /** Push a cada mudança do motor; devolve a função de unsubscribe. */
  onUpdate(cb: () => void): () => void
  /** Stream ao vivo das instalações (Claude CLI e dependências). */
  onInstalarLinha(cb: (linha: string) => void): () => void
  /** O Criador de escritórios (só a partir do app 0.2): sessão multi-turno do
   *  Claude CLI local sobre uma cópia do escritório. Shapes soltos de
   *  propósito — o contrato tipado da página mora em lib/criador-transporte,
   *  que valida as respostas; apps antigos simplesmente não têm o campo. */
  criador?: {
    abrir(slug: string): Promise<unknown>
    enviar(payload: { texto: string; model?: string; effort?: string }): Promise<unknown>
    /** App 0.2.1+: grava arquivos em anexos/ na bancada (áudio, briefings…). */
    anexar?(arquivos: Array<{ nome: string; base64: string }>): Promise<unknown>
    /** App 0.2.2+: painel Arquivos — lista e lê o escritório da bancada. */
    arquivos?(): Promise<unknown>
    arquivo?(caminho: string): Promise<unknown>
    cancelar(): Promise<unknown>
    estado(): Promise<unknown>
    publicar(): Promise<unknown>
    fechar(): Promise<unknown>
    onEvento(cb: (ev: unknown) => void): () => void
  }
}

declare global {
  interface Window {
    /** Ponte do Motor local — só existe na janela do site do app desktop novo. */
    offizMotor?: OffizMotorBridge
    /** Marcador genérico do app desktop (reservado para gerações futuras). */
    offizDesktop?: { versao?: string; [k: string]: unknown }
  }
}

/**
 * A ponte existe e é utilizável? Feature-detect de verdade (função presente),
 * nunca via userAgent — apps antigos são "desktop" mas não têm a ponte.
 */
export function temMotorBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.offizMotor?.estado === 'function'
}

/**
 * Evento window disparado quando a troca automática do motor da org acontece
 * (parear/aguardarLoginClaude com motorTrocado, desparear com motorRestaurado)
 * — a SecaoMotorIA escuta e recarrega os settings para o select refletir.
 */
export const EVENTO_SETTINGS_LLM_MUDOU = 'offiz:settings-llm-mudou'
