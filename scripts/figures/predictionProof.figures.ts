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
      if (p === 'from') return (table: string) => bind(t.from(table), WRITES)
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
  readOnlyClient = readOnly(createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }))
  const supabase = readOnlyClient

  // Imported after the mock is in place, from whichever source tree `@` points at.
  const { findActivityStatementCsv } = await import('@/lib/analysis/lodgementStore')
  const { parseActivityStatementCsv } = await import('@/lib/analysis/parseActivityStatement')
  const { computeLateLodgement } = await import('@/lib/analysis/computeLateLodgement')
  const { POST } = await import('@/app/api/admin/clients/[id]/predict-outcome/route')

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
