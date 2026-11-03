/** Executa a configuração real num nginx local; usa apenas tokens fictícios. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const executable = process.env.NGINX_EXECUTABLE
assert(executable, 'Defina NGINX_EXECUTABLE para um nginx instalado.')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'offiz-nginx-privacy-'))
const forward = p => p.replaceAll('\\', '/')
const probe = net.createServer()
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise(resolve => probe.close(resolve))
await fs.mkdir(path.join(temp, 'logs'))
await fs.mkdir(path.join(temp, 'temp'))
await fs.mkdir(path.join(temp, 'html/assets'), { recursive: true })
await fs.writeFile(path.join(temp, 'html/index.html'), '<h1>Fixture Offiz</h1>')
await fs.writeFile(path.join(temp, 'html/assets/demo.js'), '/* fixture */')
const source = (await fs.readFile(path.join(root, 'nginx.conf'), 'utf8'))
  .replace('listen 80;', `listen 127.0.0.1:${port};`)
  .replace('/usr/share/nginx/html', `"${forward(path.join(temp, 'html'))}"`)
  .replace('/var/log/nginx/access.log', 'logs/access.log')
await fs.writeFile(path.join(temp, 'nginx.conf'), `worker_processes 1;\nerror_log logs/error.log warn;\npid logs/nginx.pid;\nevents { worker_connections 32; }\nhttp {\n${source}\n}`)
const args = ['-p', `${forward(temp)}/`, '-c', 'nginx.conf']
const syntax = spawnSync(executable, [...args, '-t'], { encoding: 'utf8', windowsHide: true })
assert.equal(syntax.status, 0, syntax.stderr)
const child = spawn(executable, args, { windowsHide: true, stdio: 'ignore' })
const closed = new Promise(resolve => child.once('exit', resolve))
try {
  let started = false
  for (let i = 0; i < 60 && !started; i++) {
    try { started = (await fetch(`http://127.0.0.1:${port}/`)).ok }
    catch { await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  assert(started, 'nginx não iniciou')
  for (const route of ['/convite/SEGREDO-FICTICIO', '/redefinir-senha/SEGREDO-FICTICIO', '/api/v1/convites/SEGREDO-FICTICIO', '/assets/demo.js?token=SEGREDO-FICTICIO']) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { Referer: 'https://example.test/SEGREDO-FICTICIO' } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.match(response.headers.get('cache-control'), route.startsWith('/assets') ? /immutable/ : /no-cache/)
  }
} finally {
  spawnSync(executable, [...args, '-s', 'quit'], { encoding: 'utf8', windowsHide: true })
  await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5000))])
}
const access = await fs.readFile(path.join(temp, 'logs/access.log'), 'utf8')
assert(!access.includes('SEGREDO-FICTICIO'), 'token/Referer apareceu no access log')
assert(access.includes('GET /assets/demo.js HTTP/1.1'))
console.log(JSON.stringify({ nginxSyntax: true, realRequests: 4, privateAccessLog: true, cacheHeaders: true, evidence: temp }))
