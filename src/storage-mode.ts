// Local experiments are the default. Server persistence is an explicit opt-in.
export const SERVER_STORAGE = import.meta.env.VITE_STORAGE_MODE === 'server'
export const SUPABASE_STORAGE = import.meta.env.VITE_STORAGE_MODE === 'supabase'
export const OWNER_KEY = SUPABASE_STORAGE ? 'pigeon-owner-supabase-v1' : SERVER_STORAGE ? 'pigeon-owner-v1' : 'pigeon-owner-local-v1'
