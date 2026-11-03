/** Built UI with synthetic API/desktop bridge; no account, provider or disk mutation. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright-core'
import { consumoSemRegistros } from './fixtures-consumo.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.INTERFACE_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'offiz-storage-ui-'))
await fs.mkdir(out, { recursive: true })
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
const person = { id: 11, email: 'fixture@example.invalid', nome: 'Conta simulada', is_admin: false, idioma_interface: 'pt-BR' }
const office = { slug: 'conteudo', nome: 'Conteúdo', descricao: '', tema: { cor_primaria: '#0066cc', cor_acento: '#0066cc', cor_fundo: '#fff', icone: 'conversa' } }
const storage = { limite_bytes: 10e9, unidade_bytes: 1e9, bytes_centrais_reais: 2e9, bytes_alocados_centrais: 3e9, medicao_completa: true, excedido: false, disponivel_bytes: 8e9, pode_incrementar: true, destino: 'compartilhado', residencia_integral_verificada: false, requisitos: { postgres_configurado_testado: false, s3_configurado_testado: false, infraestrutura_externa_verificada: false }, pendencias_residencia: [] }
const errors = [], unexpected = [], writes = [], results = []
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : chromium.executablePath()), headless: true })
  for (const width of [1280, 390]) for (const mode of ['new', 'old', 'web']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'pt-BR', ...(mode !== 'web' ? { userAgent: 'OffizDesktop/0.2.24 synthetic-interface-test' } : {}) })
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.addInitScript(({ person, mode }) => {
      localStorage.setItem('offiz_access_token', 'fixture-storage-ui')
      localStorage.setItem('offiz_usuario', JSON.stringify(person))
      window.__folderProof = { choices: 0, opens: 0, starts: 0 }
      if (mode === 'web') return
      let state = 'parado'
      const folder = () => localStorage.getItem('fixture-folder')
      window.offizMotor = {
        versao: mode === 'new' ? '0.2.24' : '0.2.23',
        estado: async () => ({ config: { orgId: 3, orgNome: 'Empresa simulada', backendUrl: 'https://fixture.invalid', claudeBin: '', localEngine: 'codex', workerEnabled: state !== 'parado', ...(mode === 'new' ? { pastaTrabalho: { pasta: folder(), disponivel: Boolean(folder()) } } : {}) }, pareado: true, pareadoPor: 'Conta simulada', worker: { estado: state, jobAtual: null, log: [] } }),
        claudeStatus: async () => ({ installed: true, loggedIn: true }), codexStatus: async () => ({ installed: true, authenticated: true }),
        onUpdate: () => () => {}, onInstalarLinha: () => () => {}, verificarDeps: async () => ({ deps: [] }),
        ligar: async () => { window.__folderProof.starts++; state = 'ocioso'; return { ok: true } }, desligar: async () => { state = 'parado'; return { ok: true } },
        ...(mode === 'new' ? {
          escolherPastaTrabalho: async org => { if (org !== 3) throw Error('Wrong organization'); window.__folderProof.choices++; localStorage.setItem('fixture-folder', 'C:\\QA\\Offiz\\empresa-3\\usuario-11'); return { ok: true } },
          abrirPastaTrabalho: async org => { if (org !== 3) throw Error('Wrong organization'); window.__folderProof.opens++; return { ok: true } },
        } : {}),
      }
    }, { person, mode })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (!url.pathname.startsWith('/api/v1/')) {
        if (url.origin === origin) return route.continue()
        unexpected.push(request.url()); return route.abort()
      }
      const endpoint = url.pathname.slice('/api/v1'.length)
      if (request.method() !== 'GET') { writes.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 500, json: { detail: 'No writes permitted in this proof' } }) }
      let body
      if (endpoint === '/auth/me') body = person
      else if (endpoint === '/notificacoes') body = []
      else if (endpoint === '/predios') body = [{ org_id: 3, office_slug: 'conteudo', org_nome: 'Empresa simulada', office, meu_papel: 'owner' }]
      else if (endpoint === '/orgs/3/contrato') body = { tipo: 'byok', vigencia: 'vigente' }
      else if (endpoint === '/orgs/3/settings/llm') body = { motor_modo: 'cli', motor_cli: 'codex', llm_provedor: 'openai', tem_chave: false, modelos: {}, limite_tokens_mes: null }
      else if (endpoint === '/orgs/3/uso/historico') body = consumoSemRegistros(1)
      else if (endpoint === '/orgs/3/uso') body = { tokens_entrada: 0, tokens_saida: 0, por_office: [], por_usuario: [], execucoes: 0 }
      else if (endpoint === '/orgs/3/worker-token') body = { pareado: false, tem_token: false }
      else if (endpoint === '/orgs/3/worker-token/todos') body = { pareamentos: [] }
      else if (endpoint === '/orgs/3/armazenamento') body = storage
      else if (endpoint === '/orgs/3/database') body = { configurado: false, database_ok: false, pode_usar_banco_central: true, storage: { configurado: false } }
      else if (endpoint === '/orgs/3/database/migracao') body = { pronto: { byod: false, byos: false }, total_arquivos: 0, total_bytes: 0, categorias: [], linhas_sem_arquivo: 0 }
      else { unexpected.push(`${request.method()} ${endpoint}`); return route.fulfill({ status: 500, json: { detail: 'Missing explicit fixture' } }) }
      return route.fulfill({ json: body })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${origin}/config/org/3#ia`)
    await page.getByRole('heading', { name: 'Configurações da organização' }).waitFor()
    if (mode === 'new') {
      const area = page.getByRole('region', { name: 'Pasta de trabalho neste computador' })
      await area.waitFor()
      const start = page.getByRole('button', { name: 'Ligar o motor', exact: true })
      assert.equal(await start.isDisabled(), true)
      await area.getByRole('button', { name: 'Escolher pasta', exact: true }).click()
      await area.getByRole('button', { name: 'Trocar pasta', exact: true }).waitFor()
      assert.equal(await start.isEnabled(), true)
      await area.getByRole('button', { name: 'Abrir pasta dos trabalhos', exact: true }).click()
      await start.click()
      await page.getByText('ligado — aguardando tarefas', { exact: true }).waitFor()
      assert.equal(await area.getByRole('button', { name: 'Trocar pasta', exact: true }).isDisabled(), true)
      await page.getByRole('button', { name: 'Desligar', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.__folderProof), { choices: 1, opens: 1, starts: 1 })
      await page.reload()
      await page.getByRole('button', { name: 'Trocar pasta', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Ligar o motor', exact: true }).isEnabled(), true)
    } else if (mode === 'old') {
      await page.getByText(/A escolha de uma pasta persistente requer o Offiz 0.2.24/).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Escolher pasta', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Ligar o motor', exact: true }).isEnabled(), true)
    } else assert.equal(await page.getByRole('button', { name: 'Escolher pasta', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false)
    await page.screenshot({ path: path.join(out, `motor-${mode}-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Dados e conexões', exact: true }).click()
    const storageArea = page.getByRole('region', { name: 'Armazenamento da empresa' })
    await storageArea.getByText(/10 GB/).waitFor()
    assert.match(await storageArea.innerText(), /Uso contabilizado:\s*2 GB/)
    assert.match(await storageArea.innerText(), /residência integral fora do Offiz ainda não foi verificada/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false)
    await page.screenshot({ path: path.join(out, `${mode}-${width}.png`), fullPage: true })
    results.push({ width, mode, folderRequired: mode === 'new', persistedOnReload: mode === 'new', sharedStorage: true })
    await context.close()
  }
  assert.deepEqual(errors, [], 'No runtime UI errors')
  assert.deepEqual(unexpected, [], 'All routes and external calls must be accounted for')
  assert.deepEqual(writes, [], 'No real API writes')
  console.log(JSON.stringify({ compiledUI: true, syntheticAPI: true, syntheticDesktopBridge: true, nativeFolderDialogTested: false, results, apiWrites: 0, providerCalls: 0, out }))
} finally { await browser?.close(); await server.httpServer.close() }
