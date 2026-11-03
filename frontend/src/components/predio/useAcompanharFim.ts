import { useEffect, useRef, useState, type RefObject } from 'react'

/** Segue crescimento real do thread, sem tirar quem voltou para ler acima. */
export function useAcompanharFim(ref: RefObject<HTMLDivElement | null>, contexto: string, ativo: boolean) {
  const seguir = useRef(true)
  const [novaAtividade, setNovaAtividade] = useState(false)
  const irAoFim = () => {
    const el = ref.current
    if (!el) return
    seguir.current = true
    el.scrollTop = el.scrollHeight
    setNovaAtividade(false)
  }
  useEffect(() => {
    seguir.current = true
    setNovaAtividade(false)
    const el = ref.current
    if (!ativo || !el) return
    let vivo = true
    let frame = 0
    let altura = el.scrollHeight
    const scroll = () => {
      seguir.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 48
      if (seguir.current) setNovaAtividade(false)
    }
    const acompanhar = () => {
      if (!vivo) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!vivo || ref.current !== el) return
        if (seguir.current) el.scrollTop = el.scrollHeight
        else if (el.scrollHeight > altura) setNovaAtividade(true)
        altura = el.scrollHeight
      })
    }
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(acompanhar) : null
    const observados = new Set<Element>()
    const observar = () => {
      for (const child of observados) if (child.parentElement !== el) {
        resize?.unobserve(child); observados.delete(child)
      }
      for (const child of el.children) if (!observados.has(child)) {
        resize?.observe(child); observados.add(child)
      }
      acompanhar()
    }
    const mutation = new MutationObserver(observar)
    mutation.observe(el, { childList: true, subtree: true, characterData: true })
    resize?.observe(el)
    el.addEventListener('scroll', scroll, { passive: true })
    el.addEventListener('load', acompanhar, true)
    observar()
    return () => {
      vivo = false
      cancelAnimationFrame(frame)
      mutation.disconnect(); resize?.disconnect()
      el.removeEventListener('scroll', scroll)
      el.removeEventListener('load', acompanhar, true)
    }
  }, [ref, contexto, ativo])
  return { novaAtividade, irAoFim }
}
