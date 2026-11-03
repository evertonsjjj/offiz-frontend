type ArquivoCarrossel = { id: number; nome: string; editorial_peca_id?: number | null }

/** Somente a sequência declarada no contrato editorial. Fotografias avulsas,
 * versões diferentes e cards incompletos mantêm a navegação por arquivo. */
export function sequenciaCarrossel<T extends ArquivoCarrossel>(arquivos: T[]): T[] {
  const cards = arquivos.flatMap(arquivo => {
    const numero = arquivo.nome.match(/^card-(0[1-9]|1[0-9]|20)\.png$/i)?.[1]
    return numero ? [{ arquivo, numero: Number(numero) }] : []
  }).sort((a, b) => a.numero - b.numero)
  if (cards.length < 2 || new Set(cards.map(c => c.arquivo.editorial_peca_id ?? null)).size !== 1) return []
  if (cards.some((card, indice) => card.numero !== indice + 1)) return []
  return cards.map(c => c.arquivo)
}

/** Reordena apenas os lugares dos cards; legenda, HTML e outros arquivos
 * conservam suas posições. Sem uma sequência inequívoca, nada muda. */
export function ordenarArquivosCarrossel<T extends ArquivoCarrossel>(arquivos: T[]): T[] {
  const cards = sequenciaCarrossel(arquivos)
  if (!cards.length) return arquivos
  const ids = new Set(cards.map(card => card.id))
  let indice = 0
  return arquivos.map(arquivo => ids.has(arquivo.id) ? cards[indice++] : arquivo)
}

/** Mantém o post inicialmente escolhido, mas privilegia seus cards originais
 * quando a mesma peça tem uma sequência completa. Nunca mistura dois posts. */
export function primeiraImagemCarrossel<T extends ArquivoCarrossel>(arquivos: T[], referencia?: T): T | undefined {
  if (!referencia) return undefined
  return sequenciaCarrossel(arquivos.filter(a => (a.editorial_peca_id ?? null) === (referencia.editorial_peca_id ?? null)))[0]
}
