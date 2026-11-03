/* ------------------------------------------------------------------ */
/* "O que eu já sei" — o conhecimento do escritório para o DONO         */
/*                                                                     */
/* Só LEITURA, de propósito. O caminho de escrita do usuário comum é    */
/* conversar (a IA já recebe o conhecimento no system) e aprovar/       */
/* rejeitar uma entrega. A ConhecimentoTab (1567 linhas, markdown cru,  */
/* jargão de operador e remoção destrutiva de lição) continua servindo  */
/* o operador na shell completa — esta tela é outra coisa.              */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'

import { ApiError, api, baixarArquivo, carregarArquivo, getSessionIdentity } from '../../lib/api'
import { wsClient } from '../../lib/ws'
import { Icone, iconeDoArquivo } from '../Icone'
import { useToasts } from '../Toasts'
import { useConfirmacao } from '../useConfirmacao'
import { useIdioma, type Idioma, type Traduzir } from '../../lib/i18n'
import { formatBytes } from '../../lib/format'
import PortaVozes from './PortaVozes'

type TarefaConhecimento = { chave: string; titulo: string; descricao: string }

/** Uma regra que caiu porque outra a contradisse. Vem de knowledge/
 *  substituicoes.json — fora do cânon, senão continuaria mandando. */
type Substituicao = {
  regra_revogada: string
  regra_vigente: string
  quando?: string
  job_id?: number
}

type Licao = {
  indice: number
  motivo: string
  type: string
  weight: number
  contexto_resumido?: string
  /** o porquê absorvido pela IA na refação (o motivo é a palavra crua do humano) */
  diagnostico?: string
  last_seen?: string
}

type Atividade = {
  id: number
  titulo: string
  descricao: string
  escopo: string
  tem_conhecimento: boolean
}

/** Um material que o dono subiu. `legenda`/`tags` vêm do catálogo que o
 *  escritório escreve (skill catalogar-acervo) depois de ABRIR o arquivo —
 *  é o que faz "aquela foto da fachada" ser encontrável. Pode não existir
 *  ainda: material recém-subido só ganha legenda na próxima tarefa. */
type Material = {
  nome: string
  sub?: string
  tamanho_bytes: number
  modificado_em: string
  legenda?: string | null
  tags?: string[]
}

/** Os destinos que o backend aceita (whitelist em arquivos.py):
 *  entrada/ é o balcão clássico, lido em toda tarefa; exemplos e produto são
 *  o acervo da marca — só aparecem em escritório com acervo_de_marca. */
type PastaMaterial = 'entrada' | 'exemplos' | 'produto'

function nomeMaterial(material: Pick<Material, 'nome' | 'sub'>): string {
  return material.sub ? `${material.sub}/${material.nome}` : material.nome
}

function chaveMaterial(pasta: PastaMaterial, material: Pick<Material, 'nome' | 'sub'>): string {
  return `${pasta}/${nomeMaterial(material)}`
}

function urlMaterial(orgId: number, slug: string, pasta: PastaMaterial, material: Pick<Material, 'nome' | 'sub'>): string {
  return `/predios/${orgId}/${slug}/arquivos/${pasta}/${encodeURIComponent(material.nome)}${material.sub ? `?sub=${encodeURIComponent(material.sub)}` : ''}`
}

const EH_IMAGEM = /\.(png|jpe?g|webp|gif)$/i

/** A MINIATURA do material: o dono decidia o que apagar às cegas (só o nome —
 *  "IMG_0907.PNG" não diz nada). Imagem carrega os bytes por fetch autenticado
 *  (o <img src> cru leva 401) e revoga o objectURL no unmount; vídeo e
 *  documento ganham um glifo — miniatura de vídeo fica para quando houver
 *  proxy de frames no worker. */
function MiniaturaMaterial({
  orgId,
  slug,
  pasta,
  nome,
  sub,
}: {
  orgId: number
  slug: string
  pasta: PastaMaterial
  nome: string
  sub?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const ehImagem = EH_IMAGEM.test(nome)
  useEffect(() => {
    setUrl(null)
    if (!ehImagem) return
    let vivo = true
    let objeto: string | null = null
    carregarArquivo(
      urlMaterial(orgId, slug, pasta, { nome, sub }),
    )
      .then((u) => {
        objeto = u
        if (vivo) setUrl(u)
        else URL.revokeObjectURL(u)
      })
      .catch(() => {
        /* sem miniatura não é erro: o glifo cobre */
      })
    return () => {
      vivo = false
      if (objeto) URL.revokeObjectURL(objeto)
    }
  }, [ehImagem, orgId, slug, pasta, nome, sub])

  const caixa: CSSProperties = {
    width: 44,
    height: 44,
    flex: '0 0 44px',
    borderRadius: 8,
    border: '1px solid var(--borda)',
    background: 'var(--bg-1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    fontSize: 18,
  }
  if (ehImagem && url) {
    return (
      <span style={caixa} aria-hidden="true">
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </span>
    )
  }
  return (
    <span style={caixa} aria-hidden="true">
      <Icone nome={iconeDoArquivo(nome)} />
    </span>
  )
}

type CartaoAcervo = {
  pasta: PastaMaterial
  titulo: string
  explicacao: string
  vazio: string
  icone: string
}

const CARTAO_ENTRADA = (traduzir: Traduzir): CartaoAcervo => ({
  pasta: 'entrada',
  // O cabeçalho da seção já promete "é daqui que eu tiro os fatos" — o card
  // não repete: para quem lê devagar, texto dobrado atrasa a tela inteira.
  titulo: traduzir('Documentos da empresa', 'Company documents'),
  explicacao: traduzir('Catálogo, apresentação, tabela de preços, textos do site — o que descreve a sua empresa.', 'Catalogs, presentations, price lists, website copy — material that describes your company.'),
  vazio:
    traduzir('Nada aqui ainda — por isso eu só consigo te fazer perguntas. Envie o que descreve a sua empresa e eu paro de perguntar o que já está escrito.', 'Nothing here yet. Upload material describing your company so I can use its information instead of asking for it.'),
  icone: 'arq-documento',
})

// O acervo da marca: os dois cards vão direto para memoria/brand/acervo/,
// que é onde a diretriz manda os agentes buscarem — a foto REAL do produto
// (packshot; gerar por IA é proibido pela §6) e os posts de referência.
const CARTOES_MARCA = (traduzir: Traduzir): CartaoAcervo[] => [
  {
    pasta: 'exemplos',
    titulo: traduzir('Exemplos de posts', 'Example posts'),
    explicacao:
      traduzir('Posts que você gosta — seus ou de outras marcas. Eu aprendo o jeito deles, não copio o conteúdo.', 'Posts you like, from your brand or others. I learn their style without copying their content.'),
    vazio: traduzir('Nenhum exemplo ainda. Com dois ou três, eu já pego o estilo que você quer.', 'No examples yet. Two or three help me understand the style you want.'),
    icone: 'ideia',
  },
  {
    pasta: 'produto',
    titulo: traduzir('Fotos do produto', 'Product photos'),
    explicacao:
      traduzir('A foto verdadeira do que você vende — é ela que aparece nas peças, nunca uma inventada.', 'Real photos of what you sell are used in deliverables, never invented ones.'),
    vazio:
      traduzir('Nenhuma foto ainda. Se o seu negócio é serviço e não tem produto pra fotografar, pode deixar vazio.', 'No photos yet. If you provide services without a physical product, you can leave this empty.'),
    icone: 'arq-imagem',
  },
]

/** dd/mm/aaaa, ou vazio quando a data não veio/não presta — a tela não pode
 *  mostrar "Invalid Date" para o dono. */
function dataCurta(iso: string | undefined, idioma: Idioma): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(idioma)
}

/** Uma seção `## ` do cânon: título + as linhas que vieram abaixo dela. */
type SecaoCanon = { titulo: string; linhas: string[] }

function fatiarCanon(texto: string): SecaoCanon[] {
  const secoes: SecaoCanon[] = []
  let atual: SecaoCanon | null = null
  // Cânon no formato ANTIGO vinha embrulhado num bloco <!-- -->, com a
  // explicação do que é o cânon. Pular só as linhas que ABREM e FECHAM o
  // comentário deixava o CORPO dele virar item da lista: o dono lia "escreva
  // aqui os INEGOCIÁVEIS" como se fosse uma regra que ele mesmo tivesse dado.
  let dentroDeComentario = false
  for (const bruta of (texto || '').split('\n')) {
    const linha = bruta.trim()
    if (!linha) continue
    if (dentroDeComentario) {
      if (linha.includes('-->')) dentroDeComentario = false
      continue
    }
    if (linha.startsWith('<!--')) {
      if (!linha.includes('-->')) dentroDeComentario = true
      continue
    }
    if (linha.startsWith('## ')) {
      atual = { titulo: linha.slice(3).trim(), linhas: [] }
      secoes.push(atual)
      continue
    }
    if (linha.startsWith('# ')) continue // título do arquivo — a tela já tem o seu
    const item = linha.replace(/^[-*]\s+/, '')
    if (!item) continue
    if (!atual) {
      atual = { titulo: '', linhas: [] }
      secoes.push(atual)
    }
    atual.linhas.push(item)
  }
  return secoes.filter((s) => s.linhas.length > 0)
}

/* Cada bloco tinha um botão "💬 Perguntar sobre isso" que levava para a
   conversa com a pergunta pronta. Saiu: era um segundo caminho para a mesma
   coisa, e um caminho pior — a pessoa lia a pergunta escrita por nós em vez
   de perguntar com as palavras dela. A conversa é a porta, e é uma só. */
function Bloco({
  titulo,
  explicacao,
  children,
}: {
  titulo: string
  explicacao: string
  children: React.ReactNode
}) {
  return (
    <section className="sabe-bloco">
      <header className="sabe-bloco-topo">
        <div>
          <h3>{titulo}</h3>
          <p className="texto-suave">{explicacao}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

type ConhecimentoProps = {
  orgId: number
  slug: string
  aoPerguntar?: (texto: string) => void
  acervoDeMarca?: boolean
  acervoSeparado?: boolean
  aoAbrirAcervo?: () => void
}

export function ConhecimentoSimples(props: ConhecimentoProps) {
  return <ConhecimentoConteudo key={`${props.orgId}:${props.slug}:${getSessionIdentity()}`} {...props} />
}

type RenomearProps = {
  orgId: number
  slug: string
  pasta: PastaMaterial
  material: Material
  antesDeSalvar: () => void
  aoSalvar: (nome: string) => void
  aoFechar: () => void
}

function RenomearMaterial({ orgId, slug, pasta, material, antesDeSalvar, aoSalvar, aoFechar }: RenomearProps) {
  const { t } = useIdioma()
  const [nome, setNome] = useState(material.nome)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const vivoRef = useRef(true)
  const envioRef = useRef(false)
  const sessaoRef = useRef(getSessionIdentity())
  const campoRef = useRef<HTMLInputElement>(null)
  const telaAtual = () => vivoRef.current && getSessionIdentity() === sessaoRef.current

  useEffect(() => {
    vivoRef.current = true
    campoRef.current?.focus()
    campoRef.current?.select()
    return () => { vivoRef.current = false }
  }, [])

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const novoNome = nome.trim()
    if (envioRef.current || !novoNome || novoNome === material.nome || !telaAtual()) return
    envioRef.current = true
    setSalvando(true)
    setErro('')
    antesDeSalvar()
    try {
      const resposta = await api.patch<{ nome: string }>(urlMaterial(orgId, slug, pasta, material), { novo_nome: novoNome })
      if (telaAtual()) aoSalvar(resposta.nome)
    } catch (erro) {
      if (telaAtual()) setErro(erro instanceof ApiError ? erro.detail : t('Não consegui renomear agora. Seu novo nome continua aqui.', 'Could not rename the file. Your new name is still here.'))
    } finally {
      envioRef.current = false
      if (telaAtual()) setSalvando(false)
    }
  }

  return (
    <form className="sabe-card" aria-label={t(`Renomear ${nomeMaterial(material)}`, `Rename ${nomeMaterial(material)}`)}
      onSubmit={salvar} onKeyDown={event => {
        if (event.key === 'Escape' && !envioRef.current) { event.preventDefault(); aoFechar() }
      }}>
      <strong>{t('Renomear arquivo', 'Rename file')}</strong>
      <p>{nomeMaterial(material)}</p>
      <label>{t('Novo nome do arquivo', 'New file name')}
        <input ref={campoRef} maxLength={255} required value={nome} disabled={salvando} onChange={event => setNome(event.target.value)} />
      </label>
      {erro && <p className="alerta alerta-erro" role="alert">{erro}</p>}
      <div className="linha-form">
        <button className="botao botao-primario" disabled={salvando || !nome.trim() || nome.trim() === material.nome}>
          {salvando ? t('Salvando…', 'Saving…') : t('Salvar nome', 'Save name')}
        </button>
        <button type="button" className="botao botao-fantasma" disabled={salvando} onClick={aoFechar}>{t('Cancelar', 'Cancel')}</button>
      </div>
    </form>
  )
}

function ConhecimentoConteudo({
  orgId,
  slug,
  aoPerguntar,
  acervoDeMarca = false,
  acervoSeparado = false,
  aoAbrirAcervo,
}: ConhecimentoProps) {
  const { t: traduzir, idioma } = useIdioma()
  const [canon, setCanon] = useState<string>('')
  const [licoes, setLicoes] = useState<Licao[]>([])
  const [atividades, setAtividades] = useState<Atividade[]>([])
  const [premissas, setPremissas] = useState<string | null>(null)
  // EDIÇÃO DAS PREMISSAS (23/08/2026): o escritório ancora TODA entrega nos
  // objetivos deste arquivo, e a tela só o exibia — o dono não tinha onde
  // preencher, então tudo ficava '[a preencher]' para sempre e cada peça
  // repetia o mesmo diagnóstico.
  const [editandoPremissas, setEditandoPremissas] = useState(false)
  const [premissasRascunho, setPremissasRascunho] = useState('')
  const [salvandoPremissas, setSalvandoPremissas] = useState(false)
  const [tarefas, setTarefas] = useState<TarefaConhecimento[]>([])
  const [materiais, setMateriais] = useState<Record<PastaMaterial, Material[]>>({
    entrada: [],
    exemplos: [],
    produto: [],
  })
  const [enviando, setEnviando] = useState<PastaMaterial | null>(null)
  // Chave `pasta/sub/nome`: arquivos de conversas podem repetir o nome.
  const [excluindo, setExcluindo] = useState<string | null>(null)
  /** Mesma chave do excluir. O material do dono pode ter dezenas de MB (vídeo
   *  do celular): sem o "…" no botão, o clique parecia não ter feito nada e
   *  ele clicava de novo. Só o arquivo EM VOO trava — baixar dois ao mesmo
   *  tempo é legítimo (ao contrário do excluir, que é destrutivo). */
  const [baixando, setBaixando] = useState<string | null>(null)
  const [substituicoes, setSubstituicoes] = useState<Substituicao[]>([])
  const [disparando, setDisparando] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [consultado, setConsultado] = useState(false)
  const [erroPremissas, setErroPremissas] = useState('')
  const [renomeando, setRenomeando] = useState<{ pasta: PastaMaterial; material: Material } | null>(null)
  const origemRenomear = useRef<HTMLButtonElement | null>(null)
  const botoesRenomearRef = useRef(new Map<string, HTMLButtonElement>())
  const focoRenomearRef = useRef<string | null>(null)
  const telaAtivaRef = useRef(true)
  const sessaoRef = useRef(getSessionIdentity())
  const leituraRef = useRef<AbortController | null>(null)
  const consultaCompletaRef = useRef(false)
  const disparandoRef = useRef(false)
  const enviandoRef = useRef(false)
  const { sucesso, falha } = useToasts()
  const { confirmar, dialogo } = useConfirmacao(`${sessaoRef.current}:${orgId}:${slug}`)

  const telaAtual = useCallback(() => telaAtivaRef.current && getSessionIdentity() === sessaoRef.current, [])
  useEffect(() => { telaAtivaRef.current = true; return () => { telaAtivaRef.current = false; leituraRef.current?.abort() } }, [])

  /** Dispara a tarefa em que a IA propõe conhecimento. A proposta volta como
   *  ENTREGA — quem aplica ao escritório é a sua aprovação, não o agente. */
  async function rodarTarefa(t: TarefaConhecimento) {
    if (!telaAtual() || disparandoRef.current) return
    disparandoRef.current = true
    setDisparando(t.chave)
    try {
      await api.post(`/predios/${orgId}/${slug}/conhecimento/tarefas/${t.chave}`, {})
      if (!telaAtual()) return
      sucesso(traduzir(`“${t.titulo}” começou. Quando ficar pronto, aparece em Entregas para o seu OK.`, `“${t.titulo}” has started. When ready, it will appear in Deliverables for your approval.`))
      carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir('Não consegui começar essa tarefa agora.', 'Could not start this task right now.'))
    } finally {
      disparandoRef.current = false
      if (telaAtual()) setDisparando(null)
    }
  }

  /** Sobe material da empresa para a pasta do card (documentos, exemplos de
   *  post ou fotos do produto) — é assim que o escritório passa a conhecer a
   *  empresa sem que ninguém precise digitar tudo. */
  async function enviarMateriais(pasta: PastaMaterial, lista: FileList | null) {
    const arquivos = Array.from(lista ?? [])
    if (!arquivos.length || !telaAtual() || enviandoRef.current) return
    enviandoRef.current = true
    setEnviando(pasta)
    let enviados = 0
    for (const arquivo of arquivos) {
      if (!telaAtual()) break
      try {
        const fd = new FormData()
        fd.append('arquivo', arquivo)
        await api.postForm(`/predios/${orgId}/${slug}/arquivos?pasta=${pasta}`, fd)
        enviados += 1
      } catch (e) {
        // Um arquivo grande demais não pode derrubar os outros do mesmo lote.
        if (!telaAtual()) break
        falha(
          e instanceof ApiError
            ? `${arquivo.name}: ${e.detail}`
            : traduzir(`Não consegui receber “${arquivo.name}”.`, `Could not receive “${arquivo.name}”.`),
        )
      }
    }
    enviandoRef.current = false
    if (!telaAtual()) return
    setEnviando(null)
    if (enviados) {
      sucesso(
        enviados === 1
          ? traduzir('Material guardado. Vou ler ele na próxima tarefa.', 'Material saved. I will read it in the next task.')
          : traduzir(`${enviados} materiais guardados. Vou ler todos na próxima tarefa.`, `${enviados} files saved. I will read them in the next task.`),
      )
      carregar()
    }
  }

  /** BAIXAR o material de volta (12/08/2026 — pedido do dono).
   *
   *  O endpoint dos bytes já existia (é o que serve a miniatura); faltava a
   *  porta na tela. O que o dono sobe é DELE — ele precisa conseguir levar
   *  embora sem depender de nós, e mais ainda numa org com residência de
   *  dados, em que o arquivo mora na infra dele (o backend resolve
   *  cliente-primeiro sozinho). Download autenticado por fetch: `<a href>`
   *  cru levaria 401 (o token não vai na navegação). */
  async function baixarMaterial(pasta: PastaMaterial, material: Material) {
    if (!telaAtual()) return
    setBaixando(chaveMaterial(pasta, material))
    try {
      await baixarArquivo(
        urlMaterial(orgId, slug, pasta, material),
        material.nome,
      )
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir('Não consegui baixar esse material agora.', 'Could not download this material right now.'))
    } finally {
      if (telaAtual()) setBaixando(null)
    }
  }

  async function excluirMaterial(pasta: PastaMaterial, material: Material) {
    const nome = nomeMaterial(material)
    if (!telaAtual() || excluindo !== null) return
    if (!await confirmar({ titulo: traduzir('Remover arquivo do escritório', 'Remove file from workspace'), mensagem: traduzir(`Tirar “${nome}” do escritório? Ele deixa de ser lido nas tarefas.`, `Remove “${nome}” from the workspace? It will no longer be read in tasks.`), acao: traduzir('Remover arquivo', 'Remove file') }) || !telaAtual()) return
    leituraRef.current?.abort()
    const chave = chaveMaterial(pasta, material)
    setExcluindo(chave)
    try {
      await api.del(urlMaterial(orgId, slug, pasta, material))
      if (!telaAtual()) return
      leituraRef.current?.abort()
      setMateriais((prev) => ({
        ...prev,
        [pasta]: prev[pasta].filter((m) => chaveMaterial(pasta, m) !== chave),
      }))
      sucesso(traduzir(`“${nome}” saiu do escritório.`, `“${nome}” was removed from the office.`))
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : traduzir('Não consegui excluir esse material agora.', 'Could not delete this material right now.'))
    } finally {
      if (telaAtual()) setExcluindo(null)
    }
  }

  function fecharRenomear(restaurarFoco = true) {
    setRenomeando(null)
    if (restaurarFoco && origemRenomear.current?.isConnected) origemRenomear.current.focus()
  }

  useEffect(() => {
    if (renomeando || !focoRenomearRef.current) return
    botoesRenomearRef.current.get(focoRenomearRef.current)?.focus()
    focoRenomearRef.current = null
  }, [materiais, renomeando])

  const carregar = useCallback(() => {
    if (!telaAtual()) return Promise.resolve()
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    const base = `/predios/${orgId}/${slug}/conhecimento`
    const atual = () => telaAtual() && !controller.signal.aborted
    // Uma falha parcial conserva os valores já consultados. Ausência de
    // resposta nunca equivale a perfil vazio ou material excluído.
    return Promise.allSettled([
      api.get<{ conteudo: string }>(`${base}/canon`, controller.signal),
      api.get<Licao[]>(`${base}/licoes`, controller.signal),
      api.get<{ atividades: Atividade[] }>(`${base}/atividades`, controller.signal),
      api.get<{ conteudo: string | null }>(`${base}/premissas`, controller.signal),
      api.get<{ tarefas: TarefaConhecimento[] }>(`${base}/tarefas`, controller.signal),
      api.get<{ substituicoes: Substituicao[] }>(`${base}/substituicoes`, controller.signal),
      api.get<{ entrada: Material[]; exemplos: Material[]; produto: Material[] }>(`/predios/${orgId}/${slug}/arquivos`, controller.signal),
    ])
      .then(([c, l, a, p, tf, sub, arq]) => {
        if (!atual()) return
        if (arq.status === 'fulfilled') {
          setMateriais({
            entrada: Array.isArray(arq.value?.entrada) ? arq.value.entrada : [],
            exemplos: Array.isArray(arq.value?.exemplos) ? arq.value.exemplos : [],
            produto: Array.isArray(arq.value?.produto) ? arq.value.produto : [],
          })
        }
        if (sub.status === 'fulfilled') setSubstituicoes(Array.isArray(sub.value?.substituicoes) ? sub.value.substituicoes : [])
        if (c.status === 'fulfilled') setCanon(c.value?.conteudo ?? '')
        if (l.status === 'fulfilled') setLicoes(Array.isArray(l.value) ? l.value : [])
        if (a.status === 'fulfilled') setAtividades(Array.isArray(a.value?.atividades) ? a.value.atividades : [])
        if (p.status === 'fulfilled') setPremissas(p.value?.conteudo ?? null)
        if (tf.status === 'fulfilled') setTarefas(Array.isArray(tf.value?.tarefas) ? tf.value.tarefas : [])
        const completa = [c, l, a, p, tf, sub, arq].every(resultado => resultado.status === 'fulfilled')
        if (completa) { consultaCompletaRef.current = true; setConsultado(true); setErro(null) }
        else {
          // Identificar a parte indisponível sem expor respostas do servidor,
          // caminhos de arquivo ou credenciais recebidas numa mensagem de erro.
          const partesNaoLidas = [
            [c, traduzir('perfil', 'profile')],
            [l, traduzir('aprendizados', 'lessons')],
            [a, traduzir('atividades', 'activities')],
            [p, traduzir('objetivos e regras', 'goals and rules')],
            [tf, traduzir('pedidos', 'requests')],
            [sub, traduzir('regras substituídas', 'replaced rules')],
            [arq, traduzir('materiais', 'materials')],
          ] as const
          const partes = partesNaoLidas.filter(([resultado]) => resultado.status === 'rejected').map(([, nome]) => nome).join(', ')
          const aviso = consultaCompletaRef.current
            ? traduzir('Não foi possível consultar todas as informações. Os dados da última consulta foram preservados. Tente novamente.', 'Could not check all information. Data from the last check was kept. Try again.')
            : traduzir('Não foi possível abrir todas as informações da empresa. Tente novamente antes de usar este painel.', 'Could not load all company information. Try again before using this panel.')
          setErro(`${aviso} ${traduzir('Não foi possível ler:', 'Could not read:')} ${partes}.`)
        }
      })
      .finally(() => {
        if (atual()) setCarregando(false)
      })
  }, [orgId, slug, traduzir, telaAtual])

  useEffect(() => {
    setCarregando(true)
    void carregar()
    return () => leituraRef.current?.abort()
  }, [carregar])

  // O laço do produto é "aprove e veja o escritório aprender": esta aba fica
  // MONTADA (display:none) enquanto o dono aprova em Entregas, então sem
  // escutar o evento ela mostrava o estado velho — inclusive o "ainda não
  // aprendi nada" logo depois do toast dizendo que a lição foi guardada.
  useEffect(() => {
    const recarregar = () => { void carregar() }
    window.addEventListener('offiz:entregas-mudou', recarregar)
    const off = wsClient.on('job_status', evento => { if ('org_id' in evento && evento.org_id === orgId) recarregar() })
    return () => {
      window.removeEventListener('offiz:entregas-mudou', recarregar)
      off()
    }
  }, [carregar, orgId])

  const secoes = fatiarCanon(canon)
  const temMateriais = Object.values(materiais).some((lista) => lista.length > 0)
  const tarefasOferecidas = tarefas.filter((t) => {
    // Cada tarefa só aparece quando HÁ o que ela consome — botão que gasta uma
    // rodada e devolve proposta vazia ensina o dono a não clicar em nada.
    if (t.chave === 'revisar-conhecimento') return licoes.length > 0
    if (t.chave === 'apurar-conhecimento') return licoes.length > 0 || temMateriais
    return true
  })
  // Agrupa as tarefas pelo tema declarado no escritório (office.json) — sem
  // tema, tudo cai num grupo só, e a tela continua legível.
  const porEscopo = new Map<string, Atividade[]>()
  for (const a of atividades) {
    const chave = a.escopo || traduzir('O que eu faço', 'What I do')
    porEscopo.set(chave, [...(porEscopo.get(chave) ?? []), a])
  }

  if (carregando) {
    return (
      <div className="sabe" aria-busy="true">
        <p className="texto-suave">{traduzir('Abrindo o meu caderno…', 'Opening my notes…')}</p>
      </div>
    )
  }

  // Servidor fora do ar: SÓ o aviso e a saída — renderizar os blocos vazios
  // embaixo do aviso contaria duas histórias contraditórias na mesma tela.
  if (erro && !consultado) {
    return (
      <div className="sabe">
        <div className="alerta alerta-erro" role="alert">{erro}</div>
        <button
          type="button"
          className="botao botao-primario"
          onClick={() => {
            setErro(null)
            setCarregando(true)
            carregar()
          }}
        >
          {traduzir('Tentar de novo', 'Try again')}
        </button>
      </div>
    )
  }

  return (
    <div className="sabe">
      {dialogo}
      {erro && <p className="alerta alerta-erro" role="alert">{erro} <button type="button" className="botao-texto" onClick={() => void carregar()}>{traduzir('Tentar novamente', 'Try again')}</button></p>}
      {renomeando && <RenomearMaterial key={chaveMaterial(renomeando.pasta, renomeando.material)} orgId={orgId} slug={slug} {...renomeando} antesDeSalvar={() => leituraRef.current?.abort()} aoFechar={() => fecharRenomear()} aoSalvar={nome => {
        leituraRef.current?.abort()
        const chave = chaveMaterial(renomeando.pasta, renomeando.material)
        setMateriais(atuais => ({ ...atuais, [renomeando.pasta]: atuais[renomeando.pasta].map(material => chaveMaterial(renomeando.pasta, material) === chave ? { ...material, nome } : material) }))
        focoRenomearRef.current = chaveMaterial(renomeando.pasta, { ...renomeando.material, nome })
        fecharRenomear(false)
        sucesso(traduzir(`Renomeado para “${nome}”.`, `Renamed to “${nome}”.`))
      }} />}

      {/* Aqui havia um MAPA (grafo de nós e arestas). Saiu: o desenho não
          dizia a ninguém o que fazer em seguida, e ocupava a primeira dobra
          da tela — o lugar mais caro. Quem precisa entender o que o
          escritório sabe lê os cards abaixo, que são texto e têm botão. */}
      <p className="sabe-intro">
        {traduzir('Isto é tudo o que eu sei sobre a sua empresa. Você me ensina de três jeitos:', 'This is everything I know about your company. You can teach me in three ways:')}{' '}
        <strong>{traduzir('enviando os materiais aqui embaixo', 'uploading material below')}</strong>{traduzir(', me falando na conversa, ou dizendo o que ficou bom (e o que não ficou) quando aprovar uma entrega.', ', talking to me in the chat, or explaining what worked and what did not when reviewing a deliverable.')}
      </p>

      {/* PRIMEIRA seção da tela, e não por acaso: num escritório recém-aberto o
          resto está vazio: sem material, o escritório não sabe o nome do seu
          produto, e toda tarefa só pode devolver perguntas. Subir arquivo é o
          único passo que transforma um escritório zerado num que trabalha.
          Em prédio de marca são TRÊS cards — documentos, exemplos de posts e
          fotos do produto — para o arquivo cair direto no lugar que a
          diretriz manda os agentes lerem, sem ninguém ter que classificar. */}
      {/* Com o ACERVO como porta própria (16/08/2026), esta tela para de
          duplicar os materiais: arquivo é DADO e mora lá; aqui ficam as
          regras e as lições. O card vira um ponteiro — dois lugares mostrando
          a mesma lista divergem na primeira sessão. */}
      {acervoSeparado && (
        <section className="sabe-bloco">
          <div className="sabe-vazio">
            <p>
              <strong>{traduzir('Os arquivos moram no Acervo agora.', 'Files are now in the Library.')}</strong> {traduzir('Marca, produto, referências, aprovados e pessoas — com busca e com a descrição que eu escrevo para cada um.', 'Brand assets, products, references, approved work and people — searchable, with a description for each.')}
            </p>
            {aoAbrirAcervo && (
              <button type="button" className="botao botao-fantasma" onClick={aoAbrirAcervo}>
                <Icone nome="arq-pasta" tamanho={15} /> {traduzir('Abrir o Acervo', 'Open Library')}
              </button>
            )}
          </div>
        </section>
      )}

      {!acervoSeparado && (
      <section className="sabe-bloco">
        <header className="sabe-bloco-topo">
          <div>
            <h3>{traduzir('Materiais da sua empresa', 'Your company’s materials')}</h3>
            <p className="texto-suave">
              {traduzir('Eu leio tudo o que você enviar aqui — é daqui que eu tiro os fatos, em vez de inventar.', 'I read the material you upload here and use it as the source of facts.')}
            </p>
          </div>
        </header>

        <div className="sabe-cartoes-acervo">
          {[CARTAO_ENTRADA(traduzir), ...(acervoDeMarca ? CARTOES_MARCA(traduzir) : [])].map((cartao) => (
            <div key={cartao.pasta} className="sabe-card sabe-cartao-acervo">
              <strong className="sabe-card-titulo">
                <Icone nome={cartao.icone} tamanho={15} /> {cartao.titulo}
              </strong>
              <p className="texto-suave">{cartao.explicacao}</p>

              {materiais[cartao.pasta].length === 0 ? (
                <p className="texto-suave sabe-acervo-vazio">{cartao.vazio}</p>
              ) : (
                <ul className="sabe-lista-materiais">
                  {materiais[cartao.pasta].map((m) => (
                    <li key={chaveMaterial(cartao.pasta, m)} className="sabe-material">
                      <MiniaturaMaterial
                        orgId={orgId}
                        slug={slug}
                        pasta={cartao.pasta}
                        nome={m.nome}
                        sub={m.sub}
                      />
                      {/* A LEGENDA na frente do nome do arquivo: "Fachada da
                          casa de Teresópolis" diz algo, "IMG_4821.jpg" não.
                          O tamanho vive NA SUBLINHA do nome — como célula
                          própria ele espremia o nome a um caractere na coluna
                          estreita (feedback real com a miniatura no ar). */}
                      <span className="sabe-material-nome" title={nomeMaterial(m)}>
                        {m.legenda ? (
                          <>
                            {m.legenda}
                            <br />
                            <span className="texto-suave">
                              {nomeMaterial(m)} · {formatBytes(m.tamanho_bytes, idioma)}
                            </span>
                          </>
                        ) : (
                          <>
                            {nomeMaterial(m)}
                            <br />
                            <span className="texto-suave">{formatBytes(m.tamanho_bytes, idioma)}</span>
                          </>
                        )}
                      </span>
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        disabled={baixando === chaveMaterial(cartao.pasta, m)}
                        onClick={() => baixarMaterial(cartao.pasta, m)}
                        aria-label={traduzir(`Baixar ${nomeMaterial(m)}`, `Download ${nomeMaterial(m)}`)}
                        title={traduzir('Baixar para o seu computador', 'Download to your computer')}
                      >
                        {baixando === chaveMaterial(cartao.pasta, m) ? '…' : <Icone nome="baixar" />}
                      </button>
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        onClick={event => { origemRenomear.current = event.currentTarget; setRenomeando({ pasta: cartao.pasta, material: m }) }}
                        aria-label={traduzir(`Renomear ${nomeMaterial(m)}`, `Rename ${nomeMaterial(m)}`)}
                        ref={elemento => {
                          const chave = chaveMaterial(cartao.pasta, m)
                          if (elemento) botoesRenomearRef.current.set(chave, elemento)
                          else botoesRenomearRef.current.delete(chave)
                        }}
                        title={traduzir('Renomear (a legenda acompanha)', 'Rename (keeping the description)')}
                      >
                        <Icone nome="lapis" />
                      </button>
                      <button
                        type="button"
                        className="botao botao-fantasma botao-pequeno"
                        // TODOS os excluir travam enquanto UM está em voo: o
                        // estado é um slot só, e liberar os vizinhos permitia
                        // clique duplo com toast de erro para exclusão que
                        // tinha dado certo.
                        disabled={excluindo !== null}
                        onClick={() => excluirMaterial(cartao.pasta, m)}
                        title={traduzir('Excluir do escritório', 'Delete from the office')}
                        aria-label={traduzir(`Excluir ${nomeMaterial(m)}`, `Delete ${nomeMaterial(m)}`)}
                      >
                        {excluindo === chaveMaterial(cartao.pasta, m) ? '…' : <Icone nome="lixeira" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <label
                className="botao botao-primario sabe-subir"
                aria-busy={enviando === cartao.pasta}
              >
                {/* "Enviar", não "subir": o público de 60 anos conhece a
                    palavra do e-mail/WhatsApp — "subir" é gíria nossa. */}
                {enviando === cartao.pasta ? (
                  traduzir('Enviando…', 'Uploading…')
                ) : (
                  <>
                    <Icone nome="subir" tamanho={15} /> {traduzir('Enviar arquivos', 'Upload files')}
                  </>
                )}
                <input
                  type="file"
                  multiple
                  hidden
                  disabled={enviando !== null}
                  onChange={(e) => {
                    enviarMateriais(cartao.pasta, e.target.files)
                    e.target.value = '' // subir o MESMO arquivo de novo tem que disparar
                  }}
                />
              </label>
            </div>
          ))}
        </div>
      </section>
      )}

      {/* Os apresentadores dos vídeos (foto + voz). Só em prédio de marca: é
          o mesmo acervo — e quando o Acervo é porta própria, eles moram lá
          (aba Pessoas), não aqui. */}
      {acervoDeMarca && !acervoSeparado && <PortaVozes orgId={orgId} slug={slug} />}

      {/* "Revisar o que eu aprendi" só faz sentido quando HÁ o que revisar —
          numa org zerada era a primeira ação da tela e a única que não podia
          dar em nada (gasta uma rodada e devolve proposta vazia). */}
      {tarefasOferecidas.length > 0 && (
        <section className="sabe-bloco">
          <header className="sabe-bloco-topo">
            <div>
              <h3>{traduzir('Quer que eu aprenda mais?', 'Want me to learn more?')}</h3>
              <p className="texto-suave">
                {traduzir('Eu faço o trabalho e te mostro a proposta — nada entra aqui sem o seu OK.', 'I do the work and show you the proposal — nothing is added without your approval.')}
              </p>
            </div>
          </header>
          <ul className="sabe-lista">
            {tarefasOferecidas.map((t) => (
              <li key={t.chave} className="sabe-card">
                <strong className="sabe-card-titulo">{t.titulo}</strong>
                <p className="texto-suave">{t.descricao}</p>
                <button
                  type="button"
                  className="botao botao-primario"
                  disabled={disparando !== null}
                  onClick={() => rodarTarefa(t)}
                >
                  {disparando === t.chave ? traduzir('Começando…', 'Starting…') : traduzir('Pode começar', 'Start now')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Bloco
        titulo={traduzir('Regras que você me deu', 'Rules you gave me')}
        explicacao={traduzir('Valem sempre, em todo trabalho — são a sua lei aqui dentro.', 'These apply to every task — they are your standing rules.')}
      >
        {secoes.length === 0 ? (
          <div className="sabe-vazio sabe-vazio--estante">
            {/* A estante no traço da casa (24-grid escalado, stroke 1.7, objetos
                — nunca pessoas): o estado vazio ilustrado do redesign ago/2026. */}
            <svg
              className="sabe-estante"
              viewBox="0 0 48 48"
              width="72"
              height="72"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="8" y="6" width="32" height="34" rx="2" />
              <path d="M8 24h32" />
              <rect x="13" y="30.5" width="4.5" height="9.5" rx="0.8" />
              <path d="M21 40 26.5 31.8 29.4 33.7 24 41.8" />
            </svg>
            <p className="sabe-vazio-titulo">{traduzir('A estante ainda está vazia.', 'The shelf is still empty.')}</p>
            <p>
              {traduzir('Você ainda não me deu nenhuma regra. Me diga na conversa uma coisa que eu nunca posso fazer — por exemplo:', 'You have not given me any rules yet. Tell me in the chat something I must never do, for example:')} <em>{traduzir('“nunca use emoji nos posts”', '“never use emoji in posts”')}</em> {traduzir('— que eu passo a respeitar em tudo.', '— and I will apply it to all work.')}
            </p>
            {aoPerguntar && (
              <button
                type="button"
                className="botao botao-primario"
                onClick={() => aoPerguntar('Quero te dar uma regra que você nunca pode quebrar: ')}
              >
                {traduzir('Escrever a primeira regra', 'Write the first rule')}
              </button>
            )}
          </div>
        ) : (
          <ul className="sabe-lista">
            {secoes.map((s, i) => (
              <li key={i} className="sabe-card">
                {s.titulo && <strong className="sabe-card-titulo">{s.titulo}</strong>}
                <ul className="sabe-regras">
                  {s.linhas.map((linha, j) => (
                    <li key={j}>{linha}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Bloco>

      {/* Só aparece quando ALGUMA regra já foi trocada — numa org nova este
          bloco seria uma caixa vazia explicando um conceito que a pessoa
          ainda não viveu. */}
      {substituicoes.length > 0 && (
        <section className="sabe-bloco">
          <header className="sabe-bloco-topo">
            <div>
              <h3>{traduzir('Regras que mudaram', 'Rules that changed')}</h3>
              <p className="texto-suave">
                {traduzir('Quando você muda de ideia, a regra antiga sai e a nova fica no lugar dela. O que saiu fica aqui — para você lembrar por que mudou.', 'When you change your mind, the new rule replaces the old one. Previous rules stay here so you can see what changed.')}
              </p>
            </div>
          </header>
          <ul className="sabe-lista">
            {substituicoes.map((s, i) => (
              <li key={i} className="sabe-card">
                <span className="sabe-trocada">
                  <s>{s.regra_revogada}</s>
                </span>
                <span className="sabe-vigente">
                  <strong>{traduzir('Agora vale:', 'Current rule:')}</strong> {s.regra_vigente}
                </span>
                {dataCurta(s.quando, idioma) && (
                  <small className="texto-suave">{traduzir('mudou em', 'changed on')} {dataCurta(s.quando, idioma)}</small>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Bloco
        titulo={traduzir('O que eu aprendi com você', 'What I learned from you')}
        explicacao={traduzir('Cada vez que você aprova ou pede ajuste, eu guardo a lição aqui.', 'When you approve or request changes, I save the lesson here.')}
      >
        {licoes.length === 0 ? (
          <div className="sabe-vazio">
            <p>
              {traduzir('Ainda não aprendi nada por aqui. Quando você aprovar uma entrega e escrever o que ficou bom — ou pedir um ajuste dizendo o porquê — a lição aparece nesta lista.', 'No lessons yet. Approve a deliverable and describe what worked, or explain a change you want, and the lesson appears here.')}
            </p>
          </div>
        ) : (
          <ul className="sabe-lista">
            {licoes.map((l) => (
              <li key={l.indice} className="sabe-card">
                <span
                  className={`status-pill ${
                    l.type === 'exemplar' ? 'status-done' : 'entrega-pendente'
                  }`}
                >
                  {l.type === 'exemplar' ? traduzir('faço sempre', 'always do') : traduzir('nunca faço', 'never do')}
                </span>
                <p className="sabe-motivo">{l.motivo}</p>
                {l.diagnostico && (
                  <p className="sabe-motivo texto-suave" style={{ fontSize: 13 }}>
                    {traduzir('o que eu entendi:', 'what I understood:')} {l.diagnostico}
                  </p>
                )}
                <small className="texto-suave">
                  {l.contexto_resumido ? traduzir(`veio de: ${l.contexto_resumido}`, `from: ${l.contexto_resumido}`) : traduzir('veio de um retorno seu', 'from your feedback')}
                  {l.weight > 1 && traduzir(` · você reforçou ${l.weight} vezes`, ` · reinforced ${l.weight} times`)}
                </small>
              </li>
            ))}
          </ul>
        )}
      </Bloco>

      <Bloco
        titulo={traduzir('Como eu faço cada trabalho', 'How I do each task')}
        explicacao={traduzir('Os trabalhos que eu sei fazer neste escritório, e onde você já ajustou o meu jeito.', 'The work I can do in this office and where you have adjusted my approach.')}
      >
        {atividades.length === 0 ? (
          <div className="sabe-vazio">
            <p>
              {traduzir('Este escritório ainda não tem trabalhos prontos. Me chame na conversa que eu te conto o que já consigo fazer.', 'This office has no ready workflows yet. Ask me in Chat what I can currently do.')}
            </p>
          </div>
        ) : (
          [...porEscopo.entries()].map(([escopo, itens]) => (
            <div key={escopo} className="sabe-grupo">
              <strong className="sabe-grupo-titulo">{escopo}</strong>
              <ul className="sabe-lista">
                {itens.map((a) => (
                  <li key={a.id} className="sabe-card">
                    <strong className="sabe-card-titulo">{a.titulo}</strong>
                    {a.descricao && <p className="texto-suave">{a.descricao}</p>}
                    {a.tem_conhecimento && (
                      <small className="sabe-selo">{traduzir('✓ com ajustes seus para este trabalho', '✓ with your adjustments for this task')}</small>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Bloco>

      {premissas !== null && premissas.trim() !== '' && (
        <Bloco
          titulo={traduzir('O que eu levo em conta em todo trabalho', 'What guides every task')}
          explicacao={traduzir('Os seus objetivos e as suas regras fixas — eu uso sem perguntar de novo.', 'Your objectives and standing rules — I use them without asking again.')}
        >
          {editandoPremissas ? (
            <>
              <textarea
                className="sabe-premissas-edicao"
                aria-label={traduzir('Objetivos e regras deste trabalho', 'Objectives and rules for this work')}
                value={premissasRascunho}
                onChange={(ev) => setPremissasRascunho(ev.target.value)}
                rows={14}
                disabled={salvandoPremissas}
              />
              {erroPremissas && <p className="alerta alerta-erro" role="alert">{erroPremissas}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="botao botao-pequeno"
                  disabled={salvandoPremissas}
                  onClick={async () => {
                    if (!telaAtual() || salvandoPremissas) return
                    leituraRef.current?.abort()
                    setSalvandoPremissas(true)
                    setErroPremissas('')
                    try {
                      await api.put(
                        `/predios/${orgId}/${slug}/conhecimento/premissas`,
                        { conteudo: premissasRascunho },
                      )
                      if (!telaAtual()) return
                      leituraRef.current?.abort()
                      setPremissas(premissasRascunho)
                      setEditandoPremissas(false)
                    } catch (erro) {
                      if (telaAtual()) setErroPremissas(erro instanceof ApiError ? erro.detail : traduzir('Não consegui salvar agora. Seu texto continua aqui para tentar novamente.', 'Could not save right now. Your text is still here so you can try again.'))
                    } finally {
                      if (telaAtual()) setSalvandoPremissas(false)
                    }
                  }}
                >
                  {salvandoPremissas ? traduzir('Salvando…', 'Saving…') : traduzir('Salvar', 'Save')}
                </button>
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  disabled={salvandoPremissas}
                  onClick={() => setEditandoPremissas(false)}
                >
                  {traduzir('Cancelar', 'Cancel')}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Sem os símbolos de markdown (##, **): quem lê é o dono, e para
                  ele marcador cru parece defeito. A EDIÇÃO mostra o arquivo
                  cru de propósito — é o que será gravado. */}
              <pre className="sabe-premissas">
                {premissas.replace(/^#{1,6}\s+/gm, '').replace(/\*\*/g, '')}
              </pre>
              <button
                type="button"
                className="botao botao-fantasma botao-pequeno"
                onClick={() => {
                  setPremissasRascunho(premissas)
                  setErroPremissas('')
                  setEditandoPremissas(true)
                }}
              >
                {traduzir('Preencher / editar', 'Fill in / edit')}
              </button>
            </>
          )}
        </Bloco>
      )}
    </div>
  )
}
