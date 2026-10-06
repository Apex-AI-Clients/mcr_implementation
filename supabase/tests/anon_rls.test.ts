import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * The publishable (anon) key sees nothing in the tables migration 0021 closed,
 * nor in the ones closed the same way since (0026).
 *
 * Run with `npm run test:db` after setting SUPABASE_TEST_URL,
 * SUPABASE_TEST_SERVICE_ROLE_KEY and SUPABASE_TEST_ANON_KEY for a DEV project.
 *
 * Read-only. Each table is checked twice: with a head-only count, and with a
 * one-row select. The select is what proves RLS rather than an empty table —
 * the service-role count beside it says whether there was anything to hide.
 * No row contents are ever printed.
 */

const URL = process.env.SUPABASE_TEST_URL
const SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY
const configured = Boolean(URL && SERVICE_KEY && ANON_KEY)

const CLOSED_TABLES = [
  'company_details',
  'lodgement_analyses',
  'financial_statements',
  'financial_comparisons',
  'sbr_historical_cases',
  'sbr_outcome_predictions',
  'financial_comparison_jobs',
  'financial_document_extractions',
] as const

/** The column each one-row select asks for. Every table has an `id` but this one. */
const KEY_COLUMN: Partial<Record<(typeof CLOSED_TABLES)[number], string>> = {
  financial_document_extractions: 'document_id',
}

/**
 * Trigger functions from 0026. EXECUTE is revoked from PUBLIC, anon and
 * authenticated; PostgREST also never exposes a function that returns
 * `trigger`. Either way the anon key must get an error, never a call.
 * The privilege itself is checked in SQL — see the migration's report.
 */
const TRIGGER_FUNCTIONS = [
  'financial_statements_release_document',
  'financial_statements_legacy_write_guard',
] as const

let anon: SupabaseClient<Database>
let db: SupabaseClient<Database>

describe.skipIf(!configured)('anon key and the tables 0021 closed', () => {
  beforeAll(() => {
    const options = { auth: { persistSession: false } }
    anon = createClient<Database>(URL!, ANON_KEY!, options)
    db = createClient<Database>(URL!, SERVICE_KEY!, options)
  })

  it.each(CLOSED_TABLES)('%s: anon counts zero rows', async (table) => {
    const { count, error } = await anon.from(table).select('*', { count: 'exact', head: true })
    expect(error).toBeNull()
    expect(count).toBe(0)
  })

  it.each(CLOSED_TABLES)('%s: anon selects nothing', async (table) => {
    const { data, error } = await anon.from(table).select(KEY_COLUMN[table] ?? 'id').limit(1)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it.each(CLOSED_TABLES)('%s: service role is unaffected', async (table) => {
    const { error } = await db
      .from(table)
      .select(KEY_COLUMN[table] ?? 'id', { count: 'exact', head: true })
    expect(error).toBeNull()
  })

  it.each(TRIGGER_FUNCTIONS)('%s: anon cannot call it', async (fn) => {
    // Not in the generated Functions type (trigger functions never are).
    const { error } = await anon.rpc(fn as never)
    expect(error).not.toBeNull()
    // PGRST202 = not exposed at all; 42501 = exposed but not permitted.
    expect(['PGRST202', '42501']).toContain(error?.code)
  })

  it('anon cannot write company_details', async () => {
    // A client_id that cannot exist: if RLS let this through, the foreign key
    // would still stop it, so nothing is ever created.
    const { error } = await anon
      .from('company_details')
      .insert({ client_id: '00000000-0000-0000-0000-000000000000' })
    expect(error).not.toBeNull()
    // 42501 = insufficient_privilege / RLS violation, not the FK (23503).
    expect(error?.code).toBe('42501')
  })
})
