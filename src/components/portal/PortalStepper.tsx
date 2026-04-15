'use client'

import { Check, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StepDescriptor {
  id: string
  title: string
  subtitle?: string
  isOptional?: boolean
  isComplete: boolean
}

interface PortalStepperProps {
  steps: StepDescriptor[]
  activeStepId: string
  onSelect: (id: string) => void
  completedCount: number
  totalRequired: number
}

export function PortalStepper({
  steps,
  activeStepId,
  onSelect,
  completedCount,
  totalRequired,
}: PortalStepperProps) {
  const percent = totalRequired === 0 ? 0 : Math.round((completedCount / totalRequired) * 100)

  return (
    <aside className="flex flex-col h-full bg-surface/30 border-r border-border">
      {/* Progress summary */}
      <div className="px-6 py-6 border-b border-border">
        <p className="text-xs uppercase tracking-wider text-muted mb-2">Your Progress</p>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-foreground">{completedCount}</span>
          <span className="text-sm text-muted">of {totalRequired} required</span>
        </div>
        <div className="mt-3 h-1.5 w-full rounded-full bg-primary/60 overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">{percent}% complete</p>
      </div>

      {/* Step list */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ol className="flex flex-col gap-1">
          {steps.map((step, idx) => {
            const isActive = step.id === activeStepId
            const isComplete = step.isComplete

            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onSelect(step.id)}
                  className={cn(
                    'group relative w-full flex items-start gap-3 rounded-lg px-3 py-3 text-left transition-all',
                    isActive
                      ? 'bg-accent/10 border border-accent/30'
                      : 'border border-transparent hover:bg-surface/60',
                  )}
                >
                  {/* Step indicator */}
                  <div
                    className={cn(
                      'mt-0.5 h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold transition-all',
                      isComplete
                        ? 'bg-success text-white'
                        : isActive
                          ? 'bg-accent text-white'
                          : 'bg-primary/60 text-muted border border-border',
                    )}
                  >
                    {isComplete ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    ) : isActive ? (
                      <Circle className="h-2 w-2 fill-white" strokeWidth={0} />
                    ) : (
                      idx + 1
                    )}
                  </div>

                  {/* Step label */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p
                        className={cn(
                          'text-sm font-medium leading-tight truncate',
                          isActive ? 'text-foreground' : isComplete ? 'text-foreground/80' : 'text-foreground/70',
                        )}
                      >
                        {step.title}
                      </p>
                    </div>
                    {step.subtitle && (
                      <p className="mt-0.5 text-xs text-muted leading-snug line-clamp-1">
                        {step.subtitle}
                      </p>
                    )}
                    {step.isOptional && (
                      <span className="mt-1 inline-block text-[10px] uppercase tracking-wide text-muted">
                        Optional
                      </span>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Footer note */}
      <div className="px-6 py-4 border-t border-border">
        <p className="text-[11px] text-muted leading-relaxed">
          Your documents are encrypted and stored securely. Contact your MCR Partners advisor with
          questions.
        </p>
      </div>
    </aside>
  )
}
