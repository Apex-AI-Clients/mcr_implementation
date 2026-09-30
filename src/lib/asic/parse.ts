import { tidyRegisterName } from '@/lib/abr/names'
import { tidyAddress } from './address'
import { dobFromBornValue, parseExtractDateTime } from './dates'
import { abnMatchesAcn, digitsOnly, isValidAbn, isValidAcn } from './identifiers'
import type {
  AsicExtract,
  AsicExtractType,
  AsicParseFailure,
  AsicParseResult,
  Director,
} from './types'

/**
 * ASIC Current Company Extract: text lines -> the fields Gabby re-types.
 *
 * Pure. It takes the lines extractText.ts pulled out of the PDF, top to bottom,
 * and never sees the file, so every layout quirk is testable with plain text.
 *
 * What it reads, in ASIC's own section names:
 *
 *   cover                         Date/Time (the "as at"), Name and ACN as a fallback
 *   Organisation Details          Name, ACN, ABN, Status — current only
 *   Address Details               Registered and Principal Place Of Business — current only
 *   Officeholders and Other Roles the Director blocks: Name, and the date from Born
 *
 * What it never reads: Contact Address (ASIC's postal address for the company,
 * not one of the wanted fields), and Share Information / Members, which list
 * shareholders with residential addresses. Parsing stops at those headings, so
 * nothing in them can end up in the result.
 *
 * Layout quirks it handles, all seen in a real extract:
 *
 *   - Document numbers printed on the same line as a value
 *     ("Name: JANE SAMPLE 7EBH40554"), on the FIRST line of an address that then
 *     carries on underneath, or on a line of their own.
 *   - Section headings that share their line with a column header
 *     ("Organisation Details Document Number").
 *   - Labels and addresses wrapped across lines, including a label split around
 *     its own value: "Principal Place Of Unit 1, 10 Sample Road, NORTH 7EBH40554"
 *     / "MELBOURNE VIC 3051" / "Business address:".
 *   - A header on every page (the title with the company name, then "ACN …") and
 *     a footer (the date and time, then the page number).
 *   - One person listed as both Director and Secretary — only Director blocks
 *     are taken, and directors are de-duplicated by name and date of birth.
 *   - "Born:" followed by place and country — only the date is kept.
 *   - A Current & Historical extract — previous and ceased entries are skipped,
 *     and a warning says so.
 */

const MESSAGES: Record<AsicParseFailure, string> = {
  no_text: 'This PDF has no readable text. Fill the fields in by hand.',
  not_asic_extract:
    "This doesn't look like an ASIC company extract. Upload the Current Company Extract PDF from ASIC, or fill the fields in by hand.",
  acn_invalid:
    "The ACN on this extract doesn't pass ASIC's check digit, so it may not have been read correctly. Fill the fields in by hand.",
  abn_invalid:
    "The ABN on this extract doesn't pass the ABN check digit, so it may not have been read correctly. Fill the fields in by hand.",
  abn_acn_mismatch:
    "The ABN on this extract doesn't belong to its ACN, so it may not have been read correctly. Fill the fields in by hand.",
}

export const WARNINGS = {
  historical:
    'This is a Current & Historical extract. Only the current details were used; previous names, addresses and officeholders were ignored.',
  noDirectors: 'No current directors were found in this extract. Add them by hand.',
  noRegisteredOffice: 'No registered office address was found in this extract.',
  noPrincipalPlace: 'No principal place of business was found in this extract.',
  noAbn: 'This extract shows no ABN.',
  noDate: "The extract's date couldn't be read.",
  missingDob: (count: number) =>
    count === 1
      ? 'One director has no date of birth in this extract.'
      : `${count} directors have no date of birth in this extract.`,
} as const

function fail(reason: AsicParseFailure): AsicParseResult {
  return { ok: false, reason, message: MESSAGES[reason] }
}

// ─── Lines ──────────────────────────────────────────────────────────────────

const PAGE_NUMBER = /^page \d+ (?:of \d+)?$/i
/** The footer on every page: "23 September 2026 AEST 02:07:38 PM 1". */
const PAGE_FOOTER = /^\d{1,2} [a-z]+ \d{4} [a-z]{3,4} \d{1,2}:\d{2}(?::\d{2})? ?(?:am|pm)? \d+$/i

function normalise(lines: readonly string[]): string[] {
  return lines
    // \s covers tabs and non-breaking spaces, which pdf.js passes through.
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !PAGE_NUMBER.test(line) && !PAGE_FOOTER.test(line))
}

/**
 * Address labels that ASIC splits around the address itself. The label sits in
 * a narrow left column and wraps; the address sits beside it and wraps on its
 * own, so the two interleave:
 *
 *   "Principal Place Of Unit 1, 10 Sample Road, NORTH 7EBH40554"
 *   "MELBOURNE VIC 3051"
 *   "Business address:"
 *
 * becomes "Principal Place Of Business address: Unit 1, …" followed by the
 * rest of the address, which is what the address reader expects.
 */
const SPLIT_LABELS = [
  'principal place of business address:',
  'registered office address:',
  'registered address:',
]

/** How far below its first half the rest of a split label may be. */
const SPLIT_LABEL_REACH = 3

function mergeSplitLabels(lines: string[]): string[] {
  const out = [...lines]
  for (let i = 0; i < out.length; i++) {
    if (isLabelled(out[i])) continue
    const words = out[i].split(' ')
    SPLIT_LABELS.some((label) => {
      const labelWords = label.split(' ')
      // Longest match first, so "Principal Place Of" is not read as "Principal".
      for (let k = Math.min(labelWords.length - 1, words.length); k >= 1; k--) {
        if (words.slice(0, k).join(' ').toLowerCase() !== labelWords.slice(0, k).join(' ')) continue
        const rest = labelWords.slice(k).join(' ')
        for (let j = i + 1; j <= i + SPLIT_LABEL_REACH && j < out.length; j++) {
          if (out[j].toLowerCase().startsWith(rest)) {
            const tail = out[j].slice(rest.length).trim()
            const labelText = `${words.slice(0, k).join(' ')} ${out[j].slice(0, rest.length)}`
            out[i] = `${labelText} ${words.slice(k).join(' ')}`.trim()
            out.splice(j, 1, ...(tail ? [tail] : []))
            return true
          }
          // Another field starts before the label was completed: not a split label.
          if (isLabelled(out[j])) break
        }
      }
      return false
    })
  }
  return out
}

/**
 * Labels that wrap. "Principal Place Of" / "Business address: ..." becomes one
 * line, so the rest of the parser only ever sees whole labels.
 */
const WRAPPABLE_LABELS = [
  'registered address:',
  'principal place of business address:',
  'appointment date:',
  'registration date:',
  'next review date:',
  'date/time:',
  'start date:',
  'cease date:',
  'end date:',
]

function joinWrappedLabels(lines: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    // Up to three lines for one label, e.g. "Principal Place" / "Of Business" / "address:".
    for (let joined = 0; joined < 2 && i + 1 < lines.length; joined++) {
      const lower = line.toLowerCase()
      if (isLabelled(line)) break
      const merged = `${line} ${lines[i + 1]}`
      const mergedLower = merged.toLowerCase()
      const continues = WRAPPABLE_LABELS.some(
        (label) =>
          label.startsWith(`${lower} `) &&
          (mergedLower.startsWith(label) || label.startsWith(mergedLower)),
      )
      if (!continues) break
      line = merged
      i++
    }
    out.push(line)
  }
  return out
}

const LABELLED = /^([A-Za-z][A-Za-z &/()'.-]{0,48}):(?:\s+(.*))?$/

function isLabelled(line: string): boolean {
  return LABELLED.test(line)
}

function readLabel(line: string): { label: string; value: string } | null {
  const match = LABELLED.exec(line)
  if (!match) return null
  return { label: match[1].trim().toLowerCase().replace(/\s+/g, ' '), value: (match[2] ?? '').trim() }
}

/**
 * An ASIC document number: an 8–10 character run of capitals and digits with at
 * least one digit — "7EBH40554", "032144978". The digit is what tells it apart
 * from the last word of a name.
 */
const DOCUMENT_NUMBER = /^(?=[A-Z0-9]*\d)[A-Z0-9]{8,10}$/

function isDocumentNumber(token: string): boolean {
  return DOCUMENT_NUMBER.test(token)
}

/** "JANE SAMPLE 7EBH40554" -> "JANE SAMPLE". Only ever the last token. */
function stripDocumentNumber(value: string): { text: string; stripped: boolean } {
  const tokens = value.split(' ')
  if (tokens.length > 1 && isDocumentNumber(tokens[tokens.length - 1])) {
    return { text: tokens.slice(0, -1).join(' '), stripped: true }
  }
  if (tokens.length === 1 && isDocumentNumber(tokens[0])) return { text: '', stripped: true }
  return { text: value, stripped: false }
}

// ─── Sections ───────────────────────────────────────────────────────────────

type Section = 'organisation' | 'address' | 'contact' | 'officeholders' | 'other' | 'end'

const OTHER_SECTIONS = [
  'share information',
  'share structure',
  'shares',
  'members',
  'shareholders',
  'documents',
  'financial reports',
  'charges',
  'ultimate holding company',
  'external administration',
]

/** The column header ASIC prints on the same line as some section headings. */
const HEADING_COLUMN = /\s+document number$/

function sectionOf(line: string): Section | null {
  if (isLabelled(line)) return null
  const lower = line.toLowerCase().replace(HEADING_COLUMN, '')
  if (/^\*+\s*end of extract/.test(lower)) return 'end'
  if (lower === 'organisation details') return 'organisation'
  if (lower === 'address details') return 'address'
  if (lower.startsWith('contact address')) return 'contact'
  if (lower === 'officeholders and other roles' || lower === 'officeholders') return 'officeholders'
  if (OTHER_SECTIONS.some((heading) => lower === heading || lower.startsWith(`${heading} `))) {
    return 'other'
  }
  return null
}

/** A sub-heading that says whether what follows is current or not. */
function currentnessOf(line: string): boolean | null {
  if (isLabelled(line)) return null
  if (/^current\b/i.test(line)) return true
  if (/^(previous|former|ceased|historical|past)\b/i.test(line)) return false
  return null
}

const DIRECTOR_ROLES = new Set(['director', 'directors'])
const OTHER_ROLES = new Set([
  'secretary',
  'secretaries',
  'alternate director',
  'alternate directors',
  'public officer',
  'appointed auditor',
  'auditor',
  'liquidator',
  'provisional liquidator',
  'administrator',
  'receiver',
  'receiver and manager',
  'controller',
  'managing controller',
  'local agent',
])

function roleOf(line: string): 'director' | 'other' | null {
  const lower = line.toLowerCase()
  if (DIRECTOR_ROLES.has(lower)) return 'director'
  if (OTHER_ROLES.has(lower)) return 'other'
  return null
}

interface SectionLines {
  section: Section
  /** Each line with whether it sits under a "Current" (true) or "Previous" (false) heading. */
  lines: { text: string; current: boolean }[]
}

function splitSections(lines: string[]): { cover: string[]; sections: SectionLines[] } {
  const cover: string[] = []
  const sections: SectionLines[] = []
  let active: SectionLines | null = null
  let current = true

  for (const line of lines) {
    const section = sectionOf(line)
    if (section === 'end') break
    if (section) {
      active = { section, lines: [] }
      sections.push(active)
      current = true
      continue
    }
    if (!active) {
      cover.push(line)
      continue
    }
    const currentness = currentnessOf(line)
    if (currentness !== null) {
      current = currentness
      continue
    }
    active.lines.push({ text: line, current })
  }
  return { cover, sections }
}

/**
 * Drop page headers that repeat the cover on every page.
 *
 * Any later line identical to a cover line is furniture. Without this a
 * repeated "Name: SAMPLE TRADING PTY LTD" header inside the officeholders
 * section would start a phantom director, and a repeated title line
 * ("Current Company Extract") would read as a "Current" sub-heading.
 */
function dropRepeatedCover(lines: string[]): { cover: string[]; body: string[] } {
  const firstSection = lines.findIndex((line) => sectionOf(line) !== null)
  const cover = firstSection > 0 ? lines.slice(0, firstSection) : []
  const seen = new Set(cover)
  const body = lines
    .slice(Math.max(firstSection, 0))
    .filter(
      (line) => !seen.has(line) && !PAGE_HEADER_TITLE.test(line) && !PAGE_HEADER_ACN.test(line),
    )
  return { cover, body }
}

/**
 * The header on every page: the title followed by the company name, then the
 * ACN on a line of its own with no colon. Dropped from the body wherever they
 * fall — a header can land in the middle of a director's block.
 */
const PAGE_HEADER_TITLE = /^current\s*(?:(?:&|and)\s*historical\s+)?company\s+extract\b/i
const PAGE_HEADER_ACN = /^acn \d{3} ?\d{3} ?\d{3}$/i

// ─── Fields ─────────────────────────────────────────────────────────────────

const ACN_PATTERN = /\b(\d{3}) ?(\d{3}) ?(\d{3})\b/
const ABN_PATTERN = /\b(\d{2}) ?(\d{3}) ?(\d{3}) ?(\d{3})\b/

function acnIn(value: string): string | null {
  const match = ACN_PATTERN.exec(value)
  return match ? digitsOnly(match[0]) : null
}

function abnIn(value: string): string | null {
  const match = ABN_PATTERN.exec(value)
  return match ? digitsOnly(match[0]) : null
}

/** A label's value: on its own line, or — when that is empty — the next line. */
function valueAt(texts: string[], index: number, value: string): string {
  if (value) return value
  const next = texts[index + 1]
  if (next && !isLabelled(next) && !roleOf(next)) return next
  return ''
}

interface CoverFields {
  extractType: AsicExtractType | null
  companyName: string | null
  acn: string | null
  extractedAt: string | null
}

const HISTORICAL_TITLE = /current\s*(?:&|and)\s*historical\s+company\s+extract/i
const CURRENT_TITLE = /current\s+company\s+extract/i

function readCover(cover: string[]): CoverFields {
  const fields: CoverFields = { extractType: null, companyName: null, acn: null, extractedAt: null }
  const text = cover.join(' ')
  if (HISTORICAL_TITLE.test(text)) fields.extractType = 'current_and_historical'
  else if (CURRENT_TITLE.test(text)) fields.extractType = 'current'

  cover.forEach((line, index) => {
    const read = readLabel(line)
    if (!read) return
    const value = valueAt(cover, index, read.value)
    if (read.label === 'name' && !fields.companyName) {
      fields.companyName = stripDocumentNumber(value).text || null
    }
    if (read.label === 'acn' && !fields.acn) fields.acn = acnIn(value)
    if (read.label === 'date/time' && !fields.extractedAt) {
      fields.extractedAt = parseExtractDateTime(value)
    }
  })
  return fields
}

interface OrganisationFields {
  companyName: string | null
  acn: string | null
  abn: string | null
  status: string | null
}

function readOrganisation(section: SectionLines | undefined): OrganisationFields {
  const fields: OrganisationFields = { companyName: null, acn: null, abn: null, status: null }
  if (!section) return fields
  const current = section.lines.filter((line) => line.current).map((line) => line.text)

  current.forEach((line, index) => {
    const read = readLabel(line)
    if (!read) return
    const value = valueAt(current, index, read.value)
    if (read.label === 'name' && !fields.companyName) {
      fields.companyName = stripDocumentNumber(value).text || null
    } else if (read.label === 'acn' && !fields.acn) {
      fields.acn = acnIn(value)
    } else if (read.label === 'abn' && !fields.abn) {
      fields.abn = abnIn(value)
    } else if (read.label === 'status' && !fields.status) {
      fields.status = stripDocumentNumber(value).text || null
    }
  })
  return fields
}

const ADDRESS_LABELS: Record<string, 'registered' | 'principal'> = {
  'registered address': 'registered',
  'registered office address': 'registered',
  'principal place of business address': 'principal',
  'principal place of business': 'principal',
}

/** A block that has ended is history, whatever heading it sits under. */
const ENDED = /^(end|cease|ceased) date:/i

function readAddresses(section: SectionLines | undefined): {
  registered: string | null
  principal: string | null
} {
  const found: { registered: string | null; principal: string | null } = {
    registered: null,
    principal: null,
  }
  if (!section) return found
  const current = section.lines.filter((line) => line.current).map((line) => line.text)

  for (let i = 0; i < current.length; i++) {
    const read = readLabel(current[i])
    const kind = read ? ADDRESS_LABELS[read.label] : undefined
    if (!read || !kind) continue

    // The address itself: this line's value, then the lines it wrapped onto, up
    // to the next label ("Start date:"). The document number is dropped from
    // whichever line carries it — ASIC prints it beside the FIRST line of the
    // address, so it cannot be taken as the end of one.
    const parts: string[] = []
    let ended = false
    const first = stripDocumentNumber(read.value)
    if (first.text) parts.push(first.text)
    let j = i + 1
    for (; j < current.length; j++) {
      const line = current[j]
      if (isLabelled(line)) break
      const part = stripDocumentNumber(line)
      if (part.text) parts.push(part.text)
    }
    // The rest of the block, up to the next address: has it ended?
    for (let k = j; k < current.length; k++) {
      const next = readLabel(current[k])
      if (next && ADDRESS_LABELS[next.label]) break
      if (ENDED.test(current[k])) ended = true
    }

    const address = parts.join(' ').trim()
    if (address && !ended && !found[kind]) found[kind] = tidyAddress(address)
  }
  return found
}

function readDirectors(section: SectionLines | undefined): Director[] {
  if (!section) return []
  const directors: Director[] = []
  const seen = new Set<string>()
  let role: 'director' | 'other' | null = null
  const lines = section.lines

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text
    const heading = roleOf(text)
    if (heading) {
      role = heading
      continue
    }
    const read = readLabel(text)
    if (!read || read.label !== 'name') continue
    const isCurrent = lines[i].current

    // The name, and any line it wrapped onto, up to the next label.
    let name = stripDocumentNumber(read.value).text
    let j = i + 1
    for (; j < lines.length; j++) {
      const line = lines[j].text
      if (isLabelled(line) || roleOf(line)) break
      const part = stripDocumentNumber(line).text
      if (part) name = name ? `${name} ${part}` : part
    }

    // The rest of this person's block, up to the next person or role.
    let dateOfBirth: string | null = null
    let ended = false
    for (; j < lines.length; j++) {
      const line = lines[j].text
      if (roleOf(line)) break
      const field = readLabel(line)
      if (field?.label === 'name') break
      if (field?.label === 'born' && dateOfBirth === null) {
        dateOfBirth = dobFromBornValue(field.value || lines[j + 1]?.text || '')
      }
      if (ENDED.test(line)) ended = true
    }
    i = j - 1

    if (role !== 'director' || !isCurrent || ended || !name) continue
    const key = `${name.toUpperCase()}|${dateOfBirth ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    directors.push({ name: tidyRegisterName(name), dateOfBirth })
  }
  return directors
}

// ─── The parse ──────────────────────────────────────────────────────────────

/** Fewer letters than this across the whole document means there is no text layer. */
const MIN_LETTERS = 20

export function parseAsicExtract(rawLines: readonly string[]): AsicParseResult {
  const lines = joinWrappedLabels(mergeSplitLabels(normalise(rawLines)))
  const letters = lines.join('').replace(/[^A-Za-z]/g, '').length
  if (letters < MIN_LETTERS) return fail('no_text')

  const { cover: coverLines, body } = dropRepeatedCover(lines)
  const cover = readCover(coverLines.length ? coverLines : lines)
  const { sections } = splitSections(body)
  const find = (kind: Section) => sections.find((section) => section.section === kind)

  const organisationSection = find('organisation')
  const officeholderSection = find('officeholders')
  if (!cover.extractType || (!organisationSection && !officeholderSection)) {
    return fail('not_asic_extract')
  }

  const organisation = readOrganisation(organisationSection)
  const acn = organisation.acn ?? cover.acn
  if (!acn) return fail('not_asic_extract')
  if (!isValidAcn(acn)) return fail('acn_invalid')

  const abn = organisation.abn
  if (abn) {
    if (!isValidAbn(abn)) return fail('abn_invalid')
    if (!abnMatchesAcn(abn, acn)) return fail('abn_acn_mismatch')
  }

  const addresses = readAddresses(find('address'))
  const directors = readDirectors(officeholderSection)
  const companyName = organisation.companyName ?? cover.companyName

  const warnings: string[] = []
  if (cover.extractType === 'current_and_historical') warnings.push(WARNINGS.historical)
  if (!cover.extractedAt) warnings.push(WARNINGS.noDate)
  if (!abn) warnings.push(WARNINGS.noAbn)
  if (!addresses.registered) warnings.push(WARNINGS.noRegisteredOffice)
  if (!addresses.principal) warnings.push(WARNINGS.noPrincipalPlace)
  if (directors.length === 0) warnings.push(WARNINGS.noDirectors)
  const missingDob = directors.filter((director) => !director.dateOfBirth).length
  if (missingDob > 0) warnings.push(WARNINGS.missingDob(missingDob))

  const extract: AsicExtract = {
    companyName: companyName ? tidyRegisterName(companyName) : null,
    acn,
    abn,
    status: organisation.status,
    registeredOffice: addresses.registered,
    principalPlaceOfBusiness: addresses.principal,
    directors,
    extractType: cover.extractType,
    extractedAt: cover.extractedAt,
    warnings,
  }
  return { ok: true, extract }
}
