import type { RealtimeChannel } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import type { Notification } from '@/lib/types'
import { useAuth } from '@/providers/AuthProvider'
import { keys } from '@/lib/queries'

/**
 * Live notifications: every row the database inserts into public.notifications
 * for this user (order updates, price drops, care reminders, chat replies…)
 * arrives here via Supabase Realtime postgres_changes, filtered by RLS.
 */
export function useNotificationStream() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    if (!user || !supabaseConfigured) return
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on<Notification>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        ({ new: n }) => {
          qc.invalidateQueries({ queryKey: keys.notifications })
          qc.invalidateQueries({ queryKey: ['me'] })
          if (n.kind === 'order') {
            qc.invalidateQueries({ queryKey: keys.orders })
            qc.invalidateQueries({ queryKey: ['order'] })
          }
          if (n.kind === 'admin') qc.invalidateQueries({ queryKey: ['admin'] })
          if (n.kind === 'system' && (n.data as { room_id?: string })?.room_id) qc.invalidateQueries({ queryKey: keys.rooms })
          toast(n.title, {
            description: n.body ?? undefined,
            action: n.link ? { label: 'View', onClick: () => navigate(n.link!) } : undefined,
          })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, qc, navigate])
}

/** Live order status: the order page updates the moment Stripe/admin changes it. */
export function useOrderLive(orderId: string | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!orderId || !supabaseConfigured) return
    const channel = supabase
      .channel(`order:${orderId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, () => {
        qc.invalidateQueries({ queryKey: keys.order(orderId) })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [orderId, qc])
}

/** Live stock for a product page, plus Presence: "N people looking at this now". */
export function useProductLive(productId: number | undefined, slug: string) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [viewers, setViewers] = useState(1)
  const [liveStock, setLiveStock] = useState<number | null>(null)

  useEffect(() => {
    if (!productId || !supabaseConfigured) return
    setLiveStock(null)
    const key = user?.id ?? `guest-${crypto.randomUUID()}`
    const channel = supabase.channel(`product:${productId}`, { config: { presence: { key } } })
    channel
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products', filter: `id=eq.${productId}` }, (p) => {
        const stock = (p.new as { stock?: number }).stock
        if (typeof stock === 'number') setLiveStock(stock)
        qc.invalidateQueries({ queryKey: keys.product(slug) })
      })
      .on('presence', { event: 'sync' }, () => setViewers(Math.max(1, Object.keys(channel.presenceState()).length)))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ at: Date.now() })
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [productId, slug, user?.id, qc])

  return { viewers, liveStock }
}

export interface LivePurchase {
  city: string
  name: string
  product: string
  image: string | null
  slug: string | null
  at: string
}

/**
 * Storefront feed — broadcast straight from a database trigger
 * (realtime.send on order paid) to everyone browsing the shop.
 */
export function useLivePurchases(onPurchase: (p: LivePurchase) => void) {
  const cb = useRef(onPurchase)
  cb.current = onPurchase
  useEffect(() => {
    if (!supabaseConfigured) return
    const channel: RealtimeChannel = supabase
      .channel('storefront', { config: { private: false } })
      .on('broadcast', { event: 'purchase' }, ({ payload }) => cb.current(payload as LivePurchase))
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])
}
