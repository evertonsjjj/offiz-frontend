/** Página compilada com API fictícia: não cria contas nem envia e-mails reais. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.INTERFACE_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'offiz-admin-ui-'))
await fs.mkdir(out, { recursive: true })
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
let browser
try {
  const executablePath = process.env.BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : chromium.executablePath())
  browser = await chromium.launch({ executablePath, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' })
  const person = { id: 1, email: 'gestao@example.com', nome: 'Gestão de teste', is_admin: true, idioma_interface: 'pt-BR' }
  const offices = [{ slug: 'conteudo', nome: 'Conteúdo e marca', descricao: '', tema: { icone: 'conversa' } }, { slug: 'juris', nome: 'Jurídico', descricao: '', tema: { icone: 'predio' } }]
  const orgs = Array.from({ length: 36 }, (_, i) => ({ id: i + 10, nome: i === 0 ? 'Aurora Contabilidade' : `Cliente de teste ${i + 1}`, slug: `cliente-${i + 1}`, status: 'ativa', membros: 1, assentos: 5, motor_modo: 'cli', offices: ['conteudo'] }))
  const errors = [], unexpected = [], created = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(person => {
    localStorage.setItem('offiz_access_token', 'synthetic')
    localStorage.setItem('offiz_usuario', JSON.stringify(person))
  }, person)
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/')) {
      if (url.origin === origin) return route.continue()
      unexpected.push(request.url()); return route.abort()
    }
    const endpoint = url.pathname.slice('/api/v1'.length)
    let body
    if (endpoint === '/auth/me') body = person
    else if (endpoint === '/notificacoes') body = []
    else if (endpoint === '/predios') body = []
    else if (endpoint === '/offices') body = offices
    else if (endpoint === '/admin/usuarios') body = [person]
    else if (endpoint === '/admin/convites') body = []
    else if (endpoint === '/admin/orgs' && request.method() === 'POST') {
      const input = request.postDataJSON(); created.push(input)
      const org = { ...orgs[0], ...input, id: 100 + created.length, membros: 0 }
      orgs.push(org)
      body = { ...org, convite_owner: { email: input.owner_email, link: `${origin}/convite/synthetic-${created.length}`, email_enviado: false } }
    } else if (endpoint === '/admin/orgs') body = orgs
    else { unexpected.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 500, json: { detail: 'Endpoint sem fixture' } }) }
    return route.fulfill({ json: body })
  })
  await page.goto(`${origin}/admin`)
  await page.getByText('Aurora Contabilidade', { exact: true }).waitFor()
  assert.equal(await page.locator('.admin-clientes-tabela tbody tr').count(), 10)
  await page.getByRole('button', { name: 'próximas →', exact: true }).click()
  await page.getByText('página 2 de 4', { exact: true }).waitFor()
  await page.getByRole('searchbox', { name: 'Filtrar organizações' }).fill('Aurora')
  await page.getByText('Aurora Contabilidade', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Excluir', exact: true }).isVisible(), false)
  await page.screenshot({ path: path.join(out, 'offiz-clientes-lista.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Novo cliente', exact: true }).click()
  await page.getByRole('button', { name: 'Teste', exact: true }).click()
  await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('Teste — Aurora')
  await page.screenshot({ path: path.join(out, 'offiz-clientes-cadastro.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Criar cliente', exact: true }).click()
  await page.locator('input[readonly]').filter({ visible: true }).waitFor()
  assert.equal(created.length, 1); assert.equal(created[0].enviar_email, false)
  assert.match(created[0].owner_email, /^teste-.+@example.com$/)
  await page.getByRole('button', { name: 'Pessoas e acessos', exact: true }).click()
  await page.getByRole('button', { name: 'Clientes e demos', exact: true }).click()
  assert((await page.locator('.admin-novo-cliente input[readonly]').inputValue()).endsWith('/convite/synthetic-1'))
  await page.getByRole('button', { name: 'Demo', exact: true }).click()
  await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('Demo — Horizonte')
  await page.getByRole('button', { name: 'Criar cliente', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.admin-novo-cliente input[readonly]')?.value.endsWith('/convite/synthetic-2'))
  assert.equal(created.length, 2); assert.notEqual(created[0].owner_email, created[1].owner_email)
  assert.equal(created[1].enviar_email, false)
  await page.getByRole('button', { name: 'Fechar cadastro', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Filtrar organizações' }).fill('Demo — Horizonte')
  await page.getByText('Demo — Horizonte', { exact: true }).waitFor()
  await page.locator('.admin-cliente-acoes summary').click()
  for (const close of await page.getByRole('button', { name: 'Fechar aviso', exact: true }).all()) await close.click()
  await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(out, 'offiz-clientes-mobile.png'), fullPage: true, animations: 'disabled' })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Sem rolagem horizontal no celular')
  assert(await page.getByRole('button', { name: 'Link de acesso', exact: true }).isVisible())
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Mudar para tema escuro', exact: true }).click()
  await page.screenshot({ path: path.join(out, 'offiz-clientes-escuro.png'), fullPage: true, animations: 'disabled' })
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  console.log(JSON.stringify({ builtUI: true, syntheticAPI: true, presets: 2, pagination: true, themes: ['light', 'dark'], responsive: true, out }))
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
