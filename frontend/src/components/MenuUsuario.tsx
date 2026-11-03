import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useIdioma } from '../lib/i18n'
import { SeletorIdioma } from './SeletorIdioma'
import { SecaoLgpd } from './SecaoLgpd'
import { createPortal } from 'react-dom'

/**
 * Avatar do topo — com MENU, não com gatilho.
 *
 * O círculo com a inicial do usuário era, nas duas shells, o botão de SAIR:
 * um clique encerrava a sessão na hora, sem confirmação. É o controle que todo
 * mundo clica esperando um menu (nome da conta, preferências, sair) — e um
 * clique errado no meio de uma apresentação jogava o apresentador na tela de
 * login, que nem caminho de recuperação de senha tem.
 *
 * Agora o clique ABRE; sair é o segundo clique, explícito e rotulado.
 */
export function MenuUsuario({ acoes = [] }: { acoes?: { titulo: string; executar: () => void }[] }) {
  const { usuario, sair } = useAuth()
  const { t } = useIdioma()
  const [aberto, setAberto] = useState(false)
  const [contaAberta, setContaAberta] = useState(false)
  const [saindo, setSaindo] = useState(false)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const avatarRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (contaAberta && !dialogRef.current?.open) dialogRef.current?.showModal()
  }, [contaAberta])

  // Mesmo padrão do sino: clique fora fecha, Esc fecha.
  useEffect(() => {
    if (!aberto) return
    const onClickFora = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setAberto(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAberto(false); avatarRef.current?.focus() }
    }
    document.addEventListener('mousedown', onClickFora)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClickFora)
      document.removeEventListener('keydown', onEsc)
    }
  }, [aberto])

  const nome = (usuario?.nome || '').trim()
  const inicial = (nome || '?').charAt(0).toUpperCase()

  return (
    <div className="sino-wrapper" ref={wrapperRef}>
      <button
        ref={avatarRef}
        type="button"
        className="shell-avatar"
        onClick={() => setAberto((v) => !v)}
        title={nome || t('Sua conta', 'Your account')}
        aria-label={t('Sua conta', 'Your account')}
        aria-haspopup="dialog"
        aria-expanded={aberto}
      >
        {inicial}
      </button>

      {aberto && (
        <div className="sino-dropdown menu-usuario" role="dialog" aria-label={t('Preferências da sua conta', 'Your account preferences')}>
          <div className="sino-cabecalho menu-usuario-quem">
            <strong>{nome || t('Sua conta', 'Your account')}</strong>
            {usuario?.email && <span className="texto-suave">{usuario.email}</span>}
          </div>
          <div className="menu-usuario-acoes">
            {acoes.length > 0 && <div className="menu-usuario-escritorio" aria-label={t('Ferramentas e configurações', 'Tools and settings')}>
              <span className="texto-suave">{t('Seu escritório', 'Your workspace')}</span>
              {acoes.map(acao => <button key={acao.titulo} type="button" className="botao botao-fantasma botao-pequeno" onClick={() => { setAberto(false); acao.executar() }}>{acao.titulo}</button>)}
            </div>}
            <SeletorIdioma compacto />
            <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => {
              setAberto(false)
              setContaAberta(true)
            }}>
              {t('Minha conta e meus dados', 'My account and data')}
            </button>
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              disabled={saindo}
              onClick={async () => {
                setSaindo(true)
                try { await sair(); setAberto(false) } finally { setSaindo(false) }
              }}
            >
              {saindo ? t('Encerrando…', 'Signing out…') : t('Sair da conta', 'Sign out')}
            </button>
          </div>
        </div>
      )}
      {contaAberta && createPortal(
        <dialog className="conta-dialogo" ref={dialogRef} onClose={() => { setContaAberta(false); wrapperRef.current?.querySelector('button')?.focus() }} aria-label={t('Minha conta e meus dados', 'My account and data')}>
          <div className="conta-dialogo-fechar">
            <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => dialogRef.current?.close()}>{t('Fechar', 'Close')}</button>
          </div>
          <SecaoLgpd />
        </dialog>, document.body,
      )}
    </div>
  )
}
