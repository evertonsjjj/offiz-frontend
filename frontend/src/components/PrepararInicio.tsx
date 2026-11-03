import { useState } from 'react'
import { useIdioma } from '../lib/i18n'
import { temMotorBridge } from '../lib/motor-bridge'
import { PainelMotorEmbutido, SecaoAppDesktop, SecaoMotorIA } from '../pages/ConfigOrg'
import { MeuContrato } from './ContratosIA'

/** Only connection setup. Media is requested when a task actually needs it. */
export function PrepararInicio({ orgId, aoAtualizar, podeConfigurarEmpresa = true, gerenciado = false, perfilPreparado = false }: { orgId: number; aoAtualizar: () => void; podeConfigurarEmpresa?: boolean; gerenciado?: boolean; perfilPreparado?: boolean }) {
  const { t } = useIdioma()
  const [apiAberta, setApiAberta] = useState(false)
  const desktop = temMotorBridge()
  if (gerenciado) return <><MeuContrato orgId={orgId} />{desktop ? <PainelMotorEmbutido gerenciado orgId={orgId} aoMudarPareamento={aoAtualizar} podeConfigurarEmpresa={podeConfigurarEmpresa} /> : <SecaoAppDesktop gerenciado />}<button type="button" className="botao-texto" onClick={aoAtualizar}>Verificar conexão novamente</button></>
  return <section className="inicio-preparar" aria-label={t('Conectar a IA', 'Connect AI')}>
    <span className="inicio-etapa">{perfilPreparado ? t('Perfil preparado', 'Profile prepared') : t('Primeiro, conecte sua IA', 'First, connect your AI')}</span>
    <h1>{perfilPreparado ? t('Conecte a IA para continuar', 'Connect AI to continue') : desktop ? t('Ligue a IA para começar', 'Turn on AI to get started') : t('Como você quer usar o Offiz?', 'How would you like to use Offiz?')}</h1>
    <p>{perfilPreparado ? t('Seu perfil confirmado orientará o pedido. Depois de conectar, converse ou peça o próximo trabalho.', 'Your confirmed profile will guide your request. Once connected, chat or ask for your next task.') : t('Depois, uma conversa curta para entender sua empresa e preparar o primeiro pedido.', 'Then, a short conversation to understand your business and prepare your first request.')}</p>
    {desktop ? <PainelMotorEmbutido orgId={orgId} aoMudarPareamento={aoAtualizar} podeConfigurarEmpresa={podeConfigurarEmpresa} /> : <SecaoAppDesktop />}
    {podeConfigurarEmpresa && <button type="button" className="botao botao-fantasma" aria-expanded={apiAberta} onClick={() => setApiAberta(!apiAberta)}>{desktop ? t('Usar uma chave de API', 'Use an API key') : t('Continuar no navegador com uma chave de API', 'Continue in the browser with an API key')}</button>}
    {podeConfigurarEmpresa && apiAberta && <SecaoMotorIA orgId={orgId} prepararApi />}
    <p className="texto-suave">{t('Para produzir imagens, vídeos ou narração, conecte os serviços quando precisar. Ditar mensagens já vem incluído no aplicativo.', 'Connect services when you need to produce images, video or narration. Message dictation is included in the app.')}</p>
    <button type="button" className="botao-texto" onClick={aoAtualizar}>{t('Já conectei · verificar novamente', 'Already connected · check again')}</button>
  </section>
}
