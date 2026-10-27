import { it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadIcaRows } from '@/lib/sbr/icaRows'
import { out, readClients, writeJson, type Snapshot } from './figures'
import { loadFinancialDocuments, loadStoredReads } from '@/lib/printed/store'
import { loadDirectorNames, loadMapping } from '@/lib/printed/mappingStore'
import { readPrintedStatements } from '@/lib/printed/readPdf'
import { loadReadiness } from '@/lib/sbr/loadReadiness'
import type { ComparisonDocument } from '@/lib/printed/compare'

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
    // What the prediction's inputs are worked out from (figures.ts predictionInputs).
    const [docs, reads, mapping, directors, saved, readiness] = await Promise.all([
      loadFinancialDocuments(supabase as never, clientId),
      loadStoredReads(supabase as never, clientId),
      loadMapping(supabase as never, clientId),
      loadDirectorNames(supabase as never, clientId),
      supabase.from('sbr_outcome_predictions').select('input_features').eq('client_id', clientId).maybeSingle(),
      loadReadiness(supabase as never, clientId),
    ])
    const documents: ComparisonDocument[] = []
    for (const doc of docs) {
      let read = reads.get(doc.id)?.read ?? null
      // Not read by the current reader yet: read now, in memory. Nothing is stored.
      if (!read) {
        const { data: blob } = await supabase.storage.from('documents').download(doc.file_path)
        read = blob ? await readPrintedStatements(new Uint8Array(await blob.arrayBuffer())).catch(() => null) : null
      }
      documents.push({ documentId: doc.id, filename: doc.original_filename, uploadedAt: doc.uploaded_at, read })
    }
    const savedFeatures = (saved.data?.input_features ?? {}) as Record<string, unknown>
    snapshot.prediction = {
      documents,
      mapping,
      directors,
      dpnOnFile: readiness.dpn,
      savedDpn: typeof savedFeatures.dpn === 'boolean' ? savedFeatures.dpn : null,
    }
    writeJson(`${alias}.snapshot.json`, snapshot)
    out(`${alias}: ATO account rows from ${ica.from}, ${(dpnNotices.data ?? []).length} notices — snapshot written`)
  }
})
