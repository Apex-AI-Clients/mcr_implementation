import { redirect, RedirectType } from 'next/navigation'

/**
 * Redirect to the unified login page.
 * Preserves any query params (e.g. ?error=invalid_link) by re-appending them.
 */
export default async function PortalLoginRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v)
  }
  const query = qs.toString()
  redirect(`/login${query ? `?${query}` : ''}`, RedirectType.replace)
}
