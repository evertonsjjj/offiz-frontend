import { useEffect, useRef, useState } from 'react'
import { api, API_V1, ApiError, getSessionIdentity } from '../../lib/api'
import { useIdioma } from '../../lib/i18n'

type Estado = 'identificando' | 'identificacao_falhou' | 'escolher' | 'pronto' | 'enviando' | 'incerto' | 'consultando' | 'repetir' | 'removido' | 'confirmado'
interface Envio { contexto: string; chave: string | null; requestId: string | null; estado: Estado; erro: string }
interface Recibo { chave: string; requestId: string; criadoEm?: string; corpoSha256?: string }
interface Resultado { id: number; office_slug: string; request_id: string; replayed: boolean }
interface Opcoes { rota?: string; rotaConsulta?: string; vincularCorpo?: boolean; extrairId?: (resultado: unknown) => unknown; alvoAnteriorCompativel?: (alvo: string) => boolean }
export interface ConfirmacaoProducao { corpoSha256: string | null }
interface Descoberta { prefixo: string; sufixo: string; aceitarAlvo: (alvo: string) => boolean }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/

function copiarCorpo(body: object): object {
  // A UUID efetiva é escrita pelo hook; a cópia é o JSON realmente enviado,
  // sem referências mutáveis do formulário ou propriedades undefined.
  const wire = { ...body } as Record<string, unknown>
  delete wire.request_id
  return JSON.parse(JSON.stringify(wire)) as object
}
function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico)
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonico(v)]))
  return valor
}
async function hashSnapshot(corpo: object): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 indisponível')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonico(corpo))))
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
}
/** Só fingerprint; o texto nunca entra no recibo nem na chave local. */
export function hashCorpoProducao(body: object): Promise<string> {
  return hashSnapshot(copiarCorpo(body))
}

let autorConfirmado: { sessao: string; id: number } | null = null
let consultaAutor: { sessao: string; promessa: Promise<number> } | null = null

/** O cache otimista da interface não identifica o dono de uma intenção.
 * Cada login confirma /auth/me; telas simultâneas compartilham essa consulta. */
function identificarAutor(sessao: string | null): Promise<number> {
  if (!sessao) return Promise.reject(new Error('Sem sessão confirmada'))
  if (autorConfirmado?.sessao === sessao) return Promise.resolve(autorConfirmado.id)
  if (consultaAutor?.sessao === sessao) return consultaAutor.promessa
  const promessa = (async () => {
    const r = await api.get<{ id?: unknown }>('/auth/me')
    if (getSessionIdentity() !== sessao || !r || typeof r.id !== 'number' || !Number.isSafeInteger(r.id) || r.id <= 0) throw new Error('Autor não confirmado')
    autorConfirmado = { sessao, id: r.id }
    return r.id
  })()
  const consulta = { sessao, promessa }
  consultaAutor = consulta
  const limpar = () => { if (consultaAutor === consulta) consultaAutor = null }
  void promessa.then(limpar, limpar)
  return promessa
}

function novoId() {
  // getRandomValues também funciona nas instalações HTTP locais.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function lerRecibo(chave: string): Recibo | null {
  try {
    const salvo: unknown = JSON.parse(localStorage.getItem(chave) || 'null')
    if (salvo && typeof salvo === 'object' && 'versao' in salvo && salvo.versao === 1 && 'request_id' in salvo && typeof salvo.request_id === 'string' && UUID.test(salvo.request_id)) {
      const criadoEm = 'criado_em' in salvo && typeof salvo.criado_em === 'string' && Number.isFinite(Date.parse(salvo.criado_em)) ? salvo.criado_em : undefined
      const corpoSha256 = 'corpo_sha256' in salvo && typeof salvo.corpo_sha256 === 'string' && SHA256.test(salvo.corpo_sha256) ? salvo.corpo_sha256 : undefined
      return { chave, requestId: salvo.request_id, criadoEm, corpoSha256 }
    }
  } catch { /* Sem armazenamento verificável, o POST será impedido. */ }
  return null
}
const lerId = (chave: string) => lerRecibo(chave)?.requestId ?? null

function listarRecibos(chave: string, descoberta?: Descoberta): Recibo[] {
  try {
    const raizes = new Set([chave])
    const armazenadas = Object.keys(localStorage)
    if (descoberta) for (const armazenada of armazenadas) {
      if (!armazenada.startsWith(descoberta.prefixo)) continue
      const intencao = armazenada.lastIndexOf(':intencao:')
      const raiz = intencao >= 0 && UUID.test(armazenada.slice(intencao + ':intencao:'.length)) ? armazenada.slice(0, intencao) : armazenada
      if (!raiz.endsWith(descoberta.sufixo)) continue
      const alvoSalvo = raiz.slice(descoberta.prefixo.length, -descoberta.sufixo.length)
      if (descoberta.aceitarAlvo(alvoSalvo)) raizes.add(raiz)
    }
    const chaves = [...raizes].flatMap(raiz => {
      const prefixo = `${raiz}:intencao:`
      return [raiz, ...armazenadas.filter(k => k.startsWith(prefixo) && UUID.test(k.slice(prefixo.length)))]
    })
    return chaves.map(lerRecibo).filter((r): r is Recibo => !!r).sort((a, b) => (a.criadoEm ?? '').localeCompare(b.criadoEm ?? '') || a.chave.localeCompare(b.chave))
  } catch { return [] }
}

function inicial(contexto: string, chave: string | null = null, recibos = chave ? listarRecibos(chave) : []): Envio {
  const unico = recibos.length === 1 ? recibos[0] : null
  return { contexto, chave: unico?.chave ?? chave, requestId: unico?.requestId ?? null, estado: !chave ? 'identificando' : recibos.length > 1 ? 'escolher' : unico ? 'incerto' : 'pronto', erro: '' }
}

/** Guarda UUID e horário de criação, separados por API, autor confirmado e alvo.
 * Um envio incerto não ganha outro UUID por retry, reload ou novo login. */
export function useProducaoSegura(base: string, alvo: string, officeSlug: string | undefined, salvar: (id: number, confirmacao?: ConfirmacaoProducao) => void, opcoes?: Opcoes) {
  const { t } = useIdioma()
  const sessao = getSessionIdentity()
  const rota = opcoes?.rota || `${base}/producao`
  const rotaConsulta = opcoes?.rotaConsulta || rota
  const vincularCorpo = !!opcoes?.vincularCorpo
  const alvoContexto = JSON.stringify([sessao, base, alvo, officeSlug, rota, rotaConsulta, vincularCorpo])
  const contextoRef = useRef({ alvo: alvoContexto, geracao: 0 })
  if (contextoRef.current.alvo !== alvoContexto) contextoRef.current = { alvo: alvoContexto, geracao: contextoRef.current.geracao + 1 }
  const geracao = contextoRef.current.geracao
  const contexto = `${alvoContexto}:${geracao}`
  const [registro, setRegistro] = useState<Envio>(() => inicial(contexto))
  const envio = registro.contexto === contexto ? registro : inicial(contexto)
  const registroRef = useRef(registro)
  if (registroRef.current.contexto !== contexto) registroRef.current = inicial(contexto)
  const vivo = useRef(true)
  const trava = useRef<{ contexto: string; operacao: symbol } | null>(null)
  const raiz = useRef<{ contexto: string; chave: string; descoberta?: Descoberta } | null>(null)
  const snapshot = useRef<{ contexto: string; requestId: string; corpo: object; sha256: string } | null>(null)
  if (snapshot.current?.contexto !== contexto) snapshot.current = null
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  useEffect(() => { void verificarConta() }, [contexto]) // eslint-disable-line react-hooks/exhaustive-deps

  function atualizar(v: Envio) { registroRef.current = v; setRegistro(v) }
  function atual() { return vivo.current && contextoRef.current.alvo === alvoContexto && contextoRef.current.geracao === geracao && getSessionIdentity() === sessao }

  async function verificarConta() {
    if (!atual() || trava.current?.contexto === contexto || registroRef.current.chave) return
    const operacao = Symbol('autor')
    trava.current = { contexto, operacao }
    atualizar(inicial(contexto))
    try {
      const autorId = await identificarAutor(sessao)
      if (!atual()) return
      const prefixo = `offiz:producao:${API_V1}:${autorId}:${base}:`
      const sufixo = opcoes?.rota ? `:operacao:${rota}` : ''
      const chave = `${prefixo}${alvo}${sufixo}`
      // Compatibilidade só dentro da mesma API, autor confirmado, empresa e
      // operação. O recibo original fica guardado até o servidor confirmá-lo.
      const descoberta = opcoes?.rota && opcoes.alvoAnteriorCompativel ? { prefixo, sufixo, aceitarAlvo: opcoes.alvoAnteriorCompativel } : undefined
      raiz.current = { contexto, chave, descoberta }
      atualizar(inicial(contexto, chave, listarRecibos(chave, descoberta)))
    } catch {
      if (atual()) atualizar({ ...inicial(contexto), estado: 'identificacao_falhou', erro: t('Não foi possível verificar a conta para recuperar seus pedidos. Tente verificar a conta novamente.', 'Your account could not be verified to recover your requests. Try verifying your account again.') })
    } finally { if (trava.current?.operacao === operacao) trava.current = null }
  }

  function idConfirmado(r: unknown, requestId: string): number | null {
    if (!r || typeof r !== 'object') return null
    const v = r as Partial<Resultado>
    const id = opcoes?.extrairId ? opcoes.extrairId(r) : v.id
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && v.request_id === requestId && v.office_slug === officeSlug && typeof v.replayed === 'boolean' ? id : null
  }
  function confirmar(r: unknown, requestId: string, chave: string) {
    const id = idConfirmado(r, requestId)
    if (id === null) throw new Error(t('O servidor não confirmou este pedido. Confira o envio antes de tentar novamente.', 'The server did not confirm this request. Check the submission before trying again.'))
    if (!atual()) return
    atualizar({ contexto, chave, requestId, estado: 'confirmado', erro: '' })
    if (vincularCorpo) salvar(id, { corpoSha256: lerRecibo(chave)?.corpoSha256 ?? null })
    else salvar(id)
    // Ao fechar a tela ou trocar de conta, o UUID continua recuperável.
    if (atual() && lerId(chave) === requestId) localStorage.removeItem(chave)
  }
  function falha(e: unknown, requestId: string, chave: string, consulta = false) {
    if (!atual()) return
    const status = e instanceof ApiError ? e.status : null
    const removido = status === 410
    const naoLocalizado = consulta && status === 404
    const rejeitado = !consulta && status !== null && [400, 402, 422].includes(status)
    const erro = removido
      ? t('Este pedido foi removido. Ele não será recriado ao tentar novamente.', 'This request was removed. Retrying will not recreate it.')
      : naoLocalizado
        ? t('O envio ainda não foi localizado. Você pode reenviar este pedido; a proteção contra duplicação continua ativa.', 'The submission has not been found yet. You can resend this request; duplicate protection remains active.')
        : rejeitado
          ? (e instanceof Error ? e.message : String(e))
          : t('Não foi possível confirmar o envio. Confira sua situação antes de iniciar outro pedido.', 'The submission could not be confirmed. Check its status before starting another request.')
    atualizar({ contexto, chave, requestId, estado: removido ? 'removido' : naoLocalizado ? 'repetir' : rejeitado ? 'pronto' : 'incerto', erro })
  }
  async function executar(consulta: boolean, body?: object) {
    const estadoAtual = registroRef.current
    let chave = estadoAtual.chave
    if (!atual() || !chave || trava.current?.contexto === contexto || ['confirmado', 'removido', 'escolher'].includes(estadoAtual.estado)) return
    if (consulta && !estadoAtual.requestId) return
    // A consulta não precisa de WebCrypto. Um novo POST vinculado precisa,
    // inclusive antes de tentar alocar a primeira UUID do navegador.
    if (!consulta && estadoAtual.estado !== 'incerto' && vincularCorpo && !globalThis.crypto?.subtle) {
      atualizar({ ...estadoAtual, erro: t('Não foi possível proteger este envio no navegador. Abra o Offiz por HTTPS e tente novamente. Seus pedidos anteriores continuam guardados.', 'This browser could not protect the submission. Open Offiz over HTTPS and try again. Previous submissions remain saved.') })
      return
    }
    // O alvo é o projeto, não a intenção. Outra tela pronta pode ter um brief
    // diferente; guarda seu UUID sem substituir nem confirmar aquele envio.
    const requestId = estadoAtual.requestId || novoId()
    if (!consulta && !estadoAtual.requestId) {
      if (raiz.current?.contexto !== contexto) return
      chave = `${raiz.current.chave}:intencao:${requestId}`
    }
    const operacao = Symbol('envio')
    trava.current = { contexto, operacao }
    const precisaConsultar = consulta || estadoAtual.estado === 'incerto'
    atualizar({ contexto, chave, requestId, estado: precisaConsultar ? 'consultando' : 'enviando', erro: '' })
    let corpo = body
    let corpoSha256: string | undefined
    if (!precisaConsultar && vincularCorpo) {
      try {
        // Clonar antes do primeiro await: digerir/enviar o mesmo JSON, mesmo
        // quando o chamador altera o formulário enquanto a promessa aguarda.
        const copia = copiarCorpo(body ?? {})
        corpoSha256 = await hashSnapshot(copia)
        if (!atual()) return
        const recibo = lerRecibo(chave)
        if (estadoAtual.requestId && (!recibo || recibo.requestId !== requestId || !recibo.corpoSha256)) {
          atualizar({ ...estadoAtual, erro: t('Não foi possível conferir o conteúdo deste envio anterior. Confira o envio ou prepare outro pedido separado.', 'The contents of this previous submission could not be verified. Check it or prepare a separate request.') })
          return
        }
        if (recibo?.corpoSha256 && recibo.corpoSha256 !== corpoSha256) {
          atualizar({ ...estadoAtual, erro: t('Este texto é outro pedido. Prepare outro pedido para enviá-lo; o envio anterior continua guardado.', 'This text is a different request. Prepare another request to send it; the previous submission remains saved.') })
          return
        }
        const anterior = snapshot.current
        corpo = anterior?.contexto === contexto && anterior.requestId === requestId && anterior.sha256 === corpoSha256 ? anterior.corpo : copia
        snapshot.current = { contexto, requestId, corpo, sha256: corpoSha256 }
      } catch {
        if (atual()) atualizar({ ...estadoAtual, erro: t('Não foi possível proteger este envio no navegador. Abra o Offiz por HTTPS e tente novamente. Seus pedidos anteriores continuam guardados.', 'This browser could not protect the submission. Open Offiz over HTTPS and try again. Previous submissions remain saved.') })
        return
      } finally {
        if ((!atual() || registroRef.current.estado !== 'enviando') && trava.current?.operacao === operacao) trava.current = null
      }
    }
    if (!consulta && (!vincularCorpo || !precisaConsultar)) {
      try {
        const criadoEm = lerRecibo(chave)?.criadoEm ?? new Date().toISOString()
        localStorage.setItem(chave, JSON.stringify({ versao: 1, request_id: requestId, criado_em: criadoEm,
          ...(corpoSha256 ? { corpo_sha256: corpoSha256 } : {}) }))
        const persistido = lerRecibo(chave)
        if (persistido?.requestId !== requestId || corpoSha256 && persistido.corpoSha256 !== corpoSha256) throw new Error('Armazenamento indisponível')
      } catch {
        // Falhar ao regravar não desfaz uma intenção que já pode estar no
        // servidor. Só um envio ainda sem POST pode voltar sem UUID.
        if (atual()) atualizar(estadoAtual.requestId
          ? { ...estadoAtual, estado: 'incerto', erro: t('Não foi possível guardar a confirmação neste navegador. Confira o envio anterior antes de tentar novamente.', 'This browser could not save the confirmation. Check the previous submission before trying again.') }
          : { contexto, chave, requestId: null, estado: 'pronto', erro: t('Não foi possível preparar o envio neste navegador. Mantenha esta janela aberta e tente novamente.', 'This browser could not prepare the submission. Keep this window open and try again.') })
        if (trava.current?.operacao === operacao) trava.current = null
        return
      }
    }
    try {
      if (!atual()) return
      const r = precisaConsultar
        ? await api.get<Resultado>(`${rotaConsulta}/${requestId}`)
        : await api.post<Resultado>(rota, { ...corpo, request_id: requestId })
      confirmar(r, requestId, chave)
    } catch (e) { falha(e, requestId, chave, precisaConsultar) }
    finally { if (trava.current?.operacao === operacao) trava.current = null }
  }
  function prepararNovo() {
    const estadoAtual = registroRef.current
    const chave = estadoAtual.chave
    if (!atual() || !chave || estadoAtual.estado !== 'removido' || trava.current?.contexto === contexto) return
    try {
      if (lerId(chave) === estadoAtual.requestId) localStorage.removeItem(chave)
      snapshot.current = null
      atualizar({ contexto, chave, requestId: null, estado: 'pronto', erro: '' })
    } catch {
      atualizar({ ...estadoAtual, erro: t('Não foi possível preparar um novo pedido neste navegador. Tente novamente.', 'This browser could not prepare a new request. Try again.') })
    }
  }
  function selecionarEnvio(requestId: string) {
    if (!atual() || raiz.current?.contexto !== contexto || trava.current?.contexto === contexto || registroRef.current.estado !== 'escolher') return
    const recibos = listarRecibos(raiz.current.chave, raiz.current.descoberta)
    const recibo = recibos.find(r => r.requestId === requestId)
    if (recibo) atualizar({ contexto, chave: recibo.chave, requestId, estado: 'incerto', erro: '' })
    else atualizar({ contexto, chave: raiz.current.chave, requestId: null, estado: recibos.length ? 'escolher' : 'pronto', erro: t('A lista de envios mudou em outra janela. Confira os envios disponíveis antes de continuar.', 'The submission list changed in another window. Check the available submissions before continuing.') })
  }
  function prepararOutro() {
    if (!atual() || raiz.current?.contexto !== contexto || trava.current?.contexto === contexto || !(['escolher', 'incerto', 'repetir'].includes(registroRef.current.estado) || vincularCorpo && (registroRef.current.estado === 'confirmado' || registroRef.current.estado === 'pronto' && registroRef.current.requestId))) return
    snapshot.current = null
    atualizar({ contexto, chave: raiz.current.chave, requestId: null, estado: 'pronto', erro: '' })
  }
  const enviosPendentes = raiz.current?.contexto === contexto ? listarRecibos(raiz.current.chave, raiz.current.descoberta).map(({ requestId, criadoEm }) => ({ requestId, criadoEm })) : []
  return {
    estado: envio.estado, erro: envio.erro,
    identificando: envio.estado === 'identificando',
    precisaVerificarConta: envio.estado === 'identificacao_falhou',
    precisaEscolherEnvio: envio.estado === 'escolher', enviosPendentes, selecionarEnvio, prepararOutro,
    ocupado: ['identificando', 'enviando', 'consultando', 'confirmado'].includes(envio.estado),
    podeEditar: ['pronto', 'repetir'].includes(envio.estado),
    temEnvioPendente: envio.estado === 'incerto',
    enviar: (body: object) => executar(false, body),
    conferir: () => executar(true), verificarConta, prepararNovo,
    sair: () => { vivo.current = false },
  }
}
