import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Check, Lock, MapPin, Plus, Ticket, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Container } from '@/components/layout'
import { PlantImage } from '@/components/product'
import { Button, Card, EmptyState, Field, Input, Modal, Textarea } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { errorToast, keys, useCart } from '@/lib/queries'
import type { Address, CheckoutPreview, Order } from '@/lib/types'
import { cn, money } from '@/lib/utils'

export default function Checkout() {
  const cart = useCart()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const addresses = useQuery({ queryKey: keys.addresses, queryFn: () => api.get<Address[]>('/me/addresses') })
  const [addressId, setAddressId] = useState<number | null>(null)
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState<string | null>(null)
  const [points, setPoints] = useState(0)
  const [notes, setNotes] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId((addresses.data.find((a) => a.is_default) ?? addresses.data[0]).id)
  }, [addresses.data, addressId])

  // Live pricing straight from public.checkout_preview().
  const preview = useQuery({
    queryKey: ['checkout-preview', coupon, points, cart.data?.subtotal],
    queryFn: () => api.post<CheckoutPreview>('/checkout/preview', { coupon_code: coupon, points }),
    enabled: !!cart.data?.items.length,
    placeholderData: (p) => p,
    retry: false,
  })
  const couponError = preview.error instanceof ApiError && preview.error.code.startsWith('coupon') ? preview.error.message : null
  useEffect(() => {
    if (couponError) setCoupon(null)
  }, [couponError])
  const [lastCouponError, setLastCouponError] = useState<string | null>(null)
  useEffect(() => { if (couponError) setLastCouponError(couponError) }, [couponError])

  const place = useMutation({
    mutationFn: () => api.post<{ order: Order; payment_mode: string; checkout_url: string | null }>('/checkout', { address_id: addressId, coupon_code: coupon, points, notes: notes || null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.cart })
      qc.invalidateQueries({ queryKey: ['me'] })
      if (r.checkout_url) window.location.href = r.checkout_url
      else navigate(`/orders/${r.order.id}?pay=${r.payment_mode}`)
    },
    onError: errorToast,
  })

  if (cart.data && cart.data.items.length === 0 && !place.isSuccess) {
    return <Container className="pt-10"><EmptyState emoji="🛒" title="Nothing to check out" action={<Button onClick={() => navigate('/shop')}>Browse plants</Button>}>Your cart is empty.</EmptyState></Container>
  }

  const pv = preview.data
  return (
    <Container className="pt-6">
      <h1 className="mb-8 text-2xl font-semibold md:text-3xl">Checkout</h1>
      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-8">
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><MapPin className="size-5" /> Delivery address</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {addresses.data?.map((a) => (
                <button key={a.id} onClick={() => setAddressId(a.id)}
                  className={cn('relative rounded-xl border-2 bg-surface p-5 text-left transition', addressId === a.id ? 'border-primary' : 'border-line hover:border-fg/20')}>
                  {addressId === a.id && <span className="absolute top-4 right-4 grid size-6 place-items-center rounded-full bg-primary text-primary-fg"><Check className="size-4" /></span>}
                  <div className="font-semibold">{a.label}</div>
                  <div className="mt-1 text-sm text-muted">{a.recipient} · {a.phone}<br />{a.line1}{a.area ? `, ${a.area}` : ''}, {a.city}</div>
                </button>
              ))}
              <button onClick={() => setAddOpen(true)} className="grid min-h-28 place-items-center rounded-xl border-2 border-dashed border-line text-sm font-semibold text-muted hover:bg-surface">
                <span className="flex items-center gap-2"><Plus className="size-4" /> Add address</span>
              </button>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Card>
              <h3 className="mb-3 flex items-center gap-2 text-base font-semibold"><Ticket className="size-4" /> Coupon</h3>
              {coupon && pv?.coupon ? (
                <div className="flex items-center justify-between rounded-2xl bg-accent/30 px-4 py-3">
                  <div><div className="font-bold">{pv.coupon.code}</div><div className="text-xs">{pv.coupon.message} · −{money(pv.coupon.discount)}</div></div>
                  <button onClick={() => setCoupon(null)} aria-label="Remove coupon"><X className="size-4" /></button>
                </div>
              ) : (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setLastCouponError(null); setCoupon(couponInput.trim() || null) }}>
                  <Input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} placeholder="WELCOME10" className="uppercase" />
                  <Button type="submit" variant="soft">Apply</Button>
                </form>
              )}
              {lastCouponError && !coupon && <p className="mt-2 text-xs text-danger">{lastCouponError}</p>}
            </Card>
            <Card>
              <h3 className="mb-1 text-base font-semibold">Leaf Points</h3>
              <p className="mb-3 text-xs text-muted">Balance {pv?.points_balance ?? 0} · up to {pv?.max_redeemable_points ?? 0} usable (1 pt = ৳1)</p>
              <input type="range" min={0} max={pv?.max_redeemable_points ?? 0} value={Math.min(points, pv?.max_redeemable_points ?? 0)}
                onChange={(e) => setPoints(Number(e.target.value))} disabled={!pv?.max_redeemable_points} className="w-full accent-[var(--color-forest-500)]" />
              <div className="mt-1 text-sm font-semibold">Using {Math.min(points, pv?.max_redeemable_points ?? 0)} points</div>
            </Card>
          </section>

          <Field label="Delivery notes (optional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate code, best time to deliver…" maxLength={500} /></Field>
        </div>

        <aside>
          <div className="sticky top-28 rounded-2xl border border-line bg-surface p-6">
            <h2 className="mb-5 text-lg font-semibold">Order summary</h2>
            <ul className="mb-6 space-y-3">
              {cart.data?.items.map((it) => (
                <li key={it.id} className="flex items-center gap-3">
                  <div className="relative">
                    <PlantImage src={it.image_url} alt="" className="size-14 rounded-2xl" imgClassName="p-1" />
                    <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-fg text-[11px] font-bold text-bg">{it.quantity}</span>
                  </div>
                  <span className="flex-1 text-sm font-medium">{it.name}</span>
                  <span className="text-sm font-semibold">{money(it.line_total)}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-2 border-t border-line pt-4 text-sm">
              <Row label="Subtotal" value={money(pv?.subtotal ?? cart.data?.subtotal)} />
              {!!pv?.discount && <Row label={`Coupon ${pv.coupon?.code ?? ''}`} value={`−${money(pv.discount)}`} accent />}
              {!!pv?.points_redeemed && <Row label="Leaf Points" value={`−${money(pv.points_redeemed)}`} accent />}
              <Row label="Delivery" value={pv?.shipping_fee ? money(pv.shipping_fee) : 'Free'} />
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="font-semibold">Total</span>
              <motion.span key={pv?.total} initial={{ scale: 1.1 }} animate={{ scale: 1 }} className="text-2xl font-semibold">{money(pv?.total ?? cart.data?.total)}</motion.span>
            </div>
            <Button size="lg" className="mt-6 w-full" disabled={!addressId || pv?.payment_mode === 'unavailable'} loading={place.isPending} onClick={() => place.mutate()}>
              <Lock className="size-4" /> {pv?.payment_mode === 'stripe' ? 'Pay securely with Stripe' : 'Place order'}
            </Button>
            <p className="mt-3 text-center text-xs text-muted">
              {pv?.payment_mode === 'demo' ? 'Demo payments mode — no real card needed.' : 'Your plants are reserved for 30 minutes while you pay.'}
            </p>
          </div>
        </aside>
      </div>
      <AddressModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={(a) => setAddressId(a.id)} />
    </Container>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className="flex justify-between"><dt className="text-muted">{label}</dt><dd className={cn('font-semibold', accent && 'text-forest-500 dark:text-lime-glow')}>{value}</dd></div>
}

export function AddressModal({ open, onClose, onSaved, initial }: { open: boolean; onClose: () => void; onSaved?: (a: Address) => void; initial?: Address }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ label: 'Home', recipient: '', phone: '+880', line1: '', area: '', city: 'Dhaka', postal_code: '' })
  useEffect(() => {
    if (initial) setForm({ label: initial.label, recipient: initial.recipient, phone: initial.phone, line1: initial.line1, area: initial.area ?? '', city: initial.city, postal_code: initial.postal_code ?? '' })
  }, [initial])
  const save = useMutation({
    mutationFn: () => (initial ? api.patch<Address>(`/me/addresses/${initial.id}`, form) : api.post<Address>('/me/addresses', form)),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: keys.addresses })
      onSaved?.(a)
      onClose()
    },
    onError: errorToast,
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit address' : 'New address'}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Field label="Label"><Input value={form.label} onChange={set('label')} /></Field>
        <Field label="Recipient"><Input required value={form.recipient} onChange={set('recipient')} /></Field>
        <Field label="Phone" className="sm:col-span-2"><Input required value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input required value={form.line1} onChange={set('line1')} placeholder="House, road" /></Field>
        <Field label="Area"><Input value={form.area} onChange={set('area')} placeholder="Dhanmondi" /></Field>
        <Field label="City"><Input required value={form.city} onChange={set('city')} /></Field>
        <Button type="submit" size="lg" className="sm:col-span-2" loading={save.isPending}>Save address</Button>
      </form>
    </Modal>
  )
}
