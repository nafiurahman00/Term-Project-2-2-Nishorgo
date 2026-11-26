import { Droplet, Heart, PawPrint, Sprout, Sun, Wind } from 'lucide-react'
import { Link } from 'react-router'
import { useAddToCart, useRequireAuth, useToggleWishlist } from '@/lib/queries'
import type { ProductCard as Product } from '@/lib/types'
import { cn, LIGHT_LABEL, money } from '@/lib/utils'
import { Badge, Button, Stars } from './ui'
import { mediaUrl } from '@/lib/media'

export function PlantImage({ src, alt, className, imgClassName }: { src: string | null; alt: string; className?: string; imgClassName?: string }) {
  const url = mediaUrl(src)
  return (
    <div className={cn('plant-stage', className)}>
      {url ? (
        <img src={url} alt={alt} loading="lazy" className={cn('h-full w-full object-contain p-4 transition-transform duration-500', imgClassName)} />
      ) : (
        <div className="grid h-full place-items-center text-muted"><Sprout className="size-10" /></div>
      )}
    </div>
  )
}

export function Price({ price, compare, className }: { price: number; compare?: number | null; className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-2', className)}>
      <span className="font-semibold">{money(price)}</span>
      {compare ? <span className="text-sm text-muted line-through">{money(compare)}</span> : null}
    </span>
  )
}

export function CareChips({ p, className }: { p: Pick<Product, 'light' | 'pet_friendly' | 'air_purifying' | 'edible'>; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      <Badge className="bg-surface-2 text-muted"><Sun className="size-3" /> {LIGHT_LABEL[p.light]}</Badge>
      {p.pet_friendly && <Badge className="bg-forest-50 text-forest-700 dark:bg-lime-glow/10 dark:text-lime-glow"><PawPrint className="size-3" /> Pet safe</Badge>}
      {p.air_purifying && <Badge className="bg-sky-50 text-sky-800 dark:bg-sky-400/10 dark:text-sky-300"><Wind className="size-3" /> Air purifier</Badge>}
      {p.edible && <Badge className="bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">Edible</Badge>}
    </div>
  )
}

export function ProductCard({ p, showReason }: { p: Product; index?: number; showReason?: boolean }) {
  const add = useAddToCart()
  const wish = useToggleWishlist()
  const requireAuth = useRequireAuth()
  const off = p.compare_at_price ? Math.round((1 - p.price / p.compare_at_price) * 100) : 0
  // One badge at most, in priority order.
  const badge = p.stock === 0 ? { text: 'Sold out', tone: 'bg-surface text-muted' }
    : p.stock <= 5 ? { text: `Only ${p.stock} left`, tone: 'bg-surface text-clay' }
      : off > 0 ? { text: `${off}% off`, tone: 'bg-surface text-clay' } : null

  return (
    <article className="group flex flex-col">
      <div className="relative">
        <Link to={`/plants/${p.slug}`} className="block">
          <PlantImage src={p.image_url} alt={p.name} className="aspect-square rounded-xl" imgClassName="p-5 group-hover:scale-[1.03]" />
        </Link>
        {badge && <span className={cn('absolute top-3 left-3 rounded-md px-2 py-0.5 text-xs font-medium shadow-sm', badge.tone)}>{badge.text}</span>}
        <button
          aria-label="Save to wishlist"
          onClick={() => requireAuth() && wish.mutate(p.id)}
          className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-surface text-muted shadow-sm transition hover:text-clay focus:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 sm:top-3 sm:right-3"
        >
          <Heart className="size-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-1 flex-col">
        {/* Stacked on narrow cards so long names aren't squeezed beside the price. */}
        <div className="flex flex-col gap-0.5 lg:flex-row lg:items-start lg:justify-between lg:gap-3">
          <Link to={`/plants/${p.slug}`} className="line-clamp-2 min-w-0 font-medium hover:underline">{p.name}</Link>
          <Price price={p.price} compare={p.compare_at_price} className="shrink-0 text-sm" />
        </div>
        <div className="mt-0.5 truncate text-sm text-muted">{p.scientific_name ?? p.category.name}</div>
        {p.rating_count > 0 && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted"><Stars value={p.rating_avg} size={12} /> ({p.rating_count})</div>
        )}
        <div className="h-3 shrink-0" />
        {showReason && (p.reasons?.length || p.reason) ? (
          <div className="mt-2 text-xs text-muted">{(p.reasons ?? [p.reason!]).slice(0, 2).join(' · ')}</div>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="mt-auto w-full"
          disabled={p.stock === 0 || add.isPending}
          onClick={() => requireAuth() && add.mutate({ product_id: p.id, quantity: 1, name: p.name })}
        >
          {p.stock === 0 ? 'Sold out' : 'Add to cart'}
        </Button>
      </div>
    </article>
  )
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className="skeleton aspect-square rounded-xl" />
          <div className="skeleton mt-4 h-5 w-2/3" />
          <div className="skeleton mt-2 h-4 w-1/3" />
        </div>
      ))}
    </div>
  )
}

export function CareStat({ icon, label, value }: { icon: 'sun' | 'water' | 'pet' | 'air'; label: string; value: string }) {
  const Icon = { sun: Sun, water: Droplet, pet: PawPrint, air: Wind }[icon]
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-forest-500 dark:text-lime-glow" />
      <div><div className="text-xs text-muted">{label}</div>
      <div className="text-sm font-medium">{value}</div></div>
    </div>
  )
}
