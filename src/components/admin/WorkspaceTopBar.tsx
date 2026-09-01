'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Flag, LogOut } from 'lucide-react'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { WorkspaceSwitcher } from '@/components/admin/WorkspaceSwitcher'
import { useFollowUpCount } from '@/components/leads/LeadsStore'
import { workspaceForPath } from '@/lib/workspaces'

interface WorkspaceTopBarProps {
  userEmail: string
  signOut: () => Promise<void>
}

/**
 * Slim header for the routes that have no sidebar: the workspace chooser and
 * any single-page workspace. It carries the same controls the sidebar footer
 * does — theme, who you are, sign out — so dropping the sidebar doesn't drop
 * them with it.
 */
export function WorkspaceTopBar({ userEmail, signOut }: WorkspaceTopBarProps) {
  const pathname = usePathname() ?? ''
  const followUpCount = useFollowUpCount()

  // The intake wizard is full-screen and owns its own chrome.
  if (pathname.endsWith('/intake')) return null

  const workspace = workspaceForPath(pathname)
  if (workspace && workspace.chrome !== 'topbar') return null

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Workspaces">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
            <span className="text-sm font-bold text-white">M</span>
          </div>
          <span className="hidden text-sm font-semibold leading-none text-foreground sm:block">
            MCR Partners
          </span>
        </Link>

        {/* Only meaningful inside a workspace — on the chooser you're already here. */}
        {workspace && (
          <>
            <span aria-hidden="true" className="text-border">
              /
            </span>
            <WorkspaceSwitcher current={workspace} variant="bar" />
            {/* Carries the follow-up count that used to sit in the sidebar. It
                also reaches the lead record, which had no count at all. */}
            {workspace.badge === 'leadFollowUps' && followUpCount > 0 && (
              <Link
                href="/leads"
                className="inline-flex h-6 items-center gap-1.5 rounded-full bg-warning/15 px-2.5 text-xs font-medium text-warning transition-colors hover:bg-warning/25"
              >
                <Flag className="h-3 w-3" aria-hidden="true" />
                <span className="tabular-nums">{followUpCount}</span>
                <span className="hidden sm:inline">need follow-up</span>
              </Link>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <ThemeToggle />
        <span className="hidden max-w-[180px] truncate text-xs text-muted md:block">
          {userEmail}
        </span>
        <form action={signOut}>
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
