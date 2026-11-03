import type { NomeIcone } from '../components/Icone'

export type LocaleInterface = 'pt-BR' | 'en'

export function formatBRL(valor: number | undefined | null, locale: LocaleInterface = 'pt-BR'): string {
  const v = typeof valor === 'number' && isFinite(valor) ? valor : 0
  return v.toLocaleString(locale, { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatTokens(n: number | undefined | null, locale: LocaleInterface = 'pt-BR'): string {
  const v = typeof n === 'number' && isFinite(n) ? n : 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`
  if (v >= 1_000) return `${(v / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })}k`
  return v.toLocaleString(locale)
}

export function formatBytes(bytes: number | undefined | null, locale: LocaleInterface = 'pt-BR'): string {
  const v = typeof bytes === 'number' && isFinite(bytes) ? bytes : 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`
  return `${(v / (1024 * 1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 2 })} GB`
}

export function toDate(iso: string | undefined | null): Date | null {
  if (!iso) return null
  // Timestamps do backend são UTC; alguns vêm sem sufixo de timezone.
  const withTz = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`
  const d = new Date(withTz)
  return isNaN(d.getTime()) ? null : d
}

export function formatDataHora(iso: string | undefined | null, locale: LocaleInterface = 'pt-BR'): string {
  const d = toDate(iso)
  if (!d) return '—'
  return d.toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Formata um campo date-only (prazo, audiência, data_entrada) SEM conversão de
 * fuso. O backend serializa datas puras como `YYYY-MM-DD` (isoformat de `date`);
 * tratá-las como datetime UTC exibia o dia anterior em fusos negativos (BRT).
 * Aqui interpretamos `YYYY-MM-DD` como data local. Se vier com hora (datetime),
 * cai no formatador padrão de data (data local, sem a hora).
 */
export function formatData(iso: string | undefined | null, locale: LocaleInterface = 'pt-BR'): string {
  if (!iso) return '—'
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (soData) {
    const [, ano, mes, dia] = soData
    // Constrói a data no fuso local (mês é 0-indexado) — sem UTC.
    const d = new Date(Number(ano), Number(mes) - 1, Number(dia))
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  // Tem hora → é datetime UTC; mostra só a data local.
  const d = toDate(iso)
  if (!d) return '—'
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function tempoRelativo(iso: string | undefined | null, locale: LocaleInterface = 'pt-BR'): string {
  const d = toDate(iso)
  if (!d) return '—'
  const diff = Date.now() - d.getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return locale === 'en' ? 'just now' : 'agora mesmo'
  const m = Math.floor(s / 60)
  if (m < 60) return locale === 'en' ? `${m} min ago` : `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return locale === 'en' ? `${h} hour${h === 1 ? '' : 's'} ago` : h === 1 ? 'há 1 hora' : `há ${h} horas`
  const dias = Math.floor(h / 24)
  if (dias < 30) return locale === 'en' ? dias === 1 ? 'yesterday' : `${dias} days ago` : dias === 1 ? 'ontem' : `há ${dias} dias`
  return formatDataHora(iso, locale)
}

/** Milissegundos decorridos desde um timestamp ISO (UTC); null se inválido. */
export function msDesde(iso: string | undefined | null): number | null {
  const d = toDate(iso)
  return d ? Math.max(0, Date.now() - d.getTime()) : null
}

export function formatDuracao(ms: number | undefined | null, locale: LocaleInterface = 'pt-BR'): string {
  const v = typeof ms === 'number' && isFinite(ms) ? ms : 0
  if (v < 1000) return `${Math.round(v)} ms`
  const s = v / 1000
  if (s < 60) return `${s.toLocaleString(locale, { maximumFractionDigits: 1 })} s`
  const segundos = Math.round(s)
  const min = Math.floor(segundos / 60)
  const resto = segundos % 60
  return `${min}min ${resto}s`
}

export const STATUS_JOB_LABEL: Record<string, string> = {
  queued: 'Na fila',
  running: 'Executando',
  done: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
}

export const EFFORT_LABEL: Record<string, string> = {
  high: 'Alto',
  xhigh: 'Extra',
  max: 'Ultra',
}

export const STATUS_ENTREGA_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  aprovada: 'Aprovada',
  rejeitada: 'Rejeitada',
}

/* ---------- Fase 3: Painéis ---------- */

/**
 * Rótulo pt-BR do tipo de entrega inferido pelo backend (galeria).
 * Os tipos gerados por `services/storage.inferir_tipo_entrega` são:
 * video · imagem · dashboard · documento · planilha · pdf · arquivo (desconhecido).
 * `outro` fica como fallback do deriver local por nome no PainelGaleria.
 */
export const TIPO_ENTREGA_LABEL: Record<string, string> = {
  video: 'Vídeos',
  imagem: 'Imagens',
  dashboard: 'Dashboards',
  documento: 'Documentos',
  planilha: 'Planilhas',
  pdf: 'PDFs',
  arquivo: 'Arquivos',
  outro: 'Outros',
}

/** Ícone do tipo de entrega inferido (galeria) — CHAVE do set de traço
 *  (components/Icone.tsx), não emoji: o ponto de render usa `<Icone nome={…} />`. */
export const TIPO_ENTREGA_ICONE: Record<string, NomeIcone> = {
  video: 'arq-video',
  imagem: 'arq-imagem',
  dashboard: 'arq-web',
  documento: 'arq-documento',
  planilha: 'arq-planilha',
  pdf: 'arq-pdf',
  arquivo: 'arq-pasta',
  outro: 'arq-pasta',
}

/* ---------- Fase 2: Casos ---------- */

/**
 * Rótulos dos status de caso — chaves EXATAS de `StatusCaso` no backend
 * (webapp/backend/app/models/caso.py).
 */
export const STATUS_CASO_LABEL: Record<string, string> = {
  ativo: 'Ativo',
  em_analise: 'Em análise',
  aguardando_documentos: 'Aguardando documentos',
  aguardando_pericia: 'Aguardando perícia',
  protocolado: 'Protocolado',
  em_andamento: 'Em andamento',
  aprovado: 'Aprovado',
  negado: 'Negado',
  recurso: 'Recurso',
  concluido: 'Concluído',
  arquivado: 'Arquivado',
}

/** Classe de cor para o status-pill do caso (reaproveita a paleta de jobs). */
export const STATUS_CASO_CLASSE: Record<string, string> = {
  ativo: 'status-running',
  em_analise: 'status-queued',
  aguardando_documentos: 'status-queued',
  aguardando_pericia: 'status-queued',
  protocolado: 'status-running',
  em_andamento: 'status-running',
  aprovado: 'status-done',
  negado: 'status-cancelled',
  recurso: 'status-running',
  concluido: 'status-done',
  arquivado: 'status-cancelled',
}

/**
 * Rótulos das áreas do direito — chaves EXATAS de `AreaDireito` no backend.
 */
export const AREA_DIREITO_LABEL: Record<string, string> = {
  previdenciario: 'Previdenciário',
  trabalhista: 'Trabalhista',
  civil: 'Cível',
  consumidor: 'Consumidor',
  familia: 'Família',
  tributario: 'Tributário',
  penal: 'Penal',
  empresarial: 'Empresarial',
  administrativo: 'Administrativo',
  imobiliario: 'Imobiliário',
}

/** tipo_cliente é PF/PJ (maiúsculo) no backend. */
export const TIPO_CLIENTE_LABEL: Record<string, string> = {
  PF: 'Pessoa física',
  PJ: 'Pessoa jurídica',
}

/** polo_cliente é autor/reu no backend. */
export const POLO_CLIENTE_LABEL: Record<string, string> = {
  autor: 'Autor',
  reu: 'Réu',
}

export const CONFIANCA_LABEL: Record<string, string> = {
  alta: 'Confiança alta',
  media: 'Confiança média',
  baixa: 'Confiança baixa',
}

/* ---------- Fase 2: Monitor ---------- */

export const PRIORIDADE_LABEL: Record<string, string> = {
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
}

/** Classe de cor da prioridade (vermelho/âmbar/cinza). */
export const PRIORIDADE_CLASSE: Record<string, string> = {
  alta: 'prioridade-alta',
  media: 'prioridade-media',
  baixa: 'prioridade-baixa',
}

export const IMPORTANCIA_LABEL: Record<string, string> = {
  critico: 'Crítico',
  importante: 'Importante',
  normal: 'Normal',
}

/** Formata um número CNJ (20 dígitos) na máscara NNNNNNN-DD.AAAA.J.TR.OOOO. */
export function formatCNJ(cnj: string | undefined | null): string {
  if (!cnj) return '—'
  const d = cnj.replace(/\D/g, '')
  if (d.length !== 20) return cnj
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`
}

/** Os mapas legados continuam em pt-BR; estes leitores traduzem só o rótulo. */
export function statusEntregaLabel(status: string, locale: LocaleInterface = 'pt-BR'): string {
  return (locale === 'en' ? { pendente: 'Pending', aprovada: 'Approved', rejeitada: 'Rejected' } : STATUS_ENTREGA_LABEL)[status] ?? status
}
export function statusJobLabel(status: string, locale: LocaleInterface = 'pt-BR'): string {
  return (locale === 'en' ? { queued: 'Queued', running: 'Running', done: 'Completed', failed: 'Failed', cancelled: 'Cancelled' } : STATUS_JOB_LABEL)[status] ?? status
}
export function tipoEntregaLabel(tipo: string, locale: LocaleInterface = 'pt-BR'): string {
  return (locale === 'en' ? { video: 'Videos', imagem: 'Images', dashboard: 'Dashboards', documento: 'Documents', planilha: 'Spreadsheets', pdf: 'PDFs', arquivo: 'Files', outro: 'Other' } : TIPO_ENTREGA_LABEL)[tipo] ?? tipo
}
