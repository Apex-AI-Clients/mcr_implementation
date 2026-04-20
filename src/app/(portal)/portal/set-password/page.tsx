'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

const MIN_PASSWORD_LENGTH = 8

export default function SetPasswordPage() {
  const router = useRouter()
  const [sessionState, setSessionState] = useState<'checking' | 'ready' | 'missing'>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function establishSession() {
      const supabase = getSupabaseBrowserClient()

      // Supabase invite emails redirect here with hash-fragment tokens
      // (implicit flow: #access_token=...&refresh_token=...).
      // Parse them and call setSession() to establish the cookie-based session.
      const hash = window.location.hash
      if (hash) {
        const params = new URLSearchParams(hash.substring(1))
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')

        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (sessionError) {
            console.error('[set-password] setSession', sessionError)
          }
          // Clean the hash from the URL
          window.history.replaceState(null, '', window.location.pathname)
        }
      }

      // Now check for a valid user (either from hash tokens above or existing cookie)
      const { data } = await supabase.auth.getUser()
      if (cancelled) return
      if (!data.user) {
        setSessionState('missing')
        return
      }
      setEmail(data.user.email ?? null)
      setSessionState('ready')
    }

    establishSession()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const supabase = getSupabaseBrowserClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    router.push('/portal')
    router.refresh()
  }

  if (sessionState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <Spinner size="lg" />
      </div>
    )
  }

  if (sessionState === 'missing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary px-6 text-center">
        <div className="max-w-sm">
          <div className="h-14 w-14 mx-auto rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
            <span className="text-2xl text-destructive">!</span>
          </div>
          <h1 className="text-lg font-semibold text-foreground">Invite link expired</h1>
          <p className="mt-2 text-sm text-muted">
            Your invite link is no longer valid. Please contact your MCR Partners advisor
            to request a new invite.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-primary px-6 py-12 relative">
      <div className="absolute top-5 right-5">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-accent flex items-center justify-center shadow-lg shadow-accent/20">
            <KeyRound className="h-6 w-6 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">Welcome to MCR Partners</h1>
            <p className="text-sm text-muted mt-1">Choose a password to secure your portal.</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-card p-6 space-y-5 shadow-sm"
        >
          {email && (
            <div className="rounded-lg bg-surface/50 px-3 py-2.5 border border-border">
              <p className="text-xs text-muted">Signed in as</p>
              <p className="text-sm font-medium text-foreground">{email}</p>
            </div>
          )}

          <Input
            id="password"
            label="New password"
            type="password"
            placeholder={`Minimum ${MIN_PASSWORD_LENGTH} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            minLength={MIN_PASSWORD_LENGTH}
          />

          <Input
            id="confirm"
            label="Confirm password"
            type="password"
            placeholder="Re-enter password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
          />

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2.5">
              {error}
            </div>
          )}

          <Button type="submit" loading={loading} className="w-full" size="lg">
            Set password & continue
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted">
          Use this email and password to sign back into the portal anytime.
        </p>
      </div>
    </div>
  )
}
