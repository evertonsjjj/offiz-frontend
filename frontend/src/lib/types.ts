export type IdiomaInterface = 'auto' | 'pt-BR' | 'en'

export interface Usuario {
  id: number
  email: string
  nome: string
  is_admin: boolean
  /** Preferência de INTERFACE: true = shell completa mesmo em org simples. */
  modo_avancado?: boolean
  idioma_interface?: IdiomaInterface
}

export interface TemaOffice {
  cor_primaria: string
  cor_acento: string
  cor_fundo: string
  icone: string
  estilo?: string
}

export interface PromptPronto {
  /** Índice server-side da tarefa pronta — usado em POST /jobs
   *  (prompt_pronto_id) para o backend expandir o prompt real. */
  id?: number
  titulo: string
  /** Texto amigável do que a tarefa faz (o que o usuário vê no card). */
  descricao?: string
  /** Escopo (etapa do funil do escritório) — agrupa os cards da aba Tarefas
   *  e as páginas do Conhecimento em seções. */
  escopo?: string
  /** O prompt de engenharia. NÃO vem no detalhe do prédio (proteção de IP) —
   *  só aparece no editor de personalização do dono (owner/admin). */
  prompt?: string
}

/** Uma etapa do funil interno do escritório (contrato office.json → API →
 *  Prédio). Era "andar" até jul/2026 — o nome mudou porque "andar" passou a
 *  significar tipo de trabalho concedido (= office) no prédio por cliente. */
export interface EtapaOffice {
  n: number
  tag: string
  nome: string
  descricao?: string
}

/** Um agente NOMINAL do elenco do escritório (contrato office.json). */
export interface AgenteOffice {
  id: string
  nome: string
  papel: string
  camisa: string
  oculos?: boolean
  chefe?: boolean
  /** Etapa do funil onde o agente trabalha (n de uma EtapaOffice). */
  etapa: number
  /** Fala de apresentação em 1ª pessoa (balão ao clicar no boneco). */
  fala?: string
}

export type AreaOffice = 'marketing' | 'financas' | 'juridico' | 'tecnologia'

export interface OfficeInfo {
  slug: string
  /** Agrupamento comercial; o slug continua identificando acessos e histórico. */
  area?: AreaOffice | null
  /** Impede novas concessões; mantém os acessos e trabalhos existentes. */
  arquivado?: boolean
  nome: string
  descricao: string
  tema: TemaOffice
  prompts_prontos?: PromptPronto[]
  dependencias?: string[]
  env_opcionais?: string[]
  etapas?: EtapaOffice[]
  agentes?: AgenteOffice[]
  paineis?: Painel[]
  /** As abas do menu, DECLARADAS pelo manifesto (07/08/2026). Cada item
   *  escolhe um painel que existe na shell — o manifesto decide QUAIS painéis
   *  e em que ordem, e pode renomear (`rotulo`/`icone`/`ajuda`); não inventa
   *  painel, porque do outro lado do id há um componente React.
   *  AUSENTE = as regras antigas por flag/slug decidem (ver ShellSimples). */
  abas?: Array<AbaManifesto | string>
  /** Atividades que FAZEM SENTIDO NESTE ANDAR, oferecidas na aba ⏰ Agenda.
   *  Vem do office.json: o formulário genérico ("Relatório financeiro da
   *  semana") pedia ao usuário de conteúdo que inventasse do zero o que o
   *  escritório dele faz sozinho. Ausente = os exemplos genéricos. */
  sugestoes_agenda?: PromptPronto[]
  /** Prédio centrado em clientes: aba 👥 Clientes, tarefas por cliente,
   *  documentos por período. Hoje: financeiro, assistentes e lgpd. */
  usa_clientes?: boolean
  /** Self-service com pastas por mês (aba Meses): a org usa o prédio para si.
   *  Vem do office.json; hoje: financeiro + assistente-pf/pme + conteudo. */
  upload_mensal?: boolean
  /** Prédio de marca: o Conhecimento ganha os cards do acervo (exemplos de
   *  posts + fotos do produto). Vem do office.json; hoje: conteudo. */
  acervo_de_marca?: boolean
  /** false = office interno/parceiro (dev, outracoisa): NUNCA aparece na
   *  vitrine de andares disponíveis do cliente. Ausente = vendável. */
  vendavel?: boolean
}

/* ------------------------------------------------------------------ */
/* Fase 3 — Painéis de Conteúdo e Financeiro                           */
/* ------------------------------------------------------------------ */

/**
 * Tipo de um campo do painel de dados estruturados.
 * O contrato (office.json) usa nomes em português: `texto`/`numero`/`textarea`/
 * `cor`/`lista`. O renderer também aceita os equivalentes em inglês.
 */
export type TipoCampoPainel =
  | 'texto'
  | 'numero'
  | 'textarea'
  | 'cor'
  | 'lista'
  | 'text'
  | 'number'
  | string

/** Um campo do formulário de um painel de dados. */
export interface CampoPainel {
  id: string
  rotulo: string
  tipo?: TipoCampoPainel
  placeholder?: string
}

/** Uma aba declarada no `abas[]` do office.json.
 *
 *  `id` aponta para um painel que a shell tem (inicio, conversa, entregas,
 *  meses, clientes, pentest, casos, monitor, biblioteca, oficina, agenda).
 *  O resto é cosmético e opcional: sem `rotulo`/`icone`/`ajuda`, vale o padrão
 *  do painel. Um id só pode aparecer uma vez. */
export interface AbaManifesto {
  id: string
  rotulo?: string
  icone?: string
  ajuda?: string
}

/** Galeria das entregas do prédio, agrupadas por tipo. */
export interface PainelGaleria {
  tipo: 'galeria'
  titulo: string
  agrupar_por?: string
}

/** Formulário estruturado salvo/lido por chave (brand-kit, metas…). */
export interface PainelDados {
  tipo: 'dados'
  titulo: string
  chave: string
  campos: CampoPainel[]
}

/** Cartões de KPI lidos de um JSON de output. */
export interface PainelKpis {
  tipo: 'kpis'
  titulo: string
  fonte_arquivo: string
}

/** Textarea + botão que cria um Job a partir de um prompt-modelo. */
export interface PainelAcao {
  tipo: 'acao'
  titulo: string
  placeholder?: string
  rotulo_botao?: string
  prompt: string
}

/** Calculadora das operações financeiras (só no office financeiro). */
export interface PainelCalculadora {
  tipo: 'calculadora'
  titulo: string
}

export type Painel =
  | PainelGaleria
  | PainelDados
  | PainelKpis
  | PainelAcao
  | PainelCalculadora
  | { tipo: string; titulo?: string; [k: string]: unknown }

/** Um KPI dentro do JSON lido por PainelKpis. */
export interface Kpi {
  rotulo: string
  valor: string | number
  delta?: string | number | null
}

/** Resposta de GET /kpis?arquivo= */
export interface KpisResposta {
  existe: boolean
  dados?: {
    kpis?: Kpi[]
    series?: unknown[]
  }
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
export type Effort = 'high' | 'xhigh' | 'max'

export interface Job {
  id: number
  organization_id?: number
  office_slug?: string
  usuario_id?: number
  titulo: string
  prompt: string
  effort: Effort
  status: JobStatus
  /** O status terminal já contabilizou uso; o lote ainda não foi consolidado. */
  finalizando?: boolean
  erro?: string | null
  criado_em: string
  iniciado_em?: string | null
  finalizado_em?: string | null
  tokens_entrada?: number
  tokens_saida?: number
  custo_brl?: number
  /** Cliente do trabalho (aba Tarefas do financeiro) — null nas tarefas sem cliente. */
  cliente_id?: number | null
  cliente_nome?: string | null
  /** Conversa de origem — liga tentativas do MESMO pedido (a falha antiga se
   *  auto-resolve quando um job posterior da conversa termina). */
  conversa_id?: number | null
  /** Modelo EFETIVO carimbado pelo roteador (null = premium da org). */
  claude_model?: string | null
}

export interface Predio {
  org_id: number
  org_nome: string
  office_slug: string
  office: OfficeInfo
  /** Papel efetivo do usuário na org (owner | admin | member). */
  meu_papel?: string
  nao_lidas: number
  ultimo_job: Job | null
  /** Org no MODO SIMPLES: a shell vira duas abas (Conversar + Entregas). */
  modo_simples?: boolean
}

export type TipoEvento =
  | 'iniciado'
  | 'agent_text'
  | 'tool_use'
  | 'subagente'
  | 'resultado'
  | 'entrega_registrada'
  | 'erro'

export interface JobEvent {
  seq: number
  tipo: TipoEvento | string
  payload: Record<string, unknown>
  criado_em?: string
}

export type EntregaStatus = 'pendente' | 'aprovada' | 'rejeitada'

/** Canal pelo qual a entrega chega ao cliente: peça de e-mail/newsletter
 *  ("email") ou trabalho comum pedido no Chat AI ("chat"). */
export type EntregaCanal = 'email' | 'chat'

export interface Entrega {
  editorial_peca_id?: number | null
  id: number
  job_id: number
  organization_id?: number
  office_slug?: string
  caminho_rel: string
  nome: string
  mime?: string | null
  tamanho_bytes: number | null
  status: EntregaStatus
  feedback?: string | null
  criado_em: string
  decidido_em?: string | null
  /** Tipo inferido pelo backend (video/imagem/dashboard/documento/planilha/pdf/email…). */
  tipo?: string | null
  /** Cliente do trabalho (denormalizado do job) — controle/filtro por cliente. */
  cliente?: string | null
  /** Id do cliente do trabalho (quando o backend envia) — chips por cliente. */
  cliente_id?: number | null
  /** Título do job de origem — a aba Entregas agrupa por trabalho com isto. */
  job_titulo?: string | null
  /** Canal calculado pelo backend na listagem: "email" (peça de e-mail ou job
   *  de newsletter) ou "chat" (trabalho comum). Opcional: linhas antigas/rotas
   *  que não calculam ficam sem. */
  canal?: EntregaCanal
  /** A conversa que criou o trabalho (27/08): o fio de volta da entrega —
   *  "quero outro igual" reabre o chat de origem. */
  conversa_id?: number | null
  conversa_titulo?: string | null
}

/* ------------------------------------------------------------------ */
/* Aba Chat AI — conversas multi-turno com a IA (sem produzir entregas) */
/* ------------------------------------------------------------------ */

/** Sugestão da IA de virar uma tarefa de verdade (job) a partir da conversa. */
export interface PesquisaPlanejada {
  modo: 'necessaria' | 'dispensavel_por_material' | 'indefinida'
  justificativa: string
  atividade: 'edicao_composicao' | 'pesquisa_criacao' | 'indefinida'
  sem_fatos_externos: boolean
  materiais: string[]
}

export interface SugestaoTarefa {
  pesquisa?: PesquisaPlanejada
  referencia_job_id?: number
  referencia_entrega_id?: number
  intencao_referencia?: 'ajustar' | 'reutilizar' | 'testar'
  escopo_referencia?: 'completo' | 'texto' | 'imagem' | 'cena'
  /** Andar-alvo (conversa do PRÉDIO/CEO): slug do escritório que executa.
   *  Ausente nas conversas de andar — lá o alvo é o próprio andar aberto. */
  andar?: string
  /** PLANO multi-andar (CEO fase 2): quando presente, a sugestão é um plano
   *  de 2-5 etapas em sequência — o cartão vira "iniciar plano". */
  etapas?: { andar: string; titulo: string; prompt: string; pesquisa?: PesquisaPlanejada }[]

  titulo: string
  prompt: string
}

export interface ReferenciaConversa {
  jobId: number
  entregaId?: number
  intencao: 'discutir' | 'ajustar' | 'reutilizar' | 'testar'
}

/**
 * Proposta de MARCA vinda da conversa: o dono pediu "põe as cores do meu time"
 * e a IA respondeu com o que mudar. Viaja na mesma chave `sugestao_tarefa` da
 * mensagem (mesma coluna no banco) e se distingue pelo `tipo` — por isso o
 * discriminante é obrigatório aqui e ausente na de tarefa.
 */
export interface SugestaoMarca {
  tipo: 'marca'
  /** Uma linha do que muda, na voz do dono. */
  resumo: string
  /** Cores/ícone a aplicar (só as chaves propostas). */
  tema?: {
    cor_primaria?: string
    cor_acento?: string
    cor_fundo?: string
    icone?: string
  } | null
  /** Texto a ACRESCENTAR à diretriz de marca do escritório. */
  diretriz?: string | null
}

/**
 * DEVOLUTIVA (visão KORÁ): a tarefa terminou de propósito pedindo insumos —
 * o finish escreveu esta mensagem na conversa de origem com o ID citável.
 * O cartão oferece ⏯ retomar (POST /jobs/{job_id}/continuar) depois que o
 * dono enviar o que faltava.
 */
export interface SugestaoDevolutiva {
  tipo: 'devolutiva'
  job_id: number
  entrega_id?: number | null
  titulo?: string | null
}

/**
 * Proposta de AGENDAMENTO vinda da conversa: a recorrência ficou clara
 * ("toda segunda eu preciso dos posts") e a IA propõe a entrada da ⏰ Agenda.
 * O clique cria com o token do usuário — permissão igual à da aba Agenda.
 */
export interface SugestaoAgendamento {
  tipo: 'agendamento'
  titulo: string
  prompt: string
  /** uma_vez (27/08): dia MARCADO — `data` manda, `dia` vem 0. */
  recorrencia: 'semanal' | 'mensal' | 'uma_vez'
  /** semanal: 0=segunda … 6=domingo · mensal: 1..28 · uma_vez: 0 */
  dia: number
  /** HH:MM (fuso de Brasília). */
  hora: string
  /** uma_vez: 'AAAA-MM-DD' (fuso de SP). */
  data?: string | null
  /** A peça do estúdio ligada ('posta a peça X quinta'). */
  peca_slug?: string | null
  resumo?: string | null
}

/**
 * Proposta de CÂNON vinda da SABATINA COM IA: a conversa entrevistou o dono
 * e organizou as seções. O resumo editável confirma a versão original e
 * somente as seções escolhidas, com permissão de owner/admin. Encerrar a
 * preparação é uma escolha independente, nunca implícita ao guardar um fato.
 */
export interface SugestaoCanon {
  tipo: 'canon'
  resumo: string
  secoes: Array<{ secao: string; conteudo: string }>
}

/** Cartão de PEÇA do estúdio anexado a uma mensagem (chat rico, 27/08):
 *  um clique abre o painel da peça ao lado da conversa. O backend só grava
 *  slug que existe no disco — título e estado vêm do documento real. */
export interface PecaCartao {
  slug: string
  titulo: string
  estado: 'rascunho' | 'com plano' | 'gerada' | string
}

/** Enriquecimentos do chat rico — ortogonais à ação: qualquer sugestão pode
 *  carregá-los, e eles também viajam sozinhos (sem cartão de ação). */
export interface EnriquecimentosDaMensagem {
  /** Respostas prontas (chips): o dono toca e o texto vira a resposta dele. */
  perguntas?: string[]
  peca?: PecaCartao
}

/** O que uma mensagem da IA pode propor. No fio, o JSON pode vir SÓ com os
 *  enriquecimentos (sem ação nenhuma) — por isso os guards de runtime
 *  (eTarefa e afins, e o cartão genérico) exigem prompt/etapas antes de
 *  tratar qualquer valor como tarefa. */
export type SugestaoDaConversa = (
  | SugestaoTarefa
  | SugestaoMarca
  | SugestaoDevolutiva
  | SugestaoAgendamento
  | SugestaoCanon
) &
  EnriquecimentosDaMensagem

/** Lê os enriquecimentos de qualquer sugestão (ou de nenhuma). */
export function extrasDaMensagem(
  s: SugestaoDaConversa | null | undefined
): EnriquecimentosDaMensagem {
  const e = (s ?? {}) as EnriquecimentosDaMensagem
  return {
    perguntas: Array.isArray(e.perguntas) ? e.perguntas.filter((p) => !!p) : undefined,
    peca: e.peca && e.peca.slug ? e.peca : undefined,
  }
}

/** Estreita a união: a de marca é a única que carrega `tipo: 'marca'`. */
export function eSugestaoDeMarca(s: SugestaoDaConversa | null | undefined): s is SugestaoMarca {
  return !!s && (s as SugestaoMarca).tipo === 'marca'
}

/** Estreita a união: devolutiva de tarefa (⏯ retomar). */
export function eSugestaoDeDevolutiva(
  s: SugestaoDaConversa | null | undefined
): s is SugestaoDevolutiva {
  return !!s && (s as SugestaoDevolutiva).tipo === 'devolutiva'
}

/** Estreita a união: proposta de recorrência para a ⏰ Agenda. */
export function eSugestaoDeAgendamento(
  s: SugestaoDaConversa | null | undefined
): s is SugestaoAgendamento {
  return !!s && (s as SugestaoAgendamento).tipo === 'agendamento'
}

/** Estreita a união: seções de cânon propostas pela sabatina com IA. */
export function eSugestaoDeCanon(
  s: SugestaoDaConversa | null | undefined
): s is SugestaoCanon {
  return !!s && (s as SugestaoCanon).tipo === 'canon'
}

/**
 * Modo de uma conversa (Fase 3 — chat-hub do juris). Fixo até o fim da
 * conversa; trocar de modo = nova conversa. Prédios não-juris ignoram
 * (o backend usa 'pesquisa' como default e nada muda para eles).
 */
export type ModoConversa = 'pesquisa' | 'contrato' | 'caso'

/** Item da lista lateral (GET /predios/{org}/{slug}/conversas). */
export interface ConversaResumo {
  id: number
  organization_id?: number
  office_slug?: string | null
  /** Área original no histórico geral da empresa; null identifica o prédio. */
  office_nome?: string | null
  titulo: string
  fixada?: boolean
  sinal?: 'trabalhando' | 'precisa_de_voce' | 'entregue' | null
  resumo?: string | null
  cliente_id?: number | null
  cliente_nome?: string | null
  atualizado_em: string
  total_mensagens: number
  /** Modo da conversa (juris) — ausente/pesquisa nas conversas antigas. */
  modo?: ModoConversa | string
  /** Caso vinculado (modo 'caso'). */
  caso_id?: number | null
  caso_nome?: string | null
  /** Modo 'contrato': já há um contrato anexado à conversa. */
  tem_contrato?: boolean
}

/** Resposta de POST /conversas/{id}/contrato (upload do contrato em análise). */
export interface ContratoUploadResposta {
  ok: boolean
  caracteres: number
  nome: string
}

export type RoleMensagem = 'user' | 'assistant'

/** Uma mensagem do thread (GET /conversas/{id} → mensagens[]). */
export interface ConversaMensagem {
  id: number
  role: RoleMensagem
  conteudo: string
  sugestao_tarefa?: SugestaoDaConversa | null
  criado_em: string
}

/** Conversa completa (GET /conversas/{id}). */
export interface AnexoConversa {
  nome: string
  chars?: number
  nome_exibicao?: string
  origem_exibicao?: string
  /** Metadados de leitura; arquivos antigos podem não ter estes campos. */
  legivel?: boolean
  leitura_parcial?: boolean
  leitura_aviso?: string | null
}

export interface ConversaDetalhe extends ConversaResumo {
  tarefas_iniciadas?: number[]
  mensagens: ConversaMensagem[]
  /** O trabalho que nasceu desta conversa (ou que o "Pedir ajuste" apontou) —
   *  reabre o painel da entrega depois de um F5. */
  trabalho_job_id?: number | null
  /** O texto extraído permanece no backend; a tela recebe apenas identidade
   *  e resultado da leitura, inclusive limitações de uma amostra. */
  anexos?: AnexoConversa[]
  /** Os trabalhos nascidos NESTA conversa, com as entregas visíveis — o
   *  thread intercala como cartões pela hora ("o chat reflete as entregas",
   *  24/08/2026; vale para conversa antiga e nova). */
  trabalhos?: TrabalhoDaConversa[]
}

export interface TrabalhoDaConversa {
  id: number
  titulo: string
  status: JobStatus
  finalizando?: boolean
  erro?: string | null
  criado_em?: string | null
  finalizado_em?: string | null
  custo_brl?: number | null
  entregas: Array<{ id: number; nome: string; tipo: string; status: string }>
}

/** Resposta de POST /conversas/{id}/anexos (anexo genérico do wizard). */
export interface AnexoConversaResposta {
  ok: boolean
  nome: string
  caracteres: number
  legivel: boolean
  leitura_parcial?: boolean
  leitura_aviso?: string | null
  anexos: string[]
  anexos_detalhes?: AnexoConversa[]
}

/** Resposta de POST /conversas/{id}/mensagens. */
export interface RespostaMensagem {
  mensagem: ConversaMensagem
  /** Cartões adicionais persistidos no mesmo turno, por exemplo perfil + tarefa. */
  mensagens_extras?: ConversaMensagem[]
  sugestao_tarefa?: SugestaoDaConversa | null
  /** IDs das sugestões pessoais criadas ou atualizadas nesta conversa. */
  solucoes_atualizadas?: string[]
  /** Produção já iniciada pelo servidor para um pedido explícito autorizado.
   * O cliente apenas acompanha; não repete a criação do trabalho. */
  trabalho_iniciado?: { id: number; titulo: string; status: JobStatus; org_id: number; office_slug: string } | null
  /** IDs de mensagens cuja proposta já gerou um trabalho. */
  tarefas_iniciadas?: number[]
  /** Orientação do servidor quando um limite ou preparo impede o início. */
  inicio_impedido?: string | null
}

export interface Notificacao {
  id: number
  organization_id: number
  office_slug: string
  tipo: 'job_done' | 'job_failed' | 'entrega_pendente' | string
  titulo: string
  corpo: string
  job_id?: number | null
  lida: boolean
  criado_em: string
}

export type Role = 'owner' | 'admin' | 'member'

/**
 * Detalhe de um prédio (GET /predios/{org}/{slug}).
 * `meu_papel` = papel efetivo do usuário logado NAQUELA org — usado para
 * liberar/bloquear o editor do Cânon (só owner/admin edita).
 */
export interface DetalhePredio {
  org_id: number
  org_nome?: string
  office_slug: string
  office: OfficeInfo
  meu_papel?: Role
  /** Entregas aguardando aprovação neste prédio (badge da aba Entregas). */
  entregas_pendentes?: number
  /** Motor configurado da org ("api" | "cli"). */
  motor_modo?: 'api' | 'cli'
  /** Onde as tarefas REALMENTE rodam agora ("api" = nuvem, "cli" = local). */
  motor_efetivo?: 'api' | 'cli'
  /** Há um motor local vivo (app desktop pareado e online). */
  motor_online?: boolean
  /** Tarefas em execução agora neste prédio. */
  jobs_em_andamento?: number
  /** Tarefas na fila (aguardando vaga) neste prédio. */
  jobs_na_fila?: number
  /** Org no MODO SIMPLES: a shell vira duas abas (Conversar + Entregas). */
  modo_simples?: boolean
  [k: string]: unknown
}

export interface Membro {
  id: number
  usuario_id: number
  organization_id?: number
  nome?: string
  email?: string
  role: Role
  ativo?: boolean
  limite_tokens_mes?: number | null
  /** Fase 7 — teto mensal de gasto em R$ do membro (null/0 = ilimitado). */
  limite_brl_mes?: number | null
  /** Avisos desta org por e-mail (toggle do operador na tabela de Membros). */
  notif_email?: boolean
  /** Andares que esta pessoa enxerga. VAZIO = sem restrição (vê todos) —
   *  nunca "não vê nenhum". Ver backend/app/models/member_office.py. */
  andares?: string[]
  /** owner/admin administram o prédio inteiro: restringi-los não teria efeito. */
  restringivel?: boolean
}

/* ------------------------------------------------------------------ */
/* Convites por e-mail + assentos (venda por assento)                  */
/* ------------------------------------------------------------------ */

/** Ocupação de assentos da org (GET /orgs/{id}/membros → campo `assentos`).
 *  usados = membros ativos; pendentes = convites ainda não aceitos.
 *  Campos de quarentena são OPCIONAIS (backend em evolução): sem eles, o
 *  medidor se comporta como sempre. */
export interface AssentosInfo {
  total: number
  usados: number
  pendentes: number
  /** Assentos presos por remoção recente (anti-rotação, ~30 dias). */
  quarentena?: number
  /** ISO da PRÓXIMA liberação automática (null/ausente sem quarentena). */
  quarentena_libera_em?: string | null
}

/** Resposta de GET /orgs/{id}/membros: lista + ocupação de assentos. */
export interface MembrosResposta {
  membros: Membro[]
  assentos?: AssentosInfo
}

/**
 * Convite pendente de uma organização.
 * `link` (com o token cru) SÓ vem na resposta do POST de criação — o GET da
 * lista devolve `link: null` porque o token não é recuperável do hash.
 */
export interface Convite {
  id: number
  email: string
  /** Convite nunca cria owner — só admin | member. */
  role: Role
  criado_em: string | null
  expira_em: string | null
  link: string | null
  /** Só na resposta do POST: o e-mail com o link foi de fato enviado? */
  email_enviado?: boolean
}

/** Resposta do POST /orgs/{id}/convites — link copiável garantido. */
export interface ConviteCriado extends Convite {
  link: string
  email_enviado: boolean
}

/** Resposta pública de GET /convites/{token} (tela /convite/:token). */
export interface ConvitePublico {
  org_nome: string | null
  email: string
  role: Role
  usuario_existe: boolean
}

export interface ProvedorLlm {
  chave: string
  nome: string
  ajuda: string
  exige_base_url: boolean
  /** Placeholder de formulário. NADA no produto depende destes ids — nome de
   *  modelo muda mais rápido que release, e chumbar um errado no código
   *  quebraria a organização inteira sem ela poder consertar. */
  exemplos: string[]
  /** O DROPDOWN de modelos deste provedor (17/08/2026: escolher, não
   *  digitar). Curadoria do servidor — a tela nunca chumba id de modelo. */
  modelos: Array<{ id: string; nome: string; dica: string }>
  /** O par que o modo Automático grava; o roteador decide por tarefa. */
  auto: { premium: string; leve: string } | null
  /** Gateways prontos (21/08/2026): o dono ESCOLHE em vez de digitar a URL.
   *  OPCIONAL de propósito — a tela precisa continuar funcionando contra um
   *  backend anterior a este campo (mesmo cuidado de `provedores?`). */
  endpoints?: Array<{
    id: string
    nome: string
    url: string
    ajuda: string
    /** Prefixo que o gateway exige no nome do modelo (ex.: "openai/"). */
    modelo_prefixo: string
  }>
}

export interface LlmSettings {
  gerenciado?: boolean
  anthropic_api_key_mascarada: string | null
  claude_model: string
  /** QUAL CLI executa as tarefas: 'claude' (padrão) ou 'codex' (o da OpenAI —
   *  a chave dela vale direto, sem gateway). Opcional para a tela continuar
   *  funcionando contra um backend anterior a este campo. */
  motor_cli?: string
  /** PROVEDOR DE IA (16/08/2026): o motor fala o protocolo de Mensagens da
   *  Anthropic, e vários provedores publicam endpoint compatível com ele. */
  llm_provedor?: string
  llm_base_url?: string | null
  llm_modelo_premium?: string | null
  llm_modelo_leve?: string | null
  provedores?: ProvedorLlm[]
  effort_default: Effort
  motor_modo?: 'api' | 'cli'
  /** Voz na Mesa: leitura das respostas ('desligada'|'botao'|'sempre') e
   *  microfone ('ligado'|'desligado'). A voz de leitura é do NAVEGADOR. */
  voz_leitura?: string
  voz_ditado?: string
  /** "inteligente" = Sonnet nas criativas, premium nas pesadas; "premium" = sempre claude_model. */
  modelo_estrategia?: 'inteligente' | 'premium'
  limite_tokens_mes?: number | null
}

export interface PrecoModelo {
  nome: string
  entrada_usd_mtok: number
  saida_usd_mtok: number
}

export interface UsoResumo {
  tokens_entrada?: number
  tokens_saida?: number
  custo_brl?: number
  custo_estimado_brl?: number
  execucoes?: number
  por_office?: Array<{ office_slug: string; tokens_entrada?: number; tokens_saida?: number; custo_brl?: number }>
  por_membro?: Array<{
    usuario_id?: number
    nome?: string
    email?: string
    tokens_entrada?: number
    tokens_saida?: number
    custo_brl?: number
  }>
  /** Tabela de preços (US$/MTok) + câmbio usado na conversão para R$. */
  precos?: { usd_brl: number; modelos: PrecoModelo[] }
  [k: string]: unknown
}

export interface ArquivoWs {
  nome: string
  caminho_rel?: string
  tamanho_bytes?: number
  tamanho?: number
  modificado_em?: string
}

export interface OrgResumo {
  contrato_tipo?: 'byok' | 'pf_gerenciado'
  id: number
  nome: string
  slug: string
  status?: string
  offices?: string[]
  /** Membros ATIVOS. Vem de GET /admin/orgs desde sempre — a tela é que ignorava. */
  membros?: number
  /** Assentos vendidos (teto da venda por assento). */
  assentos?: number
  /** Assentos presos por quarentena (removidos há < 30 dias). */
  quarentena?: number
  /** A organização já colou a chave da Anthropic? Sem ela, nenhuma tarefa roda. */
  tem_api_key?: boolean
  /** Residência de dados: pode usar o banco central do Offiz? (default sim).
   *  Revogada, só trabalha com o banco próprio (BYOD) configurado e testado. */
  autorizada_banco_central?: boolean
  /** O banco próprio da org está configurado E testado? */
  byod_ok?: boolean
  [k: string]: unknown
}

/** Uma linha da trilha de ações administrativas (GET /admin/auditoria). */
export interface EventoAdmin {
  id: number
  ator_email: string
  acao: string
  organization_id: number | null
  org_slug: string | null
  alvo: string | null
  detalhe: Record<string, unknown> | null
  criado_em: string | null
}

export interface AdminStats {
  usuarios?: number
  organizations?: number
  orgs?: number
  jobs_por_status?: Record<string, number>
  /** Soma das tarefas no período (?dias=N) — 07/08/2026. */
  jobs_total?: number
  /** Custo de IA (BRL) somado no período. */
  custo_brl?: number
  dias?: number | null
  [k: string]: unknown
}

/**
 * Lição da camada de conhecimento (knowledge/learned.md parseado pelo backend).
 * Campos tolerantes: o backend pode usar nomes em inglês (type/source/weight)
 * ou português (tipo/origem/peso) — o normalizador da UI aceita ambos.
 */
export interface Licao {
  indice?: number
  tipo?: string
  type?: string
  origem?: string
  source?: string
  peso?: number
  weight?: number
  motivo?: string
  contexto_resumido?: string
  timestamp?: string
  criado_em?: string
  last_seen?: string
  job_id?: number | string
  task_id?: number | string
  [k: string]: unknown
}

/* ------------------------------------------------------------------ */
/* Fase 2 — Casos (escritório jurídico)                                */
/* ------------------------------------------------------------------ */

/** Status de caso — valores de `StatusCaso` no backend (models/caso.py). */
export type StatusCaso =
  | 'ativo'
  | 'em_analise'
  | 'aguardando_documentos'
  | 'aguardando_pericia'
  | 'protocolado'
  | 'em_andamento'
  | 'aprovado'
  | 'negado'
  | 'recurso'
  | 'concluido'
  | 'arquivado'
  | string

/** Área do direito — valores de `AreaDireito` no backend. */
export type AreaDireito =
  | 'previdenciario'
  | 'trabalhista'
  | 'civil'
  | 'consumidor'
  | 'familia'
  | 'tributario'
  | 'penal'
  | 'empresarial'
  | 'administrativo'
  | 'imobiliario'
  | string

export type TipoCliente = 'PF' | 'PJ' | string
export type PoloCliente = 'autor' | 'reu' | string

/** Documento vinculado a um caso (caso_documentos). */
export interface CasoDocumento {
  id: number
  nome: string
  tipo?: string | null
  tamanho_bytes?: number | null
  ocr_processado?: boolean
}

/** Item da lista de casos (GET .../casos). */
export interface CasoResumo {
  id: number
  cliente_nome: string
  tipo_cliente?: TipoCliente
  polo_cliente?: PoloCliente
  area_direito?: string
  status: StatusCaso
  numero_processo?: string | null
  proximo_prazo?: string | null
  data_audiencia?: string | null
  total_documentos?: number
}

/** Caso completo (GET .../casos/{id}). Campos previdenciários/extra são tolerantes. */
export interface Caso extends CasoResumo {
  descricao?: string | null
  documentos?: CasoDocumento[]
  criado_em?: string
  atualizado_em?: string
  [k: string]: unknown
}

/** Confiança de um campo extraído pela IA no preview. */
export type Confianca = 'alta' | 'media' | 'baixa' | string

export interface CampoExtraido {
  valor: string
  confianca?: Confianca
}

/** Resposta de POST .../casos/preview-extracao. */
export interface PreviewExtracao {
  campos: Record<string, CampoExtraido>
  numero_processo_detectado?: string | null
  aviso?: string
}

/* ------------------------------------------------------------------ */
/* Peças por caso (escritório jurídico) — geração/edição/comentários   */
/* ------------------------------------------------------------------ */

/** Tipo de peça do catálogo (GET .../pecas-tipos). */
export interface PecaTipo {
  id: string
  nome: string
  descricao?: string
  /** Categoria para agrupar no <select> (Iniciais, Defesas, Recursos…). */
  categoria?: string
}

/** Item da lista leve de peças de um caso (GET .../casos/{id}/pecas — SEM conteudo). */
export interface PecaResumo {
  id: number
  caso_id: number
  tipo: string
  titulo: string
  versao: number
  status: string
  criado_em: string
  atualizado_em?: string
  tokens_entrada?: number
  tokens_saida?: number
  tem_comentarios_pendentes?: boolean
}

/** Status de um comentário de trecho da peça. */
export type StatusComentarioPeca = 'pendente' | 'aceito' | 'recusado' | 'obsoleto' | string

/** Comentário "Google Docs" sobre um trecho da peça (POST .../pecas/{id}/comentarios). */
export interface PecaComentario {
  id: number
  trecho: string
  instrucao: string
  proposta_atual?: string | null
  status: StatusComentarioPeca
  criado_em?: string
  [k: string]: unknown
}

/** Peça completa (GET .../pecas/{id} — com conteudo). Campos extras tolerantes. */
export interface Peca extends PecaResumo {
  conteudo?: string | null
  fontes_utilizadas?: unknown
  /** Alguns detalhes podem embutir os comentários da peça. */
  comentarios?: PecaComentario[]
  [k: string]: unknown
}

/** Uma versão anterior da peça (GET .../pecas/{id}/versoes). */
export interface PecaVersao {
  versao: number
  conteudo: string
  criado_em?: string | null
  origem?: string | null
}

/* ------------------------------------------------------------------ */
/* Fase 3 — Biblioteca "Doutrina & Modelos" (escopo org×office, juris)  */
/* ------------------------------------------------------------------ */

/** Tipo de item da biblioteca: template de peça ou doutrina (livro/obra). */
export type TipoBiblioteca = 'modelo' | 'doutrina'

/**
 * Item da biblioteca (GET .../biblioteca → lista LEVE, sem conteudo;
 * GET .../biblioteca/{id} e respostas de POST/PUT trazem `conteudo`).
 */
export interface BibliotecaItem {
  id: number
  tipo: TipoBiblioteca | string
  titulo: string
  descricao?: string | null
  tipo_peca?: string | null
  area_direito?: string | null
  tags?: string[]
  tamanho_chars?: number
  criado_em?: string
  atualizado_em?: string
  /** Só no detalhe/criação — a listagem não envia. */
  conteudo?: string
}

/* ------------------------------------------------------------------ */
/* Fase 4 — Playbook por área + Feedbacks dos advogados (juris)        */
/* ------------------------------------------------------------------ */

/**
 * O playbook de uma área — "a voz do escritório" que a IA usa em respostas
 * e peças. Campos EXATOS do JurisIA original (portaljurisia).
 */
export interface PlaybookJuris {
  /** Polo típico do escritório nesta área. */
  polo_padrao?: 'autor' | 'reu' | 'ambos' | string | null
  /** Teses que a IA vai PREFERIR. */
  teses_padrao?: string[]
  /** Argumentos subsidiários quando a tese padrão não couber. */
  fallbacks?: string[]
  /** Linhas vermelhas — argumentos que a IA vai recusar usar. */
  nunca_usar?: string[]
  /** Súmulas/teses para citar sempre que aplicável. */
  sumulas_favoritas?: string[]
  estilo_redacao?: string | null
  observacoes?: string | null
  [k: string]: unknown
}

/** Item de GET /predios/{o}/{s}/playbooks → playbooks[]. */
export interface PlaybookAreaItem {
  area_direito: string
  playbook: PlaybookJuris
  completo_em?: string | null
  atualizado_em?: string | null
}

export type NotaFeedback = 'positivo' | 'negativo'
export type OrigemFeedback = 'chat' | 'peca'

/** Conflito detectado (Haiku, best-effort) entre um 👎 e o playbook da área. */
export interface FeedbackConflito {
  descricao: string
  campo_playbook?: string | null
}

/** Feedback de um advogado sobre uma resposta do chat ou uma peça. */
export interface FeedbackJuris {
  id: number
  origem: OrigemFeedback | string
  referencia_id?: number | null
  conversa_id?: number | null
  area_direito?: string | null
  nota: NotaFeedback | string
  comentario?: string | null
  contexto_trecho?: string | null
  usuario_email?: string | null
  criado_em?: string | null
  [k: string]: unknown
}

/** Resposta de POST /predios/{o}/{s}/feedbacks (201). */
export interface FeedbackCriado {
  feedback: FeedbackJuris
  conflito: FeedbackConflito | null
  analise_conflito?: 'realizada' | 'nao_realizada'
}

/** Resposta de GET /predios/{o}/{s}/feedbacks/resumo (por_area tolerante). */
export interface FeedbacksResumo {
  total: number
  positivos: number
  negativos: number
  por_area?: Record<string, number | { total?: number; positivos?: number; negativos?: number }>
}

/* ------------------------------------------------------------------ */
/* Fase 2 — Monitor de processos                                       */
/* ------------------------------------------------------------------ */

export type PrioridadeProcesso = 'alta' | 'media' | 'baixa' | string

export interface Tribunal {
  slug: string
  nome: string
}

/** Movimento retornado no lookup DataJud. */
export interface MovimentoLookup {
  codigo?: string | number
  nome: string
  data?: string | null
}

export interface LookupProcesso {
  tribunal_inferido?: string | null
  encontrado: boolean
  movimentos?: MovimentoLookup[]
  /** Mensagem de erro do backend (rede/timeout/HTTP). Null = consulta ok. */
  erro?: string | null
}

/** Processo monitorado (GET .../monitor/processos). */
export interface MonitorProcesso {
  id: number
  numero_cnj: string
  tribunal?: string | null
  apelido?: string | null
  prioridade?: PrioridadeProcesso
  ativo?: boolean
  ultima_consulta_em?: string | null
  eventos_nao_lidos?: number
  caso_id?: number | null
}

export type ImportanciaEvento = 'critico' | 'importante' | 'normal' | string

/** Evento de um processo monitorado (GET .../monitor/eventos). */
export interface EventoProcesso {
  id: number
  monitor_id: number
  tipo?: string
  importancia?: ImportanciaEvento
  titulo: string
  descricao?: string | null
  data_evento?: string | null
  lido_em?: string | null
}

/* ------------------------------------------------------------------ */
/* Fase 5 — Notificações (WhatsApp BYO) e credenciais de tribunais      */
/* ------------------------------------------------------------------ */

/**
 * Fase B — status das chaves do Estúdio de mídia (BYO fal.ai/ElevenLabs/
 * HeyGen). SÓ booleans: cada segredo fica cifrado no servidor e nunca
 * volta, nem mascarado. true = chave configurada para aquele provedor.
 */
export interface MidiaKeysStatus {
  falai: boolean
  elevenlabs: boolean
}

/** GET/PUT /orgs/{id}/settings/notificacoes (owner/admin) — o access token
 *  é cifrado no backend e só volta mascarado, nunca por inteiro. */
export interface NotificacoesOrgSettings {
  gerenciado?: boolean
  whatsapp_phone_id: string | null
  whatsapp_token_mascarado: string | null
  whatsapp_enabled: boolean
  /** Fase B — status das chaves do Estúdio de mídia no MESMO GET de config
   *  (espelho do padrão WhatsApp). Opcional: backend antigo não manda. */
  midia?: MidiaKeysStatus
}

/** GET/PUT /usuarios/me/notificacoes (qualquer logado). Telefone em E.164
 *  (+5511999998888) — o backend responde 422 se o formato for inválido. */
export interface NotificacoesUsuario {
  whatsapp_telefone: string | null
  notif_email: boolean
  notif_whatsapp: boolean
}

export type TipoCredencialTribunal = 'certificado_a1' | 'login_senha'

/** Linha de GET /orgs/{id}/tribunais — nunca traz segredos (certificado,
 *  senhas e login ficam cifrados no servidor). */
export interface CredencialTribunal {
  tribunal: string
  tipo: TipoCredencialTribunal | string
  /** true = último teste passou; false = falhou; null/ausente = não testada. */
  valido?: boolean | null
  testado_em?: string | null
  criado_em?: string | null
}

/* ------------------------------------------------------------------ */
/* Fase 7 — dispositivos, LGPD, chaves MCP, storage S3 e calculadora    */
/* ------------------------------------------------------------------ */

/** Dispositivo logado do usuário (GET /usuarios/me/dispositivos). */
export interface Dispositivo {
  id: number
  nome: string | null
  criado_em: string | null
  ultimo_uso_em: string | null
  /** true = o dispositivo desta sessão (revogá-lo encerra a própria sessão). */
  atual: boolean
}

/** Linha de GET /orgs/{id}/mcp-keys — NUNCA traz a chave em claro. */
export interface McpKey {
  id: number
  key_prefix: string
  criado_em: string | null
  nome?: string | null
}

/** Resposta do POST /orgs/{id}/mcp-keys — a chave em claro (`key`) SÓ vem
 *  aqui, uma única vez; depois a listagem mostra apenas o key_prefix. */
export interface McpKeyCriada extends McpKey {
  key: string
}

/** Resposta de POST .../casos/{id}/pecas/preview-tokens — estimativa de
 *  tamanho/custo ANTES de gerar a peça. */
export interface PreviewTokensPeca {
  tokens_estimados: number
  tier: string
  custo_estimado_brl: number | null
  modo_execucao?: 'cli' | 'api'
  modalidade?: string
  modelo_solicitado?: string
}

/* ------------------------------------------------------------------ */
/* Fase 8 — Oficina de Código (office dev): loops editáveis            */
/* ------------------------------------------------------------------ */

/** Ids dos tipos de loop do catálogo (GET .../dev/loops/tipos). */
export type TipoLoopId = 'meta_verificada' | 'refinamento' | 'tdd' | 'caca_bug'

/** Um tipo de loop do catálogo da Oficina. */
export interface TipoLoop {
  id: TipoLoopId | string
  nome: string
  icone: string
  descricao: string
  exemplo: string
}

/** Resposta de GET .../loops/tipos. */
export interface TiposLoopResposta {
  tipos: TipoLoop[]
}

/** Critério de aceite do contrato — `comando: null` = revisão manual. */
export interface CriterioLoop {
  descricao: string
  comando: string | null
}

/**
 * O contrato do loop — a IA rascunha (POST .../loops/rascunho) e o usuário
 * edita TUDO antes de iniciar (POST .../loops). O loop obedece o contrato:
 * para ao passar em todos os critérios ou ao atingir `max_voltas`.
 */
export interface ContratoLoop {
  tipo: TipoLoopId | string
  objetivo: string
  criterios: CriterioLoop[]
  plano: string[]
  max_voltas: number
  repo_url: string | null
}

/** Resposta de POST .../loops/rascunho — a chave `aviso` sempre vem; null = sem aviso. */
export interface RascunhoLoopResposta {
  contrato: ContratoLoop
  aviso: string | null
}

export interface WsJobEvent {
  t: 'job_event'
  job_id: number
  org_id: number
  office_slug: string
  seq: number
  tipo: string
  payload: Record<string, unknown>
}

export interface WsNotificacao {
  t: 'notificacao'
  notificacao: Notificacao
}

export interface WsJobStatus {
  t: 'job_status'
  job_id: number
  status: JobStatus
  org_id: number
  office_slug: string
}

export type WsMessage = WsJobEvent | WsNotificacao | WsJobStatus | { t: string; [k: string]: unknown }
