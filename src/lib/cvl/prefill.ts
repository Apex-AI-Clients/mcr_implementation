import { aud, printedLineText, type AmountSource } from '@/lib/sources'
import type { FieldValue, FormCode, TableRow } from '@/lib/forms/types'
import { formatExtractDate } from '@/lib/asic/dates'
import type { AsicSectionPages } from '@/lib/asic/readUpload'
import type { Meaning } from '@/lib/printed/meanings'
import { signatureDateKeys, TABLE_DATED_KEY } from '@/lib/forms/registry'
import { splitAddress } from './address'
import { B24_DATE_KEYS, UNSURE } from '@/lib/forms/unsure'
import type { BalanceSheetFigure, CvlContext } from './context'
import { PLACEMENTS, missingSettings, type PlacementKey, type PlacementTarget } from './settings'
import { TOTALS_HELD_BACK } from '@/lib/ica/status'

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
  /** The appendix tables' "...and dated", per table page (by its first table id): the signature date. */
  signedDates: Record<string, Prefilled>
  /**
   * Part A: the client file's trust name, for A3's "Name of Trust" — put in
   * only when staff answer Yes to "Is the Company a trustee of a Trust?", and
   * taken out again on No (Nov 2026). Never filled on its own.
   */
  trustName?: Prefilled | null
  /** Beside a box that could not be filled: what would fill it. */
  notes: Record<string, string>
  /** For the whole form: blank settings, things to check. */
  warnings: string[]
  candidates: Candidate[]
}

const round = (n: number) => Math.round(n * 100) / 100

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
/**
 * The registration date, as an ISO date like every date answer. B10 is a text
 * box printed as a date (format 'date'): it was given "DD/MM/YYYY" here, which
 * the screen's date input cannot show, so B10 looked empty while the PDF
 * printed the date (Nov 2026). The engine writes ISO as DD/MM/YYYY itself.
 */
function putRegistration(out: Prefill, ctx: CvlContext, key: string) {
  const date = ctx.company?.registrationDate
  if (!date) {
    out.notes[key] = ctx.asicExtract
      ? 'The kept ASIC extract has no registration date.'
      : 'Upload the ASIC extract again to fill (the company’s registration date).'
    return
  }
  const source = companySource(ctx, 'The company’s registration date.', 'organisation')
  out.fields[key] = { value: date, source: { ...source, rule: 'Trading may have started after registration: check with the director.' } }
}

const personKey = (name: string) => name.toUpperCase().replace(/[^A-Z]/g, '')

/**
 * B1's address: the director's address on the kept ASIC extract (Gabby, 24 Nov 2026), split into
 * the form's boxes, each editable. Matched by name (and a compatible year of birth). Nothing kept,
 * or no address printed for them: blank, with a note.
 */
function putDirectorAddress(out: Prefill, ctx: CvlContext, d: { name: string; dateOfBirth: string | null }) {
  const hit = (ctx.directorAddresses ?? []).find(
    (a) => personKey(a.name) === personKey(d.name) && (!a.dateOfBirth || !d.dateOfBirth || a.dateOfBirth.slice(0, 4) === d.dateOfBirth.slice(0, 4)),
  )
  const parts = splitAddress(hit?.address)
  if (!parts) {
    out.notes.b1_street = ctx.asicExtract
      ? 'The kept ASIC extract has no address for this director: type it in.'
      : 'Upload the ASIC extract to fill the director’s address, or type it in.'
    return
  }
  const source = companySource(ctx, `The director’s address on the ASIC extract: ${hit!.address}.`, 'directors')
  put(out, 'b1_street', parts.street, source)
  put(out, 'b1_suburb', parts.suburb, source)
  put(out, 'b1_state', parts.state, source)
  put(out, 'b1_postcode', parts.postcode, source)
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
    // Not verified against the ATO's own balance yet: listed with no amount, never left out quietly.
    if (a.icaStatus === 'held_back' && a.unparsedDateRows === 0) {
      rows.push({
        row: { name: 'Australian Taxation Office', security_details: a.label, amount: null },
        source: {
          from: [`${a.label}: ${TOTALS_HELD_BACK.toLowerCase()} (its balance is checked against the ATO's own before it is filled in).`],
          link: { kind: 'pdf', documentId: a.documentId, page: null, label: 'Open the ATO account file' },
        },
      })
      continue
    }
    if (a.balance === null || a.balance <= 0) continue
    rows.push({
      row: { name: 'Australian Taxation Office', security_details: a.label, amount: round(a.balance) },
      source: {
        from: [`${a.label}: balance owing${a.balanceDate ? ` at ${formatExtractDate(a.balanceDate) ?? a.balanceDate}` : ''}, from the ATO account CSV.`],
        link: { kind: 'pdf', documentId: a.documentId, page: null, label: 'Open the ATO account file' },
      },
    })
  }
  // The ATO's own accounts stand in for the balance sheet's ATO lines when there are any. An account
  // on file whose dates could not be read is never quietly replaced by the balance sheet's figure.
  const atoOnFile = rows.length > 0 || ctx.atoAccounts.unreadable.length > 0 || (ctx.atoAccounts.heldBack?.length ?? 0) > 0
  const lineMeanings: [Meaning, { related?: boolean }][] = [
    ...(atoOnFile ? [] : ([['ato_debt', {}]] as [Meaning, { related?: boolean }][])),
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
  // A total from accounts not all verified would be understated: left for staff while any is held back.
  const anyHeld = (ctx.atoAccounts.heldBack?.length ?? 0) > 0
  if (sg.length && !anyHeld) {
    const amount = sg.reduce((s, a) => s + a.balance!, 0)
    add('super_payable', amount, {
      from: ['Superannuation guarantee owing, from the ATO account CSV:', ...sg.map((a) => `${a.label}: ${aud(a.balance!)}`)],
      calculation: sg.length > 1 ? `${sg.map((a) => aud(a.balance!)).join(' + ')} = ${aud(amount)}` : null,
    })
  }

  const unsecured = creditorRows(ctx).filter((r) => !r.row.secured && !/super/i.test(String(r.row.security_details ?? '')))
  if (unsecured.length && !anyHeld) {
    const amount = unsecured.reduce((s, r) => s + Number(r.row.amount), 0)
    add('unsecured_creditors', amount, {
      from: ['Unsecured creditors on the file (the rows of table A7 not marked secured):', ...unsecured.map((r) => `${r.row.name}: ${aud(Number(r.row.amount))}`)],
      calculation: unsecured.length > 1 ? `${unsecured.map((r) => aud(Number(r.row.amount))).join(' + ')} = ${aud(amount)}` : null,
    })
  }
  return out
}

function prefill509(ctx: CvlContext, out: Prefill) {
  // Row 6, "Creditors (unsecured) amount claimed", both columns: Part A's
  // Table A7 "Amount owing", added up as saved (Nov 2026).
  if (ctx.a7Total !== null && ctx.a7Total !== undefined) {
    const source: AmountSource = {
      from: ['Form 507 Part A, Table A7: the "Amount owing" column added up, as saved.', 'Change it here if the amount claimed differs.'],
    }
    put(out, 'r6_val', ctx.a7Total, source)
    put(out, 'r6', ctx.a7Total, source)
  }
  // Lodgement details: always the CVL settings' "Form 509 lodgement details"
  // (as on the Form 509 MCR lodges with, until changed there).
  const lodge = ctx.settings.lodgement
  put(out, 'entity_name', lodge.firm, settingSource('Firm/organisation (CVL settings: Form 509 lodgement details).'))
  put(out, 'entity_number', lodge.entityNumber, settingSource('ACN/ABN (CVL settings: Form 509 lodgement details).'))
  put(out, 'agent_number', lodge.agentNumber, settingSource('ASIC registered agent number (CVL settings: Form 509 lodgement details).'))
  put(out, 'contact_name', lodge.contactName, settingSource('Who ASIC should contact (CVL settings: Form 509 lodgement details).'))
  put(out, 'phone', lodge.phone, settingSource('Telephone number (CVL settings: Form 509 lodgement details).'))
  put(out, 'email', lodge.email, settingSource('Email address (CVL settings: Form 509 lodgement details).'))
  put(out, 'postal_1', lodge.postal1, settingSource('Postal address (CVL settings: Form 509 lodgement details).'))
  put(out, 'postal_2', lodge.postal2, settingSource('Postal address (CVL settings: Form 509 lodgement details).'))

  putCompany(out, ctx, 'company_name', 'company_acn')
  out.notes.summary_date = 'Pick the date the summary is made up to.'

  // The amounts are typed by staff (6 Nov 2026: pre-fill only from the ASIC
  // extract and the CVL settings). The statement amounts are still listed
  // beside the form, to type from; none is put in a box.
  out.candidates = candidates509(ctx)

  const d = director(ctx, 'company')
  if (d) {
    put(out, 'signer_name', d.name, companySource(ctx, 'The first director listed.', 'directors'))
    put(out, 'capacity', 'Director', companySource(ctx, 'Signed as director.', 'directors'))
  }
}

/* ---------------- Part A ---------------- */

function prefillPartA(ctx: CvlContext, out: Prefill) {
  // The External Administrator box: box for box from the CVL settings' "External Administrator".
  const ea = ctx.settings.externalAdministrator
  const from = (what: string) => settingSource(`${what} (CVL settings: External Administrator).`)
  put(out, 'ea_organisation', ea.organisation, from('Organisation'))
  put(out, 'ea_liquidator_number', ea.liquidatorNumber, from('ASIC Registered Liquidator number'))
  put(out, 'ea_name', ea.name, from('Name of External Administrator'))
  put(out, 'ea_contact', ea.contact, from('Contact person'))
  put(out, 'ea_phone', ea.phone, from('Phone number'))
  put(out, 'ea_address', ea.address, from('Address'))
  put(out, 'ea_street', ea.street, from('Street/Unit number and name'))
  put(out, 'ea_suburb', ea.suburb, from('Suburb/City'))
  put(out, 'ea_state', ea.state, from('State/Territory'))
  put(out, 'ea_postcode', ea.postcode, from('Postcode'))
  settingsWarnings(out, ctx)
  out.fields.ea_role = {
    value: 'cvl_liquidator',
    source: { from: ['Please tick appropriate box.', 'A CVL: Liquidator – creditors’ voluntary winding up – s497(4) 507D.'] },
  }

  putCompany(out, ctx, 'company_name', 'company_acn')
  const trust = ctx.company?.trustName?.trim()
  if (trust) out.trustName = { value: trust, source: { from: ['The trust name on the client file.', 'Put in when A3 is answered Yes.'] } }
  // Page 7, Form 507A: the same company.
  putCompany(out, ctx, 'f507a_company_name', 'f507a_company_acn')
  putAddress(out, ctx, 'a3_registered', ctx.company?.registeredOffice ?? null, 'Registered office.', 'addresses')
  putAddress(out, ctx, 'a3_principal', ctx.company?.principalPlace ?? null, 'Principal place of business.', 'addresses')
  putRegistration(out, ctx, 'a3_commenced')
  // The trust question, and the tables (A4 assets, A5 debtors, A6
  // employees, A7 creditors), are typed by staff: nothing is pre-filled from
  // the client file's statements or accounts (6 Nov 2026).

  const d = director(ctx, 'company')
  if (d) {
    const source = companySource(ctx, 'The first director listed.', 'directors')
    put(out, 'a9_name', d.name, source)
    put(out, 'a9_position', 'Director', source)
    // Form 507A (page 7) is signed by the same director (Nov 2026).
    put(out, 'f507a_name', d.name, source)
    put(out, 'f507a_capacity', 'Director', source)
    // The appendix tables' "signed by" name is left blank: the client signs
    // and names themselves there by hand.
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
    // B5's Manager 1 is this director (Nov 2026); Manager 2 is typed by staff.
    put(out, 'b5_m1_name', d.name, source)
    put(out, 'b5_m1_role', 'Director', source)
    put(out, 'b5_m1_duties', 'Day to day operation', { from: ['Manager 1 is the director.', 'Change it if their duties differ.'] })
    // The appendix tables' "signed by" name (B2, B3, B21, B28) is left blank:
    // the director signs and names themselves there by hand.
    if (!d.appointedOn) out.notes.b1_role = ctx.asicExtract ? 'The kept ASIC extract has no appointment date for this director.' : 'Upload the ASIC extract again to fill the appointment date.'
    putDirectorAddress(out, ctx, d)
  }
  // B10, "Date the Company started trading": the ASIC registration date (Gabby, 24 Nov 2026).
  putRegistration(out, ctx, 'b10_date')
  if (out.fields.b10_date) out.fields.b10_date.source = { ...out.fields.b10_date.source, from: ['From the ASIC extract: registration date', ...out.fields.b10_date.source.from] }

  // B1's and B5 Manager 1's phone and email: the company's own, as typed at
  // conversion or intake (Nov 2026). The accountant (B24) and the rest are
  // typed by staff.
  const contact = (what: string): AmountSource => ({ from: [`The company ${what} on the client file (Company details).`, 'Change it if the director has their own.'] })
  for (const key of ['b1_phone', 'b5_m1_phone']) put(out, key, ctx.company?.phone ?? null, contact('phone'))
  for (const key of ['b1_email', 'b5_m1_email']) put(out, key, ctx.company?.email ?? null, contact('email'))
}

/* ---------------- entry ---------------- */

export function prefillForm(code: FormCode, subject: Subject, ctx: CvlContext): Prefill {
  const out: Prefill = { fields: {}, tables: {}, signedBy: null, signedDates: {}, notes: {}, warnings: [], candidates: [] }
  if (code === '509') prefill509(ctx, out)
  else if (code === '507a') prefillPartA(ctx, out)
  else prefillPartB(ctx, subject, out)
  putSignatureDates(code, ctx, out)
  putDefaultYes(code, out)
  return out
}

/**
 * Yes/No questions answered Yes unless staff say otherwise (Nov 2026). Every
 * other Yes/No starts at No. A pre-filled answer, so it also reaches a form
 * saved before this, where the answer was never changed by hand.
 */
export const DEFAULT_YES: Partial<Record<FormCode, string[]>> = {
  '507a': ['a2', 'a8'],
  '507b': ['b8', 'b9', 'b14', 'b15', 'b27', 'b30', 'b30_permission'],
}

/**
 * B30, "Did someone help you to complete this Report?": MCR Partners did
 * (Nov 2026). Their details, as given for the form; each can be changed.
 */
export const MCR_HELPER: Record<string, string> = {
  b30_name: 'MCR Partners Pty Ltd',
  b30_street: 'PO Box 2100',
  b30_suburb: 'Gladstone Park',
  b30_state: 'VIC',
  b30_postcode: '3043',
  b30_phone: '03 8672 7979',
  b30_email: 'assist@mcrpartners.com.au',
}

function putDefaultYes(code: FormCode, out: Prefill) {
  for (const key of DEFAULT_YES[code] ?? []) {
    out.fields[key] ??= { value: 'yes', source: { from: ['Answered Yes to start with.', 'Change it to No if that is the answer.'] } }
  }
  if (code === '507b') {
    const source = { from: ['MCR Partners helped complete this Report (B30).', 'Change it if someone else did.'] }
    for (const [key, value] of Object.entries(MCR_HELPER)) out.fields[key] ??= { value, source }
    // B24's dates: "Unsure" unless a date is pre-filled, which is kept as it is (Gabby, 24 Nov 2026).
    const unsure = { from: ['Printed as "Unsure" until the date is known.', 'Switch to "Enter a date" to type it.'] }
    for (const key of B24_DATE_KEYS) out.fields[key] ??= { value: UNSURE, source: unsure }
  }
}

/**
 * Every date beside a signature (Nov 2026): Form 509's "Date signed", A9,
 * Form 507A's "Date signed", B31 and the tables' "...and dated" start
 * from Form 509's "Date to which summary is made up" as saved — never from
 * 509's own "Date signed", whatever it was changed to. Each can be changed on
 * its form; one never changed follows a later change to the summary date.
 * Blank, with a note, until Form 509 is saved with that date.
 */
/** Other dates filled from Form 509's summary date, like the signature dates (Nov 2026). */
const SAME_DATE_KEYS: Partial<Record<FormCode, string[]>> = {
  '507a': ['f507a_report_date'],
}

const OWN_SOURCE: Record<string, AmountSource> = {
  f507a_report_date: { from: ['Form 509: Date to which summary is made up.', 'Change it here if the report is dated another day.'] },
}

/** Never prefilled: A10 is left for whoever completes it (18 Nov 2026). */
const NOT_PREFILLED = new Set(['a10_date'])

function putSignatureDates(code: FormCode, ctx: CvlContext, out: Prefill) {
  const date = ctx.summaryDate ?? null
  const source: AmountSource = {
    from: ['Form 509: Date to which summary is made up.', 'Change it here if this form is signed on another day.'],
  }
  const note = code === '509'
    ? 'Fills from "Date to which summary is made up" above.'
    : 'Fills from Form 509\'s "Date to which summary is made up" once Form 509 is saved with it.'
  // Part B's B10, "Date the Company started trading", and Form 507A's "Date
  // of Report under s475(1)": the same date (Nov 2026).
  const keys = [...signatureDateKeys(code), ...(SAME_DATE_KEYS[code] ?? [])].filter((k) => !NOT_PREFILLED.has(k))
  for (const key of keys) {
    if (key.startsWith(`${TABLE_DATED_KEY}:`)) {
      if (date) out.signedDates[key.slice(TABLE_DATED_KEY.length + 1)] = { value: date, source }
      continue
    }
    if (date) put(out, key, date, OWN_SOURCE[key] ?? source)
    else out.notes[key] = note
  }
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
