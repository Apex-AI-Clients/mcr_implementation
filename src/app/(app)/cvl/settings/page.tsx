import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadCvlSettings } from '@/lib/cvl/settings'
import { CvlSettingsClient } from '@/components/cvl/CvlSettingsClient'

export const dynamic = 'force-dynamic'

/** CVL settings (settings.ts): Form 509's lodgement details (with starting values), MCR's company and the liquidator. */
export default async function CvlSettingsPage() {
  const settings = await loadCvlSettings(getSupabaseServerClient())
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">CVL settings</h1>
        <p className="mt-1 text-sm text-foreground/50">
          Each section is saved on its own. A blank item leaves its boxes on the forms blank; they can be filled in on the form itself.
        </p>
      </div>
      <CvlSettingsClient initial={settings} />
    </div>
  )
}
