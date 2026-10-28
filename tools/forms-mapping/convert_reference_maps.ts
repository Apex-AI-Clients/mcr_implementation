/**
 * Moves the two maps from the reference project onto the shared schema
 * (src/lib/forms/types.ts):
 *
 *   - Form 507 Part B (1 Aug 2022): converted from the reference
 *     form507-partb-20220801.json (216 fields, checked on the official pages).
 *     The signature box is dropped (signed by hand), and B6 user name and
 *     password and the B1 address become `handwritten`: never drawn, never
 *     stored.
 *   - Form 509 (17 Jan 2011): the coordinates measured in the reference
 *     form509-core.js, written out as a map.
 *
 * usage: npx tsx tools/forms-mapping/convert_reference_maps.ts <reference>/lib/forms/maps/form507-partb-20220801.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Box, FormField, FormMap, FormTable, TableColumn } from '../../src/lib/forms/types'

/* ======================= Form 507 Part B ======================= */

type RefField = Record<string, unknown> & { key: string; type: string }
interface RefColumn { key: string; label: string; type: TableColumn['type']; x0: number; x1: number; dollar?: number; glyphX?: number; glyphDy?: number; s1?: number; s2?: number }
interface RefTable {
  q: string; page: number; title: string; partBPage: number; columns: RefColumn[]; rows: { top: number; bot: number }[]
  header: { baseline: number; pageFrom: number[]; pageOf: number[]; signedBy: number[]; dated: number[] }
  footer: { baseline: number; page: number[]; of: number[] }
}

// B31's date sits beside the signature: dated by hand on the day.
const HANDWRITTEN = new Set(['b6_username', 'b6_password', 'b1_address', 'b1_street', 'b1_suburb', 'b1_state', 'b1_postcode', 'b31_date'])

const ref = JSON.parse(readFileSync(process.argv[2], 'utf8')) as {
  questions: FormMap['questions']; fields: RefField[]; tables: RefTable[]
}

const partBFields: FormField[] = ref.fields
  .filter((f) => f.type !== 'image')
  .map((f) => {
    const { s1, s2, sensitive, ...rest } = f as RefField & { s1?: number; s2?: number; sensitive?: boolean }
    void sensitive
    const out = { ...rest } as Record<string, unknown>
    if (f.type === 'date') out.slashes = [s1, s2]
    if (HANDWRITTEN.has(f.key)) out.handwritten = true
    return out as unknown as FormField
  })

const partBTables: FormTable[] = ref.tables.map((t) => {
  const spot = (r: number[], baseline: number) => ({ x0: r[0], x1: r[1], baseline })
  return {
    id: t.q,
    q: t.q,
    title: t.title,
    page: t.page,
    formPage: t.partBPage,
    columns: t.columns.map((c) => {
      const col: TableColumn = { key: c.key, label: c.label, type: c.type, x0: c.x0, x1: c.x1 }
      if (c.dollar !== undefined) col.dollar = c.dollar
      if (c.glyphX !== undefined) col.glyph = { x0: c.glyphX, dy: c.glyphDy ?? 0 }
      if (c.s1 !== undefined && c.s2 !== undefined) col.slashes = [c.s1, c.s2]
      return col
    }),
    rows: t.rows,
    header: {
      pageFrom: spot(t.header.pageFrom, t.header.baseline),
      pageOf: spot(t.header.pageOf, t.header.baseline),
      signedBy: spot(t.header.signedBy, t.header.baseline),
      // The reference drew the header date's month at s1 + 3.2 and the year
      // at s2 + 5.5; the engine places them at s1 + 0.62w and s2 + w + 1.2.
      dated: { s1: t.header.dated[0], s2: t.header.dated[1], slashWidth: 5.16, baseline: t.header.baseline },
    },
    footer: { page: spot(t.footer.page, t.footer.baseline), of: spot(t.footer.of, t.footer.baseline) },
  }
})

const partB: FormMap = {
  code: '507b',
  form: 'ASIC Form 507 - Report on Company Activities and Property - Part B',
  version: '20220801',
  title: 'Report on Company Activities and Property - Part B',
  pageCount: 14,
  formPages: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  formPageTotal: 9,
  appendixCoverPage: 10,
  questions: ref.questions,
  fields: partBFields,
  tables: partBTables,
}

/* ======================= Form 509 ======================= */

// Measured from the official PDF (A4). Text boxes: x, top, width, height.
const tb = (x: number, top: number, w: number, h = 13.7): Box => ({ x0: x, top, x1: round(x + w), bot: round(top + h) })
// The six single-character date cells: D D / M M / Y Y.
const DATE_X = [177.4, 195.6, 216.0, 234.3, 254.6, 272.9]
const cells = (top: number): Box[] => DATE_X.map((x) => tb(x, top, 13.6))
// Money columns on page 2. The reference wrote amounts right-aligned with
// their baseline 1.2pt above the row's bottom rule; the engine writes at
// bot − 4.5, so the boxes end 3.3pt below that rule.
const COL = { val: [400.2, 483.4], erv: [483.4, 566.7] } as const
const money = (key: string, q: string, label: string, col: keyof typeof COL, bottom: number): FormField => ({
  key, q, label, type: 'money', page: 2, currency: true,
  x0: COL[col][0], x1: COL[col][1], top: round(bottom - 10), bot: round(bottom + 3.3),
})
const text509 = (key: string, q: string, label: string, page: number, b: Box, extra: Partial<FormField> = {}): FormField =>
  ({ key, q, label, type: 'text', page, ...b, ...extra }) as FormField

const LODGE = 'Lodgement details'
const COMPANY = 'Company details'
const ASSETS = 'Summary of assets'
const LIAB = 'Summary of liabilities'
const SIGN = 'Signature'
const assetRows: [string, string, number][] = [
  ['a', '1(a) Interest in land', 114.4],
  ['b', '1(b) Sundry debtors', 126.2],
  ['c', '1(c) Cash on hand', 138.0],
  ['d', '1(d) Cash at bank', 149.8],
  ['e', '1(e) Stock as detailed in inventory', 161.6],
  ['f', '1(f) Work in progress', 173.4],
  ['g', '1(g) Plant and machinery', 185.2],
  ['h', '1(h) Other assets', 197.0],
  ['s2', '2 Assets subject to specific charges less amounts owing', 220.5],
]

const f509Fields: FormField[] = [
  text509('contact_name', LODGE, 'Name (who ASIC should contact)', 1, tb(177.4, 223.1, 389.3)),
  text509('agent_number', LODGE, 'ASIC registered agent number (if applicable)', 1, tb(177.4, 252.3, 389.3)),
  text509('entity_name', LODGE, 'Company/entity name', 1, tb(177.4, 281.5, 389.3)),
  text509('entity_number', LODGE, 'ACN/ABN/ARBN/ARSN', 1, tb(177.4, 310.7, 155.4)),
  text509('phone', LODGE, 'Telephone number', 1, tb(177.4, 339.9, 155.4)),
  text509('postal_1', LODGE, 'Postal address (line 1)', 1, tb(177.4, 369.1, 389.3)),
  text509('postal_2', LODGE, 'Postal address (line 2)', 1, tb(177.4, 386.1, 389.3)),
  text509('email', LODGE, 'Email address (optional)', 1, tb(177.4, 415.3, 389.3)),
  text509('company_name', COMPANY, 'Company name', 1, tb(177.4, 467.9, 389.3)),
  text509('company_acn', COMPANY, 'ACN', 1, tb(177.4, 497.1, 249.9)),
  { key: 'summary_date', q: COMPANY, label: 'Date to which summary is made up', type: 'datecells', page: 1, cells: cells(575.2) },
  ...assetRows.flatMap(([k, label, bottom]) => [
    money(`${k}_val`, ASSETS, `${label}: Valuation`, 'val', bottom),
    money(`${k}_erv`, ASSETS, `${label}: Estimated realisable value`, 'erv', bottom),
  ]),
  money('total_assets', ASSETS, 'TOTAL assets (valuation)', 'val', 246.0),
  money('total_erv', ASSETS, 'TOTAL estimated realisable values', 'erv', 271.4),
  money('r3', LIAB, '3 Less preferential creditors (priority over floating charge)', 'erv', 305.7),
  text509('r4_to', LIAB, '4 Secured by debenture/floating charge: to whom', 2, tb(316.5, 330.6, 82, 10.5), { size: 7 }),
  money('r4', LIAB, '4 Less amounts owing and secured by debenture/floating charge', 'erv', 340.1),
  money('r5', LIAB, '5 Estimated amount available for unsecured creditors', 'erv', 374.5),
  money('r6', LIAB, '6 Creditors (unsecured) amount claimed', 'erv', 398.0),
  money('r7_claims', LIAB, '7 Partly secured creditors: total claims', 'erv', 421.6),
  money('r7_security', LIAB, '7 Partly secured creditors: security held', 'erv', 432.4),
  money('r8', LIAB, '8 Contingent assets estimated to produce', 'erv', 455.9),
  money('r9', LIAB, '9 Estimated deficiency/surplus', 'erv', 490.3),
  money('share_issued', LIAB, 'Share capital issued', 'erv', 512.9),
  money('share_paid', LIAB, 'Share capital paid up', 'erv', 524.7),
  text509('signer_name', SIGN, 'Name of person signing', 2, tb(177.4, 588.7, 389.3)),
  text509('capacity', SIGN, 'Capacity (director or secretary)', 2, tb(177.4, 617.8, 389.3)),
  // tb(177.4, 647.0, 389.3, 22.2) is the signature: signed by hand, and so is its date.
  { key: 'date_signed', q: SIGN, label: 'Date signed', type: 'datecells', page: 2, cells: cells(684.7), handwritten: true },
]

const f509: FormMap = {
  code: '509',
  form: 'ASIC Form 509 - Presentation of summary of affairs of a company',
  version: '2011',
  title: 'Presentation of summary of affairs of a company (Form 509)',
  pageCount: 3,
  // Page 3 is ASIC's guide ("does not form part of the form").
  formPages: [1, 2],
  formPageTotal: 2,
  questions: [LODGE, COMPANY, ASSETS, LIAB, SIGN].map((q) => ({
    q, page: q === LODGE || q === COMPANY ? 1 : 2, text: q,
  })),
  fields: f509Fields,
  tables: [],
  computed: [
    { key: 'total_assets', sum: assetRows.map(([k]) => `${k}_val`) },
    { key: 'total_erv', sum: assetRows.map(([k]) => `${k}_erv`) },
  ],
}

function round(n: number) {
  return Math.round(n * 100) / 100
}

for (const [map, path] of [
  [partB, 'src/lib/forms/maps/form507-partb-20220801.json'],
  [f509, 'src/lib/forms/maps/form509-2011.json'],
] as const) {
  const keys = map.fields.map((f) => f.key)
  const dups = keys.filter((k, i) => keys.indexOf(k) !== i)
  if (dups.length) throw new Error(`${map.code}: duplicate keys ${dups.join(', ')}`)
  writeFileSync(path, `${JSON.stringify(map, null, 1)}\n`)
  console.log(map.code, 'fields', map.fields.length, 'yes/no', map.fields.filter((f) => f.type === 'yesno').length,
    'handwritten', map.fields.filter((f) => f.handwritten).length, 'tables', map.tables.length)
}
