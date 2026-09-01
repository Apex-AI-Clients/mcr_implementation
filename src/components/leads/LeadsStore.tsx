'use client'

import { createContext, useCallback, useContext, useMemo, useReducer } from 'react'
import type { AuState, Lead, LeadActivity, LeadActivityType, LeadStage } from '@/types/leads'
import { needsFollowUp } from '@/lib/leads/followUp'
import { STAGE_META } from '@/lib/leads/constants'

/**
 * In-memory CRM store for Stage 2.
 *
 * Everything here runs on the mock seed handed down from the server; nothing is
 * written to Supabase. State lives above both `/leads` and `/leads/[id]` so a
 * logged action on the record is reflected in the list without a round trip —
 * which is what makes "the follow-up flag survives opening a record but clears
 * on a logged action" observable. A hard reload resets to the seed.
 *
 * Stage 4 replaces the two `persist*` seams below with Supabase writes; the
 * reducer and the optimistic/rollback flow stay as they are.
 */

// ============================================================
// Persistence seams — no-ops until Stage 4
// ============================================================

/**
 * Where Stage 4 attaches the Supabase writes. Both default to no-ops, so today
 * the store is purely in-memory; passing an adapter is all that changes.
 */
export interface LeadsPersistence {
  /** Throwing rolls the optimistic stage change back. */
  stageChange?: (change: { leadId: string; stage: LeadStage }) => Promise<void>
  /**
   * Records the client file against the lead. If this throws, the client file
   * exists but the lead does not know about it — the caller must say so rather
   * than retry, because a duplicate client row is worse than a visible
   * inconsistency.
   */
  conversion?: (link: { leadId: string; clientId: string }) => Promise<void>
}

const NO_PERSISTENCE: LeadsPersistence = {}

// ============================================================
// State
// ============================================================

export interface LeadsState {
  leads: Lead[]
  activities: LeadActivity[]
}

export type LeadsAction =
  | { type: 'ADD_LEAD'; lead: Lead; activity: LeadActivity | null }
  | { type: 'UPDATE_LEAD'; leadId: string; patch: Partial<Lead>; at: string }
  | { type: 'LOG_ACTIVITY'; activity: LeadActivity; nextStep?: string }
  | { type: 'SET_STAGE'; leadId: string; stage: LeadStage; activity: LeadActivity; at: string }
  | { type: 'SET_CONVERTED'; leadId: string; clientId: string; activity: LeadActivity; at: string }
  | { type: 'ROLLBACK_LEAD'; lead: Lead; removeActivityId: string }

/** Exported for unit tests — this is where the follow-up clock rules live. */
export function leadsReducer(state: LeadsState, action: LeadsAction): LeadsState {
  switch (action.type) {
    case 'ADD_LEAD':
      return {
        leads: [action.lead, ...state.leads],
        activities: action.activity ? [...state.activities, action.activity] : state.activities,
      }

    case 'UPDATE_LEAD':
      // Contact edits deliberately do NOT touch lastActionAt. Correcting a
      // phone number is not evidence that anyone contacted the lead.
      return {
        ...state,
        leads: state.leads.map((lead) =>
          lead.id === action.leadId ? { ...lead, ...action.patch, updatedAt: action.at } : lead,
        ),
      }

    case 'LOG_ACTIVITY':
      return {
        leads: state.leads.map((lead) =>
          lead.id === action.activity.leadId
            ? {
                ...lead,
                lastActionAt: action.activity.createdAt,
                updatedAt: action.activity.createdAt,
                nextStep: action.nextStep ?? lead.nextStep,
              }
            : lead,
        ),
        activities: [...state.activities, action.activity],
      }

    case 'SET_STAGE':
      return {
        leads: state.leads.map((lead) =>
          lead.id === action.leadId
            ? {
                ...lead,
                stage: action.stage,
                stageSince: action.at,
                lastActionAt: action.at,
                updatedAt: action.at,
              }
            : lead,
        ),
        activities: [...state.activities, action.activity],
      }

    case 'SET_CONVERTED':
      return {
        leads: state.leads.map((lead) =>
          lead.id === action.leadId
            ? {
                ...lead,
                stage: 'client',
                convertedClientId: action.clientId,
                stageSince: action.at,
                lastActionAt: action.at,
                updatedAt: action.at,
              }
            : lead,
        ),
        activities: [...state.activities, action.activity],
      }

    case 'ROLLBACK_LEAD':
      return {
        leads: state.leads.map((lead) => (lead.id === action.lead.id ? action.lead : lead)),
        activities: state.activities.filter((a) => a.id !== action.removeActivityId),
      }
  }
}

// ============================================================
// Context
// ============================================================

export interface NewLeadInput {
  name: string
  email: string
  phone: string
  /** Integer cents. */
  debtAmount: number
  state: AuState
  note?: string
}

interface LeadsContextValue {
  leads: Lead[]
  getLead: (leadId: string) => Lead | undefined
  activitiesFor: (leadId: string) => LeadActivity[]
  followUpCount: number
  addLead: (input: NewLeadInput) => Lead
  updateLead: (leadId: string, patch: Partial<Lead>) => void
  logActivity: (leadId: string, type: LeadActivityType, body: string) => void
  /** Optimistic — applies immediately and rolls back if persistence fails. */
  changeStage: (leadId: string, stage: LeadStage) => Promise<void>
  /** Rejects when the client file exists but the lead could not be updated. */
  markConverted: (leadId: string, clientId: string) => Promise<void>
}

const LeadsContext = createContext<LeadsContextValue | null>(null)

let idCounter = 0
function newId(prefix: string): string {
  idCounter += 1
  return `${prefix}_local_${idCounter}_${Math.random().toString(36).slice(2, 8)}`
}

interface LeadsStoreProviderProps {
  initialLeads: Lead[]
  initialActivities: LeadActivity[]
  /** Name recorded against activities this user creates. */
  author: string
  /** Stage 4 supplies the Supabase writes; omitted, the store stays in memory. */
  persistence?: LeadsPersistence
  children: React.ReactNode
}

export function LeadsStoreProvider({
  initialLeads,
  initialActivities,
  author,
  persistence = NO_PERSISTENCE,
  children,
}: LeadsStoreProviderProps) {
  const [state, dispatch] = useReducer(leadsReducer, {
    leads: initialLeads,
    activities: initialActivities,
  })

  const getLead = useCallback(
    (leadId: string) => state.leads.find((lead) => lead.id === leadId),
    [state.leads],
  )

  const activitiesFor = useCallback(
    (leadId: string) =>
      state.activities
        .filter((activity) => activity.leadId === leadId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.activities],
  )

  const addLead = useCallback(
    (input: NewLeadInput) => {
      const at = new Date().toISOString()
      const lead: Lead = {
        id: newId('ld'),
        name: input.name,
        email: input.email,
        phone: input.phone,
        debtAmount: input.debtAmount,
        state: input.state,
        stage: 'lead',
        // Always manual here — this one didn't come from a campaign.
        source: 'manual',
        company: null,
        nextStep: null,
        stageSince: at,
        lastActionAt: at,
        convertedClientId: null,
        createdAt: at,
        updatedAt: at,
      }
      const activity: LeadActivity | null = input.note?.trim()
        ? {
            id: newId('act'),
            leadId: lead.id,
            type: 'note',
            body: input.note.trim(),
            author,
            createdAt: at,
          }
        : null

      dispatch({ type: 'ADD_LEAD', lead, activity })
      return lead
    },
    [author],
  )

  const updateLead = useCallback((leadId: string, patch: Partial<Lead>) => {
    dispatch({ type: 'UPDATE_LEAD', leadId, patch, at: new Date().toISOString() })
  }, [])

  const logActivity = useCallback(
    (leadId: string, type: LeadActivityType, body: string) => {
      const activity: LeadActivity = {
        id: newId('act'),
        leadId,
        type,
        body: body.trim(),
        author,
        createdAt: new Date().toISOString(),
      }
      dispatch({
        type: 'LOG_ACTIVITY',
        activity,
        nextStep: type === 'next_step' ? activity.body : undefined,
      })
    },
    [author],
  )

  const changeStage = useCallback(
    async (leadId: string, stage: LeadStage) => {
      const previous = state.leads.find((lead) => lead.id === leadId)
      if (!previous || previous.stage === stage) return

      const at = new Date().toISOString()
      const activity: LeadActivity = {
        id: newId('act'),
        leadId,
        type: 'stage_change',
        body: `Stage changed from ${STAGE_META[previous.stage].label} to ${STAGE_META[stage].label}.`,
        author,
        createdAt: at,
      }

      // Apply first — Gabby will change several in a row and shouldn't wait.
      dispatch({ type: 'SET_STAGE', leadId, stage, activity, at })

      try {
        await persistence.stageChange?.({ leadId, stage })
      } catch (error) {
        dispatch({ type: 'ROLLBACK_LEAD', lead: previous, removeActivityId: activity.id })
        throw error
      }
    },
    [state.leads, author, persistence],
  )

  const markConverted = useCallback(
    async (leadId: string, clientId: string) => {
      await persistence.conversion?.({ leadId, clientId })

      const at = new Date().toISOString()
      const activity: LeadActivity = {
        id: newId('act'),
        leadId,
        type: 'stage_change',
        body: 'Converted to a client file in the restructuring workspace.',
        author,
        createdAt: at,
      }
      dispatch({ type: 'SET_CONVERTED', leadId, clientId, activity, at })
    },
    [author, persistence],
  )

  const followUpCount = useMemo(
    () => state.leads.filter((lead) => needsFollowUp(lead)).length,
    [state.leads],
  )

  const value = useMemo<LeadsContextValue>(
    () => ({
      leads: state.leads,
      getLead,
      activitiesFor,
      followUpCount,
      addLead,
      updateLead,
      logActivity,
      changeStage,
      markConverted,
    }),
    [
      state.leads,
      getLead,
      activitiesFor,
      followUpCount,
      addLead,
      updateLead,
      logActivity,
      changeStage,
      markConverted,
    ],
  )

  return <LeadsContext.Provider value={value}>{children}</LeadsContext.Provider>
}

export function useLeads(): LeadsContextValue {
  const context = useContext(LeadsContext)
  if (!context) throw new Error('useLeads must be used inside a LeadsStoreProvider')
  return context
}

/** Follow-up count for the sidebar badge. Safe outside the provider. */
export function useFollowUpCount(): number {
  return useContext(LeadsContext)?.followUpCount ?? 0
}
