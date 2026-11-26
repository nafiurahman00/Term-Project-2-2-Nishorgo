import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PackagePlus, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { PlantImage } from '@/components/product'
import { Badge, Button, Drawer, Field, Input, Modal, PageHeader, Select, Skeleton, Switch, Textarea } from '@/components/ui'
import { api } from '@/lib/api'
import { errorToast } from '@/lib/queries'
import { uploadImage } from '@/lib/supabase'
import type { Difficulty, Light, Paged, ProductCard, ProductDetail } from '@/lib/types'
import { cn, DIFFICULTY_LABEL, LIGHT_LABEL, money, timeAgo } from '@/lib/utils'
import { useAuth } from '@/providers/AuthProvider'

type AdminProduct = ProductCard & { is_active: boolean; low_stock_threshold: number; wishlist_count: number; updated_at: string; stock_30d: { at: string; delta: number; reason: string }[] }

export default function AdminProducts() {
  const [params, setParams] = useSearchParams()
  const stock = params.get('stock') ?? ''
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<AdminProduct | 'new' | null>(null)
  const [restocking, setRestocking] = useState<AdminProduct | null>(null)
  const list = useQuery({
    queryKey: ['admin', 'products', stock, q],
    queryFn: () => api.get<Paged<AdminProduct>>('/admin/products', { stock: stock || undefined, q: q || undefined, per_page: 100 }),
    placeholderData: (p) => p,
  })

  return (
    <>
      <PageHeader eyebrow="Catalog" title="Inventory" actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> New plant</Button>}>
        Products, prices and stock levels.
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[['', 'All'], ['low', 'Low stock'], ['out', 'Sold out'], ['inactive', 'Hidden']].map(([v, l]) => (
          <button key={v} onClick={() => setParams(v ? { stock: v } : {})} className={cn('rounded-full px-3 py-1.5 text-sm font-medium', stock === v ? 'bg-primary text-primary-fg' : 'bg-surface text-muted hover:text-fg')}>{l}</button>
        ))}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plants" className="h-10 w-56 pl-9" />
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted uppercase">
            <tr><th className="px-4 py-3">Plant</th><th className="px-4 py-3 text-right">Price</th><th className="px-4 py-3 text-right">Stock</th><th className="px-4 py-3">30-day movement</th><th className="px-4 py-3 text-right">Sold</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.isLoading && <tr><td colSpan={7} className="p-4"><Skeleton className="h-40" /></td></tr>}
            {list.data?.items.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2/50">
                <td className="px-4 py-2.5">
                  <button onClick={() => setEditing(p)} className="flex items-center gap-3 text-left">
                    <PlantImage src={p.image_url} alt="" className="size-11 rounded-xl" imgClassName="p-0.5" />
                    <div><div className="font-semibold hover:underline">{p.name}</div><div className="text-xs text-muted">{p.category.name} · ♥ {p.wishlist_count}</div></div>
                  </button>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(p.price)}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className={cn('font-semibold tabular-nums', p.stock === 0 ? 'text-danger' : p.stock <= p.low_stock_threshold && 'text-amber-600')}>{p.stock}</span>
                </td>
                <td className="px-4 py-2.5"><StockSpark moves={p.stock_30d} current={p.stock} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{p.sold_count}</td>
                <td className="px-4 py-2.5">{p.is_active ? <Badge className="bg-forest-50 text-forest-700 dark:bg-lime-glow/10 dark:text-lime-glow">Live</Badge> : <Badge>Hidden</Badge>}</td>
                <td className="px-4 py-2.5 text-right"><Button size="sm" variant="soft" onClick={() => setRestocking(p)}><PackagePlus className="size-4" /> Restock</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ProductDrawer product={editing} onClose={() => setEditing(null)} />
      <RestockModal product={restocking} onClose={() => setRestocking(null)} />
    </>
  )
}

/** Tiny stock-level line reconstructed backwards from the ledger. */
function StockSpark({ moves, current }: { moves: { delta: number }[]; current: number }) {
  if (moves.length === 0) return <span className="text-xs text-muted">no movement</span>
  const levels: number[] = [current]
  for (let i = moves.length - 1; i >= 0; i--) levels.unshift(levels[0] - moves[i].delta)
  const max = Math.max(...levels, 1)
  const w = 110, h = 26
  const pts = levels.map((v, i) => `${(i / (levels.length - 1 || 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(' ')
  return (
    <svg width={w} height={h} aria-label={`Stock trend, now ${current}`}>
      <polyline points={pts} fill="none" stroke="var(--color-series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function RestockModal({ product, onClose }: { product: AdminProduct | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [delta, setDelta] = useState(10)
  const [reason, setReason] = useState('restock')
  const [note, setNote] = useState('')
  const history = useQuery({
    queryKey: ['admin', 'inventory', product?.id],
    queryFn: () => api.get<{ id: number; delta: number; reason: string; note: string | null; at: string; balance: number; by: string | null }[]>(`/admin/products/${product!.id}/inventory`),
    enabled: !!product,
  })
  const save = useMutation({
    mutationFn: () => api.post<{ stock: number }>(`/admin/products/${product!.id}/restock`, { delta: reason === 'restock' ? Math.abs(delta) : -Math.abs(delta), reason, note: note || null }),
    onSuccess: (r) => {
      toast.success(`${product!.name}: stock now ${r.stock}`)
      qc.invalidateQueries({ queryKey: ['admin'] })
      onClose()
    },
    onError: errorToast,
  })
  return (
    <Modal open={!!product} onClose={onClose} title={`Stock · ${product?.name ?? ''}`}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type"><Select value={reason} onChange={(e) => setReason(e.target.value)}><option value="restock">Restock (+)</option><option value="damage">Damaged (−)</option><option value="adjustment">Count adjustment (−)</option></Select></Field>
        <Field label="Quantity"><Input type="number" min={1} value={delta} onChange={(e) => setDelta(Number(e.target.value))} /></Field>
        <Field label="Note" className="col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Supplier delivery #42" /></Field>
      </div>
      <Button className="mt-4 w-full" loading={save.isPending} onClick={() => save.mutate()}>Record movement</Button>
      <div className="mt-6 text-sm font-semibold">Ledger</div>
      <div className="mt-2 max-h-60 overflow-y-auto">
        <table className="w-full text-xs">
          <tbody className="divide-y divide-line">
            {history.data?.map((m) => (
              <tr key={m.id}><td className="py-1.5 text-muted">{timeAgo(m.at)}</td><td className="py-1.5 capitalize">{m.reason}</td><td className={cn('py-1.5 text-right font-semibold tabular-nums', m.delta > 0 ? 'text-forest-500' : 'text-danger')}>{m.delta > 0 ? '+' : ''}{m.delta}</td><td className="py-1.5 text-right tabular-nums">= {m.balance}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

const empty = { name: '', scientific_name: '', category: 'flowering', short_description: '', description: '', price: 300, compare_at_price: '' as number | string, stock: 10, low_stock_threshold: 5, image_url: '', light: 'bright_indirect' as Light, difficulty: 'easy' as Difficulty, water_every_days: 3, fertilize_every_days: '' as number | string, pet_friendly: false, air_purifying: false, edible: false, tags: '', is_active: true, is_featured: false }

function ProductDrawer({ product, onClose }: { product: AdminProduct | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [f, setF] = useState(empty)
  const detail = useQuery({ queryKey: ['product', product !== 'new' ? product?.slug : ''], queryFn: () => api.get<ProductDetail>(`/products/${(product as AdminProduct).slug}`), enabled: !!product && product !== 'new' })
  useEffect(() => {
    if (product === 'new') setF(empty)
    else if (detail.data && product) {
      const d = detail.data
      setF({ name: d.name, scientific_name: d.scientific_name ?? '', category: d.category.slug, short_description: d.short_description ?? '', description: d.description ?? '', price: d.price, compare_at_price: d.compare_at_price ?? '', stock: d.stock, low_stock_threshold: product.low_stock_threshold, image_url: d.image_url ?? '', light: d.light, difficulty: d.difficulty, water_every_days: d.water_every_days, fertilize_every_days: d.fertilize_every_days ?? '', pet_friendly: d.pet_friendly, air_purifying: d.air_purifying, edible: d.edible, tags: d.tags.join(', '), is_active: product.is_active, is_featured: d.is_featured })
    }
  }, [product, detail.data])
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, compare_at_price: f.compare_at_price === '' ? null : Number(f.compare_at_price), fertilize_every_days: f.fertilize_every_days === '' ? null : Number(f.fertilize_every_days), tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), image_url: f.image_url || null }
      return product === 'new' ? api.post('/admin/products', body) : api.patch(`/admin/products/${(product as AdminProduct).id}`, body)
    },
    onSuccess: () => {
      toast.success('Saved — change recorded in the audit log')
      qc.invalidateQueries({ queryKey: ['admin'] })
      qc.invalidateQueries({ queryKey: ['product'] })
      onClose()
    },
    onError: errorToast,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  return (
    <Drawer open={!!product} onClose={onClose} title={product === 'new' ? 'New plant' : 'Edit plant'} className="max-w-2xl"
      footer={<Button size="lg" className="w-full" loading={save.isPending} onClick={() => save.mutate()}>Save plant</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-center gap-4 sm:col-span-2">
          <PlantImage src={f.image_url || null} alt="" className="size-24 rounded-2xl" />
          <Field label="Image" hint="Uploads to the product-images bucket" className="flex-1">
            <Input type="file" accept="image/*" className="pt-2.5" onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file || !user) return
              try { set('image_url', await uploadImage('product-images', file, user.id)) } catch (err) { errorToast(err) }
            }} />
          </Field>
        </div>
        <Field label="Name"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Scientific name"><Input value={f.scientific_name} onChange={(e) => set('scientific_name', e.target.value)} /></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => set('category', e.target.value)}><option value="flowering">Flowering</option><option value="fruit-trees">Fruit trees</option><option value="vegetables">Kitchen garden</option><option value="herbs-greens">Herbs & greens</option></Select></Field>
        <Field label="Tags" hint="Comma separated"><Input value={f.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
        <Field label="Price (৳)"><Input type="number" value={f.price} onChange={(e) => set('price', Number(e.target.value))} /></Field>
        <Field label="Compare-at price" hint="Shows a sale badge"><Input type="number" value={f.compare_at_price} onChange={(e) => set('compare_at_price', e.target.value)} /></Field>
        <Field label="Stock" hint="Changes are logged as stock adjustments"><Input type="number" value={f.stock} onChange={(e) => set('stock', Number(e.target.value))} /></Field>
        <Field label="Low-stock alert at"><Input type="number" value={f.low_stock_threshold} onChange={(e) => set('low_stock_threshold', Number(e.target.value))} /></Field>
        <Field label="Light"><Select value={f.light} onChange={(e) => set('light', e.target.value as Light)}>{Object.entries(LIGHT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Care level"><Select value={f.difficulty} onChange={(e) => set('difficulty', e.target.value as Difficulty)}>{Object.entries(DIFFICULTY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Water every (days)"><Input type="number" value={f.water_every_days} onChange={(e) => set('water_every_days', Number(e.target.value))} /></Field>
        <Field label="Fertilize every (days)"><Input type="number" value={f.fertilize_every_days} onChange={(e) => set('fertilize_every_days', e.target.value)} /></Field>
        <Field label="Short description" className="sm:col-span-2"><Input value={f.short_description} maxLength={200} onChange={(e) => set('short_description', e.target.value)} /></Field>
        <Field label="Description (Markdown)" className="sm:col-span-2"><Textarea rows={6} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <Switch checked={f.pet_friendly} onChange={(v) => set('pet_friendly', v)} label="Pet safe" />
          <Switch checked={f.air_purifying} onChange={(v) => set('air_purifying', v)} label="Air purifying" />
          <Switch checked={f.edible} onChange={(v) => set('edible', v)} label="Edible" />
          <Switch checked={f.is_featured} onChange={(v) => set('is_featured', v)} label="Staff pick" />
          <Switch checked={f.is_active} onChange={(v) => set('is_active', v)} label="Visible in shop" />
        </div>
      </div>
    </Drawer>
  )
}
