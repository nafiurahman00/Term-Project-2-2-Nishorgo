import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, RefreshCw, Table2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PlantImage } from '@/components/product'
import { Badge, Button, Card, PageHeader, Segmented, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { errorToast } from '@/lib/queries'
import type { OrderStatus } from '@/lib/types'
import { cn, compact, date, money, STATUS_META, timeAgo } from '@/lib/utils'

interface Kpi { value: number; previous: number }
interface Dashboard {
  period: { days: number; from: string; to: string; refreshed_at: string }
  kpis: { revenue: Kpi; orders: Kpi; aov: Kpi; units: Kpi; customers: Kpi; pending_fulfilment: number }
  revenue_series: { day: string; revenue: number; orders: number }[]
  category_breakdown: { category: string; emoji: string; revenue: number; units: number }[]
  top_products: { id: number; name: string; slug: string; image_url: string; stock: number; units: number; revenue: number }[]
  status_counts: Record<OrderStatus, number>
  order_heatmap: { dow: number; hour: number; orders: number }[]
  low_stock: { id: number; name: string; slug: string; stock: number; threshold: number; image_url: string; wishlist_count: number }[]
  recent_orders: { id: string; order_number: string; status: OrderStatus; total: number; placed_at: string; customer: string }[]
  coupon_performance: { code: string; uses: number; discount_given: number; revenue: number }[]
}

// Recessive chart chrome; series color comes from the validated --series-1 token.
const AXIS = { stroke: 'var(--color-muted)', fontSize: 11, tickLine: false, axisLine: false }

export default function Dashboard() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30')
  const qc = useQueryClient()
  const dash = useQuery({ queryKey: ['admin', 'dashboard', days], queryFn: () => api.get<Dashboard>('/admin/dashboard', { days }) })
  const refresh = useMutation({
    mutationFn: () => api.post<Dashboard>(`/admin/analytics/refresh?days=${days}`),
    onSuccess: (d) => qc.setQueryData(['admin', 'dashboard', days], d),
    onError: errorToast,
  })
  const d = dash.data

  return (
    <>
      <PageHeader eyebrow="Overview" title="Dashboard"
        actions={
          <div className="flex items-center gap-2">
            {/* One filter row above the charts; every chart below follows it. */}
            <Segmented value={days} onChange={setDays} options={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} />
            <Button variant="outline" size="icon" loading={refresh.isPending} onClick={() => refresh.mutate()} aria-label="Refresh figures">{!refresh.isPending && <RefreshCw className="size-4" />}</Button>
          </div>
        }>
        Sales figures update every 15 minutes.
      </PageHeader>

      {!d ? <div className="grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Revenue" kpi={d.kpis.revenue} format={money} />
            <StatTile label="Paid orders" kpi={d.kpis.orders} format={String} />
            <StatTile label="Avg. order" kpi={d.kpis.aov} format={money} />
            <StatTile label="Plants sold" kpi={d.kpis.units} format={String} />
            <StatTile label="New customers" kpi={d.kpis.customers} format={String} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <RevenueChart series={d.revenue_series} days={d.period.days} />
            <Card>
              <h2 className="text-base font-semibold">Revenue by category</h2>
              <p className="mb-4 text-xs text-muted">Last {d.period.days} days</p>
              <div style={{ height: Math.max(160, d.category_breakdown.length * 48) }}>
                <ResponsiveContainer>
                  <BarChart data={d.category_breakdown} layout="vertical" margin={{ left: 0, right: 48 }} barCategoryGap={8}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="category" width={118} {...AXIS} tick={{ fill: 'var(--color-fg)', fontSize: 12 }} />
                    <Tooltip cursor={{ fill: 'var(--color-surface-2)' }} content={<ChartTip render={(p: { category: string; revenue: number; units: number }) => <><b>{p.category}</b><div>{money(p.revenue)} · {p.units} plants</div></>} />} />
                    <Bar dataKey="revenue" fill="var(--color-series-1)" radius={[0, 4, 4, 0]} barSize={18}
                      label={{ position: 'right', fill: 'var(--color-muted)', fontSize: 11, formatter: (v: unknown) => compact(Number(v)) }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <Heatmap cells={d.order_heatmap} />
            <Card>
              <h2 className="mb-4 text-base font-semibold">Order pipeline</h2>
              <div className="space-y-2">
                {(Object.keys(STATUS_META) as OrderStatus[]).map((s) => (
                  <Link key={s} to={`/admin/orders?status=${s}`} className="flex items-center justify-between rounded-2xl px-3 py-2 hover:bg-surface-2">
                    <Badge className={STATUS_META[s].tone}>{STATUS_META[s].label}</Badge>
                    <span className="font-semibold tabular-nums">{d.status_counts[s] ?? 0}</span>
                  </Link>
                ))}
              </div>
              <div className="mt-4 rounded-2xl bg-accent/30 p-3 text-sm"><b>{d.kpis.pending_fulfilment}</b> orders waiting to be packed or shipped</div>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card>
              <h2 className="mb-4 text-base font-semibold">Top plants</h2>
              <ol className="space-y-3">
                {d.top_products.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <span className="w-4 text-sm font-bold text-muted">{i + 1}</span>
                    <PlantImage src={p.image_url} alt="" className="size-10 rounded-xl" imgClassName="p-0.5" />
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{p.name}</div><div className="text-xs text-muted">{p.units} sold · {p.stock} in stock</div></div>
                    <span className="text-sm font-semibold tabular-nums">{money(p.revenue)}</span>
                  </li>
                ))}
              </ol>
            </Card>
            <Card>
              <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><AlertTriangle className="size-4 text-amber-500" /> Low stock</h2>
              <p className="mb-4 text-xs text-muted">Plants at or below their reorder level.</p>
              {d.low_stock.length === 0 ? <p className="text-sm text-muted">Everything is well stocked.</p> : (
                <ul className="space-y-3">
                  {d.low_stock.map((p) => (
                    <li key={p.id} className="flex items-center gap-3">
                      <PlantImage src={p.image_url} alt="" className="size-10 rounded-xl" imgClassName="p-0.5" />
                      <div className="flex-1"><div className="text-sm font-semibold">{p.name}</div><div className="text-xs text-muted">{p.wishlist_count} waiting on wishlists</div></div>
                      <Badge className={p.stock === 0 ? 'bg-fg text-bg' : 'bg-amber-100 text-amber-900'}>{p.stock} left</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/admin/products?stock=low"><Button variant="soft" size="sm" className="mt-4">Restock</Button></Link>
            </Card>
            <Card>
              <h2 className="mb-4 text-base font-semibold">Recent orders</h2>
              <ul className="space-y-2.5">
                {d.recent_orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0"><div className="font-semibold">{o.order_number}</div><div className="truncate text-xs text-muted">{o.customer} · {timeAgo(o.placed_at)}</div></div>
                    <div className="text-right"><div className="font-semibold tabular-nums">{money(o.total)}</div><Badge className={cn('text-[10px]', STATUS_META[o.status].tone)}>{STATUS_META[o.status].label}</Badge></div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card>
            <h2 className="mb-4 text-base font-semibold">Coupon performance</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted uppercase"><th className="pb-2">Code</th><th className="pb-2 text-right">Uses</th><th className="pb-2 text-right">Discount given</th><th className="pb-2 text-right">Order revenue</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.coupon_performance.map((c) => (
                  <tr key={c.code}><td className="py-2 font-mono font-semibold">{c.code}</td><td className="py-2 text-right tabular-nums">{c.uses}</td><td className="py-2 text-right tabular-nums">{money(c.discount_given)}</td><td className="py-2 text-right tabular-nums">{money(c.revenue)}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="text-right text-xs text-muted">Refreshed {timeAgo(d.period.refreshed_at)}</p>
        </div>
      )}
    </>
  )
}

function StatTile({ label, kpi, format }: { label: string; kpi: Kpi; format: (n: number) => string }) {
  const value = Number(kpi.value ?? 0)
  const prev = Number(kpi.previous ?? 0)
  const change = prev ? ((value - prev) / prev) * 100 : null
  const up = (change ?? 0) >= 0
  return (
    <Card>
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{format(value)}</div>
      <div className="mt-1 flex items-center gap-1 text-xs">
        {change === null ? <span className="text-muted">No prior data</span> : (
          <>
            {/* Direction carried by icon + sign, not colour alone. */}
            <span className={cn('inline-flex items-center gap-0.5 font-semibold', up ? 'text-forest-500 dark:text-lime-glow' : 'text-danger')}>
              {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{up ? '+' : ''}{change.toFixed(0)}%
            </span>
            <span className="text-muted">vs previous period</span>
          </>
        )}
      </div>
    </Card>
  )
}

function RevenueChart({ series, days }: { series: Dashboard['revenue_series']; days: number }) {
  const [table, setTable] = useState(false)
  const data = series.map((s) => ({ ...s, revenue: Number(s.revenue) }))
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">Daily revenue</h2>
          <p className="text-xs text-muted">Last {days} days · paid orders, Asia/Dhaka time</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setTable((v) => !v)}><Table2 className="size-4" /> {table ? 'Chart' : 'Table'}</Button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface"><tr className="text-left text-xs text-muted uppercase"><th className="pb-2">Day</th><th className="pb-2 text-right">Orders</th><th className="pb-2 text-right">Revenue</th></tr></thead>
            <tbody className="divide-y divide-line">{data.slice().reverse().map((r) => <tr key={r.day}><td className="py-1.5">{date(r.day)}</td><td className="py-1.5 text-right tabular-nums">{r.orders}</td><td className="py-1.5 text-right tabular-nums">{money(r.revenue)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-series-1)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--color-series-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 3" />
              <XAxis dataKey="day" {...AXIS} tickFormatter={(v) => date(v, { day: 'numeric', month: 'short' })} minTickGap={32} />
              <YAxis {...AXIS} width={48} tickFormatter={(v) => `৳${compact(v)}`} />
              <Tooltip cursor={{ stroke: 'var(--color-muted)', strokeDasharray: '3 3' }}
                content={<ChartTip render={(p: { day: string; revenue: number; orders: number }) => <><b>{date(p.day, { weekday: 'short', day: 'numeric', month: 'short' })}</b><div>{money(p.revenue)} · {p.orders} orders</div></>} />} />
              <Area type="monotone" dataKey="revenue" stroke="var(--color-series-1)" strokeWidth={2} fill="url(#rev)"
                activeDot={{ r: 5, stroke: 'var(--color-surface)', strokeWidth: 2 }} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTip({ active, payload, render }: { active?: boolean; payload?: { payload: any }[]; render: (p: any) => React.ReactNode }) {
  if (!active || !payload?.length) return null
  return <div className="rounded-2xl border border-line bg-surface px-3 py-2 text-xs shadow-xl">{render(payload[0].payload)}</div>
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** When do people shop? Sequential single hue: more orders → stronger series colour. */
function Heatmap({ cells }: { cells: Dashboard['order_heatmap'] }) {
  const max = Math.max(1, ...cells.map((c) => c.orders))
  const get = (dow: number, hour: number) => cells.find((c) => c.dow === dow && c.hour === hour)?.orders ?? 0
  const [hover, setHover] = useState<{ dow: number; hour: number; n: number } | null>(null)
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between">
        <div><h2 className="text-base font-semibold">When customers order</h2><p className="text-xs text-muted">Paid orders by weekday and hour</p></div>
        <div className="h-5 text-xs text-muted">{hover && <span><b className="text-fg">{DOW[hover.dow - 1]} {String(hover.hour).padStart(2, '0')}:00</b> · {hover.n} order{hover.n === 1 ? '' : 's'}</span>}</div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: '36px repeat(24, 1fr)' }} onMouseLeave={() => setHover(null)}>
          {DOW.map((dname, di) => (
            <div key={dname} className="contents">
              <div className="pr-2 text-right text-[11px] leading-5 text-muted">{dname}</div>
              {Array.from({ length: 24 }).map((_, h) => {
                const n = get(di + 1, h)
                return (
                  <div key={h} onMouseEnter={() => setHover({ dow: di + 1, hour: h, n })}
                    className="h-5 rounded-[4px] transition hover:ring-2 hover:ring-fg/40"
                    style={{ background: n ? `color-mix(in oklab, var(--color-series-1) ${15 + (n / max) * 85}%, var(--color-surface-2))` : 'var(--color-surface-2)' }} />
                )
              })}
            </div>
          ))}
          <div />
          {Array.from({ length: 24 }).map((_, h) => <div key={h} className="text-center text-[10px] text-muted">{h % 6 === 0 ? `${h}h` : ''}</div>)}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-muted">
        Fewer
        {[0.15, 0.4, 0.7, 1].map((t) => <span key={t} className="size-3 rounded-[3px]" style={{ background: `color-mix(in oklab, var(--color-series-1) ${t * 100}%, var(--color-surface-2))` }} />)}
        More
      </div>
    </Card>
  )
}
