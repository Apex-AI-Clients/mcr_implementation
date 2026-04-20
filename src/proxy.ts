import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Paths that never require authentication.
const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/portal/set-password',
])

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAdminRoute = pathname.startsWith('/admin')
  const isPortalRoute = pathname.startsWith('/portal')

  if (!isAdminRoute && !isPortalRoute) {
    return NextResponse.next()
  }

  // Old login pages redirect to /login (handled by their page.tsx redirects),
  // but skip auth check so the redirect can happen.
  if (PUBLIC_PATHS.has(pathname) || pathname === '/admin/login' || pathname === '/portal/login') {
    return NextResponse.next()
  }

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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const role = (user.app_metadata?.role as string | undefined) ?? null

  // A client user should never enter admin space, and an admin user should never
  // enter the client portal — bounce them to their own side.
  if (isAdminRoute && role === 'client') {
    return NextResponse.redirect(new URL('/portal', request.url))
  }
  if (isPortalRoute && role !== 'client') {
    return NextResponse.redirect(new URL('/admin', request.url))
  }

  return response
}

export const config = {
  matcher: ['/admin/:path*', '/portal/:path*'],
}
