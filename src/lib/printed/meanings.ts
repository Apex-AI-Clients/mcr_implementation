import type { PrintedStatementKind } from './types'

/**
 * What a printed line can stand for, for the headline tiles and the SBR
 * prediction. Staff confirm, per client, which printed lines these are
 * (mapping.ts); nothing else feeds the prediction.
 *
 * The seven key figures are confirmed on "Confirm key figures"; the SBR
 * prediction waits for them. The four creditor hints are optional: they only
 * pre-fill the creditor rows on the prediction page.
 *
 * The CVL meanings (migration 0040, `cvl: true`) are the assets and share
 * capital on Form 509. Nothing in SBR reads them: they are offered only on
 * the CVL workspace's mapping page, never to AI label suggestions, and the
 * SBR prediction is unchanged by them (figures:proof).
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
  | 'cash_at_bank'
  | 'cash_on_hand'
  | 'trade_debtors'
  | 'stock'
  | 'plant_equipment'
  | 'other_assets'
  | 'share_capital'

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
  /** For the CVL forms only (Form 509): offered in the CVL workspace, unknown to SBR. */
  cvl?: boolean
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
  // CVL, Form 509 "Assets not specifically charged" and share capital (migration 0040).
  ...(
    [
      ['cash_at_bank', 'Cash at bank', 'Bank accounts in credit (Form 509 1(d)).'],
      ['cash_on_hand', 'Cash on hand', 'Petty cash and cash on hand (Form 509 1(c)).'],
      ['trade_debtors', 'Trade debtors', 'Accounts receivable and sundry debtors (Form 509 1(b)).'],
      ['stock', 'Stock', 'Stock on hand and inventory (Form 509 1(e)).'],
      ['plant_equipment', 'Plant and equipment', 'Plant, equipment, machinery and motor vehicles, at written-down value (Form 509 1(g)).'],
      ['other_assets', 'Other assets', 'Any other asset not listed above (Form 509 1(h)).'],
      ['share_capital', 'Share capital', 'Issued and paid-up share capital (Form 509 item 9).'],
    ] as const
  ).map(
    ([key, label, hint]): MeaningInfo => ({
      key,
      label,
      hint,
      statement: 'balance_sheet',
      multiple: true,
      required: false,
      prediction: false,
      tile: false,
      cvl: true,
    }),
  ),
]

export const MEANING: Record<Meaning, MeaningInfo> = Object.fromEntries(MEANINGS.map((m) => [m.key, m])) as Record<Meaning, MeaningInfo>

/** The meanings SBR offers: everything but the CVL ones. */
export const SBR_MEANINGS = MEANINGS.filter((m) => !m.cvl)

/** The meanings only the CVL forms use (Form 509). */
export const CVL_MEANINGS = MEANINGS.filter((m) => m.cvl)

/** The seven key figures the SBR prediction waits for. */
export const KEY_FIGURES = MEANINGS.filter((m) => m.required)
