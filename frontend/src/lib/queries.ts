import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from './api'
import type { Cart, ProductDetail } from './types'
import { useAuth } from '@/providers/AuthProvider'
import { useNavigate } from 'react-router'

export const keys = {
  cart: ['cart'] as const,
  wishlist: ['wishlist'] as const,
  product: (slug: string) => ['product', slug] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['order', id] as const,
  garden: ['garden'] as const,
  notifications: ['notifications'] as const,
  addresses: ['addresses'] as const,
  rooms: ['chat', 'rooms'] as const,
  messages: (room: string) => ['chat', 'messages', room] as const,
}

export function errorToast(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
}

export function useCart() {
  const { session } = useAuth()
  return useQuery({ queryKey: keys.cart, queryFn: () => api.get<Cart>('/cart'), enabled: !!session })
}

/** Redirects to login when signed out; returns false so callers can bail. */
export function useRequireAuth() {
  const { session } = useAuth()
  const navigate = useNavigate()
  return () => {
    if (session) return true
    toast('Please sign in to continue', { action: { label: 'Sign in', onClick: () => navigate('/login') } })
    navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
    return false
  }
}

export function useAddToCart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { product_id: number; quantity: number; mode?: 'add' | 'set'; name?: string }) =>
      api.post<Cart>('/cart/items', { product_id: v.product_id, quantity: v.quantity, mode: v.mode ?? 'add' }),
    onSuccess: (cart, v) => {
      qc.setQueryData(keys.cart, cart)
      qc.invalidateQueries({ queryKey: ['product'] })
      if (v.mode !== 'set') toast.success(`${v.name ?? 'Plant'} added to your cart`, { description: `${cart.item_count} items · ৳${Math.round(cart.subtotal)}` })
    },
    onError: errorToast,
  })
}

export function useToggleWishlist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (productId: number) => api.post<{ wishlisted: boolean }>(`/wishlist/${productId}`),
    onMutate: async (productId) => {
      // Optimistically flip the heart on any cached product detail.
      qc.setQueriesData<ProductDetail>({ queryKey: ['product'] }, (p) =>
        p && p.id === productId ? { ...p, is_wishlisted: !p.is_wishlisted } : p,
      )
    },
    onSuccess: (r) => {
      toast(r.wishlisted ? 'Saved to wishlist' : 'Removed from wishlist', {
        description: r.wishlisted ? "We'll ping you on price drops and restocks." : undefined,
      })
      qc.invalidateQueries({ queryKey: keys.wishlist })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['product'] })
      errorToast(e)
    },
  })
}
