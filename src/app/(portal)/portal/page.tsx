'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles } from 'lucide-react'
import { PortalHeader } from '@/components/portal/PortalHeader'
import { PortalStepper, type StepDescriptor } from '@/components/portal/PortalStepper'
import { CategoryUploadSection } from '@/components/portal/CategoryUploadSection'
import { AccountantDetailsForm } from '@/components/portal/AccountantDetailsForm'
import { ATOAdminConfirmation } from '@/components/portal/ATOAdminConfirmation'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { CHECKLIST_ORDER, CATEGORY_META, REQUIRED_CATEGORIES } from '@/lib/constants'
import type { DocumentRecord, AccountantDetails } from '@/types/app'
import type { DocCategory } from '@/lib/constants'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready'
      clientName: string
      documents: DocumentRecord[]
      atoAdminConfirmed: boolean
      accountantDetails: AccountantDetails | null
    }

type StepKind =
  | { kind: 'ato' }
  | { kind: 'accountant' }
  | { kind: 'document'; category: DocCategory }
  | { kind: 'review' }

interface WizardStep extends StepDescriptor {
  kind: StepKind
}

export default function PortalPage() {
  const router = useRouter()
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [activeStepId, setActiveStepId] = useState<string>('ato')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/me')
      if (res.status === 401) {
        router.replace('/login')
        return
      }
      if (!res.ok) {
        const data = await res.json()
        setState({ phase: 'error', message: data.error ?? 'Unable to load portal.' })
        return
      }
      const data = await res.json()
      setState({
        phase: 'ready',
        clientName: data.clientName,
        documents: data.documents,
        atoAdminConfirmed: data.atoAdminConfirmed,
        accountantDetails: data.accountantDetails,
      })
    } catch {
      setState({ phase: 'error', message: 'Unable to load portal. Please try again.' })
    }
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  const handleStepComplete = useCallback(() => {
    load()
  }, [load])

  const handleUploadComplete = useCallback(() => {
    setTimeout(load, 1500)
  }, [load])

  const steps = useMemo<WizardStep[]>(() => {
    if (state.phase !== 'ready') return []

    const uploadedCategories = new Set(state.documents.map((d) => d.docCategory))

    return [
      {
        id: 'ato',
        title: 'ATO Admin Access',
        subtitle: 'Add MCR Partners as administrator',
        isComplete: state.atoAdminConfirmed,
        kind: { kind: 'ato' },
      },
      {
        id: 'accountant',
        title: 'Accountant Details',
        subtitle: 'Your current accountant',
        isComplete: !!state.accountantDetails,
        kind: { kind: 'accountant' },
      },
      ...CHECKLIST_ORDER.map<WizardStep>((category) => {
        const meta = CATEGORY_META[category]
        return {
          id: `doc-${category}`,
          title: meta.label,
          subtitle: meta.formatLabel,
          isOptional: meta.isOptional,
          isComplete: uploadedCategories.has(category),
          kind: { kind: 'document', category },
        }
      }),
      {
        id: 'review',
        title: 'Review & Submit',
        subtitle: 'Confirm everything is in order',
        isComplete: false,
        kind: { kind: 'review' },
      },
    ]
  }, [state])

  useEffect(() => {
    if (state.phase !== 'ready' || steps.length === 0) return
    setActiveStepId((current) => {
      if (steps.some((s) => s.id === current)) return current
      const firstIncomplete = steps.find((s) => !s.isComplete && !s.isOptional)
      return firstIncomplete?.id ?? steps[0].id
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase])

  if (state.phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
          <span className="text-2xl text-destructive">!</span>
        </div>
        <h1 className="text-lg font-semibold text-foreground">Portal Unavailable</h1>
        <p className="mt-2 text-sm text-muted max-w-xs">{state.message}</p>
        <p className="mt-4 text-xs text-muted">
          If you believe this is a mistake, please contact your MCR Partners advisor.
        </p>
      </div>
    )
  }

  const { clientName, documents, atoAdminConfirmed, accountantDetails } = state

  const requiredSteps = steps.filter((s) => !s.isOptional && s.kind.kind !== 'review')
  const completedRequired = requiredSteps.filter((s) => s.isComplete).length
  const totalRequired = requiredSteps.length
  const allRequiredComplete = completedRequired === totalRequired

  const activeStep = steps.find((s) => s.id === activeStepId) ?? steps[0]
  const activeIndex = steps.findIndex((s) => s.id === activeStep.id)
  const isFirstStep = activeIndex === 0
  const isLastStep = activeIndex === steps.length - 1

  function goPrev() {
    if (activeIndex > 0) setActiveStepId(steps[activeIndex - 1].id)
  }
  function goNext() {
    if (activeIndex < steps.length - 1) setActiveStepId(steps[activeIndex + 1].id)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PortalHeader clientName={clientName} />

      <div className="flex flex-1 min-h-0">
        <div className="hidden md:flex w-80 shrink-0">
          <PortalStepper
            steps={steps}
            activeStepId={activeStep.id}
            onSelect={setActiveStepId}
            completedCount={completedRequired}
            totalRequired={totalRequired}
          />
        </div>

        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="md:hidden px-4 py-3 border-b border-border bg-surface/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted">
                Step {activeIndex + 1} of {steps.length}
              </span>
              <span className="text-xs text-muted">
                {completedRequired}/{totalRequired} required
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-primary/60 overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${(completedRequired / Math.max(totalRequired, 1)) * 100}%` }}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl w-full px-6 md:px-10 py-8 md:py-10">
              <div className="mb-6">
                <p className="text-xs uppercase tracking-wider text-accent font-medium">
                  Step {activeIndex + 1} of {steps.length}
                </p>
                <h1 className="mt-2 text-2xl md:text-3xl font-semibold text-foreground">
                  {activeStep.title}
                </h1>
                {activeStep.subtitle && activeStep.kind.kind !== 'review' && (
                  <p className="mt-2 text-sm text-muted">{activeStep.subtitle}</p>
                )}
              </div>

              <div>
                {activeStep.kind.kind === 'ato' && (
                  <ATOAdminConfirmation confirmed={atoAdminConfirmed} onComplete={handleStepComplete} />
                )}

                {activeStep.kind.kind === 'accountant' && (
                  <AccountantDetailsForm initial={accountantDetails} onComplete={handleStepComplete} />
                )}

                {activeStep.kind.kind === 'document' && (
                  <CategoryUploadSection
                    category={activeStep.kind.category}
                    documents={documents}
                    onUploadComplete={handleUploadComplete}
                    hideTitle
                  />
                )}

                {activeStep.kind.kind === 'review' && (
                  <ReviewSummary
                    clientName={clientName}
                    steps={steps}
                    allRequiredComplete={allRequiredComplete}
                    onJumpTo={setActiveStepId}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-border bg-surface/40 px-6 md:px-10 py-4">
            <div className="mx-auto max-w-3xl w-full flex items-center justify-between gap-3">
              <Button variant="ghost" size="md" onClick={goPrev} disabled={isFirstStep}>
                <ArrowLeft className="h-4 w-4" />
                Previous
              </Button>

              <div className="hidden sm:flex items-center gap-1.5">
                {steps.map((s, i) => (
                  <span
                    key={s.id}
                    className={`h-1.5 rounded-full transition-all ${
                      i === activeIndex
                        ? 'w-6 bg-accent'
                        : s.isComplete
                          ? 'w-1.5 bg-success'
                          : 'w-1.5 bg-border'
                    }`}
                  />
                ))}
              </div>

              <Button variant="primary" size="md" onClick={goNext} disabled={isLastStep}>
                {isLastStep ? 'Complete' : 'Next'}
                {!isLastStep && <ArrowRight className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

// ============================================================
// Review summary — shown at the final step
// ============================================================

interface ReviewSummaryProps {
  clientName: string
  steps: WizardStep[]
  allRequiredComplete: boolean
  onJumpTo: (id: string) => void
}

function ReviewSummary({ clientName, steps, allRequiredComplete, onJumpTo }: ReviewSummaryProps) {
  const actionableSteps = steps.filter((s) => s.kind.kind !== 'review')
  const requiredMissing = actionableSteps.filter((s) => !s.isOptional && !s.isComplete)

  return (
    <div className="flex flex-col gap-6">
      <div
        className={`rounded-xl border p-6 ${
          allRequiredComplete
            ? 'border-success/30 bg-success/5'
            : 'border-warning/30 bg-warning/5'
        }`}
      >
        <div className="flex items-start gap-3">
          {allRequiredComplete ? (
            <CheckCircle2 className="h-6 w-6 text-success shrink-0 mt-0.5" />
          ) : (
            <Sparkles className="h-6 w-6 text-warning shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <h3 className="text-base font-semibold text-foreground">
              {allRequiredComplete ? `Thank you, ${clientName.split(' ')[0]}.` : 'Almost there.'}
            </h3>
            <p className="mt-1 text-sm text-muted leading-relaxed">
              {allRequiredComplete
                ? 'All required items have been received. Your MCR Partners advisor will review your submission and reach out shortly.'
                : 'A few required items still need your attention. Use the list below to jump back and complete them.'}
            </p>
          </div>
        </div>
      </div>

      {requiredMissing.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-3">Required items outstanding</h4>
          <div className="flex flex-col gap-2">
            {requiredMissing.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onJumpTo(s.id)}
                className="group flex items-center justify-between rounded-lg border border-border bg-surface/40 px-4 py-3 text-left transition-all hover:border-accent/40 hover:bg-surface/60"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{s.title}</p>
                  {s.subtitle && <p className="text-xs text-muted mt-0.5">{s.subtitle}</p>}
                </div>
                <ArrowRight className="h-4 w-4 text-muted group-hover:text-accent transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-foreground mb-3">Submission summary</h4>
        <div className="rounded-xl border border-border bg-surface/30 divide-y divide-border">
          {actionableSteps.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onJumpTo(s.id)}
              className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface/60"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`h-5 w-5 rounded-full shrink-0 flex items-center justify-center ${
                    s.isComplete
                      ? 'bg-success text-white'
                      : s.isOptional
                        ? 'bg-primary/60 border border-border'
                        : 'bg-warning/20 border border-warning/40'
                  }`}
                >
                  {s.isComplete && <CheckCircle2 className="h-3 w-3" strokeWidth={3} />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{s.title}</p>
                </div>
              </div>
              <span
                className={`text-xs shrink-0 ${
                  s.isComplete
                    ? 'text-success'
                    : s.isOptional
                      ? 'text-muted'
                      : 'text-warning'
                }`}
              >
                {s.isComplete ? 'Received' : s.isOptional ? 'Optional — skipped' : 'Missing'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted">
        {REQUIRED_CATEGORIES.length} document categories are mandatory. Optional items can be skipped
        if they don&apos;t apply.
      </p>
    </div>
  )
}
