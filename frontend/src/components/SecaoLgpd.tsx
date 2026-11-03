import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { useIdioma } from '../lib/i18n'
import { useToasts } from './Toasts'
import { Icone } from './Icone'

const PALAVRA_EXCLUIR = 'EXCLUIR'

export function SecaoLgpd() {
  const { t } = useIdioma()
  const { sucesso, falha } = useToasts()
  const { sair } = useAuth()
  const navigate = useNavigate()
  const [exportando, setExportando] = useState(false)
  const [zonaAberta, setZonaAberta] = useState(false)
  const [confirmacao, setConfirmacao] = useState('')
  const [excluindo, setExcluindo] = useState(false)

  async function exportar() {
    setExportando(true)
    try {
      const dados = await api.get<unknown>('/lgpd/exportar-dados')
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'offiz-meus-dados.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      sucesso(t("Seus dados foram exportados — confira o download offiz-meus-dados.json.", "Your data has been exported. Check the offiz-meus-dados.json download."))
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível exportar os seus dados.", "Could not export your data."))
    } finally {
      setExportando(false)
    }
  }

  async function excluirConta() {
    if (confirmacao.trim().toUpperCase() !== PALAVRA_EXCLUIR) {
      falha(t(`Digite ${PALAVRA_EXCLUIR} para confirmar a exclusão da conta.`, `Type ${PALAVRA_EXCLUIR} to confirm account deletion.`))
      return
    }
    setExcluindo(true)
    try {
      const r = await api.del<{ limpeza_anexos_pendente?: boolean }>('/lgpd/excluir-conta', { confirmo: true })
      // Conta excluída: encerra a sessão local e volta para a página inicial.
      await sair()
      navigate('/', { replace: true })
      if (r?.limpeza_anexos_pendente) falha(t('Conta encerrada. A remoção dos anexos privados ficou pendente; entre em contato com o responsável pelo Offiz para concluir a limpeza.', 'Account closed. Private attachment removal is pending; contact the Offiz administrator to complete cleanup.'))
      else sucesso(t('Sua conta foi encerrada.', 'Your account has been closed.'))
    } catch (e) {
      falha(e instanceof ApiError ? e.detail : t("Não foi possível excluir a conta.", "Could not delete the account."))
      setExcluindo(false)
    }
  }

  return (
    <section className="cartao">
      <h2 className="secao-titulo">
        <Icone nome="cadeado" />
        {t("Minha conta e meus dados", "My account and data")}</h2>
      <p className="texto-suave">
        {t("Baixe seus dados pessoais ou encerre sua conta. Os materiais da empresa continuam com ela.", "Download your personal data or close your account. Company materials stay with the company.")}</p>
      <div className="lgpd-exportar">
        <button type="button" className="botao botao-fantasma" onClick={exportar} disabled={exportando}>
          {exportando ? (
            t("Exportando…", "Exporting…")
          ) : (
            <>
              <Icone nome="baixar" tamanho={15} />
              {t("Baixar meus dados", "Download my data")}</>
          )}
        </button>
        <span className="texto-suave">{t("perfil, organizações, preferências e registros de uso.", "profile, organizations, preferences, and usage records.")}</span>
      </div>

      <div className="lgpd-perigo" role="group" aria-label={t("Zona de perigo", "Danger zone")}>
        <div className="lgpd-perigo-cabecalho">
          <strong>{t("Zona de perigo — excluir a conta", "Danger zone — delete account")}</strong>
          <button type="button" className="botao-texto perigo" onClick={() => setZonaAberta((v) => !v)}>
            {zonaAberta ? t('Fechar', 'Close') : t('Excluir minha conta', 'Delete my account')}
          </button>
        </div>
        <p className="texto-suave">
          {t("Apaga o seu acesso e os seus dados pessoais em definitivo. Esta ação ", "Permanently deletes your access and personal data. This action ")}<strong>{t("não pode ser desfeita", "cannot be undone")}</strong>{t(". Dados das organizações (tarefas, documentos de clientes) seguem as regras de retenção de cada organização.", ". Organization data (tasks and client documents) follows each organization’s retention rules.")}</p>
        {zonaAberta && (
          <div className="lgpd-perigo-confirmar">
            <label className="campo">
              <span>
                {t("Para confirmar, digite ", "To confirm, type ")}<strong>{PALAVRA_EXCLUIR}</strong>
              </span>
              <input
                type="text"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                placeholder={PALAVRA_EXCLUIR}
                autoComplete="off"
                disabled={excluindo}
              />
            </label>
            <button
              type="button"
              className="botao botao-perigo"
              onClick={excluirConta}
              disabled={excluindo || confirmacao.trim().toUpperCase() !== PALAVRA_EXCLUIR}
            >
              {excluindo ? t("Excluindo…", "Deleting…") : t("Excluir minha conta em definitivo", "Permanently delete my account")}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
