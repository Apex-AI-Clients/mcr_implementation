'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  HelpCircle,
  Info,
  RefreshCw,
  TrendingUp,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn, formatDateRelative } from '@/lib/utils'
import type { SbrPrediction, SbrPredictionInput } from '@/lib/sbr/types'

interface InitialAuto {
  cumulativeDaysLate: number | null
  numberOfLateLodgements: number | null
  daysSinceLastPayment: number | null
  directorLoanReceivableAmount: number
  creditorAmount: number | null
  latestFinancialYear: number | null
  hasLodgement: boolean
  hasFinancials: boolean
}

interface CachedSummary {
  inputFeatures: Record<string, unknown>
  predictedOutcomePercent: number
  predictedLowPercent: number
  predictedHighPercent: number
  comparableCaseIds: string[]
  trainingSetSize: number
  computedAt: string
}

interface Props {
  clientId: string
  clientName: string
  initialAuto: InitialAuto
  initialPrediction: CachedSummary | null
}

interface FullPrediction extends SbrPrediction {
  inputFeatures: SbrPredictionInput
  creditorAmount: number | null
  computedAt: string
}

interface MissingPrereq {
  field: string
  blocker: 'lodgement_analyses' | 'financial_statements'
  actionUrl: string
}

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

function formatAud(value: number | null | undefined): string {
  if (value == null) return '—'
  return AUD.format(value)
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString('en-AU')
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step
}

export function OutcomePredictionClient({
  clientId,
  clientName,
  initialAuto,
  initialPrediction,
}: Props) {
  const [auto] = useState<InitialAuto>(initialAuto)
  const [dpn, setDpn] = useState(false)
  const [paymentPlanType, setPaymentPlanType] = useState<'plan' | 'upfront'>('upfront')
  const [directorLoanAtAppointment, setDirectorLoanAtAppointment] = useState(false)
  const [directorLoanSentToAto, setDirectorLoanSentToAto] = useState(false)

  const [prediction, setPrediction] = useState<FullPrediction | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<MissingPrereq[]>([])
  const [inputsCollapsed, setInputsCollapsed] = useState(initialPrediction !== null)

  const lodgementReady = auto.hasLodgement
  const canRun = lodgementReady

  async function runPrediction() {
    setRunning(true)
    setError(null)
    setMissing([])
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/predict-outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dpn,
          paymentPlanType,
          directorLoanAtAppointment,
          directorLoanSentToAto,
        }),
      })
      const data = await res.json()
      if (res.status === 422 && data.error === 'PREREQUISITES_MISSING') {
        setMissing(data.missing ?? [])
        return
      }
      if (!res.ok) {
        setError(data.error ?? 'Prediction failed.')
        return
      }
      setPrediction(data as FullPrediction)
      setInputsCollapsed(true)
    } catch {
      setError('Network error during prediction.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href={`/admin/clients/${clientId}`}
          className="inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to client
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">SBR Outcome Prediction</h1>
            <p className="text-sm text-foreground/60 mt-0.5">{clientName}</p>
            {(prediction || initialPrediction) && (
              <p className="text-xs text-foreground/40 mt-1">
                Generated{' '}
                {formatDateRelative(
                  prediction?.computedAt ?? initialPrediction?.computedAt ?? '',
                )}{' '}
                from {prediction?.trainingSetSize ?? initialPrediction?.trainingSetSize ?? 0}{' '}
                historical cases
              </p>
            )}
          </div>

          {prediction && (
            <div className="flex flex-wrap items-center gap-2">
              <ExportButton prediction={prediction} clientName={clientName} />
              <Button variant="ghost" size="sm" onClick={runPrediction} loading={running}>
                <RefreshCw className="h-3.5 w-3.5" />
                Re-run
              </Button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {missing.length > 0 && <PrereqMissingBlock clientId={clientId} missing={missing} />}

      {!lodgementReady && (
        <Card className="border-warning/30 bg-warning/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Run lodgement analysis first</p>
              <p className="text-xs text-foreground/60 mt-1">
                The prediction needs cumulative days late, late lodgement count, and days since
                last payment — all sourced from the lodgement analysis. Upload an Activity
                Statement CSV and run the analysis on the client page.
              </p>
              <Link
                href={`/admin/clients/${clientId}`}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
              >
                Open client page
                <ArrowLeft className="h-3 w-3 rotate-180" />
              </Link>
            </div>
          </div>
        </Card>
      )}

      <InputPanel
        auto={auto}
        dpn={dpn}
        setDpn={setDpn}
        paymentPlanType={paymentPlanType}
        setPaymentPlanType={setPaymentPlanType}
        directorLoanAtAppointment={directorLoanAtAppointment}
        setDirectorLoanAtAppointment={setDirectorLoanAtAppointment}
        directorLoanSentToAto={directorLoanSentToAto}
        setDirectorLoanSentToAto={setDirectorLoanSentToAto}
        collapsed={inputsCollapsed}
        onToggleCollapsed={() => setInputsCollapsed((v) => !v)}
        onGenerate={runPrediction}
        running={running}
        canRun={canRun}
        hasPrediction={prediction !== null}
      />

      {prediction && (
        <>
          <HeadlineTiles prediction={prediction} />
          <FeatureBreakdownPanel prediction={prediction} />
          <ComparableCasesPanel prediction={prediction} />
          {/* <MethodologyCallout prediction={prediction} /> */}
        </>
      )}
    </div>
  )
}

function PrereqMissingBlock({
  clientId,
  missing,
}: {
  clientId: string
  missing: MissingPrereq[]
}) {
  return (
    <Card className="border-warning/30 bg-warning/5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Prerequisite data is missing</p>
          <ul className="mt-2 space-y-1 text-xs text-foreground/70">
            {missing.map((m) => (
              <li key={m.field}>
                <span className="text-foreground/90">{m.field}</span> — needs{' '}
                {m.blocker === 'lodgement_analyses'
                  ? 'lodgement analysis'
                  : 'financials extraction'}
                .{' '}
                <Link href={m.actionUrl} className="text-accent hover:text-accent/80">
                  Open setup
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-foreground/50">
            Once the missing step is complete, return here and click <em>Generate Prediction</em>.
          </p>
          <Link
            href={`/admin/clients/${clientId}`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
          >
            Open client page
          </Link>
        </div>
      </div>
    </Card>
  )
}

interface InputPanelProps {
  auto: InitialAuto
  dpn: boolean
  setDpn: (v: boolean) => void
  paymentPlanType: 'plan' | 'upfront'
  setPaymentPlanType: (v: 'plan' | 'upfront') => void
  directorLoanAtAppointment: boolean
  setDirectorLoanAtAppointment: (v: boolean) => void
  directorLoanSentToAto: boolean
  setDirectorLoanSentToAto: (v: boolean) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  onGenerate: () => void
  running: boolean
  canRun: boolean
  hasPrediction: boolean
}

function InputPanel(props: InputPanelProps) {
  const {
    auto,
    dpn,
    setDpn,
    paymentPlanType,
    setPaymentPlanType,
    directorLoanAtAppointment,
    setDirectorLoanAtAppointment,
    directorLoanSentToAto,
    setDirectorLoanSentToAto,
    collapsed,
    onToggleCollapsed,
    onGenerate,
    running,
    canRun,
    hasPrediction,
  } = props
  const [helpOpen, setHelpOpen] = useState(false)

  if (collapsed) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-foreground/70">
            <span className="text-foreground/40">Inputs:</span>{' '}
            DPN: <span className="text-foreground">{dpn ? 'Yes' : 'No'}</span>
            <span className="text-foreground/30"> · </span>
            <span className="text-foreground capitalize">{paymentPlanType}</span>
            <span className="text-foreground/30"> · </span>
            Director loan at appointment:{' '}
            <span className="text-foreground">{directorLoanAtAppointment ? 'Yes' : 'No'}</span>
            <span className="text-foreground/30"> · </span>
            Director loan sent to ATO:{' '}
            <span className="text-foreground">{directorLoanSentToAto ? 'Yes' : 'No'}</span>
          </div>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="text-xs text-accent hover:text-accent/80"
          >
            Edit inputs
          </button>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Auto-detected</h3>
          <p className="mb-3 text-xs text-foreground/40">
            Sourced from existing analysis tables.
          </p>
          <dl className="space-y-3 text-xs">
            <ReadOnlyField
              label="Cumulative days late"
              value={formatNumber(auto.cumulativeDaysLate)}
              missing={auto.cumulativeDaysLate == null}
            />
            <ReadOnlyField
              label="Number of late lodgements"
              value={formatNumber(auto.numberOfLateLodgements)}
              missing={auto.numberOfLateLodgements == null}
            />
            <ReadOnlyField
              label="Days since last payment"
              value={
                auto.daysSinceLastPayment === 9999
                  ? 'No payments on record'
                  : formatNumber(auto.daysSinceLastPayment)
              }
              missing={auto.daysSinceLastPayment == null}
            />
            <ReadOnlyField
              label="Director loan receivable"
              value={formatAud(auto.directorLoanReceivableAmount)}
              hint={
                auto.hasFinancials
                  ? auto.latestFinancialYear != null
                    ? `FY${auto.latestFinancialYear}`
                    : undefined
                  : 'No financials extracted — defaulting to $0'
              }
              softMissing={!auto.hasFinancials}
            />
            <ReadOnlyField
              label="ATO debt (creditor amount proxy)"
              value={formatAud(auto.creditorAmount)}
              hint={
                auto.creditorAmount != null
                  ? auto.latestFinancialYear != null
                    ? `FY${auto.latestFinancialYear}`
                    : undefined
                  : 'Suggested offer requires financials extraction'
              }
              softMissing={auto.creditorAmount == null}
            />
          </dl>
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Manual inputs</h3>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
              aria-label="What do these inputs mean?"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              What do these mean?
            </button>
          </div>
          <p className="mb-3 text-xs text-foreground/40">
            Tick the items that apply to this client.
          </p>
          <div className="space-y-3">
            <CheckboxField
              label="Director Penalty Notice issued"
              checked={dpn}
              onChange={setDpn}
            />
            <CheckboxField
              label="Director loan at appointment"
              checked={directorLoanAtAppointment}
              onChange={setDirectorLoanAtAppointment}
            />
            <CheckboxField
              label="Director loan sent to ATO"
              checked={directorLoanSentToAto}
              onChange={setDirectorLoanSentToAto}
            />
            <fieldset className="rounded-lg border border-border bg-surface/30 px-3 py-2">
              <legend className="px-1 text-xs text-foreground/50">Payment approach</legend>
              <div className="flex gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs text-foreground/80">
                  <input
                    type="radio"
                    name="paymentPlanType"
                    value="upfront"
                    checked={paymentPlanType === 'upfront'}
                    onChange={() => setPaymentPlanType('upfront')}
                    className="accent-accent"
                  />
                  Upfront
                </label>
                <label className="flex items-center gap-2 text-xs text-foreground/80">
                  <input
                    type="radio"
                    name="paymentPlanType"
                    value="plan"
                    checked={paymentPlanType === 'plan'}
                    onChange={() => setPaymentPlanType('plan')}
                    className="accent-accent"
                  />
                  Payment plan
                </label>
              </div>
            </fieldset>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        {hasPrediction && (
          <Button variant="ghost" size="sm" onClick={onToggleCollapsed}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          size="md"
          onClick={onGenerate}
          loading={running}
          disabled={!canRun}
        >
          <TrendingUp className="h-4 w-4" />
          Generate Prediction
        </Button>
      </div>

      {helpOpen && <ManualInputsHelpModal onClose={() => setHelpOpen(false)} />}
    </Card>
  )
}

function ManualInputsHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1.5 text-foreground/50 hover:bg-primary/40 hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 pr-8">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-accent" />
            <h2 className="text-base font-semibold text-foreground">
              About the manual inputs
            </h2>
          </div>
          <p className="mt-1 text-xs text-foreground/55">
            These four fields can&apos;t be auto-detected from uploaded documents. Set each
            one based on the client&apos;s actual situation before generating a prediction.
          </p>
        </div>

        <div className="space-y-4 text-xs">
          <HelpItem
            title="Director Penalty Notice issued"
            body={
              <>
                <p>
                  Tick when the ATO has formally issued a DPN (Director Penalty Notice)
                  to the director(s) — typically for unreported SGC, PAYG withholding,
                  or GST debts. The director will have a physical copy of the notice.
                </p>
                <p className="mt-1 text-foreground/55">
                  <span className="text-foreground/80">Why it matters:</span> a DPN
                  signals personal liability and historically correlates with higher
                  settlement outcomes.
                </p>
              </>
            }
          />
          <HelpItem
            title="Director loan at appointment"
            body={
              <>
                <p>
                  Tick when the balance sheet at the time of the SBR appointment shows
                  a director-loan-receivable balance — i.e. the director owes money
                  back to the company.
                </p>
                <p className="mt-1 text-foreground/55">
                  <span className="text-foreground/80">Why it matters:</span> the
                  Director Loan Receivable amount is one of the strongest signals the
                  ATO considers when assessing an SBR proposal.
                </p>
              </>
            }
          />
          <HelpItem
            title="Director loan sent to ATO"
            body={
              <>
                <p>
                  Tick only when the director loan amount has been formally assigned
                  to or reported to the ATO as part of the workout. This is uncommon —
                  most cases leave this unticked.
                </p>
                <p className="mt-1 text-foreground/55">
                  <span className="text-foreground/80">Why it matters:</span> when sent
                  to the ATO, the loan reduces the personal exposure and shifts the
                  expected outcome slightly.
                </p>
              </>
            }
          />
          <HelpItem
            title="Payment approach — Upfront vs Payment plan"
            body={
              <>
                <p>
                  <span className="text-foreground/80">Upfront</span> — the client is
                  proposing a lump-sum payment of the SBR settlement.
                </p>
                <p>
                  <span className="text-foreground/80">Payment plan</span> — the client
                  is proposing instalments over the SBR period (usually 12–24 months).
                </p>
                <p className="mt-1 text-foreground/55">
                  <span className="text-foreground/80">Why it matters:</span> upfront
                  offers historically settle at slightly higher cents-in-the-dollar
                  than instalment plans.
                </p>
              </>
            }
          />
        </div>

        <div className="mt-5 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-foreground/65">
          <span className="text-foreground/85">Quick sanity test:</span> leave all
          three boxes unticked and Upfront selected — that gives the baseline
          prediction for the most common profile. Then re-run with the actual values
          to see how the prediction shifts.
        </div>

        <div className="mt-5 flex justify-end">
          <Button variant="primary" size="sm" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  )
}

function HelpItem({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="mt-1 space-y-1 text-foreground/70 leading-relaxed">{body}</div>
    </div>
  )
}

function ReadOnlyField({
  label,
  value,
  hint,
  missing,
  softMissing,
}: {
  label: string
  value: string
  hint?: string
  missing?: boolean
  softMissing?: boolean
}) {
  return (
    <div>
      <dt className="text-foreground/40">{label}</dt>
      <dd
        className={cn('mt-0.5 font-medium', {
          'text-foreground': !missing && !softMissing,
          'text-warning': softMissing,
          'text-destructive': missing,
        })}
      >
        {missing ? 'Not available' : value}
      </dd>
      {hint && <p className="mt-0.5 text-foreground/30">{hint}</p>}
    </div>
  )
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-border bg-surface/30 px-3 py-2 text-xs text-foreground/80 cursor-pointer hover:bg-surface/50 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent"
      />
      {label}
    </label>
  )
}

function HeadlineTiles({ prediction }: { prediction: FullPrediction }) {
  const [calcOpen, setCalcOpen] = useState(false)

  const confidenceLabel =
    prediction.neighbourStdev < 5
      ? 'Good'
      : prediction.neighbourStdev <= 10
        ? 'Moderate'
        : 'Wide'

  const confidenceTone =
    confidenceLabel === 'Good'
      ? 'text-success'
      : confidenceLabel === 'Moderate'
        ? 'text-warning'
        : 'text-destructive'

  const outcomeSeverity =
    prediction.predictedOutcomePercent < 30 || prediction.predictedOutcomePercent > 60
      ? 'text-destructive'
      : prediction.predictedOutcomePercent < 50
        ? 'text-foreground'
        : 'text-warning'

  const suggestedRounded =
    prediction.suggestedOfferAmount != null
      ? roundToNearest(prediction.suggestedOfferAmount, 500)
      : null

  return (
    <Card>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface/50 p-4 text-center">
          <p className={cn('text-4xl font-bold tabular-nums', outcomeSeverity)}>
            {prediction.predictedOutcomePercent.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-foreground/60">
            Range {prediction.predictedLowPercent.toFixed(1)}% –{' '}
            {prediction.predictedHighPercent.toFixed(1)}%
          </p>
          <p className="mt-2 text-xs text-foreground/40">Predicted outcome</p>
        </div>
        <div className="rounded-lg border border-border bg-surface/50 p-4 text-center">
          <p className="text-4xl font-bold tabular-nums text-foreground">
            {suggestedRounded != null ? formatAud(suggestedRounded) : '—'}
          </p>
          {prediction.creditorAmount != null ? (
            <p className="mt-1 text-xs text-foreground/60">
              From predicted outcome on ATO debt of {formatAud(prediction.creditorAmount)}
            </p>
          ) : (
            <p className="mt-1 text-xs text-warning">
              Run financials extraction to enable offer suggestion
            </p>
          )}
          <p className="mt-2 text-xs text-foreground/40">Suggested SBR offer</p>
        </div>
        <div className="rounded-lg border border-border bg-surface/50 p-4 text-center">
          <p className={cn('text-4xl font-bold', confidenceTone)}>{confidenceLabel}</p>
          <p className="mt-1 text-xs text-foreground/60">
            Neighbour spread {prediction.neighbourStdev.toFixed(1)}pp
          </p>
          <p className="mt-2 text-xs text-foreground/40">Confidence</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-foreground/40">
          Prediction based on the {prediction.comparableCases.length} most similar historical
          cases. Typical accuracy: ±6 percentage points.
        </p>
        <button
          type="button"
          onClick={() => setCalcOpen(true)}
          className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          Show calculations
        </button>
      </div>

      {calcOpen && (
        <CalculationsModal
          prediction={prediction}
          confidenceLabel={confidenceLabel}
          suggestedRounded={suggestedRounded}
          onClose={() => setCalcOpen(false)}
        />
      )}
    </Card>
  )
}

function CalculationsModal({
  prediction,
  confidenceLabel,
  suggestedRounded,
  onClose,
}: {
  prediction: FullPrediction
  confidenceLabel: string
  suggestedRounded: number | null
  onClose: () => void
}) {
  const outcomes = prediction.comparableCases.map((c) => c.outcomePercent)
  const sum = outcomes.reduce((s, v) => s + v, 0)
  const mean = sum / outcomes.length
  const mcrFeeRate = 0.1

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1.5 text-foreground/50 hover:bg-primary/40 hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-5 pr-8">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-accent" />
            <h2 className="text-base font-semibold text-foreground">
              How these numbers were calculated
            </h2>
          </div>
          <p className="mt-1 text-xs text-foreground/55">
            Step-by-step with this client&apos;s actual values. The same logic runs every
            time — no AI involved.
          </p>
        </div>

        {/* Predicted outcome */}
        <section className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            1. Predicted outcome ({prediction.predictedOutcomePercent.toFixed(1)}%)
          </h3>
          <p className="mb-2 text-xs text-foreground/65">
            Formula: <code className="text-foreground/90">average of the 8 nearest cases&apos; outcomes</code>
          </p>
          <div className="rounded-lg border border-border bg-surface/40 p-3 text-xs">
            <p className="text-foreground/60">Outcomes of the 8 nearest neighbours:</p>
            <ul className="mt-1 space-y-0.5 text-foreground/80">
              {prediction.comparableCases.map((c, i) => (
                <li key={c.id}>
                  <span className="text-foreground/40">{i + 1}.</span> {c.clientName} —{' '}
                  <span className="text-foreground">{c.outcomePercent.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-border/60 pt-2 text-foreground/70">
              <div>
                Sum = {outcomes.map((o) => o.toFixed(1)).join(' + ')} ={' '}
                <span className="text-foreground">{sum.toFixed(1)}</span>
              </div>
              <div className="mt-1">
                Mean = {sum.toFixed(1)} ÷ {outcomes.length} ={' '}
                <span className="text-foreground font-semibold">{mean.toFixed(2)}%</span>{' '}
                <span className="text-foreground/40">
                  (rounded to {prediction.predictedOutcomePercent.toFixed(1)}%)
                </span>
              </div>
              <div className="mt-1">
                Range = [min, max] = [
                <span className="text-foreground">
                  {prediction.predictedLowPercent.toFixed(1)}%
                </span>
                ,{' '}
                <span className="text-foreground">
                  {prediction.predictedHighPercent.toFixed(1)}%
                </span>
                ]
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-foreground/45">
            The 8 neighbours are picked using Euclidean distance over the 8 input features
            after z-score standardisation (so days late and dollar amounts contribute on
            comparable scales).
          </p>
        </section>

        {/* Suggested SBR offer */}
        <section className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            2. Suggested SBR offer{' '}
            {suggestedRounded != null ? `(${formatAud(suggestedRounded)})` : '(not available)'}
          </h3>
          {prediction.creditorAmount != null && prediction.suggestedOfferAmount != null ? (
            <>
              <p className="mb-2 text-xs text-foreground/65">
                Formula:{' '}
                <code className="text-foreground/90">
                  (predicted_outcome% × ATO_debt) ÷ (1 − MCR_fee_rate)
                </code>
              </p>
              <div className="rounded-lg border border-border bg-surface/40 p-3 text-xs text-foreground/70 space-y-1">
                <div>
                  ATO debt (creditor amount) ={' '}
                  <span className="text-foreground">{formatAud(prediction.creditorAmount)}</span>
                </div>
                <div>
                  Predicted outcome ={' '}
                  <span className="text-foreground">
                    {prediction.predictedOutcomePercent.toFixed(1)}%
                  </span>
                </div>
                <div>MCR fee rate = 10% (so creditors receive 90% of the offer)</div>
                <div className="mt-2 border-t border-border/60 pt-2">
                  Creditor receipt ={' '}
                  {(prediction.predictedOutcomePercent / 100).toFixed(3)} ×{' '}
                  {formatAud(prediction.creditorAmount)} ={' '}
                  <span className="text-foreground">
                    {formatAud(
                      (prediction.predictedOutcomePercent / 100) * prediction.creditorAmount,
                    )}
                  </span>
                </div>
                <div>
                  Offer ={' '}
                  {formatAud(
                    (prediction.predictedOutcomePercent / 100) * prediction.creditorAmount,
                  )}{' '}
                  ÷ {(1 - mcrFeeRate).toFixed(2)} ={' '}
                  <span className="text-foreground font-semibold">
                    {formatAud(prediction.suggestedOfferAmount)}
                  </span>
                </div>
                <div className="text-foreground/45">
                  Rounded to nearest $500 ={' '}
                  <span className="text-foreground">
                    {suggestedRounded != null ? formatAud(suggestedRounded) : '—'}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-xs text-foreground/45">
                The MCR fee comes off the gross offer before creditors are paid, so the
                offer is back-calculated by dividing the creditor receipt by 0.90.
              </p>
            </>
          ) : (
            <p className="text-xs text-foreground/55">
              Not calculable yet — run financials extraction so the ATO debt figure can be
              read from the balance sheet.
            </p>
          )}
        </section>

        {/* Confidence */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            3. Confidence ({confidenceLabel})
          </h3>
          <p className="mb-2 text-xs text-foreground/65">
            Formula:{' '}
            <code className="text-foreground/90">
              standard deviation of the 8 neighbour outcomes
            </code>
          </p>
          <div className="rounded-lg border border-border bg-surface/40 p-3 text-xs">
            <p className="text-foreground/60">Deviation of each neighbour from the mean:</p>
            <ul className="mt-1 space-y-0.5 text-foreground/80">
              {outcomes.map((o, i) => {
                const dev = o - mean
                return (
                  <li key={i}>
                    <span className="text-foreground/40">{i + 1}.</span> {o.toFixed(1)}% −{' '}
                    {mean.toFixed(2)}% ={' '}
                    <span className={dev >= 0 ? 'text-foreground' : 'text-foreground/80'}>
                      {dev >= 0 ? '+' : ''}
                      {dev.toFixed(2)}
                    </span>{' '}
                    <span className="text-foreground/40">(squared: {(dev * dev).toFixed(2)})</span>
                  </li>
                )
              })}
            </ul>
            <div className="mt-3 border-t border-border/60 pt-2 text-foreground/70">
              <div>
                Variance = sum of squared deviations ÷ {outcomes.length} ={' '}
                <span className="text-foreground">
                  {(prediction.neighbourStdev * prediction.neighbourStdev).toFixed(2)}
                </span>
              </div>
              <div>
                Stdev = √variance ={' '}
                <span className="text-foreground font-semibold">
                  {prediction.neighbourStdev.toFixed(2)}pp
                </span>
              </div>
            </div>
          </div>
          <div className="mt-2 grid gap-1 text-xs text-foreground/55">
            <p>
              <span className="text-foreground/80">Bands:</span> &lt; 5pp → Good · 5–10pp →
              Moderate · &gt; 10pp → Wide
            </p>
            <p>
              Lower stdev means the 8 similar cases agreed closely on the outcome — the
              prediction is on firmer ground.
            </p>
          </div>
        </section>

        <div className="mt-6 flex justify-end">
          <Button variant="primary" size="sm" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  )
}

function FeatureBreakdownPanel({ prediction }: { prediction: FullPrediction }) {
  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-foreground">How we got here</h3>
      <p className="mb-4 text-xs text-foreground/50">
        Factor-by-factor comparison between this client and the similar historical cases.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-foreground/40">
              <th className="pb-2 pr-4 font-medium">Factor</th>
              <th className="pb-2 pr-4 font-medium">This client</th>
              <th className="pb-2 pr-4 font-medium">Similar cases (median)</th>
              <th className="pb-2 font-medium">Influence</th>
            </tr>
          </thead>
          <tbody>
            {prediction.featureBreakdown.map((entry) => (
              <tr key={entry.feature} className="border-b border-border/40 last:border-0">
                <td className="py-2 pr-4 text-foreground/80">{entry.label}</td>
                <td className="py-2 pr-4 text-foreground/70">{formatFeatureValue(entry.feature, entry.inputValue)}</td>
                <td className="py-2 pr-4 text-foreground/70">{formatFeatureValue(entry.feature, entry.medianInNeighbours)}</td>
                <td className="py-2 text-foreground/60">{entry.influenceNote}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function ComparableCasesPanel({ prediction }: { prediction: FullPrediction }) {
  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-foreground">Comparable cases</h3>
      <p className="mb-4 text-xs text-foreground/50">
        The {prediction.comparableCases.length} closest historical cases, sorted by similarity.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {prediction.comparableCases.map((c) => (
          <div key={c.id} className="rounded-lg border border-border bg-surface/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{c.clientName}</p>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs',
                  c.accepted
                    ? 'bg-success/15 text-success'
                    : 'bg-destructive/15 text-destructive',
                )}
              >
                {c.accepted ? 'Accepted' : 'Rejected'}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-foreground/60">
              <span>
                Outcome: <span className="text-foreground">{c.outcomePercent.toFixed(1)}%</span>
              </span>
              <span className="text-foreground/30">·</span>
              <span>Distance: {c.distance.toFixed(2)}</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-foreground/60">
              <div>
                Cum. days late:{' '}
                <span className="text-foreground/80">
                  {formatNumber(c.features.cumulativeDaysLate)}
                </span>
              </div>
              <div>
                Late lodgements:{' '}
                <span className="text-foreground/80">
                  {formatNumber(c.features.numberOfLateLodgements)}
                </span>
              </div>
              <div>
                Days since payment:{' '}
                <span className="text-foreground/80">
                  {c.features.daysSinceLastPayment === 9999
                    ? 'Never'
                    : formatNumber(c.features.daysSinceLastPayment)}
                </span>
              </div>
              <div>
                DPN:{' '}
                <span className="text-foreground/80">{c.features.dpn ? 'Yes' : 'No'}</span>
              </div>
              <div>
                Plan:{' '}
                <span className="text-foreground/80 capitalize">
                  {c.features.paymentPlanType}
                </span>
              </div>
              <div>
                Director loan:{' '}
                <span className="text-foreground/80">
                  {c.features.directorLoanAtAppointment ? 'Yes' : 'No'}
                </span>
              </div>
            </dl>
            <p className="mt-2 text-xs text-foreground/50">
              SBR offer: <span className="text-foreground/80">{formatAud(c.sbrPayment)}</span> of{' '}
              <span className="text-foreground/80">{formatAud(c.creditorAmount)}</span> creditor
              debt
            </p>
          </div>
        ))}
      </div>
    </Card>
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function MethodologyCallout({ prediction }: { prediction: FullPrediction }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="border-accent/20 bg-accent/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold text-foreground">
            Methodology &amp; limitations
          </span>
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-foreground/50" />
        ) : (
          <ChevronDown className="h-4 w-4 text-foreground/50" />
        )}
      </button>
      {open && (
        <div className="mt-4 space-y-4 text-xs text-foreground/70">
          <div>
            <p className="text-foreground/90 font-medium mb-1">How this prediction works</p>
            <p>
              We compare the client&apos;s profile across 8 factors (late lodgement history,
              payment behaviour, DPN status, director loans, and payment-plan type) against{' '}
              {prediction.trainingSetSize} historical MCR cases. The prediction is the average
              outcome of the {prediction.comparableCases.length} most similar past cases; the
              range is the lowest and highest outcomes in that group.
            </p>
          </div>
          <div>
            <p className="text-foreground/90 font-medium mb-1">
              What this prediction can and can&apos;t tell you
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {prediction.accuracyDisclosure.knownLimitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
              <li>
                This prediction is a starting point for client conversations, not a final figure.
              </li>
            </ul>
          </div>
        </div>
      )}
    </Card>
  )
}

function ExportButton({
  prediction,
  clientName,
}: {
  prediction: FullPrediction
  clientName: string
}) {
  function handleExport() {
    const lines: string[] = []
    const push = (...cells: Array<string | number | null>) =>
      lines.push(
        cells
          .map((c) => {
            if (c == null) return ''
            const s = String(c)
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
              return `"${s.replace(/"/g, '""')}"`
            }
            return s
          })
          .join(','),
      )

    push('SBR Outcome Prediction', clientName)
    push('Generated', prediction.computedAt)
    push('Training set size', prediction.trainingSetSize)
    push('')

    push('SUMMARY')
    push('Predicted outcome %', prediction.predictedOutcomePercent)
    push('Range low %', prediction.predictedLowPercent)
    push('Range high %', prediction.predictedHighPercent)
    push('Neighbour stdev (pp)', prediction.neighbourStdev)
    push(
      'Suggested SBR offer',
      prediction.suggestedOfferAmount != null
        ? roundToNearest(prediction.suggestedOfferAmount, 500)
        : '',
    )
    push('ATO debt (creditor proxy)', prediction.creditorAmount ?? '')
    push('')

    push('INPUTS')
    push('DPN', prediction.inputFeatures.dpn ? 'Yes' : 'No')
    push('Payment plan type', prediction.inputFeatures.paymentPlanType)
    push(
      'Director loan at appointment',
      prediction.inputFeatures.directorLoanAtAppointment ? 'Yes' : 'No',
    )
    push(
      'Director loan sent to ATO',
      prediction.inputFeatures.directorLoanSentToAto ? 'Yes' : 'No',
    )
    push('Director loan receivable', prediction.inputFeatures.directorLoanReceivableAmount)
    push('Cumulative days late', prediction.inputFeatures.cumulativeDaysLate)
    push('Number of late lodgements', prediction.inputFeatures.numberOfLateLodgements)
    push('Days since last payment', prediction.inputFeatures.daysSinceLastPayment)
    push('')

    push('FEATURE BREAKDOWN')
    push('Factor', 'This client', 'Median (neighbours)', 'Influence')
    for (const entry of prediction.featureBreakdown) {
      push(
        entry.label,
        formatFeatureValue(entry.feature, entry.inputValue),
        formatFeatureValue(entry.feature, entry.medianInNeighbours),
        entry.influenceNote,
      )
    }
    push('')

    push('COMPARABLE CASES')
    push(
      'Rank',
      'Client',
      'Outcome %',
      'Accepted',
      'Distance',
      'Creditor amount',
      'SBR payment',
      'Cum days late',
      'Late lodgements',
      'Days since payment',
      'DPN',
      'Payment plan',
      'Director loan at appt',
      'Director loan to ATO',
      'Director loan receivable',
    )
    prediction.comparableCases.forEach((c, i) => {
      push(
        i + 1,
        c.clientName,
        c.outcomePercent,
        c.accepted ? 'Yes' : 'No',
        c.distance.toFixed(3),
        c.creditorAmount,
        c.sbrPayment,
        c.features.cumulativeDaysLate,
        c.features.numberOfLateLodgements,
        c.features.daysSinceLastPayment,
        c.features.dpn ? 'Yes' : 'No',
        c.features.paymentPlanType,
        c.features.directorLoanAtAppointment ? 'Yes' : 'No',
        c.features.directorLoanSentToAto ? 'Yes' : 'No',
        c.features.directorLoanReceivableAmount,
      )
    })
    push('')

    push('METHODOLOGY')
    push('Mean absolute error (pp)', prediction.accuracyDisclosure.meanAbsoluteError)
    push('Interval coverage', prediction.accuracyDisclosure.intervalCoverage)
    push('Sample size', prediction.accuracyDisclosure.sampleSize)
    for (const line of prediction.accuracyDisclosure.knownLimitations) {
      push('', line)
    }

    const csv = lines.join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safe = clientName.replace(/[^a-z0-9-]+/gi, '_')
    a.href = url
    a.download = `${safe}_sbr_outcome_prediction.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleExport}>
      <Download className="h-3.5 w-3.5" />
      Export CSV
    </Button>
  )
}

function formatFeatureValue(feature: string, value: number | boolean | string): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') {
    if (value === 'plan') return 'Payment plan'
    if (value === 'upfront') return 'Upfront'
    return value
  }
  if (feature === 'directorLoanReceivableAmount') return formatAud(value)
  if (feature === 'daysSinceLastPayment' && value >= 9999) return 'No payments ever'
  return formatNumber(value)
}
