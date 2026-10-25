import { it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadIcaRows } from '@/lib/sbr/icaRows'
import { out, readClients, writeJson, type Snapshot } from './figures'

/**
 * `npm run figures:snapshot` — READ-ONLY. Copies each listed test client's
 * ATO account rows and director penalty notices into
 * verified-figures/<alias>.snapshot.json (gitignored). SELECTs only; nothing is written to the
 * database. Prints aliases and counts, never names or figures.
 *
 * FIGURES_ALIAS=client-c snapshots only that client, leaving the others'
 * snapshots (the baseline for figures:check) as they are.
 */
it('snapshots the ATO account rows and notices of the test clients', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const only = process.env.FIGURES_ALIAS?.trim()
  // A client deleted from the database has no rows to copy: its PDFs are checked locally (scripts/printed).
  const clients = readClients().filter((c): c is { alias: string; clientId: string } => c.clientId !== null && (!only || c.alias === only))
  if (only && clients.length === 0) throw new Error(`No client "${only}" in verified-figures/clients.json`)
  for (const { alias, clientId } of clients) {
    const [lodgement, dpnDocuments, dpnNotices] = await Promise.all([
      supabase
        .from('lodgement_analyses')
        .select('document_id, rows')
        .eq('client_id', clientId)
        .order('analysed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Director penalty notices as stored (never an address: none is stored).
      supabase.from('documents').select('id, original_filename').eq('client_id', clientId).eq('doc_category', 'director_penalty_notices'),
      supabase.from('director_penalty_notices').select('*').eq('client_id', clientId),
    ])
    // The same rows the prediction reads (icaRows.ts): a download, never a write.
    const ica = await loadIcaRows(supabase as never, (lodgement.data as never) ?? null)
    const snapshot: Snapshot = {
      takenAt: new Date().toISOString(),
      icaRows: ica.rows,
      dpn: {
        documents: (dpnDocuments.data ?? []).map((d) => ({ id: d.id, originalFilename: d.original_filename })),
        noticeRows: (dpnNotices.data ?? []) as never,
      },
    }
    writeJson(`${alias}.snapshot.json`, snapshot)
    out(`${alias}: ATO account rows from ${ica.from}, ${(dpnNotices.data ?? []).length} notices — snapshot written`)
  }
})
