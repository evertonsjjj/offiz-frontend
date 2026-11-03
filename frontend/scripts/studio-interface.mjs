/** Real built UI + synthetic API. No real account, AI charge or publication. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright-core'
import { consumoSemRegistros } from './fixtures-consumo.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.INTERFACE_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'offiz-studio-ui-'))
await fs.mkdir(out, { recursive: true })
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
const executablePath = process.env.BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : chromium.executablePath())
let browser
try {
  browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' })
  const page = await context.newPage()
  const errors = [], unexpected = [], generations = [], voiceChanges = []
  page.on('pageerror', error => errors.push(error.message))
  const now = new Date().toISOString()
  const person = { id: 11, email: 'pessoa@example.invalid', nome: 'Pessoa de teste', is_admin: false, idioma_interface: 'pt-BR' }
  const office = { slug: 'conteudo', nome: 'Conteúdo e marca', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
  const conversation = { id: 17, organization_id: 3, office_slug: null, sinal: 'precisa_de_voce', resumo: 'Esperando o seu OK', titulo: 'Campanha de segunda', atualizado_em: now, total_mensagens: 1, mensagens: [{ id: 20, role: 'assistant', conteudo: 'Preparei o plano da apresentação. Você pode conferir as cenas e o custo no Estúdio.', criado_em: now }], anexos: [] }
  const areaConversation = { ...conversation, id: 18, office_slug: 'conteudo', titulo: 'Fotos para a campanha', mensagens: [{ id: 21, role: 'assistant', conteudo: 'Esta conversa pertence à área de Conteúdo e marca.', criado_em: now }], anexos: [{ nome: 'conteudo-qa-original.png', nome_exibicao: 'original.png', origem_exibicao: 'conteudo / ensaio' }] }
  const delivered = { id: 61, titulo: 'Campanha aprovada de interface', office_slug: 'conteudo', projeto_id: null, projeto_nome: null, referencia_job_id: null, favorito: false, aprovado: true, criado_em: now, estado: 'aprovado', status: 'done', desatualizados: [], arquivos: [] }
  const conversationsFetched = []
  const messagePosts = [], jobCreations = [], libraryQueries = [], attachmentDeletes = [], attachmentUploads = []
  let pendingUpload = null
  let directFlow = false, directConversation = null
  const directJob = { id: 77, organization_id: 3, office_slug: 'conteudo', conversa_id: 17, titulo: 'Post da camisa oficial', prompt: 'Produzir o post da camisa.', effort: 'high', status: 'queued', criado_em: now }
  const production = { slug: 'apresentacao', titulo: 'Aferia — apresentação da empresa', estado: 'rascunho', cenas: [{ id: 'c1', roteiro: 'Conheça a Aferia.', ato: 'abertura' }, { id: 'c2', roteiro: 'Automatize sua rotina.', ato: 'serie' }], orcamento: { teto_usd: 5, gasto_usd: 0 } }
  let running = false
  const plan = { tem_plano: true, pode_gerar: true, custo_pendente: 1.25, orcamento: production.orcamento, referencia: { fonte: 'Identidade atual da empresa', copiei: 'Cores e tipografia', acrescentei: 'Demonstração do produto' }, cenas: [
    { id: 'c1', rotulo: 'Apresentar a Aferia', roteiro: 'Conheça a Aferia.', origem: 'acervo', custo_usd: 0, material: [{ nome: 'marca.png', existe: true }] },
    { id: 'c2', rotulo: 'Mostrar a rotina automatizada', roteiro: 'Automatize sua rotina.', origem: 'gerada', custo_usd: 1.25, material: [] },
  ], falta: [], critica: null, narracao: { texto: 'Conheça a Aferia.', porta_voz: 'Ana', vozes: [{ nome: 'Ana', pronta: true }, { nome: 'Bia', pronta: false }] } }
  await context.addInitScript(person => {
    localStorage.setItem('offiz_access_token', 'synthetic-ui-test')
    localStorage.setItem('offiz_usuario', JSON.stringify(person))
  }, person)
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/')) {
      if (url.origin === origin) return route.continue()
      unexpected.push(request.url()); return route.abort()
    }
    const endpoint = url.pathname.slice('/api/v1'.length)
    if (request.method() === 'POST' && endpoint === '/conversas/18/anexos') {
      assert(pendingUpload, 'Upload deve pertencer ao cenário sintético pendente')
      const operation = pendingUpload
      attachmentUploads.push(endpoint)
      operation.started()
      await operation.response
      return route.fulfill({ json: { nome: operation.name, legivel: true, anexos: [...areaConversation.anexos, { nome: operation.name }] } })
    }
    if (request.method() === 'DELETE' && endpoint === '/conversas/18/anexos/conteudo-qa-original.png') {
      attachmentDeletes.push(endpoint)
      areaConversation.anexos = []
      return route.fulfill({ status: 204 })
    }
    let body
    if (request.method() === 'POST' && /^\/jobs(?:\/|$)/.test(endpoint)) jobCreations.push(endpoint)
    if (endpoint === '/auth/me') body = person
    else if (endpoint === '/predios') body = [{ org_id: 3, org_nome: 'Aferia · teste de interface', office_slug: 'conteudo', office, meu_papel: 'owner', nao_lidas: 0, ultimo_job: null }]
    else if (endpoint === '/lgpd/exportar-dados') body = { perfil: person }
    else if (endpoint === '/notificacoes') body = []
    else if (endpoint === '/orgs/3/saldo' && request.method() === 'GET') body = { tipo: 'pf_gerenciado', vigencia: 'vigente', periodo: now.slice(0, 7), consultado_em: now, renovacao_em: null, estado: 'disponivel', limite_brl_mes: 120, credito_brl: 0, total_brl: 120, consumido_brl: 25, reservado_brl: 8.4, disponivel_brl: 86.6, percentual_disponivel: 86.6 / 120 * 100 }
    else if (endpoint === '/orgs/3/contrato' && request.method() === 'GET') body = { tipo: directFlow ? 'pf_gerenciado' : 'byok', vigencia: 'vigente', inicio: null, fim: null, periodo: now.slice(0, 7), servicos: ['openai'], conexoes: { openai: true }, mensalidade_brl: 120, limite_brl_mes: 120, consumido_brl: 25, reservado_brl: 8.4, disponivel_brl: 86.6 }
    else if (endpoint === '/orgs/3/inicio') body = { org_id: 3, org_nome: 'Aferia · teste de interface', org_status: 'ativa', meu_papel: 'owner', contrato_gerenciado: directFlow, motor_modo: 'api', tem_chave: true, andares: [{ slug: 'conteudo', nome: office.nome, descricao: '' }], solucoes: [], outras_solucoes: [], sabatina: { estado: 'contextualizado', pergunta: 'O que vamos preparar?', opcoes: [], permite_livre: true } }
    else if (endpoint === '/predios/3/conteudo') body = { org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' }
    else if (endpoint === '/orgs/3/predio/conversas') body = { conversas: [directConversation || conversation] }
    else if (endpoint === '/predios/3/conteudo/conversas') body = { conversas: [areaConversation] }
    else if (endpoint === '/orgs/3/biblioteca') {
      libraryQueries.push(url.search)
      const activeWork = { ...directJob, projeto_id: null, projeto_nome: null, referencia_job_id: null, favorito: false, aprovado: false, estado: 'em_producao', desatualizados: [], arquivos: [] }
      const state = url.searchParams.get('estado'), filter = url.searchParams.get('filtro'), search = (url.searchParams.get('busca') || '').toLowerCase()
      const items = (directConversation ? [delivered, activeWork] : [delivered]).filter(item => (!state || item.estado === state) && (filter !== 'aprovados' || item.aprovado) && (!search || item.titulo.toLowerCase().includes(search)))
      body = { itens: items, total: items.length, resumo: { prontos: 0, precisa_de_voce: 0, em_producao: directConversation ? 1 : 0, aprovados: 1 }, atualizado_em: now }
    }
    else if (endpoint === '/orgs/3/biblioteca/61') body = delivered
    else if (endpoint === '/orgs/3/projetos' || endpoint === '/orgs/3/padroes') body = []
    else if (endpoint === '/predios/3/conteudo/clientes') body = []
    else if (endpoint === '/conversas/17') { conversationsFetched.push(17); body = directConversation || conversation }
    else if (endpoint === '/conversas/18') { conversationsFetched.push(18); body = areaConversation }
    else if (request.method() === 'GET' && ['/conversas/17/uso', '/conversas/18/uso'].includes(endpoint)) body = consumoSemRegistros()
    else if (request.method() === 'GET' && endpoint === '/predios/3/conteudo/estudio/prontidao') body = {
      niveis: [{ nome: 'Teste', descricao: 'Estudo sintético, sem publicação.' }],
      tipos: { teste: { nome: 'Primeira peça de teste', minimo: ['Tema do teste', 'Tipo de peça e canal'], premium: ['Fatos e ativos conferidos'] } },
    }
    else if (endpoint === '/conversas/17/mensagens' && directFlow && request.method() === 'POST') {
      const message = request.postDataJSON()
      messagePosts.push({ endpoint, body: message })
      const turnTime = new Date().toISOString()
      directJob.criado_em = turnTime
      const reply = { id: 31, role: 'assistant', conteudo: 'Vou produzir o post da camisa oficial.', criado_em: turnTime,
        sugestao_tarefa: { titulo: directJob.titulo, prompt: directJob.prompt, andar: directJob.office_slug } }
      const userMessage = { id: 30, role: 'user', conteudo: message.conteudo, criado_em: turnTime }
      directConversation = { ...conversation, sinal: 'trabalhando', resumo: 'Na fila', mensagens: [...conversation.mensagens, userMessage, reply],
        total_mensagens: 3, tarefas_iniciadas: [reply.id], trabalho_job_id: directJob.id,
        trabalhos: [{ id: directJob.id, titulo: directJob.titulo, status: directJob.status, criado_em: turnTime, entregas: [] }] }
      body = { mensagem: reply, tarefas_iniciadas: directConversation.tarefas_iniciadas,
        trabalho_iniciado: { id: directJob.id, titulo: directJob.titulo, status: directJob.status, org_id: 3, office_slug: directJob.office_slug } }
    }
    else if (endpoint === '/jobs/77' && request.method() === 'GET') body = directJob
    else if (endpoint === '/jobs/77/events' && request.method() === 'GET') body = { events: [] }
    else if (endpoint === '/orgs/3/biblioteca/77' && request.method() === 'GET') body = { ...directJob, estado: 'em_producao', arquivos: [], desatualizados: [] }
    else if (endpoint.endsWith('/editorial') || endpoint.endsWith('/entregas')) body = []
    else if (endpoint.endsWith('/atividade')) body = { jobs: [] }
    else if (endpoint.endsWith('/estudio/comentarios')) body = { comentarios: [] }
    else if (endpoint.endsWith('/pecas/apresentacao/fluxo')) body = { slug: production.slug, titulo: production.titulo, estado: 'rascunho', gasto_usd: 0, teto_usd: 5, fontes: [], cenas: [], audio: {}, final: { master: '', existe: false, montagem: [] }, tem_rastro: false }
    else if (endpoint === '/predios/3/conteudo/estudio/pecas') body = { pecas: [{ ...production, cenas: 2, duracao_s: 15, gasto_usd: 0, teto_usd: 5 }] }
    else if (endpoint === '/predios/3/conteudo/estudio/pecas/apresentacao') body = { peca: production }
    else if (endpoint === '/predios/3/conteudo/estudio/pecas/apresentacao/mesa') body = { ...plan, job_ativo: running ? { id: 41, status: 'queued' } : null }
    else if (endpoint === '/predios/3/conteudo/estudio/pecas/apresentacao/narracao' && request.method() === 'PATCH') {
      const change = request.postDataJSON()
      voiceChanges.push(change)
      // Desligar remove a narração no servidor. Texto retido aqui faria a UI
      // selecionar a voz padrão e esconderia uma fixture incoerente.
      if (change.ligada === false) { plan.narracao.texto = ''; plan.narracao.porta_voz = '' }
      else if (change.porta_voz != null) plan.narracao.porta_voz = change.porta_voz
      body = { ok: true }
    }
    else if (endpoint === '/predios/3/conteudo/estudio/pecas/apresentacao/gerar' && request.method() === 'POST') { generations.push(request.postDataJSON()); running = true; body = { ok: true, job: { id: 41, status: 'queued' } } }
    else { unexpected.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 500, json: { detail: 'Endpoint sem fixture de teste' } }) }
    return route.fulfill({ json: body })
  })
  await page.goto(`${origin}/app?org=3&vista=estudio&area=conteudo`)
  await page.getByRole('textbox', { name: 'Seu pedido' }).waitFor()
  const balance = page.locator('.saldo-ia')
  await balance.locator('summary').getByText(/86,60/).waitFor()
  await balance.locator('summary').click()
  await balance.getByText('Reservado', { exact: true }).waitFor()
  assert.match(await balance.locator('.saldo-ia__valores').innerText(), /8,40/)
  await page.keyboard.press('Escape')
  assert.equal(await balance.getAttribute('open'), null)
  await page.getByText('Campanha de segunda', { exact: true }).click()
  await page.getByText(conversation.mensagens[0].conteudo, { exact: true }).waitFor()
  await page.getByRole('button', { name: /Abrir/ }).click()
  await page.getByRole('button', { name: 'Pode gerar', exact: true }).waitFor()
  const voice = page.getByRole('combobox', { name: 'Voz da narração', exact: true })
  await voice.selectOption('__voz_padrao__')
  await page.waitForFunction(() => document.querySelector('.estudio-plano-voz select')?.value === '__voz_padrao__' && !document.querySelector('.estudio-plano-voz select')?.disabled)
  await voice.selectOption('')
  await page.waitForFunction(() => document.querySelector('.estudio-plano-voz select')?.value === '' && !document.querySelector('.estudio-plano-voz select')?.disabled)
  await voice.selectOption('Ana')
  await page.waitForFunction(() => document.querySelector('.estudio-plano-voz select')?.value === 'Ana' && !document.querySelector('.estudio-plano-voz select')?.disabled)
  assert.deepEqual(voiceChanges, [{ ligada: true, porta_voz: '' }, { ligada: false }, { porta_voz: 'Ana' }])
  const details = page.locator('.estudio-detalhes-producao')
  assert.equal(await details.getAttribute('open'), null)
  await details.locator('summary').first().click()
  await page.getByRole('heading', { name: 'Roteiro, cena a cena', exact: true }).waitFor()
  await details.locator('summary').first().click()
  assert.equal(await page.getByRole('complementary', { name: 'Conversa do Estúdio', exact: true }).count(), 0)
  await page.getByText(/Ver o que será criado/).click()
  await page.screenshot({ path: path.join(out, 'offiz-plano-conversa-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Pedir ajuste no plano', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Seu pedido"]')?.value.includes('Quero mudar o plano'))
  assert.equal(await page.getByRole('textbox', { name: 'Seu pedido' }).inputValue(), 'Quero mudar o plano da peça "apresentacao": ')
  assert.equal(await page.getByRole('complementary', { name: 'Estúdio', exact: true }).count(), 1)
  await page.setViewportSize({ width: 390, height: 844 })
  const history = await page.locator('.conversa-lista').boundingBox()
  await page.screenshot({ path: path.join(out, 'offiz-plano-conversa-mobile.png'), fullPage: true })
  assert(history && history.height <= 210, 'Histórico com busca deve ocupar uma faixa compacta no celular')
  assert(await page.getByText('Esperando o seu OK', { exact: true }).isVisible(), 'Estado do pedido precisa continuar visível no celular')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Overflow horizontal no celular')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Mudar para tema escuro', exact: true }).click()
  await page.getByRole('button', { name: 'Mudar para tema claro', exact: true }).waitFor()
  await page.screenshot({ path: path.join(out, 'offiz-plano-conversa-escuro.png'), fullPage: true, animations: 'disabled' })
  assert.notEqual(await page.getByRole('button', { name: 'Pedir ajuste no plano', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)', 'Botões devem acompanhar o tema escuro')
  assert.equal(await page.getByRole('textbox', { name: 'Seu pedido' }).inputValue(), 'Quero mudar o plano da peça "apresentacao": ')
  await page.getByRole('button', { name: 'Mudar para tema claro', exact: true }).click()
  await page.getByRole('button', { name: 'Pode gerar', exact: true }).click()
  await page.getByText('Geração em andamento. Acompanhe pela conversa.', { exact: true }).waitFor()
  assert(await voice.isDisabled())
  assert.deepEqual(generations, [{ conversa_id: 17 }])
  await page.getByRole('button', { name: 'Sua conta', exact: true }).click()
  await page.getByRole('button', { name: 'Minha conta e meus dados', exact: true }).click()
  const account = page.getByRole('dialog', { name: 'Minha conta e meus dados', exact: true })
  await account.waitFor()
  const downloadPromise = page.waitForEvent('download')
  await account.getByRole('button', { name: 'Baixar meus dados', exact: true }).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), 'offiz-meus-dados.json')
  await account.getByRole('button', { name: 'Excluir minha conta', exact: true }).click()
  assert(await account.getByRole('button', { name: 'Excluir minha conta em definitivo', exact: true }).isDisabled())
  await page.screenshot({ path: path.join(out, 'offiz-conta-membro-claro.png'), fullPage: true })
  await page.keyboard.press('Escape')
  assert.equal(await account.count(), 0)
  await page.getByRole('button', { name: 'Mudar para tema escuro', exact: true }).click()
  await page.getByRole('button', { name: 'Sua conta', exact: true }).click()
  await page.getByRole('button', { name: 'Minha conta e meus dados', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await account.waitFor()
  assert.notEqual(await account.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(out, 'offiz-conta-membro-escuro-mobile.png'), fullPage: true })
  await account.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${origin}/app?org=3&conversa=17`)
  await page.getByText(conversation.mensagens[0].conteudo, { exact: true }).waitFor()
  await page.getByRole('textbox', { name: 'Seu pedido' }).fill('Quero ajustar só o título.')
  await page.getByRole('link', { name: 'Pedidos e entregas', exact: true }).click()
  await page.getByRole('heading', { name: 'Pedidos e entregas', exact: true }).waitFor()
  const librarySearch = page.getByRole('searchbox', { name: 'Buscar projetos e entregas', exact: true })
  await librarySearch.fill('Campanha')
  await page.getByRole('combobox', { name: 'Filtrar trabalhos', exact: true }).selectOption('aprovados')
  await page.getByRole('button', { name: /Campanha aprovada de interface/ }).click()
  await page.getByRole('heading', { name: delivered.titulo, exact: true }).waitFor()
  await page.screenshot({ path: path.join(out, 'offiz-pedido-desktop.png'), fullPage: true })
  await page.goBack()
  await page.getByRole('button', { name: /Campanha aprovada de interface/ }).waitFor()
  assert.equal(await librarySearch.inputValue(), 'Campanha')
  assert.equal(await page.getByRole('combobox', { name: 'Filtrar trabalhos', exact: true }).inputValue(), 'aprovados')
  await page.getByRole('button', { name: 'Conversa', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Seu pedido' }).inputValue(), 'Quero ajustar só o título.')
  await page.getByRole('link', { name: 'Pedidos e entregas', exact: true }).click()
  await librarySearch.waitFor()
  assert.equal(await librarySearch.inputValue(), 'Campanha')
  assert.equal(await page.getByRole('combobox', { name: 'Filtrar trabalhos', exact: true }).inputValue(), 'aprovados')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(out, 'offiz-pedidos-mobile.png'), fullPage: true })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.goto(`${origin}/app?org=3&slug=conteudo&conversa=18`)
  await page.getByText(areaConversation.mensagens[0].conteudo, { exact: true }).waitFor()
  await page.getByRole('link', { name: 'Abrir conversa geral da empresa', exact: true }).waitFor()
  assert.equal(await page.getByText('Campanha de segunda', { exact: true }).count(), 0)
  const areaMessage = page.getByText(areaConversation.mensagens[0].conteudo, { exact: true })
  await areaMessage.scrollIntoViewIfNeeded()
  assert(await areaMessage.evaluate(el => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    const bubble = el.closest('.conversa-bolha') || el
    return hit !== null && bubble.contains(hit)
  }), 'Campo de mensagem não pode encobrir a resposta da conversa no celular')
  await page.screenshot({ path: path.join(out, 'offiz-conversa-area-mobile.png'), fullPage: true, animations: 'disabled' })
  const areaDraft = page.getByRole('textbox', { name: 'Seu pedido', exact: true })
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await areaDraft.fill('Preserve meu pedido enquanto consulto os requisitos.')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Dois botões no cabeçalho do andar não criam rolagem horizontal')
    for (const [nome, titulo, leitura] of [
      ['Guia da peça', 'O que preciso para a primeira peça?', 'Tema do teste'],
      ['Custo do chat', 'Custo deste chat e seus trabalhos', 'Todo o chat'],
    ]) {
      const controle = page.getByRole('button', { name: nome, exact: true })
      const controleBox = await controle.boundingBox()
      assert(controleBox.height >= 44 && controleBox.width >= 44, 'Acesso ao custo e ao guia conserva alvo de 44 px')
      const altura = await page.locator('.conversa-thread').evaluate(el => el.getBoundingClientRect().height)
      await controle.focus()
      await controle.press('Enter')
      const dialogo = page.getByRole('dialog', { name: titulo, exact: true })
      await dialogo.getByText(leitura, { exact: true }).waitFor()
      const caixa = await dialogo.locator('.conversa-informacoes-caixa').boundingBox()
      assert(caixa.x >= 0 && caixa.x + caixa.width <= width && caixa.height <= 844, 'Guia e custo cabem no desktop e no celular')
      assert.equal(await page.locator('.conversa-thread').evaluate(el => el.getBoundingClientRect().height), altura, 'Consultar informação não comprime conversa do andar')
      await page.keyboard.press('Escape')
      await dialogo.waitFor({ state: 'hidden' })
      assert(await controle.evaluate(el => document.activeElement === el), 'Fechar a informação devolve foco ao botão')
      assert.equal(await areaDraft.inputValue(), 'Preserve meu pedido enquanto consulto os requisitos.')
    }
  }
  await page.getByRole('button', { name: 'Custo do chat', exact: true }).click()
  await page.getByRole('dialog', { name: 'Custo deste chat e seus trabalhos', exact: true }).waitFor()
  await page.evaluate(() => {
    history.pushState(history.state, '', '/app?org=3&slug=conteudo&conversa=nova')
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  })
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('button', { name: 'Custo do chat', exact: true }).count(), 0, 'Nova conversa não conserva o custo da anterior')
  await page.goBack()
  await areaMessage.waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0, 'Voltar ao histórico não reabre diálogo antigo')
  assert.equal(await areaDraft.inputValue(), 'Preserve meu pedido enquanto consulto os requisitos.')
  // Navegar no mesmo componente durante um upload: a URL não pode levar os
  // anexos da conversa antiga, nem deixar o novo composer preso em “enviando”.
  for (const type of ['ajuste', 'pergunta']) {
    await page.getByRole('button', { name: 'Nova conversa', exact: true }).click()
    const newDraft = `Rascunho novo de ${type}.`
    const oldDraft = `Rascunho da conversa antiga de ${type}.`
    await areaDraft.fill(newDraft)
    await page.getByRole('button', { name: /^Fotos para a campanha/ }).click()
    await areaMessage.waitFor()
    await areaDraft.fill(oldDraft)
    let release, started
    const ready = new Promise(resolve => { started = resolve })
    const response = new Promise(resolve => { release = resolve })
    pendingUpload = { name: `pendente-${type}.txt`, response, started }
    await page.getByLabel('Anexar arquivos à conversa', { exact: true }).setInputFiles({ name: pendingUpload.name, mimeType: 'text/plain', buffer: Buffer.from('fixture sintética') })
    await ready
    assert(await page.getByRole('button', { name: 'Enviar', exact: true }).isDisabled())
    const seed = type === 'ajuste' ? 'Sobre a entrega “Post da camisa”, o que eu gostaria de ajustar: ' : 'Quero entender minha marca'
    const query = type === 'ajuste' ? 'ajustepeca=Post%20da%20camisa&ajustejob=77' : 'pergunta=Quero%20entender%20minha%20marca'
    await page.evaluate(query => {
      history.pushState(history.state, '', `/app?org=3&slug=conteudo&conversa=18&${query}`)
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    }, query)
    const expected = `${newDraft}\n${seed}`
    await page.waitForFunction(value => document.querySelector('textarea[aria-label="Seu pedido"]')?.value === value, expected)
    assert.equal(new URL(page.url()).searchParams.get('conversa'), 'nova')
    assert(await page.getByRole('button', { name: 'Enviar', exact: true }).isEnabled())
    assert.equal(await page.getByRole('button', { name: /Remover original.png/ }).count(), 0)
    assert.equal(await areaMessage.count(), 0)
    const uploadDone = page.waitForResponse(response => response.url().endsWith('/conversas/18/anexos') && response.request().method() === 'POST')
    release()
    await uploadDone
    pendingUpload = null
    assert.equal(await page.getByText(`pendente-${type}.txt`, { exact: true }).count(), 0, 'Resposta atrasada deve continuar ligada à conversa antiga')
    assert.equal(await areaDraft.inputValue(), expected)
    assert(await page.getByRole('button', { name: 'Enviar', exact: true }).isEnabled())
    await page.getByRole('button', { name: /^Fotos para a campanha/ }).click()
    await areaMessage.waitFor()
    assert.equal(await areaDraft.inputValue(), oldDraft)
    await page.getByRole('button', { name: 'Nova conversa', exact: true }).click()
    assert.equal(await areaDraft.inputValue(), expected)
    if (type === 'ajuste') await page.screenshot({ path: path.join(out, 'offiz-ajuste-upload-pendente-mobile.png'), fullPage: true, animations: 'disabled' })
  }
  await page.getByRole('button', { name: /^Fotos para a campanha/ }).click()
  await areaMessage.waitFor()
  await areaDraft.fill('Quero preparar o próximo post.')
  const removeAttachment = page.getByRole('button', { name: 'Remover original.png (conteudo / ensaio) da conversa', exact: true })
  const removeBounds = await removeAttachment.boundingBox()
  assert(removeBounds.width >= 44 && removeBounds.height >= 44)
  await removeAttachment.click()
  await removeAttachment.waitFor({ state: 'detached' })
  assert.deepEqual(attachmentDeletes, ['/conversas/18/anexos/conteudo-qa-original.png'])
  assert.equal(await areaDraft.inputValue(), 'Quero preparar o próximo post.')
  await page.reload()
  await page.getByText(areaConversation.mensagens[0].conteudo, { exact: true }).waitFor()
  assert.equal(await removeAttachment.count(), 0, 'Recarga não pode restaurar o anexo já removido')
  assert.equal(await areaDraft.inputValue(), 'Quero preparar o próximo post.')
  await page.getByRole('link', { name: 'Abrir conversa geral da empresa', exact: true }).click()
  await page.getByText(conversation.mensagens[0].conteudo, { exact: true }).waitFor()
  await page.goto(`${origin}/app?org=3&conversa=999`)
  await page.getByRole('textbox', { name: 'Seu pedido' }).waitFor()
  assert(!conversationsFetched.includes(999), 'Id fora da lista autorizada não pode ser consultado')

  // A produção autorizada começa no servidor. A interface deve apenas
  // acompanhar o mesmo id, inclusive depois de recarregar, sem novo POST job.
  directFlow = true
  conversation.anexos = [{ nome: 'camisa.png', nome_exibicao: 'camisa.png' }]
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${origin}/app?org=3&conversa=17`)
  await page.getByText(conversation.mensagens[0].conteudo, { exact: true }).waitFor()
  const naturalRequest = 'Faz um post da nossa camisa para o Instagram.'
  await page.getByRole('textbox', { name: 'Seu pedido' }).fill(naturalRequest)
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  const workPanel = page.getByRole('complementary', { name: 'A entrega desta conversa', exact: true })
  await page.locator('.conversa-thread').getByText('Na fila', { exact: true }).waitFor()
  assert.equal(await workPanel.count(), 0, 'Pedido na fila deve conservar a conversa inteira, sem abrir um painel vazio')
  await page.getByRole('button', { name: 'Ver a entrega', exact: true }).click()
  await workPanel.getByText(directJob.titulo, { exact: true }).waitFor()
  await workPanel.getByText('#77', { exact: true }).waitFor()
  await page.locator('.conversa-thread').getByText('Na fila', { exact: true }).waitFor()
  await page.locator('.conversa-thread').getByText(naturalRequest, { exact: true }).waitFor()
  assert(await page.getByRole('button', { name: 'Remover camisa.png da conversa', exact: true }).isDisabled(), 'Anexo usado pelo pedido na fila não pode ser removido')
  const directThread = await page.locator('.conversa-thread').innerText()
  assert(directThread.indexOf(naturalRequest) < directThread.indexOf('Vou produzir o post da camisa oficial.'), 'Pedido deve aparecer antes da resposta do escritório')
  assert(directThread.indexOf('Vou produzir o post da camisa oficial.') < directThread.indexOf(directJob.titulo), 'Cartão de acompanhamento deve aparecer depois da resposta')
  assert.equal(await page.getByRole('button', { name: 'Sim, iniciar tarefa', exact: true }).count(), 0)
  assert.deepEqual(messagePosts, [{ endpoint: '/conversas/17/mensagens', body: { conteudo: naturalRequest } }])
  assert.deepEqual(jobCreations, [], 'Início direto não pode criar outro job no frontend')
  await page.screenshot({ path: path.join(out, 'offiz-inicio-direto-desktop.png'), fullPage: true, animations: 'disabled' })
  await page.reload()
  await page.locator('.conversa-thread').getByText('Na fila', { exact: true }).waitFor()
  assert.equal(await workPanel.count(), 0, 'Recarregar um pedido na fila conserva o vínculo sem abrir a prévia vazia')
  await page.getByRole('button', { name: 'Ver a entrega', exact: true }).click()
  await workPanel.getByText('#77', { exact: true }).waitFor()
  await page.locator('.conversa-thread').getByText(naturalRequest, { exact: true }).waitFor()
  await page.locator('.conversa-thread').getByText('Na fila', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Sim, iniciar tarefa', exact: true }).count(), 0, 'Recarga não pode ressuscitar confirmação de um trabalho iniciado')
  assert.equal(messagePosts.length, 1, 'Recarga não pode reenviar a mensagem')
  assert.deepEqual(jobCreations, [])
  await page.setViewportSize({ width: 390, height: 844 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Produção iniciada deve caber no celular')
  await page.screenshot({ path: path.join(out, 'offiz-inicio-direto-mobile.png'), fullPage: true, animations: 'disabled' })

  // Compatibilidade dos links de ajuste: um assunto antigo na URL não pode
  // restaurar seu histórico por cima da nova mensagem de ajuste.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${origin}/app?org=3&conversa=17&ajustepeca=Post%20da%20camisa&ajustejob=77`)
  const adjustmentSeed = 'Sobre a entrega “Post da camisa”, o que eu gostaria de ajustar: '
  await page.waitForFunction(seed => document.querySelector('textarea[aria-label="Seu pedido"]')?.value === seed, adjustmentSeed)
  assert.equal(new URL(page.url()).searchParams.get('conversa'), 'nova')
  assert.equal(new URL(page.url()).searchParams.has('ajustepeca'), false)
  assert.equal(await page.locator('.conversa-thread').getByText(naturalRequest, { exact: true }).count(), 0)
  assert.equal(messagePosts.length, 1, 'Abrir um ajuste somente prepara o pedido')
  await page.screenshot({ path: path.join(out, 'offiz-ajuste-assunto-novo.png'), fullPage: true, animations: 'disabled' })

  // Ao escolher um estado específico, a lista não pode herdar uma busca,
  // formato, paginação ou aba de padrões que esconda os pedidos desse estado.
  await page.goto(`${origin}/app?org=3&conversa=nova&busca-pedidos=inexistente&filtro-pedidos=arquivados&formato-pedidos=pdf&versoes-pedidos=1&pagina-pedidos=2&biblioteca-aba=padroes&projeto=8&trabalho=61`)
  await page.getByRole('button', { name: /O Offiz está cuidando/ }).click()
  await page.getByRole('searchbox', { name: 'Buscar projetos e entregas', exact: true }).waitFor()
  const target = new URL(page.url()).searchParams
  assert.equal(target.get('vista'), 'biblioteca')
  assert.equal(target.get('estado'), 'em_producao')
  for (const key of ['busca-pedidos', 'filtro-pedidos', 'formato-pedidos', 'versoes-pedidos', 'pagina-pedidos', 'biblioteca-aba', 'projeto', 'trabalho']) assert.equal(target.has(key), false, `Atalho deve limpar ${key}`)
  assert.equal(await page.getByRole('searchbox', { name: 'Buscar projetos e entregas', exact: true }).inputValue(), '')
  assert.equal(await page.getByRole('button', { name: 'Todos os pedidos', exact: true }).getAttribute('aria-current'), 'page')
  assert(libraryQueries.some(search => { const q = new URLSearchParams(search); return q.get('estado') === 'em_producao' && q.get('busca') === '' && q.get('filtro') === 'todos' && q.get('formato') === '' && q.get('offset') === '0' }), 'Biblioteca deve consultar o estado selecionado sem filtros incompatíveis')
  assert.equal(messagePosts.length, 1)
  assert.deepEqual(jobCreations, [])
  await page.screenshot({ path: path.join(out, 'offiz-atalho-estado-limpo.png'), fullPage: true, animations: 'disabled' })
  assert.deepEqual(errors, [])
  assert.deepEqual(unexpected, [])
  assert.equal(attachmentUploads.length, 2)
  console.log(JSON.stringify({ builtUI: true, syntheticAPI: true, conversationId: 17, memberDataExport: true, singleChat: true, responsive: true, directProduction: { messagePosts: messagePosts.length, jobPosts: jobCreations.length, panelJobId: directJob.id, reload: true }, attachmentRemoval: { exactDelete: attachmentDeletes.length === 1, draftPreserved: true, reload: true, productionBlocked: true, mobileTouchTarget: true }, navigation: ['company', 'area', 'library', 'detail', 'back', 'draft', 'filters', 'unauthorizedId', 'legacyAdjustmentNewTopic', 'adjustmentAndQuestionDuringUpload', 'stateShortcutClearsFilters'], themes: ['light', 'dark'], out }))
} catch (error) {
  const page = browser?.contexts()[0]?.pages().find(p => p.url().startsWith(origin))
  if (page) {
    await page.screenshot({ path: path.join(out, 'offiz-interface-falha.png'), fullPage: true })
    console.error(JSON.stringify({ url: page.url(), visible: (await page.locator('body').innerText()).slice(0, 2200) }))
  }
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
