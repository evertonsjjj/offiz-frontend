import { useState } from 'react'
import { useIdioma } from '../lib/i18n'
import { Icone } from './Icone'
import './campanha-demonstracao.css'

/** Demonstração declarada: os exemplos não se passam por trabalhos de clientes. */
export function CampanhaDemonstracao() {
  const { t } = useIdioma()
  const [etapa, setEtapa] = useState(0)
  const [formato, setFormato] = useState(0)
  return <div className="campanha-demo">
    <div className="campanha-demo__topo"><span>Offiz</span><small>{t('Demonstração ilustrativa · marca fictícia', 'Illustrative demo · fictional brand')}</small></div>
    <div className="campanha-demo__corpo">
      <div className="campanha-demo__pedido"><span className="campanha-demo__avatar">S</span><p>{t('“Vou lançar um café novo. Prepare a campanha com esta foto e a nossa identidade.”', '“I’m launching a new coffee. Prepare the campaign with this photo and our brand identity.”')}</p><div className="campanha-demo__anexo"><Icone nome="arq-imagem" tamanho={20} /><span>{t('Foto do produto + dados do lançamento', 'Product photo + launch details')}</span></div>
        <nav aria-label={t('Etapas da demonstração', 'Demo steps')}>{[t('Um pedido', 'One request'), t('Entrega conferida', 'Checked deliverables'), t('Tudo organizado', 'Everything organized')].map((s, i) => <button key={s} aria-pressed={etapa === i} onClick={() => setEtapa(i)}><span>{i + 1}</span>{s}</button>)}</nav>
      </div>
      <div className="campanha-demo__resultado">
        {etapa < 2 ? <><div className={`campanha-demo__arte campanha-demo__arte--${formato}`}><small>SERRA CAFÉ</small><h3>{formato === 1 ? t('Seu novo ritual.', 'Your new ritual.') : t('Uma pausa de origem.', 'A pause with roots.')}</h3><div className="campanha-demo__saco"><span>SERRA</span><div>CAFÉ</div><strong>Aurora</strong><small>{t('Café de origem · 250 g', 'Single-origin coffee · 250 g')}</small></div><span className="campanha-demo__assinatura">Lote Aurora</span></div>
          <div className="campanha-demo__formatos">{[t('Post', 'Post'), t('Story', 'Story'), t('Apresentação', 'Presentation')].map((f, i) => <button aria-pressed={formato === i} key={f} onClick={() => setFormato(i)}>{f}</button>)}</div>
          {etapa === 1 && <div className="campanha-demo__conferencia"><strong>{t('O que foi conferido', 'What was checked')}</strong><p>✓ {t('Nome e peso iguais ao catálogo', 'Name and weight match the catalog')}</p><p>✓ {t('Data consistente nas peças', 'Consistent date across deliverables')}</p><p>✓ {t('Arquivos disponíveis para sua decisão', 'Files available for your decision')}</p></div>}</> : <div className="campanha-demo__biblioteca"><div><Icone nome="arq-pasta" tamanho={28} /><h3>{t('Lançamento Aurora', 'Aurora launch')}</h3></div><p>{t('Cada projeto guarda seus trabalhos, arquivos e versões.', 'Each project keeps its work, files and versions.')}</p>{[t('Post do lançamento', 'Launch post'), t('Story de apresentação', 'Introduction story'), t('Apresentação comercial', 'Sales presentation')].map((s, i) => <div className="campanha-demo__linha" key={s}><Icone nome={i === 2 ? 'arq-web' : 'arq-imagem'} tamanho={19} /><span>{s}<small>{t('Versão aprovada preservada', 'Approved version preserved')}</small></span><b>{i === 0 ? '★' : '✓'}</b></div>)}<div className="campanha-demo__padrao"><strong>{t('Gostou? Faça os próximos assim.', 'Like it? Make the next ones like this.')}</strong><p>{t('Seu exemplo aprovado acompanha o próximo pedido.', 'Your approved example accompanies the next request.')}</p></div></div>}
      </div>
    </div>
  </div>
}
