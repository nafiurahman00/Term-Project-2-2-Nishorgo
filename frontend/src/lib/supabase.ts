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

/**
 * Shrink a photo in the browser before upload: longest side ≤ maxSide, re-encoded
 * as WebP. A 6 MB phone photo typically becomes ~150–300 KB. Falls back to the
 * original file if the browser can't decode or encode it.
 */
async function compressImage(file: File, maxSide = 1600, quality = 0.85): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    return blob && blob.type === 'image/webp' && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

/**
 * Upload a catalogue photo to the `product-images` bucket (staff only, enforced by
 * a Storage RLS policy) and return its public URL.
 */
export async function uploadProductImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} isn't an image`)
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is over 20 MB`)
  const body = await compressImage(file)
  if (body.size > 5 * 1024 * 1024) throw new Error(`${file.name} is still over 5 MB after resizing`)
  const ext = body.type === 'image/webp' ? 'webp' : (file.name.split('.').pop()?.toLowerCase() ?? 'jpg')
  const path = `catalog/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('product-images')
    .upload(path, body, { cacheControl: '31536000', contentType: body.type || file.type, upsert: false })
  if (error) throw error
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl
}

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
