import { toCompanyDetails, type ConversionForm } from './conversionForm'
import type { LeadActivity } from '@/types/leads'

/**
 * Creating a client file from a lead.
 *
 * The details collected at conversion go with the create call rather than in
 * a second request: two requests can half-succeed, and a client file that
 * exists without the details somebody was just made to type is the state this
 * flow is meant to rule out. The route rolls the client back if the details
 * cannot be written.
 *
 * The lead goes with it for the same reason. Marking the lead converted used to
 * be a second request from the browser, and a page reload between the two left
 * a client file whose lead still said "lead". The route now links the lead in
 * the same request and says so (`leadLinked`), handing back the timeline entry
 * it wrote so the screen can show it without asking again.
 *
 * It answers 409 with the id of the client that already owns the email, which
 * is not an error to show raw — it's an opportunity to link the two records.
 */

export type ConvertResult =
  | {
      kind: 'created'
      clientId: string
      /** The server marked the lead converted in the same request. */
      leadLinked: boolean
      /** The timeline entry it wrote, when it wrote one. */
      activity: LeadActivity | null
    }
  /**
   * The email already belongs to a client file; offer to link to it. An
   * archived file is not offered for linking: it is restored, or deleted
   * permanently, from the Archive first.
   */
  | { kind: 'duplicate'; clientId: string; archived: boolean }
  | { kind: 'failed'; message: string }

const GENERIC_FAILURE = "That didn't work. No client file was created."

function readActivity(value: unknown): LeadActivity | null {
  if (!value || typeof value !== 'object') return null
  const a = value as Record<string, unknown>
  if (
    typeof a.id !== 'string' ||
    typeof a.leadId !== 'string' ||
    typeof a.body !== 'string' ||
    typeof a.author !== 'string' ||
    typeof a.createdAt !== 'string' ||
    a.type !== 'stage_change'
  ) {
    return null
  }
  return { id: a.id, leadId: a.leadId, type: a.type, body: a.body, author: a.author, createdAt: a.createdAt }
}

export async function createClientFromLead(
  form: ConversionForm,
  leadId?: string,
): Promise<ConvertResult> {
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
        ...(leadId ? { leadId } : {}),
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
  const payload = (body ?? {}) as {
    id?: unknown
    clientId?: unknown
    error?: unknown
    leadLinked?: unknown
    leadActivity?: unknown
    archived?: unknown
  }

  if (response.status === 409) {
    // Only useful if the route told us which file it collided with.
    return typeof payload.clientId === 'string' && payload.clientId
      ? { kind: 'duplicate', clientId: payload.clientId, archived: payload.archived === true }
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

  return {
    kind: 'created',
    clientId: payload.id,
    leadLinked: payload.leadLinked === true,
    activity: readActivity(payload.leadActivity),
  }
}
