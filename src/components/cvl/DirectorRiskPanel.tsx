import Link from 'next/link'
import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { SourcedAmount } from '@/components/ui/SourcedAmount'
import { aud, printedLinesSource, type AmountSource } from '@/lib/sources'
import { DPN_TYPE_LABEL } from '@/lib/dpn/types'
import { describeDaysLeft, formatIsoDate } from '@/lib/dpn/summary'
import { REPORTED_LATE_DAYS, type PotentialByType, type ReportedItem } from '@/lib/cvl/directorRisk'
import type { DirectorRiskData } from '@/lib/cvl/directorRiskStore'
import { unparsedDatesMessage } from '@/lib/analysis/config'

interface DirectorRiskPanelProps {
  clientId: string
  risk: DirectorRiskData
}

const ddmmyyyy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const MAX_LISTED = 12

/** One reported amount, in a line: what, how much, when reported against when due. */
function itemLine(i: ReportedItem): string {
  const reported = i.reportedOn ? `reported ${ddmmyyyy(i.reportedOn)}` : 'not reported by the company'
  const due = i.dueOn ? `, due ${ddmmyyyy(i.dueOn)}` : ''
  const late = i.daysLate !== null && i.daysLate > 0 ? ` (${i.daysLate} days after)` : ''
  return `${i.period}: ${aud(i.amount)} — ${i.how}, ${reported}${due}${late}.`
}

function itemsSource(what: string, from: string, items: ReportedItem[], total: number, href: string | null): AmountSource {
  return {
    from: [
      what,
      from,
      ...items.slice(0, MAX_LISTED).map(itemLine),
      ...(items.length > MAX_LISTED ? [`… and ${items.length - MAX_LISTED} more.`] : []),
    ],
    rule: `Reported more than ${REPORTED_LATE_DAYS} days (3 months) after the due date counts as late.`,
    calculation: items.length > 1 ? `${items.length} amounts = ${aud(total)}` : null,
    link: href ? { kind: 'href', href, label: 'Show the ATO rows' } : null,
  }
}

/**
 * The director's personal risk on a CVL file: the notices already issued,
 * the PAYG withholding, GST and super guarantee charge a notice could still
 * cover (split by whether each was reported within 3 months of its due date),
 * the director loan year by year, and the total ATO debt. Fixed rules over the
 * files on record; no AI, and not advice.
 */
export function DirectorRiskPanel({ clientId, risk }: DirectorRiskPanelProps) {
  const base = `/cvl/${clientId}`
  const asHref = `${base}/lodgement-compliance-analysis`
  const fromFor = (p: PotentialByType) =>
    p.type === 'sgc'
      ? risk.sgAccounts.length
        ? `Superannuation guarantee account: ${risk.sgAccounts.join(', ')}.`
        : 'No superannuation guarantee account on file.'
      : risk.activityStatement
        ? `${risk.activityStatement.label ?? 'Activity statement'}: the ${DPN_TYPE_LABEL[p.type]} sub-line under each statement.`
        : 'No activity statement on file.'
  const hrefFor = (p: PotentialByType) => (p.type === 'sgc' ? null : risk.activityStatement ? asHref : null)

  // An account whose dates could not be read gives no figure: no total either.
  const potentialUnread = risk.potential.some((p) => (p.unreadableRows ?? 0) > 0)
  const lateTotal = risk.potential.reduce((s, p) => s + p.late, 0)
  const staysTotal = risk.issued.reduce((s, d) => s + d.stays, 0)
  const debtSource: AmountSource = {
    from: [
      'Every ATO account’s newest balance, credits netted off.',
      ...risk.accounts.map((a) =>
        a.unparsedDateRows > 0
          ? `${a.label}: not read (dates unreadable)`
          : `${a.label}: ${a.balance === null ? 'no balance read' : aud(a.balance)}${a.balanceDate ? ` at ${ddmmyyyy(a.balanceDate)}` : ''}`,
      ),
    ],
    link: { kind: 'href', href: asHref, label: 'Open the ATO accounts' },
  }
  const lateSource: AmountSource = {
    from: [
      'Reported more than 3 months late, or never reported by the company: if a notice is issued for it, it stays with the director (it is not removed by appointing a liquidator).',
      ...risk.potential.map((p) => `${DPN_TYPE_LABEL[p.type]}: ${aud(p.late)}`),
    ],
    calculation: `= ${aud(lateTotal)}`,
  }
  const staysSource: AmountSource = {
    from: [
      'The notices on file, current notice per director and type: the amount that stays with the director unless paid.',
      ...risk.issued.map((d) => `${d.directorName}: ${aud(d.stays)}`),
    ],
    link: { kind: 'href', href: `${base}/director-penalty-notices`, label: 'Open the notices' },
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-foreground/50" />
          <CardTitle>Director&rsquo;s personal risk</CardTitle>
        </div>
      </CardHeader>

      {/* An ATO account whose dates could not be read: failed, never figures. */}
      {risk.unreadable.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          {risk.unreadable.map((u) => (
            <p key={u.label} className="font-medium">
              {u.label}: {unparsedDatesMessage(u.rows)}
            </p>
          ))}
          <p className="mt-1 text-foreground/70">
            The total ATO debt and anything worked out from {risk.unreadable.length === 1 ? 'that account' : 'those accounts'} are not
            shown until {risk.unreadable.length === 1 ? 'it is' : 'they are'} uploaded as downloaded from the ATO.
          </p>
        </div>
      )}

      {/* The three numbers that matter most */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          ['Total ATO debt', risk.totalAtoDebt, debtSource, risk.unreadable.length ? 'Not available: dates unreadable' : 'All ATO accounts on file'],
          ['Stays with the director (issued notices)', risk.issued.length ? staysTotal : null, staysSource, risk.issued.length ? 'Not removed by liquidation' : 'No notices on file'],
          ['Reported late or never', potentialUnread ? null : lateTotal, lateSource, potentialUnread ? 'Not available: dates unreadable' : 'Could not be removed by liquidation'],
        ].map(([label, value, source, hint]) => (
          <div key={label as string} className="rounded-lg border border-border bg-surface/40 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/40">{label as string}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              <SourcedAmount value={value as number | null} source={source as AmountSource} />
            </p>
            <p className="text-[11px] text-foreground/40">{hint as string}</p>
          </div>
        ))}
      </div>

      {/* Issued notices */}
      <section className="mb-5" aria-labelledby="risk-issued">
        <h3 id="risk-issued" className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">
          Issued director penalty notices
        </h3>
        {risk.issued.length === 0 ? (
          <p className="text-xs text-foreground/50">
            None on file.{' '}
            <Link href={`${base}/director-penalty-notices`} className="text-accent hover:underline">
              Director penalty notices
            </Link>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/8 text-left text-foreground/50">
                  <th className="py-2 pr-3 font-medium">Director</th>
                  <th className="py-2 pr-3 font-medium">Notices</th>
                  <th className="py-2 pr-3 text-right font-medium">Removed if a liquidator is appointed by the deadline</th>
                  <th className="py-2 text-right font-medium">Stays with the director</th>
                </tr>
              </thead>
              <tbody>
                {risk.issued.map((d) => {
                  const src = (what: string, amount: number): AmountSource => ({
                    from: [`${d.directorName}: ${what}.`, `Current notices: ${d.types.map((t) => DPN_TYPE_LABEL[t]).join(', ')}.`],
                    calculation: `= ${aud(amount)}`,
                    link: { kind: 'href', href: `${base}/director-penalty-notices`, label: 'Open the notices' },
                  })
                  return (
                    <tr key={d.directorName} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3 font-medium text-foreground/80">{d.directorName}</td>
                      <td className="py-2 pr-3 text-foreground/60">
                        {d.types.map((t) => DPN_TYPE_LABEL[t]).join(', ')}
                        {d.deadline && (
                          <span className={`block ${d.daysLeft !== null && d.daysLeft <= 7 ? 'text-destructive' : 'text-foreground/40'}`}>
                            Deadline {formatIsoDate(d.deadline)}
                            {d.daysLeft !== null ? ` · ${describeDaysLeft(d.daysLeft)}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        <SourcedAmount value={d.removable} cents source={src('removed if the company appoints a liquidator, or pays, by the deadline', d.removable)} />
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        <SourcedAmount value={d.stays} cents source={src('stays with the director unless paid', d.stays)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Potential notices */}
      <section className="mb-5" aria-labelledby="risk-potential">
        <h3 id="risk-potential" className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">
          What a notice could still cover
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/8 text-left text-foreground/50">
                <th className="py-2 pr-3 font-medium">Tax</th>
                <th className="py-2 pr-3 text-right font-medium">Reported within 3 months</th>
                <th className="py-2 text-right font-medium">Reported late or never</th>
              </tr>
            </thead>
            <tbody>
              {risk.potential.map((p) => {
                if ((p.unreadableRows ?? 0) > 0) {
                  return (
                    <tr key={p.type} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3 font-medium text-foreground/80">
                        {DPN_TYPE_LABEL[p.type]}
                        <span className="block font-normal text-destructive">Dates unreadable: {unparsedDatesMessage(p.unreadableRows!)}</span>
                      </td>
                      <td className="py-2 pr-3 text-right text-destructive">Not read</td>
                      <td className="py-2 text-right text-destructive">Not read</td>
                    </tr>
                  )
                }
                const onTime = p.items.filter((i) => !i.late)
                const late = p.items.filter((i) => i.late)
                return (
                  <tr key={p.type} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 font-medium text-foreground/80">
                      {DPN_TYPE_LABEL[p.type]}
                      <span className="block font-normal text-foreground/40">
                        {p.items.length ? `${p.items.length} ${p.items.length === 1 ? 'amount' : 'amounts'} reported` : fromFor(p).startsWith('No ') ? fromFor(p) : 'Nothing reported'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      <SourcedAmount
                        value={p.onTime}
                        cents
                        source={itemsSource(`${DPN_TYPE_LABEL[p.type]} reported within 3 months of its due date: a notice for it is removed if a liquidator is appointed (or it is paid) by the notice’s deadline.`, fromFor(p), onTime, p.onTime, hrefFor(p))}
                      />
                    </td>
                    <td className={`py-2 text-right tabular-nums ${p.late > 0 ? 'font-medium text-destructive' : ''}`}>
                      <SourcedAmount
                        value={p.late}
                        cents
                        source={itemsSource(`${DPN_TYPE_LABEL[p.type]} reported more than 3 months after its due date, or never: a notice for it stays with the director unless paid.`, fromFor(p), late, p.late, hrefFor(p))}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-foreground/50">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          These are the amounts reported. A notice can only cover what is still unpaid, which is at most the ATO debt above.
        </p>
      </section>

      {/* Director loan */}
      <section aria-labelledby="risk-loan">
        <h3 id="risk-loan" className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">
          Director loan account
        </h3>
        {risk.loans.length === 0 ? (
          <p className="text-xs text-foreground/50">
            No loan account lines confirmed.{' '}
            <Link href={`${base}/financials-comparison/mapping`} className="text-accent hover:underline">
              Confirm key figures
            </Link>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/8 text-left text-foreground/50">
                  <th className="py-2 pr-3 font-medium">Year</th>
                  <th className="py-2 pr-3 text-right font-medium">Owed to the company by the director</th>
                  <th className="py-2 text-right font-medium">Owed by the company to the director</th>
                </tr>
              </thead>
              <tbody>
                {risk.loans.map((y) => (
                  <tr key={y.label} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 font-medium text-foreground/80">{y.label}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      <SourcedAmount value={y.receivable} cents source={printedLinesSource('Loan account owed to the company.', `${y.label} balance sheet`, y.receivableLines, y.receivable ?? 0)} />
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      <SourcedAmount value={y.payable} cents source={printedLinesSource('Loan account owed by the company.', `${y.label} balance sheet`, y.payableLines, y.payable ?? 0)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-4 border-t border-border pt-3 text-[11px] text-foreground/40">
        Worked out by fixed rules from the files on record. Not advice.
      </p>
    </Card>
  )
}
