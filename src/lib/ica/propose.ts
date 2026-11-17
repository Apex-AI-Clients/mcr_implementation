import { ICA_WINDOW_PROMPT } from '@/lib/ai/prompts'
import { applyPatterns, printedOf, wordingKey, type LearnedPattern } from './learned'
import { reconcile, type Reconciliation, type UnmatchedWindow } from './reconcile'
import { audBalance, aud, type IcaFile } from './types'

/**
 * Claude's proposals for windows no known rule matches (approved verbally by
 * Gabby, 16 Nov 2026; CLAUDE.md rule 12). For each unmatched window:
 *
 *   1. ONLY that window's rows go to Claude, anonymised: processed and
 *      effective dates, description, debit, credit, balance. No client name,
 *      ABN, TFN, account label or file name; any long run of digits in a
 *      description is masked. Through the existing OpenRouter client
 *      (Anthropic only, no training, no logging).
 *   2. Claude answers which rows count (JSON).
 *   3. The answer is tested against the ATO's running balance: the whole file
 *      is reconciled again with it, and it is accepted ONLY if that window
 *      then matches to the cent (within the 7-day window limit, so a wide
 *      window must verify in narrower ones) and no other window stops
 *      matching. Otherwise it is rejected and the window stays unverified.
 *   4. From an accepted answer, patterns are learned (learned.ts): wording
 *      only, never amounts or dates.
 */

/** A window larger than this is not sent. */
export const MAX_PROPOSAL_ROWS = 400

export type Ask = (prompt: string) => Promise<{ text: string; model: string; generationId: string }>

export interface Proposal {
  count: number[]
  skip: number[]
  explanation: string
}

export interface ProposalOutcome {
  window: UnmatchedWindow
  status: 'accepted' | 'rejected' | 'not_sent' | 'failed'
  /** Why, in plain words. */
  note: string
  explanation?: string
  model?: string
  generationId?: string
  patterns?: LearnedPattern[]
}

/** Long digit strings (an ABN, TFN, reference number) masked; dates and wording kept. */
export function maskDescription(description: string): string {
  // A run of digits, spaces and hyphens holding 8 or more digits ("91 656 014 002", "123-456-789").
  return description.replace(/\d[\d \-]*\d/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '#' : m))
}

/** The prompt for one window, and the window-local ids it uses (1…n, in the ATO's printed order). */
export function windowPrompt(file: IcaFile, window: UnmatchedWindow): { prompt: string; ids: number[] } {
  const ids = [...window.rowIds].sort((a, b) => a - b)
  const money = (c: number) => (c ? aud(c) : '')
  const lines = ids.map((id, i) => {
    const r = file.rows[id]
    return [i + 1, r.processed ?? '', r.effective ?? '', JSON.stringify(maskDescription(r.description)), money(r.debit), money(r.credit), r.balance === null ? '' : audBalance(r.balance)].join(' | ')
  })
  const list = (cs: number[]) => cs.map(audBalance).join(' or ')
  const needed = [...new Set(window.fromCandidates.flatMap((f) => window.toCandidates.map((t) => t - f)))]
  const prompt = ICA_WINDOW_PROMPT.replace('{before}', list(window.fromCandidates))
    .replace('{after}', list(window.toCandidates))
    .replace('{needed}', needed.map((n) => `${n < 0 ? 'minus ' : 'plus '}${aud(Math.abs(n))}`).join(' or '))
    .replace('{rows}', lines.join('\n'))
  return { prompt, ids }
}

/** Claude's answer, read strictly: every window row in exactly one list. Null when it is not that. */
export function parseProposal(text: string, size: number): Proposal | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  const o = raw as { count?: unknown; skip?: unknown; explanation?: unknown }
  const ints = (v: unknown) => (Array.isArray(v) && v.every((x) => Number.isInteger(x) && x >= 1 && x <= size) ? (v as number[]) : null)
  const count = ints(o.count)
  const skip = ints(o.skip)
  if (!count || !skip) return null
  const all = new Set([...count, ...skip])
  if (all.size !== size || count.length + skip.length !== size) return null
  return { count, skip, explanation: typeof o.explanation === 'string' ? o.explanation.slice(0, 2000) : '' }
}

const windowKey = (w: { days: string[] }) => w.days.join(',')
const overlaps = (a: { days: string[] }, b: { days: string[] }) => a.days.some((d) => b.days.includes(d))

/**
 * Tests a proposal against the ATO's balance. Accepted only if, with it, the
 * window matches and every window that matched still does.
 */
export function testProposal(
  file: IcaFile,
  before: Reconciliation,
  window: UnmatchedWindow,
  ids: number[],
  proposal: Proposal,
  options: { patterns?: readonly LearnedPattern[]; forced?: ReadonlyMap<number, boolean> } = {},
): { accepted: boolean; after: Reconciliation; forced: Map<number, boolean>; patterns: LearnedPattern[] } {
  const forced = new Map(options.forced ?? [])
  for (const n of proposal.count) forced.set(ids[n - 1], true)
  for (const n of proposal.skip) forced.set(ids[n - 1], false)
  const after = reconcile(file, { patterns: options.patterns, forced })
  const stillUnmatched = after.unmatched.some((u) => overlaps(u, window))
  const oldKeys = new Set(before.unmatched.map(windowKey))
  const newProblem = after.unmatched.some((u) => !oldKeys.has(windowKey(u)) && !overlaps(u, window))
  const accepted = !stillUnmatched && !newProblem && after.unmatched.length < before.unmatched.length
  if (accepted) for (const m of after.matched) if (overlaps(m, window)) m.method = 'claude'

  // Patterns: the rows whose reading Claude changed, by wording; a wording decided both ways is not learned.
  const decided = new Map<string, LearnedPattern | null>()
  if (accepted) {
    for (const id of ids) {
      const row = file.rows[id]
      const counts = forced.get(id)!
      if (counts === before.counted.has(id)) continue
      const key = `${printedOf(row)}|${wordingKey(row.description)}`
      const seen = decided.get(key)
      if (seen === undefined) decided.set(key, { wording: wordingKey(row.description), printed: printedOf(row), count: counts, explanation: proposal.explanation })
      else if (seen && seen.count !== counts) decided.set(key, null)
    }
    // A wording learned one way must not contradict another row of the same wording in the window.
    for (const [key, p] of decided) {
      if (!p) continue
      const conflict = ids.some((id) => `${printedOf(file.rows[id])}|${wordingKey(file.rows[id].description)}` === key && forced.get(id) !== p.count)
      if (conflict) decided.set(key, null)
    }
  }
  return { accepted, after, forced, patterns: [...decided.values()].filter((p): p is LearnedPattern => !!p) }
}

/**
 * Asks Claude about every unmatched window, one at a time, keeping each
 * accepted answer for the next. Never throws: a failure leaves the window unverified.
 */
export async function proposeForUnmatched(
  file: IcaFile,
  ask: Ask,
  options: { patterns?: readonly LearnedPattern[]; forced?: ReadonlyMap<number, boolean> } = {},
): Promise<{ reconciliation: Reconciliation; forced: Map<number, boolean>; outcomes: ProposalOutcome[]; learned: LearnedPattern[] }> {
  let forced = new Map(options.forced ?? [])
  let current = reconcile(file, { patterns: options.patterns, forced })
  const outcomes: ProposalOutcome[] = []
  const learned: LearnedPattern[] = []
  const tried = new Set<string>()

  for (;;) {
    const window = current.unmatched.find((u) => !tried.has(windowKey(u)))
    if (!window) break
    tried.add(windowKey(window))
    if (window.rowIds.length > MAX_PROPOSAL_ROWS) {
      outcomes.push({ window, status: 'not_sent', note: `${window.rowIds.length} rows: more than ${MAX_PROPOSAL_ROWS}, so not sent.` })
      continue
    }
    const { prompt, ids } = windowPrompt(file, window)
    let answer: Awaited<ReturnType<Ask>>
    try {
      answer = await ask(prompt)
    } catch (e) {
      outcomes.push({ window, status: 'failed', note: `Claude could not be asked: ${e instanceof Error ? e.message : String(e)}` })
      continue
    }
    const proposal = parseProposal(answer.text, ids.length)
    if (!proposal) {
      outcomes.push({ window, status: 'rejected', note: 'The answer was not a complete list of the rows.', model: answer.model, generationId: answer.generationId })
      continue
    }
    const test = testProposal(file, current, window, ids, proposal, { patterns: options.patterns, forced })
    if (!test.accepted) {
      outcomes.push({
        window,
        status: 'rejected',
        note: "With Claude's reading the ATO's balance still does not match, so it was not used.",
        explanation: proposal.explanation,
        model: answer.model,
        generationId: answer.generationId,
      })
      continue
    }
    forced = test.forced
    current = test.after
    learned.push(...test.patterns)
    outcomes.push({
      window,
      status: 'accepted',
      note: "Claude's reading matches the ATO's balance to the cent.",
      explanation: proposal.explanation,
      model: answer.model,
      generationId: answer.generationId,
      patterns: test.patterns,
    })
  }
  return { reconciliation: current, forced, outcomes, learned }
}

/** Learned patterns that decide some row of the file: for reporting which were used. */
export const patternsUsed = (file: IcaFile, patterns: readonly LearnedPattern[]) => applyPatterns(file.rows, patterns).size
