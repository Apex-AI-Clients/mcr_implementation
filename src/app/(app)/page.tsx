import { Suspense } from 'react'
import { getSupabaseAuthClient } from '@/lib/supabase/server'
import { firstNameFromMetadata } from '@/lib/utils'
import { cvlEnabled } from '@/lib/cvl/flag'
import { readRange, type RangeKey } from '@/lib/dashboard/range'
import {
  CvlKpis,
  DashboardHeader,
  DashboardSwitcher,
  HeaderSummary,
  LeadsKpis,
  RangePicker,
  SbrKpis,
  ViewIntro,
  readView,
  type DashboardView,
} from '@/components/dashboard/DashboardTop'
import { FollowUpsPanel, LeadsCharts } from '@/components/dashboard/LeadsSection'
import { SbrSection } from '@/components/dashboard/SbrSection'
import { CvlSection, RecentActivity } from '@/components/dashboard/CvlAndActivity'
import { LineSkeleton, PanelSkeleton, SectionSkeleton, TilesSkeleton } from '@/components/dashboard/Skeletons'

export const dynamic = 'force-dynamic'

/**
 * Home: three dashboards — Leads, SBR and CVL — picked with the small switcher
 * top right (`?view=`), or All of them one after another, where Home opens.
 * Gabby (Nov 2026): one long page mixing all three took too much effort to
 * read, so each is its own block with its own title.
 *
 * Each dashboard opens with what needs doing (follow-ups, items to check,
 * dates coming up), then the numbers, then the charts. Every list item links
 * to the record it is about. Sections stream in on their own, so a slow one
 * never holds up the rest. Only the Leads dashboard takes a date range.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const view = readView(params.view)
  const range = readRange(params.range)
  const supabase = await getSupabaseAuthClient()
  const { data } = await supabase.auth.getClaims()
  const firstName = firstNameFromMetadata((data?.claims?.user_metadata ?? {}) as Record<string, unknown>)

  return (
    <div className="mx-auto flex max-w-[1376px] flex-col gap-12 px-4 py-8 sm:px-8 sm:pb-14">
      <DashboardHeader
        firstName={firstName}
        controls={<DashboardSwitcher current={view} range={range} />}
        summary={
          <Suspense fallback={<LineSkeleton />}>
            <HeaderSummary />
          </Suspense>
        }
      />

      {(view === 'leads' || view === 'all') && <LeadsView range={range} view={view} />}
      {(view === 'sbr' || view === 'all') && <SbrView />}
      {(view === 'cvl' || view === 'all') && cvlEnabled() && <CvlView />}

      <footer className="flex flex-wrap justify-between gap-2 border-t border-border pt-6 text-xs text-muted">
        <span>MCR Partners · Internal use only</span>
        <span>Figures are read live each time the page opens</span>
      </footer>
    </div>
  )
}

function LeadsView({ range, view }: { range: RangeKey; view: DashboardView }) {
  return (
    <div className="flex flex-col gap-6">
      <ViewIntro
        id="leads-dashboard"
        title="Leads dashboard"
        description="How many new enquiries came in, where they came from, how far they got, and who needs a call."
        href="/leads"
        cta="Open CRM"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-foreground">Numbers for the period</h3>
        <RangePicker current={range} view={view} />
      </div>
      <Suspense fallback={<TilesSkeleton count={4} />}>
        <LeadsKpis range={range} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton panels={2} />}>
        <LeadsCharts range={range} />
      </Suspense>
      <Suspense fallback={<PanelSkeleton rows={4} />}>
        <FollowUpsPanel />
      </Suspense>
      <Suspense fallback={<PanelSkeleton rows={5} />}>
        <RecentActivity tag="CRM" />
      </Suspense>
    </div>
  )
}

function SbrView() {
  return (
    <div className="flex flex-col gap-6">
      <ViewIntro
        id="sbr-dashboard"
        title="SBR dashboard"
        description="What needs checking, how complete each file’s documents are, the predicted outcomes and the tax position. All figures as of today."
        href="/clients"
        cta="Open SBR"
      />
      <Suspense fallback={<TilesSkeleton count={4} />}>
        <SbrKpis />
      </Suspense>
      <Suspense fallback={<SectionSkeleton panels={3} />}>
        <SbrSection />
      </Suspense>
      <Suspense fallback={<PanelSkeleton rows={5} />}>
        <RecentActivity tag="SBR" />
      </Suspense>
    </div>
  )
}

function CvlView() {
  return (
    <div className="flex flex-col gap-6">
      <ViewIntro
        id="cvl-dashboard"
        title="CVL dashboard"
        description="Dates coming up, and where each liquidation file is with its ASIC forms. All figures as of today."
        href="/cvl"
        cta="Open CVL"
      />
      <Suspense fallback={<TilesSkeleton count={4} />}>
        <CvlKpis />
      </Suspense>
      <Suspense fallback={<SectionSkeleton />}>
        <CvlSection />
      </Suspense>
      <Suspense fallback={<PanelSkeleton rows={5} />}>
        <RecentActivity tag="CVL" />
      </Suspense>
    </div>
  )
}
