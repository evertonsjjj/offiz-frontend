import { expect, it } from 'vitest'
import { ABA_ACERVO, localizarAba } from './abas'

it('traduz os rótulos padrão e mantém o nome e a ajuda que o cliente definiu', () => {
  expect(localizarAba(ABA_ACERVO, 'en')).toMatchObject({ rotulo: 'Asset library' })
  const propria = { ...ABA_ACERVO, rotulo: 'Fotos da equipe João', ajuda: 'Padrão da minha marca' }
  expect(localizarAba(propria, 'en')).toEqual(propria)
  expect(localizarAba(ABA_ACERVO, 'pt-BR')).toBe(ABA_ACERVO)
})
