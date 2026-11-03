import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError, baixarArquivo, getSessionIdentity } from '../../lib/api'
import { useIdioma } from '../../lib/i18n'
import { formatDataHora } from '../../lib/format'
import type { Entrega, ReferenciaConversa } from '../../lib/types'
import { Icone, iconeDoArquivo } from '../Icone'
import MiniaturaArquivo from '../MiniaturaArquivo'
import ResultadoEntrega, { temResultadoVisivel, type PosicaoEntrega } from './ResultadoEntrega'
import SequenciaCarrossel from './SequenciaCarrossel'
import { ordenarArquivosCarrossel } from '../../lib/carrosselEntrega'
import { arquivoInicialEntrega } from '../../lib/arquivoInicialEntrega'
import { enderecoConversaEntrega, gruposEntregasConversa } from '../../lib/gruposEntregasConversa'
import { wsClient } from '../../lib/ws'
import { AgendaTab } from './AgendaTab'
import { useBiblioteca } from './useBiblioteca'
import { useMaisPedidos } from './useMaisPedidos'
import { useProducaoSegura } from './useProducaoSegura'
import { OrientacoesEntrega, type DevolutivaDoTrabalho } from './PainelTrabalho'
import { OrigemEntrega } from './OrigemEntrega'
import './biblioteca-projetos.css'
import './entregas-conversas.css'

export interface Projeto {
  id: number; nome: string; office_slug: string; objetivo: string; dados: Record<string, string>
  formatos: string[]; versao: number; arquivado: boolean; atualizado_em: string
}
interface Padrao { id: number; nome: string; job_id: number; office_slug: string; preservar: string; campos: string[] }
interface Resultado { id: number; entrega_id: number; metrica: string; valor: string; fonte: string; inicio: string; fim: string; registrado_em: string }
interface Trabalho {
  id: number; titulo: string; office_slug: string; projeto_id: number | null; projeto_nome: string | null
  referencia_job_id: number | null; favorito: boolean; aprovado: boolean; criado_em: string
  estado: 'pronto' | 'aprovado' | 'precisa_de_voce' | 'em_producao'; status: string
  finalizando?: boolean
  desatualizados: string[]; arquivos: Entrega[]; erro?: string; origem?: string | null
  devolutivas?: DevolutivaDoTrabalho[]
  conversa_id?: number | null; conversa_titulo?: string | null; conversa_office_slug?: string | null
  qualidade?: { estado: string; avisos: string[]; conferencias: { nome: string; conferida: boolean }[]; verificacoes?: { nome: string; estado: string; detalhe: string; evidencias?: string[] }[]; atualizado_em: string | null; revisao_automatica?: { estado: string; limites?: string; correcao_job_id?: number } | null }
  fontes?: { id: number; titulo: string }[]
  versoes_anteriores?: { id: number; titulo: string; criado_em: string }[]
  dados_utilizados?: Record<string, string>; objetivo_utilizado?: string; projeto_nome_utilizado?: string; resultados?: Resultado[]
  pecas_editoriais?: { id: number; titulo: string; revisao_id: number; legendas: { nome: string; texto: string }[]; aprovada: boolean; variante_aprovada?: number | null; pendencias: string[] }[]
}
interface Lista { itens: Trabalho[]; total: number; resumo: { prontos: number; precisa_de_voce: number; em_producao: number; aprovados: number }; atualizado_em: string }
interface AprovacaoVersao { jobId: number; officeSlug: string; origem?: string | null; conhecimentoAplicado: boolean }
const FORMATOS = ['video', 'imagem', 'pdf', 'apresentacao', 'documento', 'planilha', 'html', 'audio']
const NOMES_FORMATOS: Record<string, [string, string]> = { video: ['Vídeo', 'Video'], imagem: ['Imagem', 'Image'], pdf: ['PDF', 'PDF'], apresentacao: ['Apresentação', 'Presentation'], pptx: ['Apresentação', 'Presentation'], documento: ['Documento', 'Document'], docx: ['Documento', 'Document'], planilha: ['Planilha', 'Spreadsheet'], xlsx: ['Planilha', 'Spreadsheet'], html: ['Página web', 'Web page'], audio: ['Áudio', 'Audio'] }
const nomeFormato = (f: string, t: (pt: string, en: string) => string) => NOMES_FORMATOS[f] ? t(...NOMES_FORMATOS[f]) : f
const mudou = () => window.dispatchEvent(new Event('offiz:biblioteca-mudou'))
const mensagemErro = (e: unknown) => e instanceof Error ? e.message : String(e)
const idDaUrl = (valor: string | null) => valor && /^[1-9]\d*$/.test(valor) && Number.isSafeInteger(Number(valor)) ? Number(valor) : null
const FILTROS = ['todos', 'favoritos', 'aprovados', 'sem-projeto', 'arquivados']
const FORMATOS_FILTRO = ['video', 'imagem', 'pdf', 'pptx', 'docx', 'xlsx', 'html', 'audio']
const ABAS = ['trabalhos', 'padroes', 'rotinas', 'resultados']
const ESTADOS = ['pronto', 'em_producao', 'precisa_de_voce']

function useTelaAtiva() {
  const ativa = useRef(true)
  useEffect(() => { ativa.current = true; return () => { ativa.current = false } }, [])
  return ativa
}

interface BibliotecaProps {
  orgId: number; areaSlug?: string; andares: { slug: string; nome: string }[]; conversaId?: number | null; pedirNaConversa: (texto: string, referencia?: ReferenciaConversa) => void; podeConfigurar?: boolean
}
export default function BibliotecaProjetos(props: BibliotecaProps) {
  return <BibliotecaDaEmpresa key={`${getSessionIdentity()}:${props.orgId}:${props.areaSlug || "predio"}`} {...props} />
}

function AvisoConsulta({ erro, consultadoEm, repetir }: { erro?: string; consultadoEm?: string; repetir: () => void }) {
  const { t, idioma } = useIdioma()
  if (!erro) return null
  return <p role="alert">{erro}{consultadoEm && <> · {t('Exibindo a última consulta confirmada', 'Showing the last confirmed query')} (<time dateTime={consultadoEm}>{formatDataHora(consultadoEm, idioma)}</time>).</>} {' '}
    <button onClick={repetir}>{t('Tentar novamente', 'Try again')}</button>
  </p>
}

function BibliotecaDaEmpresa({ orgId, areaSlug, andares, conversaId, pedirNaConversa, podeConfigurar = false }: BibliotecaProps) {
  const { t, idioma } = useIdioma()
  const [params, setParams] = useSearchParams()
  const projetoId = idDaUrl(params.get('projeto'))
  const jobId = idDaUrl(params.get('trabalho'))
  const linkInvalido = (params.has('projeto') && !projetoId) || (params.has('trabalho') && !jobId)
  const busca = params.get('busca-pedidos') || ''
  const [buscaAplicada, setBuscaAplicada] = useState(busca)
  const filtro = FILTROS.includes(params.get('filtro-pedidos') || '') ? params.get('filtro-pedidos')! : 'todos'
  const formato = FORMATOS_FILTRO.includes(params.get('formato-pedidos') || '') ? params.get('formato-pedidos')! : ''
  const versoes = params.get('versoes-pedidos') === '1'
  const estado = ESTADOS.includes(params.get('estado') || '') ? params.get('estado')! : ''
  const [buscaProjeto, setBuscaProjeto] = useState('')
  const [todosProjetos, setTodosProjetos] = useState(false)
  const [selecionados, setSelecionados] = useState<Trabalho[]>([])
  const [destino, setDestino] = useState('')
  const [organizando, setOrganizando] = useState(false)
  const pagina = idDaUrl(params.get('pagina-pedidos')) || 1
  const offset = Number.isSafeInteger((pagina - 1) * 24) ? (pagina - 1) * 24 : 0
  const [revisao, setRevisao] = useState(0)
  const [formProjeto, setFormProjeto] = useState<Projeto | 'novo' | null>(null)
  const aba = ABAS.includes(params.get('biblioteca-aba') || '') ? params.get('biblioteca-aba')! : 'trabalhos'
  const [padrao, setPadrao] = useState<Padrao | null>(null)
  const [pedido, setPedido] = useState(false)
  const [erroAcao, setErroAcao] = useState('')
  const base = `/orgs/${orgId}`
  const atualizar = useCallback(() => setRevisao(r => r + 1), [])
  const atualizarFiltro = (chave: string, valor: string) => setParams(p => {
    const n = new URLSearchParams(p)
    if (valor) n.set(chave, valor); else n.delete(chave)
    n.delete('pagina-pedidos')
    return n
  }, { replace: true })
  const setAba = (valor: string) => setParams(p => {
    const n = new URLSearchParams(p)
    if (valor === 'trabalhos') n.delete('biblioteca-aba'); else n.set('biblioteca-aba', valor)
    return n
  })
  const mudarPagina = (diferenca: number) => setParams(p => {
    const n = new URLSearchParams(p)
    const proxima = Math.max(1, (idDaUrl(p.get('pagina-pedidos')) || 1) + diferenca)
    if (proxima === 1) n.delete('pagina-pedidos'); else n.set('pagina-pedidos', String(proxima))
    return n
  })
  useEffect(() => {
    if (busca === buscaAplicada) return
    const id = window.setTimeout(() => setBuscaAplicada(busca), 250)
    return () => window.clearTimeout(id)
  }, [busca, buscaAplicada])
  useEffect(() => {
    window.addEventListener('offiz:biblioteca-mudou', atualizar)
    window.addEventListener('offiz:entregas-mudou', atualizar)
    const off = wsClient.on('job_status', e => { if ('org_id' in e && e.org_id === orgId) atualizar() })
    return () => { off(); window.removeEventListener('offiz:biblioteca-mudou', atualizar); window.removeEventListener('offiz:entregas-mudou', atualizar) }
  }, [atualizar, orgId])
  const todosOsProjetos = useBiblioteca<Projeto[]>(`${base}/projetos`, revisao)
  const todosOsPadroes = useBiblioteca<Padrao[]>(`${base}/padroes`, revisao)
  const projetos = { ...todosOsProjetos, dados: todosOsProjetos.dados?.filter(p => !areaSlug || p.office_slug === areaSlug) }
  const padroes = { ...todosOsPadroes, dados: todosOsPadroes.dados?.filter(p => !areaSlug || p.office_slug === areaSlug) }
  const equipes = andares.filter(a => !areaSlug || a.slug === areaSlug)
  const query = new URLSearchParams({ busca: buscaAplicada, filtro, formato, estado, versoes: String(versoes), offset: String(offset), limite: '24' })
  if (areaSlug) query.set('office_slug', areaSlug)
  if (projetoId) query.set('projeto_id', String(projetoId))
  const lista = useBiblioteca<Lista>(`${base}/biblioteca?${query}`, revisao)
  const mais = useMaisPedidos(`${base}/biblioteca?${query}`, revisao, lista.dados?.itens || [], offset, lista.dados?.total || 0)
  const grupos = gruposEntregasConversa(mais.pedidos)
  const temMaisPedidos = mais.pedidos.length > (lista.dados?.itens.length || 0)
  const projeto = projetos.dados?.find(p => p.id === projetoId)
  const temFiltro = !!(buscaAplicada || filtro !== 'todos' || formato || estado)
  const limparFiltros = () => setParams(p => {
    const n = new URLSearchParams(p)
    for (const chave of ['busca-pedidos', 'filtro-pedidos', 'formato-pedidos', 'estado', 'pagina-pedidos']) n.delete(chave)
    return n
  }, { replace: true })
  const destinosPermitidos = projetos.dados?.filter(p => !p.arquivado && selecionados.every(j => j.office_slug === p.office_slug)) || []
  const destinoAtual = destinosPermitidos.some(p => String(p.id) === destino) ? destino : ''
  const consultaComErro = [projetos, lista, padroes].find(consulta => consulta.erro)
  const navegar = (chave: string, valor: number | null, arquivoId?: number) => {
    setParams(p => {
      const n = new URLSearchParams(p)
      if (valor) n.set(chave, String(valor)); else n.delete(chave)
      n.delete('biblioteca-aba')
      if (chave === 'trabalho' && arquivoId != null) n.set('arquivo', String(arquivoId))
      else n.delete('arquivo')
      if (chave === 'projeto') {
        n.delete('trabalho'); n.delete('pagina-pedidos')
        if (n.get('filtro-pedidos') === 'sem-projeto') n.delete('filtro-pedidos')
      }
      return n
    })
    setPedido(false); setFormProjeto(null)
    if (chave === 'projeto') { setTodosProjetos(false); setBuscaProjeto('') }
  }
  async function favoritar(j: Trabalho) {
    setErroAcao('')
    try { await api.put(`${base}/biblioteca/${j.id}/favorito`, { favorito: !j.favorito }); mudou() }
    catch (e) { setErroAcao(mensagemErro(e)) }
  }
  const conversaGeral = new URLSearchParams(params); conversaGeral.delete('slug'); conversaGeral.delete('area'); conversaGeral.delete('projeto'); conversaGeral.delete('trabalho'); conversaGeral.delete('estado'); conversaGeral.set('vista', 'biblioteca'); conversaGeral.set('org', String(orgId))
  conversaGeral.delete('arquivo')
  return <section className="offiz-biblioteca" data-detalhe={aba === "trabalhos" && !!jobId || undefined}>
    {areaSlug && <p className="biblioteca-contexto">{t("Trabalhos de", "Work from")} {equipes[0]?.nome || areaSlug}. <Link to={`/app?${conversaGeral}`}>{t("Ver pedidos de todas as áreas", "See requests from all teams")}</Link></p>}
    <div className="biblioteca-cabecalho">
      <div><h2>{projeto?.nome || t('Pedidos e entregas', 'Requests and deliverables')}</h2>
        <p>{projeto?.objetivo || t('Acompanhe os pedidos, revise as entregas e encontre suas versões anteriores.', 'Track requests, review deliverables, and find earlier versions.')}</p></div>
      <button className={`btn ${projeto ? 'btn--secundario' : 'btn--primario'}`} onClick={() => setFormProjeto('novo')}>{t('Novo projeto', 'New project')}</button>
    </div>
    <nav className="biblioteca-abas" aria-label={t('Organizar trabalhos', 'Organize work')}>
      {[["trabalhos", t('Todos os pedidos', 'All requests')], ['padroes', t('Meus padrões', 'My patterns')], ['rotinas', t('Rotinas', 'Routines')], ['resultados', t('Resultados', 'Results')]].map(([id, nome]) => <button key={id} aria-current={aba === id ? 'page' : undefined} onClick={() => { setAba(id); setPadrao(null) }}>{nome}</button>)}
    </nav>
    {erroAcao && <p role="alert">{erroAcao}</p>}
    {linkInvalido && <p role="alert">{t('Este link de pedido ou projeto é inválido.', 'This request or project link is invalid.')} <button onClick={() => setParams(p => { const n = new URLSearchParams(p); if (!idDaUrl(p.get('trabalho'))) { n.delete('trabalho'); n.delete('arquivo') }; if (!idDaUrl(p.get('projeto'))) n.delete('projeto'); return n }, { replace: true })}>{t('Ver os pedidos disponíveis', 'See available requests')}</button></p>}
    <AvisoConsulta erro={consultaComErro?.erro} consultadoEm={consultaComErro?.consultadoEm} repetir={atualizar} />
    {formProjeto && <FormProjeto key={typeof formProjeto === 'string' ? 'novo' : formProjeto.id} base={base} projeto={formProjeto === 'novo' ? undefined : formProjeto} andares={equipes}
      fechar={() => setFormProjeto(null)} salvar={p => { mudou(); setFormProjeto(null); navegar('projeto', p.id) }} />}
    {aba === 'rotinas' ? <RotinasMateriais areaSlug={areaSlug} base={base} orgId={orgId} projetos={projetos.dados || []} andares={equipes} podeConfigurar={podeConfigurar} revisao={revisao} abrir={id => navegar('trabalho', id)} /> : aba === 'resultados' ? <ResultadosBiblioteca areaSlug={areaSlug} base={base} revisao={revisao} abrir={(id, arquivoId) => navegar('trabalho', id, arquivoId)} pedirNaConversa={pedirNaConversa} /> : aba === 'padroes' ? <>
      <p>{t('Guarde uma versão aprovada e diga o que deve permanecer nos próximos trabalhos.', 'Save an approved version and describe what should stay in future work.')}</p>
      {!padroes.dados ? <p role="status">{t('Carregando padrões…', 'Loading patterns…')}</p> : !padroes.dados.length ? <div className="biblioteca-vazio"><Icone nome="arq-pasta" tamanho={32} /><h3>{t('Gostou de uma entrega?', 'Like a deliverable?')}</h3><p>{t('Abra o trabalho aprovado e escolha “Usar como padrão”.', 'Open the approved work and choose “Save as pattern”.')}</p></div> : <div className="biblioteca-padroes">{padroes.dados.map(p => <article key={p.id}><h3>{p.nome}</h3><p>{p.preservar || t('Referência aprovada preservada.', 'Approved reference preserved.')}</p><small>{p.campos.join(', ')}</small><button className="btn btn--secundario" onClick={() => setPadrao(p)}>{t('Fazer o próximo assim', 'Make the next one like this')}</button></article>)}</div>}
      {padrao && <FormProducao key={padrao.id} base={base} padrao={padrao} projeto={projeto?.office_slug === padrao.office_slug && !projeto.arquivado ? projeto : undefined} conversaId={conversaId} fechar={() => setPadrao(null)} salvar={id => { mudou(); setPadrao(null); navegar('trabalho', id) }} />}
    </> : <>
      <div className="biblioteca-filtros">
        <label className="biblioteca-busca"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input type="search" aria-label={t('Buscar projetos e entregas', 'Search projects and deliverables')} value={busca} onChange={e => atualizarFiltro('busca-pedidos', e.target.value)} placeholder={t('Busque pelo trabalho, projeto ou arquivo', 'Search work, project or file')} /></label>
        <select aria-label={t('Filtrar trabalhos', 'Filter work')} value={filtro} onChange={e => atualizarFiltro('filtro-pedidos', e.target.value === 'todos' ? '' : e.target.value)}>
          {[['todos', t('Todos os trabalhos', 'All work')], ['favoritos', t('Meus favoritos', 'My favorites')], ['aprovados', t('Aprovados', 'Approved')], ['sem-projeto', t('Sem projeto', 'Without a project')], ['arquivados', t('Arquivados', 'Archived')]].map(([v, s]) => <option key={v} value={v}>{s}</option>)}
        </select>
        <select aria-label={t('Formato', 'Format')} value={formato} onChange={e => atualizarFiltro('formato-pedidos', e.target.value)}><option value="">{t('Todos os formatos', 'All formats')}</option>{['video', 'imagem', 'pdf', 'pptx', 'docx', 'xlsx', 'html', 'audio'].map(f => <option key={f} value={f}>{nomeFormato(f, t)}</option>)}</select>
      </div>
      {!jobId && <div className="biblioteca-estados" role="group" aria-label={t('Situação dos pedidos', 'Request status')}>
        <span>{t('Situação', 'Status')}</span>
        {[["", t('Todas', 'All')], ['pronto', t('Para revisar', 'To review')], ['em_producao', t('Em produção', 'In production')], ['precisa_de_voce', t('Precisa de você', 'Needs your input')]].map(([id, nome]) => <button key={id} aria-pressed={estado === id} onClick={() => atualizarFiltro('estado', id)}>{nome}</button>)}
        {temFiltro && <button className="biblioteca-limpar" onClick={limparFiltros}>{t('Limpar filtros', 'Clear filters')}</button>}
      </div>}
      <div className="biblioteca-projetos" aria-label={t('Projetos', 'Projects')}>
        <button className={!projetoId ? 'selecionado' : ''} onClick={() => navegar('projeto', null)}>{t('Todos os projetos', 'All projects')}</button>
        <button className={projeto ? 'selecionado' : ''} disabled={!projetos.dados?.length} aria-expanded={todosProjetos} onClick={() => setTodosProjetos(v => !v)}><Icone nome="arq-pasta" tamanho={15} />{projeto?.nome || t('Escolher projeto', 'Choose project')} ▾</button>
      </div>
      {todosProjetos && <div className="biblioteca-seletor-projeto"><label>{t('Buscar um projeto', 'Find a project')}<input autoFocus type="search" value={buscaProjeto} onChange={e => setBuscaProjeto(e.target.value)} /></label><div>{projetos.dados?.filter(p => p.arquivado === (filtro === 'arquivados') && p.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(buscaProjeto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())).map(p => <button key={p.id} onClick={() => navegar('projeto', p.id)}>{p.nome}</button>)}</div></div>}
      <div className="biblioteca-opcoes-lista"><label className="biblioteca-check"><input type="checkbox" checked={versoes} onChange={e => atualizarFiltro('versoes-pedidos', e.target.checked ? '1' : '')} />{t('Incluir versões anteriores', 'Include earlier versions')}</label>{params.get('estado') && <button onClick={() => atualizarFiltro('estado', '')}>{t('Remover filtro de situação', 'Clear status filter')} ×</button>}</div>
      {projeto && <div className="biblioteca-projeto-dados">
        <div>{projeto.arquivado ? <strong>{t('Projeto arquivado', 'Archived project')}</strong> : <button className="btn btn--primario" onClick={() => setPedido(true)}>{t('Novo trabalho neste projeto', 'New work in this project')}</button>}
          <button className="btn btn--secundario" onClick={() => setFormProjeto(projeto)}>{t('Organizar projeto', 'Organize project')}</button></div>
        {projeto.formatos.length > 0 && <CoberturaProjeto base={base} projeto={projeto} revisao={revisao} />}
        {!!Object.keys(projeto.dados).length && <details><summary>{t('Informações usadas nas próximas entregas', 'Information for the next deliverables')}</summary><dl>{Object.entries(projeto.dados).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl></details>}
        {!projeto.arquivado && <ImpactoProjeto key={`${projeto.id}:${projeto.versao}`} base={base} projeto={projeto} conversaId={conversaId} revisao={revisao} />}
      </div>}
      {pedido && projeto && <FormProducao base={base} projeto={projeto} conversaId={conversaId} fechar={() => setPedido(false)} salvar={id => { mudou(); navegar('trabalho', id) }} />}
      {jobId ? <DetalheTrabalho areaSlug={areaSlug} key={`${orgId}:${jobId}`} base={base} jobId={jobId} projetos={projetos.dados || []} revisao={revisao} conversaId={conversaId} fechar={() => navegar('trabalho', null)} abrir={id => navegar('trabalho', id)} favoritar={favoritar} pedirNaConversa={pedirNaConversa} /> : <>
        {!lista.dados && !lista.erro && <p role="status">{t('Abrindo sua biblioteca…', 'Opening your library…')}</p>}
        {lista.dados?.total === 0 && <div className="biblioteca-vazio"><Icone nome="arq-pasta" tamanho={36} /><h3>{temFiltro ? t('Nenhum trabalho com esses filtros', 'No work matches these filters') : t('Um lugar para o seu próximo trabalho', 'A place for your next work')}</h3><p>{temFiltro ? t('Tente outro nome ou retire um filtro.', 'Try another name or remove a filter.') : projeto?.arquivado ? t('Não há trabalhos neste projeto arquivado.', 'There is no work in this archived project.') : projeto ? t('Peça o primeiro trabalho no botão “Novo trabalho neste projeto”. As entregas e suas versões ficarão aqui.', 'Request your first task with “New work in this project”. Deliverables and their versions will appear here.') : t('Crie um projeto ou organize os trabalhos que já estão em “Sem projeto”.', 'Create a project or organize the work under “Without a project”.')}</p></div>}
        {!!lista.dados?.total && <details className="biblioteca-organizar"><summary>{t('Organizar vários trabalhos', 'Organize multiple jobs')}{selecionados.length > 0 ? ` · ${selecionados.length}` : ''}</summary><p>{t('Marque até 60 trabalhos e escolha o projeto. Versões e aprovações permanecem guardadas.', 'Select up to 60 jobs and choose a project. Versions and approvals stay saved.')}</p><div className="biblioteca-acoes"><button disabled={organizando} onClick={() => setSelecionados(lista.dados!.itens.filter(j => !j.finalizando && !['queued', 'running'].includes(j.status)))}>{temMaisPedidos ? t(`Selecionar primeiros ${lista.dados!.itens.length} pedidos`, `Select first ${lista.dados!.itens.length} requests`) : t('Selecionar esta página', 'Select this page')}</button><button disabled={organizando || !selecionados.length} onClick={() => setSelecionados([])}>{t('Limpar seleção', 'Clear selection')}</button></div>{selecionados.length > 0 && <><small>{selecionados.map(j => j.titulo).join(' · ')}</small><label>{t('Destino dos trabalhos selecionados', 'Selected work destination')}<select value={destinoAtual} disabled={organizando} onChange={e => setDestino(e.target.value)}><option value="">{t('Sem projeto', 'Without a project')}</option>{destinosPermitidos.map(p => <option value={p.id} key={p.id}>{p.nome}</option>)}</select></label><button className="btn--primario" disabled={organizando} onClick={async () => { setOrganizando(true); setErroAcao(''); try { await api.post(`${base}/biblioteca/organizar`, { jobs: selecionados.map(j => j.id), projeto_id: Number(destinoAtual) || null }); setSelecionados([]); mudou() } catch(e) { setErroAcao(mensagemErro(e)) } finally { setOrganizando(false) } }}>{t(`Guardar ${selecionados.length} trabalhos`, `Save ${selecionados.length} jobs`)}</button></>}</details>}
        <div className="biblioteca-lista biblioteca-lista--conversas">{grupos.map(grupo => {
          const titulo = grupo.conversaId === null ? t('Sem conversa vinculada', 'No linked conversation') : grupo.titulo || t(`Conversa #${grupo.conversaId}`, `Conversation #${grupo.conversaId}`)
          return <section key={grupo.chave} className="biblioteca-conversa-grupo" aria-label={titulo}>
          <header className="biblioteca-conversa-cabecalho"><div><h3><Icone nome="conversa" tamanho={18} />{titulo}</h3><span>{t(`${grupo.pedidos.length} pedido${grupo.pedidos.length === 1 ? '' : 's'} carregado${grupo.pedidos.length === 1 ? '' : 's'}`, `${grupo.pedidos.length} loaded request${grupo.pedidos.length === 1 ? '' : 's'}`)}</span></div>
            {grupo.conversaId !== null && <Link className="biblioteca-conversa-link" to={enderecoConversaEntrega(orgId, grupo.conversaId, grupo.officeSlug)}>{t('Ver conversa', 'View conversation')}</Link>}
          </header>
          {grupo.pedidos.map(j => {
            const principal = arquivoInicialEntrega(j.arquivos)
            return <article key={j.id} className="biblioteca-trabalho">
          <input className="biblioteca-selecao" type="checkbox" aria-label={`${t('Selecionar', 'Select')} ${j.titulo}`} disabled={j.finalizando || ['queued', 'running'].includes(j.status) || organizando || (selecionados.length >= 60 && !selecionados.some(s => s.id === j.id))} checked={selecionados.some(s => s.id === j.id)} onChange={e => setSelecionados(v => e.target.checked ? [...v, j] : v.filter(s => s.id !== j.id))} />
          <button className="biblioteca-abrir" onClick={() => navegar('trabalho', j.id)}><MiniaturaArquivo className="biblioteca-miniatura" caminho={principal ? `/entregas/${principal.id}/miniatura` : ''} nome={principal?.nome || ''} /><div><strong>{j.titulo}</strong><span>{j.projeto_nome || t('Sem projeto', 'Without a project')} · {j.arquivos.length} {j.arquivos.length === 1 ? t('arquivo', 'file') : t('arquivos', 'files')}{j.referencia_job_id ? ` · ${t('Nova versão', 'New version')}` : ''}</span><small>{andares.find(a => a.slug === j.office_slug)?.nome || j.office_slug} · {formatDataHora(j.criado_em, idioma)}</small>{!!j.desatualizados.length && <small className="biblioteca-pendente">{t('Informações mudaram:', 'Information changed:')} {j.desatualizados.join(', ')}</small>}</div></button>
          <EstadoTrabalho estado={j.estado} status={j.status} finalizando={j.finalizando} /><button className="biblioteca-favorito" aria-label={j.favorito ? t('Remover dos favoritos', 'Remove from favorites') : t('Guardar nos favoritos', 'Save to favorites')} aria-pressed={j.favorito} onClick={() => void favoritar(j)}>{j.favorito ? '★' : '☆'}</button>
        </article>})}</section>})}</div>
        {mais.falhou && <p role="alert" className="biblioteca-carregar-erro">{t('Não consegui abrir os próximos pedidos. Os que você já carregou continuam aqui.', 'Could not load the next requests. The ones you already loaded remain here.')}</p>}
        {mais.podeCarregar && <div className="biblioteca-carregar-mais"><button type="button" disabled={mais.ocupado || !!lista.erro} onClick={() => void mais.carregar()}>{mais.ocupado ? t('Carregando pedidos…', 'Loading requests…') : mais.falhou ? t('Tentar carregar mais pedidos', 'Try loading more requests') : t('Mostrar mais pedidos', 'Show more requests')}</button><small>{t('Os pedidos da mesma conversa ficam juntos conforme você carrega.', 'Requests from the same conversation stay together as you load them.')}</small></div>}
        {!!lista.dados?.total && <div className="biblioteca-paginacao"><span>{offset + 1}–{Math.min(offset + mais.pedidos.length, lista.dados.total)} {t('de', 'of')} {lista.dados.total}</span>{!temMaisPedidos && <><button disabled={!offset} onClick={() => mudarPagina(-1)}>{t('Anterior', 'Previous')}</button><button disabled={offset + 24 >= lista.dados.total} onClick={() => mudarPagina(1)}>{t('Próxima', 'Next')}</button></>}</div>}
      </>}
    </>}
  </section>
}

function EstadoTrabalho({ estado, status, finalizando }: { estado: Trabalho['estado']; status: Trabalho['status']; finalizando?: boolean }) {
  const { t } = useIdioma()
  const nomes = { pronto: t('Pronto para você', 'Ready for you'), aprovado: t('Aprovado', 'Approved'), precisa_de_voce: t('Precisa de você', 'Needs your input'), em_producao: t('Em produção', 'In production') }
  return <span className={`biblioteca-estado biblioteca-estado--${estado}`}>{finalizando ? t('Organizando arquivos', 'Organizing files') : status === 'cancelled' ? t('Interrompido', 'Stopped') : nomes[estado]}</span>
}

function CoberturaProjeto({ base, projeto, revisao }: { base: string; projeto: Projeto; revisao: number }) {
  const { t } = useIdioma()
  const [tentativa, setTentativa] = useState(0)
  const { dados, erro, consultadoEm } = useBiblioteca<{ formatos: { nome: string; disponivel: boolean }[] }>(`${base}/projetos/${projeto.id}/cobertura`, revisao + tentativa)
  return <div className="biblioteca-cobertura"><p>{t('Formatos do projeto', 'Project formats')}</p><AvisoConsulta erro={erro} consultadoEm={consultadoEm} repetir={() => setTentativa(v => v + 1)} /><div>{(dados?.formatos || projeto.formatos.map(nome => ({ nome, disponivel: false }))).map(f => <span key={f.nome}>{dados ? f.disponivel ? '✓' : '○' : '…'} {nomeFormato(f.nome, t)} <small>{dados ? f.disponivel ? t('disponível', 'available') : t('a entregar', 'to deliver') : erro ? t('consulta indisponível', 'query unavailable') : t('consultando', 'loading')}</small></span>)}</div><small>{t('Disponível significa que há um arquivo entregue. A conferência e a aprovação aparecem em cada versão.', 'Available means there is a delivered file. Checks and approval appear on each version.')}</small></div>
}

function FormProjeto({ base, projeto, andares, fechar, salvar }: { base: string; projeto?: Projeto; andares: { slug: string; nome: string }[]; fechar: () => void; salvar: (p: Projeto) => void }) {
  const { t } = useIdioma()
  const sessao = useRef(getSessionIdentity()).current
  const contexto = JSON.stringify([base, projeto?.id ?? null])
  const atual = useRef<string | null>(contexto)
  const viva = useRef(false)
  const revisao = useRef(0)
  const trava = useRef<symbol | null>(null)
  useLayoutEffect(() => {
    viva.current = true; atual.current = contexto
    return () => { viva.current = false; atual.current = null; trava.current = null }
  }, [contexto])
  const [nome, setNome] = useState(projeto?.nome || '')
  const [objetivo, setObjetivo] = useState(projeto?.objetivo || '')
  const [slug, setSlug] = useState(projeto?.office_slug || andares[0]?.slug || '')
  const [formatos, setFormatos] = useState(projeto?.formatos || [])
  const [campos, setCampos] = useState(Object.entries(projeto?.dados || {}))
  const [arquivado, setArquivado] = useState(projeto?.arquivado || false)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const vigente = () => viva.current && atual.current === contexto && sessao === getSessionIdentity()
  async function enviarProjeto() {
    if (!viva.current || trava.current) return
    if (!vigente()) { setErro(t('Sua conta mudou. Reabra o formulário antes de salvar.', 'Your account changed. Reopen the form before saving.')); return }
    if (new Set(campos.map(([k]) => k.trim())).size !== campos.length) { setErro(t('Use um nome diferente para cada informação.', 'Use a different name for each field.')); return }
    const operacao = Symbol(); trava.current = operacao
    const enviada = revisao.current
    const body = { nome, objetivo, office_slug: slug, formatos: [...formatos], dados: Object.fromEntries(campos.map(([k, v]) => [k.trim(), v])), arquivado, versao: projeto?.versao }
    setSalvando(true); setErro('')
    try {
      const salvo = projeto ? await api.put<Projeto>(`${base}/projetos/${projeto.id}`, body) : await api.post<Projeto>(`${base}/projetos`, body)
      if (typeof salvo?.id !== 'number' || !Number.isSafeInteger(salvo.id) || salvo.id < 1 || (projeto && salvo.id !== projeto.id)) throw new Error(t('A resposta de salvamento está incompleta.', 'The save response is incomplete.'))
      if (vigente() && revisao.current === enviada) salvar(salvo)
    } catch (e) {
      if (vigente() && revisao.current === enviada) setErro(e instanceof ApiError && e.status > 0 && e.status < 500 && e.status !== 408 ? mensagemErro(e)
        : `${mensagemErro(e)} ${t('Não foi possível confirmar o salvamento. Antes de tentar novamente, confira os projetos.', 'Saving could not be confirmed. Before trying again, check the projects.')}`)
    } finally {
      // Release this request without changing a draft edited while it ran.
      if (trava.current === operacao) { trava.current = null; if (vigente()) setSalvando(false) }
    }
  }
  return <form className="biblioteca-form" onChange={() => { revisao.current++; setErro('') }} onSubmit={e => { e.preventDefault(); void enviarProjeto() }}>
    <h3>{projeto ? t('Organizar projeto', 'Organize project') : t('Novo projeto', 'New project')}</h3>
    <label>{t('Nome do projeto', 'Project name')}<input autoFocus required maxLength={160} value={nome} onChange={e => setNome(e.target.value)} placeholder={t('Ex.: Lançamento de setembro', 'E.g. September launch')} /></label>
    <label>{t('O que queremos entregar?', 'What do we want to deliver?')}<textarea maxLength={3000} value={objetivo} onChange={e => setObjetivo(e.target.value)} /></label>
    {!projeto && andares.length > 1 && <label>{t('Equipe responsável', 'Responsible team')}<select value={slug} onChange={e => setSlug(e.target.value)}>{andares.map(a => <option key={a.slug} value={a.slug}>{a.nome}</option>)}</select></label>}
    <fieldset><legend>{t('Formatos combinados', 'Expected formats')}</legend><div className="biblioteca-checks">{FORMATOS.map(f => <label key={f}><input type="checkbox" checked={formatos.includes(f)} onChange={e => setFormatos(v => e.target.checked ? [...v, f] : v.filter(x => x !== f))} />{nomeFormato(f, t)}</label>)}</div></fieldset>
    <fieldset><legend>{t('Informações que precisam ser iguais nas peças', 'Information that must match across deliverables')}</legend>
      {campos.map(([k, v], i) => <div className="biblioteca-campo-par" key={i}><input required maxLength={80} aria-label={`${t('Nome da informação', 'Field name')} ${i + 1}`} placeholder={t('Ex.: Data da promoção', 'E.g. Promotion date')} value={k} onChange={e => setCampos(c => c.map((p, n) => n === i ? [e.target.value, p[1]] : p))} /><input maxLength={1000} aria-label={`${t('Valor', 'Value')} ${i + 1}`} value={v} onChange={e => setCampos(c => c.map((p, n) => n === i ? [p[0], e.target.value] : p))} /><button type="button" aria-label={`${t('Remover informação', 'Remove field')} ${i + 1}`} onClick={() => { revisao.current++; setCampos(c => c.filter((_, n) => n !== i)) }}>×</button></div>)}
      <button type="button" disabled={campos.length >= 20} onClick={() => { revisao.current++; setCampos(c => [...c, ['', '']]) }}>{t('Adicionar informação', 'Add information')}</button>
    </fieldset>
    {projeto && <label className="biblioteca-check"><input type="checkbox" checked={arquivado} onChange={e => setArquivado(e.target.checked)} />{t('Arquivar projeto. As entregas ficam guardadas e você pode restaurar depois.', 'Archive project. Deliverables stay saved and you can restore it later.')}</label>}
    {projeto && <p>{t('Salvar atualiza os dados do projeto. As versões produzidas continuam preservadas; as afetadas serão sinalizadas para atualização.', 'Saving updates project information. Existing versions remain preserved; affected work will be flagged for an update.')}</p>}
    {erro && <p role="alert">{erro}</p>}<div className="biblioteca-acoes"><button disabled={salvando || !nome.trim()} className="btn btn--primario">{salvando ? t('Salvando…', 'Saving…') : t('Salvar projeto', 'Save project')}</button><button type="button" onClick={() => { revisao.current++; fechar() }}>{t('Cancelar', 'Cancel')}</button></div>
  </form>
}

function FormProducao({ base, projeto, padrao, referencia, conversaId, fechar, salvar }: { base: string; projeto?: Projeto; padrao?: Padrao; referencia?: Trabalho; conversaId?: number | null; fechar: () => void; salvar: (id: number) => void }) {
  const { t, idioma } = useIdioma()
  const [pedido, setPedido] = useState(referencia?.desatualizados.length ? t(`Atualize ${referencia.desatualizados.join(', ')} nas peças, preservando o restante.`, `Update ${referencia.desatualizados.join(', ')} in the deliverables, preserving the rest.`) : '')
  const [dados, setDados] = useState<Record<string, string>>(projeto?.dados || Object.fromEntries(padrao?.campos.map(k => [k, '']) || []))
  const [escopo, setEscopo] = useState('completo')
  const officeSlug = referencia?.office_slug || padrao?.office_slug || projeto?.office_slug
  const envio = useProducaoSegura(base, JSON.stringify([officeSlug, projeto?.id || null, padrao?.id || null, referencia?.id || null, conversaId || null]), officeSlug, salvar)
  return <form className="biblioteca-form" onSubmit={e => { e.preventDefault(); if (envio.podeEditar && pedido.trim()) void envio.enviar({ pedido, dados, escopo, projeto_id: projeto?.id || null, padrao_id: padrao?.id || null, referencia_job_id: referencia?.id || null, office_slug: officeSlug, conversa_id: conversaId || null }) }}>
    <h3>{padrao ? padrao.nome : referencia ? t('Preparar uma nova versão', 'Prepare a new version') : t('Novo trabalho', 'New work')}</h3>
    {padrao && <p>{t('A produção recebe os arquivos exatos da versão aprovada e as orientações abaixo.', 'Production receives the exact approved files and the instructions below.')} {padrao.preservar}</p>}
    {Array.from(new Set([...Object.keys(dados), ...(padrao?.campos || [])])).map(k => <label key={k}>{k}<input disabled={!envio.podeEditar} required={padrao?.campos.includes(k)} value={dados[k] || ''} maxLength={1000} onChange={e => setDados(d => ({ ...d, [k]: e.target.value }))} /></label>)}
    {referencia && <label>{t('O que pode mudar?', 'What may change?')}<select disabled={!envio.podeEditar} value={escopo} onChange={e => setEscopo(e.target.value)}><option value="completo">{t('A peça completa', 'The complete deliverable')}</option><option value="texto">{t('Texto; manter a arte', 'Text; keep artwork')}</option><option value="imagem">{t('Imagem; manter o texto', 'Image; keep text')}</option><option value="cena">{t('Uma cena do vídeo', 'One video scene')}</option></select></label>}
    <label>{t('Qual resultado você precisa?', 'What result do you need?')}<textarea autoFocus disabled={!envio.podeEditar} required maxLength={6000} value={pedido} onChange={e => setPedido(e.target.value)} placeholder={t('Descreva o trabalho ou o ajuste.', 'Describe the work or adjustment.')} /></label>
    <p>{t('O Offiz prepara uma nova entrega. As anteriores e suas aprovações continuam guardadas.', 'Offiz prepares a new deliverable. Previous versions and approvals stay saved.')}</p>
    {envio.identificando && <p role="status">{t('Conferindo a conta e os pedidos já enviados…', 'Checking the account and submitted requests…')}</p>}
    {envio.temEnvioPendente && !envio.erro && <p role="status">{t('Há um envio para conferir. A consulta recupera esse pedido sem produzir novamente.', 'There is a submission to check. Checking recovers this request without producing it again.')}</p>}
    {envio.precisaEscolherEnvio && <fieldset>
      <legend>{t('Qual envio você quer conferir?', 'Which submission do you want to check?')}</legend>
      <p>{t('Escolha um envio pendente deste projeto para consultar, ou prepare outro pedido separado.', 'Choose a pending submission for this project to check, or prepare a separate request.')}</p>
      {envio.enviosPendentes.map((recibo, i) => <button key={recibo.requestId} type="button" onClick={() => envio.selecionarEnvio(recibo.requestId)}>
        {t(`Selecionar envio ${i + 1}`, `Select submission ${i + 1}`)}{recibo.criadoEm && <> · <time dateTime={recibo.criadoEm}>{formatDataHora(recibo.criadoEm, idioma)}</time></>}
      </button>)}
    </fieldset>}
    {envio.erro && <p role="alert">{envio.erro}</p>}
    <div className="biblioteca-acoes">
      {envio.precisaVerificarConta ? <button type="button" className="btn btn--primario" onClick={() => void envio.verificarConta()}>{t('Tentar verificar a conta', 'Try checking the account')}</button>
        : envio.precisaEscolherEnvio ? null
        : envio.temEnvioPendente || envio.estado === 'consultando' ? <button type="button" className="btn btn--primario" disabled={envio.ocupado} onClick={() => void envio.conferir()}>{envio.ocupado ? t('Conferindo envio…', 'Checking submission…') : t('Conferir envio', 'Check submission')}</button>
        : envio.estado === 'removido' ? <button key="preparar-novo" type="button" onClick={e => { e.preventDefault(); envio.prepararNovo() }}>{t('Preparar um novo pedido', 'Prepare a new request')}</button>
          : <button className="btn btn--primario" disabled={envio.ocupado || !envio.podeEditar || !pedido.trim()}>{envio.ocupado ? t('Preparando…', 'Preparing…') : envio.estado === 'repetir' ? t('Reenviar pedido', 'Resend request') : t('Pode produzir', 'Start production')}</button>}
      {(envio.temEnvioPendente || envio.precisaEscolherEnvio) && <button type="button" onClick={envio.prepararOutro}>{t('Preparar outro pedido', 'Prepare another request')}</button>}
      <button type="button" onClick={() => { envio.sair(); fechar() }}>{envio.estado === 'pronto' ? t('Cancelar', 'Cancel') : t('Fechar', 'Close')}</button>
    </div>
    {(envio.temEnvioPendente || envio.precisaEscolherEnvio) && <p className="texto-suave">{t('Preparar outro pedido mantém os envios anteriores guardados. A produção só começa quando você enviar o novo pedido.', 'Preparing another request keeps earlier submissions saved. Production only starts when you submit the new request.')}</p>}
  </form>
}

function FormAjuste({ base, j, principal, peca, posicao, conversaId, texto, setTexto, escopo, setEscopo, apontando, setApontando, ocupado, fechar, salvar }: {
  base: string; j: Trabalho; principal: Entrega; peca?: { titulo: string }; posicao: { entregaId: number; ponto: PosicaoEntrega }; conversaId?: number | null
  texto: string; setTexto: (valor: string) => void; escopo: string; setEscopo: (valor: string) => void
  apontando: boolean; setApontando: (valor: boolean | ((anterior: boolean) => boolean)) => void; ocupado: boolean; fechar: () => void; salvar: (id: number) => void
}) {
  const { t, idioma } = useIdioma()
  const conversaDoEnvio = useRef<{ id: number | null } | null>(null)
  const envio = useProducaoSegura(base, JSON.stringify(['ajuste', j.office_slug, j.id, principal.id]), j.office_slug, salvar, {
    rota: `${base}/biblioteca/${j.id}/ajustes`,
    extrairId: r => r && typeof r === 'object' && 'job_id' in r ? r.job_id : null,
    alvoAnteriorCompativel: salvo => {
      try {
        const v: unknown = JSON.parse(salvo)
        return Array.isArray(v) && v.length === 5 && v[0] === 'ajuste' && v[1] === j.office_slug && v[2] === j.id && v[3] === principal.id
          && (v[4] === null || typeof v[4] === 'number' && Number.isSafeInteger(v[4]) && v[4] > 0)
      } catch { return false }
    },
  })
  return <form className="biblioteca-form" onSubmit={e => {
    e.preventDefault()
    if (!ocupado && envio.podeEditar && texto.trim()) {
      setApontando(false)
      // O histórico pode chegar depois do envio. Um retry da mesma intenção
      // conserva o vínculo que foi enviado, sem persistir o texto no navegador.
      conversaDoEnvio.current ??= { id: conversaId || null }
      void envio.enviar({ entrega_id: posicao.entregaId, ...posicao.ponto, escopo, texto: texto.trim(), conversa_id: conversaDoEnvio.current.id })
    }
  }}>
      <h3>{peca ? t(`Ajustar: ${peca.titulo}`, `Adjust: ${peca.titulo}`) : t('O que precisa mudar aqui?', 'What needs to change here?')}</h3>
      <p>{peca ? t('Este pedido altera somente o post selecionado. A prévia, a arte e a legenda em Word acompanham a mudança quando necessário; os outros posts permanecem como estão.', 'This request changes only the selected post. Preview, artwork and Word caption follow the change when needed; other posts stay as they are.') : t('O ajuste usa este arquivo como referência e cria uma nova versão para revisar.', 'The adjustment uses this file as reference and creates a new version for review.')}</p>
      <label>{t('O que você quer mudar?', 'What would you like to change?')}<textarea autoFocus disabled={!envio.podeEditar} required maxLength={2000} value={texto} onChange={e => setTexto(e.target.value)} placeholder={t('Ex.: clarear o fundo da arte e manter a legenda.', 'E.g. lighten the artwork background and keep the caption.')} /></label>
      <label>{t('O que pode mudar neste ajuste?', 'What may change in this adjustment?')}<select disabled={!envio.podeEditar} value={escopo} onChange={e => setEscopo(e.target.value)}>
        <option value="completo">{t('Conforme meu pedido', 'As described in my request')}</option>
        <option value="texto">{t('Só a legenda; manter a arte', 'Caption only; keep artwork')}</option>
        <option value="imagem">{t('Só a arte; manter a legenda', 'Artwork only; keep caption')}</option>
        {/\.(mp4|webm|mov|m4v)$/i.test(principal?.nome || '') && <option value="cena">{t('Somente a cena apontada', 'Only the selected scene')}</option>}
      </select></label>
      {principal && temResultadoVisivel(principal.nome, principal.mime) && <button type="button" disabled={!envio.podeEditar} aria-pressed={apontando} title={t('Opcional: indique um ponto ou instante na prévia acima para acompanhar seu comentário.', 'Optional: mark a point or moment in the preview above to accompany your comment.')} onClick={() => setApontando(a => !a)}>{apontando ? t('Parar de marcar', 'Stop marking') : t('Marcar um ponto na prévia', 'Mark a point in the preview')}</button>}
      {(posicao.ponto.pagina || posicao.ponto.segundo !== undefined || posicao.ponto.x !== undefined) && <p>{t('Ponto marcado', 'Marked point')}{posicao.ponto.pagina ? ` · ${t('Página', 'Page')} ${posicao.ponto.pagina}` : ''}{posicao.ponto.segundo !== undefined ? ` · ${posicao.ponto.segundo.toFixed(1)}s` : ''}{posicao.ponto.x !== undefined ? ` · ${Math.round(posicao.ponto.x * 100)}%, ${Math.round((posicao.ponto.y || 0) * 100)}%` : ''}</p>}
      {envio.identificando && <p role="status">{t('Conferindo a conta e os pedidos já enviados…', 'Checking the account and submitted requests…')}</p>}
      {envio.temEnvioPendente && !envio.erro && <p role="status">{t('Há um envio para conferir. A consulta recupera esse ajuste sem produzir novamente.', 'There is a submission to check. Checking recovers this adjustment without producing it again.')}</p>}
      {envio.precisaEscolherEnvio && <fieldset><legend>{t('Qual envio você quer conferir?', 'Which submission do you want to check?')}</legend>
        {envio.enviosPendentes.map((recibo, i) => <button key={recibo.requestId} type="button" onClick={() => envio.selecionarEnvio(recibo.requestId)}>{t(`Selecionar envio ${i + 1}`, `Select submission ${i + 1}`)}{recibo.criadoEm && <> · <time dateTime={recibo.criadoEm}>{formatDataHora(recibo.criadoEm, idioma)}</time></>}</button>)}
      </fieldset>}
      {envio.erro && <p role="alert">{envio.erro}</p>}
      <div className="biblioteca-acoes">
        {envio.precisaVerificarConta ? <button type="button" onClick={() => void envio.verificarConta()}>{t('Tentar verificar a conta', 'Try checking the account')}</button>
          : envio.precisaEscolherEnvio ? null
          : envio.temEnvioPendente || envio.estado === 'consultando' ? <button type="button" className="btn btn--primario" disabled={ocupado || envio.ocupado} onClick={() => void envio.conferir()}>{envio.ocupado ? t('Conferindo envio…', 'Checking submission…') : t('Conferir envio', 'Check submission')}</button>
          : envio.estado === 'removido' ? <button type="button" onClick={() => { conversaDoEnvio.current = null; envio.prepararNovo() }}>{t('Preparar um novo pedido', 'Prepare a new request')}</button>
          : <button className="btn btn--primario" disabled={ocupado || envio.ocupado || !envio.podeEditar || !texto.trim()}>{envio.estado === 'repetir' ? t('Reenviar pedido', 'Resend request') : t('Aplicar ajuste', 'Apply adjustment')}</button>}
        {(envio.temEnvioPendente || envio.precisaEscolherEnvio) && <button type="button" onClick={() => { conversaDoEnvio.current = null; envio.prepararOutro() }}>{t('Preparar outro pedido', 'Prepare another request')}</button>}
        <button type="button" onClick={() => { envio.sair(); fechar() }}>{envio.estado === 'pronto' ? t('Cancelar', 'Cancel') : t('Fechar', 'Close')}</button>
      </div>
      {(envio.temEnvioPendente || envio.precisaEscolherEnvio) && <p className="texto-suave">{t('Preparar outro pedido mantém os envios anteriores guardados. A produção só começa quando você enviar o novo pedido.', 'Preparing another request keeps earlier submissions saved. Production only starts when you submit the new request.')}</p>}
  </form>
}

function DetalheTrabalho({ base, areaSlug, jobId, projetos, revisao, conversaId, fechar, abrir, favoritar, pedirNaConversa }: { base: string; areaSlug?: string; jobId: number; projetos: Projeto[]; revisao: number; conversaId?: number | null; fechar: () => void; abrir: (id: number) => void; favoritar: (j: Trabalho) => Promise<void>; pedirNaConversa: (texto: string, referencia?: ReferenciaConversa) => void }) {
  const { t, idioma } = useIdioma()
  const navegar = useNavigate()
  const [tentativa, setTentativa] = useState(0)
  const leitura = useBiblioteca<Trabalho>(`${base}/biblioteca/${jobId}`, revisao + tentativa)
  const consultaAtual = useRef(leitura.dados)
  useLayoutEffect(() => { consultaAtual.current = leitura.dados }, [leitura.dados])
  const [aprovacaoConfirmada, setAprovacaoConfirmada] = useState<{ dados: Trabalho; anterior?: Trabalho; consultadoEm: string }>()
  // The explicit approval query is authoritative until the library obtains a
  // newer snapshot. A failed refresh must not bring back the old pending file.
  const confirmada = aprovacaoConfirmada?.anterior === leitura.dados ? aprovacaoConfirmada : undefined
  const j = confirmada?.dados || leitura.dados
  const erro = leitura.erro, consultadoEm = confirmada?.consultadoEm || leitura.consultadoEm
  const [params, setParams] = useSearchParams()
  const arquivoId = idDaUrl(params.get('arquivo'))
  const [acao, setAcao] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [mensagemDaRevisao, setMensagemDaRevisao] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [aprovacaoPendente, setAprovacaoPendente] = useState<AprovacaoVersao>()
  const sessaoAprovacao = useRef(getSessionIdentity()).current
  const aprovacaoViva = useRef(false)
  const travaAprovacao = useRef<symbol | null>(null)
  const consultaAprovacao = useRef<AbortController | null>(null)
  const travaConversa = useRef<symbol | null>(null)
  useLayoutEffect(() => {
    aprovacaoViva.current = true
    return () => { aprovacaoViva.current = false; consultaAprovacao.current?.abort(); travaAprovacao.current = null }
  }, [])
  const [nomePadrao, setNomePadrao] = useState('')
  const [preservar, setPreservar] = useState('')
  const [campos, setCampos] = useState('')
  const [ciente, setCiente] = useState(false)
  const [cientes, setCientes] = useState<Record<number, boolean>>({})
  const [apontando, setApontando] = useState(false)
  const [escopoApontado, setEscopoApontado] = useState('completo')
  const [textoAjuste, setTextoAjuste] = useState('')
  const [posicao, setPosicao] = useState<{ entregaId: number; ponto: PosicaoEntrega }>()
  const [variantes, setVariantes] = useState<Record<number, number>>({})
  const referenciaInicial = j?.arquivos.find(a => a.nome === 'post.html') || j?.arquivos.find(a => temResultadoVisivel(a.nome, a.mime)) || j?.arquivos[0]
  const principal = params.has('arquivo') ? j?.arquivos.find(a => a.id === arquivoId) : arquivoInicialEntrega(j?.arquivos || [], referenciaInicial)
  // O detalhe devolve somente a conversa privada autorizada para esta conta.
  // Nunca inferir a área pelo escritório executor ou por um parâmetro herdado.
  const orgId = Number(base.split('/')[2])
  const conversaConfirmada = j?.id === jobId && Number.isSafeInteger(orgId) && orgId > 0
    && typeof j.conversa_id === 'number' && Number.isSafeInteger(j.conversa_id) && j.conversa_id > 0
    && (j.conversa_office_slug === null || (typeof j.conversa_office_slug === 'string' && !!j.conversa_office_slug.trim()))
  const enderecoConversa = conversaConfirmada
    ? enderecoConversaEntrega(orgId, j!.conversa_id!, j!.conversa_office_slug!) : null
  const sessaoPadrao = useRef(getSessionIdentity()).current
  const contextoPadrao = JSON.stringify([base, areaSlug ?? null, jobId, principal?.id ?? null])
  const contextoPadraoAtual = useRef<string | null>(contextoPadrao)
  const padraoVivo = useRef(false)
  const formularioPadrao = useRef(0)
  const revisaoPadrao = useRef(0)
  const travaPadrao = useRef<symbol | null>(null)
  const acaoAtual = useRef(acao)
  useLayoutEffect(() => { acaoAtual.current = acao }, [acao])
  useLayoutEffect(() => {
    if (travaPadrao.current) { travaPadrao.current = null; setOcupado(false) }
    padraoVivo.current = true; contextoPadraoAtual.current = contextoPadrao
    return () => { padraoVivo.current = false; contextoPadraoAtual.current = null }
  }, [contextoPadrao])
  // Reset before the new file becomes interactive. A passive reset can erase
  // the first click after loading; a comment must never follow another file.
  useLayoutEffect(() => {
    setApontando(false); setPosicao(undefined); setEscopoApontado('completo'); setTextoAjuste(''); setAcao('')
  }, [principal?.id])
  const pecasNavegaveis = j?.pecas_editoriais?.filter(p => j.arquivos.some(a => a.editorial_peca_id === p.id)) || []
  const agruparPecas = pecasNavegaveis.length > 1 && pecasNavegaveis.length === j?.pecas_editoriais?.length
  const prioridade = (a: Entrega) => a.nome === 'post.html' ? 0 : a.nome === 'arte.png' ? 1 : a.nome === 'legenda.docx' ? 2 : 3
  const arquivosVisiveis = ordenarArquivosCarrossel([...(agruparPecas && principal ? j?.arquivos.filter(a => a.editorial_peca_id === principal.editorial_peca_id) || [] : j?.arquivos || [])].sort((a, b) => prioridade(a) - prioridade(b)))
  const pecaSelecionada = j?.pecas_editoriais?.find(p => p.id === principal?.editorial_peca_id)
  const devolutivas = j?.devolutivas?.filter(e => e.job_id === j.id && e.tipo === 'devolutiva'
    && (e.organization_id == null || e.organization_id === Number(base.split('/')[2]))
    && (e.office_slug == null || e.office_slug === j.office_slug)) || []
  const pecasVisiveis = agruparPecas ? j?.pecas_editoriais?.filter(p => p.id === principal?.editorial_peca_id) : j?.pecas_editoriais
  function escolherArquivo(id: number) {
    if (!j?.arquivos.some(a => a.id === id)) return
    setParams(p => { const n = new URLSearchParams(p); n.set('arquivo', String(id)); return n })
    setApontando(false); setPosicao(undefined); setEscopoApontado('completo'); setTextoAjuste(''); setAcao('')
  }
  function nomeDoArquivo(nome: string) {
    if (!principal?.editorial_peca_id) return nome
    if (nome === 'arte.png') return t('Arte', 'Artwork')
    if (nome === 'legenda.docx') return t('Legenda em Word', 'Caption in Word')
    if (nome === 'post.html') return t('Ler post', 'Read post')
    return nome
  }
  async function agir(fn: () => Promise<unknown>, ok: string, daRevisao = false) { setOcupado(true); setMensagem(''); setMensagemDaRevisao(false); try { await fn(); mudou(); setMensagem(ok); setMensagemDaRevisao(daRevisao) } catch (e) { setMensagem(mensagemErro(e)) } finally { setOcupado(false) } }
  async function abrirConversaDoPedido() {
    if (!j || !enderecoConversa || ocupado || travaConversa.current) return
    const alvo = { jobId: j.id, conversaId: j.conversa_id, endereco: enderecoConversa }
    const vigente = () => aprovacaoViva.current && sessaoAprovacao === getSessionIdentity()
      && consultaAtual.current?.id === alvo.jobId && consultaAtual.current?.conversa_id === alvo.conversaId
    if (!vigente()) return
    const operacao = Symbol(); travaConversa.current = operacao
    setOcupado(true); setMensagem(''); setMensagemDaRevisao(false)
    try {
      const confirmado = await api.put<{ ok: boolean; job_id: number }>(`/conversas/${alvo.conversaId}/trabalho`, { job_id: alvo.jobId, entrega_id: null, intencao: 'discutir' })
      if (!vigente() || travaConversa.current !== operacao) return
      if (confirmado?.ok !== true || confirmado.job_id !== alvo.jobId) throw new Error(t('Não consegui confirmar o trabalho desta conversa. Tente novamente.', 'Could not confirm this conversation’s work. Try again.'))
      navegar(alvo.endereco)
    } catch (e) {
      if (vigente() && travaConversa.current === operacao) setMensagem(mensagemErro(e))
    } finally {
      if (travaConversa.current === operacao) {
        travaConversa.current = null
        if (aprovacaoViva.current && sessaoAprovacao === getSessionIdentity()) setOcupado(false)
      }
    }
  }
  async function guardarPadrao() {
    if (!j || !padraoVivo.current || ocupado || travaPadrao.current || acaoAtual.current !== 'padrao') return
    const vigente = () => padraoVivo.current && contextoPadraoAtual.current === contextoPadrao && sessaoPadrao === getSessionIdentity()
    if (!vigente()) { setMensagem(t('Sua conta mudou. Reabra o formulário antes de salvar.', 'Your account changed. Reopen the form before saving.')); setMensagemDaRevisao(false); return }
    const operacao = Symbol(); travaPadrao.current = operacao
    const formularioEnviado = formularioPadrao.current, revisaoEnviada = revisaoPadrao.current
    const body = { job_id: j.id, nome: nomePadrao, preservar, campos: campos.split(',').map(s => s.trim()).filter(Boolean) }
    const mesmoFormulario = () => vigente() && formularioPadrao.current === formularioEnviado && revisaoPadrao.current === revisaoEnviada && acaoAtual.current === 'padrao'
    setOcupado(true); setMensagem(''); setMensagemDaRevisao(false)
    try {
      const salvo = await api.post<{ id: number }>(`${base}/padroes`, body)
      if (typeof salvo?.id !== 'number' || !Number.isSafeInteger(salvo.id) || salvo.id < 1) throw new Error(t('A resposta de salvamento está incompleta.', 'The save response is incomplete.'))
      if (!vigente()) return
      mudou()
      if (mesmoFormulario()) { setAcao(''); setMensagem(t('Padrão guardado em Meus padrões.', 'Pattern saved in My patterns.')) }
    } catch (e) {
      if (mesmoFormulario()) setMensagem(e instanceof ApiError && e.status > 0 && e.status < 500 && e.status !== 408 ? mensagemErro(e)
        : `${mensagemErro(e)} ${t('Não foi possível confirmar o salvamento. Antes de tentar novamente, confira Meus padrões.', 'Saving could not be confirmed. Before trying again, check My patterns.')}`)
    } finally {
      // An old ACK may release its request, but must not close or reset B.
      if (travaPadrao.current === operacao) { travaPadrao.current = null; if (vigente()) setOcupado(false) }
    }
  }
  const aprovacaoVigente = () => aprovacaoViva.current && sessaoAprovacao === getSessionIdentity()
  const mensagemAprovacaoIncerta = () => t('Não foi possível confirmar a aprovação desta versão. Confira a aprovação antes de decidir novamente.', 'This version’s approval could not be confirmed. Check the approval before deciding again.')
  async function conferirAprovacao(aprovar: AprovacaoVersao) {
    const c = new AbortController(); consultaAprovacao.current = c
    try {
      const atual = await api.get<Trabalho>(`${base}/biblioteca/${aprovar.jobId}`, c.signal)
      if (!aprovacaoVigente() || c.signal.aborted) return
      const arquivos = atual?.arquivos
      if (atual?.id !== aprovar.jobId || atual.office_slug !== aprovar.officeSlug || typeof atual.aprovado !== 'boolean'
        || !Array.isArray(arquivos) || !arquivos.length || new Set(arquivos.map(a => a?.id)).size !== arquivos.length
        || arquivos.some(a => !a || !Number.isSafeInteger(a.id) || a.id < 1 || !['aprovada', 'rejeitada', 'pendente'].includes(a.status))
        || atual.aprovado !== arquivos.every(a => a.status === 'aprovada')) throw new Error(t('A consulta da aprovação está incompleta.', 'The approval query is incomplete.'))
      setAprovacaoConfirmada({ dados: atual, anterior: consultaAtual.current, consultadoEm: new Date().toISOString() })
      setAprovacaoPendente(undefined)
      const resultado = atual.aprovado ? t('Versão aprovada.', 'Version approved.')
        : arquivos.some(a => a.status === 'aprovada') ? t('Aprovação parcial. Os arquivos rejeitados ou pendentes permanecem sem aprovação.', 'Partial approval. Rejected or pending files remain unapproved.')
          : t('A aprovação desta versão não foi confirmada. Confira o estado de cada arquivo.', 'This version’s approval was not confirmed. Check the status of each file.')
      setMensagem(aprovar.origem !== 'conhecimento' ? resultado : `${resultado} ${aprovar.conhecimentoAplicado
        ? t('A proposta foi aplicada à configuração.', 'The proposal was applied to the configuration.')
        : t('A aplicação à configuração não foi confirmada; a equipe Offiz precisa verificar a proposta.', 'Applying the configuration was not confirmed; the Offiz team needs to check the proposal.')}`)
      mudou()
    } catch (e) {
      if (aprovacaoVigente() && !c.signal.aborted) setMensagem(`${mensagemErro(e)} ${mensagemAprovacaoIncerta()}`)
    } finally { if (consultaAprovacao.current === c) consultaAprovacao.current = null }
  }
  async function aprovarVersao(conferir = false) {
    if (!j || j.id !== jobId || ocupado || travaAprovacao.current || !aprovacaoVigente()) return
    if (aprovacaoPendente && !conferir) return
    const aprovar: AprovacaoVersao = aprovacaoPendente || { jobId: j.id, officeSlug: j.office_slug, origem: j.origem, conhecimentoAplicado: false }
    const operacao = Symbol(); travaAprovacao.current = operacao
    setOcupado(true); setMensagem(''); setMensagemDaRevisao(false)
    try {
      if (!conferir) {
        const r = await api.post<{ conhecimento_aplicado?: { job_id?: number } | null }>(`/jobs/${aprovar.jobId}/entregas/aprovar`, {})
        if (!aprovacaoVigente()) return
        aprovar.conhecimentoAplicado = r?.conhecimento_aplicado?.job_id === aprovar.jobId
        setAprovacaoPendente(aprovar)
      }
      await conferirAprovacao(aprovar)
    } catch (e) {
      if (!aprovacaoVigente()) return
      const recusado = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408
      if (recusado) setMensagem(mensagemErro(e))
      else { setAprovacaoPendente(aprovar); setMensagem(`${mensagemErro(e)} ${mensagemAprovacaoIncerta()}`) }
    } finally {
      if (travaAprovacao.current === operacao) { travaAprovacao.current = null; if (aprovacaoVigente()) setOcupado(false) }
    }
  }
  if (erro && !j) return <div className="biblioteca-detalhe"><button onClick={fechar}>← {t('Voltar à biblioteca', 'Back to library')}</button><AvisoConsulta erro={erro} repetir={() => setTentativa(v => v + 1)} /></div>
  if (!j) return <p role="status">{t('Abrindo entrega…', 'Opening deliverable…')}</p>
  if (areaSlug && j.office_slug !== areaSlug) return <div className="biblioteca-detalhe"><button onClick={fechar}>← {t('Voltar à biblioteca', 'Back to library')}</button><p role="status">{t('Este trabalho pertence a outra área. Abra a conversa da empresa para continuar com ele.', 'This work belongs to another team. Open the organization conversation to continue with it.')}</p></div>
  const pendencias = (j.qualidade?.avisos.length || 0) > 0 || j.qualidade?.estado !== 'conferida'
  return <article className="biblioteca-detalhe">
    <button className="biblioteca-voltar" onClick={fechar}>← {t('Voltar à biblioteca', 'Back to library')}</button>
    <AvisoConsulta erro={erro} consultadoEm={consultadoEm} repetir={() => setTentativa(v => v + 1)} />
    <header><div><h3>{j.titulo}</h3><p>{formatDataHora(j.criado_em, idioma)}</p></div><EstadoTrabalho estado={j.estado} status={j.status} finalizando={j.finalizando} /><button className="biblioteca-favorito" aria-pressed={j.favorito} onClick={() => void favoritar(j)} aria-label={t('Favorito', 'Favorite')}>{j.favorito ? '★' : '☆'}</button></header>
    {enderecoConversa && <button className="biblioteca-conversa-link" disabled={ocupado} onClick={() => void abrirConversaDoPedido()}>{t('Ver conversa deste pedido', 'View this request’s conversation')}</button>}
    {params.has('arquivo') && !j.arquivos.some(a => a.id === arquivoId) && <p role="status">{t('O arquivo deste link não está disponível nesta entrega. Os arquivos disponíveis aparecem abaixo.', 'The file in this link is unavailable in this deliverable. Available files appear below.')}</p>}
    {j.finalizando && <p role="status">{t('Os arquivos da entrega estão sendo organizados. Aguarde a conclusão, sem reenviar o pedido.', 'Deliverable files are being organized. Wait for completion without submitting the request again.')}</p>}
    {j.status === 'cancelled' && <p role="status">{t('Este trabalho foi interrompido. Os arquivos já salvos e as versões anteriores continuam guardados.', 'This task was stopped. Saved files and earlier versions remain available.')}</p>}
    {['em_fila', 'em_revisao'].includes(j.qualidade?.revisao_automatica?.estado || '') && <p role="status">{t('Os arquivos estão prontos. A conferência automática está na fila ou em andamento.', 'Files are ready. The automatic review is queued or in progress.')}</p>}
    {!!j.desatualizados.length && <div className="biblioteca-pendencia"><strong>{t('Uma informação deste projeto mudou.', 'Project information has changed.')}</strong><p>{j.desatualizados.join(', ')}</p><button onClick={() => setAcao('produzir')}>{t('Preparar versão atualizada', 'Prepare updated version')}</button></div>}
    {j.erro && <p role="status">{j.erro}</p>}
    {devolutivas.length > 0 && <section aria-label={t('Orientações para continuar', 'Instructions to continue')}>
      <p role="status">{t('O escritório pediu material para continuar. Abra as orientações, envie na conversa o que falta e retome por lá.', 'The office requested material to continue. Open the instructions, send what is missing in the conversation, and resume there.')}</p>
      <ul className="painel-pecas">{devolutivas.map(e => <OrientacoesEntrega key={e.id} entrega={e} />)}</ul>
    </section>}
    {!!j.fontes?.length && <div className="biblioteca-fontes"><span>{t('Pesquisa usada nesta entrega:', 'Research used for this work:')}</span>{j.fontes.map(f => <button key={f.id} onClick={() => abrir(f.id)}>{f.titulo}</button>)}</div>}
    <OrigemEntrega key={`${orgId}:${j.office_slug}:${j.id}`} orgId={orgId} slug={j.office_slug} jobId={j.id} />
    {agruparPecas && <nav className="biblioteca-pecas" aria-label={t('Peças deste trabalho', 'Deliverables in this work')}>
      {pecasNavegaveis.map(p => <button key={p.id} aria-pressed={principal?.editorial_peca_id === p.id} onClick={() => {
        const arquivos = j.arquivos.filter(a => a.editorial_peca_id === p.id)
        const arquivo = arquivos.find(a => a.nome === 'post.html') || arquivos.find(a => a.tipo === 'imagem' || a.mime?.startsWith('image/')) || arquivos.find(a => temResultadoVisivel(a.nome, a.mime)) || arquivos[0]
        if (arquivo) escolherArquivo((arquivoInicialEntrega(arquivos, arquivo) || arquivo).id)
      }}>{p.titulo}{p.aprovada && <Icone nome="check" tamanho={14} />}</button>)}
      {j.arquivos.some(a => !a.editorial_peca_id) && <button aria-pressed={!principal?.editorial_peca_id} onClick={() => escolherArquivo(j.arquivos.find(a => !a.editorial_peca_id)!.id)}>{t('Arquivos do lote', 'Batch files')}</button>}
    </nav>}
    {!!arquivosVisiveis.length && <div className="biblioteca-arquivos">{arquivosVisiveis.map(a => <button key={a.id} aria-pressed={a.id === principal?.id} className={a.id === principal?.id ? 'selecionado' : ''} onClick={() => escolherArquivo(a.id)}><Icone nome={iconeDoArquivo(a.nome)} tamanho={16} />{nomeDoArquivo(a.nome)}{a.status === 'aprovada' && <Icone nome="check" tamanho={13} />}</button>)}</div>}
    {principal && <>
      <small>{t('Entrega', 'Deliverable')} #{principal.id} · {principal.nome}</small>
      <SequenciaCarrossel arquivos={arquivosVisiveis} selecionadaId={principal.id} escolher={escolherArquivo} />
      {apontando && <p role="status">{t('Escolha um ponto na imagem ou página, ou um instante do vídeo ou áudio. Você também pode comentar o arquivo inteiro.', 'Choose a point on the image or page, or a moment in the video or audio. You can also comment on the entire file.')}</p>}
      <div className="biblioteca-previa">{temResultadoVisivel(principal.nome, principal.mime) ? <ResultadoEntrega entregaId={principal.id} nome={principal.nome} mime={principal.mime} tamanhoBytes={principal.tamanho_bytes} aoApontar={apontando ? ponto => { setPosicao({ entregaId: principal.id, ponto }); setAcao('apontar') } : undefined} /> : <div className="biblioteca-vazio"><Icone nome={iconeDoArquivo(principal.nome)} tamanho={42} /><strong>{principal.nome}</strong><p>{t('Baixe o arquivo original para abrir no seu aplicativo.', 'Download the original to open it in your app.')}</p></div>}</div>
      <div className="biblioteca-acoes">
        {j.arquivos.length > 1 && <button className="btn btn--primario" disabled={ocupado} title={t('Baixa todos os posts e seus arquivos em um ZIP, separados por post.', 'Downloads every post and its files in one ZIP, grouped by post.')} onClick={() => void agir(() => baixarArquivo(`${base}/biblioteca/${j.id}/download`, `trabalho-${j.id}.zip`), t('Download de todos os arquivos iniciado.', 'Download of all files started.'))}>{t('Baixar todos os arquivos', 'Download all files')}</button>}
        <button disabled={ocupado} onClick={() => void agir(() => baixarArquivo(`/entregas/${principal.id}/download`, principal.nome), t('Download iniciado.', 'Download started.'))}>{/\.docx$/i.test(principal.nome) ? t('Baixar Word', 'Download Word') : t('Baixar arquivo', 'Download file')}</button>
        <button disabled={ocupado || j.finalizando || ['queued', 'running'].includes(j.status)} aria-expanded={acao === 'apontar'} title={t('Descreva a mudança no post selecionado. Você também pode marcar um ponto na prévia. Os outros posts são preservados.', 'Describe a change to the selected post. You can also mark a point in the preview. Other posts are preserved.')} onClick={() => { setPosicao({ entregaId: principal.id, ponto: {} }); setEscopoApontado('completo'); setTextoAjuste(''); setAcao('apontar') }}>{pecaSelecionada ? t('Pedir ajuste neste post', 'Request a change to this post') : t('Pedir ajuste', 'Request adjustment')}</button>
        <button onClick={() => { formularioPadrao.current++; revisaoPadrao.current++; setNomePadrao(j.titulo); setAcao('padrao') }} disabled={!j.aprovado}>{t('Usar como padrão', 'Save as pattern')}</button>
      </div>

    </>}
    {/* O ajuste pertence ao pedido aberto, mesmo com outro chat ativo na shell.
        Somente um trabalho sem conversa privada confirmada usa o contexto atual. */}
    {acao === 'apontar' && posicao && principal && posicao.entregaId === principal.id && <FormAjuste key={principal.id} base={base} j={j} principal={principal} peca={pecaSelecionada} posicao={posicao} conversaId={conversaConfirmada ? j.conversa_id : conversaId}
      texto={textoAjuste} setTexto={setTextoAjuste} escopo={escopoApontado} setEscopo={setEscopoApontado} apontando={apontando} setApontando={setApontando} ocupado={ocupado}
      fechar={() => { setAcao(''); setApontando(false); setPosicao(undefined); setTextoAjuste('') }} salvar={id => { mudou(); abrir(id) }} />}
    {j.qualidade && <details className="biblioteca-conferencia"><summary>{t('Conferência desta versão', 'Checks for this version')} {j.qualidade.avisos.length ? `(${j.qualidade.avisos.length} ${j.qualidade.avisos.length === 1 ? t('pendência', 'issue') : t('pendências', 'issues')})` : ''}</summary>
      {j.qualidade.estado === 'sem_laudo' && <p>{t('Esta versão não tem um laudo completo registrado. Concluir a produção não comprova a qualidade do conteúdo.', 'This version has no complete recorded report. Finishing production does not verify content quality.')}</p>}
      {j.qualidade.conferencias.map((c, i) => <p key={i}>{c.conferida ? '✓' : '○'} {c.nome}: {c.conferida ? t('texto conferido nesta versão', 'text checked in this version') : t('conferência incompleta', 'incomplete check')}</p>)}
      {j.qualidade.verificacoes?.map((v, i) => <div key={`arquivo-${i}`}><p>{v.estado === 'conferido' ? '✓' : '○'} <strong>{v.nome}</strong>: {v.detalhe}</p>{!!v.evidencias?.length && <details><summary>{t('Como foi conferido', 'How it was reviewed')}</summary>{v.evidencias.map((e, n) => <p key={n}>{e}</p>)}</details>}</div>)}
      {j.qualidade.avisos.map((a, i) => <p key={i} className="biblioteca-pendente">{a}</p>)}
      {j.qualidade.revisao_automatica?.limites && <p>{j.qualidade.revisao_automatica.limites}</p>}
      {j.qualidade.revisao_automatica?.correcao_job_id && <button onClick={() => abrir(j.qualidade!.revisao_automatica!.correcao_job_id!)}>{t('Ver a correção desta versão', 'View this version’s correction')}</button>}
      {j.status === 'done' && !j.finalizando && j.arquivos.length > 0 && !['em_fila', 'em_revisao'].includes(j.qualidade.revisao_automatica?.estado || '') && <button disabled={ocupado} onClick={() => void agir(() => api.post(`${base}/biblioteca/${j.id}/revisar`, {}), t('Conferência na fila. Os arquivos desta versão permanecem guardados.', 'Review queued. This version’s files remain saved.'), true)}>{j.qualidade.revisao_automatica ? t('Conferir novamente', 'Review again') : t('Conferir os arquivos', 'Review files')}</button>}
      {(j.projeto_nome_utilizado || j.objetivo_utilizado || !!Object.keys(j.dados_utilizados || {}).length) && <dl>{j.projeto_nome_utilizado && <div><dt>{t('Projeto nesta versão', 'Project in this version')}</dt><dd>{j.projeto_nome_utilizado}</dd></div>}{j.objetivo_utilizado && <div><dt>{t('Objetivo desta versão', 'Goal of this version')}</dt><dd>{j.objetivo_utilizado}</dd></div>}{Object.entries(j.dados_utilizados || {}).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
    </details>}
    {!j.aprovado && j.arquivos.some(a => a.status === 'pendente') && j.status === 'done' && !j.finalizando && !j.arquivos.some(a => a.editorial_peca_id) && <div className="biblioteca-aprovar">{pendencias && <label className="biblioteca-check"><input type="checkbox" checked={ciente} onChange={e => setCiente(e.target.checked)} />{t('Conferi os arquivos e as limitações desta versão.', 'I checked the files and limitations of this version.')}</label>}<button disabled={ocupado || !!aprovacaoPendente || (pendencias && !ciente)} onClick={() => void aprovarVersao()}>{j.origem === 'newsletter' ? t('Aprovar e enviar aos destinatários configurados', 'Approve and send to configured recipients') : j.origem === 'conhecimento' ? t('Aprovar e aplicar à configuração', 'Approve and apply to configuration') : t('Aprovar esta versão', 'Approve this version')}</button></div>}
    {aprovacaoPendente && <button disabled={ocupado} onClick={() => void aprovarVersao(true)}>{ocupado ? t('Conferindo aprovação…', 'Checking approval…') : t('Conferir aprovação', 'Check approval')}</button>}
    {pecasVisiveis?.map(p => <div className="biblioteca-aprovar biblioteca-legenda" key={p.id}><strong>{p.titulo}</strong><label>{t('Texto que acompanha a peça', 'Copy accompanying the deliverable')}<select disabled={p.aprovada} value={p.aprovada ? p.variante_aprovada || 0 : variantes[p.id] || 0} onChange={e => { setVariantes(v => ({ ...v, [p.id]: Number(e.target.value) })); setCientes(v => ({ ...v, [p.id]: false })) }}>{p.legendas.map((v, i) => <option key={i} value={i}>{v.nome}</option>)}</select></label><p>{p.legendas[p.aprovada ? p.variante_aprovada || 0 : variantes[p.id] || 0]?.texto}</p><button onClick={() => void agir(() => navigator.clipboard.writeText(p.legendas[p.aprovada ? p.variante_aprovada || 0 : variantes[p.id] || 0]?.texto || ''), t('Legenda copiada.', 'Caption copied.'))}>{t('Copiar legenda', 'Copy caption')}</button>{p.aprovada ? <strong>{t('Peça aprovada', 'Deliverable approved')}</strong> : <>{(p.pendencias.length > 0 || pendencias) && <label className="biblioteca-check"><input type="checkbox" checked={!!cientes[p.id]} onChange={e => setCientes(v => ({ ...v, [p.id]: e.target.checked }))} />{t('Conferi esta versão e suas pendências.', 'I checked this version and its issues.')}</label>}<button disabled={ocupado || j.finalizando || ((p.pendencias.length > 0 || pendencias) && !cientes[p.id])} onClick={() => void agir(() => api.post(`/predios/${base.split('/')[2]}/${j.office_slug}/editorial/${p.id}/aprovar`, { revisao_id: p.revisao_id, variante: variantes[p.id] || 0, ciente_pendencias: !!cientes[p.id] }), t('Peça aprovada.', 'Deliverable approved.'))}>{t('Aprovar esta peça', 'Approve this deliverable')}</button></>}</div>)}
    <button onClick={() => pedirNaConversa(t(`Sobre o trabalho ${j.id}, ${j.titulo}: `, `About work ${j.id}, ${j.titulo}: `), { jobId: j.id, intencao: 'discutir' })}>{t('Conversar sobre este trabalho', 'Discuss this work')}</button>
    {acao === 'produzir' && <FormProducao base={base} referencia={j} projeto={projetos.find(p => p.id === j.projeto_id)} conversaId={conversaId} fechar={() => setAcao('')} salvar={id => { mudou(); abrir(id) }} />}

    {acao === 'padrao' && <form className="biblioteca-form" onChange={() => { revisaoPadrao.current++ }} onSubmit={e => { e.preventDefault(); void guardarPadrao() }}><h3>{t('Faça os próximos assim', 'Make the next ones like this')}</h3><label>{t('Nome do padrão', 'Pattern name')}<input autoFocus required maxLength={160} value={nomePadrao} onChange={e => setNomePadrao(e.target.value)} /></label><label>{t('O que você gostou e quer preservar?', 'What did you like and want to keep?')}<textarea maxLength={3000} value={preservar} onChange={e => setPreservar(e.target.value)} /></label><label>{t('O que muda a cada vez? Separe os nomes por vírgula.', 'What changes each time? Separate field names with commas.')}<input value={campos} onChange={e => setCampos(e.target.value)} placeholder={t('Produto, oferta, data', 'Product, offer, date')} /></label><div className="biblioteca-acoes"><button disabled={ocupado}>{t('Guardar padrão', 'Save pattern')}</button><button type="button" onClick={() => { formularioPadrao.current++; setAcao('') }}>{t('Cancelar', 'Cancel')}</button></div></form>}
    <details><summary>{t('Projeto e versões anteriores', 'Project and earlier versions')}</summary><label>{t('Guardar no projeto', 'Save in project')}<select value={j.projeto_id || ''} disabled={ocupado || j.finalizando || ['queued', 'running'].includes(j.status)} onChange={e => void agir(() => api.put(`${base}/biblioteca/${j.id}/projeto`, { projeto_id: Number(e.target.value) || null }), t('Projeto atualizado.', 'Project updated.'))}><option value="">{t('Sem projeto', 'Without a project')}</option>{projetos.filter(p => p.office_slug === j.office_slug && (!p.arquivado || p.id === j.projeto_id)).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>{j.versoes_anteriores?.map(v => <button className="biblioteca-versao" key={v.id} onClick={() => abrir(v.id)}>{v.titulo} · {formatDataHora(v.criado_em, idioma)}</button>)}{!j.versoes_anteriores?.length && <p>{t('Primeira versão registrada nesta sequência.', 'First recorded version in this sequence.')}</p>}</details>
    <details><summary>{t('Resultados desta entrega', 'Results for this deliverable')}</summary><p>{t('Vincule um resultado à versão utilizada, à fonte e ao período. Ausência de dados não significa zero.', 'Link a result to the version used, its source and period. Missing data does not mean zero.')}</p>{j.resultados?.map(r => <div className="biblioteca-resultado" key={r.id}><strong>{r.valor} {r.metrica}</strong><span>{r.inicio} — {r.fim}</span><small>{r.fonte}</small></div>)}{!j.resultados?.length && <p>{t('Ainda não há resultados registrados.', 'No results recorded yet.')}</p>}{principal?.status === 'aprovada' && <FormResultado key={principal.id} base={base} entregaId={principal.id} agir={agir} ocupado={ocupado} />}</details>
    {mensagem && (!mensagemDaRevisao || ['em_fila', 'em_revisao'].includes(j.qualidade?.revisao_automatica?.estado || '')) && <p role="status">{mensagem}</p>}
  </article>
}

function FormResultado({ base, entregaId, agir, ocupado }: { base: string; entregaId: number; agir: (fn: () => Promise<unknown>, ok: string) => Promise<void>; ocupado: boolean }) {
  const { t } = useIdioma()
  const [erroPeriodo, setErroPeriodo] = useState(false)
  return <form className="biblioteca-form" onChange={() => setErroPeriodo(false)} onSubmit={e => {
    e.preventDefault()
    const d = new FormData(e.currentTarget)
    const inicio = String(d.get('inicio') || '')
    const fim = String(d.get('fim') || '')
    if (inicio && fim && fim < inicio) { setErroPeriodo(true); return }
    setErroPeriodo(false)
    void agir(() => api.post(`${base}/resultados`, { entrega_id: entregaId, metrica: d.get('metrica'), valor: d.get('valor'), fonte: d.get('fonte'), inicio, fim }), t('Resultado registrado.', 'Result recorded.'))
  }}><div className="biblioteca-campo-par"><label>{t('Métrica', 'Metric')}<input name="metrica" required maxLength={80} placeholder={t('Ex.: cliques', 'E.g. clicks')} /></label><label>{t('Valor observado', 'Observed value')}<input name="valor" type="number" min="0" step="any" required /></label></div><label>{t('Fonte ou relatório', 'Source or report')}<input name="fonte" required maxLength={1000} /></label><div className="biblioteca-campo-par"><label>{t('Início do período', 'Period start')}<input name="inicio" type="date" required /></label><label>{t('Fim do período', 'Period end')}<input name="fim" type="date" required aria-invalid={erroPeriodo || undefined} /></label></div>{erroPeriodo && <p role="alert">{t('O fim do período precisa ser igual ou posterior ao início.', 'The period end must be on or after its start.')}</p>}<button disabled={ocupado}>{t('Registrar resultado', 'Record result')}</button></form>
}

interface ImpactoAtualizacao { versao: number; itens: { id: number; titulo: string; campos: string[] }[] }
interface CorpoAtualizacao { versao: number; jobs: number[]; conversa_id: number | null }
interface SnapshotAtualizacao { corpo: CorpoAtualizacao; contexto: string; sessao: string; enviadoEm: number }
type FaseAtualizacao = 'pronto' | 'enviando' | 'incerto' | 'consultando' | 'conferido' | 'recusado' | 'confirmado'
interface EstadoAtualizacao {
  contexto: string; fase: FaseAtualizacao; mensagem: string; incerto: boolean
  snapshot?: SnapshotAtualizacao
  consulta?: { dados: ImpactoAtualizacao; revisao: number }
}
const idsAtualizacaoValidos = (ids: unknown): ids is number[] => Array.isArray(ids)
  && ids.every(id => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length
function impactoAtualizacaoValido(valor: unknown): valor is ImpactoAtualizacao {
  if (!valor || typeof valor !== 'object') return false
  const d = valor as Partial<ImpactoAtualizacao>
  return Number.isSafeInteger(d.versao) && Number(d.versao) > 0 && Array.isArray(d.itens)
    && d.itens.every(i => i && typeof i.titulo === 'string' && Array.isArray(i.campos) && i.campos.every(c => typeof c === 'string'))
    && idsAtualizacaoValidos(d.itens.map(i => i.id))
}

function ImpactoProjeto({ base, projeto, conversaId, revisao }: { base: string; projeto: Projeto; conversaId?: number | null; revisao: number }) {
  const { t } = useIdioma()
  const [tentativa, setTentativa] = useState(0)
  const rota = `${base}/projetos/${projeto.id}`
  const { dados, erro, consultadoEm } = useBiblioteca<ImpactoAtualizacao>(`${rota}/impacto`, revisao + tentativa)
  const sessao = getSessionIdentity()
  const contexto = JSON.stringify([sessao, base, projeto.id, projeto.versao, conversaId ?? null])
  const atual = useRef({ contexto, revisao }); atual.current = { contexto, revisao }
  const vivo = useRef(true)
  const trava = useRef<{ contexto: string; sessao: string } | null>(null)
  const leitura = useRef<AbortController | null>(null)
  const [ocupacao, setOcupacao] = useState<{ contexto: string } | null>(null)
  const [selecao, setSelecao] = useState<{ contexto: string; ids: number[] }>({ contexto, ids: [] })
  const [estado, setEstado] = useState<EstadoAtualizacao>({ contexto, fase: 'pronto', mensagem: '', incerto: false })
  const situacao: EstadoAtualizacao = estado.contexto === contexto ? estado : { contexto, fase: 'pronto', mensagem: '', incerto: false }
  const consulta = situacao.consulta?.revisao === revisao ? situacao.consulta : undefined
  const impacto = consulta?.dados ?? dados
  const selecionados = selecao.contexto === contexto ? selecao.ids : []
  const ocupado = ocupacao?.contexto === contexto
  const bloqueado = ocupado || situacao.incerto || situacao.fase === 'conferido'

  useLayoutEffect(() => { vivo.current = true; return () => { vivo.current = false; leitura.current?.abort(); trava.current = null } }, [])
  useLayoutEffect(() => () => { leitura.current?.abort(); if (trava.current?.contexto === contexto) trava.current = null }, [contexto])

  const vigente = (operacao: { contexto: string; sessao: string }) => vivo.current
    && atual.current.contexto === operacao.contexto && getSessionIdentity() === operacao.sessao
  function ocupar() {
    if (!sessao || getSessionIdentity() !== sessao || !vivo.current || atual.current.contexto !== contexto || (trava.current && trava.current.contexto === contexto)) return null
    const operacao = { contexto, sessao }
    trava.current = operacao; setOcupacao(operacao)
    return operacao
  }
  function liberar(operacao: { contexto: string; sessao: string }) {
    if (trava.current !== operacao) return
    trava.current = null
    if (vigente(operacao)) setOcupacao(null)
  }
  async function enviar() {
    if (bloqueado || erro || !impactoAtualizacaoValido(impacto) || impacto.versao !== projeto.versao
      || !idsAtualizacaoValidos(selecionados) || selecionados.length < 1 || selecionados.length > 20
      || selecionados.some(id => !impacto.itens.some(i => i.id === id))) return
    const operacao = ocupar()
    if (!operacao) return
    // Dados do lote, sem prompt, congelados antes de qualquer espera.
    const corpo = JSON.parse(JSON.stringify({ versao: impacto.versao, jobs: selecionados, conversa_id: conversaId ?? null })) as CorpoAtualizacao
    const snapshot = { corpo, contexto, sessao: operacao.sessao, enviadoEm: Date.now() }
    setEstado({ contexto, fase: 'enviando', mensagem: '', incerto: false, snapshot, consulta })
    try {
      const r = await api.post<{ jobs: unknown }>(`${rota}/atualizar`, corpo)
      if (!vigente(operacao) || trava.current !== operacao) return
      if (!r || !idsAtualizacaoValidos(r.jobs) || r.jobs.length !== corpo.jobs.length) throw new Error(t('A confirmação do lote veio incompleta. Confira a situação antes de enviar outro.', 'The batch confirmation was incomplete. Check its status before submitting another.'))
      setSelecao({ contexto, ids: [] })
      setEstado({ contexto, fase: 'confirmado', mensagem: r.jobs.length === 1 ? t('1 nova versão na fila.', '1 new version queued.') : t(`${r.jobs.length} novas versões na fila.`, `${r.jobs.length} new versions queued.`), incerto: false })
      mudou()
    } catch (e) {
      if (!vigente(operacao) || trava.current !== operacao) return
      const recusado = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408
      setEstado({ contexto, fase: recusado ? 'recusado' : 'incerto', incerto: !recusado, snapshot,
        mensagem: recusado ? mensagemErro(e) : t('A confirmação do envio não chegou. Confira a atualização antes de preparar outra.', 'The submission confirmation did not arrive. Check the update before preparing another.') })
    } finally { liberar(operacao) }
  }
  async function conferir() {
    const operacao = ocupar()
    if (!operacao) return
    const revisaoConsulta = revisao
    const c = new AbortController(); leitura.current?.abort(); leitura.current = c
    setEstado({ ...situacao, fase: 'consultando', mensagem: '' })
    try {
      const resposta = await api.get<unknown>(`${rota}/impacto`, c.signal)
      if (!vigente(operacao) || trava.current !== operacao || c.signal.aborted) return
      if (atual.current.revisao !== revisaoConsulta) {
        setEstado({ ...situacao, fase: situacao.incerto ? 'incerto' : 'recusado', consulta: undefined,
          mensagem: t('A lista mudou durante a consulta. Confira novamente.', 'The list changed during the check. Check again.') })
        return
      }
      if (!impactoAtualizacaoValido(resposta)) throw new Error(t('Não foi possível conferir a lista recebida. Tente a consulta novamente.', 'Could not verify the received list. Try the check again.'))
      setEstado({ ...situacao, fase: 'conferido', consulta: { dados: resposta, revisao: revisaoConsulta },
        mensagem: situacao.incerto
          ? t('Situação atual consultada. Esta consulta não confirma o envio anterior nem recupera os IDs do lote. Confira os pedidos na Biblioteca.', 'Current status checked. This check does not confirm the previous submission or recover the batch IDs. Review the requests in the Library.')
          : t('Lista atual consultada. Prepare uma nova atualização para os trabalhos disponíveis.', 'Current list checked. Prepare a new update for the available work.') })
    } catch (e) {
      if (vigente(operacao) && trava.current === operacao && !c.signal.aborted) setEstado({ ...situacao, fase: situacao.incerto ? 'incerto' : 'recusado', consulta: undefined, mensagem: mensagemErro(e) })
    } finally { if (leitura.current === c) leitura.current = null; liberar(operacao) }
  }
  function prepararNova() {
    if (ocupado || !sessao || getSessionIdentity() !== sessao || !vivo.current || !consulta || consulta.dados.versao !== projeto.versao) return
    setSelecao({ contexto, ids: [] })
    setEstado({ contexto, fase: 'pronto', incerto: false, consulta,
      mensagem: t('Nova atualização preparada. Escolha os trabalhos atuais; a consulta não confirmou o envio anterior.', 'New update prepared. Select the current work; the check did not confirm the previous submission.') })
  }
  const aviso = <AvisoConsulta erro={erro} consultadoEm={consultadoEm} repetir={() => setTentativa(v => v + 1)} />
  const podeConferir = situacao.incerto || ['recusado', 'conferido', 'consultando'].includes(situacao.fase)
  if (!impacto?.itens.length && !situacao.mensagem && !podeConferir) return aviso
  return <>{aviso}
    {situacao.mensagem && <p role="status">{situacao.mensagem}</p>}
    {podeConferir && <div className="biblioteca-acoes">
      <button disabled={ocupado} onClick={() => void conferir()}>{situacao.fase === 'consultando' ? t('Conferindo atualização…', 'Checking update…') : t('Conferir atualização', 'Check update')}</button>
      {situacao.fase === 'conferido' && <button disabled={ocupado || !consulta || consulta.dados.versao !== projeto.versao} onClick={prepararNova}>{t('Preparar nova atualização', 'Prepare a new update')}</button>}
    </div>}
    {!!impacto?.itens.length && <details className="biblioteca-impacto"><summary>{impacto.itens.length === 1 ? t('1 trabalho usa informações que mudaram', '1 job uses information that changed') : t(`${impacto.itens.length} trabalhos usam informações que mudaram`, `${impacto.itens.length} jobs use information that changed`)}</summary><p>{t('Escolha até 20 trabalhos por vez. As versões aprovadas permanecem guardadas.', 'Choose up to 20 jobs at a time. Approved versions stay saved.')}</p>{impacto.itens.map(i => <label className="biblioteca-check" key={i.id}><input type="checkbox" disabled={bloqueado || (selecionados.length >= 20 && !selecionados.includes(i.id))} checked={selecionados.includes(i.id)} onChange={e => setSelecao(v => ({ contexto, ids: e.target.checked ? [...(v.contexto === contexto ? v.ids : []), i.id] : (v.contexto === contexto ? v.ids : []).filter(id => id !== i.id) }))} /><span><strong>{i.titulo}</strong><small> · {i.campos.join(', ')}</small></span></label>)}<button disabled={bloqueado || !!erro || !selecionados.length || selecionados.length > 20} onClick={() => void enviar()}>{selecionados.length === 1 ? t('Pode atualizar 1 trabalho', 'Update 1 job') : t(`Pode atualizar ${selecionados.length} trabalhos`, `Update ${selecionados.length} jobs`)}</button></details>}
  </>
}

interface Rotina { id: number; nome: string; projeto_id: number; projeto_nome: string; arquivo_nome: string; ativo: boolean; pedido: string; eventos: { id: number; estado: string; erro: string | null; job_id: number | null }[] }
function RotinasMateriais({ base, orgId, areaSlug, projetos, andares, podeConfigurar, revisao, abrir }: { base: string; orgId: number; areaSlug?: string; projetos: Projeto[]; andares: { slug: string; nome: string }[]; podeConfigurar: boolean; revisao: number; abrir: (id: number) => void }) {
  const { t } = useIdioma()
  const [tentativa, setTentativa] = useState(0)
  const { dados, erro, consultadoEm } = useBiblioteca<{ itens: Rotina[]; agendador_ativo: boolean }>(`${base}/rotinas-material${areaSlug ? `?office_slug=${encodeURIComponent(areaSlug)}` : ''}`, revisao + tentativa)
  const [nova, setNova] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [area, setArea] = useState(andares[0]?.slug || '')
  const ativa = useTelaAtiva()
  const conta = useRef(getSessionIdentity())
  const operacao = useRef(false)
  const formulario = useRef(0)
  const telaAtual = () => ativa.current && getSessionIdentity() === conta.current
  async function agir(fn: () => Promise<unknown>) {
    if (!telaAtual() || operacao.current) return
    operacao.current = true
    setOcupado(true); setMensagem('')
    try { await fn(); if (telaAtual()) mudou() }
    catch (e) { if (telaAtual()) setMensagem(mensagemErro(e)) }
    finally { operacao.current = false; if (telaAtual()) setOcupado(false) }
  }
  return <div className="biblioteca-rotinas"><h3>{t('O trabalho começa quando o material chega.', 'Work starts when the material arrives.')}</h3><p>{t('Uma nova versão do arquivo na Entrada do Offiz inicia o trabalho combinado. O mesmo conteúdo não é processado duas vezes.', 'A new file version in Offiz Inbox starts the agreed work. The same content is not processed twice.')}</p>
    <p>{t('O motor local precisa estar ligado para produzir. A rotina prepara entregas; a publicação continua sob sua decisão.', 'The local engine must be on to produce work. Routines prepare deliverables; publishing remains your decision.')}</p>
    {dados && !dados.agendador_ativo && <p role="status">{t('O agendador está desligado neste ambiente. As rotinas ficam guardadas, mas não iniciam trabalhos.', 'The scheduler is off in this environment. Routines are saved but do not start work.')}</p>}
    <AvisoConsulta erro={erro} consultadoEm={consultadoEm} repetir={() => setTentativa(v => v + 1)} />
    {podeConfigurar && <button aria-expanded={nova} disabled={!projetos.some(p => !p.arquivado)} onClick={() => { formulario.current++; setNova(v => !v) }}>{t('Nova rotina por material', 'New material routine')}</button>}
    {!projetos.some(p => !p.arquivado) && <p>{t('Crie um projeto ativo para organizar as entregas da rotina.', 'Create an active project to organize routine deliverables.')}</p>}
    {nova && <form className="biblioteca-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget), intencao = formulario.current; void agir(async () => { await api.post(`${base}/rotinas-material`, { projeto_id: Number(f.get('projeto')), nome: f.get('nome'), arquivo_nome: f.get('arquivo'), pedido: f.get('pedido') }); if (telaAtual() && formulario.current === intencao) setNova(false) }) }}>
      <label>{t('Nome da rotina', 'Routine name')}<input name="nome" required maxLength={160} /></label><label>{t('Projeto', 'Project')}<select required name="projeto">{projetos.filter(p => !p.arquivado).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label><label>{t('Nome exato do arquivo na Entrada', 'Exact filename in Inbox')}<input name="arquivo" required maxLength={200} placeholder="relatorio-mensal.csv" /></label><label>{t('O que o Offiz deve preparar?', 'What should Offiz prepare?')}<textarea name="pedido" required maxLength={6000} /></label><p>{t('Ao ativar, você autoriza a produção quando esse arquivo chegar. Não é necessário aprovar cada início.', 'Activating authorizes production when this file arrives. Each start does not need separate approval.')}</p><button disabled={ocupado}>{t('Ativar rotina', 'Activate routine')}</button></form>}
    {dados?.itens.map(r => <article key={r.id} className="biblioteca-rotina"><div><h4>{r.nome}</h4><span>{r.projeto_nome}</span></div><p>{t('Quando chegar:', 'When this arrives:')} <strong>{r.arquivo_nome}</strong></p><p>{r.pedido}</p><div className="biblioteca-acoes"><span>{r.ativo ? t('Ativa', 'Active') : t('Pausada', 'Paused')}</span>{podeConfigurar && <button disabled={ocupado} onClick={() => void agir(() => api.put(`${base}/rotinas-material/${r.id}`, { ativo: !r.ativo }))}>{r.ativo ? t('Pausar', 'Pause') : t('Retomar', 'Resume')}</button>}</div>{!r.eventos.length && <small>{t('Aguardando a primeira chegada.', 'Waiting for the first arrival.')}</small>}{r.eventos.map(e => <div key={e.id} className="biblioteca-evento">{e.job_id ? <button onClick={() => abrir(e.job_id!)}>{t('Abrir trabalho', 'Open work')} #{e.job_id}</button> : <span>{e.estado === 'aguardando' ? t('Material recebido; aguardando início', 'Material received; waiting to start') : e.erro}</span>}{e.estado === 'pendencia' && podeConfigurar && <button disabled={ocupado} onClick={() => void agir(() => api.post(`${base}/rotinas-material/${r.id}/eventos/${e.id}/retomar`, {}))}>{t('Problema resolvido. Tentar novamente.', 'Issue resolved. Try again.')}</button>}</div>)}</article>)}
    <details className="biblioteca-agenda"><summary>{t('Rotinas por dia e horário', 'Routines by day and time')}</summary>{andares.length > 1 && <select value={area} aria-label={t('Equipe da agenda', 'Schedule team')} onChange={e => setArea(e.target.value)}>{andares.map(a => <option key={a.slug} value={a.slug}>{a.nome}</option>)}</select>}{area && <AgendaTab key={area} orgId={orgId} slug={area} podeEditar={podeConfigurar} />}</details>
    {mensagem && <p role="alert">{mensagem}</p>}
  </div>
}

function ResultadosBiblioteca({ base, areaSlug, revisao, abrir, pedirNaConversa }: { base: string; areaSlug?: string; revisao: number; abrir: (id: number, entregaId: number) => void; pedirNaConversa: (p: string, referencia?: ReferenciaConversa) => void }) {
  const { t } = useIdioma()
  const [offset, setOffset] = useState(0)
  const [mensagem, setMensagem] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const { dados, erro, consultadoEm } = useBiblioteca<{ total: number; atualizado_em: string; itens: (Resultado & { job_id: number; trabalho: string; arquivo: string })[] }>(`${base}/resultados?offset=${offset}${areaSlug ? `&office_slug=${encodeURIComponent(areaSlug)}` : ''}`, revisao + tentativa)
  return <div><h3>{t('O que vale repetir no próximo trabalho?', 'What is worth repeating in the next job?')}</h3><p>{t('Resultados ligados à versão utilizada, à fonte e ao período. Uma diferença observada ajuda a formular um teste; não comprova a causa.', 'Results linked to the version used, source and period. An observed difference helps formulate a test; it does not prove its cause.')}</p>
    <details><summary>{t('Importar resultados de um relatório CSV', 'Import results from a CSV report')}</summary><p>{t('Use UTF-8 e estas colunas:', 'Use UTF-8 and these columns:')}</p><code>entrega_id,metrica,valor,fonte,inicio,fim</code><p>{t('Datas no formato AAAA-MM-DD. O número da entrega aparece no detalhe do arquivo.', 'Dates use YYYY-MM-DD. The deliverable number appears in the file details.')}</p><input type="file" accept=".csv,text/csv" disabled={enviando} aria-label={t('Relatório de resultados', 'Results report')} onChange={async e => { const campo = e.currentTarget; const f = campo.files?.[0]; if (!f) return; setEnviando(true); setMensagem(''); const form = new FormData(); form.append('arquivo', f); try { const r = await api.postForm<{ adicionados: number; repetidos: number }>(`${base}/resultados/importar`, form); mudou(); setMensagem(t(`Novos resultados: ${r.adicionados}. Já registrados: ${r.repetidos}.`, `${r.adicionados} results added. ${r.repetidos} were already recorded.`)) } catch (e) { setMensagem(mensagemErro(e)) } finally { setEnviando(false); if (campo.isConnected) campo.value = '' } }} /></details>
    <AvisoConsulta erro={erro} consultadoEm={consultadoEm} repetir={() => setTentativa(v => v + 1)} />{mensagem && <p role="status">{mensagem}</p>}
    {dados?.total === 0 && <div className="biblioteca-vazio"><Icone nome="painel" tamanho={34} /><h3>{t('Ainda precisamos dos seus resultados.', 'We still need your results.')}</h3><p>{t('Abra uma entrega aprovada para registrar uma medição ou importe seu relatório. Não há números de exemplo nesta tela.', 'Open an approved deliverable to record a measurement or import your report. There are no sample numbers on this screen.')}</p></div>}
    {dados?.itens.map(r => <article className="biblioteca-resultado" key={r.id}><strong>{r.valor} {r.metrica}</strong><span>{r.trabalho}</span><small>{r.inicio} — {r.fim} · {r.fonte}</small><div className="biblioteca-acoes"><button onClick={() => abrir(r.job_id, r.entrega_id)}>{t('Ver a versão utilizada', 'View the version used')}</button><button onClick={() => pedirNaConversa(t(`Prepare um teste a partir do trabalho ${r.job_id} (${r.trabalho}). Resultado observado: ${r.valor} ${r.metrica}, de ${r.inicio} a ${r.fim}. Fonte informada: ${r.fonte}. Confira a qualidade dos dados, proponha uma hipótese e varie um elemento por vez. Não atribua causalidade sem evidência.`, `Prepare a test based on work ${r.job_id} (${r.trabalho}). Observed result: ${r.valor} ${r.metrica}, from ${r.inicio} to ${r.fim}. Reported source: ${r.fonte}. Check data quality, propose a hypothesis and vary one element at a time. Do not infer causation without evidence.`), { jobId: r.job_id, entregaId: r.entrega_id, intencao: 'testar' })}>{t('Preparar o próximo teste', 'Prepare the next test')}</button></div></article>)}
    {dados && dados.total > 24 && <div className="biblioteca-paginacao"><button disabled={!offset} onClick={() => setOffset(v => Math.max(0, v - 24))}>{t('Anterior', 'Previous')}</button><button disabled={offset + 24 >= dados.total} onClick={() => setOffset(v => v + 24)}>{t('Próxima', 'Next')}</button></div>}
  </div>
}
