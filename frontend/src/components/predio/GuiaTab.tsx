import { useTextoEscritorio } from '../../lib/i18nEscritorios'
/* ------------------------------------------------------------------ */
/* Guia do escritório — a última porta do menu, de propósito.           */
/*                                                                     */
/* Duas partes: COMO o escritório trabalha (o laço pedir → trabalhar →  */
/* entregar → revisar) e OS 7 C's — a mobília que faz um agente de IA   */
/* funcionar, cada um com a tradução pro Offiz e o móvel correspondente */
/* (do handoff Adamá). É material de consulta, não de operação: quem já */
/* entendeu nunca mais precisa abrir.                                   */
/* ------------------------------------------------------------------ */

import { Icone } from '../Icone'

type PassoLaco = { icone: string; titulo: string; texto: string }

const LACO: PassoLaco[] = [
  {
    icone: 'conversa',
    titulo: 'Você pede',
    texto: 'Na aba Conversa, do seu jeito — pode anexar arquivos e mandar áudio.',
  },
  {
    icone: 'config',
    titulo: 'A equipe trabalha',
    texto: 'Os agentes seguem as suas regras e usam os materiais da sua empresa.',
  },
  {
    icone: 'entregas',
    titulo: 'A entrega chega',
    texto: 'Em Pedidos e entregas, para você ver, baixar e dar o seu OK — nada sai sem ele.',
  },
  {
    icone: 'conhecimento',
    titulo: 'Seu feedback fica registrado',
    texto: 'O feedback fica registrado. Lições para os próximos trabalhos precisam ser revisadas e confirmadas.',
  },
]

type SeteC = {
  /** O nome técnico do C — o guia existe para explicar estes nomes. */
  chip: string
  nome: string
  /** O que este C é DENTRO do Offiz, na linguagem do dono. */
  noOffiz: string
  /** A mobília: o móvel do escritório que faz o mesmo papel. */
  mobilia: string
  /** Aba onde este C mora, quando existe uma tela para ele. */
  alvo?: string
  rotuloAlvo?: string
  /** true = C do DONO (24/08/2026): não é peça da máquina, é o que o dono
   *  sente no bolso e na pele — Custo e Confiança ganham destaque próprio. */
  doDono?: boolean
}

const SETE_CS: SeteC[] = [
  {
    chip: 'C_instructions',
    nome: 'Instruções',
    noOffiz: 'A lei do escritório: as regras que você dá e que valem em todo trabalho (o Cânon).',
    mobilia: 'o manual aberto na mesa do chefe',
    alvo: 'conhecimento',
    rotuloAlvo: 'ver as suas regras',
  },
  {
    chip: 'C_knowledge',
    nome: 'Conhecimento',
    noOffiz: 'Os arquivos que ele consulta: os materiais e documentos da sua empresa.',
    mobilia: 'a estante de livros',
    alvo: 'conhecimento',
    rotuloAlvo: 'ver os materiais',
  },
  {
    chip: 'C_tools',
    nome: 'Ferramentas',
    noOffiz: 'Os conectores e habilidades que a equipe usa para produzir o trabalho.',
    mobilia: 'o painel de cabos',
  },
  {
    chip: 'C_tasks',
    nome: 'Tarefas',
    noOffiz: 'A fila de trabalho: o que foi pedido, o que está rodando e o que já saiu.',
    mobilia: 'o kanban na parede',
    alvo: 'inicio',
    rotuloAlvo: 'ver a visão geral',
  },
  {
    chip: 'C_memory',
    nome: 'Memória',
    noOffiz: 'As lições e preferências registradas a partir dos seus feedbacks.',
    mobilia: 'o arquivo de gavetas',
    alvo: 'conhecimento',
    rotuloAlvo: 'ver as lições registradas',
  },
  {
    chip: 'C_state',
    nome: 'Estado',
    noOffiz: 'O que está rodando agora, ao vivo — e o que espera o seu OK.',
    mobilia: 'as bandejas de papel',
    alvo: 'inicio',
    rotuloAlvo: 'ver o que roda agora',
  },
  {
    chip: 'C_query',
    nome: 'Consulta',
    noOffiz: 'O pedido que entra: a sua conversa é o balcão de entrada de tudo.',
    mobilia: 'o pedestal de entrada',
    alvo: 'conversa',
    rotuloAlvo: 'abrir a conversa',
  },
  // ── Os DOIS C's do dono (24/08/2026): não são peças da máquina — são o
  // que se compra. É por eles que a apresentação comercial fecha em 9.
  {
    chip: 'C_cost',
    nome: 'Custo',
    noOffiz:
      'Confira o orçamento, os limites e o consumo registrado. Conversa e pesquisa também podem consumir saldo; valores ainda sem confirmação precisam de conferência.',
    mobilia: 'a etiqueta de preço antes do caixa',
    alvo: 'estudio',
    rotuloAlvo: 'ver o portão no Estúdio',
    doDono: true,
  },
  {
    chip: 'C_trust',
    nome: 'Confiança',
    noOffiz:
      'Confira os arquivos, a atividade, as fontes e as decisões disponíveis na entrega antes de aprovar o resultado.',
    mobilia: 'o carimbo de conferido',
    alvo: 'entregas',
    rotuloAlvo: 'ver e aprovar entregas',
    doDono: true,
  },
]

export function GuiaTab({
  aoNavegar,
  podeVerConhecimento = false,
}: {
  /** Navega para uma aba da shell (ids da ShellSimples). */
  aoNavegar: (aba: string) => void
  /** O 🧠 é bastidor de owner/admin — sem ele, o atalho não aparece. */
  podeVerConhecimento?: boolean
}) {
  const tx = useTextoEscritorio()
  return (
    <div className="guia">
      <p className="guia-intro"> {tx("Este escritório funciona num laço simples — você pede, a equipe trabalha, a entrega chega e seu feedback orienta os próximos trabalhos. Aqui embaixo, o mapa completo: os passos do laço e as nove peças (os")}{' '}
        <strong>{tx("9 C’s")}</strong>{tx(") que fazem tudo isso acontecer — sete da máquina e duas suas.")} </p>

      <section className="guia-bloco">
        <h3>{tx("Como o escritório trabalha")}</h3>
        <ol className="guia-laco">
          {LACO.map((p, i) => (
            <li key={p.titulo} className="guia-passo">
              <span className="guia-passo-numero" aria-hidden="true">
                {i + 1}
              </span>
              <span className="guia-passo-icone" aria-hidden="true">
                <Icone nome={p.icone} />
              </span>
              <div className="guia-passo-texto">
                <strong>{tx(p.titulo)}</strong>
                <p className="texto-suave">{tx(p.texto)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="guia-bloco">
        <h3>{tx("Os 9 C’s — a mobília do escritório (e as duas peças que são SUAS)")}</h3>
        <p className="texto-suave guia-explica"> {tx("Todo agente de IA que funciona de verdade tem as sete primeiras peças — cada uma é um móvel do escritório, com uma tela onde você a vê trabalhando. As duas últimas são do dono: acompanhar custos e conferir o resultado e os registros disponíveis.")} </p>
        <ul className="guia-cs">
          {SETE_CS.map((c) => {
            const alvoVisivel =
              c.alvo && (c.alvo !== 'conhecimento' || podeVerConhecimento) ? c.alvo : null
            return (
              <li key={c.chip} className={c.doDono ? "guia-c guia-c--dono" : "guia-c"}>
                <div className="guia-c-topo">
                  <strong className="guia-c-nome">{tx(c.nome)}</strong>
                  <code className="guia-c-chip">{c.chip}</code>
                </div>
                <p className="guia-c-offiz">{tx(c.noOffiz)}</p>
                <p className="guia-c-mobilia texto-suave">
                  <span aria-hidden="true">🪑</span> {tx("A mobília:")} {tx(c.mobilia)}.
                </p>
                {alvoVisivel && (
                  <button
                    type="button"
                    className="botao-texto guia-c-atalho"
                    onClick={() => aoNavegar(alvoVisivel)}
                  >
                    {tx(c.rotuloAlvo ?? '')} →
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
