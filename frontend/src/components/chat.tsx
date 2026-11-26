import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { BadgeCheck, ImagePlus, Pencil, Reply, Send, SmilePlus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { errorToast, keys } from '@/lib/queries'
import { supabase, supabaseConfigured, uploadImage } from '@/lib/supabase'
import type { ChatMessage } from '@/lib/types'
import { cn, timeAgo } from '@/lib/utils'
import { useAuth } from '@/providers/AuthProvider'
import { Avatar, Button, Spinner } from './ui'

const EMOJIS = ['🌱', '❤️', '😂', '😮', '🙏', '👍'] as const

type Pages = InfiniteData<ChatMessage[], number | null>

/**
 * A realtime chat room.
 *  - history: paged from the API (keyset pagination by id)
 *  - new/edited/deleted messages + reactions: Realtime postgres_changes (RLS-filtered)
 *  - "Rafi is typing…": Realtime Broadcast (ephemeral, never stored)
 *  - who's online: Realtime Presence
 */
export function ChatPane({ roomId, className, compact }: { roomId: string; className?: string; compact?: boolean }) {
  const { user, account, session } = useAuth()
  const qc = useQueryClient()
  const scroller = useRef<HTMLDivElement>(null)
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({})
  const [online, setOnline] = useState<{ name: string; role: string }[]>([])
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const history = useInfiniteQuery({
    queryKey: keys.messages(roomId),
    queryFn: ({ pageParam }) => api.get<ChatMessage[]>(`/chat/rooms/${roomId}/messages`, { before: pageParam ?? undefined }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.length >= 40 ? last[last.length - 1].id : undefined),
  })

  // Oldest → newest for display.
  const messages = useMemo(() => (history.data?.pages.flat() ?? []).slice().reverse(), [history.data])
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])

  const patch = (fn: (msgs: ChatMessage[]) => ChatMessage[]) =>
    qc.setQueryData<Pages>(keys.messages(roomId), (d) => (d ? { ...d, pages: d.pages.map(fn) } : d))

  useEffect(() => {
    if (!supabaseConfigured) return
    const presenceKey = user?.id ?? `guest-${crypto.randomUUID()}`
    const ch = supabase.channel(`room:${roomId}`, { config: { presence: { key: presenceKey }, broadcast: { self: false } } })
    channelRef.current = ch

    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` }, ({ new: m }) => {
      const msg = m as ChatMessage
      qc.setQueryData<Pages>(keys.messages(roomId), (d) => {
        if (!d || d.pages.some((p) => p.some((x) => x.id === msg.id))) return d
        const first = [{ ...msg, is_mine: msg.sender_id === user?.id, reactions: [] }, ...(d.pages[0] ?? [])]
        return { ...d, pages: [first, ...d.pages.slice(1)] }
      })
      setTyping((t) => {
        const n = { ...t }
        if (msg.sender_id) delete n[msg.sender_id]
        return n
      })
      qc.invalidateQueries({ queryKey: keys.rooms })
    })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` }, ({ new: m }) => {
        const msg = m as ChatMessage
        patch((list) => list.map((x) => (x.id === msg.id ? { ...x, body: msg.body, image_url: msg.image_url, edited_at: msg.edited_at, deleted_at: msg.deleted_at } : x)))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions', filter: `room_id=eq.${roomId}` }, (e) => {
        const r = (e.eventType === 'DELETE' ? e.old : e.new) as { message_id: number; emoji: string; user_id: string }
        const delta = e.eventType === 'DELETE' ? -1 : 1
        patch((list) =>
          list.map((x) => {
            if (x.id !== r.message_id) return x
            const reactions = [...(x.reactions ?? [])]
            const i = reactions.findIndex((y) => y.emoji === r.emoji)
            const mine = r.user_id === user?.id
            if (i === -1 && delta > 0) reactions.push({ emoji: r.emoji, count: 1, mine })
            else if (i >= 0) reactions[i] = { ...reactions[i], count: reactions[i].count + delta, mine: mine ? delta > 0 : reactions[i].mine }
            return { ...x, reactions: reactions.filter((y) => y.count > 0) }
          }),
        )
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        setTyping((t) => ({ ...t, [payload.id]: { name: payload.name, at: Date.now() } }))
      })
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState<{ name: string; role: string }>()
        setOnline(Object.values(state).map((v) => v[0]).filter((v) => v?.name))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && account) await ch.track({ name: account.full_name ?? 'Plant lover', role: account.role })
      })

    return () => {
      supabase.removeChannel(ch)
      channelRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, user?.id, account?.full_name])

  // Expire typing indicators.
  useEffect(() => {
    const t = setInterval(() => setTyping((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => Date.now() - v.at < 3500))), 1000)
    return () => clearInterval(t)
  }, [])

  // Stick to the bottom when new messages arrive; mark as read.
  const lastId = messages[messages.length - 1]?.id
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
    if (session && lastId) api.post(`/chat/rooms/${roomId}/read`).then(() => qc.invalidateQueries({ queryKey: keys.rooms })).catch(() => {})
  }, [lastId, roomId, session, qc])

  const typingNames = Object.entries(typing).filter(([id]) => id !== user?.id).map(([, v]) => v.name)

  const react = (m: ChatMessage, emoji: string) =>
    api.post(`/chat/messages/${m.id}/reactions`, { emoji }).catch(errorToast)

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {!compact && online.length > 0 && (
        <div className="flex items-center gap-2 border-b border-line px-5 py-2 text-xs text-muted">
          <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>
          {online.length} online · {online.slice(0, 4).map((o) => o.name.split(' ')[0]).join(', ')}
          {online.some((o) => o.role !== 'customer') && <span className="ml-1 rounded-full bg-accent/40 px-2 py-0.5 font-semibold text-fg">Expert here</span>}
        </div>
      )}

      <div ref={scroller} className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
        {history.hasNextPage && (
          <div className="pb-2 text-center">
            <Button size="sm" variant="ghost" loading={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>Load earlier messages</Button>
          </div>
        )}
        {history.isLoading && <div className="grid place-items-center py-10"><Spinner /></div>}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const grouped = prev && prev.sender_id === m.sender_id && !m.is_system && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000
          return (
            <MessageBubble
              key={m.id}
              m={m}
              mine={m.sender_id === user?.id}
              grouped={!!grouped}
              reply={m.reply ?? (m.reply_to ? byId.get(m.reply_to) : undefined)}
              onReply={() => setReplyTo(m)}
              onEdit={() => setEditing(m)}
              onDelete={() => api.delete(`/chat/messages/${m.id}`).catch(errorToast)}
              onReact={(e) => (session ? react(m, e) : errorToast(new Error()))}
              canAct={!!session}
            />
          )
        })}
      </div>

      <div className="h-5 px-5 text-xs text-muted">
        <AnimatePresence>
          {typingNames.length > 0 && (
            <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {typingNames.slice(0, 2).join(' & ')} {typingNames.length > 1 ? 'are' : 'is'} typing<span className="animate-pulse">…</span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {session ? (
        <Composer
          roomId={roomId}
          replyTo={replyTo}
          editing={editing}
          onCancel={() => { setReplyTo(null); setEditing(null) }}
          onTyping={() => channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { id: user!.id, name: account?.full_name ?? 'Someone' } })}
          userId={user!.id}
        />
      ) : (
        <div className="m-3 rounded-2xl bg-surface-2 p-4 text-center text-sm text-muted">
          <a href="/login" className="font-semibold text-fg underline">Sign in</a> to join the conversation.
        </div>
      )}
    </div>
  )
}

function MessageBubble({ m, mine, grouped, reply, onReply, onEdit, onDelete, onReact, canAct }: {
  m: ChatMessage
  mine: boolean
  grouped: boolean
  reply?: Pick<ChatMessage, 'sender_name' | 'body'> | null
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  onReact: (e: string) => void
  canAct: boolean
}) {
  const [picker, setPicker] = useState(false)
  if (m.is_system) {
    return <div className="py-2 text-center text-xs text-muted">{m.body}</div>
  }
  const isExpert = m.sender_role === 'staff' || m.sender_role === 'admin'
  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('group flex gap-2.5', mine && 'flex-row-reverse', !grouped && 'pt-3')}>
      <div className="w-8 shrink-0">{!grouped && !mine && <Avatar src={m.sender_avatar} name={m.sender_name} className="size-8" />}</div>
      <div className={cn('flex max-w-[78%] flex-col', mine && 'items-end')}>
        {!grouped && (
          <div className={cn('mb-1 flex items-center gap-1.5 text-xs text-muted', mine && 'flex-row-reverse')}>
            <span className="font-semibold text-fg">{mine ? 'You' : m.sender_name}</span>
            {isExpert && <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/40 px-1.5 py-px text-[10px] font-bold text-fg"><BadgeCheck className="size-3" /> Plant expert</span>}
            <span>{timeAgo(m.created_at)}</span>
          </div>
        )}
        <div className="relative">
          {m.deleted_at ? (
            <div className="rounded-2xl border border-dashed border-line px-3.5 py-2 text-sm text-muted italic">Message deleted</div>
          ) : (
            <div className={cn('rounded-xl px-4 py-2.5 text-[15px] leading-snug', mine ? 'rounded-br-sm bg-primary text-primary-fg' : isExpert ? 'rounded-bl-sm bg-accent/35' : 'rounded-bl-sm bg-surface-2')}>
              {reply && (
                <div className={cn('mb-1.5 border-l-2 pl-2 text-xs opacity-80', mine ? 'border-primary-fg/50' : 'border-forest-500')}>
                  <span className="font-semibold">{reply.sender_name}</span> · {reply.body?.slice(0, 80)}
                </div>
              )}
              {m.image_url && <img src={m.image_url} alt="" className="mb-1.5 max-h-64 rounded-2xl object-cover" />}
              {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
              {m.edited_at && <span className="text-[10px] opacity-60"> (edited)</span>}
            </div>
          )}
          {canAct && !m.deleted_at && (
            <div className={cn('absolute -top-4 flex gap-0.5 rounded-full border border-line bg-surface p-0.5 opacity-0 shadow-sm transition group-hover:opacity-100', mine ? 'left-0' : 'right-0')}>
              <IconBtn label="React" onClick={() => setPicker((v) => !v)}><SmilePlus /></IconBtn>
              <IconBtn label="Reply" onClick={onReply}><Reply /></IconBtn>
              {mine && <IconBtn label="Edit" onClick={onEdit}><Pencil /></IconBtn>}
              {mine && <IconBtn label="Delete" onClick={onDelete}><Trash2 /></IconBtn>}
            </div>
          )}
          {picker && (
            <div className={cn('absolute -top-12 z-10 flex gap-1 rounded-full border border-line bg-surface p-1 shadow-lg', mine ? 'left-0' : 'right-0')}>
              {EMOJIS.map((e) => (
                <button key={e} className="rounded-full p-1 text-lg transition hover:scale-125" onClick={() => { onReact(e); setPicker(false) }}>{e}</button>
              ))}
            </div>
          )}
        </div>
        {!!m.reactions?.length && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <button key={r.emoji} onClick={() => onReact(r.emoji)} className={cn('rounded-full border px-2 py-0.5 text-xs transition', r.mine ? 'border-forest-500 bg-forest-50 dark:bg-lime-glow/10' : 'border-line bg-surface')}>
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-fg [&>svg]:size-3.5">
      {children}
    </button>
  )
}

function Composer({ roomId, replyTo, editing, onCancel, onTyping, userId }: {
  roomId: string
  replyTo: ChatMessage | null
  editing: ChatMessage | null
  onCancel: () => void
  onTyping: () => void
  userId: string
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const lastTyping = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) setText(editing.body ?? '')
  }, [editing])

  const submit = async (e?: FormEvent, imageUrl?: string) => {
    e?.preventDefault()
    if (!text.trim() && !imageUrl) return
    setBusy(true)
    try {
      if (editing) await api.patch(`/chat/messages/${editing.id}`, { body: text.trim() })
      else await api.post(`/chat/rooms/${roomId}/messages`, { body: text.trim() || null, image_url: imageUrl ?? null, reply_to: replyTo?.id ?? null })
      setText('')
      onCancel()
    } catch (err) {
      errorToast(err)
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (f?: File) => {
    if (!f) return
    setBusy(true)
    try {
      const url = await uploadImage('garden-photos', f, userId)
      await submit(undefined, url)
    } catch (err) {
      errorToast(err)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-line p-3">
      {(replyTo || editing) && (
        <div className="mb-2 flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2 text-xs">
          <span className="truncate">{editing ? 'Editing message' : <>Replying to <b>{replyTo!.sender_name}</b>: {replyTo!.body?.slice(0, 60)}</>}</span>
          <button type="button" onClick={() => { onCancel(); setText('') }}><X className="size-4" /></button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <Button type="button" variant="ghost" size="icon" aria-label="Attach photo" onClick={() => fileRef.current?.click()} disabled={busy || !!editing}>
          <ImagePlus className="size-5" />
        </Button>
        <textarea
          value={text}
          rows={1}
          maxLength={2000}
          placeholder="Write a message…"
          onChange={(e) => {
            setText(e.target.value)
            if (Date.now() - lastTyping.current > 1500) {
              lastTyping.current = Date.now()
              onTyping()
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-line bg-surface px-4 py-2.5 text-sm focus:border-ring focus:outline-none"
        />
        <Button type="submit" size="icon" aria-label="Send" loading={busy} disabled={!text.trim()}>
          {!busy && <Send className="size-4" />}
        </Button>
      </div>
    </form>
  )
}
