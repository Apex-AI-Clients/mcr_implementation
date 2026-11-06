'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Gavel } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { LoadingOverlay } from '@/components/ui/LoadingOverlay'

interface ConvertToCvlButtonProps {
  clientId: string
  clientName: string
}

/**
 * "Convert to CVL" on an SBR client page (POST /api/admin/cvl/convert).
 *
 * The client is added to CVL with its documents and analyses and stays on the
 * SBR list: one file in both (migration 0047).
 */
export function ConvertToCvlButton({ clientId, clientName }: ConvertToCvlButtonProps) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function convert() {
    setError(null)
    setWorking(true)
    try {
      const res = await fetch('/api/admin/cvl/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to convert to CVL')
      router.push(typeof data.href === 'string' ? data.href : `/cvl/${clientId}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setWorking(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setError(null)
          setConfirming(true)
        }}
      >
        <Gavel className="h-3.5 w-3.5" />
        Convert to CVL
      </Button>

      <Dialog
        open={confirming}
        onClose={working ? () => {} : () => setConfirming(false)}
        title="Convert to a CVL client?"
        description={`${clientName} is added to the CVL workspace, with every document, detail and analysis on file, and stays on the SBR client list. Both share the same file; nothing is copied or deleted.`}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={working}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={convert} loading={working}>
              <Gavel className="h-3.5 w-3.5" />
              Convert to CVL
            </Button>
          </>
        }
      >
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </Dialog>

      {working && <LoadingOverlay label="Moving to CVL…" />}
    </>
  )
}
