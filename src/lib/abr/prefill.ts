import { entityTypeFromAbr } from './entityType'
import { hasTrusteePrefix, tidyRegisterName, tidyTrustName } from './names'
import type { AbrEntityDetails, AbrPrefill, ResolvedEntityType } from './types'

/**
 * A picked ABR entity -> the form fields it can honestly fill.
 *
 * Pure, so the mapping is testable without a browser or the register, and form
 * agnostic, so lead conversion, client creation and the intake wizard all fill
 * the same way. What it fills is narrow on purpose:
 *
 *   - the name, tidied out of the register's ALL CAPS
 *   - the ABN and, when ABR carries one, the ACN
 *   - the entity type, but only when the register actually settles it
 *
 * phoneNumber and emailAddress are absent and stay absent. Neither is on the
 * public register, so there is nothing to prefill them from — and offering a
 * lookup that leaves them blank invites somebody to read the blank as "ABR says
 * they have no phone number" rather than "ABR was never asked".
 */

/**
 * A trust the register files under its trustee still reads as a trust, whatever
 * the code says. Checked after the code so an explicit code always wins.
 */
export function resolveEntityType(details: AbrEntityDetails): ResolvedEntityType {
  const fromRegister = entityTypeFromAbr(details.entityTypeCode, details.entityTypeName)
  if (fromRegister) return fromRegister
  return hasTrusteePrefix(details.entityName) ? 'trust' : null
}

export function prefillFromAbr(details: AbrEntityDetails): AbrPrefill {
  const entityType = resolveEntityType(details)

  // ABR gives both numbers as unspaced digits, and they go in that way. This
  // app has no ACN or ABN formatter — every screen renders whatever string was
  // stored — so the register's own shape *is* the house convention, and
  // inventing "123 456 789" here would make lookup-filled records the odd ones
  // out. Validation strips non-digits either way.
  const prefill: AbrPrefill = { abnNumber: details.abn }

  if (entityType) prefill.entityType = entityType

  if (entityType === 'trust') {
    // The trust's own name, not "THE TRUSTEE FOR …". companyName is left alone
    // on purpose: where a trust has a corporate trustee, ABR's EntityName does
    // not name it, so anything we put there would be a guess.
    prefill.trustName = tidyTrustName(details.entityName)
  } else {
    prefill.companyName = tidyRegisterName(details.entityName)
  }

  // Absent rather than '' when ABR has no ACN — a trust or a sole trader has
  // none, and blanking a field somebody already typed into would be a loss.
  if (details.acn) prefill.acnNumber = details.acn

  return prefill
}

/**
 * The prefill, plus the one rule every form with both name fields needs.
 *
 * `searchedIn` is the field the match was found from. If the register's answer
 * went to the *other* name field — searching the company box and landing on a
 * trust — then what is left in the searched box is a search term, not an
 * answer, so it goes. Nothing else is touched, so a trustee company typed into
 * the company field survives a pick made in the trust field.
 */
export function prefillFor(
  searchedIn: 'companyName' | 'trustName',
  prefill: AbrPrefill,
): AbrPrefill {
  const patch: AbrPrefill = { ...prefill }
  if (searchedIn === 'companyName' && patch.companyName === undefined) patch.companyName = ''
  if (searchedIn === 'trustName' && patch.trustName === undefined) patch.trustName = ''
  return patch
}
