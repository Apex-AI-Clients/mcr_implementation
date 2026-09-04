'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { createClientFromLead } from '@/lib/leads/convert'
import type { Lead } from '@/types/leads'

interface ConvertToClientDialogProps {
  lead: Lead | null
  onClose: () => void
}

type Phase =
  | { kind: 'confirm' }
  | { kind: 'working' }
  /** 409 — the email already belongs to a client file. Offer to link instead. */
  | { kind: 'duplicate'; clientId: string }
  /** The file was created but the lead could not be updated. Never retry. */
  | { kind: 'orphaned'; clientId: string }
  | { kind: 'failed'; message: string }

/**
 * Confirmation for the most consequential action in the CRM — it writes into
 * the restructuring workspace, so it never happens on a stray select change.
 */
export function ConvertToClientDialog({ lead, onClose }: ConvertToClientDialogProps) {
  const { markConverted } = useLeads()
  const { toast } = useToast()
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' })

  // Reset when a different lead is opened. React-sanctioned "adjust state
  // during render" — same pattern as ClientsPageClient, no effect needed.
  const [prevLeadId, setPrevLeadId] = useState<string | null>(lead?.id ?? null)
  if ((lead?.id ?? null) !== prevLeadId) {
    setPrevLeadId(lead?.id ?? null)
    setPhase({ kind: 'confirm' })
  }

  async function link(clientId: string) {
    if (!lead) return
    setPhase({ kind: 'working' })
    try {
      await markConverted(lead.id, clientId)
      toast('Lead linked to client file.', {
        href: `/clients/${clientId}`,
        linkLabel: 'Open client file',
      })
      onClose()
    } catch {
      setPhase({ kind: 'orphaned', clientId })
    }
  }

  async function handleConvert() {
    if (!lead) return
    setPhase({ kind: 'working' })

    const result = await createClientFromLead(lead)

    if (result.kind === 'failed') {
      setPhase({ kind: 'failed', message: result.message })
      return
    }
    if (result.kind === 'duplicate') {
      setPhase({ kind: 'duplicate', clientId: result.clientId })
      return
    }

    // The client file now exists. From here a failure is an inconsistency to
    // report, not something to retry — retrying would create a second file.
    try {
      await markConverted(lead.id, result.clientId)
    } catch {
      setPhase({ kind: 'orphaned', clientId: result.clientId })
      return
    }

    toast('Client file created.', {
      href: `/clients/${result.clientId}`,
      linkLabel: 'Open client file',
    })
    onClose()
  }

  const working = phase.kind === 'working'

  return (
    <Dialog
      open={lead !== null}
      onClose={onClose}
      title={phase.kind === 'duplicate' ? 'This email already has a client file' : 'Convert to client'}
      description={
        lead && (phase.kind === 'confirm' || phase.kind === 'working' || phase.kind === 'failed')
          ? `This creates a client file for ${lead.name} and opens their intake.`
          : undefined
      }
      footer={<Footer phase={phase} onConvert={handleConvert} onLink={link} onClose={onClose} />}
    >
      {lead && (
        <div className="space-y-4">
          {(phase.kind === 'confirm' || phase.kind === 'working' || phase.kind === 'failed') && (
            <div className="space-y-2 rounded-lg border border-border bg-surface/40 px-3 py-3 text-sm">
              <Row label="Name" value={lead.name} />
              <Row label="Email" value={lead.email} />
            </div>
          )}

          {phase.kind === 'duplicate' && (
            <>
              <p className="text-sm leading-relaxed text-foreground/70">
                {lead.email} already belongs to a client file. Rather than create a second one,
                link {lead.name} to the existing file.
              </p>
              <Link
                href={`/clients/${phase.clientId}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
              >
                Look at the existing file first
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </>
          )}

          {phase.kind === 'orphaned' && (
            <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground/80">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                Client file created, but this lead wasn&rsquo;t updated.
              </p>
              <Link
                href={`/clients/${phase.clientId}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
              >
                Open the client file
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          )}

          {phase.kind === 'failed' && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {phase.message}
            </p>
          )}
        </div>
      )}
      {working && <span className="sr-only">Creating the client file…</span>}
    </Dialog>
  )
}

function Footer({
  phase,
  onConvert,
  onLink,
  onClose,
}: {
  phase: Phase
  onConvert: () => void
  onLink: (clientId: string) => void
  onClose: () => void
}) {
  // Nothing to retry once the file exists — only a way out.
  if (phase.kind === 'orphaned') {
    return (
      <Button type="button" variant="ghost" onClick={onClose}>
        Close
      </Button>
    )
  }

  if (phase.kind === 'duplicate') {
    const { clientId } = phase
    return (
      <>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={() => onLink(clientId)}>
          Link to existing file
        </Button>
      </>
    )
  }

  const working = phase.kind === 'working'
  return (
    <>
      <Button type="button" variant="ghost" onClick={onClose} disabled={working}>
        Cancel
      </Button>
      <Button type="button" onClick={onConvert} loading={working}>
        {phase.kind === 'failed' ? 'Try again' : 'Convert'}
      </Button>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  )
}
