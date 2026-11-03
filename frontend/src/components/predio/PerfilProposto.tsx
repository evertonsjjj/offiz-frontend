import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { useIdioma } from '../../lib/i18n'
import { chaveSecaoPerfil, lerSecoesPerfil } from '../../lib/perfilSabatina'
import type { SugestaoCanon } from '../../lib/types'
import { Icone } from '../Icone'
import './perfil-proposto.css'

/** A confirmação é sobre o texto visível e editável, não sobre um resumo
 * produzido pelo modelo. Desmarcar uma seção não apaga conhecimento anterior. */
export type ConfirmacaoPerfil = { base: string; secoes: SugestaoCanon['secoes']; concluir: boolean }

export function PerfilProposto({ proposta, canonUrl, podeSalvar, salvando, aoConfirmar, aoContinuar, continuarSomenteCorrecoes = false }: {
  proposta: SugestaoCanon
  canonUrl: string
  podeSalvar: boolean
  salvando: boolean
  aoConfirmar: (confirmacao: ConfirmacaoPerfil) => Promise<void>
  aoContinuar: (secoes: SugestaoCanon['secoes']) => void
  /** Proposta da IA: texto intocado não se torna uma resposta da pessoa.
   * O roteiro de preparação já tem origem humana e conserva a seleção completa. */
  continuarSomenteCorrecoes?: boolean
}) {
  const { t } = useIdioma()
  // A origem acompanha o texto montado; uma releitura da proposta não prova
  // uma edição da pessoa nem troca a base de comparação do cartão visível.
  const [secoes, setSecoes] = useState(() => proposta.secoes.map(secao => ({ ...secao, conteudoOriginal: secao.conteudo, incluir: true })))
  const [base, setBase] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [conflito, setConflito] = useState(false)
  const [concluir, setConcluir] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const lendoRef = useRef<AbortController | null>(null)
  const vivoRef = useRef(true)
  const envioRef = useRef(false)
  const carregar = useCallback(async () => {
    lendoRef.current?.abort()
    const controller = new AbortController()
    lendoRef.current = controller
    setCarregando(true)
    setErro(null)
    try {
      const atual = await api.get<{ conteudo: string | null }>(canonUrl, controller.signal)
      if (controller.signal.aborted) return
      setBase(atual.conteudo ?? '')
      setConflito(false)
    } catch (e) {
      if (!controller.signal.aborted) setErro(e instanceof ApiError ? e.detail : t('Não consegui abrir o perfil. Tente novamente.', 'Could not load the profile. Try again.'))
    } finally {
      if (!controller.signal.aborted) setCarregando(false)
    }
  }, [canonUrl, t])
  useEffect(() => {
    vivoRef.current = true
    if (podeSalvar) void carregar()
    return () => { vivoRef.current = false; lendoRef.current?.abort() }
  }, [carregar, podeSalvar])
  const selecionadas = secoes.filter(secao => secao.incluir)
  const corrigidas = secoes.filter(secao => secao.incluir && !!secao.conteudo.trim()
    && secao.conteudo.trim() !== secao.conteudoOriginal.trim())
  const valido = selecionadas.length > 0 && selecionadas.every(secao => secao.conteudo.trim())
  const ocupado = salvando || enviando
  const atuais = lerSecoesPerfil(base ?? '')
  async function confirmar() {
    if (base === null || !valido || !podeSalvar || ocupado || conflito || carregando || envioRef.current) return
    envioRef.current = true
    setEnviando(true)
    setErro(null)
    try {
      await aoConfirmar({ base, secoes: selecionadas.map(({ secao, conteudo }) => ({ secao, conteudo: conteudo.trim() })), concluir })
    } catch (e) {
      if (!vivoRef.current) return
      if (e instanceof ApiError && e.status === 409) setConflito(true)
      setErro(e instanceof ApiError ? e.detail : t('Não consegui guardar agora. Seu texto continua aqui.', 'Could not save right now. Your text is still here.'))
    } finally {
      envioRef.current = false
      if (vivoRef.current) setEnviando(false)
    }
  }

  return <section className="conversa-sugestao perfil-proposto" aria-label={t('Confira o perfil', 'Review your profile')}>
    <p className="conversa-sugestao-titulo"><Icone nome="canon" tamanho={15} /> <strong>{t('Confira o que vamos guardar', 'Review what we will save')}</strong></p>
    <p>{proposta.resumo}</p>
    <p className="texto-suave">{t('Corrija o que não estiver certo. Desmarque o que ainda não sabe ou não quer guardar. O restante do perfil continua como está.', 'Correct anything that is inaccurate. Uncheck anything you do not know yet or do not want to save. The rest of your profile stays as it is.')}</p>
    {carregando && <p role="status">{t('Abrindo o perfil atual para comparar…', 'Loading the current profile for comparison…')}</p>}
    {erro && <p role="alert">{erro}</p>}
    {conflito && <p>{t('O perfil mudou enquanto você revisava. Reabra a comparação e confira antes de confirmar. Suas correções serão mantidas.', 'The profile changed while you were reviewing. Reload the comparison and check it before confirming. Your edits will be kept.')}</p>}
    {podeSalvar && !carregando && (conflito || base === null) && <button type="button" className="botao-texto" onClick={() => void carregar()}>{t('Reabrir comparação', 'Reload comparison')}</button>}
    <div className="perfil-proposto-secoes">
      {secoes.map((secao, index) => <div key={`${index}:${secao.secao}`} className="perfil-proposto-secao">
        <label className="perfil-proposto-incluir">
          <input type="checkbox" checked={secao.incluir} disabled={ocupado || !podeSalvar}
            onChange={event => setSecoes(atuais => atuais.map((atual, i) => i === index ? { ...atual, incluir: event.target.checked } : atual))} />
          <span>{secao.secao}</span>
        </label>
        {atuais.has(chaveSecaoPerfil(secao.secao)) && <div className="perfil-proposto-atual"><strong>{t('Hoje está assim', 'Current information')}</strong><p>{atuais.get(chaveSecaoPerfil(secao.secao))}</p><span>{t('O texto abaixo vai substituir esta seção.', 'The text below will replace this section.')}</span></div>}
        <textarea aria-label={t(`Texto de ${secao.secao}`, `Text for ${secao.secao}`)} rows={3} value={secao.conteudo}
          disabled={ocupado || !podeSalvar || !secao.incluir}
          onChange={event => setSecoes(atuais => atuais.map((atual, i) => i === index ? { ...atual, conteudo: event.target.value } : atual))} />
      </div>)}
    </div>
    <label className="perfil-proposto-incluir"><input type="checkbox" checked={concluir} disabled={ocupado || !podeSalvar} onChange={event => setConcluir(event.target.checked)} /><span>{t('Já revisei o perfil e quero encerrar esta preparação.', 'I have reviewed the profile and want to finish this setup.')}</span></label>
    <p className="texto-suave">{t('Você pode trabalhar e completar o perfil depois. Encerrar a preparação não aprova entregas.', 'You can start working and complete the profile later. Finishing setup does not approve deliverables.')}</p>
    {continuarSomenteCorrecoes && corrigidas.length > 0 && <p className="texto-suave" role="status">{t('Ao continuar, suas correções ficam no campo da conversa para você revisar e enviar. O perfil só muda quando você confirmar.', 'When you continue, your corrections go to the conversation field for you to review and send. The profile changes only when you confirm.')}</p>}
    <div className="conversa-sugestao-acoes">
      <button type="button" className="botao botao-primario botao-pequeno" disabled={ocupado || !podeSalvar || !valido || base === null || conflito || carregando}
        onClick={() => void confirmar()}>
        {ocupado ? t('Guardando…', 'Saving…') : t('Confirmar e guardar', 'Confirm and save')}
      </button>
      <button type="button" className="botao botao-fantasma botao-pequeno" disabled={ocupado}
        onClick={() => aoContinuar((continuarSomenteCorrecoes ? corrigidas : selecionadas).map(({ secao, conteudo }) => ({ secao, conteudo })))}>{t('Continuar conversando', 'Keep talking')}</button>
      {!podeSalvar && <span className="texto-suave">{t('Somente o dono ou um administrador pode guardar informações da empresa.', 'Only the owner or an administrator can save company knowledge.')}</span>}
    </div>
  </section>
}
