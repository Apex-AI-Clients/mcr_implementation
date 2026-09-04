import { getSupabaseAuthClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { WorkspaceTopBar } from '@/components/admin/WorkspaceTopBar'
import { LeadsStoreProvider } from '@/components/leads/LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import { getLeads, getAllLeadActivities } from '@/lib/leads/queries'
import { leadsPersistence } from '@/lib/leads/persistence'
import { firstNameFromMetadata } from '@/lib/utils'

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

  // Loaded here rather than in the leads routes so the sidebar and the list
  // read the same state as Gabby works.
  const [leads, activities] = await Promise.all([getLeads(), getAllLeadActivities()])
  const author = firstNameFromMetadata(user.user_metadata) ?? user.email?.split('@')[0] ?? 'You'

  return (
    <ToastProvider>
      <LeadsStoreProvider
        initialLeads={leads}
        initialActivities={activities}
        author={author}
        persistence={leadsPersistence}
      >
        {/* Fixed to the viewport rather than `h-screen`: the root layout leaves
            body as `min-h-full` with no overflow rule, so a 100vh shell still
            let the document keep a second scrollbar of its own next to
            <main>'s. Taking the shell out of flow makes that impossible.
            /login sits outside this route group and is unaffected. */}
        <div className="fixed inset-0 flex overflow-hidden bg-primary">
          <AdminSidebar userEmail={user.email ?? ''} signOut={signOut} />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <WorkspaceTopBar userEmail={user.email ?? ''} signOut={signOut} />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
      </LeadsStoreProvider>
    </ToastProvider>
  )
}
