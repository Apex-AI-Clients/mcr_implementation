/**
 * Numbered overlay of every box, ruled line and checkbox find_boxes.py found.
 *
 * usage: npx tsx tools/forms-mapping/number_boxes.ts form.pdf geo.json out.pdf
 *
 * Open out.pdf (or render it) and read the ids off it to write the form's map.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

interface GeoItem { id: string; k: 'box' | 'line' | 'chk'; x0: number; top: number; x1: number; bot: number }

async function main() {
  const [pdfPath, geoPath, outPath] = process.argv.slice(2)
  const geo = JSON.parse(readFileSync(geoPath, 'utf8')) as Record<string, GeoItem[]>
  const doc = await PDFDocument.load(readFileSync(pdfPath))
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  for (const [pi, items] of Object.entries(geo)) {
    const page = doc.getPage(Number(pi))
    const H = page.getHeight()
    for (const t of items) {
      const color = t.k === 'chk' ? rgb(0.9, 0, 0) : t.k === 'line' ? rgb(0, 0.6, 0) : rgb(0.9, 0.4, 0)
      page.drawRectangle({ x: t.x0, y: H - t.bot, width: t.x1 - t.x0, height: t.bot - t.top, borderColor: color, borderWidth: 0.6 })
      page.drawText(t.id, { x: t.k === 'chk' ? t.x0 - 16 : t.x1 - 22, y: H - t.bot + 3, size: 7, font, color })
    }
  }
  writeFileSync(outPath, await doc.save())
}

void main()
