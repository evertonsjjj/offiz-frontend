import { useEffect, useState } from 'react'
import { carregarImagem } from './api'

/**
 * O BRASÃO do prédio, pronto para um `<img src>`.
 *
 * Por que um hook e não um `<img src="/api/...">`: o endpoint é autenticado
 * (Bearer no header), então a tag crua levaria 401 — `carregarImagem` busca com
 * o token e devolve um object URL. Esse URL é um recurso do navegador: se
 * ninguém o revogar, cada troca de logo vaza um blob na memória da aba, e quem
 * fica o dia todo na mesma tela paga a conta. A limpeza mora aqui, uma vez, em
 * vez de em cada tela que mostra o brasão.
 *
 * Recarrega ao ouvir `offiz:personalizacao-mudou` — trocar o logo em
 * Configurações aparece na hora, sem F5.
 *
 * `null` quer dizer "não há brasão" (404 é resposta normal): quem chama cai no
 * ícone do tema.
 */
export function useBrasao(orgId: number | string, slug: string): string | null {
  const [brasao, setBrasao] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    let urlLocal: string | null = null
    const buscar = () => {
      carregarImagem(`/predios/${orgId}/${slug}/personalizacao/brasao`)
        .then((url) => {
          if (!vivo) {
            URL.revokeObjectURL(url)
            return
          }
          if (urlLocal) URL.revokeObjectURL(urlLocal)
          urlLocal = url
          setBrasao(url)
        })
        .catch(() => {
          if (vivo) setBrasao(null)
        })
    }
    buscar()
    window.addEventListener('offiz:personalizacao-mudou', buscar)
    return () => {
      vivo = false
      window.removeEventListener('offiz:personalizacao-mudou', buscar)
      if (urlLocal) URL.revokeObjectURL(urlLocal)
    }
  }, [orgId, slug])

  return brasao
}
