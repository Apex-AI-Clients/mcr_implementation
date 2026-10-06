import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Migration 0027 against a real Supabase project: one active comparison job
 * per client.
 *
 * Run with `npm run test:db` after setting SUPABASE_TEST_URL,
 * SUPABASE_TEST_SERVICE_ROLE_KEY and SUPABASE_TEST_ANON_KEY for a DEV project.
 * Never production: these tests insert rows. Everything hangs off a synthetic
 * client with this run's prefix and is deleted afterwards (jobs cascade).
 */

const URL = process.env.SUPABASE_TEST_URL
const SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY
const configured = Boolean(URL && SERVICE_KEY && ANON_KEY)

const RUN = `dbtest-${Date.now().toString(36)}-`
let db: SupabaseClient<Database>
let clientId: string

describe.skipIf(!configured)('one active comparison job per client (0027)', () => {
  beforeAll(async () => {
    db = createClient<Database>(URL!, SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await db
      .from('clients')
      .insert({ name: `${RUN}jobs`, email: `${RUN}jobs@example.test` })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    clientId = data.id
  })

  afterAll(async () => {
    if (db) await db.from('clients').delete().like('email', `${RUN}%`)
  })

  it('refuses a second active job, and allows one again once the first is done', async () => {
    const first = await db.from('financial_comparison_jobs').insert({ client_id: clientId, status: 'pending', mode: 'full' }).select('id').single()
    expect(first.error).toBeNull()

    const second = await db.from('financial_comparison_jobs').insert({ client_id: clientId, status: 'pending', mode: 'full' })
    expect(second.error?.code).toBe('23505')

    await db.from('financial_comparison_jobs').update({ status: 'done' }).eq('id', first.data!.id)
    const third = await db.from('financial_comparison_jobs').insert({ client_id: clientId, status: 'pending', mode: 'compare' })
    expect(third.error).toBeNull()
  })
})
