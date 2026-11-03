import { useTextoLanding } from '../lib/i18nLanding'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LogoMark } from '../components/LogoMark'
import { AssinaturaAdama } from '../components/AssinaturaAdama'
import { Icone } from '../components/Icone'
import { LandingSolucoes } from '../components/LandingSolucoes'
import { CampanhaDemonstracao } from '../components/CampanhaDemonstracao'
import { SeletorIdioma } from '../components/SeletorIdioma'
import { DownloadsMac } from '../components/DownloadsMac'
import { DownloadsWindowsZIP } from '../components/DownloadsWindowsZIP'
import { ehDesktop } from '../lib/desktop'
import { getAccessToken } from '../lib/api'
import {
  CONTATO_EMAIL,
  CONTATO_WHATSAPP_DISPLAY,
  mailtoLink,
  temContato,
  temEmail,
  temWhatsapp,
  whatsappLink,
} from '../lib/contato'
import '../styles/landing.css'

/* ------------------------------------------------------------------
   A landing apresenta o trabalho: conversa, insumos, produção e revisão.
   Instrument Sans, azul para a ação e coral quando precisa da pessoa.
   Os exemplos visuais demonstram fluxos; não são entregas de clientes.
   O modelo comercial continua serviço preparado por um consultor.

   Com `prefers-reduced-motion` TUDO congela no estado final e informativo
   (a mesa mostra a entrega + aprovação; as cenas ficam completas).
   ------------------------------------------------------------------ */

const semMovimento = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** As quatro cantoneiras de mira dos painéis de máquina. */
function Cantos() {
  return (
    <>
      <span className="lp-canto lp-canto--te" aria-hidden="true" />
      <span className="lp-canto lp-canto--td" aria-hidden="true" />
      <span className="lp-canto lp-canto--be" aria-hidden="true" />
      <span className="lp-canto lp-canto--bd" aria-hidden="true" />
    </>
  )
}

/** O herói mostra O PRODUTO DE HOJE: uma miniatura fiel da Mesa — o dono
 *  pede na conversa, a IA declara o PLANO (o que sai do acervo dele, o que
 *  ela gera, o que falta) e NADA renderiza sem o OK. O ciclo real, encenado
 *  em ~13s; com prefers-reduced-motion a cena abre no quadro final. */
const CENAS_DEMO = ['ABERTURA', 'IDENTIDADE', 'TRANSIÇÃO', 'PRODUTO', 'LETREIRO', 'CARTELA']

function MesaMockup() {
  const texto = useTextoLanding()
  const estatico = semMovimento()
  const TOTAL = 6
  const [fase, setFase] = useState(estatico ? 5 : -1)

  useEffect(() => {
    if (estatico) return
    let vivo = true
    const timers: number[] = []
    const t = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
    const avanca = (f: number) => {
      if (!vivo) return
      setFase(f)
      // O ritmo segura onde o produto fala: no plano (2) e no portão (5).
      const espera = [900, 1500, 2100, 1900, 2400, 4600][f] ?? 1500
      t(espera, () => avanca((f + 1) % TOTAL))
    }
    t(600, () => avanca(0))
    return () => {
      vivo = false
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [estatico])

  const em = (f: number) => fase >= f
  // Opacidade INLINE dirigida pelo estado — o herói tem cascata antiga de
  // máquina; classe utilitária aqui já foi engolida uma vez.
  const surge = (ligado: boolean, extra?: CSSProperties): CSSProperties => ({
    opacity: ligado ? 1 : 0,
    transition: 'opacity 420ms ease, transform 420ms ease',
    transform: ligado ? 'none' : 'translateY(6px)',
    ...extra,
  })
  const gerando = fase === 4
  const entregue = fase >= 5

  return (
    <div className="lp-demo-wrap" aria-hidden="true">
      <div className="lp-demo">
        <div className="lp-demo-topo">
          <span className="lp-demo-marca">
            <LogoMark size={16} className="lp-demo-logo" />
            <strong>{texto("Sua marca")}</strong>
            <em>{texto("exemplo de fluxo")}</em>
          </span>
          <span className="lp-demo-agora">{texto("quarta, 16h02 · 26/08")}</span>
        </div>
        <div className="lp-demo-corpo">
          <aside className="lp-demo-rail">
            <div className="lp-demo-rail-topo">
              {texto("Conversas")}{" "}<span className="lp-demo-mais">+</span>
            </div>
            <span className="lp-demo-grupo">{texto("Hoje")}</span>
            <span className={`lp-demo-conversa is-ativa`}>
              <span
                className={`lp-demo-bolinha${gerando ? ' is-trabalhando' : ''}${entregue ? ' is-precisa' : ''}`}
              />
              {texto("Vídeo do lançamento")}</span>
            <span className="lp-demo-conversa">{texto("Pauta da semana")}</span>
            <div className="lp-demo-rail-pe">{texto("Acervo · 45 arquivos")}</div>
          </aside>

          <div className="lp-demo-chat">
            <div className="lp-demo-msg lp-demo-msg--dono" style={surge(em(0))}>
              {texto("Deixa o vídeo do lançamento pronto pra sexta.")}</div>
            <div className="lp-demo-msg lp-demo-msg--ia" style={surge(em(1))}>
              {texto("Montei o plano: 6 cenas — 4 saem do")}{" "}<strong>{texto("seu acervo")}</strong>{texto(", 1 é acervo + IA e só 1 é gerada.")}{" "}<em>{texto("Nada foi gerado ainda")}</em>{texto("; o que falta está marcado ao lado.")}</div>
            <div className="lp-demo-msg lp-demo-msg--ia" style={surge(entregue)}>
              {texto("Entregue — está em")}{" "}<strong>{texto("Entregas")}</strong> {texto("esperando o seu OK.")}</div>
          </div>

          <aside className="lp-demo-peca" style={surge(em(2), { transform: 'none' })}>
            <div className="lp-demo-peca-topo">
              <strong>{texto("Lançamento")}</strong>
              <span>{texto("vídeo · 12s · 6 cenas")}</span>
            </div>
            <div className="lp-demo-chips">
              <span className="lp-demo-chip lp-demo-chip--acervo">{texto("4 do acervo")}</span>
              <span className="lp-demo-chip lp-demo-chip--mix">{texto("1 acervo + IA")}</span>
              <span className="lp-demo-chip lp-demo-chip--gerada">{texto("1 gerada")}</span>
            </div>
            <div className="lp-demo-board">
              {CENAS_DEMO.map((c, i) => (
                <span
                  className="lp-demo-cena"
                  style={{
                    opacity: em(2) ? 1 : 0,
                    transform: em(2) ? 'none' : 'scale(0.92)',
                    transition: 'opacity 360ms ease, transform 360ms ease',
                    transitionDelay: em(2) ? `${i * 90}ms` : '0ms',
                  }}
                  key={c}
                >
                  {texto(c)}
                </span>
              ))}
            </div>
            <div className="lp-demo-falta" style={surge(em(3), { transform: 'none' })}>
              {texto("falta: a foto real do produto — você manda e eu encaixo")}</div>
            {!entregue ? (
              <button
                type="button"
                tabIndex={-1}
                className={`lp-demo-gerar${em(3) ? ' is-on' : ''}${gerando ? ' is-gerando' : ''}`}
                style={{ opacity: em(3) ? 1 : 0.25, transition: 'opacity 380ms ease' }}
              >
                {gerando ? (
                  <span className="lp-demo-barra">
                    <span className="lp-demo-barra-fill" />
                  </span>
                ) : (
                  texto("Pode gerar")
                )}
              </button>
            ) : (
              <span className="lp-demo-ok">
                <span className="lp-demo-ponto" /> {texto("Aguardando o seu OK")}</span>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

/** Reveal de scroll: dispara UMA vez (threshold 0.22) e nunca re-anima ao
 *  rolar de volta. Com movimento reduzido nasce visível e não chama onReveal
 *  (as cenas já nascem no estado final). */
function useReveal<T extends HTMLElement>(onReveal?: () => void) {
  const ref = useRef<T | null>(null)
  const [vis, setVis] = useState(semMovimento)
  const cb = useRef(onReveal)
  cb.current = onReveal

  useEffect(() => {
    if (vis) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (ents) => {
        for (const en of ents) {
          if (en.isIntersecting) {
            setVis(true)
            cb.current?.()
            io.disconnect()
            break
          }
        }
      },
      { threshold: 0.22 },
    )
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { ref, vis }
}

const PASSOS = [
  {
    n: '01',
    titulo: 'Começamos pela sabatina',
    texto: 'O consultor reúne seus objetivos, público, tom de voz, identidade e referências. Essa escuta orienta a preparação da IA.',
    cor: 'neutro',
  },
  {
    n: '02',
    titulo: 'Preparamos a IA para sua marca',
    texto: 'Organizamos esse contexto no escritório e ajustamos as orientações de criação. Você recebe o acesso com uma direção preparada para usar e refinar.',
    cor: 'azul',
  },
  {
    n: '03',
    titulo: 'Você pede e acompanha',
    texto: 'Converse sobre o que precisa. Escolha as pautas quando houver pesquisa e aprove a proposta antes da produção dos arquivos.',
    cor: 'verde',
  },
] as const

/* A linha de produção do "como funciona": limites de scroll em que cada nó
 * acende, na cor do passo (o 4º é o único coral — a página ensina a gramática
 * de cor sem dizer uma palavra). */
const NOS = [
  { limite: 0.14, cor: 'var(--lp-line2)' },
  { limite: 0.4, cor: 'var(--marca-azul)' },
  { limite: 0.66, cor: 'var(--marca-verde)' },
  { limite: 0.92, cor: 'var(--marca-coral)' },
] as const

/* A vitrine do Estúdio: o caminho real de um vídeo, etapa por etapa. */
const ETAPAS = [
  { rotulo: 'roteiro', sub: '6 cenas, tom da marca' },
  { rotulo: 'corte', sub: '3,9s de silêncio fora' },
  { rotulo: 'cor', sub: 'acertada pela paleta' },
  { rotulo: 'legenda', sub: 'sincronizada para revisão' },
  { rotulo: 'trilha', sub: 'por baixo da voz, sem abafar a fala' },
  { rotulo: 'peça pronta', sub: 'entregue para o seu OK' },
] as const

const MENSAIS = [
  {
    icone: 'arq-web',
    titulo: 'Posts e carrosséis',
    texto: 'Texto e arte com sua identidade, distribuídos para facilitar a leitura. Você revisa antes de publicar.',
    arq: 'post-novidade-agosto.html',
  },
  {
    icone: 'arq-video',
    titulo: 'Reels com seu material',
    texto: 'Envie seu vídeo, fotos e áudio. Peça cortes, ajuste de pausas, legendas e imagens de apoio.',
    arq: 'reels-lancamento.mp4',
  },
  {
    icone: 'agenda',
    titulo: 'Produção no dia marcado',
    texto: 'Agende tarefas com os arquivos necessários. Receba o resultado para revisar e publicar quando decidir.',
    arq: 'agenda-semana-34.pdf',
  },
] as const

const SERVICO = [
  {
    icone: 'setup',
    titulo: 'Sabatina da sua marca',
    texto: 'Entendemos como você trabalha, para quem comunica e quais referências fazem sentido. Transformamos isso em uma direção para a IA.',
  },
  {
    icone: 'entregas',
    titulo: 'Personalização para produzir',
    texto: 'Preparamos o contexto, os materiais e as orientações do escritório. Seus pedidos e feedbacks ajudam a refinar o estilo das próximas entregas.',
  },
  {
    icone: 'chave',
    titulo: 'Escopo definido em contrato',
    texto: 'Combinamos a preparação, os ajustes, o acompanhamento e a vigência. O contrato também define capacidades e consumo de IA, com serviços administrados pelo Offiz ou contas próprias.',
  },
] as const

const LICAO_TXT = 'o título ficou formal demais — a gente fala simples'

/* O ticker do CTA final: linhas mono reais de trabalho, a baixa opacidade —
 * a sala de máquinas vista pela janela à noite. */
const TICKER = [
  'agenda · segunda 08h · post da semana',
  'fechamento de agosto · aguardando extrato',
  'revisor: aprovado sem ressalvas',
  'legendas.srt · revisadas palavra a palavra',
  'lição nova: título simples, sem formalidade',
  'quinta 08h · agenda da semana para o seu OK',
  'relatorio-gerencial.pdf · enviado por e-mail',
  'Nino · editor — trabalhando…',
] as const

const PERGUNTAS = [
  {
    q: 'O que eu recebo com o Offiz?',
    a: 'Um serviço de sabatina, preparação e personalização da IA para sua marca, dentro do escopo contratado. O consultor organiza contexto e referências; você usa o Offiz para pedir, revisar e guardar o trabalho.',
  },
  {
    q: 'Preciso assinar outras ferramentas de IA?',
    a: 'Na modalidade com IA incluída, as conexões ficam por conta do Offiz. Você usa a web sem cadastrar chaves ou escolher modelos a cada pedido. Quem já tem contas próprias pode combinar essa modalidade com o consultor.',
  },
  {
    q: 'Como funcionam o contrato e o consumo de IA?',
    a: 'O contrato define o serviço de preparação e personalização, os ajustes e o acompanhamento combinados, valores e vigência. Quando houver IA incluída, ele também define os serviços liberados e o saldo mensal para uso. Esse saldo é separado do valor do serviço, renova por mês e não acumula. Novas gerações dependem de saldo disponível.',
  },
  {
    q: 'O agendamento publica sozinho no Instagram?',
    a: 'O agendamento programa tarefas do escritório, como preparar pautas ou produzir conteúdo com os arquivos que você enviar. Você revisa as entregas e faz a publicação na rede social. A publicação automática no Instagram ainda não está disponível.',
  },
  {
    q: 'E se a entrega vier errada?',
    a: 'Você pede ajustes e explica o motivo. As correções ficam registradas como referência para os próximos trabalhos. A sua revisão continua fazendo parte do processo.',
  },
  {
    q: 'E se o Offiz não conseguir fazer o que eu pedi?',
    a: 'Ele deve explicar a limitação, dizer quais materiais ou capacidades faltam e propor um próximo passo concreto. Quando houver uma alternativa, você decide se ela atende ao pedido. Um arquivo parcial não deve ser apresentado como pronto.',
  },
  {
    q: 'Meu acervo continua organizado?',
    a: 'Sim. Os materiais podem receber descrição e organização automática, e você continua podendo adicionar, revisar e organizar manualmente. Os arquivos e as referências da empresa ajudam a orientar os próximos trabalhos.',
  },
  {
    q: 'Preciso instalar algum programa?',
    a: 'Você pode usar pelo navegador e receber avisos por e-mail. O aplicativo para Windows é opcional; o consultor ajuda a definir a forma de acesso adequada ao seu contrato.',
  },
  {
    q: 'Quem mais da minha equipe pode usar?',
    a: 'As pessoas autorizadas no seu contrato. Cada uma entra com acesso próprio e vê as áreas permitidas para seu papel.',
  },
] as const

/** O CTA principal (nav e herói). Vive FORA de LandingCorpo de propósito: o
 *  corpo re-renderiza a cada frame de scroll (comoProg) e a cada tique da
 *  cena da lição — um componente declarado lá dentro ganharia identidade nova
 *  por render, e o React remontaria o nó DOM do botão (matando foco e hover). */
function CtaPrincipal({
  className,
  logado,
  ctaTexto,
}: {
  className: string
  logado: boolean
  ctaTexto: string
}) {
  const texto = useTextoLanding()
  if (logado) {
    return (
      <Link to="/app" className={className}>
        {ctaTexto}
      </Link>
    )
  }
  if (temEmail) {
    return (
      <a href={mailtoLink()} className={className}>
        {ctaTexto}
      </a>
    )
  }
  if (temWhatsapp) {
    return (
      <a href={whatsappLink()} target="_blank" rel="noopener noreferrer" className={className}>
        {ctaTexto}
      </a>
    )
  }
  return (
    <Link to="/login" className={className}>
      {texto("Entrar")}</Link>
  )
}

function LandingCorpo() {
  const texto = useTextoLanding()
  const { usuario } = useAuth()
  const estatico = semMovimento()

  const logado = !!usuario
  const destinoEntrar = logado ? '/app' : '/login'
  // O CTA principal é falar com a gente; logado, ele vira "ir trabalhar".
  // "Abrir meu escritório", não "Ir para os prédios": prédio/andar é o NOSSO
  // vocabulário interno — o cliente procura a palavra que a página usa.
  const ctaTexto = logado ? texto("Abrir meu escritório") : texto("Pedir uma demonstração")

  // ---- nav que encolhe + progresso da linha de produção -------------------
  const [navMini, setNavMini] = useState(false)
  const [comoProg, setComoProg] = useState(estatico ? 1 : 0)
  const progRef = useRef(comoProg)

  useEffect(() => {
    const aoRolar = () => {
      setNavMini(window.scrollY > 8)
      if (estatico) return
      const el = document.getElementById('como')
      if (!el) return
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      const p = Math.max(0, Math.min(1, (vh * 0.92 - r.top) / (r.height * 0.9)))
      if (Math.abs(p - progRef.current) > 0.012 || (p === 1 && progRef.current !== 1)) {
        progRef.current = p
        setComoProg(p)
      }
    }
    window.addEventListener('scroll', aoRolar, { passive: true })
    aoRolar()
    return () => window.removeEventListener('scroll', aoRolar)
  }, [estatico])

  // ---- as duas cenas com sequência própria --------------------------------
  const [estudioN, setEstudioN] = useState(estatico ? 7 : 0)
  const [licaoBeat, setLicaoBeat] = useState(estatico ? 3 : 0)
  const [licaoTyped, setLicaoTyped] = useState(estatico ? LICAO_TXT : '')
  const timers = useRef<number[]>([])
  const t = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))
  useEffect(
    () => () => {
      timers.current.forEach((id) => window.clearTimeout(id))
    },
    [],
  )

  const seqEstudio = () => {
    for (let k = 1; k <= 6; k++) t(200 + k * 120, () => setEstudioN(k))
    t(200 + 6 * 120 + 420, () => setEstudioN(7))
  }
  const seqLicao = () => {
    t(500, () => {
      let i = 0
      const tique = () => {
        i += 1
        setLicaoTyped(LICAO_TXT.slice(0, i))
        setLicaoBeat(1)
        if (i < LICAO_TXT.length) t(26, tique)
        else {
          t(600, () => setLicaoBeat(2))
          t(1500, () => setLicaoBeat(3))
        }
      }
      tique()
    })
  }

  const rComo = useReveal<HTMLElement>()
  const rConteudo = useReveal<HTMLElement>(seqEstudio)
  const rServico = useReveal<HTMLElement>()
  const rLicao = useReveal<HTMLElement>(seqLicao)
  const rDono = useReveal<HTMLDivElement>()

  const rd = (ms: number) => ({ '--rd': `${ms}ms` }) as React.CSSProperties

  return (
    <div className="lp">
      {/* ---------- NAV ---------- */}
      <nav className={`lp-nav${logado ? '' : ' lp-nav--visitante'}${navMini ? ' is-mini' : ''}`}>
        <span className="lp-marca">
          <LogoMark size={26} className="lp-marca-icone" />
          Offiz<span className="lp-ponto">.</span>
        </span>
        <span className="lp-nav-espaco" />
        <SeletorIdioma compacto />
        <a className="lp-nav-link" href="#como">{texto("Como funciona")}</a>
        <a className="lp-nav-link" href="#conteudo">{texto("Conteúdo")}</a>
        <a className="lp-nav-link" href="#servico">{texto("Nosso serviço")}</a>
        <a className="lp-nav-link" href="#perguntas">{texto("Perguntas")}</a>
        {temContato && <a className="lp-nav-link" href="#contato">{texto("Contato")}</a>}
        {!logado && (
          <Link className="lp-nav-entrar" to={destinoEntrar}>
            {texto("Entrar")}</Link>
        )}
        <CtaPrincipal className="lp-btn lp-btn--azul lp-btn--nav" logado={logado} ctaTexto={logado ? texto("Abrir Offiz") : ctaTexto} />
      </nav>

      {/* ---------- HERÓI — centrado, com a mesa de operação ---------- */}
      <header className="lp-heroi lp-heroi--campanha">
        <div className="lp-heroi-texto">
        <p className="lp-kicker">{texto("Para profissionais e empresas")}</p>
        <h1 className="lp-h1">
          {texto("IA preparada para o jeito da sua marca.")}</h1>
        <p className="lp-lead">
          {texto("Conhecemos sua marca na sabatina, organizamos referências e ajustamos a IA ao seu contexto. Um serviço por contrato, com o Offiz como ambiente para pedir, revisar e organizar suas entregas.")}</p>
        <div className="lp-heroi-acoes">
          <CtaPrincipal className="lp-btn lp-btn--azul lp-btn--grande" logado={logado} ctaTexto={ctaTexto} />
          <a className="lp-link-seta" href="#demonstracao">
            {texto("Ver uma campanha pronta")}</a>
        </div>
        <p className="lp-heroi-garantia">
          <Icone nome="seguranca" tamanho={20} />
          <span><strong>{texto("Seu OK vem antes de qualquer ação irreversível.")}</strong> {texto("Se faltarem insumos para um bom resultado, o Offiz diz exatamente o que precisa.")}</span>
        </p>
        </div>
        <div id="demonstracao"><CampanhaDemonstracao /></div>
        <details className="lp-demo-detalhes"><summary>{texto("Ver como o pedido acompanha a produção")}</summary><MesaMockup /></details>
      </header>

      {/* ---------- O MODELO DE SERVIÇO ---------- */}
      <section className={`lp-secao${rServico.vis ? ' is-vis' : ''}`} ref={rServico.ref} id="servico">
        <div className="lp-wrap">
          <p className="lp-kicker">{texto("O MODELO DE SERVIÇO")}</p>
          <h2 className="lp-h2 lp-h2--larga">{texto("O serviço começa pela sua marca.")}</h2>
          <p className="lp-sub">{texto("Você contrata a sabatina e a preparação da IA para o seu contexto, com ajustes e acompanhamento conforme o escopo combinado. O aplicativo é onde esse trabalho ganha continuidade.")}</p>
          <div className="lp-tri">
            {SERVICO.map((s, i) => (
              <article className="lp-servico lp-rev" style={rd(i * 60)} key={s.titulo}>
                <span className="lp-servico-icone" aria-hidden="true">
                  <Icone nome={s.icone} tamanho={26} />
                </span>
                <div>
                  <h3 className="lp-servico-titulo">{texto(s.titulo)}</h3>
                  <p className="lp-servico-texto">{texto(s.texto)}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <LandingSolucoes logado={logado} usuarioId={usuario?.id} />

      {/* ---------- COMO FUNCIONA — a linha de produção ---------- */}
      <section
        className={`lp-secao lp-secao--papel${rComo.vis ? ' is-vis' : ''}`}
        id="como"
        ref={rComo.ref}
      >
        <div className="lp-wrap">
          <p className="lp-kicker">{texto("COMO FUNCIONA")}</p>
          <h2 className="lp-h2">{texto("Da sabatina à entrega aprovada.")}</h2>
          <p className="lp-sub">
            {texto("Primeiro preparamos a IA com o contexto da sua marca. Depois, cada pedido segue um caminho de proposta, produção e revisão.")}</p>

          {/* O fio técnico que se desenha com o scroll, um nó por passo. */}
          <div className="lp-strip" aria-hidden="true">
            <span className="lp-strip-base" />
            <span
              className="lp-strip-fio"
              style={{ transform: `scaleX(${rComo.vis ? comoProg : 0})` }}
            />
            {NOS.map((no, i) => {
              const aceso = rComo.vis && comoProg >= no.limite
              return (
                <span
                  key={no.limite}
                  className={`lp-strip-no${aceso && i === 3 && !estatico ? ' is-pop' : ''}`}
                  style={{
                    left: `${12.5 + i * 25}%`,
                    borderColor: aceso ? no.cor : 'var(--lp-line2)',
                    background: aceso && i > 0 ? no.cor : 'var(--lp-paper)',
                  }}
                />
              )
            })}
          </div>

          <div className="lp-passos">
            {PASSOS.map((p, i) => (
              <article className="lp-passo lp-rev" style={rd(i * 60)} key={p.n}>
                <div className={`lp-passo-n lp-passo-n--${p.cor}`}>{p.n}</div>
                <h3 className="lp-passo-titulo">{texto(p.titulo)}</h3>
                <p className="lp-passo-texto">{texto(p.texto)}</p>
              </article>
            ))}
            {/* O 4º é o argumento do produto: por isso é o único em coral. */}
            <article className="lp-passo lp-passo--destaque lp-rev" style={rd(180)}>
              <div className="lp-passo-n lp-passo-n--coral">04</div>
              <h3 className="lp-passo-titulo">{texto("Você aprova — ou corrige")}</h3>
              <p className="lp-passo-texto">
                {texto("Revise os arquivos, aprove ou peça ajustes. Suas correções ficam como")}{' '}
                <strong>{texto("referência para os próximos trabalhos")}</strong>{texto(", junto com os exemplos que você aprovou.")}</p>
            </article>
          </div>
        </div>
      </section>

      {/* ---------- CONTEÚDO & MARCA — a vitrine do carro-chefe ---------- */}
      <section
        className={`lp-secao${rConteudo.vis ? ' is-vis' : ''}`}
        id="conteudo"
        ref={rConteudo.ref}
      >
        <div className="lp-wrap">
          <p className="lp-kicker">{texto("No trabalho de conteúdo")}</p>
          <h2 className="lp-h2 lp-h2--larga">{texto("Conteúdo com o seu jeito de comunicar.")}</h2>
          <p className="lp-sub">
            {texto("Peça uma pesquisa de pautas usando seu perfil e suas referências. Escolha as ideias, aprove a proposta de produção e receba posts, carrosséis ou vídeos para revisar.")}</p>

          <div className="lp-maq lp-vitrine lp-rev" aria-hidden="true">
            <Cantos />
            <div className="lp-vitrine-topo">
              <span className="lp-maq-rotulo">{texto("ESTÚDIO · A LINHA DE PRODUÇÃO DE UMA PEÇA")}</span>
              <span className="lp-maq-rotulo lp-maq-rotulo--solto">{texto("vídeo · reels · 0:42")}</span>
            </div>
            <div className="lp-vitrine-etapas">
              {ETAPAS.map((e, i) => {
                const k = i + 1
                return (
                  <div
                    key={e.rotulo}
                    className={`lp-etapa${k === 6 ? ' lp-etapa--fim' : ''}${
                      estudioN >= k ? ' is-acesa' : ''
                    }${estudioN > k ? ' is-feita' : ''}`}
                  >
                    <div className="lp-etapa-topo">
                      <span className="lp-etapa-no" />
                      {k < 6 && (
                        <span className="lp-etapa-fio">
                          <i />
                        </span>
                      )}
                    </div>
                    <div className="lp-etapa-rotulo">{texto(e.rotulo)}</div>
                    <div className="lp-etapa-sub">{texto(e.sub)}</div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="lp-eject-wrap lp-eject-wrap--dir" aria-hidden="true">
            <div className={`lp-eject${estudioN >= 7 ? ' is-on' : ''}`}>
              <Icone nome="arq-video" tamanho={18} />
              <span className="lp-eject-arq">reels-lancamento.mp4</span>
            </div>
          </div>

          <div className="lp-tri">
            {MENSAIS.map((m, i) => (
              <article className="lp-card lp-rev" style={rd(120 + i * 60)} key={m.titulo}>
                <div className="lp-card-icone" aria-hidden="true">
                  <Icone nome={m.icone} tamanho={30} />
                </div>
                <h3 className="lp-card-titulo">{texto(m.titulo)}</h3>
                <p className="lp-card-texto">{texto(m.texto)}</p>
                <p className="lp-card-arq">{m.arq}</p>
              </article>
            ))}
          </div>
          <p className="lp-vitrine-fecho">
            {texto("Seu perfil orienta a criação. Seus materiais ficam no acervo.")}{' '}
            <strong>{texto("Você decide o que publicar.")}</strong>
          </p>
        </div>
      </section>

      {/* ---------- O ESCRITÓRIO APRENDE — a cena da lição ---------- */}
      <section
        className={`lp-secao lp-secao--papel${rLicao.vis ? ' is-vis' : ''}`}
        ref={rLicao.ref}
      >
        <div className="lp-wrap">
          <p className="lp-kicker">{texto("O ESCRITÓRIO APRENDE")}</p>
          <h2 className="lp-h2">{texto("Cada correção orienta o próximo trabalho.")}</h2>
          <p className="lp-sub">
            {texto("A sua correção não morre na conversa: vira uma lição escrita, com data — e entra nos próximos trabalhos como referência para a equipe.")}</p>

          <div className="lp-maq lp-licao lp-rev" aria-hidden="true">
            <Cantos />
            <div className="lp-licao-grid">
              <div>
                <div className="lp-maq-rotulo">{texto("A CORREÇÃO")}</div>
                <div className="lp-licao-card">
                  <div className="lp-licao-arq">
                    <Icone nome="arq-web" tamanho={18} />
                    <span className="lp-licao-arq-nome">post-institucional.html</span>
                    <span className="lp-licao-arq-nota">{texto("entregue para aprovação")}</span>
                  </div>
                  <div className="lp-licao-botoes">
                    <span className="lp-licao-ok">
                      <Icone nome="visto" tamanho={14} /> {texto("Aprovar")}</span>
                    <span className="lp-licao-rej">{texto("Rejeitar")}</span>
                  </div>
                  <div className="lp-licao-motivo">
                    <div className="lp-licao-motivo-rotulo">{texto("o motivo, do seu jeito:")}</div>
                    <div className="lp-licao-motivo-texto">
                      {texto(LICAO_TXT).slice(0, Math.ceil(licaoTyped.length / LICAO_TXT.length * texto(LICAO_TXT).length))}
                      <span
                        className={`lp-mesa-cursor${licaoBeat === 1 && !estatico ? '' : ' is-oculto'}`}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div className="lp-maq-rotulo">{texto("A PILHA DE LIÇÕES")}</div>
                <div className="lp-licao-pilha">
                  <div className={`lp-licao-item lp-licao-item--nova${licaoBeat >= 2 ? ' is-on' : ''}`}>
                    <span>{texto("a gente fala simples — sem formalidade no título")}</span>
                    <span className="lp-licao-data">{texto("hoje")}</span>
                  </div>
                  <div className="lp-licao-item">
                    <span>{texto("não usar caixa-alta em título")}</span>
                    <span className="lp-licao-data">12/08</span>
                  </div>
                  <div className="lp-licao-item lp-licao-item--velha">
                    <span>{texto("assinar como equipe, nunca “atenciosamente”")}</span>
                    <span className="lp-licao-data">29/07</span>
                  </div>
                </div>
                <div className={`lp-licao-selo${licaoBeat >= 3 ? ' is-on' : ''}`}>
                  <Icone nome="visto" tamanho={15} /> {texto("referência para o próximo trabalho")}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- SIMPLES NO DIA A DIA ---------- */}
      <section className={`lp-secao${rDono.vis ? ' is-vis' : ''}`}>
        <div className="lp-wrap lp-duas" ref={rDono.ref}>
          <div>
            <p className="lp-kicker">{texto("SIMPLES NO DIA A DIA")}</p>
            <h2 className="lp-h2">{texto("Converse. Acompanhe. Encontre tudo.")}</h2>
            <p className="lp-sub">
              {texto("Comece na Conversa, acompanhe Projetos e entregas, guarde seus materiais no Acervo e programe tarefas em Agendamento. Ferramentas e conexões ficam reunidas no menu da sua conta.")}</p>
            <ul className="lp-checks">
              {/* O check é do set, não um '✓' solto — texto puro vira ruído no
                  leitor de tela e foge do traço da casa. */}
              <li><span className="lp-check" aria-hidden="true"><Icone nome="visto" tamanho={16} /></span> {texto("Aprovar uma entrega leva um clique")}</li>
              <li><span className="lp-check" aria-hidden="true"><Icone nome="visto" tamanho={16} /></span> {texto("Você pode receber avisos por e-mail")}</li>
              <li><span className="lp-check" aria-hidden="true"><Icone nome="visto" tamanho={16} /></span> {texto("Acompanhe as pendências e o próximo passo")}</li>
              <li><span className="lp-check" aria-hidden="true"><Icone nome="visto" tamanho={16} /></span> {texto("O acesso segue as permissões da sua empresa")}</li>
            </ul>
          </div>
          <div className="lp-mock lp-rev" aria-hidden="true">
            <div className="lp-mock-topo">
              <LogoMark size={18} className="lp-marca-icone" />
              <span className="lp-mock-org">{texto("Flores & Cia")}</span>
              <span className="lp-mock-sep">›</span>
              <span className="lp-mock-office">{texto("Conteúdo & Marca")}</span>
              <span className="lp-nav-espaco" />
              <span className="lp-mock-sino">
                <Icone nome="sino" tamanho={16} />
              </span>
            </div>
            <div className="lp-mock-miolo">
              <div className="lp-mock-abas">
                <span className="lp-mock-aba is-ativa">
                  <Icone nome="conversa" tamanho={15} /> {texto("Conversa")}</span>
                <span className="lp-mock-aba">
                  <Icone nome="entregas" tamanho={15} /> {texto("Projetos e entregas")}{' '}
                  <span className="lp-mock-badge">2</span>
                </span>
                <span className="lp-mock-aba"><Icone nome="arq-pasta" tamanho={15} /> {texto("Acervo")}</span>
                <span className="lp-mock-aba"><Icone nome="agenda" tamanho={15} /> {texto("Agendamento")}</span>
              </div>
              <div className="lp-mock-bolha">
                {texto("Bom dia, Helena! O relatório de junho está pronto para o seu OK.")}</div>
              <div className="lp-mock-acoes">
                <span className="lp-mock-ok" style={{ gap: 7 }}>
                  <Icone nome="visto" tamanho={15} /> {texto("Aprovar")}</span>
                <span className="lp-mock-rej">{texto("Rejeitar…")}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- PERGUNTAS ---------- */}
      <section className="lp-secao lp-secao--papel" id="perguntas">
        <div className="lp-wrap lp-wrap--estreito">
          <h2 className="lp-h2 lp-h2--solto">{texto("Perguntas diretas, respostas diretas.")}</h2>
          {PERGUNTAS.map((p) => (
            <details className="lp-faq" key={p.q}>
              {/* O flex fica num <span> INTERNO: display:flex direto no summary
                  apaga a semântica de disclosure no Safari/VoiceOver. */}
              <summary>
                <span className="lp-faq-resumo">
                  <span className="lp-faq-seta" aria-hidden="true">
                    <Icone nome="seta-direita" tamanho={15} />
                  </span>
                  {texto(p.q)}
                </span>
              </summary>
              <p>{texto(p.a)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---------- CTA + CONTATO — a máquina que não dorme ---------- */}
      <section className="lp-cta" id="contato">
        <div className="lp-ticker" aria-hidden="true">
          <div className="lp-ticker-fita">
            {/* 4 cópias: o loop anda -50% (= 2 cópias exatas), então a emenda
                cai sempre em cima de uma repetição — e a metade visível cobre a
                seção inteira, sem faixa vazia no rodapé. */}
            {[...TICKER, ...TICKER, ...TICKER, ...TICKER].map((l, i) => (
              <div key={i}>{texto(l)}</div>
            ))}
          </div>
        </div>
        <div className="lp-wrap lp-wrap--estreito lp-cta-corpo">
          <h2 className="lp-cta-titulo">{texto("Vamos preparar a IA para a sua marca.")}</h2>
          <p className="lp-cta-sub">
            {texto("Conte como você trabalha e o que quer produzir. Na conversa inicial, alinhamos as referências, a preparação e o escopo do serviço antes da contratação.")}</p>
          <p className="lp-cta-sub lp-cta-sub--agenda">
            {texto("Seu escritório também trabalha no dia marcado — a agenda programa a produção, organiza o fechamento do mês e pode avisar por e-mail. Você revisa e publica nas redes.")}</p>

          {temContato ? (
            <>
              <div className="lp-cta-canais">
                {temWhatsapp && (
                  <a
                    className="lp-btn lp-btn--coral lp-btn--grande"
                    href={whatsappLink()}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {texto("Chamar no WhatsApp")}</a>
                )}
                {temEmail && (
                  <a
                    className={`lp-btn lp-btn--grande ${temWhatsapp ? 'lp-btn--claro' : 'lp-btn--coral'}`}
                    href={mailtoLink()}
                  >
                    {texto("Mandar um e-mail")}</a>
                )}
              </div>
              <p className="lp-cta-nota">
                {temWhatsapp && <span className="lp-cta-dado">{CONTATO_WHATSAPP_DISPLAY}</span>}
                {temWhatsapp && temEmail && <span className="lp-cta-sep">·</span>}
                {temEmail && <span className="lp-cta-dado">{CONTATO_EMAIL}</span>}
                <br />
                {texto("a gente responde gente por gente.")}</p>
            </>
          ) : (
            <Link className="lp-btn lp-btn--coral lp-btn--grande" to="/login">
              {texto("Entrar")}</Link>
          )}
        </div>
      </section>

      {/* ---------- RODAPÉ ---------- */}
      <section className="lp-secao lp-secao--papel" aria-label="Offiz Desktop">
        <div className="lp-wrap">
          <h2 className="lp-h2">Offiz Desktop</h2>
          <DownloadsWindowsZIP />
          <DownloadsMac />
        </div>
      </section>
      <footer className="lp-rodape">
        <span className="lp-marca lp-marca--peq">
          <LogoMark size={20} className="lp-marca-icone" />
          Offiz<span className="lp-ponto">.</span>
        </span>
        <span>{texto("escritórios de IA que aprendem com você")}</span>
        <AssinaturaAdama />
        <span className="lp-nav-espaco" />
        {temEmail && <a href={mailtoLink()}>{CONTATO_EMAIL}</a>}
        {temWhatsapp && (
          <a href={whatsappLink()} target="_blank" rel="noopener noreferrer">
            {CONTATO_WHATSAPP_DISPLAY}
          </a>
        )}
        <Link to={destinoEntrar}>{logado ? texto("Abrir meu escritório") : texto("Entrar")}</Link>
        <span>{texto("Seu escritório, com acesso por permissões")}</span>
      </footer>
    </div>
  )
}

export default function Landing() {
  // Dentro do app desktop a landing NÃO existe: decidido antes de qualquer
  // render, para a página institucional não piscar dentro do aplicativo.
  // O guard mora FORA do corpo com hooks para não condicionar a ordem deles.
  if (ehDesktop) {
    return <Navigate to={getAccessToken() ? '/app' : '/login'} replace />
  }
  return <LandingCorpo />
}
