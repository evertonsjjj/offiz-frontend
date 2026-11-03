export interface DesfechoConversa {
  tipo: 'desfecho'
  status?: string
  job_id?: number
  qualidade?: string
  correcao_job_id?: number | null
  pendencias?: Array<{ nome?: string; detalhe?: string }>
}

/** O recibo descreve esta versão, não o estado atual de uma correção posterior. */
export function lerDesfecho(valor: unknown): DesfechoConversa | null {
  if (!valor || typeof valor !== 'object' || !('tipo' in valor) || valor.tipo !== 'desfecho') return null
  return valor as DesfechoConversa
}

export function temPendenciaDesfecho(desfecho: DesfechoConversa | null | undefined): boolean {
  return desfecho?.status === 'done' && (desfecho.qualidade === 'pendente'
    || desfecho.qualidade === 'em_correcao' || !!desfecho.pendencias?.length)
}

export function detalhesDesfecho(desfecho: DesfechoConversa, original: string): string[] {
  const pendencias = Array.isArray(desfecho.pendencias) ? desfecho.pendencias : []
  const detalhes = pendencias.flatMap(p => {
    if (!p || typeof p !== 'object') return []
    const nome = typeof p.nome === 'string' ? p.nome : ''
    const detalhe = typeof p.detalhe === 'string' ? p.detalhe : ''
    return nome || detalhe ? [[nome, detalhe].filter(Boolean).join(': ')] : []
  })
  return detalhes.length ? detalhes : [textoDesfecho(original, true)].filter(Boolean)
}

/** Limpa metadados e resume recibos pendentes; o original continua no histórico. */
export function textoDesfecho(texto: string, temCartao: boolean, desfecho?: DesfechoConversa | null, ingles = false): string {
  if (temPendenciaDesfecho(desfecho)) {
    if (desfecho?.qualidade === 'em_correcao' && desfecho.correcao_job_id) {
      return ingles
        ? `This version needs adjustments. A correction was assigned to task #${desfecho.correcao_job_id}; check that task for its current status.`
        : `A conferência desta versão identificou ajustes. Uma correção foi encaminhada no trabalho #${desfecho.correcao_job_id}; consulte nele o andamento atual.`
    }
    return ingles
      ? 'This version was completed with points to review. Its files are available for evaluation.'
      : 'Esta versão foi concluída com pontos a revisar. Os arquivos estão disponíveis para avaliação.'
  }
  let limpo = texto
    .replace(/^\s*(?:[#*]+\s*)?PROGRESSO:\s*\d{1,3}\s*%[^\n]*\n?/gmi, '')
    .replace(/^\s*(?:Entrega|Arquivo)(?:s| final)?:\s*`?(?:outputs\/|\/data\/storage\/)[^\n]*\n?/gmi, '')
    .replace(/\[([^\]]+)\]\(<?(?:outputs\/|\/data\/storage\/)[^)>]*>?\)/g, '$1')
  if (temCartao) limpo = limpo.split('\n\n📦 O que ficou para você na aba Entregas:')[0]
  return limpo.replace(/\n{3,}/g, '\n\n').trim()
}
