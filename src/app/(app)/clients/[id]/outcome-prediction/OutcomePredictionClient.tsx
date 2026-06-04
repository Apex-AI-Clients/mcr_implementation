'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Banknote,
  Download,
  FileCheck,
  FileClock,
  HelpCircle,
  Info,
  Landmark,
  RefreshCw,
  Target,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn, formatDateRelative } from '@/lib/utils'
import type { SbrPrediction, SbrPredictionInput } from '@/lib/sbr/types'

interface InitialAuto {
  cumulativeDaysLate: number | null
  numberOfLateLodgements: number | null
  daysSinceLastPayment: number | null
  directorLoanReceivableAmount: number
  directorLoanDetected: boolean | null
  directorLoanReasoning: string | null
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
  autoDetectedDirectorLoan?: {
    detected: boolean | null
    reasoning: string | null
  }
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

function extractCachedInput(
  cached: CachedSummary | null,
): {
  dpn: boolean
  paymentPlanType: 'plan' | 'upfront'
  directorLoanAtAppointment: boolean
} | null {
  if (!cached) return null
  const f = cached.inputFeatures
  const ppt = f.paymentPlanType
  return {
    dpn: typeof f.dpn === 'boolean' ? f.dpn : false,
    paymentPlanType: ppt === 'plan' ? 'plan' : 'upfront',
    directorLoanAtAppointment:
      typeof f.directorLoanAtAppointment === 'boolean' ? f.directorLoanAtAppointment : false,
  }
}

export function OutcomePredictionClient({
  clientId,
  clientName,
  initialAuto,
  initialPrediction,
}: Props) {
  const cachedInputs = extractCachedInput(initialPrediction)

  const [auto] = useState<InitialAuto>(initialAuto)
  const [dpn, setDpn] = useState(cachedInputs?.dpn ?? false)
  const [paymentPlanType, setPaymentPlanType] = useState<'plan' | 'upfront'>(
    cachedInputs?.paymentPlanType ?? 'upfront',
  )
  const [directorLoanAtAppointment, setDirectorLoanAtAppointment] = useState(
    // Pre-fill from the cached input if any, else from balance-sheet auto-detection.
    cachedInputs?.directorLoanAtAppointment ?? initialAuto.directorLoanDetected === true,
  )

  const [prediction, setPrediction] = useState<FullPrediction | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<MissingPrereq[]>([])
  // Inputs panel is always open on page load — the user often wants to tweak
  // and re-run, so keep the form visible. They can still collapse manually.
  const [inputsCollapsed, setInputsCollapsed] = useState(false)
  // "About this prediction" methodology now lives behind a header info button.
  const [methodologyOpen, setMethodologyOpen] = useState(false)

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
    } catch {
      setError('Network error during prediction.')
    } finally {
      setRunning(false)
    }
  }

  // On mount: if there's a cached prediction, hydrate the full payload (the DB
  // cache only stores the summary — the comparable cases + breakdown have to
  // be recomputed). This is fast (~10ms server-side) and idempotent.
  const hydrated = useRef(false)
  useEffect(() => {
    if (hydrated.current) return
    if (!initialPrediction) return
    if (!lodgementReady) return
    hydrated.current = true
    runPrediction()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href={`/clients/${clientId}`}
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
              <button
                type="button"
                onClick={() => setMethodologyOpen(true)}
                aria-label="About this prediction"
                title="About this prediction"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground/60 hover:bg-surface/60 hover:text-foreground transition-colors"
              >
                <Info className="h-4 w-4" />
              </button>
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
                href={`/clients/${clientId}`}
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
          {/* Temporarily hidden (client request): "What the rejections tell us"
              and "How to strengthen this profile". Re-enable by uncommenting. */}
          {/* <RejectionLearningPanel prediction={prediction} /> */}
          {/* <ProfileStrengtheningPanel prediction={prediction} /> */}
          <FeatureBreakdownPanel prediction={prediction} />
          <ComparableCasesPanel prediction={prediction} />
          {/* "About this prediction" — opened from the header info button. */}
          {methodologyOpen && (
            <MethodologyModal prediction={prediction} onClose={() => setMethodologyOpen(false)} />
          )}
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
            href={`/clients/${clientId}`}
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
            <div>
              <CheckboxField
                label="Director loan at appointment"
                checked={directorLoanAtAppointment}
                onChange={setDirectorLoanAtAppointment}
              />
              <DirectorLoanAutoCaption
                detected={auto.directorLoanDetected}
                reasoning={auto.directorLoanReasoning}
              />
            </div>
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
          <Button variant="ghost" size="md" onClick={onToggleCollapsed}>
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
            These fields drive the prediction. Director loan at appointment is pre-filled from
            the balance sheet where possible — confirm or override each one based on the
            client&apos;s actual situation before generating a prediction.
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
          <span className="text-foreground/85">Quick sanity test:</span> leave both
          boxes unticked and Upfront selected — that gives the baseline
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

function DirectorLoanAutoCaption({
  detected,
  reasoning,
}: {
  detected: boolean | null
  reasoning: string | null
}) {
  if (detected === null) {
    return (
      <p className="mt-1 pl-1 text-xs text-foreground/40">
        No balance sheet available — set manually.
      </p>
    )
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 pl-1 text-xs text-foreground/40">
      {detected && (
        <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success">
          Auto-detected
        </span>
      )}
      <span>{reasoning} Toggle if incorrect.</span>
    </p>
  )
}

const RISK_BAND_META: Record<
  FullPrediction['riskBand'],
  { label: string; emoji: string; tile: string; text: string }
> = {
  likely_accepted: {
    label: 'Likely accepted',
    emoji: '🟢',
    tile: 'border-success/40 bg-success/5',
    text: 'text-success',
  },
  borderline: {
    label: 'Borderline',
    emoji: '🟡',
    tile: 'border-warning/40 bg-warning/5',
    text: 'text-warning',
  },
  high_rejection_risk: {
    label: 'High rejection risk',
    emoji: '🔴',
    tile: 'border-destructive/40 bg-destructive/5',
    text: 'text-destructive',
  },
}

function paymentStructureLabel(
  rec: FullPrediction['paymentStructureRecommendation']['recommended'],
): string {
  if (rec === 'upfront') return 'Upfront preferred'
  if (rec === 'plan') return 'Payment plan preferred'
  return 'No clear preference'
}

/**
 * Plain-English explanation of what each payment-structure result means in
 * practice — so a non-technical user knows what to actually do.
 */
function paymentStructureMeaning(
  rec: FullPrediction['paymentStructureRecommendation']['recommended'],
): string {
  if (rec === 'upfront') {
    return 'Most similar deals that got accepted were paid as a single lump sum — lead with an upfront offer.'
  }
  if (rec === 'plan') {
    return 'Most similar deals that got accepted were paid in instalments — a payment plan should be acceptable.'
  }
  return 'Similar accepted deals used upfront and payment plans about equally. Both have been approved for this profile, so choose whichever suits the client’s cash position — it should not change the approval odds.'
}

function riskBandExportLabel(band: FullPrediction['riskBand']): string {
  return RISK_BAND_META[band].label
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used by the temporarily-hidden export section
function offerMoreVerdictLabel(
  verdict: FullPrediction['rejectionLearning']['offerMoreVerdict'],
): string {
  if (verdict === 'higher_offer_may_help') return 'A higher offer should help this profile'
  if (verdict === 'higher_offer_unlikely_to_help')
    return 'A higher offer alone is unlikely to flip this profile'
  return 'Insufficient signal'
}

function HeadlineTiles({ prediction }: { prediction: FullPrediction }) {
  const [calcOpen, setCalcOpen] = useState(false)

  const suggestedRounded =
    prediction.suggestedOfferAmount != null
      ? roundToNearest(prediction.suggestedOfferAmount, 500)
      : null

  // "What do we offer to get it accepted?" — shown for risky profiles.
  const aligned = prediction.acceptedAlignedOffer
  const targetRounded =
    aligned.targetAmount != null ? roundToNearest(aligned.targetAmount, 500) : null
  const isRisky = prediction.riskBand !== 'likely_accepted'
  const showRaise = isRisky && aligned.mode === 'raise' && targetRounded != null
  const showAlreadyStrong = isRisky && aligned.mode === 'already_strong'

  const band = RISK_BAND_META[prediction.riskBand]
  const payment = prediction.paymentStructureRecommendation

  return (
    <Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. Recommended offer (predicted cents-in-the-dollar outcome) */}
        <div className="rounded-lg border border-border bg-surface/50 p-4 text-center">
          <p className="text-4xl font-bold tabular-nums text-foreground">
            {prediction.predictedOutcomePercent.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-foreground/60">
            Range {prediction.predictedLowPercent.toFixed(1)}% –{' '}
            {prediction.predictedHighPercent.toFixed(1)}% across {prediction.comparableCases.length}{' '}
            similar cases
          </p>
          <p className="mt-2 text-xs text-foreground/40">Recommended offer</p>
        </div>

        {/* 2. SBR amount — for risky profiles, shows the offer needed to reach
            the level at which similar deals were accepted. */}
        <div
          className={cn(
            'rounded-lg border p-4 text-center',
            showRaise ? 'border-success/40 bg-success/5' : 'border-border bg-surface/50',
          )}
        >
          {prediction.creditorAmount == null ? (
            <>
              <p className="text-4xl font-bold tabular-nums text-foreground">—</p>
              <p className="mt-1 text-xs text-warning">
                Run financials extraction to enable offer suggestion
              </p>
              <p className="mt-2 text-xs text-foreground/40">Suggested SBR amount</p>
            </>
          ) : showRaise ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-success">
                Amount to make it acceptable
              </p>
              <p className="mt-1 text-4xl font-bold tabular-nums text-success">
                {formatAud(targetRounded)}
              </p>
              <p className="mt-1.5 text-xs text-foreground/70">
                Current SBR amount is{' '}
                <span className="font-medium text-foreground">{formatAud(suggestedRounded)}</span> —
                raise it to{' '}
                <span className="font-medium text-success">{formatAud(targetRounded)}</span> to match
                similar deals that were accepted.
              </p>
              <p className="mt-2 text-xs text-foreground/40">SBR amount to aim for</p>
            </>
          ) : showAlreadyStrong ? (
            <>
              <p className="text-4xl font-bold tabular-nums text-foreground">
                {suggestedRounded != null ? formatAud(suggestedRounded) : '—'}
              </p>
              <p className="mt-1.5 text-xs text-foreground/70">
                This is the current SBR amount — already at the level similar deals were accepted
                at. To improve the odds, pay sooner or in full rather than increasing the offer.
              </p>
              <p className="mt-2 text-xs text-foreground/40">Current SBR amount</p>
            </>
          ) : (
            <>
              <p className="text-4xl font-bold tabular-nums text-foreground">
                {suggestedRounded != null ? formatAud(suggestedRounded) : '—'}
              </p>
              <p className="mt-1 text-xs text-foreground/60">
                In line with similar deals that were accepted.
              </p>
              <p className="mt-2 text-xs text-foreground/40">Suggested SBR amount</p>
            </>
          )}
        </div>

        {/* 3. Risk band — traffic-light label only, never a probability */}
        <div className={cn('rounded-lg border p-4 text-center', band.tile)}>
          <p className={cn('text-lg font-bold', band.text)}>
            {band.emoji} {band.label}
          </p>
          <p className="mt-1 text-xs text-foreground/60">{prediction.riskBandReasoning}</p>
          <p className="mt-2 text-xs text-foreground/40">Risk band</p>
        </div>

        {/* 4. Payment structure recommendation */}
        <div className="rounded-lg border border-border bg-surface/50 p-4 text-center">
          <p className="text-lg font-bold text-foreground">
            {paymentStructureLabel(payment.recommended)}
          </p>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px]">
            <span className="rounded bg-surface px-1.5 py-0.5 text-foreground/70">
              Plan {payment.neighbourSplit.plan}
            </span>
            <span className="rounded bg-surface px-1.5 py-0.5 text-foreground/70">
              Upfront {payment.neighbourSplit.upfront}
            </span>
          </div>
          <p className="mt-2 text-xs text-foreground/60">
            {paymentStructureMeaning(payment.recommended)}
          </p>
          <p className="mt-2 text-xs text-foreground/40">Payment structure</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-foreground/40">
          Prediction based on the {prediction.comparableCases.length} most similar historical
          cases. Typical accuracy: ±8 percentage points.
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
          suggestedRounded={suggestedRounded}
          onClose={() => setCalcOpen(false)}
        />
      )}
    </Card>
  )
}

function CalculationsModal({
  prediction,
  suggestedRounded,
  onClose,
}: {
  prediction: FullPrediction
  suggestedRounded: number | null
  onClose: () => void
}) {
  const outcomes = prediction.comparableCases.map((c) => c.outcomePercent)
  const sum = outcomes.reduce((s, v) => s + v, 0)
  const mean = sum / outcomes.length
  const sbrPractitionerFeeRate = 0.125
  const k = prediction.comparableCases.length
  const rejectedCount = prediction.rejectedNeighbours.length
  const acceptedCount = k - rejectedCount
  const band = RISK_BAND_META[prediction.riskBand]
  const split = prediction.paymentStructureRecommendation.neighbourSplit
  const aligned = prediction.acceptedAlignedOffer
  const targetRounded =
    aligned.targetAmount != null ? roundToNearest(aligned.targetAmount, 500) : null

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
            How each of the four tiles is worked out, step-by-step with this client&apos;s actual
            values. The same logic runs every time — no AI involved.
          </p>
        </div>

        {/* 1. Recommended offer */}
        <section className="mb-5">
          <h3 className="mb-1 text-sm font-semibold text-foreground">
            1. Recommended offer ({prediction.predictedOutcomePercent.toFixed(1)}%)
          </h3>
          <p className="mb-2 text-xs italic text-foreground/45">
            What it is: the cents-in-the-dollar settlement to put forward, as a % of the ATO debt.
          </p>
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
            The 8 neighbours are picked using Euclidean distance over the 7 input features
            after z-score standardisation (so days late and dollar amounts contribute on
            comparable scales).
          </p>
        </section>

        {/* 2. SBR amount — current offer + the amount to make it acceptable */}
        <section className="mb-5">
          <h3 className="mb-1 text-sm font-semibold text-foreground">
            2. SBR amount{' '}
            {suggestedRounded != null ? `(current ${formatAud(suggestedRounded)})` : '(not available)'}
          </h3>
          <p className="mb-2 text-xs italic text-foreground/45">
            What it is: the current dollar offer (the recommended % on this client&apos;s ATO debt,
            grossed up for the SBR practitioner fee) — and the amount needed to match similar deals
            that were accepted.
          </p>
          <p className="mb-2 text-xs font-medium text-foreground/80">2a. Current SBR amount</p>
          {prediction.creditorAmount != null && prediction.suggestedOfferAmount != null ? (
            <>
              <p className="mb-2 text-xs text-foreground/65">
                Formula:{' '}
                <code className="text-foreground/90">
                  (predicted_outcome% × ATO_debt) ÷ (1 − SBR_practitioner_fee)
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
                <div>SBR practitioner fee = 12.5% (so creditors receive 87.5% of the offer)</div>
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
                  ÷ {(1 - sbrPractitionerFeeRate).toFixed(3)} ={' '}
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
                The SBR practitioner fee comes off the gross offer before creditors are paid, so the
                offer is back-calculated by dividing the creditor receipt by 0.875.
              </p>

              {/* 2b. Amount to make it acceptable */}
              {aligned.targetPercent != null && aligned.targetAmount != null && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-foreground/80">
                    2b. Amount to make it acceptable{' '}
                    {targetRounded != null ? `(${formatAud(targetRounded)})` : ''}
                  </p>
                  <p className="mb-2 text-xs text-foreground/65">
                    Formula:{' '}
                    <code className="text-foreground/90">
                      (highest_accepted_offer% × ATO_debt) ÷ (1 − SBR_practitioner_fee)
                    </code>
                  </p>
                  <div className="rounded-lg border border-border bg-surface/40 p-3 text-xs text-foreground/70 space-y-1">
                    <div>
                      Highest offer a similar case was accepted at ={' '}
                      <span className="text-foreground">{aligned.targetPercent.toFixed(1)}%</span>
                    </div>
                    <div>
                      Creditor receipt = {(aligned.targetPercent / 100).toFixed(3)} ×{' '}
                      {formatAud(prediction.creditorAmount)} ={' '}
                      <span className="text-foreground">
                        {formatAud((aligned.targetPercent / 100) * prediction.creditorAmount)}
                      </span>
                    </div>
                    <div>
                      Offer ={' '}
                      {formatAud((aligned.targetPercent / 100) * prediction.creditorAmount)} ÷{' '}
                      {(1 - sbrPractitionerFeeRate).toFixed(3)} ={' '}
                      <span className="text-foreground font-semibold">
                        {formatAud(aligned.targetAmount)}
                      </span>{' '}
                      <span className="text-foreground/40">
                        (rounded to {targetRounded != null ? formatAud(targetRounded) : '—'})
                      </span>
                    </div>
                    <div className="mt-2 border-t border-border/60 pt-2">
                      {aligned.mode === 'raise' ? (
                        <span>
                          Current offer {formatAud(suggestedRounded)} is below this — raising it to{' '}
                          <span className="text-success font-medium">
                            {formatAud(targetRounded)}
                          </span>{' '}
                          matches the deals that were accepted.
                        </span>
                      ) : (
                        <span>
                          The current offer {formatAud(suggestedRounded)} already meets or exceeds
                          this level, so raising it further is not the lever — improve the odds by
                          paying sooner or in full instead.
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-foreground/45">
                    The target is the highest cents-in-the-dollar at which a similar past case was
                    accepted — i.e. the proven ceiling of acceptance for this profile. It is an
                    association from comparable deals, not a guarantee of approval.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-foreground/55">
              Not calculable yet — run financials extraction so the ATO debt figure can be
              read from the balance sheet.
            </p>
          )}
        </section>

        {/* 3. Risk band */}
        <section className="mb-5">
          <h3 className="mb-1 text-sm font-semibold text-foreground">
            3. Risk band ({band.emoji} {band.label})
          </h3>
          <p className="mb-2 text-xs italic text-foreground/45">
            What it is: a traffic-light read on how risky this profile looks — based purely on how
            many similar past deals were rejected. It is not a probability.
          </p>
          <p className="mb-2 text-xs text-foreground/65">
            Rule:{' '}
            <code className="text-foreground/90">
              count how many of the {k} closest cases were rejected
            </code>
          </p>
          <div className="rounded-lg border border-border bg-surface/40 p-3 text-xs text-foreground/70 space-y-1">
            <div>
              Of the {k} closest cases:{' '}
              <span className="text-success">{acceptedCount} accepted</span>,{' '}
              <span className="text-warning">{rejectedCount} rejected</span>.
            </div>
            <div className="mt-2 border-t border-border/60 pt-2">
              Bands: <span className="text-foreground">0–2 rejected → 🟢 Likely accepted</span> ·{' '}
              <span className="text-foreground">3 rejected → 🟡 Borderline</span> ·{' '}
              <span className="text-foreground">4+ rejected → 🔴 High rejection risk</span>
            </div>
            <div>
              {rejectedCount} rejected →{' '}
              <span className={cn('font-semibold', band.text)}>
                {band.emoji} {band.label}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-foreground/45">{prediction.riskBandReasoning}</p>
        </section>

        {/* 4. Payment structure */}
        <section>
          <h3 className="mb-1 text-sm font-semibold text-foreground">
            4. Payment structure ({paymentStructureLabel(prediction.paymentStructureRecommendation.recommended)})
          </h3>
          <p className="mb-2 text-xs italic text-foreground/45">
            What it is: whether comparable accepted deals leaned toward an upfront payment or a
            payment plan.
          </p>
          <p className="mb-2 text-xs text-foreground/65">
            Rule:{' '}
            <code className="text-foreground/90">
              among the accepted neighbours, recommend a structure only on a 2:1 majority
            </code>
          </p>
          <div className="rounded-lg border border-border bg-surface/40 p-3 text-xs text-foreground/70 space-y-1">
            <div>
              Accepted neighbours by structure:{' '}
              <span className="text-foreground">{split.plan} payment plan</span> ·{' '}
              <span className="text-foreground">{split.upfront} upfront</span>
            </div>
            <div className="mt-2 border-t border-border/60 pt-2">
              Result:{' '}
              <span className="text-foreground font-semibold">
                {paymentStructureLabel(prediction.paymentStructureRecommendation.recommended)}
              </span>{' '}
              <span className="text-foreground/40">
                {prediction.paymentStructureRecommendation.recommended === 'no_strong_signal'
                  ? '(neither side reaches a 2:1 majority → no clear preference)'
                  : '(reaches a 2:1 majority)'}
              </span>
            </div>
          </div>
          <div className="mt-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-foreground/70">
            <span className="font-medium text-foreground/85">What this means: </span>
            {paymentStructureMeaning(prediction.paymentStructureRecommendation.recommended)}
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

const OFFER_MORE_META: Record<
  FullPrediction['rejectionLearning']['offerMoreVerdict'],
  { heading: string; banner: string }
> = {
  higher_offer_may_help: {
    heading: 'A higher offer should help this profile',
    banner: 'border-success/30 bg-success/5 text-foreground/80',
  },
  higher_offer_unlikely_to_help: {
    heading: 'A higher offer alone is unlikely to flip this profile',
    banner: 'border-warning/30 bg-warning/5 text-foreground/80',
  },
  insufficient_signal: {
    heading: 'What the closest cases tell us',
    banner: 'border-border bg-surface/40 text-foreground/80',
  },
}

function OfferRangeCard({
  label,
  range,
  tone,
}: {
  label: string
  range: FullPrediction['rejectionLearning']['acceptedOfferRange']
  tone: 'accepted' | 'rejected'
}) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3">
      <p className="text-xs text-foreground/40">{label}</p>
      {range ? (
        <>
          <p className="mt-1 text-sm font-medium text-foreground">
            {range.min.toFixed(1)}% – {range.max.toFixed(1)}%
          </p>
          <p className="mt-0.5 text-xs text-foreground/50">
            median {range.median.toFixed(1)}% ·{' '}
            <span className={tone === 'rejected' ? 'text-warning' : 'text-success'}>
              {range.count} {tone === 'rejected' ? 'rejected' : 'accepted'}
            </span>
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-foreground/40">None among the closest cases</p>
      )}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- temporarily hidden, kept for re-enable
function RejectionLearningPanel({ prediction }: { prediction: FullPrediction }) {
  const learning = prediction.rejectionLearning
  const meta = OFFER_MORE_META[learning.offerMoreVerdict]

  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-foreground">What the rejections tell us</h3>
      <p className="mb-4 text-xs text-foreground/50">
        How to read the rejected comparables — and whether a higher offer would realistically
        help this profile.
      </p>

      <div className={cn('rounded-lg border px-3 py-2.5 text-xs leading-relaxed', meta.banner)}>
        <p className="font-medium text-foreground">{meta.heading}</p>
        <p className="mt-1">{learning.insight}</p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <OfferRangeCard
          label="Accepted comparables offered"
          range={learning.acceptedOfferRange}
          tone="accepted"
        />
        <OfferRangeCard
          label="Rejected comparables offered"
          range={learning.rejectedOfferRange}
          tone="rejected"
        />
      </div>

      {prediction.rejectedNeighbours.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-foreground/40">Rejected cases among the closest:</p>
          <ul className="space-y-1 text-xs text-foreground/70">
            {prediction.rejectedNeighbours.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                <span className="text-foreground/80">{c.clientName}</span>
                <span className="text-foreground/40">— offered {c.outcomePercent.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

const LEVER_ICONS: Record<string, LucideIcon> = {
  'Offer level': TrendingUp,
  'Payment structure': Wallet,
  'Lodgement compliance': FileCheck,
  'Late lodgements': FileClock,
  'Payment activity': Banknote,
  'Director loan': Landmark,
}

interface UiLever {
  factor: string
  suggestion: string
  basis: string
  current?: string
  target?: string
  impact?: 'high' | 'medium'
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- temporarily hidden, kept for re-enable
function ProfileStrengtheningPanel({ prediction }: { prediction: FullPrediction }) {
  const learning = prediction.rejectionLearning
  const payment = prediction.paymentStructureRecommendation

  // Compose the "all ways" list: offer lever + payment structure + operational
  // levers. Each is an association from accepted comparables, not a guarantee.
  const offerLever: UiLever | null =
    learning.offerMoreVerdict === 'higher_offer_may_help' && learning.acceptedOfferRange
      ? {
          factor: 'Offer level',
          suggestion: 'Lift the offer toward the band where similar deals have been accepted.',
          basis: 'Rejected comparables for this profile were offered less than the accepted ones — here, more cents in the dollar genuinely helps.',
          current:
            learning.rejectedOfferRange != null
              ? `Rejected around ${learning.rejectedOfferRange.median.toFixed(1)}%`
              : undefined,
          target: `${learning.acceptedOfferRange.min.toFixed(1)}%–${learning.acceptedOfferRange.max.toFixed(1)}% (accepted band)`,
          impact: 'high',
        }
      : learning.offerMoreVerdict === 'higher_offer_unlikely_to_help'
        ? {
            factor: 'Offer level',
            suggestion:
              'Do not rely on a higher offer here — put the effort into eligibility, documentation and lodgement compliance instead.',
            basis: 'Rejected comparables offered as much or more than accepted ones, so more money alone is unlikely to flip the outcome.',
            impact: 'medium',
          }
        : null

  const structureLever: UiLever | null =
    payment.recommended !== 'no_strong_signal'
      ? {
          factor: 'Payment structure',
          suggestion:
            payment.recommended === 'upfront'
              ? 'Favour an upfront offer for this profile.'
              : 'A payment plan appears workable for this profile.',
          basis: payment.reasoning,
          target: payment.recommended === 'upfront' ? 'Upfront' : 'Payment plan',
          impact: 'medium',
        }
      : null

  const allLevers: UiLever[] = [offerLever, structureLever, ...prediction.improvementLevers].filter(
    (l): l is UiLever => l !== null,
  )
  // Highest-impact levers first so the practitioner sees the big wins at the top.
  const order = { high: 0, medium: 1, undefined: 2 } as const
  allLevers.sort(
    (a, b) => order[a.impact ?? 'undefined'] - order[b.impact ?? 'undefined'],
  )

  const band = RISK_BAND_META[prediction.riskBand]

  return (
    <Card className="border-accent/30">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15">
          <Target className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">How to strengthen this profile</h3>
          <p className="mt-0.5 text-xs text-foreground/55">
            Currently{' '}
            <span className={cn('font-medium', band.text)}>
              {band.emoji} {band.label}
            </span>
            . Below are the levers most associated with the deals that got accepted — work the
            high-impact ones first. These are associations, not guarantees of approval.
          </p>
        </div>
      </div>

      {allLevers.length === 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-foreground/80">
          <span className="text-success">✓</span>
          <span>
            This profile already aligns closely with the accepted comparables — no obvious gaps to
            close. Apply practitioner judgement before quoting any figure.
          </span>
        </div>
      ) : (
        <ol className="space-y-3">
          {allLevers.map((lever, i) => {
            const Icon = LEVER_ICONS[lever.factor] ?? Target
            return (
              <li
                key={`${lever.factor}-${i}`}
                className="rounded-xl border border-border bg-surface/40 p-4"
              >
                <div className="flex gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                    <Icon className="h-5 w-5 text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-foreground/45">
                        {lever.factor}
                      </span>
                      {lever.impact === 'high' && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                          High impact
                        </span>
                      )}
                      {lever.impact === 'medium' && (
                        <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/50">
                          Worth doing
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium leading-snug text-foreground">
                      {lever.suggestion}
                    </p>
                    {lever.current && lever.target && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-md bg-warning/10 px-2 py-1 font-medium text-warning">
                          Now: {lever.current}
                        </span>
                        <ArrowRight className="h-4 w-4 text-foreground/40" />
                        <span className="rounded-md bg-success/10 px-2 py-1 font-medium text-success">
                          Target: {lever.target}
                        </span>
                      </div>
                    )}
                    {!lever.current && lever.target && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-md bg-success/10 px-2 py-1 font-medium text-success">
                          Aim for: {lever.target}
                        </span>
                      </div>
                    )}
                    <p className="mt-2 text-xs leading-relaxed text-foreground/50">{lever.basis}</p>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
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

function CaseInfoTooltip({ explanation }: { explanation: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        aria-label="Why this case got its outcome"
        className="text-foreground/40 hover:text-foreground/80 transition-colors"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute right-0 top-5 z-20 w-56 rounded-md border border-border bg-primary px-2.5 py-2 text-xs leading-relaxed text-foreground/80 shadow-xl"
        >
          {explanation}
        </span>
      )}
    </span>
  )
}

function ComparableCasesPanel({ prediction }: { prediction: FullPrediction }) {
  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-foreground">Closest historical cases</h3>
      <p className="mb-4 text-xs text-foreground/50">
        The {prediction.comparableCases.length} closest historical cases, sorted by similarity.
        Hover the ⓘ for why each case got its outcome.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {prediction.comparableCases.map((c) => (
          <div
            key={c.id}
            className={cn(
              'rounded-lg border border-border bg-surface/40 p-3',
              // Rejected cases get a subtle amber left border instead of a pill.
              !c.accepted && 'border-l-2 border-l-warning',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{c.clientName}</p>
              <CaseInfoTooltip explanation={c.outcomeExplanation} />
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

function MethodologyModal({
  prediction,
  onClose,
}: {
  prediction: FullPrediction
  onClose: () => void
}) {
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

        <div className="mb-4 flex items-center gap-2 pr-8">
          <Info className="h-4 w-4 text-accent" />
          <h2 className="text-base font-semibold text-foreground">About this prediction</h2>
        </div>

        <div className="space-y-4 text-xs text-foreground/70">
          <div>
            <p className="text-foreground/90 font-medium mb-1">How this prediction works</p>
            <p>
              We compare the client&apos;s profile across 7 factors (late lodgement history,
              payment behaviour, DPN status, director loan, and payment-plan type) against{' '}
              {prediction.trainingSetSize} historical MCR cases (41 accepted, 18 rejected). The
              recommended offer is the average outcome of the {prediction.comparableCases.length}{' '}
              most similar past cases.
            </p>
          </div>
          <div>
            <p className="text-foreground/90 font-medium mb-1">About the risk band</p>
            <p>
              The risk band is a coarse signal based on how many of the{' '}
              {prediction.comparableCases.length} closest past cases were rejected. It is NOT a
              calibrated probability. In the historical data, rejected cases were offered amounts
              between 19.7% and 61.7% — they were not systematically lower than accepted offers,
              so offering more does not automatically reduce rejection risk.
            </p>
          </div>
          <div>
            <p className="text-foreground/90 font-medium mb-1">Accuracy</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Predictions are typically within ±8 percentage points of the actual outcome.</li>
              <li>75% of historical outcomes fell inside the predicted range.</li>
              <li>
                The model does not consider revenue size, ATO debt size, industry, ATO assessor
                variance, documentation quality, or contested debts.
              </li>
            </ul>
          </div>
          <p className="text-foreground/90 font-medium">
            Always apply practitioner judgement before quoting any figure to a client.
          </p>
        </div>

        <div className="mt-6 flex justify-end">
          <Button variant="primary" size="sm" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
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
    push('Risk Band', riskBandExportLabel(prediction.riskBand))
    push('Risk Band Reasoning', prediction.riskBandReasoning)
    push(
      'Payment Structure Recommendation',
      `${paymentStructureLabel(prediction.paymentStructureRecommendation.recommended)} — ${prediction.paymentStructureRecommendation.reasoning}`,
    )
    push('')

    // Temporarily hidden (client request): "What the rejections tell us" and
    // "How to strengthen this profile" sections. Re-enable by uncommenting.
    // push('WHAT THE REJECTIONS TELL US')
    // push('Higher offer verdict', offerMoreVerdictLabel(prediction.rejectionLearning.offerMoreVerdict))
    // push('Insight', prediction.rejectionLearning.insight)
    // {
    //   const a = prediction.rejectionLearning.acceptedOfferRange
    //   const r = prediction.rejectionLearning.rejectedOfferRange
    //   push(
    //     'Accepted comparables offered',
    //     a ? `${a.min}%–${a.max}% (median ${a.median}%, n=${a.count})` : 'None among closest',
    //   )
    //   push(
    //     'Rejected comparables offered',
    //     r ? `${r.min}%–${r.max}% (median ${r.median}%, n=${r.count})` : 'None among closest',
    //   )
    // }
    // push('')

    // push('HOW TO STRENGTHEN THIS PROFILE')
    // push('Note', 'Associations from comparable accepted cases — not guarantees of approval.')
    // if (prediction.improvementLevers.length === 0) {
    //   push('', 'Profile already aligns closely with accepted comparables — no obvious gaps.')
    // } else {
    //   prediction.improvementLevers.forEach((lever, i) => {
    //     push(`${i + 1}. ${lever.factor}`, lever.suggestion, lever.basis)
    //   })
    // }
    // push('')

    push('INPUTS')
    push('DPN', prediction.inputFeatures.dpn ? 'Yes' : 'No')
    push('Payment plan type', prediction.inputFeatures.paymentPlanType)
    push(
      'Director loan at appointment',
      prediction.inputFeatures.directorLoanAtAppointment ? 'Yes' : 'No',
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
      'Director loan receivable',
      'Outcome Explanation',
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
        c.features.directorLoanReceivableAmount,
        c.outcomeExplanation,
      )
    })
    push('')

    push('METHODOLOGY')
    push(
      'How this prediction works',
      `We compare the client's profile across 7 factors (late lodgement history, payment behaviour, DPN status, director loan, and payment-plan type) against ${prediction.trainingSetSize} historical MCR cases (41 accepted, 18 rejected). The recommended offer is the average outcome of the ${prediction.comparableCases.length} most similar past cases.`,
    )
    push(
      'About the risk band',
      `The risk band is a coarse signal based on how many of the ${prediction.comparableCases.length} closest past cases were rejected. It is NOT a calibrated probability. In the historical data, rejected cases were offered amounts between 19.7% and 61.7% — they were not systematically lower than accepted offers, so offering more does not automatically reduce rejection risk.`,
    )
    push('Mean absolute error (pp)', prediction.accuracyDisclosure.meanAbsoluteError)
    push('Interval coverage', prediction.accuracyDisclosure.intervalCoverage)
    push('Sample size', prediction.accuracyDisclosure.sampleSize)
    for (const line of prediction.accuracyDisclosure.knownLimitations) {
      push('', line)
    }
    push('Risk band disclaimer', prediction.accuracyDisclosure.riskBandDisclaimer)
    push('', 'Always apply practitioner judgement before quoting any figure to a client.')

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
