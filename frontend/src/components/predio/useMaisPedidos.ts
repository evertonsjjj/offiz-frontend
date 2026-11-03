import { useEffect, useRef, useState } from 'react'
import { api, getSessionIdentity } from '../../lib/api'
import { mesclarPedidosCarregados } from '../../lib/gruposEntregasConversa'

/** Páginas extras são opcionais e pertencem à mesma consulta confirmada. */
export function useMaisPedidos<T extends { id: number }>(url: string, revisao: number, iniciais: T[], offset: number, total: number) {
  const sessao = getSessionIdentity()
  const contexto = JSON.stringify([sessao, url, revisao])
  const atual = useRef(contexto); atual.current = contexto
  const vivo = useRef(true)
  const envio = useRef<{ contexto: string; controle: AbortController } | null>(null)
  const [estado, setEstado] = useState<{ contexto: string; adicionais: T[]; proximo: number; ocupado: boolean; falhou: boolean }>()
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; envio.current?.controle.abort() } }, [])
  useEffect(() => () => { if (envio.current?.contexto === contexto) envio.current.controle.abort() }, [contexto])
  const vigente = estado?.contexto === contexto ? estado : undefined
  const pedidos = mesclarPedidosCarregados(iniciais, vigente?.adicionais || [])
  const proximo = vigente?.proximo ?? offset + iniciais.length
  const podeCarregar = iniciais.length > 0 && proximo < total
  async function carregar() {
    if (!podeCarregar || (envio.current?.contexto === contexto && !envio.current.controle.signal.aborted)) return
    envio.current?.controle.abort()
    const controle = new AbortController(), operacao = { contexto, controle }
    envio.current = operacao
    const aindaAtual = () => vivo.current && !controle.signal.aborted && atual.current === contexto && getSessionIdentity() === sessao
    setEstado({ contexto, adicionais: vigente?.adicionais || [], proximo, ocupado: true, falhou: false })
    try {
      const consulta = new URL(url, 'https://offiz.invalid')
      consulta.searchParams.set('offset', String(proximo)); consulta.searchParams.set('limite', '24')
      const dados = await api.get<{ itens: T[] }>(`${consulta.pathname}?${consulta.searchParams}`, controle.signal)
      if (!aindaAtual()) return
      if (!Array.isArray(dados.itens) || dados.itens.length > 24 || dados.itens.some(p => !p || !Number.isSafeInteger(p.id) || p.id <= 0)) throw new Error('Página de pedidos inválida')
      setEstado({ contexto, adicionais: mesclarPedidosCarregados(vigente?.adicionais || [], dados.itens), proximo: dados.itens.length ? proximo + dados.itens.length : total, ocupado: false, falhou: false })
    } catch {
      if (aindaAtual()) setEstado({ contexto, adicionais: vigente?.adicionais || [], proximo, ocupado: false, falhou: true })
    } finally { if (envio.current === operacao) envio.current = null }
  }
  return { pedidos, podeCarregar, carregar, ocupado: vigente?.ocupado || false, falhou: vigente?.falhou || false }
}
