import { Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Fragment, Suspense, lazy } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import Landing from './pages/Landing'
import LoginPage from './pages/Login'
import ConvitePage from './pages/Convite'
import RedefinirSenhaPage from './pages/RedefinirSenha'
import { useIdioma } from './lib/i18n'
import { loadRoute } from './lib/routeReload'
import { getSessionIdentity } from './lib/api'

/* CODE-SPLITTING POR ROTA (05/09/2026). O bundle era UM chunk de ~840 kB que
   todo visitante da landing baixava inteiro — Mesa, Estúdio, Configurações da
   org (4.600 linhas), Admin e Criador inclusos. As telas públicas (landing,
   login, convite, redefinir senha) continuam no chunk de entrada; o resto só
   desce quando a rota abre. O `Suspense` abaixo mostra a mesma tela de
   carregamento que o guard de auth já usa, então visualmente nada muda. */
const CeoPage = lazy(() => loadRoute(() => import('./pages/Ceo')))
const PrediosPage = lazy(() => loadRoute(() => import('./pages/Predios')))
const ConfigOrgPage = lazy(() => loadRoute(() => import('./pages/ConfigOrg')))
const AdminPage = lazy(() => loadRoute(() => import('./pages/Admin')))
const CriadorPage = lazy(() => loadRoute(() => import('./pages/Criador')))
const AppShell = lazy(() => loadRoute(() => import('./pages/AppShell')))

function TelaCarregando() {
  const { t } = useIdioma()
  return (
    <div className="tela-carregando">
      <div className="predio-loader" aria-hidden="true">
        <span /><span /><span /><span /><span /><span />
      </div>
      <p>{t('Abrindo o escritório…', 'Opening your office…')}</p>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { usuario, carregando } = useAuth()
  const location = useLocation()
  if (carregando) return <TelaCarregando />
  if (!usuario) return <Navigate to="/login" state={{ de: location.pathname + location.search + location.hash }} replace />
  return <Layout key={getSessionIdentity() || usuario.id}>{children}</Layout>
}

/** Guard sem o Layout (topbar/rodapé): a AppShell é a própria chrome. */
function RequireAuthBare({ children }: { children: ReactNode }) {
  const { usuario, carregando } = useAuth()
  const location = useLocation()
  if (carregando) return <TelaCarregando />
  if (!usuario) return <Navigate to="/login" state={{ de: location.pathname + location.search + location.hash }} replace />
  return <Fragment key={getSessionIdentity() || usuario.id}>{children}</Fragment>
}

/** Link velho para `/predios/:orgId/:slug` → a shell viva, no mesmo andar.
 *  Preserva o `?f=` (a aba de destino) para a notificação antiga continuar
 *  caindo em Entregas. */
function RedirecionaAndarAntigo() {
  const { orgId, slug } = useParams()
  const [params] = useSearchParams()
  const { hash } = useLocation()
  const destino = new URLSearchParams(params)
  destino.set('org', orgId || '')
  destino.set('slug', slug || '')
  return (
    <Navigate to={`/app?${destino}${hash}`} replace />
  )
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { usuario, carregando } = useAuth()
  const location = useLocation()
  if (carregando) return <TelaCarregando />
  if (!usuario) return <Navigate to="/login" state={{ de: location.pathname + location.search + location.hash }} replace />
  if (!usuario.is_admin) return <Navigate to="/predios" replace />
  return <Layout key={getSessionIdentity() || usuario.id}>{children}</Layout>
}

/** As TELAS-CASA do cliente (/predios, /app) não são casa de admin: ele não é
 *  membro de org nenhuma, então elas abririam VAZIAS — foi exatamente o que
 *  aconteceu em produção (07/08/2026). Admin cai na Administração.
 *
 *  EXCEÇÃO: deep-link com ?org=&slug= (a "demo real" do criador chega assim)
 *  é acesso INTENCIONAL a um prédio específico — o guard do backend decide. */
function SemAdmin({ children }: { children: ReactNode }) {
  const { usuario } = useAuth()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const deepLink = Boolean(params.get('org'))
  if (usuario?.is_admin && !deepLink) return <Navigate to="/admin" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Suspense fallback={<TelaCarregando />}>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<LoginPage />} />
      {/* Página pública do convite por e-mail — o convidado ainda não tem sessão. */}
      <Route path="/convite/:token" element={<ConvitePage />} />
      <Route path="/convite" element={<ConvitePage />} />
      {/* Redefinição de senha — pública pelo mesmo motivo do convite: quem
          esqueceu a senha não consegue logar para provar quem é. Quem prova
          é o token de uso único. */}
      <Route path="/redefinir-senha/:token" element={<RedefinirSenhaPage />} />
      <Route path="/redefinir-senha" element={<RedefinirSenhaPage />} />
      <Route
        path="/predios"
        element={
          <RequireAuth>
            <SemAdmin>
              <PrediosPage />
            </SemAdmin>
          </RequireAuth>
        }
      />
      {/* A ROTA ANTIGA DO ANDAR. Ela abria a shell anterior (abas no topo,
          prédio isométrico, Tarefas e Conhecimento em telas próprias), que o
          redesenho clássico aposentou — e para a qual nenhum link do produto
          apontava mais: login, landing, lista de prédios, sino e criador já
          mandavam todo mundo para /app.
          Continua existindo como REDIRECT, e não apagada, porque link velho
          (e-mail antigo, favorito do dono) tem que cair no lugar certo em vez
          de num 404 — ou, pior, na interface de antes. */}
      <Route
        path="/predios/:orgId/:slug"
        element={<RedirecionaAndarAntigo />}
      />
      {/* O CEO do prédio (fase 1): conversa no nível da organização. */}
      <Route
        path="/ceo/:orgId"
        element={
          <RequireAuth>
            <CeoPage />
          </RequireAuth>
        }
      />
      <Route
        path="/config/org/:id"
        element={
          <RequireAuth>
            <ConfigOrgPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminPage />
          </RequireAdmin>
        }
      />
      {/* O Criador de escritórios: Claude de um lado, o preview do produto do
          outro. Ferramenta do consultor (admin global) — o CLI de verdade roda
          no app desktop; na web a tela abre em simulação. */}
      <Route
        path="/criador"
        element={
          <RequireAdmin>
            <CriadorPage />
          </RequireAdmin>
        }
      />
      {/* Nova shell single-page (visionOS Adamá) — opt-in, convive com /predios. */}
      <Route
        path="/app"
        element={
          <RequireAuthBare>
            <SemAdmin>
              <AppShell />
            </SemAdmin>
          </RequireAuthBare>
        }
      />
      {/* Saiu daqui a rota /predio-preview (só DEV): ela existia para mexer no
          prédio ISOMÉTRICO sem backend, e o prédio isométrico saiu com o
          desenho clássico — andar e agente viraram etapa e autoria, não arte. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
