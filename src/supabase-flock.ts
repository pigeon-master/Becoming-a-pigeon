import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { FaceAsset, FlockSnapshot, PigeonOwner } from './pigeon-data'
import { rememberOwners } from './ownership'
import { validSpeech } from './speech-text'

let client: SupabaseClient, signingIn: Promise<User> | undefined
const metadata = 'id,owner_id,sequence,created_at,replaces,message,automatic'
function database() {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Supabase URL과 공개 API 키를 설정해 주세요.')
  if (key.startsWith('sb_secret_')) throw new Error('Supabase secret 키는 브라우저에서 사용할 수 없습니다. publishable 키를 사용해 주세요.')
  client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  return client
}
async function currentUser() {
  const { data, error } = await database().auth.getSession()
  if (error) throw new Error(`Supabase 인증 확인 실패: ${error.message}`)
  return data.session?.user
}
async function ensureUser() {
  const existing = await currentUser()
  if (existing) return existing
  signingIn ??= (async () => {
    const signIn = async () => {
      const user = await currentUser()
      if (user) return user
      const { data, error } = await database().auth.signInAnonymously()
      if (error || !data.user) throw new Error(`Supabase 익명 접속 실패: ${error?.message ?? '사용자 ID가 없습니다.'} Anonymous Sign-Ins 설정을 확인해 주세요.`)
      return data.user
    }
    // Keep simultaneous captures in two tabs on the same anonymous identity.
    return navigator.locks ? navigator.locks.request('pigeon-supabase-sign-in', signIn) : signIn()
  })().finally(() => { signingIn = undefined })
  return signingIn
}
function ownerFor(id: string, user: User): PigeonOwner {
  // Compatibility marker for existing UI. Authorization always uses Supabase's JWT/RLS.
  return { id, token: user.id.replaceAll('-', '').repeat(2) }
}

export const supabaseFlock = {
  async snapshot(): Promise<FlockSnapshot> {
    const user = await currentUser()
    const { data, error } = await database().from('pigeons').select(metadata).order('sequence')
    if (error) throw new Error(`Supabase 불러오기 실패: ${error.message}`)
    const owned = (data ?? []).filter(row => row.owner_id === user?.id)
    if (user) rememberOwners(owned.map(row => ownerFor(row.id, user)))
    return {
      revision: Math.max(0, ...(data ?? []).map(row => Number(row.sequence))),
      birds: (data ?? []).map(row => ({ id: row.id, createdAt: Date.parse(row.created_at), replaces: row.replaces,
        message: row.message, automatic: row.automatic ?? [], owned: row.owner_id === user?.id })),
    }
  },
  async get(id: string): Promise<FaceAsset | null> {
    const { data, error } = await database().from('pigeons').select('asset').eq('id', id).maybeSingle()
    if (error) throw new Error(`비둘기 불러오기 실패: ${error.message}`)
    return data?.asset ?? null
  },
  async save(id: string, asset: FaceAsset): Promise<PigeonOwner> {
    const user = await ensureUser()
    const { error } = await database().rpc('create_pigeon', { pigeon_id: id, face_asset: asset })
    if (error) throw new Error(`비둘기 저장 실패: ${error.message}`)
    return ownerFor(id, user)
  },
  async say(owner: PigeonOwner, message: string, automatic: number[] = []) {
    if (!validSpeech(message, automatic)) throw new Error('직접 입력한 글자는 공백 포함 50자까지 가능합니다.')
    const { data, error } = await database().from('pigeons').update({ message, automatic }).eq('id', owner.id).select('id')
    if (error) throw new Error(`말풍선 저장 실패: ${error.message}`)
    if (!data?.length) throw new Error('본인 비둘기의 말풍선만 수정할 수 있습니다. 이미 교체되거나 삭제되었을 수도 있습니다.')
  },
  async remove(owner: PigeonOwner) {
    const { data, error } = await database().from('pigeons').delete().eq('id', owner.id).select('id')
    if (error) throw new Error(`비둘기 삭제 실패: ${error.message}`)
    if (!data?.length) throw new Error('본인 비둘기만 삭제할 수 있습니다. 이미 교체되거나 삭제되었을 수도 있습니다.')
  },
}
