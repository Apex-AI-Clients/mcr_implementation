import type { getSupabaseServerClient } from '@/lib/supabase/server'
import type { PrintedRead } from '@/lib/printed/types'

/**
 * Staff corrections of a figure Claude read from a scanned page
 * (scan_figure_choices, migration 0044): Claude's figure back, or a
 * typed one, with who and when. Applied when the comparison is built, so a
 * choice never needs the scan read again, and survives a re-read that prints
 * the same line. Before the migration there are none.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export interface ScanChoice {
  rowKey: string
  column: number
  source: 'tesseract' | 'claude' | 'typed'
  /** Null: nil ("-"). */
  value: number | null
  chosenBy: string
  chosenAt: string
}

export async function loadScanChoices(supabase: ServerClient, clientId: string): Promise<Map<string, ScanChoice[]>> {
  const out = new Map<string, ScanChoice[]>()
  const { data, error } = await supabase.from('scan_figure_choices').select('*').eq('client_id', clientId)
  if (error) return out
  for (const r of data ?? []) {
    const list = out.get(r.document_id) ?? []
    list.push({ rowKey: r.row_key, column: r.column_index, source: r.source as ScanChoice['source'], value: r.value === null ? null : Number(r.value), chosenBy: r.chosen_by, chosenAt: r.chosen_at })
    out.set(r.document_id, list)
  }
  return out
}

/** The read with each chosen figure in place (status 'chosen'). Pure; the read passed in is not changed. */
export function applyScanChoices(read: PrintedRead, choices: ScanChoice[]): PrintedRead {
  if (choices.length === 0) return read
  const byKey = new Map(choices.map((c) => [`${c.rowKey}#${c.column}`, c]))
  return {
    ...read,
    statements: read.statements.map((st) => ({
      ...st,
      rows: st.rows.map((row) => {
        if (!row.scan) return row
        let changed = false
        const amounts = [...row.amounts]
        const cells = row.scan.cells.map((cell, i) => {
          const choice = byKey.get(`${row.scan!.key}#${i}`)
          if (!choice) return cell
          changed = true
          amounts[i] = choice.value
          return { ...cell, status: 'chosen' as const, chosenBy: choice.chosenBy, chosenAt: choice.chosenAt }
        })
        return changed ? { ...row, amounts, scan: { ...row.scan, cells } } : row
      }),
    })),
  }
}

export class ScanChoiceError extends Error {}

/** Keeps a staff choice. The line must be a scanned line of that document, in a column it has. */
export async function saveScanChoice(
  supabase: ServerClient,
  { clientId, documentId, rowKey, column, source, value, by }: { clientId: string; documentId: string; rowKey: string; column: number; source: ScanChoice['source']; value: number | null; by: string },
  read: PrintedRead | null,
): Promise<void> {
  const row = read?.statements.flatMap((s) => s.rows).find((r) => r.scan?.key === rowKey)
  if (!row?.scan || column < 0 || column >= row.scan.cells.length) throw new ScanChoiceError('That figure is not a scanned figure of this file.')
  const cell = row.scan.cells[column]
  if (source === 'tesseract') throw new ScanChoiceError('That reading is no longer used.')
  if (source === 'claude' && cell.claude !== value) throw new ScanChoiceError('That reading does not print this figure.')
  if (value !== null && !Number.isFinite(value)) throw new ScanChoiceError('Type the figure as printed, e.g. 1,234 or (1,234).')
  const { error } = await supabase.from('scan_figure_choices').upsert({
    client_id: clientId,
    document_id: documentId,
    row_key: rowKey,
    column_index: column,
    source,
    value,
    chosen_by: by,
    chosen_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Could not save the choice: ${error.message}`)
}
