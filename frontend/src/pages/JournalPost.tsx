import { useQuery } from '@tanstack/react-query'
import { motion, useScroll, useSpring } from 'motion/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useParams } from 'react-router'
import { Container } from '@/components/layout'
import { ProductCard } from '@/components/product'
import { Avatar, Badge, Skeleton } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import type { JournalPost as Post } from '@/lib/types'
import { date } from '@/lib/utils'
import NotFound from './NotFound'
import { mediaUrl } from '@/lib/media'

export default function JournalPost() {
  const { slug = '' } = useParams()
  const post = useQuery({ queryKey: ['journal', 'post', slug], queryFn: () => api.get<Post>(`/journal/${slug}`) })
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 })

  if (post.error instanceof ApiError && post.error.status === 404) return <NotFound />
  const p = post.data
  if (!p) return <Container className="max-w-3xl pt-10"><Skeleton className="h-[60vh] rounded-2xl" /></Container>

  return (
    <article>
      <motion.div style={{ scaleX: progress }} className="fixed top-0 right-0 left-0 z-50 h-1 origin-left bg-primary" />
      <Container className="max-w-3xl pt-8 text-center">
        <div className="mb-4 flex justify-center gap-2">{p.tags.map((t) => <Link key={t} to={`/journal?tag=${t}`}><Badge className="capitalize">{t.replace(/-/g, ' ')}</Badge></Link>)}</div>
        <h1 className="text-3xl font-semibold md:text-4xl">{p.title}</h1>
        <p className="mt-4 text-xl text-muted">{p.excerpt}</p>
        <div className="mt-6 flex items-center justify-center gap-3 text-sm text-muted">
          {p.author && <><Avatar src={p.author.avatar_url} name={p.author.name} className="size-7" /> {p.author.name} ·</>}
          {date(p.published_at)} · {p.reading_minutes} min read
        </div>
      </Container>
      <Container className="mt-10 max-w-5xl">
        <img src={mediaUrl(p.cover_url) ?? ''} alt="" className="aspect-[21/9] w-full rounded-2xl object-cover" />
      </Container>
      <Container className="mt-12 max-w-2xl">
        <div className="prose-leaf text-lg"><Markdown remarkPlugins={[remarkGfm]}>{p.body}</Markdown></div>
      </Container>
      {p.products.length > 0 && (
        <Container className="mt-20">
                    <h2 className="mb-6 text-2xl font-semibold">Plants in this article</h2>
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 xl:grid-cols-5">
            {p.products.map((x, i) => <ProductCard key={x.id} p={x} index={i} />)}
          </div>
        </Container>
      )}
      {p.more.length > 0 && (
        <Container className="mt-20">
          <h2 className="mb-6 text-2xl font-semibold">Keep reading</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {p.more.map((m) => (
              <Link key={m.slug} to={`/journal/${m.slug}`} className="group flex items-center gap-4 rounded-xl border border-line bg-surface p-3">
                <img src={mediaUrl(m.cover_url) ?? ''} alt="" className="size-20 rounded-2xl object-cover" />
                <div><div className="font-semibold group-hover:underline">{m.title}</div><div className="text-xs text-muted">{m.reading_minutes} min read</div></div>
              </Link>
            ))}
          </div>
        </Container>
      )}
    </article>
  )
}
