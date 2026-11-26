import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Link, useSearchParams } from 'react-router'
import { Container } from '@/components/layout'
import { PageHeader, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import type { JournalCard, Paged } from '@/lib/types'
import { cn, date } from '@/lib/utils'

export default function Journal() {
  const [params, setParams] = useSearchParams()
  const tag = params.get('tag')
  const list = useQuery({
    queryKey: ['journal', tag],
    queryFn: () => api.get<Paged<JournalCard> & { tags: string[] }>('/journal', { tag: tag ?? undefined }),
    placeholderData: (p) => p,
  })
  const [lead, ...rest] = list.data?.items ?? []

  return (
    <Container className="pt-6">
      <PageHeader title="Journal">Care guides, growing tips and a little plant history.</PageHeader>
      <div className="mb-10 flex flex-wrap gap-2">
        {[null, ...(list.data?.tags ?? [])].map((t) => (
          <button key={t ?? 'all'} onClick={() => setParams(t ? { tag: t } : {})}
            className={cn('rounded-full border px-4 py-1.5 text-sm font-medium capitalize transition', tag === t ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface hover:border-fg/30')}>
            {t?.replace(/-/g, ' ') ?? 'All'}
          </button>
        ))}
      </div>
      {list.isLoading && <Skeleton className="h-96 rounded-2xl" />}
      {lead && (
        <Link to={`/journal/${lead.slug}`} className="group mb-14 grid items-center gap-8 md:grid-cols-2">
          <div className="overflow-hidden rounded-2xl"><img src={lead.cover_url ?? ''} alt="" className="aspect-[4/3] w-full object-cover transition duration-700 group-hover:scale-105" /></div>
          <div>
            <div className="text-sm text-muted">{date(lead.published_at)} · {lead.reading_minutes} min read</div>
            <h2 className="mt-2 text-3xl font-semibold group-hover:underline">{lead.title}</h2>
            <p className="mt-4 text-lg text-muted">{lead.excerpt}</p>
          </div>
        </Link>
      )}
      <div className="grid gap-x-6 gap-y-12 md:grid-cols-3">
        {rest.map((j, i) => (
          <motion.div key={j.slug} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}>
            <Link to={`/journal/${j.slug}`} className="group block">
              <div className="overflow-hidden rounded-2xl"><img src={j.cover_url ?? ''} alt="" className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-105" /></div>
              <div className="mt-4 text-xs text-muted">{date(j.published_at)} · {j.reading_minutes} min read</div>
              <h3 className="mt-1 text-lg font-semibold group-hover:underline">{j.title}</h3>
              <p className="mt-1 line-clamp-2 text-muted">{j.excerpt}</p>
            </Link>
          </motion.div>
        ))}
      </div>
    </Container>
  )
}
