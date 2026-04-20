'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Settings, LogOut } from 'lucide-react'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

interface PortalHeaderProps {
  clientName: string
  showAccountLinks?: boolean
}

export function PortalHeader({ clientName, showAccountLinks = true }: PortalHeaderProps) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
      <div className="px-4 md:px-6 py-4 flex items-center justify-between">
        <Link href="/portal" className="flex items-center gap-3 group">
          <div className="h-8 w-8 rounded-lg bg-accent flex items-center justify-center">
            <span className="text-white text-xs font-bold">M</span>
          </div>
          <div>
            <p className="text-xs text-muted leading-none">MCR Partners</p>
            <p className="text-sm font-semibold text-foreground leading-tight mt-0.5 group-hover:text-accent transition-colors">
              Document Portal
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-3 md:gap-4">
          <ThemeToggle />
          <div className="hidden sm:block text-right">
            <p className="text-xs text-muted">Signed in as</p>
            <p className="text-sm font-medium text-foreground">{clientName}</p>
          </div>
          {showAccountLinks && (
            <div className="flex items-center gap-1">
              <Link
                href="/portal/settings"
                aria-label="Account settings"
                className="h-9 w-9 flex items-center justify-center rounded-lg text-foreground/60 hover:text-foreground hover:bg-surface/60 transition-colors"
              >
                <Settings className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                aria-label="Sign out"
                className="h-9 w-9 flex items-center justify-center rounded-lg text-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
