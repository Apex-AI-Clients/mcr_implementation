/**
 * Builds src/lib/forms/maps/form507-parta-20220801.json: every fillable spot
 * on ASIC Form 507 Part A (1 Aug 2022), including Form 507A (page 7) and the
 * appendix tables A4–A7.
 *
 * usage:
 *   python -I find_boxes.py  asic-form-507-parta-20220801.pdf geo.json
 *   python -I find_tables.py asic-form-507-parta-20220801.pdf tables.json 9 10 11 12
 *   npx tsx tools/forms-mapping/build_parta_map.ts geo.json tables.json out.json
 *
 * Box ids (b12, c3, …) are the ones number_boxes.ts prints on the overlay.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Box, FormField, FormMap, FormQuestion, FormTable, TableColumn, TextSpot } from '../../src/lib/forms/types'

interface GeoItem extends Box {
  id: string
  k: 'box' | 'line' | 'chk'
  slashes?: number[]
}
interface Word extends Box {
  t: string
}
interface TablePage {
  grids: { bbox: number[]; rows: { top: number; bot: number; cells: ([number, number] | null)[] }[] }[]
  words: Word[]
  glyphs: (Box & { t: string })[]
}

const [geoPath, tablesPath, outPath] = process.argv.slice(2)
const geoRaw = JSON.parse(readFileSync(geoPath, 'utf8')) as Record<string, GeoItem[]>
const geo = Object.fromEntries(
  Object.entries(geoRaw).map(([k, v]) => [Number(k) + 1, Object.fromEntries(v.map((t) => [t.id, t]))]),
) as Record<number, Record<string, GeoItem>>
const tablePages = JSON.parse(readFileSync(tablesPath, 'utf8')) as Record<string, TablePage>

const fields: FormField[] = []
const questions: FormQuestion[] = []

function box(page: number, ref: string): Box {
  const t = geo[page][ref]
  if (!t) throw new Error(`No ${ref} on page ${page}`)
  return { x0: t.x0, top: t.top, x1: t.x1, bot: t.bot }
}
function question(q: string, page: number, text: string, section?: string) {
  questions.push({ q, page, text, ...(section ? { section } : {}) })
}
function text(key: string, q: string, label: string, page: number, ref: string, extra: Partial<FormField> = {}) {
  fields.push({ key, q, label, type: 'text', page, ...box(page, ref), ...extra } as FormField)
}
function lines(key: string, q: string, label: string, page: number, refs: string[]) {
  fields.push({ key, q, label, type: 'lines', page, lines: refs.map((r) => box(page, r)) })
}
function yesno(key: string, q: string, label: string, page: number, no: string, yes: string) {
  fields.push({ key, q, label, type: 'yesno', page, no: box(page, no), yes: box(page, yes) })
}
/** A date box with its two printed "/" (found by find_boxes.py). */
function date(key: string, q: string, label: string, page: number, ref: string, slashWidth?: number) {
  const t = geo[page][ref]
  if (!t.slashes || t.slashes.length !== 2) throw new Error(`${ref} on page ${page} has no two slashes`)
  fields.push({
    key, q, label, type: 'date', page, ...box(page, ref),
    slashes: [t.slashes[0], t.slashes[1]],
    ...(slashWidth ? { slashWidth } : {}),
  })
}
/** Street box + "Suburb/City | State/Territory | Postcode" box split at the printed labels. */
function address(prefix: string, q: string, page: number, streetRef: string, splitRef: string, stateX: number, postX: number) {
  text(`${prefix}_street`, q, 'Street/Unit number and name', page, streetRef)
  const b = box(page, splitRef)
  fields.push({ key: `${prefix}_suburb`, q, label: 'Suburb/City', type: 'text', page, ...b, x1: stateX - 3 })
  fields.push({ key: `${prefix}_state`, q, label: 'State/Territory', type: 'text', page, ...b, x0: stateX - 3, x1: postX - 3, pad: 3 })
  fields.push({ key: `${prefix}_postcode`, q, label: 'Postcode', type: 'text', page, ...b, x0: postX - 3, pad: 3 })
}

/* ======================= PAGE 2: External Administrator ======================= */
let P = 2
const EA = 'External Administrator'
question(EA, P, 'External Administrator (lodging party)')
text('ea_organisation', EA, 'Organisation', P, 'b1')
text('ea_liquidator_number', EA, 'ASIC Registered Liquidator number (if applicable)', P, 'b2')
text('ea_name', EA, 'Name of External Administrator', P, 'b3')
text('ea_contact', EA, 'Contact person', P, 'b4')
text('ea_phone', EA, 'Phone number during business hours', P, 'b5')
text('ea_address', EA, 'Address', P, 'b6')
address('ea', EA, P, 'b7', 'b8', 172.32, 246.58)
fields.push({
  key: 'ea_role', q: EA, label: 'Type of appointment', type: 'choice', page: P,
  options: {
    receiver_manager: box(P, 'c9'),
    managing_controller: box(P, 'c11'),
    controller_director_report: box(P, 'c13'),
    court_liquidator: box(P, 'c15'),
    cvl_liquidator: box(P, 'c17'),
    voluntary_administrator: box(P, 'c19'),
  },
})
date('ea_receiver_appointment_date', EA, 'Receiver and Manager s421A(1) 507G: Appointment date', P, 'b10', 7.02)
date('ea_controller_control_date', EA, 'Managing Controller s421A(1) 507H: Date person took control', P, 'b12', 7.02)
date('ea_controller_report_date', EA, 'Controller s429(2)(b) 507F: Date received Report', P, 'b14', 7.02)
date('ea_court_report_date', EA, 'Court liquidator s475(1) 507C: Date received Report', P, 'b16', 7.02)
date('ea_cvl_report_date', EA, 'Liquidator, creditors’ voluntary winding up s497(4) 507D: Date received Report', P, 'b18', 7.02)
date('ea_va_report_date', EA, 'Voluntary Administrator s438B(2) 507K: Date received Report', P, 'b20', 7.02)

/* ======================= PAGE 3: EA dates, A1–A3 ======================= */
P = 3
// The three dates in the "External Administrator to complete" panel have no
// boxes of their own: only the printed slashes.
function inlineDate(key: string, label: string, s1: number, s2: number, slashTop: number) {
  fields.push({
    key, q: EA, label, type: 'date', page: P,
    x0: s1 - 24, top: slashTop, x1: s2 + 44, bot: slashTop + 18,
    slashes: [s1, s2], slashWidth: 7.02,
  })
}
inlineDate('ea_records_from', 'Director to provide the Company’s records for the period: From', 125.59, 202.81, 200.85)
inlineDate('ea_records_to', 'Director to provide the Company’s records for the period: To (appointment date)', 113.09, 190.23, 231.68)
inlineDate('ea_return_by', 'Director to return this Report to the External Administrator by', 103.23, 180.45, 339.86)
question('A1', P, 'Provide Company records for the dates shown, complete this form and send it to the External Administrator by the date shown.')
question('A2', P, 'Do you have the Instructions for completing this form?')
yesno('a2', 'A2', 'Do you have the Instructions for completing this form?', P, 'c2', 'c4')
question('A3', P, 'Company details')
text('company_name', 'A3', 'Name of Company under external administration', P, 'b5')
text('company_acn', 'A3', 'ACN/ABN', P, 'b6')
address('a3_registered', 'A3', P, 'b7', 'b8', 453.04, 527.31)
address('a3_principal', 'A3', P, 'b9', 'b10', 453.04, 527.31)
date('a3_commenced', 'A3', 'Date the Company commenced trading', P, 'b11')
date('a3_ceased', 'A3', 'Date the Company ceased trading', P, 'b12')

/* ======================= PAGE 4: A3 (cont.), A4, A5 ======================= */
P = 4
yesno('a3_other_places', 'A3', 'Does the Company have other places of business?', P, 'c1', 'c2')
address('a3_other', 'A3', P, 'b3', 'b4', 170.15, 244.42)
yesno('a3_trustee', 'A3', 'Is the Company a trustee of a Trust?', P, 'c5', 'c6')
lines('a3_trust_name', 'A3', 'Name of Trust', P, ['b7', 'b8'])
question('A4', P, 'Does the Company own any assets as listed below?', 'What the Company owns and owes (Assets and Liabilities)')
yesno('a4_bank', 'A4', 'Bank accounts', P, 'c9', 'c10')
yesno('a4_crypto', 'A4', 'Crypto assets or cryptocurrency', P, 'c11', 'c12')
yesno('a4_vehicles', 'A4', 'Motor vehicles', P, 'c13', 'c14')
yesno('a4_plant', 'A4', 'Plant and equipment', P, 'c15', 'c16')
yesno('a4_inventory', 'A4', 'Inventory', P, 'c17', 'c18')
yesno('a4_real_property', 'A4', 'Real property', P, 'c19', 'c20')
yesno('a4_other', 'A4', 'Other assets', P, 'c21', 'c22')
yesno('a4_property_on_trust', 'A4', 'Does the Company hold property on trust?', P, 'c23', 'c24')
yesno('a4_super_trustee', 'A4', 'Is the Company a trustee of a superannuation fund?', P, 'c25', 'c26')
lines('a4_no_assets', 'A4', 'If you ticked NO to all the items, explain why the Company has no assets', P, ['b27', 'b28', 'b29'])
question('A5', P, 'Is the Company owed money? (Debtors)')
yesno('a5', 'A5', 'Is the Company owed money? (Debtors)', P, 'c30', 'c31')

/* ======================= PAGE 5: A6, A7 ======================= */
P = 5
question('A6', P, 'Does the Company owe money to its employees?')
yesno('a6', 'A6', 'Does the Company owe money to its employees?', P, 'c1', 'c2')
const a6: [string, string][] = [
  ['wages', 'Wages or salary'], ['annual_leave', 'Annual leave (holiday pay)'], ['long_service', 'Long service leave'],
  ['super', 'Superannuation'], ['redundancy', 'Redundancy'], ['notice', 'Payment in lieu of notice'],
  ['other', 'Other (such as reimbursement of expenses)'],
]
a6.forEach(([k, label], i) => yesno(`a6_${k}`, 'A6', label, P, `c${3 + 2 * i}`, `c${4 + 2 * i}`))
question('A7', P, 'Does the Company owe money, goods or services to others (other than to employees)?')
const a7: [string, string][] = [
  ['suppliers', 'Suppliers of goods/services (including contractors and subcontractors)'],
  ['government', 'Government bodies (e.g. ASIC, local council)'], ['landlords', 'Landlords (e.g. rent)'],
  ['leased', 'Leased equipment or transport'], ['utilities', 'Utilities (gas, electricity, telephone, water)'],
  ['email_web', 'Email and web service providers'], ['banks', 'Banks (including credit cards)'],
  ['personal_loans', 'Personal loans'],
  ['tax', 'Tax (ATO for company tax, GST, PAYG, State Revenue Office for payroll tax/land tax)'],
  ['other', 'Other'],
]
a7.forEach(([k, label], i) => yesno(`a7_${k}`, 'A7', label, P, `c${17 + 2 * i}`, `c${18 + 2 * i}`))
text('a7_other_specify', 'A7', 'Other (please specify)', P, 'b37')

/* ======================= PAGE 6: A8–A10 ======================= */
P = 6
question('A8', P, 'Have you provided the full details asked for in Questions A4 to A7 including all attachments?')
yesno('a8', 'A8', 'Have you provided the full details asked for in Questions A4 to A7 including all attachments?', P, 'c1', 'c2')
question('A9', P, 'Declaration by Director, Secretary, Managing Controller, or person nominated by the External Administrator')
text('a9_name', 'A9', 'Name', P, 'b3')
text('a9_position', 'A9', 'Position', P, 'b4')
// b5 is the signature: signed by hand.
date('a9_date', 'A9', 'Date', P, 'b6')
question('A10', P, 'Declaration by Managing Controller')
text('a10_name', 'A10', 'Name', P, 'b7')
// b8 is the signature: signed by hand.
date('a10_date', 'A10', 'Date', P, 'b9')

/* ======================= PAGE 7: Form 507A (court liquidations only) ======================= */
P = 7
const F507A = 'Form 507A'
question(F507A, P, 'Statement verifying Report under s475(1) (court liquidations only)')
text('f507a_company_name', F507A, 'Company name', P, 'b23')
text('f507a_company_acn', F507A, 'ACN/ABN', P, 'b24')
// The "/" for these dates are printed outside the boxes on ASIC's PDF, so
// the dates are written whole: DD/MM/YYYY.
text('f507a_report_date', F507A, 'Date of Report under s475(1)', P, 'b25', { format: 'date' } as Partial<FormField>)
text('f507a_name', F507A, 'Name', P, 'b26')
text('f507a_capacity', F507A, 'Capacity', P, 'b27')
// b28 is the signature: signed by hand.
text('f507a_date_signed', F507A, 'Date signed', P, 'b29', { format: 'date' } as Partial<FormField>)

/* ======================= APPENDIX TABLES (pages 9–12) ======================= */

function word(tp: TablePage, t: string, near?: number): Word {
  const all = tp.words.filter((w) => w.t === t || (t === '....' && w.t.startsWith('....')))
  const w = near === undefined ? all[0] : all.sort((a, b) => Math.abs(a.top - near) - Math.abs(b.top - near))[0]
  if (!w) throw new Error(`No word ${t}`)
  return w
}

/**
 * Header ("This is the annexure of Page/s ___ of ___ ... signed by ... and
 * dated  /  /") and footer ("Page___of ___") spots, measured from the printed
 * words. Offsets match the Part B map, which was checked on paper.
 */
function headerFooter(tp: TablePage) {
  const from = word(tp, '_____of')
  const of = word(tp, '____')
  const dots = word(tp, '....')
  const slashes = tp.glyphs.filter((g) => g.t === '/' && Math.abs(g.top - dots.top) < 4).sort((a, b) => a.x0 - b.x0)
  const [s1, s2] = slashes.slice(-2)
  const pageWord = word(tp, 'Page___of')
  const ofWord = tp.words.filter((w) => w.t === '___').sort((a, b) => b.top - a.top)[0]
  const spot = (x0: number, x1: number, top: number): TextSpot => ({ x0: round(x0), x1: round(x1), baseline: round(top + 6.8) })
  return {
    header: {
      pageFrom: spot(from.x0, from.x0 + 28, from.top),
      pageOf: spot(of.x0, of.x1, of.top),
      signedBy: spot(dots.x0, dots.x1 - 2.4, dots.top),
      dated: { s1: s1.x0, s2: s2.x0, slashWidth: round(s1.x1 - s1.x0), baseline: round(s1.top + 6.8) },
    },
    footer: {
      page: spot(pageWord.x0 + 49.42, pageWord.x0 + 79.92, pageWord.top + 12.57),
      of: spot(ofWord.x0, ofWord.x0 + 25.1, ofWord.top + 12.57),
    },
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100
}

/** Column x-ranges from the grid's first row; "$", "/" and checkbox glyphs found inside each. */
function columns(tp: TablePage, cells: [number, number][], defs: [string, string, TableColumn['type']][], firstRowTop: number, firstRowBot: number): TableColumn[] {
  return defs.map(([key, label, type], i) => {
    const [x0, x1] = cells[i]
    const inRow = tp.glyphs.filter((g) => g.x0 >= x0 - 1 && g.x0 <= x1 && g.top >= firstRowTop - 3 && g.top <= firstRowBot)
    const col: TableColumn = { key, label, type, x0, x1 }
    if (type === 'money') {
      const d = inRow.find((g) => g.t === '$')
      if (d) col.dollar = d.x0
    }
    if (type === 'date') {
      const s = inRow.filter((g) => g.t === '/').sort((a, b) => a.x0 - b.x0)
      if (s.length !== 2) throw new Error(`${key}: expected two slashes`)
      col.slashes = [s[0].x0, s[1].x0]
    }
    if (type === 'check') {
      const g = inRow.find((g) => g.t === '❑' || g.t === '❏')
      if (!g) throw new Error(`${key}: no checkbox glyph`)
      col.glyph = { x0: g.x0, dy: round(g.top - firstRowTop) }
    }
    return col
  })
}

function gridTable(
  id: string, q: string, title: string, page: number, formPage: number, gridIndex: number,
  defs: [string, string, TableColumn['type']][], opts: { totalsRow?: boolean } = {},
): FormTable {
  const tp = tablePages[String(page)]
  const grid = tp.grids[gridIndex]
  const body = grid.rows.slice(1)
  const data = opts.totalsRow ? body.slice(0, -1) : body
  const cells = data[0].cells as [number, number][]
  return {
    id, q, title, page, formPage,
    columns: columns(tp, cells, defs, data[0].top, data[0].bot),
    rows: data.map((r) => ({ top: r.top, bot: r.bot })),
    ...(opts.totalsRow ? { totals: { top: body[body.length - 1].top, bot: body[body.length - 1].bot } } : {}),
    ...headerFooter(tp),
  }
}

const a6Cols: [string, string, TableColumn['type']][] = [
  ['name', 'Employee’s name', 'text'], ['start_date', 'Start date', 'date'], ['wages', 'Wages or salary owed', 'money'],
  ['annual_leave', 'Annual leave (holiday pay) owed', 'money'], ['long_service', 'Long service leave owed', 'money'],
  ['super', 'Superannuation owed', 'money'], ['redundancy', 'Redundancy owed', 'money'], ['other', 'Other', 'money'],
  ['total', 'Total owed', 'money'],
]

const tables: FormTable[] = [
  gridTable('A4', 'A4', 'Assets owned by the Company', 9, 4, 0, [
    ['description', 'Asset description', 'text'],
    ['location', 'Location/address where asset is located (bank accounts: give bank a/c details including a/c numbers)', 'text'],
    ['security', 'Security held by (subject to finance) (if applicable)', 'text'],
    ['estimated_value', 'Estimated asset value', 'money'],
    ['security_value', 'Value of security', 'money'],
    ['net_realisable', 'Net realisable value', 'money'],
    ['disposed', 'Tick if disposed of in the last 6 months', 'text'],
  ]),
  gridTable('A5', 'A5', 'Money owed to the Company (debtors)', 10, 4, 0, [
    ['name', 'Debtor name', 'text'], ['description', 'Description', 'text'], ['address', 'Debtor address', 'text'],
    ['outstanding', 'Amount outstanding', 'money'], ['realisable', 'Estimated amount realisable', 'money'],
    ['ppsr', 'PPSR if applicable', 'text'], ['security_type', 'Security type', 'text'], ['date_secured', 'Date secured', 'date'],
  ]),
  gridTable('A6_unrelated', 'A6', 'Amounts the Company owes to its unrelated employees (priority creditors)', 11, 5, 0, a6Cols, { totalsRow: true }),
  gridTable('A6_related', 'A6', 'Amounts the Company owes to its related party employees', 11, 5, 1, a6Cols, { totalsRow: true }),
  a7Table(),
]

/**
 * Table A7 is printed rotated by about a quarter of a degree, so pdfplumber
 * finds no grid. Rows and columns come from its ruled lines (measured at the
 * left edge, x = 27.3) and every row is moved by the skew along x.
 */
function a7Table(): FormTable {
  const tp = tablePages['12']
  const xs = [27.3, 148.0, 310.4, 405.1, 460.9, 549.2, 647.5, 727.7, 812.0]
  const tops = [203.3, 225.1, 246.9, 268.6, 290.4, 312.2, 334.0]
  const skew = -0.00526
  const glyph = (x: number) => {
    const g = tp.glyphs.filter((g) => (g.t === '❑' || g.t === '❏') && Math.abs(g.x0 - x) < 20).sort((a, b) => a.top - b.top)[0]
    return { x0: g.x0, dy: round(g.top - (tops[0] + skew * (g.x0 - xs[0]))) }
  }
  const dollar = tp.glyphs.filter((g) => g.t === '$').sort((a, b) => a.top - b.top)[0]
  const col = (i: number, key: string, label: string, type: TableColumn['type']): TableColumn => ({ key, label, type, x0: xs[i], x1: xs[i + 1] })
  return {
    id: 'A7', q: 'A7', title: 'Amounts the Company owes to its creditors', page: 12, formPage: 5,
    columns: [
      col(0, 'name', 'Creditor’s name', 'text'),
      col(1, 'address', 'Postal address in full', 'text'),
      col(2, 'email', 'Email address', 'text'),
      { ...col(3, 'secured', 'Tick if secured', 'check'), glyph: glyph(427) },
      col(4, 'ppsr', 'PPSR (if applicable)', 'text'),
      col(5, 'security_details', 'If secured, give asset details', 'text'),
      { ...col(6, 'related', 'Tick if related party', 'check'), glyph: glyph(681) },
      { ...col(7, 'amount', 'Amount owing', 'money'), dollar: dollar.x0 },
    ],
    rows: tops.slice(0, -1).map((top, i) => ({ top, bot: tops[i + 1] })),
    skew,
    skewOrigin: xs[0],
    ...headerFooter(tp),
  }
}

const map: FormMap = {
  code: '507a',
  form: 'ASIC Form 507 - Report on Company Activities and Property - Part A',
  version: '20220801',
  title: 'Report on Company Activities and Property - Part A (Form 507)',
  pageCount: 12,
  formPages: [1, 2, 3, 4, 5, 6],
  optionalPages: [{ id: '507a', page: 7, label: 'Form 507A: Statement verifying Report under s475(1) (court liquidations only)' }],
  formPageTotal: 6,
  appendixCoverPage: 8,
  questions,
  fields,
  tables,
}

const keys = fields.map((f) => f.key)
const dups = keys.filter((k, i) => keys.indexOf(k) !== i)
if (dups.length) throw new Error(`Duplicate keys: ${dups.join(', ')}`)
writeFileSync(outPath, `${JSON.stringify(map, null, 1)}\n`)
console.log('fields', fields.length, 'yes/no', fields.filter((f) => f.type === 'yesno').length,
  'tables', tables.map((t) => `${t.id}:${t.rows.length}`).join(' '))
