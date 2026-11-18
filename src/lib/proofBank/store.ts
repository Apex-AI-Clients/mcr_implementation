import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadNoticePanel } from '@/lib/dpn/proofStore'
import { readDirectorPenaltyNotice } from '@/lib/dpn/extractText'
import { noticeFieldsFromParse, toStoredNotice, type NoticeRow } from '@/lib/dpn/stored'
import { loadPrintedComparison, readOrQueueScan } from '@/lib/printed/store'
import { applyScanChoices, loadScanChoices } from '@/lib/scan/choices'
import type { Json } from '@/types/database'
import { bankDifferences, documentYearFigures, noticeBankFigures, provenYearsByDocument, type NoticeBankFigures, type StatementBankFigures } from './figures'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * Server-only. The test bank (figures.ts, migration 0060): joining it when a file
 * proves, and checking every banked file against the current code.
 */

/**
 * Every proven notice and statement of the client not banked yet joins the bank with
 * the figures it proved. Existing entries are never changed. Never throws; before
 * migration 0060 there is nothing to join. Returns how many joined.
 */
export async function joinProofBank(supabase: ServerClient, clientId: string): Promise<{ joined: number }> {
  try {
    const { data: banked, error } = await supabase.from('proof_bank').select('document_id, kind').eq('client_id', clientId)
    if (error) return { joined: 0 } // Before 0060.
    const have = new Set((banked ?? []).map((b) => `${b.document_id}|${b.kind}`))
    const entries = (await provenEntries(supabase, clientId)).filter((e) => !have.has(`${e.document_id}|${e.kind}`))
    if (entries.length === 0) return { joined: 0 }
    const { error: insertError } = await supabase.from('proof_bank').upsert(entries, { onConflict: 'document_id,kind', ignoreDuplicates: true })
    if (insertError) {
      console.error('[proof-bank] join failed', insertError.code)
      return { joined: 0 }
    }
    return { joined: entries.length }
  } catch (err) {
    console.error('[proof-bank] join failed', err instanceof Error ? err.name : 'unknown')
    return { joined: 0 }
  }
}

export interface BankEntry {
  client_id: string
  document_id: string
  kind: 'dpn' | 'statement'
  expected: Json
}

/** The client's proven notices and statements, with the figures they prove now. Read only. */
export async function provenEntries(supabase: ServerClient, clientId: string): Promise<BankEntry[]> {
  const entries: BankEntry[] = []

  const notices = await loadNoticePanel(supabase, clientId)
  for (const view of notices?.panel.notices ?? []) {
    if (view.proof?.status !== 'verified' || !view.notice) continue
    entries.push({ client_id: clientId, document_id: view.documentId, kind: 'dpn', expected: noticeBankFigures(view.notice) as unknown as Json })
  }

  const printed = await loadPrintedComparison(supabase, clientId)
  for (const [documentId, years] of provenYearsByDocument(printed.comparison)) {
    const doc = printed.documents.find((d) => d.documentId === documentId)
    if (!doc?.read) continue
    const figures = documentYearFigures(doc, years)
    if (Object.keys(figures.years).length === 0) continue
    entries.push({ client_id: clientId, document_id: documentId, kind: 'statement', expected: figures as unknown as Json })
  }
  return entries
}

export interface BankCheck {
  clientId: string
  documentId: string
  kind: 'dpn' | 'statement'
  /** How the figures were read now: the file again with the current code, or its kept reading (a scan, a typed notice). */
  readFrom: 'file' | 'kept_reading'
  /** Keys and figures only. Empty: the figures are unchanged. */
  differences: string[]
  /** The file could not be checked (gone from storage, unreadable): why. */
  error: string | null
}

/** Every banked file read again with the current code and compared with its banked figures. Read-only. */
export async function checkProofBank(supabase: ServerClient): Promise<BankCheck[] | null> {
  const { data: bank, error } = await supabase.from('proof_bank').select('client_id, document_id, kind, expected').order('joined_at')
  if (error) return null // Before 0060.
  return checkEntries(supabase, (bank ?? []) as BankEntry[])
}

/** Each entry's file read again with the current code, compared with its figures. Read only. */
export async function checkEntries(supabase: ServerClient, bank: BankEntry[]): Promise<BankCheck[]> {
  const out: BankCheck[] = []
  const choicesByClient = new Map<string, Awaited<ReturnType<typeof loadScanChoices>>>()
  for (const entry of bank) {
    const base = { clientId: entry.client_id, documentId: entry.document_id, kind: entry.kind as BankCheck['kind'] }
    try {
      if (entry.kind === 'dpn') {
        const { data: row } = await supabase.from('director_penalty_notices').select('*').eq('document_id', entry.document_id).single()
        if (!row) throw new Error('The notice is no longer stored.')
        let now: NoticeBankFigures
        let readFrom: BankCheck['readFrom'] = 'kept_reading'
        if (row.source === 'parsed') {
          const bytes = await download(supabase, entry.document_id)
          const fields = noticeFieldsFromParse(await readDirectorPenaltyNotice(bytes))
          now = noticeBankFigures(toStoredNotice({ ...row, ...fields } as NoticeRow))
          readFrom = 'file'
        } else {
          now = noticeBankFigures(toStoredNotice(row))
        }
        out.push({ ...base, readFrom, differences: bankDifferences(entry.expected, now), error: null })
        continue
      }

      const { data: kept } = await supabase.from('printed_reads').select('*').eq('document_id', entry.document_id).maybeSingle()
      const scan = (kept as { scan?: { pages?: { scanned: boolean }[] } | null } | null)?.scan
      const scanned = !!scan?.pages?.some((p) => p.scanned)
      const { data: doc } = await supabase.from('documents').select('original_filename, uploaded_at').eq('id', entry.document_id).single()
      if (!doc) throw new Error('The file is no longer on the client.')
      let read
      if (scanned) {
        // A scan is not sent to Claude again for a check: its kept reading, with the staff choices.
        if (!kept) throw new Error('The scan reading is no longer kept.')
        if (!choicesByClient.has(entry.client_id)) choicesByClient.set(entry.client_id, await loadScanChoices(supabase, entry.client_id))
        read = applyScanChoices(
          { status: kept.status as never, pageCount: kept.page_count ?? 0, statements: kept.statements as never, issues: kept.issues as never, scan: scan as never },
          choicesByClient.get(entry.client_id)!.get(entry.document_id) ?? [],
        )
      } else {
        read = await readOrQueueScan(await download(supabase, entry.document_id))
      }
      const expected = entry.expected as unknown as StatementBankFigures
      const now = documentYearFigures({ documentId: entry.document_id, filename: doc.original_filename, uploadedAt: doc.uploaded_at, read }, Object.keys(expected.years ?? {}))
      out.push({ ...base, readFrom: scanned ? 'kept_reading' : 'file', differences: bankDifferences(expected, now), error: null })
    } catch (err) {
      out.push({ ...base, readFrom: 'file', differences: [], error: err instanceof Error ? err.message : 'unknown' })
    }
  }
  return out
}

async function download(supabase: ServerClient, documentId: string): Promise<Uint8Array> {
  const { data: doc } = await supabase.from('documents').select('file_path').eq('id', documentId).single()
  if (!doc?.file_path) throw new Error('The file is no longer stored.')
  const { data: blob, error } = await supabase.storage.from('documents').download(doc.file_path)
  if (error || !blob) throw new Error('The file could not be downloaded.')
  return new Uint8Array(await blob.arrayBuffer())
}
