import type { IncomingMessage, ServerResponse } from 'node:http'
import { openStore, validAsset } from './store.ts'
import { validSpeech } from '../src/speech-text.ts'

export function createApi(filename?: string) {
  const store = openStore(filename)
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body))
  }
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0] ?? ''
    if (!path.startsWith('/api/')) { next(); return }
    try {
      if (path === '/api/pigeons' && req.method === 'GET') { json(res, 200, store.snapshot()); return }
      const detail = path.match(/^\/api\/pigeons\/([a-f0-9-]{36})$/i)
      if (detail && req.method === 'GET') {
        const asset = store.get(detail[1]); json(res, asset ? 200 : 404, asset ?? { error: '비둘기가 교체되었습니다.' }); return
      }
      const speech = path.match(/^\/api\/pigeons\/([a-f0-9-]{36})\/message$/i)
      if (detail && req.method === 'DELETE') {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { json(res, 403, { error: 'Origin not allowed' }); return }
        const token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
        if (!/^[a-f0-9]{64}$/.test(token) || !store.remove(detail[1], token)) { json(res, 403, { error: '본인이 만든 비둘기만 삭제할 수 있어요.' }); return }
        json(res, 200, { deleted: detail[1] }); return
      }
      if ((path !== '/api/pigeons' && !speech) || req.method !== 'POST') { json(res, 404, { error: 'Not found' }); return }
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { json(res, 403, { error: 'Origin not allowed' }); return }
      if (!req.headers['content-type']?.startsWith('application/json')) { json(res, 415, { error: 'JSON required' }); return }
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > (speech ? 4096 : 1500000)) { json(res, 413, { error: '데이터가 너무 큽니다.' }); return }
        chunks.push(Buffer.from(chunk))
      }
      let data
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (speech) {
        const automatic = data?.automatic ?? []
        if (!validSpeech(data?.message, automatic)) { json(res, 400, { error: '직접 입력한 글자는 공백 포함 50자까지 사용할 수 있습니다.' }); return }
        const token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
        if (!/^[a-f0-9]{64}$/.test(token) || !store.say(speech[1], token, data.message, automatic)) { json(res, 403, { error: '본인이 만든 비둘기만 말할 수 있어요. 비둘기가 교체됐는지 확인해 주세요.' }); return }
        json(res, 200, { message: data.message, automatic }); return
      }
      if (!data || typeof data.id !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(data.id) || !validAsset(data.asset)) {
        json(res, 400, { error: '올바르지 않은 얼굴 데이터입니다.' }); return
      }
      if (data.token !== undefined && (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token))) { json(res, 400, { error: 'Invalid owner token' }); return }
      json(res, 200, store.add(data.id, data.asset, data.token))
    } catch (error) { console.error('Pigeon API:', error); if (!res.headersSent) json(res, 500, { error: '서버에 저장하지 못했습니다. 다시 시도해 주세요.' }) }
  }
  return { handle, close: () => store.close() }
}
