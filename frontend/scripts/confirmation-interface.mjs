/** App compilado com API sintética: teclado e efeitos sem alterar conexões reais. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright-core'
import { consumoSemRegistros } from './fixtures-consumo.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.INTERFACE_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'offiz-confirmacao-ui-'))
await fs.mkdir(out, { recursive: true })
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
let browser
try {
  const executablePath = process.env.BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : chromium.executablePath())
  browser = await chromium.launch({ executablePath, headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' })
  const person = { id: 11, email: 'fixture@example.invalid', nome: 'Pessoa de teste', is_admin: false, idioma_interface: 'pt-BR' }
  const errors = [], unexpected = [], writes = [], nativeDialogs = []
  let media = { falai: true, elevenlabs: true }
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss() })
  await page.addInitScript(person => {
    localStorage.setItem('offiz_access_token', 'fixture-confirmacao')
    localStorage.setItem('offiz_usuario', JSON.stringify(person))
  }, person)
  const adminOrg = { id: 3, nome: 'Cliente de demonstração', slug: 'cliente-demo', status: 'ativa', assentos: 5, membros: 2, offices: ['conteudo'] }
  const routeFixture = async route => {
    const request = route.request(), url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/')) {
      if (url.origin === origin) return route.continue()
      unexpected.push(request.url()); return route.abort()
    }
    const endpoint = url.pathname.slice('/api/v1'.length)
    let body
    if (endpoint === '/auth/me') body = person
    else if (endpoint === '/notificacoes') body = []
    else if (endpoint === '/predios') body = [{ org_id: 3, office_slug: 'conteudo', meu_papel: 'owner' }]
    else if (endpoint === '/offices') body = [{ slug: 'conteudo', nome: 'Conteúdo e marca', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }]
    else if (endpoint === '/admin/orgs' && request.method() === 'GET') body = [adminOrg]
    else if (endpoint === '/admin/orgs/3/status' && request.method() === 'PUT') {
      const input = request.postDataJSON()
      assert.deepEqual(input, { status: 'suspensa' }, 'A fixture confirma suspensão sem inventar motivo')
      writes.push({ endpoint, input }); adminOrg.status = 'suspensa'; body = { tarefas_na_fila: 1 }
    }
    else if (endpoint === '/orgs/3/contrato' && request.method() === 'GET') body = { tipo: 'byok' }
    else if (endpoint === '/orgs/3/uso/historico' && request.method() === 'GET') body = consumoSemRegistros(12)
    else if (endpoint === '/orgs/3/settings/notificacoes' && request.method() === 'GET') body = { midia: media }
    else if (endpoint === '/orgs/3/midia-keys' && request.method() === 'PUT') {
      const input = request.postDataJSON()
      writes.push({ endpoint, input })
      assert.deepEqual(input, { falai_api_key: '' }, 'Somente a chave da fal.ai pode ser removida nesta fixture')
      media = { ...media, falai: false }; body = { midia: media }
    } else {
      unexpected.push(`${request.method()} ${endpoint}`)
      return route.fulfill({ status: 500, json: { detail: 'Endpoint sem fixture' } })
    }
    return route.fulfill({ json: body })
  }
  await page.route('**/*', routeFixture)
  await page.goto(`${origin}/config/org/3#midia`)
  const source = page.getByRole('button', { name: 'Limpar', exact: true }).first()
  await source.waitFor()
  const draft = page.getByLabel('API key da fal.ai', { exact: true })
  await draft.fill('rascunho-sintetico-nao-real')
  await source.click()
  const dialog = page.getByRole('dialog', { name: 'Remover chave do provedor', exact: true })
  await dialog.waitFor()
  const cancel = dialog.getByRole('button', { name: 'Cancelar', exact: true })
  assert(await cancel.evaluate(element => element === document.activeElement), 'Cancelar deve receber o foco inicial')
  assert.equal(writes.length, 0)
  await page.screenshot({ path: path.join(out, 'confirmacao-desktop.png'), animations: 'disabled' })
  await page.keyboard.press('Shift+Tab')
  assert(await dialog.getByRole('button', { name: 'Remover chave', exact: true }).evaluate(element => element === document.activeElement), 'O teclado fica no diálogo')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert(await source.evaluate(element => element === document.activeElement), 'Fechar devolve o foco à ação')
  assert.equal(await draft.inputValue(), 'rascunho-sintetico-nao-real')
  assert.equal(writes.length, 0)

  await page.setViewportSize({ width: 390, height: 844 })
  await source.click(); await dialog.waitFor()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Sem rolagem horizontal')
  const box = await dialog.boundingBox()
  assert(box && box.x >= 0 && box.x + box.width <= 390, 'Diálogo cabe no celular')
  for (const button of await dialog.getByRole('button').all()) {
    const bounds = await button.boundingBox(); assert(bounds && bounds.height >= 44, 'Área de toque mínima')
  }
  await page.screenshot({ path: path.join(out, 'confirmacao-mobile.png'), animations: 'disabled' })
  await cancel.click(); await dialog.waitFor({ state: 'hidden' })
  assert.equal(writes.length, 0)

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'Mudar para tema escuro', exact: true }).click()
  await source.click(); await dialog.waitFor()
  await page.screenshot({ path: path.join(out, 'confirmacao-escuro.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: 'Remover chave', exact: true }).click()
  await page.getByText('Não configurada', { exact: true }).waitFor()
  assert.equal(writes.length, 1)
  assert(await page.getByText('✓ Configurada', { exact: true }).isVisible(), 'ElevenLabs permanece configurada')
  // Formulário real do admin: cancelar motivo e corrigir quantidade não
  // autorizam uma alteração. Só a confirmação explícita faz um PUT sintético.
  person.is_admin = true
  const admin = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' })
  admin.on('pageerror', error => errors.push(error.message))
  admin.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss() })
  await admin.addInitScript(person => {
    localStorage.setItem('offiz_access_token', 'fixture-admin-confirmacao')
    localStorage.setItem('offiz_usuario', JSON.stringify(person))
  }, person)
  await admin.route('**/*', routeFixture)
  await admin.goto(`${origin}/admin`)
  await admin.getByText(adminOrg.nome, { exact: true }).waitFor()
  await admin.getByText('Gerenciar', { exact: true }).click()
  const suspender = admin.getByRole('button', { name: 'Suspender', exact: true })
  await suspender.click()
  const formDialog = admin.getByRole('dialog', { name: `Suspender ${adminOrg.nome}` })
  await formDialog.waitFor()
  const reason = formDialog.getByRole('textbox')
  assert(await reason.evaluate(element => element === document.activeElement), 'Campo do formulário recebe foco')
  await reason.fill('Motivo cancelado, nunca enviado')
  await admin.screenshot({ path: path.join(out, 'admin-formulario-desktop.png'), animations: 'disabled' })
  await admin.keyboard.press('Escape')
  await formDialog.waitFor({ state: 'hidden' })
  assert(await suspender.evaluate(element => element === document.activeElement), 'Cancelar devolve foco à ação do cliente')
  assert.equal(writes.length, 1, 'Cancelar o motivo não escreve no servidor')

  await admin.setViewportSize({ width: 390, height: 844 })
  await admin.getByRole('button', { name: '2/5', exact: true }).click()
  const seats = admin.getByRole('dialog', { name: `Assentos de ${adminOrg.nome}` })
  const quantity = seats.getByRole('spinbutton')
  await quantity.fill('1.5'); await admin.keyboard.press('Enter')
  await seats.getByRole('alert').waitFor()
  assert.equal(await quantity.inputValue(), '1.5', 'O número inválido permanece para correção')
  assert.equal(writes.length, 1)
  assert(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Admin não alarga o celular')
  for (const control of await seats.locator('input,button').all()) {
    const bounds = await control.boundingBox(); assert(bounds && bounds.height >= 44, 'Campo e ações têm área de toque')
  }
  await admin.screenshot({ path: path.join(out, 'admin-formulario-mobile.png'), animations: 'disabled' })
  await seats.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await seats.waitFor({ state: 'hidden' })
  await suspender.click(); await formDialog.waitFor()
  assert.equal(await formDialog.getByRole('textbox').inputValue(), '', 'O motivo cancelado não é reutilizado')
  await formDialog.getByRole('button', { name: 'Suspender', exact: true }).click()
  await admin.getByRole('button', { name: 'Reativar', exact: true }).waitFor()
  assert.equal(writes.length, 2, 'Uma alteração por intenção confirmada')
  assert.deepEqual(nativeDialogs, []); assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  console.log(JSON.stringify({ builtUI: true, syntheticAPI: true, widths: [1280, 390], keyboard: true, adminForms: true, nativeDialogs: 0, providerCalls: 0, syntheticWrites: writes.length, out }))
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
