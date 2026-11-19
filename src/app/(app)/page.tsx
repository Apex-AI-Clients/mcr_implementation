import { redirect } from 'next/navigation'

/**
 * No home dashboard (removed 18 Nov 2026, Gabby's 16 Nov meeting): staff land
 * on the SBR client list. Kept as an address so the logo, old bookmarks and the
 * sign-in redirect still land somewhere useful.
 */
export default function HomePage() {
  redirect('/clients')
}
