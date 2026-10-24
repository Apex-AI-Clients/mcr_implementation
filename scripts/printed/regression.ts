import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** Everything here is under /verified-figures/ (gitignored). */
export const VERIFIED_DIR = path.resolve(process.cwd(), 'verified-figures')
export const PDF_DIR = path.join(VERIFIED_DIR, 'pdfs')
export const PRINTED_DIR = path.join(VERIFIED_DIR, 'printed')

export interface ManifestDocument {
  documentId: string
  /** The PDF's name under pdfs/<alias>/. */
  file: string
  originalFilename: string
  category: string
}

/** pdfs/manifest.json: alias -> the client's financial PDFs. Aliases only, never names. */
export type Manifest = Record<string, { clientId: string; documents: ManifestDocument[] }>

export function readManifest(): Manifest {
  const file = path.join(PDF_DIR, 'manifest.json')
  if (!existsSync(file)) throw new Error('verified-figures/pdfs/manifest.json not found (scripts/printed/README.md)')
  return JSON.parse(readFileSync(file, 'utf8')) as Manifest
}

/** <alias>/<documentId>.expected.json: the as-printed rows, written by hand from the PDF. */
export interface ExpectedDocument {
  documentId: string
  /** 'unverified': written but not yet checked against the PDF by staff. */
  status: 'verified' | 'unverified'
  checkedBy: string
  statements: {
    kind: string
    title: string
    pages: number[]
    columns: { header: string; periodStart: string | null; periodEnd: string; kind: string; financialYear: number }[]
    rows: { page: number; path: string[]; label: string; style: string; amounts: (number | string | null)[] }[]
  }[]
  /** The PDF's own arithmetic errors: "<title>|<row label>|<column header>". */
  pdfErrors: string[]
}

export function readExpected(alias: string, documentId: string): ExpectedDocument | null {
  const file = path.join(PRINTED_DIR, alias, `${documentId}.expected.json`)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ExpectedDocument) : null
}
