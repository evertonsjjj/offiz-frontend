import { Component } from 'react'
import type { ReactNode } from 'react'
import { traduzirForaDoProvider as t } from '../lib/idiomaBase'

/** A borda de erro da RAIZ (06/09/2026). A shell já tinha a sua (BordaPainel,
 *  por painel), mas landing, login, Configurações, Admin e Criador não tinham
 *  nenhuma: um erro de render em qualquer uma delas apagava a página inteira
 *  — tela em branco, sem pista. Aqui o erro vira um aviso com o botão de
 *  recarregar e o detalhe técnico para o print do suporte. */
export class BordaRaiz extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null }

  static getDerivedStateFromError(erro: Error) {
    return { erro }
  }

  render() {
    if (this.state.erro) {
      return (
        <div style={{ maxWidth: 560, margin: '64px auto', padding: '0 24px' }}>
          <div className="alerta alerta-erro" role="alert">
            <p>
              {t('Não foi possível abrir esta tela. Tente novamente; se continuar, entre em contato com o suporte.', 'This screen could not open. Try again; if the problem continues, contact support.')}
            </p>
            <p>
              <button type="button" onClick={() => window.location.reload()}>
                {t('Tentar novamente', 'Try again')}
              </button>
            </p>
            <details className="texto-suave">
              <summary>{t('Detalhes para o suporte', 'Details for support')}</summary>
              <small>{String(this.state.erro.message || this.state.erro)}</small>
            </details>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
