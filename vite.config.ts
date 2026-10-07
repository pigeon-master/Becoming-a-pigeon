import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const serverStorage = env.VITE_STORAGE_MODE === 'server'
  if (env.VITE_STORAGE_MODE === 'supabase') {
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase URL과 publishable 키를 환경 변수에 설정해 주세요. docs/supabase.md를 확인하세요.')
    if (!/^https:\/\//.test(env.VITE_SUPABASE_URL)) throw new Error('Supabase URL은 https://로 시작해야 합니다.')
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
    if (!key.startsWith('sb_publishable_')) {
      let role = ''
      try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role } catch { /* Not a public key. */ }
      if (role !== 'anon') throw new Error('Supabase publishable 키 또는 legacy anon 키만 사용하세요. secret/service_role 키는 사용할 수 없습니다.')
    }
  }
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
