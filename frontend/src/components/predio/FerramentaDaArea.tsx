import type { OfficeInfo } from '../../lib/types'
import { abasDoEscritorio, ABA_ESTUDIO, ABA_CONHECIMENTO, ABA_GUIA } from '../../lib/abas'
import { lazy, Suspense } from 'react'
import { useIdioma } from '../../lib/i18n'
import { loadRoute } from '../../lib/routeReload'
import type { PreparacaoDaArea } from '../../lib/perfilSabatina'

const EstudioTab = lazy(() => loadRoute(() => import('./EstudioTab')))
const DashboardTab = lazy(() => loadRoute(() => import('./DashboardTab').then(m => ({ default: m.DashboardTab }))))
const MesesTab = lazy(() => loadRoute(() => import('./MesesTab').then(m => ({ default: m.MesesTab }))))
const ClientesTab = lazy(() => loadRoute(() => import('./ClientesTab').then(m => ({ default: m.ClientesTab }))))
const PentestTab = lazy(() => loadRoute(() => import('./PentestTab').then(m => ({ default: m.PentestTab }))))
const CasosTab = lazy(() => loadRoute(() => import('./CasosTab').then(m => ({ default: m.CasosTab }))))
const MonitorTab = lazy(() => loadRoute(() => import('./MonitorTab').then(m => ({ default: m.MonitorTab }))))
const BibliotecaTab = lazy(() => loadRoute(() => import('./BibliotecaTab').then(m => ({ default: m.BibliotecaTab }))))
const OficinaTab = lazy(() => loadRoute(() => import('./OficinaTab').then(m => ({ default: m.OficinaTab }))))
const AgendaTab = lazy(() => loadRoute(() => import('./AgendaTab').then(m => ({ default: m.AgendaTab }))))
const GuiaTab = lazy(() => loadRoute(() => import('./GuiaTab').then(m => ({ default: m.GuiaTab }))))
const ConhecimentoSimples = lazy(() => loadRoute(() => import('./ConhecimentoSimples').then(m => ({ default: m.ConhecimentoSimples }))))

export function ferramentasDaArea(office: OfficeInfo, slug: string, operador: boolean) {
  return [...abasDoEscritorio(office, slug).filter(a => !['mesa', 'conversa', 'entregas', 'acervo'].includes(a.id)),
    ...(slug === 'conteudo' ? [ABA_ESTUDIO] : []), ...(operador ? [ABA_CONHECIMENTO] : []), ABA_GUIA]
}

/** Os painéis especializados continuam dentro da mesma conversa e navegação. */
export function FerramentaDaArea({ vista, orgId, slug, office, meuPapel, navegar, perguntar, peca, trabalho, conversaId, antesDeGerar, aoContinuarPerfil }: {
  vista: string; orgId: number; slug: string; office: OfficeInfo; meuPapel: string
  navegar: (id: string) => void; perguntar: (texto: string) => void
  peca: { slug: string; n: number; jobId?: number } | null
  trabalho: { jobId: number; n: number } | null
  conversaId?: number | null
  antesDeGerar?: () => Promise<boolean>
  aoContinuarPerfil?: (dados: PreparacaoDaArea) => void
}) {
  const { t } = useIdioma()
  const props = { orgId, slug }
  const operador = meuPapel === 'owner' || meuPapel === 'admin'
  if (!ferramentasDaArea(office, slug, operador).some(a => a.id === vista)) return null
  const painel = (() => { switch (vista) {
    case 'inicio': return <DashboardTab {...props} office={office} meuPapel={meuPapel} aoNavegar={navegar} aoContinuarPerfil={aoContinuarPerfil} />
    case 'estudio': return <Suspense fallback={<p role="status">{t('Abrindo o Estúdio…', 'Opening the Studio…')}</p>}><EstudioTab {...props} aoPerguntar={perguntar} conversaAtual={conversaId} antesDeGerar={antesDeGerar} pecaInicial={peca} trabalhoInicial={trabalho} aoVerEntregas={() => navegar('entregas')} /></Suspense>
    case 'meses': return <MesesTab {...props} />
    case 'clientes': return <ClientesTab {...props} office={office} />
    case 'pentest': return <PentestTab {...props} aoVerEntregas={() => navegar('entregas')} />
    case 'casos': return <CasosTab {...props} />
    case 'monitor': return <MonitorTab {...props} />
    case 'biblioteca': return <BibliotecaTab {...props} />
    case 'oficina': return <OficinaTab {...props} />
    case 'agenda': return <AgendaTab {...props} office={office} podeEditar={operador} />
    case 'conhecimento': return <ConhecimentoSimples {...props} aoPerguntar={perguntar} acervoDeMarca={!!office.acervo_de_marca} acervoSeparado={!!office.acervo_de_marca} aoAbrirAcervo={() => navegar('acervo')} />
    case 'guia': return <GuiaTab aoNavegar={navegar} podeVerConhecimento={operador} />
  } })()
  return <Suspense fallback={<p role="status">{t('Abrindo ferramenta…', 'Opening tool…')}</p>}>{painel}</Suspense>
}
