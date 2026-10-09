import { formatPhone } from './format'
import { directorsForSave, sourceFor, type DirectorRow } from '@/lib/asic/fill'
import { identityForSave } from '@/lib/clients/identity'
import {
  asicFieldsOf,
  identityOf,
  type IdentityFormState,
  type TrusteeOfferReason,
} from '@/lib/clients/identityForm'
import type { EntityType, Lead } from '@/types/leads'

/**
 * The details that can be given when a lead becomes a client file.
 *
 * These are the same fields as steps 1 and 2 of the SBR intake wizard, offered
 * at conversion so intake opens pre-filled. None of them is required: a lead
 * can be converted with all of them blank and completed on intake.
 */
export interface ConversionForm extends IdentityFormState {
  /** Step 1 — the client record itself. */
  name: string
  email: string
  /**
   * The client's own number — the lead's phone, carried over. Optional, and
   * not the company or trust line, which is `phoneNumber` below.
   */
  phone: string
  /**
   * 'company', or 'trust' meaning "a company acting as trustee of a trust".
   * Decides whether the trust fields are shown.
   */
  entityType: EntityType
  /** Step 2 — the company, and the trust when it is a trustee. See src/lib/clients/identity.ts. */
  companyName: string
  acnNumber: string
  /** The company's OWN ABN — never the trust's. Optional for a trustee. */
  abnNumber: string
  trustName: string
  trustAbnNumber: string
  /**
   * "Enter manually (don't search ABN Lookup)", one per section. Ticked: no
   * name suggestions in that section and — for the company — no ABN-by-ACN
   * check. Not saved.
   */
  companyManual: boolean
  trustManual: boolean
  /** Optional, both of them. Start as the lead's own phone and email. */
  phoneNumber: string
  emailAddress: string
  /**
   * What Gabby used to re-type from the ASIC company extract. All optional:
   * typed by hand, or filled from an uploaded extract PDF. Conversion never
   * depends on the upload.
   */
  registeredOfficeAddress: string
  principalPlaceOfBusiness: string
  /** Separate from `name` above — the lead's own name is never overwritten by a director. */
  directors: DirectorRow[]
  /** The fill currently applied from an extract, if any. Not a field; it rides along for undo and for the saved source. */
  asicFill: IdentityFormState['asicFill']
  /** Offering the Trust entity type, and why. Not saved. */
  trusteeOffer: TrusteeOfferReason | null
}

export function emptyConversionForm(lead: Lead | null): ConversionForm {
  return {
    name: lead?.name ?? '',
    email: lead?.email ?? '',
    // Every captured lead has a phone, and it is this person's own number, so
    // it carries straight over. Shown grouped ("0412 345 678"); the API stores
    // it normalised, the same shape the lead held it in.
    phone: lead?.phone ? formatPhone(lead.phone) : '',
    // The capture forms ask this, so it is usually already known. Defaults to
    // company because it is far the commoner of the two on this pipeline.
    entityType: lead?.entityType ?? 'company',
    companyName: '',
    acnNumber: '',
    abnNumber: '',
    trustName: '',
    trustAbnNumber: '',
    companyManual: false,
    trustManual: false,
    // Pre-filled from the lead: in practice the person who enquired is the
    // company's contact, so their phone and email are the company's too. Both
    // stay editable for the case where the company has its own line.
    phoneNumber: lead?.phone ? formatPhone(lead.phone) : '',
    emailAddress: lead?.email ?? '',
    registeredOfficeAddress: '',
    principalPlaceOfBusiness: '',
    directors: [],
    asicFill: null,
    trusteeOffer: null,
  }
}

// Shared with the intake company step; re-exported for this form's callers.
export { asicFieldsOf, identityOf }

/** The company-details half, trimmed, as the API wants it. */
export function toCompanyDetails(form: ConversionForm) {
  return {
    ...identityForSave(identityOf(form)),
    phoneNumber: form.phoneNumber.trim(),
    emailAddress: form.emailAddress.trim().toLowerCase(),
    registeredOfficeAddress: form.registeredOfficeAddress.trim(),
    principalPlaceOfBusiness: form.principalPlaceOfBusiness.trim(),
    // Nothing is checked at conversion, so a row with only a date of birth can
    // arrive here; the API needs a name on every director, so it is dropped.
    directors: directorsForSave(form.directors).filter((director) => director.name),
    // The extract's date is kept for as long as the fill is — edited or not —
    // and the source says which of those it was.
    asicExtractDate: form.asicFill?.extractedAt ?? null,
    companyDetailsSource: sourceFor(form.asicFill, asicFieldsOf(form)),
  }
}
