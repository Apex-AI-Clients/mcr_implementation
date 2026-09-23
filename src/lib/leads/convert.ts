import { toCompanyDetails, type ConversionForm } from './conversionForm'

/**
 * Creating a client file from a lead.
 *
 * The details collected at conversion go with the create call rather than in
 * a second request: two requests can half-succeed, and a client file that
 * exists without the details somebody was just made to type is the state this
 * flow is meant to rule out. The route rolls the client back if the details
 * cannot be written.
 *
 * It answers 409 with the id of the client that already owns the email, which
 * is not an error to show raw — it's an opportunity to link the two records.
 */

export type ConvertResult =
  | { kind: 'created'; clientId: string }
  /** The email already belongs to a client file; offer to link to it. */
  | { kind: 'duplicate'; clientId: string }
  | { kind: 'failed'; message: string }

const GENERIC_FAILURE = "That didn't work. No client file was created."

export async function createClientFromLead(form: ConversionForm): Promise<ConvertResult> {
  let response: Response
  try {
    response = await fetch('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        companyDetails: toCompanyDetails(form),
      }),
    })
  } catch {
    return { kind: 'failed', message: 'Could not reach the server. No client file was created.' }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  const payload = (body ?? {}) as { id?: unknown; clientId?: unknown; error?: unknown }

  if (response.status === 409) {
    // Only useful if the route told us which file it collided with.
    return typeof payload.clientId === 'string' && payload.clientId
      ? { kind: 'duplicate', clientId: payload.clientId }
      : { kind: 'failed', message: 'A client with this email already exists.' }
  }

  if (!response.ok) {
    return {
      kind: 'failed',
      message: typeof payload.error === 'string' && payload.error ? payload.error : GENERIC_FAILURE,
    }
  }

  if (typeof payload.id !== 'string' || !payload.id) {
    return { kind: 'failed', message: GENERIC_FAILURE }
  }

  return { kind: 'created', clientId: payload.id }
}
