import {
  ABN_DIGITS,
  ACN_DIGITS,
  abnMatchesAcn,
  digitsOnly,
  isValidAbn,
  isValidAcn,
} from '@/lib/asic/identifiers'
import type { AbrPrefill } from '@/lib/abr/types'
import type { EntityType } from '@/types/leads'

/**
 * Who the client is: the company, and — when it is a trustee — the trust.
 *
 * A company acting as trustee of a trust has two identities, and they never
 * share a number:
 *
 *   the company  has an ACN, and may or may not have its own ABN. When it has
 *                one, that ABN is two check digits plus the ACN.
 *   the trust    has its own ABN, and never an ACN.
 *
 * So "does this ABN end with the ACN?" is how a company's ABN is told from a
 * trust's, everywhere in this file. Before migration 0023 both went into one
 * field and one overwrote the other.
 *
 * Pure, and shared by every form that asks: lead conversion, the intake
 * company step, and intake step 1's name lookup.
 */

/** The company half — also exactly what an ASIC extract can speak to. */
export interface CompanyIdentity {
  companyName: string
  acnNumber: string
  /** The company's OWN ABN. Never the trust's. */
  abnNumber: string
}

export interface IdentityFields extends CompanyIdentity {
  /** 'trust' here means "a company acting as trustee of a trust". */
  entityType: EntityType
  trustName: string
  trustAbnNumber: string
}

export type IdentityValues = Omit<IdentityFields, 'entityType'>
export type IdentityErrors = Partial<Record<keyof IdentityFields, string>>

/**
 * A change to the identity fields, plus whether it implies a trustee.
 *
 * The entity type is never switched silently: a pick, an extract or a move
 * that looks like a trust only suggests it, and the form asks.
 */
export interface IdentityChange {
  patch: Partial<IdentityValues>
  /** Offer the Trust entity type. Only ever true while the form says Company. */
  suggestTrustee: boolean
}

/**
 * The entity type as the convert and intake forms word it — the same short
 * "Company" / "Trust" as everywhere else. "Trust" here means a company acting
 * as trustee of a trust: the company fields are still asked.
 */
export const IDENTITY_ENTITY_LABELS: Record<EntityType, string> = {
  company: 'Company',
  trust: 'Trust',
}

export const IDENTITY_ENTITY_TYPES: EntityType[] = ['company', 'trust']

function filled(value: string): boolean {
  return value.trim() !== ''
}

/** The ACN, when it is whole enough to compare an ABN against. */
function comparableAcn(fields: Pick<IdentityFields, 'acnNumber'>): string | null {
  const acn = digitsOnly(fields.acnNumber)
  return acn.length === ACN_DIGITS ? acn : null
}

/** Shape and checksum of any ABN. null when it is fine. */
function abnShapeError(value: string): string | null {
  const digits = digitsOnly(value)
  if (digits.length !== ABN_DIGITS) return `An ABN is ${ABN_DIGITS} digits.`
  if (!isValidAbn(digits)) return 'That ABN fails its check digits. Check it for a typo.'
  return null
}

/**
 * What is missing or wrong.
 *
 *   Company (both entity types): name and ACN required, ACN checked.
 *   Company ABN: required for "Company", optional for "Trust". When given,
 *                11 digits, checksum, and it must end with the ACN.
 *   Trust name and trust ABN: required for "Trust", optional for "Company".
 *                A trust ABN, whenever one is given, is checked, and it must
 *                NOT end with the ACN — that would be the company's own.
 */
export function validateIdentity(
  fields: IdentityFields,
  options: {
    /**
     * Whether a Company must have its own ABN. Lead conversion turns this off:
     * a company can have only an ACN while its trust holds the ABN. A typed
     * ABN is still checked either way.
     */
    companyAbnRequired?: boolean
  } = {},
): IdentityErrors {
  const companyAbnRequired = options.companyAbnRequired ?? true
  const errors: IdentityErrors = {}
  const trustee = fields.entityType === 'trust'

  if (!filled(fields.companyName)) errors.companyName = 'Enter the company name.'

  if (!filled(fields.acnNumber)) errors.acnNumber = 'Enter the ACN.'
  else if (digitsOnly(fields.acnNumber).length !== ACN_DIGITS) {
    errors.acnNumber = `An ACN is ${ACN_DIGITS} digits.`
  } else if (!isValidAcn(fields.acnNumber)) {
    errors.acnNumber = 'That ACN fails its check digit. Check it for a typo.'
  }

  const acn = comparableAcn(fields)

  if (!filled(fields.abnNumber)) {
    if (!trustee && companyAbnRequired) errors.abnNumber = "Enter the company's ABN."
  } else {
    const shape = abnShapeError(fields.abnNumber)
    if (shape) errors.abnNumber = shape
    else if (acn && !abnMatchesAcn(fields.abnNumber, acn)) {
      errors.abnNumber =
        "That isn't this company's own ABN — a company's ABN ends with its ACN. If it's the trust's, move it to the trust ABN."
    }
  }

  if (trustee && !filled(fields.trustName)) errors.trustName = 'Enter the trust name.'

  if (!filled(fields.trustAbnNumber)) {
    if (trustee) errors.trustAbnNumber = "Enter the trust's ABN."
  } else {
    const shape = abnShapeError(fields.trustAbnNumber)
    if (shape) errors.trustAbnNumber = shape
    else if (acn && abnMatchesAcn(fields.trustAbnNumber, acn)) {
      errors.trustAbnNumber =
        "That's the company's own ABN — it ends with the ACN. A trust has its own ABN."
    }
  }

  return errors
}

/**
 * Whether to offer [Move to trust ABN] next to the company ABN.
 *
 * Only for a well-formed ABN that does not end with a whole ACN — the one
 * error the move actually fixes — and never over a different trust ABN that is
 * already there, which the move would silently lose.
 */
export function canMoveAbnToTrust(fields: IdentityFields): boolean {
  const acn = comparableAcn(fields)
  if (!acn || abnShapeError(fields.abnNumber)) return false
  if (abnMatchesAcn(fields.abnNumber, acn)) return false
  const trustAbn = digitsOnly(fields.trustAbnNumber)
  return trustAbn === '' || trustAbn === digitsOnly(fields.abnNumber)
}

/** The company ABN becomes the trust ABN; a Company form is offered the switch to trustee. */
export function moveAbnToTrust(fields: IdentityFields): IdentityChange {
  return {
    patch: { abnNumber: '', trustAbnNumber: fields.abnNumber.trim() },
    suggestTrustee: fields.entityType === 'company',
  }
}

function isTrustPick(prefill: AbrPrefill): boolean {
  return prefill.entityType === 'trust' || prefill.trustName !== undefined
}

/**
 * A register match picked from the company name box or the trust name box.
 *
 *   company box, a company  -> company name, company ABN, and the ACN when ABR has one
 *   company box, a trust    -> trust name + trust ABN; the company fields are left
 *                              alone except the searched text, which is a search
 *                              term rather than a company and is cleared
 *   trust box, anything     -> trust name + trust ABN only; never a company field
 *
 * A trust found from the company box suggests the trustee entity type. The
 * patch never carries an entity type, and never a phone or email.
 */
export function identityPatchForPick(
  box: 'company' | 'trust',
  prefill: AbrPrefill,
  current: Pick<IdentityFields, 'entityType'>,
): IdentityChange {
  if (box === 'trust') {
    return {
      patch: {
        trustName: prefill.trustName ?? prefill.companyName ?? '',
        trustAbnNumber: prefill.abnNumber,
      },
      suggestTrustee: false,
    }
  }

  if (isTrustPick(prefill)) {
    return {
      patch: {
        companyName: '',
        trustName: prefill.trustName ?? '',
        trustAbnNumber: prefill.abnNumber,
      },
      suggestTrustee: current.entityType === 'company',
    }
  }

  const patch: Partial<IdentityValues> = {
    companyName: prefill.companyName ?? '',
    abnNumber: prefill.abnNumber,
  }
  // Absent rather than '' when ABR has no ACN — never blank one already typed.
  if (prefill.acnNumber !== undefined) patch.acnNumber = prefill.acnNumber
  return { patch, suggestTrustee: false }
}

/**
 * The identity fields as they are stored. Trimmed; the numbers keep whatever
 * spacing was typed (staff recognise their own formatting on the intake form).
 * The trust fields are kept for both entity types — optional for a Company,
 * but whatever was typed is saved.
 */
export function identityForSave(fields: IdentityFields) {
  return {
    entityType: fields.entityType,
    companyName: fields.companyName.trim(),
    acnNumber: fields.acnNumber.trim(),
    abnNumber: fields.abnNumber.trim(),
    trustName: fields.trustName.trim(),
    trustAbnNumber: fields.trustAbnNumber.trim(),
  }
}

/**
 * The ABN the ATO knows this client by: the trust's when there is one,
 * otherwise the company's. null when neither is recorded.
 *
 * For a trading trust the debt and the lodgements usually sit under the
 * trust's ABN. Not used anywhere yet — MCR still has to confirm this is the
 * right ABN for the ATO tools (see CRM_CHANGES.md).
 */
export function atoAbnFor(details: {
  abnNumber?: string | null
  trustAbnNumber?: string | null
}): string | null {
  const trust = details.trustAbnNumber?.trim()
  if (trust) return trust
  const company = details.abnNumber?.trim()
  return company || null
}
