import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { LAST_WORKSPACE_COOKIE, lastWorkspaceForPath } from '@/lib/lastWorkspace'

/**
 * Single-role auth guard. Every page requires an authenticated staff user;
 * unauthenticated requests are bounced to /login. The matcher already excludes
 * /login, /api/*, Next internals, and static files, so anything reaching here
 * is a protected page.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Verified locally against the project's signing keys (ES256): no round trip
  // to Supabase on every page. It also refreshes an expired session. API
  // routes, which change data, still check with the auth server (getUser).
  const { data } = await supabase.auth.getClaims()

  if (!data?.claims) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Remember the workspace, so opening the app goes back to it (lastWorkspace.ts).
  const workspace = lastWorkspaceForPath(request.nextUrl.pathname)
  if (workspace && request.cookies.get(LAST_WORKSPACE_COOKIE)?.value !== workspace) {
    response.cookies.set(LAST_WORKSPACE_COOKIE, workspace, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  }

  return response
}

export const config = {
  // Protect every route except /login, /privacy (public legal page — crawlers
  // must reach it unauthenticated), the API (self-authed), Next internals, and
  // any path with a file extension (static assets).
  matcher: ['/((?!api|_next|login|privacy|favicon.ico|.*\\.).*)'],
}
