/**
 * Director penalty notices (DPNs): what the parser reads from an ATO notice.
 *
 * A DPN names a director personally and is posted to their home. Only the
 * director's NAME is ever kept; the address printed under it is read past and
 * dropped. Nothing here is sent to an AI model.
 *
 * Money is held in whole cents, so totals and the Column 3 = 4 + 5 check are
 * exact.
 */

/** What "This notice is for" says. Super guarantee charge has no sample yet. */
export type DpnType = 'paygw' | 'gst' | 'sgc'

export const DPN_TYPE_LABEL: Record<DpnType, string> = {
  paygw: 'PAYG withholding',
  gst: 'GST',
  sgc: 'Super guarantee charge',
}

/** Columns 2–5 of a notice's table, in cents. */
export interface DpnAmounts {
  /** Amount withheld (PAYGW) or net amount assessed (GST). */
  column2: number
  /** Amount the Commissioner thinks is the unpaid amount. */
  column3: number
  /** Unpaid, notified on or before 3 months after the due day. */
  column4: number
  /** Unpaid, not notified within 3 months after the due day. */
  column5: number
}

export interface DpnRow extends DpnAmounts {
  /** ISO date (YYYY-MM-DD), the period's first day. */
  periodFrom: string
  /** ISO date, the period's last day. */
  periodTo: string
}

export interface DirectorPenaltyNotice {
  /** "Our reference". */
  reference: string
  /** ISO date, "Date of issue". */
  issuedOn: string
  type: DpnType
  /** "For this company". */
  companyName: string
  /** "With this ACN", digits only. */
  acn: string
  /** The name on the "TO:" line, as printed. Never the address. */
  directorName: string
  rows: DpnRow[]
  /** Sums of the rows. The notice prints no total row. */
  totals: DpnAmounts
}

/** Why a notice has to be entered by hand. */
export type DpnManualReason =
  /** Super guarantee charge: no sample yet, so its table is not trusted. */
  | 'sgc'
  /** No table rows could be read, or a row's figures could not be placed. */
  | 'table_unreadable'
  /** A required field (reference, date, type, company, ACN, director) is missing. */
  | 'missing_fields'

export type DpnParseResult =
  | { kind: 'parsed'; notice: DirectorPenaltyNotice }
  | {
      kind: 'needs_manual'
      reason: DpnManualReason
      /** Whatever was read, to prefill the manual form. */
      partial: Partial<DirectorPenaltyNotice>
      /** Which required fields are missing, for 'missing_fields'. */
      missing: (keyof DirectorPenaltyNotice)[]
    }
  /** No "director penalty notice" wording anywhere: the wrong file. */
  | { kind: 'not_a_dpn' }
