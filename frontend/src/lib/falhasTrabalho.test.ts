import { describe, expect, it } from 'vitest'
import { orientacaoFalha } from './falhasTrabalho'
import type { Traduzir } from './i18n'

const pt: Traduzir = (portugues) => portugues
const en: Traduzir = (_portugues, ingles) => ingles
const limite = 'O Offiz interrompeu esta chamada porque o saldo disponível do contrato não cobre a reserva necessária para continuar. Esta nova geração não foi iniciada; o consumo das etapas anteriores permanece registrado.'
const provedor = 'O serviço de IA recusou esta chamada com HTTP 429. Esta recusa veio do provedor, não do limite do contrato no Offiz.'

describe('causa confirmada do gateway na orientação de falha', () => {
  it('preserva a diferença entre reserva contratual e gasto anterior', () => {
    expect(orientacaoFalha(limite, pt)).toContain('contrato não cobre a reserva')
    expect(orientacaoFalha(limite, pt)).toContain('consumo das etapas anteriores permanece registrado')
    expect(orientacaoFalha(limite, pt)).not.toContain('conexão de IA atingiu')
    expect(orientacaoFalha(limite, en)).toContain('earlier usage remains recorded')
  })
  it('atribui ao provedor apenas a recusa comprovada', () => {
    expect(orientacaoFalha(provedor, pt)).toContain('veio do provedor, não do limite do contrato')
    expect(orientacaoFalha(provedor, en)).toContain('provider, not the Offiz contract limit')
  })
  it.each(['exceeded retry limit, last status: 429 Too Many Requests', 'Saldo indisponível', 'OpenAI429'])('não inventa origem para %s', erro => {
    expect(orientacaoFalha(erro, pt)).toContain('Confira o saldo e a disponibilidade')
    expect(orientacaoFalha(erro, pt)).not.toContain('veio do provedor')
    expect(orientacaoFalha(erro, en)).toContain('Check the balance and connection availability')
  })
})
