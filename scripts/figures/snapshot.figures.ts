import { it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadCompanyDetails, loadDocumentRecords } from '@/lib/financials/comparisonJob'
import { loadStoredSlots } from '@/lib/financials/storedStatements'
import { loadIcaRows } from '@/lib/sbr/icaRows'
import { out, readClients, writeJson, type Snapshot } from './figures'

/**
 * `npm run figures:snapshot` — READ-ONLY. Copies each listed test client's
 * stored statements, document records and company details into
 * verified-figures/<alias>.snapshot.json (gitignored). Run it after
 * re-extracting a test client. SELECTs only; nothing is written to the
 * database. Prints aliases and counts, never names or figures.
 */
it('snapshots the stored statements of the test clients', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  for (const { alias, clientId } of readClients()) {
    const [slots, records, company, lodgement] = await Promise.all([
      loadStoredSlots(supabase as never, clientId),
      loadDocumentRecords(supabase as never, clientId),
      loadCompanyDetails(supabase as never, clientId),
      supabase
        .from('lodgement_analyses')
        .select('document_id, rows')
        .eq('client_id', clientId)
        .order('analysed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    // The same rows the prediction reads (icaRows.ts): a download, never a write.
    const ica = await loadIcaRows(supabase as never, (lodgement.data as never) ?? null)
    const snapshot: Snapshot = { takenAt: new Date().toISOString(), slots, records, company, icaRows: ica.rows }
    writeJson(`${alias}.snapshot.json`, snapshot)
    out(`${alias}: ${slots.length} statement slots, ${records.length} documents, ATO account rows from ${ica.from} — snapshot written`)
  }
})
