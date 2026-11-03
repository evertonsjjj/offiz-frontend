import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useIdioma } from '../lib/i18n'
import DialogoArquivo from './predio/DialogoArquivo'
import './confirmacao.css'

export type PedidoConfirmacao = {
  titulo: string
  mensagem: string
  acao: string
  perigoso?: boolean
}

export type PedidoTexto = PedidoConfirmacao & {
  rotulo: string
  valorInicial?: string
  tipo?: 'text' | 'email' | 'number'
  maxLength?: number
  aceitarVazio?: boolean
  validar?: (valor: string) => string | null
}

type Resposta = boolean | string | null
type ConfirmacaoPendente = PedidoConfirmacao & {
  id: number
  escopo: string
  campo?: PedidoTexto
  resolver: (resposta: Resposta) => void
}

function ConteudoDialogo({ pedido, responder }: {
  pedido: ConfirmacaoPendente
  responder: (id: number, resposta: Resposta) => void
}) {
  const { t } = useIdioma()
  const [valor, setValor] = useState(pedido.campo?.valorInicial ?? '')
  const [erro, setErro] = useState('')
  const erroId = useId()
  return <form onSubmit={event => {
    event.preventDefault()
    if (!pedido.campo) { responder(pedido.id, true); return }
    const texto = valor.trim()
    const problema = !texto && !pedido.campo.aceitarVazio
      ? t('Preencha o campo para continuar.', 'Fill in the field to continue.')
      : pedido.campo.validar?.(texto)
    if (problema) { setErro(problema); return }
    responder(pedido.id, texto)
  }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controles = event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')
    const primeiro = controles[0], ultimo = controles[controles.length - 1]
    if (event.shiftKey && document.activeElement === primeiro) {
      event.preventDefault(); ultimo?.focus()
    } else if (!event.shiftKey && document.activeElement === ultimo) {
      event.preventDefault(); primeiro?.focus()
    }
  }}>
    <h2>{pedido.titulo}</h2>
    <p>{pedido.mensagem}</p>
    {pedido.campo && <label className="campo">
      <span>{pedido.campo.rotulo}</span>
      <input type={pedido.campo.tipo ?? 'text'} autoFocus value={valor}
        step={pedido.campo.tipo === 'number' ? 'any' : undefined}
        maxLength={pedido.campo.maxLength ?? 500} autoComplete="off"
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? erroId : undefined}
        onChange={event => { setValor(event.target.value); setErro('') }} />
    </label>}
    {erro && <p id={erroId} role="alert" className="alerta alerta-erro">{erro}</p>}
    <div className="confirmacao-acoes">
      <button type="button" autoFocus={!pedido.campo} className="botao botao-fantasma"
        onClick={() => responder(pedido.id, false)}>{t('Cancelar', 'Cancel')}</button>
      <button type="submit" className={`botao ${pedido.perigoso === false ? 'botao-primario' : 'botao-perigo'}`}>
        {pedido.acao}
      </button>
    </div>
  </form>
}

/** Confirmações funcionam no navegador e no app, sem depender de window.confirm. */
export function useConfirmacao(escopo: string) {
  const [pedido, setPedido] = useState<ConfirmacaoPendente | null>(null)
  const pendente = useRef<ConfirmacaoPendente | null>(null)
  const sequencia = useRef(0)
  const escopoAtual = useRef(escopo)
  const montado = useRef(false)
  escopoAtual.current = escopo

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
      const anterior = pendente.current
      pendente.current = null
      anterior?.resolver(false)
    }
  }, [])

  useEffect(() => () => {
    const anterior = pendente.current
    if (anterior?.escopo === escopo) {
      pendente.current = null
      anterior.resolver(false)
    }
  }, [escopo])

  const abrir = useCallback((opcoes: PedidoConfirmacao, campo?: PedidoTexto): Promise<Resposta> => {
    if (!montado.current || pendente.current) return Promise.resolve(false)
    return new Promise(resolve => {
      const novo = { ...opcoes, campo, id: ++sequencia.current, escopo: escopoAtual.current, resolver: resolve }
      pendente.current = novo
      setPedido(novo)
    })
  }, [])

  const confirmar = useCallback(async (opcoes: PedidoConfirmacao): Promise<boolean> => {
    return await abrir(opcoes) === true
  }, [abrir])
  const solicitarTexto = useCallback(async (opcoes: PedidoTexto): Promise<string | null> => {
    const resposta = await abrir(opcoes, opcoes)
    return typeof resposta === 'string' ? resposta : null
  }, [abrir])

  const responder = useCallback((id: number, resposta: Resposta) => {
    const atual = pendente.current
    if (!atual || atual.id !== id) return
    pendente.current = null
    setPedido(null)
    atual.resolver(montado.current && atual.escopo === escopoAtual.current ? resposta : false)
  }, [])

  const visivel = pedido?.escopo === escopo && pendente.current?.id === pedido.id ? pedido : null
  const dialogo = visivel && <DialogoArquivo key={visivel.id} nome={visivel.titulo}
    className="conta-dialogo confirmacao-dialogo" aoFechar={() => responder(visivel.id, false)}>
    <ConteudoDialogo pedido={visivel} responder={responder} />
  </DialogoArquivo>
  return { confirmar, solicitarTexto, dialogo }
}
