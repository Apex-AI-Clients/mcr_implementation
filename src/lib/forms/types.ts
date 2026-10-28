/**
 * The shape of a form map: where every answer goes on an official ASIC PDF.
 *
 * One schema for every form and version (Form 509, Form 507 Part A, Part B).
 * Coordinates are PDF points measured from the TOP-left of the template page
 * (what pdfplumber reports); the engine converts to pdf-lib's bottom-left.
 * Pages are 1-based template page numbers.
 */

export interface Box {
  x0: number
  top: number
  x1: number
  bot: number
}

interface FieldBase {
  key: string
  /** The form's own question number ("B14", "A4"), or a section name. */
  q: string
  label: string
  page: number
  /**
   * Filled in by hand on the printout: the engine never draws it and the app
   * never stores it (Part B B6 user name/password, B1 address).
   */
  handwritten?: boolean
}

export type FormField =
  | (FieldBase & Box & {
      type: 'text'
      pad?: number
      size?: number
      align?: 'left' | 'center' | 'right'
      /** Write a date value as DD/MM/YYYY in a plain box. */
      format?: 'date'
    })
  /** A long answer over the printed ruled lines (or stacked boxes). */
  | (FieldBase & { type: 'lines'; lines: Box[] })
  | (FieldBase & Box & {
      type: 'money'
      /** Where the text starts when a "$" is printed in the box; otherwise right-aligned. */
      startX?: number
      /** Write the "$" ourselves (the box has none printed). */
      currency?: boolean
    })
  /** A box with two printed "/" separators: DD / MM / YYYY around them. */
  | (FieldBase & Box & { type: 'date'; slashes: [number, number]; slashWidth?: number })
  /** One character per printed cell (Form 509: D D M M Y Y). */
  | (FieldBase & { type: 'datecells'; cells: Box[] })
  /** A Yes/No question: a tick in one of two printed checkboxes. */
  | (FieldBase & { type: 'yesno'; yes: Box; no: Box })
  /** One of several printed checkboxes, by option name (Part A: type of appointment). */
  | (FieldBase & { type: 'choice'; options: Record<string, Box> })

export type FieldType = FormField['type']

/** A spot on an appendix page's header or footer, e.g. the "___" after "Page". */
export interface TextSpot {
  x0: number
  x1: number
  baseline: number
}

export interface TableColumn {
  key: string
  label: string
  type: 'text' | 'money' | 'date' | 'check'
  x0: number
  x1: number
  /** money: x of the "$" printed in each cell. */
  dollar?: number
  /** check: the printed checkbox glyph, x and its offset below the row top. */
  glyph?: { x0: number; dy: number }
  /** date: the two printed "/" separators. */
  slashes?: [number, number]
}

export interface FormTable {
  /** Key of the rows in FormData.tables, e.g. "B28", "A6_related". */
  id: string
  q: string
  title: string
  /** Template page of the appendix table. Two tables can share a page (Part A A6). */
  page: number
  /** Form page that asks for the table: "This is the annexure of Page/s _ of _". */
  formPage: number
  columns: TableColumn[]
  /** Printed data rows, top to bottom. More rows than this → another copy of the page. */
  rows: { top: number; bot: number }[]
  /**
   * The table is printed slightly rotated (Part A A7): points the rows move
   * down per point of x. Measured at x = skewOrigin.
   */
  skew?: number
  skewOrigin?: number
  /** A printed "Total" row: money columns are summed into it, on the last page. */
  totals?: { top: number; bot: number }
  header: {
    pageFrom: TextSpot
    pageOf: TextSpot
    signedBy: TextSpot
    dated: { s1: number; s2: number; slashWidth: number; baseline: number }
  }
  footer: { page: TextSpot; of: TextSpot }
}

export interface FormQuestion {
  q: string
  page: number
  text: string
  section?: string
}

export type FormCode = '509' | '507a' | '507b'

export interface FormMap {
  code: FormCode
  form: string
  /** ASIC's version date of the template, e.g. "20220801". */
  version: string
  /** Document title written into the output PDF. */
  title: string
  /** Pages in the template, checked on load so a wrong PDF is refused. */
  pageCount: number
  /** Template pages printed, in order. */
  formPages: number[]
  /** Template pages left out unless asked for by id (Part A p7, Form 507A). */
  optionalPages?: { id: string; page: number; label: string }[]
  /** "Page/s _ of N" on the appendix headers: the form's own page count. */
  formPageTotal: number
  /** The appendix cover, added before the first appendix table that is used. */
  appendixCoverPage?: number
  questions: FormQuestion[]
  fields: FormField[]
  tables: FormTable[]
  /** Fields the engine fills as the sum of others when not given (Form 509 totals). */
  computed?: { key: string; sum: string[] }[]
}

export type FieldValue = string | number | boolean | null | undefined
export type TableRow = Record<string, FieldValue>

export interface FormData {
  fields: Record<string, FieldValue>
  tables?: Record<string, TableRow[]>
  /** Printed on every appendix table header ("signed by ... and dated"). */
  signedBy?: string
  signedDate?: string
}

export interface FormWarning {
  key: string
  q?: string
  message: string
}

export interface FillOptions {
  /** Optional page ids to print (e.g. "507a"). None by default. */
  include?: string[]
  /** "used" (default): appendix tables with rows only; "all": every table page; "none". */
  tables?: 'used' | 'all' | 'none'
  ink?: 'blue' | 'black'
  /** Outline every mapped box in red: for checking a map, never for output. */
  debug?: boolean
}

export interface FillResult {
  pdf: Uint8Array
  warnings: FormWarning[]
  pages: number
}
