import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError, asList } from '../lib/api'
import { wsClient } from '../lib/ws'
import { useAuth } from '../context/AuthContext'
import { useIdioma } from '../lib/i18n'
import { Icone } from '../components/Icone'
import type { DetalhePredio, Predio } from '../lib/types'
import { OffizInicio } from './Ceo'

/* =============================================================
   AppShell (rota /app) — a PORTA de entrada do produto.

   O que ela é hoje: só carga de dados. Descobre os prédios da conta,
   resolve qual está ativo (pelo ?org=&slug= ou o primeiro da lista),
   busca o detalhe e os números ao vivo, e entrega tudo para o
   OffizInicio (CEO do prédio). Nenhuma decisão de layout mora aqui.

   O que ela FOI, até 14/08/2026: a shell "visionOS Adamá" — rail de
   vidro à esquerda, doca com um diorama 3D dos bonecos trabalhando
   (three.js + GLBs), os 7 C's como mobília e abas de vidro fosco.
   Esse desenho saiu no redesenho clássico de jul/2026, mas o código
   ficou: como `modoSimplesAtivo()` passou a devolver `true` sempre,
   as ~450 linhas de rail/doca/diorama só rodavam no caso degenerado
   de "nenhum prédio" — uma identidade inteira viva no bundle e morta
   na tela, arrastando three.js, @react-three/* e o prédio isométrico.
   Foram embora junto com esta reescrita.
   ============================================================= */

export default function AppShell() {
  const { t } = useIdioma()
  const [params] = useSearchParams()
  const org = params.get('org')
  const slug = params.get('slug')
  const orgValida = org !== null && /^\d+$/.test(org) && Number.isSafeInteger(Number(org)) && Number(org) > 0
  if ((params.has('org') && !orgValida) || (params.has('slug') && (!orgValida || !slug?.trim()))) return <main className="estado-vazio estado-vazio--pagina" role="alert"><h2>{t('Endereço da empresa inválido.', 'Invalid organization address.')}</h2><Link to="/app">{t('Voltar ao início', 'Back to home')}</Link></main>
  // Trocar de contexto desmonta os estados e pedidos da área anterior.
  if (orgValida && slug) return <AndarShell key={`${Number(org)}:${slug}`} />
  if (orgValida) return <OffizInicio key={Number(org)} orgId={Number(org)} embutido />
  return <EscolherEmpresa />
}

/** A empresa é a unidade de contexto; uma área técnica nunca decide a entrada. */
function EscolherEmpresa() {
  const { t } = useIdioma()
  const [params] = useSearchParams()
  const destinoEmpresa = (id: number) => {
    const destino = new URLSearchParams(params)
    destino.set('org', String(id))
    return `/app?${destino}`
  }
  const [orgs, setOrgs] = useState<{ id: number; nome: string }[] | null>(null)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    let ativo = true
    api.get('/orgs').then((d) => { if (ativo) setOrgs(asList(d, 'orgs')) })
      .catch(() => { if (ativo) setErro(true) })
    return () => { ativo = false }
  }, [])
  if (erro) return <div className="estado-vazio estado-vazio--pagina" role="alert"><h2>{t('Não consegui abrir suas empresas.', 'Could not load your organizations.')}</h2><button className="botao botao-primario" onClick={() => window.location.reload()}>{t('Tentar novamente', 'Try again')}</button></div>
  if (!orgs) return <div className="tela-carregando"><p>{t('Abrindo o Offiz…', 'Opening Offiz…')}</p></div>
  if (orgs.length === 1) return <OffizInicio orgId={orgs[0].id} embutido />
  return <main className="estado-vazio estado-vazio--pagina">
    <h1>{orgs.length ? t('Em qual empresa vamos trabalhar?', 'Which organization are we working with?') : t('Seu acesso está pronto', 'Your account is ready')}</h1>
    <p className="texto-suave">{orgs.length ? t('O contexto, as conversas e os materiais acompanham a empresa escolhida.', 'Context, conversations, and materials stay with the selected organization.') : t('Seu consultor precisa vincular uma empresa a esta conta para começarmos.', 'Your consultant needs to link an organization to this account before we can get started.')}</p>
    <div className="conversa-chips">{orgs.map((o) => <Link className="botao botao-primario" key={o.id} to={destinoEmpresa(o.id)}>{o.nome}</Link>)}</div>
    <Link to="/predios">{t('Gerenciar meus acessos', 'Manage my access')}</Link>
  </main>
}

function AndarShell() {
  const { t } = useIdioma()
  const { usuario } = useAuth()
  const [searchParams] = useSearchParams()
  const [predios, setPredios] = useState<Predio[] | null>(null)
  const [detalhe, setDetalhe] = useState<DetalhePredio | null>(null)
  const [erroDetalhe, setErroDetalhe] = useState<string | null>(null)
  const [erroLista, setErroLista] = useState(false)
  const [revisaoDetalhe, setRevisaoDetalhe] = useState(0)
  const tentarDetalhe = useCallback(() => setRevisaoDetalhe((valor) => valor + 1), [])

  const orgParam = searchParams.get('org')
  const slugParam = searchParams.get('slug')

  // ---- Lista de prédios da conta ----
  const [revisaoLista, setRevisaoLista] = useState(0)
  const carregarPredios = useCallback(() => setRevisaoLista((valor) => valor + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    api.get('/predios', controller.signal)
      .then((d) => { if (!controller.signal.aborted) { setPredios(asList<Predio>(d, 'predios')); setErroLista(false) } })
      .catch(() => { if (!controller.signal.aborted) setErroLista(true) })
    return () => controller.abort()
  }, [revisaoLista])

  useEffect(() => {
    const offNotif = wsClient.on('notificacao', () => carregarPredios())
    const offStatus = wsClient.on('job_status', () => carregarPredios())
    return () => {
      offNotif()
      offStatus()
    }
  }, [carregarPredios])

  // Prédio ativo: o do ?org/?slug, senão o primeiro da lista.
  const ativo = useMemo<Predio | null>(() => {
    if (orgParam && slugParam) {
      const achado = (predios ?? []).find(
        (p) => p.org_id === Number(orgParam) && p.office_slug === slugParam,
      )
      if (achado) return achado
      // ADMIN GLOBAL por deep-link (a demo do criador chega assim): ele não é
      // membro, então a lista por membership não traz o prédio — mas o
      // require_predio_access do detalhe o deixa entrar. Entrada sintética
      // mínima; tudo que a tela mostra de verdade vem do GET do detalhe.
      if (usuario?.is_admin && predios !== null) {
        const orgId = Number(orgParam)
        if (Number.isSafeInteger(orgId) && orgId > 0) {
          return {
            org_id: orgId,
            org_nome: `Organização ${orgId}`,
            office_slug: slugParam,
            office: {
              slug: slugParam,
              nome: slugParam,
              descricao: '',
              tema: { cor_primaria: '#2f54c4', cor_acento: '#2f54c4', cor_fundo: '#f4efe6', icone: 'predio' },
            },
            meu_papel: 'admin',
            nao_lidas: 0,
            ultimo_job: null,
          } satisfies Predio
        }
      }
      return null
    }
    if (!predios || predios.length === 0) return null
    return predios[0]
  }, [predios, orgParam, slugParam, usuario])

  // ---- Detalhe do prédio ativo ----
  // Dependências PRIMITIVAS (org_id/slug), nunca o objeto `ativo`: todo
  // evento WS refaz /predios com objetos de identidade nova — com dep no
  // objeto, cada job_status desmontava a página inteira.
  const orgIdAtivo = ativo?.org_id
  const slugAtivo = ativo?.office_slug
  useEffect(() => {
    if (orgIdAtivo == null || !slugAtivo) return
    let vivo = true
    setDetalhe(null)
    setErroDetalhe(null)
    api
      .get<DetalhePredio>(`/predios/${orgIdAtivo}/${encodeURIComponent(slugAtivo)}`)
      .then((d) => {
        if (vivo) setDetalhe(d)
      })
      .catch((e) => {
        if (!vivo) return
        setErroDetalhe(
          e instanceof ApiError && e.status === 403
            ? 'Você não tem acesso a este escritório.'
            : 'Não foi possível abrir o escritório.',
        )
      })
    return () => {
      vivo = false
    }
  }, [orgIdAtivo, slugAtivo, revisaoDetalhe])

  // ---- Sem prédio nenhum: o estado vazio de verdade ----
  // Era aqui que o rail de vidro e o diorama apareciam — a única situação em
  // que aquela shell inteira renderizava. Quem cai neste caso é conta nova
  // (ou órfã), e o que ela precisa não é um escritório 3D vazio: é saber que
  // ainda não tem escritório e para onde ir.
  if (erroLista && !predios) return <main className="estado-vazio estado-vazio--pagina" role="alert"><h2>{t('Não foi possível carregar seus acessos.', 'Could not load your access.')}</h2><p>{t('Confira sua conexão e tente novamente.', 'Check your connection and try again.')}</p><button type="button" className="botao botao-primario" onClick={carregarPredios}>{t('Tentar novamente', 'Try again')}</button><Link to="/app">{t('Voltar ao início', 'Back to home')}</Link></main>
  if (predios !== null && orgParam && slugParam && !ativo) {
    return <main className="estado-vazio estado-vazio--pagina" role="alert"><h2>{t('Este espaço não está disponível para sua conta.', 'This workspace is not available to your account.')}</h2><p>{t('O acesso pode ter mudado. Volte ao início para ver as opções disponíveis.', 'Your access may have changed. Return home to see the available options.')}</p><Link className="botao botao-primario" to={`/app?org=${encodeURIComponent(orgParam)}`}>{t('Voltar ao início', 'Back to home')}</Link></main>
  }
  if (predios !== null && predios.length === 0 && !ativo) {
    return (
      <div className="estado-vazio estado-vazio--pagina">
        <div className="estado-vazio-arte">
          <Icone nome="predio" tamanho={48} traco={1.2} />
        </div>
        <h2>{t('Você ainda não tem um escritório', 'You do not have an office yet')}</h2>
        <p className="texto-suave">
          {t('Assim que o seu escritório for montado, ele abre direto aqui.', 'Your office will appear here once it has been set up.')}
        </p>
        <p>
          <Link to="/predios">{t('Ver os meus escritórios', 'View my offices')}</Link>
        </p>
      </div>
    )
  }

  // Ainda descobrindo quais prédios a conta tem.
  if (!ativo) {
    return (
      <div className="tela-carregando">
        <div className="predio-loader" aria-hidden="true">
          <span /><span /><span /><span /><span /><span />
        </div>
        <p>{t('Abrindo o escritório…', 'Opening your office…')}</p>
      </div>
    )
  }

  if (erroDetalhe) return <main className="estado-vazio estado-vazio--pagina" role="alert"><h2>{erroDetalhe}</h2><button onClick={tentarDetalhe}>{t('Tentar novamente', 'Try again')}</button></main>
  if (!detalhe) return <div className="tela-carregando"><p>{t('Carregando área', 'Loading workspace')}</p></div>
  // Mesmo produto e mesma navegação. O slug conserva o histórico do andar;
  // redirecionar cegamente ao chat geral faria as conversas antigas sumirem.
  return <OffizInicio orgId={ativo.org_id} embutido areaSlug={ativo.office_slug} areaOffice={detalhe.office} />
}
