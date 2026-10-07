import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig(({ command, mode }) => {
  const serverStorage = loadEnv(mode, process.cwd(), '').VITE_STORAGE_MODE === 'server'
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]
  const base = command === 'build' && repository && !repository.endsWith('.github.io') ? `/${repository}/` : '/'
  return {
    base,
    server: command === 'serve' ? {
      host: '0.0.0.0',
      port: 5175,
      strictPort: true,
      https: {
        cert: readFileSync(resolve('.cert/dev-cert.pem')),
        key: readFileSync(resolve('.cert/dev-key.pem')),
      },
    } : undefined,
    plugins: serverStorage ? [{
      name: 'pigeon-persistence',
      async configureServer(server) {
        const { createApi } = await import('./server/api.ts')
        const api = createApi()
        server.middlewares.use((req, res, next) => { void api.handle(req, res, next) })
        server.httpServer?.once('close', api.close)
      },
      async configurePreviewServer(server) {
        const { createApi } = await import('./server/api.ts')
        const api = createApi()
        server.middlewares.use((req, res, next) => { void api.handle(req, res, next) })
        server.httpServer.once('close', api.close)
      },
    }] : [],
  }
})
