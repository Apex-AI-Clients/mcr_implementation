import type { DpnNoticeFigures } from './noticeFigures'
import type { DpnType } from './types'

/**
 * "By tax type" under the lodgement page's two director penalty cards (Gabby, 18 Nov 2026): the
 * split the cards no longer show, one row per tax type, and a total row equal to the two cards.
 * Pure; the page and the CSV both read it.
 *
 *   notice columns  Unpaid (Column 3), Removed if acted on by the deadline (Column 4), Stays with the
 *                   director unless paid (Column 5), Deadline: from the current notices of that type,
 *                   only when they are proven ("Being prepared" otherwise; "No notice uploaded" for a
 *                   type with none)
 *   last column     lodged more than 90 days late since the balance was last nil, from the verified
 *                   ATO account, each tax type counted on its own
 */

export type NoticeCell = { kind: 'amount'; value: number } | { kind: 'held' } | { kind: 'none' }

export interface TaxTypeRow {
  key: DpnType | 'other' | 'total'
  label: string
  unpaid: NoticeCell
  removable: NoticeCell
  stays: NoticeCell
  /** The earliest deadline among that type's current notices, and whether it has passed. */
  deadline: { iso: string; passed: boolean } | null
  /** Dollars, from the verified ATO account. */
  lateSinceNil: number
}

const TYPES: { type: DpnType; label: string; late: 'paygw' | 'gst' }[] = [
  { type: 'paygw', label: 'PAYG withholding', late: 'paygw' },
  { type: 'gst', label: 'GST', late: 'gst' },
]

export function byTaxType(notices: DpnNoticeFigures | null, late: { total: number; gst: number; paygw: number; other: number }): TaxTypeRow[] {
  const rows: TaxTypeRow[] = TYPES.map(({ type, label, late: lateKey }) => {
    const items = (notices?.items ?? []).filter((n) => n.type === type)
    const t = notices?.byType.find((b) => b.type === type)
    const held = items.some((n) => n.proof.status !== 'verified')
    const cell = (v: number | undefined): NoticeCell => (items.length === 0 || !t ? { kind: 'none' } : held ? { kind: 'held' } : { kind: 'amount', value: v ?? 0 })
    const first = [...items].sort((a, b) => a.deadline.localeCompare(b.deadline))[0]
    return {
      key: type,
      label,
      unpaid: cell(t?.unpaid),
      removable: cell(t?.removable),
      stays: cell(t?.staysWithDirector),
      deadline: first ? { iso: first.deadline, passed: first.daysLeft < 0 } : null,
      lateSinceNil: late[lateKey],
    }
  })
  // Another tax type lodged late (rare): its own row, so the total still equals the card.
  if (late.other) {
    rows.push({ key: 'other', label: 'Other tax types', unpaid: { kind: 'none' }, removable: { kind: 'none' }, stays: { kind: 'none' }, deadline: null, lateSinceNil: late.other })
  }
  const anyNotice = (notices?.items.length ?? 0) > 0
  const totalCell = (v: number | undefined): NoticeCell => (!notices || !anyNotice ? { kind: 'none' } : notices.heldBack ? { kind: 'held' } : { kind: 'amount', value: v ?? 0 })
  rows.push({
    key: 'total',
    label: 'Total',
    unpaid: totalCell(notices?.unpaid),
    removable: totalCell(notices?.removable),
    stays: totalCell(notices?.staysWithDirector),
    deadline: null,
    lateSinceNil: late.total,
  })
  return rows
}

/** A notice cell in words, for the CSV and screen readers. */
export function noticeCellText(c: NoticeCell, money: (n: number) => string): string {
  return c.kind === 'amount' ? money(c.value) : c.kind === 'held' ? 'Being prepared' : 'No notice uploaded'
}
