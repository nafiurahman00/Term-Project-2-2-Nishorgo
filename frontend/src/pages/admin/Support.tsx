import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Package } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChatPane } from '@/components/chat'
import { Avatar, Badge, Button, EmptyState, PageHeader } from '@/components/ui'
import { api } from '@/lib/api'
import { errorToast, keys } from '@/lib/queries'
import type { ChatRoom } from '@/lib/types'
import { cn, timeAgo } from '@/lib/utils'

export default function AdminSupport() {
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const rooms = useQuery({ queryKey: keys.rooms, queryFn: () => api.get<{ support: ChatRoom[] }>('/chat/rooms') })
  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const list = (rooms.data?.support ?? []).filter((r) => filter === 'all' || r.status !== 'resolved')
  const activeId = params.get('room') ?? list[0]?.id
  const active = rooms.data?.support.find((r) => r.id === activeId)
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/chat/rooms/${id}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rooms }),
    onError: errorToast,
  })

  return (
    <>
      <PageHeader eyebrow="Plant clinic" title="Support inbox">Customers waiting for a reply are shown first.</PageHeader>
      <div className="grid h-[calc(100dvh-15rem)] min-h-[520px] overflow-hidden rounded-2xl border border-line bg-surface md:grid-cols-[320px_1fr]">
        <aside className="flex flex-col border-r border-line">
          <div className="flex gap-1 border-b border-line p-2">
            {(['active', 'all'] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={cn('flex-1 rounded-full py-1.5 text-sm capitalize', filter === f ? 'bg-primary text-primary-fg' : 'text-muted')}>{f}</button>)}
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {list.length === 0 && <p className="p-6 text-center text-sm text-muted">No conversations</p>}
            {list.map((r) => (
              <button key={r.id} onClick={() => setParams({ room: r.id })} className={cn('flex w-full gap-3 rounded-2xl p-3 text-left', activeId === r.id ? 'bg-surface-2' : 'hover:bg-surface-2/60')}>
                <Avatar src={r.customer?.avatar_url} name={r.customer?.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{r.customer?.name}</span><span className="shrink-0 text-[11px] text-muted">{timeAgo(r.last_message_at)}</span></div>
                  <div className="truncate text-xs text-muted">{r.last_message_preview}</div>
                  <div className="mt-1 flex gap-1">
                    {r.status === 'waiting' && <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">Waiting</Badge>}
                    {r.status === 'resolved' && <Badge>Resolved</Badge>}
                    {r.order_number && <Badge><Package className="size-3" />{r.order_number}</Badge>}
                    {r.unread > 0 && <Badge className="bg-clay text-white">{r.unread} new</Badge>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>
        <section className="flex min-h-0 flex-col">
          {active ? (
            <>
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <div>
                  <div className="font-semibold">{active.customer?.name} <span className="text-sm font-normal text-muted">{active.customer?.email}</span></div>
                  <div className="text-xs text-muted">{active.title}{active.assigned_to ? ` · assigned to ${active.assigned_to}` : ' · unassigned'}{active.order_id && <> · <Link to={`/admin/orders?focus=${active.order_id}`} className="underline">open order</Link></>}</div>
                </div>
                {active.status !== 'resolved' && <Button size="sm" variant="soft" loading={resolve.isPending} onClick={() => resolve.mutate(active.id)}><CheckCircle2 className="size-4" /> Resolve</Button>}
              </div>
              <ChatPane key={active.id} roomId={active.id} className="min-h-0 flex-1" />
            </>
          ) : <div className="p-10"><EmptyState emoji="💬" title="Select a conversation" /></div>}
        </section>
      </div>
    </>
  )
}
