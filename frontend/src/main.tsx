import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, Suspense, lazy, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/layout'
import { Spinner } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { AuthProvider, useAuth } from '@/providers/AuthProvider'
import { useTheme } from '@/providers/theme'
import './index.css'

const Home = lazy(() => import('@/pages/Home'))
const Shop = lazy(() => import('@/pages/Shop'))
const Product = lazy(() => import('@/pages/Product'))
const Match = lazy(() => import('@/pages/Match'))
const Checkout = lazy(() => import('@/pages/Checkout'))
const Orders = lazy(() => import('@/pages/Orders'))
const OrderDetail = lazy(() => import('@/pages/OrderDetail'))
const Garden = lazy(() => import('@/pages/Garden'))
const Wishlist = lazy(() => import('@/pages/Wishlist'))
const Account = lazy(() => import('@/pages/Account'))
const Community = lazy(() => import('@/pages/Community'))
const Journal = lazy(() => import('@/pages/Journal'))
const JournalPost = lazy(() => import('@/pages/JournalPost'))
const Auth = lazy(() => import('@/pages/Auth'))
const NotFound = lazy(() => import('@/pages/NotFound'))
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'))
const AdminDashboard = lazy(() => import('@/pages/admin/Dashboard'))
const AdminOrders = lazy(() => import('@/pages/admin/Orders'))
const AdminProducts = lazy(() => import('@/pages/admin/Products'))
const AdminCustomers = lazy(() => import('@/pages/admin/Customers'))
const AdminCoupons = lazy(() => import('@/pages/admin/Coupons'))
const AdminSupport = lazy(() => import('@/pages/admin/Support'))
const AdminAudit = lazy(() => import('@/pages/admin/Audit'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
})

const Fallback = () => <div className="grid min-h-[50vh] place-items-center"><Spinner className="size-7" /></div>
const page = (el: ReactNode) => <Suspense fallback={<Fallback />}>{el}</Suspense>

function RequireAuth({ children, staff }: { children: ReactNode; staff?: boolean }) {
  const { session, isStaff, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Fallback />
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (staff && !isStaff) return <Navigate to="/" replace />
  return <>{children}</>
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: page(<Home />) },
      { path: 'shop', element: page(<Shop />) },
      { path: 'shop/:category', element: page(<Shop />) },
      { path: 'plants/:slug', element: page(<Product />) },
      { path: 'match', element: page(<Match />) },
      { path: 'journal', element: page(<Journal />) },
      { path: 'journal/:slug', element: page(<JournalPost />) },
      { path: 'community', element: page(<Community />) },
      { path: 'community/:slug', element: page(<Community />) },
      { path: 'checkout', element: <RequireAuth>{page(<Checkout />)}</RequireAuth> },
      { path: 'orders', element: <RequireAuth>{page(<Orders />)}</RequireAuth> },
      { path: 'orders/:id', element: <RequireAuth>{page(<OrderDetail />)}</RequireAuth> },
      { path: 'garden', element: <RequireAuth>{page(<Garden />)}</RequireAuth> },
      { path: 'wishlist', element: <RequireAuth>{page(<Wishlist />)}</RequireAuth> },
      { path: 'account', element: <RequireAuth>{page(<Account />)}</RequireAuth> },
      { path: 'support', element: <Navigate to="/community" replace /> },
      { path: 'login', element: page(<Auth mode="login" />) },
      { path: 'signup', element: page(<Auth mode="signup" />) },
      { path: 'reset-password', element: page(<Auth mode="reset" />) },
      { path: 'auth/callback', element: page(<Auth mode="callback" />) },
      { path: '*', element: page(<NotFound />) },
    ],
  },
  {
    path: 'admin',
    element: <RequireAuth staff>{page(<AdminLayout />)}</RequireAuth>,
    children: [
      { index: true, element: page(<AdminDashboard />) },
      { path: 'orders', element: page(<AdminOrders />) },
      { path: 'products', element: page(<AdminProducts />) },
      { path: 'customers', element: page(<AdminCustomers />) },
      { path: 'coupons', element: page(<AdminCoupons />) },
      { path: 'support', element: page(<AdminSupport />) },
      { path: 'audit', element: page(<AdminAudit />) },
    ],
  },
])

function ThemedToaster() {
  const { theme } = useTheme()
  return <Toaster theme={theme} position="top-center" toastOptions={{ className: '!rounded-2xl !font-sans' }} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <ThemedToaster />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
