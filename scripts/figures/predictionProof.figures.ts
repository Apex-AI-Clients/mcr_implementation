import { it, vi } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { out } from './figures'

/**
 * `npm run figures:proof` — READ-ONLY proof that a change leaves every
 * client's lodgement analysis and SBR prediction exactly as it was.
 *
 * For every client in the database: the lodgement analysis re-run in memory
 * from its activity statement CSV, and the predict route called with the
 * inputs saved with the client's last prediction (or the defaults). Every
 * write the code attempts — insert, upsert, update, delete, rpc, storage
 * upload or remove — is blocked and counted; nothing reaches the database.
 *
 * PROOF_LABEL=before|after names the run: the result is written to
 * verified-figures/proof-<label>.json (gitignored). With PROOF_COMPARE=<label>
 * the run is compared with that earlier file, client by client. Prints
 * aliases (c01, c02, … by client id order), statuses, counts and hashes only.
 *
 * PROOF_SCOPE=originals_only|originals_and_amendments runs as if
 * LATE_LODGEMENT_SCOPE were set to it (analysis/config.ts), to see what a
 * switch would change before it is made.
 *
 * PROOF_RERUN=yes reads each stored lodgement analysis whose rows were saved
 * without dates (an export re-saved in Excel, before the date fix) as a
 * re-run would store it: today's code over its raw cells. In memory only.
 *
 * Run with TZ=UTC, as the server: stored dates are ISO strings.
 */

const blocked = { count: 0 }
let readOnlyClient: SupabaseClient | null = null
/** On the second call per client, the readiness gate is opened so the prediction itself is computed. */
const gate = { open: false }

vi.mock('@/lib/sbr/loadReadiness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sbr/loadReadiness')>()
  return {
    ...actual,
    loadReadiness: async (...args: Parameters<typeof actual.loadReadiness>) => {
      const readiness = await actual.loadReadiness(...args)
      return gate.open ? { ...readiness, canPredict: true, waitingFor: [] } : readiness
    },
  }
})

// As if LATE_LODGEMENT_SCOPE were PROOF_SCOPE: the constant, and every default that reads it.
vi.mock('@/lib/analysis/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analysis/config')>()
  const scope = process.env.PROOF_SCOPE?.trim()
  if (!scope) return actual
  if (scope !== 'originals_only' && scope !== 'originals_and_amendments') throw new Error(`PROOF_SCOPE ${scope} is not a setting`)
  type Scope = typeof actual.LATE_LODGEMENT_SCOPE
  const s = scope as Scope
  return {
    ...actual,
    LATE_LODGEMENT_SCOPE: s,
    isCountedLodgement: (row: Parameters<typeof actual.isCountedLodgement>[0], sc: Scope = s) => actual.isCountedLodgement(row, sc),
    countsAsLate: (row: Parameters<typeof actual.countsAsLate>[0], sc: Scope = s) => actual.countsAsLate(row, sc),
    lateLodgementSummary: (rows: Parameters<typeof actual.lateLodgementSummary>[0], sc: Scope = s) => actual.lateLodgementSummary(rows, sc),
    storedLateLodgements: (rows: unknown, stored: Parameters<typeof actual.storedLateLodgements>[1], sc: Scope = s) =>
      actual.storedLateLodgements(rows, stored, sc),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: () => readOnlyClient,
  getSupabaseAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'proof', app_metadata: {} } }, error: null }) },
  }),
}))

/** A chain that swallows any further calls and resolves to "nothing happened". */
function inert(): unknown {
  const result = { data: null, error: null, count: null }
  const fn = () => proxy
  const proxy: unknown = new Proxy(fn, {
    get: (_t, p) => (p === 'then' ? (resolve: (v: unknown) => void) => resolve(result) : () => proxy),
    apply: () => proxy,
  })
  return proxy
}

/** Set once the database is known: lodgement_analyses.unparsed_date_rows (migration 0048) is not there yet. */
const lodgementColumns = { missing0048: false }

/** PROOF_RERUN: an analysis saved without dates, as a re-run with today's code would store it. */
let rerun: ((record: Record<string, unknown>) => void) | null = null

/**
 * lodgement_analyses as the code under test expects it: without migration
 * 0048 the column is left out of the query and reads as its default, 0 (the
 * state just after the migration); with PROOF_RERUN, rows saved without dates
 * are re-analysed.
 */
function lodgementTable<T extends object>(builder: T): T {
  const patch = (result: { data?: unknown }) => {
    const records = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : []
    for (const r of records as Record<string, unknown>[]) {
      if (lodgementColumns.missing0048 && !('unparsed_date_rows' in r)) r.unparsed_date_rows = 0
      rerun?.(r)
    }
    return result
  }
  const wrap = (b: object): object =>
    new Proxy(b, {
      get(t, p) {
        const value = Reflect.get(t, p)
        if (p === 'then' && typeof value === 'function') {
          return (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
            (value as (a: unknown, b?: unknown) => Promise<unknown>).call(t, (r: { data?: unknown }) => ok(patch(r)), fail)
        }
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          if (p === 'select' && lodgementColumns.missing0048 && typeof args[0] === 'string') {
            args[0] = args[0].split(',').map((c) => c.trim()).filter((c) => c !== 'unparsed_date_rows').join(', ')
          }
          const out = (value as (...a: unknown[]) => unknown).apply(t, args)
          return out && typeof out === 'object' ? wrap(out) : out
        }
      },
    })
  return wrap(builder) as T
}

const WRITES = new Set(['insert', 'upsert', 'update', 'delete'])
const STORAGE_WRITES = new Set(['upload', 'update', 'remove', 'move', 'copy', 'createSignedUploadUrl', 'uploadToSignedUrl'])

function bind<T extends object>(target: T, block: Set<string>): T {
  return new Proxy(target, {
    get(t, p) {
      if (typeof p === 'string' && block.has(p)) {
        return () => {
          blocked.count += 1
          return inert()
        }
      }
      const value = Reflect.get(t, p)
      return typeof value === 'function' ? value.bind(t) : value
    },
  })
}

function readOnly(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(t, p) {
      if (p === 'from') {
        return (table: string) => (table === 'lodgement_analyses' ? lodgementTable(bind(t.from(table), WRITES)) : bind(t.from(table), WRITES))
      }
      if (p === 'rpc') {
        return () => {
          blocked.count += 1
          return inert()
        }
      }
      if (p === 'storage') return { from: (bucket: string) => bind(t.storage.from(bucket), STORAGE_WRITES) }
      const value = Reflect.get(t, p)
      return typeof value === 'function' ? value.bind(t) : value
    },
  })
}

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16)

interface ClientProof {
  lodgement: { status: string; hash?: string; late?: number; daysLate?: number; balance?: number | null }
  prediction: PredictionProof
  /** The same call with the readiness gate opened: the prediction maths for every client. */
  predictionUngated: PredictionProof
}

interface PredictionProof {
  status: number
  hash: string
  percent?: number
  low?: number
  high?: number
  cases?: number
  creditorAmount?: number | null
  error?: string
}

it('re-runs every client lodgement analysis and prediction, read-only', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  const label = process.env.PROOF_LABEL?.trim()
  if (!label) throw new Error('Set PROOF_LABEL (e.g. before / after)')
  const raw = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  lodgementColumns.missing0048 = Boolean((await raw.from('lodgement_analyses').select('unparsed_date_rows').limit(1)).error)
  readOnlyClient = readOnly(raw)
  const supabase = readOnlyClient
  const scopeNote = process.env.PROOF_SCOPE?.trim() || 'the setting in config.ts'
  out(`late-lodgement scope: ${scopeNote}; migration 0048 ${lodgementColumns.missing0048 ? 'not applied (column read as 0)' : 'applied'}; time zone offset ${new Date(2026, 0, 1).getTimezoneOffset()} min`)

  // Imported after the mock is in place, from whichever source tree `@` points at.
  const { findActivityStatementCsv } = await import('@/lib/analysis/lodgementStore')
  const { parseActivityStatementCsv } = await import('@/lib/analysis/parseActivityStatement')
  const { computeLateLodgement } = await import('@/lib/analysis/computeLateLodgement')
  const { POST } = await import('@/app/api/admin/clients/[id]/predict-outcome/route')

  if (process.env.PROOF_RERUN === 'yes') {
    const { reanalyseStoredRows } = await import('@/lib/analysis/computeLateLodgement')
    const { unparsedDateRows } = await import('@/lib/analysis/config')
    rerun = (r) => {
      if (!Array.isArray(r.rows) || unparsedDateRows(r.rows) === 0) return
      const fresh = reanalyseStoredRows(r.rows)
      if (!fresh) return
      // As stored: JSON, dates as ISO strings.
      r.rows = JSON.parse(JSON.stringify(fresh.rows))
      if ('number_of_late_lodgements' in r) r.number_of_late_lodgements = fresh.summary.numberOfLateLodgements
      if ('cumulative_days_late' in r) r.cumulative_days_late = fresh.summary.cumulativeDaysLate
      if ('unparsed_date_rows' in r) r.unparsed_date_rows = fresh.unparsedDateRows
    }
    out(`PROOF_RERUN: analyses saved without dates are read as re-run (in memory)`)
  }

  // Which source tree `@` resolved to: the ATO account module exists only after the change.
  const tree = await import('@/lib/analysis/atoAccountKind').then(() => 'with ATO accounts', () => 'without ATO accounts')

  const { data: clients, error } = await supabase.from('clients').select('id').order('id')
  if (error) throw new Error(`Reading clients failed: ${error.code}`)
  const results: Record<string, ClientProof> = {}

  for (const [i, { id }] of (clients ?? []).entries()) {
    const alias = `c${String(i + 1).padStart(2, '0')}`

    // The lodgement analysis, as the upload run makes it: the newest activity statement CSV.
    let lodgement: ClientProof['lodgement']
    const file = await findActivityStatementCsv(supabase as never, id)
    if (!file) lodgement = { status: 'no activity statement' }
    else {
      try {
        const r = computeLateLodgement(parseActivityStatementCsv(file.text))
        lodgement = {
          status: 'analysed',
          hash: hash(r),
          late: r.summary.numberOfLateLodgements,
          daysLate: r.summary.cumulativeDaysLate,
          balance: r.debtBreakdown.currentBalance,
        }
      } catch (err) {
        lodgement = { status: `failed: ${err instanceof Error ? err.message : 'unknown'}` }
      }
    }

    // The prediction, with the inputs saved last time (or the page's defaults).
    const { data: saved } = await supabase
      .from('sbr_outcome_predictions')
      .select('input_features, practitioner_fee_rate, creditors')
      .eq('client_id', id)
      .maybeSingle()
    const f = (saved?.input_features ?? {}) as Record<string, unknown>
    const c = (saved?.creditors ?? null) as { atoDebt?: number | null; atoDebtEdited?: boolean; rows?: unknown[] } | null
    const body = {
      paymentPlanType: f.paymentPlanType === 'plan' ? 'plan' : 'upfront',
      directorLoanAtAppointment: f.directorLoanAtAppointment === true,
      ...(typeof f.dpn === 'boolean' ? { dpn: f.dpn } : {}),
      ...(saved?.practitioner_fee_rate != null ? { practitionerFeeRate: Number(saved.practitioner_fee_rate) } : {}),
      ...(c?.atoDebtEdited && typeof c.atoDebt === 'number' ? { creditorAmount: c.atoDebt } : {}),
      creditors: Array.isArray(c?.rows) ? c.rows : [],
    }
    const predict = async (open: boolean, flipLoan = false): Promise<PredictionProof> => {
      gate.open = open
      const sent = flipLoan ? { ...body, directorLoanAtAppointment: !body.directorLoanAtAppointment } : body
      const res = await POST(new NextRequest(`http://localhost/api/admin/clients/${id}/predict-outcome`, { method: 'POST', body: JSON.stringify(sent) }), {
        params: Promise.resolve({ id }),
      })
      gate.open = false
      const json = (await res.json()) as Record<string, unknown>
      // The time it ran is the only thing expected to differ.
      delete json.computedAt
      const p: PredictionProof = { status: res.status, hash: hash(json) }
      if (res.status === 200) {
        p.percent = json.predictedOutcomePercent as number
        p.low = json.predictedLowPercent as number
        p.high = json.predictedHighPercent as number
        p.cases = (json.comparableCases as unknown[]).length
        p.creditorAmount = json.creditorAmount as number | null
      } else {
        p.error = String(json.code ?? json.error ?? '')
      }
      return p
    }
    let ungated = await predict(true)
    // A saved director loan flag the amount now contradicts is refused (inputPrecedence.ts):
    // the flag that matches the amount, as the page now starts from, so the maths still runs.
    if (ungated.error === 'DIRECTOR_LOAN_MISMATCH') ungated = { ...(await predict(true, true)), error: 'loan flag flipped to match the amount' }
    results[alias] = { lodgement, prediction: await predict(false), predictionUngated: ungated }
  }

  const file = path.join('verified-figures', `proof-${label}.json`)
  writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), results }, null, 2) + '\n')
  const values = Object.values(results)
  const statuses = values.reduce<Record<string, number>>((m, v) => {
    const k = v.prediction.status === 200 ? '200' : `${v.prediction.status} ${v.prediction.error}`
    m[k] = (m[k] ?? 0) + 1
    return m
  }, {})
  const ungated = values.reduce<Record<string, number>>((m, v) => {
    const k = v.predictionUngated.status === 200 ? '200' : `${v.predictionUngated.status} ${v.predictionUngated.error}`
    m[k] = (m[k] ?? 0) + 1
    return m
  }, {})
  out(`proof "${label}" (code ${tree}): ${values.length} clients; lodgement analysed ${values.filter((v) => v.lodgement.status === 'analysed').length}; predictions ${JSON.stringify(statuses)}; with the gate opened ${JSON.stringify(ungated)}; writes blocked: ${blocked.count}`)

  const against = process.env.PROOF_COMPARE?.trim()
  if (!against) return
  const otherFile = path.join('verified-figures', `proof-${against}.json`)
  if (!existsSync(otherFile)) throw new Error(`No ${otherFile}`)
  const other = (JSON.parse(readFileSync(otherFile, 'utf8')) as { results: Record<string, ClientProof> }).results
  let differing = 0
  out('')
  out(`alias | result | lodgement | prediction as the route answers | prediction with the readiness gate opened`)
  for (const alias of [...new Set([...Object.keys(other), ...Object.keys(results)])].sort()) {
    const a = other[alias]
    const b = results[alias]
    const same = JSON.stringify(a) === JSON.stringify(b)
    if (!same) differing += 1
    const l = (p?: ClientProof) => (p ? (p.lodgement.hash ? `${p.lodgement.late} late, ${p.lodgement.daysLate} days, bal ${p.lodgement.balance} [${p.lodgement.hash}]` : p.lodgement.status) : 'missing')
    const one = (p?: PredictionProof) =>
      p ? (p.status === 200 ? `${p.percent}% (${p.low}–${p.high}), ${p.cases} cases, creditors ${p.creditorAmount} [${p.hash}]` : `${p.status} ${p.error} [${p.hash}]`) : 'missing'
    const pr = (p?: ClientProof) => `${one(p?.prediction)} | ${one(p?.predictionUngated)}`
    out(`${alias} | ${same ? 'IDENTICAL' : 'DIFFERENT'} | ${l(b)} | ${pr(b)}${same ? '' : `  (was: ${l(a)} | ${pr(a)})`}`)
  }
  out('')
  out(differing === 0 ? `All ${Object.keys(results).length} clients identical.` : `${differing} client(s) differ.`)
  if (differing > 0) throw new Error(`${differing} client(s) differ`)
})
