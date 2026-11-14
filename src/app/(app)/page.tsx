import { Suspense } from 'react'
import { getSupabaseAuthClient } from '@/lib/supabase/server'
import { firstNameFromMetadata } from '@/lib/utils'
import { cvlEnabled } from '@/lib/cvl/flag'
import { readRange } from '@/lib/dashboard/range'
import { DashboardHeader, HeaderSummary, KpiGrid, WorkspaceCards } from '@/components/dashboard/DashboardTop'
import { LeadsSection } from '@/components/dashboard/LeadsSection'
import { SbrSection } from '@/components/dashboard/SbrSection'
import { CvlSection, RecentActivity } from '@/components/dashboard/CvlAndActivity'
import { LineSkeleton, SectionSkeleton, TilesSkeleton } from '@/components/dashboard/Skeletons'

export const dynamic = 'force-dynamic'

/**
 * Home: the whole business on one page, and the way into each workspace.
 *
 * Opening the app lands here (it used to go back to the workspace used last).
 * Each section streams in on its own, so a slow one (the SBR readiness
 * checklist reads every file) never holds up the rest. Only the lead figures
 * follow the date range; SBR and CVL are as of today.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const range = readRange((await searchParams).range)
  const supabase = await getSupabaseAuthClient()
  const { data } = await supabase.auth.getClaims()
  const metadata = (data?.claims?.user_metadata ?? {}) as Record<string, unknown>
  const firstName = firstNameFromMetadata(metadata)

  return (
    <div className="mx-auto flex max-w-[1376px] flex-col gap-10 px-4 py-8 sm:px-8 sm:pb-14">
      <DashboardHeader
        firstName={firstName}
        range={range}
        summary={
          <Suspense fallback={<LineSkeleton />}>
            <HeaderSummary range={range} />
          </Suspense>
        }
      />

      <Suspense fallback={<TilesSkeleton count={cvlEnabled() ? 3 : 2} height="h-40" />}>
        <WorkspaceCards range={range} />
      </Suspense>

      <Suspense fallback={<TilesSkeleton count={8} />}>
        <KpiGrid range={range} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton panels={4} />}>
        <LeadsSection range={range} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton panels={3} />}>
        <SbrSection />
      </Suspense>

      {cvlEnabled() && (
        <Suspense fallback={<SectionSkeleton />}>
          <CvlSection />
        </Suspense>
      )}

      <Suspense fallback={<SectionSkeleton panels={1} />}>
        <RecentActivity />
      </Suspense>

      <footer className="flex flex-wrap justify-between gap-2 border-t border-border pt-6 text-xs text-muted">
        <span>MCR Partners · Internal use only</span>
        <span>Figures are read live each time the page opens</span>
      </footer>
    </div>
  )
}
