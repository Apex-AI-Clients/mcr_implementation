import type { PrintedStatementKind } from './types'

/**
 * What a printed line can stand for, for the headline tiles and the SBR
 * prediction. Staff confirm, per client, which printed lines these are
 * (mapping.ts); nothing else feeds the tiles or the prediction.
 */

export type Meaning =
  | 'revenue'
  | 'net_profit'
  | 'net_assets'
  | 'ato_debt'
  | 'income_tax_payable'
  | 'loan_receivable'
  | 'loan_payable'
  | 'credit_cards'
  | 'cash_loans'
  | 'bank_overdraft'
  | 'trade_suppliers'

export interface MeaningInfo {
  key: Meaning
  label: string
  statement: PrintedStatementKind
  /** Several printed lines may make it up (GST, PAYG, BAS Payable…); else exactly one. */
  multiple: boolean
  /** Shown as a headline tile on the comparison page. */
  tile: boolean
  hint: string
}

export const MEANINGS: MeaningInfo[] = [
  { key: 'revenue', label: 'Revenue', statement: 'profit_and_loss', multiple: false, tile: true, hint: 'The total income or sales line.' },
  { key: 'net_profit', label: 'Net profit', statement: 'profit_and_loss', multiple: false, tile: true, hint: 'The bottom-line profit (or loss) as printed.' },
  { key: 'net_assets', label: 'Net assets', statement: 'balance_sheet', multiple: false, tile: true, hint: 'Net assets, or total equity.' },
  { key: 'ato_debt', label: 'ATO-related debt', statement: 'balance_sheet', multiple: true, tile: true, hint: 'ATO, BAS, GST and PAYG liabilities. Not super, not income tax.' },
  { key: 'income_tax_payable', label: 'Income tax payable', statement: 'balance_sheet', multiple: true, tile: true, hint: 'Owed to the ATO, shown on its own line.' },
  { key: 'loan_receivable', label: 'Loan account owed to the company', statement: 'balance_sheet', multiple: true, tile: true, hint: 'Director, shareholder, beneficiary or related-party loans under assets.' },
  { key: 'loan_payable', label: 'Loan account owed by the company', statement: 'balance_sheet', multiple: true, tile: true, hint: 'Director, shareholder, beneficiary or related-party loans under liabilities.' },
  { key: 'credit_cards', label: 'Credit cards', statement: 'balance_sheet', multiple: true, tile: false, hint: 'For the SBR creditors.' },
  { key: 'cash_loans', label: 'Bank loans and finance', statement: 'balance_sheet', multiple: true, tile: false, hint: 'Bank loans, chattel mortgages, hire purchase and equipment finance (with their unexpired interest). For the SBR creditors.' },
  { key: 'bank_overdraft', label: 'Bank overdraft', statement: 'balance_sheet', multiple: true, tile: false, hint: 'For the SBR creditors.' },
  { key: 'trade_suppliers', label: 'Trade suppliers', statement: 'balance_sheet', multiple: true, tile: false, hint: 'Accounts payable and trade creditors. For the SBR creditors.' },
]

export const MEANING: Record<Meaning, MeaningInfo> = Object.fromEntries(MEANINGS.map((m) => [m.key, m])) as Record<Meaning, MeaningInfo>
