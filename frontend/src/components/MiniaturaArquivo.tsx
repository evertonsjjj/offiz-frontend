import { useEffect, useRef, useState } from 'react'
import { carregarArquivo, getSessionIdentity } from '../lib/api'
import { Icone, iconeDoArquivo } from './Icone'
import './MiniaturaArquivo.css'

const TEM_MINIATURA = /\.(?:jpe?g|png|webp|gif|avif|mp4|webm|mov|m4v|pdf)$/i
const MAX_LEITURAS = 2
type Leitura = { signal: AbortSignal; executar: () => Promise<void>; aoAbortar: () => void }
const fila: Leitura[] = []
let emCurso = 0

function continuarFila() {
  while (emCurso < MAX_LEITURAS && fila.length) {
    const leitura = fila.shift()!
    leitura.signal.removeEventListener('abort', leitura.aoAbortar)
    if (leitura.signal.aborted) continue
    emCurso += 1
    void leitura.executar().finally(() => { emCurso -= 1; continuarFila() })
  }
}

/** Limita a leitura das miniaturas visíveis; cancelamento tira as pendentes da fila. */
function agendar(signal: AbortSignal, executar: () => Promise<void>) {
  const leitura: Leitura = { signal, executar, aoAbortar: () => {
    const indice = fila.indexOf(leitura)
    if (indice >= 0) fila.splice(indice, 1)
  } }
  signal.addEventListener('abort', leitura.aoAbortar, { once: true })
  fila.push(leitura)
  continuarFila()
}

/** O caminho recebido é o endpoint compacto, nunca o arquivo original. */
export default function MiniaturaArquivo({ caminho, nome, className = '' }: {
  caminho: string; nome: string; className?: string
}) {
  const alvo = useRef<HTMLSpanElement>(null)
  const objeto = useRef<string | null>(null)
  const [previa, setPrevia] = useState<{ caminho: string; sessao: string | null; url: string } | null>(null)
  const url = previa?.caminho === caminho && previa.sessao === getSessionIdentity() ? previa.url : null

  useEffect(() => {
    setPrevia(null)
    if (!TEM_MINIATURA.test(nome) || !caminho.startsWith('/') || caminho.startsWith('//')) return
    const controller = new AbortController()
    const sessao = getSessionIdentity()
    let vivo = true
    let iniciado = false
    const carregar = () => {
      if (iniciado || !vivo || controller.signal.aborted) return
      iniciado = true
      agendar(controller.signal, async () => {
        if (!vivo || controller.signal.aborted || getSessionIdentity() !== sessao) return
        try {
          const recebido = await carregarArquivo(caminho, controller.signal)
          if (!vivo || controller.signal.aborted || getSessionIdentity() !== sessao) {
            URL.revokeObjectURL(recebido)
            return
          }
          objeto.current = recebido
          setPrevia({ caminho, sessao, url: recebido })
        } catch { /* Miniatura indisponível: mantém o ícone, sem ler o original. */ }
      })
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer?.disconnect()
        carregar()
      }
    }, { rootMargin: '80px' })
    const conferirSessao = () => {
      if (getSessionIdentity() === sessao) return
      vivo = false
      controller.abort()
      observer?.disconnect()
      if (objeto.current) { URL.revokeObjectURL(objeto.current); objeto.current = null }
      setPrevia(null)
    }
    window.addEventListener('offiz:token-changed', conferirSessao)
    window.addEventListener('storage', conferirSessao)
    if (observer && alvo.current) observer.observe(alvo.current)
    else carregar()
    return () => {
      vivo = false
      controller.abort()
      observer?.disconnect()
      window.removeEventListener('offiz:token-changed', conferirSessao)
      window.removeEventListener('storage', conferirSessao)
      if (objeto.current) { URL.revokeObjectURL(objeto.current); objeto.current = null }
    }
  }, [caminho, nome])

  return <span ref={alvo} className={`miniatura-arquivo ${className}`.trim()} aria-hidden="true">
    {url ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => {
      if (objeto.current === url) {
        URL.revokeObjectURL(url)
        objeto.current = null
        setPrevia(null)
      }
    }} /> : <Icone nome={iconeDoArquivo(nome)} />}
  </span>
}
