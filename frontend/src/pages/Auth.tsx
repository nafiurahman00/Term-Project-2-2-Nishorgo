import { motion } from 'motion/react'
import { ArrowRight, Mail } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Logo } from '@/components/layout'
import { Button, Field, Input, Segmented, Spinner } from '@/components/ui'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/providers/AuthProvider'

type Mode = 'login' | 'signup' | 'reset' | 'callback'

const DEMO = [
  { label: 'Customer', email: 'ayesha@nishorgo.test' },
  { label: 'Plant expert', email: 'expert@nishorgo.test' },
  { label: 'Admin', email: 'admin@nishorgo.test' },
]

export default function Auth({ mode }: { mode: Mode }) {
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/'
  const navigate = useNavigate()
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [method, setMethod] = useState<'password' | 'magic'>('password')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const recovering = mode === 'reset' && params.get('type') !== 'request'

  useEffect(() => {
    if (session && (mode === 'login' || mode === 'signup' || mode === 'callback')) navigate(next, { replace: true })
  }, [session, mode, next, navigate])

  const redirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: redirectTo } })
        if (error) throw error
        if (!data.session) setSent(true)
        else toast.success('Welcome to Nishorgo — 100 Leaf Points have been added to your account')
      } else if (mode === 'reset' && recovering && session) {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        toast.success('Password updated')
        navigate('/')
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` })
        if (error) throw error
        setSent(true)
      } else if (method === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
        if (error) throw error
        setSent(true)
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  const google = () => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })

  if (mode === 'callback') {
    return <div className="grid min-h-[60vh] place-items-center"><div className="text-center"><Spinner className="mx-auto size-8" /><p className="mt-4 text-muted">Signing you in…</p></div></div>
  }

  const title = mode === 'signup' ? 'Create your account' : mode === 'reset' ? (session ? 'Choose a new password' : 'Reset your password') : 'Welcome back'

  return (
    <div className="mx-auto grid min-h-[80vh] max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-2">
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="relative hidden h-full min-h-[560px] overflow-hidden rounded-2xl bg-forest-900 p-10 text-[#f6f3ea] lg:block">
        <img src="/brand/leaves.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 mix-blend-luminosity" />
        <div className="relative flex h-full flex-col justify-between">
          <div className="text-lg font-semibold">Nishorgo</div>
          <div>
            <h2 className="text-3xl font-semibold md:text-4xl">Every plant deserves a good home.</h2>
            <ul className="mt-6 space-y-2 text-white/80">
              <li>100 Leaf Points when you join</li>
              <li>Care reminders for every plant</li>
              <li>Free advice from plant experts</li>
            </ul>
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-md">
        <Logo className="mb-8 lg:hidden" />
        <h1 className="text-2xl font-semibold">{title}</h1>
        {!supabaseConfigured && <p className="mt-4 rounded-2xl bg-amber-100 p-3 text-sm text-amber-900">Supabase isn't configured — set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.</p>}

        {sent ? (
          <div className="mt-8 rounded-xl border border-line bg-surface p-6 text-center">
            <Mail className="mx-auto mb-3 size-10 text-forest-500" />
            <div className="font-semibold">Check your inbox</div>
            <p className="mt-1 text-sm text-muted">We sent a link to <b>{email}</b>.</p>
          </div>
        ) : (
          <>
            {(mode === 'login' || mode === 'signup') && (
              <>
                <Button variant="outline" size="lg" className="mt-8 w-full" onClick={google}>
                  <svg viewBox="0 0 24 24" className="size-5"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" /></svg>
                  Continue with Google
                </Button>
                <div className="my-6 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" /></div>
              </>
            )}
            {mode === 'login' && (
              <Segmented value={method} onChange={setMethod} className="mb-5"
                options={[{ value: 'password', label: 'Password' }, { value: 'magic', label: 'Magic link' }]} />
            )}
            <form onSubmit={submit} className="space-y-4">
              {mode === 'signup' && <Field label="Your name"><Input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
              {!(mode === 'reset' && session) && <Field label="Email"><Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>}
              {((mode === 'login' && method === 'password') || mode === 'signup' || (mode === 'reset' && session)) && (
                <Field label={mode === 'reset' ? 'New password' : 'Password'} hint={mode !== 'login' ? 'At least 8 characters' : undefined}>
                  <Input required type="password" minLength={mode === 'login' ? undefined : 8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                </Field>
              )}
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                {mode === 'signup' ? 'Create account' : mode === 'reset' ? (session ? 'Update password' : 'Send reset link') : method === 'magic' ? 'Email me a link' : 'Sign in'}
                <ArrowRight className="size-4" />
              </Button>
            </form>
          </>
        )}

        <div className="mt-6 space-y-2 text-center text-sm text-muted">
          {mode === 'login' && <>
            <div>New here? <Link to={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-fg underline">Create an account</Link></div>
            <div><Link to="/reset-password?type=request" className="hover:text-fg">Forgot password?</Link></div>
          </>}
          {mode !== 'login' && <div>Already have an account? <Link to="/login" className="font-semibold text-fg underline">Sign in</Link></div>}
        </div>

        {mode === 'login' && import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true' && (
          <div className="mt-8 rounded-xl border border-dashed border-line p-4">
            <div className="mb-2 text-sm font-medium">Demo accounts (password Nishorgo#2026)</div>
            <div className="flex flex-wrap gap-2">
              {DEMO.map((d) => (
                <button key={d.email} onClick={() => { setEmail(d.email); setPassword('Nishorgo#2026'); setMethod('password') }} className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold hover:bg-line">{d.label}</button>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}
