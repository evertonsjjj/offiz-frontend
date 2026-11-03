import { formatUSD } from '../../lib/i18nProducao'
import { useIdioma } from '../../lib/i18n'
/**
 * O EDITOR DA PEÇA "com mais opções" (24/08/2026 — os mockups do dono).
 *
 * Timeline com lanes (BLOCOS · ARTE · ÁUDIO com ondas reais), inspetor por
 * bloco (takes com preço, seed, DIREÇÃO que a IA lê, NOTA que a IA NÃO lê,
 * travar) e a LINHA VERMELHA DO DINHEIRO desenhada na tela:
 *
 * - salvar direção/seed NUNCA gasta — só muda a assinatura; o plano volta
 *   dizendo o que a mudança CUSTARIA gerar;
 * - "Recompor — US$ 0,00" roda o ffmpeg no servidor na hora (sem provedor);
 *   se algum bloco precisaria GERAR, o botão vira o custo e o disparo é
 *   pelo chat ("Falar com este bloco") — o portão humano continua lá;
 * - voltar a um take antigo é restauração pelo rastro (grátis); take sem
 *   rastro não restaura — o servidor recusa em vez de cobrar em silêncio.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { api, ApiError, carregarArquivo } from '../../lib/api'
import { Icone, iconeDoArquivo } from '../Icone'
import { useToasts } from '../Toasts'
import VisorArquivo, { type MidiaVisor } from './VisorArquivo'

function midiaDoNome(nome: string): MidiaVisor {
  const ext = (nome.split('.').pop() || '').toLowerCase()
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'audio'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'imagem'
  return 'documento'
}

type TakeEd = {
  n: number | null
  hash: string
  custo_usd: number | null
  escolhido: boolean
  arquivo: string | null
  restauravel: boolean
}

type BlocoEd = {
  id: string
  tipo: string
  ato?: string | null
  rotulo: string
  entrada_s: number
  saida_s: number
  dur: number
  direcao: string
  seed?: number | null
  travado: boolean
  nota: string
  letreiro: string[]
  fontes: string[]
  takes: TakeEd[]
  sig_g?: string
  sig_c?: string
  gera: boolean
  custo_usd: number
  recompoe: boolean
  comp: string | null
  motion?: boolean
  motion_features?: string[]
}

const MOTION_FEATURE_LABELS = new Map<string, [string, string]>([
  ['keyframes', ['Movimento personalizado', 'Custom motion']],
  ['gradient', ['Degradê', 'Gradient']],
  ['shadow', ['Sombra', 'Shadow']],
])

type EditorPayload = {
  slug: string
  titulo?: string
  estado?: string
  molde?: string
  dur_total?: number
  blocos: BlocoEd[]
  montagem: string[]
  audio: {
    trilha: { existe: boolean; arquivo: string; prompt?: string }
    narracao: { existe: boolean; arquivo: string; porta_voz?: string | null }
    ducking: boolean
  }
  final: { master: string; existe: boolean }
  custo_pendente: number | null
  custo_consulta_confirmada?: boolean
  custo_pendente_escopo?: string
  custo_total_estimado?: boolean
  custos_fora_fal?: Array<{ etapa: string; custo_usd: number | null; via?: string }>
  etapas_pendentes?: Array<{ etapa: string; custo_usd: number | null; via?: string }>
  aviso_custo_externo?: string
  aviso_custo_consulta?: string
  composicao_local_disponivel?: boolean
  aviso_composicao_local?: string
  pendencias?: string[]
  trilha_falta: boolean
}

const USD = formatUSD

export default function EditorPeca({
  orgId,
  officeSlug,
  pecaSlug,
  aoPreencher,
  aoFechar,
}: {
  orgId: number
  officeSlug: string
  pecaSlug: string
  /** prepara um pedido no composer do chat — quem gasta é o agente, depois do seu OK */
  aoPreencher: (texto: string) => void
  aoFechar: () => void
}) {
  const { t: tr, idioma } = useIdioma()
  const base = `/predios/${orgId}/${officeSlug}/estudio/pecas/${pecaSlug}`
  const { sucesso: toastOk, falha: toastErro } = useToasts()
  const [ed, setEd] = useState<EditorPayload | null>(null)
  const [erroAbrir, setErroAbrir] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [recompondo, setRecompondo] = useState(false)
  const [direcao, setDirecao] = useState('')
  const [nota, setNota] = useState('')
  const [seed, setSeed] = useState<string>('')
  const [ondas, setOndas] = useState<{ trilha: number[]; narracao: number[] }>({ trilha: [], narracao: [] })
  const thumbsRef = useRef<Map<string, string>>(new Map())
  const [, setTick] = useState(0)
  // "Bem estúdio mesmo" (24/08/2026): o preview do bloco TOCA o vídeo (take
  // escolhido/composição) em vez de mostrar só um quadro — e cada fonte abre
  // no visor grande. Sem mídia grande, editor de vídeo é lista de nomes.
  const [previewVideo, setPreviewVideo] = useState<string | null>(null)
  const previewVideoRef = useRef<string | null>(null)
  const [visor, setVisor] = useState<{ titulo: string; caminho: string; midia: MidiaVisor; url: string | null; erro: string | null } | null>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await api.get<EditorPayload>(`${base}/editor`)
      setEd(r)
      setErroAbrir(null)
      setSel((s) => s && r.blocos.some((b) => b.id === s) ? s : r.blocos[0]?.id ?? null)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : tr("Não consegui abrir o editor desta peça", "I could not open the editor for this production")
      // "Abrindo…" eterno esconde o motivo — o erro fica NA TELA, com retry
      // (peça em construção por um trabalho devolve o plano assim que fecha).
      setErroAbrir(msg)
      toastErro(msg)
    }
  }, [base, toastErro])

  useEffect(() => { void carregar() }, [carregar])

  // ondas REAIS (uma vez por peça; vazio quando o áudio ainda não existe)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const t = await api.get<{ picos: number[] }>(`${base}/ondas?qual=trilha`)
        const n = await api.get<{ picos: number[] }>(`${base}/ondas?qual=narracao`)
        if (vivo) setOndas({ trilha: t.picos ?? [], narracao: n.picos ?? [] })
      } catch { /* lane fica vazia — nunca onda fake */ }
    })()
    return () => { vivo = false }
  }, [base])

  // miniaturas dos blocos (take escolhido ou comp) via a porta de bytes da peça
  useEffect(() => {
    if (!ed) return
    let vivo = true
    ;(async () => {
      for (const b of ed.blocos) {
        const alvo = b.takes.find((t) => t.escolhido)?.arquivo ?? b.comp
        if (!alvo || thumbsRef.current.has(b.id)) continue
        if (alvo.endsWith('.mp4')) continue
        try {
          const url = await carregarArquivo(`${base}/arquivo?caminho=${encodeURIComponent(alvo)}`)
          if (!vivo) { URL.revokeObjectURL(url); return }
          thumbsRef.current.set(b.id, url)
          setTick((t) => t + 1)
        } catch { /* sem thumb — mostra o rótulo */ }
      }
    })()
    return () => { vivo = false }
  }, [ed, base])

  // o formulário do inspetor segue o bloco selecionado
  useEffect(() => {
    const b = ed?.blocos.find((x) => x.id === sel)
    setDirecao(b?.direcao ?? '')
    setNota(b?.nota ?? '')
    setSeed(b?.seed != null ? String(b.seed) : '')
  }, [sel, ed])

  // O VÍDEO do bloco selecionado, tocável: take escolhido (.mp4) ou a
  // composição do cache. Carrega sob demanda e revoga ao trocar.
  useEffect(() => {
    const b = ed?.blocos.find((x) => x.id === sel)
    const alvo = [b?.takes.find((t) => t.escolhido)?.arquivo, b?.comp]
      .find((a) => a && a.endsWith('.mp4')) ?? null
    if (previewVideoRef.current) {
      URL.revokeObjectURL(previewVideoRef.current)
      previewVideoRef.current = null
      setPreviewVideo(null)
    }
    if (!alvo) return
    let vivo = true
    ;(async () => {
      try {
        const url = await carregarArquivo(`${base}/arquivo?caminho=${encodeURIComponent(alvo)}`)
        if (!vivo) { URL.revokeObjectURL(url); return }
        previewVideoRef.current = url
        setPreviewVideo(url)
      } catch { /* fica na thumb/rótulo */ }
    })()
    return () => { vivo = false }
  }, [sel, ed, base])

  async function abrirFonteNoVisor(rel: string) {
    const nome = rel.split('/').pop() || rel
    setVisor({ titulo: nome, caminho: rel, midia: midiaDoNome(nome), url: null, erro: null })
    try {
      const url = await carregarArquivo(`${base}/arquivo?caminho=${encodeURIComponent(rel)}`)
      setVisor((v) => (v && v.caminho === rel ? { ...v, url } : v))
    } catch (e) {
      setVisor((v) =>
        v && v.caminho === rel
          ? { ...v, erro: e instanceof ApiError ? e.message : tr("Não consegui abrir este arquivo", "I could not open this file") }
          : v,
      )
    }
  }

  const bloco = ed?.blocos.find((b) => b.id === sel) ?? null
  const motionFeatures = bloco?.motion && Array.isArray(bloco.motion_features) ? [...new Set(bloco.motion_features)].flatMap(feature => {
    if (typeof feature !== 'string') return []
    const label = MOTION_FEATURE_LABELS.get(feature)
    return label ? [tr(...label)] : []
  }) : []

  async function patch(campos: Record<string, unknown>, aviso?: string) {
    if (!bloco) return
    setSalvando(true)
    try {
      await api.patch(`${base}/cenas/${bloco.id}`, campos)
      if (aviso) toastOk(aviso)
      await carregar()
    } catch (e) {
      toastErro(e instanceof ApiError ? e.message : tr("Não deu para salvar a edição", "Could not save the edit"))
    } finally {
      setSalvando(false)
    }
  }

  async function mover(delta: number) {
    if (!ed || !bloco) return
    const ordem = [...ed.montagem]
    const i = ordem.indexOf(bloco.id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= ordem.length) return
    ;[ordem[i], ordem[j]] = [ordem[j], ordem[i]]
    try {
      await api.patch(`${base}/montagem`, { ordem })
      await carregar()
    } catch (e) {
      toastErro(e instanceof ApiError ? e.message : tr("Não deu para reordenar", "Could not reorder"))
    }
  }

  async function recompor() {
    setRecompondo(true)
    try {
      await api.post(`${base}/recompor`)
      toastOk(tr("Recomposto — US$ 0,00 (ffmpeg no servidor, nenhum provedor)", "Recomposed — US$ 0.00 (ffmpeg on the server, no provider)"))
      await carregar()
    } catch (e) {
      toastErro(e instanceof ApiError ? e.message : tr("A recomposição falhou", "Recomposition failed"))
    } finally {
      setRecompondo(false)
    }
  }

  if (!ed) {
    if (erroAbrir) {
      return (
        <div className="edpc-erro">
          <p className="alerta alerta-erro">{erroAbrir}</p>
          <p className="texto-suave">
            {tr("Se um trabalho ainda está construindo esta peça, o editor abre assim que ele terminar.", "If a task is still building this production, the editor becomes available when it finishes.")}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="botao botao-fantasma botao-pequeno" onClick={() => { setErroAbrir(null); void carregar() }}>
              {tr("Tentar de novo", "Try again")}</button>
            <button className="botao botao-fantasma botao-pequeno" onClick={aoFechar}>{tr("← Voltar", "← Back")}</button>
          </div>
        </div>
      )
    }
    return <p className="texto-suave">{tr("Abrindo o editor…", "Opening editor…")}</p>
  }

  const custoPend = ed.custo_pendente
  const custoExterno = ed.custo_total_estimado === false || (ed.custos_fora_fal?.length ?? 0) > 0
  const custoIndisponivel = ed.custo_consulta_confirmada === false || custoPend == null
  const direcaoMudou = bloco ? direcao !== bloco.direcao : false
  const seedMudou = bloco ? seed !== (bloco.seed != null ? String(bloco.seed) : '') : false

  return (
    <section className="edpc" aria-label={tr(`Editor da peça ${ed.titulo ?? ed.slug}`, `Production editor: ${ed.titulo ?? ed.slug}`)}>
      <header className="edpc-topo">
        <button className="botao botao-fantasma botao-pequeno" onClick={aoFechar}>{tr("← Voltar", "← Back")}</button>
        <strong>{ed.titulo ?? ed.slug}</strong>
        <span className="texto-suave">{ed.molde} · {ed.estado}</span>
        <span className="edpc-espaco" />
        {custoIndisponivel ? <span role="alert">{tr('Custo indisponível', 'Cost unavailable')}</span> : custoPend! > 0 ? (
          <button
            className="botao botao-fantasma botao-pequeno"
            title={tr("Há geração paga pendente — o disparo é pelo chat, com o custo dito antes", "Paid generation is pending. Start it from chat after reviewing the cost")}
            onClick={() => aoPreencher(
              custoExterno
                ? tr(`Na peça ${ed.slug}: confira custo e escopo das pendências (estimativa fal.ai ${USD(custoPend!, idioma)}; custo externo não estimado) antes de gerar, respeitando o teto do documento.`, `In production ${ed.slug}: check the cost and scope of pending items (fal.ai estimate ${USD(custoPend!, idioma)}; external cost is not estimated) before generating, within the document’s budget.`)
                : tr(`Na peça ${ed.slug}: rode o plano e gere o que falta (custo estimado ${USD(custoPend!, idioma)}), respeitando o teto do documento.`, `In production ${ed.slug}: run the plan and generate what is missing (estimated cost ${USD(custoPend!, idioma)}), within the document’s budget.`),
            )}
          >
            {tr("Gerar pendências — ", "Generate pending items — ")}{custoExterno && tr('estimativa fal.ai ', 'fal.ai estimate ')}{USD(custoPend!, idioma)} {tr("· pelo chat", "· via chat")}</button>
        ) : ed.composicao_local_disponivel === false ? (
          <button className="botao botao-primario botao-pequeno" onClick={() => aoPreencher(
            tr(`Recomponha a peça ${ed.slug} com os ajustes salvos e os materiais existentes. Preserve o visual e não gere nova mídia paga.`, `Recompose production ${ed.slug} with the saved changes and existing assets. Preserve the design and do not generate new paid media.`),
          )}>{tr('Aplicar ajustes pela conversa', 'Apply changes through chat')}</button>
        ) : (
          <button className="botao botao-primario botao-pequeno" disabled={recompondo} onClick={() => void recompor()}>
            {recompondo ? tr("Recompondo…", "Recomposing…") : tr("Ver como fica de verdade — US$ 0,00", "Preview the actual render — US$ 0.00")}
          </button>
        )}
      </header>

      {custoExterno && <div className="alerta" role="status"><strong>{tr('Estimativa fal.ai:', 'fal.ai estimate:')} {custoPend != null ? USD(custoPend, idioma) : tr('indisponível', 'unavailable')}</strong><p>{ed.aviso_custo_externo || tr('Há custo externo não estimado. O valor não é o custo total.', 'There is an unestimated external cost. This amount is not the total cost.')}</p>{ed.etapas_pendentes?.some(e => e.etapa === 'narracao') && <p>{tr('A composição local não gera a narração pendente; ela permite revisar os materiais que já existem.', 'Local composition does not generate pending narration; it lets you review existing materials.')}</p>}</div>}
      {ed.pendencias?.length ? <ul>{ed.pendencias.map((p, i) => <li key={`pendencia-${i}`}>{p}</li>)}</ul> : null}
      {ed.composicao_local_disponivel === false && <p role="status">{ed.aviso_composicao_local || tr('Esta animação é atualizada pelo motor de produção. Continue pela conversa; o pedido será preenchido para você conferir e enviar.', 'This animation is updated by the production engine. Continue through chat; the request will be filled in for you to review and send.')}</p>}
      {custoIndisponivel && <p>{ed.aviso_custo_consulta || tr('Não foi possível conferir o custo. Atualize o plano para tentar novamente.', 'Could not check the cost. Refresh the plan to try again.')}</p>}

      <div className="edpc-corpo">
        <div className="edpc-visor">
          {bloco ? (
            <>
              <div className="edpc-preview">
                {previewVideo ? (
                  <video src={previewVideo} controls playsInline />
                ) : thumbsRef.current.get(bloco.id) ? (
                  <img src={thumbsRef.current.get(bloco.id)} alt={`Bloco ${bloco.id}`} />
                ) : (
                  <div className="edpc-preview-vazio">
                    <Icone nome="arq-video" />
                    <span>{bloco.gera ? tr("ainda não gerado", "not generated yet") : tr("sem prévia de imagem", "no image preview")}</span>
                  </div>
                )}
                {bloco.fontes.length > 0 && (
                  <div className="edpc-fontes">
                    {bloco.fontes.map((rel) => /\.(ttf|otf|woff2?)$/i.test(rel) ? (
                      <span key={rel} className="edpc-fonte-chip" title={tr("Fonte tipográfica usada na animação", "Typeface used in the animation")}>
                        {rel.split('/').pop()}
                      </span>
                    ) : (
                      <button
                        key={rel}
                        type="button"
                        className="edpc-fonte-chip"
                        title={tr("Abrir no visor", "Open viewer")}
                        onClick={() => void abrirFonteNoVisor(rel)}
                      >
                        <Icone nome={iconeDoArquivo(rel)} tamanho={13} /> {rel.split('/').pop()}
                      </button>
                    ))}
                  </div>
                )}
                <p className="texto-suave edpc-preview-nota">
                  {tr("A verdade é o render do worker — a prévia aproxima.", "The worker render is the final result. This preview is approximate.")}{bloco.recompoe && !bloco.gera && ed.composicao_local_disponivel !== false && tr(" “Ver como fica de verdade” recompõe sem nova geração de mídia.", " “Preview the actual render” recomposes it without new media generation.")}
                </p>
              </div>
              {bloco.takes.length > 0 && (
                <div className="edpc-takes" role="listbox" aria-label={tr("Takes deste bloco", "Takes for this block")}>
                  {bloco.takes.map((t) => (
                    <button
                      key={t.hash}
                      className={`botao botao-fantasma edpc-take${t.escolhido ? ' ativo' : ''}`}
                      disabled={t.escolhido || !t.restauravel || salvando}
                      title={t.restauravel
                        ? tr(`take ${t.n} · ${t.custo_usd != null ? USD(t.custo_usd, idioma) : tr("custo no rastro", "cost in the trace")} — voltar é grátis (cache)`, `take ${t.n} · ${t.custo_usd != null ? USD(t.custo_usd, idioma) : tr('custo no rastro', 'cost in the trace')} — restore for free (cache)`)
                        : tr("sem rastro de geração — não dá para restaurar com segurança", "no generation trace; cannot restore safely")}
                      onClick={() => void patch({ take_hash: t.hash }, tr(`Take ${t.n} restaurado — US$ 0,00 (cache)`, `Take ${t.n} restored — US$ 0.00 (cache)`))}
                    >
                      take {t.n}{t.escolhido ? ' ✓' : ''}
                      <small>{t.custo_usd != null ? USD(t.custo_usd, idioma) : '—'}{t.escolhido ? tr(" · pago ✓", " · paid ✓") : ''}</small>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="texto-suave">{tr("Escolha um bloco na timeline.", "Choose a block in the timeline.")}</p>
          )}
        </div>

        {bloco && (
          <aside className="edpc-inspetor">
            {bloco.motion ? <div>
              <strong>{tr('Animação gráfica', 'Motion graphics')}</strong>
              <p className="texto-suave">{tr('Textos, logos e movimento usam os materiais da peça. Peça mudanças em “Falar com este bloco”; não é preciso gerar outra imagem.', 'Text, logos and motion use this production’s assets. Request changes through “Discuss this block”; another image does not need to be generated.')}</p>
              {bloco.letreiro.length > 0 && <ul aria-label={tr('Textos da animação', 'Animation text')}>{bloco.letreiro.map((texto, indice) => <li key={indice}>{texto}</li>)}</ul>}
              {motionFeatures.length > 0 && <ul className="texto-suave" aria-label={tr('Recursos da animação', 'Animation features')}>{motionFeatures.map(feature => <li key={feature}>{feature}</li>)}</ul>}
            </div> : <>
            <div className="edpc-linha">
              <label htmlFor="edpc-seed">seed</label>
              <input
                id="edpc-seed" value={seed} inputMode="numeric"
                onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))}
              />
              <button
                className="botao botao-fantasma botao-pequeno" disabled={salvando || !seedMudou}
                onClick={() => void patch({ seed: Number(seed || 0) }, tr("Seed salvo — gerar de novo é que custa", "Seed saved. Only regeneration incurs a cost"))}
              >{tr("salvar", "save")}</button>
            </div>

            <label className="edpc-rotulo" htmlFor="edpc-direcao">
              {tr("DIREÇÃO ", "DIRECTION ")}<span className="texto-suave">{tr("— a IA lê", "— the AI reads this")}</span>
            </label>
            <textarea
              id="edpc-direcao" rows={3} value={direcao}
              onChange={(e) => setDirecao(e.target.value)}
            />
            {direcaoMudou && (
              <p className="edpc-aviso">
                {tr("Direção nova muda a assinatura: salvar é grátis; GERAR com ela custa", "New direction changes the generation signature. Saving is free; generating with it costs")}{' '}{USD(bloco.custo_usd || 0, idioma)} {tr("e sai pelo chat.", "and starts from chat.")}</p>
            )}
            <button
              className="botao botao-fantasma botao-pequeno" disabled={salvando || !direcaoMudou}
              onClick={() => void patch({ direcao }, tr("Direção salva — nada foi gasto", "Direction saved. Nothing was spent"))}
            >{tr("Salvar direção", "Save direction")}</button>
            </>}

            <label className="edpc-rotulo" htmlFor="edpc-nota">
              {tr("NOTA ", "NOTE ")}<span className="texto-suave">{tr("— a IA NÃO lê", "— the AI does not read this")}</span>
            </label>
            <textarea
              id="edpc-nota" rows={2} value={nota}
              placeholder={tr("anotação sua, para os outros da equipe", "your note for teammates")}
              onChange={(e) => setNota(e.target.value)}
            />
            <button
              className="botao botao-fantasma botao-pequeno" disabled={salvando || nota === (bloco.nota ?? '')}
              onClick={() => void patch({ nota }, tr("Nota guardada fora do documento", "Note saved outside the document"))}
            >{tr("Salvar nota", "Save note")}</button>

            <div className="edpc-sigs texto-suave">
              <span>{tr("geração ", "generation ")}<code>{bloco.sig_g}</code> {bloco.gera ? tr("≠ pagará", "≠ paid change") : tr("✓ igual", "✓ unchanged")}</span>
              <span>{tr("composição ", "composition ")}<code>{bloco.sig_c}</code> {bloco.recompoe ? tr("≠ recompor com os materiais existentes", "≠ recompose with existing assets") : tr("✓ igual", "✓ unchanged")}</span>
            </div>

            <div className="edpc-acoes">
              <button
                className="botao botao-fantasma botao-pequeno"
                onClick={() => aoPreencher(
                  tr(`No bloco ${bloco.id} ("${bloco.rotulo}") da peça ${ed.slug}: `, `In block ${bloco.id} (“${bloco.rotulo}”) of production ${ed.slug}: `),
                )}
              >{tr("💬 Falar com este bloco", "💬 Discuss this block")}</button>
              <button
                className="botao botao-fantasma botao-pequeno"
                disabled={salvando}
                onClick={() => void patch({ travado: !bloco.travado },
                  bloco.travado ? tr("Destravado — pode regenerar", "Unlocked. Can regenerate") : tr("Travado — nunca regenera", "Locked. Will not regenerate"))}
              >{bloco.travado ? tr("🔓 Destravar", "🔓 Unlock") : tr("🔒 Travar", "🔒 Lock")}</button>
              <button className="botao botao-fantasma botao-pequeno" onClick={() => void mover(-1)}>{tr("← mover", "← move")}</button>
              <button className="botao botao-fantasma botao-pequeno" onClick={() => void mover(1)}>{tr("mover →", "move →")}</button>
            </div>
          </aside>
        )}
      </div>

      <div className="edpc-timeline" aria-label={tr("Timeline da peça", "Production timeline")}>
        <div className="edpc-lane">
          <span className="edpc-lane-nome">{tr("BLOCOS", "BLOCKS")}</span>
          <div className="edpc-fita">
            {ed.blocos.map((b) => (
              <button
                key={b.id}
                className={`edpc-bloco${b.id === sel ? ' ativo' : ''}${b.gera ? ' pendente' : ''}`}
                style={{ flexGrow: Math.max(1, Math.round(b.dur * 10)) }}
                onClick={() => setSel(b.id)}
                title={`${b.id} · ${b.entrada_s.toFixed(1)}s → ${b.saida_s.toFixed(1)}s${b.gera ? tr(` · gerar ${USD(b.custo_usd || 0, idioma)}`, ` · generate ${USD(b.custo_usd || 0, idioma)}`) : tr(" · pronto", " · ready")}`}
              >
                {thumbsRef.current.get(b.id)
                  ? <img src={thumbsRef.current.get(b.id)} alt="" />
                  : <span className="edpc-bloco-rotulo">{b.id}</span>}
                {b.travado && <span className="edpc-cadeado">🔒</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="edpc-lane">
          <span className="edpc-lane-nome">{tr("ARTE", "ART")}</span>
          <div className="edpc-fita edpc-fita-arte">
            {ed.blocos.map((b) => (
              <span key={b.id} className="edpc-chip" style={{ flexGrow: Math.max(1, Math.round(b.dur * 10)) }}>
                {(b.letreiro[0] ?? b.rotulo).slice(0, 22)}
              </span>
            ))}
          </div>
        </div>
        <div className="edpc-lane">
          <span className="edpc-lane-nome">{tr("ÁUDIO", "AUDIO")}</span>
          <div className="edpc-ondas" title={ed.audio.trilha.existe || ed.audio.narracao.existe
            ? tr("ondas reais do áudio da peça", "actual waveform from this production’s audio")
            : tr("áudio ainda não gerado", "audio not generated yet")}>
            {(ondas.trilha.length ? ondas.trilha : ondas.narracao).map((p, i) => (
              <i key={i} style={{ height: `${Math.max(4, p * 100)}%` }} />
            ))}
            {!ondas.trilha.length && !ondas.narracao.length && (
              <span className="texto-suave">{tr("sem áudio ainda", "no audio yet")}</span>
            )}
          </div>
        </div>
        <p className="texto-suave edpc-legenda-nota">
          {ed.blocos.every(b => b.motion)
            ? tr("Texto, movimento e ordem mudam a composição com os materiais existentes. Peça ajustes nas camadas pela conversa; a tarefa pode consumir IA e infraestrutura, sem nova geração de mídia.", "Text, motion and order affect composition using existing assets. Request layer changes through chat; the task may use AI and infrastructure, without new media generation.")
            : tr("Legenda e ordem são COMPOSIÇÃO — ajustes aqui = US$ 0,00 em provedor. Direção e seed mudam a GERAÇÃO — o custo aparece antes, e o disparo é pelo chat.", "Captions and order affect composition: these changes cost US$ 0.00 in provider charges. Direction and seed affect generation: the cost is shown upfront, and you start it from chat.")}</p>
      </div>

      {visor && (
        <VisorArquivo
          titulo={visor.titulo}
          caminho={visor.caminho}
          midia={visor.midia}
          url={visor.url}
          erro={visor.erro}
          aoFechar={() => {
            if (visor.url) URL.revokeObjectURL(visor.url)
            setVisor(null)
          }}
        />
      )}
    </section>
  )
}
