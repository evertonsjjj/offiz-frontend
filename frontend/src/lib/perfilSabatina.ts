/** Leitura conservadora de seções: não infere fatos nem interpreta exemplos
 * do modelo como respostas. A escrita e a resolução de conflitos são do servidor. */
export type TextosPreparacao = { textos: readonly string[] }
export type PreparacaoDaArea = TextosPreparacao & { orgId: number; slug: string; sessao: string | null }
export type PreparacaoNaConversa = PreparacaoDaArea & {
  origem: 'preparacao'
  destino: { slug: string; conversaId: number | null }
}

/** Texto ainda não guardado: só atravessa para a conversa que recebeu a escolha. */
export function preparacaoNoDestino(dados: PreparacaoNaConversa, destino: {
  orgId: number; slug: string; nivelPredio: boolean; sessao: string | null; conversaId: number | null
}): boolean {
  return dados.origem === 'preparacao' && !!dados.sessao && dados.sessao === destino.sessao
    && dados.orgId === destino.orgId && !!dados.slug
    && (destino.nivelPredio || dados.slug === destino.slug)
    && dados.destino.slug === (destino.nivelPredio ? 'predio' : destino.slug)
    && dados.destino.conversaId === destino.conversaId
    && Array.isArray(dados.textos) && dados.textos.length > 0
    && dados.textos.every(texto => typeof texto === 'string' && !!texto.trim())
}

export function chaveSecaoPerfil(titulo: string): string {
  return titulo.trim().normalize('NFKC').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')
}

export function lerSecoesPerfil(canon: string): Map<string, string> {
  const secoes = new Map<string, string>()
  let titulo: string | null = null
  let linhas: string[] = []
  function guardar() {
    if (!titulo) return
    const chave = chaveSecaoPerfil(titulo)
    const texto = linhas.join('\n').replace(/<!--[^]*?-->/g, '').trim()
    secoes.set(chave, [secoes.get(chave), texto].filter(Boolean).join('\n\n'))
  }
  let cerca: string | null = null
  for (const linha of canon.replace(/<!--[^]*?(?:-->|$)/g, '').split(/\r?\n/)) {
    const fence = linha.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (!cerca) cerca = fence[1]
      else if (fence[1][0] === cerca[0] && fence[1].length >= cerca.length) cerca = null
      linhas.push(linha)
      continue
    }
    const cabecalho = !cerca && linha.match(/^##\s+(.+?)\s*$/)
    if (cabecalho) { guardar(); titulo = cabecalho[1]; linhas = [] }
    else linhas.push(linha)
  }
  guardar()
  return secoes
}
