'use client'

import { useState } from 'react'
import { FileDown } from 'lucide-react'
import { Button } from '@/components/ui/Button'

// Shared "Export PDF" button. Rasterises a page region (identified by element
// id) to a multi-page A4 PDF using html2canvas-pro + jsPDF, downloaded directly
// (no print dialog). html2canvas-pro is used over html2canvas because Tailwind
// v4 emits color-mix()/oklch, which the original library cannot parse.
//
// Content selection mirrors a print stylesheet via marker classes on the page:
//   - .no-print      → hidden in the export (buttons, back links)
//   - .print:hidden  → hidden in the export (screen-only panels)
//   - .print:block   → revealed in the export (export-only blocks)
// Pages without those classes simply export everything inside the target.

function parseRgb(color: string): [number, number, number] {
  const m = color.match(/(\d+(?:\.\d+)?)/g)
  if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])]
  return [15, 19, 34] // dark-theme --mcr-primary fallback (#0F1322)
}

interface Props {
  /** id of the DOM element whose contents should be exported. */
  targetId: string
  /** Base filename (without extension); sanitised before use. */
  fileName: string
}

export function ExportPdfButton({ targetId, fileName }: Props) {
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    const node = document.getElementById(targetId)
    if (!node) return
    setDownloading(true)
    let clone: HTMLElement | null = null
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
      ])

      const bgColor = getComputedStyle(document.body).backgroundColor || 'rgb(15, 19, 34)'
      const bgRgb = parseRgb(bgColor)

      // 1. Off-screen clone with the export content selection applied. Cloning
      // (rather than mutating the live DOM) avoids any on-screen flicker.
      const width = node.offsetWidth
      clone = node.cloneNode(true) as HTMLElement
      clone.removeAttribute('id')
      clone.style.position = 'fixed'
      clone.style.left = '-10000px'
      clone.style.top = '0'
      clone.style.width = `${width}px`
      clone.style.background = bgColor
      document.body.appendChild(clone)
      clone
        .querySelectorAll<HTMLElement>('.no-print, .print\\:hidden')
        .forEach((el) => (el.style.display = 'none'))
      clone
        .querySelectorAll<HTMLElement>('.print\\:block')
        .forEach((el) => (el.style.display = 'block'))
      // html2canvas mis-rasterises box-shadow (renders it as a grey fill over
      // the element). Only light mode adds a shadow to .rounded-xl cards, so
      // strip shadows ONLY in light mode — dark mode renders correctly untouched
      // and stripping there itself triggers breakage. Detect light by background
      // luminance rather than the theme attribute (its location varies).
      const isLight = 0.299 * bgRgb[0] + 0.587 * bgRgb[1] + 0.114 * bgRgb[2] > 140
      if (isLight) {
        clone.querySelectorAll<HTMLElement>('*').forEach((el) => (el.style.boxShadow = 'none'))
      }

      // Let fonts and the freshly-inserted off-screen layout settle before
      // capture, otherwise the first section can rasterise mid-layout.
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready
        } catch {
          /* fonts API unavailable — proceed */
        }
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )

      // 2. Capture the WHOLE region in a single html2canvas pass (one render →
      // deterministic, matches the on-screen layout). Record each visible
      // top-level section's vertical bounds so we can paginate at boundaries.
      const scale = 2
      const bounds: Array<{ top: number; bottom: number }> = []
      for (const child of Array.from(clone.children)) {
        const el = child as HTMLElement
        if (el.offsetHeight === 0 || getComputedStyle(el).display === 'none') continue
        bounds.push({ top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight })
      }

      const canvas = await html2canvas(clone, { scale, useCORS: true, backgroundColor: bgColor })

      // 3. Paginate. Group whole sections onto each background-filled, padded
      // page; only a section taller than one page is sliced internally, so
      // cards are never cut mid-content.
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const pad = 24
      const usableW = pageWidth - pad * 2
      const usableH = pageHeight - pad * 2
      const pxPerPt = canvas.width / usableW
      const usableHpx = usableH * pxPerPt

      const fillPage = () => {
        pdf.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2])
        pdf.rect(0, 0, pageWidth, pageHeight, 'F')
      }

      // Crop [topPx, bottomPx] of the full canvas onto a (possibly new) page.
      const addSlice = (topPx: number, bottomPx: number, newPage: boolean) => {
        const h = Math.round(bottomPx - topPx)
        if (h <= 0) return
        const tmp = document.createElement('canvas')
        tmp.width = canvas.width
        tmp.height = h
        const ctx = tmp.getContext('2d')
        if (ctx) {
          ctx.fillStyle = bgColor
          ctx.fillRect(0, 0, tmp.width, tmp.height)
          ctx.drawImage(canvas, 0, topPx, canvas.width, h, 0, 0, canvas.width, h)
        }
        if (newPage) pdf.addPage()
        fillPage()
        pdf.addImage(tmp.toDataURL('image/png'), 'PNG', pad, pad, usableW, h / pxPerPt)
      }

      const secs = bounds.map((b) => ({ top: b.top * scale, bottom: b.bottom * scale }))
      let i = 0
      let firstPage = true
      while (i < secs.length) {
        const pageTop = secs[i].top
        let j = i
        while (j < secs.length && secs[j].bottom - pageTop <= usableHpx) j++

        if (j === i) {
          // This section alone is taller than a page — slice it across pages.
          let sy = secs[i].top
          while (sy < secs[i].bottom) {
            const h = Math.min(usableHpx, secs[i].bottom - sy)
            addSlice(sy, sy + h, !firstPage)
            firstPage = false
            sy += h
          }
          i++
        } else {
          addSlice(pageTop, secs[j - 1].bottom, !firstPage)
          firstPage = false
          i = j
        }
      }

      if (firstPage) fillPage() // nothing captured — leave a single filled page

      const safe = fileName.replace(/[^a-z0-9-]+/gi, '_')
      pdf.save(`${safe}.pdf`)
    } catch (err) {
      console.error('PDF download failed', err)
    } finally {
      if (clone && clone.parentNode) clone.parentNode.removeChild(clone)
      setDownloading(false)
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleDownload} disabled={downloading}>
      {downloading ? (
        'Exporting…'
      ) : (
        <>
          <FileDown className="h-3.5 w-3.5" />
          Export PDF
        </>
      )}
    </Button>
  )
}
