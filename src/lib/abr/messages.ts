/**
 * Shared wording for the two failure states staff can actually see.
 *
 * Both are quiet on purpose. Lookup is a convenience bolted onto conversion;
 * neither message may read as though something has gone wrong with the
 * conversion itself, because nothing has — the form still works, typed by hand,
 * exactly as it did before lookup existed.
 */

export const NOT_CONFIGURED =
  'Company lookup is not configured on this deployment (no ABR registration).'

export const UPSTREAM_FAILED =
  "The Australian Business Register didn't answer. Enter the details by hand."

/**
 * Separate from the above because the advice is different, and because the
 * first live failure was a timeout wearing the other message — which made it
 * look like the register had rejected the search rather than been slow to it.
 * The register's first answer for an unfamiliar term is routinely its slowest.
 */
export const UPSTREAM_TIMEOUT =
  'The Australian Business Register was too slow to answer. Search again, or enter the details by hand.'
