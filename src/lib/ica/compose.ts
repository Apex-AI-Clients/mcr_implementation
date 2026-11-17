import { lineOf, subLineOf, wordingOf, type LineIdentity, type Section } from './wording'
import type { Reconciliation } from './reconcile'
import { effectOf, type Cents, type IcaFile } from './types'

/**
 * Gabby's composition, every line in the ATO's words, built only from a
 * reconciliation (reconcile.ts): the counted rows are the ones the ATO's own
 * balance proved.
 *
 *   Balance brought forward
 *   + tax lodged: GST, PAYG withholding, each other tax its own line
 *   + general interest charge − remitted
 *   + penalties − remitted
 *   = ATO debt
 *   − payments − government credits − credits transferred in + refunds paid out
 *   ± every other entry, each its own line under its exact ATO description
 *   = the ATO's balance
 *
 * A counted statement row that carries the amount is split into tax lines by
 * its own sub-lines (Doyle: 823 = GST 944 − fuel tax credit 121); if the
 * sub-lines do not add up to it, the rest stays on a line of the statement's
 * own wording. Every row is in exactly one line, or listed as not counted with
 * the reason.
 */

export interface LinePart {
  rowId: number
  debit: Cents
  credit: Cents
  /** Not counted itself: a sub-line used to split the counted statement row above it. */
  splits?: number
}

export interface CompositionLine extends LineIdentity {
  debit: Cents
  credit: Cents
  /** debit − credit: positive adds to what is owed. */
  net: Cents
  parts: LinePart[]
  /** The distinct descriptions on its rows, as printed: what to search the spreadsheet for. */
  descriptions: string[]
}

export interface NotCounted {
  rowId: number
  /** The counted row(s) of its structure, and why this one is not counted. */
  countedIn: number[]
  reason: string
}

export interface Composition {
  opening: Cents
  /** In display order: tax, interest, penalties (the ATO debt), then payments, credits, refunds, other. */
  lines: CompositionLine[]
  atoDebt: Cents
  /** opening + every line: equals the ATO's balance when the file is verified. */
  total: Cents
  atoBalance: Cents | null
  atoBalanceDate: string | null
  notCounted: NotCounted[]
}

const SECTION_ORDER: Section[] = ['tax', 'interest', 'penalties', 'payments', 'credits', 'refunds', 'other']
const NAMED_ORDER = ['gst', 'paygw', 'gic', 'gicRemitted', 'penalties', 'penaltiesRemitted', 'payments', 'governmentCredits', 'creditTransfers', 'refunds']
const DEBT_SECTIONS = new Set<Section>(['tax', 'interest', 'penalties'])

export function compose(file: IcaFile, rec: Reconciliation): Composition {
  const rows = file.rows
  const lines = new Map<string, CompositionLine>()
  const firstSeen = new Map<string, number>()
  const add = (identity: LineIdentity, part: LinePart, description: string) => {
    let line = lines.get(identity.key)
    if (!line) {
      line = { ...identity, debit: 0, credit: 0, net: 0, parts: [], descriptions: [] }
      lines.set(identity.key, line)
      firstSeen.set(identity.key, part.rowId)
    }
    line.debit += part.debit
    line.credit += part.credit
    line.net = line.debit - line.credit
    line.parts.push(part)
    if (!line.descriptions.includes(description)) line.descriptions.push(description)
  }

  const notCounted: NotCounted[] = []
  for (const g of rec.groups) {
    const members = [g.head, ...g.parts]
    const counted = members.filter((id) => rec.counted.has(id))
    for (const id of members) {
      if (rec.counted.has(id)) continue
      notCounted.push({
        rowId: id,
        countedIn: counted,
        reason:
          g.kind === 'statement'
            ? id === g.head
              ? 'The statement row has no amount of its own here; its sub-lines are counted.'
              : 'A sub-line splitting the statement row above it, which is counted.'
            : counted.length === 0
              ? 'Not counted: the reading that matches the ATO balance leaves it out.'
              : id === g.head
                ? 'A total summing the rows printed with it, which are counted.'
                : 'Part of the total printed with it, which is counted.',
      })
    }
    for (const id of counted) {
      const r = rows[id]
      // A counted statement row with sub-lines: split by them; any rest stays on the statement's own line.
      if (g.kind === 'statement' && id === g.head && g.parts.length > 0) {
        let rest = effectOf(r)
        for (const p of g.parts) {
          const sub = rows[p]
          add(subLineOf(r.description, sub.description), { rowId: p, debit: sub.debit, credit: sub.credit, splits: id }, sub.description)
          rest -= effectOf(sub)
        }
        if (rest !== 0) add(lineOf(r.description), { rowId: id, debit: Math.max(rest, 0), credit: Math.max(-rest, 0) }, r.description)
        continue
      }
      // A counted sub-line of a statement: its line depends on who raised the statement.
      const identity = g.kind === 'statement' && id !== g.head ? subLineOf(rows[g.head].description, r.description) : lineOf(r.description)
      add(identity, { rowId: id, debit: r.debit, credit: r.credit }, r.description)
    }
  }

  const ordered = [...lines.values()].sort((a, b) => {
    const s = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section)
    if (s) return s
    const na = NAMED_ORDER.indexOf(a.key)
    const nb = NAMED_ORDER.indexOf(b.key)
    if (na !== -1 || nb !== -1) return (na === -1 ? 99 : na) - (nb === -1 ? 99 : nb)
    return firstSeen.get(a.key)! - firstSeen.get(b.key)!
  })
  for (const l of ordered) l.parts.sort((a, b) => a.rowId - b.rowId)
  const atoDebt = rec.opening + ordered.filter((l) => DEBT_SECTIONS.has(l.section)).reduce((s, l) => s + l.net, 0)
  const total = rec.opening + ordered.reduce((s, l) => s + l.net, 0)
  return {
    opening: rec.opening,
    lines: ordered,
    atoDebt,
    total,
    atoBalance: rec.atoBalance,
    atoBalanceDate: rec.atoBalanceDate,
    notCounted: notCounted.sort((a, b) => a.rowId - b.rowId),
  }
}

/** What to type into the spreadsheet's search box to find a line's rows. */
export function searchHelpers(line: CompositionLine): string[] {
  return line.descriptions.map((d) => wordingOf(d) || d).filter((d, i, all) => all.indexOf(d) === i)
}
