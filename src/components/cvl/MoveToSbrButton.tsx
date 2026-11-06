'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Briefcase } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { LoadingOverlay } from '@/components/ui/LoadingOverlay'

/**
 * "Move to SBR" on a CVL file not on the SBR list: the mirror of moving an
 * SBR client to CVL. The client goes on the SBR list and stays in CVL; its
 * documents and details are the same file in both (POST
 * /api/admin/cvl/[caseId]/to-sbr, migration 0047).
 */
export function MoveToSbrButton({ caseId, clientName }: { caseId: string; clientName: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function move() {
    setError(null)
    setWorking(true)
    try {
      const res = await fetch(`/api/admin/cvl/${caseId}/to-sbr`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to move the client to SBR')
      setConfirming(false)
      router.push(typeof data.href === 'string' ? data.href : '/sbr')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setWorking(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null)
          setConfirming(true)
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
      >
        <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
        Move to SBR
      </button>
      <Dialog
        open={confirming}
        onClose={working ? () => {} : () => setConfirming(false)}
        title="Move this client to SBR?"
        description={`${clientName} goes on the SBR client list and stays in CVL. Its documents and details are shared by both; nothing is copied or lost.`}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={working}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={move} loading={working}>
              <Briefcase className="h-3.5 w-3.5" />
              Move to SBR
            </Button>
          </>
        }
      >
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </Dialog>
      {working && <LoadingOverlay label="Moving to SBR…" />}
    </>
  )
}
