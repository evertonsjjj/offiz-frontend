import type { ConversaMensagem } from './types'

type EstadoProposta = 'dispensada' | 'iniciada'
function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : null
}
const texto = (valor: unknown): valor is string => typeof valor === 'string' && !!valor.trim()
const id = (valor: unknown) => typeof valor === 'number' && Number.isSafeInteger(valor) && valor > 0
const temAcao = (valor: Record<string, unknown>) => 'prompt' in valor || 'etapas' in valor || 'tipo' in valor

function canonAuxiliar(valor: Record<string, unknown>): boolean {
  return valor.tipo === 'canon' && !('prompt' in valor) && !('etapas' in valor)
    && texto(valor.resumo) && Array.isArray(valor.secoes) && valor.secoes.length > 0
    && valor.secoes.every(secao => {
      const s = objeto(secao)
      return !!s && texto(s.secao) && texto(s.conteudo)
    })
}

function desfechoTecnico(valor: Record<string, unknown>): boolean {
  return valor.tipo === 'desfecho' && !('prompt' in valor) && !('etapas' in valor)
    && id(valor.job_id) && (valor.status === 'done' || valor.status === 'failed') && texto(valor.titulo)
    && typeof valor.qualidade === 'string' && ['sem_entrega', 'em_correcao', 'pendente', 'aguardando_aprovacao'].includes(valor.qualidade)
    && (valor.correcao_job_id === null || id(valor.correcao_job_id))
    && Array.isArray(valor.pendencias) && valor.pendencias.every(p => {
      const detalhe = objeto(p)
      return !!detalhe && texto(detalhe.nome) && texto(detalhe.detalhe)
    })
    && Array.isArray(valor.entregas) && valor.entregas.every(e => {
      const entrega = objeto(e)
      return !!entrega && id(entrega.id) && texto(entrega.nome) && texto(entrega.tipo)
    })
}

/** Uma resposta humana ou uma resposta comum encerra a pergunta anterior.
 * Cartões auxiliares não a apagam; um desfecho nunca reabre decisão de ação. */
export function perguntaPendente(
  mensagens: readonly ConversaMensagem[] = [],
  iniciadas: readonly number[] = [],
  estados: Readonly<Record<number, EstadoProposta>> = {},
): number | null {
  let houveDesfecho = false
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const mensagem = mensagens[i]
    if (mensagem.role !== 'assistant') return null
    const proposta = objeto(mensagem.sugestao_tarefa)
    if (!proposta) return null
    if ('perguntas' in proposta) {
      if (!Array.isArray(proposta.perguntas) || !proposta.perguntas.length || !proposta.perguntas.every(texto)) return null
      if (estados[mensagem.id] || iniciadas.includes(mensagem.id)) return null
      return houveDesfecho && temAcao(proposta) ? null : mensagem.id
    }
    if (canonAuxiliar(proposta)) continue
    if (desfechoTecnico(proposta)) { houveDesfecho = true; continue }
    return null
  }
  return null
}
