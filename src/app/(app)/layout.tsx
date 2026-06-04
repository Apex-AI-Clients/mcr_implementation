import { getSupabaseAuthClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

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
      <AdminSidebar userEmail={user.email ?? ''} signOut={signOut} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
