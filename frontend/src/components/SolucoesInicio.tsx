import { localizarInicio, useTextoInicio } from '../lib/i18nInicio'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../lib/api'
import type { InicioOrganizacao, PreferenciaSolucao, SolucaoInicio } from '../lib/inicio'
import { Icone, type NomeIcone } from './Icone'
import './solucoes-inicio.css'

const ICONES: Record<SolucaoInicio['tipo'], NomeIcone> = {
  video: 'arq-video', apresentacao: 'arq-slides', juridico: 'arq-documento',
  conteudo: 'arq-imagem', diagnostico: 'lupa', tarefa: 'entregas',
}

type AlterarPreferencia = (solucao: SolucaoInicio, preferencia: PreferenciaSolucao) => void

function PreferenciasSolucao({ solucao, aoAlterar, ocupado }: {
  solucao: SolucaoInicio
  aoAlterar?: AlterarPreferencia
  ocupado: boolean
}) {
  const { texto } = useTextoInicio()
  if (solucao.origem !== 'aprendida') return null
  return (
    <div className="inicio-solucao-preferencias">
      <span className="inicio-solucao-origem"><Icone nome="conversa" tamanho={13} />{texto("Aprendido na conversa")}</span>
      {aoAlterar && <div className="inicio-solucao-controles">
        <button type="button" disabled={ocupado} aria-pressed={Boolean(solucao.fixada)} aria-label={`${solucao.fixada ? texto("Desfixar") : texto("Fixar")}: ${solucao.titulo}`} onClick={() => aoAlterar(solucao, { fixada: !solucao.fixada })}>
          {solucao.fixada && <Icone nome="check" tamanho={12} />}{solucao.fixada ? texto("Desfixar") : texto("Fixar")}
        </button>
        <button type="button" disabled={ocupado} aria-label={`${texto('Ocultar')}: ${solucao.titulo}`} onClick={() => aoAlterar(solucao, { oculta: true })}>{texto("Ocultar")}</button>
      </div>}
    </div>
  )
}

function MotivoSolucao({ motivo }: { motivo?: string }) {
  return motivo ? <p className="inicio-solucao-motivo"><Icone nome="bussola" tamanho={13} /><span>{motivo}</span></p> : null
}

function CartaoSolucao({ solucao, aoEscolher, aoAlterar, ocupado }: {
  solucao: SolucaoInicio
  aoEscolher: (prompt: string) => void
  aoAlterar?: AlterarPreferencia
  ocupado: boolean
}) {
  const { texto } = useTextoInicio()
  return (
    <article className="inicio-sugestao">
      <button type="button" className="inicio-sugestao-escolher" data-solucao-iniciar={solucao.id} onClick={() => aoEscolher(solucao.prompt)} aria-label={`${texto('Começar')}: ${solucao.titulo}`}>
        <Icone nome={ICONES[solucao.tipo]} tamanho={20} />
        <span><strong>{solucao.titulo}</strong><span>{solucao.descricao}</span></span>
        <Icone nome="seta-direita" tamanho={18} />
      </button>
      {solucao.origem === 'aprendida' && <MotivoSolucao motivo={solucao.motivo} />}
      <PreferenciasSolucao solucao={solucao} aoAlterar={aoAlterar} ocupado={ocupado} />
    </article>
  )
}

/** Ocupa o estado inicial da conversa, sem criar um segundo compositor.
 * Escolher apenas preenche o campo; enviar e iniciar trabalho são explícitos. */
export function SolucoesInicio({ inicio, aoEscolher, aoAtualizarSolucao }: {
  inicio: InicioOrganizacao
  aoEscolher: (prompt: string) => void
  aoAtualizarSolucao?: (id: string, preferencia: PreferenciaSolucao) => Promise<void>
}) {
  const { texto, idioma } = useTextoInicio()
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const [verOcultas, setVerOcultas] = useState(false)
  const [pendente, setPendente] = useState<string | null>(null)
  const [erroPreferencia, setErroPreferencia] = useState<string | null>(null)
  const [avisoPreferencia, setAvisoPreferencia] = useState<string | null>(null)
  const [focoPendente, setFocoPendente] = useState<{ id: string; ocultar: boolean; origem: Element | null } | null>(null)
  const raizRef = useRef<HTMLDivElement | null>(null)
  const tituloRef = useRef<HTMLHeadingElement | null>(null)
  const ocultasRef = useRef<HTMLButtonElement | null>(null)
  const localizado = localizarInicio(inicio, idioma)
  const { sabatina, solucoes, outras_solucoes: outras } = localizado
  const ocultas = (localizado.solucoes_ocultas ?? []).filter((solucao) => solucao.origem === 'aprendida')
  const conhecendo = sabatina.estado !== 'contextualizado' && !sabatina.perfil_preparado && !sabatina.conduzida_pelo_offiz
  const podeCriarConteudo = !conhecendo && inicio.andares.some(andar => andar.slug === 'conteudo' && !andar.arquivado)
  useEffect(() => {
    if (!focoPendente) return
    // Uma atualização lenta não rouba o foco de quem já voltou a escrever.
    if (document.activeElement === document.body || document.activeElement === focoPendente.origem) {
      const inicioRestaurado = [...(raizRef.current?.querySelectorAll<HTMLButtonElement>('[data-solucao-iniciar]') ?? [])]
        .find((botao) => botao.dataset.solucaoIniciar === focoPendente.id)
      const alvo = focoPendente.ocultar ? ocultasRef.current : inicioRestaurado
      ;(alvo || tituloRef.current)?.focus()
    }
    setFocoPendente(null)
  }, [focoPendente])
  async function alterar(solucao: SolucaoInicio, preferencia: PreferenciaSolucao) {
    if (!aoAtualizarSolucao || pendente || solucao.origem !== 'aprendida') return
    setPendente(solucao.id)
    setErroPreferencia(null)
    setAvisoPreferencia(null)
    const origem = document.activeElement
    try {
      await aoAtualizarSolucao(solucao.id, preferencia)
      if (preferencia.oculta !== undefined) setFocoPendente({ id: solucao.id, ocultar: preferencia.oculta, origem })
      setAvisoPreferencia(
        preferencia.oculta === true ? texto("Sugestão ocultada. Você pode restaurá-la em Sugestões ocultas.")
          : preferencia.oculta === false ? texto("Sugestão restaurada.")
            : preferencia.fixada ? texto("Sugestão fixada no início.") : texto("Sugestão desfixada."),
      )
    } catch (e) {
      setErroPreferencia(e instanceof ApiError ? e.detail : texto("Não foi possível salvar sua preferência. Tente novamente."))
    } finally {
      setPendente(null)
    }
  }
  const aoAlterar: AlterarPreferencia | undefined = aoAtualizarSolucao ? (solucao, preferencia) => { void alterar(solucao, preferencia) } : undefined
  return (
    <div className="inicio-solucoes" ref={raizRef}>
      <div className="inicio-apresentacao"><h1>{conhecendo ? texto("Vamos começar pelo que você precisa.") : texto("O que vamos fazer hoje?")}</h1><p>{conhecendo ? texto("Conte o que precisa. Vamos preparar o próximo passo juntos.") : texto("Peça com suas palavras. Seu perfil, suas referências e os ajustes anteriores orientam o trabalho.")}</p></div>
      {conhecendo && sabatina.opcoes.some(opcao => !solucoes.some(s => s.id === opcao.id)) && <div className="inicio-onboarding">
        {sabatina.opcoes.filter(opcao => !solucoes.some(s => s.id === opcao.id)).slice(0, 1).map(opcao => <button type="button" className="botao botao-fantasma botao-pequeno" key={opcao.id} aria-pressed={escolhida === opcao.id} onClick={() => { setEscolhida(opcao.id); aoEscolher(opcao.prompt) }}>{opcao.label}</button>)}
      </div>}
      {erroPreferencia && <p className="inicio-preferencia-erro" role="alert"><Icone nome="alerta" tamanho={16} /><span>{erroPreferencia}</span></p>}
      {avisoPreferencia && <p className="sr-only" role="status">{avisoPreferencia}</p>}
      {solucoes.length > 0 || outras.length > 0 || ocultas.length > 0 ? (
        <section className="inicio-catalogo" aria-label={texto('Próximos passos')}>
          <h2 className="sr-only" id="inicio-solucoes-titulo" ref={tituloRef} tabIndex={-1}>{texto('Próximos passos')}</h2>
          {solucoes.length > 0 && <div className={`inicio-sugestoes${solucoes.length >= 4 ? ' inicio-sugestoes--quatro' : ''}`}>{solucoes.slice(0, 4).map((solucao) => <CartaoSolucao key={solucao.id} solucao={solucao} aoEscolher={aoEscolher} aoAlterar={aoAlterar} ocupado={pendente !== null} />)}</div>}
          {podeCriarConteudo && <div className="inicio-pauta-livre">
            <p>{texto('Sem uma ideia hoje? O escritório pode escolher uma pauta para o seu público.')}</p>
            <button type="button" className="botao-texto" onClick={() => aoEscolher(texto('Faz um post para esta semana. Pode escolher o tema.'))}>{texto('Escolher uma pauta por mim')}</button>
          </div>}
          {outras.length > 0 && <details className="inicio-outras">
            <summary>{texto('Outros pedidos')}</summary>
            <div className="inicio-outras-lista">{outras.map(solucao => <div key={solucao.id} className="inicio-outra-solucao">
              <button className="inicio-outra-escolher" type="button" data-solucao-iniciar={solucao.id} onClick={() => aoEscolher(solucao.prompt)}><Icone nome={ICONES[solucao.tipo]} tamanho={17} /><span>{solucao.titulo}</span></button>
              <PreferenciasSolucao solucao={solucao} aoAlterar={aoAlterar} ocupado={pendente !== null} />
            </div>)}</div>
          </details>}
          {ocultas.length > 0 && <div className="inicio-ocultas">
            <button className="inicio-outras-toggle" type="button" ref={ocultasRef} aria-expanded={verOcultas} aria-controls="inicio-solucoes-ocultas" onClick={() => setVerOcultas(!verOcultas)}><Icone nome="olho" tamanho={15} />{texto('Sugestões ocultas')} ({ocultas.length})</button>
            {verOcultas && <ul id="inicio-solucoes-ocultas" className="inicio-ocultas-lista">{ocultas.map((solucao) => <li key={solucao.id}>
              <div><strong>{solucao.titulo}</strong><MotivoSolucao motivo={solucao.motivo} /></div>
              {aoAlterar && <button type="button" disabled={pendente !== null} aria-label={`${texto('Restaurar')}: ${solucao.titulo}`} onClick={() => aoAlterar(solucao, { oculta: false })}>{texto("Restaurar")}</button>}
            </li>)}</ul>}
          </div>}
        </section>
      ) : (
        <div className="inicio-sem-solucoes"><Icone nome="ideia" tamanho={24} /><div><h2>{texto("Seu primeiro pedido ajuda a montar o escritório.")}</h2><p>{texto("Descreva o resultado que você espera. Vamos esclarecer o que falta e o que precisa ser preparado para entregar.")}</p></div></div>
      )}
      {(solucoes.length > 0 || outras.length > 0) && <p className="inicio-compromisso"><Icone nome="visto" tamanho={17} /><span>{texto("Escolher uma sugestão prepara a mensagem. Confira o pedido e envie; a entrega fica disponível para sua revisão.")}</span></p>}
      {!conhecendo && <button type="button" className="botao-texto" onClick={() => aoEscolher(texto('Quero rever o que você sabe sobre minha empresa.'))}>{texto('Rever meu perfil')}</button>}
    </div>
  )
}
