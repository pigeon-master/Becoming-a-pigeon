import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  const serverStorage = loadEnv(mode, process.cwd(), '').VITE_STORAGE_MODE === 'server'
  return {
    server: {
      host: '0.0.0.0',
      port: 5175,
      strictPort: true,
      https: {
        cert: readFileSync(resolve('.cert/dev-cert.pem')),
        key: readFileSync(resolve('.cert/dev-key.pem')),
      },
    },
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
