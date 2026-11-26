import { useQuery } from '@tanstack/react-query'
import { Hash, Users } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { ChatPane } from '@/components/chat'
import { Container } from '@/components/layout'
import { Badge, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/queries'
import type { ChatRoom } from '@/lib/types'
import { cn, timeAgo } from '@/lib/utils'

export default function Community() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const rooms = useQuery({ queryKey: keys.rooms, queryFn: () => api.get<{ community: ChatRoom[]; support: ChatRoom[] }>('/chat/rooms') })
  const list = rooms.data?.community ?? []
  const active = list.find((r) => r.slug === slug) ?? list[0]

  return (
    <Container className="pt-6">
      <div className="mb-8">
                <h1 className="text-2xl font-semibold md:text-3xl">Community</h1>
        <p className="mt-2 max-w-2xl text-muted">Chat with other plant owners and our team. Share photos, ask questions and swap tips.</p>
      </div>
      <div className="grid h-[calc(100dvh-16rem)] min-h-[520px] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-line bg-surface md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden flex-col border-r border-line md:flex">
          <div className="border-b border-line px-5 py-4 text-sm font-semibold text-fg">Rooms</div>
          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {rooms.isLoading && [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}
            {list.map((r) => (
              <button key={r.id} onClick={() => navigate(`/community/${r.slug}`)}
                className={cn('flex w-full items-start gap-3 rounded-2xl p-3 text-left transition', active?.id === r.id ? 'bg-surface-2' : 'hover:bg-surface-2/60')}>
                <Hash className="mt-0.5 size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{r.title}</span>
                    {r.unread > 0 && <Badge className="bg-clay text-white">{r.unread}</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted">{r.last_message_preview ?? r.description}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className="flex min-h-0 min-w-0 flex-col">
          {active && (
            <>
              <div className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-5">
                <div className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 md:hidden">
                  {list.map((r) => (
                    <button key={r.id} onClick={() => navigate(`/community/${r.slug}`)} className={cn('shrink-0 rounded-full px-3 py-1 text-sm', active.id === r.id ? 'bg-primary text-primary-fg' : 'bg-surface-2')}>{r.title}</button>
                  ))}
                </div>
                <div className="hidden md:block">
                  <div className="flex items-center gap-1.5 font-semibold"><Hash className="size-4 text-muted" />{active.title}</div>
                  <div className="flex items-center gap-3 text-xs text-muted"><span>{active.description}</span><span className="flex items-center gap-1"><Users className="size-3" /> {active.members} members</span>{active.last_message_at && <span>active {timeAgo(active.last_message_at)}</span>}</div>
                </div>
              </div>
              <ChatPane key={active.id} roomId={active.id} className="min-h-0 flex-1" />
            </>
          )}
        </section>
      </div>
    </Container>
  )
}
