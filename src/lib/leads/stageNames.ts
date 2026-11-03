import { FORMER_STAGE_LABELS, STAGE_META } from './constants'
import type { BuiltInStage } from '@/types/leads'

/**
 * The built-in stage with this name, now or as it was called before migration
 * 0042 (case-insensitive), or null. A custom stage can't take one of these
 * names: two "Unresponsive" tabs could not be told apart.
 */
export function builtInStageNamed(name: string): BuiltInStage | null {
  const wanted = name.trim().toLowerCase()
  const stages = Object.keys(STAGE_META) as BuiltInStage[]
  return (
    stages.find(
      (stage) =>
        STAGE_META[stage].label.toLowerCase() === wanted || FORMER_STAGE_LABELS[stage]?.toLowerCase() === wanted,
    ) ?? null
  )
}
