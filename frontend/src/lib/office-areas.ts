import type { Traduzir } from './i18n'
import type { AreaOffice, OfficeInfo } from './types'

export type AreaOfficeId = AreaOffice | 'outros'
export const AREAS_OFFICE: AreaOfficeId[] = ['marketing', 'financas', 'juridico', 'tecnologia', 'outros']

const modulos: Record<string, { area: AreaOffice; original: string; pt: string; en: string; resumo: [string, string] }> = {
  conteudo: { area: 'marketing', original: 'Conteúdo & Marca', pt: 'Produção de conteúdo', en: 'Content production', resumo: ['Posts, carrosséis, imagens, voz e vídeo.', 'Posts, carousels, images, voice and video.'] },
  midia: { area: 'marketing', original: 'Mídia & Performance', pt: 'Campanhas e resultados', en: 'Campaigns and results', resumo: ['Planejamento e análise dos dados enviados. Operação de anúncios manual.', 'Planning and analysis of uploaded data. Ads are operated manually.'] },
  'assistente-pf': { area: 'financas', original: 'Assistente Financeiro Pessoal', pt: 'Pessoal', en: 'Personal', resumo: ['Extratos, despesas, orçamento e fechamento do mês.', 'Statements, expenses, budgets and monthly closing.'] },
  'assistente-pme': { area: 'financas', original: 'Assistente Financeiro Empresarial', pt: 'Empresa', en: 'Business', resumo: ['Caixa, contas em aberto e resultado gerencial a partir dos arquivos enviados.', 'Cash flow, open balances and management results from uploaded files.'] },
  financeiro: { area: 'financas', original: 'Consultoria Financeira', pt: 'Planejamento', en: 'Planning', resumo: ['Projeções, dívidas, metas e relatórios financeiros.', 'Projections, debt, goals and financial reports.'] },
  juris: { area: 'juridico', original: 'JurisAI — Escritório Jurídico', pt: 'Jurídico', en: 'Legal', resumo: ['Casos, minutas e documentos para revisão profissional.', 'Cases, drafts and documents for professional review.'] },
  lgpd: { area: 'juridico', original: 'Conformidade LGPD', pt: 'Conformidade LGPD', en: 'LGPD compliance', resumo: ['Diagnóstico de privacidade, questionário e plano de adequação.', 'Privacy assessment, questionnaire and compliance plan.'] },
  outracoisa: { area: 'tecnologia', original: 'OUTRAI — Estúdio de Produto', pt: 'Design de produto', en: 'Product design', resumo: ['Pesquisa, definição, especificações e backlog.', 'Research, definition, specifications and backlog.'] },
  dev: { area: 'tecnologia', original: 'Oficina de Código', pt: 'Desenvolvimento', en: 'Development', resumo: ['Implementação de código com critérios de aceite e testes.', 'Code implementation with acceptance criteria and tests.'] },
}

export function areaDoOffice(office: Pick<OfficeInfo, 'slug' | 'area'>): AreaOfficeId {
  if (office.area === null) return 'outros'
  if (office.area && AREAS_OFFICE.includes(office.area)) return office.area
  return modulos[office.slug]?.area ?? 'outros'
}

export function agruparOffices<T extends Pick<OfficeInfo, 'slug' | 'area'>>(offices: T[]): { id: AreaOfficeId; offices: T[] }[] {
  return AREAS_OFFICE.map(id => ({ id, offices: offices.filter(o => areaDoOffice(o) === id) })).filter(g => g.offices.length > 0)
}

export function nomeArea(id: AreaOfficeId, t: Traduzir): string {
  return {
    marketing: t('Marketing & Conteúdo', 'Marketing & Content'),
    financas: t('Finanças', 'Finance'),
    juridico: t('Jurídico & Conformidade', 'Legal & Compliance'),
    tecnologia: t('Produto & Tecnologia', 'Product & Technology'),
    outros: t('Outros serviços', 'Other services'),
  }[id]
}

export function descricaoArea(id: AreaOfficeId, t: Traduzir): string {
  return {
    marketing: t('Produção, campanhas e análise de resultados.', 'Production, campaigns and performance analysis.'),
    financas: t('Pessoal, Empresa e Planejamento.', 'Personal, Business and Planning.'),
    juridico: t('Casos, documentos e privacidade.', 'Cases, documents and privacy.'),
    tecnologia: t('Da definição do produto ao desenvolvimento.', 'From product definition to development.'),
    outros: t('Serviços personalizados para cada cliente.', 'Services tailored to each client.'),
  }[id]
}

export function iconeArea(id: AreaOfficeId): string {
  return { marketing: '✍️', financas: '📊', juridico: '⚖️', tecnologia: '🛠️', outros: 'predio' }[id]
}

export function nomeModulo(office: Pick<OfficeInfo, 'slug' | 'nome'>, t: Traduzir): string {
  const modulo = modulos[office.slug]
  // Uma personalização do consultor nunca perde seu nome ao agrupar.
  if (modulo && (!office.nome || office.nome === modulo.original)) return t(modulo.pt, modulo.en)
  return office.nome || office.slug
}

export function resumoModulo(office: Pick<OfficeInfo, 'slug' | 'nome' | 'descricao'>, t: Traduzir): string {
  const modulo = modulos[office.slug]
  if (modulo && (!office.nome || office.nome === modulo.original)) return t(...modulo.resumo)
  return office.descricao || ''
}
