import { getSupabaseAuthClient, getSupabaseServerClient } from '@/lib/supabase/server'

export interface PortalClientContext {
  userId: string
  clientId: string
  name: string
  email: string
}

/**
 * Resolve the authenticated client from the request session.
 *
 * Returns `null` when:
 *   - there is no active Supabase session,
 *   - the session user is not linked to a `clients` row via `auth_user_id`.
 *
 * Use in portal-scoped API routes to replace the old `x-client-token` pattern.
 * Admin users (no matching clients row) will also resolve to `null` here —
 * route handlers should treat that as "Unauthorized".
 */
export async function getPortalClient(): Promise<PortalClientContext | null> {
  const authClient = await getSupabaseAuthClient()
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser()

  if (userError || !user) return null

  const supabase = getSupabaseServerClient()
  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, email')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (error || !client) return null

  return {
    userId: user.id,
    clientId: client.id,
    name: client.name,
    email: client.email,
  }
}
