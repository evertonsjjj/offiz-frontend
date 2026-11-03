/** Built UI with original synthetic image/video files. No account or AI calls. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright-core'
import { consumoSemRegistros } from './fixtures-consumo.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.INTERFACE_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'offiz-deliveries-ui-'))
await fs.mkdir(out, { recursive: true })
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
const executablePath = process.env.BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : chromium.executablePath())
let browser
try {
  browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' })
  const page = await context.newPage()
  const errors = [], unexpected = [], writes = [], downloads = [], thumbnails = [], archiveReads = []
  page.on('pageerror', error => errors.push(error.message))
  // Original pixels and a decodable vertical video, created only for UI QA.
  const media = await page.evaluate(async () => {
    const compactImages = []
    const images = [1, 2, 3, 4].map(numero => {
      const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = numero % 2 ? '#172a41' : '#ece5d5'; ctx.fillRect(0, 0, 1080, 1350)
      ctx.fillStyle = numero % 2 ? '#fff' : '#172a41'; ctx.font = 'bold 88px sans-serif'
      ctx.fillText(`IMAGEM ${numero}`, 80, 220)
      ctx.font = '40px sans-serif'; ctx.fillText('Material sintético para conferir a interface.', 80, 340)
      ctx.font = '24px sans-serif'; ctx.fillText('Texto pequeno que exige conferir o arquivo original.', 80, 440)
      const compact = document.createElement('canvas'); compact.width = 154; compact.height = 192
      compact.getContext('2d').drawImage(canvas, 0, 0, compact.width, compact.height)
      compactImages.push(compact.toDataURL('image/jpeg', .78).split(',')[1])
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 640
    const ctx = canvas.getContext('2d'), stream = canvas.captureStream(12)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }), chunks = []
    let frame = 0
    const draw = () => { ctx.fillStyle = frame++ % 2 ? '#0066cc' : '#172a41'; ctx.fillRect(0, 0, 360, 640); ctx.fillStyle = '#fff'; ctx.font = '30px sans-serif'; ctx.fillText('VÍDEO DE TESTE', 45, 310) }
    const finished = new Promise(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = resolve })
    draw()
    const compact = document.createElement('canvas'); compact.width = 108; compact.height = 192
    compact.getContext('2d').drawImage(canvas, 0, 0, compact.width, compact.height)
    const compactVideo = compact.toDataURL('image/jpeg', .78).split(',')[1]
    recorder.start(); const timer = setInterval(draw, 85)
    await new Promise(resolve => setTimeout(resolve, 1300)); recorder.stop(); clearInterval(timer); stream.getTracks().forEach(track => track.stop()); await finished
    const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' })) })
    return { images, compactImages, compactVideo, video: data.split(',')[1] }
  })
  const now = new Date().toISOString()
  const person = { id: 11, email: 'qa@example.invalid', nome: 'Pessoa de teste', is_admin: false, idioma_interface: 'pt-BR' }
  const office = { slug: 'conteudo', nome: 'Conteúdo e marca', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
  const image = (id, numero) => ({ id, job_id: 61, nome: `card-${String(numero).padStart(2, '0')}.png`, mime: 'image/png', tamanho_bytes: Buffer.from(media.images[numero - 1], 'base64').length, status: 'aprovada', tipo: 'arquivo' })
  const baseWork = { organization_id: 3, org_id: 3, office_slug: 'conteudo', projeto_id: null, projeto_nome: null, referencia_job_id: null, favorito: false, aprovado: true, criado_em: now, estado: 'aprovado', status: 'done', desatualizados: [], qualidade: { estado: 'conferida', avisos: [], conferencias: [], atualizado_em: now } }
  const carousel = { ...baseWork, id: 61, titulo: 'Carrossel de teste — sequência original', arquivos: [image(103, 3), { id: 104, job_id: 61, nome: 'post.html', mime: 'text/html', status: 'aprovada', tipo: 'arquivo' }, image(101, 1), image(102, 2)], versoes_anteriores: [{ id: 60, titulo: 'Versão anterior preservada', criado_em: now }] }
  const previous = { ...baseWork, id: 60, titulo: 'Versão anterior preservada', arquivos: [{ ...image(301, 1), job_id: 60, nome: 'arte-anterior.png' }] }
  const video = { ...baseWork, aprovado: false, estado: 'pronto', id: 62, titulo: 'Vídeo vertical de teste', arquivos: [{ id: 201, job_id: 62, nome: 'video-vertical.webm', mime: 'video/webm', tamanho_bytes: Buffer.from(media.video, 'base64').length, status: 'pendente', tipo: 'arquivo' }] }
  const editorial = { ...baseWork, id: 63, titulo: 'Post editorial de teste', pecas_editoriais: [{ id: 9, titulo: 'Tema editorial de teste' }], arquivos: [
    { id: 401, job_id: 63, editorial_peca_id: 9, nome: 'post.html', mime: 'text/html', status: 'aprovada', tipo: 'arquivo' },
    { ...image(402, 4), job_id: 63, editorial_peca_id: 9, nome: 'arte.png' },
    { id: 403, job_id: 63, editorial_peca_id: 9, nome: 'legenda.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', status: 'aprovada', tipo: 'arquivo' },
  ] }
  // Metadata advertises a large file; the same small, original QA video lets
  // this test prove the explicit load decision without transferring 16 MiB.
  const largeVideo = { ...baseWork, id: 64, titulo: 'Vídeo grande de teste', arquivos: [{ ...video.arquivos[0], id: 501, job_id: 64, nome: 'video-grande.webm', tamanho_bytes: 16 * 1024 * 1024, status: 'aprovada' }] }
  const conversation = { id: 17, organization_id: 3, office_slug: null, sinal: 'entregue', resumo: 'Entrega pronta', titulo: 'Pedido do carrossel', atualizado_em: now, total_mensagens: 1, mensagens: [{ id: 20, role: 'assistant', conteudo: 'Os três cards estão prontos para conferir.', criado_em: now }], anexos: [], trabalho_job_id: 61, trabalhos: [{ id: 61, titulo: carousel.titulo, status: 'done', criado_em: now, entregas: carousel.arquivos }] }
  const linkedConversation = (id, work) => ({ ...conversation, id, titulo: work.titulo, mensagens: [{ ...conversation.mensagens[0], id: id + 20, conteudo: 'A peça está pronta para conferir.' }], trabalho_job_id: work.id, trabalhos: [{ id: work.id, titulo: work.titulo, status: 'done', criado_em: now, entregas: work.arquivos }] })
  const conversations = [conversation, linkedConversation(18, editorial), linkedConversation(19, video), linkedConversation(20, largeVideo)]
  const works = [carousel, previous, video, editorial, largeVideo]
  for (const work of works) {
    const source = conversations.find(item => item.trabalho_job_id === work.id) || (work.id === previous.id ? conversation : null)
    Object.assign(work, { conversa_id: source?.id ?? null, conversa_titulo: source?.titulo ?? null, conversa_office_slug: source?.office_slug ?? null })
  }
  let failPreviewOnceId = null
  await context.addInitScript(person => { if (window !== window.top) return; localStorage.setItem('offiz_access_token', 'synthetic-ui-test'); localStorage.setItem('offiz_usuario', JSON.stringify(person)) }, person)
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/')) { if (url.origin === origin) return route.continue(); unexpected.push(request.url()); return route.abort() }
    const endpoint = url.pathname.slice('/api/v1'.length)
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 500, json: { detail: 'QA não executa escrita.' } }) }
    const archiveOriginal = '/predios/3/conteudo/arquivos/produto/original.png'
    if (endpoint === archiveOriginal || endpoint === `${archiveOriginal}/miniatura`) {
      assert.equal(url.searchParams.get('sub'), 'ensaio', 'archive source preserves its collection')
      assert.equal(request.headers().authorization, 'Bearer synthetic-ui-test', 'archive media remains authenticated')
      if (endpoint.endsWith('/miniatura')) {
        thumbnails.push(endpoint)
        return route.fulfill({ body: Buffer.from(media.compactImages[0], 'base64'), contentType: 'image/jpeg', headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
      }
      archiveReads.push(endpoint)
      return route.fulfill({ body: Buffer.from(media.images[0], 'base64'), contentType: 'image/png' })
    }
    if (/^\/entregas\/\d+\/miniatura$/.test(endpoint)) {
      assert.equal(request.headers().authorization, 'Bearer synthetic-ui-test', 'delivery thumbnails remain authenticated')
      const id = Number(endpoint.split('/')[2])
      const index = id === 101 || id === 301 ? 0 : id === 102 ? 1 : id === 103 ? 2 : id === 402 ? 3 : -1
      const body = index >= 0 ? media.compactImages[index] : id === 201 || id === 501 ? media.compactVideo : null
      assert(body, `thumbnail fixture must correspond to an actual raster/video: ${endpoint}`)
      thumbnails.push(endpoint)
      return route.fulfill({ body: Buffer.from(body, 'base64'), contentType: 'image/jpeg', headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
    }
    if (/^\/entregas\/\d+\/download$/.test(endpoint)) {
      downloads.push(endpoint)
      const id = Number(endpoint.split('/')[2])
      if (id === failPreviewOnceId) { failPreviewOnceId = null; return route.fulfill({ status: 503, json: { detail: 'Falha sintética de prévia.' } }) }
      const index = id === 101 || id === 301 ? 0 : id === 102 ? 1 : id === 103 ? 2 : id === 402 ? 3 : -1
      if (index >= 0) return route.fulfill({ body: Buffer.from(media.images[index], 'base64'), contentType: 'image/png' })
      if (id === 201 || id === 501) return route.fulfill({ body: Buffer.from(media.video, 'base64'), contentType: 'video/webm' })
      if (id === 104 || id === 401) return route.fulfill({ body: '<!doctype html><h1>Visão da sequência</h1><p>Legenda do material sintético.</p>', contentType: 'text/html' })
    }
    if (endpoint === '/entregas/403/leitura') return route.fulfill({ body: '# Legenda do post\nTexto sintético para conferir a leitura.', contentType: 'text/plain' })
    let body
    if (endpoint === '/auth/me') body = person
    else if (endpoint === '/predios') body = [{ org_id: 3, org_nome: 'Cliente de teste de interface', office_slug: 'conteudo', office, meu_papel: 'owner', nao_lidas: 0, ultimo_job: null }]
    else if (endpoint === '/predios/3/conteudo') body = { org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' }
    else if (endpoint === '/notificacoes') body = []
    else if (endpoint === '/orgs/3/saldo') body = { tipo: 'pf_gerenciado', vigencia: 'vigente', periodo: now.slice(0, 7), consultado_em: now, renovacao_em: null, estado: 'disponivel', limite_brl_mes: 120, credito_brl: 0, total_brl: 120, consumido_brl: 25, reservado_brl: 0, disponivel_brl: 95, percentual_disponivel: 95 / 120 * 100 }
    else if (endpoint === '/orgs/3/contrato') body = { tipo: 'pf_gerenciado', vigencia: 'vigente', inicio: null, fim: null, periodo: now.slice(0, 7), servicos: ['openai'], conexoes: { openai: true }, mensalidade_brl: 120, limite_brl_mes: 120, consumido_brl: 25, reservado_brl: 0, disponivel_brl: 95 }
    else if (endpoint === '/orgs/3/inicio') body = { org_id: 3, org_nome: 'Cliente de teste de interface', org_status: 'ativa', meu_papel: 'owner', contrato_gerenciado: true, motor_modo: 'api', tem_chave: true, andares: [{ slug: 'conteudo', nome: office.nome, descricao: '', acervo_de_marca: true }], solucoes: [], outras_solucoes: [], sabatina: { estado: 'contextualizado', pergunta: 'O que vamos preparar?', opcoes: [], permite_livre: true } }
    else if (endpoint === '/orgs/3/predio/conversas') body = { conversas: conversations }
    else if (endpoint === '/predios/3/conteudo/conversas') body = { conversas: [] }
    else if (endpoint === '/predios/3/conteudo/arquivos') body = { entrada: [], exemplos: [], aprovados: [], marca: [], produto: [{ nome: 'original.png', sub: 'ensaio', tamanho_bytes: Buffer.from(media.images[0], 'base64').length, legenda: 'Imagem original de teste', tags: ['QA'] }] }
    else if (/^\/conversas\/\d+$/.test(endpoint)) body = conversations.find(item => item.id === Number(endpoint.split('/')[2]))
    else if (request.method() === 'GET' && /^\/conversas\/\d+\/uso$/.test(endpoint)) {
      assert(conversations.some(item => item.id === Number(endpoint.split('/')[2])), 'Consumo somente de conversa desta fixture')
      body = consumoSemRegistros()
    }
    else if (/^\/jobs\/\d+$/.test(endpoint)) body = works.find(item => item.id === Number(endpoint.split('/')[2]))
    else if (/^\/jobs\/\d+\/events$/.test(endpoint)) body = { events: [] }
    else if (/^\/orgs\/3\/biblioteca\/\d+$/.test(endpoint)) body = works.find(item => item.id === Number(endpoint.split('/')[4]))
    else if (endpoint === '/orgs/3/biblioteca') {
      const estado = url.searchParams.get('estado')
      const itens = (url.searchParams.get('versoes') === 'true' ? [carousel, previous, video] : [carousel, video]).filter(item => !estado || item.estado === estado)
      body = { itens, total: itens.length, resumo: { prontos: 1, precisa_de_voce: 0, em_producao: 0, aprovados: 1 }, atualizado_em: now }
    }
    else if (endpoint === '/orgs/3/projetos' || endpoint === '/orgs/3/padroes' || endpoint.endsWith('/editorial') || endpoint.endsWith('/entregas')) body = []
    else if (endpoint.endsWith('/atividade')) body = { jobs: [] }
    else { unexpected.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 500, json: { detail: 'Endpoint sem fixture de teste.' } }) }
    return route.fulfill({ json: body })
  })
  const loaded = alt => page.getByAltText(alt).waitFor().then(() => page.waitForFunction(alt => [...document.images].some(img => img.alt === alt && img.naturalWidth > 0), alt))
  const reachableControl = async (control, name) => {
    await control.scrollIntoViewIfNeeded()
    const visible = await control.evaluate(el => {
      const box = el.getBoundingClientRect()
      let left = Math.max(0, box.left), top = Math.max(0, box.top), right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom)
      for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect()
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
      }
      const hits = [.15, .5, .85].flatMap(y => [.15, .5, .85].map(x => {
        const uppermost = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y)
        return uppermost === el || el.contains(uppermost)
      }))
      return { width: box.width, height: box.height, visibleWidth: Math.max(0, right - left), visibleHeight: Math.max(0, bottom - top), unobscured: hits.every(Boolean) }
    })
    assert(visible.height >= 44, `${name}: readable control height, got ${visible.height}`)
    assert(visible.visibleHeight >= visible.height - 2 && visible.visibleWidth >= visible.width - 2, `${name}: fully reachable without clipping ${JSON.stringify(visible)}`)
    assert(visible.unobscured, `${name}: not covered by another element ${JSON.stringify(visible)}`)
    return visible
  }
  await page.goto(`${origin}/app?org=3&vista=biblioteca&trabalho=61`)
  await loaded('card-01.png')
  await page.getByText('Imagem 1 de 3', { exact: true }).waitFor()
  assert.deepEqual(await page.locator('.biblioteca-arquivos button').allTextContents(), ['post.html', 'card-01.png', 'card-02.png', 'card-03.png'])
  await page.locator('.saldo-ia__valor').getByText(/95,00/).waitFor()
  assert.equal(await page.locator('.biblioteca-previa iframe').count(), 0)
  await page.getByRole('button', { name: 'Próxima imagem', exact: true }).click()
  await loaded('card-02.png')
  await page.getByRole('button', { name: 'Próxima imagem', exact: true }).click()
  await loaded('card-03.png')
  assert(await page.getByRole('button', { name: 'Próxima imagem', exact: true }).isDisabled())
  await page.screenshot({ path: path.join(out, 'offiz-carrossel-original-desktop.png'), fullPage: true })
  const beforeWidth = await page.getByAltText('card-03.png').evaluate(img => {
    const box = img.getBoundingClientRect()
    return Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight) * img.naturalWidth
  })
  const transfers = downloads.length
  await page.getByRole('button', { name: 'Ampliar imagem', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Imagem ampliada: card-03.png', exact: true })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Ver detalhes', exact: true }).waitFor()
  assert((await dialog.getByAltText('card-03.png').boundingBox()).width > beforeWidth)
  assert.equal(downloads.length, transfers)
  assert(await dialog.locator('.resultado-entrega__ampliada-corpo').evaluate(el => {
    const image = el.querySelector('img').getBoundingClientRect(), body = el.getBoundingClientRect()
    return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1
      && image.top >= body.top - 1 && image.bottom <= body.bottom + 1
      && image.left >= body.left - 1 && image.right <= body.right + 1
  }), 'Ampliação inicial encaixa a imagem inteira, sem exigir rolagem')
  await dialog.getByRole('button', { name: 'Ver detalhes', exact: true }).click()
  assert.equal((await dialog.getByAltText('card-03.png').boundingBox()).width, 1080)
  assert(await dialog.locator('.resultado-entrega__ampliada-corpo').evaluate(el => el.scrollHeight > el.clientHeight), 'Rolagem dos pixels originais só começa por escolha explícita')
  await dialog.getByRole('button', { name: 'Ver imagem inteira', exact: true }).click()
  await page.screenshot({ path: path.join(out, 'offiz-imagem-ampliada-desktop.png') })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert(await page.getByRole('button', { name: 'Ampliar imagem', exact: true }).evaluate(el => document.activeElement === el))
  const imageDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).click()
  const downloadedImage = await imageDownload
  assert.equal(downloadedImage.suggestedFilename(), 'card-03.png')
  assert.deepEqual(await fs.readFile(await downloadedImage.path()), Buffer.from(media.images[2], 'base64'))
  await page.getByText('Projeto e versões anteriores', { exact: true }).click()
  await page.getByRole('button', { name: /Versão anterior preservada/ }).click()
  await loaded('arte-anterior.png')
  assert.match(page.url(), /trabalho=60/)
  assert.equal(await page.getByAltText('card-03.png').count(), 0)
  await page.goBack(); await loaded('card-03.png')
  assert.match(page.url(), /trabalho=61/)
  assert.match(page.url(), /arquivo=103/)
  await page.getByRole('button', { name: 'card-01.png', exact: true }).click()
  await loaded('card-01.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(out, 'offiz-carrossel-original-mobile.png'), fullPage: true })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.getByRole('button', { name: 'Ampliar imagem', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Ver detalhes', exact: true }).waitFor()
  const close = page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }), rect = await close.boundingBox()
  assert(rect.y >= 0 && rect.y + rect.height <= 844 && rect.height >= 44)
  await page.screenshot({ path: path.join(out, 'offiz-imagem-ampliada-mobile.png') })
  const mobileDialog = page.getByRole('dialog'), detailTransfers = downloads.length
  const imageSource = await mobileDialog.getByAltText('card-01.png').getAttribute('src')
  await mobileDialog.getByRole('button', { name: 'Ver detalhes', exact: true }).click()
  const detailRegion = mobileDialog.getByRole('region', { name: 'Detalhes de card-01.png', exact: true })
  assert.equal((await mobileDialog.getByAltText('card-01.png').boundingBox()).width, 1080)
  assert(await detailRegion.evaluate(el => el.scrollWidth > el.clientWidth && el.scrollHeight > el.clientHeight))
  await detailRegion.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.querySelector('.resultado-entrega__ampliada [role="region"]').scrollLeft > 0)
  await detailRegion.evaluate(el => { el.scrollTop = 280 })
  const detailCloseRect = await close.boundingBox()
  assert(detailCloseRect.y >= 0 && detailCloseRect.y + detailCloseRect.height <= 844)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(out, 'offiz-imagem-detalhes-mobile.png') })
  await mobileDialog.getByRole('button', { name: 'Ver imagem inteira', exact: true }).click()
  const overview = mobileDialog.getByRole('region', { name: 'Imagem de card-01.png', exact: true })
  assert(await overview.evaluate(el => el.scrollLeft === 0 && el.scrollTop === 0))
  assert((await mobileDialog.getByAltText('card-01.png').boundingBox()).width <= await overview.evaluate(el => el.clientWidth))
  assert.equal(await mobileDialog.getByAltText('card-01.png').getAttribute('src'), imageSource)
  await mobileDialog.getByRole('button', { name: 'Ver detalhes', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await mobileDialog.getByRole('button', { name: 'Ver imagem inteira', exact: true }).click()
  assert.equal(await mobileDialog.getByRole('button', { name: 'Ver detalhes', exact: true }).count(), 1, 'Retrato ainda reduzido na altura mantém o zoom disponível')
  assert(await mobileDialog.getByRole('button', { name: 'Ver detalhes', exact: true }).evaluate(el => el === document.activeElement), 'Alternar fit mantém o foco no mesmo controle de zoom')
  assert.equal(downloads.length, detailTransfers)
  await page.setViewportSize({ width: 390, height: 844 })
  await close.click()
  await page.goto(`${origin}/app?org=3&vista=biblioteca&trabalho=62`)
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  const player = page.locator('video')
  assert(await player.evaluate(el => el.controls && !el.autoplay && el.videoWidth === 360 && el.videoHeight === 640))
  await player.evaluate(el => el.play())
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > .25)
  await player.evaluate(el => el.pause())
  const videoBox = await player.boundingBox()
  assert(videoBox.width <= 390 && videoBox.height > videoBox.width)
  await page.screenshot({ path: path.join(out, 'offiz-video-original-mobile.png'), fullPage: true })
  const videoDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).click()
  const downloadedVideo = await videoDownload
  assert.equal(downloadedVideo.suggestedFilename(), 'video-vertical.webm')
  assert.deepEqual(await fs.readFile(await downloadedVideo.path()), Buffer.from(media.video, 'base64'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${origin}/app?org=3&conversa=17`)
  await loaded('card-01.png')
  await page.getByText('Imagem 1 de 3', { exact: true }).waitFor()
  assert.deepEqual(await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.title)), ['card-01.png', 'card-02.png', 'card-03.png', 'post.html'])
  await page.getByRole('button', { name: 'Próxima imagem', exact: true }).click(); await loaded('card-02.png')
  assert.match(page.url(), /conversa=17/)
  await page.screenshot({ path: path.join(out, 'offiz-carrossel-na-conversa-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Ampliar imagem', exact: true }).click()
  await page.getByRole('dialog', { name: 'Imagem ampliada: card-02.png', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'post · HTML', exact: true }).click()
  await page.locator('iframe[title="post.html"]').waitFor()
  assert.equal(await page.getByLabel('Sequência do carrossel', { exact: true }).count(), 0)

  const layouts = []
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 900 }, { width: 1138, height: 884 }, { width: 901, height: 884 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const specimen of [{ conversation: 18, name: 'arte.png', type: 'editorial' }, { conversation: 19, name: 'video-vertical.webm', type: 'video' }]) {
      await page.goto(`${origin}/app?org=3&conversa=${specimen.conversation}`)
      const panel = page.getByRole('complementary', { name: 'A entrega desta conversa', exact: true })
      await panel.waitFor()
      const preview = specimen.type === 'video' ? panel.locator('video') : panel.getByAltText(specimen.name)
      if (specimen.type === 'video') await page.waitForFunction(() => document.querySelector('.painel-trabalho video')?.readyState >= 2)
      else await loaded(specimen.name)
      // An editorial delivery opens the actual artwork; HTML and its caption
      // remain explicit formats, rather than replacing the visual result.
      if (specimen.type === 'editorial') {
        assert.equal(await panel.locator('iframe').count(), 0)
        assert.deepEqual(await panel.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.title).sort()), ['arte.png', 'legenda.docx', 'post.html'])
        assert(await panel.getByRole('tab', { name: 'Arte', exact: true }).getAttribute('aria-selected') === 'true')
      } else {
        assert.equal(await panel.getByRole('button', { name: 'Pedir ajuste', exact: true }).count(), 1)
        assert.equal(await panel.getByRole('button', { name: 'Baixar todos os arquivos', exact: true }).count(), 0)
      }
      const dimensions = await preview.evaluate(el => {
        const box = el.getBoundingClientRect(), area = el.closest('.painel-trabalho').getBoundingClientRect()
        const style = getComputedStyle(el)
        return { width: box.width, height: box.height, x: box.x, y: box.y, bottom: box.bottom, panelLeft: area.left, panelRight: area.right,
          naturalWidth: el.naturalWidth || el.videoWidth, naturalHeight: el.naturalHeight || el.videoHeight, objectFit: style.objectFit }
      })
      assert(dimensions.width > 0 && dimensions.height > 0, `${specimen.type}: visible media`)
      assert(dimensions.x >= dimensions.panelLeft && dimensions.x + dimensions.width <= dimensions.panelRight + 1, `${specimen.type}: contained media width`)
      assert(dimensions.height < viewport.height / 2, `${specimen.type}: inline media leaves room for decisions`)
      const ratio = dimensions.naturalWidth / dimensions.naturalHeight
      assert(dimensions.objectFit === 'contain' || Math.abs(dimensions.width / dimensions.height - ratio) < .01, `${specimen.type}: original aspect ratio`)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${viewport.width}: no horizontal page overflow`)
      const closePanel = panel.getByRole('button', { name: 'Voltar à conversa', exact: true })
      const closeBox = await closePanel.boundingBox()
      assert(closeBox.height >= 44 && closeBox.width >= 44, 'panel close is touch accessible')
      const composer = page.locator('.conversa-composer')
      await composer.waitFor()
      const lastDecision = specimen.type === 'video' ? panel.getByRole('button', { name: 'Está bom — aprovar', exact: true }) : panel.getByRole('button', { name: 'Baixar todos os arquivos', exact: true })
      await lastDecision.waitFor()
      const composerBox = await composer.boundingBox(), sendBox = await composer.getByRole('button', { name: 'Enviar', exact: true }).boundingBox()
      const panelBox = await panel.boundingBox(), footerBox = await panel.locator('footer').boundingBox(), pageSize = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight }))
      if (viewport.width === 1138 || viewport.width === 901) {
        await fs.writeFile(path.join(out, `delivery-${specimen.type}-${viewport.width}-before-check.json`), JSON.stringify({ viewport, media: dimensions, panel: panelBox, footer: footerBox, composer: composerBox, send: sendBox, page: pageSize }, null, 2))
        await page.screenshot({ path: path.join(out, `offiz-${specimen.type}-${viewport.width}-before-check.png`) })
      }
      if (viewport.width > 900) {
        assert(composerBox.y >= 0 && composerBox.y + composerBox.height <= viewport.height, `${viewport.width}: composer remains in the first viewport`)
        assert(sendBox.y >= 0 && sendBox.y + sendBox.height <= viewport.height, `${viewport.width}: send remains accessible`)
      } else {
        assert(await panel.evaluate(el => el.scrollHeight <= el.clientHeight + 2), 'mobile delivery does not require a second vertical scroll area')
      }
      const controlVisibility = []
      if (viewport.width === 1138 || viewport.width === 901) {
        const history = page.getByRole('complementary', { name: 'Suas conversas', exact: true })
        const search = history.getByRole('searchbox', { name: 'Buscar conversa', exact: true })
        await search.waitFor()
        const searchBox = await search.boundingBox()
        assert(searchBox.width >= 80 && searchBox.height > 0 && searchBox.y >= 0 && searchBox.y + searchBox.height <= viewport.height, `${viewport.width}: conversation search appears in the sidebar`)
        assert(await search.evaluate(el => {
          const box = el.getBoundingClientRect(), uppermost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
          return uppermost === el || el.contains(uppermost)
        }), `${viewport.width}: conversation search is not obscured`)
        assert.equal(await history.locator('.conversa-item').count(), conversations.length)
        for (const card of await history.locator('.conversa-item').all()) controlVisibility.push({ name: await card.locator('.conversa-item-titulo').textContent(), ...await reachableControl(card, `${viewport.width}: history conversation card`) })
      }
      if (specimen.type === 'editorial') {
        for (const tab of await panel.getByRole('tab').all()) controlVisibility.push({ name: await tab.getAttribute('title'), ...await reachableControl(tab, `${viewport.width}: format tab`) })
        controlVisibility.push({ name: 'Ampliar imagem', ...await reachableControl(panel.getByRole('button', { name: 'Ampliar imagem', exact: true }), `${viewport.width}: enlarge image`) })
      }
      // This scroll only reveals a decision; the test never approves or sends.
      controlVisibility.push({ name: 'Final decision', ...await reachableControl(lastDecision, `${viewport.width}: final decision`) })
      const decisionBox = await lastDecision.boundingBox()
      assert(decisionBox.y >= 0 && decisionBox.y + decisionBox.height <= viewport.height, 'last delivery action remains reachable')
      const finalAction = specimen.type === 'video' ? panel.getByRole('button', { name: 'Pedir ajuste', exact: true }) : panel.getByRole('button', { name: 'Pedir ajuste neste post', exact: true })
      await finalAction.click()
      const draft = composer.locator('textarea')
      assert.match(await draft.inputValue(), new RegExp(specimen.name.replace('.', '\\.')))
      await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA')
      assert(await draft.evaluate(el => el === document.activeElement), 'adjustment focuses the composer without submitting')
      assert.match(page.url(), new RegExp(`conversa=${specimen.conversation}(?:&|$)`))
      await draft.fill('')
      const selectedDownload = page.waitForEvent('download')
      await panel.getByRole('button', { name: 'Baixar', exact: true }).click()
      const original = await selectedDownload
      assert.equal(original.suggestedFilename(), specimen.name)
      assert.deepEqual(await fs.readFile(await original.path()), Buffer.from(specimen.type === 'video' ? media.video : media.images[3], 'base64'))
      await page.evaluate(() => window.scrollTo(0, 0))
      await panel.evaluate(el => { el.scrollTop = 0 })
      await page.screenshot({ path: path.join(out, `offiz-${specimen.type}-na-conversa-${viewport.width}.png`), fullPage: viewport.width <= 900 })
      await draft.fill('Rascunho para continuar a conversa sem enviar.')
      await closePanel.click()
      await panel.waitFor({ state: 'detached' })
      const conversation = page.getByRole('region', { name: 'Conversa atual', exact: true })
      assert(await conversation.evaluate(el => el.contains(document.activeElement) && document.activeElement?.tagName !== 'TEXTAREA'), 'return identifies the conversation without opening the editing keyboard')
      assert.equal(await draft.inputValue(), 'Rascunho para continuar a conversa sem enviar.')
      const returned = await conversation.getByRole('heading', { level: 1 }).boundingBox()
      assert(returned.y >= 0 && returned.y + returned.height <= viewport.height, 'return reveals the conversation title')
      assert.match(page.url(), new RegExp(`conversa=${specimen.conversation}(?:&|$)`))
      assert(await page.getByRole('button', { name: 'Ver a entrega', exact: true }).isVisible())
      await page.screenshot({ path: path.join(out, `offiz-voltar-conversa-${specimen.type}-${viewport.width}.png`) })
      layouts.push({ ...viewport, type: specimen.type, originalRatio: true, composerInFirstViewport: viewport.width > 900, finalDecisionReachable: true, adjustmentDraftOnly: true, originalDownload: true, media: dimensions, panel: panelBox, footer: footerBox, composer: composerBox, send: sendBox, decisionAfterScroll: decisionBox, controls: controlVisibility, page: pageSize })
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${origin}/app?org=3&conversa=20`)
  const largePanel = page.getByRole('complementary', { name: 'A entrega desta conversa', exact: true })
  const loadLarge = largePanel.getByRole('button', { name: /Abrir prévia de vídeo/ })
  await loadLarge.waitFor()
  assert.equal(downloads.filter(endpoint => endpoint === '/entregas/501/download').length, 0)
  assert.equal(await largePanel.locator('video').count(), 0)
  await page.screenshot({ path: path.join(out, 'offiz-video-grande-espera-clique.png') })
  await loadLarge.click()
  await page.waitForFunction(() => document.querySelector('.painel-trabalho video')?.readyState >= 2)
  assert.equal(downloads.filter(endpoint => endpoint === '/entregas/501/download').length, 1)
  const largeDownload = page.waitForEvent('download')
  await largePanel.getByRole('button', { name: 'Baixar', exact: true }).click()
  const downloadedLarge = await largeDownload
  assert.equal(downloadedLarge.suggestedFilename(), 'video-grande.webm')
  assert.deepEqual(await fs.readFile(await downloadedLarge.path()), Buffer.from(media.video, 'base64'))
  await largePanel.getByRole('button', { name: 'Voltar à conversa', exact: true }).click()
  await largePanel.waitFor({ state: 'detached' })
  assert.match(page.url(), /conversa=20/)

  // A network failure must remain legible and recoverable in the dark theme.
  // Reuse the original QA video; neither retry nor download starts a job.
  await page.setViewportSize({ width: 1138, height: 884 })
  await page.goto(`${origin}/app?org=3&conversa=20`)
  await page.getByRole('button', { name: 'Mudar para tema escuro', exact: true }).click()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  await loadLarge.waitFor()
  failPreviewOnceId = 501
  await loadLarge.click()
  const failure = largePanel.getByRole('alert')
  await failure.waitFor()
  assert.match(await failure.textContent(), /Não consegui mostrar o resultado aqui.*Baixar/)
  const retry = largePanel.getByRole('button', { name: 'Tentar novamente', exact: true })
  const retryVisibility = await reachableControl(retry, 'Dark preview retry')
  const textContrast = async locator => locator.evaluate(el => {
    const rgb = value => value.match(/[\d.]+/g)?.map(Number) || []
    const blend = (foreground, background) => foreground.slice(0, 3).map((value, i) => value * (foreground[3] ?? 1) + background[i] * (1 - (foreground[3] ?? 1)))
    const luminance = color => color.slice(0, 3).map(value => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4 }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
    const ancestry = []; for (let parent = el; parent; parent = parent.parentElement) ancestry.unshift(parent)
    let background = [255, 255, 255]
    for (const parent of ancestry) { const color = rgb(getComputedStyle(parent).backgroundColor); if (color.length >= 3) background = blend(color, background) }
    const foreground = blend(rgb(getComputedStyle(el).color), background), a = luminance(foreground), b = luminance(background)
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
  })
  const failureContrast = await textContrast(failure), retryContrast = await textContrast(retry)
  assert(failureContrast >= 4.5, 'Dark preview failure text remains readable')
  assert(retryContrast >= 4.5, 'Dark preview retry text remains readable')
  await page.screenshot({ path: path.join(out, 'offiz-video-erro-escuro-regressao.png') })
  const fallbackDownload = page.waitForEvent('download')
  await largePanel.getByRole('button', { name: 'Baixar', exact: true }).click()
  const originalAfterFailure = await fallbackDownload
  assert.equal(originalAfterFailure.suggestedFilename(), 'video-grande.webm')
  assert.deepEqual(await fs.readFile(await originalAfterFailure.path()), Buffer.from(media.video, 'base64'))
  assert(await failure.isVisible(), 'Downloading does not silently dismiss the preview failure')
  await retry.click()
  await page.waitForFunction(() => document.querySelector('.painel-trabalho video')?.readyState >= 2)
  assert.equal(await largePanel.getByRole('alert').count(), 0)
  assert(await largePanel.locator('video').evaluate(el => el.controls && !el.autoplay && el.videoWidth === 360 && el.videoHeight === 640))
  await page.screenshot({ path: path.join(out, 'offiz-video-recuperado-escuro.png') })
  const darkRetry = { recovered: true, failureContrast, retryContrast, retryVisibility, originalDownloadAfterFailure: true }
  await page.getByRole('button', { name: 'Mudar para tema claro', exact: true }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}/app?org=3&vista=acervo&area=conteudo`)
  const archiveSearch = page.getByRole('textbox', { name: 'Buscar no acervo', exact: true })
  await archiveSearch.fill('original')
  const archiveSource = page.getByRole('button', { name: 'Ver ensaio/original.png', exact: true })
  await archiveSource.waitFor()
  assert.equal(await archiveSource.textContent(), 'original', 'archive displays the readable name instead of its storage path')
  await page.waitForFunction(() => [...document.querySelectorAll('.acv-thumb img')].some(img => img.naturalWidth > 0 && Math.max(img.naturalWidth, img.naturalHeight) <= 192))
  assert.equal(archiveReads.length, 0, 'archive listing fetches no original before opening it')
  assert(thumbnails.includes('/predios/3/conteudo/arquivos/produto/original.png/miniatura'), 'archive listing displays the compact endpoint')
  await archiveSource.click()
  const archiveDialog = page.getByRole('dialog', { name: 'ensaio/original.png', exact: true })
  await archiveDialog.waitFor()
  await page.waitForFunction(() => document.querySelector('.acv-luz img')?.naturalWidth === 1080)
  assert.equal(archiveReads.length, 1, 'opening the archive preview reads the actual original once')
  assert(await archiveDialog.evaluate(el => el.matches(':modal')))
  const archiveClose = archiveDialog.getByRole('button', { name: 'Fechar', exact: true })
  assert(await archiveClose.evaluate(el => document.activeElement === el))
  // A prévia nativa impede o foco no campo atrás, além de fechar com Esc.
  await archiveSearch.evaluate(el => el.focus())
  assert(await archiveClose.evaluate(el => document.activeElement === el))
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press('Tab')
    assert(await archiveDialog.evaluate(el => el.contains(document.activeElement) || document.activeElement === document.body))
  }
  const archiveCloseBox = await archiveClose.boundingBox()
  assert(archiveCloseBox.y >= 0 && archiveCloseBox.y + archiveCloseBox.height <= 844 && archiveCloseBox.height >= 44 && archiveCloseBox.width >= 44)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(out, 'offiz-acervo-previa-mobile.png') })
  await page.keyboard.press('Escape')
  await archiveDialog.waitFor({ state: 'detached' })
  assert(await archiveSource.evaluate(el => document.activeElement === el))
  assert.equal(await archiveSearch.inputValue(), 'original')
  // O fechamento continua alcançável quando a pessoa vira o celular.
  await page.setViewportSize({ width: 844, height: 390 })
  await archiveSource.click(); await archiveDialog.waitFor()
  const landscapeClose = await archiveClose.boundingBox()
  assert(landscapeClose.y >= 0 && landscapeClose.y + landscapeClose.height <= 390)
  await page.screenshot({ path: path.join(out, 'offiz-acervo-previa-landscape.png') })
  await archiveClose.click(); await archiveDialog.waitFor({ state: 'detached' })
  assert(await archiveSource.evaluate(el => document.activeElement === el))
  await page.setViewportSize({ width: 390, height: 844 })
  const originalTransfersBeforeList = downloads.length
  await page.goto(`${origin}/app?org=3&vista=biblioteca&estado=pronto`)
  const statusFilters = page.getByRole('group', { name: 'Situação dos pedidos', exact: true })
  await statusFilters.waitFor()
  assert.equal(await statusFilters.getByRole('button', { name: 'Para revisar', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: /Vídeo vertical de teste/ }).waitFor()
  assert.equal(await page.getByRole('button', { name: /Carrossel de teste — sequência original/ }).count(), 0)
  for (const name of ['Todas', 'Para revisar', 'Em produção', 'Precisa de você', 'Limpar filtros']) {
    await reachableControl(statusFilters.getByRole('button', { name, exact: true }), `Status filter ${name}`)
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(out, 'offiz-pedidos-situacao-mobile.png'), fullPage: true })
  await statusFilters.getByRole('button', { name: 'Em produção', exact: true }).click()
  await page.getByText('Nenhum trabalho com esses filtros', { exact: true }).waitFor()
  assert.match(page.url(), /estado=em_producao/)
  await statusFilters.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await page.getByRole('button', { name: /Carrossel de teste — sequência original/ }).waitFor()
  assert.equal(new URL(page.url()).searchParams.has('estado'), false)
  const carouselGroup = page.getByRole('region', { name: 'Pedido do carrossel', exact: true })
  const videoGroup = page.getByRole('region', { name: 'Vídeo vertical de teste', exact: true })
  await carouselGroup.waitFor(); await videoGroup.waitFor()
  assert.equal(await carouselGroup.locator('.biblioteca-trabalho').count(), 1)
  assert.equal(await videoGroup.locator('.biblioteca-trabalho').count(), 1)
  assert.equal(await carouselGroup.getByRole('link', { name: 'Ver conversa', exact: true }).getAttribute('href'), '/app?org=3&conversa=17&vista=conversa')
  const includeVersions = page.getByRole('checkbox', { name: 'Incluir versões anteriores', exact: true })
  await includeVersions.click()
  await page.waitForFunction(() => document.querySelector('.biblioteca-opcoes-lista input[type="checkbox"]')?.checked === true)
  assert.equal(new URL(page.url()).searchParams.get('versoes-pedidos'), '1')
  await carouselGroup.getByRole('button', { name: /Versão anterior preservada/ }).waitFor()
  assert.equal(await carouselGroup.locator('.biblioteca-trabalho').count(), 2, 'both versions retain the same originating conversation')
  assert.equal(await page.locator('.biblioteca-conversa-grupo').count(), 2)
  assert.equal(await page.getByRole('region', { name: 'Sem conversa vinculada', exact: true }).count(), 0)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  for (const card of await page.locator('.biblioteca-trabalho').all()) {
    await card.scrollIntoViewIfNeeded()
    await card.locator('.biblioteca-miniatura img').waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.biblioteca-miniatura img')].every(img => img.naturalWidth > 0 && Math.max(img.naturalWidth, img.naturalHeight) <= 192))
  }
  assert.equal(await page.locator('.biblioteca-miniatura img').count(), 3)
  assert.equal(downloads.length, originalTransfersBeforeList, 'grouping/filtering requests never loads full delivery files')
  await page.screenshot({ path: path.join(out, 'offiz-pedidos-por-conversa-mobile.png'), fullPage: true })
  assert.equal(writes.length, 0)
  assert.deepEqual(errors, [])
  assert.deepEqual(unexpected, [])
  await fs.writeFile(path.join(out, 'delivery-layout-facts.json'), JSON.stringify({ layouts, largeVideo: { waitsForClick: true, previewTransfers: 1, originalDownload: true }, darkRetry, thumbnails, archive: { originalReads: archiveReads.length, compactBeforeOpening: true }, conversationGroups: { groups: 2, versionsTogether: true }, writes, errors, unexpected }, null, 2))
  console.log(JSON.stringify({ ok: true, builtUI: true, syntheticAPI: true, carousel: { originalFirst: true, ordered: true, orderedFiles: true, panel: true }, enlargement: { desktop: true, mobile390: true, originalDetails: true, keyboardScroll: true, resize: true, focus: true, extraTransfers: 0 }, video: { decoded: true, played: true, vertical: true, originalDownload: true }, conversationLayouts: layouts, largeVideo: { waitsForClick: true, originalDownload: true }, darkRetry, archive: { nativeModal: true, keyboard: true, focusReturn: true, searchPreserved: true, mobile390: true, landscape: true }, previousVersion: true, writes: 0, screenshots: out }))
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
