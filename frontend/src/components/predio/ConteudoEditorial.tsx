import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, baixarArquivo } from '../../lib/api'
import ResultadoEntrega from './ResultadoEntrega'
import './conteudo-editorial.css'
import { useIdioma, type Traduzir } from '../../lib/i18n'
import { correspondeBusca } from '../../lib/busca'

type Arquivo = { entrega_id: number; nome: string; mime?: string; tamanho_bytes: number }
type Revisao = {
  id: number; job_id: number; criado_em: string; titulo: string; canal: string
  legendas: { nome: string; texto: string }[]; arquivos: Arquivo[]
  qualidade: { avisos: string[]; nota: string }
}
export type PecaEditorial = {
  id: number; titulo: string; canal: string; data_planejada: string | null; briefing: string
  estado: string; job_id: number | null; job_status: string | null
  revisao_aprovada_id: number | null; variante_aprovada: number; nova_revisao: boolean
  publicado_em: string | null; link_publicacao: string | null; metricas: Record<string, number>
  revisoes: Revisao[]
}
const estadosRotulos = (traduzir: Traduzir): Record<string, string> => ({
  planejado: traduzir("Planejado", "Planned"), em_producao: traduzir("Em produção", "In production"), em_revisao: traduzir("Em revisão", "Under review"), aprovado: traduzir("Aprovado", "Approved"), publicado: traduzir("Publicado", "Published"),
})
const pautaVazia = { titulo: '', canal: 'instagram', data_planejada: '', briefing: '' }

export default function ConteudoEditorial({ orgId, aoMudar }: { orgId: number; aoMudar?: () => void }) {
  const { t: traduzir, idioma } = useIdioma()
  const ESTADOS = estadosRotulos(traduzir)
  const base = `/predios/${orgId}/conteudo/editorial`
  const [pecas, setPecas] = useState<PecaEditorial[] | null>(null)
  const [busca, setBusca] = useState('')
  const [limite, setLimite] = useState(24)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [nova, setNova] = useState(false)
  const [pauta, setPauta] = useState(pautaVazia)
  const [filtro, setFiltro] = useState('todas')
  const [aberta, setAberta] = useState<number | null>(null)
  const [aviso, setAviso] = useState('')
  const leituraAtual = useRef(0)
  const carregar = useCallback(async (signal?: AbortSignal) => {
    const leitura = ++leituraAtual.current
    try {
      const resposta = await api.get<PecaEditorial[]>(base, signal)
      if (signal?.aborted || leitura !== leituraAtual.current) return
      setPecas(resposta); setErro('')
    } catch (e) {
      if (!signal?.aborted && leitura === leituraAtual.current) setErro(e instanceof Error ? e.message : traduzir("Não consegui abrir o calendário.", "Could not open the calendar."))
    }
  }, [base, traduzir])
  useEffect(() => {
    const ac = new AbortController()
    void carregar(ac.signal)
    const t = window.setInterval(() => { if (!document.hidden) void carregar(ac.signal) }, 15000)
    return () => { ++leituraAtual.current; ac.abort(); window.clearInterval(t) }
  }, [carregar])
  async function atualizar() { await carregar(); aoMudar?.() }
  async function criar(ev: FormEvent) {
    ev.preventDefault(); setOcupado(true); setErro('')
    try {
      const p = await api.post<PecaEditorial>(base, { ...pauta, data_planejada: pauta.data_planejada || null })
      setNova(false); setPauta(pautaVazia); setAberta(p.id); setFiltro('todas'); await atualizar()
    } catch (e) { setErro((e as Error).message) }
    finally { setOcupado(false) }
  }
  useEffect(() => { setLimite(24) }, [busca, filtro])
  const visiveis = (pecas || []).filter(p => (filtro === 'todas' || p.estado === filtro || (filtro === 'em_revisao' && p.nova_revisao)) && correspondeBusca(busca, p.titulo, p.canal, p.briefing))
  const hoje = new Date().toLocaleDateString('en-CA')
  return <section className="editorial" aria-label={traduzir("Calendário de conteúdo", "Content calendar")}>
    <header className="editorial__cabecalho">
      <div><span className="editorial__sobretitulo">{traduzir("CONTEÚDO & MARCA", "CONTENT & BRAND")}</span><h3>{traduzir("Da pauta à publicação", "From brief to publication")}</h3>
        <p>{traduzir("Revise cada peça, escolha a legenda e leve o kit pronto para publicar.", "Review each deliverable, choose a caption and download the ready-to-publish kit.")}</p></div>
      <button type="button" className="mesa-btn" onClick={() => setNova(!nova)}>{nova ? traduzir("Fechar formulário", "Close form") : traduzir("+ Nova pauta", "+ New brief")}</button>
    </header>
    {erro && <p role="alert" className="editorial__erro">{erro} <button className="mesa-link" onClick={() => void carregar()}>{traduzir("Tentar novamente", "Try again")}</button></p>}
    {aviso && <p role="status">{aviso}</p>}
    {nova && <form className="editorial__form" onSubmit={criar}>
      <label>{traduzir("Pauta", "Brief")}<input required maxLength={200} value={pauta.titulo} onChange={e => setPauta({ ...pauta, titulo: e.target.value })} placeholder={traduzir("Ex.: apresentar a nova coleção", "E.g. introduce the new collection")} /></label>
      <div className="editorial__duas-colunas"><label>{traduzir("Canal", "Channel")}<select value={pauta.canal} onChange={e => setPauta({ ...pauta, canal: e.target.value })}>
        {['instagram', 'linkedin', 'tiktok', 'x', 'youtube', 'blog', 'email'].map(c => <option key={c}>{c}</option>)}
      </select></label><label>{traduzir("Data desejada", "Target date")}<input type="date" value={pauta.data_planejada} onChange={e => setPauta({ ...pauta, data_planejada: e.target.value })} /></label></div>
      <label>{traduzir("O que esta peça precisa comunicar?", "What does this deliverable need to communicate?")}<textarea rows={3} maxLength={12000} value={pauta.briefing} onChange={e => setPauta({ ...pauta, briefing: e.target.value })} placeholder={traduzir("Objetivo, público, mensagem, fatos e referências. A equipe também consulta o cânon da marca.", "Goal, audience, message, facts and references. The team also consults the confirmed brand knowledge.")} /></label>
      <button className="mesa-btn" disabled={ocupado || !pauta.titulo.trim()}>{ocupado ? traduzir("Salvando…", "Saving…") : traduzir("Guardar pauta", "Save brief")}</button>
    </form>}
    <div className="editorial__filtros" role="group" aria-label={traduzir("Filtrar peças", "Filter deliverables")}>
      {[['todas', traduzir("Todas", "All")], ...Object.entries(ESTADOS)].map(([v, nome]) => <button key={v} type="button" aria-pressed={filtro === v} onClick={() => setFiltro(v)}>{nome}</button>)}
    </div>
    {!!pecas?.length && <label className="lista-busca">{traduzir('Buscar trabalhos', 'Search work')}<input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder={traduzir('Título, canal ou assunto', 'Title, channel or topic')} /></label>}
    {!!visiveis.length && <p className="texto-suave" role="status">{traduzir(`${visiveis.length} trabalho(s) · mostrando ${Math.min(limite, visiveis.length)}`, `${visiveis.length} item(s) · showing ${Math.min(limite, visiveis.length)}`)}</p>}
    {!pecas && !erro && <p role="status">{traduzir("Abrindo calendário…", "Opening calendar…")}</p>}
    {pecas && !visiveis.length && <p className="editorial__vazio">{pecas.length ? traduzir("Nenhuma peça neste filtro.", "No deliverables match this filter.") : traduzir("Guarde a primeira pauta ou peça um lote de posts na conversa. As peças aparecerão aqui para revisão.", "Save your first brief or request a batch of posts in the conversation. Deliverables will appear here for review.")}</p>}
    <div className="editorial__lista">
      {visiveis.slice(0, limite).map(p => <article key={p.id} className="editorial__peca">
        <button type="button" className="editorial__linha" aria-expanded={aberta === p.id} onClick={() => setAberta(aberta === p.id ? null : p.id)}>
          <span className="editorial__data">{p.data_planejada ? new Date(`${p.data_planejada}T12:00:00`).toLocaleDateString(idioma, { day: '2-digit', month: '2-digit' }) : traduzir("Sem data", "No date")}</span>
          <span className="editorial__titulo"><strong>{p.titulo}</strong><small>{p.canal}{p.nova_revisao ? traduzir(" · nova revisão disponível", " · new revision available") : ''}{p.data_planejada && p.data_planejada < hoje && !p.publicado_em ? traduzir(" · data passou, confira a publicação", " · date has passed; check publication") : ''}</small></span>
          <span className={`editorial__estado editorial__estado--${p.estado}`}>{ESTADOS[p.estado]}</span><span aria-hidden="true">{aberta === p.id ? '−' : '+'}</span>
        </button>
        {aberta === p.id && <DetalhePeca key={p.id} peca={p} base={base} atualizar={atualizar} adaptar={(r, legenda) => {
          setPauta({ titulo: `${p.titulo} — adaptação`.slice(0, 200), canal: p.canal, data_planejada: '', briefing: `${p.briefing}\nAdapte a peça aprovada preservando os fatos e a oferta. Texto: ${legenda}\nArquivos: ${r.arquivos.map(a => `editorial/${p.id}/${r.id}/${a.nome}`).join(', ')}`.slice(0, 12000) })
          setNova(true); setAviso(traduzir("A pauta de adaptação está no formulário acima. Escolha o canal e salve.", "The adaptation brief is in the form above. Choose a channel and save."))
        }} />}
      </article>)}
    </div>
    {visiveis.length > limite && <button type="button" className="mesa-btn" onClick={() => setLimite(l => l + 24)}>{traduzir('Mostrar mais trabalhos', 'Show more work')}</button>}
    <p className="editorial__nota">{traduzir("A data organiza sua produção. A publicação na rede é feita por você.", "The date helps organize production. You publish on the social network yourself.")}</p>
  </section>
}

function DetalhePeca({ peca: p, base, atualizar, adaptar }: {
  peca: PecaEditorial; base: string; atualizar: () => Promise<void>; adaptar: (r: Revisao, texto: string) => void
}) {
  const { t: traduzir } = useIdioma()
  const metricasRotulos: Record<string, string> = { alcance: traduzir("alcance", "reach"), interacoes: traduzir("interações", "interactions"), cliques: traduzir("cliques", "clicks"), conversoes: traduzir("conversões", "conversions") }
  const [revisaoId, setRevisaoId] = useState(p.revisoes[0]?.id || 0)
  const [varianteEscolhida, setVariante] = useState(p.revisao_aprovada_id === revisaoId ? p.variante_aprovada : 0)
  const [ciencia, setCiencia] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const acaoEmCurso = useRef(false)
  const [ajustar, setAjustar] = useState(false)
  const [instrucao, setInstrucao] = useState('')
  const [escopo, setEscopo] = useState('texto')
  const [publicacao, setPublicacao] = useState(false)
  const [link, setLink] = useState(p.link_publicacao || '')
  const [metricas, setMetricas] = useState(p.metricas)
  const [data, setData] = useState(p.data_planejada || '')
  const [arquivoId, setArquivoId] = useState(0)
  const revisaoEscolhida = p.revisoes.find(v => v.id === revisaoId)
  // A primeira entrega já aparece neste render. Uma escolha ainda existente
  // permanece selecionada mesmo quando o polling acrescenta outra revisão.
  const r = revisaoEscolhida || p.revisoes[0]
  const idAtual = r?.id || 0
  const variante = revisaoEscolhida ? varianteEscolhida : (p.revisao_aprovada_id === idAtual ? p.variante_aprovada : 0)
  useEffect(() => {
    if (!revisaoEscolhida && revisaoId !== idAtual) {
      setRevisaoId(idAtual)
      setVariante(p.revisao_aprovada_id === idAtual ? p.variante_aprovada : 0)
      setArquivoId(0)
      setCiencia(null)
    }
  }, [revisaoEscolhida, revisaoId, idAtual, p.revisao_aprovada_id, p.variante_aprovada])
  const cienciaAtual = JSON.stringify([idAtual, variante, r?.qualidade?.avisos || []])
  const ciente = ciencia === cienciaAtual
  const estaAprovada = p.revisao_aprovada_id === idAtual && p.variante_aprovada === variante
  const aprovada = p.revisoes.find(v => v.id === p.revisao_aprovada_id)
  const texto = r?.legendas[variante]?.texto || ''
  const previas = r?.arquivos.filter(a => /image\/|html|video|audio|pdf/.test(a.mime || '') || /\.pdf$/i.test(a.nome)) || []
  const principal = previas.find(a => a.entrega_id === arquivoId) || previas.find(a => /image\//.test(a.mime || '')) || previas[0]
  const produziu = !!r?.arquivos.length
  async function agir(fn: () => Promise<unknown>, ok: string) {
    if (acaoEmCurso.current) return
    acaoEmCurso.current = true
    setOcupado(true); setErro(''); setMensagem('')
    try { await fn(); setMensagem(ok); await atualizar() }
    catch (e) { setErro(e instanceof Error ? e.message : traduzir("Não consegui concluir a ação.", "Could not complete the action.")) }
    finally { acaoEmCurso.current = false; setOcupado(false) }
  }
  const gerar = (pedido: string, alvo: string) => agir(async () => {
    await api.post(`${base}/${p.id}/gerar`, { instrucao: pedido, escopo: alvo, revisao_id: r?.id || null })
    setAjustar(false)
  }, aprovada
    ? traduzir("Peça na fila de produção. A versão aprovada continua disponível.", "Deliverable queued for production. The approved version remains available.")
    : r
      ? traduzir("Ajuste na fila de produção. A versão anterior continua disponível para revisão.", "Adjustment queued for production. The previous version remains available for review.")
      : traduzir("Peça na fila de produção.", "Deliverable queued for production."))
  return <div className="editorial__detalhe">
    {p.briefing && (r ? <details className="editorial__briefing">
      <summary>{traduzir("Ver pedido original", "View original brief")}</summary>
      <p>{p.briefing}</p>
    </details> : <p className="editorial__briefing">{p.briefing}</p>)}

    {p.job_status === 'failed' && <p role="status">{traduzir("A produção não terminou. Você pode tentar novamente com um pedido de ajuste.", "Production did not finish. You can try again with an adjustment request.")}</p>}
    {r && produziu && <>
      <div className="editorial__duas-colunas">
        <label>{traduzir("Revisão", "Revision")}<select value={idAtual} onChange={e => { const id = Number(e.target.value); setRevisaoId(id); setVariante(id === p.revisao_aprovada_id ? p.variante_aprovada : 0); setCiencia(null) }}>
          {p.revisoes.map((v, i) => <option key={v.id} value={v.id}>{traduzir("Versão", "Version")} {p.revisoes.length - i}{v.id === p.revisao_aprovada_id ? traduzir(" · aprovada", " · approved") : ''}</option>)}
        </select></label>
        <label>{traduzir("Legenda", "Caption")}<select value={variante} onChange={e => { setVariante(Number(e.target.value)); setCiencia(null) }}>{r.legendas.map((v, i) => <option key={i} value={i}>{v.nome}</option>)}</select></label>
      </div>
      <div className="editorial__resultado">
        <div>{previas.length > 1 && <label>{traduzir("Visualizar arte ou prévia", "View artwork or preview")}<select value={principal?.entrega_id || 0} onChange={e => setArquivoId(Number(e.target.value))}>{previas.map(a => <option key={a.entrega_id} value={a.entrega_id}>{a.nome}</option>)}</select></label>}{principal && <ResultadoEntrega entregaId={principal.entrega_id} nome={principal.nome} mime={principal.mime} tamanhoBytes={principal.tamanho_bytes} />}</div>
        <div><label>{traduzir("Texto pronto", "Ready-to-use text")}<textarea className="editorial__legenda" rows={8} value={texto} readOnly /></label>
          <button className="mesa-link" disabled={ocupado} onClick={() => void agir(() => navigator.clipboard.writeText(texto), traduzir("Legenda copiada.", "Caption copied."))}>{traduzir("Copiar legenda", "Copy caption")}</button>
          {aprovada && aprovada.id !== r.id && <details className="editorial__comparacao"><summary>{traduzir("Comparar com o texto aprovado", "Compare with approved text")}</summary><p>{aprovada.legendas[p.variante_aprovada]?.texto}</p><span>{traduzir("A arte e os arquivos anteriores estão na revisão aprovada do seletor.", "Previous artwork and files are available in the approved revision in the selector.")}</span></details>}
        </div>
      </div>
      {!!r.qualidade?.avisos?.length && <details className="editorial__qualidade"><summary>{traduzir(`${r.qualidade.avisos.length} ponto(s) para conferir antes de aprovar`, `${r.qualidade.avisos.length} item(s) to check before approval`)}</summary><ul>{r.qualidade.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul><p>{r.qualidade.nota}</p></details>}
      {!!r.qualidade?.avisos?.length && !estaAprovada && <label className="editorial__check"><input type="checkbox" checked={ciente} onChange={e => setCiencia(e.target.checked ? cienciaAtual : null)} /> {traduzir("Conferi os pontos desta revisão e aceito aprovar assim.", "I checked the issues in this revision and agree to approve it as it is.")}</label>}
      <div className="editorial__acoes">
        <button className="mesa-btn" disabled={ocupado} onClick={() => void agir(() => baixarArquivo(`${base}/${p.id}/kit?revisao_id=${r.id}&variante=${variante}`, `peca-${p.id}-revisao-${r.id}.zip`), traduzir("Download do kit iniciado com a legenda selecionada.", "Kit download started with the selected caption."))}>{traduzir("Baixar kit", "Download kit")}</button>
        {!p.publicado_em && <button className="mesa-btn" disabled={ocupado || (!!r.qualidade?.avisos?.length && !ciente && !estaAprovada) || estaAprovada} onClick={() => void agir(() => api.post(`${base}/${p.id}/aprovar`, { revisao_id: r.id, variante, ciente_pendencias: ciente }), traduzir("Peça aprovada.", "Deliverable approved."))}>{estaAprovada ? traduzir("Esta versão está aprovada", "This version is approved") : traduzir("Aprovar esta peça", "Approve this deliverable")}</button>}
        {aprovada && <button className="mesa-link" onClick={() => adaptar(aprovada, aprovada.legendas[p.variante_aprovada]?.texto || '')}>{traduzir("Adaptar para outro canal", "Adapt for another channel")}</button>}
      </div>
      <details><summary>{traduzir("Arquivos desta revisão", "Files in this revision")} ({r.arquivos.length})</summary><ul className="editorial__arquivos">{r.arquivos.map(a => <li key={a.entrega_id}><span>{a.nome}</span><button className="mesa-link" disabled={ocupado} onClick={() => void agir(() => baixarArquivo(`/entregas/${a.entrega_id}/download`, a.nome), traduzir("Arquivo baixado.", "File downloaded."))}>{traduzir("Baixar", "Download")}</button></li>)}</ul></details>
    </>}
    <div className="editorial__acoes">
      {!produziu && <button className="mesa-btn" disabled={ocupado || p.estado === 'em_producao'} onClick={() => void gerar('Produza esta pauta completa, com arte, legenda e prévia conforme o briefing.', 'completo')}>{p.estado === 'em_producao' ? traduzir("Em produção…", "In production…") : traduzir("Produzir esta pauta", "Produce this brief")}</button>}
      {produziu && !p.publicado_em && <button className="mesa-link" disabled={ocupado || p.estado === 'em_producao'} onClick={() => setAjustar(!ajustar)}>{p.estado === 'em_producao' ? traduzir("Ajuste em produção…", "Adjustment in production…") : traduzir("Pedir ajuste nesta peça", "Request an adjustment")}</button>}
      {aprovada && <button className="mesa-link" onClick={() => setPublicacao(!publicacao)}>{p.publicado_em ? traduzir("Publicação e resultados", "Publication and results") : traduzir("Registrar que publiquei", "Record publication")}</button>}
    </div>
    <details><summary>{traduzir("Organizar data", "Schedule date")}</summary>
    <div className="editorial__acoes"><label>{traduzir("Data desejada", "Target date")} <input aria-label={traduzir("Alterar data desejada", "Change target date")} type="date" value={data} onChange={e => setData(e.target.value)} /></label>
      <button className="mesa-link" disabled={ocupado || data === (p.data_planejada || '')} onClick={() => void agir(() => api.put(`${base}/${p.id}`, { titulo: p.titulo, canal: p.canal, briefing: p.briefing, data_planejada: data || null }), traduzir("Data atualizada.", "Date updated."))}>{traduzir("Salvar data", "Save date")}</button></div>
    </details>
    {ajustar && <form className="editorial__form" onSubmit={e => { e.preventDefault(); void gerar(instrucao, escopo) }}><label>{traduzir("O que deve mudar?", "What should change?")}<select value={escopo} onChange={e => setEscopo(e.target.value)}><option value="texto">{traduzir("Só o texto; manter a arte", "Text only; keep artwork")}</option><option value="imagem">{traduzir("Só a imagem; manter a legenda", "Image only; keep caption")}</option><option value="completo">{traduzir("Revisar a peça completa", "Revise the complete deliverable")}</option></select></label><label>{traduzir("Pedido de ajuste", "Adjustment request")}<textarea required value={instrucao} maxLength={6000} onChange={e => setInstrucao(e.target.value)} placeholder={traduzir("Ex.: trocar a chamada por uma frase mais direta, mantendo a oferta.", "E.g. use a more direct headline while keeping the offer.")} /></label><button className="mesa-btn" disabled={ocupado || !instrucao.trim() || p.estado === 'em_producao'}>{traduzir("Enviar ajuste", "Send adjustment")}</button></form>}
    {publicacao && <form className="editorial__form" onSubmit={e => { e.preventDefault(); void agir(() => api.post(`${base}/${p.id}/publicacao`, { link: link || null, metricas }), traduzir("Publicação registrada.", "Publication recorded.")) }}><p>{traduzir("Registre aqui a publicação que você fez na rede. Os resultados abaixo são informados por você.", "Record the post you published on the social network. You enter the results below.")}</p><label>{traduzir("Link da publicação (opcional)", "Publication link (optional)")}<input type="url" value={link} onChange={e => setLink(e.target.value)} /></label><div className="editorial__duas-colunas">{['alcance', 'interacoes', 'cliques', 'conversoes'].map(k => <label key={k}>{metricasRotulos[k]}<input type="number" min={0} value={metricas[k] ?? ''} onChange={e => setMetricas({ ...metricas, [k]: Number(e.target.value) })} /></label>)}</div><button className="mesa-btn" disabled={ocupado}>{traduzir("Salvar registro", "Save record")}</button></form>}
    {mensagem && <p role="status">{mensagem}</p>}{erro && <p role="alert" className="editorial__erro">{erro}</p>}
  </div>
}
