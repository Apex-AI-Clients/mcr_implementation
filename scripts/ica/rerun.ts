/**
 * npm run ica:rerun                       DRY RUN (read only)
 * ICA_RERUN_APPLY=yes npm run ica:rerun   APPLY (after migration 0058)
 *
 * Every file in the three ATO account slots, checked against the ATO's own
 * balance with the ICA engine (src/lib/ica).
 *
 * Dry run: reads each file from storage in memory and prints, by alias
 * (verified-figures/ica/aliases.json, else an id prefix) and counts only,
 * which files would verify and which clients with a saved prediction would
 * be held back. Writes nothing; never asks Claude.
 *
 * Apply: stores each file's check on its analyses (verifyAndStoreDocument:
 * learned patterns, Claude for an unmatched window, the RBA spreadsheet
 * comparison, a developer alert for anything unverified), then clears the
 * stored AI summaries of every ATO analysis (they quoted figures from before
 * the check; they are written again, from verified figures only, when a page
 * is opened).
 */
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { analyseIca, readIcaFile } from '@/lib/ica'
import { statusOf, verifyAndStoreDocument } from '@/lib/ica/verifyStore'

try {
  process.loadEnvFile('.env')
} catch {
  // Environment from the shell.
}
const APPLY = process.env.ICA_RERUN_APPLY === 'yes'
const CATEGORIES = ['integrated_client_account', 'ato_income_tax_account', 'ato_super_guarantee_account']

const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const aliasFile = 'verified-figures/ica/aliases.json'
const aliases = new Map<string, string>(
  existsSync(aliasFile) ? JSON.parse(readFileSync(aliasFile, 'utf8')).all.map((a: { alias: string; clientId: string }) => [a.clientId, a.alias]) : [],
)
const alias = (id: string) => aliases.get(id) ?? `client-${id.slice(0, 6)}`

;(async () => {
  console.log(APPLY ? 'APPLY: storing each check and clearing stale AI summaries.' : 'DRY RUN: nothing is written, Claude is not asked.')
  if (APPLY) {
    const probe = await db.from('lodgement_analyses').select('ica_status').limit(1)
    if (probe.error) throw new Error(`Migration 0058 is not applied (${probe.error.message}). Apply it first.`)
  }
  const { data: docs, error } = await db.from('documents').select('id, client_id, doc_category, file_path').in('doc_category', CATEGORIES)
  if (error) throw error
  const { data: preds } = await db.from('sbr_outcome_predictions').select('client_id')
  const withPrediction = new Set((preds ?? []).map((p) => p.client_id))
  const counts = { verified: 0, unverified: 0, empty: 0, failed: 0 }
  const heldClients = new Set<string>()

  for (const d of docs ?? []) {
    let status: 'verified' | 'unverified' | 'empty' | 'failed'
    let detail = ''
    if (APPLY) {
      const out = await verifyAndStoreDocument(db as never, d.client_id, d.id)
      status = out.ok ? out.status : 'failed'
      if (!out.ok) detail = out.error
    } else {
      const { data: blob } = d.file_path ? await db.storage.from('documents').download(d.file_path) : { data: null }
      if (!blob) {
        status = 'failed'
        detail = 'not downloaded'
      } else {
        try {
          const a = analyseIca(readIcaFile(new Uint8Array(await blob.arrayBuffer())))
          status = statusOf(a)
          detail = `${a.file.rows.length} rows${a.verified ? '' : ` — ${a.holdReasons.join('; ')}`}`
        } catch (e) {
          status = 'failed'
          detail = (e as Error).message
        }
      }
    }
    counts[status]++
    // Only the activity statement account holds a prediction back (its ATO debt and payments); 'empty' holds nothing.
    if ((status === 'unverified' || status === 'failed') && d.doc_category === 'integrated_client_account') heldClients.add(d.client_id)
    console.log(`${alias(d.client_id).padEnd(14)} ${d.doc_category.padEnd(28)} ${status.toUpperCase().padEnd(10)} ${detail}${withPrediction.has(d.client_id) ? '  (has a saved prediction)' : ''}`)
  }

  if (APPLY) {
    const [a, b] = await Promise.all([
      db.from('lodgement_analyses').update({ ai_summary: null, ai_summary_generated_at: null, ai_summary_model: null }).not('ai_summary', 'is', null).select('id'),
      db.from('ato_account_analyses').update({ ai_summary: null, ai_summary_generated_at: null, ai_summary_model: null }).not('ai_summary', 'is', null).select('id'),
    ])
    console.log(`AI summaries cleared: ${a.data?.length ?? 0} lodgement, ${b.data?.length ?? 0} ATO account.`)
  }
  const losing = [...heldClients].filter((c) => withPrediction.has(c))
  console.log(`\nfiles ${docs?.length ?? 0} · verified ${counts.verified} · not verified ${counts.unverified} · no rows ${counts.empty} · not read ${counts.failed}`)
  console.log(`clients whose activity statement is held back: ${heldClients.size} · of those with a saved prediction: ${losing.length} ${losing.map(alias).join(' ')}`)
})().catch((e) => {
  console.error(String((e as Error).message ?? e))
  process.exit(1)
})
