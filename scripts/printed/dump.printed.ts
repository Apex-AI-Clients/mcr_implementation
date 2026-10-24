import { it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { readPdfPageCells } from '@/lib/pdf/pageLines'
import { PDF_DIR, PRINTED_DIR, readManifest } from './regression'

/**
 * `npm run printed:dump` — every PDF's text layer, page by page, each cell
 * with its left and right edge, into verified-figures/printed/<alias>/<doc>.txt
 * (gitignored). What expected files are written from, beside the page itself.
 * PRINTED_ALIAS=client-f dumps one client.
 */
it('dumps the text layer of every regression PDF', async () => {
  const only = process.env.PRINTED_ALIAS?.trim()
  for (const [alias, entry] of Object.entries(readManifest())) {
    if (only && alias !== only) continue
    mkdirSync(path.join(PRINTED_DIR, alias), { recursive: true })
    for (const doc of entry.documents) {
      const { pages } = await readPdfPageCells(new Uint8Array(readFileSync(path.join(PDF_DIR, alias, doc.file))), 200)
      const text = pages
        .map((lines, i) => [`=== page ${i + 1} ===`, ...lines.map((l) => l.cells.map((c) => `[${c.x.toFixed(0)}-${c.right.toFixed(0)}] ${c.text}`).join('  |  '))].join('\n'))
        .join('\n')
      writeFileSync(path.join(PRINTED_DIR, alias, `${doc.documentId}.txt`), text)
    }
  }
})
