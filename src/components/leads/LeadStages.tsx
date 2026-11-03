'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CustomStage, CustomStageKey, LeadStage } from '@/types/leads'

/**
 * The stages staff added (lead_stages), for every leads screen: the tabs, the
 * stage selects, the record. Read once in the app layout and handed down, so
 * a stage added from the list is offered on the record without another read.
 *
 * Each change is saved first and then shown, not the other way round: a stage
 * that failed to save would otherwise appear as a tab with nothing behind it.
 * The page is refreshed afterwards so the tabs and their counts are re-read.
 */

interface LeadStagesValue {
  custom: CustomStage[]
  /**
   * `refresh: false` leaves the re-read to the caller: the stage select moves
   * a lead into the new stage first, and a re-read started before that move
   * is saved would bring the lead back in its old stage.
   */
  addStage: (label: string, options?: { refresh?: boolean }) => Promise<CustomStage>
  renameStage: (key: CustomStageKey, label: string) => Promise<CustomStage>
  /** Any leads in it go to `moveTo` first. Resolves with how many moved. */
  deleteStage: (key: CustomStageKey, moveTo?: LeadStage) => Promise<number>
  /** Re-read the page, for a caller that passed `refresh: false`. */
  refresh: () => void
}

const LeadStagesContext = createContext<LeadStagesValue | null>(null)

/** Outside a provider (tests, a stray render): no custom stages, and no way to add one. */
const NO_PROVIDER: LeadStagesValue = {
  custom: [],
  addStage: () => Promise.reject(new Error('No LeadStagesProvider')),
  renameStage: () => Promise.reject(new Error('No LeadStagesProvider')),
  deleteStage: () => Promise.reject(new Error('No LeadStagesProvider')),
  refresh: () => {},
}

async function send(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<CustomStage> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as { stage?: CustomStage; error?: string }
  if (!response.ok || !data.stage) throw new Error(data.error ?? 'That did not save')
  return data.stage
}

export function LeadStagesProvider({ initial, children }: { initial: CustomStage[]; children: React.ReactNode }) {
  const router = useRouter()
  const [custom, setCustom] = useState(initial)

  // A refresh re-reads the layout; take what the server now says. Adjusted
  // while rendering rather than in an effect, so nothing renders the old list.
  const [lastInitial, setLastInitial] = useState(initial)
  if (initial !== lastInitial) {
    setLastInitial(initial)
    setCustom(initial)
  }

  const put = useCallback((stage: CustomStage) => {
    setCustom((current) => [...current.filter((c) => c.key !== stage.key), stage])
  }, [])

  const addStage = useCallback(
    async (label: string, { refresh = true }: { refresh?: boolean } = {}) => {
      const stage = await send('/api/admin/lead-stages', 'POST', { label })
      put(stage)
      if (refresh) router.refresh()
      return stage
    },
    [put, router],
  )

  const renameStage = useCallback(
    async (key: CustomStageKey, label: string) => {
      const stage = await send(`/api/admin/lead-stages/${key}`, 'PATCH', { label })
      put(stage)
      router.refresh()
      return stage
    },
    [put, router],
  )

  const deleteStage = useCallback(
    async (key: CustomStageKey, moveTo?: LeadStage) => {
      const response = await fetch(`/api/admin/lead-stages/${key}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moveTo }),
      })
      const data = (await response.json().catch(() => ({}))) as { moved?: number; error?: string }
      if (!response.ok) throw new Error(data.error ?? 'That did not save')
      setCustom((current) => current.filter((stage) => stage.key !== key))
      router.refresh()
      return data.moved ?? 0
    },
    [router],
  )

  const refresh = useCallback(() => router.refresh(), [router])

  const value = useMemo(
    () => ({ custom, addStage, renameStage, deleteStage, refresh }),
    [custom, addStage, renameStage, deleteStage, refresh],
  )
  return <LeadStagesContext.Provider value={value}>{children}</LeadStagesContext.Provider>
}

export function useLeadStages(): LeadStagesValue {
  return useContext(LeadStagesContext) ?? NO_PROVIDER
}
