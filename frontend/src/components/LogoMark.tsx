import { useId } from 'react'

/**
 * A MARCA DO OFFIZ — o "O" de andares.
 *
 * O que ela é: um O de tinta creme sobre o azul de trabalho, cortado por
 * duas fendas horizontais. As três faixas que sobram são os ANDARES do
 * prédio — que é o modelo do produto inteiro (um cliente, um prédio, um
 * andar por ofício) e o desenho do material que o app usa (papel empilhado).
 * Ela tem uma segunda leitura de propósito: a 20px lê como a letra O; no
 * tamanho grande, os andares aparecem.
 *
 * O que ela ERA, até 14/08/2026: uma "gem" de rede de nós — dois octógonos
 * concêntricos com dezesseis vértices e as facetas ligando todos. Um desenho
 * bonito e o clichê exato do setor: rede neural / grafo / constelação, a
 * mesma marca que todo produto de IA usa. Ficava no canto superior esquerdo
 * de toda página do produto que se diferencia justamente por NÃO parecer
 * uma ferramenta de IA — parecer um escritório que entrega peça pronta.
 *
 * As cores são fixas (independem do tema): a marca é a marca nos dois.
 * O quadrado arredondado permanece — é o que a chrome já espera na caixa.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const uid = useId()
  const azul = `${uid}-azul`
  const creme = `${uid}-creme`
  const recorte = `${uid}-recorte`

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <defs>
        <linearGradient id={azul} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a62d8" />
          <stop offset="1" stopColor="#24409a" />
        </linearGradient>
        <linearGradient id={creme} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffdf8" />
          <stop offset=".6" stopColor="#f4efe6" />
          <stop offset="1" stopColor="#e6dfd2" />
        </linearGradient>

        {/* O anel branco é o que aparece; os dois riscos pretos são as fendas
            entre os andares. Máscara, e não duas linhas azuis por cima: o
            fundo é gradiente, então uma linha de cor chapada nunca casaria
            com o azul exato daquela altura. Assim a fenda é buraco de
            verdade e mostra o próprio fundo. */}
        <mask id={recorte}>
          <rect width="100" height="100" fill="#000" />
          <circle cx="50" cy="50" r="22.5" fill="none" stroke="#fff" strokeWidth="15" />
          <rect x="18" y="40" width="64" height="4.6" fill="#000" />
          <rect x="18" y="55.4" width="64" height="4.6" fill="#000" />
        </mask>
      </defs>

      <rect
        x="3"
        y="3"
        width="94"
        height="94"
        rx="27"
        fill={`url(#${azul})`}
        stroke="rgba(244,239,230,.32)"
        strokeWidth="1"
      />
      <rect width="100" height="100" fill={`url(#${creme})`} mask={`url(#${recorte})`} />
    </svg>
  )
}
