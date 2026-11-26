import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { Container } from '@/components/layout'
import { PlantImage } from '@/components/product'
import { Badge, Button, EmptyState, PageHeader, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { keys } from '@/lib/queries'
import type { OrderSummary } from '@/lib/types'
import { cn, date, money, STATUS_META } from '@/lib/utils'

export default function Orders() {
  const orders = useQuery({ queryKey: keys.orders, queryFn: () => api.get<OrderSummary[]>('/orders') })
  return (
    <Container className="max-w-4xl pt-6">
      <PageHeader title="Orders">Track your deliveries and view past orders.</PageHeader>
      {orders.isLoading && <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>}
      {orders.data?.length === 0 && <EmptyState emoji="📦" title="No orders yet" action={<Link to="/shop"><Button>Start shopping</Button></Link>}>Your first plant is waiting.</EmptyState>}
      <div className="space-y-3">
        {orders.data?.map((o, i) => (
          <motion.div key={o.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            <Link to={`/orders/${o.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition hover:shadow-lg sm:gap-4 sm:p-4">
              <div className="flex shrink-0 sm:-space-x-4">
                {o.thumbnails.slice(0, 3).map((t, j) => (
                  <PlantImage key={j} src={t} alt="" className={cn('size-12 rounded-xl border-2 border-surface sm:size-14 sm:rounded-2xl', j > 0 && 'hidden sm:block')} imgClassName="p-1" />
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold whitespace-nowrap">{o.order_number}</div>
                <div className="truncate text-sm text-muted">
                  {date(o.placed_at)} · {o.item_count} item{o.item_count > 1 ? 's' : ''}
                </div>
                <div className="mt-1.5 flex items-center gap-2 sm:hidden">
                  <Badge className={STATUS_META[o.status].tone}>{STATUS_META[o.status].label}</Badge>
                  <span className="text-sm font-semibold">{money(o.total)}</span>
                </div>
              </div>
              <Badge className={cn('hidden sm:inline-flex', STATUS_META[o.status].tone)}>{STATUS_META[o.status].label}</Badge>
              <div className="hidden w-24 text-right font-semibold sm:block">{money(o.total)}</div>
              <ChevronRight className="size-5 shrink-0 text-muted" />
            </Link>
          </motion.div>
        ))}
      </div>
    </Container>
  )
}
