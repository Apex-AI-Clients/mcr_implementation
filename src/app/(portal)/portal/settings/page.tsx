'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Mail, ShieldCheck, CheckCircle } from 'lucide-react'
import { PortalHeader } from '@/components/portal/PortalHeader'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

interface MeResponse {
  clientName: string
  clientEmail: string
}

const MIN_PASSWORD_LENGTH = 8

export default function PortalSettingsPage() {
  const router = useRouter()
  const [data, setData] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)

  // Password change state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/portal/me')
      if (res.status === 401) {
        router.replace('/login')
        return
      }
      if (res.ok) {
        const json = await res.json()
        setData({ clientName: json.clientName, clientEmail: json.clientEmail })
      }
      setLoading(false)
    }
    load()
  }, [router])

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    setPwError(null)
    setPwSuccess(false)

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPwError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match.')
      return
    }

    setPwLoading(true)
    const supabase = getSupabaseBrowserClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })

    if (error) {
      setPwError(error.message)
      setPwLoading(false)
      return
    }

    setPwSuccess(true)
    setNewPassword('')
    setConfirmPassword('')
    setPwLoading(false)
    setTimeout(() => setPwSuccess(false), 4000)
  }

  if (loading || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen">
      <PortalHeader clientName={data.clientName} />

      <main className="flex-1 px-4 md:px-6 py-8 md:py-12">
        <div className="mx-auto max-w-2xl">
          <Link
            href="/portal"
            className="inline-flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to portal
          </Link>

          <div className="mb-8">
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">Account</h1>
            <p className="mt-1 text-sm text-muted">
              Your MCR Partners portal sign-in details.
            </p>
          </div>

          <Card className="mb-6">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                <Mail className="h-5 w-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted font-medium">
                  Email address
                </p>
                <p className="mt-1 text-base font-medium text-foreground break-all">
                  {data.clientEmail}
                </p>
                <p className="mt-2 text-xs text-muted">
                  Use this email to sign in at any time. To change it, contact your MCR Partners advisor.
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                <ShieldCheck className="h-5 w-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted font-medium">
                  Change password
                </p>
                <p className="mt-1 text-xs text-muted mb-4">
                  Enter a new password below to update your sign-in credentials.
                </p>

                <form onSubmit={handlePasswordChange} className="space-y-3">
                  <Input
                    id="new-password"
                    label="New password"
                    type="password"
                    placeholder={`Minimum ${MIN_PASSWORD_LENGTH} characters`}
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setPwSuccess(false) }}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                  />
                  <Input
                    id="confirm-password"
                    label="Confirm new password"
                    type="password"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setPwSuccess(false) }}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                  />

                  {pwError && (
                    <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2.5">
                      {pwError}
                    </div>
                  )}

                  {pwSuccess && (
                    <div className="flex items-center gap-2 text-sm text-success bg-success/10 rounded-lg px-3 py-2.5">
                      <CheckCircle className="h-4 w-4 shrink-0" />
                      Password updated successfully.
                    </div>
                  )}

                  <Button type="submit" loading={pwLoading} size="sm">
                    Update password
                  </Button>
                </form>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
