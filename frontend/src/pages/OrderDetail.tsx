import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Check, Clock, CreditCard, MessageCircle, Package, Sprout, Truck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Container } from '@/components/layout'
import { PlantImage } from '@/components/product'
import { Badge, Button, Card, Field, Input, Modal, Skeleton } from '@/components/ui'
import { useOrderLive } from '@/hooks/useRealtime'
import { api } from '@/lib/api'
import { errorToast, keys } from '@/lib/queries'
import type { Order, OrderStatus } from '@/lib/types'
import { cn, date, money, STATUS_META } from '@/lib/utils'

const FLOW: { status: OrderStatus; label: string; icon: typeof Check }[] = [
  { status: 'pending_payment', label: 'Placed', icon: Clock },
  { status: 'paid', label: 'Paid', icon: CreditCard },
  { status: 'processing', label: 'Packing', icon: Package },
  { status: 'shipped', label: 'On the way', icon: Truck },
  { status: 'delivered', label: 'Delivered', icon: Sprout },
]

export default function OrderDetail() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const order = useQuery({ queryKey: keys.order(id), queryFn: () => api.get<Order>(`/orders/${id}`) })
  useOrderLive(id)
  const [demoOpen, setDemoOpen] = useState(params.get('pay') === 'demo')
  const o = order.data

  // Celebrate when payment lands (Stripe redirect or realtime update).
  const [celebrated, setCelebrated] = useState(false)
  useEffect(() => {
    if (o && o.status !== 'pending_payment' && o.status !== 'cancelled' && (params.get('paid') || params.get('pay')) && !celebrated) {
      setCelebrated(true)
      setParams({}, { replace: true })
    }
  }, [o, params, celebrated, setParams])

  const pay = useMutation({
    mutationFn: () => api.post<{ checkout_url: string | null; payment_mode: string }>(`/orders/${id}/pay`),
    onSuccess: (r) => (r.checkout_url ? (window.location.href = r.checkout_url) : setDemoOpen(true)),
    onError: errorToast,
  })
  const cancel = useMutation({
    mutationFn: () => api.post<Order & { refund?: string }>(`/orders/${id}/cancel`, { reason: 'Cancelled by customer' }),
    onSuccess: (r) => {
      qc.setQueryData(keys.order(id), r)
      qc.invalidateQueries({ queryKey: ['me'] })
    },
    onError: errorToast,
  })
  const support = useMutation({
    mutationFn: () => api.post('/support', { order_id: id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.rooms })
      window.dispatchEvent(new Event('nishorgo:open-support'))
    },
    onError: errorToast,
  })

  if (!o) return <Container className="max-w-5xl pt-6"><Skeleton className="h-96 rounded-2xl" /></Container>

  const reached = new Set(o.timeline.map((t) => t.status))
  const ended = o.status === 'cancelled' || o.status === 'refunded'

  return (
    <Container className="max-w-5xl pt-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/orders" className="text-sm text-muted hover:text-fg">← All orders</Link>
          <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Order {o.order_number}</h1>
          <div className="mt-2 text-muted">Placed {date(o.placed_at, { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}</div>
        </div>
        <Badge className={cn('px-4 py-1.5 text-sm', STATUS_META[o.status].tone)}>
          {STATUS_META[o.status].label}
        </Badge>
      </div>

      {o.can_pay && <PayBanner expires={o.expires_at} onPay={() => pay.mutate()} loading={pay.isPending} />}

      {!ended ? (
        <Card className="mb-8 p-8">
          <div className="relative grid grid-cols-5">
            <div className="absolute top-5 right-[10%] left-[10%] h-1 rounded-full bg-line" />
            <motion.div className="absolute top-5 left-[10%] h-1 rounded-full bg-primary"
              initial={{ width: 0 }} animate={{ width: `${(Math.max(0, FLOW.findIndex((f) => f.status === o.status)) / (FLOW.length - 1)) * 80}%` }} transition={{ duration: 0.8 }} />
            {FLOW.map((f) => {
              const done = reached.has(f.status)
              const at = o.timeline.find((t) => t.status === f.status)?.at
              return (
                <div key={f.status} className="relative flex flex-col items-center text-center">
                  <motion.div animate={{ scale: f.status === o.status ? [1, 1.15, 1] : 1 }} transition={{ repeat: f.status === o.status ? Infinity : 0, duration: 2 }}
                    className={cn('z-10 grid size-11 place-items-center rounded-full border-2', done ? 'border-transparent bg-primary text-primary-fg' : 'border-line bg-surface text-muted')}>
                    <f.icon className="size-5" />
                  </motion.div>
                  <div className={cn('mt-3 text-sm font-semibold', !done && 'text-muted')}>{f.label}</div>
                  {at && <div className="text-xs text-muted">{date(at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
                </div>
              )
            })}
          </div>
          {o.tracking_code && <div className="mt-8 rounded-lg bg-surface-2 p-4 text-sm">Tracking code <b className="font-mono">{o.tracking_code}</b></div>}
        </Card>
      ) : (
        <Card className="mb-8 flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-full bg-surface-2"><X className="size-5" /></span>
          <div>
            <div className="font-semibold">This order was {o.status}.</div>
            <div className="text-sm text-muted">{o.timeline[o.timeline.length - 1]?.note ?? ''} Stock and any Leaf Points were returned automatically.</div>
          </div>
        </Card>
      )}

      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Plants</h2>
          <ul className="divide-y divide-line">
            {o.items.map((it) => (
              <li key={it.id} className="flex items-center gap-4 py-3">
                <PlantImage src={it.image_url} alt="" className="size-16 rounded-2xl" imgClassName="p-1" />
                <div className="flex-1">
                  {it.slug ? <Link to={`/plants/${it.slug}`} className="font-semibold hover:underline">{it.name}</Link> : <span className="font-semibold">{it.name}</span>}
                  <div className="text-sm text-muted">{it.quantity} × {money(it.unit_price)}</div>
                </div>
                <div className="font-semibold">{money(it.line_total)}</div>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{money(o.subtotal)}</dd></div>
            {o.discount > 0 && <div className="flex justify-between"><dt className="text-muted">Coupon {o.coupon_code}</dt><dd>−{money(o.discount)}</dd></div>}
            {o.points_redeemed > 0 && <div className="flex justify-between"><dt className="text-muted">Leaf Points</dt><dd>−{money(o.points_redeemed)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd>{o.shipping_fee ? money(o.shipping_fee) : 'Free'}</dd></div>
            <div className="flex justify-between pt-2 text-lg font-bold"><dt>Total</dt><dd>{money(o.total)}</dd></div>
            {o.points_earned > 0 && <div className="pt-1 text-right text-xs font-semibold text-forest-500 dark:text-lime-glow">+{o.points_earned} Leaf Points earned</div>}
          </dl>
        </Card>
        <div className="space-y-4">
          <Card>
            <h3 className="mb-2 text-base font-semibold">Delivering to</h3>
            <p className="text-sm text-muted">{o.shipping_address.recipient} · {o.shipping_address.phone}<br />{o.shipping_address.line1}{o.shipping_address.area ? `, ${o.shipping_address.area}` : ''}<br />{o.shipping_address.city}</p>
          </Card>
          <Card>
            <h3 className="mb-3 text-base font-semibold">Activity</h3>
            <ol className="space-y-3 border-l-2 border-line pl-4">
              {o.timeline.slice().reverse().map((t, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-forest-500" />
                  <b>{STATUS_META[t.status].label}</b>{t.note && <span className="text-muted"> — {t.note}</span>}
                  <div className="text-xs text-muted">{date(t.at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
                </li>
              ))}
            </ol>
          </Card>
          <Button variant="outline" className="w-full" loading={support.isPending} onClick={() => support.mutate()}><MessageCircle className="size-4" /> Ask an expert about this order</Button>
          {o.can_cancel && <Button variant="ghost" className="w-full text-danger" loading={cancel.isPending} onClick={() => confirm('Cancel this order? Stock and points will be returned.') && cancel.mutate()}>Cancel order</Button>}
        </div>
      </div>

      <DemoPayModal open={demoOpen && o.can_pay} onClose={() => setDemoOpen(false)} order={o} />
    </Container>
  )
}

function PayBanner({ expires, onPay, loading }: { expires: string | null; onPay: () => void; loading: boolean }) {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, new Date(expires ?? 0).getTime() - Date.now()))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [expires])
  const mm = String(Math.floor(left / 60000)).padStart(2, '0')
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0')
  return (
    <div className="mb-8 flex flex-wrap items-center gap-4 rounded-2xl bg-amber-100 p-5 text-amber-950 dark:bg-amber-400/15 dark:text-amber-100">
      <Clock className="size-6" />
      <div className="flex-1">
        <div className="font-semibold">Your plants are reserved for <span className="font-mono">{mm}:{ss}</span></div>
        <div className="text-sm opacity-80">Complete payment before the timer ends or the stock is released.</div>
      </div>
      <Button onClick={onPay} loading={loading}><CreditCard className="size-4" /> Pay now</Button>
    </div>
  )
}

function DemoPayModal({ open, onClose, order }: { open: boolean; onClose: () => void; order: Order }) {
  const qc = useQueryClient()
  const pay = useMutation({
    mutationFn: () => api.post<Order>(`/orders/${order.id}/demo-pay`),
    onSuccess: (o) => {
      qc.setQueryData(keys.order(order.id), o)
      onClose()
    },
    onError: errorToast,
  })
  return (
    <Modal open={open} onClose={onClose} title="Complete payment">
      <div className="mb-5 rounded-xl border border-line bg-surface-2 p-5">
        <div className="flex justify-between text-sm opacity-80"><span>Nishorgo demo card</span><span>VISA</span></div>
        <div className="mt-8 font-mono text-xl tracking-widest">4242 4242 4242 4242</div>
        <div className="mt-4 flex justify-between text-sm"><span>PLANT LOVER</span><span>12/30</span></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Card number" className="col-span-2"><Input defaultValue="4242 4242 4242 4242" readOnly /></Field>
        <Field label="Expiry"><Input defaultValue="12/30" readOnly /></Field>
        <Field label="CVC"><Input defaultValue="424" readOnly /></Field>
      </div>
      <Button size="lg" className="mt-6 w-full" loading={pay.isPending} onClick={() => pay.mutate()}>Pay {money(order.total)}</Button>
      <p className="mt-3 text-center text-xs text-muted">Demo mode: Stripe keys aren't configured, so the API simulates a successful charge.</p>
    </Modal>
  )
}
