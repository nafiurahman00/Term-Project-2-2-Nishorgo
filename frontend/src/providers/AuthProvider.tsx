import type { Session, User } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { Account, Role } from '@/lib/types'

interface AuthState {
  session: Session | null
  user: User | null
  /** Role stamped into the JWT by the custom access token hook (falls back to the profile). */
  role: Role
  isStaff: boolean
  account: Account | undefined
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

function roleFromJwt(session: Session | null): Role | null {
  const token = session?.access_token
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return (payload.user_role as Role) ?? null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_OUT') qc.clear()
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') qc.invalidateQueries()
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  const account = useQuery({
    queryKey: ['me', session?.user.id],
    queryFn: () => api.get<Account>('/me'),
    enabled: !!session,
    staleTime: 30_000,
  })

  const value = useMemo<AuthState>(() => {
    const role = roleFromJwt(session) ?? account.data?.role ?? 'customer'
    return {
      session,
      user: session?.user ?? null,
      role,
      isStaff: role === 'staff' || role === 'admin',
      account: account.data,
      loading: !ready || (!!session && account.isLoading),
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }
  }, [session, ready, account.data, account.isLoading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
