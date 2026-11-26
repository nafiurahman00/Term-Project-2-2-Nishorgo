import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Container } from '@/components/layout'
import { Avatar, Badge, Button, Card, Field, Input, PageHeader, Segmented } from '@/components/ui'
import { api } from '@/lib/api'
import { errorToast, keys } from '@/lib/queries'
import { uploadImage } from '@/lib/supabase'
import type { Address } from '@/lib/types'
import { cn, date, money } from '@/lib/utils'
import { useAuth } from '@/providers/AuthProvider'
import { AddressModal } from './Checkout'

const REASON_LABEL: Record<string, string> = {
  signup_bonus: 'Welcome bonus', order_earned: 'Order reward', order_redeemed: 'Redeemed at checkout',
  redemption_refund: 'Refunded points', earned_reversal: 'Refund reversal', review_bonus: 'Review bonus', admin_adjustment: 'Bonus',
}

export default function Account() {
  const { account, user } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') ?? 'rewards') as 'rewards' | 'profile' | 'addresses'
  if (!account) return null

  return (
    <Container className="max-w-5xl pt-6">
      <PageHeader title="Account">{account.email}</PageHeader>
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm text-muted">Leaf Points balance</div>
              <div className="mt-1 text-3xl font-semibold">{account.loyalty_points.toLocaleString()}</div>
              <div className="mt-0.5 text-sm text-muted">Worth {money(account.loyalty_points)} at checkout</div>
            </div>
            <Badge className="bg-accent text-accent-fg">{account.tier} member</Badge>
          </div>
          {account.next_tier_at && (
            <div className="mt-6">
              <div className="mb-1.5 flex justify-between text-xs text-muted"><span>Progress to next tier</span><span>{account.lifetime_points} / {account.next_tier_at}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-primary" style={{ width: `${account.next_tier_progress}%` }} />
              </div>
            </div>
          )}
        </Card>
        <Card className="grid grid-cols-2 gap-4">
          {[['Orders', account.orders_count], ['Spent', money(account.total_spent)], ['Plants', account.garden_count], ['Saved', account.wishlist_count]].map(([l, v]) => (
            <div key={l as string}><div className="text-sm text-muted">{l}</div><div className="text-xl font-semibold">{v}</div></div>
          ))}
        </Card>
      </div>

      <Segmented value={tab} onChange={(t) => setParams({ tab: t })} className="mb-6"
        options={[{ value: 'rewards', label: 'Rewards' }, { value: 'profile', label: 'Profile' }, { value: 'addresses', label: 'Addresses' }]} />

      {tab === 'rewards' && (
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Points history</h2>
          <p className="mb-4 text-sm text-muted">Earn 1 point per ৳10 spent (more at higher tiers), 20 points per verified review, and bonuses for care streaks. 1 point = ৳1 at checkout.</p>
          <ul className="divide-y divide-line">
            {account.points_history.map((h, i) => (
              <li key={i} className="flex items-center justify-between py-3">
                <div><div className="font-medium">{REASON_LABEL[h.reason] ?? h.reason}</div><div className="text-xs text-muted">{h.note} · {date(h.at)}</div></div>
                <span className={cn('font-bold', h.delta > 0 ? 'text-forest-500 dark:text-lime-glow' : 'text-muted')}>{h.delta > 0 ? '+' : ''}{h.delta}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tab === 'profile' && user && <ProfileForm userId={user.id} />}
      {tab === 'addresses' && <Addresses />}
    </Container>
  )
}

function ProfileForm({ userId }: { userId: string }) {
  const { account } = useAuth()
  const qc = useQueryClient()
  const [form, setForm] = useState({ full_name: '', username: '', phone: '' })
  useEffect(() => {
    if (account) setForm({ full_name: account.full_name ?? '', username: account.username ?? '', phone: account.phone ?? '' })
  }, [account])
  const save = useMutation({
    mutationFn: (body: Record<string, string | null>) => api.patch('/me', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); toast.success('Profile saved') },
    onError: errorToast,
  })
  return (
    <Card className="p-6">
      <div className="mb-6 flex items-center gap-4">
        <div className="relative">
          <Avatar src={account?.avatar_url} name={account?.full_name} className="size-20 text-xl" />
          <label className="absolute -right-1 -bottom-1 grid size-8 cursor-pointer place-items-center rounded-full bg-primary text-primary-fg shadow">
            <Camera className="size-4" />
            <input type="file" accept="image/*" hidden onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              try { save.mutate({ avatar_url: await uploadImage('avatars', f, userId) }) } catch (err) { errorToast(err) }
            }} />
          </label>
        </div>
        <div><div className="font-semibold">{account?.email}</div><Badge className="mt-1">{account?.role}</Badge></div>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ full_name: form.full_name || null, username: form.username || null, phone: form.phone || null }) }}>
        <Field label="Full name"><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
        <Field label="Username" hint="3–30 letters, numbers or _"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+8801…" /></Field>
        <div className="flex items-end"><Button type="submit" loading={save.isPending}>Save changes</Button></div>
      </form>
    </Card>
  )
}

function Addresses() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: keys.addresses, queryFn: () => api.get<Address[]>('/me/addresses') })
  const [editing, setEditing] = useState<Address | undefined>()
  const [open, setOpen] = useState(false)
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/me/addresses/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: keys.addresses }), onError: errorToast })
  const makeDefault = useMutation({ mutationFn: (id: number) => api.patch(`/me/addresses/${id}`, { is_default: true }), onSuccess: () => qc.invalidateQueries({ queryKey: keys.addresses }), onError: errorToast })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {list.data?.map((a) => (
        <Card key={a.id}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 font-semibold"><MapPin className="size-4" /> {a.label} {a.is_default && <Badge className="bg-accent/40">Default</Badge>}</div>
            <div className="flex gap-1">
              <button className="rounded-full p-2 hover:bg-surface-2" onClick={() => { setEditing(a); setOpen(true) }}><Pencil className="size-4" /></button>
              <button className="rounded-full p-2 text-danger hover:bg-surface-2" onClick={() => remove.mutate(a.id)}><Trash2 className="size-4" /></button>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted">{a.recipient} · {a.phone}<br />{a.line1}{a.area ? `, ${a.area}` : ''}, {a.city}</p>
          {!a.is_default && <Button variant="ghost" size="sm" className="mt-3" onClick={() => makeDefault.mutate(a.id)}>Make default</Button>}
        </Card>
      ))}
      <button onClick={() => { setEditing(undefined); setOpen(true) }} className="grid min-h-36 place-items-center rounded-xl border-2 border-dashed border-line font-semibold text-muted hover:bg-surface">
        <span className="flex items-center gap-2"><Plus className="size-4" /> Add address</span>
      </button>
      <AddressModal open={open} onClose={() => setOpen(false)} initial={editing} />
    </div>
  )
}
