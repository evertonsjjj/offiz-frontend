import { useEffect, useRef, useState, type ReactNode } from 'react'

/** A prévia mantém o teclado dentro do arquivo e devolve o foco à origem. */
export default function DialogoArquivo({ nome, className, aoFechar, children }: {
  nome: string
  className: string
  aoFechar: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Capturado antes do autoFocus dos filhos, inclusive quando a prévia carrega.
  const [origem] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (origem?.isConnected) origem.focus()
    }
  }, [origem])
  useEffect(() => {
    // O Estúdio também usa Esc. Consuma primeiro para fechar só a prévia.
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        aoFechar()
      }
    }
    window.addEventListener('keydown', aoTeclar, true)
    return () => window.removeEventListener('keydown', aoTeclar, true)
  }, [aoFechar])
  return <dialog ref={dialogRef} className={className} aria-label={nome} aria-modal="true"
    onCancel={e => { e.preventDefault(); aoFechar() }}
    onClick={e => { if (e.target === e.currentTarget) aoFechar() }}>
    {children}
  </dialog>
}
