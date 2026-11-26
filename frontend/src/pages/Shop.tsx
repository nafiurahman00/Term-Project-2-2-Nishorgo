import { useInfiniteQuery } from '@tanstack/react-query'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useDeferredValue, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { Container } from '@/components/layout'
import { ProductCard, ProductGridSkeleton } from '@/components/product'
import { Button, Drawer, EmptyState, Select, Switch } from '@/components/ui'
import { api } from '@/lib/api'
import type { Difficulty, Light, SearchResult } from '@/lib/types'
import { cn, DIFFICULTY_LABEL, LIGHT_LABEL } from '@/lib/utils'

const PER_PAGE = 12
const LIGHTS = Object.keys(LIGHT_LABEL) as Light[]
const DIFFS = Object.keys(DIFFICULTY_LABEL) as Difficulty[]

export default function Shop() {
  const { category } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const deferredQ = useDeferredValue(q)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const light = params.getAll('light') as Light[]
  const difficulty = params.getAll('difficulty') as Difficulty[]
  const pet = params.get('pet') === '1'
  const inStock = params.get('in_stock') === '1'
  const sort = params.get('sort') ?? 'relevance'
  const maxPrice = params.get('max') ?? ''

  useEffect(() => {
    const t = setTimeout(() => update((p) => (deferredQ ? p.set('q', deferredQ) : p.delete('q'))), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQ])

  function update(fn: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }
  const toggleMulti = (key: string, value: string) =>
    update((p) => {
      const vals = p.getAll(key)
      p.delete(key)
      ;(vals.includes(value) ? vals.filter((v) => v !== value) : [...vals, value]).forEach((v) => p.append(key, v))
    })

  const query = {
    q: params.get('q') ?? undefined,
    category,
    light,
    difficulty,
    pet_friendly: pet || undefined,
    in_stock: inStock || undefined,
    max_price: maxPrice || undefined,
    sort,
  }

  const results = useInfiniteQuery({
    queryKey: ['products', query],
    queryFn: ({ pageParam }) => api.get<SearchResult>('/products', { ...query, page: pageParam, per_page: PER_PAGE }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.length * PER_PAGE < last.total ? all.length + 1 : undefined),
    placeholderData: (prev) => prev,
  })

  const first = results.data?.pages[0]
  const items = results.data?.pages.flatMap((p) => p.items) ?? []
  const activeCount = light.length + difficulty.length + (pet ? 1 : 0) + (inStock ? 1 : 0) + (maxPrice ? 1 : 0)
  const catName = first?.facets.categories.find((c) => c.slug === category)

  const filters = (
    <div className="space-y-8">
      <FilterGroup title="Category">
        <div className="flex flex-col gap-1">
          <CatButton active={!category} onClick={() => navigate({ pathname: '/shop', search: params.toString() })}>All plants</CatButton>
          {first?.facets.categories.map((c) => (
            <CatButton key={c.slug} active={category === c.slug} onClick={() => navigate({ pathname: `/shop/${c.slug}`, search: params.toString() })}>
              <span>{c.name}</span><span className="text-xs text-muted">{c.count}</span>
            </CatButton>
          ))}
        </div>
      </FilterGroup>
      <FilterGroup title="Light">
        <div className="flex flex-wrap gap-2">
          {LIGHTS.map((l) => <Chip key={l} active={light.includes(l)} onClick={() => toggleMulti('light', l)}>{LIGHT_LABEL[l]}</Chip>)}
        </div>
      </FilterGroup>
      <FilterGroup title="Care level">
        <div className="flex flex-wrap gap-2">
          {DIFFS.map((d) => <Chip key={d} active={difficulty.includes(d)} onClick={() => toggleMulti('difficulty', d)}>{DIFFICULTY_LABEL[d]}</Chip>)}
        </div>
      </FilterGroup>
      <FilterGroup title={`Max price${maxPrice ? ` · ৳${maxPrice}` : ''}`}>
        <input type="range" min={100} max={Math.max(1500, Math.ceil(first?.facets.price_range.max ?? 1500))} step={50}
          value={maxPrice || Math.ceil(first?.facets.price_range.max ?? 1500)}
          onChange={(e) => update((p) => p.set('max', e.target.value))}
          className="w-full accent-[var(--color-forest-500)]" />
      </FilterGroup>
      <div className="space-y-3">
        <Switch checked={pet} onChange={(v) => update((p) => (v ? p.set('pet', '1') : p.delete('pet')))} label="Safe for pets" />
        <Switch checked={inStock} onChange={(v) => update((p) => (v ? p.set('in_stock', '1') : p.delete('in_stock')))} label="In stock only" />
      </div>
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setParams(params.get('q') ? { q: params.get('q')! } : {})}><X className="size-4" /> Clear filters</Button>
      )}
    </div>
  )

  return (
    <Container className="pt-6">
      <div className="mb-10">
                <h1 className="text-3xl font-semibold md:text-4xl">{catName ? catName.name : 'All plants'}</h1>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plants, e.g. “purple flower”"
            className="h-12 w-full rounded-full border border-line bg-surface pr-4 pl-12 focus:border-ring focus:ring-4 focus:ring-ring/15 focus:outline-none" />
        </div>
        <Select value={sort} onChange={(e) => update((p) => p.set('sort', e.target.value))} className="h-12 w-auto rounded-full">
          <option value="relevance">Recommended</option>
          <option value="popular">Bestselling</option>
          <option value="rating">Top rated</option>
          <option value="price_asc">Price: low → high</option>
          <option value="price_desc">Price: high → low</option>
          <option value="newest">Newest</option>
        </Select>
        <Button variant="outline" size="lg" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal className="size-4" /> Filters {activeCount > 0 && `(${activeCount})`}
        </Button>
      </div>

      <div className="grid gap-10 lg:grid-cols-[240px_1fr]">
        <aside className="hidden lg:block"><div className="sticky top-28">{filters}</div></aside>
        <div>
          <div className="mb-5 text-sm text-muted">{first ? `${first.total} plant${first.total === 1 ? '' : 's'}` : ' '}</div>
          {results.isLoading ? <ProductGridSkeleton count={6} /> : items.length === 0 ? (
            <EmptyState emoji="🔍" title="No plants match" action={<Button onClick={() => { setQ(''); setParams({}) }}>Reset search</Button>}>
              Try removing a filter or searching for something else.
            </EmptyState>
          ) : (
            <div className={cn('grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3', results.isPlaceholderData && 'opacity-60 transition-opacity')}>
              {items.map((p, i) => <ProductCard key={p.id} p={p} index={i % PER_PAGE} />)}
            </div>
          )}
          {results.hasNextPage && (
            <div className="mt-12 text-center">
              <Button variant="outline" size="lg" loading={results.isFetchingNextPage} onClick={() => results.fetchNextPage()}>Load more plants</Button>
            </div>
          )}
        </div>
      </div>

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" side="left">{filters}</Drawer>
    </Container>
  )
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-fg">{title}</div>
      {children}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('rounded-full border px-3 py-1.5 text-sm font-medium transition', active ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface hover:border-fg/30')}>
      {children}
    </button>
  )
}

function CatButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('flex items-center justify-between rounded-2xl px-3 py-2 text-left text-sm font-medium transition', active ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg')}>
      {children}
    </button>
  )
}
