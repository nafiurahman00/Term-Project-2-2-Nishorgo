import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Award, Bell, Leaf, MessageCircle, ShieldCheck, Star, Truck } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Container } from '@/components/layout'
import { PlantImage, ProductCard, ProductGridSkeleton } from '@/components/product'
import { Button } from '@/components/ui'
import { api } from '@/lib/api'
import type { Category, JournalCard, ProductCard as P } from '@/lib/types'
import { date } from '@/lib/utils'

interface HomeData {
  featured: P[]
  popular: P[]
  categories: Category[]
  journal: JournalCard[]
  stats: { plants: number; reviews: number; rating: string | null }
}

const CATEGORY_IMAGE: Record<string, string> = {
  flowering: '/plants/rose.webp',
  'fruit-trees': '/plants/mango.webp',
  vegetables: '/plants/tomato.webp',
  'herbs-greens': '/plants/lavender.webp',
}

const HERO = [
  { slug: 'miniature-rose', name: 'Miniature Rose', img: '/plants/rose.webp' },
  { slug: 'moth-orchid', name: 'Moth Orchid', img: '/plants/orchids.webp' },
  { slug: 'dwarf-mango-amrapali', name: 'Dwarf Mango', img: '/plants/mango.webp' },
  { slug: 'cherry-tomato', name: 'Cherry Tomato', img: '/plants/tomato.webp' },
]

export default function Home() {
  const { data, isLoading } = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeData>('/home') })

  return (
    <>
      {/* Hero */}
      <section className="border-b border-line bg-surface">
        <Container className="grid items-center gap-10 py-12 md:grid-cols-2 md:py-16">
          <div>
            <h1 className="text-4xl leading-tight font-semibold md:text-5xl">Healthy plants, delivered across Bangladesh</h1>
            <p className="mt-4 max-w-md text-lg text-muted">
              Flowering plants, fruit trees and kitchen-garden favourites — grown locally, packed with care, and backed by real people when you need advice.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/shop"><Button size="lg">Shop plants <ArrowRight className="size-4" /></Button></Link>
              <Link to="/match"><Button size="lg" variant="outline">Help me choose</Button></Link>
            </div>
            {data?.stats.rating && (
              <div className="mt-8 flex items-center gap-2 text-sm text-muted">
                <Star className="size-4 fill-amber-400 text-amber-400" />
                <span><span className="font-medium text-fg">{data.stats.rating}/5</span> from {data.stats.reviews} verified reviews</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {HERO.map((h) => (
              <Link key={h.slug} to={`/plants/${h.slug}`} className="group relative">
                <PlantImage src={h.img} alt={h.name} className="aspect-square rounded-xl" imgClassName="p-6 group-hover:scale-[1.03]" />
                <span className="absolute bottom-3 left-3 rounded-md bg-surface/90 px-2 py-1 text-xs font-medium shadow-sm">{h.name}</span>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      {/* Promises */}
      <Container className="py-8">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Perk icon={<Truck className="size-5" />} title="Free delivery over ৳1,500">2–4 days anywhere in Dhaka</Perk>
          <Perk icon={<ShieldCheck className="size-5" />} title="30-day guarantee">Healthy on arrival, or we replace it</Perk>
          <Perk icon={<MessageCircle className="size-5" />} title="Ask a plant expert">Free advice by chat</Perk>
          <Perk icon={<Award className="size-5" />} title="Leaf Points">Earn on every order</Perk>
        </div>
      </Container>

      {/* Categories */}
      <Container className="mt-10">
        <SectionTitle title="Shop by category" link={{ to: '/shop', label: 'View all' }} />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {(data?.categories ?? []).map((c) => (
            <Link key={c.slug} to={`/shop/${c.slug}`} className="group">
              <PlantImage src={CATEGORY_IMAGE[c.slug] ?? null} alt={c.name} className="aspect-[4/3] rounded-xl" imgClassName="p-4 group-hover:scale-[1.03]" />
              <div className="mt-2.5 flex items-baseline justify-between">
                <span className="font-medium group-hover:underline">{c.name}</span>
                <span className="text-sm text-muted">{c.count}</span>
              </div>
            </Link>
          ))}
        </div>
      </Container>

      {/* Featured */}
      <Container className="mt-16">
        <SectionTitle title="Our picks this season" link={{ to: '/shop', label: 'Shop all' }} />
        {isLoading ? <ProductGridSkeleton /> : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
            {data?.featured.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        )}
      </Container>

      {/* Quiz banner */}
      <Container className="mt-16">
        <div className="flex flex-col items-start justify-between gap-6 rounded-xl border border-line bg-accent px-6 py-8 md:flex-row md:items-center md:px-10">
          <div>
            <h2 className="text-2xl font-semibold text-accent-fg">Not sure what will grow in your space?</h2>
            <p className="mt-1.5 max-w-xl text-accent-fg/80">Answer five quick questions about light, watering and pets, and we'll suggest plants that suit you.</p>
          </div>
          <Link to="/match"><Button size="lg">Take the plant quiz</Button></Link>
        </div>
      </Container>

      {/* Bestsellers */}
      <Container className="mt-16">
        <SectionTitle title="Bestsellers" />
        {isLoading ? <ProductGridSkeleton count={4} /> : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-4">
            {data?.popular.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        )}
      </Container>

      {/* After you buy */}
      <Container className="mt-20">
        <SectionTitle title="After your plants arrive" />
        <div className="grid gap-8 md:grid-cols-3">
          <Feature icon={<Bell className="size-5" />} title="Care reminders" to="/garden">
            Every plant you order is added to My Garden, with watering and feeding reminders based on its species.
          </Feature>
          <Feature icon={<MessageCircle className="size-5" />} title="Help from people who know plants" to="/community">
            Ask our team about yellow leaves or pests, or swap tips with other growers in the community rooms.
          </Feature>
          <Feature icon={<Leaf className="size-5" />} title="Rewards that add up" to="/account">
            Collect Leaf Points on orders, reviews and care streaks, and spend them on your next plant.
          </Feature>
        </div>
      </Container>

      {/* Journal */}
      {!!data?.journal.length && (
        <Container className="mt-20">
          <SectionTitle title="From the journal" link={{ to: '/journal', label: 'All articles' }} />
          <div className="grid gap-8 md:grid-cols-3">
            {data.journal.map((j) => (
              <Link key={j.slug} to={`/journal/${j.slug}`} className="group">
                <img src={j.cover_url ?? ''} alt="" className="aspect-[3/2] w-full rounded-xl object-cover" />
                <div className="mt-3 text-xs text-muted">{date(j.published_at)} · {j.reading_minutes} min read</div>
                <h3 className="mt-1 text-lg font-semibold group-hover:underline">{j.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{j.excerpt}</p>
              </Link>
            ))}
          </div>
        </Container>
      )}
    </>
  )
}

function SectionTitle({ title, link }: { title: string; link?: { to: string; label: string } }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <h2 className="text-2xl font-semibold">{title}</h2>
      {link && <Link to={link.to} className="flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">{link.label} <ArrowRight className="size-4" /></Link>}
    </div>
  )
}

function Perk({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg">{icon}</span>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-sm text-muted">{children}</div>
      </div>
    </div>
  )
}

function Feature({ icon, title, to, children }: { icon: ReactNode; title: string; to: string; children: ReactNode }) {
  return (
    <div>
      <span className="grid size-10 place-items-center rounded-lg bg-accent text-accent-fg">{icon}</span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted">{children}</p>
      <Link to={to} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Learn more <ArrowRight className="size-3.5" /></Link>
    </div>
  )
}
