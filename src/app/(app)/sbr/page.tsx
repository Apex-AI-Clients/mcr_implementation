import { redirect } from 'next/navigation'

/**
 * The SBR dashboard moved to Home (14 Nov 2026), and SBR opens on its client
 * list. This address is kept so old bookmarks still land somewhere useful.
 */
export default function SbrPage() {
  redirect('/clients')
}
