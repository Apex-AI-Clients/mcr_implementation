'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles } from 'lucide-react'
import { PortalStepper, type StepDescriptor } from '@/components/portal/PortalStepper'
import { CategoryUploadSection } from '@/components/portal/CategoryUploadSection'
import { AccountantDetailsForm } from '@/components/portal/AccountantDetailsForm'
import { CompanyDetailsForm, type CompanyDetails } from '@/components/portal/CompanyDetailsForm'
import { ClientDetailsForm } from '@/components/admin/intake/ClientDetailsForm'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { CHECKLIST_ORDER, CATEGORY_META } from '@/lib/constants'
import type { DocumentRecord, AccountantDetails } from '@/types/app'
import type { DocCategory } from '@/lib/constants'

interface Props {
  /** null = adding a new client (later steps are locked until created). */
  clientId: string | null
  initialName?: string
  initialEmail?: string
}

type State =
  | { phase: 'new' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready'
      clientName: string
      clientEmail: string
      documents: DocumentRecord[]
      accountantDetails: AccountantDetails | null
      companyDetails: CompanyDetails | null
    }

type StepKind =
  | { kind: 'details' }
  | { kind: 'company' }
  | { kind: 'accountant' }
  | { kind: 'document'; category: DocCategory }
  | { kind: 'review' }

interface WizardStep extends StepDescriptor {
  kind: StepKind
}

export function IntakeClient({ clientId, initialName = '', initialEmail = '' }: Props) {
  const [state, setState] = useState<State>(clientId ? { phase: 'loading' } : { phase: 'new' })
  const [activeStepId, setActiveStepId] = useState<string>('details')

  const load = useCallback(async () => {
    if (!clientId) return
    try {
      const res = await fetch(`/api/portal/me?clientId=${clientId}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setState({ phase: 'error', message: data.error ?? 'Unable to load client intake.' })
        return
      }
      const data = await res.json()
      setState({
        phase: 'ready',
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        documents: data.documents,
        accountantDetails: data.accountantDetails,
        companyDetails: data.companyDetails,
      })
    } catch {
      setState({ phase: 'error', message: 'Unable to load client intake. Please try again.' })
    }
  }, [clientId])

  useEffect(() => {
    load()
  }, [load])

  const handleStepComplete = useCallback(() => {
    load()
  }, [load])

  const handleUploadComplete = useCallback(() => {
    setTimeout(load, 1200)
  }, [load])

  const isNew = state.phase === 'new'

  const steps = useMemo<WizardStep[]>(() => {
    if (state.phase !== 'ready' && state.phase !== 'new') return []

    const ready = state.phase === 'ready' ? state : null
    const docs = ready ? ready.documents : []
    const uploadedCategories = new Set(docs.map((d) => d.docCategory))
    const detailsComplete = ready ? Boolean(ready.clientName && ready.clientEmail) : false

    const trustDeedIdx = CHECKLIST_ORDER.indexOf('trust_deed')
    const beforeAccountant = CHECKLIST_ORDER.slice(0, trustDeedIdx + 1)
    const afterAccountant = CHECKLIST_ORDER.slice(trustDeedIdx + 1)

    const docStep = (category: DocCategory): WizardStep => {
      const meta = CATEGORY_META[category]
      return {
        id: `doc-${category}`,
        title: meta.label,
        subtitle: meta.formatLabel,
        isOptional: meta.isOptional,
        isComplete: uploadedCategories.has(category),
        kind: { kind: 'document', category },
      }
    }

    return [
      {
        id: 'details',
        title: 'Client Details',
        subtitle: 'Email & name',
        isComplete: detailsComplete,
        kind: { kind: 'details' },
      },
      {
        id: 'company',
        title: 'Company or Trust Details',
        subtitle: 'Business information',
        isComplete: !!ready?.companyDetails,
        kind: { kind: 'company' },
      },
      ...beforeAccountant.map(docStep),
      {
        id: 'accountant',
        title: 'Accountant Details',
        subtitle: 'Current accountant',
        isComplete: !!ready?.accountantDetails,
        kind: { kind: 'accountant' },
      },
      ...afterAccountant.map(docStep),
      {
        id: 'review',
        title: 'Review',
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <Link
          href="/admin/clients"
          className="inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to clients
        </Link>
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <h1 className="text-base font-semibold text-foreground">Intake unavailable</h1>
          <p className="mt-2 text-sm text-foreground/60">{state.message}</p>
        </div>
      </div>
    )
  }

  // Shared layout for both "new" (Step 1 only, rest locked) and "ready".
  const ready = state.phase === 'ready' ? state : null
  const clientName = ready ? ready.clientName : initialName
  const clientEmail = ready ? ready.clientEmail : initialEmail
  const documents = ready ? ready.documents : []
  const accountantDetails = ready ? ready.accountantDetails : null
  const companyDetails = ready ? ready.companyDetails : null

  const requiredSteps = steps.filter((s) => !s.isOptional && s.kind.kind !== 'review')
  const completedRequired = requiredSteps.filter((s) => s.isComplete).length
  const totalRequired = requiredSteps.length
  const allRequiredComplete = completedRequired === totalRequired

  // In "new" mode only Step 1 is reachable until the client is created.
  const effectiveActiveId = isNew ? 'details' : activeStepId
  const activeStep = steps.find((s) => s.id === effectiveActiveId) ?? steps[0]
  const activeIndex = steps.findIndex((s) => s.id === activeStep.id)
  const isFirstStep = activeIndex === 0
  const isLastStep = activeIndex === steps.length - 1

  function selectStep(id: string) {
    // Locked steps (everything past Step 1) stay disabled until the client exists.
    if (isNew && id !== 'details') return
    setActiveStepId(id)
  }
  function goPrev() {
    if (activeIndex > 0) setActiveStepId(steps[activeIndex - 1].id)
  }
  function goNext() {
    if (activeIndex < steps.length - 1) setActiveStepId(steps[activeIndex + 1].id)
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left progress rail — flush left, full height */}
      <div className="hidden md:block w-80 shrink-0 h-full">
        <PortalStepper
          steps={steps}
          activeStepId={activeStep.id}
          onSelect={selectStep}
          completedCount={completedRequired}
          totalRequired={totalRequired}
        />
      </div>

      {/* Right content pane — fills the remaining width */}
      <div className="flex flex-1 min-w-0 h-full flex-col overflow-y-auto">
        <div className="flex-1 px-6 md:px-12 py-8">
          <Link
            href={clientId ? `/admin/clients/${clientId}` : '/admin/clients'}
            className="inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {clientId ? 'Back to client' : 'Back to clients'}
          </Link>

          <div className="mt-3 mb-6">
            <p className="text-xs uppercase tracking-wider text-accent font-medium">
              Step {activeIndex + 1} of {steps.length}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">
              {isNew ? 'Add Client' : activeStep.title}
            </h1>
            {isNew ? (
              <p className="mt-1 text-sm text-foreground/50">
                Enter the client’s details — saving unlocks the remaining steps.
              </p>
            ) : (
              activeStep.subtitle &&
              activeStep.kind.kind !== 'review' && (
                <p className="mt-1 text-sm text-foreground/50">{activeStep.subtitle}</p>
              )
            )}
          </div>

          <div className="max-w-4xl">
            {activeStep.kind.kind === 'details' && (
              <ClientDetailsForm
                clientId={clientId}
                initialName={clientName}
                initialEmail={clientEmail}
                onSaved={clientId ? handleStepComplete : undefined}
              />
            )}

            {activeStep.kind.kind === 'company' && clientId && (
              <CompanyDetailsForm
                clientId={clientId}
                initial={companyDetails}
                onComplete={handleStepComplete}
              />
            )}

            {activeStep.kind.kind === 'accountant' && clientId && (
              <AccountantDetailsForm
                clientId={clientId}
                initial={accountantDetails}
                onComplete={handleStepComplete}
              />
            )}

            {activeStep.kind.kind === 'document' && clientId && (
              <CategoryUploadSection
                clientId={clientId}
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
                onJumpTo={selectStep}
              />
            )}
          </div>
        </div>

        {!isNew && (
          <div className="sticky bottom-0 border-t border-border bg-primary/85 backdrop-blur px-6 md:px-12 py-4">
            <div className="flex items-center justify-between gap-3">
              <Button variant="ghost" size="md" onClick={goPrev} disabled={isFirstStep}>
                <ArrowLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button variant="primary" size="md" onClick={goNext} disabled={isLastStep}>
                {isLastStep ? 'Done' : 'Next'}
                {!isLastStep && <ArrowRight className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

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
          allRequiredComplete ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
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
              {allRequiredComplete ? `${clientName} — intake complete.` : 'Almost there.'}
            </h3>
            <p className="mt-1 text-sm text-foreground/60 leading-relaxed">
              {allRequiredComplete
                ? 'All required items have been captured for this client.'
                : 'A few required items still need to be added. Use the list below to jump back.'}
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
                  {s.subtitle && <p className="text-xs text-foreground/50 mt-0.5">{s.subtitle}</p>}
                </div>
                <ArrowRight className="h-4 w-4 text-foreground/40 group-hover:text-accent transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-foreground mb-3">Summary</h4>
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
                <p className="text-sm text-foreground truncate">{s.title}</p>
              </div>
              <span
                className={`text-xs shrink-0 ${
                  s.isComplete ? 'text-success' : s.isOptional ? 'text-foreground/40' : 'text-warning'
                }`}
              >
                {s.isComplete ? 'Received' : s.isOptional ? 'Optional' : 'Missing'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
