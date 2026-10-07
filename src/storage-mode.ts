// Local experiments are the default. Server persistence is an explicit opt-in.
export const SERVER_STORAGE = import.meta.env.VITE_STORAGE_MODE === 'server'
export const OWNER_KEY = SERVER_STORAGE ? 'pigeon-owner-v1' : 'pigeon-owner-local-v1'
