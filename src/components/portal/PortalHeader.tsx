'use client'

import { ThemeToggle } from '@/components/ui/ThemeToggle'

interface PortalHeaderProps {
  clientName: string
}

export function PortalHeader({ clientName }: PortalHeaderProps) {
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
      <div className="px-4 md:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-accent flex items-center justify-center">
            <span className="text-white text-xs font-bold">M</span>
          </div>
          <div>
            <p className="text-xs text-muted leading-none">MCR Partners</p>
            <p className="text-sm font-semibold text-foreground leading-tight mt-0.5">
              Document Portal
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <div className="text-right">
            <p className="text-xs text-muted">Uploading for</p>
            <p className="text-sm font-medium text-foreground">{clientName}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
