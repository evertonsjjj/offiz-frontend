/**
 * AS ABAS DA SHELL — a regra única de "qual menu este escritório tem".
 *
 * Morava dentro de ShellSimples.tsx; virou lib em 07/08/2026 porque o CRIADOR
 * precisa desenhar o preview "como o cliente vê" — e um preview que não usa
 * EXATAMENTE a mesma função da shell é um preview que mente. Um consumidor só
 * de cada lado: a shell monta o menu real, o criador monta o espelho.
 */

import type { AbaManifesto, OfficeInfo } from './types'
import type { Idioma } from './i18n'

export type AbaSimples =
  | 'inicio'
  | 'mesa'
  | 'conversa'
  | 'entregas'
  | 'estudio'
  | 'meses'
  | 'clientes'
  | 'pentest'
  | 'casos'
  | 'monitor'
  | 'biblioteca'
  | 'oficina'
  | 'agenda'
  | 'acervo'
  | 'conhecimento'
  | 'guia'

export type AbaDef = {
  id: AbaSimples
  /** Chave do set de ícones (ver components/Icone.tsx). Era EMOJI até
   *  14/08/2026; um manifesto ainda pode mandar emoji aqui, e o <Icone>
   *  devolve ele como texto — por isso o tipo continua `string`. */
  icone: string
  rotulo: string
  ajuda: string
  /** Só aparece quando o escritório precisa. */
  quando?: (office: OfficeInfo | null, slug: string) => boolean
}

/* AS ABAS SÃO DO ESCRITÓRIO, não do "modo".
 *
 * Existia um modo simples (2 abas) e um avançado (10) com uma chave para
 * alternar — e a chave era o problema. Agora há UMA shell: Visão geral,
 * Conversar e Entregas são o esqueleto de todo escritório; o resto aparece
 * quando o manifesto do prédio pede. Ninguém escolhe "modo". */
export const ABAS: AbaDef[] = [
  {
    // A MESA (26/08/2026): a tela de decisão do conteudo — conversa +
    // plano da peça + o portão "Pode gerar". O Estúdio segue como bastidor.
    id: 'mesa',
    icone: 'mesa',
    rotulo: 'Mesa',
    ajuda: 'Peça, veja o plano e libere a geração',
    quando: (_o, slug) => slug === 'conteudo',
  },
  { id: 'inicio', icone: 'painel', rotulo: 'Visão geral', ajuda: 'Os números e o que está rodando' },
  { id: 'conversa', icone: 'conversa', rotulo: 'Conversar', ajuda: 'Peça o que precisar, anexe arquivos' },
  { id: 'entregas', icone: 'entregas', rotulo: 'Entregas', ajuda: 'Veja, baixe e dê o seu OK' },
  {
    id: 'meses',
    icone: 'meses',
    rotulo: 'Meses',
    ajuda: 'Suba o material de cada mês',
    quando: (office) => !!office?.upload_mensal,
  },
  {
    // A CARTEIRA. Escritório que atende uma carteira (financeiro, assistentes,
    // conformidade) trabalha POR CLIENTE. Quem manda é o manifesto.
    id: 'clientes',
    icone: 'clientes',
    rotulo: 'Clientes',
    ajuda: 'A sua carteira: ficha, material e histórico de cada cliente',
    quando: (office) => !!office?.usa_clientes,
  },
  {
    // O trabalho do andar de conformidade é SOB DEMANDA e por cliente — esta
    // aba entra NO LUGAR da Agenda: mesma posição, o verbo certo.
    id: 'pentest',
    icone: 'seguranca',
    rotulo: 'Teste de segurança',
    ajuda: 'Termo, verificação e relatório — por cliente, só com autorização',
    quando: (_o, slug) => slug === 'lgpd',
  },
  { id: 'casos', icone: 'casos', rotulo: 'Casos', ajuda: 'Os processos que você acompanha',
    quando: (_o, slug) => slug === 'juris' },
  { id: 'monitor', icone: 'monitor', rotulo: 'Monitor', ajuda: 'Prazos e movimentações',
    quando: (_o, slug) => slug === 'juris' },
  { id: 'biblioteca', icone: 'biblioteca', rotulo: 'Doutrina & Modelos', ajuda: 'A sua biblioteca de peças',
    quando: (_o, slug) => slug === 'juris' },
  { id: 'oficina', icone: 'oficina', rotulo: 'Oficina', ajuda: 'Os loops de código',
    quando: (_o, slug) => slug === 'dev' },
  { id: 'agenda', icone: 'agenda', rotulo: 'Agenda', ajuda: 'O que o escritório faz sozinho, no dia marcado',
    quando: (_o, slug) => slug !== 'lgpd' },
]

/** Os padrões por id — a base sobre a qual o manifesto escolhe e renomeia. */
const PADROES: Map<string, AbaDef> = new Map(ABAS.map((a) => [a.id, a]))

/** As portas fora da lista do manifesto: o bastidor e o guia. */
export const ABA_ACERVO: AbaDef = {
  // O par honesto de "O que eu já sei" (16/08/2026): arquivo é DADO, regra é
  // APRENDIDA. Só aparece em escritório de marca (acervo_de_marca) — nos
  // outros, os documentos continuam no card de sempre do conhecimento.
  id: 'acervo',
  icone: 'arq-pasta',
  rotulo: 'Acervo',
  ajuda: 'O que você me deu: marca, produto, referências, aprovados e pessoas',
}
export const ABA_ESTUDIO: AbaDef = {
  // O Estúdio desceu para o BASTIDOR em 26/08/2026. Ele é a bancada da
  // produção — timeline, takes, cache, custo por cena. O diretor de marketing
  // decide na Mesa; quem abre o Estúdio é quem opera. Deixá-lo na fileira das
  // portas do escritório era exatamente a "tela cheia de coisa" criticada.
  id: 'estudio',
  icone: 'estudio',
  rotulo: 'Estúdio',
  ajuda: 'A bancada: timeline, takes e custo por cena',
}
export const ABA_CONHECIMENTO: AbaDef = {
  id: 'conhecimento',
  icone: 'conhecimento',
  rotulo: 'O que eu já sei',
  ajuda: 'As suas regras e o que eu aprendi',
}
export const ABA_GUIA: AbaDef = {
  id: 'guia',
  icone: 'guia',
  rotulo: 'Guia do escritório',
  ajuda: 'Como tudo funciona — e os 9 C’s',
}

const ABAS_INGLES: Record<AbaSimples, [string, string]> = {
  mesa: ['Desk', 'Make a request, review the plan, and approve production'],
  inicio: ['Overview', 'Your numbers and work in progress'],
  conversa: ['Chat', 'Ask for what you need and attach files'],
  entregas: ['Deliverables', 'Review, download, and approve'],
  meses: ['Months', 'Upload each month’s materials'],
  clientes: ['Clients', 'Client details, materials, and history'],
  pentest: ['Security assessment', 'Authorization, checks, and report for each client'],
  casos: ['Cases', 'The legal cases you follow'],
  monitor: ['Monitor', 'Deadlines and case updates'],
  biblioteca: ['References & templates', 'Your legal document library'],
  oficina: ['Workshop', 'Coding workflows'],
  agenda: ['Schedule', 'Work scheduled for a specific day'],
  acervo: ['Asset library', 'Your brand, products, references, approved materials, and people'],
  estudio: ['Studio', 'Timeline, takes, and cost per scene'],
  conhecimento: ['What I know', 'Your rules and what I have learned'],
  guia: ['Office guide', 'How everything works — and the 9 C’s'],
}
/** Custom names/help belong to the customer and are kept verbatim. */
export function localizarAba(aba: AbaDef, idioma: Idioma): AbaDef {
  if (idioma !== 'en') return aba
  const padrao = [...ABAS, ABA_ACERVO, ABA_ESTUDIO, ABA_CONHECIMENTO, ABA_GUIA].find((item) => item.id === aba.id)
  const traducao = ABAS_INGLES[aba.id]
  return { ...aba, rotulo: aba.rotulo === padrao?.rotulo ? traducao[0] : aba.rotulo, ajuda: aba.ajuda === padrao?.ajuda ? traducao[1] : aba.ajuda }
}

/** As abas que ESTE escritório mostra, de duas fontes possíveis.
 *
 * 1. `office.abas` — a lista DECLARADA no manifesto, na ordem em que ela vem.
 *    Cada item escolhe um painel que existe aqui (o manifesto escolhe QUAIS
 *    painéis e em que ordem — não inventa painel novo, porque do outro lado do
 *    id há um componente React de verdade) e pode trocar rótulo, ícone e
 *    ajuda: a clínica chama a aba "Clientes" de "Pacientes".
 * 2. Sem `abas` no manifesto: as regras de sempre (o `quando` de cada padrão).
 *    É o que mantém os escritórios existentes funcionando sem tocar neles —
 *    nenhum dos 8 declara `abas` hoje.
 *
 * Robustez de propósito: id desconhecido (manifesto de uma versão mais nova,
 * ou erro de digitação do criador) é IGNORADO em vez de quebrar a shell, e uma
 * lista que não sobrou nada cai no padrão — shell sem menu não é uma tela.
 */
export function abasDoEscritorio(office: OfficeInfo | null, slug: string): AbaDef[] {
  const porRegra = () => ABAS.filter((a) => !a.quando || a.quando(office, slug))
  const declaradas = office?.abas
  if (!Array.isArray(declaradas) || declaradas.length === 0) return porRegra()

  const vistas = new Set<string>()
  const escolhidas: AbaDef[] = []
  for (const item of declaradas) {
    const id = typeof item === 'string' ? item : item?.id
    const padrao = id ? PADROES.get(id) : undefined
    if (!padrao || vistas.has(padrao.id)) continue // desconhecida ou repetida
    vistas.add(padrao.id)
    const custom: Partial<AbaManifesto> = typeof item === 'string' ? {} : item
    escolhidas.push({
      ...padrao,
      rotulo: custom.rotulo?.trim() || padrao.rotulo,
      icone: custom.icone?.trim() || padrao.icone,
      ajuda: custom.ajuda?.trim() || padrao.ajuda,
      // Declarou, aparece: a regra do padrão (`quando`) era o jeito de
      // adivinhar quando não havia declaração. Agora há.
      quando: undefined,
    })
  }
  return escolhidas.length > 0 ? escolhidas : porRegra()
}
