'use client'

import { createContext, useCallback, useContext, useMemo, useReducer } from 'react'
import type {
  AuState,
  EntityType,
  Lead,
  LeadActivity,
  LeadActivityType,
  LeadStage,
} from '@/types/leads'
import { needsFollowUp } from '@/lib/leads/followUp'
import { STAGE_META } from '@/lib/leads/constants'
import { useToast } from '@/components/ui/Toast'

/**
 * CRM store.
 *
 * State lives above both `/leads` and `/leads/[id]` so a logged action on the
 * record is reflected in the list without a round trip — which is what makes
 * "the follow-up flag survives opening a record but clears on a logged action"
 * observable.
 *
 * Every mutation is optimistic: the reducer applies it immediately, then the
 * persistence adapter writes it. If the write fails the change is rolled back
 * and the user is told, so the screen never quietly disagrees with the
 * database. Without an adapter the store is purely in-memory, which is what
 * the tests use.
 */

// ============================================================
// Persistence seams
// ============================================================

/**
 * Where the database writes attach. Every hook is optional and defaults to a
 * no-op, so omitting the adapter leaves the store in memory.
 *
 * Throwing from any of these rolls the optimistic update back. None of them
 * may write `last_action_at`: the trigger on lead_activities owns that column,
 * which is why a data correction (no activity) leaves the follow-up clock
 * alone while a stage change (which carries one) resets it.
 */
export interface LeadsPersistence {
  createLead?: (input: { lead: Lead; activity: LeadActivity | null }) => Promise<void>
  /** A data correction — deliberately carries no activity. */
  updateLead?: (input: { leadId: string; patch: Partial<Lead> }) => Promise<void>
  logActivity?: (input: { activity: LeadActivity }) => Promise<void>
  stageChange?: (change: {
    leadId: string
    stage: LeadStage
    activity: LeadActivity
  }) => Promise<void>
  /** The text of one timeline entry. Carries no activity, so no clock reset. */
  editActivity?: (input: { leadId: string; activityId: string; body: string }) => Promise<void>
  /** Removes one timeline entry. See the route for what it does NOT undo. */
  deleteActivity?: (input: { leadId: string; activityId: string }) => Promise<void>
  /**
   * Permanent. Throwing leaves every lead in place, which is the only safe
   * failure mode for a delete — the caller shows the error rather than a list
   * that has quietly lost a row the database still holds.
   */
  deleteLeads?: (input: { ids: string[] }) => Promise<void>
  /**
   * Records the client file against the lead. If this throws, the client file
   * exists but the lead does not know about it — the caller must say so rather
   * than retry, because a duplicate client row is worse than a visible
   * inconsistency.
   */
  conversion?: (link: {
    leadId: string
    clientId: string
    activity: LeadActivity
  }) => Promise<void>
}

const NO_PERSISTENCE: LeadsPersistence = {}

/** Sentinel for a rollback that has no activity to remove. */
const NO_ACTIVITY = '__no_activity__'

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
  /** Undo an optimistic ADD_LEAD whose write failed. */
  | { type: 'REMOVE_LEAD'; leadId: string }
  /** Deleted for good, after the database confirmed it. */
  | { type: 'REMOVE_LEADS'; ids: string[] }
  | { type: 'EDIT_ACTIVITY'; activityId: string; body: string; nextStepFor?: string }
  | { type: 'REMOVE_ACTIVITY'; activityId: string; nextStepFor?: string; nextStep?: string | null }
  /** Rows just read from the server — see SYNC in the reducer. */
  | { type: 'SYNC'; leads: Lead[]; activities: LeadActivity[] }

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

    case 'REMOVE_LEAD':
      return {
        leads: state.leads.filter((lead) => lead.id !== action.leadId),
        activities: state.activities.filter((a) => a.leadId !== action.leadId),
      }

    // Editing text is not an action: lastActionAt is deliberately untouched,
    // the same way a phone-number correction leaves it alone.
    case 'EDIT_ACTIVITY':
      return {
        leads: action.nextStepFor
          ? state.leads.map((lead) =>
              lead.id === action.nextStepFor ? { ...lead, nextStep: action.body } : lead,
            )
          : state.leads,
        activities: state.activities.map((activity) =>
          activity.id === action.activityId ? { ...activity, body: action.body } : activity,
        ),
      }

    case 'REMOVE_ACTIVITY':
      return {
        // When the entry being removed was the next step the record shows,
        // the lead falls back to whatever is left rather than keeping one
        // nobody can find.
        leads: action.nextStepFor
          ? state.leads.map((lead) =>
              lead.id === action.nextStepFor
                ? { ...lead, nextStep: action.nextStep ?? null }
                : lead,
            )
          : state.leads,
        activities: state.activities.filter((activity) => activity.id !== action.activityId),
      }

    case 'REMOVE_LEADS': {
      const gone = new Set(action.ids)
      return {
        leads: state.leads.filter((lead) => !gone.has(lead.id)),
        activities: state.activities.filter((a) => !gone.has(a.leadId)),
      }
    }

    // A page or a record has just been read from the database. The server is
    // authoritative for the rows it returned, so those replace what is held;
    // anything it did not mention is left alone, because it is either a lead
    // on another page or one optimistically added a moment ago whose write has
    // not come back yet. Upsert, never replace wholesale.
    case 'SYNC': {
      const incoming = new Map(action.leads.map((lead) => [lead.id, lead]))
      const merged = state.leads.map((lead) => incoming.get(lead.id) ?? lead)
      const known = new Set(state.leads.map((lead) => lead.id))
      for (const lead of action.leads) if (!known.has(lead.id)) merged.push(lead)

      const activityIds = new Set(state.activities.map((activity) => activity.id))
      const newActivities = action.activities.filter((a) => !activityIds.has(a.id))

      return {
        leads: merged,
        activities: newActivities.length
          ? [...state.activities, ...newActivities]
          : state.activities,
      }
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
  /** Whole dollars. Null max is open-ended. */
  debtMin: number | null
  debtMax: number | null
  state: AuState
  entityType?: EntityType | null
  /** The lead's own words from the capture form. Not an activity. */
  message?: string
  /** Staff commentary, saved as the first activity. */
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
  /** Permanent, and confirmed by the database before anything leaves the list. */
  deleteLeads: (ids: string[]) => Promise<void>
  /** Correct the wording of a timeline entry. Rejects on failure. */
  editActivity: (activityId: string, body: string) => Promise<void>
  /** Remove a timeline entry. Rejects on failure, having changed nothing. */
  deleteActivity: (activityId: string) => Promise<void>
  /**
   * Hand the store what the server just returned. Pages call this with their
   * own slice — the list with its ten rows, the record with its one — so the
   * store holds what is on screen plus anything optimistic, and no longer
   * needs every lead in the database to be loaded up front.
   */
  syncFromServer: (leads: Lead[], activities: LeadActivity[]) => void
}

const LeadsContext = createContext<LeadsContextValue | null>(null)

/**
 * Real UUIDs: these ids are the primary keys the database stores, so the
 * optimistic row and the persisted row are the same row. `randomUUID` needs a
 * secure context, hence the fallback.
 */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8
    return value.toString(16)
  })
}

interface LeadsStoreProviderProps {
  /** Usually empty — pages sync their own rows in. */
  initialLeads?: Lead[]
  initialActivities?: LeadActivity[]
  /** Name recorded against activities this user creates. */
  author: string
  /** Stage 4 supplies the Supabase writes; omitted, the store stays in memory. */
  persistence?: LeadsPersistence
  children: React.ReactNode
}

export function LeadsStoreProvider({
  initialLeads = [],
  initialActivities = [],
  author,
  persistence = NO_PERSISTENCE,
  children,
}: LeadsStoreProviderProps) {
  const [state, dispatch] = useReducer(leadsReducer, {
    leads: initialLeads,
    activities: initialActivities,
  })
  const { toast } = useToast()

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
        id: newId(),
        name: input.name,
        // Lowercased to match what the route stores, so the optimistic row and
        // the persisted row don't disagree until the next reload.
        email: input.email.trim().toLowerCase(),
        phone: input.phone.trim(),
        debtMin: input.debtMin,
        debtMax: input.debtMax,
        state: input.state,
        entityType: input.entityType ?? null,
        message: input.message?.trim() || null,
        preferredCallTime: null,
        stage: 'lead',
        // Always manual here — this one didn't come from a campaign.
        source: 'manual',
        company: null,
        nextStep: null,
        stageSince: at,
        lastActionAt: at,
        convertedClientId: null,
        metaFormId: null,
        metaAdId: null,
        metaAdgroupId: null,
        metaPageId: null,
        metaCampaignId: null,
        metaCampaignName: null,
        metaAdName: null,
        metaAccountId: null,
        metaStateRaw: null,
        metaStateOptions: null,
        createdAt: at,
        updatedAt: at,
      }
      const activity: LeadActivity | null = input.note?.trim()
        ? {
            id: newId(),
            leadId: lead.id,
            type: 'note',
            body: input.note.trim(),
            author,
            createdAt: at,
          }
        : null

      dispatch({ type: 'ADD_LEAD', lead, activity })

      // Optimistic: the dialog closes straight away. If the write fails the row
      // is taken back out rather than left looking saved.
      void persistence.createLead?.({ lead, activity })?.catch(() => {
        dispatch({ type: 'REMOVE_LEAD', leadId: lead.id })
        toast(`${lead.name} could not be saved. Please add them again.`, { tone: 'error' })
      })

      return lead
    },
    [author, persistence, toast],
  )

  const updateLead = useCallback(
    (leadId: string, patch: Partial<Lead>) => {
      const previous = state.leads.find((lead) => lead.id === leadId)
      dispatch({ type: 'UPDATE_LEAD', leadId, patch, at: new Date().toISOString() })

      void persistence.updateLead?.({ leadId, patch })?.catch(() => {
        // NO_ACTIVITY matches nothing, so only the lead is restored.
        if (previous) {
          dispatch({ type: 'ROLLBACK_LEAD', lead: previous, removeActivityId: NO_ACTIVITY })
        }
        toast("That didn't save. The previous value has been put back.", { tone: 'error' })
      })
    },
    [state.leads, persistence, toast],
  )

  const logActivity = useCallback(
    (leadId: string, type: LeadActivityType, body: string) => {
      const activity: LeadActivity = {
        id: newId(),
        leadId,
        type,
        body: body.trim(),
        author,
        createdAt: new Date().toISOString(),
      }
      const previous = state.leads.find((lead) => lead.id === leadId)
      dispatch({
        type: 'LOG_ACTIVITY',
        activity,
        nextStep: type === 'next_step' ? activity.body : undefined,
      })

      void persistence.logActivity?.({ activity })?.catch(() => {
        if (previous) {
          dispatch({ type: 'ROLLBACK_LEAD', lead: previous, removeActivityId: activity.id })
        }
        toast("That didn't save. Please try again.", { tone: 'error' })
      })
    },
    [author, state.leads, persistence, toast],
  )

  const changeStage = useCallback(
    async (leadId: string, stage: LeadStage) => {
      const previous = state.leads.find((lead) => lead.id === leadId)
      if (!previous || previous.stage === stage) return

      const at = new Date().toISOString()
      const activity: LeadActivity = {
        id: newId(),
        leadId,
        type: 'stage_change',
        body: `Stage changed from ${STAGE_META[previous.stage].label} to ${STAGE_META[stage].label}.`,
        author,
        createdAt: at,
      }

      // Apply first — Gabby will change several in a row and shouldn't wait.
      dispatch({ type: 'SET_STAGE', leadId, stage, activity, at })

      try {
        await persistence.stageChange?.({ leadId, stage, activity })
      } catch (error) {
        dispatch({ type: 'ROLLBACK_LEAD', lead: previous, removeActivityId: activity.id })
        throw error
      }
    },
    [state.leads, author, persistence],
  )

  const markConverted = useCallback(
    async (leadId: string, clientId: string) => {
      const at = new Date().toISOString()
      const activity: LeadActivity = {
        id: newId(),
        leadId,
        type: 'stage_change',
        body: 'Converted to a client file in the restructuring workspace.',
        author,
        createdAt: at,
      }

      // Persist first, then apply: the client file already exists at this
      // point, so the caller has to be able to tell the difference between
      // "linked" and "created but not linked".
      await persistence.conversion?.({ leadId, clientId, activity })
      dispatch({ type: 'SET_CONVERTED', leadId, clientId, activity, at })
    },
    [author, persistence],
  )

  const deleteLeads = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      // Persist first, then apply — the reverse of every other mutation here.
      // An optimistic delete that fails would have to put rows back, and a row
      // reappearing after someone watched it vanish reads as a bug in a way
      // that a row which never left does not.
      await persistence.deleteLeads?.({ ids })
      dispatch({ type: 'REMOVE_LEADS', ids })
    },
    [persistence],
  )

  /** The newest `next_step` entry on a lead — the one the record displays. */
  const currentNextStep = useCallback(
    (leadId: string, exclude?: string) =>
      state.activities
        .filter(
          (activity) =>
            activity.leadId === leadId &&
            activity.type === 'next_step' &&
            activity.id !== exclude,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    [state.activities],
  )

  const editActivity = useCallback(
    async (activityId: string, body: string) => {
      const existing = state.activities.find((activity) => activity.id === activityId)
      if (!existing) return
      const trimmed = body.trim()
      if (!trimmed || trimmed === existing.body) return

      // Mirror the lead's next step only when this entry is the one showing.
      const mirrors =
        existing.type === 'next_step' && currentNextStep(existing.leadId)?.id === activityId

      dispatch({
        type: 'EDIT_ACTIVITY',
        activityId,
        body: trimmed,
        nextStepFor: mirrors ? existing.leadId : undefined,
      })

      try {
        await persistence.editActivity?.({
          leadId: existing.leadId,
          activityId,
          body: trimmed,
        })
      } catch (error) {
        // Put the old wording back rather than leave the screen showing an
        // edit the database rejected.
        dispatch({
          type: 'EDIT_ACTIVITY',
          activityId,
          body: existing.body,
          nextStepFor: mirrors ? existing.leadId : undefined,
        })
        throw error
      }
    },
    [state.activities, currentNextStep, persistence],
  )

  const deleteActivity = useCallback(
    async (activityId: string) => {
      const existing = state.activities.find((activity) => activity.id === activityId)
      if (!existing) return

      const mirrors =
        existing.type === 'next_step' && currentNextStep(existing.leadId)?.id === activityId
      const fallback = mirrors ? currentNextStep(existing.leadId, activityId)?.body ?? null : null

      // Persist first, as with deleting a lead: an entry that vanishes and
      // then comes back reads as a bug in a way one that never left does not.
      await persistence.deleteActivity?.({ leadId: existing.leadId, activityId })
      dispatch({
        type: 'REMOVE_ACTIVITY',
        activityId,
        nextStepFor: mirrors ? existing.leadId : undefined,
        nextStep: fallback,
      })
    },
    [state.activities, currentNextStep, persistence],
  )

  const syncFromServer = useCallback((leads: Lead[], activities: LeadActivity[]) => {
    dispatch({ type: 'SYNC', leads, activities })
  }, [])

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
      deleteLeads,
      editActivity,
      deleteActivity,
      syncFromServer,
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
      deleteLeads,
      editActivity,
      deleteActivity,
      syncFromServer,
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
