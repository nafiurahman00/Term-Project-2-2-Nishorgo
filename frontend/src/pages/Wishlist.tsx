import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Container } from '@/components/layout'
import { ProductCard, ProductGridSkeleton } from '@/components/product'
import { Badge, Button, EmptyState, PageHeader } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/queries'
import type { ProductCard as P } from '@/lib/types'
import { money } from '@/lib/utils'

type WishItem = P & { added_at: string; price_when_added: number; price_dropped: boolean }

export default function Wishlist() {
  const list = useQuery({ queryKey: keys.wishlist, queryFn: () => api.get<WishItem[]>('/wishlist') })
  return (
    <Container className="pt-6">
      <PageHeader title="Wishlist">We'll let you know when a saved plant drops in price or comes back in stock.</PageHeader>
      {list.isLoading ? <ProductGridSkeleton count={4} /> : list.data?.length === 0 ? (
        <EmptyState emoji="💚" title="Nothing saved yet" action={<Link to="/shop"><Button>Explore plants</Button></Link>}>Tap the heart on any plant to save it here.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
          {list.data?.map((p, i) => (
            <div key={p.id}>
              <ProductCard p={p} index={i} />
              {p.price_dropped && <Badge className="mt-2 bg-surface-2 text-clay">Price dropped from {money(p.price_when_added)}</Badge>}
            </div>
          ))}
        </div>
      )}
    </Container>
  )
}
