import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadCvlSettings } from '@/lib/cvl/settings'
import { CvlSettingsClient } from '@/components/cvl/CvlSettingsClient'

export const dynamic = 'force-dynamic'

/** CVL settings: the items waiting for Gabby's confirmation (settings.ts). None has a default. */
export default async function CvlSettingsPage() {
  const settings = await loadCvlSettings(getSupabaseServerClient())
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">CVL settings</h1>
        <p className="mt-1 text-sm text-foreground/50">
          Nothing here has a default. A blank item leaves its boxes on the forms blank, and says so beside them; they can be filled in on the form itself.
        </p>
      </div>
      <CvlSettingsClient initial={settings} />
    </div>
  )
}
