import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { getSupabaseAuthClient } from '@/lib/supabase/server'
import { getCompletenessSummary } from '@/lib/clients/completeness'
import { getOpenLeadCount } from '@/lib/leads/queries'
import { WORKSPACES, type Workspace } from '@/lib/workspaces'
import { firstNameFromMetadata } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface Stat {
  value: number
  label: string
  /** Amber when there's something to act on today. */
  tone?: 'warning'
}

/**
 * Workspace chooser. The sidebar hides itself here and WorkspaceTopBar takes
 * over, so this page owns the whole area below the header.
 */
export default async function WorkspaceChooserPage() {
  const supabase = await getSupabaseAuthClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const summary = await getCompletenessSummary()

  // Counted in SQL rather than by reading every lead and calling .length —
  // that load was also silently capped at PostgREST's 1000-row ceiling.
  const openLeads = await getOpenLeadCount()

  const [crm, sbr] = WORKSPACES

  return (
    // 3.5rem is the WorkspaceTopBar height — explicit beats a percentage that
    // has to resolve against a flex-sized scroll container.
    <div className="relative flex min-h-[calc(100vh-3.5rem)] items-center justify-center overflow-hidden px-6 py-14">
      {/* Ambient wash. Accent is fixed across themes, so a low opacity reads
          correctly in both without a second palette. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-accent/8 blur-[120px]" />
        <div className="absolute -bottom-48 -right-32 h-[26rem] w-[26rem] rounded-full bg-accent/6 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            color: 'var(--color-accent)',
          }}
        />
      </div>

      <div className="relative w-full max-w-4xl">
        <div className="mb-9">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {greetingLine(user?.user_metadata)}
          </h1>
          <p className="mt-2 text-base text-foreground/50">Where would you like to start?</p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <WorkspaceCard
            workspace={crm}
            stats={[
              { value: openLeads, label: openLeads === 1 ? 'Open lead' : 'Open leads' },
              // Follow-up stat — hidden with the rest of the follow-up UI (table
              // column, filter toggle, page-header count, top-bar pill, record
              // badge). Restore alongside the `followUps` line above.
              // {
              //   value: followUps,
              //   label: 'Need follow-up',
              //   tone: followUps > 0 ? 'warning' : undefined,
              // },
            ]}
          />
          <WorkspaceCard
            workspace={sbr}
            stats={[
              {
                value: summary.totalClients,
                label: summary.totalClients === 1 ? 'Active file' : 'Active files',
              },
              { value: summary.awaitingDocuments, label: 'Awaiting docs' },
            ]}
          />
        </div>

        <p className="mt-8 text-xs text-foreground/30">MCR Partners</p>
      </div>
    </div>
  )
}

function WorkspaceCard({ workspace, stats }: { workspace: Workspace; stats: Stat[] }) {
  const Icon = workspace.icon

  return (
    <Link
      href={workspace.href}
      className="group flex flex-col rounded-2xl border border-border bg-card p-7 transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 transition-colors group-hover:bg-accent/15">
        <Icon className="h-6 w-6 text-accent" />
      </div>

      <h2 className="mt-5 text-xl font-semibold tracking-tight text-foreground">
        {workspace.name}
      </h2>
      {workspace.fullName !== workspace.name && (
        <p className="mt-1 text-xs text-foreground/40">{workspace.fullName}</p>
      )}
      <p className="mt-2.5 min-h-[2.75rem] text-sm leading-relaxed text-foreground/55">
        {workspace.description}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5">
        {stats.map((stat) => (
          <div key={stat.label}>
            <p
              className={`text-3xl font-bold tabular-nums ${
                stat.tone === 'warning' ? 'text-warning' : 'text-foreground'
              }`}
            >
              {stat.value}
            </p>
            <p
              className={`mt-1 text-xs ${
                stat.tone === 'warning' ? 'text-warning/80' : 'text-foreground/40'
              }`}
            >
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        Open {workspace.name}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}

/**
 * One line, time-of-day aware. Falls back to "Welcome back" when Supabase has
 * no name for the user.
 *
 * The hour is resolved in Australia/Sydney, not the server's timezone — this
 * renders on a UTC host and MCR is an Australian practice, so a plain
 * `getHours()` would greet Gabby with "Good evening" at 9am.
 */
function greetingLine(metadata: Record<string, unknown> | undefined): string {
  const firstName = firstNameFromMetadata(metadata)
  if (!firstName) return 'Welcome back'

  const hour = Number(
    new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()),
  )

  const partOfDay = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return `${partOfDay}, ${firstName}`
}
