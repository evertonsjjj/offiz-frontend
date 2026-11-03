/** App compilado; HTTP integralmente interceptado, sem produção ou API paga. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.INTERFACE_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'offiz-production-ui-'))
await fs.mkdir(out, { recursive: true })
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
const executablePath = process.env.BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : chromium.executablePath())
const person = { id: 11, email: 'fixture@example.invalid', nome: 'Conta simulada', is_admin: false, idioma_interface: 'pt-BR' }
const office = { slug: 'conteudo', nome: 'Conteúdo e marca', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const now = new Date().toISOString()
const project = { id: 1, nome: 'Projeto de teste', office_slug: 'conteudo', objetivo: '', dados: {}, formatos: [], arquivado: false, versao: 1 }
const work = { id: 91, titulo: 'Pedido recuperado de teste', office_slug: 'conteudo', projeto_id: 1, projeto_nome: project.nome, referencia_job_id: null, favorito: false, aprovado: false, criado_em: now, estado: 'em_producao', status: 'queued', desatualizados: [], arquivos: [] }
const fixtures = [], errors = [], unexpected = []
let browser
try {
  browser = await chromium.launch({ executablePath, headless: true })
  for (const scenario of ['resposta_perdida', 'nao_confirmado', 'removido']) {
    const context = await browser.newContext({ viewport: { width: scenario === 'resposta_perdida' ? 1280 : 390, height: 844 }, locale: 'pt-BR' })
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
    let page = await context.newPage()
    await context.addInitScript(person => {
      if (location.origin === 'null') return
      localStorage.setItem('offiz_access_token', 'fixture-production')
      localStorage.setItem('offiz_usuario', JSON.stringify(person))
    }, person)
    const posts = [], recoveries = []
    let saved = null
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (!url.pathname.startsWith('/api/v1/')) {
        if (url.origin === origin) return route.continue()
        unexpected.push(request.url()); return route.abort()
      }
      const endpoint = url.pathname.slice('/api/v1'.length)
      if (request.method() === 'POST' && endpoint === '/orgs/3/producao') {
        const body = request.postDataJSON()
        assert.match(body.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        posts.push(body)
        if (posts.length === 1) {
          if (scenario !== 'nao_confirmado') saved = { id: 91, office_slug: 'conteudo', request_id: body.request_id, replayed: false }
          // Simula uma resposta interrompida. Nenhum serviço real é acionado.
          return route.abort('failed')
        }
        assert.equal(scenario, 'nao_confirmado', 'Um envio aceito nunca é repetido nesta prova')
        assert.equal(body.request_id, posts[0].request_id, 'O retry conserva a intenção')
        saved = { id: 91, office_slug: 'conteudo', request_id: body.request_id, replayed: false }
        return route.fulfill({ status: 201, json: saved })
      }
      if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 500, json: { detail: 'Escrita não prevista nesta fixture' } }) }
      if (/^\/orgs\/3\/producao\/[0-9a-f-]+$/.test(endpoint)) {
        recoveries.push(endpoint)
        assert.equal(endpoint.split('/').pop(), posts[0]?.request_id)
        if (scenario === 'removido') return route.fulfill({ status: 410, json: { detail: { code: 'producao_removida', message: 'Pedido removido' } } })
        if (!saved) return route.fulfill({ status: 404, json: { detail: 'Não encontrado' } })
        return route.fulfill({ json: { ...saved, replayed: true } })
      }
      let body
      if (endpoint === '/auth/me') body = person
      else if (endpoint === '/notificacoes') body = []
      else if (endpoint === '/predios') body = [{ org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' }]
      else if (endpoint === '/orgs/3/inicio') body = { org_id: 3, org_nome: 'Empresa simulada', org_status: 'ativa', meu_papel: 'owner', contrato_gerenciado: false, motor_modo: 'api', tem_chave: true, andares: [{ ...office, acervo_de_marca: true }], solucoes: [], outras_solucoes: [], sabatina: { estado: 'contextualizado', pergunta: 'O que vamos preparar?', opcoes: [], permite_livre: true } }
      else if (endpoint === '/predios/3/conteudo') body = { org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' }
      else if (endpoint === '/orgs/3/predio/conversas' || endpoint === '/predios/3/conteudo/conversas') body = { conversas: [] }
      else if (endpoint === '/orgs/3/contrato') body = { tipo: 'byok', vigencia: 'vigente' }
      else if (endpoint === '/orgs/3/saldo') body = { tipo: 'byok', vigencia: 'vigente', estado: 'conta_propria', periodo: now.slice(0, 7), consultado_em: now }
      else if (endpoint === '/orgs/3/projetos') body = [project]
      else if (endpoint === '/orgs/3/projetos/1/impacto') body = { itens: [], versao: 1 }
      else if (endpoint === '/orgs/3/padroes') body = []
      else if (endpoint === '/orgs/3/biblioteca') body = { itens: saved ? [work] : [], total: saved ? 1 : 0, resumo: { prontos: 0, precisa_de_voce: 0, em_producao: saved ? 1 : 0, aprovados: 0 }, atualizado_em: now }
      else if (endpoint === '/orgs/3/biblioteca/91') body = work
      else if (endpoint.endsWith('/conhecimento/canon')) body = { conteudo: '' }
      else if (endpoint.endsWith('/arquivos')) body = { entrada: [], exemplos: [], produto: [] }
      else if (endpoint.endsWith('/stats')) body = { tarefas_mes: 0, concluidas_mes: 0, rodando: false, entregas_pendentes: 0 }
      else if (endpoint.endsWith('/jobs') || endpoint.endsWith('/entregas') || endpoint.endsWith('/clientes') || endpoint.endsWith('/editorial')) body = []
      else if (endpoint.endsWith('/atividade')) body = { jobs: [] }
      else if (endpoint.endsWith('/metricas/loop')) body = { trabalhos: { total: 0, aprovados_de_primeira: 0, com_rejeicao: 0, pendentes: 0, com_devolutiva: 0, rodadas_extras: 0 }, taxa_aprovacao_primeira: null, por_tipo: [], tempo_mediano_ate_decisao_s: null, criterios_reprovados: 0 }
      else { unexpected.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 500, json: { detail: 'Endpoint sem fixture' } }) }
      return route.fulfill({ json: body })
    })
    const open = async () => page.getByRole('button', { name: 'Novo trabalho neste projeto', exact: true }).click()
    let draft = page.getByRole('textbox', { name: 'Qual resultado você precisa?', exact: true })
    await page.goto(`${origin}/app?org=3&vista=biblioteca&projeto=1`)
    await open()
    await draft.fill('Uma arte para anunciar o jogo de amanhã.')
    await page.getByRole('button', { name: 'Pode produzir', exact: true }).click()
    await page.getByRole('button', { name: 'Conferir envio', exact: true }).waitFor()
    assert.equal(posts.length, 1)
    assert.equal(await draft.inputValue(), 'Uma arte para anunciar o jogo de amanhã.')
    assert(await draft.isDisabled())
    await page.screenshot({ path: path.join(out, `${scenario}-envio-incerto.png`), fullPage: true })
    if (scenario === 'resposta_perdida') {
      // Reabre até a aba: sessionStorage deixa de existir, localStorage permanece.
      await page.close()
      page = await context.newPage()
      draft = page.getByRole('textbox', { name: 'Qual resultado você precisa?', exact: true })
      await page.goto(`${origin}/app?org=3&vista=biblioteca&projeto=1`)
      await open()
      await page.getByRole('button', { name: 'Conferir envio', exact: true }).click()
      await page.waitForURL(url => url.searchParams.get('trabalho') === '91')
      assert.equal(posts.length, 1, 'Reabrir recupera o envio aceito sem criar outro')
      assert.equal(recoveries.length, 1)
      await page.screenshot({ path: path.join(out, `${scenario}-pedido-recuperado.png`) })
    } else {
      await page.getByRole('button', { name: 'Conferir envio', exact: true }).click()
      if (scenario === 'nao_confirmado') {
        await page.getByRole('button', { name: 'Reenviar pedido', exact: true }).waitFor()
        assert.equal(posts.length, 1)
        await page.getByRole('button', { name: 'Reenviar pedido', exact: true }).click()
        await page.waitForURL(url => url.searchParams.get('trabalho') === '91')
        assert.equal(posts.length, 2)
        assert.equal(new Set(posts.map(p => p.request_id)).size, 1)
      } else {
        await page.getByText('Este pedido foi removido. Ele não será recriado ao tentar novamente.', { exact: true }).waitFor()
        assert.equal(posts.length, 1)
        await page.getByRole('button', { name: 'Preparar um novo pedido', exact: true }).click()
        assert(await draft.isEnabled())
        assert.equal(posts.length, 1, 'Preparar não envia automaticamente')
      }
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'O formulário cabe no celular')
    fixtures.push({ scenario, posts: posts.length, uniqueIntents: new Set(posts.map(p => p.request_id)).size, recoveryGETs: recoveries.length })
    await context.close()
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  console.log(JSON.stringify({ compiledUI: true, fixtureOnly: true, realProduction: 0, providerCalls: 0, fixtures, out }))
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
