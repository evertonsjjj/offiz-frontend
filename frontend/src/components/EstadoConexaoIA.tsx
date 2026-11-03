import type { ConexaoIA, EstadoIA } from '../lib/conexao-ia'
import { useIdioma } from '../lib/i18n'

export function EstadoConexaoIA({ conexao, configurar }: { conexao: ConexaoIA; configurar?: () => void }) {
  const { t } = useIdioma()
  const origem = conexao.origem === 'local' ? t('Motor local', 'Local engine') : conexao.origem === 'contrato' ? t('Contrato Offiz', 'Offiz plan') : t('API própria', 'Your API')
  const estado: Record<EstadoIA, string> = {
    verificando: t('Verificando…', 'Checking…'), conectado: t('Conectado', 'Connected'),
    configurada: t('Configurada', 'Configured'), 'sem-configuracao': t('Não configurada', 'Not configured'),
    'sem-saldo': t('Sem saldo', 'Out of credit'), parear: t('Conectar empresa', 'Pair company'),
    desligado: t('Desligado', 'Off'), instalar: t('Instalar IA', 'Install AI'),
    autenticar: t('Conectar conta', 'Connect account'), suspensa: t('Suspensa', 'Suspended'),
    erro: t('Falha ao verificar', 'Could not check'),
  }
  const conteudo = <><strong>{origem}{conexao.motor ? ` · ${conexao.motor === 'codex' ? 'Codex' : 'Claude'}` : ''}</strong><span>{estado[conexao.estado]}</span></>
  const className = `inicio-conexao-status${conexao.pronto ? ' pronta' : ' pendente'}`
  const titulo = conexao.origem === 'local'
    ? t('Conversas pela conta conectada neste computador. Imagens e áudio podem consumir saldo de API separadamente.', 'Conversations use the account connected on this computer. Images and audio may use API credit separately.')
    : t('Origem da IA desta conversa. Configurada indica conexão cadastrada; não é um teste de resposta do provedor.', 'AI source for this conversation. Configured means a connection is saved; it is not a provider response test.')
  return configurar ? <button type="button" className={className} onClick={configurar} title={titulo} aria-label={`${origem}: ${estado[conexao.estado]}`}>{conteudo}</button>
    : <span className={className} title={titulo} role="status">{conteudo}</span>
}
