import { useLayoutEffect, type RefObject } from 'react'

/** A altura acompanha o rascunho; o texto nunca é cortado nem enviado aqui. */
export function useAlturaPedido(ref: RefObject<HTMLTextAreaElement>, texto: string, visivel: boolean) {
  useLayoutEffect(() => {
    const campo = ref.current
    if (!campo || !visivel) return
    let largura = campo.clientWidth
    const atualizarRolagem = () => {
      const estilo = getComputedStyle(campo)
      const bordas = (Number.parseFloat(estilo.borderTopWidth) || 0) + (Number.parseFloat(estilo.borderBottomWidth) || 0)
      const alturaVisivel = campo.clientHeight || Math.max(0, (Number.parseFloat(campo.style.height) || 0) - bordas)
      campo.style.overflowY = campo.scrollHeight > alturaVisivel ? 'auto' : 'hidden'
      // A própria scrollbar pode consumir largura. Não a confundir com uma
      // coluna redimensionada e desfazer a altura escolhida manualmente.
      largura = campo.clientWidth
    }
    const ajustar = () => {
      if (!campo.isConnected || campo.clientWidth === 0) return
      const estilo = getComputedStyle(campo)
      const minimo = Number.parseFloat(estilo.minHeight) || 52
      const maximo = Math.max(minimo, Number.parseFloat(estilo.maxHeight) || 160)
      const bordas = (Number.parseFloat(estilo.borderTopWidth) || 0) + (Number.parseFloat(estilo.borderBottomWidth) || 0)
      campo.style.height = '0px'
      campo.style.height = `${Math.max(minimo, Math.min(maximo, campo.scrollHeight + bordas))}px`
      // O conteúdo longo continua acessível pela rolagem do próprio campo.
      atualizarRolagem()
    }
    ajustar()
    const observar = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      // Resize manual permanece permitido; só a mudança de largura refaz as linhas.
      if (campo.clientWidth !== largura) ajustar()
      else atualizarRolagem()
    })
    observar?.observe(campo)
    window.addEventListener('resize', ajustar)
    return () => { observar?.disconnect(); window.removeEventListener('resize', ajustar) }
  }, [ref, texto, visivel])
}
