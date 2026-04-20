'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { Shield, FileCheck, BarChart3 } from 'lucide-react'

function LoginInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')
  const errorParam = searchParams.get('error')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(
    errorParam === 'invalid_link'
      ? 'That link is invalid or has expired. Please sign in with your email and password.'
      : errorParam === 'missing_code'
        ? 'Sign-in link was incomplete. Please sign in below.'
        : null,
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = getSupabaseBrowserClient()
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    // Route based on role
    const role = data.user?.app_metadata?.role as string | undefined
    const destination = redirect ?? (role === 'client' ? '/portal' : '/admin')

    router.push(destination)
    router.refresh()
  }

  return (
    <div className="flex min-h-screen bg-primary">
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#1a1032]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(233,69,96,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(233,69,96,0.3) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-accent/8 blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-64 w-64 rounded-full bg-purple-500/5 blur-[80px]" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-11 w-11 rounded-xl bg-accent flex items-center justify-center shadow-lg shadow-accent/25">
                <span className="text-white text-lg font-bold tracking-tight">M</span>
              </div>
              <span className="text-white/90 text-xl font-semibold tracking-tight">
                MCR Partners
              </span>
            </div>
            <p className="text-white/40 text-sm ml-14">Your Business, Our Expertise</p>
          </div>

          <div className="max-w-md">
            <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight tracking-tight">
              Streamline your
              <br />
              <span className="text-accent">client documents</span>
            </h1>
            <p className="mt-5 text-white/50 text-base leading-relaxed">
              AI-powered document collection, classification, and compliance tracking —
              built for financial professionals.
            </p>

            <div className="mt-10 flex flex-col gap-4">
              {[
                { icon: FileCheck, label: 'Assess', desc: 'Identify missing documents instantly' },
                { icon: Shield, label: 'Secure', desc: 'Encrypted portal with role-based access' },
                { icon: BarChart3, label: 'Track', desc: 'Real-time completeness dashboard' },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] border border-white/[0.08]">
                    <Icon className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white/90">{label}</p>
                    <p className="text-sm text-white/40">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-white/25 text-xs">
            MCR Partners &times; Apex AI &mdash; Secure Portal
          </p>
        </div>
      </div>

      {/* Right login panel */}
      <div className="flex w-full lg:w-[45%] flex-col items-center justify-center px-6 sm:px-12 relative">
        <div className="absolute top-5 right-5">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-10 flex flex-col items-center gap-3 lg:hidden">
            <div className="h-14 w-14 rounded-2xl bg-accent flex items-center justify-center shadow-lg shadow-accent/20">
              <span className="text-white text-xl font-bold">M</span>
            </div>
            <div className="text-center">
              <h1 className="text-xl font-semibold text-foreground">MCR Partners</h1>
              <p className="text-sm text-muted mt-1">Your Business, Our Expertise</p>
            </div>
          </div>

          {/* Desktop heading */}
          <div className="hidden lg:block mb-8">
            <h2 className="text-2xl font-semibold text-foreground tracking-tight">Welcome</h2>
            <p className="text-sm text-muted mt-1.5">Sign in to your MCR Partners account</p>
          </div>

          {/* Login form */}
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-border bg-card p-6 space-y-5 shadow-sm"
          >
            <Input
              id="email"
              label="Email address"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />

            <Input
              id="password"
              label="Password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2.5">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                {error}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Sign In
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted">
            Haven&apos;t received an invite? Contact your MCR Partners advisor.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
