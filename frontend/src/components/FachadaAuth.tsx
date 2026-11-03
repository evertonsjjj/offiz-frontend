import { AssinaturaAdama } from './AssinaturaAdama'
import { LogoMark } from './LogoMark'
import { useIdioma } from '../lib/i18n'

/**
 * Lateral das telas de login/convite.
 *
 * ANTES era um prédio de pixels com janelas acendendo — a identidade que saiu
 * no redesenho clássico (jul/2026). No lugar entra o que o produto realmente
 * promete, dito em texto: o ciclo de trabalho. É a mesma história da landing
 * (pede → trabalha → entrega → você revisa), condensada
 * em quatro linhas para quem está a um campo de distância de entrar.
 *
 * Decorativa: some abaixo de 860px (o formulário é o que importa no celular).
 */
const CICLO = [
  { n: '01', texto: 'Você pede, do seu jeito.', en: 'Ask in your own words.' },
  { n: '02', texto: 'O escritório trabalha na sua frente.', en: 'Your office works where you can see it.' },
  { n: '03', texto: 'Entrega um arquivo pronto.', en: 'Receive a finished file.' },
  { n: '04', texto: 'Você revisa, aprova ou pede ajustes.', en: 'Review, approve, or request changes.' },
] as const

export function FachadaAuth() {
  const { t } = useIdioma()
  return (
    <aside className="auth-fachada">
      <div className="fachada-conteudo">
        <h2 className="fachada-titulo">
          {t('Um escritório inteiro trabalhando para você.', 'An entire office working for you.')}
        </h2>
        <p className="fachada-sub">
          {t('Produção e conferência automáticas. Você decide o que usar.', 'Automatic production and checks. You decide what to use.')}
        </p>
        <ol className="fachada-ciclo">
          {CICLO.map((p) => (
            <li key={p.n}>
              <span className="fachada-ciclo-n" aria-hidden="true">{p.n}</span>
              <span>{t(p.texto, p.en)}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="fachada-marca">
        <LogoMark size={22} />
        <span className="fachada-marca-nome">Offiz</span>
        <AssinaturaAdama />
      </div>
    </aside>
  )
}
