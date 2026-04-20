import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAuthClient } from '@/lib/supabase/server'

/**
 * Supabase Auth PKCE callback.
 *
 * Supabase invite / password-reset / magic-link emails point at this route with a `code`
 * query param. We exchange it for a session and then redirect the user to `next`
 * (defaulting to `/portal/set-password` for fresh invites).
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/portal/set-password'

  if (!code) {
    // Implicit flow (hash fragment #access_token=...) — the server can't read
    // hash fragments, so redirect to the client-side set-password page which
    // will pick up the tokens from the URL hash and establish the session.
    return NextResponse.redirect(`${origin}/portal/set-password`)
  }

  const supabase = await getSupabaseAuthClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession', error)
    return NextResponse.redirect(`${origin}/login?error=invalid_link`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
