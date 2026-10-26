import { parse } from 'csv-parse/sync'
import { DOCUMENT_CATEGORIES, type DocCategory } from '@/lib/constants'
import { nameKey } from '@/lib/sbr/import/normalise'

/**
 * Which ATO account a CSV is, read from its content: line 1 names the account
 * ("Activity statement 001", "Income tax 001", "Superannuation guarantee
 * employer 005") and line 2 the entity the ATO holds it for. The filename and
 * the slot it was dropped in decide nothing — a file in the wrong slot is
 * moved to the right one, with a note saying so (migration 0038).
 *
 * Pure. Not used by the lodgement analysis, which keeps its own check
 * (isActivityStatementCsv) so the SBR prediction's source cannot change.
 */

export type AtoAccountKind = 'activity_statement' | 'income_tax' | 'super_guarantee'

/** What line 1 says; 'unrecognised' for any other CSV in an ATO account slot. */
export type DetectedAtoAccountKind = AtoAccountKind | 'unrecognised'

export interface AtoAccountHeader {
  kind: DetectedAtoAccountKind
  /** Line 1 as printed, e.g. "Income tax 001"; null when the file has no first line. */
  label: string | null
  /** Line 2 as printed, e.g. "EXAMPLE TRADING PTY LTD". */
  entityName: string | null
}

const KIND_PATTERNS: [AtoAccountKind, RegExp][] = [
  ['activity_statement', /^activity statement\b/i],
  ['income_tax', /^income tax\b/i],
  ['super_guarantee', /^superannuation guarantee\b/i],
]

/** The slot each account type is filed in. */
export const ATO_ACCOUNT_SLOT: Record<AtoAccountKind, DocCategory> = {
  activity_statement: DOCUMENT_CATEGORIES.INTEGRATED_CLIENT_ACCOUNT,
  income_tax: DOCUMENT_CATEGORIES.ATO_INCOME_TAX_ACCOUNT,
  super_guarantee: DOCUMENT_CATEGORIES.ATO_SUPER_GUARANTEE_ACCOUNT,
}

export const ATO_ACCOUNT_CATEGORIES: readonly DocCategory[] = Object.values(ATO_ACCOUNT_SLOT)

export function isAtoAccountCategory(category: string): boolean {
  return (ATO_ACCOUNT_CATEGORIES as readonly string[]).includes(category)
}

/** How an account type is named in the notes: "an income tax account". */
const KIND_NAME: Record<AtoAccountKind, string> = {
  activity_statement: 'an activity statement account',
  income_tax: 'an income tax account',
  super_guarantee: 'a superannuation guarantee account',
}

/** The slot names as the client file shows them. */
export const ATO_SLOT_LABEL: Record<AtoAccountKind, string> = {
  activity_statement: 'ATO activity statement',
  income_tax: 'ATO income tax account',
  super_guarantee: 'ATO superannuation guarantee account',
}

export const UNRECOGNISED_NOTE = 'Account type not recognised yet'

/** Lines 1 and 2 of an ATO account CSV. Never throws. */
export function readAtoAccountHeader(csvText: string): AtoAccountHeader {
  let rows: string[][] = []
  try {
    const head = csvText.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').slice(0, 3).join('\n')
    rows = parse(head, { relax_column_count: true, relax_quotes: true, skip_empty_lines: true })
  } catch {
    rows = []
  }
  const label = rows[0]?.[0]?.trim() || null
  const entityName = rows[1]?.[0]?.trim() || null
  const kind = (label && KIND_PATTERNS.find(([, pattern]) => pattern.test(label))?.[0]) || 'unrecognised'
  return { kind, label, entityName }
}

/**
 * Where a CSV uploaded to an ATO account slot belongs, and the note to show
 * when it was moved there. An unrecognised account stays where it was put.
 */
export function fileAtoAccount(
  uploadedTo: DocCategory,
  kind: DetectedAtoAccountKind,
): { category: DocCategory; note: string | null } {
  if (kind === 'unrecognised') return { category: uploadedTo, note: UNRECOGNISED_NOTE }
  const category = ATO_ACCOUNT_SLOT[kind]
  if (category === uploadedTo) return { category, note: null }
  return { category, note: `This is ${KIND_NAME[kind]}; moved to ${ATO_SLOT_LABEL[kind]}` }
}

/**
 * Whether the entity on line 2 is one the client goes by (its name, company
 * or trust), ignoring case, punctuation and "Pty Ltd". Null when there is
 * nothing to compare.
 */
export function entityMatches(entityName: string | null, names: readonly (string | null | undefined)[]): boolean | null {
  if (!entityName) return null
  const known = names.filter((n): n is string => typeof n === 'string' && nameKey(n) !== '')
  if (known.length === 0) return null
  const key = nameKey(entityName)
  return known.some((n) => nameKey(n) === key)
}

/** The warning shown beside a file whose entity is not the client's. */
export function entityMismatchNote(entityName: string): string {
  return `This account is for ${entityName}, which does not match the client's company or trust name. Check it is the right client.`
}

/** What a file row shows for an ATO account CSV: its account, why it is in this slot, and an entity warning. */
export interface AtoFileInfo {
  atoAccountLabel: string | null
  categoryNote: string | null
  entityWarning: string | null
}

/** The ATO account details of a documents row, checked against the names the client goes by. */
export function atoFileInfo(
  row: { ato_account_label: string | null; ato_entity_name: string | null; category_note: string | null },
  names: readonly (string | null | undefined)[],
): AtoFileInfo {
  const mismatch = entityMatches(row.ato_entity_name, names) === false
  return {
    atoAccountLabel: row.ato_account_label,
    categoryNote: row.category_note,
    entityWarning: mismatch && row.ato_entity_name ? entityMismatchNote(row.ato_entity_name) : null,
  }
}
