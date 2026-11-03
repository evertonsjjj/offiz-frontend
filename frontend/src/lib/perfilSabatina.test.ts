import { expect, it } from 'vitest'
import { chaveSecaoPerfil, lerSecoesPerfil } from './perfilSabatina'

it('reconhece a seção existente quando o título contém comentário editorial', () => {
  const secoes = lerSecoesPerfil('## Público <!-- confirmado pelo consultor -->\nAdultos.')
  expect(secoes.size).toBe(1)
  expect(secoes.get(chaveSecaoPerfil('Público'))).toBe('Adultos.')
})

it('a comparação ignora exemplos de cabeçalhos em comentários e cercas e não esconde duplicatas', () => {
  const secoes = lerSecoesPerfil('<!--\n## Tom de voz\nInventado\n-->\n## Tom de voz\nFormal\n\n````md\n## Público\nExemplo\n```\n## Oculto\nExemplo\n````\n\n## TOM DE VOZ\nMais recente\n<!-- sem fechamento\n## Fantasma')
  expect(secoes.size).toBe(1)
  expect(secoes.get(chaveSecaoPerfil('tom de voz'))).toContain('Formal')
  expect(secoes.get(chaveSecaoPerfil('tom de voz'))).toContain('Mais recente')
  expect(secoes.get(chaveSecaoPerfil('tom de voz'))).not.toContain('Inventado')
  expect(chaveSecaoPerfil('  Tom  DE voz  ')).toBe('tom de voz')
})
