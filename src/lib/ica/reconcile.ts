import { applyPatterns, type LearnedPattern } from './learned'
import { buildGroups, type Group } from './structures'
import { effectOf, type Cents, type IcaFile, type IcaRow } from './types'

/**
 * The ATO's running balance is the answer key.
 *
 * The rows are put in date order (processed date; within a day, the order
 * the ATO printed them in, read from oldest to newest). A "balance day" is a
 * processed date with at least one printed balance. Between two consecutive
 * balance days, the counted movements must equal the change in the ATO's
 * balance, to the cent.
 *
 * On a day with several printed balances, any one of them can be the day's
 * closing balance: the ATO does not always print a day's rows in time order
 * (a payment effective the day before can carry the balance from before that
 * day's interest charge). A day matches when one of its printed balances is
 * the previous closing balance plus the day's movements.
 *
 * When a day does not match:
 *   1. the other readings of its structures (structures.ts) are tried, the
 *      fewest changes first; a reading is used only if it is the only one
 *      that matches (two different readings that both match are not chosen
 *      between: the balance cannot tell them apart);
 *   2. patterns learned from verified Claude proposals (learned.ts);
 *   3. the window is widened over the next balance days, up to WINDOW_LIMIT_DAYS
 *      between its first and last balance day, trying 1–2 each time.
 * A window that still does not match is reported with its rows, in the ATO's
 * words; propose.ts may then ask Claude for a reading, which is used only if
 * it matches to the cent.
 *
 * Finally the whole file must reconcile: the balance brought forward plus
 * every counted movement must equal the ATO's balance on its newest row.
 */

export const WINDOW_LIMIT_DAYS = 7
/** Most readings changed at once in one window, and the most states the search keeps. */
const MAX_CHANGES = 4
const MAX_STATES = 200_000

export type WindowMethod = 'day' | 'reading' | 'learned' | 'claude' | 'widened'

export interface MatchedWindow {
  /** The balance day the window starts after (its closing balance is `from`). */
  after: string | null
  /** The balance days the window covers, oldest first. */
  days: string[]
  method: WindowMethod
  from: Cents
  to: Cents
  movement: Cents
  /** Structures read other than by the rule's reading here, with the reading used. */
  readingsChanged: { group: number; reading: string }[]
}

export interface UnmatchedWindow {
  after: string | null
  days: string[]
  /** The printed closing balance(s) the window could start from, and could end on. */
  fromCandidates: Cents[]
  toCandidates: Cents[]
  /** What the counted rows add up to, and the ATO's change that was needed (from the first candidates). */
  movement: Cents
  needed: Cents
  /** Every row in the window, in the ATO's printed order. */
  rowIds: number[]
  reason: 'no_reading_matches' | 'readings_ambiguous' | 'too_many_rows_to_search'
}

export interface Reconciliation {
  /** Which reading each structure is counted by (index into its readings). */
  chosen: number[]
  /** Rows counted or skipped by a learned pattern or an accepted Claude proposal, overriding their structure's reading. */
  forced: Map<number, boolean>
  counted: Set<number>
  groups: Group[]
  /** Group id of every row. */
  groupOfRow: number[]
  balanceDays: number
  matched: MatchedWindow[]
  unmatched: UnmatchedWindow[]
  opening: Cents
  /** The ATO's balance: the closing balance of its newest balance day, as the reconciliation proved it, and that day. */
  atoBalance: Cents | null
  atoBalanceDate: string | null
  /** Balance brought forward + every counted movement. */
  composed: Cents
  /** Rows after the newest printed balance: they move nothing the ATO has printed. */
  trailingRowIds: number[]
  /** Rows whose processed or effective date could not be read. */
  unreadDateRows: number
  /** True only when every window matched and the whole file reconciles to the ATO's balance. */
  verified: boolean
}

export interface ReconcileOptions {
  patterns?: readonly LearnedPattern[]
  /** Accepted Claude readings: rows forced counted (true) or not (false). */
  forced?: ReadonlyMap<number, boolean>
  /** The window limit in days (WINDOW_LIMIT_DAYS unless given). */
  limitDays?: number
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** Row ids in date order: processed date, then the printed order read oldest to newest. */
export function chronologicalIds(file: IcaFile): number[] {
  const ids = file.rows.map((r) => r.id)
  const base = file.printOrder === 'newest_first' ? [...ids].reverse() : ids
  let last = ''
  const keyed = base.map((id, i) => {
    last = file.rows[id].processed ?? last
    return { id, day: last, i }
  })
  return keyed.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.i - b.i)).map((k) => k.id)
}

/** The ATO's balance as the export states it: the newest row that prints one. */
export function atoBalanceOf(file: IcaFile): { balance: Cents | null; date: string | null } {
  const order = file.printOrder === 'newest_first' ? file.rows : [...file.rows].reverse()
  const row = order.find((r) => r.balance !== null)
  return { balance: row?.balance ?? null, date: row?.processed ?? null }
}

export function reconcile(file: IcaFile, options: ReconcileOptions = {}): Reconciliation {
  const rows = file.rows
  const limitDays = options.limitDays ?? WINDOW_LIMIT_DAYS
  const groups = buildGroups(rows)
  const groupOfRow: number[] = new Array(rows.length)
  for (const g of groups) for (const r of [g.head, ...g.parts]) groupOfRow[r] = g.id
  const chosen = groups.map(() => 0)
  const forced = new Map(options.forced ?? [])
  const patterns = options.patterns ?? []

  const isCounted = (id: number): boolean => {
    const f = forced.get(id)
    if (f !== undefined) return f
    const g = groups[groupOfRow[id]]
    return g.readings[chosen[g.id]].counted.includes(id)
  }
  const groupEffect = (g: Group, reading: number) =>
    [g.head, ...g.parts].reduce((s, id) => {
      const f = forced.get(id)
      const counts = f !== undefined ? f : g.readings[reading].counted.includes(id)
      return counts ? s + effectOf(rows[id]) : s
    }, 0)

  const unreadDateRows = rows.filter((r) => !r.processed || !r.effective).length

  // Intervals: the rows up to and including each balance day.
  const chron = chronologicalIds(file)
  const balanceDays: string[] = []
  const closings: Cents[][] = []
  const intervals: number[][] = []
  let current: number[] = []
  let currentDay = ''
  const flushDay = () => {
    if (!currentDay) return
    const printed = current.filter((id) => rows[id].processed === currentDay && rows[id].balance !== null)
    if (printed.length) {
      balanceDays.push(currentDay)
      closings.push([...new Set(printed.map((id) => rows[id].balance!))])
      intervals.push(current)
      current = []
    }
  }
  for (const id of chron) {
    const day = rows[id].processed ?? currentDay
    if (day !== currentDay) {
      flushDay()
      currentDay = day
    }
    current.push(id)
  }
  flushDay()
  const trailingRowIds = current

  const matched: MatchedWindow[] = []
  const unmatched: UnmatchedWindow[] = []
  const net = (ids: number[]) => ids.reduce((s, id) => (isCounted(id) ? s + effectOf(rows[id]) : s), 0)

  // The closing of the first balance day is not checked (nothing before it); it is settled by the first match.
  let prev: Cents[] = closings[0] ?? []
  let firstFrom: Cents | null = null
  const settleFirst = (from: Cents) => {
    if (firstFrom === null) firstFrom = from
  }

  let k = 1
  while (k < balanceDays.length) {
    const start = k
    let accepted = false
    let end = start
    for (; end < balanceDays.length; end++) {
      if (end > start && daysBetween(balanceDays[start], balanceDays[end]) > limitDays) break
      const ids = intervals.slice(start, end + 1).flat()
      const movement = net(ids)
      const pairs = (m: Cents) => prev.flatMap((p) => closings[end].filter((c) => c - p === m).map((c) => ({ p, c })))
      const record = (method: WindowMethod, hits: { p: Cents; c: Cents }[], changed: { group: number; reading: string }[]) => {
        settleFirst(hits[0].p)
        matched.push({
          after: balanceDays[start - 1] ?? null,
          days: balanceDays.slice(start, end + 1),
          method,
          from: hits[0].p,
          to: hits[0].c,
          movement: hits[0].c - hits[0].p,
          readingsChanged: changed,
        })
        prev = [...new Set(hits.map((h) => h.c))]
      }

      let hits = pairs(movement)
      if (hits.length) {
        record(end === start ? 'day' : 'widened', hits, [])
        accepted = true
        break
      }

      // 1. Other readings of the structures in the window.
      const windowGroups = [...new Set(ids.map((id) => groupOfRow[id]))].map((g) => groups[g]).filter((g) => g.readings.length > 1)
      const needed = new Set(prev.flatMap((p) => closings[end].map((c) => c - p - movement)))
      const found = searchReadings(windowGroups, chosen, groupEffect, needed)
      if (found.kind === 'one') {
        for (const [g, r] of found.changes) chosen[g] = r
        hits = pairs(net(ids))
        if (hits.length) {
          record('reading', hits, found.changes.map(([g, r]) => ({ group: g, reading: groups[g].readings[r].name })))
          accepted = true
          break
        }
        for (const [g] of found.changes) chosen[g] = 0
      }

      // 2. Learned patterns, tested here only.
      if (patterns.length) {
        const learned = applyPatterns(ids.map((id) => rows[id]), patterns)
        const before = new Map([...learned.keys()].map((id) => [id, forced.get(id)]))
        for (const [id, v] of learned) if (!forced.has(id)) forced.set(id, v)
        hits = pairs(net(ids))
        if (hits.length && learned.size) {
          record('learned', hits, [])
          accepted = true
          break
        }
        for (const [id, v] of before) {
          if (v === undefined) forced.delete(id)
          else forced.set(id, v)
        }
      }
    }

    if (accepted) {
      k = end + 1
      continue
    }
    // 3. Not matched within the window limit: reported, and the next window starts from the ATO's own closing.
    const last = Math.max(start, end - 1)
    const ids = intervals.slice(start, last + 1).flat()
    const movement = net(ids)
    const windowGroups = [...new Set(ids.map((id) => groupOfRow[id]))].map((g) => groups[g]).filter((g) => g.readings.length > 1)
    const needed = new Set(prev.flatMap((p) => closings[last].map((c) => c - p - movement)))
    const search = searchReadings(windowGroups, chosen, groupEffect, needed)
    unmatched.push({
      after: balanceDays[start - 1] ?? null,
      days: balanceDays.slice(start, last + 1),
      fromCandidates: prev,
      toCandidates: closings[last],
      movement,
      needed: (closings[last][0] ?? 0) - (prev[0] ?? 0),
      rowIds: [...ids].sort((a, b) => a - b),
      reason: search.kind === 'ambiguous' ? 'readings_ambiguous' : search.kind === 'too_many' ? 'too_many_rows_to_search' : 'no_reading_matches',
    })
    if (firstFrom === null && prev.length) firstFrom = prev[0]
    prev = closings[last]
    k = last + 1
  }

  const counted = new Set(rows.filter((r) => isCounted(r.id)).map((r) => r.id))
  const firstIds = intervals[0] ?? []
  const firstNet = firstIds.reduce((s, id) => (counted.has(id) ? s + effectOf(rows[id]) : s), 0)
  const firstClose = firstFrom ?? closings[0]?.[0] ?? 0
  const opening = balanceDays.length ? firstClose - firstNet : 0
  const composed = opening + rows.reduce((s, r) => (counted.has(r.id) ? s + effectOf(r) : s), 0)
  // The ATO's balance: the closing the verified chain ends on (one of the balances printed on the newest
  // balance day). Within a day the ATO does not always print the closing on the newest row, so the newest
  // printed row's balance is used only to choose between closings the chain cannot tell apart.
  const printed = atoBalanceOf(file)
  const lastDay = balanceDays[balanceDays.length - 1] ?? null
  const ato = {
    balance: prev.length === 1 ? prev[0] : printed.balance !== null && prev.includes(printed.balance) ? printed.balance : (printed.balance ?? null),
    date: lastDay ?? printed.date,
  }
  const trailingMoves = trailingRowIds.some((id) => counted.has(id) && effectOf(rows[id]) !== 0)

  return {
    chosen,
    forced,
    counted,
    groups,
    groupOfRow,
    balanceDays: balanceDays.length,
    matched,
    unmatched,
    opening,
    atoBalance: ato.balance,
    atoBalanceDate: ato.date,
    composed,
    trailingRowIds,
    unreadDateRows,
    verified:
      unreadDateRows === 0 && unmatched.length === 0 && !trailingMoves && ato.balance !== null && composed === ato.balance,
  }
}

type SearchResult = { kind: 'one'; changes: [number, number][] } | { kind: 'none' } | { kind: 'ambiguous' } | { kind: 'too_many' }

/**
 * The fewest structure readings to change so the window's movement shifts by
 * one of `needed`. Only a single answer is used: if two different sets of
 * changes (of the same, smallest size) both match, the balance cannot tell
 * them apart and neither is chosen.
 */
function searchReadings(
  groups: Group[],
  chosen: number[],
  groupEffect: (g: Group, reading: number) => Cents,
  needed: Set<Cents>,
): SearchResult {
  if (needed.size === 0) return { kind: 'none' }
  const options = groups
    .map((g) => {
      const base = groupEffect(g, chosen[g.id])
      return {
        g: g.id,
        alts: g.readings.map((_, r) => ({ r, delta: groupEffect(g, r) - base })).filter((a) => a.r !== chosen[g.id] && a.delta !== 0),
      }
    })
    .filter((o) => o.alts.length > 0)

  // states: shift → the changes reaching it with the fewest changes, and whether another set reaches it too.
  let states = new Map<Cents, { changes: [number, number][]; ambiguous: boolean }>([[0, { changes: [], ambiguous: false }]])
  for (const o of options) {
    const next = new Map(states)
    for (const [shift, s] of states) {
      if (s.changes.length >= MAX_CHANGES) continue
      for (const a of o.alts) {
        const key = shift + a.delta
        const changes: [number, number][] = [...s.changes, [o.g, a.r]]
        const seen = next.get(key)
        if (!seen || seen.changes.length > changes.length) next.set(key, { changes, ambiguous: s.ambiguous })
        else if (seen.changes.length === changes.length) seen.ambiguous = true
      }
    }
    states = next
    if (states.size > MAX_STATES) return { kind: 'too_many' }
  }
  const hits = [...needed].map((n) => states.get(n)).filter((s): s is NonNullable<typeof s> => !!s && s.changes.length > 0)
  if (hits.length === 0) return { kind: 'none' }
  const fewest = Math.min(...hits.map((h) => h.changes.length))
  const best = hits.filter((h) => h.changes.length === fewest)
  if (best.length > 1 || best[0].ambiguous) return { kind: 'ambiguous' }
  return { kind: 'one', changes: best[0].changes }
}

export const rowsOf = (file: IcaFile, ids: readonly number[]): IcaRow[] => ids.map((id) => file.rows[id])
