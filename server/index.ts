import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createApi } from './api.ts'

export function createApp(database?: string) {
  const api = createApi(database), root = resolve('dist')
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png' }
  const server = createServer((req, res) => {
    void api.handle(req, res, () => { void (async () => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
        const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
        if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return }
        const content = await readFile(file)
        res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' })
        res.end(req.method === 'HEAD' ? undefined : content)
      } catch { res.writeHead(404); res.end('Not found') }
    })() })
  })
  server.on('close', api.close)
  return server
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createApp(), port = Number(process.env.PORT ?? 3000)
  server.listen(port, process.env.HOST ?? '0.0.0.0', () => console.log(`Pigeon server listening on ${port}`))
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)))
}
