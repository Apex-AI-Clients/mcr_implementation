import { getSupabaseAuthClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { WorkspaceTopBar } from '@/components/admin/WorkspaceTopBar'
import { LeadsStoreProvider } from '@/components/leads/LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import { getLeads, getAllLeadActivities } from '@/lib/leads/mock'
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

  // The CRM seed is loaded here rather than in the leads routes so the sidebar's
  // follow-up count stays live as Gabby works. Mock until Stage 4.
  const author = firstNameFromMetadata(user.user_metadata) ?? user.email?.split('@')[0] ?? 'You'

  return (
    <ToastProvider>
      <LeadsStoreProvider
        initialLeads={getLeads()}
        initialActivities={getAllLeadActivities()}
        author={author}
      >
        <div className="flex h-screen overflow-hidden bg-primary">
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
