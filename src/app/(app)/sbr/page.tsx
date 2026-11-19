import { redirect } from 'next/navigation'

/**
 * SBR opens on its client list (there is no dashboard, 18 Nov 2026). This
 * address is kept so old bookmarks still land somewhere useful.
 */
export default function SbrPage() {
  redirect('/clients')
}
