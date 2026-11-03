import { expect, it } from 'vitest'
import { detalhesDesfecho, lerDesfecho, temPendenciaDesfecho, textoDesfecho } from './desfechoConversa'

it('preserva decisão e limitação, retirando protocolo e arquivo duplicado do desfecho antigo', () => {
  const texto = 'PROGRESSO: 100% — pesquisa conferida.\n\nEntrega: `outputs/pautas/pautas.md`\n\nSeparei cinco pautas. Não confirmei uma tendência; aguardo sua escolha.\n\n📦 O que ficou para você na aba Entregas:\n• pautas.md\n\nDá uma olhada.'
  expect(textoDesfecho(texto, true)).toBe('Separei cinco pautas. Não confirmei uma tendência; aguardo sua escolha.')
  expect(textoDesfecho(texto, false)).toContain('• pautas.md')
})
it('mantém conteúdo normal e links das fontes', () => {
  const texto = 'Consultei [OMS](https://www.who.int/). A tarefa ainda requer sua revisão.\nPrefiro falar sobre meu progresso: 20%.'
  expect(textoDesfecho(texto, true)).toBe(texto)
})

it('resume desfecho legado pendente sem descartar os detalhes técnicos', () => {
  const texto = 'Pronto! Pendências: copy.txt ausente; laudos sem hash. PROGRESSO: 100%'
  const desfecho = lerDesfecho({ tipo: 'desfecho', status: 'done', job_id: 302,
    qualidade: 'pendente', pendencias: [{ nome: 'Post', detalhe: 'copy.txt ausente' }] })!
  expect(temPendenciaDesfecho(desfecho)).toBe(true)
  expect(textoDesfecho(texto, true, desfecho)).toContain('pontos a revisar')
  expect(textoDesfecho(texto, true, desfecho)).not.toMatch(/Pronto|copy.txt|hash/)
  expect(detalhesDesfecho(desfecho, texto)).toEqual(['Post: copy.txt ausente'])
})

it('recibo de correção não afirma que o job filho continua rodando', () => {
  const desfecho = lerDesfecho({ tipo: 'desfecho', status: 'done', qualidade: 'em_correcao', correcao_job_id: 303 })!
  expect(textoDesfecho('Estamos corrigindo', true, desfecho)).toContain('foi encaminhada no trabalho #303')
  expect(textoDesfecho('Estamos corrigindo', true, desfecho)).not.toMatch(/Estamos corrigindo|está rodando/)
  expect(textoDesfecho('We are fixing it', true, desfecho, true)).toContain('current status')
})

it('dados de desfecho não alteram mensagens normais nem inventam correção', () => {
  expect(lerDesfecho(null)).toBeNull()
  expect(lerDesfecho({ tipo: 'tarefa' })).toBeNull()
  const desfecho = lerDesfecho({ tipo: 'desfecho', status: 'done', qualidade: 'pendente' })!
  expect(textoDesfecho('Laudo incompleto', false, desfecho)).not.toContain('correção foi encaminhada')
  expect(detalhesDesfecho(desfecho, 'Laudo incompleto')).toEqual(['Laudo incompleto'])
})
