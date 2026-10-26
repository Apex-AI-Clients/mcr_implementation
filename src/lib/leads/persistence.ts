'use client'

import type { ExistingLead, LeadsPersistence } from '@/components/leads/LeadsStore'

/**
 * The Stage 4 adapter: the seams LeadsStoreProvider was built around, wired to
 * the admin lead routes.
 *
 * Every function rejects on a non-2xx so the store can roll its optimistic
 * update back. None of them send `last_action_at` — the database trigger owns
 * that column.
 */

async function send(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach the server')
  }

  if (!response.ok) {
    let detail = `${method} ${url} failed with ${response.status}`
    try {
      const payload = (await response.json()) as { error?: unknown }
      if (typeof payload.error === 'string' && payload.error) detail = payload.error
    } catch {
      // Non-JSON error body — the status line is all we have.
    }
    throw new Error(detail)
  }

  try {
    return await response.json()
  } catch {
    return null
  }
}

/** Fire-and-check writes that need nothing back. */
async function write(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<void> {
  await send(url, method, body)
}

export const leadsPersistence: LeadsPersistence = {
  findLeadByEmail: async (email) => {
    let response: Response
    try {
      response = await fetch(`/api/admin/leads?email=${encodeURIComponent(email.trim())}`)
    } catch {
      throw new Error('Could not reach the server')
    }
    if (!response.ok) throw new Error('Could not check that email')
    const payload = (await response.json()) as { lead?: ExistingLead | null }
    return payload.lead ?? null
  },

  // A known email is merged onto the existing lead (200, merged: true) rather
  // than refused, so the store learns which lead the details landed on.
  createLead: async ({ lead, activity }) => {
    const payload = (await send('/api/admin/leads', 'POST', {
      lead: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        debtMin: lead.debtMin,
        debtMax: lead.debtMax,
        state: lead.state,
        // Set instead of `state` when several were ticked. The route rebuilds
        // the display text from these itself.
        stateOptions: lead.metaStateOptions,
        entityType: lead.entityType,
        message: lead.message,
        preferredCallTime: lead.preferredCallTime,
        source: lead.source,
        company: lead.company,
      },
      activity,
    })) as { id?: unknown; merged?: unknown } | null
    return {
      leadId: typeof payload?.id === 'string' ? payload.id : lead.id,
      merged: payload?.merged === true,
    }
  },

  // Staff have seen the "enquired again" marker. No activity — this is not a
  // logged action — and the server records who and when from the session.
  dismissReenquiry: ({ leadId }) =>
    write(`/api/admin/leads/${leadId}`, 'PATCH', { patch: { dismissReenquiry: true } }),

  // A data correction: no activity, so the trigger never fires and the
  // follow-up clock is left where it was.
  updateLead: ({ leadId, patch }) =>
    write(`/api/admin/leads/${leadId}`, 'PATCH', { patch }),

  logActivity: ({ activity }) =>
    write(`/api/admin/leads/${activity.leadId}/activities`, 'POST', { activity }),

  // Editing the text of a note is not a new action, so neither of these
  // carries an activity and neither resets the follow-up clock.
  editActivity: ({ leadId, activityId, body }) =>
    write(`/api/admin/leads/${leadId}/activities/${activityId}`, 'PATCH', { body }),

  deleteActivity: ({ leadId, activityId }) =>
    write(`/api/admin/leads/${leadId}/activities/${activityId}`, 'DELETE'),

  // Hard delete, one or many. Posts to an explicit /delete path rather than
  // using the DELETE verb, because this always carries a body of ids and a
  // DELETE with a body is inconsistently handled across proxies.
  deleteLeads: ({ ids }) => write('/api/admin/leads/delete', 'POST', { ids }),

  // Stage and activity together, so the clock and the history can't disagree.
  stageChange: ({ leadId, stage, activity }) =>
    write(`/api/admin/leads/${leadId}`, 'PATCH', { patch: { stage }, activity }),

  conversion: ({ leadId, clientId, activity }) =>
    write(`/api/admin/leads/${leadId}`, 'PATCH', {
      patch: { stage: 'client', convertedClientId: clientId },
      activity,
    }),
}
