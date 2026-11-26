import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { BadgeCheck, Camera, ChevronRight, Eye, Heart, Minus, Plus, ShieldCheck, ThumbsUp, Truck } from 'lucide-react'
import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useParams } from 'react-router'
import { Container } from '@/components/layout'
import { CareStat, PlantImage, Price, ProductCard } from '@/components/product'
import { Avatar, Badge, Button, EmptyState, Field, Input, Modal, Segmented, Skeleton, Stars, Textarea } from '@/components/ui'
import { useProductLive } from '@/hooks/useRealtime'
import { api, ApiError } from '@/lib/api'
import { errorToast, keys, useAddToCart, useRequireAuth, useToggleWishlist } from '@/lib/queries'
import { uploadImage } from '@/lib/supabase'
import type { Paged, ProductCard as P, ProductDetail, Review } from '@/lib/types'
import { cn, DIFFICULTY_LABEL, LIGHT_LABEL, timeAgo } from '@/lib/utils'
import { useAuth } from '@/providers/AuthProvider'
import NotFound from './NotFound'

export default function Product() {
  const { slug = '' } = useParams()
  const product = useQuery({ queryKey: keys.product(slug), queryFn: () => api.get<ProductDetail>(`/products/${slug}`) })
  const p = product.data
  const { viewers, liveStock } = useProductLive(p?.id, slug)
  const [qty, setQty] = useState(1)
  const add = useAddToCart()
  const wish = useToggleWishlist()
  const requireAuth = useRequireAuth()

  if (product.error instanceof ApiError && product.error.status === 404) return <NotFound />
  if (!p) {
    return (
      <Container className="grid gap-12 pt-8 lg:grid-cols-2">
        <Skeleton className="aspect-square rounded-2xl" />
        <div className="space-y-4"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-6 w-1/3" /><Skeleton className="h-32" /></div>
      </Container>
    )
  }

  const stock = liveStock ?? p.stock
  const images = [p.image_url, ...p.gallery].filter(Boolean) as string[]

  return (
    <>
      <Container className="pt-4">
        <nav className="mb-6 flex items-center gap-1 text-sm text-muted">
          <Link to="/shop" className="hover:text-fg">Shop</Link><ChevronRight className="size-4" />
          <Link to={`/shop/${p.category.slug}`} className="hover:text-fg">{p.category.name}</Link><ChevronRight className="size-4" />
          <span className="text-fg">{p.name}</span>
        </nav>

        <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <motion.div layoutId={`plant-${p.id}`}>
              <PlantImage src={images[0] ?? null} alt={p.name} className="aspect-square rounded-2xl" imgClassName="p-10" />
            </motion.div>
          </div>

          <div className="lg:pt-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge>{p.category.name}</Badge>
              {viewers > 1 && (
                <Badge className="bg-accent/30 text-fg"><Eye className="size-3" /> {viewers} people viewing now</Badge>
              )}
            </div>
            <h1 className="text-3xl font-semibold md:text-4xl">{p.name}</h1>
            {p.scientific_name && <div className="mt-2 text-lg text-muted italic">{p.scientific_name}</div>}
            <a href="#reviews" className="mt-4 inline-flex items-center gap-2 text-sm">
              <Stars value={p.rating_avg} /> <b>{p.rating_avg}</b> <span className="text-muted">· {p.rating_count} reviews · {p.sold_count} sold</span>
            </a>
            <p className="mt-6 text-lg text-muted">{p.short_description}</p>

            <div className="mt-6 flex items-center gap-4">
              <Price price={p.price} compare={p.compare_at_price} className="text-3xl" />
              <motion.span key={stock} initial={{ scale: 1.15 }} animate={{ scale: 1 }}>
                {stock === 0 ? <Badge className="bg-fg text-bg">Sold out</Badge>
                  : stock <= 5 ? <Badge className="bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">Only {stock} left</Badge>
                    : <Badge className="bg-forest-50 text-forest-700 dark:bg-lime-glow/10 dark:text-lime-glow">In stock</Badge>}
              </motion.span>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <div className="inline-flex h-12 items-center rounded-full border border-line bg-surface">
                <button className="px-4 disabled:opacity-40" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)} aria-label="Decrease"><Minus className="size-4" /></button>
                <span className="w-8 text-center font-semibold">{qty}</span>
                <button className="px-4 disabled:opacity-40" disabled={qty >= stock} onClick={() => setQty((q) => q + 1)} aria-label="Increase"><Plus className="size-4" /></button>
              </div>
              <Button size="lg" className="flex-1" disabled={stock === 0} loading={add.isPending}
                onClick={() => requireAuth() && add.mutate({ product_id: p.id, quantity: qty, name: p.name }, { onSuccess: () => window.dispatchEvent(new Event('nishorgo:open-cart')) })}>
                {stock === 0 ? 'Sold out' : 'Add to cart'}
              </Button>
              <Button size="icon" variant="outline" className="size-12" aria-label="Wishlist" onClick={() => requireAuth() && wish.mutate(p.id)}>
                <Heart className={cn('size-5 transition', p.is_wishlisted && 'scale-110 fill-clay text-clay')} />
              </Button>
            </div>
            {p.in_cart > 0 && <div className="mt-3 text-sm text-muted">You have {p.in_cart} in your cart.</div>}
            {stock === 0 && <div className="mt-3 text-sm text-muted">Save it to your wishlist and we'll email you when it's back.</div>}

            <div className="mt-8 grid grid-cols-2 gap-3">
              <CareStat icon="sun" label="Light" value={LIGHT_LABEL[p.light]} />
              <CareStat icon="water" label="Water" value={`Every ${p.water_every_days} day${p.water_every_days > 1 ? 's' : ''}`} />
              <CareStat icon="pet" label="Pets" value={p.pet_friendly ? 'Pet safe' : 'Keep away from pets'} />
              <CareStat icon="air" label="Care level" value={DIFFICULTY_LABEL[p.difficulty]} />
            </div>

            <div className="mt-8 grid gap-3 rounded-xl bg-surface-2 p-5 text-sm sm:grid-cols-2">
              <div className="flex gap-3"><Truck className="size-5 shrink-0" /> Free delivery over ৳1,500, arrives in 2–4 days</div>
              <div className="flex gap-3"><ShieldCheck className="size-5 shrink-0" /> 30-day healthy plant guarantee</div>
            </div>
          </div>
        </div>

        {p.description && (
          <div className="mt-20 grid gap-10 lg:grid-cols-[1fr_2fr]">
            <h2 className="text-2xl font-semibold">About this plant</h2>
            <div className="prose-leaf text-lg"><Markdown remarkPlugins={[remarkGfm]}>{p.description}</Markdown></div>
          </div>
        )}

        <Reviews product={p} />
      </Container>

      <Recommendations productId={p.id} />
    </>
  )
}

function Reviews({ product }: { product: ProductDetail }) {
  const [sort, setSort] = useState<'helpful' | 'newest' | 'highest' | 'lowest'>('helpful')
  const [writing, setWriting] = useState(false)
  const { session } = useAuth()
  const qc = useQueryClient()
  const reviews = useQuery({
    queryKey: ['reviews', product.id, sort],
    queryFn: () => api.get<Paged<Review>>(`/products/${product.id}/reviews`, { sort, per_page: 6 }),
  })
  const vote = useMutation({
    mutationFn: (id: number) => api.post(`/reviews/${id}/vote`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews', product.id] }),
    onError: errorToast,
  })
  const total = Object.values(product.rating_distribution).reduce((a, b) => a + b, 0)

  return (
    <section id="reviews" className="mt-24 scroll-mt-28">
      <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
        <div>
          <h2 className="text-2xl font-semibold">Reviews</h2>
          <div className="mt-6 flex items-end gap-3">
            <span className="text-5xl font-semibold">{product.rating_avg || '—'}</span>
            <div className="pb-3"><Stars value={product.rating_avg} size={18} /><div className="text-sm text-muted">{product.rating_count} reviews</div></div>
          </div>
          <div className="mt-6 space-y-2">
            {[5, 4, 3, 2, 1].map((s) => {
              const n = product.rating_distribution[s] ?? 0
              return (
                <div key={s} className="flex items-center gap-3 text-sm">
                  <span className="w-3">{s}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <motion.div className="h-full rounded-full bg-amber-400" initial={{ width: 0 }} whileInView={{ width: `${total ? (n / total) * 100 : 0}%` }} viewport={{ once: true }} />
                  </div>
                  <span className="w-6 text-right text-muted">{n}</span>
                </div>
              )
            })}
          </div>
          {session && (
            <Button className="mt-8" variant="outline" onClick={() => setWriting(true)}>Write a review</Button>
          )}
          <p className="mt-3 text-xs text-muted">Reviews marked <BadgeCheck className="inline size-3" /> verified come from customers who received this plant.</p>
        </div>

        <div>
          <Segmented value={sort} onChange={setSort} className="mb-6"
            options={[{ value: 'helpful', label: 'Most helpful' }, { value: 'newest', label: 'Newest' }, { value: 'highest', label: 'Highest' }, { value: 'lowest', label: 'Lowest' }]} />
          {reviews.data?.items.length === 0 && <EmptyState emoji="📝" title="No reviews yet">Be the first to share how this plant is doing.</EmptyState>}
          <div className="space-y-4">
            {reviews.data?.items.map((r) => (
              <motion.article key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-line bg-surface p-6">
                <div className="flex items-center gap-3">
                  <Avatar src={r.author.avatar_url} name={r.author.name} />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {r.author.name}
                      {r.is_verified_purchase && <Badge className="bg-forest-50 text-forest-700 dark:bg-lime-glow/10 dark:text-lime-glow"><BadgeCheck className="size-3" /> Verified buyer</Badge>}
                      <span className="text-xs font-normal text-muted">{r.author.tier}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted"><Stars value={r.rating} size={12} /> {timeAgo(r.created_at)}</div>
                  </div>
                </div>
                {r.title && <h3 className="mt-4 font-sans text-lg font-semibold tracking-normal">{r.title}</h3>}
                {r.body && <p className="mt-1 text-muted">{r.body}</p>}
                {r.photos.length > 0 && (
                  <div className="mt-4 flex gap-2">{r.photos.map((src) => <img key={src} src={src} alt="" className="size-24 rounded-2xl object-cover" />)}</div>
                )}
                {!r.is_mine && session && (
                  <button onClick={() => vote.mutate(r.id)} className={cn('mt-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition', r.has_voted ? 'border-forest-500 bg-forest-50 dark:bg-lime-glow/10' : 'border-line hover:bg-surface-2')}>
                    <ThumbsUp className="size-3.5" /> Helpful · {r.helpful_count}
                  </button>
                )}
                {(r.is_mine || !session) && r.helpful_count > 0 && <div className="mt-4 text-xs text-muted">{r.helpful_count} found this helpful</div>}
              </motion.article>
            ))}
          </div>
        </div>
      </div>
      <ReviewForm product={product} open={writing} onClose={() => setWriting(false)} />
    </section>
  )
}

function ReviewForm({ product, open, onClose }: { product: ProductDetail; open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [rating, setRating] = useState(5)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const submit = useMutation({
    mutationFn: () => api.post<Review>(`/products/${product.id}/reviews`, { rating, title, body, photos }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews', product.id] })
      qc.invalidateQueries({ queryKey: keys.product(product.slug) })
      onClose()
    },
    onError: errorToast,
  })

  return (
    <Modal open={open} onClose={onClose} title={`Review ${product.name}`}>
      <div className="space-y-5">
        {!product.can_review && <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">You haven't received this plant yet, so your review won't carry a verified badge.</div>}
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <button key={s} onClick={() => setRating(s)} className={cn('text-3xl', s <= rating ? 'text-amber-400' : 'text-line')} aria-label={`${s} stars`}>★</button>
          ))}
        </div>
        <Field label="Headline"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Thriving after two weeks!" /></Field>
        <Field label="Your review"><Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="How did it arrive? How is it growing?" /></Field>
        <div>
          <div className="mb-2 text-sm font-semibold">Photos (up to 4)</div>
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => <img key={p} src={p} alt="" className="size-20 rounded-2xl object-cover" />)}
            {photos.length < 4 && (
              <label className="grid size-20 cursor-pointer place-items-center rounded-2xl border border-dashed border-line text-muted hover:bg-surface-2">
                {uploading ? '…' : <Camera className="size-5" />}
                <input type="file" accept="image/*" hidden onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f || !user) return
                  setUploading(true)
                  try { const url = await uploadImage('review-photos', f, user.id); setPhotos((x) => [...x, url]) } catch (err) { errorToast(err) } finally { setUploading(false) }
                }} />
              </label>
            )}
          </div>
        </div>
        <Button className="w-full" size="lg" loading={submit.isPending} onClick={() => submit.mutate()}>Post review</Button>
        <p className="text-center text-xs text-muted">Verified reviews earn 20 Leaf Points.</p>
      </div>
    </Modal>
  )
}

function Recommendations({ productId }: { productId: number }) {
  const recs = useQuery({ queryKey: ['recs', productId], queryFn: () => api.get<P[]>(`/products/${productId}/recommendations`) })
  if (!recs.data?.length) return null
  return (
    <Container className="mt-24">
            <h2 className="mb-6 text-2xl font-semibold">You might also like</h2>
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 xl:grid-cols-6">
        {recs.data.map((p, i) => <ProductCard key={p.id} p={p} index={i} showReason />)}
      </div>
    </Container>
  )
}
