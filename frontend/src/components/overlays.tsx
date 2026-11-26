import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Award, Bell, Command, Droplet, MessageCircle, Minus, Package, Plus, Search, Sprout, Star, Tag, Trash2, Truck, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useDeferredValue } from 'react'
import { api } from '@/lib/api'
import { errorToast, keys, useAddToCart, useCart } from '@/lib/queries'
import type { ChatRoom, Notification, SearchResult } from '@/lib/types'
import { cn, money, timeAgo } from '@/lib/utils'
import { useLivePurchases, type LivePurchase } from '@/hooks/useRealtime'
import { useAuth } from '@/providers/AuthProvider'
import { ChatPane } from './chat'
import { PlantImage } from './product'
import { Button, Drawer, EmptyState, Spinner } from './ui'

// ------------------------------------------------------------------ Cart
export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCart()
  const update = useAddToCart()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/cart/items/${id}`),
    onSuccess: (c) => qc.setQueryData(keys.cart, c),
    onError: errorToast,
  })
  const c = cart.data
  const progress = c ? Math.min(100, (c.subtotal / c.free_shipping_threshold) * 100) : 0

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={<span>Your cart {c?.item_count ? <span className="text-muted">({c.item_count})</span> : null}</span>}
      footer={
        c && c.items.length > 0 ? (
          <div className="space-y-4">
            <div className="flex justify-between text-sm"><span className="text-muted">Subtotal</span><span className="font-semibold">{money(c.subtotal)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted">Delivery</span><span className="font-semibold">{c.shipping_fee ? money(c.shipping_fee) : 'Free'}</span></div>
            <Button size="lg" className="w-full" onClick={() => { onClose(); navigate('/checkout') }}>
              Checkout · {money(c.total)} <ArrowRight className="size-4" />
            </Button>
          </div>
        ) : undefined
      }
    >
      {cart.isLoading ? <Spinner /> : !c || c.items.length === 0 ? (
        <EmptyState emoji="🪴" title="Your cart is empty" action={<Button onClick={() => { onClose(); navigate('/shop') }}>Browse plants</Button>}>
          Find a green friend for your windowsill.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl bg-surface-2 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Truck className="size-4" />
              {c.free_shipping_remaining > 0 ? <>Add <b>{money(c.free_shipping_remaining)}</b> more for free delivery</> : <>You've unlocked <b>free delivery</b></>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-line">
              <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${progress}%` }} />
            </div>
          </div>
          <ul className="space-y-4">
            <AnimatePresence initial={false}>
              {c.items.map((it) => (
                <motion.li key={it.id} layout exit={{ opacity: 0, x: 40 }} className="flex gap-4">
                  <Link to={`/plants/${it.slug}`} onClick={onClose}><PlantImage src={it.image_url} alt={it.name} className="size-20 rounded-2xl" imgClassName="p-1.5" /></Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <Link to={`/plants/${it.slug}`} onClick={onClose} className="truncate font-semibold">{it.name}</Link>
                      <span className="font-semibold">{money(it.line_total)}</span>
                    </div>
                    <div className="text-xs text-muted">{money(it.price)} each</div>
                    {it.issue && <div className="mt-1 text-xs font-medium text-danger">{it.issue === 'unavailable' ? 'No longer available' : `Only ${it.stock} in stock`}</div>}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="inline-flex items-center rounded-full border border-line">
                        <button className="p-1.5 disabled:opacity-40" disabled={it.quantity <= 1} onClick={() => update.mutate({ product_id: it.id, quantity: it.quantity - 1, mode: 'set' })}><Minus className="size-3.5" /></button>
                        <span className="w-6 text-center text-sm font-semibold">{it.quantity}</span>
                        <button className="p-1.5 disabled:opacity-40" disabled={it.quantity >= it.stock} onClick={() => update.mutate({ product_id: it.id, quantity: it.quantity + 1, mode: 'set' })}><Plus className="size-3.5" /></button>
                      </div>
                      <button className="ml-auto rounded-full p-1.5 text-muted hover:text-danger" onClick={() => remove.mutate(it.id)} aria-label="Remove"><Trash2 className="size-4" /></button>
                    </div>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}
    </Drawer>
  )
}

// --------------------------------------------------------- Notifications
const kindIcon: Record<Notification['kind'], typeof Bell> = {
  order: Package, stock: Sprout, price_drop: Tag, care: Droplet, loyalty: Award, review: Star, system: Bell, admin: Bell,
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: keys.notifications, queryFn: () => api.get<{ unread: number; items: Notification[] }>('/notifications') })
  const markAll = useMutation({
    mutationFn: (ids?: number[]) => api.post('/notifications/read', { ids: ids ?? null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.notifications })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const unread = q.data?.unread ?? 0
  return (
    // Not `relative` on phones: the panel then anchors to the (sticky) header and
    // spans the screen width instead of hanging off the bell and running off-screen.
    <div ref={ref} className="sm:relative">
      <button aria-label="Notifications" onClick={() => setOpen((v) => !v)} className="relative grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
        <Bell className="size-[18px]" />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-clay px-1 text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
            className="absolute inset-x-3 top-full z-50 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[380px]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-semibold">Notifications</span>
              {unread > 0 && <button onClick={() => markAll.mutate(undefined)} className="text-xs font-semibold text-muted hover:text-fg">Mark all read</button>}
            </div>
            <div className="max-h-[min(60vh,32rem)] overflow-y-auto overscroll-contain">
              {q.data?.items.length ? q.data.items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.read_at) markAll.mutate([n.id])
                    if (n.link) navigate(n.link)
                    setOpen(false)
                  }}
                  className={cn('flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left transition hover:bg-surface-2', !n.read_at && 'bg-accent/10')}
                >
                  {(() => { const I = kindIcon[n.kind]; return <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted"><I className="size-4" /></span> })()}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-muted">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-clay" />}
                </button>
              )) : <div className="p-8 text-center text-sm text-muted">You're all caught up</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// -------------------------------------------------------- ⌘K palette
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const deferred = useDeferredValue(q)
  const navigate = useNavigate()
  const [active, setActive] = useState(0)
  const results = useQuery({
    queryKey: ['palette', deferred],
    queryFn: () => api.get<SearchResult>('/products', { q: deferred, per_page: 6 }),
    enabled: open && deferred.trim().length > 1,
    placeholderData: (p) => p,
  })
  const shortcuts = [
    { label: 'Plant quiz', to: '/match' },
    { label: 'My Garden', to: '/garden' },
    { label: 'Community', to: '/community' },
    { label: 'Journal', to: '/journal' },
    { label: 'My orders', to: '/orders' },
  ]
  const items = deferred.trim().length > 1
    ? (results.data?.items ?? []).map((p) => ({ label: p.name, to: `/plants/${p.slug}`, sub: p.scientific_name, img: p.image_url, price: p.price }))
    : shortcuts.map((s) => ({ ...s, sub: null as string | null, img: null as string | null, price: null as number | null }))

  useEffect(() => { setActive(0) }, [deferred])
  useEffect(() => { if (!open) setQ('') }, [open])

  const go = (to: string) => { navigate(to); onClose() }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
          <motion.div className="absolute inset-0 bg-forest-950/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.96, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
            className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
            <div className="flex items-center gap-3 border-b border-line px-5">
              <Search className="size-5 text-muted" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)) }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
                  if (e.key === 'Enter') {
                    if (items[active]) go(items[active].to)
                    else if (q.trim()) go(`/shop?q=${encodeURIComponent(q.trim())}`)
                  }
                  if (e.key === 'Escape') onClose()
                }}
                placeholder="Search plants — try “purple flower” or “lavendar”…"
                className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
              />
              {results.isFetching && <Spinner className="size-4" />}
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2">
              {items.map((it, i) => (
                <li key={it.to}>
                  <button onMouseEnter={() => setActive(i)} onClick={() => go(it.to)}
                    className={cn('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left', i === active && 'bg-surface-2')}>
                    {it.img ? <PlantImage src={it.img} alt="" className="size-10 rounded-xl" imgClassName="p-0.5" /> : <span className="grid size-10 place-items-center rounded-lg bg-surface-2 text-muted"><ArrowRight className="size-4" /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{it.label}</span>
                      {it.sub && <span className="block truncate text-xs text-muted italic">{it.sub}</span>}
                    </span>
                    {it.price != null && <span className="text-sm font-semibold">{money(it.price)}</span>}
                  </button>
                </li>
              ))}
              {deferred.trim().length > 1 && !results.isFetching && items.length === 0 && (
                <li className="p-6 text-center text-sm text-muted">No plants match “{deferred}”.</li>
              )}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-xs text-muted">
              <span>Search by name, species or colour</span>
              <span className="inline-flex items-center gap-1"><Command className="size-3" />K</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ------------------------------------------------- Live purchase toasts
export function LivePurchaseFeed() {
  const [items, setItems] = useState<(LivePurchase & { key: number })[]>([])
  useLivePurchases((p) => {
    const item = { ...p, key: Date.now() }
    setItems((x) => [...x.slice(-1), item])
    setTimeout(() => setItems((x) => x.filter((y) => y.key !== item.key)), 6000)
  })
  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-40 flex flex-col gap-2">
      <AnimatePresence>
        {items.map((p) => (
          <motion.div key={p.key} initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
            className="glass pointer-events-auto flex max-w-xs items-center gap-3 rounded-xl p-2.5 pr-4 shadow-xl">
            <PlantImage src={p.image} alt="" className="size-12 rounded-2xl" imgClassName="p-1" />
            <div className="text-sm leading-tight">
              <b>{p.name}</b> in {p.city} just adopted{' '}
              {p.slug ? <Link className="font-semibold underline" to={`/plants/${p.slug}`}>{p.product}</Link> : p.product}
              <div className="text-[11px] text-muted">just now</div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// --------------------------------------------------- Ask-an-expert widget
export function SupportWidget() {
  const { session, isStaff } = useAuth()
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // The community chat has its own composer in the bottom-right corner on phones.
  const hideLauncherOnPhone = pathname.startsWith('/community')
  const rooms = useQuery({ queryKey: keys.rooms, queryFn: () => api.get<{ support: ChatRoom[]; community: ChatRoom[] }>('/chat/rooms'), enabled: !!session && !isStaff })
  const active = rooms.data?.support.find((r) => r.status !== 'resolved')
  const start = useMutation({
    mutationFn: () => api.post<ChatRoom>('/support', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rooms }),
    onError: errorToast,
  })
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener('nishorgo:open-support', show)
    return () => window.removeEventListener('nishorgo:open-support', show)
  }, [])
  if (isStaff) return null
  const unread = rooms.data?.support.reduce((n, r) => n + r.unread, 0) ?? 0

  return (
    <>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => (session ? setOpen((v) => !v) : navigate('/login?next=/'))}
        className={cn('fixed right-4 bottom-4 z-40 flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-fg shadow-lg sm:right-5 sm:bottom-5', hideLauncherOnPhone && !open && 'max-md:hidden')}
      >
        {open ? <X className="size-4" /> : <MessageCircle className="size-4" />}
        <span className="hidden sm:inline">Need help?</span>
        {unread > 0 && !open && <span className="grid size-5 place-items-center rounded-full bg-clay text-[11px]">{unread}</span>}
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.96 }}
            className="fixed right-4 bottom-18 z-40 flex h-[min(560px,75dvh)] w-[min(380px,calc(100vw-2rem))] sm:right-5 sm:bottom-20 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
            <div className="border-b border-line p-4">
              <div className="flex items-center gap-2 font-semibold"><Sprout className="size-4" /> Plant help</div>
              <p className="text-sm text-muted">Our team usually replies within a few minutes.</p>
            </div>
            {active ? (
              <ChatPane roomId={active.id} compact className="min-h-0 flex-1" />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="text-sm text-muted">Yellow leaves? Overwatering? Send a photo and a Nishorgo expert will help.</p>
                <Button loading={start.isPending} onClick={() => start.mutate()}>Start a conversation</Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
