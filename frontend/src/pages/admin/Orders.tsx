import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { PlantImage } from '@/components/product'
import { Badge, Button, Drawer, Field, Input, PageHeader, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { errorToast } from '@/lib/queries'
import type { Order, OrderStatus, Paged } from '@/lib/types'
import { cn, date, money, STATUS_META, timeAgo } from '@/lib/utils'

interface Row {
  id: string; order_number: string; status: OrderStatus; total: number; placed_at: string; paid_at: string | null
  tracking_code: string | null; customer: { name: string; email: string }; city: string; item_count: number; next_statuses: OrderStatus[]
}

const TABS: (OrderStatus | 'all')[] = ['all', 'paid', 'processing', 'shipped', 'delivered', 'pending_payment', 'cancelled', 'refunded']

export default function AdminOrders() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') ?? 'all') as OrderStatus | 'all'
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(params.get('focus'))
  const list = useQuery({
    queryKey: ['admin', 'orders', status, q],
    queryFn: () => api.get<Paged<Row>>('/admin/orders', { status: status === 'all' ? undefined : status, q: q || undefined, per_page: 50 }),
    placeholderData: (p) => p,
  })

  return (
    <>
      <PageHeader eyebrow="Fulfilment" title="Orders">Move orders through fulfilment. Customers see each update right away.</PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setParams(t === 'all' ? {} : { status: t })}
            className={cn('rounded-full px-3 py-1.5 text-sm font-medium', status === t ? 'bg-primary text-primary-fg' : 'bg-surface text-muted hover:text-fg')}>
            {t === 'all' ? 'All' : STATUS_META[t].label}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order #, name or email" className="h-10 w-64 pl-9" />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted uppercase">
            <tr><th className="px-4 py-3">Order</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Items</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3">Placed</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.isLoading && <tr><td colSpan={6} className="p-4"><Skeleton className="h-40" /></td></tr>}
            {list.data?.items.map((o) => (
              <tr key={o.id} onClick={() => setOpen(o.id)} className="cursor-pointer transition hover:bg-surface-2/60">
                <td className="px-4 py-3 font-semibold">{o.order_number}{o.tracking_code && <div className="font-mono text-xs font-normal text-muted">{o.tracking_code}</div>}</td>
                <td className="px-4 py-3"><div>{o.customer.name}</div><div className="text-xs text-muted">{o.city}</div></td>
                <td className="px-4 py-3"><Badge className={STATUS_META[o.status].tone}>{STATUS_META[o.status].label}</Badge></td>
                <td className="px-4 py-3 text-right tabular-nums">{o.item_count}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(o.total)}</td>
                <td className="px-4 py-3 text-muted">{timeAgo(o.placed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && <div className="border-t border-line px-4 py-2 text-xs text-muted">{list.data.total} orders</div>}
      </div>
      <OrderDrawer id={open} onClose={() => setOpen(null)} />
    </>
  )
}

function OrderDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const order = useQuery({ queryKey: ['admin', 'order', id], queryFn: () => api.get<Order>(`/admin/orders/${id}`), enabled: !!id })
  const [note, setNote] = useState('')
  const [tracking, setTracking] = useState('')
  const row = qc.getQueriesData<Paged<Row>>({ queryKey: ['admin', 'orders'] }).flatMap(([, d]) => d?.items ?? []).find((r) => r.id === id)
  const next = row?.next_statuses ?? []
  const set = useMutation({
    mutationFn: (status: OrderStatus) => api.patch<Order & { refund?: string }>(`/admin/orders/${id}/status`, { status, note: note || null, tracking_code: tracking || null }),
    onSuccess: (o) => {
      toast.success(`${o.order_number} → ${STATUS_META[o.status].label}${o.refund ? ' · Stripe refund initiated' : ''}`)
      setNote(''); setTracking('')
      qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: errorToast,
  })
  const o = order.data
  return (
    <Drawer open={!!id} onClose={onClose} title={o?.order_number ?? 'Order'} className="max-w-lg">
      {!o ? <Skeleton className="h-64" /> : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Badge className={cn('px-3 py-1', STATUS_META[o.status].tone)}>{STATUS_META[o.status].label}</Badge>
            <span className=" text-3xl font-semibold">{money(o.total)}</span>
          </div>
          <div className="rounded-2xl bg-surface-2 p-4 text-sm">
            <div className="font-semibold">{o.customer?.name}</div><div className="text-muted">{o.customer?.email}</div>
            <div className="mt-2 text-muted">{o.shipping_address.recipient} · {o.shipping_address.phone}<br />{o.shipping_address.line1}, {o.shipping_address.city}</div>
            {o.notes && <div className="mt-2 italic">“{o.notes}”</div>}
          </div>
          <ul className="space-y-2">
            {o.items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 text-sm">
                <PlantImage src={it.image_url} alt="" className="size-10 rounded-xl" imgClassName="p-0.5" />
                <span className="flex-1">{it.name} × {it.quantity}</span><span className="font-semibold">{money(it.line_total)}</span>
              </li>
            ))}
          </ul>
          {next.length > 0 && (
            <div className="space-y-3 rounded-xl border border-line p-4">
              <div className="text-sm font-semibold">Move order to…</div>
              {next.includes('shipped') && <Field label="Tracking code"><Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="PTH123456" /></Field>}
              <Field label="Note (shown on timeline)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
              <div className="flex flex-wrap gap-2">
                {next.map((s) => (
                  <Button key={s} size="sm" variant={s === 'cancelled' || s === 'refunded' ? 'danger' : 'primary'} loading={set.isPending && set.variables === s} onClick={() => set.mutate(s)}>
                    {STATUS_META[s].label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="mb-2 text-sm font-semibold">Timeline</div>
            <ol className="space-y-2 border-l-2 border-line pl-4 text-sm">
              {o.timeline.map((t, i) => (
                <li key={i}><b>{STATUS_META[t.status].label}</b>{t.note && <span className="text-muted"> — {t.note}</span>}<div className="text-xs text-muted">{date(t.at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div></li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Drawer>
  )
}
