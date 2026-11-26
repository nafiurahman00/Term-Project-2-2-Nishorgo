import { AnimatePresence, motion } from 'motion/react'
import { Heart, LayoutDashboard, LogOut, Menu, Moon, Package, Search, ShoppingBag, Sprout, Sun, User, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useCart } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useNotificationStream } from '@/hooks/useRealtime'
import { useAuth } from '@/providers/AuthProvider'
import { useTheme } from '@/providers/theme'
import { CartDrawer, CommandPalette, LivePurchaseFeed, NotificationBell, SupportWidget } from './overlays'
import { Avatar, Button } from './ui'

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('inline-flex items-center gap-2', className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-fg">
        <Sprout className="size-[18px]" />
      </span>
      <span className="text-lg font-semibold tracking-tight">Nishorgo</span>
    </Link>
  )
}

const NAV = [
  { to: '/shop', label: 'Shop' },
  { to: '/match', label: 'Plant Match' },
  { to: '/garden', label: 'My Garden' },
  { to: '/community', label: 'Greenhouse' },
  { to: '/journal', label: 'Journal' },
]

function UserMenu() {
  const { account, isStaff, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => { setOpen(false) }, [pathname])
  if (!account) return null
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="ml-1 rounded-full" aria-label="Account menu">
        <Avatar src={account.avatar_url} name={account.full_name} className="size-8" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-line bg-surface p-1.5 shadow-lg">
              <div className="mb-1 border-b border-line px-3 pt-2 pb-3">
                <div className="text-sm font-semibold">{account.full_name}</div>
                <div className="text-xs text-muted">{account.tier} member · {account.loyalty_points.toLocaleString()} Leaf Points</div>
              </div>
              {[
                { to: '/account', icon: User, label: 'Account & rewards' },
                { to: '/orders', icon: Package, label: 'Orders' },
                { to: '/wishlist', icon: Heart, label: 'Wishlist' },
                { to: '/garden', icon: Sprout, label: 'My Garden' },
                ...(isStaff ? [{ to: '/admin', icon: LayoutDashboard, label: 'Admin console' }] : []),
              ].map((i) => (
                <Link key={i.to} to={i.to} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-surface-2">
                  <i.icon className="size-4 text-muted" /> {i.label}
                </Link>
              ))}
              <button onClick={signOut} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-danger hover:bg-surface-2">
                <LogOut className="size-4" /> Sign out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function Navbar({ onCart, onSearch }: { onCart: () => void; onSearch: () => void }) {
  const { session } = useAuth()
  const { theme, toggle } = useTheme()
  const cart = useCart()
  const [mobile, setMobile] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => { setMobile(false) }, [pathname])
  const count = cart.data?.item_count ?? 0
  const iconBtn = 'relative grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg'

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5 md:px-6">
        <Logo />
        <nav className="hidden items-center gap-6 md:flex">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cn('text-sm transition-colors', isActive ? 'font-medium text-fg' : 'text-muted hover:text-fg')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={onSearch} className="mr-1 hidden h-9 w-56 items-center gap-2 rounded-lg border border-line bg-bg px-3 text-sm text-muted transition hover:border-fg/20 lg:flex">
            <Search className="size-4" /> Search plants <kbd className="ml-auto text-[11px] text-muted/80">⌘K</kbd>
          </button>
          <button onClick={onSearch} className={cn(iconBtn, 'lg:hidden')} aria-label="Search"><Search className="size-[18px]" /></button>
          <button onClick={toggle} className={iconBtn} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </button>
          {session && <NotificationBell />}
          <button onClick={onCart} className={iconBtn} aria-label="Cart">
            <ShoppingBag className="size-[18px]" />
            {count > 0 && (
              <span className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-fg">{count}</span>
            )}
          </button>
          {session ? <UserMenu /> : (
            <Link to="/login" className="ml-2"><Button size="sm">Sign in</Button></Link>
          )}
          <button onClick={() => setMobile((v) => !v)} className={cn(iconBtn, 'md:hidden')} aria-label="Menu">
            {mobile ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {mobile && (
        <nav className="border-t border-line px-5 py-2 md:hidden">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} className="block py-2.5 text-sm">{n.label}</NavLink>)}
        </nav>
      )}
    </header>
  )
}

function AnnouncementBar() {
  return (
    <div className="bg-primary px-4 py-2 text-center text-xs text-primary-fg">
      Free delivery on orders over ৳1,500 · 30-day healthy plant guarantee
    </div>
  )
}

function Footer() {
  const cols = [
    { title: 'Shop', links: [['All plants', '/shop'], ['Flowering', '/shop/flowering'], ['Fruit trees', '/shop/fruit-trees'], ['Kitchen garden', '/shop/vegetables']] },
    { title: 'Learn', links: [['Plant Match', '/match'], ['Journal', '/journal'], ['Community', '/community']] },
    { title: 'Account', links: [['Orders', '/orders'], ['My Garden', '/garden'], ['Wishlist', '/wishlist']] },
  ]
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 md:grid-cols-5 md:px-6">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted">Healthy plants grown in Bangladesh and delivered to your door, with care help whenever you need it.</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <div className="mb-3 text-sm font-medium">{c.title}</div>
            <ul className="space-y-2 text-sm text-muted">
              {c.links.map(([label, to]) => <li key={to}><Link to={to} className="hover:text-fg">{label}</Link></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-5 py-5 text-xs text-muted md:px-6">
          <span>© {new Date().getFullYear()} Nishorgo. Dhaka, Bangladesh.</span>
          <span>Secure card payments by Stripe</span>
        </div>
      </div>
    </footer>
  )
}

export function AppShell() {
  const [cartOpen, setCartOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { pathname } = useLocation()
  useNotificationStream()

  // Block body: window.scrollTo() returns a Promise in modern Chrome, which
  // React would otherwise treat as an (invalid) effect cleanup.
  useEffect(() => { window.scrollTo({ top: 0 }) }, [pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    const openCart = () => setCartOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('nishorgo:open-cart', openCart)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('nishorgo:open-cart', openCart)
    }
  }, [])

  return (
    <div className="min-h-dvh">
      <AnnouncementBar />
      <Navbar onCart={() => setCartOpen(true)} onSearch={() => setSearchOpen(true)} />
      <main>
        <Outlet />
      </main>
      <Footer />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <LivePurchaseFeed />
      <SupportWidget />
    </div>
  )
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto max-w-7xl px-5 md:px-6', className)}>{children}</div>
}
