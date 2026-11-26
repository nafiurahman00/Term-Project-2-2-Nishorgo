import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar, Input, PageHeader, Select, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { errorToast } from '@/lib/queries'
import type { Paged, Role } from '@/lib/types'
import { date, money, TIER_META } from '@/lib/utils'
import { useAuth } from '@/providers/AuthProvider'

interface Customer {
  id: string; full_name: string | null; email: string; role: Role; avatar_url: string | null; loyalty_points: number
  lifetime_points: number; tier: keyof typeof TIER_META; orders: number; lifetime_value: number; last_order_at: string | null; created_at: string
}

export default function AdminCustomers() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const list = useQuery({ queryKey: ['admin', 'customers', q], queryFn: () => api.get<Paged<Customer>>('/admin/customers', { q: q || undefined, per_page: 100 }), placeholderData: (p) => p })
  const setRole = useMutation({
    mutationFn: (v: { id: string; role: Role }) => api.patch(`/admin/customers/${v.id}/role`, { role: v.role }),
    onSuccess: () => { toast.success('Role updated — takes effect on their next token refresh'); qc.invalidateQueries({ queryKey: ['admin', 'customers'] }) },
    onError: errorToast,
  })
  return (
    <>
      <PageHeader eyebrow="People" title="Customers" actions={
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" className="h-10 w-64 pl-9" /></div>
      }>Sorted by lifetime value. Only admins can change roles.</PageHeader>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted uppercase"><tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Tier</th><th className="px-4 py-3 text-right">Orders</th><th className="px-4 py-3 text-right">Lifetime value</th><th className="px-4 py-3 text-right">Points</th><th className="px-4 py-3">Last order</th><th className="px-4 py-3">Role</th></tr></thead>
          <tbody className="divide-y divide-line">
            {list.isLoading && <tr><td colSpan={7} className="p-4"><Skeleton className="h-40" /></td></tr>}
            {list.data?.items.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2.5"><div className="flex items-center gap-3"><Avatar src={c.avatar_url} name={c.full_name} className="size-8" /><div><div className="font-semibold">{c.full_name}</div><div className="text-xs text-muted">{c.email} · joined {date(c.created_at)}</div></div></div></td>
                <td className="px-4 py-2.5">{TIER_META[c.tier].emoji} {c.tier}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.orders}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{money(c.lifetime_value)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.loyalty_points}</td>
                <td className="px-4 py-2.5 text-muted">{c.last_order_at ? date(c.last_order_at) : '—'}</td>
                <td className="px-4 py-2.5">
                  {role === 'admin' ? (
                    <Select value={c.role} onChange={(e) => setRole.mutate({ id: c.id, role: e.target.value as Role })} className="h-9 w-32 rounded-full text-xs">
                      <option value="customer">Customer</option><option value="staff">Staff</option><option value="admin">Admin</option>
                    </Select>
                  ) : <span className="capitalize">{c.role}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
