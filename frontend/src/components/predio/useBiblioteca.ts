import { useEffect, useState } from 'react'
import { api, getSessionIdentity } from '../../lib/api'

export function useBiblioteca<T>(url: string, revisao = 0) {
  const conta = getSessionIdentity()
  const [estado, setEstado] = useState<{ url: string; conta: string | null; dados?: T; erro?: string; consultadoEm?: string }>({ url, conta })
  useEffect(() => {
    const c = new AbortController()
    const atual = () => !c.signal.aborted && getSessionIdentity() === conta
    api.get<T>(url, c.signal).then(dados => {
      if (atual()) setEstado({ url, conta, dados, consultadoEm: new Date().toISOString() })
    }).catch(e => {
      if (!atual()) return
      // Uma falha não confirma dados novos nem apaga a última consulta válida.
      // O snapshot só pode acompanhar a mesma URL e a mesma sessão.
      setEstado(anterior => ({ ...(anterior.url === url && anterior.conta === conta ? anterior : { url, conta }), erro: e instanceof Error ? e.message : String(e) }))
    })
    return () => c.abort()
  }, [url, revisao, conta])
  return estado.url === url && estado.conta === conta ? estado : { url, conta }
}
