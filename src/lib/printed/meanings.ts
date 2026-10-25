import type { PrintedStatementKind } from './types'

/**
 * What a printed line can stand for, for the headline tiles and the SBR
 * prediction. Staff confirm, per client, which printed lines these are
 * (mapping.ts); nothing else feeds the prediction.
 *
 * The seven key figures are confirmed on "Confirm key figures"; the SBR
 * prediction waits for them. The four creditor hints are optional: they only
 * pre-fill the creditor rows on the prediction page.
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
  /** Plain title for staff. */
  label: string
  /** One line: what it is. */
  hint: string
  statement: PrintedStatementKind
  /** Several printed lines added up (checkboxes); else exactly one line (radio). */
  multiple: boolean
  /** One of the seven key figures: confirmed before the SBR prediction. */
  required: boolean
  /** Feeds the SBR prediction directly. */
  prediction: boolean
  /** Shown as a headline tile on the comparison page. */
  tile: boolean
}

/** In the order staff see them: what the SBR prediction uses first. */
export const MEANINGS: MeaningInfo[] = [
  {
    key: 'loan_receivable',
    label: 'Loan account — owed TO the company',
    hint: 'Money the director or related parties owe the company.',
    statement: 'balance_sheet',
    multiple: true,
    required: true,
    prediction: true,
    tile: true,
  },
  {
    key: 'loan_payable',
    label: 'Loan account — owed BY the company',
    hint: 'Money the company owes the director or related parties.',
    statement: 'balance_sheet',
    multiple: true,
    required: true,
    prediction: true,
    tile: true,
  },
  {
    key: 'ato_debt',
    label: 'ATO-related debt',
    hint: 'What the business owes the ATO: BAS, GST, PAYG and other ATO accounts (not super, not income tax).',
    statement: 'balance_sheet',
    multiple: true,
    required: true,
    prediction: true,
    tile: true,
  },
  { key: 'revenue', label: 'Revenue', hint: 'Total sales or income for the year.', statement: 'profit_and_loss', multiple: false, required: true, prediction: false, tile: true },
  {
    key: 'net_profit',
    label: 'Net profit',
    hint: 'The profit (or loss) at the bottom of the profit and loss.',
    statement: 'profit_and_loss',
    multiple: false,
    required: true,
    prediction: false,
    tile: true,
  },
  {
    key: 'net_assets',
    label: 'Net assets',
    hint: 'Total assets less total liabilities, often printed as total equity.',
    statement: 'balance_sheet',
    multiple: false,
    required: true,
    prediction: false,
    tile: true,
  },
  {
    key: 'income_tax_payable',
    label: 'Income tax payable',
    hint: 'Company income tax owed to the ATO, on its own line.',
    statement: 'balance_sheet',
    multiple: false,
    required: true,
    prediction: false,
    tile: true,
  },
  { key: 'credit_cards', label: 'Credit cards', hint: 'Credit card balances owed.', statement: 'balance_sheet', multiple: true, required: false, prediction: false, tile: false },
  {
    key: 'cash_loans',
    label: 'Bank loans and finance',
    hint: 'Bank loans, chattel mortgages, hire purchase and equipment finance, with their unexpired interest.',
    statement: 'balance_sheet',
    multiple: true,
    required: false,
    prediction: false,
    tile: false,
  },
  { key: 'bank_overdraft', label: 'Bank overdraft', hint: 'An overdrawn bank account.', statement: 'balance_sheet', multiple: true, required: false, prediction: false, tile: false },
  { key: 'trade_suppliers', label: 'Trade suppliers', hint: 'Accounts payable and trade creditors.', statement: 'balance_sheet', multiple: true, required: false, prediction: false, tile: false },
]

export const MEANING: Record<Meaning, MeaningInfo> = Object.fromEntries(MEANINGS.map((m) => [m.key, m])) as Record<Meaning, MeaningInfo>

/** The seven key figures the SBR prediction waits for. */
export const KEY_FIGURES = MEANINGS.filter((m) => m.required)
