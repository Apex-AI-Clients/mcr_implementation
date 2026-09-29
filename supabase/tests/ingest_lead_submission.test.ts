import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'

/**
 * ingest_lead_submission (migration 0020), against a real Supabase project.
 *
 * Run with `npm run test:db` after setting SUPABASE_TEST_URL,
 * SUPABASE_TEST_SERVICE_ROLE_KEY and SUPABASE_TEST_ANON_KEY for a DEV project.
 * Never production: these tests insert rows.
 *
 * Every row they create is synthetic and carries this run's prefix in its
 * email, on the reserved .test domain, and is deleted afterwards. The prefix
 * has no `_` or `%`, so the LIKE used for clean-up cannot match anything else.
 */

const URL = process.env.SUPABASE_TEST_URL
const SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY
const configured = Boolean(URL && SERVICE_KEY && ANON_KEY)

const RUN = `dbtest-${Date.now().toString(36)}-`
const email = (local: string) => `${RUN}${local}@example.test`

type Db = SupabaseClient<Database>
type LeadRow = Database['public']['Tables']['leads']['Row']
type Outcome = { outcome: string; lead_id: string | null }

let db: Db
let anon: Db

type Submission = Record<string, unknown> & { email: string }

async function ingest(submission: Submission, latestTouch = false): Promise<Outcome> {
  const { data, error } = await db.rpc('ingest_lead_submission', {
    p_submission: { name: 'Test Person', phone: '0400000000', source: 'facebook', ...submission } as Json,
    p_note_body: 'New enquiry from the facebook form.',
    p_note_author: 'Facebook',
    p_latest_touch: latestTouch,
  })
  if (error) throw new Error(`ingest failed: ${error.message}`)
  return data[0]
}

async function lead(id: string): Promise<LeadRow> {
  const { data, error } = await db.from('leads').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data
}

async function submissions(leadId: string) {
  const { data, error } = await db
    .from('lead_submissions')
    .select('*')
    .eq('lead_id', leadId)
    .order('received_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data
}

async function noteCount(leadId: string): Promise<number> {
  const { count, error } = await db
    .from('lead_activities')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function leadsWithEmail(address: string) {
  const { data, error } = await db.from('leads').select('id').ilike('email', address)
  if (error) throw new Error(error.message)
  return data
}

describe.skipIf(!configured)('ingest_lead_submission', () => {
  beforeAll(() => {
    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    db = createClient<Database>(URL!, SERVICE_KEY!, options)
    anon = createClient<Database>(URL!, ANON_KEY!, options)
  })

  afterAll(async () => {
    if (!db) return
    // Leads first: submissions and activities cascade, and a lead's
    // converted_client_id would otherwise just be nulled.
    await db.from('leads').delete().like('email', `${RUN}%`)
    await db.from('clients').delete().like('email', `${RUN}%`)
  })

  // ----------------------------------------------------------
  // Access
  // ----------------------------------------------------------

  describe('access', () => {
    it('cannot be executed with the anon key', async () => {
      const { data, error } = await anon.rpc('ingest_lead_submission', {
        p_submission: { name: 'A', email: email('anon'), phone: '1', source: 'website' },
        p_note_body: 'x',
        p_note_author: 'x',
      })
      expect(data).toBeNull()
      expect(error?.code).toBe('42501')
      expect(await leadsWithEmail(email('anon'))).toHaveLength(0)
    })

    it('does not let the anon key read submissions', async () => {
      await ingest({ email: email('anon-read') })
      const { data } = await anon.from('lead_submissions').select('id').like('email', `${RUN}%`)
      expect(data ?? []).toHaveLength(0)
    })
  })

  // ----------------------------------------------------------
  // New lead
  // ----------------------------------------------------------

  describe('new lead', () => {
    it('creates the lead and its first submission together', async () => {
      const result = await ingest({
        email: email('New.Lead'),
        state: 'QLD',
        debt_min: 100000,
        debt_max: 124999,
        entity_type: 'company',
        external_id: `${RUN}new-1`,
        meta_ad_id: 'ad-A',
      })
      expect(result.outcome).toBe('created')

      const row = await lead(result.lead_id!)
      expect(row.email).toBe(email('new.lead'))
      expect(row.stage).toBe('lead')
      expect(row.enquiry_count).toBe(1)
      expect(row.last_enquiry_at).toBe(row.created_at)

      const subs = await submissions(row.id)
      expect(subs).toHaveLength(1)
      expect(subs[0]).toMatchObject({ state: 'QLD', debt_min: 100000, meta_ad_id: 'ad-A', after_close: false })
      // As before: a brand-new lead gets no timeline note.
      expect(await noteCount(row.id)).toBe(0)
    })

    it('gives a lead added by hand its first submission too, with source manual', async () => {
      const { data, error } = await db
        .from('leads')
        .insert({ name: 'Manual', email: email('manual'), phone: '0400000001', state: 'VIC', source: 'manual' })
        .select('*')
        .single()
      expect(error).toBeNull()
      expect(data!.enquiry_count).toBe(1)
      const subs = await submissions(data!.id)
      expect(subs.map((s) => s.source)).toEqual(['manual'])
    })

    it('refuses a second lead for the same email in any case (the 409 in Add lead)', async () => {
      const { error } = await db
        .from('leads')
        .insert({ name: 'Manual', email: email('MANUAL'), phone: '0400000001', source: 'manual' })
      expect(error?.code).toBe('23505')
      expect(error?.message).toContain('leads_email_lower_key')
    })
  })

  // ----------------------------------------------------------
  // Repeat enquiries
  // ----------------------------------------------------------

  describe('repeat enquiry on an open lead', () => {
    it('takes the fuller data from a later enquiry', async () => {
      const first = await ingest({ email: email('fuller'), source: 'website', external_id: `${RUN}fuller-1` })
      const repeat = await ingest({
        email: email('fuller'),
        name: 'Test Person Updated',
        phone: '0400000002',
        debt_min: 250000,
        debt_max: 499999,
        state: 'NSW',
        entity_type: 'trust',
        message: 'Now behind on super as well.',
        preferred_call_time: 'Mornings',
        external_id: `${RUN}fuller-2`,
      })
      expect(repeat).toEqual({ outcome: 'appended', lead_id: first.lead_id })

      const row = await lead(first.lead_id!)
      expect(row).toMatchObject({
        name: 'Test Person Updated',
        phone: '0400000002',
        debt_min: 250000,
        debt_max: 499999,
        state: 'NSW',
        entity_type: 'trust',
        message: 'Now behind on super as well.',
        preferred_call_time: 'Mornings',
        enquiry_count: 2,
      })
      expect(new Date(row.last_enquiry_at) >= new Date(row.created_at)).toBe(true)

      const subs = await submissions(row.id)
      expect(subs).toHaveLength(2)
      expect(subs[1]).toMatchObject({ debt_min: 250000, entity_type: 'trust', after_close: false })
      expect(await noteCount(row.id)).toBe(1)
    })

    it('never lets a blank wipe a known value', async () => {
      const first = await ingest({
        email: email('blanks'),
        state: 'SA',
        debt_min: 50000,
        debt_max: 99999,
        entity_type: 'company',
        message: 'First message.',
        preferred_call_time: 'After 6pm',
        external_id: `${RUN}blanks-1`,
      })
      // What bef-aft-pg-18.php sends: name, email, phone and nothing else,
      // with blanks as empty strings as well as nulls.
      await ingest({
        email: email('blanks'),
        name: 'Test Person Again',
        phone: '0400000003',
        entity_type: '',
        message: '   ',
        preferred_call_time: null,
        state: null,
        external_id: `${RUN}blanks-2`,
      })

      const row = await lead(first.lead_id!)
      expect(row).toMatchObject({
        name: 'Test Person Again',
        phone: '0400000003',
        state: 'SA',
        debt_min: 50000,
        debt_max: 99999,
        entity_type: 'company',
        message: 'First message.',
        preferred_call_time: 'After 6pm',
      })
      // The submission itself records what that enquiry actually said.
      const subs = await submissions(row.id)
      expect(subs[1]).toMatchObject({ state: null, entity_type: null, message: null })
    })
  })

  describe('merge groups', () => {
    it('replaces a single state with a grouped answer as one unit', async () => {
      const first = await ingest({ email: email('state-to-group'), state: 'NSW', external_id: `${RUN}stg-1` })
      await ingest({
        email: email('state-to-group'),
        meta_state_raw: 'NSW, VIC, ACT, TAS',
        meta_state_options: ['NSW', 'VIC', 'ACT', 'TAS'],
        external_id: `${RUN}stg-2`,
      })
      // Merging field by field would keep NSW beside the options and break
      // leads_state_or_state_options.
      expect(await lead(first.lead_id!)).toMatchObject({
        state: null,
        meta_state_raw: 'NSW, VIC, ACT, TAS',
        meta_state_options: ['NSW', 'VIC', 'ACT', 'TAS'],
      })
    })

    it('replaces a grouped answer with a single state as one unit', async () => {
      const first = await ingest({
        email: email('group-to-state'),
        meta_state_raw: 'NT, SA',
        meta_state_options: ['NT', 'SA'],
        external_id: `${RUN}gts-1`,
      })
      await ingest({ email: email('group-to-state'), state: 'SA', external_id: `${RUN}gts-2` })
      expect(await lead(first.lead_id!)).toMatchObject({
        state: 'SA',
        meta_state_raw: null,
        meta_state_options: null,
      })
    })

    it('keeps an unresolved state answer when it is the only thing sent', async () => {
      const first = await ingest({ email: email('state-raw'), state: 'WA', external_id: `${RUN}sr-1` })
      await ingest({ email: email('state-raw'), meta_state_raw: 'Auckland', external_id: `${RUN}sr-2` })
      // The raw answer is a value, so the group moves — state goes null
      // rather than keeping WA beside an answer that contradicts it.
      expect(await lead(first.lead_id!)).toMatchObject({ state: null, meta_state_raw: 'Auckland' })
    })

    it('replaces the debt range as a pair, including an open-ended one', async () => {
      const first = await ingest({
        email: email('debt'),
        debt_min: 100000,
        debt_max: 124999,
        external_id: `${RUN}debt-1`,
      })
      // "$150,000 or +": a null max here means open-ended, not blank. Keeping
      // the old 124,999 would also break leads_debt_range_ordered.
      await ingest({ email: email('debt'), debt_min: 150000, debt_max: null, external_id: `${RUN}debt-2` })
      expect(await lead(first.lead_id!)).toMatchObject({ debt_min: 150000, debt_max: null })

      await ingest({ email: email('debt'), external_id: `${RUN}debt-3` })
      expect(await lead(first.lead_id!)).toMatchObject({ debt_min: 150000, debt_max: null })
    })

    it('replaces entity type, message and call time each on its own', async () => {
      const first = await ingest({
        email: email('singles'),
        entity_type: 'company',
        message: 'Old message.',
        preferred_call_time: 'Mornings',
        external_id: `${RUN}singles-1`,
      })
      await ingest({ email: email('singles'), message: 'New message.', external_id: `${RUN}singles-2` })
      expect(await lead(first.lead_id!)).toMatchObject({
        entity_type: 'company',
        message: 'New message.',
        preferred_call_time: 'Mornings',
      })
    })

    it('keeps first-touch attribution on the row, with every touch in submissions', async () => {
      const first = await ingest({
        email: email('first-touch'),
        external_id: `${RUN}ft-1`,
        meta_ad_id: 'ad-A',
        meta_campaign_name: 'Campaign A',
      })
      await ingest({
        email: email('first-touch'),
        source: 'website',
        external_id: `${RUN}ft-2`,
      })
      expect(await lead(first.lead_id!)).toMatchObject({
        source: 'facebook',
        external_id: `${RUN}ft-1`,
        meta_ad_id: 'ad-A',
        meta_campaign_name: 'Campaign A',
      })
      const subs = await submissions(first.lead_id!)
      expect(subs.map((s) => [s.source, s.meta_ad_id])).toEqual([
        ['facebook', 'ad-A'],
        ['website', null],
      ])
    })

    it('with p_latest_touch, replaces attribution as a whole group', async () => {
      const first = await ingest({
        email: email('latest-touch'),
        external_id: `${RUN}lt-1`,
        meta_ad_id: 'ad-A',
        meta_campaign_name: 'Campaign A',
      })
      await ingest({ email: email('latest-touch'), source: 'website', external_id: `${RUN}lt-2` }, true)
      // Nulls included: a website touch has no ad, and keeping ad-A beside
      // source 'website' would describe a touch that never happened.
      expect(await lead(first.lead_id!)).toMatchObject({
        source: 'website',
        external_id: `${RUN}lt-2`,
        meta_ad_id: null,
        meta_campaign_name: null,
      })
    })
  })

  // ----------------------------------------------------------
  // Retries (bug 1) and matching (bug 2)
  // ----------------------------------------------------------

  describe('Meta retries', () => {
    it('ignores a retry of a first enquiry', async () => {
      const first = await ingest({ email: email('retry-first'), external_id: `${RUN}rf-1` })
      const retry = await ingest({ email: email('retry-first'), external_id: `${RUN}rf-1` })
      expect(retry).toEqual({ outcome: 'duplicate', lead_id: first.lead_id })
      expect(await submissions(first.lead_id!)).toHaveLength(1)
      expect(await noteCount(first.lead_id!)).toBe(0)
    })

    it('ignores a retry of a repeat enquiry (bug 1: this used to add a second note)', async () => {
      const first = await ingest({ email: email('retry-repeat'), external_id: `${RUN}rr-1` })
      await ingest({ email: email('retry-repeat'), external_id: `${RUN}rr-2` })
      const retry = await ingest({ email: email('retry-repeat'), external_id: `${RUN}rr-2`, name: 'Changed' })
      expect(retry).toEqual({ outcome: 'duplicate', lead_id: first.lead_id })

      const row = await lead(first.lead_id!)
      expect(row.enquiry_count).toBe(2)
      expect(row.name).toBe('Test Person')
      expect(await noteCount(row.id)).toBe(1)
    })
  })

  describe('email matching', () => {
    it('treats _ as a character, not a wildcard (bug 2)', async () => {
      const underscored = await ingest({ email: email('a_b'), external_id: `${RUN}us-1` })
      const lookalike = await ingest({ email: email('axb'), external_id: `${RUN}us-2` })
      expect(underscored.outcome).toBe('created')
      expect(lookalike.outcome).toBe('created')
      expect(lookalike.lead_id).not.toBe(underscored.lead_id)
    })

    it('matches a known email regardless of case and surrounding spaces', async () => {
      const first = await ingest({ email: email('case'), external_id: `${RUN}case-1` })
      const repeat = await ingest({ email: `  ${email('CASE').toUpperCase()} `, external_id: `${RUN}case-2` })
      expect(repeat).toEqual({ outcome: 'appended', lead_id: first.lead_id })
    })
  })

  // ----------------------------------------------------------
  // Converted and closed leads
  // ----------------------------------------------------------

  describe('repeat enquiry on a converted or closed lead', () => {
    it('leaves a converted lead and its stage alone, and marks it', async () => {
      const first = await ingest({ email: email('converted'), state: 'VIC', external_id: `${RUN}conv-1` })
      const { data: client, error } = await db
        .from('clients')
        .insert({ name: 'Test Client', email: email('converted-client') })
        .select('id')
        .single()
      expect(error).toBeNull()
      await db.from('leads').update({ stage: 'client', converted_client_id: client!.id }).eq('id', first.lead_id!)
      const before = await lead(first.lead_id!)

      const repeat = await ingest({
        email: email('converted'),
        name: 'Should Not Apply',
        state: 'NSW',
        external_id: `${RUN}conv-2`,
      })
      expect(repeat).toEqual({ outcome: 'appended', lead_id: first.lead_id })

      const after = await lead(first.lead_id!)
      expect(after).toMatchObject({
        stage: 'client',
        stage_since: before.stage_since,
        converted_client_id: client!.id,
        name: before.name,
        state: 'VIC',
        enquiry_count: 2,
      })
      expect(after.reenquired_after_close_at).not.toBeNull()

      const subs = await submissions(after.id)
      expect(subs[1]).toMatchObject({ name: 'Should Not Apply', state: 'NSW', after_close: true })
      expect(await noteCount(after.id)).toBe(1)
    })

    it.each(['converted', 'non_proceeding', 'do_not_contact'])(
      'marks a %s lead without changing it',
      async (stage) => {
        const first = await ingest({ email: email(`closed-${stage}`), external_id: `${RUN}cl-${stage}-1` })
        await db.from('leads').update({ stage }).eq('id', first.lead_id!)
        await ingest({ email: email(`closed-${stage}`), name: 'Should Not Apply', external_id: `${RUN}cl-${stage}-2` })
        const row = await lead(first.lead_id!)
        expect(row.stage).toBe(stage)
        expect(row.name).toBe('Test Person')
        expect(row.reenquired_after_close_at).not.toBeNull()
      },
    )

    it('clears the marker on any stage change, and not on a dismissal', async () => {
      const first = await ingest({ email: email('marker'), external_id: `${RUN}mk-1` })
      await db.from('leads').update({ stage: 'non_proceeding' }).eq('id', first.lead_id!)
      await ingest({ email: email('marker'), external_id: `${RUN}mk-2` })

      // Dismissing records who and when, and leaves the marker's own timestamp
      // so the two can be compared. No activity: it is not a logged action.
      const notesBefore = await noteCount(first.lead_id!)
      await db
        .from('leads')
        .update({ reenquiry_dismissed_at: new Date().toISOString(), reenquiry_dismissed_by: 'Test Staff' })
        .eq('id', first.lead_id!)
      const dismissed = await lead(first.lead_id!)
      expect(dismissed.reenquired_after_close_at).not.toBeNull()
      expect(dismissed.reenquiry_dismissed_by).toBe('Test Staff')
      expect(await noteCount(first.lead_id!)).toBe(notesBefore)

      await db.from('leads').update({ stage: 'lead' }).eq('id', first.lead_id!)
      expect((await lead(first.lead_id!)).reenquired_after_close_at).toBeNull()
    })

    it('does not mark an open lead', async () => {
      const first = await ingest({ email: email('open'), external_id: `${RUN}open-1` })
      await db.from('leads').update({ stage: 'prospect' }).eq('id', first.lead_id!)
      await ingest({ email: email('open'), external_id: `${RUN}open-2` })
      expect((await lead(first.lead_id!)).reenquired_after_close_at).toBeNull()
    })
  })

  // ----------------------------------------------------------
  // Races (bug 3)
  // ----------------------------------------------------------

  describe('concurrent deliveries', () => {
    // Promise.all sends the calls over separate HTTP requests, so PostgREST
    // runs them on separate connections at the same time. Repeated because a
    // single pair may happen not to overlap.
    const ROUNDS = 5

    it('creates one lead when two enquiries for a new email arrive together', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const address = email(`race-${round}`)
        const results = await Promise.all([
          ingest({ email: address, source: 'website', external_id: `${RUN}race-${round}-w` }),
          ingest({ email: address, source: 'facebook', external_id: `${RUN}race-${round}-f` }),
        ])
        expect(results.map((r) => r.outcome).sort()).toEqual(['appended', 'created'])
        expect(results[0].lead_id).toBe(results[1].lead_id)
        expect(await leadsWithEmail(address)).toHaveLength(1)
        expect(await submissions(results[0].lead_id!)).toHaveLength(2)
      }
    })

    it('stores a delivery once when Meta sends it twice at the same moment', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const address = email(`dup-race-${round}`)
        const results = await Promise.all([
          ingest({ email: address, external_id: `${RUN}dup-race-${round}` }),
          ingest({ email: address, external_id: `${RUN}dup-race-${round}` }),
        ])
        expect(results.map((r) => r.outcome).sort()).toEqual(['created', 'duplicate'])
        expect(results[0].lead_id).toBe(results[1].lead_id)
        expect(await submissions(results[0].lead_id!)).toHaveLength(1)
      }
    })
  })
})
