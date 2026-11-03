/** Prévia HTML real do compositor, só fixture e navegador headless isolado. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const renderer = path.resolve(frontend, '../offices/conteudo/ferramentas/renderizar_carrossel.py')
const out = process.env.INTERFACE_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'offiz-carrossel-preview-'))
await fs.mkdir(out, { recursive: true })
const python = process.env.INTERFACE_QA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const fixture = `import importlib.util,json,sys
from pathlib import Path
from PIL import Image,ImageDraw
source,out=Path(sys.argv[1]),Path(sys.argv[2])
spec=importlib.util.spec_from_file_location('renderer_previa_sintetica',source)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
image=Image.new('RGB',(600,750),'#ddd');draw=ImageDraw.Draw(image)
draw.rectangle((0,0,599,20),fill='#111');draw.rectangle((0,729,599,749),fill='#555')
asset=out/'foto-sintetica.png';image.save(asset)
title='HelenoDidiJairzinhoSemQuebra'*18
caption='Legenda exata com nomes e fatos simulados.\\n'+'PalavraSemQuebra'*80+'\\nhttps://example.invalid/'+('referencia'*35)+'\\nFechamento da legenda.'
doc={'titulo':title,'legenda':caption,'largura':600,'altura':750,
 'cards':[{'layout':'galeria','imagem':str(asset),'descricao':'Foto sintética '+str(i)} for i in range(4)]}
module.renderizar(doc,out/'arte',local=True)
(out/'expected.json').write_text(json.dumps({'title':title,'caption':caption}),encoding='utf8')
`
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/TOKEN|KEY|SECRET|PASSWORD|OFFIZ_|BACKEND_URL|DATABASE_URL|ANTHROPIC|OPENAI|CODEX_/i.test(key)))
const result = spawnSync(python, ['-I', '-c', fixture, renderer, out], {
  encoding: 'utf8', env, timeout: 20000, windowsHide: true,
})
assert.equal(result.status, 0, `Fixture não foi renderizada (${result.error?.code || result.status}); sem dados de cliente`)
const html = await fs.readFile(path.join(out, 'arte/post.html'), 'utf8')
const expected = JSON.parse(await fs.readFile(path.join(out, 'expected.json'), 'utf8'))
const unexpected = [], errors = [], measurements = []
let browser
try {
  const executablePath = process.env.BROWSER_EXECUTABLE || (process.platform === 'win32'
    ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : chromium.executablePath())
  browser = await chromium.launch({ executablePath, headless: true })
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } })
    await context.route('**/*', route => { unexpected.push(route.request().url()); return route.abort() })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent(html)
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
    const data = await page.evaluate(() => {
      const bound = element => {
        const r = element.getBoundingClientRect()
        return { left: r.left, right: r.right, width: r.width, height: r.height,
          scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
      }
      return {
        document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
        title: document.querySelector('h1').textContent, caption: document.querySelector('pre span').textContent,
        elements: [...document.querySelectorAll('h1, pre, figure')].map(bound),
        images: [...document.querySelectorAll('img')].map(image => ({ ...bound(image),
          naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
          container: bound(image.parentElement), overflow: getComputedStyle(image.parentElement).overflow })),
      }
    })
    assert(data.document.scrollWidth <= data.document.clientWidth, `Página transborda em ${width}px`)
    assert.equal(data.title, expected.title, 'Título permanece inteiro')
    assert.equal(data.caption, expected.caption, 'Legenda, URL e quebras permanecem inteiras')
    for (const element of data.elements) {
      assert(element.scrollWidth <= element.clientWidth + 1, `Título/legenda/card transborda em ${width}px`)
      assert(element.left >= -1 && element.right <= width + 1, 'Conteúdo cabe na janela')
    }
    assert.equal(data.images.length, 4)
    for (const image of data.images) {
      assert(Math.abs(image.width / image.height - image.naturalWidth / image.naturalHeight) < 0.001,
        'Foto conserva a proporção completa')
      assert(image.left >= image.container.left - 1 && image.right <= image.container.right + 1,
        'Foto inteira dentro do card')
      assert.notEqual(image.overflow, 'hidden', 'Não mascara recorte com overflow:hidden')
    }
    measurements.push({ width, ...data })
    await page.screenshot({ path: path.join(out, `previa-${width}.png`), fullPage: true })
    await context.close()
  }
  assert.deepEqual(unexpected, [], 'Nenhuma requisição externa da prévia')
  assert.deepEqual(errors, [], 'Nenhum erro do navegador')
  const rendererSHA256 = createHash('sha256').update(await fs.readFile(renderer)).digest('hex')
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify({ fixture: true, renderer, rendererSHA256,
    browserVersion: browser.version(),
    noCustomerAssets: true, noProvider: true, noProductUI: true, measurements, unexpected, errors }, null, 2))
  console.log(JSON.stringify({ out, passed: [390, 1440], externalRequests: unexpected.length, errors: errors.length }))
} finally {
  await browser?.close()
}
