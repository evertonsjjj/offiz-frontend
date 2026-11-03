import type { OfficeInfo } from './types'

/** Opções públicas filtradas por permissão. Ordenar cartões não altera os
 * IDs dos modelos originais nem o trabalho escolhido. */
export interface SolucaoInicio {
  id: string
  titulo: string
  descricao: string
  prompt: string
  andar: string
  entrega: string
  etapas: string[]
  insumos: string[]
  tipo: 'video' | 'apresentacao' | 'juridico' | 'conteudo' | 'diagnostico' | 'tarefa'
  motivo?: string
  prompt_pronto_id?: number
  rotulo_curado?: boolean
  origem?: 'catalogo' | 'aprendida'
  base_id?: string
  fixada?: boolean
  oculta?: boolean
  atualizada_em?: string
}

export interface PreferenciaSolucao {
  fixada?: boolean
  oculta?: boolean
}

export interface AndarInicio {
  slug: string
  nome: string
  descricao: string
  acervo_de_marca?: boolean
  area?: OfficeInfo['area']
  arquivado?: boolean
}

export interface InicioOrganizacao {
  contrato_gerenciado?: boolean
  org_id: number
  org_nome: string
  meu_papel: string
  org_status: string
  tem_chave: boolean
  motor_modo?: 'api' | 'cli'
  sem_saldo?: boolean
  andares: AndarInicio[]
  solucoes: SolucaoInicio[]
  outras_solucoes: SolucaoInicio[]
  solucoes_ocultas?: SolucaoInicio[]
  sabatina: {
    conduzida_pelo_offiz?: boolean
    perfil_preparado?: boolean
    estado: 'inicial' | 'em_andamento' | 'contextualizado'
    pergunta: string
    opcoes: Array<{ id: string; label: string; prompt: string }>
    permite_livre: boolean
  }
}
