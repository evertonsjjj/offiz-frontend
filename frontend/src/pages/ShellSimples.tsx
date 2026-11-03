import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LogoMark } from '../components/LogoMark'
import { Icone } from '../components/Icone'
import { ToggleTema } from '../components/ToggleTema'
import { SinoNotificacoes } from '../components/SinoNotificacoes'
import { MenuUsuario } from '../components/MenuUsuario'
import { AssinaturaAdama } from '../components/AssinaturaAdama'
import { PlacaExecucao } from '../predio/PlacaExecucao'
import { DashboardTab } from '../components/predio/DashboardTab'
import { ConversaTab } from '../components/predio/ConversaTab'
import { EntregasTab } from '../components/predio/EntregasTab'
import EstudioTab from '../components/predio/EstudioTab'
import MesaTab from '../components/predio/MesaTab'
import { ConhecimentoSimples } from '../components/predio/ConhecimentoSimples'
import { MesesTab } from '../components/predio/MesesTab'
import { CasosTab } from '../components/predio/CasosTab'
import { ClientesTab } from '../components/predio/ClientesTab'
import { PentestTab } from '../components/predio/PentestTab'
import { MonitorTab } from '../components/predio/MonitorTab'
import { BibliotecaTab } from '../components/predio/BibliotecaTab'
import { AgendaTab } from '../components/predio/AgendaTab'
import { OficinaTab } from '../components/predio/OficinaTab'
import { GuiaTab } from '../components/predio/GuiaTab'
import type { OfficeInfo } from '../lib/types'
import { temaParaEstilo } from '../lib/tema'
import { useBrasao } from '../lib/useBrasao'
import { useIdioma, type Traduzir } from '../lib/i18n'
import { AcervoTab } from '../components/predio/AcervoTab'
import {
  ABA_ACERVO,
  ABA_CONHECIMENTO,
  ABA_ESTUDIO,
  ABA_GUIA,
  abasDoEscritorio,
  localizarAba,
  type AbaDef,
  type AbaSimples,
} from '../lib/abas'

/* =============================================================
   ShellSimples — o Offiz para TODO usuário (a shell única).

   Desenho de ago/2026: as abas saem do topo e viram um MENU LATERAL
   fixo (o modelo mental de navegação do aplicativo — "tipo o
   Paperclip"): as portas do escritório em cima, o bastidor do
   operador no meio e o Guia — a última opção, de propósito — no
   rodapé. A aba inicial é a Visão geral (dashboard); enquanto o
   escritório não conhece a empresa, ela abre com a sabatina de
   setup. Tipografia maior e alvos generosos continuam decisão de
   persona (60+).
   ============================================================= */

/** Um painel que quebrar mostra O ERRO em vez de sumir em silêncio — área em
 *  branco é o pior diagnóstico possível. */
class BordaPainel extends Component<{ children: ReactNode; t: Traduzir }, { erro: Error | null }> {
  state = { erro: null as Error | null }
  static getDerivedStateFromError(erro: Error) {
    return { erro }
  }
  render() {
    if (this.state.erro) {
      return (
        <div className="alerta alerta-erro" role="alert">
          <p>{this.props.t('Esta área não conseguiu abrir. Feche o navegador e abra a página de novo — se continuar, mande um print deste aviso para o suporte.', 'This area could not load. Close the browser and open the page again. If it keeps happening, send support a screenshot of this message.')}</p>
          {/* O técnico existe SÓ para o print do suporte — não no meio da frase. */}
          <small className="texto-suave">
            {this.props.t('detalhe técnico:', 'technical detail:')} {String(this.state.erro.message || this.state.erro)}
          </small>
        </div>
      )
    }
    return this.props.children
  }
}

export function ShellSimples({
  orgId,
  slug,
  orgNome,
  office,
  carregando,
  erro,
  emAndamento,
  pendentes,
  meuPapel,
  totalPredios,
  aoTentarNovamente,
}: {
  orgId: number
  slug: string
  orgNome: string
  office: OfficeInfo | null
  carregando: boolean
  erro: string | null
  /** nº de jobs rodando/na fila (stats ao vivo da AppShell). */
  emAndamento: number
  /** nº de trabalhos aguardando o OK do humano. */
  pendentes: number
  /** Papel na org: owner/admin ganham o bastidor (🧠 e ⚙️). */
  meuPapel?: string
  /** Quantos escritórios esta conta tem. Com UM só, o atalho de prédios e o
   *  logo não levam a lugar nenhum. */
  totalPredios?: number
  aoTentarNovamente?: () => void
}) {
  const { t, idioma } = useIdioma()
  const [searchParams, setSearchParams] = useSearchParams()
  const temMaisDeUmPredio = (totalPredios ?? 1) > 1
  const operador = meuPapel === 'owner' || meuPapel === 'admin'
  // As abas deste escritório (ver abasDoEscritorio lá em cima: o manifesto
  // decide quando declara `abas`; sem declaração, as regras de sempre).
  const abasVisiveis = useMemo(() => abasDoEscritorio(office, slug), [office, slug])
  // O Acervo é porta do bastidor SÓ em escritório de marca — nos outros, os
  // materiais continuam no card de sempre de "O que eu já sei".
  const temAcervo = Boolean(office?.acervo_de_marca)
  // O Estúdio é do escritório de conteúdo — porta de bastidor, não da fileira.
  const temEstudio = slug === 'conteudo'
  const idsValidos = useMemo(
    () =>
      new Set<string>([
        ...abasVisiveis.map((a) => a.id),
        ...(temAcervo ? ['acervo'] : []),
        // O Estúdio saiu da fileira do escritório e virou porta de bastidor —
        // mas continua um destino VÁLIDO: é para ele que "como foi feita" e o
        // quadro do trabalho levam, e o deep-link ?f=estudio precisa abrir.
        ...(temEstudio ? ['estudio'] : []),
        'conhecimento',
        'guia',
      ]),
    [abasVisiveis, temAcervo, temEstudio],
  )
  /** Este escritório tem Mesa? É o que decide se a shell é o produto ou só o
   *  bastidor: com Mesa, ela é a porta da frente e não se sai dela à toa. */
  const temMesa = useMemo(() => abasVisiveis.some((a) => a.id === 'mesa'), [abasVisiveis])
  // A aba inicial pode vir da URL (?f=entregas) — é assim que a notificação
  // de "entrega pronta" cai direto no lugar certo em vez de abrir o painel.
  const [aba, setAba] = useState<AbaSimples>(() => {
    const f = searchParams.get('f')
    if (f === 'entregas' || f === 'conhecimento') return f
    // A MESA é a porta da frente de quem tem Mesa (26/08/2026): o diretor
    // abre o escritório e cai onde se DECIDE, não num painel de números.
    if (abasDoEscritorio(office, slug).some((a) => a.id === 'mesa')) return 'mesa'
    return 'inicio'
  })
  // Abas visitadas ficam montadas (display:none) — voltar pra conversa não
  // perde o texto digitado nem recarrega o histórico.
  const [visitadas, setVisitadas] = useState<Set<AbaSimples>>(() => new Set<AbaSimples>([aba]))
  // O menu lateral vira gaveta no celular; este é o trinco dela.
  const [menuAberto, setMenuAberto] = useState(false)
  /* A MESA EM TELA CHEIA (26/08/2026): com a Mesa aberta, a moldura do shell
     (lateral, cabeçalho, assinatura) SOME — "tudo em uma página", o desenho
     do mockup aprovado. As outras portas continuam alcançáveis pelo menu do
     rodapé da própria Mesa; trocar de aba devolve a moldura. */
  const imersa = aba === 'mesa' && !erro && !carregando && Boolean(office)

  useEffect(() => {
    setVisitadas((prev) => (prev.has(aba) ? prev : new Set(prev).add(aba)))
  }, [aba])

  // O ?f= tem de valer TAMBÉM com a shell já montada: o sino ("entrega
  // pronta") navega dentro da mesma rota /app, o componente não remonta e o
  // inicializador do useState não roda de novo. Consome o param para não
  // competir com a troca manual depois.
  useEffect(() => {
    const f = searchParams.get('f')
    // Só aceita aba que ESTE escritório tem: um link velho para ?f=casus num
    // prédio de conteúdo deixaria a shell sem painel nenhum na tela.
    if (!f || !idsValidos.has(f)) return
    // ESCRITÓRIO COM MESA NÃO SAI DA MESA (30/08/2026, pedido do dono). O
    // aviso do sino levava a shell antiga toda vez que uma entrega ficava
    // pronta — a Mesa é o produto, e ela já tem a gaveta de Entregas. Onde
    // existe gaveta, o foco abre a GAVETA; onde não existe (Estúdio, que é
    // bancada de operador), a shell continua sendo o caminho.
    if (temMesa && (f === 'entregas' || f === 'agenda')) {
      setAba('mesa')
      setPainelDaMesa((prev) => ({
        qual: f as 'entregas' | 'agenda',
        n: (prev?.n ?? 0) + 1,
      }))
      const so = new URLSearchParams(searchParams)
      so.delete('f')
      setSearchParams(so, { replace: true })
      return
    }
    setAba(f as AbaSimples)
    const limpo = new URLSearchParams(searchParams)
    limpo.delete('f')
    setSearchParams(limpo, { replace: true })
  }, [searchParams, setSearchParams, idsValidos, temMesa])

  /** Troca de aba com validação — o dashboard e o guia navegam por aqui. */
  function irPara(id: string) {
    if (!idsValidos.has(id)) return
    setAba(id as AbaSimples)
    setMenuAberto(false)
  }

  /** "Perguntar sobre isso": leva a pergunta para a aba Conversar, que consome
   *  o param `pergunta` e abre uma conversa nova com o campo já preenchido. */
  function perguntarNaConversa(texto: string) {
    const params = new URLSearchParams(searchParams)
    params.set('pergunta', texto)
    setSearchParams(params, { replace: true })
    setAba('conversa')
  }

  // "🧬 Ver como foi feita" na vitrine → abre o Estúdio já na peça certa.
  // O `n` cresce a cada clique: clicar de novo na MESMA peça re-dispara o
  // efeito no Estúdio (sem ele, voltar à lista e clicar de novo não abria).
  const [pecaFluxo, setPecaFluxo] = useState<
    { slug: string; n: number; jobId?: number } | null
  >(null)
  /* O `jobId` viaja junto como RESERVA: o caminho `outputs/pecas/<slug>/` diz
     que o trabalho PARECE uma peça, mas quem entrega arte estática grava lá
     sem abrir documento. Sem a reserva, o Estúdio abria em "Peça não
     encontrada" — tela morta no meio do caminho da demo. */
  function verComoFoiFeita(pecaSlug: string, jobId?: number) {
    setPecaFluxo((prev) => ({ slug: pecaSlug, n: (prev?.n ?? 0) + 1, jobId }))
    setAba('estudio')
  }

  // O irmão para QUALQUER trabalho (15/08/2026): a vitrine e a conversa abrem
  // o quadro derivado do diário no Estúdio. Mesmo contrato do pecaFluxo.
  const [trabalhoFluxo, setTrabalhoFluxo] = useState<{ jobId: number; n: number } | null>(null)
  /** Qual gaveta a Mesa deve abrir ao receber o foco (?f=). */
  const [painelDaMesa, setPainelDaMesa] = useState<
    { qual: 'entregas' | 'agenda'; n: number } | null
  >(null)
  /** "Abrir Entregas" de qualquer canto (placa, Estúdio, pentest): onde há
   *  Mesa, abre a GAVETA dela — a mesma regra do foco por ?f=. Sair para a
   *  aba de Entregas da shell era o "layout antigo" que o dono pediu para
   *  impedir de qualquer forma (04/09/2026: a placa ainda escapava). */
  function abrirEntregas() {
    if (temMesa) {
      setAba('mesa')
      setPainelDaMesa((prev) => ({ qual: 'entregas', n: (prev?.n ?? 0) + 1 }))
      return
    }
    setAba('entregas')
  }
  function verFluxoDoTrabalho(jobId: number) {
    setTrabalhoFluxo((prev) => ({ jobId, n: (prev?.n ?? 0) + 1 }))
    setAba('estudio')
  }

  // O BRASÃO substitui o ícone do tema — é o que a tela de personalização
  // promete ("aparece no topo do prédio, no lugar do ícone"). Com o logo do
  // cliente aqui, o prédio parece dele; sem brasão, o emoji do tema vale.
  const brasao = useBrasao(orgId, slug)
  /* Sem brasão, o sinal do andar é o ÍCONE DE PRÉDIO do set — não mais o emoji
     🏢. Um manifesto que declare `tema.icone` continua mandando: o <Icone>
     devolve como texto o que não for chave conhecida. */
  const icone = office?.tema?.icone || 'predio'
  const nomeDoAndar = office?.nome ?? t('Seu escritório', 'Your office')
  /** O ícone do andar: brasão quando existe, o traço quando não. O `alt` fica
   *  vazio porque o nome do escritório vem escrito ao lado — um leitor de tela
   *  que anunciasse os dois leria a mesma coisa duas vezes. */
  const marca = brasao ? (
    <img src={brasao} alt="" className="simples-brasao" />
  ) : (
    <Icone nome={icone} tamanho={17} className="simples-marca-icone" />
  )
  /* As portas de BASTIDOR (Estúdio, Acervo) entram na busca da migalha: elas
     não estão na fileira, mas são destinos de verdade — sem elas o "Onde você
     está" caía no fallback e anunciava a Mesa com o Estúdio na tela. */
  const abaAtual =
    [...abasVisiveis, ABA_ESTUDIO, ABA_ACERVO, ABA_CONHECIMENTO, ABA_GUIA].find(
      (a) => a.id === aba,
    ) ?? abasVisiveis[0]

  /** Um item do menu lateral (o mesmo desenho nas três seções). */
  function ItemMenu({ def }: { def: AbaDef }) {
    const local = localizarAba(def, idioma)
    return (
      <button
        type="button"
        className={`simples-item${aba === def.id ? ' ativo' : ''}`}
        aria-current={aba === def.id ? 'page' : undefined}
        title={local.ajuda}
        onClick={() => irPara(def.id)}
      >
        <Icone nome={def.icone} className="simples-item-icone" />
        <span className="simples-item-rotulo">{local.rotulo}</span>
        {def.id === 'entregas' && pendentes > 0 && (
          <span className="contador" aria-label={t(`${pendentes} aguardando você`, `${pendentes} awaiting your review`)}>
            {pendentes}
          </span>
        )}
      </button>
    )
  }

  const menu = (
    <>
      <div className="simples-lateral-topo">
          <Link to={`/app?org=${orgId}`} className="simples-logo" title={t('Início do Offiz', 'Offiz home')} aria-label={t('Voltar ao início do Offiz', 'Back to Offiz home')}>
            <LogoMark size={26} />
          </Link>
        <div className="simples-titulos">
          <strong className="simples-org">{orgNome}</strong>
          <span className="simples-office">
            {marca} {nomeDoAndar}
          </span>
        </div>
      </div>

      <nav className="simples-nav" aria-label={t('O seu escritório', 'Your office')}>
        <span className="simples-nav-titulo">{t('Escritório', 'Office')}</span>
        {abasVisiveis.map((a) => (
          <ItemMenu key={a.id} def={a} />
        ))}

        {/* O BASTIDOR do operador (owner/admin). O usuário comum não vê nada
            disso — a simplicidade é o produto. */}
        {operador && (
          <>
            <span className="simples-nav-titulo">{t('Bastidor', 'Management')}</span>
            {temEstudio && <ItemMenu def={ABA_ESTUDIO} />}
            {temAcervo && <ItemMenu def={ABA_ACERVO} />}
            <ItemMenu def={ABA_CONHECIMENTO} />
            {temMaisDeUmPredio && (
              <Link to="/predios" className="simples-item" title={t('Seus escritórios', 'Your offices')}>
                <Icone nome="predio" className="simples-item-icone" />
                <span className="simples-item-rotulo">{t('Seus escritórios', 'Your offices')}</span>
              </Link>
            )}
            <Link
              to={`/config/org/${orgId}`}
              className="simples-item"
              title={t('Configurações avançadas — Sala das máquinas (chave da IA, membros, notificações)', 'Advanced settings — AI key, members, and notifications')}
            >
              <Icone nome="config" className="simples-item-icone" />
              <span className="simples-item-rotulo">{t('Sala das máquinas', 'Settings')}</span>
            </Link>
          </>
        )}
      </nav>

      {/* A última opção do menu, DE PROPÓSITO: quem precisa do guia acha no
          mesmo lugar em que todo produto guarda a documentação. */}
      <div className="simples-lateral-rodape">
        <ItemMenu def={ABA_GUIA} />
      </div>
    </>
  )

  return (
    /* A MARCA DO CLIENTE ENTRA AQUI (15/08/2026). `temaParaEstilo` existia desde
     * 08/08 e era aplicada num lugar só — o cartão do andar em /predios. A shell
     * viva, que é onde o cliente passa o dia, nunca vestiu a cor dele: o prédio
     * do Clube Aurora era idêntico ao do Offiz, exceto pelo brasão. Mesma armadilha
     * do brasão em 08/08 (ligado num cabeçalho que esta shell não renderiza):
     * com duas shells no repositório, ligar coisa visual na errada não dá erro,
     * só não aparece.
     *
     * O estilo inline alcança todo painel e todo modal porque não há um único
     * createPortal no app; só os <Toasts> ficam fora, montados acima do router. */
    <div className="simples" style={temaParaEstilo(office?.tema)}>
      {!imersa && (
        <aside className={`simples-lateral${menuAberto ? ' aberta' : ''}`}>{menu}</aside>
      )}
      {/* O véu fecha a gaveta no celular — só existe com ela aberta. */}
      {!imersa && menuAberto && (
        <button
          type="button"
          className="simples-veu"
          aria-label={t('Fechar o menu', 'Close menu')}
          onClick={() => setMenuAberto(false)}
        />
      )}

      <div className="simples-main">
        {!imersa && (
        <header className="simples-topo papel">
          <button
            type="button"
            className="simples-hamburger"
            aria-label={menuAberto ? t('Fechar o menu', 'Close menu') : t('Abrir o menu', 'Open menu')}
            aria-expanded={menuAberto}
            onClick={() => setMenuAberto((v) => !v)}
          >
            <Icone nome="menu" tamanho={22} />
          </button>
          <div className="simples-migalha" aria-label={t('Onde você está', 'Current location')}>
            <span className="simples-migalha-office">
              {marca} {nomeDoAndar}
            </span>
            {abaAtual && (
              <>
                <span className="simples-migalha-separador" aria-hidden="true">›</span>
                <strong className="simples-migalha-aba">{localizarAba(abaAtual, idioma).rotulo}</strong>
              </>
            )}
          </div>
          <div className="simples-acoes">
            <ToggleTema />
            <SinoNotificacoes />
            <MenuUsuario />
          </div>
        </header>
        )}

        <main className={imersa ? 'simples-corpo simples-corpo--imersa' : aba === 'estudio' ? 'simples-corpo simples-corpo--palco' : 'simples-corpo'}>
          {erro && (
            <div className="estado-vazio" role="alert">
              <div className="estado-vazio-arte">
                <Icone nome="porta" tamanho={44} traco={1.3} />
              </div>
              <h2>{erro}</h2>
              {aoTentarNovamente && <button type="button" className="botao botao-primario" onClick={aoTentarNovamente}>{t('Tentar novamente', 'Try again')}</button>}
              <Link to={`/app?org=${orgId}`}>{t('Voltar ao início', 'Back to home')}</Link>
            </div>
          )}

          {!erro && carregando && (
            <div className="shell-palco-carregando" role="status">
              <span className="sr-only">{t('Abrindo o escritório…', 'Opening your office…')}</span>
              <div className="predio-loader" aria-hidden="true">
                <span /><span /><span /><span /><span /><span />
              </div>
            </div>
          )}

          {!erro && !carregando && office && (
            <div className="simples-com-placa">
              {/* O letreiro vivo: o que está sendo feito agora (título, % e log)
                  e o aviso coral quando algo espera o OK do usuário. Em repouso
                  não renderiza nada — a página fica limpa. */}
              {aba !== 'mesa' && <PlacaExecucao
                orgId={orgId}
                slug={slug}
                emAndamento={emAndamento}
                pendentes={pendentes}
                aoAbrirEntregas={abrirEntregas}
              />}
              <div className="simples-conteudo">
                {([
                  ...abasVisiveis.map((a) => a.id),
                  ...(temAcervo ? ['acervo'] : []),
                  // O Estúdio é porta de bastidor (fora da fileira), mas o
                  // painel dele TEM de estar nesta lista: 'ver como foi
                  // feita' e o deep-link ?f=estudio fazem setAba('estudio'),
                  // e sem o id aqui a aba abria VAZIA (bug real, 27/08).
                  ...(temEstudio ? ['estudio'] : []),
                  'conhecimento',
                  'guia',
                ] as AbaSimples[])
                  .filter((id) => visitadas.has(id))
                  .map((id) => (
                    <div
                      key={id}
                      className="simples-painel predio-corpo"
                      style={aba === id ? undefined : { display: 'none' }}
                    >
                      <BordaPainel t={t}>
                        {id === 'inicio' && (
                          <DashboardTab
                            orgId={orgId}
                            slug={slug}
                            office={office}
                            meuPapel={meuPapel}
                            aoNavegar={irPara}
                          />
                        )}
                        {id === 'conversa' && (
                          <ConversaTab
                            orgId={orgId}
                            slug={slug}
                            office={office}
                            meuPapel={meuPapel}
                            aoVerFluxo={temEstudio ? verFluxoDoTrabalho : undefined}
                            aoVerPeca={temEstudio ? verComoFoiFeita : undefined}
                          />
                        )}
                        {id === 'entregas' && (
                          <EntregasTab
                            orgId={orgId}
                            slug={slug}
                            aoPedirAjuste={() => setAba('conversa')}
                            aoVerComoFoiFeita={temEstudio ? verComoFoiFeita : undefined}
                            aoVerFluxo={temEstudio ? verFluxoDoTrabalho : undefined}
                          />
                        )}
                        {id === 'mesa' && (
                          <MesaTab
                            orgId={orgId}
                            slug={slug}
                            emExecucao={emAndamento > 0}
                            acompanhamento={aba === 'mesa' ? (
                              <PlacaExecucao
                                orgId={orgId}
                                slug={slug}
                                emAndamento={emAndamento}
                                pendentes={pendentes}
                                aoAbrirEntregas={abrirEntregas}
                              />
                            ) : null}
                            imersa
                            orgNome={orgNome}
                            officeNome={office?.nome || 'Conteúdo'}
                            configHref={operador ? `/config/org/${orgId}` : undefined}
                            destinos={[
                              /* O menu do MOCKUP, enxuto de propósito:
                                 Dashboard, Entregas e a Sala das máquinas.
                                 Sem Estúdio e sem 'O que eu já sei' — o
                                 conhecimento é CONVERSA (o dono pergunta o
                                 que a IA sabe e ajusta falando), e o
                                 Estúdio é bancada de operador, fora da
                                 vista do diretor (decisão do dono, 26/08). */
                              { id: 'inicio', rotulo: 'Dashboard', icone: 'painel' },
                              { id: 'entregas', rotulo: t('Entregas', 'Deliverables'), icone: 'entregas' },
                            ]}
                            aoNavegar={irPara}
                            office={office}
                            painelInicial={painelDaMesa}
                            aoVerEstudio={temEstudio ? verComoFoiFeita : undefined}
                            aoVerFluxo={temEstudio ? verFluxoDoTrabalho : undefined}
                          />
                        )}
                        {id === 'estudio' && (
                          <EstudioTab
                            orgId={orgId}
                            slug={slug}
                            aoPerguntar={perguntarNaConversa}
                            pecaInicial={pecaFluxo}
                            trabalhoInicial={trabalhoFluxo}
                            aoVerEntregas={abrirEntregas}
                          />
                        )}
                        {id === 'meses' && <MesesTab orgId={orgId} slug={slug} />}
                        {id === 'clientes' && (
                          <ClientesTab orgId={orgId} slug={slug} office={office} />
                        )}
                        {id === 'pentest' && (
                          <PentestTab
                            orgId={orgId}
                            slug={slug}
                            aoVerEntregas={abrirEntregas}
                          />
                        )}
                        {id === 'casos' && <CasosTab orgId={orgId} slug={slug} />}
                        {id === 'monitor' && <MonitorTab orgId={orgId} slug={slug} />}
                        {id === 'biblioteca' && <BibliotecaTab orgId={orgId} slug={slug} />}
                        {id === 'oficina' && <OficinaTab orgId={orgId} slug={slug} />}
                        {id === 'agenda' && (
                          <AgendaTab
                            orgId={orgId}
                            slug={slug}
                            office={office}
                            podeEditar={operador}
                          />
                        )}
                        {id === 'acervo' && <AcervoTab orgId={orgId} slug={slug} />}
                        {id === 'conhecimento' && (
                          <ConhecimentoSimples
                            orgId={orgId}
                            slug={slug}
                            aoPerguntar={perguntarNaConversa}
                            acervoDeMarca={temAcervo}
                            // Com a aba Acervo existindo, o conhecimento para de
                            // duplicar os materiais — arquivo mora lá, regra aqui.
                            acervoSeparado={temAcervo}
                            aoAbrirAcervo={() => irPara('acervo')}
                          />
                        )}
                        {id === 'guia' && (
                          <GuiaTab aoNavegar={irPara} podeVerConhecimento={operador} />
                        )}
                      </BordaPainel>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Na imersao o rodape SOME por inteiro — o footer vazio ainda
              media 32px e fazia a pagina rolar alem dos 100dvh da Mesa. */}
          {!imersa && (
            <footer className="shell-rodape-pagina">
              <AssinaturaAdama />
            </footer>
          )}
        </main>
      </div>
    </div>
  )
}
