import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, History, LayoutDashboard, MessageCircle, Moon, Package, Store, Sun, Ticket, Users } from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { toast } from 'sonner'
import { Logo } from '@/components/layout'
import { Avatar, Badge } from '@/components/ui'
import { api } from '@/lib/api'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import type { ChatRoom } from '@/lib/types'
import { cn, money } from '@/lib/utils'
import { useNotificationStream } from '@/hooks/useRealtime'
import { useAuth } from '@/providers/AuthProvider'
import { useTheme } from '@/providers/theme'

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/orders', label: 'Orders', icon: Package },
  { to: '/admin/products', label: 'Inventory', icon: Boxes },
  { to: '/admin/customers', label: 'Customers', icon: Users },
  { to: '/admin/coupons', label: 'Coupons', icon: Ticket },
  { to: '/admin/support', label: 'Support inbox', icon: MessageCircle, badge: true },
  { to: '/admin/audit', label: 'Audit log', icon: History },
]

export default function AdminLayout() {
  const { account, role } = useAuth()
  const { theme, toggle } = useTheme()
  const qc = useQueryClient()
  const { pathname } = useLocation()
  useNotificationStream()
  const rooms = useQuery({ queryKey: ['chat', 'rooms'], queryFn: () => api.get<{ support: ChatRoom[] }>('/chat/rooms'), refetchInterval: 60_000 })
  const waiting = rooms.data?.support.filter((r) => r.status === 'waiting').length ?? 0

  // Staff-wide live feed: new orders and support rooms pop in without refresh.
  useEffect(() => {
    if (!supabaseConfigured) return
    const ch = supabase
      .channel('admin-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (p) => {
        const o = p.new as { status: string; order_number: string; total: number }
        const old = p.old as { status?: string }
        if (o.status === 'paid' && old.status !== 'paid') toast.success(`New paid order ${o.order_number}`, { description: money(o.total) })
        qc.invalidateQueries({ queryKey: ['admin'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_rooms' }, () => qc.invalidateQueries({ queryKey: ['chat', 'rooms'] }))
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [qc])

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
        <Logo className="px-2" />
        <Badge className="mx-2 mt-2 w-fit bg-accent/40 capitalize">{role} console</Badge>
        <nav className="mt-6 flex-1 space-y-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cn('flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition', isActive ? 'bg-primary text-primary-fg' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
              <n.icon className="size-4" /> {n.label}
              {n.badge && waiting > 0 && <span className="ml-auto grid size-5 place-items-center rounded-full bg-clay text-[11px] font-bold text-white">{waiting}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 border-t border-line pt-4">
          <NavLink to="/" className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm text-muted hover:bg-surface-2"><Store className="size-4" /> View storefront</NavLink>
          <button onClick={toggle} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-sm text-muted hover:bg-surface-2">
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />} {theme === 'dark' ? 'Light' : 'Dark'} mode
          </button>
          <div className="flex items-center gap-3 px-3 pt-2">
            <Avatar src={account?.avatar_url} name={account?.full_name} className="size-8" />
            <div className="min-w-0 text-sm"><div className="truncate font-semibold">{account?.full_name}</div><div className="truncate text-xs text-muted">{account?.email}</div></div>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-line bg-surface/90 p-2 backdrop-blur lg:hidden">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn('shrink-0 rounded-full px-3 py-1.5 text-sm', isActive ? 'bg-primary text-primary-fg' : 'text-muted')}>{n.label}</NavLink>
          ))}
        </div>
        <main key={pathname} className="mx-auto max-w-7xl p-5 md:p-8"><Outlet /></main>
      </div>
    </div>
  )
}
