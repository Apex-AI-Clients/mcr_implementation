import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ComparisonDocument } from '@/lib/printed/compare'
import { readPrintedStatements } from '@/lib/printed/readPdf'
import { tesseractEngine } from '@/lib/scan/ocr'
import { readScannedPdf, type SecondReading } from '@/lib/scan/readScanned'
import { parseScanAnswer } from '@/lib/scan/claudeReader'

/**
 * Clients whose statements include scans (verified-figures/scans/<alias>/):
 * their comparison as the app builds it, offline and free. Text-layer PDFs by
 * the exact reader; each scan read again by Tesseract with Claude's stored
 * transcription reused (the job's own path, src/lib/scan): no model call, the
 * same result every time. Local only: the PDFs and transcriptions are gitignored.
 */

const SCANS = path.resolve(process.cwd(), 'verified-figures', 'scans')

interface Manifest {
  pdfDir: string
  documents: { documentId: string; filename: string; scan?: boolean }[]
}

export function scanAliases(): string[] {
  if (!existsSync(SCANS)) return []
  return readdirSync(SCANS).filter((a) => existsSync(path.join(SCANS, a, 'manifest.json')))
}

export async function replayDocuments(alias: string): Promise<ComparisonDocument[]> {
  const dir = path.join(SCANS, alias)
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest
  const ocr = await tesseractEngine()
  try {
    const out: ComparisonDocument[] = []
    for (const d of manifest.documents) {
      const bytes = new Uint8Array(readFileSync(path.resolve(process.cwd(), 'verified-figures', manifest.pdfDir, `${d.documentId}.pdf`)))
      let read
      if (d.scan) {
        const stored = JSON.parse(readFileSync(path.join(dir, `${d.documentId}.claude.json`), 'utf8')) as Record<string, { model: string; generationId: string; answer: unknown }>
        const reuse = new Map<number, SecondReading>(
          Object.entries(stored).map(([page, s]) => [Number(page), { answer: parseScanAnswer(JSON.stringify(s.answer)), model: s.model, generationId: s.generationId, tokensIn: 0, tokensOut: 0 }]),
        )
        read = (await readScannedPdf(bytes, { ocr, second: null, secondPagesAllowed: 0, reuse }))!.read
      } else {
        read = await readPrintedStatements(bytes)
      }
      out.push({ documentId: d.documentId, filename: d.filename, uploadedAt: '', read })
    }
    return out
  } finally {
    await ocr.close()
  }
}
