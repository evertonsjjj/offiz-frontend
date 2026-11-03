/** Janela de conversa compilada, cenários simulados, navegador headless isolado. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright-core'
import { consumoSemRegistros } from './fixtures-consumo.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.INTERFACE_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'offiz-conversa-layout-'))
const baseline = process.env.INTERFACE_QA_BASELINE === '1'
await fs.mkdir(out, { recursive: true })
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
const person = { id: 11, email: 'fixture@example.invalid', nome: 'Conta simulada', is_admin: false, idioma_interface: 'pt-BR' }
const office = { slug: 'conteudo', nome: 'Conteúdo e marca', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const now = new Date().toISOString()
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#20232b"/><rect x="90" y="90" width="900" height="1170" fill="#e9e9ed"/><text x="135" y="190" font-family="sans-serif" font-size="48" fill="#20232b">PRÉVIA SIMULADA</text></svg>'
const errors = [], unexpected = [], writes = [], results = []
let browser
try {
  const executablePath = process.env.BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : chromium.executablePath())
  browser = await chromium.launch({ executablePath, headless: true })
  const fixturePage = await browser.newPage()
  const pngs = await fixturePage.evaluate(() => Array.from({ length: 5 }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = i === 4 ? 600 : 1080; canvas.height = i === 4 ? 2000 : 1350
    const ctx = canvas.getContext('2d'); ctx.fillStyle = ['#152d49', '#1e493d', '#583629', '#423457', '#35404f'][i]; ctx.fillRect(0, 0, 1080, 1350)
    ctx.fillStyle = '#eee'; ctx.fillRect(60, 60, 960, 1230); ctx.fillStyle = '#222'; ctx.font = '56px sans-serif'; ctx.fillText(`PÁGINA SIMULADA ${i + 1}`, 120, 200)
    return canvas.toDataURL('image/png').split(',')[1]
  }))
  await fixturePage.close()
  for (const width of [1344, 1280, 390]) for (const state of ['empty', 'running', 'delivered', 'carousel']) {
    const height = width >= 901 ? 812 : 844
    const context = await browser.newContext({ viewport: { width, height }, locale: 'pt-BR', recordVideo: { dir: path.join(out, 'compiled-videos'), size: { width, height } } })
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.addInitScript(person => {
      localStorage.setItem('offiz_access_token', 'fixture-conversa-layout')
      localStorage.setItem('offiz_usuario', JSON.stringify(person))
    }, person)
    const done = state === 'delivered' || state === 'carousel', status = done ? 'done' : 'running'
    const job = { id: 91, organization_id: 3, office_slug: 'conteudo', conversa_id: 42, usuario_id: 11, titulo: 'Chamada do próximo jogo', prompt: 'Faz a chamada do jogo. Preciso de post e story.', status, effort: 'high', criado_em: now, iniciado_em: now, finalizado_em: done ? now : null }
    const names = state === 'carousel' ? ['post.html', 'card-01.png', 'card-02.png', 'card-03.png', 'card-04.png', 'card-05.png', 'legenda.docx', 'fontes.pdf', 'projeto.svg'] : ['post.html', 'feed-editavel.svg', 'feed.png', 'story.png', 'legenda.docx', 'campanha.pdf']
    const files = done ? (state === 'carousel' ? [1] : [1, 2]).flatMap(post => names.map((nome, index) => ({ id: 301 + (post - 1) * 6 + index, job_id: 91, organization_id: 3, office_slug: 'conteudo', editorial_peca_id: post, nome, caminho_rel: `outputs/post-${post}/${nome}`, tamanho_bytes: Buffer.from(pngs[0], 'base64').length, mime: nome.endsWith('.png') ? 'image/png' : nome.endsWith('.svg') ? 'image/svg+xml' : undefined, tipo: nome.endsWith('.png') ? 'imagem' : 'arquivo', status: 'pendente', criado_em: now }))) : []
    const conversation = { id: 42, organization_id: 3, office_slug: null, titulo: 'Chamada do próximo jogo', sinal: done ? 'entregue' : 'trabalhando', resumo: done ? 'Entrega disponível' : 'Em produção', atualizado_em: now, total_mensagens: 2, trabalho_job_id: 91,
      mensagens: [{ id: 1, role: 'user', conteudo: 'Faz a chamada do jogo com essas fotos. Preciso de post e story.', criado_em: now }, { id: 2, role: 'assistant', conteudo: done ? 'O post e o story estão prontos. Você pode revisar as peças aqui ao lado.' : 'Vou preparar a chamada usando as fotos do acervo e conferir as informações da partida.', criado_em: now }],
      anexos: Array.from({ length: 8 }, (_, i) => ({ nome: `fonte-${i + 1}.jpg`, nome_exibicao: `fotografia-do-acervo-com-identificacao-completa-${i + 1}.jpg`, origem_exibicao: `conteudo / fotos históricas / coleção ${i + 1}`, legivel: true })),
      trabalhos: [{ ...job, entregas: files }],
    }
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
      if (/^\/entregas\/\d+\/(conteudo|preview|miniatura|download|leitura)$/.test(endpoint)) {
        const file = files.find(f => f.id === Number(endpoint.split('/')[2]))
        assert(file, 'Só arquivos da entrega simulada são acessíveis')
        if (file.nome.endsWith('.png')) {
          const index = /^card-(\d+)\.png$/.exec(file.nome)?.[1] || 1
          return route.fulfill({ contentType: 'image/png', body: Buffer.from(pngs[Number(index) - 1], 'base64') })
        }
        if (file.nome.endsWith('.docx')) return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: 'Legenda de apoio simulada, sem produção real.' })
        if (file.nome.endsWith('.html')) return route.fulfill({ contentType: 'text/html', body: '<html><body>Post simulado de apoio</body></html>' })
        if (file.nome.endsWith('.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: svg })
        return route.fulfill({ contentType: 'application/octet-stream', body: 'arquivo simulado' })
      }
      let body
      if (endpoint === '/auth/me') body = person
      else if (endpoint === '/notificacoes') body = []
      else if (endpoint === '/predios') body = [{ org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' }]
      else if (endpoint === '/orgs/3/inicio') body = { org_id: 3, org_nome: 'Clube simulado', org_status: 'ativa', meu_papel: 'owner', contrato_gerenciado: false, motor_modo: 'api', tem_chave: true, andares: [{ ...office, acervo_de_marca: true }], solucoes: [], outras_solucoes: [], sabatina: { estado: 'contextualizado', pergunta: 'O que vamos preparar?', opcoes: [], permite_livre: true } }
      else if (endpoint === '/orgs/3/predio/conversas' || endpoint === '/predios/3/conteudo/conversas') body = { conversas: state === 'empty' ? [] : [conversation] }
      else if (endpoint === '/conversas/42') body = conversation
      else if (endpoint === '/conversas/42/uso') body = consumoSemRegistros()
      else if (endpoint === '/orgs/3/contrato') body = { tipo: 'byok', vigencia: 'vigente' }
      else if (endpoint === '/orgs/3/saldo') body = { tipo: 'byok', vigencia: 'vigente', estado: 'conta_propria', periodo: now.slice(0, 7), consultado_em: now, renovacao_em: null, limite_brl_mes: null, credito_brl: null, total_brl: null, consumido_brl: null, reservado_brl: null, disponivel_brl: null, percentual_disponivel: null }
      else if (endpoint === '/predios/3/conteudo') body = { org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' }
      else if (endpoint === '/predios/3/conteudo/partida') body = { tem_motor: true, tem_chave: true, motor_local: false, sabatina_pendente: false, perfil_estado: 'contextualizado' }
      else if (endpoint === '/orgs/3/projetos' || endpoint === '/orgs/3/padroes') body = []
      else if (endpoint === '/orgs/3/biblioteca') body = { itens: [], total: 0, resumo: { prontos: 0, precisa_de_voce: 0, em_producao: state === 'running' ? 1 : 0, aprovados: 0 }, atualizado_em: now }
      else if (endpoint === '/orgs/3/biblioteca/91') body = { ...job, arquivos: files, devolutivas: [], pecas_editoriais: [{ id: 1, titulo: 'Chamada para a torcida' }, { id: 2, titulo: 'Informações da partida' }], qualidade: { estado: 'nao_conferido', avisos: [], revisao_automatica: { estado: 'em_fila' } } }
      else if (endpoint === '/jobs/91') body = job
      else if (endpoint === '/jobs/91/events') body = { events: [] }
      else if (endpoint.endsWith('/conhecimento/canon')) body = { conteudo: '' }
      else if (endpoint.endsWith('/arquivos')) body = { produto: [], marca: [], exemplos: [] }
      else if (endpoint.endsWith('/stats')) body = { tarefas_mes: 1, concluidas_mes: done ? 1 : 0, rodando: state === 'running', entregas_pendentes: files.length }
      else if (endpoint.endsWith('/atividade')) body = { jobs: state === 'running' ? [job] : [] }
      else if (endpoint.endsWith('/jobs')) body = state === 'empty' ? [] : [job]
      else if (endpoint.endsWith('/entregas')) body = files
      else if (endpoint.endsWith('/clientes') || endpoint.endsWith('/editorial')) body = []
      else if (endpoint.endsWith('/metricas/loop')) body = { trabalhos: { total: 1, aprovados_de_primeira: 0, com_rejeicao: 0, pendentes: files.length, com_devolutiva: 0, rodadas_extras: 0 }, taxa_aprovacao_primeira: null, por_tipo: [], tempo_mediano_ate_decisao_s: null, criterios_reprovados: 0 }
      else { unexpected.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 500, json: { detail: 'Endpoint sem fixture' } }) }
      return route.fulfill({ json: body })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${origin}/app?org=3&conversa=${state === 'empty' ? 'nova' : 42}&vista=conversa`)
    const draft = page.getByRole('textbox', { name: 'Seu pedido', exact: true })
    await draft.waitFor()
    if (done) await page.getByRole('complementary', { name: 'A entrega desta conversa', exact: true }).waitFor()
    if (state === 'running') assert.equal(await page.locator('.painel-trabalho').count(), 0, 'Produção sem arquivos não abre coluna vazia')
    if (done) await page.locator('.painel-trabalho .resultado-entrega__img').waitFor()
    await page.evaluate(() => document.fonts.ready)
    const measure = () => page.evaluate(() => {
      const rect = selector => { const e = document.querySelector(selector); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, width: r.width, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight } }
      return { panel: rect('.conversa-painel'), thread: rect('.conversa-thread'), composer: rect('.conversa-composer'), textarea: rect('.composer-textarea'), attachments: rect('.conversa-anexos'), footer: rect('.conversa-composer-rodape'), send: rect('.conversa-composer-rodape > button'), delivery: rect('.painel-trabalho'), preview: rect('.painel-trabalho .resultado-entrega__img'), previewBox: rect('.painel-peca-previa'), deliveryActions: rect('.painel-trabalho-decisoes'), horizontalOverflow: document.documentElement.scrollWidth > innerWidth }
    })
    const initial = await measure()
    assert.equal(initial.horizontalOverflow, false)
    if (!baseline && width >= 901) {
      assert(initial.send.bottom <= height - 12, 'Enviar permanece dentro da janela')
      if (state !== 'empty') assert(initial.thread.height >= 220, 'Conversa e atividade recebem espaço de leitura')
      assert(initial.composer.height < 230, 'Pedido curto com oito anexos não toma metade da janela')
      if (done) {
        const visiblePreview = Math.min(initial.preview.bottom, initial.delivery.bottom) - Math.max(initial.preview.top, initial.delivery.top)
        assert(visiblePreview >= 180, 'A imagem tem espaço real para revisão na primeira dobra da entrega')
        assert(initial.preview.top >= initial.previewBox.top && initial.preview.bottom <= initial.previewBox.bottom + 1, 'A imagem inteira cabe na linha reservada, sem recorte por margens herdadas')
        assert(initial.preview.bottom <= initial.deliveryActions.top, 'As ações não cobrem parte da imagem')
        if (state === 'carousel') assert.equal(await page.getByRole('combobox', { name: 'Arquivo em exibição' }).inputValue(), '302')
        else assert.equal(await page.getByRole('tab', { name: 'feed', exact: true }).getAttribute('aria-selected'), 'true')
      }
    }
    await page.screenshot({ path: path.join(out, `conversa-${width}-${state}.png`), fullPage: true, animations: 'disabled' })
    if (state !== 'empty') {
      await draft.fill('Rascunho preservado ao conferir o custo.')
      const custo = page.getByRole('button', { name: 'Custo do chat', exact: true })
      await custo.focus()
      await custo.press('Enter')
      const dialogo = page.getByRole('dialog', { name: 'Custo deste chat e seus trabalhos', exact: true })
      await dialogo.getByRole('cell', { name: 'Todo o chat', exact: true }).waitFor()
      const durante = await measure()
      assert(Math.abs(durante.thread.height - initial.thread.height) <= 1, 'Abrir consumo preserva o espaço da conversa')
      assert(Math.abs(durante.composer.height - initial.composer.height) <= 1, 'Abrir consumo preserva o compositor')
      const caixa = await dialogo.locator('.conversa-informacoes-caixa').boundingBox()
      assert(caixa.x >= 0 && caixa.x + caixa.width <= width && caixa.height <= height, 'Relatório cabe no desktop e no celular')
      await page.keyboard.press('Escape')
      await dialogo.waitFor({ state: 'hidden' })
      assert(await custo.evaluate(el => document.activeElement === el), 'Fechar o relatório devolve foco ao botão')
      assert.equal(await draft.inputValue(), 'Rascunho preservado ao conferir o custo.')
      await draft.fill('')
    }
    if (state === 'running' && width >= 901) {
      // Native ResizeObserver proof: only synthetic layout growth, not agent
      // events or a real production. Mutating height exercises the live hook.
      await page.getByRole('button', { name: 'Ver atividade', exact: true }).waitFor()
      await draft.fill('Meu rascunho continua aqui.')
      await draft.focus()
      await page.evaluate(() => { document.querySelector('.atividade-chat').style.minHeight = '600px' })
      await page.waitForFunction(() => { const el = document.querySelector('.conversa-thread'); return el.scrollHeight - el.clientHeight - el.scrollTop <= 2 })
      assert(await draft.evaluate(el => document.activeElement === el), 'Crescimento da atividade não desvia o foco de quem escreve')
      await page.evaluate(() => { const el = document.querySelector('.conversa-thread'); el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
      await page.evaluate(() => { document.querySelector('.atividade-chat').style.minHeight = '1000px' })
      const acompanhar = page.getByRole('button', { name: 'Ver nova atividade', exact: true })
      await acompanhar.waitFor()
      assert.equal(await page.locator('.conversa-thread').evaluate(el => el.scrollTop), 0, 'Pessoa lendo acima conserva o scroll')
      assert.equal(await draft.inputValue(), 'Meu rascunho continua aqui.')
      const box = await acompanhar.boundingBox()
      assert(box.height >= 44, 'Controle para retomar o acompanhamento permanece acessível')
      await acompanhar.click()
      await page.waitForFunction(() => { const el = document.querySelector('.conversa-thread'); return el.scrollHeight - el.clientHeight - el.scrollTop <= 2 })
      await page.evaluate(() => { document.querySelector('.atividade-chat').style.minHeight = '' })
      await draft.fill('')
      results.push({ width, height, state: 'native-resize-growth', syntheticLayoutOnly: true, followedWhileAtEnd: true, preservedReadingAbove: true, draftAndTypingFocusPreserved: true, explicitResume: true })
    }
    if (state === 'carousel') {
      const seletor = page.getByRole('combobox', { name: 'Arquivo em exibição' })
      assert.equal(await seletor.locator('option').count(), 9)
      assert.equal(await page.getByRole('tablist', { name: 'Arquivos desta entrega' }).count(), 0)
      for (const control of [seletor, page.getByRole('button', { name: 'Imagem anterior', exact: true }), page.getByRole('button', { name: 'Próxima imagem', exact: true })]) {
        const box = await control.boundingBox()
        assert(box.height >= 44 && box.width >= 44, 'Seletor e navegação conservam alvos de 44 px')
      }
      await page.getByRole('button', { name: 'Próxima imagem', exact: true }).click()
      await page.getByAltText('card-02.png', { exact: true }).waitFor()
      assert.equal(await seletor.inputValue(), '303')
      await draft.fill('Meu ajuste ainda não enviado.')
      await page.evaluate(() => window.dispatchEvent(new Event('offiz:entregas-mudou')))
      assert.equal(await seletor.inputValue(), '303', 'Refresh mantém a página escolhida')
      assert.equal(await draft.inputValue(), 'Meu ajuste ainda não enviado.')
      for (const id of ['302', '306']) {
        await seletor.selectOption(id)
        const ampliar = page.getByRole('button', { name: 'Ampliar imagem', exact: true })
        await ampliar.click()
        const dialogo = page.getByRole('dialog')
        await dialogo.waitFor()
        await page.waitForFunction(() => document.querySelector('dialog img')?.naturalHeight > 0)
        const fit = await dialogo.evaluate(el => {
          const img = el.querySelector('img'), region = el.querySelector('[role="region"]')
          const a = img.getBoundingClientRect(), b = region.getBoundingClientRect()
          return { image: { top: a.top, bottom: a.bottom, left: a.left, right: a.right, height: a.height, width: a.width },
            body: { top: b.top, bottom: b.bottom, left: b.left, right: b.right }, scrollHeight: region.scrollHeight, clientHeight: region.clientHeight, scrollWidth: region.scrollWidth, clientWidth: region.clientWidth,
            naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }
        })
        await fs.writeFile(path.join(out, `modal-${width}-${id}-facts.json`), JSON.stringify(fit, null, 2))
        await page.screenshot({ path: path.join(out, `conversa-${width}-carousel-fit-${id}.png`), animations: 'disabled' })
        assert(fit.image.top >= fit.body.top - 1 && fit.image.bottom <= fit.body.bottom + 1, 'Modal começa com a imagem inteira na altura')
        assert(fit.image.left >= fit.body.left - 1 && fit.image.right <= fit.body.right + 1, 'Modal começa com a imagem inteira na largura')
        assert(fit.scrollHeight <= fit.clientHeight + 1 && fit.scrollWidth <= fit.clientWidth + 1, 'Fit inicial não exige rolar')
        assert(Math.abs(fit.image.width / fit.image.height - fit.naturalWidth / fit.naturalHeight) < .01, 'Fit conserva a proporção da imagem')
        await page.getByRole('button', { name: 'Ver detalhes', exact: true }).click()
        assert(await dialogo.locator('.resultado-entrega__ampliada-corpo--detalhes').count() === 1)
        await page.getByRole('button', { name: 'Ver imagem inteira', exact: true }).click()
        await page.keyboard.press('Escape')
        assert.equal(await page.getByRole('dialog').count(), 0)
        assert.equal(await ampliar.evaluate(el => document.activeElement === el), true, 'Fechar retorna ao controle que abriu')
        results.push({ width, height, state: `modal-${id}`, ...fit })
      }
      await seletor.selectOption('307')
      await page.getByRole('article', { name: 'legenda.docx' }).waitFor()
      assert.equal(await page.getByLabel('Sequência do carrossel', { exact: true }).count(), 0, 'Apoio não participa da sequência de imagens')
      await page.evaluate(() => window.dispatchEvent(new Event('offiz:entregas-mudou')))
      assert.equal(await seletor.inputValue(), '307')
      await seletor.selectOption('302')
      await page.getByAltText('card-01.png', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Pedir ajuste neste post', exact: true }).click()
      assert((await draft.inputValue()).startsWith('Meu ajuste ainda não enviado.'), 'Ajuste acrescenta referência sem apagar o texto próprio')
      await draft.fill('')
    }
    if (!baseline) {
      const long = Array.from({ length: 15 }, (_, i) => `Linha ${i + 1}: quero um ajuste no enquadramento e na legenda.`).join('\n')
      await draft.fill(long)
      const expanded = await measure()
      assert(expanded.textarea.height <= 162 && expanded.textarea.height > initial.textarea.height, 'O campo cresce com limite e mantém o texto completo')
      assert.equal(await draft.inputValue(), long)
      await draft.fill('Pode deixar o título um pouco menor?')
      const short = await measure()
      assert(short.textarea.height < expanded.textarea.height, 'Apagar texto devolve espaço à conversa')
      await draft.fill('Primeira linha\nSegunda linha\nTerceira linha\nQuarta linha')
      await draft.evaluate(element => { element.style.height = '52px' })
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.composer-textarea')).overflowY === 'auto')
      const manual = await measure()
      assert(manual.textarea.height <= initial.textarea.height + 2, 'Resize manual menor é preservado')
      assert(manual.textarea.scrollHeight > manual.textarea.clientHeight, 'Texto maior que a altura manual continua rolável')
      await draft.fill('')
      if (state !== 'empty') {
        const attachments = page.getByLabel('Arquivos anexados à conversa', { exact: true })
        await attachments.focus()
        await page.keyboard.press('End')
        await page.waitForFunction(() => document.querySelector('.conversa-anexos').scrollTop > 0)
        assert(await attachments.evaluate(element => element.scrollTop > 0), 'Os anexos usados pelo trabalho permanecem alcançáveis pelo teclado')
        await draft.focus()
      }
      if (width >= 901 && state !== 'empty') {
        await page.getByRole('button', { name: 'Enviar', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: 'Escreva sua mensagem antes de enviar' }).waitFor()
        const localError = await measure()
        assert(localError.send.bottom <= height - 12 && localError.thread.height >= 160, `Uma validação local não esconde Enviar nem toda a conversa: ${JSON.stringify({ width, state, thread: localError.thread, send: localError.send })}`)
        await draft.fill('Pode deixar o título um pouco menor?')
        assert.equal(await page.getByRole('alert').count(), 0, 'Digitar um pedido válido resolve só a validação local')
        await draft.fill('')
        if (!done) await page.getByRole('button', { name: 'Ver aqui do lado', exact: true }).click()
        await page.getByRole('complementary', { name: 'A entrega desta conversa', exact: true }).getByRole('button', { name: 'Voltar à conversa', exact: true }).click()
        const closed = await measure()
        assert(closed.send.bottom <= height - 12, 'Fechar a entrega não empurra o pedido abaixo da janela')
        assert(closed.thread.height >= 220)
        await page.screenshot({ path: path.join(out, `conversa-${width}-${state}-painel-fechado.png`), animations: 'disabled' })
      }
      if (width === 390) {
        await draft.scrollIntoViewIfNeeded()
        assert(await draft.isVisible())
        assert(await page.getByRole('button', { name: 'Enviar', exact: true }).isVisible())
        const mobile = await measure()
        assert(mobile.send.bottom <= height - 8, 'O pedido e Enviar cabem juntos na janela mobile ao chegar ao campo')
        await page.screenshot({ path: path.join(out, `conversa-${width}-${state}-pedido.png`), animations: 'disabled' })
      }
    }
    results.push({ width, height, state, ...initial })
    await context.close()
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.deepEqual(writes, [])
  const receipt = { compiledUI: true, syntheticAPI: true, headless: true, baseline, results, writes: 0, providerCalls: 0, externalRequests: 0, out }
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(receipt))
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
