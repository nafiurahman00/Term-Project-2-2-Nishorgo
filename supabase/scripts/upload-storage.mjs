#!/usr/bin/env node
// Upload the catalogue photos in supabase/storage/product-images to a Supabase
// project's `product-images` bucket. Signs in as a staff/admin account, so no
// service-role key is needed: the bucket's RLS policy lets staff write to it.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_KEY=<publishable key> \
//   STAFF_EMAIL=admin@nishorgo.test STAFF_PASSWORD=... \
//   node supabase/scripts/upload-storage.mjs
//
// Re-running is safe: existing objects are overwritten (x-upsert).
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const { SUPABASE_URL, SUPABASE_KEY, STAFF_EMAIL, STAFF_PASSWORD } = process.env
if (!SUPABASE_URL || !SUPABASE_KEY || !STAFF_EMAIL || !STAFF_PASSWORD) {
  console.error('Set SUPABASE_URL, SUPABASE_KEY, STAFF_EMAIL and STAFF_PASSWORD.')
  process.exit(1)
}
const BUCKET = 'product-images'
const ROOT = fileURLToPath(new URL(`../storage/${BUCKET}`, import.meta.url))
const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.avif': 'image/avif' }
const base = SUPABASE_URL.replace(/\/$/, '')

async function walk(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else if (TYPES[extname(e.name).toLowerCase()]) out.push(p)
  }
  return out
}

const auth = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: STAFF_EMAIL, password: STAFF_PASSWORD }),
}).then((r) => r.json())
if (!auth.access_token) {
  console.error('Sign-in failed:', auth.msg ?? auth.error_description ?? auth)
  process.exit(1)
}

const files = await walk(ROOT)
let done = 0
const failed = []
async function upload(file) {
  const key = relative(ROOT, file).split('\\').join('/')
  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${auth.access_token}`,
      'Content-Type': TYPES[extname(file).toLowerCase()],
      'Cache-Control': 'max-age=31536000',
      'x-upsert': 'true',
    },
    body: await readFile(file),
  })
  if (!res.ok) failed.push(`${key}: ${res.status} ${(await res.text()).slice(0, 120)}`)
  if (++done % 20 === 0 || done === files.length) console.log(`${done}/${files.length}`)
}

// A few uploads at a time.
const queue = [...files]
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await upload(queue.shift()) }))

console.log(`Uploaded ${files.length - failed.length} of ${files.length} files to ${BUCKET}.`)
if (failed.length) {
  console.error(failed.join('\n'))
  process.exit(1)
}
