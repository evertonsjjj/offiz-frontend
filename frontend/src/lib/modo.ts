/* ------------------------------------------------------------------
   Modo da interface: SIMPLES (duas abas + "O que eu já sei") x COMPLETA.

   Regra única, para não existirem dois lugares decidindo isto:

     efetivo = usuário pediu avançado ? completa : (org é modo_simples ? simples : completa)

   A preferência mora no USUÁRIO (usuarios.modo_avancado) porque dono e
   operador convivem na mesma organização — e porque a coluna da org é
   território do seed, reescrita a cada deploy.

   Use por ROTA, não só por componente: sem isso, um link vindo de fora
   (a notificação do sino, por exemplo) leva o dono para a shell de
   operador com todas as abas.
   ------------------------------------------------------------------ */

import type { Predio, Usuario } from './types'

/** SEMPRE a shell única. Existia um "modo avançado" por usuário que trocava a
 *  interface inteira por uma de operador — dois produtos para a mesma pessoa
 *  aprender. Ele saiu: agora o que muda de escritório para escritório são as
 *  ABAS, e quem decide é o manifesto do prédio (ver ABAS em ShellSimples).
 *
 *  A função continua existindo com a assinatura antiga para não espalhar a
 *  mudança pelos chamadores; ela é o ponto único caso um dia volte a haver
 *  mais de uma shell. */
export function modoSimplesAtivo(
  _predio?: unknown,
  _usuario?: unknown,
): boolean {
  return true
}

/** @deprecated regra antiga (org × preferência do usuário) — mantida só como
 *  registro do que existia até jul/2026. */
export function modoSimplesLegado(
  predio: Pick<Predio, 'modo_simples'> | null | undefined,
  usuario: Pick<Usuario, 'modo_avancado'> | null | undefined,
): boolean {
  if (usuario?.modo_avancado) return false
  return !!predio?.modo_simples
}
