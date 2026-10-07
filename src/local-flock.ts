import type { FaceAsset, FlockSnapshot, PigeonOwner, PigeonRecord } from './pigeon-data'
import { validSpeech } from './speech-text'

interface StoredBird extends PigeonRecord { sequence: number; token: string; asset: FaceAsset }
let database: Promise<IDBDatabase> | undefined
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pigeon-local-v1', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('birds', { keyPath: 'id' })
      request.result.createObjectStore('requests', { keyPath: 'id' })
      request.result.createObjectStore('state')
    }
    request.onerror = () => reject(new Error('브라우저 저장소를 열지 못했어요. 사이트 데이터 저장을 허용해 주세요.'))
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined }
      resolve(request.result)
    }
  }).catch(error => { database = undefined; throw error })
  return database
}
function read<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
}
function complete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(new Error('브라우저에 저장하지 못했어요. 저장 공간과 사이트 데이터 설정을 확인해 주세요.'))
  })
}
export const localFlock = {
  async owners(): Promise<PigeonOwner[]> {
    const db = await openDatabase()
    const birds = await read(db.transaction('birds').objectStore('birds').getAll() as IDBRequest<StoredBird[]>)
    // Local mode only contains captures made in this browser, including pre-upgrade captures.
    return birds.map(({ id, token }) => ({ id, token }))
  },
  async remove(owner: PigeonOwner) {
    const db = await openDatabase(), tx = db.transaction(['birds', 'state'], 'readwrite')
    const done = complete(tx), birds = tx.objectStore('birds'), state = tx.objectStore('state')
    let denied = false
    const request = birds.get(owner.id)
    request.onsuccess = () => {
      const bird = request.result as StoredBird | undefined
      if (!bird) return // An already removed pigeon stays removed on retries.
      if (bird.token !== owner.token) { denied = true; return }
      birds.delete(owner.id)
      const revision = state.get('revision')
      revision.onsuccess = () => state.put(Number(revision.result ?? 0) + 1, 'revision')
    }
    await done
    if (denied) throw new Error('본인이 만든 비둘기만 삭제할 수 있어요.')
  },
  async snapshot(): Promise<FlockSnapshot> {
    const db = await openDatabase(), tx = db.transaction(['birds', 'state'])
    const [all, revision] = await Promise.all([read(tx.objectStore('birds').getAll() as IDBRequest<StoredBird[]>), read(tx.objectStore('state').get('revision'))])
    return { revision: revision ?? 0, birds: all.sort((a, b) => a.sequence - b.sequence).map(({ id, createdAt, replaces, message, automatic }) => ({ id, createdAt, replaces, message, automatic: automatic ?? [] })) }
  },
  async get(id: string): Promise<FaceAsset | null> {
    const db = await openDatabase()
    const bird = await read(db.transaction('birds').objectStore('birds').get(id) as IDBRequest<StoredBird | undefined>)
    return bird?.asset ?? null
  },
  async save(id: string, token: string, asset: FaceAsset) {
    const db = await openDatabase(), tx = db.transaction(['birds', 'requests', 'state'], 'readwrite')
    const done = complete(tx), birds = tx.objectStore('birds'), requests = tx.objectStore('requests'), state = tx.objectStore('state')
    // Keep the check, FIFO eviction and write in one transaction across browser tabs.
    const existing = requests.get(id)
    existing.onsuccess = () => {
      if (existing.result) return
      const revision = state.get('revision')
      revision.onsuccess = () => {
        const all = birds.getAll()
        all.onsuccess = () => {
          const flock = (all.result as StoredBird[]).sort((a, b) => a.sequence - b.sequence)
          const replaces = flock.length >= 40 ? flock[0].id : null
          const sequence = Number(revision.result ?? 0) + 1
          if (replaces) birds.delete(replaces)
          birds.put({ id, token, asset, sequence, replaces, createdAt: Date.now(), message: '' } satisfies StoredBird)
          requests.put({ id }); state.put(sequence, 'revision')
        }
      }
    }
    await done
  },
  async say(owner: PigeonOwner, message: string, automatic: number[] = []) {
    if (!validSpeech(message, automatic)) throw new Error('직접 입력한 글자는 공백 포함 50자까지 사용할 수 있어요.')
    const db = await openDatabase(), tx = db.transaction('birds', 'readwrite')
    const done = complete(tx), store = tx.objectStore('birds'), request = store.get(owner.id)
    let allowed = false
    request.onsuccess = () => {
      const bird = request.result as StoredBird | undefined
      if (!bird || bird.token !== owner.token) return
      allowed = true; store.put({ ...bird, message, automatic })
    }
    await done
    if (!allowed) throw new Error('이 비둘기는 이미 교체됐어요. 새 비둘기를 만들어 주세요.')
  },
}
