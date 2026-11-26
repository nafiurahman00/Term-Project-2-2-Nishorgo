import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Switch } from '@/components/ui'
import { api } from '@/lib/api'
import { errorToast } from '@/lib/queries'
import { date, money } from '@/lib/utils'

interface Coupon {
  id: number; code: string; description: string | null; kind: 'percent' | 'fixed'; value: number; min_subtotal: number
  max_discount: number | null; starts_at: string; ends_at: string | null; usage_limit: number | null; per_user_limit: number
  times_used: number; is_active: boolean; is_live: boolean
}

export default function AdminCoupons() {
  const list = useQuery({ queryKey: ['admin', 'coupons'], queryFn: () => api.get<Coupon[]>('/admin/coupons') })
  const [editing, setEditing] = useState<Partial<Coupon> | null>(null)
  return (
    <>
      <PageHeader eyebrow="Promotions" title="Coupons" actions={<Button onClick={() => setEditing({ kind: 'percent', value: 10, per_user_limit: 1, is_active: true })}><Plus className="size-4" /> New coupon</Button>}>
        Discount codes for promotions and loyal customers.
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.data?.map((c) => (
          <Card key={c.id} className="relative overflow-hidden">
            <button className="absolute inset-0" onClick={() => setEditing(c)} aria-label={`Edit ${c.code}`} />
            <div className="flex items-start justify-between">
              <div className="font-mono text-2xl font-bold">{c.code}</div>
              {c.is_live ? <Badge className="bg-forest-50 text-forest-700 dark:bg-lime-glow/10 dark:text-lime-glow">● Live</Badge> : <Badge>Inactive</Badge>}
            </div>
            <div className="mt-1 text-2xl font-semibold">{c.kind === 'percent' ? `${Number(c.value)}%` : money(c.value)} <span className="text-base text-muted">off</span></div>
            <p className="mt-2 text-sm text-muted">{c.description}</p>
            <div className="mt-4 space-y-1 text-xs text-muted">
              <div>Min. spend {money(c.min_subtotal)}{c.max_discount ? ` · max ${money(c.max_discount)}` : ''}</div>
              <div>{c.ends_at ? `Ends ${date(c.ends_at)}` : 'No end date'} · {c.per_user_limit} per customer</div>
            </div>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs"><span>Used {c.times_used}{c.usage_limit ? ` / ${c.usage_limit}` : ''}</span></div>
              {c.usage_limit && <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-series-1" style={{ width: `${Math.min(100, (c.times_used / c.usage_limit) * 100)}%` }} /></div>}
            </div>
          </Card>
        ))}
      </div>
      <CouponModal coupon={editing} onClose={() => setEditing(null)} />
    </>
  )
}

function CouponModal({ coupon, onClose }: { coupon: Partial<Coupon> | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<Partial<Coupon>>({})
  const [prev, setPrev] = useState<Partial<Coupon> | null>(null)
  if (coupon !== prev) { setPrev(coupon); setF(coupon ?? {}) }
  const save = useMutation({
    mutationFn: () => api.post('/admin/coupons', { ...f, ends_at: f.ends_at || null, max_discount: f.max_discount || null, usage_limit: f.usage_limit || null }),
    onSuccess: () => { toast.success('Coupon saved'); qc.invalidateQueries({ queryKey: ['admin'] }); onClose() },
    onError: errorToast,
  })
  const set = <K extends keyof Coupon>(k: K, v: Coupon[K] | undefined) => setF((x) => ({ ...x, [k]: v }))
  return (
    <Modal open={!!coupon} onClose={onClose} title={coupon?.id ? `Edit ${coupon.code}` : 'New coupon'}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Code" className="col-span-2"><Input value={f.code ?? ''} disabled={!!coupon?.id} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="SPRING20" className="font-mono uppercase" /></Field>
        <Field label="Description" className="col-span-2"><Input value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Type"><Select value={f.kind} onChange={(e) => set('kind', e.target.value as Coupon['kind'])}><option value="percent">Percent</option><option value="fixed">Fixed ৳</option></Select></Field>
        <Field label="Value"><Input type="number" value={f.value ?? ''} onChange={(e) => set('value', Number(e.target.value))} /></Field>
        <Field label="Min. spend ৳"><Input type="number" value={f.min_subtotal ?? 0} onChange={(e) => set('min_subtotal', Number(e.target.value))} /></Field>
        <Field label="Max discount ৳"><Input type="number" value={f.max_discount ?? ''} onChange={(e) => set('max_discount', e.target.value ? Number(e.target.value) : null)} /></Field>
        <Field label="Total uses"><Input type="number" value={f.usage_limit ?? ''} onChange={(e) => set('usage_limit', e.target.value ? Number(e.target.value) : null)} placeholder="Unlimited" /></Field>
        <Field label="Per customer"><Input type="number" value={f.per_user_limit ?? 1} onChange={(e) => set('per_user_limit', Number(e.target.value))} /></Field>
        <Field label="Ends" className="col-span-2"><Input type="date" value={f.ends_at?.slice(0, 10) ?? ''} onChange={(e) => set('ends_at', e.target.value || null)} /></Field>
        <div className="col-span-2"><Switch checked={!!f.is_active} onChange={(v) => set('is_active', v)} label="Active" /></div>
      </div>
      <Button size="lg" className="mt-6 w-full" loading={save.isPending} onClick={() => save.mutate()}>Save coupon</Button>
    </Modal>
  )
}
