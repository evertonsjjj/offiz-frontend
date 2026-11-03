/* ------------------------------------------------------------------ */
/* "Fotos e vozes" — os porta-vozes do escritório       */
/*                                                                     */
/* Uma pessoa = uma pasta em memoria/brand/acervo/porta-vozes/<nome>/   */
/* com a FOTO (que o avatar anima) e a AMOSTRA DE VOZ (que a skill      */
/* clonar-voz manda para a ElevenLabs). Havia um terceiro papel, o      */
/* "vídeo de referência": saiu em 15/08/2026 porque nenhum motor o lia  */
/* — nem o avatar, nem a clonagem, nem o peca.py. Campo que ninguém lê  */
/* promete ao dono que mandar o arquivo melhora o resultado.            */
/* O voice_id fica no perfil.md — quem escreve lá é a skill,            */
/* nunca esta tela: clonar voz gasta a chave da organização e exige     */
/* consentimento, então é decisão de tarefa, não de clique.             */
/*                                                                     */
/* A tela existe para o dono VER o que já tem, trocar a foto/voz e      */
/* excluir — sem abrir pasta nenhuma e sem saber o que é voice_id.      */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, api, getSessionIdentity } from '../../lib/api'
import { Icone } from '../Icone'
import { useToasts } from '../Toasts'
import { useConfirmacao } from '../useConfirmacao'
import { useIdioma, type Traduzir } from '../../lib/i18n'

type Papel = 'foto' | 'voz'

/** O que a IA achou da foto. É CONSELHO, nunca portão: o dono manda. */
type Veredito = {
  veredito: 'boa' | 'ajustar' | 'ruim'
  resumo: string
  problemas: string[]
  quando: string
}

type PortaVoz = {
  nome: string
  arquivos: { nome: string; tamanho_bytes: number }[]
  tem_foto: boolean
  tem_voz: boolean
  foto_veredito: Veredito | null
  voice_id: string | null
  pronto: boolean
}

const titulosVeredito = (t: Traduzir): Record<Veredito['veredito'], string> => ({
  boa: t("A foto serve para o vídeo.", "This photo works for the video."),
  ajustar: t("Dá para usar, mas o vídeo fica melhor se você ajustar:", "You can use it, but the video will improve if you adjust:"),
  ruim: t("Esta foto não serve para gerar o vídeo:", "This photo is not suitable for generating the video:"),
})

/** O que cada papel aceita — o mesmo contrato do backend (arquivos.py). */
const ACEITA: Record<Papel, string> = {
  foto: 'image/png,image/jpeg,image/webp',
  voz: 'audio/*',
}

const rotulosMaterial = (t: Traduzir): Record<Papel, string> => ({
  foto: t("foto do rosto", "portrait photo"),
  voz: t("gravação da voz", "voice recording"),
})

/** A frase que diz ao dono o que FALTA — em linguagem de gente, não em
 *  nome de campo. Ordem importa: sem foto não há vídeo nenhum. */
function pendencia(p: PortaVoz, t: Traduzir): string | null {
  if (!p.tem_foto && !p.voice_id && !p.tem_voz)
    return t("Falta a foto do rosto e a voz. Envie os dois e eu preparo a voz na conversa.", "The portrait photo and voice are missing. Upload both, then ask me in the conversation to prepare the voice.")
  if (!p.tem_foto) return t("Falta a foto do rosto (de frente, olhando para a câmera).", "A portrait photo is missing (facing and looking at the camera).")
  if (!p.voice_id && p.tem_voz)
    return t(`A gravação chegou, mas a voz ainda não foi preparada — me peça isso na conversa ("prepara a voz do ${p.nome}").`, `The recording was received, but the voice is not prepared yet. Ask in the conversation to prepare the voice for ${p.nome}.`)
  if (!p.voice_id) return t("Falta a gravação da voz (1 a 3 minutos falando naturalmente).", "A voice recording is missing (1–3 minutes of natural speech).")
  return null
}

export default function PortaVozes({ orgId, slug }: { orgId: number; slug: string }) {
  return <PortaVozesConteudo key={`${orgId}:${slug}:${getSessionIdentity()}`} orgId={orgId} slug={slug} />
}

function PortaVozesConteudo({ orgId, slug }: { orgId: number; slug: string }) {
  const { t } = useIdioma()
  const ROTULO = rotulosMaterial(t)
  const TITULO_VEREDITO = titulosVeredito(t)
  const [pessoas, setPessoas] = useState<PortaVoz[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // `pessoa/papel` — o mesmo papel existe em várias pessoas.
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [novo, setNovo] = useState('')
  const [criando, setCriando] = useState(false)
  // O gravador na tela: para QUEM o painel está aberto, e a gravação em voo.
  const [gravandoDe, setGravandoDe] = useState<string | null>(null)
  const [gravacao, setGravacao] = useState<MediaRecorder | null>(null)
  const [abrindoMicrofone, setAbrindoMicrofone] = useState(false)
  const [finalizandoGravacao, setFinalizandoGravacao] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const cronoRef = useRef<number | null>(null)
  const { sucesso, falha } = useToasts()

  /* Desmontar no meio de uma gravação solta o microfone — o LED do navegador
   * aceso depois de sair da tela é um susto que nenhum toast conserta.
   *
   * DEPS VAZIAS, e isso importa (bug pego na revisão de 16/08): com [gravacao]
   * o cleanup rodava no PRÓPRIO setGravacao(rec) que inicia a gravação, e
   * matava o setInterval criado três linhas depois — o cronômetro ficava
   * 0:00 a gravação inteira. O stream vive num ref justamente para o cleanup
   * de desmontagem alcançá-lo sem precisar do estado nas deps. */
  const streamRef = useRef<MediaStream | null>(null)
  const gravacaoRef = useRef<MediaRecorder | null>(null)
  const envioGravacaoRef = useRef<MediaRecorder | null>(null)
  const permissaoRef = useRef(0)
  const pedindoMicrofoneRef = useRef(false)
  const telaAtivaRef = useRef(true)
  const sessaoRef = useRef(getSessionIdentity())
  const leituraRef = useRef<AbortController | null>(null)
  const { confirmar, dialogo } = useConfirmacao(`${sessaoRef.current}:${orgId}:${slug}`)
  /* A conferência da foto roda numa thread do servidor e leva segundos; o
   * upload responde antes dela. Sem estas releituras o dono veria "ainda não
   * conferi" para sempre e só descobriria o veredito ao trocar de aba. */
  const relerRef = useRef<number[]>([])
  useEffect(() => {
    telaAtivaRef.current = true
    return () => {
      telaAtivaRef.current = false
      permissaoRef.current += 1
      pedindoMicrofoneRef.current = false
      leituraRef.current?.abort()
      if (cronoRef.current) window.clearInterval(cronoRef.current)
      cronoRef.current = null
      const recorder = gravacaoRef.current
      gravacaoRef.current = null
      envioGravacaoRef.current = null
      if (recorder) {
        recorder.onstop = null
        recorder.ondataavailable = null
        if (recorder.state !== 'inactive') recorder.stop()
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      relerRef.current.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  const telaAtual = useCallback(() => telaAtivaRef.current && getSessionIdentity() === sessaoRef.current, [])

  const base = `/predios/${orgId}/${slug}/porta-vozes`

  const carregar = useCallback(async () => {
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    try {
      const r = await api.get<{ porta_vozes: PortaVoz[] }>(`/predios/${orgId}/${slug}/porta-vozes`, controller.signal)
      if (!telaAtual() || controller.signal.aborted) return
      setPessoas(Array.isArray(r?.porta_vozes) ? r.porta_vozes : [])
      setErro(null)
    } catch (e) {
      if (!telaAtual() || controller.signal.aborted) return
      // Falha de rede vira AVISO, nunca lista vazia: "nenhum apresentador"
      // depois de cadastrar lê como "o sistema apagou o meu material".
      setErro(
        e instanceof ApiError ? e.detail : t("Não consegui ver os apresentadores agora.", "Could not load presenters. Please try again."),
      )
    }
  }, [orgId, slug, t, telaAtual])

  useEffect(() => {
    carregar()
  }, [carregar])

  /** Duas releituras espaçadas, sem polling eterno: a conferência ou saiu
   *  nesse tempo, ou o dono usa "Conferir de novo". */
  const esperarVeredito = useCallback(() => {
    relerRef.current.forEach((t) => window.clearTimeout(t))
    relerRef.current = [3000, 9000].map((ms) =>
      window.setTimeout(() => void carregar(), ms),
    )
  }, [carregar])

  /** "Conferir de novo": síncrono, porque quem clicou está olhando. */
  async function conferirFoto(pessoa: string) {
    if (!telaAtual()) return
    setOcupado(`${pessoa}/conferir`)
    try {
      await api.post(`${base}/${encodeURIComponent(pessoa)}/conferir-foto`, {})
      if (!telaAtual()) return
      await carregar()
    } catch (e) {
      if (!telaAtual()) return
      falha(e instanceof ApiError ? e.detail : t("Não consegui conferir a foto agora.", "Could not check the photo. Please try again."))
    } finally {
      if (telaAtual()) setOcupado(null)
    }
  }

  async function enviar(pessoa: string, papel: Papel, arquivo: File | undefined) {
    if (!arquivo || !telaAtual()) return
    setOcupado(`${pessoa}/${papel}`)
    try {
      const fd = new FormData()
      fd.append('arquivo', arquivo)
      await api.postForm(
        `${base}/${encodeURIComponent(pessoa)}?papel=${papel}`,
        fd,
      )
      if (!telaAtual()) return
      sucesso(
        papel === 'voz'
          ? t(`Gravação de ${pessoa} guardada. Me peça na conversa para preparar a voz.`, `Recording for ${pessoa} saved. Ask in the conversation to prepare the voice.`)
          : t(`${ROTULO[papel]} de ${pessoa} guardada. Estou conferindo se ela serve.`, `${ROTULO[papel]} for ${pessoa} saved. Checking its suitability.`),
      )
      await carregar()
      if (papel === 'foto') esperarVeredito()
    } catch (e) {
      if (!telaAtual()) return
      falha(e instanceof ApiError ? e.detail : t(`Não consegui receber a ${ROTULO[papel]}.`, `Could not upload the ${ROTULO[papel]}.`))
    } finally {
      if (telaAtual()) setOcupado(null)
    }
  }

  async function excluirMaterial(pessoa: string, papel: Papel) {
    if (!telaAtual() || ocupado !== null) return
    if (!await confirmar({ titulo: t('Remover material da pessoa', 'Remove person’s material'), mensagem: t(`Tirar a ${ROTULO[papel]} de ${pessoa}?`, `Remove the ${ROTULO[papel]} for ${pessoa}?`), acao: t('Remover material', 'Remove material') }) || !telaAtual()) return
    setOcupado(`${pessoa}/${papel}`)
    try {
      await api.del(`${base}/${encodeURIComponent(pessoa)}/${papel}`)
      if (!telaAtual()) return
      sucesso(t(`A ${ROTULO[papel]} de ${pessoa} saiu.`, `${ROTULO[papel]} for ${pessoa} removed.`))
      await carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : t("Não consegui excluir agora.", "Could not delete this item. Please try again."))
    } finally {
      if (telaAtual()) setOcupado(null)
    }
  }

  async function excluirPessoa(pessoa: string) {
    if (!telaAtual() || ocupado !== null) return
    if (!await confirmar({ titulo: t('Excluir pessoa do escritório', 'Delete person from workspace'), mensagem: t(`Tirar ${pessoa} do escritório? A foto e a gravação são apagadas. A voz já preparada continua na conta do provedor.`, `Remove ${pessoa} from the workspace? The photo and recording will be deleted. The prepared voice remains in your provider account.`), acao: t('Excluir pessoa', 'Delete person') }) || !telaAtual()) return
    setOcupado(`${pessoa}/*`)
    try {
      await api.del(`${base}/${encodeURIComponent(pessoa)}`)
      if (!telaAtual()) return
      sucesso(t(`${pessoa} saiu dos apresentadores.`, `${pessoa} removed from presenters.`))
      await carregar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : t("Não consegui excluir agora.", "Could not delete this item. Please try again."))
    } finally {
      if (telaAtual()) setOcupado(null)
    }
  }

  /** Criar = subir a primeira foto de um nome novo (a pasta nasce com ela).
   *  Sem foto não existe apresentador, então não há "pessoa vazia". */
  async function criar(arquivo: File | undefined, papel: Papel = 'foto') {
    const nome = novo.trim()
    if (!nome || !arquivo || !telaAtual()) return
    setCriando(true)
    try {
      const fd = new FormData()
      fd.append('arquivo', arquivo)
      await api.postForm(`${base}/${encodeURIComponent(nome)}?papel=${papel}`, fd)
      if (!telaAtual()) return
      sucesso(papel === 'voz' ? t(`Áudio de ${nome} guardado.`, `Audio for ${nome} saved.`) : t(`${nome} cadastrado. Você também pode enviar um áudio.`, `${nome} added. You can also upload audio.`))
      setNovo('')
      await carregar()
      if (papel === 'foto') esperarVeredito()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : t("Não consegui cadastrar essa pessoa.", "Could not add this person. Please try again."))
    } finally {
      if (telaAtual()) setCriando(false)
    }
  }

  /** O veredito da IA sobre a foto — conselho com motivo, e sempre com a
   *  saída aberta: nada aqui impede o dono de gerar o vídeo assim mesmo. */
  function blocoVeredito(p: PortaVoz) {
    if (!p.tem_foto) return null
    const v = p.foto_veredito
    const conferindo = ocupado === `${p.nome}/conferir`
    const botao = (
      <button
        type="button"
        className="botao botao-fantasma botao-pequeno pv-conferir"
        disabled={ocupado !== null}
        onClick={() => conferirFoto(p.nome)}
      >
        {conferindo ? t("Conferindo…", "Checking…") : v ? t("Conferir de novo", "Check again") : t("Conferir a foto", "Check photo")}
      </button>
    )
    if (!v)
      return (
        <div className="pv-veredito pv-veredito-ausente">
          <p className="texto-suave">{t("Ainda não conferi esta foto.", "This photo has not been checked yet.")}</p>
          {botao}
        </div>
      )
    return (
      <div className={`pv-veredito pv-veredito-${v.veredito}`}>
        <p className="pv-veredito-titulo">
          <Icone nome={v.veredito === 'boa' ? 'check' : 'alerta'} tamanho={15} />{' '}
          {TITULO_VEREDITO[v.veredito]}
        </p>
        {v.problemas.length > 0 && (
          <ul className="pv-veredito-lista">
            {v.problemas.map((problema) => (
              <li key={problema}>{problema}</li>
            ))}
          </ul>
        )}
        {v.resumo && <p className="texto-suave">{v.resumo}</p>}
        {v.veredito !== 'boa' && (
          <p className="texto-suave pv-veredito-saida">
            {t("Isto é uma opinião minha — se você quiser, gero o vídeo com esta foto do mesmo jeito.", "This is a recommendation. You can still choose to use this photo for the video.")}
          </p>
        )}
        {botao}
      </div>
    )
  }

  function botoesDeMaterial(p: PortaVoz, papel: Papel, tem: boolean) {
    const chave = `${p.nome}/${papel}`
    return (
      <li key={papel} className="sabe-material">
        <span className="sabe-material-nome">
          {tem ? '✓' : '—'} {ROTULO[papel]}
          {papel === 'voz' && p.voice_id ? t(" (voz pronta)", " (voice ready)") : ''}
        </span>
        {papel === 'voz' && (
          <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            disabled={ocupado !== null && gravandoDe !== p.nome}
            onClick={() => alternarGravador(p.nome)}
          >
            <Icone nome="microfone" tamanho={15} />{' '}
            {gravandoDe === p.nome ? gravacao || abrindoMicrofone ? t('Cancelar gravação', 'Cancel recording') : t("Fechar", "Close") : tem ? t("Regravar aqui", "Record again") : t("Gravar aqui", "Record here")}
          </button>
        )}
        <label className="botao botao-fantasma botao-pequeno" aria-busy={ocupado === chave}>
          {ocupado === chave ? t("Enviando…", "Uploading…") : tem ? t("Trocar", "Replace") : t("Enviar", "Upload")}
          <input
            type="file"
            hidden
            accept={ACEITA[papel]}
            disabled={ocupado !== null}
            onChange={(e) => {
              enviar(p.nome, papel, e.target.files?.[0])
              e.target.value = '' // enviar o MESMO arquivo de novo tem que disparar
            }}
          />
        </label>
        {tem && (
          <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            disabled={ocupado !== null}
            onClick={() => excluirMaterial(p.nome, papel)}
            aria-label={t(`Excluir ${ROTULO[papel]} de ${p.nome}`, `Delete ${ROTULO[papel]} for ${p.nome}`)}
          >
            <Icone nome="lixeira" tamanho={15} />
          </button>
        )}
      </li>
    )
  }

  /* ── O GRAVADOR NA PRÓPRIA TELA (16/08/2026) ─────────────────────────
   * A voz era só upload — e quem não tem um arquivo de áudio pronto desiste.
   * Com o roteiro na frente e o botão vermelho, a barreira vira um minuto de
   * leitura. O .webm gravado sobe pelo MESMO endpoint do upload (a whitelist
   * do papel `voz` já aceita webm); quem clona continua sendo a skill, com
   * consentimento — esta tela só grava o arquivo. */
  function painelGravador(p: PortaVoz) {
    if (gravandoDe !== p.nome) return null
    // O backend guarda a pessoa como slug ("marcela-rangel") — mas o roteiro
    // é TEXTO PARA LER EM VOZ ALTA, e ninguém se apresenta soletrando hífen.
    const nomeFalado = p.nome
      .replace(/-/g, ' ')
      .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
    return (
      <div className="pv-gravador">
        <strong>{t("Leia em voz alta, no seu ritmo normal", "Read aloud at your normal pace")}</strong>
        <blockquote className="pv-roteiro">
          {t(`Oi! Eu sou ${nomeFalado}, e esta é a minha voz. Vou falar por um minuto sobre o que a gente faz, do jeito que eu falaria com um cliente: o que oferecemos, para quem, e por que eu acredito nisso. Se eu errar uma palavra, sigo em frente — o natural vale mais que o perfeito.`, `Hi! I am ${nomeFalado}, and this is my voice. I will spend a minute talking about our work as I would to a customer: what we offer, who it is for, and why I believe in it. If I make a mistake, I will keep going — natural speech matters more than perfection.`)}
        </blockquote>
        <p className="texto-suave pv-dica">
          {t("Um a três minutos bastam. Ambiente sem eco, celular ou microfone a um palmo do rosto. Errou? Continua — dá para cortar depois.", "One to three minutes is enough. Choose a room without echo, with the phone or microphone about a handspan from your face. Made a mistake? Keep going; you can edit it later.")}
        </p>
        <div className="pv-controles">
          <button
            type="button"
            className={`botao botao-pequeno ${gravacao ? 'botao-perigo' : 'botao-primario'}`}
            disabled={ocupado !== null || abrindoMicrofone || finalizandoGravacao}
            onClick={() => (gravacao ? pararGravacao() : iniciarGravacao(p.nome))}
          >
            {gravacao ? (
              <>
                <Icone nome="parar" tamanho={15} /> {t("Parar e enviar", "Stop and upload")} (
                {`${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`})
              </>
            ) : (
              <>
                <Icone nome="microfone" tamanho={15} /> {abrindoMicrofone ? t('Abrindo microfone…', 'Opening microphone…') : finalizandoGravacao ? t('Preparando áudio…', 'Preparing audio…') : t("Começar a gravar", "Start recording")}
              </>
            )}
          </button>
          {gravacao && <span className="pv-vivo" aria-hidden="true" />}
        </div>
      </div>
    )
  }

  async function iniciarGravacao(pessoa: string) {
    if (pedindoMicrofoneRef.current || gravacaoRef.current || !telaAtual()) return
    const pedido = ++permissaoRef.current
    pedindoMicrofoneRef.current = true
    setAbrindoMicrofone(true)
    let stream: MediaStream | null = null
    let recorder: MediaRecorder | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (pedido !== permissaoRef.current || !telaAtual()) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const rec = new MediaRecorder(stream)
      recorder = rec
      gravacaoRef.current = rec
      const streamDaGravacao = stream
      const pedacos: Blob[] = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) pedacos.push(e.data)
      }
      rec.onstop = () => {
        streamDaGravacao.getTracks().forEach((track) => track.stop())
        if (streamRef.current === streamDaGravacao) streamRef.current = null
        const enviarAudio = envioGravacaoRef.current === rec
        if (gravacaoRef.current === rec) gravacaoRef.current = null
        if (envioGravacaoRef.current === rec) envioGravacaoRef.current = null
        if (!telaAtual()) return
        setGravacao(null)
        setFinalizandoGravacao(false)
        setGravandoDe(null)
        if (!enviarAudio) return
        const blob = new Blob(pedacos, { type: rec.mimeType || 'audio/webm' })
        if (blob.size === 0) {
          falha(t("A gravação saiu vazia — confira o microfone e tente de novo.", "The recording is empty. Check your microphone and try again."))
          return
        }
        // O MESMO caminho do upload: o backend renomeia para voz.webm.
        void enviar(pessoa, 'voz', new File([blob], 'voz-gravada.webm', { type: blob.type }))
      }
      rec.start()
      setGravacao(rec)
      setSegundos(0)
      cronoRef.current = window.setInterval(() => setSegundos((s) => s + 1), 1000)
    } catch {
      stream?.getTracks().forEach((track) => track.stop())
      if (streamRef.current === stream) streamRef.current = null
      if (gravacaoRef.current === recorder) gravacaoRef.current = null
      if (pedido !== permissaoRef.current || !telaAtual()) return
      // O caso comum: permissão negada ou sem microfone. Sem estado eterno de
      // "gravando" — a falha é dita e o upload de arquivo continua ali.
      falha(
        t("Não consegui acessar o microfone. Libere a permissão no navegador — ou envie um arquivo de áudio pelo botão ao lado.", "Could not access the microphone. Allow microphone access in your browser or upload an audio file using the adjacent button."),
      )
      setGravacao(null)
    } finally {
      if (pedido === permissaoRef.current) {
        pedindoMicrofoneRef.current = false
        if (telaAtual()) setAbrindoMicrofone(false)
      }
    }
  }

  function pararGravacao() {
    const rec = gravacaoRef.current
    if (!rec || rec.state === 'inactive' || !telaAtual()) return
    if (cronoRef.current) {
      window.clearInterval(cronoRef.current)
      cronoRef.current = null
    }
    envioGravacaoRef.current = rec
    setFinalizandoGravacao(true)
    rec.stop()
  }

  function cancelarGravacao() {
    permissaoRef.current += 1
    pedindoMicrofoneRef.current = false
    envioGravacaoRef.current = null
    if (cronoRef.current) window.clearInterval(cronoRef.current)
    cronoRef.current = null
    const rec = gravacaoRef.current
    gravacaoRef.current = null
    if (rec) {
      rec.onstop = null
      rec.ondataavailable = null
      if (rec.state !== 'inactive') rec.stop()
    }
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setAbrindoMicrofone(false)
    setFinalizandoGravacao(false)
    setGravacao(null)
    setGravandoDe(null)
  }

  function alternarGravador(pessoa: string) {
    if (gravandoDe === pessoa) {
      cancelarGravacao()
    } else {
      cancelarGravacao()
      setGravandoDe(pessoa)
    }
  }

  return (
    <section className="sabe-bloco">
      {dialogo}
      <header className="sabe-bloco-topo">
        <div>
          <h3>{t("Fotos e vozes", "Photos and voices")}</h3>
          <p className="texto-suave">
            {t("Guarde fotos e gravações de quem participa dos seus conteúdos. Use o áudio como referência de voz e complete a foto quando precisar de uma apresentação em vídeo.", "Save photos and recordings of people featured in your content. Use audio as a voice reference and add a photo when you need a video presenter.")}
          </p>
        </div>
      </header>

      {erro && <p className="alerta alerta-erro" role="alert">{erro} <button type="button" className="botao-texto" onClick={() => void carregar()}>{t('Tentar novamente', 'Try again')}</button></p>}
      {pessoas === null && !erro && <p role="status">{t('Carregando pessoas…', 'Loading people…')}</p>}

      {pessoas !== null && (
        <div className="sabe-cartoes-acervo">
          {pessoas.map((p) => {
            const falta = pendencia(p, t)
            return (
              <div key={p.nome} className="sabe-card sabe-cartao-acervo">
                <strong className="sabe-card-titulo">
                  <Icone nome={p.pronto ? 'estudio' : 'ampulheta'} tamanho={15} /> {p.nome}
                </strong>
                <p className="texto-suave">
                  {p.pronto
                    ? t("Pronto: já posso gerar vídeo com esta pessoa apresentando.", "Ready to generate a video with this presenter.")
                    : falta}
                </p>
                <ul className="sabe-lista-materiais">
                  {botoesDeMaterial(p, 'foto', p.tem_foto)}
                  {botoesDeMaterial(p, 'voz', p.tem_voz)}
                </ul>
                {blocoVeredito(p)}
                {painelGravador(p)}
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  disabled={ocupado !== null}
                  onClick={() => excluirPessoa(p.nome)}
                >
                  {ocupado === `${p.nome}/*` ? (
                    t("Excluindo…", "Deleting…")
                  ) : (
                    <>
                      <Icone nome="lixeira" tamanho={15} /> {t(`Tirar ${p.nome}`, `Remove ${p.nome}`)}
                    </>
                  )}
                </button>
              </div>
            )
          })}

          <div className="sabe-card sabe-cartao-acervo">
            <strong className="sabe-card-titulo">
              <Icone nome="mais" tamanho={15} /> {t("Cadastrar pessoa", "Add person")}
            </strong>
            <p className="texto-suave">
              {t("Escreva o nome e envie uma foto ou um áudio. Você pode completar os materiais depois.", "Enter a name and upload a photo or audio. You can add the other materials later.")}
            </p>
            <input
              type="text"
              className="campo"
              placeholder={t("Nome (ex.: Everton)", "Name (e.g. Everton)")}
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              disabled={criando}
              aria-label={t("Nome do apresentador", "Presenter name")}
            />
            <div className="pv-novos-materiais">
            <label
              className="botao botao-fantasma sabe-subir"
              aria-busy={criando}
              aria-disabled={!novo.trim()}
            >
              {criando ? (
                t("Enviando…", "Uploading…")
              ) : (
                <>
                  <Icone nome="subir" tamanho={15} /> {t("Enviar a foto", "Upload photo")}
                </>
              )}
              <input
                type="file"
                className="sr-only"
                aria-label={t('Foto da pessoa', 'Person’s photo')}
                accept={ACEITA.foto}
                disabled={criando || !novo.trim()}
                onChange={(e) => {
                  criar(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
            <label className="botao botao-fantasma sabe-subir" aria-busy={criando}>
              <Icone nome="subir" tamanho={15} /> {t('Enviar áudio', 'Upload audio')}
              <input type="file" className="sr-only" aria-label={t('Áudio da pessoa', 'Person’s audio')} accept={ACEITA.voz} disabled={criando || !novo.trim()} onChange={e => { void criar(e.target.files?.[0], 'voz'); e.target.value = '' }} />
            </label>
            </div>
            <p className="texto-suave">{t('O envio guarda a gravação no acervo. Criar uma voz de IA é uma etapa separada, com autorização da pessoa.', 'Uploading saves the recording in your library. Creating an AI voice is a separate step that requires the person’s permission.')}</p>
            {!novo.trim() && (
              <p className="texto-suave">{t("Escreva o nome primeiro para liberar o envio.", "Enter a name to enable upload.")}</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
