import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, asList, ApiError, getSessionIdentity } from '../lib/api'
import { Link } from 'react-router-dom'
import { prepararDemoCriador } from '../lib/criador-demo'
import { iniciarDitadoLocal, type EstadoDitado } from '../lib/desktop-dictation'
import { appDownloadWindowsBase } from '../lib/downloadsApp'
import { DownloadsMac } from '../components/DownloadsMac'
import { DownloadsWindowsZIP } from '../components/DownloadsWindowsZIP'
import { useToasts } from '../components/Toasts'
import { useConfirmacao } from '../components/useConfirmacao'
import { Icone, iconeDoArquivo } from '../components/Icone'
import { ABA_CONHECIMENTO, ABA_GUIA, abasDoEscritorio, localizarAba } from '../lib/abas'
import {
  temCriadorDesktop,
  transporteDesktop,
  transporteSimulacao,
  type AnexoEnvio,
  type ArquivoAlterado,
  type CriadorTransporte,
  type EstadoCriador,
  type EventoCriador,
  type ManifestoCriador,
} from '../lib/criador-transporte'
import type { OfficeInfo, PromptPronto } from '../lib/types'
import { useIdioma, type Idioma, type Traduzir } from '../lib/i18n'
import { AREAS_OFFICE, agruparOffices, areaDoOffice, nomeArea, nomeModulo } from '../lib/office-areas'
import '../components/catalogo-areas.css'

/* =============================================================
   O CRIADOR DE ESCRITÓRIOS — "quase um Claude Code".

   Claude de um lado, o escritório do outro (decisão do dono,
   07/08/2026): a conversa edita a cópia de trabalho e o lado
   direito mostra O PRODUTO — o escritório como o cliente vê,
   desenhado pelas MESMAS regras da shell (lib/abas). Nada
   acontece no catálogo até o consultor clicar em Publicar.

   Dois transportes (lib/criador-transporte): o app desktop
   roda o Claude CLI local (o de verdade); na web entra a
   simulação sem IA — comandos determinísticos, úteis para
   demonstrar a tela e editar manifesto rápido. A tela sempre
   DIZ qual dos dois está ativo.
   ============================================================= */

interface Mensagem {
  id: number
  papel: 'consultor' | 'criador' | 'erro'
  texto: string
  ferramentas: string[]
}

/* ─── Escolha do alvo (a primeira tela) ───────────────────────────────────── */

function slugDe(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

const DOWNLOAD_WIN = `${appDownloadWindowsBase}/Offiz-Setup.exe`

/** O convite para baixar o app — só aparece na web (sem a ponte do CLI). */
function CartaoDownloadApp() {
  const { t: traduzir } = useIdioma()
  return (
    <div className="alerta alerta-aviso criador-download" role="note">
      <p>
        <strong>{traduzir("O Claude de verdade roda no Offiz Desktop.", "The real Claude runs in Offiz Desktop.")}</strong> {traduzir("Aqui na web esta tela funciona em simulação (comandos fixos, sem IA). Baixe o app, entre com esta mesma conta e o criador conversa com o Claude Code CLI da sua máquina.", "On the web, this screen runs a simulation with fixed commands and no AI. Download the app and sign in with the same account to use your machine’s Claude Code CLI.")}
      </p>
      <span className="linha-conceder" style={{ flexWrap: 'wrap' }}>
        <a className="botao botao-primario botao-pequeno" href={DOWNLOAD_WIN}>
          <Icone nome="baixar" tamanho={15} /> {traduzir("Baixar para Windows", "Download for Windows")}
        </a>
        <DownloadsWindowsZIP />
      </span>
      <DownloadsMac />
    </div>
  )
}

/** Linha do catálogo como o /admin/offices devolve para o criador. */
type OfficeCatalogo = OfficeInfo & { origem?: string; orgs_ativas?: number }

/** "20260807-193040.zip" → "07/08/2026 19:30" (o nome da versão É o instante
 *  UTC em que ela saiu de cena). */
function rotuloVersao(nome: string, idioma: Idioma): string {
  const m = nome.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/)
  if (!m) return nome
  const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
  return utc.toLocaleString(idioma, { dateStyle: 'short', timeStyle: 'short' })
}

/** Uma linha do catálogo + as VERSÕES dela (o rollback de um clique).
 *  Toda publicação/exclusão guarda a versão que saiu; restaurar também
 *  guarda a vigente — desfazer o desfazer é clicar de novo. */
function LinhaCatalogo({
  office: o,
  aoAbrir,
  aoMudar,
}: {
  office: OfficeCatalogo
  aoAbrir: (slug: string) => void
  /** recarrega o catálogo (a exclusão tira/reverte a linha) */
  aoMudar: () => void | Promise<void>
}) {
  const { t: traduzir, idioma } = useIdioma()
  const { sucesso, falha } = useToasts()
  const [versoesAbertas, setVersoesAbertas] = useState(false)
  const [versoes, setVersoes] = useState<Array<{ nome: string; bytes: number }> | null>(null)
  const [restaurando, setRestaurando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [salvandoCatalogo, setSalvandoCatalogo] = useState(false)
  const [erroCatalogo, setErroCatalogo] = useState<string | null>(null)
  const [erroVersoes, setErroVersoes] = useState<string | null>(null)
  const salvandoRef = useRef(false)
  const alterandoRef = useRef(false)
  const contaRef = useRef(getSessionIdentity())
  const montadoRef = useRef(true)
  const versoesRef = useRef<AbortController | null>(null)
  const { confirmar, dialogo } = useConfirmacao(`${contaRef.current}:${o.slug}`)
  const telaAtual = () => montadoRef.current && getSessionIdentity() === contaRef.current
  useEffect(() => { montadoRef.current = true; return () => { montadoRef.current = false; versoesRef.current?.abort() } }, [])

  async function organizar(patch: { area?: OfficeInfo['area']; arquivado?: boolean }) {
    if (!telaAtual() || salvandoRef.current || alterandoRef.current) return
    salvandoRef.current = true
    setSalvandoCatalogo(true)
    setErroCatalogo(null)
    try {
      await api.put(`/admin/offices/${o.slug}/manifesto`, patch)
      if (!telaAtual()) return
      sucesso(patch.arquivado === true
        ? traduzir(`“${o.nome}” arquivado. Histórico e acessos existentes preservados.`, `“${o.nome}” archived. History and existing access are preserved.`)
        : patch.arquivado === false
          ? traduzir(`“${o.nome}” voltou ao catálogo disponível.`, `“${o.nome}” is available in the catalog again.`)
          : traduzir('Área atualizada.', 'Area updated.'))
      await aoMudar()
    } catch (e) {
      if (telaAtual()) setErroCatalogo(e instanceof ApiError ? e.detail : traduzir('Não foi possível atualizar o catálogo. Tente novamente.', 'Could not update the catalog. Try again.'))
    } finally {
      salvandoRef.current = false
      if (telaAtual()) setSalvandoCatalogo(false)
    }
  }

  async function excluir() {
    if (!telaAtual() || salvandoRef.current || alterandoRef.current) return
    if (!await confirmar({ titulo: traduzir('Excluir versão personalizada', 'Delete custom version'),
      mensagem: traduzir(`Excluir a versão personalizada de “${o.nome || o.slug}”?\n\nSe existir a versão embutida (do produto), ela volta a valer na hora; se não existir, o escritório sai do catálogo. Uma cópia fica guardada nas versões — dá para restaurar depois.`, `Delete the custom version of “${o.nome || o.slug}”?\n\nThe built-in version takes effect immediately if one exists; otherwise, the office is removed from the catalog. A copy is saved in version history for later restoration.`),
      acao: traduzir('Excluir versão personalizada', 'Delete custom version'),
    }) || !telaAtual() || salvandoRef.current || alterandoRef.current) return
    alterandoRef.current = true
    setExcluindo(true)
    try {
      await api.del(`/admin/offices/${o.slug}`)
      if (!telaAtual()) return
      sucesso(traduzir(`Versão personalizada de “${o.nome || o.slug}” excluída.`, `Custom version of “${o.nome || o.slug}” deleted.`))
      await aoMudar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível excluir.", "Could not delete this version."))
    } finally {
      alterandoRef.current = false
      if (telaAtual()) setExcluindo(false)
    }
  }

  async function carregarVersoes() {
    if (!telaAtual()) return
    versoesRef.current?.abort()
    const controller = new AbortController()
    versoesRef.current = controller
    setErroVersoes(null)
    try {
      const r = await api.get<{ versoes: Array<{ nome: string; bytes: number }> }>(`/admin/offices/${o.slug}/versoes`, controller.signal)
      if (telaAtual() && !controller.signal.aborted) setVersoes(r.versoes)
    } catch (e) {
      if (telaAtual() && !controller.signal.aborted) setErroVersoes(e instanceof ApiError ? e.detail : traduzir('Não foi possível ler as versões. Tente novamente.', 'Could not read versions. Try again.'))
    }
  }

  function alternarVersoes() {
    const abrir = !versoesAbertas
    setVersoesAbertas(abrir)
    if (abrir && versoes === null) void carregarVersoes()
  }

  async function restaurar(nome: string) {
    if (!telaAtual() || salvandoRef.current || alterandoRef.current) return
    if (!await confirmar({ titulo: traduzir('Restaurar versão do escritório', 'Restore office version'),
      mensagem: traduzir(`Restaurar “${o.nome || o.slug}” para a versão de ${rotuloVersao(nome, idioma)}?\n\nVale NA HORA para todos os clientes com este escritório. A versão atual também fica guardada — dá para desfazer este rollback.`, `Restore “${o.nome || o.slug}” to the version from ${rotuloVersao(nome, idioma)}?\n\nThis takes effect immediately for every client using this office. The current version is also saved so this rollback can be undone.`),
      acao: traduzir('Restaurar versão', 'Restore version'),
    }) || !telaAtual() || salvandoRef.current || alterandoRef.current) return
    alterandoRef.current = true
    setRestaurando(true)
    try {
      await api.post(`/admin/offices/${o.slug}/versoes/${nome}/restaurar`)
      if (!telaAtual()) return
      versoesRef.current?.abort()
      sucesso(traduzir(`“${o.nome || o.slug}” restaurado para ${rotuloVersao(nome, idioma)}.`, `“${o.nome || o.slug}” restored to ${rotuloVersao(nome, idioma)}.`))
      setVersoes(null)
      setVersoesAbertas(false)
      await aoMudar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível restaurar.", "Could not restore this version."))
    } finally {
      alterandoRef.current = false
      if (telaAtual()) setRestaurando(false)
    }
  }

  return (
    <div className="criador-linha-bloco" data-office={o.slug}>
      {dialogo}
      <div className="criador-linha">
        <button type="button" className="criador-linha-abrir-area" onClick={() => aoAbrir(o.slug)}>
          <Icone nome={o.tema?.icone || 'predio'} className="criador-linha-icone" />
          <span className="criador-linha-nome">
            <strong>{o.nome || o.slug}</strong> <code>{o.slug}</code>
            {o.arquivado && <span className="catalogo-estado">{traduzir('Arquivado', 'Archived')}</span>}
            {!o.arquivado && o.vendavel === false && <span className="catalogo-estado">{traduzir('Interno / parceiros', 'Internal / collaborators')}</span>}
            {o.origem === 'personalizado' && (
              <span title={traduzir("Editado — vive no volume", "Edited — stored on the volume")}> <Icone nome="lapis" tamanho={14} /></span>
            )}
          </span>
          {/* O raio de impacto de uma edição: em quantos clientes ela cai. */}
          <span
            className={`criador-linha-ativos${(o.orgs_ativas ?? 0) > 0 ? '' : ' texto-suave'}`}
            title={traduzir("Clientes com este escritório ativo — publicar muda para todos eles", "Clients using this office — publishing changes it for all of them")}
          >
            {(o.orgs_ativas ?? 0) === 0
              ? traduzir("sem clientes", "no clients")
              : traduzir(`ativo em ${o.orgs_ativas} cliente${(o.orgs_ativas ?? 0) > 1 ? 's' : ''}`, `active for ${o.orgs_ativas} client${(o.orgs_ativas ?? 0) > 1 ? 's' : ''}`)}
          </span>
          <span className="criador-linha-abrir" aria-hidden="true">{traduzir("Abrir →", "Open →")}</span>
        </button>
        <button
          type="button"
          className="botao botao-fantasma botao-pequeno"
          onClick={alternarVersoes}
          aria-expanded={versoesAbertas}
          title={traduzir("Versões guardadas — rollback de um clique", "Saved versions — restore with one click")}
        >
          {traduzir("↩ versões", "↩ versions")}
        </button>
        {o.origem === 'personalizado' && (
          <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            onClick={excluir}
            disabled={excluindo || restaurando || salvandoCatalogo}
            title={traduzir("Excluir a versão personalizada (a embutida volta a valer, se existir)", "Delete the custom version (restores the built-in version, if available)")}
          >
            {excluindo ? traduzir("Excluindo…", "Deleting…") : <><Icone nome="lixeira" tamanho={15} /> {traduzir("excluir", "delete")}</>}
          </button>
        )}
      </div>
      <details className="catalogo-organizar">
        <summary>{traduzir('Organizar serviço', 'Organize service')}</summary>
        <div className="catalogo-organizar-controles">
          <label className="campo">
            <span>{traduzir('Área', 'Area')}</span>
            <select aria-label={traduzir(`Área de ${o.nome}`, `Area for ${o.nome}`)} value={areaDoOffice(o)} disabled={excluindo || restaurando || salvandoCatalogo} onChange={e => organizar({ area: e.target.value === 'outros' ? null : e.target.value as OfficeInfo['area'] })}>
              {AREAS_OFFICE.map(id => <option key={id} value={id}>{nomeArea(id, traduzir)}</option>)}
            </select>
          </label>
          <button type="button" className="botao botao-fantasma botao-pequeno" disabled={excluindo || restaurando || salvandoCatalogo} onClick={() => organizar({ arquivado: !o.arquivado })}>
            {salvandoCatalogo ? traduzir('Salvando…', 'Saving…') : o.arquivado ? traduzir('Restaurar ao catálogo', 'Restore to catalog') : traduzir('Arquivar serviço', 'Archive service')}
          </button>
        </div>
        <p className="texto-suave">{traduzir('Arquivar retira o serviço de novos cadastros e concessões. Clientes atuais continuam com acesso e histórico. Você pode restaurar depois.', 'Archiving removes the service from new registrations and grants. Existing clients keep access and history. You can restore it later.')}</p>
        {erroCatalogo && <p className="alerta alerta-erro" role="alert">{erroCatalogo}</p>}
      </details>
      {versoesAbertas && (
        <div className="criador-versoes">
          {erroVersoes && <p className="alerta alerta-erro" role="alert">{erroVersoes}{' '}<button type="button" className="botao-texto" onClick={() => void carregarVersoes()}>{traduzir('Tentar novamente', 'Try again')}</button></p>}
          {versoes === null && !erroVersoes && <p className="texto-suave">{traduzir("Lendo as versões…", "Reading versions…")}</p>}
          {versoes !== null && versoes.length === 0 && (
            <p className="texto-suave">
              {traduzir("Nenhuma versão guardada ainda — elas nascem a cada publicação que substitui este escritório.", "No saved versions yet. A version is saved whenever a publication replaces this office.")}
            </p>
          )}
          {(versoes ?? []).map((v) => (
            <span key={v.nome} className="criador-versao">
              <code>{rotuloVersao(v.nome, idioma)}</code>
              <span className="texto-suave">{Math.max(1, Math.round(v.bytes / 1024))} KB</span>
              <button
                type="button"
                className="botao botao-fantasma botao-pequeno"
                onClick={() => restaurar(v.nome)}
                disabled={excluindo || restaurando || salvandoCatalogo}
              >
                {traduzir("Restaurar", "Restore")}
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function EscolhaAlvo({ aoAbrir }: { aoAbrir: (slug: string) => void }) {
  const { t: traduzir } = useIdioma()
  const { falha, sucesso } = useToasts()
  const [offices, setOffices] = useState<OfficeCatalogo[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const [mostrarArquivados, setMostrarArquivados] = useState(false)
  const [carregandoCatalogo, setCarregandoCatalogo] = useState(true)
  const geracaoCatalogo = useRef(0)
  const contaRef = useRef(getSessionIdentity())
  const montadoRef = useRef(true)
  const criandoRef = useRef(false)
  const telaAtual = () => montadoRef.current && getSessionIdentity() === contaRef.current
  useEffect(() => { montadoRef.current = true; return () => { montadoRef.current = false } }, [])

  const [nomeNovo, setNomeNovo] = useState('')
  const [slugNovo, setSlugNovo] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)
  const [origemNovo, setOrigemNovo] = useState('_basico')
  const [criando, setCriando] = useState(false)
  const slugEfetivo = slugTocado ? slugNovo : slugDe(nomeNovo)

  const recarregarCatalogo = useCallback(() => {
    const geracao = ++geracaoCatalogo.current
    return api.get<unknown>('/admin/offices')
      .then((d) => { if (geracao === geracaoCatalogo.current) { setOffices(asList(d, 'offices')); setErro(null) } })
      .catch((e) => { if (geracao === geracaoCatalogo.current) setErro(e instanceof ApiError ? e.detail : traduzir('Não foi possível listar os escritórios.', 'Could not list offices.')) })
      .finally(() => { if (geracao === geracaoCatalogo.current) setCarregandoCatalogo(false) })
  }, [traduzir])
  useEffect(() => { void recarregarCatalogo(); return () => { geracaoCatalogo.current += 1 } }, [recarregarCatalogo])

  async function criar() {
    if (!telaAtual() || criandoRef.current) return
    if (!nomeNovo.trim()) { falha(traduzir("Dê um nome ao escritório.", "Give the office a name.")); return }
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slugEfetivo)) {
      falha(traduzir("Slug inválido: minúsculas, números e hífens, de 2 a 61 caracteres.", "Invalid slug: use 2–61 lowercase letters, numbers or hyphens."))
      return
    }
    criandoRef.current = true
    setCriando(true)
    try {
      const r = await api.post<{ slug: string; arquivos: number }>('/admin/offices', {
        slug: slugEfetivo, nome: nomeNovo.trim(), origem: origemNovo,
      })
      if (!telaAtual()) return
      sucesso(traduzir(`“${nomeNovo.trim()}” criado com ${r.arquivos} arquivos — abrindo no criador.`, `“${nomeNovo.trim()}” created with ${r.arquivos} files. Opening in the builder.`))
      aoAbrir(r.slug)
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível criar o escritório.", "Could not create the office."))
    } finally {
      criandoRef.current = false
      if (telaAtual()) setCriando(false)
    }
  }

  const termo = filtro.trim().toLowerCase()
  const visiveis = offices.filter(o => mostrarArquivados || !o.arquivado)
  const filtrados = termo
    ? visiveis.filter(
        (o) =>
          (o.nome || '').toLowerCase().includes(termo) ||
          o.slug.toLowerCase().includes(termo) ||
          (o.descricao || '').toLowerCase().includes(termo) ||
          nomeArea(areaDoOffice(o), traduzir).toLowerCase().includes(termo) ||
          nomeModulo(o, traduzir).toLowerCase().includes(termo),
      )
    : visiveis

  return (
    <div className="criador-escolha">
      {/* Criar novo BEM EM CIMA (pedido do dono, 07/08/2026): criar é a ação
          nobre do criador; a lista do catálogo vem depois, filtrável. Ajuste
          exclusivo de cliente NÃO existe mais — cliente que quer algo muito
          próprio ganha um clone dele (ex.: conteudo-clientex), cobrado à parte. */}
      <h2 className="secao-subtitulo">{traduzir("Criar escritório novo", "Create a new office")}</h2>
      <p className="texto-suave">
        {traduzir("Nasce de uma cópia que roda: o molde básico ou um clone — inclusive o clone POR CLIENTE (ex.: conteudo-clientex) quando um cliente pede algo que não serve aos outros.", "Start from the basic template or a working copy of an existing office. Use a client-specific copy when a client needs something that does not apply to others.")}
      </p>
      <div className="linha-conceder tp-seletores">
        <label className="campo">
          <span>{traduzir("Partir de", "Start from")}</span>
          <select value={origemNovo} onChange={(e) => setOrigemNovo(e.target.value)}>
            <option value="_basico">{traduzir("Escritório básico (molde em branco)", "Basic office (blank template)")}</option>
            {offices.filter(o => !o.arquivado).map((o) => (
              <option key={o.slug} value={o.slug}>{traduzir(`Clone de ${o.nome || o.slug}`, `Copy of ${o.nome || o.slug}`)}</option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>{traduzir("Nome", "Name")}</span>
          <input type="text" value={nomeNovo} maxLength={80} placeholder={traduzir("Recursos Humanos", "Human Resources")}
            onChange={(e) => setNomeNovo(e.target.value)} />
        </label>
        <label className="campo">
          <span>Slug</span>
          <input type="text" value={slugEfetivo} placeholder="rh"
            onChange={(e) => { setSlugTocado(true); setSlugNovo(e.target.value.toLowerCase()) }} />
        </label>
        <button type="button" className="botao botao-primario" onClick={criar} disabled={criando}>
          {criando ? traduzir("Criando…", "Creating…") : <><Icone nome="mais" tamanho={15} /> {traduzir("Criar e abrir", "Create and open")}</>}
        </button>
      </div>

      <h2 className="secao-subtitulo">{traduzir("Escritórios do catálogo", "Office catalog")}</h2>
      {erro && <p className="alerta alerta-erro">{erro}</p>}
      <div className="linha-conceder admin-filtro">
        <input
          type="search"
          value={filtro}
          placeholder={traduzir("Filtrar por nome, slug ou descrição…", "Filter by name, slug or description…")}
          aria-label={traduzir("Filtrar escritórios", "Filter offices")}
          onChange={(e) => setFiltro(e.target.value)}
        />
        {filtro && (
          <button type="button" className="botao-texto" onClick={() => setFiltro('')}>{traduzir("limpar", "clear")}</button>
        )}
        <span className="texto-suave">{traduzir(`${filtrados.length} de ${visiveis.length}`, `${filtrados.length} of ${visiveis.length}`)}</span>
        <label className="catalogo-mostrar-arquivados"><input type="checkbox" checked={mostrarArquivados} onChange={e => setMostrarArquivados(e.target.checked)} />{traduzir('Mostrar arquivados', 'Show archived')} ({offices.filter(o => o.arquivado).length})</label>
      </div>
      <div className="criador-lista">
        {agruparOffices(filtrados).map(grupo => (
          <section className="catalogo-area" key={grupo.id} aria-label={nomeArea(grupo.id, traduzir)}>
            <h3>{nomeArea(grupo.id, traduzir)}</h3>
            {grupo.offices.map(o => <LinhaCatalogo key={o.slug} office={o} aoAbrir={aoAbrir} aoMudar={recarregarCatalogo} />)}
          </section>
        ))}
        {carregandoCatalogo && <p className="texto-suave">{traduzir("Carregando…", "Loading…")}</p>}
        {!carregandoCatalogo && !erro && filtrados.length === 0 && (
          <p className="texto-suave">{traduzir(`Nada com “${filtro}”.`, `No results for “${filtro}”.`)}</p>
        )}
      </div>
    </div>
  )
}

/* ─── O preview: o escritório como o cliente vê ───────────────────────────── */

function PreviewEscritorio({
  manifesto,
  slug,
  aoAbrirDemo,
}: {
  manifesto: ManifestoCriador | null
  slug: string
  aoAbrirDemo: () => void
}) {
  const { t: traduzir, idioma } = useIdioma()
  const [abaAtiva, setAbaAtiva] = useState('conversa')

  // As MESMAS regras da shell do cliente (lib/abas) — é o que torna o preview
  // honesto: manifesto sem `abas` cai nas regras por flag/slug, igual lá.
  const abas = useMemo(
    () => abasDoEscritorio((manifesto ?? null) as OfficeInfo | null, slug).map((aba) => localizarAba(aba, idioma)),
    [manifesto, slug, idioma],
  )
  // As portas fixas também são clicáveis (pedido do dono: "não consigo clicar
  // no guia") — mostram o placeholder e apontam para a demo real.
  const fixas = [ABA_CONHECIMENTO, ABA_GUIA].map((aba) => localizarAba(aba, idioma))
  const todas = [...abas, ...fixas]
  const abaSel = todas.find((a) => a.id === abaAtiva) ?? abas[0]

  if (!manifesto) {
    return (
      <div className="alerta alerta-erro">
        {traduzir("O office.json da bancada está ilegível — peça na conversa para corrigir o JSON.", "The workspace’s office.json cannot be read. Ask in the conversation to fix the JSON.")}
      </div>
    )
  }

  const tema = manifesto.tema ?? {}
  const grupos: Array<{ escopo: string; itens: PromptPronto[] }> = []
  for (const p of manifesto.prompts_prontos ?? []) {
    const escopo = p.escopo || ''
    const g = grupos.find((x) => x.escopo === escopo)
    if (g) g.itens.push(p)
    else grupos.push({ escopo, itens: [p] })
  }

  return (
    <div
      className="pv-janela"
      style={{
        ['--pv-primaria' as string]: tema.cor_primaria || '#33415c',
        ['--pv-acento' as string]: tema.cor_acento || tema.cor_primaria || '#5b7cb5',
      }}
    >
      <div className="pv-chrome">
        <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
        <em>{traduzir("como o cliente vê", "the client’s view")} — {manifesto.nome || slug}</em>
        <button
          type="button"
          className="botao botao-fantasma botao-pequeno pv-demo"
          onClick={aoAbrirDemo}
          title={traduzir("Abre a shell REAL numa empresa de demonstração com este escritório — painéis, guia e conhecimento de verdade", "Open the real interface in a demo company with this office, including its panels, guide and knowledge")}
        >
          <Icone nome="lupa" tamanho={15} /> {traduzir("Ver demo real", "Open real demo")}
        </button>
      </div>
      <div className="pv-corpo">
        <nav className="pv-menu" aria-label={traduzir("Menu do escritório (preview)", "Office menu (preview)")}>
          <div className="pv-marca" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Icone nome={tema.icone || 'predio'} tamanho={15} /> {manifesto.nome || slug}
          </div>
          {abas.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`pv-item${abaSel?.id === a.id ? ' ativo' : ''}`}
              onClick={() => setAbaAtiva(a.id)}
              title={a.ajuda}
            >
              <Icone nome={a.icone} tamanho={15} /> {a.rotulo}
            </button>
          ))}
          <div className="pv-separador" aria-hidden="true" />
          {fixas.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`pv-item pv-item-fixo${abaSel?.id === a.id ? ' ativo' : ''}`}
              onClick={() => setAbaAtiva(a.id)}
              title={traduzir("Porta fixa da shell — sempre presente, fora do manifesto", "This section is always available, independent of the manifest")}
            >
              <Icone nome={a.icone} tamanho={15} /> {a.rotulo}
            </button>
          ))}
        </nav>
        <div className="pv-area">
          {abaSel?.id === 'conversa' ? (
            <>
              <p className="pv-ajuda">{abaSel.ajuda}</p>
              {grupos.map((g) => (
                <div key={g.escopo || '(sem seção)'}>
                  {(grupos.length > 1 || g.escopo) && <h4 className="pv-escopo">{g.escopo || traduzir("Tarefas", "Tasks")}</h4>}
                  <div className="pv-cards">
                    {g.itens.map((p, i) => (
                      <div className="pv-card" key={`${p.titulo}-${i}`}>
                        <strong>{p.titulo}</strong>
                        {p.descricao && <span>{p.descricao}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {(manifesto.prompts_prontos ?? []).length === 0 && (
                <p className="texto-suave">{traduzir("Nenhuma tarefa pronta — o cliente só teria a conversa livre.", "No task templates. The client would have only the free-form conversation.")}</p>
              )}
            </>
          ) : (
            <div className="pv-painel-placeholder">
              {abaSel?.icone && <Icone nome={abaSel.icone} tamanho={36} traco={1.4} />}
              <strong>{abaSel?.rotulo}</strong>
              <p className="texto-suave">{abaSel?.ajuda}</p>
              <p className="texto-suave pv-nota">
                {abaSel?.id === 'conhecimento' || abaSel?.id === 'guia'
                  ? traduzir("Porta fixa da shell, sempre presente. O conteúdo real abre na demo:", "This section is always available. Open the demo to see its real content:")
                  : traduzir("O conteúdo deste painel é do produto — o manifesto escolhe se ele aparece e com que nome. Para vê-lo funcionando:", "This panel is built into the product. The manifest chooses whether to show it and its name. To see it working:")}
              </p>
              <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoAbrirDemo}>
                <Icone nome="lupa" tamanho={15} /> {traduzir("Ver demo real", "Open real demo")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Painel Arquivos: ver o prompt E as skills, lado a lado ──────────────── */

/** O outro lado do preview (pedido do dono: "só vendo o prompt é difícil de
 *  ajustar"): a árvore do escritório na bancada, com leitor. No app é o disco
 *  de verdade; na web só o office.json (não há bancada). Leitura pura — quem
 *  edita é a conversa. */
function PainelArquivos({ transporte }: { transporte: CriadorTransporte }) {
  const { t: traduzir } = useIdioma()
  const [lista, setLista] = useState<Array<{ caminho: string; tamanho: number }> | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  const [conteudo, setConteudo] = useState<string | null>(null)
  const [avisoArquivo, setAvisoArquivo] = useState<string | null>(null)
  const [erroArquivo, setErroArquivo] = useState(false)
  const contaRef = useRef(getSessionIdentity())
  const montadoRef = useRef(true)
  const listaRef = useRef(0)
  const arquivoRef = useRef(0)
  const telaAtual = useCallback(() => montadoRef.current && getSessionIdentity() === contaRef.current, [])
  useEffect(() => { montadoRef.current = true; return () => { montadoRef.current = false; listaRef.current++; arquivoRef.current++ } }, [])

  const recarregar = useCallback(async () => {
    if (!telaAtual()) return
    const leitura = ++listaRef.current
    try {
      const r = await transporte.arquivos()
      if (!telaAtual() || leitura !== listaRef.current) return
      if (r.ok) { setLista(r.arquivos ?? []); setErro(null) }
      else setErro(r.error ?? traduzir("Não foi possível listar.", "Could not list files."))
    } catch (e) {
      if (telaAtual() && leitura === listaRef.current) setErro(e instanceof Error ? e.message : traduzir('Não foi possível listar.', 'Could not list files.'))
    }
  }, [transporte, traduzir, telaAtual])

  useEffect(() => { recarregar() }, [recarregar])

  async function abrirArquivo(caminho: string) {
    if (!telaAtual()) return
    const leitura = ++arquivoRef.current
    setAberto(caminho)
    setConteudo(null)
    setAvisoArquivo(null)
    setErroArquivo(false)
    try {
      const r = await transporte.arquivo(caminho)
      if (!telaAtual() || leitura !== arquivoRef.current) return
      if (!r.ok) { setErroArquivo(true); setAvisoArquivo(r.error ?? traduzir("Não deu para ler.", "Could not read this file.")) }
      else if (r.binario) setAvisoArquivo(r.aviso ?? traduzir(`Arquivo binário (${r.tamanho} bytes) — sem visualização.`, `Binary file (${r.tamanho} bytes) — no preview.`))
      else setConteudo(r.conteudo ?? '')
    } catch (e) {
      if (telaAtual() && leitura === arquivoRef.current) { setErroArquivo(true); setAvisoArquivo(e instanceof Error ? e.message : traduzir('Não deu para ler.', 'Could not read this file.')) }
    }
  }

  const kb = (n: number) => (n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)

  return (
    <div className="pv-janela pv-arquivos">
      <div className="pv-chrome">
        <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
        <em>{traduzir("os arquivos da bancada — leitura", "workspace files — read only")}</em>
        <button type="button" className="botao botao-fantasma botao-pequeno pv-demo" onClick={recarregar}>
          <Icone nome="loop" tamanho={15} /> {traduzir("atualizar", "refresh")}
        </button>
      </div>
      <div className="pv-corpo">
        <nav className="pv-menu pv-menu-arquivos" aria-label={traduzir("Arquivos do escritório", "Office files")}>
          {erro && <p className="alerta alerta-erro" role="alert">{erro}{' '}<button type="button" className="botao-texto" onClick={() => void recarregar()}>{traduzir('Tentar novamente', 'Try again')}</button></p>}
          {lista === null && !erro && <p className="texto-suave">{traduzir("Lendo…", "Reading…")}</p>}
          {lista?.map((a) => (
            <button
              key={a.caminho}
              type="button"
              className={`pv-item${aberto === a.caminho ? ' ativo' : ''}`}
              onClick={() => abrirArquivo(a.caminho)}
              title={`${a.caminho} · ${kb(a.tamanho)}`}
            >
              <Icone nome={iconeDoArquivo(a.caminho)} tamanho={15} />
              <span className="pv-arquivo-nome">{a.caminho}</span>
            </button>
          ))}
        </nav>
        <div className="pv-area">
          {aberto === null && (
            <p className="texto-suave">
              {traduzir("Escolha um arquivo — o CLAUDE.md diz o método, cada skill em skills/…/SKILL.md diz um jeito de trabalhar, e o office.json é a vitrine + tarefas. Para mudar, peça na conversa.", "Choose a file. CLAUDE.md defines the method, skills/…/SKILL.md describes each workflow, and office.json defines the catalog entry and tasks. Request changes in the conversation.")}
            </p>
          )}
          {aberto !== null && (
            <>
              <p className="pv-arquivo-titulo"><code>{aberto}</code></p>
              {avisoArquivo && <p className="texto-suave" role={erroArquivo ? 'alert' : 'status'}>{avisoArquivo}{erroArquivo && <>{' '}<button type="button" className="botao-texto" onClick={() => void abrirArquivo(aberto)}>{traduzir('Tentar novamente', 'Try again')}</button></>}</p>}
              {conteudo === null && !avisoArquivo && <p className="texto-suave">{traduzir("Abrindo…", "Opening…")}</p>}
              {conteudo !== null && <pre className="pv-arquivo-conteudo">{conteudo}</pre>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Voz e anexos ────────────────────────────────────────────────────────── */

/** Blob → base64 puro (sem o prefixo data:). */
function blobParaBase64(blob: Blob, traduzir: Traduzir): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error(traduzir('Não consegui ler o arquivo.', 'Could not read the file.')))
    r.readAsDataURL(blob)
  })
}

/** Só o nome-base, sem caminho e sem caractere que vire outra coisa no disco. */
function nomeSeguro(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? 'arquivo'
  return base.replace(/[^\w.\-()À-ſ ]+/g, '_').slice(0, 120) || 'arquivo'
}

type SpeechRecognitionCtor = new () => {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((ev: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((ev: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

/** Ditado do navegador. O aplicativo usa o Whisper local antes deste caminho. */
function apiDeDitado(): SpeechRecognitionCtor | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as SpeechRecognitionCtor | null
}

/* ─── A sessão: conversa + preview ────────────────────────────────────────── */

let _idMsg = 0

export default function CriadorPage() {
  return <CriadorConteudo key={getSessionIdentity()} />
}

function CriadorConteudo() {
  const { t: traduzir, idioma } = useIdioma()
  const { sucesso, falha } = useToasts()
  const idiomaRef = useRef(idioma)
  useEffect(() => { idiomaRef.current = idioma }, [idioma])
  // O transporte é decidido UMA vez: app desktop → CLI local; web → simulação.
  const transporteRef = useRef<CriadorTransporte | null>(null)
  if (transporteRef.current === null) {
    transporteRef.current = temCriadorDesktop()
      ? transporteDesktop(() => idiomaRef.current)
      : transporteSimulacao(() => idiomaRef.current)
  }
  const transporte = transporteRef.current

  const rotulosAlteracao: Record<ArquivoAlterado["acao"], string> = { novo: traduzir("novo", "new"), alterado: traduzir("alterado", "modified"), removido: traduzir("removido", "removed") }
  const [sessao, setSessao] = useState<EstadoCriador | null>(null)
  const [manifesto, setManifesto] = useState<ManifestoCriador | null>(null)
  const [alterados, setAlterados] = useState<ArquivoAlterado[]>([])
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [texto, setTexto] = useState('')
  const [abrindo, setAbrindo] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const [fechando, setFechando] = useState(false)
  const [demoLink, setDemoLink] = useState('')
  const preparandoDemo = useRef(false)
  // Anexos já GRAVADOS na bancada nesta sessão (chips acima da entrada). O
  // material que explica o escritório: briefing, planilha, áudio .ogg/.mp3…
  const [anexos, setAnexos] = useState<string[]>([])
  const [anexando, setAnexando] = useState(false)
  // Lado direito: o produto (preview) ou os arquivos da bancada.
  const [lado, setLado] = useState<'produto' | 'arquivos'>('produto')
  // Fala: 'ditando' (SpeechRecognition → texto) ou 'gravando' (MediaRecorder →
  // vira anexo de áudio). null = parado.
  const [voz, setVoz] = useState<'preparando' | 'ditando' | 'gravando' | null>(null)
  const ditadoRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null)
  const gravadorRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const permissaoRef = useRef(0)
  const pedindoMicrofoneRef = useRef(false)
  const ditadoLocalRef = useRef<ReturnType<typeof iniciarDitadoLocal> | null>(null)
  const [vozLocal, setVozLocal] = useState<EstadoDitado>('parado')
  const arquivoRef = useRef<HTMLInputElement | null>(null)
  const fimRef = useRef<HTMLDivElement | null>(null)
  const contaRef = useRef(getSessionIdentity())
  const montadoRef = useRef(true)
  const bancadaRef = useRef(0)
  const operacaoRef = useRef(false)
  const { confirmar, dialogo } = useConfirmacao(`${contaRef.current}:${sessao?.slug ?? 'catalogo'}`)
  const telaAtual = useCallback((bancada?: number) => montadoRef.current && getSessionIdentity() === contaRef.current && (bancada === undefined || bancadaRef.current === bancada), [])
  useEffect(() => { montadoRef.current = true; return () => { montadoRef.current = false; bancadaRef.current++ } }, [])

  const cancelarVoz = useCallback(() => {
    permissaoRef.current++
    pedindoMicrofoneRef.current = false
    ditadoLocalRef.current?.cancelar(); ditadoLocalRef.current = null
    const ditado = ditadoRef.current
    ditadoRef.current = null
    if (ditado) {
      ditado.onresult = null; ditado.onerror = null; ditado.onend = null
      try { ditado.stop() } catch { /* o ditado pode já ter parado */ }
    }
    const gravador = gravadorRef.current
    gravadorRef.current = null
    if (gravador) {
      gravador.onstop = null; gravador.ondataavailable = null
      try { if (gravador.state !== 'inactive') gravador.stop() } catch { /* soltar o stream abaixo continua necessário */ }
    }
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }, [])
  useEffect(() => () => cancelarVoz(), [sessao?.slug, cancelarVoz])

  useEffect(() => {
    const semMovimento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    fimRef.current?.scrollIntoView({ behavior: semMovimento ? 'auto' : 'smooth', block: 'end' })
  }, [mensagens, ocupado])

  const tratarEvento = useCallback((ev: EventoCriador) => {
    if (!telaAtual()) return
    if (ev.tipo === 'agent_text') {
      setMensagens((prev) => {
        const ult = prev[prev.length - 1]
        if (ult && ult.papel === 'criador') {
          return [...prev.slice(0, -1), { ...ult, texto: ult.texto + ev.payload.texto }]
        }
        return [...prev, { id: ++_idMsg, papel: 'criador', texto: ev.payload.texto, ferramentas: [] }]
      })
    } else if (ev.tipo === 'tool_use') {
      const chip = ev.payload.resumo
        ? `${ev.payload.ferramenta} · ${ev.payload.resumo}`
        : ev.payload.ferramenta
      setMensagens((prev) => {
        const ult = prev[prev.length - 1]
        if (ult && ult.papel === 'criador') {
          return [...prev.slice(0, -1), { ...ult, ferramentas: [...ult.ferramentas, chip] }]
        }
        return [...prev, { id: ++_idMsg, papel: 'criador', texto: '', ferramentas: [chip] }]
      })
    } else if (ev.tipo === 'subagente') {
      if (ev.payload.acao === 'start') {
        setMensagens((prev) => {
          const ult = prev[prev.length - 1]
          const chip = traduzir(`subagente · ${ev.payload.nome}`, `subagent · ${ev.payload.nome}`)
          if (ult && ult.papel === 'criador') {
            return [...prev.slice(0, -1), { ...ult, ferramentas: [...ult.ferramentas, chip] }]
          }
          return [...prev, { id: ++_idMsg, papel: 'criador', texto: '', ferramentas: [chip] }]
        })
      }
    } else if (ev.tipo === 'erro') {
      setMensagens((prev) => [...prev, { id: ++_idMsg, papel: 'erro', texto: ev.payload.mensagem, ferramentas: [] }])
    } else if (ev.tipo === 'status') {
      setOcupado(ev.payload.ocupado)
    } else if (ev.tipo === 'manifesto') {
      setManifesto(ev.payload.manifesto)
      setAlterados(ev.payload.alterados)
    }
  }, [traduzir, telaAtual])

  useEffect(() => transporte.onEvento(tratarEvento), [transporte, tratarEvento])

  async function abrir(slug: string) {
    if (!telaAtual() || operacaoRef.current) return
    const bancada = ++bancadaRef.current
    cancelarVoz(); setVozLocal('parado'); setVoz(null)
    setAbrindo(true)
    setDemoLink('')
    try {
      const estado = await transporte.abrir(slug)
      if (!telaAtual(bancada)) return
      setSessao(estado)
      setManifesto(estado.manifesto)
      setAlterados(estado.alterados)
      setOcupado(estado.ocupado)
      setTexto('')
      setAnexos([])
      setLado('produto')
      setMensagens([{
        id: ++_idMsg,
        papel: 'criador',
        texto: transporte.tipo === 'desktop'
          ? traduzir(`“${estado.manifesto?.nome ?? slug}” está na bancada. Pode pedir — mudar tarefas, abas, textos, colher uma skill de um link do GitHub. Nada vai ao catálogo sem você publicar.`, `“${estado.manifesto?.nome ?? slug}” is open in the workspace. Ask to change tasks, tabs or text, or add a skill from a GitHub link. Nothing reaches the catalog until you publish.`)
          : traduzir(`“${estado.manifesto?.nome ?? slug}” está na bancada, em SIMULAÇÃO (sem IA). Digite “ajuda” para os comandos; no app Offiz Desktop esta tela conversa com o Claude de verdade.`, `“${estado.manifesto?.nome ?? slug}” is open in SIMULATION mode (no AI). Type “ajuda” for commands. In Offiz Desktop, this screen connects to the real Claude.`),
        ferramentas: [],
      }])
    } catch (e) {
      if (telaAtual(bancada)) falha(e instanceof ApiError ? e.detail : e instanceof Error ? e.message : traduzir("Não foi possível abrir.", "Could not open the workspace."))
    } finally {
      if (telaAtual(bancada)) setAbrindo(false)
    }
  }

  async function enviar() {
    const t = texto.trim()
    if (!t || ocupado || !telaAtual() || operacaoRef.current) return
    const bancada = bancadaRef.current
    setTexto('')
    // Anexos pendentes viajam CITADOS na mensagem — a sessão sabe onde estão
    // (anexos/), mas dizer os nomes evita o Claude ter que listar a pasta.
    const comAnexos =
      anexos.length > 0 ? `${t}\n\n[Anexos em anexos/: ${anexos.join(', ')}]` : t
    setMensagens((prev) => [...prev, {
      id: ++_idMsg,
      papel: 'consultor',
      texto: anexos.length > 0 ? `${t}\n📎 ${anexos.join(' · ')}` : t,
      ferramentas: [],
    }])
    setAnexos([])
    try {
      await transporte.enviar(comAnexos)
    } catch (e) {
      if (!telaAtual(bancada)) return
      setMensagens((prev) => [...prev, {
        id: ++_idMsg, papel: 'erro',
        texto: e instanceof Error ? e.message : traduzir("A mensagem não saiu.", "The message was not sent."),
        ferramentas: [],
      }])
    }
  }

  /** Grava arquivos escolhidos (ou uma gravação de voz) na bancada. */
  async function anexarArquivos(arquivos: File[] | AnexoEnvio[]) {
    if (arquivos.length === 0 || !telaAtual() || operacaoRef.current) return
    const bancada = bancadaRef.current
    setAnexando(true)
    try {
      const prontos: AnexoEnvio[] = []
      for (const a of arquivos) {
        if (!telaAtual(bancada)) return
        if (a instanceof File) {
          if (a.size > 25 * 1024 * 1024) {
            falha(traduzir(`“${a.name}” passa de 25 MB — mande um recorte.`, `“${a.name}” exceeds 25 MB. Upload a smaller excerpt.`))
            continue
          }
          prontos.push({ nome: nomeSeguro(a.name), base64: await blobParaBase64(a, traduzir) })
        } else {
          prontos.push(a)
        }
      }
      if (prontos.length === 0 || !telaAtual(bancada)) return
      const r = await transporte.anexar(prontos)
      if (!telaAtual(bancada)) return
      if (!r.ok) {
        falha(r.error || traduzir("Não foi possível anexar.", "Could not attach the files."))
        return
      }
      setAnexos((prev) => [...prev, ...(r.salvos ?? prontos.map((p) => p.nome))])
      if (transporte.tipo === 'simulacao') {
        setMensagens((prev) => [...prev, {
          id: ++_idMsg, papel: 'criador',
          texto: traduzir("Anexo registrado. Na simulação eu não leio arquivos — no app Offiz Desktop o Claude lê os anexos (áudio incluso, quando a máquina tem como transcrever).", "Attachment recorded. Simulation does not read files. In Offiz Desktop, Claude reads attachments, including audio when transcription is available on the machine."),
          ferramentas: [],
        }])
      }
    } catch (e) {
      if (telaAtual(bancada)) falha(e instanceof Error ? e.message : traduzir("Não foi possível anexar.", "Could not attach the files."))
    } finally {
      if (telaAtual(bancada)) setAnexando(false)
    }
  }

  /** 🎤 — ditado onde o navegador sabe transcrever; senão grava e anexa. */
  async function alternarVoz() {
    if (!telaAtual() || operacaoRef.current) return
    if (pedindoMicrofoneRef.current) { cancelarVoz(); setVoz(null); return }
    const bancada = bancadaRef.current
    if (window.offizMotor) {
      if (ditadoLocalRef.current) { ditadoLocalRef.current.parar(); return }
      ditadoLocalRef.current = iniciarDitadoLocal({
        estado: estado => { if (!telaAtual(bancada)) return; setVozLocal(estado); if (estado === 'parado') ditadoLocalRef.current = null },
        texto: falado => { if (telaAtual(bancada)) setTexto(prev => prev ? `${prev} ${falado}` : falado) },
        erro: error => { if (telaAtual(bancada)) falha(error instanceof Error ? error.message : traduzir('Não foi possível transcrever. Confira a permissão do microfone e tente novamente.', 'Could not transcribe. Check microphone permission and try again.')) },
      })
      return
    }
    if (voz === 'ditando') {
      ditadoRef.current?.stop()
      return
    }
    if (voz === 'gravando') {
      gravadorRef.current?.stop()
      return
    }
    const SR = apiDeDitado()
    if (SR) {
      try {
        const rec = new SR()
        rec.lang = idioma
        rec.continuous = true
        rec.interimResults = false
        rec.onresult = (ev) => {
          if (!telaAtual(bancada) || ditadoRef.current !== rec) return
          let falado = ''
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i]
            if (r.isFinal) falado += r[0].transcript
          }
          if (falado) setTexto((prev) => (prev ? `${prev} ${falado.trim()}` : falado.trim()))
        }
        // O Electron TEM a classe mas o serviço falha em runtime — o erro cai
        // aqui e a fala vira gravação anexada, sem o botão morrer calado.
        rec.onerror = () => {
          if (!telaAtual(bancada) || ditadoRef.current !== rec) return
          rec.onresult = null; rec.onerror = null; rec.onend = null; ditadoRef.current = null
          try { rec.stop() } catch { /* serviço de ditado indisponível */ }
          setVoz(null); void gravarAudio()
        }
        rec.onend = () => { if (telaAtual(bancada) && ditadoRef.current === rec) { ditadoRef.current = null; setVoz(null) } }
        ditadoRef.current = rec
        rec.start()
        setVoz('ditando')
        return
      } catch {
        /* cai na gravação */
      }
    }
    gravarAudio()
  }

  async function gravarAudio() {
    if (!telaAtual() || pedindoMicrofoneRef.current || gravadorRef.current) return
    const bancada = bancadaRef.current
    const permissao = ++permissaoRef.current
    const atual = () => telaAtual(bancada) && permissaoRef.current === permissao
    pedindoMicrofoneRef.current = true
    setVoz('preparando')
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!atual()) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      const gravador = new MediaRecorder(stream)
      const pedacos: Blob[] = []
      gravador.ondataavailable = (e) => { if (atual() && e.data.size > 0) pedacos.push(e.data) }
      gravador.onstop = async () => {
        stream?.getTracks().forEach((t) => t.stop())
        if (!atual() || gravadorRef.current !== gravador) return
        streamRef.current = null
        gravadorRef.current = null
        setVoz(null)
        const blob = new Blob(pedacos, { type: gravador.mimeType || 'audio/webm' })
        if (blob.size < 1000) return // clique acidental — nada gravado
        const ext = (gravador.mimeType || 'audio/webm').includes('ogg') ? 'ogg' : 'webm'
        try {
          const base64 = await blobParaBase64(blob, traduzir)
          if (atual()) await anexarArquivos([{ nome: `fala-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`, base64 }])
        } catch (e) { if (atual()) falha(e instanceof Error ? e.message : traduzir('Não foi possível anexar o áudio.', 'Could not attach audio.')) }
      }
      gravadorRef.current = gravador
      gravador.start()
      setVoz('gravando')
    } catch {
      stream?.getTracks().forEach(track => track.stop())
      if (atual()) {
        streamRef.current = null; gravadorRef.current = null
        falha(traduzir("Sem acesso ao microfone — libere a permissão ou anexe um áudio (.ogg/.mp3).", "No microphone access. Allow access or attach an audio file (.ogg/.mp3)."))
        setVoz(null)
      }
    } finally { if (atual()) pedindoMicrofoneRef.current = false }
  }

  async function publicar() {
    if (!sessao || alterados.length === 0 || !telaAtual() || operacaoRef.current || ocupado) return
    const bancada = bancadaRef.current
    const lista = alterados.map((a) => `• ${a.caminho} (${rotulosAlteracao[a.acao]})`).join('\n')
    if (!await confirmar({ titulo: traduzir('Publicar escritório', 'Publish office'),
      mensagem: traduzir(`Publicar “${manifesto?.nome ?? sessao.slug}” no catálogo?\n\nVale NA HORA para todos os clientes com este escritório.\n\nO que mudou:\n${lista}`, `Publish “${manifesto?.nome ?? sessao.slug}” to the catalog?\n\nThis takes effect immediately for every client using this office.\n\nChanges:\n${lista}`),
      acao: traduzir('Publicar escritório', 'Publish office'),
    }) || !telaAtual(bancada) || operacaoRef.current) return
    operacaoRef.current = true
    setPublicando(true)
    try {
      const r = await transporte.publicar()
      if (!telaAtual(bancada)) return
      if (r.ok) sucesso(traduzir("Publicado — já vale para os clientes deste escritório.", "Published — now active for this office’s clients."))
      else falha(r.error || traduzir("A publicação falhou.", "Publication failed."))
    } catch (e) {
      if (telaAtual(bancada)) falha(e instanceof ApiError ? e.detail : e instanceof Error ? e.message : traduzir('A publicação falhou.', 'Publication failed.'))
    } finally {
      operacaoRef.current = false
      if (telaAtual(bancada)) setPublicando(false)
    }
  }

  /** A DEMO REAL: garante um prédio de demonstração com este andar e abre a
   *  shell verdadeira nele (painéis, guia e conhecimento de verdade — o que o
   *  preview não alcança). A demo mostra a versão PUBLICADA do catálogo. */
  async function abrirDemo() {
    if (!sessao?.slug || preparandoDemo.current || !telaAtual() || operacaoRef.current) return
    const bancada = bancadaRef.current
    if (alterados.length > 0 && !await confirmar({ titulo: traduzir('Abrir demo publicada', 'Open published demo'),
      mensagem: traduzir('A demo abre a versão PUBLICADA do catálogo — as edições da bancada ainda não publicadas não aparecem lá.\n\nAbrir mesmo assim?', 'The demo opens the PUBLISHED catalog version. Unpublished workspace changes will not appear.\n\nOpen anyway?'),
      acao: traduzir('Abrir versão publicada', 'Open published version'), perigoso: false,
    })) return
    if (!telaAtual(bancada) || preparandoDemo.current || operacaoRef.current) return
    try {
      preparandoDemo.current = true
      setDemoLink('')
      const link = await prepararDemoCriador(sessao.slug)
      if (!telaAtual(bancada)) return
      setDemoLink(link)
      window.open(link, '_blank', 'noopener')
    } catch (e) {
      if (telaAtual(bancada)) falha(e instanceof ApiError ? e.detail : traduzir("Não foi possível abrir a demo.", "Could not open the demo."))
    } finally { preparandoDemo.current = false }
  }

  async function descartar() {
    if (!sessao || !telaAtual() || operacaoRef.current) return
    const bancada = bancadaRef.current
    if (alterados.length > 0 && !await confirmar({ titulo: traduzir('Descartar bancada', 'Discard workspace'),
      mensagem: traduzir(`Descartar a bancada de “${manifesto?.nome ?? sessao.slug}”?\n\n${alterados.length} arquivo(s) editados serão perdidos — nada foi publicado.`, `Discard the workspace for “${manifesto?.nome ?? sessao.slug}”?\n\n${alterados.length} edited file(s) will be lost. Nothing has been published.`),
      acao: traduzir('Descartar alterações', 'Discard changes'),
    })) return
    if (!telaAtual(bancada) || operacaoRef.current) return
    operacaoRef.current = true
    setFechando(true)
    cancelarVoz(); setVozLocal('parado'); setVoz(null)
    try {
      await transporte.fechar()
      if (!telaAtual(bancada)) return
      bancadaRef.current++
      setDemoLink('')
      setSessao(null)
      setManifesto(null)
      setAlterados([])
      setMensagens([])
      setTexto('')
      setAnexos([])
      setAnexando(false)
      setOcupado(false)
    } catch (e) {
      if (telaAtual(bancada)) falha(e instanceof ApiError ? e.detail : e instanceof Error ? e.message : traduzir('Não foi possível fechar a bancada. Tente novamente.', 'Could not close the workspace. Try again.'))
    } finally {
      operacaoRef.current = false
      if (telaAtual()) setFechando(false)
    }
  }

  /* ─── render ─── */

  if (!sessao) {
    return (
      <div className="pagina">
        {dialogo}
        <div className="pagina-cabecalho">
          <div>
            <h1>{traduzir("Criador de escritórios", "Office builder")}</h1>
            <p className="pagina-sub">
              {traduzir("Conversa de um lado, o escritório do outro.", "Conversation on one side, the office on the other.")}{' '}
              {transporte.tipo === 'desktop'
                ? traduzir("Rodando com o Claude Code CLI desta máquina.", "Running with this machine’s Claude Code CLI.")
                : traduzir("Na web, em simulação — o Claude de verdade roda no app Offiz Desktop.", "Web simulation — the real Claude runs in Offiz Desktop.")}
            </p>
          </div>
        </div>
        <p><Link to="/admin">{traduzir('Gerenciar clientes e criar contas de teste', 'Manage clients and create test accounts')}</Link></p>
        {transporte.tipo === 'simulacao' && <CartaoDownloadApp />}
        {abrindo
          ? <p className="texto-suave">{traduzir("Baixando o escritório para a bancada…", "Downloading the office to the workspace…")}</p>
          : <EscolhaAlvo aoAbrir={abrir} />}
      </div>
    )
  }

  return (
    <div className="pagina criador-pagina">
      {dialogo}
      <p><Link to="/admin">{traduzir('Clientes e demos', 'Clients and demos')}</Link></p>
      {demoLink && <p role="status">{traduzir('Sua demo está pronta. ', 'Your demo is ready. ')}<a href={demoLink} target="_blank" rel="noopener noreferrer">{traduzir('Abrir demonstração', 'Open demo')}</a></p>}
      <div className="criador-grid">
        <section className="criador-conversa cartao" aria-label={traduzir("Conversa com o criador", "Conversation with the builder")}>
          <header className="criador-conversa-topo">
            <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Icone nome="conversa" tamanho={15} /> {traduzir("Conversa", "Conversation")}
            </strong>
            <span className={`status-pill ${transporte.tipo === 'desktop' ? 'status-done' : 'status-run'}`}>
              {transporte.tipo === 'desktop' ? traduzir("CLI local", "local CLI") : traduzir("simulação — sem IA", "simulation — no AI")}
            </span>
            <button type="button" className="botao-texto" onClick={descartar} disabled={publicando || fechando}>{traduzir("← trocar de escritório", "← switch office")}</button>
          </header>

          <div className="criador-mensagens">
            {mensagens.map((m) => (
              <div key={m.id} className={`criador-msg criador-msg-${m.papel}`}>
                {m.ferramentas.length > 0 && (
                  <span className="criador-chips">
                    {m.ferramentas.map((f, i) => <code key={i}>{f}</code>)}
                  </span>
                )}
                {m.texto && <p>{m.texto}</p>}
              </div>
            ))}
            {ocupado && <p className="texto-suave criador-digitando">{traduzir("o criador está trabalhando…", "the builder is working…")}</p>}
            <div ref={fimRef} />
          </div>

          {anexos.length > 0 && (
            <div className="criador-anexos" aria-label={traduzir("Anexos prontos para a próxima mensagem", "Attachments ready for the next message")}>
              {anexos.map((a) => (
                <code key={a} className="criador-anexo">
                  <Icone nome="anexo" tamanho={14} /> {a}
                  <button
                    type="button"
                    aria-label={traduzir(`Remover ${a} da mensagem`, `Remove ${a} from the message`)}
                    title={traduzir("Tira da mensagem (o arquivo continua em anexos/ na bancada)", "Remove from the message (the file stays in anexos/ in the workspace)")}
                    onClick={() => setAnexos((prev) => prev.filter((x) => x !== a))}
                  >
                    <Icone nome="fechar" tamanho={14} />
                  </button>
                </code>
              ))}
            </div>
          )}

          <div className="criador-entrada">
            <input
              ref={arquivoRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                anexarArquivos(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
            <span className="criador-entrada-acoes">
              <button
                type="button"
                className="botao botao-fantasma botao-pequeno"
                onClick={() => arquivoRef.current?.click()}
                disabled={anexando}
                title={traduzir("Anexar arquivos — briefing, planilha, áudio (.ogg/.mp3)… o material que explica o escritório", "Attach files — brief, spreadsheet, audio (.ogg/.mp3) or other material describing the office")}
                aria-label={traduzir("Anexar arquivos", "Attach files")}
              >
                {anexando ? '…' : <Icone nome="anexo" />}
              </button>
              <button
                type="button"
                className={`botao botao-pequeno ${voz || vozLocal !== 'parado' ? 'botao-primario criador-voz-ativa' : 'botao-fantasma'}`}
                onClick={alternarVoz}
                disabled={vozLocal === 'preparando' || vozLocal === 'transcrevendo'}
                title={
                  vozLocal === 'gravando' ? traduzir('Gravando — clique para transcrever no computador', 'Recording — click to transcribe on this computer')
                    : vozLocal === 'transcrevendo' ? traduzir('Transcrevendo no computador…', 'Transcribing on this computer…')
                    : voz === 'preparando' ? traduzir('Abrindo microfone — clique para cancelar', 'Opening microphone — click to cancel')
                    : voz === 'ditando' ? traduzir("Ditando — clique para parar", "Dictating — click to stop")
                    : voz === 'gravando' ? traduzir("Gravando — clique para parar e anexar o áudio", "Recording — click to stop and attach audio")
                    : traduzir("Falar em vez de digitar", "Speak instead of typing")
                }
                aria-label={traduzir("Falar", "Speak")}
              >
                {voz === 'gravando' || vozLocal === 'gravando' ? <Icone nome="parar" /> : <Icone nome="microfone" />}
              </button>
              {vozLocal !== 'parado' && <span role="status" className="texto-suave">{vozLocal === 'preparando' ? traduzir('Abrindo microfone…', 'Opening microphone…') : vozLocal === 'gravando' ? traduzir('Ouvindo · até 2 min', 'Listening · up to 2 min') : traduzir('Transcrevendo no computador…', 'Transcribing on this computer…')}</span>}
            </span>
            <textarea
              rows={3}
              value={texto}
              placeholder={traduzir('Peça a mudança, cole um link do GitHub, anexe arquivos ou fale (🎤).\nEnter envia · Shift+Enter quebra linha', 'Request a change, paste a GitHub link, attach files or speak (🎤).\nEnter sends · Shift+Enter adds a line')}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() }
              }}
            />
            {ocupado ? (
              <button type="button" className="botao botao-fantasma" onClick={() => transporte.cancelar()}>
                <Icone nome="parar" tamanho={15} /> {traduzir("Parar", "Stop")}
              </button>
            ) : (
              <button type="button" className="botao botao-primario" onClick={enviar} disabled={!texto.trim()}>
                {traduzir("Enviar", "Send")}
              </button>
            )}
          </div>
        </section>

        <section className="criador-lado-direito" aria-label={traduzir("Preview do escritório", "Office preview")}>
          <div className="criador-lado-toggle" role="tablist" aria-label={traduzir("O que mostrar à direita", "What to show on the right")}>
            <button
              type="button"
              role="tab"
              aria-selected={lado === 'produto'}
              className={`botao botao-pequeno ${lado === 'produto' ? 'botao-primario' : 'botao-fantasma'}`}
              onClick={() => setLado('produto')}
            >
              <Icone nome="computador" tamanho={15} /> {traduzir("Produto", "Product")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={lado === 'arquivos'}
              className={`botao botao-pequeno ${lado === 'arquivos' ? 'botao-primario' : 'botao-fantasma'}`}
              onClick={() => setLado('arquivos')}
              title={traduzir("CLAUDE.md, skills e office.json da bancada — leitura", "Read the workspace’s CLAUDE.md, skills and office.json")}
            >
              <Icone nome="arq-pasta" tamanho={15} /> {traduzir("Arquivos", "Files")}
            </button>
          </div>

          {lado === 'produto'
            ? <PreviewEscritorio manifesto={manifesto} slug={sessao.slug ?? ''} aoAbrirDemo={abrirDemo} />
            : <PainelArquivos transporte={transporte} />}

          <footer className="criador-rodape cartao">
            <div className="criador-alterados">
              {alterados.length === 0
                ? <span className="texto-suave">{traduzir("Bancada igual ao catálogo — nada a publicar.", "The workspace matches the catalog. Nothing to publish.")}</span>
                : alterados.map((a) => (
                  <code key={a.caminho} className={`criador-alterado criador-alterado-${a.acao}`}
                    title={rotulosAlteracao[a.acao]}>
                    {a.acao === 'novo' ? '＋' : a.acao === 'removido' ? '−' : '±'} {a.caminho}
                  </code>
                ))}
            </div>
            <span className="linha-conceder">
              <button
                type="button"
                className="botao botao-primario"
                onClick={publicar}
                disabled={publicando || fechando || ocupado || alterados.length === 0}
              >
                {publicando ? traduzir("Publicando…", "Publishing…") : traduzir(`Publicar${alterados.length ? ` (${alterados.length})` : ''}`, `Publish${alterados.length ? ` (${alterados.length})` : ''}`)}
              </button>
              <button type="button" className="botao-texto perigo" onClick={descartar} disabled={publicando || fechando}>
                {fechando ? traduzir('Fechando…', 'Closing…') : traduzir("Descartar bancada", "Discard workspace")}
              </button>
            </span>
          </footer>
        </section>
      </div>
    </div>
  )
}
