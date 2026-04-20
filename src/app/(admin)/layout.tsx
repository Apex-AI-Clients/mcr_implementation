import Link from 'next/link'
import { Users, LayoutDashboard, LogOut } from 'lucide-react'
import { getSupabaseAuthClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseAuthClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // No user (e.g. login page) — render children without sidebar
  if (!user) {
    return <>{children}</>
  }

  async function signOut() {
    'use server'
    const supabase = await getSupabaseAuthClient()
    await supabase.auth.signOut()
    redirect('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-primary">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
          <div className="h-8 w-8 rounded-lg bg-accent flex items-center justify-center">
            <span className="text-white text-sm font-bold">M</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-none">MCR Partners</p>
            <p className="text-xs text-muted leading-none mt-0.5">Admin Panel</p>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 p-3 flex-1">
          <NavLink href="/admin" icon={<LayoutDashboard className="h-4 w-4" />}>
            Dashboard
          </NavLink>
          <NavLink href="/admin/clients" icon={<Users className="h-4 w-4" />}>
            Clients
          </NavLink>
        </nav>

        <div className="border-t border-border px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">Theme</p>
            <ThemeToggle />
          </div>
          <div>
            <p className="text-xs text-muted truncate">{user.email}</p>
            <form action={signOut} className="mt-1.5">
              <button
                type="submit"
                className="flex items-center gap-2 text-xs text-muted hover:text-foreground transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-muted hover:bg-surface hover:text-foreground transition-colors"
    >
      {icon}
      {children}
    </Link>
  )
}
