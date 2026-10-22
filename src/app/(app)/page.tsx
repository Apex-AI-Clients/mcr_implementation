import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { LAST_WORKSPACE_COOKIE, homeFor } from '@/lib/lastWorkspace'

/**
 * Opening the app goes back to the workspace used last, and to Leads — only
 * the active leads — the first time (Gabby, 22 Oct). The workspace switcher
 * moves between the two.
 */
export default async function HomePage() {
  const store = await cookies()
  redirect(homeFor(store.get(LAST_WORKSPACE_COOKIE)?.value))
}
