import type { PigeonOwner } from './pigeon-data'
import { OWNER_KEY } from './storage-mode'

const prefix = `${OWNER_KEY}:`
const session = new Map<string, PigeonOwner>()
const valid = (value: unknown): value is PigeonOwner => {
  if (!value || typeof value !== 'object') return false
  const owner = value as PigeonOwner
  return typeof owner.id === 'string' && /^[a-f0-9-]{36}$/i.test(owner.id) && typeof owner.token === 'string' && /^[a-f0-9]{64}$/.test(owner.token)
}

export function rememberOwners(owners: PigeonOwner[]) {
  for (const owner of owners) {
    if (!valid(owner)) continue
    session.set(owner.id, { ...owner })
    // Separate keys keep simultaneous captures in different tabs from overwriting each other.
    try { localStorage.setItem(prefix + owner.id, JSON.stringify(owner)) } catch { /* Session-only ownership. */ }
  }
}

export function readOwners(): Map<string, PigeonOwner> {
  try {
    const legacy: unknown = JSON.parse(localStorage.getItem(OWNER_KEY) ?? 'null')
    if (valid(legacy)) rememberOwners([legacy])
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      try {
        const owner: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (valid(owner)) session.set(owner.id, owner)
      } catch { /* Ignore a damaged entry without losing other pigeons. */ }
    }
  } catch { /* Session-only ownership. */ }
  return new Map(session)
}
