import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarCheck, Droplet, Flame, Leaf, MoreHorizontal, Plus, Sparkles, Trash2, Wind } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Container } from '@/components/layout'
import { PlantImage } from '@/components/product'
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, ProgressRing, Segmented, Select, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { errorToast, keys } from '@/lib/queries'
import { uploadImage } from '@/lib/supabase'
import type { CareTask, GardenOverview, GardenPlant, Light } from '@/lib/types'
import { cn, LIGHT_LABEL, timeAgo } from '@/lib/utils'
import { useAuth } from '@/providers/AuthProvider'

export default function Garden() {
  const garden = useQuery({ queryKey: keys.garden, queryFn: () => api.get<GardenOverview>('/garden') })
  const [filter, setFilter] = useState<'all' | 'attention'>('all')
  const [adding, setAdding] = useState(false)
  const g = garden.data
  const attention = g?.plants.filter((p) => p.water_due_in_days < 0 || (p.fertilize_due_in_days ?? 1) < 0) ?? []
  const shown = filter === 'attention' ? attention : g?.plants ?? []
  const avgHealth = g?.plants.length ? Math.round(g.plants.reduce((s, p) => s + p.health, 0) / g.plants.length) : 0

  return (
    <Container className="pt-6">
      <PageHeader title="My Garden"
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add a plant</Button>}>
        Plants you order appear here once they're delivered. Log watering and feeding to keep reminders on track.
      </PageHeader>

      {garden.isLoading ? <Skeleton className="h-40 rounded-2xl" /> : g && (
        <div className="mb-10 grid gap-4 md:grid-cols-4">
          <Stat icon={<Flame className="size-5 text-orange-500" />} label="Care streak" value={`${g.streak.current} day${g.streak.current === 1 ? '' : 's'}`} sub={`Best streak: ${g.streak.best} day${g.streak.best === 1 ? '' : 's'}`} highlight={g.streak.current >= 3} />
          <Stat icon={<Leaf className="size-5 text-forest-500" />} label="Plants" value={String(g.plants.length)} sub={`${attention.length} need attention`} />
          <Stat icon={<CalendarCheck className="size-5 text-sky-500" />} label="This week" value={`${g.week.tasks_done} tasks`} sub={`Active ${g.week.days_active} of 7 days`} />
          <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5">
            <ProgressRing value={avgHealth} size={72} stroke={7}>{avgHealth}%</ProgressRing>
            <div><div className="text-sm font-medium">Garden health</div><div className="text-sm text-muted">Average across all plants</div></div>
          </div>
        </div>
      )}

      {g && g.plants.length > 0 && (
        <Segmented value={filter} onChange={setFilter} className="mb-6"
          options={[{ value: 'all', label: `All plants (${g.plants.length})` }, { value: 'attention', label: `Needs attention (${attention.length})` }]} />
      )}

      {g && g.plants.length === 0 ? (
        <EmptyState emoji="🪴" title="Your garden is empty" action={<div className="flex gap-3"><Link to="/shop"><Button>Shop plants</Button></Link><Button variant="outline" onClick={() => setAdding(true)}>Add one you own</Button></div>}>
          Buy a plant and it'll appear here on delivery — or add plants you already have.
        </EmptyState>
      ) : (
        <motion.div layout className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence>
            {shown.map((p) => <PlantTile key={p.id} p={p} />)}
          </AnimatePresence>
        </motion.div>
      )}
      <AddPlantModal open={adding} onClose={() => setAdding(false)} />
    </Container>
  )
}

function Stat({ icon, label, value, sub, highlight }: { icon: React.ReactNode; label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={cn('rounded-xl border border-line p-5', highlight ? 'bg-accent text-accent-fg' : 'bg-surface')}>
      <div className="mb-2 flex items-center gap-2 text-sm text-muted">{icon}{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs opacity-70">{sub}</div>
    </div>
  )
}

function dueLabel(days: number | null) {
  if (days == null) return null
  if (days < 0) return { text: `${-days}d overdue`, tone: 'text-danger' }
  if (days === 0) return { text: 'Today', tone: 'text-amber-600 dark:text-amber-400' }
  if (days === 1) return { text: 'Tomorrow', tone: 'text-muted' }
  return { text: `in ${days} days`, tone: 'text-muted' }
}

function PlantTile({ p }: { p: GardenPlant }) {
  const qc = useQueryClient()
  const [menu, setMenu] = useState(false)
  const care = useMutation({
    mutationFn: (task: CareTask) => api.post<GardenPlant>(`/garden/plants/${p.id}/care`, { task }),
    onSuccess: () => {
      const before = qc.getQueryData<GardenOverview>(keys.garden)?.streak.current ?? 0
      qc.invalidateQueries({ queryKey: keys.garden }).then(() => {
        const after = qc.getQueryData<GardenOverview>(keys.garden)?.streak.current ?? 0
        if (after > before) {
          toast.success(`${after}-day care streak`)
        }
      })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
    onError: errorToast,
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/garden/plants/${p.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.garden }),
    onError: errorToast,
  })
  const water = dueLabel(p.water_due_in_days)
  const feed = dueLabel(p.fertilize_due_in_days)

  return (
    <motion.article layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
      className="relative overflow-hidden rounded-2xl border border-line bg-surface p-4">
      <div className="relative">
        <PlantImage src={p.photo_url} alt={p.nickname} className="aspect-[4/3] rounded-xl" />
        <div className="absolute top-3 right-3 rounded-full bg-surface/90 p-1 shadow backdrop-blur"><ProgressRing value={p.health} size={52} stroke={5}>{p.health}</ProgressRing></div>
        {p.water_due_in_days < 0 && <Badge className="absolute top-3 left-3 bg-surface text-danger shadow-sm">Needs water</Badge>}
      </div>
      <div className="mt-4 flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{p.nickname}</h3>
          <div className="truncate text-sm text-muted italic">{p.species ?? (p.light ? LIGHT_LABEL[p.light] : 'Custom plant')}{p.location ? ` · ${p.location}` : ''}</div>
        </div>
        <div className="relative">
          <button className="rounded-full p-2 hover:bg-surface-2" onClick={() => setMenu((v) => !v)} aria-label="More"><MoreHorizontal className="size-5" /></button>
          {menu && (
            <div className="absolute right-0 z-10 mt-1 w-44 rounded-2xl border border-line bg-surface p-1 shadow-xl">
              {p.product_slug && <Link to={`/plants/${p.product_slug}`} className="block rounded-xl px-3 py-2 text-sm hover:bg-surface-2">View in shop</Link>}
              <button onClick={() => care.mutate('prune')} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2">Log pruning</button>
              <button onClick={() => care.mutate('repot')} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2">Log repotting</button>
              <button onClick={() => confirm(`Remove ${p.nickname}?`) && remove.mutate()} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-danger hover:bg-surface-2"><Trash2 className="size-4" /> Remove</button>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 px-1 text-sm">
        <div className="rounded-2xl bg-surface-2 p-3"><div className="flex items-center gap-1.5 text-xs text-muted"><Droplet className="size-3.5 text-sky-500" /> Water</div><div className={cn('font-semibold', water?.tone)}>{water?.text}</div></div>
        <div className="rounded-2xl bg-surface-2 p-3"><div className="flex items-center gap-1.5 text-xs text-muted"><Sparkles className="size-3.5 text-amber-500" /> Feed</div><div className={cn('font-semibold', feed?.tone)}>{feed?.text ?? '—'}</div></div>
      </div>
      <div className="mt-3 flex gap-2 px-1">
        <Button className="flex-1" size="sm" loading={care.isPending && care.variables === 'water'} onClick={() => care.mutate('water')}><Droplet className="size-4" /> Water</Button>
        {p.fertilize_every_days && <Button variant="soft" size="sm" onClick={() => care.mutate('fertilize')}><Sparkles className="size-4" /> Feed</Button>}
        <Button variant="soft" size="sm" onClick={() => care.mutate('mist')} aria-label="Mist"><Wind className="size-4" /></Button>
      </div>
      {p.recent_care[0] && <div className="mt-3 px-1 text-xs text-muted">Last: {p.recent_care[0].task} {timeAgo(p.recent_care[0].at)}</div>}
    </motion.article>
  )
}

function AddPlantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [form, setForm] = useState({ nickname: '', species: '', location: '', light: 'bright_indirect' as Light, water_every_days: 3, fertilize_every_days: '' as string | number, photo_url: '' })
  const [uploading, setUploading] = useState(false)
  const save = useMutation({
    mutationFn: () => api.post('/garden/plants', { ...form, fertilize_every_days: form.fertilize_every_days || null, photo_url: form.photo_url || null, species: form.species || null, location: form.location || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.garden })
      toast.success(`${form.nickname} added to your garden`)
      onClose()
    },
    onError: errorToast,
  })
  return (
    <Modal open={open} onClose={onClose} title="Add a plant you own">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Field label="Nickname" className="sm:col-span-2"><Input required value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="Monty the Monstera" /></Field>
        <Field label="Species"><Input value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })} placeholder="Monstera deliciosa" /></Field>
        <Field label="Where is it?"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Living room" /></Field>
        <Field label="Light">
          <Select value={form.light} onChange={(e) => setForm({ ...form, light: e.target.value as Light })}>
            {Object.entries(LIGHT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Water every (days)"><Input type="number" min={1} max={60} value={form.water_every_days} onChange={(e) => setForm({ ...form, water_every_days: Number(e.target.value) })} /></Field>
        <Field label="Fertilize every (days)" hint="Optional"><Input type="number" min={7} max={365} value={form.fertilize_every_days} onChange={(e) => setForm({ ...form, fertilize_every_days: e.target.value })} /></Field>
        <Field label="Photo" hint="Optional">
          <Input type="file" accept="image/*" className="pt-2.5" onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f || !user) return
            setUploading(true)
            try { setForm((x) => ({ ...x, photo_url: '' })); const url = await uploadImage('garden-photos', f, user.id); setForm((x) => ({ ...x, photo_url: url })) } catch (err) { errorToast(err) } finally { setUploading(false) }
          }} />
        </Field>
        <Button type="submit" size="lg" className="sm:col-span-2" loading={save.isPending || uploading}>Add to garden</Button>
      </form>
    </Modal>
  )
}
