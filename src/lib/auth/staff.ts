import { getSupabaseAuthClient } from '@/lib/supabase/server'
import type { User } from '@supabase/supabase-js'
import { firstNameFromMetadata } from '@/lib/utils'

/**
 * Resolve the authenticated staff user from the request session.
 *
 * Single-role model (20 May 2026 refactor): there is now exactly one kind of
 * user — MCR staff. Any authenticated Supabase user is staff; there is no
 * `client` role and clients no longer log in. Returns the user, or `null` when
 * there is no active session.
 *
 * Replaces the old `getPortalClient()` (which resolved a client row from the
 * session) — staff now operate on a client they select, passed explicitly as a
 * `clientId` to each endpoint.
 */
export async function requireStaffUser(): Promise<User | null> {
  const authClient = await getSupabaseAuthClient()
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error) {
    console.error('[requireStaffUser] auth error:', error.message)
    return null
  }
  return user ?? null
}

/**
 * The name a staff member's actions are recorded under — timeline authorship,
 * and who dismissed an "enquired again" marker. Worked out from the session on
 * the server, so a request body cannot claim to be somebody else.
 */
export function staffAuthorName(user: Pick<User, 'user_metadata' | 'email'>): string {
  return firstNameFromMetadata(user.user_metadata) ?? user.email?.split('@')[0] ?? 'You'
}
