/* =============================================================
   ÍCONES — o set de traço do Offiz.

   Por que existe: até 14/08/2026 toda navegação do produto era EMOJI
   (📊 no menu, 📦 nas entregas, ⚖️ nos casos…). Emoji não herda cor,
   muda de desenho entre Windows/Mac/Android, tem peso óptico próprio
   de cada fonte de sistema — e contradiz o tom. O desenho clássico é
   papel creme, tinta ameixa e serifa editorial; adesivo de mensageiro
   em cada porta desfazia isso na primeira olhada.

   A GRAMÁTICA (a mesma que o sino de notificações e o sol/lua do tema
   já usavam — este arquivo alinha o resto do app a eles):
   - grade de 24×24, desenho contido numa caixa óptica de ~20×20;
   - traço de 1.7, `currentColor`, pontas e junções redondas;
   - NENHUM preenchimento sólido: é desenho a traço, como planta de
     arquiteto. É o que combina com papel.
   Consequência prática: o ícone fica da cor do texto onde estiver —
   tinta no menu, azul no item ativo, coral no "precisa de você" —
   sem uma linha de CSS por ícone.

   COMO ESTENDER: acrescente a chave em `TRACOS`. Nada mais.

   O ESCAPE DO MANIFESTO: `office.abas[].icone` deixa o manifesto de um
   escritório trocar o ícone de uma aba, e manifesto na natureza traz
   emoji. Por isso <Icone> aceita QUALQUER string: chave conhecida vira
   SVG; o que não for, sai como texto. Um escritório de terceiro nunca
   fica sem ícone — no pior caso ele volta a ser emoji, só ali.
   ============================================================= */

import type { ReactNode } from 'react'

/** As chaves do set. Nomeadas pelo PAPEL no produto, não pelo desenho:
 *  'entregas', não 'caixa' — o dia em que a caixa virar outra coisa, o
 *  nome continua verdadeiro. */
export type NomeIcone =
  // — as portas do escritório (menu lateral) —
  | 'painel'
  | 'mesa'
  | 'conversa'
  | 'comentario'
  | 'entregas'
  | 'estudio'
  | 'meses'
  | 'clientes'
  | 'seguranca'
  | 'casos'
  | 'monitor'
  | 'biblioteca'
  | 'oficina'
  | 'agenda'
  | 'conhecimento'
  | 'guia'
  // — chrome e bastidor —
  | 'predio'
  | 'config'
  | 'menu'
  | 'sino'
  | 'porta'
  | 'setup'
  | 'fluxo'
  | 'pessoa'
  | 'voz'
  // — estado —
  | 'check'
  | 'alerta'
  | 'erro'
  | 'relogio'
  | 'loop'
  | 'raio'
  | 'calculadora'
  | 'impressora'
  | 'ampulheta'
  | 'pausa'
  | 'parar'
  | 'fechar'
  | 'visto'
  // — verbos —
  | 'baixar'
  | 'subir'
  | 'enviar'
  | 'anexo'
  | 'play'
  | 'lupa'
  | 'lixeira'
  | 'lapis'
  | 'mais'
  | 'seta-direita'
  | 'expandir'
  | 'contrair'
  | 'desfazer'
  | 'polegar-cima'
  | 'polegar-baixo'
  | 'copiar'
  | 'olho'
  | 'ia'
  | 'microfone'
  // — objetos do escritório —
  | 'email'
  | 'celular'
  | 'canon'
  | 'ideia'
  | 'bussola'
  | 'cadeado'
  | 'chave'
  | 'paleta'
  | 'audio'
  | 'computador'
  | 'conector'
  | 'broto'
  // — tipos de arquivo —
  | 'arq-documento'
  | 'arq-planilha'
  | 'arq-pdf'
  | 'arq-slides'
  | 'arq-imagem'
  | 'arq-video'
  | 'arq-zip'
  | 'arq-web'
  | 'arq-texto'
  | 'arq-pasta'
  // — ofícios (landing e cartões de escritório) —
  | 'oficio-conteudo'
  | 'oficio-financeiro'
  | 'oficio-juridico'

/** O desenho de cada ícone: só a geometria interna do <svg> 24×24.
 *  O <svg> em volta (stroke, cor, tamanho, acessibilidade) é do componente —
 *  assim nenhum ícone pode divergir da gramática por descuido. */
const TRACOS: Record<NomeIcone, ReactNode> = {
  /* ---------- As portas do escritório ---------- */

  // A Mesa: o tampo visto de frente — a prancheta do dono com a peça em cima.
  mesa: (
    <>
      <path d="M3.2 8.6h17.6" />
      <path d="M5 8.6v10.6M19 8.6v10.6" />
      <rect x="8.2" y="4.2" width="7.6" height="4.4" rx="1" />
    </>
  ),

  // Visão geral: os números do mês — barras sobre a linha de base.
  painel: (
    <>
      <path d="M3.5 20.2h17" />
      <path d="M7.4 20.2v-4.8M12 20.2v-9.4M16.6 20.2v-13" />
    </>
  ),

  // Conversar: o balão. É a porta de entrada do produto inteiro.
  conversa: <path d="M20.3 14.6a2.5 2.5 0 0 1-2.5 2.5H8.4l-4.7 4.1V6.4a2.5 2.5 0 0 1 2.5-2.5h11.6a2.5 2.5 0 0 1 2.5 2.5Z" />,
  /* COMENTAR — o mesmo balão da conversa com as linhas do texto dentro.
     Existe porque os dois convivem no MESMO nó do quadro "Como foi feita":
     comentar aqui e pedir a mudança no chat eram dois ícones idênticos
     empilhados, com significados diferentes (visto na tela, 08/09/2026). */
  comentario: (
    <>
      <path d="M20.3 14.6a2.5 2.5 0 0 1-2.5 2.5H8.4l-4.7 4.1V6.4a2.5 2.5 0 0 1 2.5-2.5h11.6a2.5 2.5 0 0 1 2.5 2.5Z" />
      <path d="M8 9h8M8 12.4h5" />
    </>
  ),

  // Entregas: a caixa isométrica — o que sai pronto e espera o seu OK.
  entregas: (
    <>
      <path d="M12 3.3 20.4 8v8L12 20.7 3.6 16V8Z" />
      <path d="M3.6 8 12 12.7 20.4 8" />
      <path d="M12 12.7v8" />
    </>
  ),

  // Estúdio: a claquete — produção por peça, cena a cena.
  estudio: (
    <>
      <path d="M3.2 9.2h17.6v9.3a2.2 2.2 0 0 1-2.2 2.2H5.4a2.2 2.2 0 0 1-2.2-2.2Z" />
      <path d="M3.2 9.2V6.5a1.4 1.4 0 0 1 1.4-1.4h14.8a1.4 1.4 0 0 1 1.4 1.4v2.7" />
      <path d="m8.1 5.1-1.7 4.1M13.4 5.1l-1.7 4.1M18.7 5.1 17 9.2" />
    </>
  ),

  // Meses: a pasta do material que o dono sobe.
  meses: <path d="M3.4 6.6a2 2 0 0 1 2-2h3.3a2 2 0 0 1 1.6.8l1.1 1.5h7.2a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2Z" />,

  // Clientes: a carteira — duas pessoas, uma na frente da outra.
  clientes: (
    <>
      <circle cx="9.3" cy="8" r="3.3" />
      <path d="M15.4 20.3v-1.7a3.5 3.5 0 0 0-3.5-3.5H6.7a3.5 3.5 0 0 0-3.5 3.5v1.7" />
      <path d="M15.8 4.9a3.3 3.3 0 0 1 0 6.4" />
      <path d="M20.8 20.3v-1.7a3.5 3.5 0 0 0-2.6-3.4" />
    </>
  ),

  // Teste de segurança: escudo com a verificação dentro.
  seguranca: (
    <>
      <path d="M12 21.2s7.3-3.4 7.3-9.2V6.3L12 3.4 4.7 6.3v5.7c0 5.8 7.3 9.2 7.3 9.2Z" />
      <path d="m9.1 11.8 2 2 3.8-4.1" />
    </>
  ),

  // Casos: a balança — o ofício jurídico, sem o emoji de mensageiro.
  casos: (
    <>
      <path d="M12 4.6v15.6M8.2 20.2h7.6" />
      <path d="M4.6 8.2h14.8" />
      <path d="M4.6 8.2 2.4 13.4a2.5 2.5 0 0 0 4.4 0Z" />
      <path d="m19.4 8.2 2.2 5.2a2.5 2.5 0 0 1-4.4 0Z" />
    </>
  ),

  // Monitor: as ondas do sinal — prazos e movimentações chegando.
  monitor: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 15.8a5.4 5.4 0 0 0 0-7.6" />
      <path d="M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 18.6a9.3 9.3 0 0 0 0-13.2" />
    </>
  ),

  // Doutrina & Modelos: a pilha — a biblioteca de peças.
  biblioteca: (
    <>
      <rect x="3.4" y="4.3" width="17.2" height="4.3" rx="1.4" />
      <rect x="3.4" y="9.9" width="17.2" height="4.3" rx="1.4" />
      <rect x="3.4" y="15.5" width="17.2" height="4.3" rx="1.4" />
      <path d="M6.9 5.6v1.7M6.9 11.2v1.7M6.9 16.8v1.7" />
    </>
  ),

  // Oficina: o laço de código — sai, roda, volta.
  oficina: (
    <>
      <path d="M20.4 9.6A8.6 8.6 0 0 0 5.7 6.5L3.5 8.7" />
      <path d="M3.6 14.4a8.6 8.6 0 0 0 14.7 3.1l2.2-2.2" />
      <path d="M3.5 4.3v4.4h4.4M20.5 19.7v-4.4h-4.4" />
    </>
  ),

  // Agenda: o dia marcado — o que o escritório faz sozinho.
  agenda: (
    <>
      <rect x="3.4" y="5.4" width="17.2" height="15.2" rx="2.2" />
      <path d="M3.4 10.1h17.2M8.4 3.4v4M15.6 3.4v4" />
      <path d="M8.1 13.9h.01M12 13.9h.01M15.9 13.9h.01M8.1 17.3h.01M12 17.3h.01" />
    </>
  ),

  // O que eu já sei: a rede — regras, atividades e lições ligadas.
  conhecimento: (
    <>
      <circle cx="6.1" cy="7.4" r="2.5" />
      <circle cx="17.9" cy="9.5" r="2.5" />
      <circle cx="11.2" cy="18" r="2.5" />
      <path d="m8.55 7.85 6.85 1.2M16.35 11.55l-3.6 4.5M9.5 9.55l.9 6" />
    </>
  ),

  // Guia do escritório: o livro aberto — a última porta do menu.
  guia: (
    <>
      <path d="M12 7.1v12.8" />
      <path d="M12 7.1C10.6 5.7 8.7 5 6.2 5H3.6v12.6h2.6c2.5 0 4.4.7 5.8 2.1" />
      <path d="M12 7.1c1.4-1.4 3.3-2.1 5.8-2.1h2.6v12.6h-2.6c-2.5 0-4.4.7-5.8 2.1" />
    </>
  ),

  /* ---------- Chrome e bastidor ---------- */

  // Prédio: a metáfora inteira do produto — torre, anexo e chão.
  predio: (
    <>
      <path d="M4.6 20.4V5.4a1.5 1.5 0 0 1 1.5-1.5h7.3a1.5 1.5 0 0 1 1.5 1.5v15" />
      <path d="M14.9 10.4h3.4a1.5 1.5 0 0 1 1.5 1.5v8.5" />
      <path d="M2.8 20.4h18.4" />
      <path d="M7.6 7.8h1M11.3 7.8h1M7.6 11.4h1M11.3 11.4h1M7.6 15h1M11.3 15h1M17.2 14.2h.01M17.2 17.3h.01" />
    </>
  ),

  // Sala das máquinas: a engrenagem.
  config: (
    <>
      <circle cx="12" cy="12" r="2.6" />
      <circle cx="12" cy="12" r="6.1" />
      <path d="M12 3.3v2.4M12 18.3v2.4M20.7 12h-2.4M5.7 12H3.3M18.15 5.85l-1.7 1.7M7.55 16.45l-1.7 1.7M18.15 18.15l-1.7-1.7M7.55 7.55l-1.7-1.7" />
    </>
  ),

  // O trinco da gaveta no celular (era o caractere ☰).
  menu: <path d="M3.8 7h16.4M3.8 12h16.4M3.8 17h16.4" />,

  // O sino — mesmo desenho que SinoNotificacoes já usava, agora no set.
  sino: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),

  // A porta fechada: o estado vazio ("não foi possível abrir o escritório").
  porta: (
    <>
      <path d="M5.6 20.4V4.8a1.2 1.2 0 0 1 1.2-1.2h10.4a1.2 1.2 0 0 1 1.2 1.2v15.6" />
      <path d="M3.6 20.4h16.8" />
      <circle cx="14.9" cy="12.3" r="1" />
    </>
  ),

  // Setup: a prancheta com o primeiro item marcado.
  setup: (
    <>
      <path d="M9.2 4.6H7.6a2 2 0 0 0-2 2v11.9a2 2 0 0 0 2 2h8.8a2 2 0 0 0 2-2V6.6a2 2 0 0 0-2-2h-1.6" />
      <rect x="9.2" y="2.9" width="5.6" height="3.5" rx="1.2" />
      <path d="m9.4 13.3 1.9 1.9 3.6-4" />
    </>
  ),

  // Como foi feita: a genealogia da peça — fontes que viram cena que vira filme.
  fluxo: (
    <>
      <circle cx="5.4" cy="6.6" r="2.2" />
      <circle cx="5.4" cy="17.4" r="2.2" />
      <circle cx="12.4" cy="12" r="2.2" />
      <circle cx="19.2" cy="12" r="2.2" />
      <path d="m7.35 7.65 3.1 2.9M7.35 16.35l3.1-2.9M14.6 12h2.4" />
    </>
  ),

  // Uma pessoa (porta-voz, membro, autor).
  pessoa: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.9 20.4v-1.6a4.2 4.2 0 0 1 4.2-4.2h5.8a4.2 4.2 0 0 1 4.2 4.2v1.6" />
    </>
  ),

  // Voz / narração (os porta-vozes e o áudio da peça).
  voz: (
    <>
      <rect x="9.1" y="2.9" width="5.8" height="11.4" rx="2.9" />
      <path d="M5.5 11.6a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18.1v3.1" />
    </>
  ),

  /* ---------- Estado ---------- */

  check: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="m8.3 12.2 2.6 2.6 5-5.4" />
    </>
  ),
  alerta: (
    <>
      <path d="M12 4.1 21 19.3a1.4 1.4 0 0 1-1.2 2.1H4.2A1.4 1.4 0 0 1 3 19.3Z" />
      <path d="M12 10v4.2M12 17.7h.01" />
    </>
  ),
  erro: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
  relogio: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  loop: (
    <>
      <path d="M20.4 9.6A8.6 8.6 0 0 0 5.7 6.5L3.5 8.7" />
      <path d="M3.6 14.4a8.6 8.6 0 0 0 14.7 3.1l2.2-2.2" />
      <path d="M3.5 4.3v4.4h4.4M20.5 19.7v-4.4h-4.4" />
    </>
  ),
  // "Ao vivo" / execução acontecendo.
  raio: <path d="M13.4 2.8 4.6 13.4h6.3l-.3 7.8 8.8-10.6h-6.3Z" />,
  // O cálculo do fechamento (financas.py) no log ao vivo.
  calculadora: (
    <>
      <rect x="4.6" y="2.9" width="14.8" height="18.2" rx="2.2" />
      <path d="M8.2 6.9h7.6" />
      <path d="M8.4 11.4h.01M12 11.4h.01M15.6 11.4h.01M8.4 14.6h.01M12 14.6h.01M15.6 14.6h.01M8.4 17.8h.01M12 17.8h.01M15.6 17.8h.01" />
    </>
  ),
  // A impressão do PDF / do relatório.
  impressora: (
    <>
      <path d="M6.6 9.4V3.6h10.8v5.8" />
      <path d="M6.6 17.6H4.8a1.8 1.8 0 0 1-1.8-1.8v-4.6a1.8 1.8 0 0 1 1.8-1.8h14.4a1.8 1.8 0 0 1 1.8 1.8v4.6a1.8 1.8 0 0 1-1.8 1.8h-1.8" />
      <rect x="6.6" y="14.6" width="10.8" height="5.8" rx="1.4" />
    </>
  ),

  /* ---------- Verbos ---------- */

  baixar: (
    <>
      <path d="M20.4 15.6v3.4a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8v-3.4" />
      <path d="M7.6 10.8 12 15.2l4.4-4.4M12 15.2V3.4" />
    </>
  ),
  subir: (
    <>
      <path d="M20.4 15.6v3.4a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8v-3.4" />
      <path d="M7.6 7.8 12 3.4l4.4 4.4M12 3.4v11.8" />
    </>
  ),
  /* a tecla Enter - o mandar do composer da Mesa (upload e outro desenho) */
  enviar: (
    <>
      <path d="M19.4 5.2v6a2.4 2.4 0 0 1-2.4 2.4H4.9" />
      <path d="M9.1 9.4 4.9 13.6l4.2 4.2" />
    </>
  ),
  anexo: <path d="M20.3 11.4 12.5 19.2a5 5 0 0 1-7.1-7.1l8.4-8.4a3.3 3.3 0 1 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.8-7.7" />,
  play: <path d="M8.4 5.6 18.8 12 8.4 18.4Z" />,
  lupa: (
    <>
      <circle cx="10.9" cy="10.9" r="6.9" />
      <path d="m15.9 15.9 4.5 4.5" />
    </>
  ),
  lixeira: (
    <>
      <path d="M3.8 6.3h16.4" />
      <path d="M18.4 6.3v13a2 2 0 0 1-2 2H7.6a2 2 0 0 1-2-2v-13" />
      <path d="M8.8 6.3V4.6a1.8 1.8 0 0 1 1.8-1.8h2.8a1.8 1.8 0 0 1 1.8 1.8v1.7" />
      <path d="M10.4 11v6M13.6 11v6" />
    </>
  ),
  lapis: (
    <>
      <path d="M16.6 3.9a2.4 2.4 0 0 1 3.4 3.4L8.2 19.1l-4.5 1.1 1.1-4.5Z" />
      <path d="m14.9 5.6 3.4 3.4" />
    </>
  ),
  mais: <path d="M12 4.6v14.8M4.6 12h14.8" />,
  'seta-direita': <path d="M4.6 12h14.2M13 6.2l5.8 5.8-5.8 5.8" />,
  expandir: <path d="M8.8 3.6H4.6a1 1 0 0 0-1 1v4.2M15.2 3.6h4.2a1 1 0 0 1 1 1v4.2M20.4 15.2v4.2a1 1 0 0 1-1 1h-4.2M3.6 15.2v4.2a1 1 0 0 0 1 1h4.2" />,
  /* O PAR do expandir — cantos apontando para dentro. Sem ele, entrar e sair
     da tela cheia ficavam com o MESMO ícone e a diferença só existia no
     `title`: o botão dizia a mesma coisa nos dois estados. */
  contrair: <path d="M3.6 8.8h4.2a1 1 0 0 0 1-1V3.6M20.4 8.8h-4.2a1 1 0 0 1-1-1V3.6M15.2 20.4v-4.2a1 1 0 0 1 1-1h4.2M8.8 20.4v-4.2a1 1 0 0 0-1-1H3.6" />,
  /* Restaurar/voltar uma versão. NÃO é o 'loop' (↻ = refazer, gastar de novo):
     a seta que retorna diz desfazer, e a diferença importa num botão que
     mexe no trabalho já entregue. */
  desfazer: (
    <>
      <path d="M3.6 7.2v5.4h5.4" />
      <path d="M5.85 12.6a7.9 7.9 0 1 0 1.9-5.1L3.6 11.1" />
    </>
  ),
  /* O par de polegares: o feedback do advogado sobre uma resposta ou peça.
     Não dá para reusar 'visto'/'fechar' — aprovar e ACHAR BOM são coisas
     diferentes no produto: o OK libera a entrega, o polegar vira lição. */
  'polegar-cima': (
    <>
      <path d="M6.9 21.1V10.4" />
      <path d="M6.9 10.4h3.7l1.5-5.5a2.2 2.2 0 0 1 4.3.6v4.9h3.1a2 2 0 0 1 2 2.4l-1.3 6.4a2 2 0 0 1-2 1.6H6.9Z" />
    </>
  ),
  'polegar-baixo': (
    <>
      <path d="M6.9 2.9v10.7" />
      <path d="M6.9 13.6h3.7l1.5 5.5a2.2 2.2 0 0 0 4.3-.6v-4.9h3.1a2 2 0 0 0 2-2.4l-1.3-6.4a2 2 0 0 0-2-1.6H6.9Z" />
    </>
  ),
  copiar: (
    <>
      <rect x="8.6" y="8.6" width="11.8" height="11.8" rx="2.2" />
      <path d="M15.4 8.6V5.8a2.2 2.2 0 0 0-2.2-2.2H5.8a2.2 2.2 0 0 0-2.2 2.2v7.4a2.2 2.2 0 0 0 2.2 2.2h2.8" />
    </>
  ),
  olho: (
    <>
      <path d="M2.4 12S6.2 5.4 12 5.4 21.6 12 21.6 12 17.8 18.6 12 18.6 2.4 12 2.4 12Z" />
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
  // "Pedir para a IA": a fagulha. NÃO é decorativo — marca a ação que gasta.
  ia: (
    <>
      <path d="M12 3.2 13.7 9l5.8 1.7-5.8 1.7L12 18.2l-1.7-5.8L4.5 10.7 10.3 9Z" />
      <path d="M18.6 3.4v3M20.1 4.9h-3M6 17.4v2.4M7.2 18.6H4.8" />
    </>
  ),
  microfone: (
    <>
      <rect x="9.1" y="2.9" width="5.8" height="11.4" rx="2.9" />
      <path d="M5.5 11.6a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18.1v3.1M8.6 21.2h6.8" />
    </>
  ),
  ampulheta: (
    <>
      <path d="M6.6 3.4h10.8M6.6 20.6h10.8" />
      <path d="M7.6 3.4v3.3c0 1 .4 1.9 1.1 2.6L12 12l-3.3 2.7c-.7.7-1.1 1.6-1.1 2.6v3.3" />
      <path d="M16.4 3.4v3.3c0 1-.4 1.9-1.1 2.6L12 12l3.3 2.7c.7.7 1.1 1.6 1.1 2.6v3.3" />
    </>
  ),
  pausa: <path d="M9.2 4.6v14.8M14.8 4.6v14.8" />,
  parar: <rect x="5.2" y="5.2" width="13.6" height="13.6" rx="2.4" />,
  /* O X e o ✓ NUS — sem o círculo do 'erro'/'check'. São os dois verbos do
     portão humano ("aprovar" / "rejeitar") e o fechar de todo modal. */
  fechar: <path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8" />,
  visto: <path d="m4.8 12.6 4.6 4.6L19.2 7" />,

  /* ---------- Objetos do escritório ---------- */

  email: (
    <>
      <rect x="2.9" y="4.9" width="18.2" height="14.2" rx="2.4" />
      <path d="m3.4 7 7.4 5.3a2 2 0 0 0 2.4 0L20.6 7" />
    </>
  ),
  celular: (
    <>
      <rect x="6.4" y="2.6" width="11.2" height="18.8" rx="2.6" />
      <path d="M10.6 18.4h2.8" />
    </>
  ),
  // O CÂNON: a lei do escritório. Pergaminho — o documento que manda.
  canon: (
    <>
      <path d="M7.4 3.6h10.8a1.8 1.8 0 0 1 1.8 1.8v13a2.6 2.6 0 0 0 2.6 2.6H7.4Z" />
      <path d="M7.4 3.6a2.6 2.6 0 0 0-2.6 2.6v12.2a2.6 2.6 0 0 0 2.6 2.6" />
      <path d="M10.6 8h6M10.6 11.6h6M10.6 15.2h3.4" />
    </>
  ),
  ideia: (
    <>
      <path d="M9.2 17.4a6.4 6.4 0 1 1 5.6 0" />
      <path d="M9.4 17.4h5.2v1.8a2.6 2.6 0 0 1-2.6 2.6 2.6 2.6 0 0 1-2.6-2.6Z" />
    </>
  ),
  bussola: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="m15.6 8.4-2 5.6-5.6 2 2-5.6Z" />
    </>
  ),
  cadeado: (
    <>
      <rect x="4.4" y="10.4" width="15.2" height="10.4" rx="2.4" />
      <path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" />
    </>
  ),
  chave: (
    <>
      <circle cx="7.9" cy="16.1" r="3.9" />
      <path d="m10.7 13.3 8.4-8.4M16.3 7.7l2.4 2.4M14.1 9.9l2.4 2.4" />
    </>
  ),
  paleta: (
    <>
      <path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.2 0 1.9-.8 1.9-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.9-1.8h1.9a4.4 4.4 0 0 0 4.4-4.4c0-3.8-4-6.8-9.1-6.8Z" />
      <path d="M7.2 11.2h.01M10.2 7.8h.01M14.4 7.8h.01M17.4 11.2h.01" />
    </>
  ),
  audio: (
    <>
      <path d="M11.4 4.6 6.9 8.4H3.6v7.2h3.3l4.5 3.8Z" />
      <path d="M16 8.8a4.6 4.6 0 0 1 0 6.4M18.9 6.2a8.4 8.4 0 0 1 0 11.6" />
    </>
  ),
  computador: (
    <>
      <rect x="2.9" y="4.2" width="18.2" height="12.4" rx="2.2" />
      <path d="M8.4 20.4h7.2M12 16.6v3.8" />
    </>
  ),
  conector: (
    <>
      <path d="M9.4 2.9v4.4M14.6 2.9v4.4" />
      <path d="M7.4 7.3h9.2v4.2a4.6 4.6 0 0 1-4.6 4.6 4.6 4.6 0 0 1-4.6-4.6Z" />
      <path d="M12 16.1v5" />
    </>
  ),
  // Estado vazio de "ainda não plantamos nada aqui".
  broto: (
    <>
      <path d="M12 20.6v-7.4" />
      <path d="M12 13.2C12 9.6 9.1 6.7 5.5 6.7c0 3.6 2.9 6.5 6.5 6.5Z" />
      <path d="M12.6 12.6c0-3.2 2.6-5.8 5.9-5.8 0 3.2-2.6 5.8-5.9 5.8Z" />
    </>
  ),

  /* ---------- Tipos de arquivo ----------
     Todos partem da MESMA folha com a dobra: o que muda é o que está
     escrito nela. Assim uma lista de entregas lê como uma pilha de
     papéis de tipos diferentes, não como uma feira de ícones. */

  'arq-documento': (
    <>
      <path d="M13.8 3.4H7.4a2 2 0 0 0-2 2v13.2a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6Z" />
      <path d="M13.8 3.4v5.2h4.8" />
      <path d="M8.6 13h6.8M8.6 16.4h4.4" />
    </>
  ),
  'arq-planilha': (
    <>
      <path d="M13.8 3.4H7.4a2 2 0 0 0-2 2v13.2a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6Z" />
      <path d="M13.8 3.4v5.2h4.8" />
      <path d="M8.4 12.4h7.2M8.4 16.2h7.2M12 12.4v7.4" />
    </>
  ),
  'arq-pdf': (
    <>
      <path d="M13.8 3.4H7.4a2 2 0 0 0-2 2v13.2a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6Z" />
      <path d="M13.8 3.4v5.2h4.8" />
      <path d="M9.4 11.8h1.6a1.6 1.6 0 0 1 0 3.2H9.4v3.2" />
      <path d="M13.6 11.8v6.4h1.2a1.8 1.8 0 0 0 1.8-1.8v-2.8a1.8 1.8 0 0 0-1.8-1.8Z" />
    </>
  ),
  'arq-slides': (
    <>
      <rect x="3.4" y="4.4" width="17.2" height="11.4" rx="2" />
      <path d="M12 15.8v3.2M8.4 21h7.2" />
      <path d="M8.2 11.6l2.6-2.8 2.2 2.2 2.8-3.2" />
    </>
  ),
  'arq-imagem': (
    <>
      <rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.4" />
      <circle cx="8.9" cy="9.8" r="1.8" />
      <path d="m3.8 17.2 4.7-4.4a2 2 0 0 1 2.7 0l6.9 6.5" />
    </>
  ),
  'arq-video': (
    <>
      <rect x="2.8" y="5.6" width="12.8" height="12.8" rx="2.4" />
      <path d="m15.6 10.6 5.6-3.2v9.2l-5.6-3.2Z" />
    </>
  ),
  'arq-zip': (
    <>
      <path d="M13.8 3.4H7.4a2 2 0 0 0-2 2v13.2a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6Z" />
      <path d="M13.8 3.4v5.2h4.8" />
      <path d="M11 3.6v1.6M13 5.2v1.6M11 6.8v1.6M13 8.4V10M11 10v1.6" />
      <rect x="10.2" y="13.2" width="3.6" height="4.4" rx="1.2" />
    </>
  ),
  'arq-web': (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M3.4 12h17.2" />
      <path d="M12 3.4a13.2 13.2 0 0 1 0 17.2 13.2 13.2 0 0 1 0-17.2Z" />
    </>
  ),
  'arq-texto': (
    <>
      <path d="M13.8 3.4H7.4a2 2 0 0 0-2 2v13.2a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6Z" />
      <path d="M13.8 3.4v5.2h4.8" />
      <path d="M8.6 12.2h4M8.6 15.4h6.8M8.6 18.2h5.2" />
    </>
  ),
  'arq-pasta': <path d="M3.4 6.6a2 2 0 0 1 2-2h3.3a2 2 0 0 1 1.6.8l1.1 1.5h7.2a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2Z" />,

  /* ---------- Ofícios (os cartões de escritório) ---------- */

  // Conteúdo & Marca: a pena.
  'oficio-conteudo': (
    <>
      <path d="M20.4 3.6C13.8 4.4 8.6 7.4 6.6 12.2c-1.4 3.4-1 6-1 6s2.2-2.2 5.4-2.8c5.2-1 8.6-6 9.4-11.8Z" />
      <path d="M4.4 20.4c1.2-3.4 3.6-6.4 6.8-8.4" />
    </>
  ),
  // Financeiro: a coluna com a seta de tendência.
  'oficio-financeiro': (
    <>
      <path d="M3.6 20.2h16.8" />
      <path d="M7 20.2v-5.6M12 20.2v-9M17 20.2v-13" />
      <path d="M4.4 11.4 8.8 7l3.4 3.4 6-6" />
    </>
  ),
  // Jurídico: a mesma balança dos Casos — um ofício, um sinal.
  'oficio-juridico': (
    <>
      <path d="M12 4.6v15.6M8.2 20.2h7.6" />
      <path d="M4.6 8.2h14.8" />
      <path d="M4.6 8.2 2.4 13.4a2.5 2.5 0 0 0 4.4 0Z" />
      <path d="m19.4 8.2 2.2 5.2a2.5 2.5 0 0 1-4.4 0Z" />
    </>
  ),
}

/** Existe desenho para esta chave? (o `abas.ts` usa para validar o manifesto) */
export function ehNomeDeIcone(nome: string): nome is NomeIcone {
  return Object.prototype.hasOwnProperty.call(TRACOS, nome)
}

/** Dos tipos de arquivo, pelo nome do arquivo. Uma fonte só — a lista de
 *  entregas, o dashboard e o acervo pediam o mesmo ícone em três lugares. */
export function iconeDoArquivo(nome: string): NomeIcone {
  const ext = nome.split('.').pop()?.toLowerCase() ?? ''
  if (['html', 'htm'].includes(ext)) return 'arq-web'
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'arq-documento'
  if (['xls', 'xlsx', 'ods', 'csv', 'tsv'].includes(ext)) return 'arq-planilha'
  if (ext === 'pdf') return 'arq-pdf'
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return 'arq-slides'
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp'].includes(ext)) return 'arq-imagem'
  if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'].includes(ext)) return 'arq-video'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'arq-zip'
  if (['md', 'txt', 'json', 'yml', 'yaml', 'log'].includes(ext)) return 'arq-texto'
  return 'arq-pasta'
}

export interface IconeProps {
  /** Chave do set. Uma string desconhecida (emoji do manifesto) sai como texto. */
  nome: NomeIcone | string
  /** Lado do quadrado, em px. O padrão 20 é o do menu lateral. */
  tamanho?: number
  className?: string
  /** Rótulo para leitor de tela. SEM ele o ícone é decorativo (aria-hidden) —
   *  que é o certo quando o nome vem escrito ao lado, como no menu. */
  titulo?: string
  /** Espessura do traço. Só mexa em tamanhos grandes, onde 1.7 fica gordo. */
  traco?: number
}

export function Icone({ nome, tamanho = 20, className, titulo, traco = 1.7 }: IconeProps) {
  const desenho = ehNomeDeIcone(nome) ? TRACOS[nome] : null

  // Escape do manifesto: sem desenho, o que veio (emoji, letra) sai como texto
  // no mesmo espaço — a linha do menu não desalinha.
  if (!desenho) {
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', width: tamanho, height: tamanho, alignItems: 'center', justifyContent: 'center', fontSize: tamanho * 0.9, lineHeight: 1 }}
        {...(titulo ? { role: 'img', 'aria-label': titulo } : { 'aria-hidden': true })}
      >
        {nome}
      </span>
    )
  }

  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={traco}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      focusable="false"
      {...(titulo ? { role: 'img', 'aria-label': titulo } : { 'aria-hidden': true })}
    >
      {desenho}
    </svg>
  )
}
