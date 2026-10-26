import { it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { ATO_ACCOUNT_CATEGORIES, fileAtoAccount, readAtoAccountHeader, type DetectedAtoAccountKind } from '@/lib/analysis/atoAccountKind'
import type { DocCategory } from '@/lib/constants'
import { out } from './figures'

/**
 * `npm run ato:refile` — one-off, after migration 0038. Files every ATO
 * account CSV already uploaded by what its first two lines say, as new
 * uploads are (atoAccountKind.ts): an income tax or super guarantee export
 * sitting in the activity statement slot moves to its own slot, with a note.
 *
 * DRY RUN unless ATO_REFILE_APPLY=yes: reads (SELECTs and downloads) and
 * prints counts only — files, account types, moves, clients. Never a client
 * name, filename or figure.
 *
 * With ATO_REFILE_APPLY=yes it writes, per file: the account type, line 1,
 * line 2 and the note, and the new slot when it moves. Nothing else changes:
 * the lodgement analysis was only ever made from activity statement files,
 * which stay where they are, so the SBR prediction is not affected.
 */
it('re-files the ATO account CSVs already uploaded', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const apply = process.env.ATO_REFILE_APPLY === 'yes'

  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, client_id, file_path, doc_category')
    .in('doc_category', ATO_ACCOUNT_CATEGORIES as string[])
  if (error) throw new Error(`Reading documents failed: ${error.code}`)

  const kinds = new Map<DetectedAtoAccountKind, number>()
  const moves = new Map<string, number>()
  const clients = new Set<string>()
  const movedClients = new Set<string>()
  let unreadable = 0
  let written = 0
  let writeFailures = 0

  for (const doc of docs ?? []) {
    clients.add(doc.client_id)
    const { data: blob } = doc.file_path ? await supabase.storage.from('documents').download(doc.file_path) : { data: null }
    if (!blob) {
      unreadable += 1
      continue
    }
    const header = readAtoAccountHeader(await blob.text())
    kinds.set(header.kind, (kinds.get(header.kind) ?? 0) + 1)
    const from = doc.doc_category as DocCategory
    const filed = fileAtoAccount(from, header.kind)
    if (filed.category !== from) {
      const key = `${from} -> ${filed.category}`
      moves.set(key, (moves.get(key) ?? 0) + 1)
      movedClients.add(doc.client_id)
    }

    if (apply) {
      const { error: updateError } = await supabase
        .from('documents')
        .update({
          doc_category: filed.category,
          ato_account_kind: header.kind,
          ato_account_label: header.label,
          ato_entity_name: header.entityName,
          category_note: filed.note,
        })
        .eq('id', doc.id)
      if (updateError) writeFailures += 1
      else written += 1
    }
  }

  out(apply ? 'ATO account CSVs: APPLIED' : 'ATO account CSVs: DRY RUN (nothing written)')
  out(`files: ${(docs ?? []).length} across ${clients.size} clients; unreadable: ${unreadable}`)
  for (const [kind, count] of [...kinds].sort()) out(`  ${kind}: ${count}`)
  out(`moves: ${[...moves.values()].reduce((a, b) => a + b, 0)} files across ${movedClients.size} clients`)
  for (const [move, count] of [...moves].sort()) out(`  ${move}: ${count}`)
  if (apply) out(`written: ${written}; failed: ${writeFailures}`)
})
