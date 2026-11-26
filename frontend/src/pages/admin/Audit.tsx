import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge, PageHeader, Segmented, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import type { Paged } from '@/lib/types'
import { cn, date } from '@/lib/utils'

interface Entry {
  id: number; table: string; record_id: string; action: 'INSERT' | 'UPDATE' | 'DELETE'; actor: string; actor_role: string
  changed_fields: string[] | null; diff: Record<string, { from: unknown; to: unknown }> | null; snapshot: Record<string, unknown> | null; at: string
}

const fmt = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const ACTION_TONE = {
  INSERT: 'bg-forest-50 text-forest-700 dark:bg-lime-glow/10 dark:text-lime-glow',
  UPDATE: 'bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-300',
  DELETE: 'bg-rose-100 text-rose-900 dark:bg-rose-400/15 dark:text-rose-300',
}

export default function AdminAudit() {
  const [table, setTable] = useState<'all' | 'products' | 'orders' | 'coupons' | 'profiles'>('all')
  const log = useQuery({ queryKey: ['admin', 'audit', table], queryFn: () => api.get<Paged<Entry>>('/admin/audit', { table: table === 'all' ? undefined : table, per_page: 100 }) })
  return (
    <>
      <PageHeader eyebrow="Compliance" title="Audit log">Who changed what, and when, across products, orders, coupons and roles.</PageHeader>
      <Segmented value={table} onChange={setTable} className="mb-6" options={[{ value: 'all', label: 'All' }, { value: 'products', label: 'Products' }, { value: 'orders', label: 'Orders' }, { value: 'coupons', label: 'Coupons' }, { value: 'profiles', label: 'Roles' }]} />
      {log.isLoading && <Skeleton className="h-64 rounded-xl" />}
      <ol className="space-y-3">
        {log.data?.items.map((e) => (
          <li key={e.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge className={ACTION_TONE[e.action]}>{e.action}</Badge>
              <span className="font-mono text-xs">{e.table}#{e.record_id.slice(0, 8)}</span>
              <span className="text-muted">by <b className="text-fg">{e.actor}</b> ({e.actor_role})</span>
              <span className="ml-auto text-xs text-muted">{date(e.at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
            </div>
            {e.diff && (
              <div className="mt-3 overflow-x-auto rounded-2xl bg-surface-2 p-3 font-mono text-xs">
                {Object.entries(e.diff).map(([k, v]) => (
                  <div key={k} className="flex flex-wrap gap-2 py-0.5">
                    <span className="w-40 shrink-0 text-muted">{k}</span>
                    <span className="text-rose-700 line-through dark:text-rose-300">{fmt(v.from).slice(0, 80)}</span>
                    <span>→</span>
                    <span className="text-forest-700 dark:text-lime-glow">{fmt(v.to).slice(0, 80)}</span>
                  </div>
                ))}
              </div>
            )}
            {e.snapshot && (
              <div className={cn('mt-3 truncate rounded-2xl bg-surface-2 p-3 font-mono text-xs text-muted')}>
                {Object.entries(e.snapshot).filter(([k]) => ['name', 'code', 'price', 'status', 'order_number'].includes(k)).map(([k, v]) => `${k}: ${fmt(v)}`).join(' · ') || JSON.stringify(e.snapshot).slice(0, 160)}
              </div>
            )}
          </li>
        ))}
      </ol>
    </>
  )
}
