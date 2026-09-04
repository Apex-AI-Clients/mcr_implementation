'use client'

import type { LeadsPersistence } from '@/components/leads/LeadsStore'

/**
 * The Stage 4 adapter: the seams LeadsStoreProvider was built around, wired to
 * the admin lead routes.
 *
 * Every function rejects on a non-2xx so the store can roll its optimistic
 * update back. None of them send `last_action_at` — the database trigger owns
 * that column.
 */

async function send(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<void> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
}

export const leadsPersistence: LeadsPersistence = {
  createLead: ({ lead, activity }) =>
    send('/api/admin/leads', 'POST', {
      lead: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        debtMin: lead.debtMin,
        debtMax: lead.debtMax,
        state: lead.state,
        entityType: lead.entityType,
        message: lead.message,
        preferredCallTime: lead.preferredCallTime,
        source: lead.source,
        company: lead.company,
      },
      activity,
    }),

  // A data correction: no activity, so the trigger never fires and the
  // follow-up clock is left where it was.
  updateLead: ({ leadId, patch }) =>
    send(`/api/admin/leads/${leadId}`, 'PATCH', { patch }),

  logActivity: ({ activity }) =>
    send(`/api/admin/leads/${activity.leadId}/activities`, 'POST', { activity }),

  // Stage and activity together, so the clock and the history can't disagree.
  stageChange: ({ leadId, stage, activity }) =>
    send(`/api/admin/leads/${leadId}`, 'PATCH', { patch: { stage }, activity }),

  conversion: ({ leadId, clientId, activity }) =>
    send(`/api/admin/leads/${leadId}`, 'PATCH', {
      patch: { stage: 'client', convertedClientId: clientId },
      activity,
    }),
}
