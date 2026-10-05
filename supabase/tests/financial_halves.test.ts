import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Migration 0026 against a real Supabase project: deleting a document clears
 * only the statement halves it owns, and the release-window guard turns a
 * whole-row rewrite back into a legacy row.
 *
 * Run with `npm run test:db` after setting SUPABASE_TEST_URL,
 * SUPABASE_TEST_SERVICE_ROLE_KEY and SUPABASE_TEST_ANON_KEY for a DEV project.
 * Never production: these tests insert rows.
 *
 * Every row is synthetic, hangs off clients whose email carries this run's
 * prefix on the reserved .test domain, and is deleted afterwards with them
 * (documents and statements cascade from the client). The documents point at
 * storage paths that do not exist; nothing is uploaded.
 */

const URL = process.env.SUPABASE_TEST_URL
const SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY
const configured = Boolean(URL && SERVICE_KEY && ANON_KEY)

const RUN = `dbtest-${Date.now().toString(36)}-`

type Db = SupabaseClient<Database>
let db: Db

const IS = { income: { sales: 100 }, cogs: {}, expenses: {}, totals: {} }
const BS = { totals: { totalAssets: 50 } }

async function newClient(label: string): Promise<string> {
  const { data, error } = await db
    .from('clients')
    .insert({ name: `${RUN}${label}`, email: `${RUN}${label}@example.test` })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

async function newDocument(clientId: string, label: string): Promise<string> {
  const { data, error } = await db
    .from('documents')
    .insert({
      client_id: clientId,
      doc_category: 'historical_financials',
      file_path: `documents/${clientId}/${RUN}${label}.pdf`,
      file_type: 'application/pdf',
      original_filename: `${label}.pdf`,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

async function statementRows(clientId: string) {
  const { data, error } = await db.from('financial_statements').select('*').eq('client_id', clientId)
  if (error) throw new Error(error.message)
  return data
}

async function deleteDocument(id: string) {
  const { error } = await db.from('documents').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

describe.skipIf(!configured)('financial statement halves (0026)', () => {
  beforeAll(() => {
    db = createClient<Database>(URL!, SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  })

  afterAll(async () => {
    if (!db) return
    await db.from('clients').delete().like('email', `${RUN}%`)
  })

  it('deleting the P&L file clears only the P&L half; deleting the balance sheet file removes the row', async () => {
    const clientId = await newClient('split')
    const pnl = await newDocument(clientId, 'pnl')
    const bs = await newDocument(clientId, 'bs')
    const now = new Date().toISOString()
    const { error } = await db.from('financial_statements').insert({
      client_id: clientId,
      financial_year: 2025,
      period_end_date: '2025-06-30',
      source_column: 'primary',
      income_statement: IS,
      is_document_id: pnl,
      is_source_filename: 'pnl.pdf',
      is_extracted_at: now,
      balance_sheet: BS,
      bs_document_id: bs,
      bs_source_filename: 'bs.pdf',
      bs_extracted_at: now,
    })
    expect(error).toBeNull()

    await deleteDocument(pnl)
    const [row] = await statementRows(clientId)
    expect(row.income_statement).toBeNull()
    expect(row.is_document_id).toBeNull()
    expect(row.bs_document_id).toBe(bs)
    expect(row.balance_sheet).toEqual(BS)

    await deleteDocument(bs)
    expect(await statementRows(clientId)).toHaveLength(0)
  })

  it('deleting the document of a legacy row removes it whole, as the old cascade did', async () => {
    const clientId = await newClient('legacy')
    const doc = await newDocument(clientId, 'combined')
    const { error } = await db.from('financial_statements').insert({
      client_id: clientId,
      financial_year: 2024,
      period_end_date: '2024-06-30',
      source_column: 'primary',
      document_id: doc,
      source_filename: 'combined.pdf',
      income_statement: IS,
      balance_sheet: BS,
    })
    expect(error).toBeNull()

    await deleteDocument(doc)
    expect(await statementRows(clientId)).toHaveLength(0)
  })

  it('a whole-row rewrite that stamps no half (the old code) turns the row back into legacy', async () => {
    const clientId = await newClient('guard')
    const doc = await newDocument(clientId, 'combined')
    const now = new Date().toISOString()
    const { data: inserted, error } = await db
      .from('financial_statements')
      .insert({
        client_id: clientId,
        financial_year: 2023,
        period_end_date: '2023-06-30',
        source_column: 'primary',
        document_id: doc,
        source_filename: 'combined.pdf',
        income_statement: IS,
        is_document_id: doc,
        is_extracted_at: now,
        balance_sheet: BS,
        bs_document_id: doc,
        bs_extracted_at: now,
      })
      .select('id')
      .single()
    expect(error).toBeNull()

    const rewrite = await db
      .from('financial_statements')
      .update({ income_statement: { income: { sales: 101 } }, balance_sheet: BS })
      .eq('id', inserted!.id)
    expect(rewrite.error).toBeNull()

    const [row] = await statementRows(clientId)
    expect(row.is_document_id).toBeNull()
    expect(row.bs_document_id).toBeNull()
    expect(row.document_id).toBe(doc)
  })

  it('deleting a whole client goes through the trigger without error', async () => {
    const clientId = await newClient('whole')
    const doc = await newDocument(clientId, 'combined')
    const now = new Date().toISOString()
    await db.from('financial_statements').insert({
      client_id: clientId,
      financial_year: 2025,
      period_end_date: '2025-06-30',
      source_column: 'primary',
      income_statement: IS,
      is_document_id: doc,
      is_extracted_at: now,
      balance_sheet: BS,
      bs_document_id: doc,
      bs_extracted_at: now,
    })
    const { error } = await db.from('clients').delete().eq('id', clientId)
    expect(error).toBeNull()
    expect(await statementRows(clientId)).toHaveLength(0)
  })
})
