/* =============================================================
   A LÍNGUA DO LOG AO VIVO.

   Quem lê o log enquanto o escritório trabalha é o CLIENTE, não um
   dev: nada de comando bash cru, nada de caminho absoluto do servidor,
   nada de nome de ferramenta em inglês. Estas três funções são o
   tradutor, e são compartilhadas pela placa de execução (a linha única
   sobre o escritório) e pelo diário completo (JobStream) — para as
   duas telas falarem a mesma língua.

   De onde veio: este arquivo era `office-state.ts`, 624 linhas, e
   quase tudo nele era o REDUCER que dirigia o prédio isométrico e o
   diorama 3D — quem estava em qual andar, quem acendia, a delegação
   encenada por semelhança de tokens. Aquele desenho saiu em jul/2026
   ("andares e agentes viram etapa e autoria, não arte") e o reducer
   ficou. Sobrou o que nunca foi cenografia: traduzir o que a máquina
   fez para uma frase de gente.

   `resumoTool` devolve ÍCONE + TEXTO, e não uma frase com emoji dentro
   ("📄 lendo canon.md"), porque o emoji embutido não podia herdar a
   cor da linha nem virar traço junto com o resto do app.
   ============================================================= */

import type { NomeIcone } from '../components/Icone'
import type { Idioma } from '../lib/i18n'

/** Uma linha de log já traduzida: o sinal e a frase, separados.
 *  `icone` é opcional porque prosa do agente (o que ele está *dizendo*, não
 *  fazendo) entra crua — ali um ícone seria enfeite, não informação. */
export interface LinhaLog {
  icone?: NomeIcone
  texto: string
}

/** Última frase de um texto (para o balão): quebra em . ! ? ou nova linha. */
export function ultimaFrase(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  if (!limpo) return ''
  const partes = limpo.split(/(?<=[.!?…])\s+|\n+/).map((p) => p.trim()).filter(Boolean)
  const frase = partes.length ? partes[partes.length - 1] : limpo
  return frase.length > 120 ? frase.slice(0, 117) + '…' : frase
}

/** Prefixo do workspace (Linux do worker ou Windows do desktop) → some. */
const RE_PREFIXO_WORKSPACE =
  /(?:\/data\/storage\/orgs\/\d+\/offices\/[^/]+\/workspace\/|[A-Z]:\\[^ ]*workspace\\)/g

/** Remove o prefixo do workspace de caminhos citados no texto (vira relativo). */
export function semPrefixoWorkspace(texto: string): string {
  return texto.replace(RE_PREFIXO_WORKSPACE, '')
}

/** Só o nome do arquivo (última parte do caminho) — para o rótulo compacto. */
function nomeArquivo(caminho: string): string {
  const rel = semPrefixoWorkspace(caminho).trim()
  const partes = rel.split(/[\\/]/).filter(Boolean)
  return partes.length ? partes[partes.length - 1] : rel
}

function truncarResumo(texto: string, max = 80): string {
  const t = texto.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** O genérico honesto: usado quando a ferramenta não diz nada ao cliente. */
const FERRAMENTAS: LinhaLog = { icone: 'config', texto: 'usando as ferramentas do escritório' }

/** Rótulo compacto e de leigo para um tool_use. */
export function resumoTool(ferramenta: string, resumo: string, idioma: Idioma = 'pt-BR'): LinhaLog {
  const tr = (pt: string, en: string) => idioma === 'en' ? en : pt
  const ferramentas = idioma === 'en' ? { ...FERRAMENTAS, texto: 'using office tools' } : FERRAMENTAS
  const f = ferramenta.toLowerCase()
  const r = resumo.toLowerCase()
  // burocracia interna do agente (TaskCreate/TaskUpdate/TodoWrite…): sem detalhe.
  if (/task(create|update|list|view|get|status)/.test(f) || f.includes('todo')) {
    return { icone: 'setup', texto: tr('organizando o plano de trabalho', 'organizing the work plan') }
  }
  if (f.includes('task') || f.includes('agent')) {
    const t = resumo.trim()
    // resumo vazio ou só um número (id interno) não diz nada pro cliente.
    if (!t || /^\d+$/.test(t)) return { icone: 'pessoa', texto: tr('acionando especialista', 'calling a specialist') }
    return { icone: 'pessoa', texto: tr(`acionando especialista: ${truncarResumo(t)}`, `calling a specialist: ${truncarResumo(t)}`) }
  }
  if (f.includes('bash') || f.includes('shell') || f.includes('exec') || f.includes('command')) {
    // NUNCA o comando cru — só o que ele significa para o cliente.
    if (r.includes('financas.py')) return { icone: 'calculadora', texto: tr('calculando com financas.py', 'calculating with financas.py') }
    if (r.includes('gerar_pdf')) return { icone: 'impressora', texto: tr('gerando o PDF', 'generating the PDF') }
    if (r.includes('gerar_pptx')) return { icone: 'arq-slides', texto: tr('montando a apresentação', 'building the presentation') }
    if (r.includes('chromium') || r.includes('screenshot')) {
      return { icone: 'impressora', texto: tr('preparando a impressão', 'preparing for printing') }
    }
    return ferramentas
  }
  if (f.includes('write') || f.includes('edit')) {
    return resumo
      ? { icone: 'lapis', texto: tr(`escrevendo ${nomeArquivo(resumo)}`, `writing ${nomeArquivo(resumo)}`) }
      : { icone: 'lapis', texto: tr('escrevendo um arquivo', 'writing a file') }
  }
  if (f.includes('read')) {
    return resumo
      ? { icone: 'arq-documento', texto: tr(`lendo ${nomeArquivo(resumo)}`, `reading ${nomeArquivo(resumo)}`) }
      : { icone: 'arq-documento', texto: tr('lendo um arquivo', 'reading a file') }
  }
  if (f.includes('fetch') || f.includes('web') || f.includes('search')) {
    return { icone: 'arq-web', texto: tr('pesquisando na internet', 'searching the web') }
  }
  if (f.includes('grep') || f.includes('glob')) {
    return { icone: 'lupa', texto: tr('procurando nos arquivos', 'searching files') }
  }
  return ferramentas
}
