import { useIdioma } from '../lib/i18n'
import { agruparOffices, descricaoArea, iconeArea, nomeArea, nomeModulo, resumoModulo } from '../lib/office-areas'
import type { OfficeInfo } from '../lib/types'
import { Icone } from './Icone'
import './seletor-escritorios.css'

export function SeletorEscritorios({ offices, selecionados, aoAlternar, disabled = false }: {
  offices: OfficeInfo[]
  selecionados: Set<string>
  aoAlternar: (slug: string) => void
  disabled?: boolean
}) {
  const { t } = useIdioma()
  const grupos = agruparOffices(offices.filter(o => !o.arquivado))
  return (
    <fieldset className="seletor-escritorios" disabled={disabled}>
      <legend>{t('Áreas e serviços liberados', 'Granted areas and services')}</legend>
      <p className="texto-suave">{t('Abra uma área e escolha os serviços que este cliente vai usar.', 'Open an area and choose the services this client will use.')}</p>
      <div className="seletor-escritorios-grupos">
        {grupos.map(grupo => {
          const escolhidos = grupo.offices.filter(o => selecionados.has(o.slug))
          return (
            <details className="seletor-escritorios-area" key={grupo.id}>
              <summary>
                <Icone nome={iconeArea(grupo.id)} tamanho={20} />
                <span className="seletor-escritorios-titulo">
                  <strong>{nomeArea(grupo.id, t)}</strong>
                  <small>{descricaoArea(grupo.id, t)}</small>
                  {grupo.offices.every(o => o.vendavel === false) && <small>{t('Uso interno e parceiros', 'Internal use and collaborators')}</small>}
                  {escolhidos.length > 0 && <small className="seletor-escritorios-escolhidos">{t('Selecionados: ', 'Selected: ')}{escolhidos.map(o => nomeModulo(o, t)).join(', ')}</small>}
                </span>
                <span className="seletor-escritorios-contagem">{escolhidos.length}/{grupo.offices.length}</span>
              </summary>
              <div className="seletor-escritorios-modulos">
                {grupo.offices.map(o => (
                  <label key={o.slug} className={selecionados.has(o.slug) ? 'seletor-escritorios-modulo ativo' : 'seletor-escritorios-modulo'}>
                    <input type="checkbox" aria-label={nomeModulo(o, t)} checked={selecionados.has(o.slug)} onChange={() => aoAlternar(o.slug)} />
                    <span><strong>{nomeModulo(o, t)}</strong><small>{resumoModulo(o, t)}</small></span>
                  </label>
                ))}
              </div>
            </details>
          )
        })}
      </div>
      {grupos.length === 0 && <p className="texto-suave">{t('Nenhum serviço disponível no catálogo.', 'No services are available in the catalog.')}</p>}
    </fieldset>
  )
}
