/**
 * What an ASIC company extract gives us, whatever it came from.
 *
 * Today the only source is an uploaded Current Company Extract PDF, parsed on
 * our own server (parse.ts). An ASIC API integration is parked; when it lands,
 * it should return this same shape so the forms that fill from it do not care
 * which one answered.
 *
 * Deliberately narrow. The extract also carries directors' places of birth,
 * appointment dates, the ASIC contact (postal) address and shareholders with
 * their residential addresses. None of those are wanted, so none of them have a
 * field here, and the parser never reads the sections they live in.
 */

export type AsicExtractType = 'current' | 'current_and_historical'

export interface Director {
  name: string
  /**
   * ISO 8601 at whatever precision the source had: "1970-03-14", "1970-03" or
   * "1970". ASIC is consulting on showing only the year of birth from July
   * 2027, so a full date cannot be assumed. null when the extract had none.
   */
  dateOfBirth: string | null
}

export interface AsicExtract {
  companyName: string | null
  /** Nine digits, unspaced — the house convention (see src/lib/abr/prefill.ts). */
  acn: string
  /** Eleven digits, unspaced. null when the extract shows no ABN. */
  abn: string | null
  /** ASIC's own wording, e.g. "Registered". */
  status: string | null
  registeredOffice: string | null
  principalPlaceOfBusiness: string | null
  /** Current directors only, one row each, de-duplicated. */
  directors: Director[]
  extractType: AsicExtractType
  /** The extract's own Date/Time from the cover, as ISO with its offset. */
  extractedAt: string | null
  /**
   * Things staff should check. Worded without names or dates of birth, so a
   * warning that ends up somewhere it should not still carries no personal data.
   */
  warnings: string[]
}

export type AsicParseFailure =
  | 'no_text'
  | 'not_asic_extract'
  | 'acn_invalid'
  | 'abn_invalid'
  | 'abn_acn_mismatch'

export type AsicParseResult =
  | { ok: true; extract: AsicExtract }
  | { ok: false; reason: AsicParseFailure; message: string }
