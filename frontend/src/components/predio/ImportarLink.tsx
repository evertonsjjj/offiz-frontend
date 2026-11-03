import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ApiError, api, getSessionIdentity } from '../../lib/api'
import { formatBytes } from '../../lib/format'
import { useIdioma } from '../../lib/i18n'
import { Icone } from '../Icone'
import './importar-link.css'

type PastaImportacao = 'entrada' | 'produto'
type EstadoImportacao = 'na_fila' | 'em_andamento' | 'concluido' | 'falhou' | 'interrompido'
type Tentativa = { id: string; url: string; pasta: PastaImportacao }
type Fonte = 'youtube' | 'instagram'
type ArquivoImportado = { nome: string; tamanho_bytes: number; ordem: number; tipo_midia: 'imagem' | 'video'; duracao_segundos: number | null }
type Importacao = Tentativa & {
  status: EstadoImportacao
  nome: string | null
  tamanho_bytes: number | null
  duracao_segundos: number | null
  erro: string | null
  arquivos: ArquivoImportado[]
  qtd_arquivos?: number
  total_arquivos?: number
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ESTADOS = new Set<EstadoImportacao>(['na_fila', 'em_andamento', 'concluido', 'falhou', 'interrompido'])
const emAndamento = (estado?: EstadoImportacao) => estado === 'na_fila' || estado === 'em_andamento'
const resultadoConhecidoIncerto = (resposta: Importacao | null) => resposta?.status === 'interrompido' && (resposta.arquivos.length > 0 || !!resposta.nome?.trim())

function fonteDoLink(texto: string): Fonte | null {
  try {
    const url = new URL(texto.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const host = url.hostname.toLowerCase()
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host) && !url.searchParams.has('list')) {
      const id = host === 'youtu.be' ? url.pathname.replace(/^\//, '').replace(/\/$/, '')
        : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return 'youtube'
    }
    if (['instagram.com', 'www.instagram.com'].includes(host) && /^\/(?:p|reel|tv)\/[A-Za-z0-9_-]{5,32}\/?$/.test(url.pathname)) return 'instagram'
    return null
  } catch { return null }
}

function identidadeDoLink(texto: string): string | null {
  const fonte = fonteDoLink(texto)
  if (!fonte) return null
  const url = new URL(texto.trim())
  return fonte === 'instagram' ? url.pathname.split('/')[2]
    : url.hostname === 'youtu.be' ? url.pathname.split('/')[1] : url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.split('/')[2]
}

function lerTentativa(chave: string, legado: string): Tentativa | null {
  try {
    const valor: unknown = JSON.parse(sessionStorage.getItem(chave) || sessionStorage.getItem(legado) || 'null')
    if (!valor || typeof valor !== 'object') return null
    const tentativa = valor as Partial<Tentativa>
    if (typeof tentativa.id !== 'string' || !UUID.test(tentativa.id)
      || typeof tentativa.url !== 'string' || tentativa.url.length > 2048 || !fonteDoLink(tentativa.url)
      || !['entrada', 'produto'].includes(tentativa.pasta || '')) return null
    return tentativa as Tentativa
  } catch { return null }
}

function novaChave(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function duracao(segundos: number): string {
  const inteiro = Math.round(segundos)
  return `${Math.floor(inteiro / 60)}:${String(inteiro % 60).padStart(2, '0')}`
}

function lerResposta(valor: unknown, tentativa: Tentativa): Importacao {
  if (!valor || typeof valor !== 'object') throw new Error('Resposta de importação inválida')
  const r = valor as Partial<Importacao>
  const fonte = fonteDoLink(tentativa.url)
  if (r.id !== tentativa.id || typeof r.url !== 'string' || fonteDoLink(r.url) !== fonte
    || identidadeDoLink(r.url) !== identidadeDoLink(tentativa.url) || r.pasta !== tentativa.pasta
    || !ESTADOS.has(r.status as EstadoImportacao)) throw new Error('Resposta de importação inválida')
  const arquivos = fonte === 'instagram' ? lerArquivos(r.arquivos) : []
  if (r.status === 'concluido' && fonte === 'instagram' && (!arquivos.length || r.qtd_arquivos !== arquivos.length
    || r.total_arquivos !== arquivos.length || arquivos.some((item, indice) => item.ordem !== indice + 1))) throw new Error('Arquivos importados não confirmados')
  if (r.status === 'concluido' && fonte === 'youtube' && (typeof r.nome !== 'string' || !r.nome.trim()
    || typeof r.tamanho_bytes !== 'number' || !Number.isFinite(r.tamanho_bytes) || r.tamanho_bytes <= 0)) {
    throw new Error('Arquivo importado não confirmado')
  }
  return {
    ...tentativa, status: r.status as EstadoImportacao,
    nome: typeof r.nome === 'string' ? r.nome : null,
    tamanho_bytes: typeof r.tamanho_bytes === 'number' && Number.isFinite(r.tamanho_bytes) ? r.tamanho_bytes : null,
    duracao_segundos: typeof r.duracao_segundos === 'number' && Number.isFinite(r.duracao_segundos) ? r.duracao_segundos : null,
    erro: typeof r.erro === 'string' ? r.erro : null,
    arquivos,
  }
}

function lerArquivos(valor: unknown): ArquivoImportado[] {
  if (valor === undefined || valor === null) return []
  if (!Array.isArray(valor) || valor.length > 20) throw new Error('Lista de arquivos inválida')
  const arquivos = valor.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Arquivo inválido')
    const r = item as Partial<ArquivoImportado>
    if (typeof r.nome !== 'string' || !r.nome.trim() || typeof r.tamanho_bytes !== 'number'
      || !Number.isFinite(r.tamanho_bytes) || r.tamanho_bytes <= 0 || !Number.isInteger(r.ordem)
      || (r.ordem as number) < 1 || (r.ordem as number) > 20 || !['imagem', 'video'].includes(r.tipo_midia || '')) throw new Error('Arquivo não confirmado')
    return { nome: r.nome, tamanho_bytes: r.tamanho_bytes, ordem: r.ordem as number, tipo_midia: r.tipo_midia as 'imagem' | 'video',
      duracao_segundos: typeof r.duracao_segundos === 'number' && Number.isFinite(r.duracao_segundos) && r.duracao_segundos > 0 ? r.duracao_segundos : null }
  })
  if (new Set(arquivos.map(item => item.ordem)).size !== arquivos.length) throw new Error('Ordem de arquivos inválida')
  return arquivos.sort((a, b) => a.ordem - b.ordem)
}

/** Importar é uma ação explícita. Links colados na conversa continuam referências.
 * Resposta perdida é consultada pelo UUID guardado. Só um 404 confirmado permite
 * solicitar de novo por ação humana, com exatamente a mesma chave e destino. */
type Propriedades = {
  orgId: number
  slug: string
  pasta: PastaImportacao
  disponivel: boolean
  aoImportar: () => void
  aoEnviarArquivo: () => void
}
export default function ImportarLink(props: Propriedades) {
  return <ConteudoImportacao key={`${getSessionIdentity()}:${props.orgId}:${props.slug}`} {...props} />
}
function ConteudoImportacao({ orgId, slug, pasta, disponivel, aoImportar, aoEnviarArquivo }: Propriedades) {
  const { t, idioma } = useIdioma()
  const idOrientacao = useId()
  const [sessao] = useState(getSessionIdentity)
  const chave = `offiz.importacao-link:${sessao ?? 'sem-sessao'}:${orgId}:${slug}`
  const legado = `offiz.youtube:${sessao ?? 'sem-sessao'}:${orgId}:${slug}`
  const [tentativa, setTentativa] = useState<Tentativa | null>(() => lerTentativa(chave, legado))
  const [aberto, setAberto] = useState(() => !!lerTentativa(chave, legado))
  const [url, setUrl] = useState(() => lerTentativa(chave, legado)?.url || '')
  const [operacao, setOperacao] = useState<Importacao | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [consultando, setConsultando] = useState(false)
  const [ausenteConfirmado, setAusenteConfirmado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const ativa = useRef(true)
  const envioRef = useRef(false)
  const leituraRef = useRef<AbortController | null>(null)
  const notificadoRef = useRef<string | null>(null)
  const campoRef = useRef<HTMLInputElement>(null)
  const botaoRef = useRef<HTMLButtonElement>(null)
  const aoImportarRef = useRef(aoImportar)
  aoImportarRef.current = aoImportar
  const base = `/predios/${orgId}/${slug}/arquivos`
  const endpoint = useCallback((atual: Tentativa) => `${base}/importacoes-${fonteDoLink(atual.url)}`, [base])
  const vigente = useCallback(() => ativa.current && getSessionIdentity() === sessao, [sessao])
  const guardar = useCallback((valor: Tentativa | null) => {
    // Se storage estiver indisponível, a guarda em memória ainda impede replay.
    try { if (valor) sessionStorage.setItem(chave, JSON.stringify(valor)); else sessionStorage.removeItem(chave); sessionStorage.removeItem(legado) } catch { /* sem persistência local */ }
    setTentativa(valor)
  }, [chave, legado])
  const aceitar = useCallback((resposta: Importacao) => {
    setOperacao(resposta)
    setErro(null)
    setAusenteConfirmado(false)
    if ((resposta.status === 'concluido' || resultadoConhecidoIncerto(resposta)) && notificadoRef.current !== resposta.id) {
      notificadoRef.current = resposta.id
      aoImportarRef.current()
    }
    if (!emAndamento(resposta.status) && !resultadoConhecidoIncerto(resposta)) {
      try { sessionStorage.removeItem(chave); sessionStorage.removeItem(legado) } catch { /* resultado continua na tela */ }
    }
  }, [chave, legado])
  const conferir = useCallback(async (atual: Tentativa) => {
    if (!vigente() || envioRef.current) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    setConsultando(true)
    try {
      const resposta = await api.get<unknown>(`${endpoint(atual)}/${atual.id}`, controller.signal)
      if (!vigente() || controller.signal.aborted || leituraRef.current !== controller) return
      aceitar(lerResposta(resposta, atual))
    } catch (e) {
      if (!vigente() || controller.signal.aborted || leituraRef.current !== controller) return
      const falta = e instanceof ApiError && e.status === 404
      setAusenteConfirmado(falta)
      setErro(falta
        ? t('A importação não foi encontrada. Você pode verificar novamente ou solicitar esta mesma importação, sem criar outra tentativa.', 'The import was not found. You can check again or request this same import, without creating another attempt.')
        : t('Não consegui confirmar a importação agora. Verifique o estado novamente; isso não repete o download.', 'Could not confirm the import right now. Check its status again; this does not repeat the download.'))
    } finally {
      if (vigente() && leituraRef.current === controller && !controller.signal.aborted) setConsultando(false)
    }
  }, [aceitar, endpoint, t, vigente])
  useEffect(() => {
    ativa.current = true
    return () => { ativa.current = false; leituraRef.current?.abort() }
  }, [])
  useEffect(() => {
    if (tentativa && !operacao && !enviando) void conferir(tentativa)
  }, [tentativa, operacao, enviando, conferir])
  useEffect(() => {
    if (!tentativa || !operacao || !emAndamento(operacao.status) || erro || enviando) return
    const timer = window.setTimeout(() => void conferir(tentativa), 3000)
    return () => window.clearTimeout(timer)
  }, [tentativa, operacao, erro, enviando, conferir])
  useEffect(() => { if (aberto && !tentativa) campoRef.current?.focus() }, [aberto, tentativa])

  const resultadoIncerto = resultadoConhecidoIncerto(operacao)
  const pendente = !!tentativa && (!operacao || emAndamento(operacao.status) || resultadoIncerto)
  async function importar(evento: FormEvent) {
    evento.preventDefault()
    if (!vigente() || envioRef.current || pendente || !fonteDoLink(url) || url.trim().length > 2048) return
    const atual: Tentativa = { id: novaChave(), url: url.trim(), pasta }
    guardar(atual)
    await solicitar(atual)
  }
  async function solicitar(atual: Tentativa) {
    if (!vigente() || envioRef.current) return
    envioRef.current = true
    leituraRef.current?.abort()
    setConsultando(false)
    setAusenteConfirmado(false)
    setEnviando(true)
    setOperacao(null)
    setErro(null)
    try {
      const resposta = await api.post<unknown>(endpoint(atual), { url: atual.url, pasta: atual.pasta, chave_importacao: atual.id })
      if (vigente()) aceitar(lerResposta(resposta, atual))
    } catch (e) {
      if (!vigente()) return
      const recusado = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408
      if (recusado) {
        guardar(null)
        setErro(e.detail)
      } else {
        setErro(t('A resposta não foi confirmada. A importação pode ter começado; confira o estado antes de qualquer nova tentativa.', 'The response was not confirmed. The import may have started; check its status before starting another attempt.'))
      }
    } finally {
      envioRef.current = false
      if (vigente()) setEnviando(false)
    }
  }
  function fechar() { setAberto(false); botaoRef.current?.focus() }
  const pastaVisivel = pendente || operacao?.status === 'concluido' ? tentativa?.pasta || pasta : pasta
  const destino = pastaVisivel === 'produto' ? t('O produto', 'Product') : t('Chegou agora', 'New arrivals')
  const fonte = fonteDoLink(pendente || operacao?.status === 'concluido' ? tentativa?.url || url : url)
  const instagram = fonte === 'instagram'
  const linkInvalido = !pendente && !!url.trim() && !fonteDoLink(url)
  return <div className="importar-link">
    {(disponivel || tentativa) && <button ref={botaoRef} type="button" className="botao botao-fantasma botao-pequeno" aria-expanded={aberto}
      onClick={() => setAberto(valor => !valor)}><Icone nome="play" tamanho={15} />{pendente ? t('Ver importação por link', 'View link import') : t('Importar por link', 'Import from link')}</button>}
    {aberto && <section className="importar-link__painel" aria-label={t('Importar do YouTube ou Instagram', 'Import from YouTube or Instagram')}>
      <header><h3>{t('Importar por link', 'Import from link')}</h3><button type="button" className="botao-texto" onClick={fechar} aria-label={t('Fechar importação', 'Close import')}><Icone nome="fechar" tamanho={18} /></button></header>
      <p className="texto-suave">{t('Cole um vídeo do YouTube ou uma publicação pública do Instagram. Os arquivos serão salvos no Acervo para edição. Para inspiração, cole o link na conversa; isso não baixa os arquivos.', 'Paste a YouTube video or a public Instagram post. The files will be saved to your library for editing. For inspiration, paste the link in the conversation; that does not download the files.')}</p>
      {operacao?.status !== 'concluido' && !resultadoIncerto && <form onSubmit={evento => void importar(evento)}>
        <label>{t('Link do vídeo ou publicação', 'Video or post link')}<input ref={campoRef} type="url" value={url} maxLength={2048} disabled={pendente || enviando}
          aria-invalid={linkInvalido} aria-describedby={linkInvalido ? idOrientacao : undefined}
          placeholder="https://www.instagram.com/p/…" onChange={evento => setUrl(evento.target.value)} /></label>
        {linkInvalido && <p id={idOrientacao} className="texto-suave importar-link__limites">{t('Use o link de um vídeo do YouTube ou de uma publicação ou Reel do Instagram. Perfis, stories e playlists não são importados.', 'Use a YouTube video link or an Instagram post or Reel link. Profiles, stories and playlists are not imported.')}</p>}
        <p className="texto-suave importar-link__limites">{instagram
          ? t(`Destino: ${destino}. Fotos, Reel ou carrossel com até 20 arquivos em sua ordem original, até 200 MB no total. Perfis e stories não são importados.`, `Destination: ${destino}. Photos, Reel or carousel with up to 20 files in their original order, up to 200 MB in total. Profiles and stories are not imported.`)
          : t(`Destino: ${destino}. YouTube: um vídeo por vez, até 45 minutos e 200 MB; a qualidade pode chegar a 1080p. Instagram: foto, Reel ou carrossel público.`, `Destination: ${destino}. YouTube: one video at a time, up to 45 minutes and 200 MB; quality may reach 1080p. Instagram: a public photo, Reel or carousel.`)}</p>
        {!pendente && <button className="botao botao-primario botao-pequeno" type="submit" disabled={!fonteDoLink(url) || enviando}>{t('Importar arquivos', 'Import files')}</button>}
      </form>}
      {enviando && <p role="status">{t('Solicitando a importação…', 'Requesting import…')}</p>}
      {!enviando && operacao && emAndamento(operacao.status) && <p role="status">{operacao.status === 'na_fila'
        ? t('Na fila para importar os arquivos.', 'Queued to import the files.')
        : t('Importando e conferindo os arquivos…', 'Importing and checking the files…')}</p>}
      {operacao?.status === 'concluido' && !instagram && <div role="status"><p>{t('Vídeo guardado no Acervo', 'Video saved to your library')}: <strong>{operacao.nome}</strong>{operacao.tamanho_bytes !== null && <> ({formatBytes(operacao.tamanho_bytes, idioma)})</>}.
        {operacao.duracao_segundos !== null && operacao.duracao_segundos > 0 && <> {t('Duração', 'Duration')}: {duracao(operacao.duracao_segundos)}.</>} <a href={operacao.url} target="_blank" rel="noopener noreferrer">{t('Origem no YouTube', 'YouTube source')}</a></p>
        <p>{t('Use “Do acervo” na conversa para selecionar o arquivo.', 'Select the file with “From library” in the conversation.')}</p></div>}
      {operacao && resultadoIncerto && !instagram && <div role="status"><p>{t('Confira este arquivo no Acervo; a importação não foi confirmada por inteiro:', 'Check this file in your library; the import was not fully confirmed:')} <strong>{operacao.nome}</strong>.</p>
        <p><a href={operacao.url} target="_blank" rel="noopener noreferrer">{t('Origem no YouTube', 'YouTube source')}</a></p></div>}
      {operacao && instagram && operacao.arquivos.length > 0 && <div className="importar-link__resultado" role="status">
        <p>{operacao.status === 'concluido'
          ? t(`${operacao.arquivos.length} ${operacao.arquivos.length === 1 ? 'arquivo guardado' : 'arquivos guardados'} no Acervo.`, `${operacao.arquivos.length} ${operacao.arquivos.length === 1 ? 'file saved' : 'files saved'} to your library.`)
          : t(`Confira ${operacao.arquivos.length} ${operacao.arquivos.length === 1 ? 'arquivo' : 'arquivos'} no Acervo; a importação não foi confirmada por inteiro.`, `Check ${operacao.arquivos.length} ${operacao.arquivos.length === 1 ? 'file' : 'files'} in your library; the import was not fully confirmed.`)}</p>
        <ol aria-label={t('Arquivos na ordem da publicação', 'Files in post order')}>{operacao.arquivos.map(arquivo => <li key={arquivo.ordem} value={arquivo.ordem}>
          <strong>{arquivo.nome}</strong><span>{t(arquivo.tipo_midia === 'imagem' ? 'Foto' : 'Vídeo', arquivo.tipo_midia === 'imagem' ? 'Photo' : 'Video')} ({formatBytes(arquivo.tamanho_bytes, idioma)}){arquivo.duracao_segundos !== null && <> · {duracao(arquivo.duracao_segundos)}</>}</span>
        </li>)}</ol>
        <p><a href={operacao.url} target="_blank" rel="noopener noreferrer">{t('Origem no Instagram', 'Instagram source')}</a></p>
        {operacao.status === 'concluido' && <p>{t('Use “Do acervo” na conversa para selecionar os arquivos.', 'Select the files with “From library” in the conversation.')}</p>}
      </div>}
      {operacao?.status === 'concluido' && <button type="button" className="botao botao-fantasma botao-pequeno"
        onClick={() => { if (!vigente()) return; guardar(null); setOperacao(null); setUrl(''); setErro(null) }}>{t('Importar outro link', 'Import another link')}</button>}
      {resultadoIncerto && <button type="button" className="botao botao-fantasma botao-pequeno"
        onClick={() => { if (!vigente() || envioRef.current) return; leituraRef.current?.abort(); guardar(null); setOperacao(null); setUrl(''); setErro(null); setConsultando(false); setAusenteConfirmado(false) }}>{t('Conferi o Acervo — encerrar aviso', 'I checked the library — dismiss notice')}</button>}
      {operacao && ['falhou', 'interrompido'].includes(operacao.status) && <p role="alert">{operacao.erro || t('A importação não foi concluída. Você pode enviar o arquivo do computador.', 'The import did not complete. You can upload the file from your computer.')}</p>}
      {erro && <p role="alert">{erro}</p>}
      {pendente && !enviando && <button type="button" className="botao botao-fantasma botao-pequeno" disabled={consultando} onClick={() => tentativa && void conferir(tentativa)}>{consultando ? t('Verificando…', 'Checking…') : t('Verificar importação', 'Check import')}</button>}
      {pendente && !enviando && ausenteConfirmado && <button type="button" className="botao botao-primario botao-pequeno" disabled={consultando}
        onClick={() => tentativa && vigente() && !envioRef.current && void solicitar(tentativa)}>{t('Solicitar esta importação', 'Request this import')}</button>}
      {(erro || operacao?.status === 'falhou' || operacao?.status === 'interrompido') && <div><button type="button" className="botao-texto" onClick={() => { if (vigente()) aoEnviarArquivo() }}>{t('Enviar arquivo do computador', 'Upload a file from your computer')}</button><p className="texto-suave">{t('O arquivo enviado aparecerá em “Chegou agora”.', 'The uploaded file will appear in “New arrivals”.')}</p></div>}
      {pendente && <p className="texto-suave">{t('Fechar este painel não cancela nem repete a importação.', 'Closing this panel does not cancel or repeat the import.')}</p>}
    </section>}
  </div>
}
