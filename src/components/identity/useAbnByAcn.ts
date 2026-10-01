'use client'

import { useEffect, useRef, useState } from 'react'
import { abrConfigured } from '@/lib/abr/browser'
import { acnToLookUp, lookupAbnForAcn, type AcnAbnOutcome } from '@/lib/abr/acnAbn'
import { digitsOnly } from '@/lib/asic/identifiers'

const DEBOUNCE_MS = 600

/**
 * "Does the company with this ACN have an ABN of its own?" — asked of the
 * register once the ACN is whole and the company ABN is still empty.
 *
 * Debounced, and once per ACN for the life of the form: retyping the same ACN
 * never asks again. Never asks with the company's "Enter manually" ticked, or
 * when the deployment has no ABR registration.
 *
 * Answers the outcome only while it still applies — for the ACN in the box, with
 * the ABN still empty and manual mode still off. The register's answer is kept
 * even if it lands after somebody started typing an ABN, so clearing the ABN
 * shows it again without asking twice.
 */
export function useAbnByAcn(state: {
  companyManual: boolean
  acnNumber: string
  abnNumber: string
}): AcnAbnOutcome | null {
  const checked = useRef<Set<string>>(new Set())
  const [result, setResult] = useState<{ acn: string; outcome: AcnAbnOutcome } | null>(null)

  const manual = state.companyManual
  const acn = digitsOnly(state.acnNumber)
  const abnEmpty = state.abnNumber.trim() === ''

  useEffect(() => {
    const wanted = acnToLookUp(
      { companyManual: manual, acnNumber: acn, abnNumber: abnEmpty ? '' : 'typed' },
      checked.current,
    )
    if (!wanted) return

    const timer = setTimeout(() => {
      void abrConfigured().then(async (configured) => {
        if (!configured || checked.current.has(wanted)) return
        checked.current.add(wanted)
        const outcome = await lookupAbnForAcn(wanted)
        setResult({ acn: wanted, outcome })
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [manual, acn, abnEmpty])

  if (!result || manual || !abnEmpty || result.acn !== acn) return null
  return result.outcome
}
