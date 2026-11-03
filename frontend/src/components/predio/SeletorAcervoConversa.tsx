import { useEffect, useId, useRef, useState } from 'react'
import { useIdioma } from '../../lib/i18n'
import { Icone } from '../Icone'
import MiniaturaArquivo from '../MiniaturaArquivo'
import './SeletorAcervoConversa.css'

/** A identidade original segue intacta para a cópia normal do anexo. */
export type ItemAcervoAnexo = {
  pasta: string
  caminho: string
  nome: string
  legenda: string | null
  andar?: string
  andarNome?: string
  sub?: string
}

function normalizarBusca(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim()
}

export function SeletorAcervoConversa({
  orgId, slug, nivelPredio, itens, carregando, erro, ocupado, aoSelecionar, aoFechar, aoConsultarNovamente,
}: {
  orgId: number
  slug: string
  nivelPredio: boolean
  itens: ItemAcervoAnexo[] | null
  carregando: boolean
  erro: string | null
  ocupado: boolean
  aoSelecionar: (item: ItemAcervoAnexo) => void
  aoFechar: () => void
  aoConsultarNovamente: () => void
}) {
  const { t } = useIdioma()
  const [busca, setBusca] = useState('')
  const buscaRef = useRef<HTMLInputElement>(null)
  const listaRef = useRef<HTMLUListElement>(null)
  const erroAnterior = useRef(erro)
  const id = useId()
  const pastas: Record<string, string> = {
    entrada: t('Arquivos recebidos', 'Received files'),
    produto: t('O produto', 'The product'),
    exemplos: t('Referências', 'References'),
    marca: t('A marca', 'The brand'),
    aprovados: t('Aprovados', 'Approved'),
  }
  const termos = normalizarBusca(busca).split(/\s+/).filter(Boolean)
  const encontrados = (itens ?? []).filter(item => {
    const texto = normalizarBusca([item.nome, item.legenda, item.pasta, pastas[item.pasta], item.sub, item.andar, item.andarNome, item.caminho].filter(Boolean).join(' '))
    return termos.every(termo => texto.includes(termo))
  })

  useEffect(() => { buscaRef.current?.focus() }, [])
  useEffect(() => {
    // O botão de repetição sai da tela após uma leitura bem-sucedida.
    if (erroAnterior.current && !erro && !carregando) buscaRef.current?.focus({ preventScroll: true })
    erroAnterior.current = erro
  }, [erro, carregando])

  return <section className="conversa-acervo-picker" role="region" aria-label={t('Anexar do acervo', 'Attach from library')} aria-busy={carregando || ocupado} onKeyDown={evento => {
    if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); aoFechar() }
  }}>
    <header>
      <strong>{t('Do seu acervo', 'From your library')}</strong>
      <button type="button" className="botao-texto" aria-label={t('Fechar seletor do acervo', 'Close library picker')} onClick={aoFechar}>
        <Icone nome="fechar" tamanho={16} /> {t('Fechar', 'Close')}
      </button>
    </header>
    <div className="conversa-acervo-busca">
      <label htmlFor={`${id}-busca`} className="sr-only">{t('Buscar no acervo', 'Search library')}</label>
      <Icone nome="lupa" tamanho={17} />
      <input id={`${id}-busca`} ref={buscaRef} type="search" value={busca} placeholder={t('Buscar por nome, descrição ou pasta', 'Search by name, description or folder')} aria-controls={`${id}-lista`} onChange={evento => setBusca(evento.target.value)} onKeyDown={evento => {
        // Pesquisar não confirma um anexo nem envia o pedido do compositor.
        if (evento.key === 'Enter') { evento.preventDefault(); evento.stopPropagation() }
        if (evento.key === 'ArrowDown') {
          const primeiro = listaRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
          if (primeiro) { evento.preventDefault(); primeiro.focus() }
        }
      }} />
      {busca && <button type="button" className="botao-texto" aria-label={t('Limpar busca do acervo', 'Clear library search')} onClick={() => { setBusca(''); buscaRef.current?.focus() }}><Icone nome="fechar" tamanho={16} /></button>}
    </div>
    {carregando && <p className="conversa-acervo-estado" role="status">{t('Abrindo o seu acervo…', 'Opening your library…')}</p>}
    {erro && <div className="alerta alerta-erro" role="alert"><p>{erro}</p><button type="button" className="botao botao-pequeno botao-fantasma" disabled={carregando} onClick={aoConsultarNovamente}>{t('Tentar novamente', 'Try again')}</button></div>}
    {!erro && !carregando && itens !== null && <>
      <p className="conversa-acervo-contagem" role="status" aria-live="polite">{encontrados.length} {encontrados.length === 1 ? t('arquivo', 'file') : t('arquivos', 'files')}{termos.length > 0 && ` ${encontrados.length === 1 ? t('encontrado', 'found') : t('encontrados', 'found')}`}</p>
      {itens.length === 0 && <p className="conversa-acervo-estado">{t('Nada guardado ainda — use “Anexar” para mandar do computador.', 'Nothing saved yet — select “Attach” to upload from your computer.')}</p>}
      {itens.length > 0 && encontrados.length === 0 && <p className="conversa-acervo-estado">{t('Nenhum arquivo encontrado. Tente outro nome ou limpe a busca.', 'No files found. Try another name or clear the search.')}</p>}
    </>}
    <ul id={`${id}-lista`} ref={listaRef} aria-label={t('Arquivos do acervo', 'Library files')}>
      {!erro && encontrados.map(item => {
        const origem = [nivelPredio ? item.andarNome || item.andar : '', pastas[item.pasta] || item.pasta, item.sub].filter(Boolean).join(' / ')
        const descricao = [item.nome, item.legenda, origem].filter(Boolean).join(' · ')
        const sub = item.sub ? `?sub=${encodeURIComponent(item.sub)}` : ''
        const miniatura = `/predios/${orgId}/${encodeURIComponent(item.andar || slug)}/arquivos/${encodeURIComponent(item.pasta)}/${encodeURIComponent(item.nome)}/miniatura${sub}`
        return <li key={`${item.andar}:${item.caminho}`}>
          <button type="button" disabled={ocupado} title={descricao} aria-label={descricao} onClick={() => aoSelecionar(item)}>
            <MiniaturaArquivo caminho={miniatura} nome={item.nome} className="conversa-acervo-miniatura" />
            <span className="conversa-acervo-texto">
              <strong>{item.nome}</strong>
              {item.legenda && <span className="conversa-acervo-descricao">{item.legenda}</span>}
              <small className="conversa-acervo-pasta">{origem}</small>
            </span>
            <Icone nome="anexo" tamanho={16} />
          </button>
        </li>
      })}
    </ul>
  </section>
}
