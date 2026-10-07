import type { createWorld } from './world'
import type { FaceAsset, FlockSnapshot, PigeonOwner } from './pigeon-data'
import type * as THREE from 'three'
import { localFlock } from './local-flock'
import { SERVER_STORAGE, SUPABASE_STORAGE } from './storage-mode'
import { supabaseFlock } from './supabase-flock'
import { rememberOwners } from './ownership'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('서버 저장 기능이 실행되지 않았어요. 서버를 다시 시작한 뒤 새로고침해 주세요.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? '서버의 비둘기 정보를 처리하지 못했어요. 연결 후 다시 시도해 주세요.')
  }
  return response.json() as Promise<T>
}

export function connectFlock(world: ReturnType<typeof createWorld>, status: (error: string | null) => void, onSnapshot?: (snapshot: FlockSnapshot) => void) {
  let queue = Promise.resolve(), stopped = false
  let recoveredLocalOwners = false
  const drafts = new Map<string, { message: string; automatic: number[] }>()
  const sync = (focus?: string) => {
    const work = queue.then(async () => {
      if (stopped) return
      if (!SERVER_STORAGE && !SUPABASE_STORAGE && !recoveredLocalOwners) {
        rememberOwners(await localFlock.owners()); recoveredLocalOwners = true
      }
      const snapshot = SUPABASE_STORAGE ? await supabaseFlock.snapshot() : SERVER_STORAGE ? await request<FlockSnapshot>('/api/pigeons') : await localFlock.snapshot()
      const pending = snapshot.birds.filter(bird => !world.has(bird.id))
      if (pending.length) {
        const { decodeFace } = await import('./face')
        for (const bird of pending) {
          let asset: FaceAsset | null
          if (SUPABASE_STORAGE) asset = await supabaseFlock.get(bird.id)
          else if (SERVER_STORAGE) {
            const response = await fetch(`/api/pigeons/${bird.id}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
            if (response.status === 404) continue
            if (!response.ok) throw new Error('서버의 얼굴 데이터를 불러오지 못했어요.')
            asset = await response.json() as FaceAsset
          } else asset = await localFlock.get(bird.id)
          if (!asset) continue
          const face = await decodeFace(asset)
          if (stopped || !world.add(face, { id: bird.id, replaces: bird.replaces, focus: bird.id === focus })) {
            face.geometry.dispose(); face.material.map?.dispose(); face.material.dispose()
          }
        }
      }
      world.retain(new Set(snapshot.birds.map(b => b.id)))
      for (const bird of snapshot.birds) {
        const draft = drafts.get(bird.id)
        if (draft?.message === bird.message && JSON.stringify(draft.automatic) === JSON.stringify(bird.automatic ?? [])) drafts.delete(bird.id)
        world.say(bird.id, draft?.message ?? bird.message)
      }
      for (const id of drafts.keys()) if (!snapshot.birds.some(b => b.id === id)) drafts.delete(id)
      // A poll that began before a save must not overwrite the owner's newer draft.
      onSnapshot?.({ ...snapshot, birds: snapshot.birds.map(bird => ({ ...bird, ...(drafts.get(bird.id) ?? {}) })) })
      status(null)
    })
    queue = work.catch(() => {})
    return work
  }
  let timer: ReturnType<typeof setTimeout>
  const poll = async () => {
    try { await sync() }
    catch (error) { status(error instanceof Error ? error.message : SERVER_STORAGE ? '서버에 연결하지 못했어요.' : '브라우저에 저장된 비둘기를 불러오지 못했어요.') }
    if (!stopped) timer = setTimeout(poll, 3000)
  }
  void poll()
  return {
    async remove(owner: PigeonOwner) {
      // Serialize polling behind deletion and its animation; stale snapshots cannot resurrect it.
      const work = queue.then(async () => {
        if (SUPABASE_STORAGE) await supabaseFlock.remove(owner)
        else if (SERVER_STORAGE) await request(`/api/pigeons/${owner.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner.token}` } })
        else await localFlock.remove(owner)
        drafts.delete(owner.id)
        await world.remove(owner.id)
      })
      queue = work.catch(() => {})
      await work
      await sync()
    },
    async publish(face: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>) {
      const { encodeFace } = await import('./face')
      const id = crypto.randomUUID()
      let token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
      const asset = encodeFace(face)
      if (SUPABASE_STORAGE) {
        const owner = await supabaseFlock.save(id, asset)
        token = owner.token
      } else if (SERVER_STORAGE) {
        const body = JSON.stringify({ id, token, asset })
        const save = () => request<FlockSnapshot>('/api/pigeons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        try { await save() } catch { await save() }
      } else await localFlock.save(id, token, asset)
      rememberOwners([{ id, token }])
      try { await sync(id) }
      catch { status(SERVER_STORAGE ? '비둘기는 서버에 저장됐어요. 연결이 복구되면 광장에 표시됩니다.' : '비둘기는 브라우저에 저장됐어요. 새로고침하면 다시 불러옵니다.') }
      return { id, token }
    },
    previewSpeech(id: string, message: string, automatic: number[] = []) { drafts.set(id, { message, automatic }); world.say(id, message) },
    async say(owner: PigeonOwner, message: string, automatic: number[] = []) {
      if (SUPABASE_STORAGE) { await supabaseFlock.say(owner, message, automatic); return }
      if (!SERVER_STORAGE) { await localFlock.say(owner, message, automatic); return }
      await request(`/api/pigeons/${owner.id}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ message, automatic }) })
    },
    close() { stopped = true; clearTimeout(timer) },
  }
}
