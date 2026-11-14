/**
 * The home dashboard's date range, and the time buckets its charts use.
 *
 * Only the lead figures follow the range. SBR and CVL figures are "as of today":
 * a file's state is what it is now, whenever it was opened.
 */

export type RangeKey = 'd30' | 'd90' | 'm6' | 'm12' | 'all'

export interface RangeDef {
  key: RangeKey
  /** On the picker. */
  short: string
  /** In headings: "Last 30 days". */
  label: string
  /** In a sentence: "in the last 30 days". */
  phrase: string
  /** Under a figure that compares: "vs previous 30 days"; null when nothing comes before (all time). */
  comparison: string | null
  /** Null: all time, from the first lead on record. */
  days: number | null
}

export const RANGES: Record<RangeKey, RangeDef> = {
  d30: { key: 'd30', short: '30 days', label: 'Last 30 days', phrase: 'in the last 30 days', comparison: 'vs previous 30 days', days: 30 },
  d90: { key: 'd90', short: '90 days', label: 'Last 90 days', phrase: 'in the last 90 days', comparison: 'vs previous 90 days', days: 90 },
  m6: { key: 'm6', short: '6 months', label: 'Last 6 months', phrase: 'in the last 6 months', comparison: 'vs previous 6 months', days: 182 },
  m12: { key: 'm12', short: '12 months', label: 'Last 12 months', phrase: 'in the last 12 months', comparison: 'vs previous 12 months', days: 365 },
  all: { key: 'all', short: 'All time', label: 'All time', phrase: 'since the first lead', comparison: null, days: null },
}

export const RANGE_KEYS = Object.keys(RANGES) as RangeKey[]

/** A `?range=` value read safely: anything unknown is the last 30 days. */
export function readRange(value: string | string[] | undefined): RangeKey {
  const v = Array.isArray(value) ? value[0] : value
  return v && v in RANGES ? (v as RangeKey) : 'd30'
}

const DAY_MS = 86_400_000

export interface Window {
  start: number
  end: number
}

/**
 * The range ending now, and the same length before it. All time starts at
 * `since` (the first lead; a year back when there is none) and has an empty
 * window before it, so nothing compares.
 */
export function windows(range: RangeKey, now: Date, since?: string | null): { current: Window; previous: Window } {
  const end = now.getTime()
  const days = RANGES[range].days
  if (days === null) {
    const first = since ? new Date(since).getTime() : NaN
    const start = Number.isFinite(first) && first < end ? first : end - 365 * DAY_MS
    return { current: { start, end }, previous: { start, end: start } }
  }
  const span = days * DAY_MS
  return { current: { start: end - span, end }, previous: { start: end - 2 * span, end: end - span } }
}

export function inWindow(iso: string | null | undefined, w: Window): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return t >= w.start && t < w.end
}

export interface Bucket {
  start: number
  end: number
  /** Axis label, Sydney time: "14 Nov". */
  label: string
  /** The days it covers, for a tooltip: "12 – 14 Nov". */
  span: string
}

const dayLabel = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short' })

/** Buckets per range: 10 × 3 days, 13 weeks, 13 fortnights, 12 × ~30 days, 12 for all time. */
const BUCKET_COUNT: Record<RangeKey, number> = { d30: 10, d90: 13, m6: 13, m12: 12, all: 12 }

/**
 * Chart buckets across the current window, oldest first, of equal length, so
 * the chart adds up to the range's own total. Each is labelled by its last
 * day (Sydney).
 */
export function buckets(range: RangeKey, now: Date, since?: string | null): Bucket[] {
  const { current } = windows(range, now, since)
  const count = BUCKET_COUNT[range]
  const len = (current.end - current.start) / count
  // Whole milliseconds, each bucket ending exactly where the next starts, so
  // no moment falls between two of them.
  const edges = Array.from({ length: count + 1 }, (_, i) => Math.round(current.start + i * len))
  return Array.from({ length: count }, (_, i) => {
    // The last bucket includes "now" itself.
    const end = i === count - 1 ? current.end + 1 : edges[i + 1]
    const first = new Date(edges[i])
    const last = new Date(Math.min(end, current.end) - 1)
    const a = dayLabel.format(first)
    const b = dayLabel.format(last)
    return { start: edges[i], end, label: b, span: a === b ? b : `${a} – ${b}` }
  })
}

/** Which bucket a time falls in, or -1. */
export function bucketIndex(list: readonly Bucket[], iso: string): number {
  const t = new Date(iso).getTime()
  return list.findIndex((b) => t >= b.start && t < b.end)
}
