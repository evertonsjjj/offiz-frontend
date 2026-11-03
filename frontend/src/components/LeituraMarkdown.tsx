import type { ReactNode } from 'react'

/** Leitura de entregas: HTML fica como texto e só links web são clicáveis.
 * Imagens externas não são carregadas automaticamente. */
function inline(texto: string): ReactNode[] {
  const partes = texto.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|!?\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>()]+)/g)
  return partes.map((parte, i) => {
    if (parte.startsWith('**') && parte.endsWith('**')) return <strong key={i}>{inline(parte.slice(2, -2))}</strong>
    if (parte.startsWith('*') && parte.endsWith('*')) return <em key={i}>{inline(parte.slice(1, -1))}</em>
    if (parte.startsWith('`') && parte.endsWith('`')) return <code key={i}>{parte.slice(1, -1)}</code>
    if (/^https?:\/\//.test(parte)) {
      const endereco = parte.replace(/[.,;:!?]+$/, '')
      try {
        const url = new URL(endereco)
        return <span key={i}><a href={url.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{endereco}</a>{parte.slice(endereco.length)}</span>
      } catch { return parte }
    }
    const link = parte.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) {
      try {
        const url = new URL(link[2])
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          return <a key={i} href={url.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{link[1]}</a>
        }
      } catch { /* Caminhos locais continuam texto. */ }
    }
    return parte
  })
}

export default function LeituraMarkdown({ texto }: { texto: string }) {
  const blocos: ReactNode[] = []
  const linhas = texto.split('\n')
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i].trimEnd()
    if (!linha.trim()) continue
    const titulo = linha.match(/^(#{1,6})\s+(.+)$/)
    if (titulo) {
      const Conteiner = titulo[1].length === 1 ? 'h2' : titulo[1].length === 2 ? 'h3' : 'h4'
      blocos.push(<Conteiner key={i}>{inline(titulo[2])}</Conteiner>)
    } else if (/^\s*([-*]|\d+[.)])\s/.test(linha)) {
      const ordenada = /^\s*\d/.test(linha)
      const padrao = ordenada ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/
      const itens: ReactNode[] = []
      const inicio = i
      while (i < linhas.length && padrao.test(linhas[i])) {
        itens.push(<li key={i}>{inline(linhas[i].replace(padrao, ''))}</li>)
        i++
      }
      i--
      blocos.push(ordenada ? <ol key={inicio}>{itens}</ol> : <ul key={inicio}>{itens}</ul>)
    } else if (/^---+$/.test(linha)) {
      blocos.push(<hr key={i} />)
    } else {
      blocos.push(<p key={i}>{inline(linha)}</p>)
    }
  }
  return <>{blocos}</>
}
