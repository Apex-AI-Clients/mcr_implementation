import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadPrintedComparison } from '@/lib/printed/store'
import { loadMapping } from '@/lib/printed/mappingStore'
import { columnSourceLabel, resolveMeaning, type MappedLine, type MappingEntry } from '@/lib/printed/mapping'
import type { PrintedComparison } from '@/lib/printed/compare'
import type { Meaning } from '@/lib/printed/meanings'
import { loadAtoAccounts, type AtoAccountsOverview } from '@/lib/analysis/atoAccount/store'
import { readSavedCreditors, type CreditorRow } from '@/lib/sbr/creditors'
import { readDirectors } from '@/lib/clients/companyDetails'
import type { Director } from '@/lib/asic/types'
import type { AsicSectionPages } from '@/lib/asic/readUpload'
import { loadCvlSettings, type CvlSettings } from './settings'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * Everything on the client file the CVL entry screens are pre-filled from,
 * read once (prefill.ts turns it into answers, without touching the database).
 * Reuses what the app already reads: no new extraction, no AI.
 */

export interface BalanceSheetFigure {
  /** As the meaning counts it; liabilities positive. */
  amount: number
  lines: MappedLine[]
  /** "FY2026 balance sheet" or "current period at 30 Sep 2026". */
  statement: string
}

export interface CvlContext {
  clientId: string
  client: { name: string; email: string; phone: string | null }
  company: {
    companyName: string | null
    entityType: string | null
    acn: string | null
    abn: string | null
    trustName: string | null
    registeredOffice: string | null
    principalPlace: string | null
    directors: Director[]
    registrationDate: string | null
    /** The ASIC extract the fields were filled from, when they were (asic_pdf / asic_pdf_edited). */
    asicExtractDate: string | null
    source: string | null
  } | null
  /** The newest ASIC extract kept on the file (migration 0041), for ⓘ links at a page. */
  asicExtract: { id: string; extractedAt: string | null; pages: Partial<AsicSectionPages> } | null
  accountant: { companyName: string | null; contactPerson: string | null; phone: string | null; email: string | null } | null
  /** The latest balance sheet's confirmed lines, per meaning: only those with a figure. */
  balanceSheet: Partial<Record<Meaning, BalanceSheetFigure>>
  atoAccounts: AtoAccountsOverview
  /** The creditor rows saved with the SBR prediction, when there is one. */
  sbrCreditors: CreditorRow[]
  settings: CvlSettings
}

/** Liabilities and assets the CVL forms read from the latest balance sheet. */
const BALANCE_SHEET_MEANINGS: Meaning[] = [
  'cash_at_bank', 'cash_on_hand', 'trade_debtors', 'stock', 'plant_equipment', 'other_assets', 'share_capital',
  'loan_receivable', 'loan_payable', 'ato_debt', 'income_tax_payable', 'credit_cards', 'cash_loans', 'bank_overdraft', 'trade_suppliers',
]

/** The confirmed lines for each meaning in the latest balance sheet column that prints anything. Pure. */
export function latestBalanceSheet(comparison: PrintedComparison, mapping: MappingEntry[]): Partial<Record<Meaning, BalanceSheetFigure>> {
  const bs = comparison.tables.find((t) => t.kind === 'balance_sheet')
  const index = bs ? [...comparison.columns.keys()].reverse().find((i) => bs.rows.some((r) => r.cells[i].printed)) : undefined
  if (index === undefined) return {}
  const statement = columnSourceLabel(comparison.columns[index])
  const out: Partial<Record<Meaning, BalanceSheetFigure>> = {}
  for (const meaning of BALANCE_SHEET_MEANINGS) {
    const r = resolveMeaning(comparison, mapping, meaning)
    const year = r.years[index]
    if (r.status !== 'mapped' || !year || year.value === null) continue
    out[meaning] = { amount: Math.round(year.value * 100) / 100, lines: year.lines, statement }
  }
  return out
}

export async function loadCvlContext(supabase: ServerClient, clientId: string): Promise<CvlContext> {
  const [client, company, extract, accountant, comparison, mapping, atoAccounts, prediction, settings] = await Promise.all([
    supabase.from('clients').select('name, email, phone').eq('id', clientId).single(),
    supabase.from('company_details').select('*').eq('client_id', clientId).maybeSingle(),
    supabase
      .from('client_asic_extracts')
      .select('id, extracted_at, section_pages')
      .eq('client_id', clientId)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('accountant_details').select('company_name, contact_person, phone_number, email_address').eq('client_id', clientId).maybeSingle(),
    // Stored reads only: statements are read (once) when the comparison page is
    // opened. Reading here would parse PDFs again on every form open.
    loadPrintedComparison(supabase, clientId),
    loadMapping(supabase, clientId),
    loadAtoAccounts(supabase, clientId),
    supabase.from('sbr_outcome_predictions').select('creditors').eq('client_id', clientId).maybeSingle(),
    loadCvlSettings(supabase),
  ])
  const c = company.data
  return {
    clientId,
    client: { name: client.data?.name ?? '', email: client.data?.email ?? '', phone: client.data?.phone ?? null },
    company: c
      ? {
          companyName: c.company_name,
          entityType: c.entity_type,
          acn: c.acn_number,
          abn: c.abn_number,
          trustName: c.trust_name,
          registeredOffice: c.registered_office_address,
          principalPlace: c.principal_place_of_business,
          directors: readDirectors(c.directors),
          registrationDate: c.registration_date,
          asicExtractDate: c.asic_extract_date,
          source: c.company_details_source,
        }
      : null,
    asicExtract: extract.data
      ? { id: extract.data.id, extractedAt: extract.data.extracted_at, pages: (extract.data.section_pages ?? {}) as Partial<AsicSectionPages> }
      : null,
    accountant: accountant.data
      ? {
          companyName: accountant.data.company_name,
          contactPerson: accountant.data.contact_person,
          phone: accountant.data.phone_number,
          email: accountant.data.email_address,
        }
      : null,
    balanceSheet: latestBalanceSheet(comparison.comparison, mapping),
    atoAccounts,
    sbrCreditors: readSavedCreditors(prediction.data?.creditors ?? null)?.rows ?? [],
    settings,
  }
}
