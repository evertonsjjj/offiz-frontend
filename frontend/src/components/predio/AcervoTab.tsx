/* ------------------------------------------------------------------ */
/* ACERVO — "o que você me deu", em abas (16/08/2026).                  */
/*                                                                     */
/* Tudo o que o escritório usa para trabalhar, num lugar só e com nome  */
/* de dono: Chegou agora (a triagem de entrada/), A marca, O produto,   */
/* Referências (com o teto de atenção), Aprovados e Pessoas. As abas    */
/* são nomes para pastas que JÁ existem no workspace — a mesma pasta    */
/* era "produto" na API, "Fotos do produto" na tela e "acervo" na boca  */
/* do agente; aqui o nome de dono é o único visível e a identidade real */
/* do arquivo continua no tooltip e nas ações.                         */
/*                                                                     */
/* A busca atravessa as abas e procura no que a IA escreveu (legenda e  */
/* tags), não só no nome do arquivo. A triagem completa a promessa da   */
/* ingestão mecânica: o destino_sugerido vira um "guardar em…" de um    */
/* clique. E referência se ARQUIVA em vez de apagar — o acervo guarda   */
/* tudo, o prompt lê só as em uso (teto de 5 por assunto: atenção, não  */
/* armazenamento).                                                      */
/* ------------------------------------------------------------------ */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, api, baixarArquivo, carregarArquivo, getSessionIdentity } from '../../lib/api'
import { Icone, type NomeIcone } from '../Icone'
import { useToasts } from '../Toasts'
import { formatBytes, tempoRelativo } from '../../lib/format'
import PortaVozes from './PortaVozes'
import DialogoArquivo from './DialogoArquivo'
import ImportarLink from './ImportarLink'
import { useConfirmacao } from '../useConfirmacao'
import { useIdioma, type Traduzir } from '../../lib/i18n'
import { correspondeBusca } from '../../lib/busca'
import MiniaturaArquivo from '../MiniaturaArquivo'
import './AcervoTab.css'

type Material = {
  nome: string
  /** Caminho relativo dentro da pasta: nomes iguais não são o mesmo arquivo. */
  sub?: string
  tamanho_bytes: number
  modificado_em?: string
  legenda?: string | null
  tags?: string[]
  origem_legenda?: string | null
  destino_sugerido?: string | null
  em_uso?: boolean
}

type ChavePasta = 'entrada' | 'marca' | 'produto' | 'exemplos' | 'aprovados'

type AbaAcervo = {
  id: string
  chave: ChavePasta | null
  rotulo: string
  icone: NomeIcone
  descricao: string
  vazio: string
  caminho: string
}

const abasAcervo = (t: Traduzir): AbaAcervo[] => [
  {
    id: 'chegou',
    chave: 'entrada',
    rotulo: t("Chegou agora", "New arrivals"),
    icone: 'subir',
    descricao:
      t("O que você mandou — por aqui, na sabatina ou anexado na conversa. Eu leio, descrevo e sugiro onde guardar; você confirma.", "Files you sent here, during onboarding or in the conversation. I read them, describe them and suggest where to store them; you confirm."),
    vazio:
      t("Nada pendente. Quando você mandar um arquivo novo, ele aparece aqui para você confirmar o destino.", "Nothing pending. New files appear here so you can confirm where to store them."),
    caminho: 'entrada/',
  },
  {
    id: 'marca',
    chave: 'marca',
    rotulo: t("A marca", "Brand"),
    icone: 'paleta',
    descricao:
      t("Brandbook, logo, paleta e as regras da identidade — o primeiro material que eu leio antes de escrever qualquer linha.", "Your brand book, logo, colors and identity guidelines — the first material I read before writing."),
    vazio: t("Nada aqui ainda. O brandbook é o arquivo que mais melhora o meu trabalho.", "Nothing here yet. Your brand book is one of the most useful files for improving my work."),
    caminho: 'memoria/brand/assets/marca/',
  },
  {
    id: 'produto',
    chave: 'produto',
    rotulo: t("O produto", "Product"),
    icone: 'arq-imagem',
    descricao:
      t("Fotos, vídeos e documentos do seu produto, serviço ou atividade — materiais reais para usar nos posts, carrosséis e vídeos.", "Photos, videos and documents of your product, service or activity — real material to use in posts, carousels and videos."),
    vazio:
      t("Nenhum material aqui ainda. Envie fotos, vídeos ou documentos do que você oferece ou faz para usar na criação de conteúdo.", "No material here yet. Upload photos, videos or documents of what you offer or do to use in content creation."),
    caminho: 'memoria/brand/acervo/',
  },
  {
    id: 'referencias',
    chave: 'exemplos',
    rotulo: t("Referências", "References"),
    icone: 'ideia',
    descricao:
      t("Posts que você gosta — eu aprendo o jeito deles, nunca copio o conteúdo. Só as EM USO entram no trabalho.", "Posts you like — I learn their style without copying the content. Only references IN USE guide the work."),
    vazio: t("Nenhuma referência ainda. Com duas ou três, eu já pego o estilo que você quer.", "No references yet. Two or three help me understand the style you want."),
    caminho: 'memoria/brand/acervo/exemplos/',
  },
  {
    id: 'aprovados',
    chave: 'aprovados',
    rotulo: t("Aprovados", "Approved"),
    icone: 'visto',
    descricao:
      t("Peças que passaram pelo seu OK viram referência para as próximas — você já disse que estava bom.", "Deliverables you approved become references for future work."),
    vazio:
      t("Nada aqui ainda. Peça na conversa para eu guardar uma peça aprovada como referência, e ela vem para cá.", "Nothing here yet. Ask in the conversation to save an approved deliverable as a reference."),
    caminho: 'memoria/brand/acervo/aprovados/',
  },
  {
    id: 'pessoas',
    chave: null,
    rotulo: t("Pessoas", "People"),
    icone: 'pessoa',
    descricao: '',
    vazio: '',
    caminho: 'memoria/brand/acervo/porta-vozes/',
  },
]

/** Rótulo de dono por chave — para o "guardar em…" e a busca falarem a mesma
 *  língua das abas. */
const rotulosPorChave = (t: Traduzir): Record<ChavePasta, string> => ({
  entrada: t("Chegou agora", "New arrivals"),
  marca: t("A marca", "Brand"),
  produto: t("O produto", "Product"),
  exemplos: t("Referências", "References"),
  aprovados: t("Aprovados", "Approved"),
})

/** Para onde a triagem deixa mover. `entrada` fica de fora como destino — a
 *  triagem existe para ESVAZIAR a entrada, não para devolver arquivo a ela. */
const DESTINOS: ChavePasta[] = ['marca', 'produto', 'exemplos', 'aprovados']

/** O destino_sugerido da ingestão fala 'acervo'/'brandbook' (vocabulário do
 *  prompt); a whitelist fala 'produto'/'marca'. A tradução mora aqui. */
const SUGESTAO_PARA_CHAVE: Record<string, ChavePasta> = {
  entrada: 'entrada',
  exemplos: 'exemplos',
  acervo: 'produto',
  produto: 'produto',
  brandbook: 'marca',
  marca: 'marca',
  aprovados: 'aprovados',
}

/** O teto de ATENÇÃO por assunto (primeira tag): o CLAUDE.md do andar manda
 *  abrir 3–5 exemplos — guardar trinta não atrapalha, mandar trinta dilui. */
const TETO_REFERENCIAS = 5

const EH_IMAGEM = /\.(png|jpe?g|webp|gif|avif)$/i
const EH_VIDEO = /\.(mp4|webm|mov|m4v)$/i

type ErroPrevia = 'leitura' | 'decodificacao' | 'conexao' | 'acesso' | 'indisponivel' | 'servidor'

function classificarFalhaLeitura(erro: unknown): ErroPrevia {
  if (!(erro instanceof ApiError)) return 'leitura'
  if (erro.status === 0) return 'conexao'
  if (erro.status === 401 || erro.status === 403) return 'acesso'
  if (erro.status === 404) return 'indisponivel'
  if (Number.isInteger(erro.status) && erro.status >= 500 && erro.status < 600) return 'servidor'
  return 'leitura'
}

/** Somente categorias fixas: mensagens HTTP podem conter caminhos e segredos. */
function mensagemFalhaPrevia(erro: ErroPrevia, t: Traduzir): string {
  if (erro === 'conexao') return t('Não consegui conectar ao servidor para abrir a prévia. Verifique sua conexão e tente novamente.', 'Could not connect to the server to open the preview. Check your connection and try again.')
  if (erro === 'acesso') return t('Não consegui confirmar seu acesso a este arquivo. Confira sua conta ou peça ao responsável para verificar o acesso.', 'Could not confirm your access to this file. Check your account or ask the administrator to verify access.')
  if (erro === 'indisponivel') return t('Este arquivo não está disponível para esta consulta. Confira o arquivo no acervo ou peça ajuda ao responsável.', 'This file is not available for this request. Check the file in the library or ask the administrator for help.')
  if (erro === 'servidor') return t('O servidor não conseguiu abrir este arquivo agora. Tente novamente em instantes.', 'The server could not open this file right now. Try again shortly.')
  return erro === 'decodificacao'
    ? t('Não consegui mostrar a prévia deste arquivo. Tente novamente ou baixe o original.', 'Could not display this file preview. Try again or download the original.')
    : t('Não consegui abrir a prévia agora. Tente novamente ou baixe o original.', 'Could not open the preview right now. Try again or download the original.')
}

function nomeMaterial(item: Pick<Material, 'nome' | 'sub'>): string {
  return item.sub ? `${item.sub}/${item.nome}` : item.nome
}

function chaveMaterial(pasta: ChavePasta, item: Pick<Material, 'nome' | 'sub'>): string {
  return `${pasta}/${nomeMaterial(item)}`
}

function urlMaterial(orgId: number, slug: string, pasta: ChavePasta, item: Pick<Material, 'nome' | 'sub'>, acao = ''): string {
  const sub = item.sub ? `?sub=${encodeURIComponent(item.sub)}` : ''
  return `/predios/${orgId}/${slug}/arquivos/${pasta}/${encodeURIComponent(item.nome)}${acao}${sub}`
}

function nomeCurto(item: Material, t: Traduzir): string {
  let base = item.nome.replace(/\.[^.]{1,12}$/, '')
  // IDs não viram títulos inventados; a descrição continua logo abaixo.
  if (/^(?:[a-f\d]{20,}|\d{12,}|S[a-f\d]{24,})$/i.test(base)) {
    return EH_IMAGEM.test(item.nome) ? t('Imagem', 'Image') : EH_VIDEO.test(item.nome) ? t('Vídeo', 'Video') : t('Arquivo', 'File')
  }
  if (EH_VIDEO.test(item.nome)) base = base.replace(/-(?=[A-Za-z\d_-]{11}$)(?=[A-Za-z\d_-]*[A-Z])[A-Za-z\d_-]{11}$/, '')
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || item.nome
}

function colecaoMaterial(item: Material, t: Traduzir): string | null {
  const partes = item.sub?.split('/').filter(Boolean) ?? []
  const significativa = [...partes].reverse().find(parte => !/^(?:[a-f\d]{16,}|conversa-\d+|lote-[a-f\d]{8,})$/i.test(parte))
  if (significativa) return significativa.replace(/[_-]+/g, ' ')
  const conversa = partes.find(parte => /^conversa-\d+$/.test(parte))?.replace('conversa-', '')
  return conversa ? t(`Conversa ${conversa}`, `Conversation ${conversa}`) : null
}

function RenomearMaterial({ orgId, slug, pasta, item, aoFechar, aoSalvar }: {
  orgId: number; slug: string; pasta: ChavePasta; item: Material
  aoFechar: () => void; aoSalvar: () => void
}) {
  const { t } = useIdioma()
  const [nome, setNome] = useState(item.nome)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const ativa = useRef(true)
  const campo = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ativa.current = true
    campo.current?.focus()
    campo.current?.select()
    return () => { ativa.current = false }
  }, [])
  return <form className="acv-renomear" aria-label={t(`Renomear ${nomeMaterial(item)}`, `Rename ${nomeMaterial(item)}`)}
    onKeyDown={e => { if (e.key === 'Escape' && !salvando) { e.preventDefault(); aoFechar() } }}
    onSubmit={async e => {
      e.preventDefault()
      if (salvando || !nome.trim() || nome.trim() === item.nome) return
      setSalvando(true); setErro('')
      try {
        await api.patch(urlMaterial(orgId, slug, pasta, item), { novo_nome: nome.trim() })
        if (ativa.current) aoSalvar()
      } catch (e) {
        if (ativa.current) setErro(e instanceof ApiError ? e.detail : t('Não consegui renomear agora. Confira o nome e tente novamente.', 'Could not rename the file. Check the name and try again.'))
      } finally { if (ativa.current) setSalvando(false) }
    }}>
    <strong>{t('Renomear arquivo', 'Rename file')}</strong>
    <p>{nomeMaterial(item)}</p>
    <label>{t('Novo nome do arquivo', 'New file name')}<input ref={campo} required maxLength={255} value={nome} disabled={salvando} onChange={e => setNome(e.target.value)} /></label>
    {erro && <p className="alerta alerta-erro" role="alert">{erro}</p>}
    <div className="acv-renomear-acoes"><button className="botao botao-primario" disabled={salvando || !nome.trim() || nome.trim() === item.nome}>{salvando ? t('Salvando…', 'Saving…') : t('Salvar nome', 'Save name')}</button><button type="button" className="botao botao-fantasma" disabled={salvando} onClick={aoFechar}>{t('Cancelar', 'Cancel')}</button></div>
  </form>
}

export function AcervoTab(props: { orgId: number; slug: string }) {
  return <AcervoConteudo key={`${getSessionIdentity()}:${props.orgId}:${props.slug}`} {...props} />
}

function AcervoConteudo({ orgId, slug }: { orgId: number; slug: string }) {
  const { t, idioma } = useIdioma()
  const { confirmar, dialogo } = useConfirmacao(`${getSessionIdentity()}:${orgId}:${slug}`)
  const ABAS_ACERVO = abasAcervo(t)
  const ROTULO_POR_CHAVE = rotulosPorChave(t)
  const [listas, setListas] = useState<Record<ChavePasta, Material[]> | null>(null)
  const [aba, setAba] = useState('chegou')
  const [termo, setTermo] = useState('')
  const [limite, setLimite] = useState(24)
  useEffect(() => { setLimite(24) }, [termo, aba])
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [renomeando, setRenomeando] = useState<{ orgId: number; slug: string; pasta: ChavePasta; item: Material } | null>(null)
  const origemRenomear = useRef<HTMLButtonElement | null>(null)
  const buscaRef = useRef<HTMLInputElement>(null)
  // O lightbox: abrir a imagem / tocar o vídeo sem sair da aba.
  const [luz, setLuz] = useState<{
    pasta: ChavePasta; item: Material; pedido: number; url: string | null;
    carregando: boolean; erro: ErroPrevia | null; baixando: boolean;
  } | null>(null)
  const pedidoLuzRef = useRef(0)
  const leituraLuzRef = useRef<AbortController | null>(null)
  const downloadLuzRef = useRef<number | null>(null)
  const fecharLuzBotaoRef = useRef<HTMLButtonElement | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const uploadAlternativoRef = useRef<HTMLInputElement | null>(null)
  const { sucesso, falha } = useToasts()
  const telaAtivaRef = useRef(true)
  const sessaoRef = useRef(getSessionIdentity())
  const leituraRef = useRef<AbortController | null>(null)
  const uploadEmCurso = useRef(false)
  const remocoes = useRef(new Set<string>())
  const telaAtual = useCallback(() => telaAtivaRef.current && getSessionIdentity() === sessaoRef.current, [])

  useEffect(() => {
    telaAtivaRef.current = true
    return () => {
      telaAtivaRef.current = false
      leituraRef.current?.abort()
      leituraLuzRef.current?.abort()
      pedidoLuzRef.current += 1
    }
  }, [])

  const carregar = useCallback(() => {
    if (!telaAtual()) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    api
      .get<Record<string, Material[] | undefined>>(`/predios/${orgId}/${slug}/arquivos`, controller.signal)
      .then((r) => {
        if (!telaAtual() || controller.signal.aborted || leituraRef.current !== controller) return
        setListas({
          entrada: r?.entrada ?? [],
          marca: r?.marca ?? [],
          produto: r?.produto ?? [],
          exemplos: r?.exemplos ?? [],
          aprovados: r?.aprovados ?? [],
        })
        // A MESMA régua do PortaVozes: sucesso limpa o erro. Sem isto, um
        // 502 de um segundo virava estado TERMINAL — a shell mantém o painel
        // montado (display:none), então nem trocar de aba recuperava.
        setErro(null)
      })
      .catch((e) => {
        if (telaAtual() && !controller.signal.aborted && leituraRef.current === controller)
          setErro(e instanceof ApiError ? e.detail : t("Não consegui abrir o acervo agora.", "Could not open the library. Please try again."))
      })
  }, [orgId, slug, t, telaAtual])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    const url = luz?.url
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [luz?.url])

  useEffect(() => () => { pedidoLuzRef.current += 1 }, [])

  async function mover(pasta: ChavePasta, item: Material, para: ChavePasta) {
    if (!telaAtual()) return
    setOcupado(chaveMaterial(pasta, item))
    try {
      await api.post(
        urlMaterial(orgId, slug, pasta, item, '/mover'),
        { para },
      )
      if (!telaAtual()) return
      sucesso(t(`Guardado em ${ROTULO_POR_CHAVE[para]}.`, `Saved in ${ROTULO_POR_CHAVE[para]}.`))
      carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : t("Não consegui mover agora.", "Could not move the file. Please try again."))
    } finally {
      if (telaAtual()) setOcupado(null)
    }
  }

  async function marcarUso(item: Material, emUso: boolean) {
    if (!telaAtual()) return
    // O teto vale ao LIGAR: conta as em uso do mesmo assunto (primeira tag).
    if (emUso && listas) {
      const assunto = item.tags?.[0] ?? ''
      const ativas = listas.exemplos.filter(
        (m) => (m.tags?.[0] ?? '') === assunto && m.em_uso !== false && nomeMaterial(m) !== nomeMaterial(item),
      ).length
      if (ativas >= TETO_REFERENCIAS) {
        falha(
          t(`Já são ${TETO_REFERENCIAS} referências em uso${assunto ? ` em “${assunto}”` : ''}. Arquive uma antes de ligar esta — o teto existe para eu aprender UM padrão.`, `There are already ${TETO_REFERENCIAS} references in use${assunto ? ` for “${assunto}”` : ''}. Archive one before enabling this one so I can focus on one consistent style.`),
        )
        return
      }
    }
    setOcupado(chaveMaterial('exemplos', item))
    try {
      await api.post(
        urlMaterial(orgId, slug, 'exemplos', item, '/uso'),
        { em_uso: emUso },
      )
      if (telaAtual()) carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : t("Não consegui mudar isso agora.", "Could not update the reference. Please try again."))
    } finally {
      if (telaAtual()) setOcupado(null)
    }
  }

  async function excluir(pasta: ChavePasta, item: Material) {
    const chave = chaveMaterial(pasta, item)
    if (!telaAtual() || remocoes.current.has(chave)) return
    remocoes.current.add(chave)
    try {
      if (!await confirmar({
        titulo: t('Remover arquivo do acervo', 'Remove file from library'),
        mensagem: t(`Tirar “${nomeMaterial(item)}” do escritório? Ele deixa de ser lido nas tarefas.`, `Remove “${nomeMaterial(item)}” from the workspace? It will no longer be used in tasks.`),
        acao: t('Remover arquivo', 'Remove file'),
      }) || !telaAtual()) return
      setOcupado(chave)
      await api.del(urlMaterial(orgId, slug, pasta, item))
      if (telaAtual()) carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : t("Não consegui excluir agora.", "Could not delete the file. Please try again."))
    } finally {
      remocoes.current.delete(chave)
      if (telaAtual()) setOcupado(null)
    }
  }

  async function enviar(lista: FileList | null, pasta: ChavePasta) {
    const arquivos = Array.from(lista ?? [])
    if (!arquivos.length || !telaAtual() || uploadEmCurso.current) return
    uploadEmCurso.current = true
    setEnviando(true)
    let enviados = 0
    for (const arquivo of arquivos) {
      if (!telaAtual()) break
      try {
        const fd = new FormData()
        fd.append('arquivo', arquivo)
        await api.postForm(`/predios/${orgId}/${slug}/arquivos?pasta=${pasta}`, fd)
        enviados += 1
      } catch (e) {
        if (!telaAtual()) break
        falha(e instanceof ApiError ? `${arquivo.name}: ${e.detail}` : t(`Não consegui receber “${arquivo.name}”.`, `Could not upload “${arquivo.name}”.`))
      }
    }
    uploadEmCurso.current = false
    if (!telaAtual()) return
    setEnviando(false)
    if (enviados) {
      sucesso(enviados === 1 ? t("Material guardado.", "File saved.") : t(`${enviados} materiais guardados.`, `${enviados} files saved.`))
      carregar()
    }
  }

  async function abrirLuz(pasta: ChavePasta, item: Material) {
    if (!telaAtual()) return
    leituraLuzRef.current?.abort()
    const pedido = ++pedidoLuzRef.current
    const temPrevia = EH_IMAGEM.test(item.nome) || EH_VIDEO.test(item.nome)
    setLuz({ pasta, item, pedido, url: null, carregando: temPrevia, erro: null, baixando: false })
    // Documentos sem player só precisam dos bytes quando a pessoa baixa.
    if (!temPrevia) return
    const controller = new AbortController()
    leituraLuzRef.current = controller
    try {
      const url = await carregarArquivo(urlMaterial(orgId, slug, pasta, item), controller.signal)
      if (!telaAtual() || pedidoLuzRef.current !== pedido || controller.signal.aborted) {
        URL.revokeObjectURL(url)
        return
      }
      setLuz((atual) =>
        atual?.pedido === pedido
          ? { ...atual, url, carregando: false }
          : (URL.revokeObjectURL(url), atual),
      )
    } catch (erro) {
      if (!telaAtual() || pedidoLuzRef.current !== pedido || controller.signal.aborted) return
      setLuz(atual => atual?.pedido === pedido ? { ...atual, carregando: false, erro: classificarFalhaLeitura(erro) } : atual)
    } finally {
      if (leituraLuzRef.current === controller) leituraLuzRef.current = null
    }
  }

  function falhaNaPrevia(pedido: number, url: string) {
    if (!telaAtual() || pedidoLuzRef.current !== pedido) return
    setLuz(atual => atual?.pedido === pedido && atual.url === url
      ? { ...atual, erro: 'decodificacao' } : atual)
  }

  async function baixarLuz() {
    if (!luz || !telaAtual() || downloadLuzRef.current === luz.pedido) return
    const { pasta, item, pedido } = luz
    downloadLuzRef.current = pedido
    setLuz(atual => atual?.pedido === pedido ? { ...atual, baixando: true } : atual)
    try {
      await baixarArquivo(urlMaterial(orgId, slug, pasta, item), item.nome)
    } catch {
      if (telaAtual() && pedidoLuzRef.current === pedido)
        falha(t('Não consegui baixar agora.', 'Could not download the file. Please try again.'))
    } finally {
      if (downloadLuzRef.current === pedido) downloadLuzRef.current = null
      if (telaAtual()) setLuz(atual => atual?.pedido === pedido ? { ...atual, baixando: false } : atual)
    }
  }

  function fecharLuz() {
    pedidoLuzRef.current += 1
    leituraLuzRef.current?.abort()
    setLuz(null)
  }

  const abaAtual = ABAS_ACERVO.find((a) => a.id === aba) ?? ABAS_ACERVO[0]
  const buscando = termo.trim().length > 0

  /** A busca atravessa as abas: legenda primeiro, depois tags, depois nome. */
  const resultados = (() => {
    if (!buscando || !listas) return []
    const achados: Array<{ pasta: ChavePasta; item: Material }> = []
    for (const a of ABAS_ACERVO) {
      if (!a.chave) continue
      for (const item of listas[a.chave]) {
        if (correspondeBusca(termo, item.legenda, ...(item.tags ?? []), nomeMaterial(item))) achados.push({ pasta: a.chave, item })
      }
    }
    return achados
  })()

  /* `Linha` é DECLARADA DENTRO do componente de propósito? Não — e isso foi um
   * defeito pego na revisão de 16/08. Componente declarado no corpo ganha
   * identidade nova a cada render, e o React DESMONTA e remonta a subárvore
   * inteira: a cada tecla da busca, todas as miniaturas eram descartadas e
   * rebaixadas do servidor (piscando). A correção é renderizar por função
   * comum (`linha(...)`, chamada como função) em vez de elemento JSX — assim
   * o filho é o markup, não um tipo novo. */
  function linha({ pasta, item, mostrarPasta }: { pasta: ChavePasta; item: Material; mostrarPasta?: boolean }) {
    const chaveOcupado = chaveMaterial(pasta, item)
    const nomeVisivel = nomeMaterial(item)
    const colecao = colecaoMaterial(item, t)
    const sugestao = item.destino_sugerido ? SUGESTAO_PARA_CHAVE[item.destino_sugerido] : undefined
    const arquivada = pasta === 'exemplos' && item.em_uso === false
    return (
      <li className={`acv-linha${arquivada ? ' arquivada' : ''}`}>
        <button
          type="button"
          className="acv-abrir"
          title={EH_VIDEO.test(item.nome) ? t("Tocar o vídeo", "Play video") : t("Abrir", "Open")}
          aria-label={t(`Abrir ${nomeVisivel}`, `Open ${nomeVisivel}`)}
          onClick={() => abrirLuz(pasta, item)}
        >
          <MiniaturaArquivo caminho={urlMaterial(orgId, slug, pasta, item, '/miniatura')} nome={item.nome} className="acv-thumb" />
        </button>
        <div className="acv-dados">
          <button type="button" className="acv-nome" title={nomeVisivel}
            aria-label={t(`Ver ${nomeVisivel}`, `View ${nomeVisivel}`)}
            onClick={() => abrirLuz(pasta, item)}>{nomeCurto(item, t)}</button>
          <p className="acv-legenda" title={item.legenda ?? undefined}>
            {item.legenda || <span className="texto-suave">{t("Sem descrição ainda", "No description yet")}</span>}
          </p>
          <span className="acv-meta" title={nomeVisivel}>
            {item.nome.match(/\.([^.]+)$/)?.[1]?.toUpperCase() ?? t('Arquivo', 'File')} · {formatBytes(item.tamanho_bytes, idioma)}
            {item.modificado_em ? ` · ${tempoRelativo(item.modificado_em, idioma)}` : ''}
            {mostrarPasta ? ` · ${ROTULO_POR_CHAVE[pasta]}` : ''}
            {colecao ? ` · ${colecao}` : ''}
          </span>
          {(item.tags?.length ?? 0) > 0 && (
            <span className="acv-tags">
              {item.tags!.map((t) => (
                <i key={t}>{t}</i>
              ))}
            </span>
          )}
        </div>
        <div className="acv-acoes">
          {pasta === 'entrada' && sugestao && sugestao !== 'entrada' && (
            <button
              type="button"
              className="botao botao-primario botao-pequeno"
              disabled={ocupado === chaveOcupado}
              title={t("A IA leu o arquivo e sugere este destino", "AI read the file and suggests this location")}
              onClick={() => mover(pasta, item, sugestao)}
            >
              {t(`Guardar em ${ROTULO_POR_CHAVE[sugestao]}`, `Save in ${ROTULO_POR_CHAVE[sugestao]}`)}
            </button>
          )}
          {pasta === 'exemplos' && (
            <button
              type="button"
              className={`acv-uso${item.em_uso === false ? '' : ' on'}`}
              disabled={ocupado === chaveOcupado}
              aria-label={`${item.em_uso === false ? t('Usar', 'Use') : t('Arquivar', 'Archive')} ${nomeVisivel}`}
              title={
                item.em_uso === false
                  ? t("Arquivada: guardada, mas fora do que eu leio. Clique para voltar a usar.", "Archived: saved, but not used for work. Click to use again.")
                  : t("Em uso: entra no trabalho. Clique para arquivar sem apagar.", "In use: guides the work. Click to archive without deleting.")
              }
              onClick={() => marcarUso(item, item.em_uso === false)}
            >
              {item.em_uso === false ? t("arquivada", "archived") : t("✓ em uso", "✓ in use")}
            </button>
          )}
          <select
            className="acv-mover"
            title={t('Mover para outra aba', 'Move to another tab')}
            value=""
            disabled={ocupado === chaveOcupado}
            aria-label={t(`Mover ${nomeVisivel}`, `Move ${nomeVisivel}`)}
            onChange={(e) => {
              const para = e.target.value as ChavePasta
              if (para) mover(pasta, item, para)
            }}
          >
            <option value="">{t("mover…", "move…")}</option>
            {DESTINOS.filter((d) => d !== pasta).map((d) => (
              <option key={d} value={d}>
                {ROTULO_POR_CHAVE[d]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="botao-texto"
            title={t('Baixar arquivo', 'Download file')}
            aria-label={t(`Baixar ${nomeVisivel}`, `Download ${nomeVisivel}`)}
            onClick={() =>
              baixarArquivo(
                urlMaterial(orgId, slug, pasta, item),
                item.nome,
              ).catch(() => falha(t("Não consegui baixar agora.", "Could not download the file. Please try again.")))
            }
          >
            <Icone nome="baixar" tamanho={16} />
          </button>
          <button type="button" className="botao-texto" title={t('Renomear arquivo', 'Rename file')} aria-label={t(`Renomear ${nomeVisivel}`, `Rename ${nomeVisivel}`)} disabled={ocupado === chaveOcupado} onClick={e => { origemRenomear.current = e.currentTarget; setRenomeando({ orgId, slug, pasta, item }) }}>
            <Icone nome="lapis" tamanho={16} />
          </button>
          <button
            type="button"
            className="botao-texto perigo"
            title={t('Remover arquivo', 'Remove file')}
            aria-label={t(`Excluir ${nomeVisivel}`, `Delete ${nomeVisivel}`)}
            disabled={ocupado === chaveOcupado}
            onClick={() => excluir(pasta, item)}
          >
            <Icone nome="lixeira" tamanho={16} />
          </button>
        </div>
      </li>
    )
  }

  const pendentesTriagem = listas?.entrada.length ?? 0

  return (
    <div className="acv">
      {dialogo}
      {/* O erro NÃO substitui a árvore: cabeçalho, busca, as seis abas e a
          aba Pessoas (que tem GET próprio, possivelmente saudável) continuam
          de pé. O botão de tentar de novo é obrigatório — a shell mantém o
          painel montado com display:none, então trocar de aba não recarrega. */}
      {erro && (
        <p className="alerta alerta-erro">
          {erro}{' '}
          <button type="button" className="botao-texto" onClick={carregar}>
            {t("tentar de novo", "try again")}
          </button>
        </p>
      )}
      <header className="acv-topo">
        <div>
          <h2>{t("Seus materiais", "Your materials")}</h2>
          <p className="texto-suave">
            {t("Encontre suas fotos, vídeos e referências para usar nos próximos pedidos.", "Find your photos, videos and references to use in your next requests.")}
          </p>
        </div>
        <label className="acv-busca">
          <Icone nome="lupa" tamanho={16} />
          <input
            ref={buscaRef}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder={t("Buscar em todas as abas…", "Search all tabs…")}
            aria-label={t("Buscar no acervo", "Search the library")}
          />
        </label>
      </header>

      <ImportarLink orgId={orgId} slug={slug}
        pasta={aba === 'produto' ? 'produto' : 'entrada'}
        disponivel={!buscando && ['chegou', 'produto'].includes(aba)}
        aoImportar={carregar}
        aoEnviarArquivo={() => uploadAlternativoRef.current?.click()} />
      <input ref={uploadAlternativoRef} type="file" hidden tabIndex={-1} disabled={enviando}
        aria-label={t('Enviar arquivo alternativo ao Acervo', 'Upload an alternative file to the library')}
        onChange={event => { void enviar(event.target.files, 'entrada'); event.target.value = '' }} />

      <div className="acv-abas" role="tablist" aria-label={t("Abas do acervo", "Library tabs")}>
        {ABAS_ACERVO.map((a) => {
          const n = a.chave && listas ? listas[a.chave].length : null
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={aba === a.id && !buscando}
              className={`acv-aba${aba === a.id && !buscando ? ' on' : ''}`}
              onClick={() => {
                setAba(a.id)
                setTermo('')
              }}
            >
              <Icone nome={a.icone} tamanho={17} /> {a.rotulo}
              {a.id === 'chegou' && pendentesTriagem > 0 ? (
                <span className="contador">{pendentesTriagem}</span>
              ) : (
                n !== null && <span className="acv-aba-n">{n}</span>
              )}
            </button>
          )
        })}
      </div>

      {renomeando?.orgId === orgId && renomeando.slug === slug && <RenomearMaterial
        key={`${orgId}:${slug}:${chaveMaterial(renomeando.pasta, renomeando.item)}`}
        {...renomeando}
        aoFechar={() => { setRenomeando(null); (origemRenomear.current?.isConnected ? origemRenomear.current : buscaRef.current)?.focus() }}
        aoSalvar={() => { setRenomeando(null); sucesso(t('Nome atualizado. A descrição e a organização foram mantidas.', 'Name updated. The description and organization were preserved.')); carregar(); buscaRef.current?.focus() }}
      />}

      {/* ── busca atravessando as abas ── */}
      {buscando && (
        <section aria-label={t("Resultados da busca", "Search results")}>
          <p className="texto-suave" style={{ margin: '4px 0 10px' }}>
            {resultados.length === 0
              ? t("Nada encontrado. Eu procuro pelo que escrevi sobre cada arquivo, não só pelo nome.", "No results. Search includes descriptions and tags as well as file names.")
              : t(`${resultados.length} resultado${resultados.length === 1 ? '' : 's'} — em todas as abas.`, `${resultados.length} result${resultados.length === 1 ? '' : 's'} — across all tabs.`)}
          </p>
          <ul className="acv-lista">
            {resultados.slice(0, limite).map(({ pasta, item }) => (
              <Fragment key={chaveMaterial(pasta, item)}>{linha({ pasta, item, mostrarPasta: true })}</Fragment>
            ))}
          </ul>
        </section>
      )}

      {!buscando && abaAtual.id === 'pessoas' && <PortaVozes orgId={orgId} slug={slug} />}

      {!buscando && abaAtual.id !== 'pessoas' && abaAtual.chave && (
        <section aria-label={abaAtual.rotulo}>
          <div className="acv-cabecalho">
            <p className="texto-suave acv-descricao">{abaAtual.descricao}</p>
            <div className="acv-cabecalho-acoes">
              <label className="botao botao-fantasma botao-pequeno acv-enviar" aria-busy={enviando}>
                {enviando ? t("Enviando…", "Uploading…") : (
                  <>
                    <Icone nome="anexo" tamanho={15} /> {t("Enviar arquivo", "Upload file")}
                  </>
                )}
                <input
                  ref={uploadRef}
                  type="file"
                  multiple
                  className="sr-only"
                  aria-label={t("Enviar arquivo ao acervo", "Upload file to the library")}
                  disabled={enviando}
                  onChange={(e) => {
                    void enviar(e.target.files, abaAtual.chave as ChavePasta)
                    e.target.value = ''
                  }}
                />
              </label>
              {listas && <span className="acv-contagem">{t(`${listas[abaAtual.chave].length} ${listas[abaAtual.chave].length === 1 ? 'arquivo' : 'arquivos'}`, `${listas[abaAtual.chave].length} ${listas[abaAtual.chave].length === 1 ? 'file' : 'files'}`)}</span>}
            </div>
          </div>

          {abaAtual.id === 'referencias' && listas && listas.exemplos.length > 0 && (
            <p className="acv-teto texto-suave">
              {t(`Até ${TETO_REFERENCIAS} referências por assunto entram no trabalho — o acervo guarda quantas você quiser; arquivar não apaga, só tira do que eu leio antes de escrever.`, `Up to ${TETO_REFERENCIAS} references per topic guide the work. Store as many as you need; archiving keeps the file but excludes it from the references I read.`)}
            </p>
          )}

          {listas === null && erro ? (
            /* Falhou ANTES de qualquer dado: o aviso lá em cima já explica; um
               esqueleto pulsando para sempre embaixo dele leria como "ainda
               carregando". */
            <p className="acv-vazio texto-suave">{t("O acervo não abriu.", "The library could not be loaded.")}</p>
          ) : listas === null ? (
            <div className="esqueleto esqueleto-card" aria-hidden="true" />
          ) : listas[abaAtual.chave].length === 0 ? (
            <p className="acv-vazio texto-suave">{abaAtual.vazio}</p>
          ) : (
            <ul className="acv-lista">
              {listas[abaAtual.chave].slice(0, limite).map((item) => (
                <Fragment key={chaveMaterial(abaAtual.chave as ChavePasta, item)}>
                  {linha({ pasta: abaAtual.chave as ChavePasta, item })}
                </Fragment>
              ))}
            </ul>
          )}
        </section>
      )}

      {(buscando ? resultados.length : (abaAtual.chave && listas?.[abaAtual.chave]?.length) || 0) > limite && <button type="button" className="botao botao-fantasma" onClick={() => setLimite(n => n + 24)}>{t('Mostrar mais arquivos', 'Show more files')}</button>}
      {/* ── o lightbox: abrir a imagem ou tocar o vídeo ali mesmo ── */}
      {luz && (
        <DialogoArquivo className="acv-luz" nome={nomeMaterial(luz.item)} aoFechar={fecharLuz}>
          <div className="acv-luz-caixa" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong title={nomeMaterial(luz.item)} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{nomeCurto(luz.item, t)}</strong>
              <button ref={fecharLuzBotaoRef} type="button" className="botao-texto" onClick={fecharLuz} aria-label={t("Fechar", "Close")} autoFocus>
                <Icone nome="fechar" tamanho={18} />
              </button>
            </header>
            <div className="acv-luz-palco">
              {luz.erro ? (
                <p className="alerta alerta-erro" role="alert">
                  {mensagemFalhaPrevia(luz.erro, t)}
                </p>
              ) : luz.carregando ? (
                <><span className="sr-only" role="status">{t('Abrindo prévia…', 'Opening preview…')}</span><div className="esqueleto esqueleto-card" aria-hidden="true" /></>
              ) : luz.url && EH_VIDEO.test(luz.item.nome) ? (
                /* blob em <video> é seguro (não executa script); o perigo
                   documentado é abrir HTML por blob, e HTML aqui só baixa. */
                <video key={luz.pedido} src={luz.url} controls autoPlay onError={() => falhaNaPrevia(luz.pedido, luz.url!)} style={{ maxWidth: '100%', maxHeight: '62vh' }} />
              ) : luz.url && EH_IMAGEM.test(luz.item.nome) ? (
                <img key={luz.pedido} src={luz.url} alt={luz.item.legenda ?? luz.item.nome} onError={() => falhaNaPrevia(luz.pedido, luz.url!)} />
              ) : (
                <p className="texto-suave" style={{ padding: 20 }}>
                  {t("Este tipo de arquivo não abre aqui — use o botão de baixar.", "This file type cannot be previewed here. Use the download button.")}
                </p>
              )}
            </div>
            {luz.item.legenda && <p className="acv-luz-legenda">{luz.item.legenda}</p>}
            <div className="acv-renomear-acoes" style={{ padding: 16 }}>
              {luz.erro && <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => {
                void abrirLuz(luz.pasta, luz.item)
                fecharLuzBotaoRef.current?.focus()
              }}>{t('Tentar novamente', 'Try again')}</button>}
              <button type="button" className="botao botao-fantasma botao-pequeno" disabled={luz.baixando} onClick={() => void baixarLuz()}>
                <Icone nome="baixar" tamanho={16} /> {luz.baixando ? t('Baixando…', 'Downloading…') : t('Baixar original', 'Download original')}
              </button>
            </div>
          </div>
        </DialogoArquivo>
      )}
    </div>
  )
}
