/**
 * ASIC company extracts, as this app reads them.
 *
 * ABR (src/lib/abr) answers who a company is. Only ASIC answers who runs it —
 * the directors, their dates of birth, the registered office and the principal
 * place of business — and ASIC charges for that: a Current Company Extract is
 * about $10. So this layer is shaped around money as much as data:
 *
 *   lookupCompany           free   identity and status, safe to run on its own
 *   purchaseCurrentExtract  PAID   only ever after a person has confirmed a price
 *
 * Everything is behind AsicProvider so the provider can change. The first one
 * is asicapi (unverified — sandbox and demo only until it is); GlobalX is the
 * fallback, and ASIC's own API is due back in 2027. A new provider is a new
 * implementation of the interface and nothing else.
 *
 * Browser-safe: types only. Nothing here knows a key.
 */

/**
 * Which kind of extract this is. Stored with every extract and used to scope
 * the cache, so a demo or sandbox extract is never served as a live one.
 */
export type AsicMode = 'demo' | 'test' | 'live'

export type AsicProviderName = 'demo' | 'asicapi'

/** A coded value as the provider sent it. Compare on code, show the label. */
export interface AsicCoded {
  code: string
  label: string
}

/** What the free lookup answers. */
export interface AsicCompany {
  /** 9 digits, unspaced. */
  acn: string
  /** 11 digits, unspaced, or '' when the register has none. */
  abn: string
  /** Tidied out of ASIC's capitals: "Sample Trading Pty Ltd". */
  name: string
  /** e.g. { code: 'REGD', label: 'Registered' }. */
  status: AsicCoded
  /** e.g. { code: 'APTY', label: 'Australian Proprietary Company' }. */
  type: AsicCoded
}

/**
 * One current director, and only what MCR asked for.
 *
 * No address (ASIC stopped publishing it in Feb 2026, and it is not wanted),
 * no appointment date, no place of birth.
 */
export interface AsicDirector {
  name: string
  /**
   * ISO at whatever precision ASIC gave: 'YYYY-MM-DD', 'YYYY-MM' or 'YYYY'.
   * Null when there is none. See ./dob.ts.
   */
  dateOfBirth: string | null
}

/**
 * The part of an extract the forms use. Stored as asic_extracts.summary and
 * served from there, free, every time the same ACN comes up again.
 */
export interface AsicExtractSummary {
  acn: string
  abn: string
  companyName: string
  companyStatus: AsicCoded
  /** One line, tidied. Null when the extract has none. */
  registeredOffice: string | null
  /** One line, tidied. Often identical to the registered office — both kept. */
  principalPlaceOfBusiness: string | null
  /** Current directors only, de-duplicated, in the order ASIC listed them. */
  directors: AsicDirector[]
  /** When ASIC's data was current (RFC 3339), if the provider said. */
  asOf: string | null
}

/** What a purchase hands back to be stored. */
export interface AsicPurchase {
  providerExtractId: string | null
  asOf: string | null
  summary: AsicExtractSummary
  /**
   * The provider's response with members/shareholders, officeholder addresses
   * and places of birth removed. Kept for audit; never shown.
   */
  raw: unknown
}

export interface PurchaseOptions {
  /**
   * One per click, reused on every retry of that click. The provider replays
   * the original response for a repeated key instead of charging again.
   */
  idempotencyKey: string
  /** Printed on the provider's invoice. Up to 30 characters; no personal data. */
  clientReference?: string
}

export interface AsicProvider {
  readonly name: AsicProviderName
  readonly mode: AsicMode
  /** Free. Null means the provider answered and has no such company. */
  lookupCompany(acn: string): Promise<AsicCompany | null>
  /** PAID in live mode. Throws AsicRejectedError when there is nothing to buy. */
  purchaseCurrentExtract(acn: string, options: PurchaseOptions): Promise<AsicPurchase>
}
