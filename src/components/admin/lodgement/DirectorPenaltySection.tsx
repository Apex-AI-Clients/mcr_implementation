'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { SourcedAmount } from '@/components/ui/SourcedAmount'
import { CopyButton, VerifiedBadge } from '@/components/admin/ica/IcaParts'
import type { DpnRiskBreakdown } from '@/lib/analysis/types'
import { lateSinceNil, lateStatements, type LateStatementRow } from '@/lib/analysis/lateList'
import type { DpnNoticeFigures, DpnNoticeItem } from '@/lib/dpn/noticeFigures'

/**
 * The lodgement page's director penalty section (Gabby, 16 Nov 2026):
 *   - two cards side by side, each saying where it comes from:
 *     "Unpaid" (the ATO's notices, Column 3 of the current notices) and
 *     "Lodged more than 90 days late since the balance was last nil" (the ATO
 *     account, GST and PAYG withholding each counted on its own);
 *   - the statements lodged more than 90 days late, in a dropdown, with Copy,
 *     Copy all and an Excel download;
 *   - each current notice with its rows as printed (Columns 2–5).
 * A collapsed list is still in the PDF export (print:block).
 */

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const aud = (n: number) => AUD.format(n)

/** "21 Oct 2026" from an ISO date or instant. */
function day(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : undefined })
}

async function downloadXlsx(name: string, header: string[], rows: (string | number)[][]) {
  const XLSX = await import('xlsx')
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Rows')
  XLSX.writeFile(book, `${name.replace(/[^\w.\- ]+/g, '_')}.xlsx`)
}

const LATE_HEADER = ['Period ending', 'Lodged (processed)', 'Due (effective)', 'Days late', 'GST', 'PAYG withholding', 'Other', 'Total', 'Description as printed']
const lateCells = (r: LateStatementRow): (string | number)[] => [day(r.periodEnding), day(r.lodged), day(r.due), r.daysLate, r.gst, r.paygw, r.other, r.total, r.description]
const lateCopy = (r: LateStatementRow) => `${r.description}\tGST ${aud(r.gst)}\tPAYG ${aud(r.paygw)}\t${aud(r.total)}`

function Card({ source, label, children, tone }: { source: string; label: string; children: React.ReactNode; tone: 'notice' | 'account' }) {
  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        tone === 'notice' ? 'border-warning/40 bg-warning/5' : 'border-destructive/30 bg-destructive/5',
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">{source}</p>
      <p className="mt-1.5 text-xs text-foreground/60">{label}</p>
      {children}
    </div>
  )
}

/** What stands in for a figure that is not proven yet (Gabby, 17 Nov 2026). */
const BEING_PREPARED = 'Being prepared'

export function DirectorPenaltySection({
  dpnRisk,
  notices,
  dpnPage,
  fileName,
  accountBadge,
}: {
  dpnRisk: DpnRiskBreakdown
  notices: DpnNoticeFigures | null
  dpnPage?: string
  fileName: string
  /** The ATO account's proof ("Matches the ATO's own balance: ..."). */
  accountBadge?: string | null
}) {
  const [showLate, setShowLate] = useState(false)
  const late = lateStatements(dpnRisk.contributingDebits)
  const since = lateSinceNil(dpnRisk)
  const hasOther = late.some((r) => r.other !== 0)

  return (
    <div data-testid="director-penalty-section" className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Director penalty notices</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card tone="notice" source="From the ATO's director penalty notices" label="Unpaid">
          {notices && notices.heldBack ? (
            <>
              <p className="mt-0.5 text-lg font-medium text-foreground/60">{BEING_PREPARED}</p>
              <p className="mt-0.5 text-xs text-foreground/55">A notice is not proven yet: its rows are listed below as printed.</p>
            </>
          ) : notices ? (
            <>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-warning">
                <SourcedAmount
                  value={notices.unpaid}
                  format={aud}
                  source={{
                    from: [
                      'Unpaid: Column 3 of the current director penalty notices, each type and period once.',
                      ...notices.items.map((n) => `${n.label} notice issued ${day(n.issuedOn)}: ${aud(n.totals.column3)}`),
                    ],
                    calculation: notices.byType.length > 1 ? `${notices.byType.map((t) => aud(t.unpaid)).join(' + ')} = ${aud(notices.unpaid)}` : null,
                    link: dpnPage ? { kind: 'href', href: dpnPage, label: 'Open the director penalty notices' } : null,
                  }}
                />
              </p>
              <p data-explanation className="mt-0.5 text-xs text-foreground/55">
                Column 3 of the current notices{notices.byType.length ? ' · ' : ''}
                {notices.byType.map((t) => `${t.label} ${aud(t.unpaid)}`).join(' · ')}
              </p>
              {notices.badges.length > 0 && (
                <div className="mt-2">
                  <VerifiedBadge text={notices.badges.join(' · ')} />
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-foreground/70">No director penalty notice uploaded</p>
          )}
        </Card>

        <Card tone="account" source="From the ATO account" label="Lodged more than 90 days late since the balance was last nil">
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-destructive">
            <SourcedAmount
              value={since.total}
              format={aud}
              source={{
                from: [
                  `The ${since.statements} activity statements lodged more than 90 days after their due date${since.since ? ` since ${day(since.since)}, the last day the ATO's balance was nil or in credit` : ' (the balance was never nil in the export)'}.`,
                  'GST and PAYG withholding are each counted on their own (a statement’s sub-lines); a credit of one never offsets the other.',
                ],
                calculation: `GST ${aud(since.gst)} + PAYG withholding ${aud(since.paygw)}${since.other ? ` + other ${aud(since.other)}` : ''} = ${aud(since.total)}`,
                link: { kind: 'href', href: '#late-statements', label: 'Show the statements' },
              }}
            />
          </p>
          <p data-explanation className="mt-0.5 text-xs text-foreground/55">
            {since.since ? `Since ${day(since.since)}` : 'Whole export (the balance was never nil)'} · GST {aud(since.gst)} · PAYG withholding {aud(since.paygw)}
            {since.other ? ` · other ${aud(since.other)}` : ''} (each counted on its own)
          </p>
          {accountBadge && (
            <div className="mt-2">
              <VerifiedBadge text={accountBadge} />
            </div>
          )}
        </Card>
      </div>

      <div id="late-statements" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setShowLate((v) => !v)} className="no-print flex items-center gap-1 text-xs font-medium text-accent">
            {showLate ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showLate ? 'Hide' : 'Show'} the {late.length} statement{late.length === 1 ? '' : 's'} lodged more than 90 days late
          </button>
          {late.length > 0 && (
            <span className="no-print flex items-center gap-2">
              <CopyButton text={late.map(lateCopy).join('\n')} label="Copy all" />
              <Button variant="ghost" size="sm" onClick={() => void downloadXlsx(`${fileName} — lodged more than 90 days late`, LATE_HEADER, late.map(lateCells))}>
                <Download className="h-3.5 w-3.5" />
                Download these rows (Excel)
              </Button>
            </span>
          )}
        </div>
        {late.length > 0 && (
          <div className={cn('overflow-x-auto', !showLate && 'hidden print:block')}>
            <table data-source-rows className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-foreground/50">
                  <th className="py-1.5 pr-3 font-medium">Period ending</th>
                  <th className="py-1.5 pr-3 font-medium">Lodged</th>
                  <th className="py-1.5 pr-3 font-medium">Due</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Days late</th>
                  <th className="py-1.5 pr-3 text-right font-medium">GST</th>
                  <th className="py-1.5 pr-3 text-right font-medium">PAYG withholding</th>
                  {hasOther && <th className="py-1.5 pr-3 text-right font-medium">Other</th>}
                  <th className="py-1.5 pr-3 text-right font-medium">Total</th>
                  <th className="no-print py-1.5" />
                </tr>
              </thead>
              <tbody>
                {late.map((r) => (
                  <tr key={r.key} className="border-b border-white/8" title={r.description}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{day(r.periodEnding)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{day(r.lodged)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{day(r.due)}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-destructive">{r.daysLate}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{aud(r.gst)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{aud(r.paygw)}</td>
                    {hasOther && <td className="py-1.5 pr-3 text-right tabular-nums">{aud(r.other)}</td>}
                    <td className="py-1.5 pr-3 text-right font-medium tabular-nums">{aud(r.total)}</td>
                    <td className="no-print py-1.5 text-right">
                      <CopyButton text={lateCopy(r)} />
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5 pr-3" colSpan={4}>
                    {late.length} statement{late.length === 1 ? '' : 's'}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{aud(since.gst)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{aud(since.paygw)}</td>
                  {hasOther && <td className="py-1.5 pr-3 text-right tabular-nums">{aud(since.other)}</td>}
                  <td className="py-1.5 pr-3 text-right tabular-nums">{aud(since.total)}</td>
                  <td className="no-print" />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NoticesList notices={notices} dpnPage={dpnPage} fileName={fileName} />
    </div>
  )
}

function NoticesList({ notices, dpnPage, fileName }: { notices: DpnNoticeFigures | null; dpnPage?: string; fileName: string }) {
  return (
    <div data-testid="dpn-notices-list" className="space-y-2 border-t border-border/40 pt-4">
      <h4 className="text-sm font-semibold text-foreground">From the ATO&apos;s director penalty notices</h4>
      {!notices || notices.items.length === 0 ? (
        <p className="text-xs text-foreground/60">No director penalty notice uploaded.</p>
      ) : (
        notices.items.map((n) => <NoticeRow key={n.documentId} notice={n} fileName={fileName} />)
      )}
      {dpnPage && (
        <Link href={dpnPage} className="no-print inline-block text-xs font-medium text-accent hover:text-accent/80">
          DPN Summary →
        </Link>
      )}
    </div>
  )
}

const COLUMNS = ['column2', 'column3', 'column4', 'column5'] as const

function NoticeRow({ notice: n, fileName }: { notice: DpnNoticeItem; fileName: string }) {
  const [open, setOpen] = useState(false)
  const passed = n.daysLeft < 0
  const header = ['Period from', 'Period to', ...COLUMNS.map((c, i) => `Column ${i + 2}: ${n.headings[c]}`)]
  const cells = n.rows.map((r) => [day(r.periodFrom), day(r.periodTo), r.column2, r.column3, r.column4, r.column5])
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex flex-wrap items-center gap-2">
          <span>
            <span className="font-semibold">{n.label} notice</span>
            <span className="text-foreground/60"> · issued {day(n.issuedOn)} · {n.rows.length} periods</span>
          </span>
          {n.proof.badges.length > 0 && <VerifiedBadge text={n.proof.badges.join(' · ')} />}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            passed ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning',
          )}
        >
          {passed ? `Deadline passed ${day(n.deadline)}` : `Deadline ${day(n.deadline)} · ${n.daysLeft} day${n.daysLeft === 1 ? '' : 's'} left`}
        </span>
      </div>
      {n.proof.note && <p className="mt-1.5 text-xs text-foreground/60">{n.proof.note}.</p>}
      {n.proof.status !== 'verified' && <NoticeProblems notice={n} />}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="no-print flex items-center gap-1 text-xs font-medium text-accent">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {open ? 'Hide' : 'Show'} the notice&apos;s rows
        </button>
        <Button variant="ghost" size="sm" className="no-print" onClick={() => void downloadXlsx(`${fileName} — ${n.label} notice ${n.issuedOn}`, header, cells)}>
          <Download className="h-3.5 w-3.5" />
          Download (Excel)
        </Button>
      </div>
      <div className={cn('mt-2 overflow-x-auto', !open && 'hidden print:block')}>
        <table data-source-rows className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left align-bottom text-foreground/50">
              <th className="py-1.5 pr-3 font-medium">Period</th>
              {COLUMNS.map((c, i) => (
                <th key={c} className="py-1.5 pr-3 text-right font-medium">
                  Column {i + 2}
                  <span className="block font-normal text-foreground/40">{n.headings[c]}</span>
                </th>
              ))}
              <th className="no-print py-1.5" />
            </tr>
          </thead>
          <tbody>
            {n.rows.map((r) => (
              <tr key={`${r.periodFrom}-${r.periodTo}`} className="border-b border-white/8">
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {day(r.periodFrom)} – {day(r.periodTo)}
                </td>
                {COLUMNS.map((c) => (
                  <td key={c} className="py-1.5 pr-3 text-right tabular-nums">
                    {aud(r[c])}
                  </td>
                ))}
                <td className="no-print py-1.5 text-right">
                  <CopyButton text={`${day(r.periodFrom)} – ${day(r.periodTo)}\t${COLUMNS.map((c) => aud(r[c])).join('\t')}`} />
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5 pr-3">Total</td>
              {n.proof.status === 'verified' ? (
                COLUMNS.map((c) => (
                  <td key={c} className="py-1.5 pr-3 text-right tabular-nums">
                    {aud(n.totals[c])}
                  </td>
                ))
              ) : (
                <td colSpan={COLUMNS.length} className="py-1.5 pr-3 text-right font-normal text-foreground/60">
                  {BEING_PREPARED}
                </td>
              )}
              <td className="no-print" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Why a notice is not proven: rows whose Column 3 is not 4 + 5, and periods whose Column 2 differs from the ATO account (in its words). */
function NoticeProblems({ notice: n }: { notice: DpnNoticeItem }) {
  return (
    <div data-testid="dpn-notice-problems" className="mt-2 space-y-1 rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground/70">
      {n.proof.rowsNotAddingUp.map((r) => (
        <p key={`add-${r.periodFrom}`}>
          {day(r.periodFrom)} – {day(r.periodTo)}: Column 3 is not Column 4 + Column 5 on the notice as read.
        </p>
      ))}
      {n.proof.mismatches.map((m) => (
        <div key={`mm-${m.periodFrom}`} data-source-rows>
          <p>
            {day(m.periodFrom)} – {day(m.periodTo)}: the notice&apos;s Column 2 is {aud(m.notice)}; the ATO account shows {aud(m.account)}:
          </p>
          <ul className="ml-4 list-disc text-foreground/55">
            {m.accountRows.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
