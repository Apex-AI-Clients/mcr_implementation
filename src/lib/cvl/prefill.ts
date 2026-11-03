import { aud, printedLineText, type AmountSource } from '@/lib/sources'
import type { FieldValue, FormCode, TableRow } from '@/lib/forms/types'
import { formatExtractDate } from '@/lib/asic/dates'
import type { AsicSectionPages } from '@/lib/asic/readUpload'
import type { Meaning } from '@/lib/printed/meanings'
import { splitAddress } from './address'
import type { BalanceSheetFigure, CvlContext } from './context'
import { PLACEMENTS, missingSettings, type PlacementKey, type PlacementTarget } from './settings'

/**
 * What each CVL entry screen starts with, and where every value comes from
 * (its ⓘ). Pure: CvlContext in, answers out.
 *
 *   ASIC extract    company name, ACN, addresses, directors, registration date
 *   client file     phone and email; accountant details for B24 "prepared by"
 *   balance sheet   Form 509 valuations from the lines staff confirmed
 *   creditors       ATO accounts, the balance sheet's creditor lines, and the
 *                   SBR prediction's own creditor rows
 *   CVL settings    MCR's company and liquidator details, and where the
 *                   Form 509 amounts go, once Gabby confirms them
 *
 * Never filled: dates (the case dates are entered with a date picker),
 * Form 509 estimated realisable values, signatures, and anything written by
 * hand on the printout. Every Yes/No starts at "No" (drafts.ts); only the
 * trust question is answered from the file.
 */

export type Subject = 'company' | `director:${number}`

export interface Prefilled {
  value: FieldValue
  source: AmountSource
}

export interface PrefillTableRow {
  row: TableRow
  source: AmountSource
}

/** An amount listed beside Form 509 until Gabby says where it goes (settings.ts PLACEMENTS). */
export interface Candidate {
  key: PlacementKey
  label: string
  amount: number
  source: AmountSource
  /** Where the setting puts it; null: not placed yet. */
  target: PlacementTarget | null
  confirmed: boolean
}

export interface Prefill {
  fields: Record<string, Prefilled>
  tables: Record<string, PrefillTableRow[]>
  /** The name on every appendix table header ("signed by …"). */
  signedBy: Prefilled | null
  /** Beside a box that could not be filled: what would fill it. */
  notes: Record<string, string>
  /** For the whole form: blank settings, things to check. */
  warnings: string[]
  candidates: Candidate[]
}

const round = (n: number) => Math.round(n * 100) / 100
const nameKey = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '')

/* ---------------- sources ---------------- */

type Section = keyof AsicSectionPages

/** A value from the company details, and whether they came off an ASIC extract (with a link to it at the page). */
function companySource(ctx: CvlContext, what: string, section: Section): AmountSource {
  const c = ctx.company
  const fromExtract = c?.source === 'asic_pdf' || c?.source === 'asic_pdf_edited'
  const date = formatExtractDate(ctx.asicExtract?.extractedAt ?? c?.asicExtractDate ?? null)
  const from = [
    what,
    fromExtract
      ? `ASIC extract${date ? ` dated ${date}` : ''}${c?.source === 'asic_pdf_edited' ? ', as edited by staff' : ''}.`
      : 'Company details on the client file, entered by staff.',
  ]
  const page = ctx.asicExtract?.pages[section] ?? null
  return {
    from,
    link: ctx.asicExtract
      ? {
          kind: 'href',
          href: `/api/admin/clients/${ctx.clientId}/asic-extract/${ctx.asicExtract.id}${page ? `?page=${page}` : ''}`,
          label: page ? `Open the ASIC extract at page ${page}` : 'Open the ASIC extract',
        }
      : null,
  }
}

const fileSource = (what: string, where: string): AmountSource => ({ from: [what, where] })

const settingSource = (what: string): AmountSource => ({
  from: [what, 'CVL settings.'],
  link: { kind: 'href', href: '/cvl/settings', label: 'Open CVL settings' },
})

function balanceSheetSource(what: string, f: BalanceSheetFigure, clientId: string): AmountSource {
  const first = f.lines.find((l) => l.source)?.source ?? null
  return {
    from: [what, `${f.statement}, lines confirmed by staff:`, ...f.lines.map((l) => printedLineText(l.label, l.printed, l.source))],
    rule: [...new Set(f.lines.map((l) => l.rule).filter(Boolean))].join(' ') || null,
    calculation: f.lines.length > 1 ? `${f.lines.map((l) => aud(l.value)).join(' + ')} = ${aud(f.amount)}` : null,
    link: first
      ? { kind: 'pdf', documentId: first.documentId, page: first.page }
      : { kind: 'href', href: `/cvl/${clientId}/financials-comparison/mapping`, label: 'Confirm key figures' },
  }
}

/* ---------------- shared pieces ---------------- */

function put(out: Prefill, key: string, value: FieldValue, source: AmountSource) {
  if (value === null || value === undefined || value === '') return
  out.fields[key] = { value, source }
}

function putAddress(out: Prefill, ctx: CvlContext, prefix: string, address: string | null, what: string, section: Section) {
  const parts = splitAddress(address)
  if (!parts) return
  const source = companySource(ctx, what, section)
  put(out, `${prefix}_street`, parts.street, source)
  put(out, `${prefix}_suburb`, parts.suburb, source)
  put(out, `${prefix}_state`, parts.state, source)
  put(out, `${prefix}_postcode`, parts.postcode, source)
}

function putCompany(out: Prefill, ctx: CvlContext, nameKeyOnForm: string, acnKeyOnForm: string) {
  const c = ctx.company
  if (!c) {
    out.notes[nameKeyOnForm] = 'No company details on the client file yet: fill them on the client page, or upload the ASIC extract.'
    return
  }
  put(out, nameKeyOnForm, c.companyName, companySource(ctx, 'Company name.', 'organisation'))
  // As ASIC prints it: 123 456 780.
  const acn = c.acn?.replace(/\D/g, '')
  put(out, acnKeyOnForm, acn?.length === 9 ? acn.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : c.acn, companySource(ctx, 'ACN.', 'organisation'))
}

/**
 * The registration date, for the "started trading" questions: said to be the
 * registration date, to check. `asText`: the box is plain text on the form
 * (B10), so the date goes in as DD/MM/YYYY.
 */
function putRegistration(out: Prefill, ctx: CvlContext, key: string, asText = false) {
  const date = ctx.company?.registrationDate
  if (!date) {
    out.notes[key] = ctx.asicExtract
      ? 'The kept ASIC extract has no registration date.'
      : 'Upload the ASIC extract again to fill (the company’s registration date).'
    return
  }
  const source = companySource(ctx, 'The company’s registration date.', 'organisation')
  const value = asText ? date.split('-').reverse().join('/') : date
  out.fields[key] = { value, source: { ...source, rule: 'Trading may have started after registration: check with the director.' } }
}

function director(ctx: CvlContext, subject: Subject) {
  const n = subject === 'company' ? 1 : Number(subject.split(':')[1])
  return ctx.company?.directors[n - 1] ?? null
}

function settingsWarnings(out: Prefill, ctx: CvlContext) {
  const missing = missingSettings(ctx.settings)
  if (missing.length) {
    out.warnings.push(`Not set yet in CVL settings: ${missing.join(', ')}. Those boxes stay blank.`)
  }
}

/* ---------------- creditors ---------------- */

const FINANCE = /\b(chattel|hire purchase|finance|unexpired interest|hp loan|equipment loan|vehicle loan|car loan|lease)\b/i

/**
 * The creditors the file knows of, one row each for table A7: each ATO
 * account owing, each confirmed creditor line on the balance sheet, and the
 * SBR prediction's own rows that are not already one of those.
 */
export function creditorRows(ctx: CvlContext): PrefillTableRow[] {
  const rows: PrefillTableRow[] = []
  for (const a of ctx.atoAccounts.accounts) {
    if (a.balance === null || a.balance <= 0) continue
    rows.push({
      row: { name: 'Australian Taxation Office', security_details: a.label, amount: round(a.balance) },
      source: {
        from: [`${a.label}: balance owing${a.balanceDate ? ` at ${formatExtractDate(a.balanceDate) ?? a.balanceDate}` : ''}, from the ATO account CSV.`],
        link: { kind: 'pdf', documentId: a.documentId, page: null, label: 'Open the ATO account file' },
      },
    })
  }
  // The ATO's own accounts stand in for the balance sheet's ATO lines when there are any.
  const lineMeanings: [Meaning, { related?: boolean }][] = [
    ...(rows.length ? [] : ([['ato_debt', {}]] as [Meaning, { related?: boolean }][])),
    ['trade_suppliers', {}],
    ['credit_cards', {}],
    ['bank_overdraft', {}],
    ['cash_loans', {}],
    ['loan_payable', { related: true }],
  ]
  for (const [meaning, { related }] of lineMeanings) {
    const f = ctx.balanceSheet[meaning]
    if (!f) continue
    for (const line of f.lines) {
      const amount = round(Math.abs(line.value))
      if (amount === 0) continue
      const secured = meaning === 'cash_loans' && FINANCE.test(line.label)
      rows.push({
        row: {
          name: line.label.trim(),
          amount,
          ...(secured ? { secured: true } : {}),
          ...(related ? { related: true } : {}),
        },
        source: {
          from: [`${f.statement}, line confirmed by staff:`, printedLineText(line.label, line.printed, line.source)],
          rule: secured ? 'Finance lines are usually secured: check the security and the PPSR.' : null,
          link: line.source ? { kind: 'pdf', documentId: line.source.documentId, page: line.source.page } : null,
        },
      })
    }
  }
  // Rows staff added on the SBR prediction that are not a balance-sheet kind.
  for (const r of ctx.sbrCreditors) {
    if (r.kind || r.amount === null || r.amount <= 0) continue
    rows.push({
      row: { name: r.label, amount: round(r.amount) },
      source: { from: [`“${r.label}”: a creditor row staff entered on the SBR outcome prediction.`] },
    })
  }
  return rows
}

/* ---------------- Form 509 ---------------- */

const VALUATIONS: [string, Meaning, string][] = [
  ['b_val', 'trade_debtors', '1(b) Sundry debtors'],
  ['c_val', 'cash_on_hand', '1(c) Cash on hand'],
  ['d_val', 'cash_at_bank', '1(d) Cash at bank'],
  ['e_val', 'stock', '1(e) Stock'],
  ['g_val', 'plant_equipment', '1(g) Plant and machinery'],
  ['h_val', 'other_assets', '1(h) Other assets'],
]

function candidates509(ctx: CvlContext): Candidate[] {
  const out: Candidate[] = []
  const add = (key: PlacementKey, amount: number | null, source: AmountSource) => {
    if (amount === null || amount === 0) return
    out.push({
      key,
      label: PLACEMENTS[key].label,
      amount: round(amount),
      source,
      target: ctx.settings.placements[key] ?? null,
      confirmed: ctx.settings.confirmed[`f509_place.${key}`],
    })
  }
  const loan = ctx.balanceSheet.loan_receivable
  if (loan) add('director_loan', loan.amount, balanceSheetSource('Director loan: owed to the company.', loan, ctx.clientId))

  const finance = ctx.balanceSheet.cash_loans
  const financed = finance?.lines.filter((l) => FINANCE.test(l.label)) ?? []
  if (finance && financed.length) {
    const amount = financed.reduce((s, l) => s + Math.abs(l.value), 0)
    add('financed_vehicles', amount, balanceSheetSource('Financed vehicles and equipment: the finance owing.', { ...finance, lines: financed, amount: round(amount) }, ctx.clientId))
  }

  const sg = ctx.atoAccounts.accounts.filter((a) => a.kind === 'super_guarantee' && a.balance !== null && a.balance > 0)
  if (sg.length) {
    const amount = sg.reduce((s, a) => s + a.balance!, 0)
    add('super_payable', amount, {
      from: ['Superannuation guarantee owing, from the ATO account CSV:', ...sg.map((a) => `${a.label}: ${aud(a.balance!)}`)],
      calculation: sg.length > 1 ? `${sg.map((a) => aud(a.balance!)).join(' + ')} = ${aud(amount)}` : null,
    })
  }

  const unsecured = creditorRows(ctx).filter((r) => !r.row.secured && !/super/i.test(String(r.row.security_details ?? '')))
  if (unsecured.length) {
    const amount = unsecured.reduce((s, r) => s + Number(r.row.amount), 0)
    add('unsecured_creditors', amount, {
      from: ['Unsecured creditors on the file (the rows of table A7 not marked secured):', ...unsecured.map((r) => `${r.row.name}: ${aud(Number(r.row.amount))}`)],
      calculation: unsecured.length > 1 ? `${unsecured.map((r) => aud(Number(r.row.amount))).join(' + ')} = ${aud(amount)}` : null,
    })
  }
  return out
}

function prefill509(ctx: CvlContext, out: Prefill) {
  const { liquidator: l, mcrCompany: m } = ctx.settings
  put(out, 'contact_name', l.contactName, settingSource('Who ASIC should contact.'))
  put(out, 'agent_number', l.agentNumber, settingSource('ASIC registered agent number.'))
  put(out, 'entity_name', m.companyName, settingSource('MCR’s company name (from MCR’s ASIC extract).'))
  put(out, 'entity_number', m.acn, settingSource('MCR’s ACN (from MCR’s ASIC extract).'))
  put(out, 'phone', l.phone, settingSource('Liquidator’s phone.'))
  put(out, 'postal_1', l.postal1, settingSource('Liquidator’s postal address.'))
  put(out, 'postal_2', l.postal2, settingSource('Liquidator’s postal address.'))
  put(out, 'email', l.email, settingSource('Liquidator’s email.'))
  settingsWarnings(out, ctx)

  putCompany(out, ctx, 'company_name', 'company_acn')
  out.notes.summary_date = 'Pick the date the summary is made up to.'

  // Book values in the valuation column only; estimated realisable values stay blank.
  for (const [key, meaning, label] of VALUATIONS) {
    const f = ctx.balanceSheet[meaning]
    if (f) put(out, key, f.amount, balanceSheetSource(`${label}: book value.`, f, ctx.clientId))
  }
  const share = ctx.balanceSheet.share_capital
  if (share) {
    const source = balanceSheetSource('Share capital, as printed (issued; paid up taken as the same — check).', share, ctx.clientId)
    put(out, 'share_issued', share.amount, source)
    put(out, 'share_paid', share.amount, source)
  }
  out.warnings.push('Estimated realisable values are left blank: they are the liquidator’s estimate, not the books.')

  out.candidates = candidates509(ctx)
  for (const c of out.candidates) {
    if (!c.target || c.target === 'none' || out.fields[c.target]) continue
    out.fields[c.target] = {
      value: c.amount,
      source: { ...c.source, from: [...c.source.from, `Placed in ${PLACEMENTS[c.key].options[c.target as keyof (typeof PLACEMENTS)[typeof c.key]['options']]} by the CVL setting.`] },
    }
  }

  const d = director(ctx, 'company')
  if (d) {
    put(out, 'signer_name', d.name, companySource(ctx, 'The first director listed.', 'directors'))
    put(out, 'capacity', 'Director', companySource(ctx, 'Signed as director.', 'directors'))
  }
}

/* ---------------- Part A ---------------- */

function prefillPartA(ctx: CvlContext, out: Prefill) {
  const { liquidator: l, mcrCompany: m } = ctx.settings
  put(out, 'ea_organisation', m.companyName, settingSource('MCR’s company name.'))
  put(out, 'ea_liquidator_number', l.number, settingSource('Registered liquidator number.'))
  put(out, 'ea_name', l.name, settingSource('Liquidator.'))
  put(out, 'ea_contact', l.contactName, settingSource('Contact person.'))
  put(out, 'ea_phone', l.phone, settingSource('Liquidator’s phone.'))
  const office = splitAddress(m.address)
  if (office) {
    const source = settingSource('MCR’s address (from MCR’s ASIC extract).')
    put(out, 'ea_street', office.street, source)
    put(out, 'ea_suburb', office.suburb, source)
    put(out, 'ea_state', office.state, source)
    put(out, 'ea_postcode', office.postcode, source)
  }
  settingsWarnings(out, ctx)
  out.fields.ea_role = {
    value: 'cvl_liquidator',
    source: { from: ['Type of appointment.', 'A CVL: liquidator in a creditors’ voluntary winding up, s497(4).'] },
  }

  putCompany(out, ctx, 'company_name', 'company_acn')
  putAddress(out, ctx, 'a3_registered', ctx.company?.registeredOffice ?? null, 'Registered office.', 'addresses')
  putAddress(out, ctx, 'a3_principal', ctx.company?.principalPlace ?? null, 'Principal place of business.', 'addresses')
  putRegistration(out, ctx, 'a3_commenced')
  if (ctx.company?.entityType === 'trust') {
    const source = fileSource('The company acts as trustee.', 'Company and trust details on the client file.')
    put(out, 'a3_trustee', 'yes', source)
    put(out, 'a3_trust_name', ctx.company.trustName, source)
  }

  // A4: the assets on the balance sheet, described; their values are the director's estimate.
  const assets: PrefillTableRow[] = []
  for (const meaning of ['cash_at_bank', 'cash_on_hand', 'trade_debtors', 'stock', 'plant_equipment', 'other_assets'] as Meaning[]) {
    const f = ctx.balanceSheet[meaning]
    for (const line of f?.lines ?? []) {
      if (line.value === 0) continue
      assets.push({
        row: { description: line.label.trim() },
        source: {
          from: [`${f!.statement}, line confirmed by staff:`, printedLineText(line.label, line.printed, line.source)],
          rule: 'The book value is not copied into the estimated value: that is the director’s estimate.',
          link: line.source ? { kind: 'pdf', documentId: line.source.documentId, page: line.source.page } : null,
        },
      })
    }
  }
  if (assets.length) out.tables.A4 = assets
  const creditors = creditorRows(ctx)
  if (creditors.length) out.tables.A7 = creditors

  const d = director(ctx, 'company')
  if (d) {
    const source = companySource(ctx, 'The first director listed.', 'directors')
    put(out, 'a9_name', d.name, source)
    put(out, 'a9_position', 'Director', source)
    out.signedBy = { value: d.name, source }
  }
}

/* ---------------- Part B ---------------- */

function prefillPartB(ctx: CvlContext, subject: Subject, out: Prefill) {
  putCompany(out, ctx, 'company_name', 'company_acn')
  const d = director(ctx, subject)
  if (!d) {
    out.warnings.push('This director is not on the client file: add the directors on the client page.')
  } else {
    const born = d.dateOfBirth ? `, born ${d.dateOfBirth}` : ''
    const appointed = d.appointedOn ? `, appointed ${d.appointedOn}` : ''
    const source = companySource(ctx, `Director: ${d.name}${born}${appointed}.`, 'directors')
    put(out, 'b1_name', d.name, source)
    put(out, 'b1_role', 'Director', source)
    put(out, 'b31_name', d.name, source)
    out.signedBy = { value: d.name, source }
    if (!d.appointedOn) out.notes.b1_role = ctx.asicExtract ? 'The kept ASIC extract has no appointment date for this director.' : 'Upload the ASIC extract again to fill the appointment date.'
    // The client's own phone and email, when the client is this director.
    if (nameKey(ctx.client.name) === nameKey(d.name)) {
      put(out, 'b1_phone', ctx.client.phone, fileSource('The client’s phone.', 'Client file.'))
      put(out, 'b1_email', ctx.client.email, fileSource('The client’s email.', 'Client file.'))
    }
  }
  putRegistration(out, ctx, 'b10_date', true)

  const a = ctx.accountant
  const preparedBy = a?.contactPerson || a?.companyName
  if (a && preparedBy) {
    const source = fileSource('Who prepares the tax returns and BAS.', 'Accountant details on the client file.')
    put(out, 'b24_name', a.contactPerson && a.companyName ? `${a.contactPerson}, ${a.companyName}` : preparedBy, source)
    put(out, 'b24_phone', a.phone, source)
  } else {
    out.notes.b24_name = 'No accountant details on the client file.'
  }
}

/* ---------------- entry ---------------- */

export function prefillForm(code: FormCode, subject: Subject, ctx: CvlContext): Prefill {
  const out: Prefill = { fields: {}, tables: {}, signedBy: null, notes: {}, warnings: [], candidates: [] }
  if (code === '509') prefill509(ctx, out)
  else if (code === '507a') prefillPartA(ctx, out)
  else prefillPartB(ctx, subject, out)
  return out
}

/** The forms a case needs, by subject: one Part B per director unless the setting says one per company. */
export function subjectsFor(code: FormCode, { directors: n }: { directors: number }): Subject[] {
  if (code !== '507b') return ['company']
  if (n <= 1) return ['director:1']
  return Array.from({ length: n }, (_, i) => `director:${i + 1}` as Subject)
}

export function isSubject(value: string): value is Subject {
  return value === 'company' || /^director:[1-9][0-9]?$/.test(value)
}
