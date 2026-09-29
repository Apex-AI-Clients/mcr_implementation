import { tidyRegisterName } from '@/lib/abr/names'
import { formatAsicAddress, type AsicAddressParts } from './address'
import { normaliseIsoDob } from './dob'
import { AsicResponseError } from './errors'
import { digitsOnly } from './identifiers'
import type {
  AsicCoded,
  AsicCompany,
  AsicDirector,
  AsicExtractSummary,
  AsicPurchase,
} from './types'

/**
 * asicapi's JSON -> what this app keeps.
 *
 * Pure and provider-shaped: this is the one file that knows asicapi's field
 * names, so a second provider is a second mapper. Written against the shapes
 * in asicapi's docs (Sep 2026), and defensive about everything — the provider
 * is unverified, and a field that is missing or the wrong type means "not
 * known", never a crash or a guess.
 *
 * What an extract becomes:
 *
 *   directors   officeholders with role DR, status C, no ceasedAt, a person.
 *               Secretaries and every other role are dropped, so a person who
 *               is both director and secretary appears once, as a director.
 *               An unknown status code is not treated as current.
 *   addresses   RG registered office (RP for a foreign company), PA principal
 *               place of business — or a type labelled "principal place", in
 *               case the code changes. Current only. Both are kept even when
 *               identical. The CC contact address is ASIC's own postal
 *               address and is ignored.
 *   dropped     members/shareholders (names and residential addresses),
 *               officeholder addresses and places of birth — from the summary
 *               *and* from the raw copy that is stored.
 *
 * Coded values are compared on code. asicapi returns an unknown code with its
 * label set to the code, so the label is never relied on except as the
 * documented principal-place fallback.
 */

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asCoded(value: unknown): AsicCoded {
  const coded = asObject(value)
  const code = asString(coded?.code)
  return { code, label: asString(coded?.label) || code }
}

/** A section arrives as a plain array or as a list object { data: [...] }. */
function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const data = asObject(value)?.data
  return Array.isArray(data) ? data : []
}

// ============================================================
// Company
// ============================================================

/** Null when there is no usable ACN and name — nothing to show staff. */
export function mapAsicapiCompany(json: unknown): AsicCompany | null {
  const company = asObject(json)
  if (!company) return null

  const acn = digitsOnly(asString(company.acn))
  const name = tidyRegisterName(asString(company.name))
  if (acn.length !== 9 || !name) return null

  const abn = digitsOnly(asString(company.abn))
  return {
    acn,
    abn: abn.length === 11 ? abn : '',
    name,
    status: asCoded(company.status),
    type: asCoded(company.type),
  }
}

// ============================================================
// Directors
// ============================================================

function isCurrent(entry: JsonObject): boolean {
  if (asString(entry.ceasedAt)) return false
  const status = asObject(entry.status)
  // A current extract should mark everything 'C'. A missing status is read as
  // current rather than losing every director over an omitted field; a status
  // that is present but not 'C' — ceased, future, or a code we do not know —
  // is not.
  return status === null || asString(status.code) === 'C'
}

function personName(party: JsonObject): string {
  const person = asObject(party.person)
  if (!person) return ''
  const formatted = asString(person.formatted)
  if (formatted) return tidyRegisterName(formatted)

  const given = Array.isArray(person.givenNames) ? person.givenNames.map(asString) : []
  return tidyRegisterName([...given, asString(person.familyName)].filter(Boolean).join(' '))
}

/** Case and spacing folded, so "JANE  SAMPLE" and "Jane Sample" match. */
function nameKey(name: string): string {
  return name.toUpperCase().replace(/\s+/g, ' ')
}

/**
 * The same director listed twice collapses to one.
 *
 * Keyed on name *and* date of birth where both are known, so two different
 * people who share a name — a father and son on the same board — are not
 * merged. An entry with no date of birth folds into a same-named entry that
 * has one, and a later dated entry fills in an earlier undated one.
 */
function dedupeDirectors(directors: AsicDirector[]): AsicDirector[] {
  const kept: AsicDirector[] = []
  for (const director of directors) {
    const key = nameKey(director.name)
    const sameName = kept.filter((existing) => nameKey(existing.name) === key)

    if (sameName.length === 0) {
      kept.push(director)
      continue
    }
    if (director.dateOfBirth === null) continue
    if (sameName.some((existing) => existing.dateOfBirth === director.dateOfBirth)) continue

    const undated = sameName.find((existing) => existing.dateOfBirth === null)
    if (undated) undated.dateOfBirth = director.dateOfBirth
    else kept.push(director)
  }
  return kept
}

export function mapDirectors(officeholders: unknown): AsicDirector[] {
  const directors: AsicDirector[] = []

  for (const item of asList(officeholders)) {
    const entry = asObject(item)
    if (!entry) continue
    if (asCoded(entry.role).code !== 'DR') continue
    if (!isCurrent(entry)) continue

    const party = asObject(entry.party)
    if (!party) continue
    const name = personName(party)
    if (!name) continue

    directors.push({ name, dateOfBirth: normaliseIsoDob(asObject(party.birth)?.date) })
  }

  return dedupeDirectors(directors)
}

// ============================================================
// Addresses
// ============================================================

type AddressMatcher = (type: AsicCoded) => boolean

const isRegisteredOffice: AddressMatcher = (type) => type.code === 'RG'
const isForeignRegisteredOffice: AddressMatcher = (type) => type.code === 'RP'
const isPrincipalPlace: AddressMatcher = (type) =>
  type.code === 'PA' || /principal place/i.test(type.label)

/**
 * The current address of one type, as a line. If ASIC holds more than one
 * current entry of a type — it should not — the most recent `from` wins.
 */
function pickAddress(addresses: unknown, matches: AddressMatcher): string | null {
  const candidates = asList(addresses)
    .map(asObject)
    .filter((entry): entry is JsonObject => entry !== null)
    .filter((entry) => matches(asCoded(entry.type)) && isCurrent(entry))
    .sort((a, b) => asString(b.from).localeCompare(asString(a.from)))

  for (const entry of candidates) {
    const line = formatAsicAddress(asObject(entry.address) as AsicAddressParts | null)
    if (line) return line
  }
  return null
}

// ============================================================
// Redaction — what is stored as raw
// ============================================================

const PERSONAL_SECTIONS = new Set(['members', 'shareholders'])

/** Members and shareholders removed wherever they appear. */
function withoutPersonalSections(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPersonalSections)
  const object = asObject(value)
  if (!object) return value
  const out: JsonObject = {}
  for (const [key, child] of Object.entries(object)) {
    if (PERSONAL_SECTIONS.has(key)) continue
    out[key] = withoutPersonalSections(child)
  }
  return out
}

/** One officeholder with its address gone, and its birth cut to a director's date. */
function redactOfficeholder(item: unknown): unknown {
  const entry = asObject(item)
  if (!entry) return item
  const party = asObject(entry.party)
  const isDirector = asCoded(entry.role).code === 'DR'
  const birthDate = asObject(party?.birth)?.date

  return {
    ...entry,
    address: null,
    party: party
      ? { ...party, birth: isDirector && birthDate !== undefined ? { date: birthDate } : null }
      : entry.party,
  }
}

/**
 * The provider's response, safe to store: no members or shareholders, no
 * officeholder addresses, no places of birth, and no dates of birth for anyone
 * but a director. Everything else — the officeholder list itself, documents,
 * meta — stays, for audit and so a question about what was bought can be
 * answered from our own copy.
 */
export function redactAsicapiExtract(json: unknown): unknown {
  const cleaned = withoutPersonalSections(json)
  const root = asObject(cleaned)
  if (!root || !('officeholders' in root)) return cleaned

  const officeholders = root.officeholders
  if (Array.isArray(officeholders)) {
    return { ...root, officeholders: officeholders.map(redactOfficeholder) }
  }
  const list = asObject(officeholders)
  if (list && Array.isArray(list.data)) {
    return { ...root, officeholders: { ...list, data: list.data.map(redactOfficeholder) } }
  }
  return root
}

// ============================================================
// Extract
// ============================================================

/**
 * A purchase response -> summary and redacted raw.
 *
 * Identity comes from a nested `company` object when there is one, and from the
 * top level otherwise. The ACN the provider answered for must be the one we
 * asked about: an extract for a different company is refused outright, because
 * attaching it would put another company's directors on this file.
 */
export function mapAsicapiExtract(json: unknown, requestedAcn: string): AsicPurchase {
  const root = asObject(json)
  if (!root) throw new AsicResponseError('The extract response was not an object.')

  const identity = asObject(root.company) ?? root
  const answeredAcn = digitsOnly(asString(identity.acn))
  const acn = digitsOnly(requestedAcn)
  if (answeredAcn && answeredAcn !== acn) {
    throw new AsicResponseError('The extract returned is for a different ACN.')
  }

  const reference = asObject(root.extract) ?? (asString(root.object) === 'extract' ? root : null)
  const asOf = asString(reference?.asOf) || asString(root.asOf) || null
  const abn = digitsOnly(asString(identity.abn))

  const addresses = root.addresses
  const summary: AsicExtractSummary = {
    acn,
    abn: abn.length === 11 ? abn : '',
    companyName: tidyRegisterName(asString(identity.name)),
    companyStatus: asCoded(identity.status),
    registeredOffice:
      pickAddress(addresses, isRegisteredOffice) ?? pickAddress(addresses, isForeignRegisteredOffice),
    principalPlaceOfBusiness: pickAddress(addresses, isPrincipalPlace),
    directors: mapDirectors(root.officeholders),
    asOf,
  }

  return {
    providerExtractId: asString(reference?.id) || null,
    asOf,
    summary,
    raw: redactAsicapiExtract(json),
  }
}
