/** App compilado com dados simulados: contraste, teclado e consulta interrompida. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.INTERFACE_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'offiz-recovery-ui-'))
await fs.mkdir(out, { recursive: true })
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
const contrast = async locator => locator.evaluate(element => {
  const style = getComputedStyle(element)
  const luminance = color => {
    const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
    })
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  }
  const values = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a)
  return { text: style.color, background: style.backgroundColor, ratio: (values[0] + .05) / (values[1] + .05) }
})
let browser
try {
  const executablePath = process.env.BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : chromium.executablePath())
  browser = await chromium.launch({ executablePath, headless: true })
  const login = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' })
  await login.addInitScript(() => localStorage.setItem('offiz-theme', 'dark'))
  await login.goto(`${origin}/login`)
  const entrar = login.getByRole('button', { name: 'Entrar', exact: true })
  await entrar.waitFor()
  const loginContrast = await contrast(entrar)
  await login.screenshot({ path: path.join(out, 'login-dark.png'), animations: 'disabled' })
  console.log(JSON.stringify({ loginContrast, out }))
  assert(loginContrast.ratio >= 4.5, 'Texto do botão Entrar precisa passar 4,5:1 no tema escuro')
  if (process.argv.includes('--contrast-only')) process.exitCode = 0
  else {
    const person = { id: 11, email: 'fixture@example.invalid', nome: 'Pessoa simulada', is_admin: false, idioma_interface: 'pt-BR' }
    const office = { slug: 'conteudo', nome: 'Conteúdo e marca', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
    const now = new Date().toISOString()
    const work = { id: 35, titulo: 'Consulta de demonstração', office_slug: 'conteudo', projeto_id: 1, projeto_nome: 'Projeto de teste', referencia_job_id: null, favorito: false, aprovado: true, criado_em: now, estado: 'aprovado', status: 'done', desatualizados: ['Data da partida'], arquivos: [{ id: 92, nome: 'referencia.docx', tipo: 'documento', status: 'aprovada' }] }
    const errors = [], unexpected = [], writes = []
    let offline = false
    let profileState = 'contextualizado'
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' })
    // A interceptação do Playwright é assíncrona. Observá-la antes da navegação
    // evita registrar o primeiro observador só no instante do Enter nativo.
    let fileChooserEvents = 0
    page.on('filechooser', () => { fileChooserEvents++ })
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(person => {
      localStorage.setItem('offiz_access_token', 'fixture-recovery')
      localStorage.setItem('offiz_usuario', JSON.stringify(person))
      localStorage.setItem('offiz-theme', 'dark')
    }, person)
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (!url.pathname.startsWith('/api/v1/')) {
        if (url.origin === origin) return route.continue()
        unexpected.push(request.url()); return route.abort()
      }
      const endpoint = url.pathname.slice('/api/v1'.length)
      if (request.method() !== 'GET') {
        writes.push(`${request.method()} ${endpoint}`)
        return route.fulfill({ status: 500, json: { detail: 'Esta fixture não autoriza escrita' } })
      }
      let body
      if (endpoint === '/auth/me') body = person
      else if (endpoint === '/notificacoes') body = []
      else if (endpoint === '/predios') body = [{ org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' }]
      else if (endpoint === '/orgs/3/inicio') body = { org_id: 3, org_nome: 'Empresa simulada', org_status: 'ativa', meu_papel: 'owner', contrato_gerenciado: false, motor_modo: 'api', tem_chave: true, andares: [{ ...office, acervo_de_marca: true }], solucoes: [], outras_solucoes: [], sabatina: { estado: profileState, pergunta: 'O que vamos preparar?', opcoes: [], permite_livre: true } }
      else if (endpoint === '/predios/3/conteudo') body = { org_id: 3, office_slug: 'conteudo', office, meu_papel: 'owner' }
      else if (endpoint === '/predios/3/conteudo/partida') body = { tem_motor: true, tem_chave: true, motor_local: false, sabatina_pendente: profileState === 'inicial', perfil_estado: profileState }
      else if (endpoint === '/orgs/3/predio/conversas' || endpoint === '/predios/3/conteudo/conversas') body = { conversas: [] }
      else if (endpoint === '/orgs/3/contrato') body = { tipo: 'byok', vigencia: 'vigente' }
      else if (endpoint === '/orgs/3/saldo') body = { tipo: 'byok', vigencia: 'vigente', estado: 'conta_propria', periodo: now.slice(0, 7), consultado_em: now }
      else if (endpoint === '/orgs/3/projetos') body = [{ id: 1, nome: 'Projeto de teste', office_slug: 'conteudo', objetivo: '', dados: {}, formatos: [], arquivado: false, versao: 1 }]
      else if (endpoint === '/orgs/3/padroes') body = []
      else if (endpoint === '/orgs/3/biblioteca') body = { itens: [work], total: 1, resumo: { prontos: 0, precisa_de_voce: 0, em_producao: 0, aprovados: 1 }, atualizado_em: now }
      else if (endpoint === '/orgs/3/biblioteca/35') {
        if (offline) return route.fulfill({ status: 503, json: { detail: 'Consulta temporariamente indisponível' } })
        body = work
      }
      else if (endpoint === '/entregas/92/leitura') return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: '# Referência simulada\n\nConteúdo de teste da consulta confirmada.' })
      else if (endpoint.endsWith('/conhecimento/canon')) body = { conteudo: '' }
      else if (endpoint.endsWith('/arquivos')) body = { entrada: [], exemplos: [], produto: [] }
      else if (endpoint.endsWith('/stats')) body = { tarefas_mes: 0, concluidas_mes: 0, rodando: false, entregas_pendentes: 0 }
      else if (endpoint.endsWith('/jobs') || endpoint.endsWith('/entregas') || endpoint.endsWith('/clientes') || endpoint.endsWith('/editorial')) body = []
      else if (endpoint.endsWith('/atividade')) body = { jobs: [] }
      else if (endpoint.endsWith('/metricas/loop')) body = { trabalhos: { total: 0, aprovados_de_primeira: 0, com_rejeicao: 0, pendentes: 0, com_devolutiva: 0, rodadas_extras: 0 }, taxa_aprovacao_primeira: null, por_tipo: [], tempo_mediano_ate_decisao_s: null, criterios_reprovados: 0 }
      else { unexpected.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 500, json: { detail: 'Endpoint sem fixture' } }) }
      return route.fulfill({ json: body })
    })
    await page.goto(`${origin}/app?org=3&vista=biblioteca&trabalho=35`)
    await page.getByRole('button', { name: 'Preparar versão atualizada', exact: true }).click()
    const draft = page.getByRole('textbox', { name: 'Qual resultado você precisa?', exact: true })
    await draft.fill('Ajustar a data e preservar as referências do projeto.')
    const avatarContrast = await contrast(page.locator('.shell-avatar'))
    assert(avatarContrast.ratio >= 4.5, 'Inicial da conta passa contraste no tema escuro')
    const productionContrast = await contrast(page.getByRole('button', { name: 'Pode produzir', exact: true }))
    console.log(JSON.stringify({ productionContrast }))
    assert(productionContrast.ratio >= 4.5, 'O botão principal da biblioteca passa contraste no tema escuro')
    offline = true
    await page.evaluate(() => window.dispatchEvent(new Event('offiz:biblioteca-mudou')))
    await page.getByRole('alert').getByText(/Exibindo a última consulta confirmada/).waitFor()
    assert.equal(await draft.inputValue(), 'Ajustar a data e preservar as referências do projeto.')
    assert(await page.getByText('Entrega #92 · referencia.docx', { exact: true }).isVisible())
    assert(await page.getByRole('alert').locator('time').getAttribute('datetime'))
    await page.screenshot({ path: path.join(out, 'consulta-interrompida-desktop.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'A consulta e o rascunho cabem no celular')
    await page.getByRole('alert').filter({ hasText: 'Exibindo a última consulta confirmada' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(out, 'consulta-interrompida-mobile.png'), animations: 'disabled' })
    offline = false
    const warning = page.getByRole('alert').filter({ hasText: 'Exibindo a última consulta confirmada' })
    await warning.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
    await warning.waitFor({ state: 'hidden' })
    assert.equal(await draft.inputValue(), 'Ajustar a data e preservar as referências do projeto.')
    // A cena de teclado representa um perfil inicial, distinto da consulta
    // anterior. Perfil confirmado não deve abrir a entrevista automaticamente.
    profileState = 'inicial'
    await page.goto(`${origin}/app?org=3&vista=inicio&area=conteudo`)
    const files = page.getByLabel('Escolher arquivos da empresa', { exact: true })
    await files.waitFor({ state: 'attached' })
    // A caixa usa sr-only: o teclado deve alcançá-la e realçar seu contorno.
    await page.locator('.sab-zona').scrollIntoViewIfNeeded()
    await page.locator('body').click({ position: { x: 3, y: 3 } })
    let reached = false
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab')
      if (await files.evaluate(element => document.activeElement === element)) { reached = true; break }
    }
    assert(reached, 'O seletor de arquivo é alcançado na navegação por teclado')
    assert(await page.locator('.sab-zona').evaluate(element => getComputedStyle(element).outlineStyle !== 'none'), 'A área de arquivos mostra o foco')
    assert.equal(fileChooserEvents, 0, 'Nenhum seletor abriu antes da ativação por teclado')
    const choosing = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')
    await choosing // Nenhum arquivo é escolhido ou enviado.
    assert.equal(fileChooserEvents, 1, 'Enter abre exatamente um seletor nativo de arquivos')
    await page.screenshot({ path: path.join(out, 'seletor-arquivos-teclado-mobile.png'), animations: 'disabled' })
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.deepEqual(writes, [])
    console.log(JSON.stringify({ builtUI: true, syntheticAPI: true, loginContrast, avatarContrast, productionContrast, preservedDraft: true, fileChooserKeyboard: true, widths: [1280, 390], providerCalls: 0, writes: 0, out }))
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
