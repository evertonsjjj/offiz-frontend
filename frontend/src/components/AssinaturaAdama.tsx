/**
 * Assinatura de marca "by adamá" — a Adamá é a empresa parceira que apresenta
 * o Offiz. Usada no rodapé/cabeçalho da landing, no login e no app.
 * Lei da marca: o wordmark é "adamá" todo MINÚSCULO e o acento do "á" é a
 * CUNHA (trapézio retângulo sólido — o gesto atômico), nunca um acento comum.
 * Renderizamos "adam" + um "a" com a cunha por cima (o ´ não aparece como
 * glifo de fonte). Interim até o asset SVG oficial do wordmark.
 */
export function AssinaturaAdama({ className = '' }: { className?: string }) {
  return (
    <span className={`assinatura-adama ${className}`.trim()}>
      <span className="aa-por">by</span>
      <span className="aa-nome" aria-label="adamá">
        <span aria-hidden="true">adam</span>
        <span className="aa-a-final" aria-hidden="true">
          a<i className="aa-cunha" />
        </span>
      </span>
    </span>
  )
}
