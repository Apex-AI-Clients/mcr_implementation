import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ComparisonDocument } from '@/lib/printed/compare'
import { readPrintedStatements } from '@/lib/printed/readPdf'
import { readScannedPdf, type KeptReading } from '@/lib/scan/readScanned'
import { parseScanAnswer, type ScanPageAnswer } from '@/lib/scan/claudeReader'
import { tesseractTitles } from '@/lib/scan/ocr'

/**
 * Clients whose statements include scans (verified-figures/scans/<alias>/):
 * their comparison as the app builds it, offline and free. Text-layer PDFs by
 * the exact reader; each scan through the job's own path (src/lib/scan):
 * Tesseract reads the page titles again (on this machine), Claude's stored
 * transcriptions are reused: no model call, the same result every time.
 * Local only: the PDFs and readings are gitignored.
 *
 *   <documentId>.claude.json  { "transcriptions": { page: kept } }
 */

const SCANS = path.resolve(process.cwd(), 'verified-figures', 'scans')

interface Manifest {
  pdfDir: string
  documents: { documentId: string; filename: string; scan?: boolean }[]
}

type StoredReadings = Record<string, { model: string; generationId: string; answer: unknown }>

interface Stored {
  transcriptions?: StoredReadings
}

export function scanAliases(): string[] {
  if (!existsSync(SCANS)) return []
  return readdirSync(SCANS).filter((a) => existsSync(path.join(SCANS, a, 'manifest.json')))
}

function kept<T>(entries: StoredReadings | undefined, parse: (text: string) => T): Map<number, KeptReading<T>> {
  return new Map(Object.entries(entries ?? {}).map(([page, s]) => [Number(page), { answer: parse(JSON.stringify(s.answer)), model: s.model, generationId: s.generationId }]))
}

export async function replayDocuments(alias: string): Promise<ComparisonDocument[]> {
  const dir = path.join(SCANS, alias)
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest
  const out: ComparisonDocument[] = []
  const titles = await tesseractTitles()
  try {
    for (const d of manifest.documents) {
      const bytes = new Uint8Array(readFileSync(path.resolve(process.cwd(), 'verified-figures', manifest.pdfDir, `${d.documentId}.pdf`)))
      let read
      if (d.scan) {
        const stored = JSON.parse(readFileSync(path.join(dir, `${d.documentId}.claude.json`), 'utf8')) as Stored
        const reuse = { transcriptions: kept<ScanPageAnswer>(stored.transcriptions, parseScanAnswer) }
        read = (await readScannedPdf(bytes, { titles, reader: null, pagesAllowed: 0, reuse }))!.read
      } else {
        read = await readPrintedStatements(bytes)
      }
      out.push({ documentId: d.documentId, filename: d.filename, uploadedAt: '', read })
    }
  } finally {
    await titles.close()
  }
  return out
}
