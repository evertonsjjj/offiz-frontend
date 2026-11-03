/** App compilado, dados simulados e navegador headless independente. Nenhuma API real. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.INTERFACE_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'offiz-acervo-selector-'))
await fs.mkdir(out, { recursive: true })
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
const person = { id: 11, email: 'fixture@example.invalid', nome: 'Conta simulada', is_admin: false, idioma_interface: 'pt-BR' }
const office = { slug: 'conteudo', nome: 'Conteúdo e marca', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const now = new Date().toISOString()
const materials = {
  produto: [
    { nome: 'garrincha-na-selecao.jpg', sub: 'história/ídolos', legenda: 'Garrincha em campo. Fonte documental e crédito do fotógrafo guardados com a fotografia.' },
    { nome: 'CREDITOS.md', legenda: 'Créditos e fontes das fotografias históricas' },
    { nome: 'fonte-documental-didi-referencia-fotografica-completa.md', legenda: 'Identificação documental de Didi e endereço da ficha do acervo' },
    ...Array.from({ length: 65 }, (_, i) => ({ nome: `fotografia-historica-${String(i + 1).padStart(2, '0')}.jpg`, sub: `coleção-${i % 3 + 1}`, legenda: `Fotografia histórica ${i + 1}. Descrição de arquivo com detalhes completos para pesquisar sem perder a origem.` })),
  ],
  marca: [{ nome: 'manual-da-marca.pdf', legenda: 'Identidade visual do clube' }],
  exemplos: [{ nome: 'garrincha-na-selecao.jpg', sub: 'outra-coleção', legenda: 'Referência de composição' }],
}
// Imagem SVG exclusivamente sintética, entregue apenas pela miniatura interceptada.
const thumb = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#efeff2"/><path d="M18 95 48 45 66 70 84 38 108 95Z" fill="#66666b"/><circle cx="34" cy="28" r="9" fill="#0066cc"/></svg>'
const errors = [], unexpected = [], writes = [], widths = [], thumbnails = []
let browser
try {
  const executablePath = process.env.BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : chromium.executablePath())
  browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ locale: 'pt-BR' })
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.addInitScript(person => {
    localStorage.setItem('offiz_access_token', 'fixture-acervo-selector')
    localStorage.setItem('offiz_usuario', JSON.stringify(person))
  }, person)
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/')) {
      if (url.origin === origin) return route.continue()
      unexpected.push(request.url()); return route.abort()
    }
    const endpoint = url.pathname.slice('/api/v1'.length)
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${endpoint}`)
      return route.fulfill({ status: 500, json: { detail: 'Esta prova não autoriza escrita' } })
    }
    if (/^\/predios\/3\/conteudo\/arquivos\/[^/]+\/[^/]+\/miniatura$/.test(endpoint)) {
      assert.equal(request.headers().authorization, 'Bearer fixture-acervo-selector')
      thumbnails.push(`${endpoint}${url.search}`)
      return route.fulfill({ contentType: 'image/svg+xml', body: thumb })
    }
    let body
    if (endpoint === '/auth/me') body = person
    else if (endpoint === '/notificacoes') body = []
    else if (endpoint === '/predios') body = [{ org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' }]
    else if (endpoint === '/orgs/3/inicio') body = { org_id: 3, org_nome: 'Clube simulado', org_status: 'ativa', meu_papel: 'owner', contrato_gerenciado: false, motor_modo: 'api', tem_chave: true, andares: [{ ...office, acervo_de_marca: true }], solucoes: [], outras_solucoes: [], sabatina: { estado: 'contextualizado', pergunta: 'O que vamos preparar?', opcoes: [], permite_livre: true } }
    else if (endpoint === '/predios/3/conteudo') body = { org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' }
    else if (endpoint === '/predios/3/conteudo/partida') body = { tem_motor: true, tem_chave: true, motor_local: false, sabatina_pendente: false, perfil_estado: 'contextualizado' }
    else if (endpoint === '/orgs/3/predio/conversas' || endpoint === '/predios/3/conteudo/conversas') body = { conversas: [] }
    else if (endpoint === '/orgs/3/contrato') body = { tipo: 'byok', vigencia: 'vigente' }
    else if (endpoint === '/orgs/3/saldo') body = { tipo: 'byok', vigencia: 'vigente', estado: 'conta_propria', periodo: now.slice(0, 7), consultado_em: now, renovacao_em: null, limite_brl_mes: null, credito_brl: null, total_brl: null, consumido_brl: null, reservado_brl: null, disponivel_brl: null, percentual_disponivel: null }
    else if (endpoint === '/orgs/3/projetos' || endpoint === '/orgs/3/padroes') body = []
    else if (endpoint === '/orgs/3/biblioteca') body = { itens: [], total: 0, resumo: { prontos: 0, precisa_de_voce: 0, em_producao: 0, aprovados: 0 }, atualizado_em: now }
    else if (endpoint.endsWith('/conhecimento/canon')) body = { conteudo: '' }
    else if (endpoint === '/predios/3/conteudo/arquivos') body = materials
    else if (endpoint.endsWith('/stats')) body = { tarefas_mes: 0, concluidas_mes: 0, rodando: false, entregas_pendentes: 0 }
    else if (endpoint.endsWith('/jobs') || endpoint.endsWith('/entregas') || endpoint.endsWith('/clientes') || endpoint.endsWith('/editorial')) body = []
    else if (endpoint.endsWith('/atividade')) body = { jobs: [] }
    else if (endpoint.endsWith('/metricas/loop')) body = { trabalhos: { total: 0, aprovados_de_primeira: 0, com_rejeicao: 0, pendentes: 0, com_devolutiva: 0, rodadas_extras: 0 }, taxa_aprovacao_primeira: null, por_tipo: [], tempo_mediano_ate_decisao_s: null, criterios_reprovados: 0 }
    else { unexpected.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 500, json: { detail: 'Endpoint sem fixture' } }) }
    return route.fulfill({ json: body })
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  for (const width of [360, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 })
    await page.goto(`${origin}/app?org=3&conversa=nova&vista=conversa`)
    const draft = page.getByRole('textbox', { name: 'Seu pedido', exact: true })
    await draft.fill('Faz um carrossel contando a história do clube.')
    await page.getByRole('button', { name: 'Do acervo', exact: true }).click()
    const picker = page.getByRole('region', { name: 'Anexar do acervo', exact: true })
    const search = picker.getByRole('searchbox', { name: 'Buscar no acervo', exact: true })
    await picker.getByRole('status').filter({ hasText: '70 arquivos' }).waitFor()
    assert(await search.evaluate(element => document.activeElement === element), 'Abrir dá foco à busca')
    const list = picker.getByRole('list', { name: 'Arquivos do acervo', exact: true })
    await list.locator('img').first().waitFor()
    await picker.scrollIntoViewIfNeeded()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Sem rolagem horizontal em ${width}px`)
    const layout = await picker.evaluate(element => {
      const list = element.querySelector('ul'), rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height, listHeight: list.clientHeight, listScrollHeight: list.scrollHeight, rowHeight: list.querySelector('button').getBoundingClientRect().height, searchTop: element.querySelector('input').getBoundingClientRect().top }
    })
    assert(layout.listScrollHeight > layout.listHeight, 'Os 70 itens rolam apenas na lista')
    assert(layout.rowHeight <= 90, 'Nome e descrição não expandem cada linha')
    await page.screenshot({ path: path.join(out, `acervo-${width}.png`), fullPage: true, animations: 'disabled' })
    const before = await search.boundingBox()
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    assert.equal((await search.boundingBox()).y, before.y, 'A busca fica à vista ao rolar os arquivos')
    await search.fill('fotografo selecao')
    assert.equal(await list.getByRole('button').count(), 1, 'Busca combina termos da legenda sem acentos')
    await search.press('Enter')
    assert.deepEqual(writes, [], 'Enter na busca não envia nem anexa')
    await search.press('ArrowDown')
    assert(await list.getByRole('button').evaluate(element => document.activeElement === element), 'ArrowDown alcança o primeiro resultado')
    await page.keyboard.press('Escape')
    assert(await draft.evaluate(element => document.activeElement === element))
    assert.equal(await draft.inputValue(), 'Faz um carrossel contando a história do clube.')
    await page.getByRole('button', { name: 'Do acervo', exact: true }).click()
    assert.equal(await page.getByRole('searchbox', { name: 'Buscar no acervo', exact: true }).inputValue(), '')
    await page.getByRole('searchbox').fill('inexistente')
    await page.getByText('Nenhum arquivo encontrado. Tente outro nome ou limpe a busca.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Limpar busca do acervo', exact: true }).click()
    assert.equal(await page.getByRole('searchbox').inputValue(), '')
    widths.push({ viewport: width, ...layout, keyboard: true, preservedDraft: true })
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.deepEqual(writes, [])
  const receipt = { builtUI: true, headless: true, syntheticAPI: true, widths, thumbnails: [...new Set(thumbnails)], writes: 0, providerCalls: 0, externalRequests: 0, out }
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(receipt))
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
