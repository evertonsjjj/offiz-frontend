/** Frontend handoff: local read-only fixtures, no backend and no AI connection. */
import http from 'node:http'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.env.VITE_API_URL = 'http://127.0.0.1:8188'
const user = { id: 11, email: 'demo@example.invalid', nome: 'Pessoa de demonstração', is_admin: false, idioma_interface: 'pt-BR' }
const office = { slug: 'conteudo', nome: 'Conteúdo & Marca', descricao: 'Ambiente fictício para trabalhar a interface.', acervo_de_marca: true, tema: { cor_primaria: '#0066cc', icone: 'conversa' } }
const now = '2026-10-30T12:00:00'
const sampleFile = { id: 91, job_id: 71, nome: 'aurora-estudo.png', mime: 'image/png', status: 'pendente', tipo: 'arquivo', tamanho_bytes: 74911, criado_em: now }
const sampleWork = { id: 71, org_id: 3, titulo: 'Aurora — estudo de post', office_slug: 'conteudo', projeto_id: null, projeto_nome: null, referencia_job_id: null, favorito: false, aprovado: false, criado_em: now, estado: 'pronto', status: 'done', desatualizados: [], arquivos: [sampleFile], conversa_id: 42, conversa_titulo: 'Post de lançamento da Aurora', conversa_office_slug: 'conteudo', pecas_editoriais: [], fontes: [], resultados: [], versoes_anteriores: [], qualidade: { estado: 'revisar', avisos: ['Exemplo fictício para redesenhar a interface.'], conferencias: [], atualizado_em: now } }
const conversation = { id: 42, organization_id: 3, office_slug: 'conteudo', titulo: 'Post de lançamento da Aurora', modo: 'pesquisa', atualizado_em: now, total_mensagens: 2, fixada: false, grupo: null, tarefas_iniciadas: [], trabalhos: [], mensagens: [{ id: 1, role: 'user', conteudo: 'Quero uma peça para organizar ideias no papel.', criado_em: now }, { id: 2, role: 'assistant', conteudo: 'Esta é uma conversa demonstrativa. Você pode redesenhar o aplicativo com dados fictícios, sem conectar IA.', criado_em: now }] }
const total = { tokens: 3200, estimado_api_brl: .12, consumido_gerenciado_brl: 0, equivalente_assinatura_brl: .08, estimativa_legada_brl: 0, reservado_brl: 0, sem_medicao: 1 }
const fixtures = {
  '/auth/me': user,
  '/notificacoes': [],
  '/predios': [{ org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' }],
  '/orgs/3/inicio': { org_id: 3, org_nome: 'Aurora · demonstração', org_status: 'ativa', meu_papel: 'owner', contrato_gerenciado: false, motor_modo: 'api', tem_chave: true, andares: [office], solucoes: [], outras_solucoes: [], sabatina: { estado: 'contextualizado', pergunta: 'O que vamos preparar?', opcoes: [], permite_livre: true } },
  '/predios/3/conteudo': { org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' },
  '/orgs/3/predio/conversas': { conversas: [conversation] },
  '/predios/3/conteudo/conversas': { conversas: [conversation] },
  '/conversas/42': conversation,
  '/conversas/42/uso': { totais: total, meses: [{ periodo: '2026-10', ...total }], conexoes: [{ periodo: '2026-10', provedor: 'exemplo', modalidade: 'api', operacao: 'texto', registros: 2, ...total }], cobertura: ['Valores fictícios de demonstração; nenhuma cobrança nem IA conectada.'] },
  '/orgs/3/uso/historico': { totais: total, meses: [{ periodo: '2026-10', ...total }], conexoes: [], cobertura: ['Dados de demonstração.'] },
  '/orgs/3/contrato': { tipo: 'byok', vigencia: 'vigente' },
  '/orgs/3/saldo': { tipo: 'byok', vigencia: 'vigente', estado: 'conta_propria', periodo: '2026-10', consultado_em: now, renovacao_em: null, limite_brl_mes: null, credito_brl: null, total_brl: null, consumido_brl: null, reservado_brl: null, disponivel_brl: null, percentual_disponivel: null },
  '/orgs/3/projetos': [], '/orgs/3/padroes': [],
  '/orgs/3/biblioteca': { itens: [sampleWork], total: 1, resumo: { prontos: 1, precisa_de_voce: 0, em_producao: 0, aprovados: 0 }, atualizado_em: now },
  '/orgs/3/biblioteca/71': sampleWork,
  '/jobs/71': sampleWork,
  '/jobs/71/events': { events: [] },
  '/predios/3/conteudo/estudio/trabalhos/71/fluxo': { job: sampleWork, derivado: false, tem_eventos: false,
    referencias: [{ titulo: 'Referência editorial sintética', arquivo: 'entrada/referencia-editorial.txt', url: null, aplicacao: 'Título superior, caderno central, espaço vazio e assinatura discreta.', saida: 'aurora-estudo.png', limitacao: 'Demonstração; não veio de rede social.', estado: 'declarada', relato_entrega_id: 92 }],
    prontidao: [{ nivel: 'teste', faltas: [], conferido: ['Exemplo fictício de conferência relatada.'], relato_entrega_id: 92 }],
    colunas: [{ titulo: 'o que entrou', nos: [{ id: 'f:1', titulo: 'referencia-editorial.txt', selo: 'referência' }] }, { titulo: 'quem mexeu', nos: [{ id: 'a:1', titulo: 'Composição de exemplo' }] }, { titulo: 'o que saiu', nos: [{ id: 's:91', titulo: 'aurora-estudo.png', entrega_id: 91 }] }], arestas: [['f:1', 'a:1'], ['a:1', 's:91']] },
  '/orgs/3/settings/llm': { motor_modo: 'api', llm_provedor: 'openai', modelo_estrategia: 'premium', claude_model: 'modelo-demonstrativo', tem_api_key: false },
  '/orgs/3/uso': { periodo: 'mes', tokens_entrada: 2000, tokens_saida: 1200, custo_estimado_brl: .12, por_office: [], por_membro: [], total_chamadas: 2 },
}
const api = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5180')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Offiz-Execucao')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  if (req.method !== 'GET') { res.writeHead(409); return res.end(JSON.stringify({ detail: 'Demonstração somente de interface. Esta ação não chama IA nem grava dados.' })) }
  const p = new URL(req.url, 'http://127.0.0.1:8188').pathname.replace(/^\/api\/v1/, '')
  if (/^\/entregas\/91\/(download|preview|thumbnail)$/.test(p)) {
    res.setHeader('Content-Type', 'image/png')
    return res.end(fs.readFileSync(path.join(root, 'public/demo/aurora-estudo.png')))
  }
  let data = fixtures[p]
  if (data === undefined && p.endsWith('/conhecimento/canon')) data = { conteudo: 'Marca fictícia Aurora. Estudo de interface sem IA conectada.' }
  if (data === undefined && p.endsWith('/arquivos')) data = { entrada: [], exemplos: [], produto: [] }
  if (data === undefined && p.endsWith('/stats')) data = { tarefas_mes: 0, concluidas_mes: 0, rodando: false, entregas_pendentes: 0 }
  if (data === undefined && /\/(jobs|entregas|clientes|editorial|membros|agenda)$/.test(p)) data = []
  if (data === undefined && p.endsWith('/atividade')) data = { jobs: [] }
  if (data === undefined && p.endsWith('/prontidao')) data = { niveis: [{ nome: 'Demonstração', descricao: 'Dados ilustrativos.' }], tipos: { teste: { nome: 'Teste', minimo: ['Tema', 'Público', 'Formato'], premium: ['Ativos e fatos conferidos'] } } }
  if (data === undefined) { res.writeHead(404); return res.end(JSON.stringify({ detail: 'Rota não incluída nesta demonstração.' })) }
  res.end(JSON.stringify(data))
})
api.listen(8188, '127.0.0.1')
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5180, strictPort: true }, plugins: [{ name: 'offiz-demo', transformIndexHtml: () => [{ tag: 'script', children: `localStorage.setItem('offiz_access_token','demo-local-sem-credencial');localStorage.setItem('offiz_usuario',${JSON.stringify(JSON.stringify(user))});`, injectTo: 'head-prepend' }, { tag: 'div', attrs: { style: 'padding:8px;background:#fff4cc;color:#302400;text-align:center;font:14px sans-serif' }, children: 'DEMONSTRAÇÃO LOCAL · dados fictícios · nenhuma IA ou cobrança conectada', injectTo: 'body-prepend' }] }] })
await server.listen()
console.log('Aplicativo: http://127.0.0.1:5180/app?org=3&slug=conteudo&conversa=42&vista=conversa\nPágina pública: http://127.0.0.1:5180/')
process.on('SIGINT', async () => { await server.close(); api.close(); process.exit(0) })
