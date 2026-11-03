import type { CSSProperties } from 'react'
import type { TemaOffice } from './types'

/** Identidade visual POR PRÉDIO (white-label).
 *
 * Histórico: na Fase 1 do redesign a paleta foi FECHADA e esta função virou
 * no-op — todo prédio herdava o azul/creme do Offiz. O motivo era real: o
 * acento vira fundo sólido de `.botao-primario` com texto branco, e um hue
 * claro de cliente (um cinza-prata, um amarelo) deixava o botão ilegível.
 *
 * Reaberta a pedido do dono (08/08/2026) porque o produto é vendido POR
 * CLIENTE: o prédio do Empresa Exemplo tem que parecer do Empresa Exemplo, o do Clube Aurora do
 * Clube Aurora. O que mudou para não voltar ao problema: a TINTA sobre o acento
 * agora é calculada por contraste (branco ou quase-preto, o que for legível),
 * então a cor do cliente entra como ela é — sem clarear nem escurecer a marca
 * dele — e o texto se adapta.
 *
 * Escopo: só as variáveis `--predio-*` (o miolo do prédio). A moldura do Offiz
 * — topbar, fundo da página, navegação — segue nos tokens globais: é o produto
 * do Offiz, não do cliente.
 */

const HEX = /^#[0-9a-fA-F]{6}$/

/** Luminância relativa (WCAG 2.x) de um #rrggbb. */
function luminancia(hex: string): number {
  const canal = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2)
}

/** Razão de contraste WCAG entre duas luminâncias. */
function contraste(a: number, b: number): number {
  const [claro, escuro] = a > b ? [a, b] : [b, a]
  return (claro + 0.05) / (escuro + 0.05)
}

const TINTA_CLARA = '#ffffff'
// Quase-preto da paleta (--text-0), não #000: preto puro sobre cor de marca
// vibra e cansa a leitura.
const TINTA_ESCURA = '#2b2431'

/** A tinta legível sobre `fundoHex` — a de MAIOR contraste entre as duas. */
function tintaSobre(fundoHex: string): string {
  const lFundo = luminancia(fundoHex)
  const comClara = contraste(lFundo, luminancia(TINTA_CLARA))
  const comEscura = contraste(lFundo, luminancia(TINTA_ESCURA))
  return comClara >= comEscura ? TINTA_CLARA : TINTA_ESCURA
}

export function temaParaEstilo(tema: TemaOffice | undefined | null): CSSProperties {
  if (!tema) return {}
  const estilo: Record<string, string> = {}

  // Só hex #rrggbb entra (o backend já valida no PUT; aqui é a segunda porta,
  // porque o tema também vem do office.json do catálogo).
  const primaria = typeof tema.cor_primaria === 'string' && HEX.test(tema.cor_primaria)
    ? tema.cor_primaria
    : null
  const acento = typeof tema.cor_acento === 'string' && HEX.test(tema.cor_acento)
    ? tema.cor_acento
    : null
  const fundo = typeof tema.cor_fundo === 'string' && HEX.test(tema.cor_fundo)
    ? tema.cor_fundo
    : null

  if (fundo) estilo['--predio-fundo'] = fundo

  /* QUEM PINTA A AÇÃO É A PRIMÁRIA, não o acento (15/08/2026).
   *
   * A regra 60-30-10 do provisionamento diz que o acento é o que "pontua" —
   * verdade num cliente cujo acento é vibrante (a menta do Empresa Exemplo), falsa numa
   * marca BICOLOR. No Clube Aurora o acento é o cinza-prata das linhas (#9a9a9a):
   * botão prateado num prédio cuja marca é o preto, e — pior — o prata sobre o
   * papel creme dá ~2,8:1, abaixo dos 3:1 que a WCAG exige de componente de
   * interface. O foco do teclado (app.css) sai justamente dessa variável.
   *
   * Então a primária é a cor de identidade, e o acento aponta para ela: os ~43
   * blocos de app.css que já consomem `--predio-acento` obedecem sem serem
   * tocados. Cliente que declara SÓ o acento continua funcionando — ele vira a
   * primária (marca de uma cor só, como antes). */
  const identidade = primaria || acento
  if (identidade) {
    estilo['--predio-primaria'] = identidade
    estilo['--predio-acento'] = identidade
    /* A tinta legível sobre a cor do cliente. Vive em `--predio-ink` e NÃO em
     * `--accent-ink`: este último é token GLOBAL do Offiz, consumido sobre
     * fundos `--accent` azuis que o tema do prédio não muda (o avatar da conta,
     * o selo de não-lidos do monitor, a aba ativa do painel). Sobrescrevê-lo
     * jogava a tinta do cliente nesses três — no Clube Aurora, ameixa sobre azul,
     * 2,3:1. Um token para a cor do cliente, outro para a do produto. */
    estilo['--predio-ink'] = tintaSobre(identidade)
  }
  return estilo as CSSProperties
}
