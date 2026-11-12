import { toCompanyDetails, type ConversionForm } from './conversionForm'
import type { LeadActivity } from '@/types/leads'
import type { ClientWorkspace } from '@/lib/clients/workspace'

/**
 * Creating a client file from one enquiry of a lead (0052): a lead with two
 * enquiries can become two files.
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
 * Another file with the same email is fine (0052). The one 409 left is an
 * enquiry that already has its file, answered with that file's id.
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
  /** The enquiry already became this file. */
  | { kind: 'enquiry_converted'; clientId: string | null; message: string }
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
  /** The enquiry (lead_submissions id) the file is made from. */
  enquiryId?: string,
  /** The workspace the file opens in: an SBR client (default) or a CVL client. */
  workflow: ClientWorkspace = 'sbr',
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
        ...(enquiryId ? { enquiryId } : {}),
        workflow,
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
  }

  if (response.status === 409 && enquiryId) {
    return {
      kind: 'enquiry_converted',
      clientId: typeof payload.clientId === 'string' && payload.clientId ? payload.clientId : null,
      message:
        typeof payload.error === 'string' && payload.error
          ? payload.error
          : 'This enquiry already has a client file.',
    }
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
