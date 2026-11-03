/**
 * Canais de contato do Offiz (centralizados).
 * O produto é provisionado sob demanda — não há auto-cadastro; o público
 * interessado fala com a gente por aqui (WhatsApp ou e-mail).
 *
 * Os canais são o CONTATO COMERCIAL da home — existem para ser públicos, e por
 * isso ficam no código como padrão. (Antes eram só env, e as envs nunca foram
 * ligadas ao build: `temContato` era falso em produção, a seção de contato
 * sumia e o visitante não tinha como falar com ninguém.)
 *
 * VITE_CONTACT_EMAIL / VITE_WHATSAPP continuam valendo e VENCEM o padrão —
 * é assim que um fork, um ambiente de teste ou um revendedor põem o contato
 * deles sem tocar no código. Zerar a env NÃO apaga o canal; para tirar os CTAs
 * do ar, esvazie as constantes abaixo.
 *
 * WhatsApp: só dígitos, formato wa.me (55 + DDD + número).
 */

const EMAIL_PADRAO = 'evertonsjjj@gmail.com'
const WHATSAPP_PADRAO = '5551995489264'

export const CONTATO_EMAIL = (
  (import.meta.env.VITE_CONTACT_EMAIL as string) || EMAIL_PADRAO
).trim()

// Só dígitos (formato wa.me). O display formatado é derivado abaixo.
export const CONTATO_WHATSAPP = (
  (import.meta.env.VITE_WHATSAPP as string) || WHATSAPP_PADRAO
).replace(/\D/g, '')

/** Canais disponíveis — a UI condiciona cada CTA ao seu canal. */
export const temEmail = CONTATO_EMAIL.length > 0
export const temWhatsapp = CONTATO_WHATSAPP.length > 0
/** Pelo menos um canal configurado? Sem ele, os CTAs de contato somem. */
export const temContato = temEmail || temWhatsapp

export const CONTATO_WHATSAPP_DISPLAY = formatarWhatsapp(CONTATO_WHATSAPP)

const MSG_WPP =
  'Olá! Vim pelo site do Offiz e gostaria de conhecer o serviço de sabatina e personalização da IA para minha marca.'

export function whatsappLink(msg: string = MSG_WPP): string {
  return `https://wa.me/${CONTATO_WHATSAPP}?text=${encodeURIComponent(msg)}`
}

const EMAIL_ASSUNTO = 'Contato Offiz — personalização da IA para minha marca'
const EMAIL_CORPO =
  'Olá! Vim pelo site do Offiz e gostaria de conhecer o serviço de sabatina e personalização da IA para minha marca.'

export function mailtoLink(
  assunto: string = EMAIL_ASSUNTO,
  corpo: string = EMAIL_CORPO,
): string {
  return `mailto:${CONTATO_EMAIL}?subject=${encodeURIComponent(
    assunto,
  )}&body=${encodeURIComponent(corpo)}`
}

function formatarWhatsapp(digits: string): string {
  const d = digits.replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('55')) {
    return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9, 13)}`
  }
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
  }
  return digits
}
