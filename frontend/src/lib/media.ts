// Catalogue images live in Supabase Storage (bucket `product-images`).
//
// The database stores either a full URL (anything uploaded through the admin
// console) or a path inside that bucket such as "/plants/rose.webp" (the seeded
// catalogue). Paths resolve against whichever Supabase project the app points
// at, so the same seed data works locally and on the hosted project.

const SUPABASE_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').replace(/\/$/, '')
export const PRODUCT_BUCKET = 'product-images'

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (/^(https?:|data:|blob:)/.test(path)) return path
  return `${SUPABASE_URL}/storage/v1/object/public/${PRODUCT_BUCKET}/${path.replace(/^\/+/, '')}`
}
