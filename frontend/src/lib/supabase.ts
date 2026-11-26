import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
// Supabase's new "publishable" key or the legacy anon key — both are public.
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const supabaseConfigured = Boolean(url && key)

if (!supabaseConfigured) {
  console.warn('[nishorgo] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set — auth and realtime are disabled.')
}

/**
 * Used for: Auth (sessions, OAuth, magic links), Realtime (postgres_changes,
 * broadcast, presence) and Storage uploads. All data reads/writes go through
 * the PHP API, which applies the same identity in Postgres.
 */
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'public-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  realtime: { params: { eventsPerSecond: 20 } },
})

/** Upload a public image to a bucket under the user's own folder (RLS: <uid>/...). */
export async function uploadImage(bucket: 'avatars' | 'review-photos' | 'garden-photos' | 'product-images', file: File, userId: string) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Images must be under 5 MB')
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const folder = bucket === 'product-images' ? 'catalog' : userId
  const path = `${folder}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { cacheControl: '31536000', upsert: false })
  if (error) throw error
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}
