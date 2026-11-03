/** Preparação sem IA para o painel antigo. Reaproveita respostas existentes,
 * pergunta somente lacunas e exige revisão editável antes de guardar.
 * O fluxo principal continua na conversa, preparado pelo consultor. */

import { useEffect, useRef, useState } from 'react'

import { ApiError, api, getSessionIdentity } from '../../lib/api'
import { Icone } from '../Icone'
import { useToasts } from '../Toasts'
import { useIdioma } from '../../lib/i18n'
import { chaveSecaoPerfil, lerSecoesPerfil, type TextosPreparacao } from '../../lib/perfilSabatina'
import { PerfilProposto, type ConfirmacaoPerfil } from './PerfilProposto'

type TextoRoteiro = [string, string]

type Pergunta = {
  /** Título da seção `## ` que a resposta vira no Cânon. */
  secao: string
  secaoEn: string
  pergunta: TextoRoteiro
  /** A linha de baixo: o que a resposta precisa ter para ser útil. */
  ajuda: TextoRoteiro
  placeholder: TextoRoteiro
  /** O que o escritório diz ao RECEBER a resposta desta pergunta, antes da
   *  próxima. Frase FIXA do roteiro — reconhece sem fingir que analisou. */
  recibo: TextoRoteiro
}

const PERGUNTAS_BASE: Pergunta[] = [
  {
    secao: 'O que a empresa faz',
    secaoEn: 'What the company does',
    pergunta: ['Pra começar: o que a sua empresa faz?', 'To start: what does your company do?'],
    ajuda: ['Me conte como você contaria a um cliente novo. Pode escrever do seu jeito, sem capricho.', 'Explain it as you would to a new client. Write naturally — it does not need to be polished.'],
    placeholder: ['Ex.: somos uma confeitaria artesanal que entrega bolos sob encomenda…', 'E.g. we are an artisan bakery delivering made-to-order cakes…'],
    recibo: ['Anotei a sua descrição.', 'I have noted your description.'],
  },
  {
    secao: 'Produto ou serviço principal',
    secaoEn: 'Main product or service',
    pergunta: ['Qual serviço, produto ou trabalho é prioridade hoje?', 'Which service, product or type of work is your priority right now?'],
    ajuda: ['Pode ser um serviço, produto ou tipo de trabalho. Não precisa ter preço definido.', 'This can be a service, product or type of work. You do not need to have a price set.'],
    placeholder: ['Ex.: consultas online, bolos por encomenda ou revisão de documentos…', 'E.g. online appointments, made-to-order cakes or document reviews…'],
    recibo: ['Anotei.', 'Noted.'],
  },
  {
    secao: 'Quem é o cliente',
    secaoEn: 'Who the customer is',
    pergunta: ['Para quem é o seu trabalho?', 'Who is your work for?'],
    ajuda: ['Idade, região, como ele chega até você. Quanto mais concreto, melhor eu escrevo.', 'Age, location and how they find you. Specific details help me write better.'],
    placeholder: ['Ex.: mães organizando aniversário de filho, na região de Campinas…', 'E.g. parents organizing children’s birthday parties in Campinas…'],
    recibo: ['Isso me ajuda a escrever para a pessoa certa.', 'That helps me write for the right audience.'],
  },
  {
    secao: 'Tom de voz',
    secaoEn: 'Tone of voice',
    pergunta: ['Como você gosta de falar com o cliente?', 'How do you like to speak to customers?'],
    ajuda: ['Mais formal, mais leve, técnico, divertido? Se tiver um texto que soa certo, cole aqui.', 'Formal, relaxed, technical or playful? If you have text that sounds right, paste it here.'],
    placeholder: ['Ex.: leve e acolhedor, sem gíria…', 'E.g. relaxed and welcoming, without slang…'],
    recibo: ['Entendi o jeito de falar.', 'I have noted your preferred tone.'],
  },
  {
    secao: 'Instagram e redes',
    secaoEn: 'Instagram and social media',
    pergunta: ['Sua marca está no Instagram? Cola aqui o @ ou o link do perfil.', 'Is your brand on Instagram? Paste the handle or profile link here.'],
    ajuda:
      ['Pode mandar o site ou outra rede também. Se o perfil não puder ser aberto, seus arquivos e exemplos ajudam.', 'You can send your website or other social profiles too. If a profile cannot be opened, your files and examples help.'],
    placeholder: ['Ex.: @minhamarca ou https://www.instagram.com/minhamarca…', 'E.g. @mybrand or https://www.instagram.com/mybrand…'],
    recibo: ['Anotei o endereço para usar como referência.', 'I have noted the address as a reference.'],
  },
  {
    secao: 'Objetivo do trabalho',
    secaoEn: 'Work goal',
    pergunta: ['O que você quer melhorar com a nossa ajuda?', 'What would you like our help to improve?'],
    ajuda: ['Por exemplo: divulgar seu trabalho, explicar melhor um serviço ou organizar o dia a dia. Pode dizer que ainda não sabe.', 'For example: promote your work, explain a service better or organize your day. It is fine if you do not know yet.'],
    placeholder: ['Ex.: quero mostrar como funciona a primeira consulta…', 'E.g. I want to show how the first appointment works…'],
    recibo: ['Anotei o que importa agora.', 'I have noted what matters right now.'],
  },
  {
    secao: 'Exemplos e referências',
    secaoEn: 'Examples and references',
    pergunta: ['Tem algum trabalho que você gosta — e algum que não combina com você?', 'Is there any work you like — or anything that does not feel like you?'],
    ajuda: ['Pode colar um link, mandar um arquivo ou explicar com suas palavras. Diga o que gostou ou não: texto, foto, cores, organização.', 'You can paste a link, send a file or explain in your own words. Say what you liked or disliked: wording, photography, colors or layout.'],
    placeholder: ['Ex.: gosto de fotos reais e textos diretos. Não gosto de frases prontas…', 'E.g. I like real photos and direct wording. I dislike stock phrases…'],
    recibo: ['Anotei seus exemplos.', 'I have noted your examples.'],
  },
  {
    secao: 'O que eu nunca devo fazer',
    secaoEn: 'What I must never do',
    pergunta: ['Existe alguma informação ou regra que precisamos respeitar sempre?', 'Is there any information or rule we should always respect?'],
    ajuda:
      ['Ex.: não expor clientes, não prometer resultados, não inventar preços. Você confere tudo antes de guardar no perfil.', 'E.g. do not expose clients, promise outcomes or invent prices. You will review everything before saving it to the profile.'],
    placeholder: ['Ex.: nunca prometer prazo menor que 5 dias…', 'E.g. never promise delivery in fewer than five days…'],
    recibo: ['Anotei para você conferir.', 'I have noted this for you to review.'],
  },
]

/** A pergunta do Instagram só entra onde alguém CONSOME a resposta: a skill
 *  ler-instagram mora no pacote do office conteudo — perguntar o @ num andar
 *  sem ela seria prometer um estudo de perfil que nenhuma tarefa daquele
 *  escritório faz. (O backend aplica o MESMO gate no roteiro da sabatina com
 *  IA, mecanicamente, pela presença da skill no pacote do office.) */
function perguntasDoOffice(slug: string): Pergunta[] {
  if (slug === 'conteudo') return PERGUNTAS_BASE
  return PERGUNTAS_BASE.filter((p) => p.secao !== 'Instagram e redes')
}

function saudacaoPara(temRespostas: boolean): TextoRoteiro {
  return [
    temRespostas ? 'Já temos informações no seu perfil. Vamos completar apenas o que falta; depois você confere e escolhe o que guardar.' : 'Vamos conhecer seu trabalho. Responda do seu jeito; pode pular o que ainda não sabe. No final você confere o que será guardado.',
    temRespostas ? 'We already have information in your profile. Let’s fill in only what is missing; then you review and choose what to save.' : 'Let’s get to know your work. Answer in your own words and skip anything you do not know yet. You will review what gets saved at the end.',
  ]
}

/** O carimbo que a sabatina deixa no Cânon ao concluir. É um comentário HTML
 *  de propósito: o leitor do conhecimento (fatiarCanon) pula comentários, o
 *  dono nunca vê — mas a Visão geral o encontra e para de oferecer o setup.
 *  Não dá para detectar por "cânon vazio": todo office nasce com um cânon
 *  MODELO pré-preenchido, que descreve o escritório, não a empresa do dono. */
export const MARCADOR_SABATINA = '<!-- sabatina: concluída -->'

/** Uma resposta já dada — com a procedência, porque a ficha diz de onde veio. */
type Resposta = { secao: string; texto: string }

function respostasDoCanon(perguntas: Pergunta[], canon: string): Array<Resposta | null> {
  const secoes = lerSecoesPerfil(canon)
  return perguntas.map(pergunta => {
    const texto = secoes.get(chaveSecaoPerfil(pergunta.secao))
    if (!texto || /\[(?:preencher|nome da|descrever)|^\s*[-*]?\s*(?:a definir|pendente|não informado|não sei|preencher|ex\.:)/i.test(texto)) return null
    return { secao: pergunta.secao, texto: texto.replace(/^[-*]\s+/gm, '') }
  })
}

/** Um balão do fio. `pergunta` marca o balão que faz a pergunta N — é nele
 *  que a linha de ajuda aparece, em corpo menor. */
type Balao = {
  de: 'ia' | 'dono'
  texto: string | TextoRoteiro
  ajuda?: TextoRoteiro
}

/** Um arquivo que o dono acabou de mandar. `legenda` e `tags` chegam DEPOIS:
 *  a catalogação roda em thread própria no backend (ingestao_automatica) e só
 *  existe se a organização tem chave de IA. Por isso o estado 'sem-legenda'
 *  é um desfecho legítimo, e não um carregando eterno. */
type Enviado = {
  nome: string
  estado: 'enviando' | 'lendo' | 'catalogado' | 'sem-legenda' | 'erro'
  legenda?: string
  tags?: string[]
  erro?: string
}

/** Quantas vezes perguntar ao backend se a legenda já saiu, e de quanto em
 *  quanto tempo. Seis tentativas a 2,5s cobrem o caso comum (Haiku em imagem
 *  ou PDF curto) sem deixar a tela girando para sempre quando a org não tem
 *  chave — aí o arquivo termina em 'sem-legenda', que a tela explica. */
const TENTATIVAS_LEGENDA = 6
const INTERVALO_LEGENDA = 2500

/** O instante de "digitando" antes de cada balão do escritório. Curto de
 *  propósito: é ritmo de conversa, não teatro de espera. */
const PAUSA_DIGITANDO = 650

export function SetupSabatina({
  orgId,
  slug,
  canonAtual,
  aoConcluir,
  aoFechar,
  aoConversar,
  aoMaterialNovo,
  aoIniciar,
}: {
  orgId: number
  slug: string
  /** O cânon preparado até aqui. Somente as seções revisadas serão atualizadas. */
  canonAtual: string
  /** Chamado quando algo mudou de verdade (cânon salvo ou documento subido). */
  aoConcluir: () => void
  /** Só avisa que CHEGOU material — sem concluir o setup. */
  aoMaterialNovo?: () => void
  /** Preserva a entrevista em curso quando o acervo é atualizado. */
  aoIniciar?: () => void
  /** O dono LEU a despedida e quer ver o painel. Existe separado de
   *  `aoConcluir` porque gravar o cânon derruba `setupPendente` na hora: sem
   *  este segundo tempo, a tela trocaria no meio da frase e o momento em que o
   *  escritório passa a conhecer a empresa — o único que este fluxo tem — seria
   *  o único que ninguém vê. */
  aoFechar: () => void
  /** SABATINA COM IA: leva à aba Conversar, onde a entrevista acontece no
   *  chat (a IA pergunta aos poucos, analisa exemplos e propõe o cânon com
   *  um clique). O fio roteirizado continua para quem quer o rápido. */
  aoConversar?: (dados?: TextosPreparacao) => void
}) {
  const { t: traduzir } = useIdioma()
  /** O roteiro DESTE andar (estável no mount — slug não muda no meio). */
  const perguntas = perguntasDoOffice(slug)
  const [baloes, setBaloes] = useState<Balao[]>([])
  const [digitando, setDigitando] = useState(false)
  /** A pergunta que o composer responde AGORA. null = fio ocupado ou fim. */
  const [alvo, setAlvo] = useState<number | null>(null)
  /** true quando o alvo é uma CORREÇÃO (veio do clique na ficha): depois de
   *  responder, o fio volta para onde estava — sem repetir as já feitas. */
  const [corrigindo, setCorrigindo] = useState(false)
  const [resposta, setResposta] = useState('')
  const [respostas, setRespostas] = useState<Array<Resposta | null>>(
    () => respostasDoCanon(perguntas, canonAtual),
  )
  const iniciaisRef = useRef(respostas)
  const informadasRef = useRef(new Map<string, string>())
  const [revisando, setRevisando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [terminada, setTerminada] = useState(false)
  const [enviados, setEnviados] = useState<Enviado[]>([])
  const [enviandoDocs, setEnviandoDocs] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const campoRef = useRef<HTMLTextAreaElement | null>(null)
  const fioRef = useRef<HTMLDivElement | null>(null)
  const vivoRef = useRef(true)
  const timersRef = useRef<number[]>([])
  const permitirFocoRef = useRef(true)
  const origemFocoRef = useRef<Element | null>(null)
  /** De onde o fio RETOMA depois de uma correção: a pergunta que estava em pé
   *  quando o dono clicou na ficha. Sem isto, a retomada recomeçava do zero e
   *  reoferecia pergunta que ele tinha PULADO de propósito. */
  const retomarDeRef = useRef<number>(0)
  const { sucesso, falha } = useToasts()

  useEffect(() => {
    // Religa no mount: o StrictMode do dev monta→desmonta→monta o MESMO
    // componente, e sem esta linha o segundo mount nasceria com vivo=false —
    // os timeouts do fio publicariam no vazio e a saudação nunca apareceria.
    vivoRef.current = true
    return () => {
      vivoRef.current = false
      timersRef.current.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  useEffect(() => {
    // A pergunta chega depois: uma ação já escolhida pela pessoa tem prioridade,
    // inclusive clique em área que não recebe foco (ou que abre o seletor nativo).
    const respeitarEscolha = () => { permitirFocoRef.current = false }
    document.addEventListener('pointerdown', respeitarEscolha, true)
    document.addEventListener('click', respeitarEscolha, true)
    document.addEventListener('keydown', respeitarEscolha, true)
    return () => {
      document.removeEventListener('pointerdown', respeitarEscolha, true)
      document.removeEventListener('click', respeitarEscolha, true)
      document.removeEventListener('keydown', respeitarEscolha, true)
    }
  }, [])

  /** Fala como quem digita: liga o indicador, espera um instante, publica o
   *  balão. `depois` roda junto com a publicação (é como o fio avança). */
  function falar(baloesNovos: Balao[], depois?: () => void) {
    setDigitando(true)
    const t = window.setTimeout(() => {
      if (!vivoRef.current) return
      setDigitando(false)
      setBaloes((prev) => [...prev, ...baloesNovos])
      depois?.()
    }, PAUSA_DIGITANDO)
    timersRef.current.push(t)
  }

  // A abertura: saudação + primeira pergunta, como duas mensagens.
  useEffect(() => {
    falar([{ de: 'ia', texto: saudacaoPara(respostas.some(Boolean)) }], () => {
      avancar(respostas, -1, ['Vamos lá.', 'Let’s begin.'])
    })
    // roda UMA vez — o fio nasce com a tela
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Devolve a palavra sem retirar o foco do anexo ou de outra ação da tela.
  useEffect(() => {
    if (alvo === null || terminada) return
    const ativo = document.activeElement
    if (ativo === campoRef.current || (permitirFocoRef.current && (ativo === document.body || ativo === origemFocoRef.current))) {
      campoRef.current?.focus()
    }
    permitirFocoRef.current = false
    origemFocoRef.current = null
  }, [alvo, terminada])

  function devolverFoco() {
    permitirFocoRef.current = true
    origemFocoRef.current = document.activeElement
  }

  function continuarNaConversa(revisadas?: Resposta[]) {
    if (!vivoRef.current || !aoConversar) return
    const informadas = new Map(informadasRef.current)
    let pendente: string | null = null
    if (!revisadas && corrigindo && alvo !== null) {
      // Reabrir uma resposta só a exibe. Uma edição substitui sua seção;
      // não transforma o prefill do cânon em informação nova nem o duplica.
      if (resposta.trim() !== respostas[alvo]?.texto.trim()) {
        if (resposta.trim()) informadas.set(perguntas[alvo].secao, resposta)
        else informadas.delete(perguntas[alvo].secao)
      }
    } else if (!revisadas && resposta.trim()) pendente = resposta
    const textos = revisadas
      ? revisadas.filter(r => informadasRef.current.has(r.secao)
        || r.texto !== iniciaisRef.current.find(inicial => inicial?.secao === r.secao)?.texto).map(r => r.texto).filter(texto => texto.trim())
      : [...informadas.values(), ...(pendente ? [pendente] : [])]
    aoConversar(textos.length ? { textos } : undefined)
  }

  // O fio rola sozinho para a última mensagem — conversa que não rola obriga
  // o dono a caçar a pergunta.
  useEffect(() => {
    const fio = fioRef.current
    if (fio) fio.scrollTop = fio.scrollHeight
  }, [baloes, digitando])

  async function salvar(confirmacao: ConfirmacaoPerfil) {
    setSalvando(true)
    try {
      await api.post(`/predios/${orgId}/${slug}/conhecimento/canon/confirmar`, confirmacao)
      if (!vivoRef.current) return
      setRevisando(false)
      setTerminada(true)
      falar([
        {
          de: 'ia',
          texto:
            ['Perfil atualizado. Pode pedir o primeiro trabalho com suas palavras e ajustar essas informações quando quiser.', 'Profile updated. You can request your first task in your own words and change this information whenever you like.'],
        },
      ])
      sucesso(traduzir('Perfil atualizado com as informações confirmadas.', 'Profile updated with confirmed information.'))
      aoConcluir()
    } finally {
      if (vivoRef.current) setSalvando(false)
    }
  }

  /** O fio avança: reconhece o que acabou de acontecer (`recibo`), pergunta
   * a próxima lacuna ou abre a revisão. Nunca grava ao receber uma resposta. */
  function avancar(todas: Array<Resposta | null>, indiceRespondido: number, recibo: TextoRoteiro) {
    let proximo = indiceRespondido + 1
    while (proximo < perguntas.length && todas[proximo]) proximo += 1

    if (proximo < perguntas.length) {
      const p = perguntas[proximo]
      falar(
        [{ de: 'ia', texto: [`${recibo[0]} ${p.pergunta[0]}`, `${recibo[1]} ${p.pergunta[1]}`], ajuda: p.ajuda }],
        () => setAlvo(proximo),
      )
      return
    }

    // Acabaram as perguntas: o desfecho depende do que existe.
    if (todas.some(Boolean)) {
      falar([{ de: 'ia', texto: ['Confira o resumo abaixo. Você pode editar ou retirar informações antes de guardar.', 'Review the summary below. You can edit or remove information before saving.'] }], () => setRevisando(true))
    } else if (enviados.some((e) => e.estado !== 'erro')) {
      setTerminada(true)
      falar([
        {
          de: 'ia',
          texto:
            ['Os arquivos foram recebidos. Pode começar pelo que precisa; vamos conferir o material e completar só o que faltar para esse pedido.', 'Your files were received. Start with what you need; we will check the material and fill in only what is missing for that request.'],
        },
      ])
      aoConcluir()
    } else {
      setTerminada(true)
      falar([
        {
          de: 'ia',
          texto:
            ['Tudo bem. Comece pelo trabalho que precisa; completamos as informações quando fizerem falta.', 'That is fine. Start with the work you need; we will fill in information when it is needed.'],
        },
      ])
    }
  }

  function responder() {
    const texto = resposta.trim()
    if (!texto || alvo === null || salvando) return
    aoIniciar?.()
    if (/^(?:não sei|nao sei|ainda não sei|ainda nao sei|pode escolher|você decide|voce decide|não tenho certeza|i don.t know|you choose)[.!]?$/i.test(texto)) { pular(); return }
    devolverFoco()
    const n = alvo
    const todas = [...respostas]
    todas[n] = { secao: perguntas[n].secao, texto }
    informadasRef.current.set(perguntas[n].secao, texto)
    setRespostas(todas)
    setResposta('')
    setAlvo(null)
    setBaloes((prev) => [...prev, { de: 'dono', texto }])

    const recibo: TextoRoteiro = corrigindo ? ['Troquei.', 'Updated.'] : perguntas[n].recibo
    const base = corrigindo ? retomarDeRef.current - 1 : n
    setCorrigindo(false)
    avancar(todas, base, recibo)
  }

  function pular() {
    if (alvo === null || salvando) return
    aoIniciar?.()
    if (corrigindo) { manterComoEsta(); return }
    devolverFoco()
    const n = alvo
    setAlvo(null)
    setResposta('')
    setBaloes((prev) => [...prev, { de: 'dono', texto: ['Ainda não sei. Podemos deixar para depois.', 'I do not know yet. We can leave this for later.'] }])
    avancar([...respostas], n, ['Tudo bem. Não vou guardar uma suposição no seu perfil.', 'That is fine. I will not save a guess to your profile.'])
  }

  /** A saída de uma correção aberta sem querer: nada muda, o fio segue. */
  function manterComoEsta() {
    if (alvo === null || salvando || !corrigindo) return
    devolverFoco()
    setAlvo(null)
    setResposta('')
    setCorrigindo(false)
    setBaloes((prev) => [...prev, { de: 'dono', texto: ['Deixa como estava.', 'Keep it as it was.'] }])
    avancar([...respostas], retomarDeRef.current - 1, ['Fechado, fica como estava.', 'All right, keeping the previous answer.'])
  }

  /** Corrigir pela ficha: o escritório reabre a pergunta NO FIO, e o texto
   *  antigo volta ao composer — corrigir é editar, não redigitar. */
  function reabrir(n: number) {
    if (salvando || terminada || digitando) return
    aoIniciar?.()
    devolverFoco()
    // A pergunta em pé AGORA é para onde o fio volta depois. Sem pergunta em
    // pé (fio no fim), retoma do fim e apresenta novamente a revisão.
    if (!corrigindo) retomarDeRef.current = alvo ?? perguntas.length
    setRevisando(false)
    falar(
      [
        {
          de: 'ia',
          texto: [`Quer ajustar "${perguntas[n].secao}"? Me manda como fica — eu troco.`, `Would you like to adjust "${perguntas[n].secaoEn}"? Send the updated answer and I will replace it.`],
        },
      ],
      () => {
        setAlvo(n)
        setCorrigindo(true)
        setResposta(respostas[n]?.texto ?? '')
      },
    )
  }

  /** Pergunta ao backend se a catalogação já escreveu a legenda deste arquivo.
   *  A ingestão é fire-and-forget do lado de lá; aqui a tela só observa. */
  async function observarLegenda(nome: string) {
    for (let i = 0; i < TENTATIVAS_LEGENDA; i++) {
      await new Promise((r) => setTimeout(r, INTERVALO_LEGENDA))
      if (!vivoRef.current) return
      try {
        const r = await api.get<{ entrada?: Array<{ nome: string; legenda?: string | null; tags?: string[] }> }>(
          `/predios/${orgId}/${slug}/arquivos`,
        )
        const achado = (r?.entrada ?? []).find((a) => a.nome === nome)
        if (achado?.legenda) {
          if (!vivoRef.current) return
          setEnviados((prev) =>
            prev.map((e) =>
              e.nome === nome
                ? { ...e, estado: 'catalogado', legenda: achado.legenda ?? '', tags: achado.tags ?? [] }
                : e,
            ),
          )
          return
        }
      } catch {
        /* rede instável não é motivo para dizer que a catalogação falhou */
      }
    }
    if (!vivoRef.current) return
    setEnviados((prev) =>
      prev.map((e) => (e.nome === nome && e.estado === 'lendo' ? { ...e, estado: 'sem-legenda' } : e)),
    )
  }

  /** A outra porta do setup: subir documentos em vez de descrever. Mesmo
   *  balcão de sempre (entrada/) — o que cai aqui é lido em toda tarefa, e
   *  dispara a catalogação automática no backend. */
  async function enviarDocumentos(lista: FileList | File[] | null) {
    const arquivos = Array.from(lista ?? [])
    const sessao = getSessionIdentity()
    const envioVigente = () => vivoRef.current && getSessionIdentity() === sessao
    if (!arquivos.length || !envioVigente()) return
    setEnviandoDocs(true)
    setEnviados((prev) => [
      ...prev,
      ...arquivos.map((a) => ({ nome: a.name, estado: 'enviando' as const })),
    ])
    for (const arquivo of arquivos) {
      // Uma mudança de tela ou conta encerra a intenção do lote. A resposta
      // do arquivo em trânsito pode se perder; não repetir nem apagar esse envio.
      if (!envioVigente()) return
      try {
        const fd = new FormData()
        fd.append('arquivo', arquivo)
        const r = await api.postForm<{ nome: string }>(
          `/predios/${orgId}/${slug}/arquivos?pasta=entrada`,
          fd,
        )
        if (!envioVigente()) return
        // O backend sanitiza o nome — a tela precisa observar o nome GRAVADO,
        // senão a legenda nunca casa com a linha.
        const gravado = r?.nome ?? arquivo.name
        setEnviados((prev) =>
          prev.map((e) =>
            e.nome === arquivo.name ? { ...e, nome: gravado, estado: 'lendo' } : e,
          ),
        )
        void observarLegenda(gravado)
      } catch (e) {
        if (!envioVigente()) return
        const msg =
          e instanceof ApiError ? e.detail : traduzir(`Não consegui receber “${arquivo.name}”.`, `Could not receive “${arquivo.name}”.`)
        setEnviados((prev) =>
          prev.map((x) => (x.nome === arquivo.name ? { ...x, estado: 'erro', erro: msg } : x)),
        )
        falha(msg)
      }
    }
    if (!envioVigente()) return
    setEnviandoDocs(false)
    // NÃO chamar aoConcluir() aqui (bug pego na revisão de 16/08): ele acende
    // o `setupConcluido` do painel, que é justamente o flag que MANTÉM a
    // sabatina na tela até o dono clicar "Ver o meu escritório" — e esse botão
    // só existe depois de a entrevista terminar. Mandar um arquivo no meio das
    // perguntas prendia a pessoa aqui, com o "deixar para depois" já escondido.
    // O upload não conclui o setup; ele alimenta o acervo.
    aoMaterialNovo?.()
  }

  const atual = alvo !== null ? perguntas[alvo] : null

  return (
    <section className="sab" aria-label={traduzir('Apresentar a sua empresa', 'Introduce your company')}>
      <header className="sab-topo">
        <span className="sab-selo">{traduzir('Seu perfil', 'Your profile')}</span>
      </header>

      <div className="sab-grid">
        <div className="sab-esq sab-conversa">
          <div className="sab-fio" ref={fioRef} aria-live="polite">
            {baloes.map((b, i) => (
              <div key={i} className={`sab-balao sab-balao-${b.de}`}>
                <p>{typeof b.texto === 'string' ? b.texto : traduzir(...b.texto)}</p>
                {b.ajuda && <p className="sab-balao-ajuda">{traduzir(...b.ajuda)}</p>}
              </div>
            ))}
            {digitando && (
              <div className="sab-balao sab-balao-ia sab-digitando" aria-label={traduzir('escrevendo…', 'typing…')}>
                <span />
                <span />
                <span />
              </div>
            )}
            {terminada && !digitando && (
              <div className="sab-fim-acao">
                <button type="button" className="botao botao-primario" onClick={aoFechar}>
                  {traduzir('Ver o meu escritório', 'View my office')}
                </button>
              </div>
            )}
          </div>

          {revisando && <PerfilProposto proposta={{ tipo: 'canon', resumo: traduzir('Informações para orientar os próximos trabalhos.', 'Information to guide future work.'), secoes: respostas.filter((r): r is Resposta => r !== null).map(r => ({ secao: r.secao, conteudo: r.texto })) }}
            canonUrl={`/predios/${orgId}/${slug}/conhecimento/canon`} podeSalvar salvando={salvando} aoConfirmar={salvar}
            aoContinuar={aoConversar ? secoes => continuarNaConversa(secoes.map(s => ({ secao: s.secao, texto: s.conteudo }))) : aoFechar} />}
          {!terminada && !revisando && (
            <div className="sab-composer">
              <textarea
                ref={campoRef}
                className="sab-campo sab-campo-chat"
                value={resposta}
                onChange={(e) => {
                  if (e.target.value.trim()) aoIniciar?.()
                  setResposta(e.target.value)
                }}
                onKeyDown={(e) => {
                  // Enter envia; Shift+Enter quebra linha — o padrão do chat
                  // que a aba Conversar já ensinou.
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    responder()
                  }
                }}
                placeholder={atual ? traduzir(...atual.placeholder) : traduzir('um instante…', 'one moment…')}
                rows={2}
                aria-label={atual ? traduzir(...atual.pergunta) : traduzir('Sua resposta', 'Your answer')}
                disabled={salvando || alvo === null}
              />
              <div className="sab-acoes">
                <button
                  type="button"
                  className="botao botao-primario"
                  disabled={!resposta.trim() || salvando || alvo === null}
                  onClick={responder}
                >
                  {salvando ? traduzir('Guardando…', 'Saving…') : traduzir('Enviar', 'Send')}
                </button>
                {corrigindo ? (
                  <button
                    type="button"
                    className="botao botao-fantasma botao-pequeno"
                    disabled={salvando || alvo === null}
                    onClick={manterComoEsta}
                  >
                    {traduzir('Deixar como está', 'Keep as is')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="botao botao-fantasma botao-pequeno"
                    disabled={salvando || alvo === null}
                    onClick={pular}
                  >
                    {traduzir('Não sei / deixar para depois', 'Not sure / leave for later')}
                  </button>
                )}
                <span className="sab-dica">{traduzir('Enter envia · Shift+Enter quebra linha', 'Enter to send · Shift+Enter for a new line')}</span>
              </div>
            </div>
          )}
        </div>

        <aside className="sab-dir">
          {!revisando && <section>
            <p className="sab-secao">{traduzir('Seu perfil em preparação', 'Your profile in progress')}</p>
            <ul className="sab-ficha">
              {perguntas.map((p, n) => {
                const r = respostas[n]
                const estado = r ? 'ok' : n === alvo && !terminada ? 'agora' : 'pendente'
                return (
                  <li key={p.secao} className={estado}>
                    {estado === 'pendente' ? (
                      /* Não há círculo vazio no set de ícones, e chave
                         desconhecida sai como TEXTO no <Icone> — o marcador do
                         item que ainda não chegou é desenho, não glifo. */
                      <span className="sab-ficha-marca sab-ficha-ponto" aria-hidden="true" />
                    ) : (
                      <Icone
                        className="sab-ficha-marca"
                        nome={estado === 'ok' ? 'visto' : 'lapis'}
                        tamanho={17}
                      />
                    )}
                    <span className="sab-ficha-txt">
                      <span className="sab-ficha-rot">{traduzir(p.secao, p.secaoEn)}</span>
                      {r ? (
                        <button
                          type="button"
                          className="sab-ficha-val"
                          title={traduzir('Corrigir esta resposta', 'Correct this answer')}
                          onClick={() => reabrir(n)}
                        >
                          {r.texto}
                        </button>
                      ) : n === alvo && !terminada ? (
                        <span className="sab-ficha-val vazio">{traduzir('escrevendo agora…', 'writing now…')}</span>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>}

          <section className="sab-envio">
            <p className="sab-secao">{traduzir('Ou me mande os seus arquivos', 'Or send me your files')}</p>
            <label
              className={`sab-zona${arrastando ? ' sobre' : ''}`}
              aria-busy={enviandoDocs}
              onDragOver={(e) => {
                e.preventDefault()
                setArrastando(true)
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(e) => {
                e.preventDefault()
                setArrastando(false)
                void enviarDocumentos(e.dataTransfer?.files ?? null)
              }}
            >
              <Icone nome="anexo" tamanho={24} />
              <strong>{enviandoDocs ? traduzir('Enviando…', 'Uploading…') : traduzir('Arraste aqui — ou clique para escolher', 'Drop files here — or click to choose')}</strong>
              <span>
                {traduzir('Catálogo, apresentação, textos do site, fotos ou exemplos de trabalhos. Enviar um arquivo não confirma automaticamente os fatos que ele contém.', 'Catalogs, presentations, website copy, photos or examples of work. Uploading a file does not automatically confirm the facts it contains.')}
              </span>
              <input
                type="file"
                multiple
                className="sr-only"
                aria-label={traduzir('Escolher arquivos da empresa', 'Choose company files')}
                disabled={enviandoDocs}
                onChange={(e) => {
                  void enviarDocumentos(e.target.files)
                  e.target.value = '' // reenviar o MESMO arquivo tem que disparar
                }}
              />
            </label>

            {enviados.length > 0 && (
              <ul className="sab-fila">
                {enviados.map((a) => (
                  <li key={a.nome} className={`sab-item sab-${a.estado}`}>
                    <Icone nome="arq-documento" tamanho={17} className="sab-item-icone" />
                    <div className="sab-item-dados">
                      {a.estado === 'catalogado' && a.legenda ? (
                        <>
                          <p className="sab-item-legenda">{a.legenda}</p>
                          {a.tags && a.tags.length > 0 && (
                            <span className="sab-item-tags">
                              {a.tags.map((t) => (
                                <span key={t} className="sab-tag">
                                  {t}
                                </span>
                              ))}
                            </span>
                          )}
                        </>
                      ) : (
                        <p className="sab-item-legenda texto-suave">
                          {a.estado === 'enviando' && traduzir('enviando…', 'uploading…')}
                          {a.estado === 'lendo' && traduzir('recebi — estou abrindo para ver o que é…', 'received — opening it to identify its contents…')}
                          {a.estado === 'sem-legenda' &&
                            traduzir('guardado, ainda sem descrição.', 'saved, without a description yet.')}
                          {a.estado === 'erro' && (a.erro ?? traduzir('não consegui receber', 'could not receive file'))}
                        </p>
                      )}
                      <span className="sab-item-nome">{a.nome}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <footer className="sab-rodape">
        {aoConversar && !terminada && !revisando && (
          <button type="button" className="sab-porta" onClick={() => continuarNaConversa()}>
            <Icone nome="conversa" tamanho={16} /> {traduzir('Prefiro começar pelo meu pedido', 'I would rather start with my request')}
          </button>
        )}
      </footer>
    </section>
  )
}
