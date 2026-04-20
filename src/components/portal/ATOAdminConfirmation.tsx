'use client'

import { useState } from 'react'
import { MCR_ADMIN_INFO } from '@/lib/constants'
import { CheckCircle, Shield } from 'lucide-react'

interface ATOAdminConfirmationProps {
  confirmed: boolean
  onComplete?: () => void
}

export function ATOAdminConfirmation({ confirmed: initialConfirmed, onComplete }: ATOAdminConfirmationProps) {
  const [confirmed, setConfirmed] = useState(initialConfirmed)
  const [saving, setSaving] = useState(false)

  async function handleConfirm() {
    if (confirmed || saving) return
    setSaving(true)

    try {
      const res = await fetch('/api/portal/ato-admin-confirm', {
        method: 'POST',
      })
      if (res.ok) {
        setConfirmed(true)
        onComplete?.()
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-surface/30 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">ATO Portal Admin Access</h3>
      </div>

      <p className="text-xs text-foreground/50 mb-4">
        Please add the following as an administrator on your ATO portal:
      </p>

      <div className="rounded-lg bg-primary/50 px-4 py-3 space-y-1.5 mb-4">
        <div className="flex justify-between text-xs">
          <span className="text-foreground/40">First Name</span>
          <span className="text-foreground font-medium">{MCR_ADMIN_INFO.firstName}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-foreground/40">Surname</span>
          <span className="text-foreground font-medium">{MCR_ADMIN_INFO.surname}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-foreground/40">Email</span>
          <span className="text-foreground font-medium">{MCR_ADMIN_INFO.email}</span>
        </div>
      </div>

      <label
        className={`flex items-center gap-3 cursor-pointer group ${confirmed ? 'cursor-default' : ''}`}
        onClick={!confirmed ? handleConfirm : undefined}
      >
        <div
          className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-all shrink-0 ${
            confirmed
              ? 'bg-success border-success'
              : saving
                ? 'border-warning bg-warning/10'
                : 'border-white/20 group-hover:border-accent'
          }`}
        >
          {confirmed && <CheckCircle className="h-3.5 w-3.5 text-white" />}
        </div>
        <span className={`text-xs ${confirmed ? 'text-success' : 'text-foreground/60'}`}>
          {confirmed
            ? 'Confirmed — MCR Partners has been added as admin'
            : 'I confirm I have added MCR Partners as an administrator on my ATO portal'}
        </span>
      </label>
    </div>
  )
}
