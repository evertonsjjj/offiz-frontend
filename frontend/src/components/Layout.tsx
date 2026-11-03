import { Link, NavLink } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { api, asList } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useIdioma } from '../lib/i18n'
import { MenuUsuario } from './MenuUsuario'
import { Icone } from './Icone'
import { SinoNotificacoes } from './SinoNotificacoes'
import { ToggleTema } from './ToggleTema'
import { AssinaturaAdama } from './AssinaturaAdama'
import { LogoMark } from './LogoMark'
import type { Predio } from '../lib/types'
import { temMotorBridge } from '../lib/motor-bridge'

function LogoOffiz() {
  const { t } = useIdioma()
  return (
    <Link to="/" className="logo" aria-label={t('Offiz — página inicial', 'Offiz — home')}>
      <LogoMark size={26} />
      <span>Offiz</span>
    </Link>
  )
}

/** ⚙️ Sala das máquinas na topbar: aparece só para quem administra ao menos
 *  uma org (owner/admin). Uma org → link direto; várias → menu suspenso.
 *  Substitui a faixa "Sala das máquinas" que poluía a página de prédios. */
function EngrenagemConfig() {
  const { t } = useIdioma()
  const [orgs, setOrgs] = useState<{ id: number; nome: string }[]>([])

  useEffect(() => {
    let ativo = true
    api
      .get<unknown>('/predios')
      .then((data) => {
        if (!ativo) return
        const mapa = new Map<number, string>()
        for (const p of asList<Predio>(data, 'predios')) {
          if (p.meu_papel !== 'owner' && p.meu_papel !== 'admin') continue
          if (!mapa.has(p.org_id)) mapa.set(p.org_id, p.org_nome || `Organização ${p.org_id}`)
        }
        setOrgs(Array.from(mapa, ([id, nome]) => ({ id, nome })))
      })
      .catch(() => setOrgs([]))
    return () => {
      ativo = false
    }
  }, [])

  if (orgs.length === 0) return null
  if (orgs.length === 1) {
    return (
      <Link
        to={`/config/org/${orgs[0].id}${temMotorBridge() ? '#motor-local' : ''}`}
        className="topbar-engrenagem"
        title={t('Sala das máquinas — configurações da organização', 'Organization settings')}
        aria-label={t('Configurações da organização', 'Organization settings')}
      >
        {temMotorBridge() ? 'IA ▾' : <Icone nome="config" />}
      </Link>
    )
  }
  return (
    <details className="topbar-engrenagem-menu">
      <summary className="topbar-engrenagem" title={t('Sala das máquinas — configurações', 'Settings')}>
        <Icone nome="config" />
      </summary>
      <nav aria-label={t('Configurações por organização', 'Settings by organization')}>
        {orgs.map((o) => (
          <Link key={o.id} to={`/config/org/${o.id}`}>
            {o.nome}
          </Link>
        ))}
      </nav>
    </details>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { usuario } = useAuth()
  const { t } = useIdioma()

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <LogoOffiz />
          <nav className="topbar-nav">
            {/* Admin global NÃO tem prédio: ele não é cliente de ninguém, e o
                prédio que ele via era o de outra pessoa. A conta de admin abre
                direto na Administração e é só isso que ela mostra. Para operar
                um cliente, o caminho é o criador (app baixável), não navegar
                pela shell dele. (O acesso continua existindo por URL/API — o
                guard não mudou; o que saiu foi o convite a usá-lo por engano.)

                "Meus escritórios": o cliente tem UMA empresa, e ganha
                ESCRITÓRIOS conforme a necessidade cresce. */}
            {usuario?.is_admin ? (
              <>
                <NavLink to="/admin" className={({ isActive }) => (isActive ? 'nav-link ativo' : 'nav-link')}>
                  {t('Administração', 'Administration')}
                </NavLink>
                <NavLink to="/criador" className={({ isActive }) => (isActive ? 'nav-link ativo' : 'nav-link')}>
                  {t('Criador', 'Builder')}
                </NavLink>
              </>
            ) : (
              <NavLink to="/app" className={({ isActive }) => (isActive ? 'nav-link ativo' : 'nav-link')}>
                {t('Início', 'Home')}
              </NavLink>
            )}
          </nav>
          <div className="topbar-direita">
            <EngrenagemConfig />
            <ToggleTema />
            <SinoNotificacoes />
            <MenuUsuario />
          </div>
        </div>
      </header>
      <main className="conteudo">{children}</main>
      <footer className="rodape">
        <LogoMark size={18} className="rodape-logo" />
        <span>{t('Offiz — os seus escritórios de IA: um para cada tipo de trabalho.', 'Offiz — your AI offices, one for each kind of work.')}</span>
        <AssinaturaAdama className="rodape-marca" />
      </footer>
    </div>
  )
}
