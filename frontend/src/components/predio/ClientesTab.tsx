import { useIdioma } from '../../lib/i18n'
import { useTextoEscritorio } from '../../lib/i18nEscritorios'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, asList, baixarArquivo, ApiError, getSessionIdentity } from '../../lib/api'
import { useToasts } from '../Toasts'
import { useConfirmacao } from '../useConfirmacao'
import { Icone, iconeDoArquivo } from '../Icone'
import { STATUS_ENTREGA_LABEL, formatBytes, formatDataHora, tempoRelativo } from '../../lib/format'
import type { Entrega, OfficeInfo } from '../../lib/types'

/* ------------------------------------------------------------------ */
/* Tipos (contrato com o backend: models/cliente.py)                   */
/* ------------------------------------------------------------------ */

type Granularidade = 'mensal' | 'anual'
type StatusCliente = 'ativo' | 'standby'
type Notificacao = 'nenhuma' | 'semanal' | 'mensal'
type PerfilInvestidor = '' | 'conservador' | 'moderado' | 'arrojado' | 'agressivo'

function useTelaCliente() {
  const contaRef = useRef(getSessionIdentity())
  const montadoRef = useRef(true)
  const leituraRef = useRef<AbortController | null>(null)
  const telaAtual = useCallback(() => montadoRef.current && getSessionIdentity() === contaRef.current, [])
  useEffect(() => { montadoRef.current = true; return () => { montadoRef.current = false; leituraRef.current?.abort() } }, [])
  return { telaAtual, leituraRef, conta: contaRef.current }
}

interface ClienteResumo {
  id: number
  nome: string
  email: string | null
  celular: string | null
  tipo: string | null
  /** Site/domínio — o ALVO da varredura pública e do teste autorizado. */
  site: string | null
  /** O termo assinado existe (fora daqui). Destrava as camadas 2 e 3. */
  consentimento_pentest: boolean
  perfil_investidor: string | null
  granularidade: Granularidade
  status: StatusCliente
  notificacao: Notificacao
  /** Agenda de envio das dicas: semanal → 0=segunda…6=domingo; mensal → 1..28;
   *  null = sem dia fixo (vale o espaçamento por intervalo do backend). */
  envio_dia: number | null
  /** Horário do envio, "HH:MM" 24h (default 09:00). */
  envio_hora: string
  /** Liga/desliga o envio por e-mail ao cliente APÓS a aprovação da entrega. */
  envio_email: boolean
  total_periodos: number
  criado_em: string | null
}

interface ClienteArquivo {
  id: number
  nome: string
  nome_original: string | null
  tamanho_bytes: number
  criado_em: string | null
}

interface ClientePeriodo {
  id: number
  ano: number
  mes: number | null
  rotulo: string
  total_arquivos: number
  arquivos: ClienteArquivo[]
}

interface Cliente extends ClienteResumo {
  observacoes: string | null
  periodos: ClientePeriodo[]
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const GRANULARIDADE_LABEL: Record<Granularidade, string> = {
  mensal: 'Mês/Ano',
  anual: 'Anual',
}

const NOTIF_LABEL: Record<Notificacao, string> = {
  nenhuma: 'Sem notificação',
  semanal: 'Notificação semanal',
  mensal: 'Notificação mensal',
}

const PERFIL_LABEL: Record<string, string> = {
  conservador: 'Conservador',
  moderado: 'Moderado',
  arrojado: 'Arrojado',
  agressivo: 'Agressivo',
}

/** Sugestões do campo livre "tipo de cliente" (datalist — aceita qualquer texto). */
const TIPOS_SUGERIDOS = ['Autônomo', 'CLT', 'Empresário', 'Servidor público', 'Aposentado', 'PJ', 'Casal', 'Família']

/** Dias da semana na MESMA escala do backend (envio_dia semanal: 0=segunda…6=domingo). */
const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']
const DIAS_SEMANA_CURTO = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']

/** Resumo da agenda de dicas no cartão — ex.: "dicas: semanal · seg 09:00 · e-mail ligado". */
type Texto = ReturnType<typeof useTextoEscritorio>
function resumoPerfilNotificacoes(c: ClienteResumo, tx: Texto): string {
  if (c.notificacao === 'nenhuma') return tx('Sem notificação de dicas')
  const freq = tx(c.notificacao === 'semanal' ? 'Semanal' : 'Mensal')
  const dia = c.envio_dia == null ? tx('sem dia fixo')
    : c.notificacao === 'semanal' ? tx(DIAS_SEMANA_CURTO[c.envio_dia] ?? String(c.envio_dia))
    : tx('dia {0}', c.envio_dia)
  return tx('{0} · {1} · e-mail {2}', freq, dia + ' ' + (c.envio_hora || '09:00'), tx(c.envio_email ? 'ligado' : 'desligado'))
}
function resumoEnvio(c: ClienteResumo, tx: Texto): string {
  return tx('dicas: {0}', resumoPerfilNotificacoes(c, tx))
}
function resumoPeriodosArquivos(c: Cliente, tx: Texto): string {
  const periodos = c.periodos.length
  const arquivos = c.periodos.reduce((soma, p) => soma + (p.total_arquivos ?? p.arquivos.length), 0)
  return tx(periodos === 1 ? '1 período' : '{0} períodos', periodos) + ' · ' + tx(arquivos === 1 ? '1 arquivo' : '{0} arquivos', arquivos)
}

/** Perfil de investidor é conceito do FINANCEIRO. A carteira virou tela de
 *  todo escritório com `usa_clientes` (03/08/2026) — e perguntar "conservador
 *  ou arrojado?" ao cadastrar uma padaria numa banca de LGPD não é só ruído:
 *  faz o usuário duvidar de que a tela é dele. O dado continua existindo no
 *  banco e nas fichas antigas; só não se pede fora de casa. */
function ehFinanceiro(slug: string) {
  return slug === 'financeiro'
}

/** Este andar organiza o material do cliente POR PERÍODO (mês/ano)?
 *
 *  É o que separa o financeiro e os assistentes — onde "fechar o mês" é o
 *  trabalho — de um escritório de conformidade, onde o cliente manda o
 *  contrato assinado e o formulário preenchido UMA vez, sem competência de
 *  período nenhuma. Perguntar "Mês/Ano ou Anual?" e "notificação de dicas?"
 *  ao cadastrar uma padaria numa banca de LGPD é ruído que faz o usuário
 *  duvidar de que a tela é dele. Sinal: `upload_mensal` do manifesto. */
function trabalhaPorPeriodo(office?: OfficeInfo | null) {
  return !!office?.upload_mensal
}

function CamposFicha({
  slug, tipo, setTipo, site, setSite, consentimento, setConsentimento, perfil, setPerfil, tiposSugeridos,
}: {
  slug: string
  tipo: string
  setTipo: (v: string) => void
  site: string
  setSite: (v: string) => void
  consentimento: boolean
  setConsentimento: (v: boolean) => void
  perfil: PerfilInvestidor
  setPerfil: (v: PerfilInvestidor) => void
  /** Sugestões do datalist: as fixas + os tipos já usados na carteira. */
  tiposSugeridos?: string[]
}) {
  const tx = useTextoEscritorio()
  return (
    <div className="linha-campos">
      <label className="campo">
        <span>{tx("Tipo de cliente")}</span>
        <input
          type="text"
          list="tipos-cliente"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          placeholder={
            ehFinanceiro(slug) ? tx("Autônomo, CLT, Empresário…") : tx("Clínica, Escola, Varejo…")
          }
          maxLength={50}
        />
        <datalist id="tipos-cliente">
          {(tiposSugeridos ?? TIPOS_SUGERIDOS).map((t) => <option key={t} value={t} />)}
        </datalist>
      </label>
      {!ehFinanceiro(slug) && (
        <label className="campo">
          <span>{tx("Site do cliente")}</span>
          <input
            type="text"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="padaria.com.br"
            maxLength={255}
          />
          <small className="texto-suave"> {tx("É o alvo da varredura e do teste autorizado — sem ele não há o que analisar.")} </small>
        </label>
      )}
      {!ehFinanceiro(slug) && (
        <label className="check-inline" style={{ alignSelf: 'flex-end' }}>
          <input
            type="checkbox"
            checked={consentimento}
            onChange={(e) => setConsentimento(e.target.checked)}
          />
          <span> {tx("Tem termo de autorização assinado")} <br />
            <small className="texto-suave"> {tx("Marque só depois de ter o documento em mãos — ele mesmo sobe em Documentos do cliente. Sem isto, só a Camada 1 (site público) roda.")} </small>
          </span>
        </label>
      )}
      {ehFinanceiro(slug) && (
        <label className="campo">
          <span>{tx("Perfil de investidor")}</span>
          <select value={perfil} onChange={(e) => setPerfil(e.target.value as PerfilInvestidor)}>
            <option value="">{tx("Não definido")}</option>
            <option value="conservador">{tx("Conservador")}</option>
            <option value="moderado">{tx("Moderado")}</option>
            <option value="arrojado">{tx("Arrojado")}</option>
            <option value="agressivo">{tx("Agressivo")}</option>
          </select>
        </label>
      )}
    </div>
  )
}

/** Opções do select de DIA de envio conforme a frequência:
 *  semanal → seg..dom (valores 0..6); mensal → 1..28 (evita meses curtos). */
function OpcoesDiaEnvio({ notificacao }: { notificacao: Notificacao }) {
  const tx = useTextoEscritorio()
  if (notificacao === 'semanal') {
    return (
      <>
        {DIAS_SEMANA.map((d, i) => (
          <option key={i} value={i}>{tx(d)}</option>
        ))}
      </>
    )
  }
  return (
    <>
      {Array.from({ length: 28 }, (_, i) => (
        <option key={i + 1} value={i + 1}>{tx("Dia")} {i + 1}</option>
      ))}
    </>
  )
}

/** Input de horário que só grava no blur — o PUT por tecla digitada
 *  bombardearia o backend enquanto a pessoa ainda monta o horário. */
function HoraEnvio({ valor, aoSalvar, disabled }: { valor: string; aoSalvar: (v: string) => void; disabled?: boolean }) {
  const tx = useTextoEscritorio()
  const [hora, setHora] = useState(valor)
  useEffect(() => setHora(valor), [valor])
  return (
    <input
      type="time"
      disabled={disabled}
      value={hora}
      onChange={(e) => setHora(e.target.value)}
      onBlur={() => {
        if (hora && hora !== valor) aoSalvar(hora)
        // Campo limpo (ou hora igual): ressincroniza com o valor salvo — sem
        // isto o input ficaria vazio indefinidamente (a prop não muda e o
        // useEffect [valor] não dispara de novo).
        else setHora(valor)
      }}
      aria-label={tx("Horário do envio das dicas")}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Formulário de novo cliente                                          */
/* ------------------------------------------------------------------ */

function NovoCliente({
  orgId,
  slug,
  office,
  tiposSugeridos,
  aoCancelar,
  aoCriar,
}: {
  orgId: number
  slug: string
  office?: OfficeInfo | null
  tiposSugeridos: string[]
  aoCancelar: () => void
  aoCriar: (cliente: Cliente) => void
}) {
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [celular, setCelular] = useState('')
  const [tipo, setTipo] = useState('')
  const [site, setSite] = useState('')
  const [consentimento, setConsentimento] = useState(false)
  const [perfil, setPerfil] = useState<PerfilInvestidor>('')
  const [granularidade, setGranularidade] = useState<Granularidade>('mensal')
  const [notificacao, setNotificacao] = useState<Notificacao>('nenhuma')
  // Agenda de envio ('' = sem dia fixo). Trocar a frequência zera o dia:
  // o mesmo número significa outra coisa em cada escala (0..6 vs 1..28).
  const [envioDia, setEnvioDia] = useState('')
  const [envioHora, setEnvioHora] = useState('09:00')
  // Default LIGADO (decisão de produto): o e-mail só sai depois da aprovação
  // humana da entrega — o padrão é "aprovei = o cliente recebe".
  const [envioEmail, setEnvioEmail] = useState(true)
  const [observacoes, setObservacoes] = useState('')
  const [salvando, setSalvando] = useState(false)
  const salvandoRef = useRef(false)
  const { telaAtual } = useTelaCliente()

  async function salvar() {
    if (!telaAtual() || salvandoRef.current) return
    const n = nome.trim()
    if (!n) {
      falha(tx("Informe o nome do cliente antes de salvar."))
      return
    }
    salvandoRef.current = true
    setSalvando(true)
    try {
      const cliente = await api.post<Cliente>(`/predios/${orgId}/${slug}/clientes`, {
        nome: n,
        email: email.trim() || undefined,
        celular: celular.trim() || undefined,
        tipo: tipo.trim() || undefined,
        site: site.trim() || undefined,
        consentimento_pentest: consentimento,
        perfil_investidor: perfil || undefined,
        granularidade,
        notificacao,
        // Agenda só existe com frequência ligada (o backend rejeita dia sem freq).
        envio_dia: notificacao !== 'nenhuma' && envioDia !== '' ? Number(envioDia) : undefined,
        envio_hora: notificacao !== 'nenhuma' ? envioHora || '09:00' : undefined,
        envio_email: notificacao !== 'nenhuma' ? envioEmail : undefined,
        observacoes: observacoes.trim() || undefined,
      })
      if (!telaAtual()) return
      sucesso(tx("Cliente “{0}” cadastrado.", n))
      // As abas da shell ficam MONTADAS lado a lado: sem este aviso, o seletor
      // "Conversar sobre o cliente…" só enxergaria o cliente novo depois de
      // recarregar a página — a pessoa cadastra e o campo continua vazio.
      window.dispatchEvent(new Event('offiz:clientes-mudou'))
      aoCriar(cliente)
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : tx("Não foi possível cadastrar o cliente."))
    } finally {
      salvandoRef.current = false
      if (telaAtual()) setSalvando(false)
    }
  }

  return (
    <section className="cartao caso-form">
      <div className="secao-cabecalho">
        <h2 className="secao-titulo">{tx("Novo cliente")}</h2>
        <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoCancelar}> {tx("← Voltar à lista")} </button>
      </div>

      <div className="caso-form-campos">
        <label className="campo">
          <span>{tx("Nome *")}</span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={tx("Nome do cliente")}
            autoFocus
          />
        </label>

        <div className="linha-campos">
          <label className="campo">
            <span>{tx("E-mail")}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@email.com"
            />
          </label>
          <label className="campo">
            <span>{tx("Celular")}</span>
            <input
              type="tel"
              value={celular}
              onChange={(e) => setCelular(e.target.value)}
              placeholder="(00) 00000-0000"
            />
          </label>
        </div>

        <CamposFicha slug={slug} tipo={tipo} setTipo={setTipo} site={site} setSite={setSite} consentimento={consentimento} setConsentimento={setConsentimento} perfil={perfil} setPerfil={setPerfil} tiposSugeridos={tiposSugeridos} />

        {/* "Mês/Ano ou Anual?" e "notificação de dicas?" são perguntas do
            FINANCEIRO. Num escritório de conformidade, o material do cliente
            não tem competência de período e não existe newsletter de dicas —
            perguntar isso faz a pessoa duvidar de que a tela é dela. Os
            valores default do backend (mensal / nenhuma) seguem valendo. */}
        {trabalhaPorPeriodo(office) && (
        <div className="linha-campos">
          <label className="campo">
            <span>{tx("Organização dos períodos")}</span>
            <select value={granularidade} onChange={(e) => setGranularidade(e.target.value as Granularidade)}>
              <option value="mensal">{tx("Mês/Ano — para evolução mês a mês")}</option>
              <option value="anual">{tx("Anual — só o ano")}</option>
            </select>
          </label>
          <label className="campo">
            <span>{tx("Notificação de dicas")}</span>
            <select
              value={notificacao}
              onChange={(e) => {
                setNotificacao(e.target.value as Notificacao)
                setEnvioDia('') // outra frequência = outra escala de dia
              }}
            >
              <option value="nenhuma">{tx("Nenhuma")}</option>
              <option value="semanal">{tx("Semanal")}</option>
              <option value="mensal">{tx("Mensal")}</option>
            </select>
          </label>
        </div>
        )}

        {trabalhaPorPeriodo(office) && notificacao !== 'nenhuma' && (
          <>
            <div className="linha-campos">
              <label className="campo">
                <span>{tx("Dia do envio")}</span>
                <select value={envioDia} onChange={(e) => setEnvioDia(e.target.value)}>
                  <option value="">{tx("Sem dia fixo")}</option>
                  <OpcoesDiaEnvio notificacao={notificacao} />
                </select>
              </label>
              <label className="campo">
                <span>{tx("Horário")}</span>
                <input
                  type="time"
                  value={envioHora}
                  onChange={(e) => setEnvioHora(e.target.value)}
                />
              </label>
            </div>
            <label className="check-inline">
              <input
                type="checkbox"
                checked={envioEmail}
                onChange={(e) => setEnvioEmail(e.target.checked)}
              />
              <span>{tx("Enviar por e-mail ao cliente quando eu aprovar")}</span>
            </label>
            <p className="texto-suave"> {tx("As dicas são geradas no dia e horário escolhidos e")} <strong>{tx("só")}</strong> {tx("saem por e-mail para o cliente depois da sua aprovação.")} </p>
          </>
        )}

        <label className="campo">
          <span>{tx("Resumo do cliente")}</span>
          <textarea
            rows={3}
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            placeholder={tx("Situação, objetivos, contexto — os agentes usam isso nos relatórios (opcional)")}
          />
        </label>
      </div>

      <div className="caso-form-rodape">
        <button type="button" className="botao botao-fantasma" onClick={aoCancelar}> {tx("Cancelar")} </button>
        <button type="button" className="botao botao-primario" onClick={salvar} disabled={salvando}>
          {salvando ? tx("Salvando…") : tx("Salvar cliente")}
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Adicionar período                                                   */
/* ------------------------------------------------------------------ */

function NovoPeriodo({
  granularidade,
  porPeriodo = true,
  aoAdicionar,
}: {
  granularidade: Granularidade
  /** Falso = andar SEM período (conformidade): ano e mês somem e o botão cria
   *  uma pasta do ano corrente, que é só o balde onde os documentos ficam. O
   *  backend continua guardando por período — o que muda é o que se pergunta
   *  a quem está do outro lado da tela. */
  porPeriodo?: boolean
  aoAdicionar: (ano: number, mes: number | null) => Promise<void>
}) {
  const tx = useTextoEscritorio()
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(anoAtual)
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [salvando, setSalvando] = useState(false)

  async function adicionar() {
    setSalvando(true)
    try {
      await aoAdicionar(
        porPeriodo ? ano : anoAtual,
        porPeriodo && granularidade === 'mensal' ? mes : null,
      )
    } finally {
      setSalvando(false)
    }
  }

  if (!porPeriodo) {
    return (
      <button
        type="button"
        className="botao botao-primario"
        onClick={adicionar}
        disabled={salvando}
      >
        {salvando ? 'Criando…' : <><Icone nome="mais" tamanho={15} /> {tx("Criar pasta de documentos")}</>}
      </button>
    )
  }

  return (
    <div className="linha-campos" style={{ alignItems: 'flex-end' }}>
      <label className="campo">
        <span>{tx("Ano")}</span>
        <input
          type="number"
          value={ano}
          min={1900}
          max={2200}
          onChange={(e) => setAno(Number(e.target.value))}
        />
      </label>
      {granularidade === 'mensal' && (
        <label className="campo">
          <span>{tx("Mês")}</span>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => (
              <option key={i + 1} value={i + 1}>
                {tx(m)}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className="botao botao-primario" onClick={adicionar} disabled={salvando}>
        {salvando ? tx("Adicionando…") : <><Icone nome="mais" tamanho={15} /> {tx("Adicionar período")}</>}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Card de um período (com uploads)                                    */
/* ------------------------------------------------------------------ */

function PeriodoCard({
  orgId,
  slug,
  clienteId,
  periodo,
  aoMudar,
}: {
  orgId: number
  slug: string
  clienteId: number
  periodo: ClientePeriodo
  aoMudar: () => Promise<void>
}) {
  const { idioma, t } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const [enviando, setEnviando] = useState(false)
  const [removendo, setRemovendo] = useState(false)
  const ocupadoRef = useRef(false)
  const { telaAtual, conta } = useTelaCliente()
  const { confirmar, dialogo } = useConfirmacao(`${conta}:${orgId}:${slug}:${clienteId}:${periodo.id}`)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const base = `/predios/${orgId}/${slug}/clientes/${clienteId}`

  async function enviar(e: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (arquivos.length === 0 || !telaAtual() || ocupadoRef.current) return
    ocupadoRef.current = true
    setEnviando(true)
    let enviados = 0
    try {
      for (const arquivo of arquivos) {
        if (!telaAtual()) return
        const fd = new FormData()
        fd.append('arquivo', arquivo, arquivo.name)
        await api.postForm(`${base}/periodos/${periodo.id}/arquivos`, fd)
        enviados++
      }
      if (!telaAtual()) return
      sucesso(arquivos.length === 1 ? tx("Arquivo enviado.") : tx("{0} arquivos enviados.", arquivos.length))
      await aoMudar()
    } catch (err) {
      if (!telaAtual()) return
      falha(err instanceof ApiError ? err.detail : tx("Não foi possível enviar o arquivo."))
      if (enviados > 0) await aoMudar()
    } finally {
      ocupadoRef.current = false
      if (telaAtual()) setEnviando(false)
    }
  }

  async function removerArquivo(arquivo: ClienteArquivo) {
    if (!telaAtual() || ocupadoRef.current) return
    if (!await confirmar({ titulo: t('Remover arquivo do cliente', 'Remove client file'), mensagem: t(`Remover “${arquivo.nome_original || arquivo.nome}” do período ${periodo.rotulo}?`, `Remove “${arquivo.nome_original || arquivo.nome}” from ${periodo.rotulo}?`), acao: t('Remover arquivo', 'Remove file') }) || !telaAtual() || ocupadoRef.current) return
    ocupadoRef.current = true
    setRemovendo(true)
    try {
      await api.del(`${base}/arquivos/${arquivo.id}`)
      if (!telaAtual()) return
      await aoMudar()
    } catch (err) {
      if (telaAtual()) falha(err instanceof ApiError ? err.detail : tx("Não foi possível remover o arquivo."))
    } finally { ocupadoRef.current = false; if (telaAtual()) setRemovendo(false) }
  }

  async function removerPeriodo() {
    if (!telaAtual() || ocupadoRef.current) return
    if (!await confirmar({ titulo: t('Remover período', 'Remove period'), mensagem: tx("Remover o período {0} e seus arquivos?", periodo.rotulo), acao: t('Remover período', 'Remove period') }) || !telaAtual() || ocupadoRef.current) return
    ocupadoRef.current = true
    setRemovendo(true)
    try {
      await api.del(`${base}/periodos/${periodo.id}`)
      if (!telaAtual()) return
      sucesso(tx("Período {0} removido.", periodo.rotulo))
      await aoMudar()
    } catch (err) {
      if (telaAtual()) falha(err instanceof ApiError ? err.detail : tx("Não foi possível remover o período."))
    } finally { ocupadoRef.current = false; if (telaAtual()) setRemovendo(false) }
  }

  return (
    <section className="cartao">
      {dialogo}
      <div className="secao-cabecalho">
        <h3 className="secao-titulo">
          {periodo.rotulo}
          {periodo.total_arquivos > 0 && <span className="contador">{periodo.total_arquivos}</span>}
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="botao botao-fantasma botao-pequeno"
            onClick={() => inputRef.current?.click()}
            disabled={enviando || removendo}
          >
            {enviando ? tx("Enviando…") : <><Icone nome="mais" tamanho={15} /> {tx("Arquivos")}</>}
          </button>
          <button type="button" className="botao-texto perigo" aria-label={t(`Remover período ${periodo.rotulo}`, `Remove period ${periodo.rotulo}`)} disabled={enviando || removendo} onClick={removerPeriodo}> {tx("remover")} </button>
          <input ref={inputRef} type="file" multiple hidden onChange={enviar} />
        </div>
      </div>

      {periodo.arquivos.length === 0 ? (
        <p className="texto-suave">{tx("Nenhum arquivo neste período. Suba extratos, planilhas e documentos.")}</p>
      ) : (
        <ul className="lista-arquivos">
          {periodo.arquivos.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="arquivo-nome botao-texto"
                title={tx("Baixar arquivo")}
                onClick={() =>
                  baixarArquivo(`${base}/arquivos/${a.id}/download`, a.nome_original || a.nome).catch(() =>
                    falha(tx("Não foi possível baixar o arquivo.")),
                  )
                }
              >
                <Icone nome={iconeDoArquivo(a.nome)} tamanho={15} /> {a.nome_original || a.nome}
              </button>
              <span className="caso-doc-meta">
                <span className="arquivo-tamanho">{formatBytes(a.tamanho_bytes ?? 0, idioma)}</span>
                <button
                  type="button"
                  className="botao-texto"
                  onClick={() =>
                    baixarArquivo(`${base}/arquivos/${a.id}/download`, a.nome_original || a.nome).catch(() =>
                      falha(tx("Não foi possível baixar o arquivo.")),
                    )
                  }
                > {tx("baixar")} </button>
                <button type="button" className="botao-texto perigo" aria-label={t(`Remover ${a.nome_original || a.nome}`, `Remove ${a.nome_original || a.nome}`)} disabled={enviando || removendo} onClick={() => removerArquivo(a)}> {tx("remover")} </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Entregas deste cliente (grupo lazy — busca no primeiro expandir)    */
/* ------------------------------------------------------------------ */

function EntregasDoCliente({
  orgId,
  slug,
  clienteId,
  aoAbrirAbaEntregas,
}: {
  orgId: number
  slug: string
  clienteId: number
  /** Troca para a aba Entregas do prédio (padrão searchParams aba=…). */
  aoAbrirAbaEntregas: () => void
}) {
  const { idioma } = useIdioma()
  const tx = useTextoEscritorio()
  const [entregas, setEntregas] = useState<Entrega[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const buscouRef = useRef(false)

  const buscar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const data = await api.get<unknown>(
        `/predios/${orgId}/${slug}/entregas?cliente_id=${clienteId}`,
      )
      setEntregas(asList<Entrega>(data, 'entregas'))
    } catch (e) {
      setEntregas(null)
      setErro(e instanceof ApiError ? e.detail : tx("Não foi possível carregar as entregas deste cliente."))
    } finally {
      setCarregando(false)
    }
  }, [orgId, slug, clienteId])

  return (
    <details
      className="cliente-grupo"
      onToggle={(e) => {
        // Lazy: a busca só acontece no PRIMEIRO expandir — fechar e reabrir
        // não refaz a chamada (o "tentar de novo" cobre o caso de erro).
        if ((e.target as HTMLDetailsElement).open && !buscouRef.current) {
          buscouRef.current = true
          buscar()
        }
      }}
    >
      <summary>
        <span className="cliente-grupo-titulo"><Icone nome="entregas" tamanho={15} /> {tx("Entregas deste cliente")}</span>
        {entregas !== null && (
          <span className="cliente-grupo-resumo">
            {entregas.length === 1 ? '1 entrega' : tx("{0} entregas", entregas.length)}
          </span>
        )}
      </summary>

      {carregando && (
        <div className="esqueleto esqueleto-card" style={{ minHeight: 60 }} aria-hidden="true" />
      )}

      {erro && !carregando && (
        <p className="alerta alerta-erro">
          {tx(erro)}{' '}
          <button type="button" className="botao-texto" onClick={buscar}> {tx("tentar de novo")} </button>
        </p>
      )}

      {entregas !== null && !carregando && (
        entregas.length === 0 ? (
          <p className="texto-suave">{tx("Nenhuma entrega ainda para este cliente.")}</p>
        ) : (
          <ul className="entregas-cliente-lista">
            {entregas.map((ent) => (
              <li key={ent.id}>
                <span className="entregas-cliente-quando" title={formatDataHora(ent.criado_em, idioma)}>
                  {tempoRelativo(ent.criado_em, idioma)}
                </span>
                <span className="entregas-cliente-nome" title={ent.job_titulo || ent.nome}>
                  {ent.nome}
                </span>
                <span className={`status-pill entrega-${ent.status}`}>
                  {tx(STATUS_ENTREGA_LABEL[ent.status] ?? ent.status)}
                </span>
                <span className={`status-pill ${ent.canal === 'email' ? 'canal-email' : 'canal-chat'}`}>
                  {ent.canal === 'email'
                    ? <><Icone nome="email" tamanho={15} /> email</>
                    : <><Icone nome="conversa" tamanho={15} /> chat</>}
                </span>
              </li>
            ))}
          </ul>
        )
      )}

      <p className="cliente-grupo-rodape">
        <button type="button" className="botao-texto" onClick={aoAbrirAbaEntregas}> {tx("abrir na aba Entregas →")} </button>
      </p>
    </details>
  )
}

/* ------------------------------------------------------------------ */
/* Detalhe do cliente                                                  */
/* ------------------------------------------------------------------ */

function FormFicha({
  slug,
  cliente,
  tiposSugeridos,
  aoSalvar,
  aoCancelar,
}: {
  slug: string
  cliente: Cliente
  tiposSugeridos: string[]
  aoSalvar: (patch: Record<string, unknown>) => Promise<void>
  aoCancelar: () => void
}) {
  const tx = useTextoEscritorio()
  const [nome, setNome] = useState(cliente.nome)
  const [email, setEmail] = useState(cliente.email || '')
  const [celular, setCelular] = useState(cliente.celular || '')
  const [tipo, setTipo] = useState(cliente.tipo || '')
  const [site, setSite] = useState(cliente.site || '')
  const [consentimento, setConsentimento] = useState(!!cliente.consentimento_pentest)
  const [perfil, setPerfil] = useState<PerfilInvestidor>((cliente.perfil_investidor || '') as PerfilInvestidor)
  const [observacoes, setObservacoes] = useState(cliente.observacoes || '')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    if (!nome.trim()) return
    setSalvando(true)
    try {
      await aoSalvar({
        nome: nome.trim(),
        email: email.trim(),
        celular: celular.trim(),
        tipo: tipo.trim(),
        site: site.trim(),
        consentimento_pentest: consentimento,
        perfil_investidor: perfil,
        observacoes: observacoes.trim(),
      })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="caso-form-campos">
      <label className="campo">
        <span>{tx("Nome *")}</span>
        <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} />
      </label>
      <div className="linha-campos">
        <label className="campo">
          <span>{tx("E-mail")}</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="campo">
          <span>{tx("Celular")}</span>
          <input type="tel" value={celular} onChange={(e) => setCelular(e.target.value)} />
        </label>
      </div>
      <CamposFicha slug={slug} tipo={tipo} setTipo={setTipo} site={site} setSite={setSite} consentimento={consentimento} setConsentimento={setConsentimento} perfil={perfil} setPerfil={setPerfil} tiposSugeridos={tiposSugeridos} />
      <label className="campo">
        <span>{tx("Resumo do cliente")}</span>
        <textarea
          rows={4}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder={tx("Situação, objetivos, contexto — os agentes usam isso nos relatórios")}
        />
      </label>
      <div className="caso-form-rodape">
        <button type="button" className="botao botao-fantasma" onClick={aoCancelar} disabled={salvando}> {tx("Cancelar")} </button>
        <button type="button" className="botao botao-primario" onClick={salvar} disabled={salvando || !nome.trim()}>
          {salvando ? tx("Salvando…") : tx("Salvar ficha")}
        </button>
      </div>
    </div>
  )
}

function DetalheCliente({
  orgId,
  slug,
  office,
  clienteId,
  tiposSugeridos,
  aoVoltar,
  aoAtualizarLista,
  aoAbrirEntregas,
}: {
  orgId: number
  slug: string
  office?: OfficeInfo | null
  clienteId: number
  tiposSugeridos: string[]
  aoVoltar: () => void
  aoAtualizarLista: () => void
  /** Troca para a aba Entregas do prédio (link no grupo de entregas). */
  aoAbrirEntregas: () => void
}) {
  const { idioma, t } = useIdioma()
  const tx = useTextoEscritorio()
  const { sucesso, falha } = useToasts()
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)
  const [atualizando, setAtualizando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const operacaoRef = useRef(false)
  const { telaAtual, leituraRef, conta } = useTelaCliente()
  const { confirmar, dialogo } = useConfirmacao(`${conta}:${orgId}:${slug}:${clienteId}`)
  const base = `/predios/${orgId}/${slug}/clientes/${clienteId}`

  const carregar = useCallback(async () => {
    if (!telaAtual()) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    try {
      const data = await api.get<Cliente>(base, controller.signal)
      if (!telaAtual() || controller.signal.aborted) return
      setCliente(data)
      setErro(null)
    } catch (e) {
      if (telaAtual() && !controller.signal.aborted) setErro(e instanceof ApiError ? e.detail : tx("Não foi possível carregar o cliente."))
    }
  }, [base, telaAtual, leituraRef, tx])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function adicionarPeriodo(ano: number, mes: number | null) {
    if (!telaAtual() || operacaoRef.current) return
    operacaoRef.current = true
    leituraRef.current?.abort()
    try {
      await api.post(`${base}/periodos`, { ano, mes: mes ?? undefined })
      if (!telaAtual()) return
      sucesso(tx("Período adicionado."))
      await carregar()
      aoAtualizarLista()
    } catch (e) {
      if (!telaAtual()) return
      if (e instanceof ApiError && e.status === 409) {
        falha(tx("Esse período já está cadastrado para o cliente."))
      } else {
        falha(e instanceof ApiError ? e.detail : tx("Não foi possível adicionar o período."))
      }
    } finally { operacaoRef.current = false }
  }

  async function atualizarCliente(patch: Record<string, unknown>) {
    if (!telaAtual() || operacaoRef.current) return false
    operacaoRef.current = true
    setAtualizando(true)
    leituraRef.current?.abort()
    try {
      await api.put(base, patch)
      if (!telaAtual()) return false
      await carregar()
      if (!telaAtual()) return false
      aoAtualizarLista()
      return true
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : tx("Não foi possível atualizar o cliente."))
      return false
    } finally { operacaoRef.current = false; if (telaAtual()) setAtualizando(false) }
  }

  async function excluirCliente() {
    if (!cliente || !telaAtual() || operacaoRef.current) return
    if (!await confirmar({ titulo: tx('Excluir cliente'), mensagem: tx("Excluir o cliente “{0}” e todos os períodos/arquivos?", cliente.nome), acao: tx('Excluir cliente') }) || !telaAtual() || operacaoRef.current) return
    operacaoRef.current = true
    setExcluindo(true)
    leituraRef.current?.abort()
    try {
      await api.del(base)
      if (!telaAtual()) return
      sucesso(tx("Cliente excluído."))
      aoAtualizarLista()
      aoVoltar()
    } catch (e) {
      if (telaAtual()) falha(e instanceof ApiError ? e.detail : tx("Não foi possível excluir o cliente."))
    } finally { operacaoRef.current = false; if (telaAtual()) setExcluindo(false) }
  }

  if (erro && !cliente) {
    return (
      <section className="cartao">
        <p className="alerta alerta-erro" role="alert">{tx(erro)}{' '}<button type="button" className="botao-texto" onClick={() => void carregar()}>{t('Tentar novamente', 'Try again')}</button></p>
        <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoVoltar}> {tx("← Voltar à lista")} </button>
      </section>
    )
  }

  if (!cliente) {
    return (
      <div aria-hidden="true">
        <div className="esqueleto esqueleto-card" style={{ minHeight: 200 }} />
      </div>
    )
  }

  return (
    <div className="caso-detalhe">
      {dialogo}
      {erro && <p className="alerta alerta-erro" role="alert">{tx(erro)}{' '}<button type="button" className="botao-texto" onClick={() => void carregar()}>{t('Tentar novamente', 'Try again')}</button></p>}
      <div className="caso-detalhe-topo">
        <button type="button" className="botao botao-fantasma botao-pequeno" onClick={aoVoltar}> {tx("← Voltar à lista")} </button>
        <span style={{ display: 'inline-flex', gap: '0.5rem' }}>
          {cliente.status === 'standby' && (
            <span className="status-pill status-error"><Icone nome="pausa" tamanho={15} /> Standby</span>
          )}
          {cliente.notificacao !== 'nenhuma' && (
            <span className="status-pill status-done">
              <Icone nome="sino" tamanho={15} /> {cliente.notificacao === 'semanal' ? tx("Semanal") : tx("Mensal")}
            </span>
          )}
          <span className="status-pill status-queued">{tx(GRANULARIDADE_LABEL[cliente.granularidade])}</span>
        </span>
      </div>

      <section className="cartao">
        {editando ? (
          <>
            <h2 className="secao-titulo" style={{ marginBottom: '0.6rem' }}>{tx("Editar ficha do cliente")}</h2>
            <FormFicha
              slug={slug}
              cliente={cliente}
              tiposSugeridos={tiposSugeridos}
              aoCancelar={() => setEditando(false)}
              aoSalvar={async (patch) => {
                if (await atualizarCliente(patch) && telaAtual()) {
                  setEditando(false)
                  sucesso(tx("Ficha atualizada."))
                }
              }}
            />
          </>
        ) : (
          <>
            <div className="caso-detalhe-cabecalho">
              <div>
                <h2 className="secao-titulo">{cliente.nome}</h2>
                <p className="texto-suave caso-detalhe-sub">
                  {cliente.email || 'sem e-mail'}
                  {cliente.celular && <> · {cliente.celular}</>}
                  {cliente.tipo && <> · {cliente.tipo}</>}
                </p>
                {/* O site é o ALVO do trabalho num escritório de conformidade:
                    fica visível na ficha (e clicável) em vez de escondido no
                    formulário de edição. Sem ele, dizemos o que falta. */}
                {!ehFinanceiro(slug) && (
                  <p className="texto-suave caso-detalhe-sub">
                    {cliente.site ? (
                      <>
                        🌐{' '}
                        <a href={cliente.site} target="_blank" rel="noopener noreferrer">
                          {cliente.site.replace(/^https?:\/\//, '')}
                        </a>
                      </>
                    ) : (
                      <>{tx("⚠️ sem site cadastrado — a varredura e o teste precisam dele")}</>
                    )}
                  </p>
                )}
              </div>
              <span style={{ display: 'inline-flex', gap: '0.6rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  disabled={atualizando || excluindo}
                  onClick={() => atualizarCliente({ status: cliente.status === 'standby' ? 'ativo' : 'standby' })}
                >
                  {cliente.status === 'standby'
                    ? <><Icone nome="play" tamanho={15} /> {tx("Reativar")}</>
                    : <><Icone nome="pausa" tamanho={15} /> Standby</>}
                </button>
                <button type="button" className="botao botao-fantasma botao-pequeno" disabled={atualizando || excluindo} onClick={() => setEditando(true)}>
                  <Icone nome="lapis" tamanho={15} /> {tx("Editar ficha")} </button>
                <button type="button" className="botao-texto perigo" disabled={atualizando || excluindo} onClick={excluirCliente}> {tx("Excluir cliente")} </button>
              </span>
            </div>
            {cliente.perfil_investidor && (
              <p style={{ marginTop: '0.35rem' }}>
                <span className="status-pill status-queued">
                  <Icone nome="oficio-financeiro" tamanho={15} /> {tx("Investidor")}{' '}
                  {tx(PERFIL_LABEL[cliente.perfil_investidor] || cliente.perfil_investidor)}
                </span>
              </p>
            )}
          </>
        )}
      </section>

      {/* As informações do cliente vivem em 3 grupos recolhíveis (começam
          fechados): perfil/notificações, períodos+arquivos e o histórico de
          entregas — só o cabeçalho acima fica sempre visível. */}
      <div className="cliente-grupos">
        {/* Notificação de "dicas" é a newsletter do FINANCEIRO/assistentes.
            Num escritório de conformidade ela não existe — e uma seção que só
            oferece um seletor sem uso faz a pessoa procurar o que ela faz. */}
        {trabalhaPorPeriodo(office) && (
        <details className="cliente-grupo">
          <summary>
            <span className="cliente-grupo-titulo"><Icone nome="sino" tamanho={15} /> {tx("Perfil e notificações")}</span>
            <span className="cliente-grupo-resumo">{resumoPerfilNotificacoes(cliente, tx)}</span>
          </summary>

          <div className="linha-campos" style={{ marginTop: '0.4rem' }}>
            <label className="campo">
              <span>{tx("Notificação de dicas")}</span>
              <select
                value={cliente.notificacao}
                disabled={atualizando || excluindo}
                onChange={(e) => atualizarCliente({ notificacao: e.target.value })}
              >
                <option value="nenhuma">{tx("Nenhuma")}</option>
                <option value="semanal">{tx("Semanal")}</option>
                <option value="mensal">{tx("Mensal")}</option>
              </select>
            </label>
            {/* Agenda de envio: cada controle grava direto na ficha (PUT),
                no mesmo padrão do select de frequência acima. Trocar a
                frequência SEM reinformar o dia limpa a agenda no backend. */}
            {cliente.notificacao !== 'nenhuma' && (
              <>
                <label className="campo">
                  <span>{tx("Dia do envio")}</span>
                  <select
                    value={cliente.envio_dia ?? ''}
                    disabled={atualizando || excluindo}
                    onChange={(e) =>
                      atualizarCliente({
                        envio_dia: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">{tx("Sem dia fixo")}</option>
                    <OpcoesDiaEnvio notificacao={cliente.notificacao} />
                  </select>
                </label>
                <label className="campo">
                  <span>{tx("Horário")}</span>
                  <HoraEnvio
                    valor={cliente.envio_hora || '09:00'}
                    disabled={atualizando || excluindo}
                    aoSalvar={(v) => atualizarCliente({ envio_hora: v })}
                  />
                </label>
              </>
            )}
          </div>
          {cliente.notificacao !== 'nenhuma' && (
            <>
              <label className="check-inline" style={{ marginTop: '0.4rem' }}>
                <input
                  type="checkbox"
                  checked={!!cliente.envio_email}
                  disabled={atualizando || excluindo}
                  onChange={(e) => atualizarCliente({ envio_email: e.target.checked })}
                />
                <span>{tx("Enviar por e-mail ao cliente quando eu aprovar")}</span>
              </label>
              <p className="texto-suave" style={{ marginTop: '0.25rem' }}> {tx("As dicas são geradas no dia e horário acima e")} <strong>{tx("só")}</strong> {tx("saem por e-mail para o cliente depois da sua aprovação")} {cliente.envio_email && !cliente.email
                  ? ' — cadastre o e-mail do cliente para o envio funcionar'
                  : ''}
                .
              </p>
            </>
          )}
          {cliente.observacoes && <p className="caso-descricao">{cliente.observacoes}</p>}
          {cliente.criado_em && (
            <dl className="sobre-detalhes">
              <div>
                <dt>{tx("Cadastrado em")}</dt>
                <dd>{formatDataHora(cliente.criado_em, idioma)}</dd>
              </div>
            </dl>
          )}
        </details>
        )}

        {/* DOCUMENTOS DO CLIENTE. Onde entram o contrato assinado, o termo de
            autorização e o formulário preenchido. Fica ABERTO por padrão nos
            andares sem período: era a pergunta "onde eu salvo o contrato?" —
            a resposta estava dentro de um acordeão fechado chamado "Períodos
            e arquivos", que num escritório de conformidade não quer dizer
            nada. Onde o período É o trabalho (financeiro), nada muda. */}
        <details className="cliente-grupo" open={!trabalhaPorPeriodo(office)}>
          <summary>
            <span className="cliente-grupo-titulo">
              {trabalhaPorPeriodo(office)
                ? <><Icone nome="meses" tamanho={15} /> {tx("Períodos e arquivos")}</>
                : <><Icone nome="anexo" tamanho={15} /> {tx("Documentos do cliente")}</>}
            </span>
            <span className="cliente-grupo-resumo">{resumoPeriodosArquivos(cliente, tx)}</span>
          </summary>

          <p className="texto-suave" style={{ marginTop: '0.4rem' }}>
            {!trabalhaPorPeriodo(office)
              ? tx("Contrato assinado, termo de autorização, formulário preenchido, política atual — o escritório lê tudo o que estiver aqui quando trabalhar para este cliente.")
              : cliente.granularidade === 'mensal'
                ? tx("Este cliente é organizado por Mês/Ano — cada período agrupa os arquivos daquele mês.")
                : tx("Este cliente é organizado por Ano — cada período agrupa os arquivos daquele ano.")}
          </p>
          <NovoPeriodo
            granularidade={cliente.granularidade}
            porPeriodo={trabalhaPorPeriodo(office)}
            aoAdicionar={adicionarPeriodo}
          />

          {cliente.periodos.length === 0 ? (
            <p className="texto-suave" style={{ marginTop: '0.6rem' }}>
              {trabalhaPorPeriodo(office)
                ? tx("Nenhum período ainda — adicione um acima e suba os arquivos do cliente.")
                : tx("Nenhum documento ainda — crie a pasta acima e arraste os arquivos para dentro.")}
            </p>
          ) : (
            <div className="cliente-grupo-periodos">
              {cliente.periodos.map((p) => (
                <PeriodoCard
                  key={p.id}
                  orgId={orgId}
                  slug={slug}
                  clienteId={clienteId}
                  periodo={p}
                  aoMudar={carregar}
                />
              ))}
            </div>
          )}
        </details>

        <EntregasDoCliente
          orgId={orgId}
          slug={slug}
          clienteId={clienteId}
          aoAbrirAbaEntregas={aoAbrirEntregas}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Card de cliente na lista                                            */
/* ------------------------------------------------------------------ */

function CardCliente({
  cliente,
  office,
  aoAbrir,
}: {
  cliente: ClienteResumo
  office?: OfficeInfo | null
  aoAbrir: () => void
}) {
  const tx = useTextoEscritorio()
  const emStandby = cliente.status === 'standby'
  // Sem período, o cartão fala do que ESTE andar usa: o site (o alvo) em vez
  // de "Mês/Ano" e "0 período(s)" — rótulos que não querem dizer nada aqui.
  const porPeriodo = trabalhaPorPeriodo(office)
  return (
    <button
      type="button"
      className="caso-card"
      onClick={aoAbrir}
      style={emStandby ? { opacity: 0.6 } : undefined}
      title={emStandby ? tx("Cliente em standby") : undefined}
    >
      <div className="caso-card-topo">
        <strong className="caso-card-nome">{cliente.nome}</strong>
        {emStandby ? (
          <span className="status-pill status-error"><Icone nome="pausa" tamanho={15} /> Standby</span>
        ) : porPeriodo ? (
          <span className="status-pill status-queued">{tx(GRANULARIDADE_LABEL[cliente.granularidade])}</span>
        ) : null}
      </div>
      <div className="caso-card-meta">
        {cliente.tipo && <span><Icone nome="pessoa" tamanho={15} /> {cliente.tipo}</span>}
        {porPeriodo && cliente.perfil_investidor && (
          <span>
            <Icone nome="oficio-financeiro" tamanho={15} />{' '}
            {tx(PERFIL_LABEL[cliente.perfil_investidor] || cliente.perfil_investidor)}
          </span>
        )}
        {!porPeriodo &&
          (cliente.site ? (
            <span>🌐 {cliente.site.replace(/^https?:\/\//, '')}</span>
          ) : (
            <span title={tx("A varredura e o teste precisam de um alvo")}>
              <Icone nome="alerta" tamanho={15} /> {tx("sem site")} </span>
          ))}
        {cliente.email && <span><Icone nome="email" tamanho={15} /> {cliente.email}</span>}
        {cliente.celular && <span><Icone nome="celular" tamanho={15} /> {cliente.celular}</span>}
        {porPeriodo && <span><Icone nome="meses" tamanho={15} /> {cliente.total_periodos} {tx("período(s)")}</span>}
        {/* Resumo da agenda — ex.: "dicas: semanal · seg 09:00 · e-mail ligado" */}
        {cliente.notificacao !== 'nenhuma' && (
          <span title={tx(NOTIF_LABEL[cliente.notificacao])}>
            <Icone nome="sino" tamanho={15} /> {resumoEnvio(cliente, tx)}
          </span>
        )}
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Aba principal                                                       */
/* ------------------------------------------------------------------ */

type Vista = { modo: 'lista' } | { modo: 'novo' } | { modo: 'detalhe'; id: number }

export function ClientesTab({
  orgId,
  slug,
  office,
}: {
  orgId: number
  slug: string
  /** Manifesto do andar — decide o que a ficha pergunta (ver trabalhaPorPeriodo). */
  office?: OfficeInfo | null
}) {
  return <ClientesConteudo key={`${getSessionIdentity()}:${orgId}:${slug}`} orgId={orgId} slug={slug} office={office} />
}

function ClientesConteudo({ orgId, slug, office }: { orgId: number; slug: string; office?: OfficeInfo | null }) {
  const { t } = useIdioma()
  const tx = useTextoEscritorio()
  const { telaAtual, leituraRef } = useTelaCliente()
  const [searchParams, setSearchParams] = useSearchParams()
  const [clientes, setClientes] = useState<ClienteResumo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [mostrarStandby, setMostrarStandby] = useState(false)

  const clienteParam = searchParams.get('cliente')
  const novoParam = searchParams.get('novocli')
  const vista: Vista = novoParam
    ? { modo: 'novo' }
    : clienteParam && /^\d+$/.test(clienteParam)
      ? { modo: 'detalhe', id: Number(clienteParam) }
      : { modo: 'lista' }

  function irPara(v: Vista) {
    if (!telaAtual()) return
    const params = new URLSearchParams(searchParams)
    params.delete('cliente')
    params.delete('novocli')
    if (v.modo === 'novo') params.set('novocli', '1')
    else if (v.modo === 'detalhe') params.set('cliente', String(v.id))
    setSearchParams(params, { replace: true })
  }

  const carregar = useCallback(async () => {
    if (!telaAtual()) return
    leituraRef.current?.abort()
    const controller = new AbortController()
    leituraRef.current = controller
    try {
      const data = await api.get<unknown>(`/predios/${orgId}/${slug}/clientes`, controller.signal)
      if (!telaAtual() || controller.signal.aborted) return
      setClientes(asList<ClienteResumo>(data, 'clientes'))
      setErro(null)
    } catch (e) {
      if (telaAtual() && !controller.signal.aborted) setErro(e instanceof ApiError ? e.detail : tx("Não foi possível carregar os clientes."))
    }
  }, [orgId, slug, telaAtual, leituraRef, tx])

  useEffect(() => {
    // clientes === null: deep-link direto em ?novocli=1/?cliente=N também
    // carrega a lista — o datalist de tipos da carteira depende dela.
    if (vista.modo === 'lista' || clientes === null) carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregar, vista.modo])

  // Datalist do "tipo de cliente": sugestões fixas + os tipos distintos que a
  // carteira já usa (dedup + ordem alfabética) — o que foi digitado uma vez
  // vira sugestão nas próximas fichas.
  const tiposSugeridos = useMemo(() => {
    const set = new Set(TIPOS_SUGERIDOS)
    for (const c of clientes ?? []) {
      const t = (c.tipo || '').trim()
      if (t) set.add(t)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [clientes])

  if (vista.modo === 'novo') {
    return (
      <NovoCliente
        orgId={orgId}
        slug={slug}
        office={office}
        tiposSugeridos={tiposSugeridos}
        aoCancelar={() => irPara({ modo: 'lista' })}
        aoCriar={(cliente) => irPara({ modo: 'detalhe', id: cliente.id })}
      />
    )
  }

  if (vista.modo === 'detalhe') {
    return (
      <DetalheCliente
        key={vista.id}
        orgId={orgId}
        slug={slug}
        office={office}
        clienteId={vista.id}
        tiposSugeridos={tiposSugeridos}
        aoVoltar={() => irPara({ modo: 'lista' })}
        aoAtualizarLista={carregar}
        aoAbrirEntregas={() => {
          // Mesmo padrão de troca de aba do Predio.tsx: só o `aba` muda; o
          // ?cliente=N fica — voltar à aba Clientes reabre este cliente.
          const params = new URLSearchParams(searchParams)
          params.set('aba', 'entregas')
          setSearchParams(params, { replace: true })
        }}
      />
    )
  }

  const lista = (clientes ?? []).filter((c) => {
    const q = busca.trim().toLowerCase()
    if (!q) return true
    return (
      c.nome.toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.celular || '').toLowerCase().includes(q)
    )
  })
  // Ativos na grade principal; standby numa seção recolhida embaixo.
  const ativosLista = lista.filter((c) => c.status !== 'standby')
  const standbyLista = lista.filter((c) => c.status === 'standby')

  return (
    <div className="casos">
      {/* MODELOS PRONTOS — antes da lista, porque é o primeiro passo do
          trabalho: mandar os dois papéis para o cliente preencher e assinar.
          São ARQUIVOS estáticos, não tarefa de IA: o questionário e o termo
          são iguais para todo cliente, e pedir à IA que os "gere" a cada
          cadastro gasta chave e revisão para reproduzir o que já está pronto —
          e ainda arrisca sair diferente do anterior. A IA entra depois, para
          ADAPTAR (perguntar só o que a varredura não respondeu) e ANALISAR o
          que voltou preenchido. */}
      {!trabalhaPorPeriodo(office) && (
        <section className="cartao modelos-prontos">
          <h2 className="secao-titulo"><Icone nome="arq-documento" /> {tx("Modelos para mandar ao cliente")}</h2>
          <p className="texto-suave"> {tx("Prontos para baixar, imprimir ou enviar por e-mail — os mesmos para todo cliente, sem gastar tarefa da IA. O preenchido volta em")}{' '}
            <strong>{tx("Documentos do cliente")}</strong>.
          </p>
          <span className="linha-conceder">
            <a
              className="botao botao-fantasma botao-pequeno"
              href="/modelos/questionario-lgpd.docx"
              download
            >
              <Icone nome="baixar" tamanho={15} /> {tx("Questionário de conformidade (LGPD)")} </a>
            <a
              className="botao botao-fantasma botao-pequeno"
              href="/modelos/termo-autorizacao-teste-seguranca.docx"
              download
            >
              <Icone nome="baixar" tamanho={15} /> {tx("Termo de autorização do teste de segurança")} </a>
          </span>
        </section>
      )}
      <div className="casos-barra">
        <div className="campo-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={tx("Buscar cliente…")}
            aria-label={tx("Buscar clientes")}
          />
        </div>
        <button type="button" className="botao botao-primario" onClick={() => irPara({ modo: 'novo' })}>
          <Icone nome="mais" tamanho={15} /> {tx("Novo cliente")} </button>
      </div>

      {erro && <p className="alerta alerta-erro" role="alert">{tx(erro)}{' '}<button type="button" className="botao-texto" onClick={() => void carregar()}>{t('Tentar novamente', 'Try again')}</button></p>}

      {clientes === null && !erro && (
        <div aria-hidden="true">
          <div className="esqueleto esqueleto-card" />
          <div className="esqueleto esqueleto-card" />
        </div>
      )}

      {clientes !== null && lista.length === 0 && (
        <div className="estado-vazio">
          <div className="estado-vazio-arte" aria-hidden="true">
            <Icone nome="clientes" tamanho={44} traco={1.3} />
          </div>
          <h2>{busca ? tx("Nenhum cliente encontrado") : tx("Nenhum cliente ainda")}</h2>
          <p>
            {busca
              ? tx("Tente outro termo de busca.")
              : tx("Cadastre o primeiro cliente e organize os arquivos dele por período.")}
          </p>
          {!busca && (
            <p>
              <button type="button" className="botao botao-primario" onClick={() => irPara({ modo: 'novo' })}>
                <Icone nome="mais" tamanho={15} /> {tx("Novo cliente")} </button>
            </p>
          )}
        </div>
      )}

      {ativosLista.length > 0 && (
        <div className="casos-grid">
          {ativosLista.map((c) => (
            <CardCliente key={c.id} cliente={c} office={office} aoAbrir={() => irPara({ modo: 'detalhe', id: c.id })} />
          ))}
        </div>
      )}

      {/* Standby fica embaixo, recolhido — abre/fecha no +/− */}
      {standbyLista.length > 0 && (
        <div className="standby-secao">
          <button
            type="button"
            className="standby-toggle"
            aria-expanded={mostrarStandby}
            onClick={() => setMostrarStandby((v) => !v)}
          >
            <span className="standby-mais" aria-hidden="true">{mostrarStandby ? '−' : '+'}</span>
            <Icone nome="pausa" tamanho={15} /> {tx("Em standby")} <span className="contador">{standbyLista.length}</span>
          </button>
          {mostrarStandby && (
            <div className="casos-grid" style={{ marginTop: '0.7rem' }}>
              {standbyLista.map((c) => (
                <CardCliente key={c.id} cliente={c} office={office} aoAbrir={() => irPara({ modo: 'detalhe', id: c.id })} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
