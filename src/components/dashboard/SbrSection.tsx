import Link from 'next/link'
import { Suspense } from 'react'
import { loadReadinessDashboard, loadSbrDashboard } from '@/lib/dashboard/load'
import { RISK_BAND_LABELS } from '@/lib/sbr/riskBands'
import { STATUS_LABEL, type ReadinessStatus } from '@/lib/sbr/readiness'
import type { SbrRiskBand } from '@/lib/sbr/types'
import { SegmentBar } from './charts'
import { EmptyNote, Meter, Panel, PanelTitle, Pill, SectionHeader } from './Panel'
import { formatCount, formatMoneyShort, plural } from './format'
import { PanelSkeleton } from './Skeletons'

const BAND_STYLE: Record<SbrRiskBand, string> = {
  likely_accepted: 'bg-success',
  borderline: 'bg-warning',
  high_rejection_risk: 'bg-destructive',
}

const STATUS_STYLE: Record<ReadinessStatus, string> = {
  ready: 'bg-success',
  processing: 'bg-chart-1/60',
  needs_review: 'bg-warning',
  failed: 'bg-destructive',
  not_started: 'bg-chart-4',
  not_uploaded: 'bg-chart-4/40',
}

const STATUS_ORDER: ReadinessStatus[] = ['ready', 'processing', 'needs_review', 'failed', 'not_started', 'not_uploaded']

const DPN_TYPE_LABEL: Record<string, string> = { paygw: 'PAYGW', gst: 'GST', sgc: 'SGC' }

function pctText(n: number | null): string {
  return n === null ? '–' : `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`
}

export async function SbrSection() {
  const d = await loadSbrDashboard()
  const p = d.predictions
  const bandTotal = p.bands.likely_accepted + p.bands.borderline + p.bands.high_rejection_risk
  const atoKinds = [
    { label: 'Activity statement', value: d.ato.byKind.activity_statement },
    { label: 'Income tax', value: d.ato.byKind.income_tax },
    { label: 'Super guarantee', value: d.ato.byKind.super_guarantee },
  ]
  const atoMax = Math.max(1, ...atoKinds.map((k) => k.value))

  return (
    <section aria-labelledby="sbr-h" className="flex flex-col gap-4">
      <SectionHeader id="sbr-h" title="Small Business Restructuring" note={plural(d.activeFiles, 'active file')} href="/sbr" linkLabel="Open SBR" />

      {d.activeFiles === 0 ? (
        <EmptyNote>No active SBR files yet. Convert a lead or add a client in the SBR workspace.</EmptyNote>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Document collection */}
            <Panel>
              <PanelTitle title="Document collection" subtitle="Required documents across active files" action={{ href: '/clients', label: 'Clients' }} />
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight text-foreground tabular-nums">{d.documents.overallPct}%</span>
                <span className="text-sm text-muted">collected · {plural(d.documents.total, 'document')} on file</span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={d.documents.overallPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Required documents collected"
                className="h-2.5 overflow-hidden rounded-full bg-primary"
              >
                <div className="h-full rounded-full bg-accent" style={{ width: `${d.documents.overallPct}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <BigStat value={d.documents.complete} label="Files complete" className="text-success" />
                <BigStat value={d.documents.awaiting} label="Awaiting documents" className="text-warning" />
              </div>
              {d.documents.furthestBehind.length > 0 && (
                <div className="flex flex-col gap-2.5 border-t border-border pt-4">
                  <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Furthest behind</span>
                  {d.documents.furthestBehind.map((f) => (
                    <Link key={f.id} href={`/clients/${f.id}`} className="group flex flex-col gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="truncate text-muted group-hover:text-foreground">{f.name}</span>
                        <span className="font-semibold text-foreground tabular-nums">{f.pct}%</span>
                      </div>
                      <Meter pct={f.pct} className="bg-warning" />
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            {/* Predicted outcome */}
            <Panel>
              <PanelTitle
                title="Predicted outcome"
                subtitle={p.count ? `${plural(p.count, 'file')} with a prediction, by risk band` : 'No predictions yet'}
                action={{ href: '/sbr/prediction-data', label: 'Prediction data' }}
              />
              {p.count === 0 ? (
                <EmptyNote>Run “Predict SBR outcome” on a client file to see it here.</EmptyNote>
              ) : (
                <>
                  <SegmentBar
                    height="h-3"
                    segments={(Object.keys(BAND_STYLE) as SbrRiskBand[]).map((b) => ({ label: RISK_BAND_LABELS[b], value: p.bands[b], bgClass: BAND_STYLE[b] }))}
                    ariaLabel={(Object.keys(BAND_STYLE) as SbrRiskBand[]).map((b) => `${p.bands[b]} ${RISK_BAND_LABELS[b].toLowerCase()}`).join(', ')}
                  />
                  <ul className="flex flex-col gap-2.5">
                    {(Object.keys(BAND_STYLE) as SbrRiskBand[]).map((b) => (
                      <li key={b} className="flex items-center gap-2 text-[13px]">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${BAND_STYLE[b]}`} aria-hidden="true" />
                        <span className="flex-1 text-muted">{RISK_BAND_LABELS[b]}</span>
                        <span className="font-semibold text-foreground tabular-nums">{formatCount(p.bands[b])}</span>
                        <span className="w-9 text-right text-muted tabular-nums">{bandTotal ? `${Math.round((p.bands[b] / bandTotal) * 100)}%` : '–'}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xl font-semibold text-foreground tabular-nums">{pctText(p.averageOutcome)}</span>
                      <span className="text-xs text-muted">
                        Average predicted return ({pctText(p.averageLow)}–{pctText(p.averageHigh)})
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xl font-semibold text-foreground tabular-nums">{formatMoneyShort(p.creditorTotal)}</span>
                      <span className="text-xs text-muted">Owed to creditors</span>
                    </div>
                  </div>
                </>
              )}
            </Panel>

            {/* Tax position */}
            <Panel>
              <PanelTitle title="Tax position" subtitle="ATO balances and lodgement across active files" />
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight text-foreground tabular-nums">{formatMoneyShort(d.ato.total)}</span>
                <span className="text-sm text-muted">owed to the ATO</span>
              </div>
              <div className="flex flex-col gap-3">
                {atoKinds.map((k) => (
                  <div key={k.label} className="flex flex-col gap-1.5">
                    <div className="flex justify-between gap-2 text-[13px]">
                      <span className="text-muted">{k.label}</span>
                      <span className="font-semibold text-foreground tabular-nums">{formatMoneyShort(k.value)}</span>
                    </div>
                    <Meter pct={(Math.max(0, k.value) / atoMax) * 100} className="bg-chart-1" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3 border-t border-border pt-4">
                <BigStat value={d.lodgement.lateLodgements} label="Late lodgements" small />
                <BigStat value={d.lodgement.daysLate} label="Days late in total" small />
                <BigStat value={d.dpn.notices} label={`DPNs${dpnTypes(d.dpn.byType)}`} small />
              </div>
            </Panel>
          </div>

          <Suspense
            fallback={
              <div className="grid gap-5 lg:grid-cols-2">
                <PanelSkeleton rows={3} />
                <PanelSkeleton rows={5} />
              </div>
            }
          >
            <ReadinessPanels />
          </Suspense>
        </>
      )}
    </section>
  )
}

function dpnTypes(byType: Record<string, number>): string {
  const parts = Object.entries(byType)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${DPN_TYPE_LABEL[t] ?? t.toUpperCase()}`)
  return parts.length ? ` (${parts.join(', ')})` : ''
}

function BigStat({ value, label, className, small }: { value: number; label: string; className?: string; small?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`${small ? 'text-lg' : 'text-2xl'} font-semibold tabular-nums ${className ?? 'text-foreground'}`}>{formatCount(value)}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  )
}

async function ReadinessPanels() {
  const r = await loadReadinessDashboard()
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel>
        <PanelTitle
          title="Readiness checklist"
          subtitle={`Each item across ${plural(r.files, 'file')}`}
          badge={<Pill tone="success">{formatCount(r.readyToPredict)} ready to predict</Pill>}
        />
        <div className="flex flex-col gap-4">
          {r.items.map((item) => {
            const issues = item.counts.needs_review + item.counts.failed
            return (
              <div key={item.key} className="flex flex-col gap-2">
                <div className="flex justify-between gap-2 text-[13px]">
                  <span className="font-medium text-foreground">{item.label || item.key}</span>
                  <span className="text-muted tabular-nums">
                    {formatCount(item.counts.ready)} ready{issues > 0 ? ` · ${formatCount(issues)} to check` : ''}
                  </span>
                </div>
                <SegmentBar
                  segments={STATUS_ORDER.map((s) => ({ label: STATUS_LABEL[s], value: item.counts[s], bgClass: STATUS_STYLE[s] }))}
                  ariaLabel={`${item.label}: ${STATUS_ORDER.map((s) => `${item.counts[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(', ')}`}
                />
              </div>
            )
          })}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-4">
          {STATUS_ORDER.map((s) => (
            <li key={s} className="flex items-center gap-1.5 text-xs text-muted">
              <span className={`h-2.5 w-2.5 rounded-[3px] ${STATUS_STYLE[s]}`} aria-hidden="true" />
              {STATUS_LABEL[s]}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="gap-2 pb-3">
        <PanelTitle
          title="Needs attention"
          badge={r.attention.length > 0 ? <Pill tone="warning">{formatCount(r.attention.length)}</Pill> : undefined}
          subtitle="Items to review, or that could not be processed"
        />
        {r.attention.length === 0 ? (
          <EmptyNote>Nothing is waiting for a review.</EmptyNote>
        ) : (
          <ul className="flex flex-col">
            {r.attention.slice(0, 6).map((a, i) => (
              <li key={`${a.clientId}-${i}`} className="border-t border-border first:border-t-0">
                <Link
                  href={a.href}
                  className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold text-foreground">{a.name}</span>
                    <span className="line-clamp-1 text-xs text-muted">{a.detail}</span>
                  </div>
                  <Pill tone={a.status === 'failed' ? 'destructive' : 'warning'}>{a.status === 'failed' ? 'Failed' : 'Needs review'}</Pill>
                </Link>
              </li>
            ))}
            {r.attention.length > 6 && (
              <li className="border-t border-border pt-3 text-xs text-muted">and {formatCount(r.attention.length - 6)} more on the client files</li>
            )}
          </ul>
        )}
      </Panel>
    </div>
  )
}
