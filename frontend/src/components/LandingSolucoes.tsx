import { useTextoLanding } from '../lib/i18nLanding'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icone } from './Icone'
import { mailtoLink, temEmail, temWhatsapp, whatsappLink } from '../lib/contato'
import { guardarPedidoLanding, identificarPedidoLanding } from '../lib/pedidoLanding'
import '../styles/landing-solucoes.css'

const SOLUCOES = [
  {
    id: 'video',
    nome: 'Vídeo e conteúdo',
    icone: 'arq-video',
    titulo: 'Seu material. Um vídeo com a sua cara.',
    texto: 'Fotos, clipes e referências viram um plano de edição. Você confere a proposta e recebe o vídeo para revisar.',
    insumos: ['Fotos ou clipes em boa qualidade', 'Mensagem, canal e duração', 'Referências da marca que você quer preservar'],
    pedido: 'Quero transformar meus materiais em um vídeo.',
  },
  {
    id: 'apresentacao',
    nome: 'Apresentações',
    icone: 'arq-web',
    titulo: 'Ideias e dados. Uma apresentação clara.',
    texto: 'O Offiz organiza a narrativa e prepara slides editáveis. Os números vêm das suas fontes, com as lacunas à vista.',
    insumos: ['Objetivo e público da apresentação', 'Dados e documentos de referência', 'Tempo disponível e identidade visual'],
    pedido: 'Quero montar uma apresentação editável com meus dados.',
  },
  {
    id: 'documento',
    nome: 'Documentos e minutas',
    icone: 'oficio-juridico',
    titulo: 'Fatos e documentos. Uma minuta para revisar.',
    texto: 'O Offiz prepara a minuta e destaca o que precisa ser confirmado. A decisão sobre o uso fica com o responsável pelo documento.',
    insumos: ['Tipo de documento e finalidade', 'Fatos e documentos que sustentam o pedido', 'Prazos e contexto aplicável'],
    pedido: 'Preciso preparar um documento ou uma minuta para revisão.',
  },
] as const

function PreviewSolucao({ tipo }: { tipo: string }) {
  const texto = useTextoLanding()
  return (
    <div className={`lp-sol-preview lp-sol-preview--${tipo}`} aria-hidden="true">
      <div className="lp-sol-janela">
        <div className="lp-sol-janela-topo"><span>{texto("Exemplo de fluxo")}</span><span>Offiz</span></div>
        {tipo === 'video' ? (
          <>
            <div className="lp-sol-filme">
              <div className="lp-sol-filme-cena"><Icone nome="arq-video" tamanho={30} /><span>{texto("Seu material")}</span></div>
              <div className="lp-sol-filme-cena"><Icone nome="estudio" tamanho={30} /><span>{texto("Sua mensagem")}</span></div>
            </div>
            <div className="lp-sol-timeline"><span /><span /><span /><span /></div>
            <div className="lp-sol-resultado"><strong>video.mp4</strong><span>{texto("Para sua revisão")}</span></div>
          </>
        ) : tipo === 'apresentacao' ? (
          <>
            <div className="lp-sol-slides">
              <div className="lp-sol-slide lp-sol-slide--capa"><span>{texto("Sua próxima ideia")}</span><i /><small>{texto("Objetivo e contexto")}</small></div>
              <div className="lp-sol-slide lp-sol-slide--dados"><span>{texto("Dados com fonte")}</span><div><i /><i /><i /></div><small>{texto("Estrutura ilustrativa")}</small></div>
            </div>
            <div className="lp-sol-resultado"><strong>apresentacao.pptx</strong><span>{texto("Editável")}</span></div>
          </>
        ) : (
          <>
            <div className="lp-sol-documento">
              <strong>{texto("Minuta de trabalho")}</strong>
              <div><span>{texto("Fatos informados")}</span><Icone nome="check" tamanho={13} /></div>
              <div><span>{texto("Fontes a verificar")}</span><Icone nome="relogio" tamanho={13} /></div>
              <div><span>{texto("Sua decisão de uso")}</span><Icone nome="relogio" tamanho={13} /></div>
            </div>
            <div className="lp-sol-resultado"><strong>minuta.docx</strong><span>{texto("Aguardando revisão")}</span></div>
          </>
        )}
      </div>
    </div>
  )
}

/** Vitrine pública: demonstra fluxos, sem tratar ilustração como entrega real. */
export function LandingSolucoes({ logado, usuarioId = null }: { logado: boolean; usuarioId?: number | null }) {
  const texto = useTextoLanding()
  const [escolha, setEscolha] = useState('')
  const [pedido, setPedido] = useState('')
  const [pedidoId] = useState(identificarPedidoLanding)
  const [erroEntrada, setErroEntrada] = useState(false)
  const destino = pedido.trim() ? `/app?pedido-inicial=${pedidoId}` : '/app'
  function prepararEntrada(event: React.MouseEvent<HTMLAnchorElement>) {
    if (pedido.trim() && !guardarPedidoLanding(pedidoId, pedido, usuarioId)) {
      event.preventDefault()
      setErroEntrada(true)
    }
  }
  const mensagem = `${texto("Olá! Quero conhecer o Offiz para o meu trabalho. Minha primeira demanda:")} ${pedido.trim() || texto("gostaria de entender por onde começar.")}`
  const contato = temEmail ? mailtoLink(texto("Offiz — minha primeira demanda"), mensagem) : whatsappLink(mensagem)

  function escolher(id: string, pedidoEscolhido: string) {
    setEscolha(id)
    // Uma opção ajuda a começar, mas não apaga o briefing já escrito.
    setPedido((atual) => !atual.trim() || SOLUCOES.some((s) => s.pedido === atual || texto(s.pedido) === atual) ? pedidoEscolhido : atual)
  }

  return (
    <section className="lp-solucoes" id="solucoes" aria-labelledby="lp-solucoes-titulo">
      <div className="lp-wrap">
        <div className="lp-solucoes-intro">
          <h2 className="lp-h2" id="lp-solucoes-titulo">{texto("Comece pelo que você precisa entregar.")}</h2>
          <p className="lp-sub">{texto("Escolha um caminho ou descreva seu pedido. O Offiz entende o contexto, identifica o que falta e reúne as ferramentas disponíveis para o trabalho.")}</p>
          <p className="lp-solucoes-compromisso"><Icone nome="seguranca" tamanho={19} />
            {texto("Você aprova antes de publicar, enviar ou realizar uma ação irreversível.")}</p>
        </div>

        <div className="lp-sol-grid">
          {SOLUCOES.map((solucao) => (
            <article className="lp-sol-card" key={solucao.id}>
              <PreviewSolucao tipo={solucao.id} />
              <div className="lp-sol-card-corpo">
                <div className="lp-sol-categoria"><Icone nome={solucao.icone} tamanho={20} />{texto(solucao.nome)}</div>
                <h3>{texto(solucao.titulo)}</h3>
                <p>{texto(solucao.texto)}</p>
                <details className="lp-sol-insumos">
                  <summary>{texto("O que precisamos para começar")}</summary>
                  <ul>{solucao.insumos.map((insumo) => <li key={insumo}>{texto(insumo)}</li>)}</ul>
                </details>
                <a className="lp-sol-escolher" href="#primeiro-pedido"
                  onClick={() => escolher(solucao.id, texto(solucao.pedido))}>{texto("Começar por esta demanda")}</a>
              </div>
            </article>
          ))}
        </div>

        <div className="lp-sol-briefing" id="primeiro-pedido">
          <div>
            <h3>{texto("Começamos pelo seu trabalho.")}</h3>
            <p>{texto("A sabatina reúne o perfil e as referências da sua marca. O consultor prepara a IA antes de entregar o acesso; depois, você completa apenas os detalhes de cada pedido.")}</p>
            <p className="lp-sol-criterio"><strong>{texto("Faltou algo essencial?")}</strong> {texto("O Offiz explica o que precisa, por que faz diferença e como você pode fornecer.")}</p>
          </div>
          <div className="lp-sol-pedido">
            <label htmlFor="lp-primeiro-pedido">{texto("Qual resultado você precisa primeiro?")}</label>
            <div className="lp-sol-opcoes" aria-label={texto("Sugestões de pedido")}>
              {SOLUCOES.map((solucao) => <button type="button" key={solucao.id}
                aria-pressed={escolha === solucao.id}
                onClick={() => escolher(solucao.id, texto(solucao.pedido))}>{texto(solucao.nome)}</button>)}
              <button type="button" aria-pressed={escolha === 'livre'}
                onClick={() => { setEscolha('livre'); document.getElementById('lp-primeiro-pedido')?.focus() }}>{texto("Outro pedido")}</button>
            </div>
            <textarea id="lp-primeiro-pedido" rows={3} maxLength={1500} value={pedido}
              onChange={(event) => { setPedido(event.target.value); setEscolha('livre') }}
              placeholder={texto("Por exemplo: tenho uma reunião sexta e preciso apresentar os resultados do mês.")} />
            {logado ? <Link className="lp-btn lp-btn--azul" to={destino} onClick={prepararEntrada}>{texto("Abrir meu Offiz")}</Link> : (
              temEmail || temWhatsapp ? <a className="lp-btn lp-btn--azul" href={contato}
                {...(!temEmail ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                {texto("Conversar sobre meu pedido")}</a> : <Link className="lp-btn lp-btn--azul" to={destino} onClick={prepararEntrada}>{texto("Entrar")}</Link>
            )}
            {!logado && (temEmail || temWhatsapp) && <Link to={destino} onClick={prepararEntrada}>{texto('Já tenho acesso ao Offiz')}</Link>}
            {erroEntrada && <p role="alert">{texto('Não consegui guardar seu pedido nesta aba. Copie o texto antes de entrar no Offiz.')}</p>}
            <small>{texto("Combinamos o escopo do contrato e preparamos a IA para sua marca.")}</small>
          </div>
        </div>
      </div>
    </section>
  )
}
