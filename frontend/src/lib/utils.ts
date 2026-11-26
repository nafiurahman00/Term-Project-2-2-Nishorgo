import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Difficulty, Light, OrderStatus } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const taka = new Intl.NumberFormat('en-BD', { maximumFractionDigits: 0 })
export const money = (n: number | string | null | undefined) => `৳${taka.format(Number(n ?? 0))}`
export const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export function timeAgo(iso: string | null | undefined) {
  if (!iso) return ''
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60],
  ]
  for (const [unit, secs] of units) if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit)
  return 'just now'
}

export const date = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', opts) : ''

export const LIGHT_LABEL: Record<Light, string> = {
  low: 'Low light',
  medium: 'Medium light',
  bright_indirect: 'Bright, indirect',
  full_sun: 'Full sun',
}
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Beginner friendly', moderate: 'Some experience', expert: 'For experts' }

export const STATUS_META: Record<OrderStatus, { label: string; tone: string }> = {
  pending_payment: { label: 'Awaiting payment', tone: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-300' },
  paid: { label: 'Paid', tone: 'bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-300' },
  processing: { label: 'Packing', tone: 'bg-violet-100 text-violet-900 dark:bg-violet-400/15 dark:text-violet-300' },
  shipped: { label: 'On the way', tone: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-400/15 dark:text-indigo-300' },
  delivered: { label: 'Delivered', tone: 'bg-forest-100 text-forest-900 dark:bg-lime-glow/15 dark:text-lime-glow' },
  cancelled: { label: 'Cancelled', tone: 'bg-stone-200 text-stone-700 dark:bg-white/10 dark:text-stone-300' },
  refunded: { label: 'Refunded', tone: 'bg-rose-100 text-rose-900 dark:bg-rose-400/15 dark:text-rose-300' },
}

export const TIER_META = {
  Seedling: { emoji: '🌱', color: 'from-lime-200 to-emerald-200' },
  Sprout: { emoji: '🌿', color: 'from-emerald-200 to-teal-200' },
  Bloom: { emoji: '🌸', color: 'from-pink-200 to-amber-200' },
  Evergreen: { emoji: '🌳', color: 'from-emerald-300 to-lime-200' },
} as const

export function initials(name?: string | null) {
  return (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'
}
