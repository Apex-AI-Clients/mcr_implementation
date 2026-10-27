'use client'

import { Fragment, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, Info } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ExportPdfButton } from '@/components/admin/ExportPdfButton'
import { drCr } from '@/components/admin/AtoAccountsPanel'
import { AccountCompositionPanel } from './AccountCompositionPanel'
import { AiSummaryCallout } from '@/components/admin/lodgement/AiSummaryCallout'
import { atoAccountCsv, exportLock, type AtoAccountPayload } from '@/lib/analysis/atoAccount/exportCsv'
import { unpaidPhrase, type IncomeTaxSummary } from '@/lib/analysis/atoAccount/incomeTax'
import { SG_HIGHLIGHT, type SgQuarter, type SuperGuaranteeSummary } from '@/lib/analysis/atoAccount/superGuarantee'
import { cn } from '@/lib/utils'
import { SourcedAmount } from '@/components/ui/SourcedAmount'
import { aud, calculated, type AmountSource } from '@/lib/sources'

/** The ATO rows are listed under the debt composition, line by line. */
const ROWS_LINK = { kind: 'href' as const, href: '#account-composition', label: 'Show the ATO rows' }
/** An amount made of ATO account rows of this account. */
const fromRows = (what: string, account: string, detail: string, extra: Partial<AmountSource> = {}): AmountSource => ({
  from: [what, `${account}: ${detail}`],
  link: ROWS_LINK,
  ...extra,
})
const cents = (n: number) => aud(n)

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const longDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
const period = (p: { from: string; to: string } | null) => (p ? `${longDate(p.from)} – ${longDate(p.to)}` : '—')

const TITLE: Record<AtoAccountPayload['kind'], string> = {
  income_tax: 'Income tax account',
  super_guarantee: 'Superannuation guarantee account',
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface/50 px-3 py-2">
      <p className="text-xs text-foreground/50">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="text-xs text-foreground/40">{sub}</p>}
    </div>
  )
}

function Payments({ payments, account }: { payments: IncomeTaxSummary['payments']; account: string }) {
  return (
    <Stat
      label="Payments received"
      value={
        payments.count === 0 ? (
          'None'
        ) : (
          <SourcedAmount
            value={payments.total}
            cents
            source={fromRows('Payments received', account, `${payments.count} “Payment received” rows (allocation rows not counted twice), ${longDate(payments.first)} to ${longDate(payments.last)}.`)}
          />
        )
      }
      sub={payments.count === 0 ? 'No payments in the account' : `${payments.count} payment${payments.count === 1 ? '' : 's'}, ${longDate(payments.first)} – ${longDate(payments.last)}`}
    />
  )
}

function IncomeTaxSection({ summary, account }: { summary: IncomeTaxSummary; account: string }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Assessments</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-foreground/40">
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 font-medium">Assessed on</th>
                <th className="px-3 py-2 font-medium">Payment due</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.assessments.map((a) => (
                <tr key={a.rowIndex} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 text-foreground/80">{period(a.period)}</td>
                  <td className="px-3 py-2 text-foreground/70">{longDate(a.assessedOn)}</td>
                  <td className="px-3 py-2 text-foreground/70">{longDate(a.paymentDue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground/80">
                    <SourcedAmount
                      value={a.amount}
                      cents
                      source={fromRows(`Income tax assessed for ${period(a.period)}`, account, `the row “${a.description}”, processed ${longDate(a.assessedOn)}, effective (payment due) ${longDate(a.paymentDue)}, ${cents(a.amount)} debit.`)}
                    />
                  </td>
                  <td className={cn('px-3 py-2', a.unpaid > 0 ? 'text-warning' : 'text-success')}>
                    {a.unpaid <= 0
                      ? 'Paid'
                      : `${a.unpaid < a.amount ? `${AUD.format(a.unpaid)} ` : ''}${unpaidPhrase(a) ?? 'unpaid, not yet due'}`}
                  </td>
                </tr>
              ))}
              {summary.assessments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-foreground/50">
                    No assessments in the account.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-foreground/40">
          The export has no lodgement due date, so no &ldquo;days late&rdquo;. What is unpaid assumes the ATO applies
          payments to the oldest debts first.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat
          label="Total assessed"
          value={
            <SourcedAmount
              value={summary.assessedTotal}
              cents
              source={calculated('Total income tax assessed', `${summary.assessments.map((a) => cents(a.amount)).join(' + ') || '$0.00'} = ${cents(summary.assessedTotal)}`, { link: ROWS_LINK })}
            />
          }
        />
        <Payments payments={summary.payments} account={account} />
        <GicStat gic={summary.gic} account={account} />
      </div>
    </div>
  )
}

/** Interest (GIC): net, with what was charged and remitted. */
function GicStat({ gic, account }: { gic: IncomeTaxSummary['gic']; account: string }) {
  const rows = fromRows('Interest (GIC)', account, 'every “General interest charge” row, net of remissions and amendments (summary rows not counted twice).', {
    calculation: `${cents(gic.charged)} charged − ${cents(gic.remitted)} remitted or amended = ${cents(gic.net)}`,
  })
  return <Stat label="Interest (GIC)" value={<SourcedAmount value={gic.net} cents source={rows} />} sub={`${cents(gic.charged)} charged, ${cents(gic.remitted)} remitted or amended`} />
}

function QuarterRow({ q, account }: { q: SgQuarter; account: string }) {
  const quarter = period(q.period)
  const component = (what: string, value: number, key: 'shortfall' | 'nominalInterest' | 'adminFee') =>
    calculated(`${what} for ${quarter}`, `${q.events.map((e) => `${e.label} ${cents(e[key])}`).join(' + ')} = ${cents(value)}`, {
      from: [`${what} for ${quarter}`, `${account}: the “SGC Statement (Liability) - ${what === 'SG shortfall' ? 'SG Shortfall' : what === 'Nominal interest' ? 'SG Nominal Interest' : 'SG Administration Fee'}” rows of this quarter, each added by the event below it.`],
      link: ROWS_LINK,
    })
  const [open, setOpen] = useState(false)
  const headline = q.headline
  return (
    <Fragment>
      <tr className="border-b border-border/40">
        <td className="px-3 py-2 text-foreground/80">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {open ? <ChevronDown className="no-print h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="no-print h-3.5 w-3.5" aria-hidden />}
            {period(q.period)}
          </button>
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-foreground/70">
          <SourcedAmount value={q.shortfall} cents source={component('SG shortfall', q.shortfall, 'shortfall')} />
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-foreground/70">
          <SourcedAmount value={q.nominalInterest} cents source={component('Nominal interest', q.nominalInterest, 'nominalInterest')} />
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-foreground/70">
          <SourcedAmount value={q.adminFee} cents source={component('Administration fee', q.adminFee, 'adminFee')} />
        </td>
        <td className="px-3 py-2 text-right font-medium tabular-nums text-foreground">
          <SourcedAmount
            value={q.total}
            cents
            source={calculated(`SG charge for ${quarter}`, `${cents(q.shortfall)} shortfall + ${cents(q.nominalInterest)} nominal interest + ${cents(q.adminFee)} administration fee = ${cents(q.total)}`, { link: ROWS_LINK })}
          />
        </td>
        <td className="px-3 py-2">
          {headline && (
            <Badge variant={SG_HIGHLIGHT.includes(headline.kind) ? 'warning' : 'muted'}>{headline.label}</Badge>
          )}
          {q.events.length > 1 && <span className="ml-1 text-foreground/40">+{q.events.length - 1}</span>}
        </td>
      </tr>
      {/* Every event: on screen when opened, always in the PDF. */}
      <tr className={cn('border-b border-border/40', open ? '' : 'hidden print:table-row')}>
        <td colSpan={6} className="px-3 pb-2 pl-8">
          <ul className="space-y-0.5 text-foreground/60">
            {q.events.map((e) => (
              <li key={e.rowIndex}>
                <span className={cn(SG_HIGHLIGHT.includes(e.kind) && 'font-medium text-warning')}>{e.label}</span>, processed{' '}
                {longDate(e.processed)}:{' '}
                {e.total === 0 ? (
                  'no amount of its own'
                ) : (
                  <SourcedAmount
                    value={e.total}
                    cents
                    source={{
                      from: [`${e.label} for ${quarter}`, `${account}: the rows printed directly above its statement row, processed ${longDate(e.processed)}.`],
                      calculation: `${cents(e.shortfall)} shortfall + ${cents(e.nominalInterest)} nominal interest + ${cents(e.adminFee)} administration fee = ${cents(e.total)}`,
                      link: ROWS_LINK,
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </td>
      </tr>
    </Fragment>
  )
}

function SuperGuaranteeSection({ summary, account }: { summary: SuperGuaranteeSummary; account: string }) {
  const total = (what: string, key: 'shortfall' | 'nominalInterest' | 'adminFee' | 'total') =>
    calculated(`${what}, every quarter`, `${summary.quarters.map((q) => cents(q[key])).join(' + ')} = ${cents(summary.totals[key])}`, { link: ROWS_LINK })
  const raised = summary.quartersRaisedBy
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Quarters</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-foreground/40">
                <th className="px-3 py-2 font-medium">Quarter</th>
                <th className="px-3 py-2 text-right font-medium">SG shortfall</th>
                <th className="px-3 py-2 text-right font-medium">Nominal interest</th>
                <th className="px-3 py-2 text-right font-medium">Admin fee</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">How it was raised</th>
              </tr>
            </thead>
            <tbody>
              {summary.quarters.map((q) => (
                <QuarterRow key={q.period.from} q={q} account={account} />
              ))}
              <tr className="border-t border-border/60 font-semibold">
                <td className="px-3 py-2 text-foreground">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <SourcedAmount value={summary.totals.shortfall} cents source={total('SG shortfall', 'shortfall')} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <SourcedAmount value={summary.totals.nominalInterest} cents source={total('Nominal interest', 'nominalInterest')} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <SourcedAmount value={summary.totals.adminFee} cents source={total('Administration fee', 'adminFee')} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <SourcedAmount value={summary.totals.total} cents source={total('SG charge', 'total')} />
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-foreground/40">
          Open a quarter for every event that raised or changed it; the latest is shown. {summary.quarters.length} quarters:{' '}
          {raised.ato_audit} with an ATO audit, {raised.ato_default} with an ATO default assessment, {raised.client_amendment} with a
          client amendment, {raised.ato_amendment} with an ATO amendment.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat
          label="Part 7 penalty (net)"
          value={
            <SourcedAmount
              value={summary.part7.net}
              cents
              source={fromRows('Part 7 penalty, net of remission', account, 'every “SG Part 7 penalty” and “SG Part 7 penalty - remission” row.', {
                calculation: `${cents(summary.part7.charged)} charged − ${cents(summary.part7.remitted)} remitted = ${cents(summary.part7.net)}`,
              })}
            />
          }
          sub={`${cents(summary.part7.charged)} charged, ${cents(summary.part7.remitted)} remitted`}
        />
        <GicStat gic={summary.gic} account={account} />
        <Payments payments={summary.payments} account={account} />
      </div>
    </div>
  )
}

/**
 * An income tax or superannuation guarantee account: balance owing, the
 * account's own summary, the debt composition, and CSV and PDF exports —
 * locked while an unexplained difference above $1,000 has not been reviewed.
 */
export function AtoAccountReport({ payload, clientName }: { payload: AtoAccountPayload; clientName: string }) {
  const router = useRouter()
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = exportLock(payload)
  const fileName = `${clientName}_${payload.label}`.replace(/[^\w.-]+/g, '_')
  const [ai, setAi] = useState({ text: payload.aiSummary ?? null, at: payload.aiSummaryGeneratedAt ?? null })

  // An analysis stored by an automatic run has its figures but no summary:
  // write it now that someone is looking — once it is not locked for review.
  useEffect(() => {
    if (ai.text || lock) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/admin/clients/${payload.clientId}/ato-accounts/${payload.id}/summary`, { method: 'POST' })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { aiSummary: string | null; aiSummaryGeneratedAt: string | null }
        if (data.aiSummary) setAi({ text: data.aiSummary, at: data.aiSummaryGeneratedAt })
      } catch {
        // The figures stand on their own; the summary can be written next visit.
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.id, lock])

  async function markReviewed() {
    setReviewing(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${payload.clientId}/ato-accounts/${payload.id}/review`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not record the review.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the review.')
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{TITLE[payload.kind]}</h1>
          <p className="mt-0.5 text-sm text-foreground/50">
            {payload.label} · {payload.entityName ?? clientName}
          </p>
        </div>
        <div className="no-print flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={lock !== null}
            title={lock ?? undefined}
            onClick={() => downloadCsv(atoAccountCsv(payload, clientName), `${fileName}.csv`)}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
          <ExportPdfButton targetId="ato-account-export-root" fileName={fileName} lockedReason={lock} />
        </div>
      </div>

      {payload.entityMatches === false && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          This account is for {payload.entityName}, which does not match the client&rsquo;s company or trust name. Check it is the
          right client.
        </p>
      )}

      {lock ? (
        <Card className="border-warning/30 bg-warning/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <div>
                <p className="text-sm font-medium text-foreground">Needs review</p>
                <p className="mt-0.5 text-xs text-foreground/60">
                  The rows account for a different balance from the ATO&rsquo;s: {AUD.format(Math.abs(payload.unexplained ?? 0))}{' '}
                  unexplained. Check &ldquo;Other adjustments / unexplained difference&rdquo; below. The exports are locked until
                  someone has reviewed it.
                </p>
                {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
              </div>
            </div>
            <Button size="sm" onClick={markReviewed} loading={reviewing} className="no-print">
              Mark as reviewed
            </Button>
          </div>
        </Card>
      ) : (
        payload.reviewedAt && (
          <p className="flex items-center gap-1.5 text-xs text-foreground/50">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
            Unexplained difference reviewed by {payload.reviewedBy ?? 'staff'} on {longDate(payload.reviewedAt)}.
          </p>
        )
      )}

      <AiSummaryCallout summary={ai.text} generatedAt={ai.at} />

      <div className="grid gap-2 sm:grid-cols-2">
        <Stat
          label="Balance owing"
          value={
            payload.balance === null ? (
              'No balance printed'
            ) : (
              <SourcedAmount
                value={payload.balance}
                format={drCr}
                source={fromRows('Balance owing', payload.label, `the ATO's own running balance on its newest row${payload.balanceDate ? ` (${longDate(payload.balanceDate)})` : ''}, as printed in the CSV.`)}
              />
            )
          }
          sub={payload.balanceDate ? `ATO balance at ${longDate(payload.balanceDate)}` : undefined}
        />
        <Stat
          label="Unexplained difference"
          value={
            <SourcedAmount
              value={payload.unexplained}
              cents
              source={calculated(
                'Unexplained difference',
                `${payload.balance === null ? 'no balance' : cents(payload.balance)} ATO balance − ${cents((payload.balance ?? 0) - (payload.unexplained ?? 0))} the rows account for = ${cents(payload.unexplained ?? 0)}`,
                { link: ROWS_LINK },
              )}
            />
          }
          sub="The ATO balance less what the rows account for"
        />
      </div>

      <Card>
        {payload.kind === 'income_tax' ? (
          <IncomeTaxSection summary={payload.summary} account={payload.label} />
        ) : (
          <SuperGuaranteeSection summary={payload.summary} account={payload.label} />
        )}
      </Card>

      <p className="flex items-start gap-2 rounded-lg border border-border bg-surface/50 px-3 py-2 text-xs text-foreground/70">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
        {payload.summary.note}
      </p>

      <Card>
        <AccountCompositionPanel composition={payload.composition} account={payload.label} />
      </Card>

      <p className="text-xs text-foreground/40">
        Analysed {longDate(payload.analysedAt)}
        {payload.sourceFilename ? ` from ${payload.sourceFilename}` : ''}.
      </p>
    </div>
  )
}
