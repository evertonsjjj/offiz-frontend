import { useEffect, useRef, useState } from 'react'
import { useIdioma } from '../lib/i18n'

type Copy = {id: string;jobId: number;office: string;date: string}
export function RecuperacaoLocal({ orgId }: {orgId: number}) {
  const { t } = useIdioma()
  const bridge = window.offizMotor
  const [copies, setCopies] = useState<Copy[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  if (!bridge?.recuperacoes || !bridge.abrirRecuperacao) return null
  async function list() {
    setBusy(true); setError('')
    try { const rows = await bridge!.recuperacoes!(orgId); if (alive.current) setCopies(rows) }
    catch { if (alive.current) setError(t('Não consegui consultar as cópias. Entre na sua conta e tente novamente.', 'Could not check backups. Sign in and try again.')) }
    finally { if (alive.current) setBusy(false) }
  }
  async function open(id: string) {
    try { await bridge!.abrirRecuperacao!(orgId, id) }
    catch { if (alive.current) setError(t('Não consegui abrir esta cópia.', 'Could not open this backup.')) }
  }
  return <div className="motor-emb-passo">
    <button type="button" className="botao-texto" disabled={busy} onClick={() => void list()}>{t('Recuperar arquivos de um trabalho interrompido', 'Recover files from an interrupted job')}</button>
    {error && <p role="alert">{error}</p>}
    {copies && <>
      <p className="texto-suave">{copies.length ? t('Abra a cópia e confira os arquivos já criados. Você pode anexá-los à conversa para continuar.', 'Open a copy and check the files already created. Attach them to the conversation to continue.') : t('Não há cópias pendentes desta empresa para sua conta neste computador.', 'There are no pending copies for your account and company on this computer.')}</p>
      <ul>{copies.map(copy => <li key={copy.id}><button type="button" className="botao-texto" onClick={() => void open(copy.id)}>{t('Abrir arquivos do trabalho', 'Open files for job')} #{copy.jobId}</button></li>)}</ul>
    </>}
  </div>
}
