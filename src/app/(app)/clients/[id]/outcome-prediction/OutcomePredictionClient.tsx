'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Banknote,
  ChevronDown,
  ChevronUp,
  Download,
  FileCheck,
  FileClock,
  HelpCircle,
  Info,
  Landmark,
  Minus,
  Plus,
  RefreshCw,
  Target,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Tooltip } from '@/components/ui/Tooltip'
import { ExportPdfButton } from '@/components/admin/ExportPdfButton'
import { cn, formatDateRelative } from '@/lib/utils'
import {
  DEFAULT_PRACTITIONER_FEE_RATE,
  MAX_PRACTITIONER_FEE_RATE,
  PRACTITIONER_FEE_OPTIONS,
  formatFeeRate,
  isValidFeeRate,
} from '@/lib/sbr/fees'
import type { SbrPrediction, SbrPredictionInput } from '@/lib/sbr/types'
import {
  CREDITOR_LABEL_MAX,
  MAX_CREDITOR_ROWS,
  creditorTotal,
  defaultCreditorRows,
  includedCreditorRows,
  type CreditorHints,
  type CreditorKind,
  type CreditorRow,
  type SavedCreditors,
} from '@/lib/sbr/creditors'

interface InitialAuto {
  cumulativeDaysLate: number | null
  numberOfLateLodgements: number | null
  daysSinceLastPayment: number | null
  /** The ATO account's first and last dates, e.g. "1 Jul 2020 – 1 Oct 2026"; null without rows. */
  icaHistory?: string | null
  directorLoanReceivableAmount: number
  directorLoanDetected: boolean | null
  directorLoanReasoning: string | null
  creditorAmount: number | null
  /** Where the automatic creditor amount comes from, e.g. "ATO account statement, 26 Sep 2026". */
  creditorSource: string
  /** What is missing when there is no automatic amount. */
  creditorMissing: string | null
  latestFinancialYear: number | null
  hasLodgement: boolean
  hasFinancials: boolean
  /** A balance-sheet figure per kind of creditor; shown beside its row, never filled in. */
  creditorHints: CreditorHints
  /** The creditors saved with the last prediction, if any (migration 0032). */
  savedCreditors: SavedCreditors | null
}

interface CachedSummary {
  inputFeatures: Record<string, unknown>
  predictedOutcomePercent: number
  predictedLowPercent: number
  predictedHighPercent: number
  comparableCaseIds: string[]
  trainingSetSize: number
  computedAt: string
  /** The fee chosen for this client when it was saved. */
  practitionerFeeRate: number
  /** The historical cases changed after it was saved (staleness.ts). */
  stale: boolean
}

/** What the prediction is waiting for, and the DPN factor, from readiness.ts. */
interface PredictionReadiness {
  canPredict: boolean
  waitingFor: string[]
  /** Yes if any notice is on file; No only if staff ticked "none issued"; null until known. */
  dpn: boolean | null
  /** Where the DPN answer comes from, in a line. */
  dpnDetail: string
}

interface Props {
  clientId: string
  clientName: string
  initialAuto: InitialAuto
  initialPrediction: CachedSummary | null
  readiness: PredictionReadiness
}

interface FullPrediction extends SbrPrediction {
  inputFeatures: SbrPredictionInput
  /** The creditor total the offer is sized on: ATO debt + other creditors. */
  creditorAmount: number | null
  /** The ATO debt in that total. */
  atoDebt?: number | null
  /** The other creditor rows, as saved. */
  creditors?: CreditorRow[]
  creditorDebt?: { description: string; missing: string | null; source: string | null }
  computedAt: string
  autoDetectedDirectorLoan?: {
    detected: boolean | null
    reasoning: string | null
  }
  /** Past cases left out because they are this client's own record. */
  selfMatchExcluded?: number
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

/** One creditor row as staff type it. `id` keeps React's rows apart as they are added and removed. */
interface CreditorRowInput {
  id: string
  label: string
  amountText: string
  kind?: CreditorKind
}

let nextCreditorRowId = 0
const newCreditorRowId = () => `creditor-${++nextCreditorRowId}`

function parseAmount(text: string): number | null {
  if (text.trim() === '') return null
  const n = Number(text.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

function formatAud(value: number | null | undefined): string {
  if (value == null) return '—'
  return AUD.format(value)
}

/** "$87,912.70": the in-between steps keep their cents so each one reconciles. */
function formatAudCents(value: number): string {
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Up to four decimals, no trailing zeros: 39.371250 -> "39.3713". */
function exactPercent(value: number): string {
  return String(Math.round(value * 10_000) / 10_000)
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString('en-AU')
}

/**
 * A percentage as the fraction the offer was worked out with, to 6 places and
 * no trailing zeros (42.4125% -> "0.424125"), so each calculation step
 * reconciles with the next. The tiles show the % rounded to one place.
 */
export function exactFraction(percent: number): string {
  return String(Number((percent / 100).toFixed(6)))
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step
}

/**
 * The SBR payment as a share of the creditors, and the discount that leaves
 * (Gabby, 21 Oct): 97,500 ÷ 223,129 = 43.70%, so 56.30%. Rounded to two
 * decimals; the discount is taken from the rounded offer so the two add up
 * to 100%.
 */
export function offerPercentages(payment: number | null, totalCreditors: number | null): { offer: number; discount: number } | null {
  if (payment == null || totalCreditors == null || totalCreditors <= 0) return null
  const offer = Math.round((payment / totalCreditors) * 10_000) / 100
  return { offer, discount: Math.round((100 - offer) * 100) / 100 }
}

/**
 * The working behind the three figures on the first tile, with this client's
 * values, for the info icon beside each. Null where a figure is not shown.
 */
export function headlineExplanations(
  prediction: Pick<FullPrediction, 'comparableCases' | 'predictedOutcomePercent' | 'practitionerFeeRate' | 'creditorAmount' | 'atoDebt' | 'creditors'>,
  suggestedRounded: number | null,
): { offer: string | null; discount: string | null; cents: string } {
  const outcomes = prediction.comparableCases.map((c) => c.outcomePercent)
  const sum = outcomes.reduce((t, v) => t + v, 0)
  const mean = outcomes.length ? sum / outcomes.length : 0
  const fee = prediction.practitionerFeeRate
  const cents = [
    `Average of the ${outcomes.length} most similar past cases' outcomes:`,
    `${outcomes.map((o) => o.toFixed(1)).join(' + ')} = ${sum.toFixed(1)}`,
    `${sum.toFixed(1)} ÷ ${outcomes.length} = ${exactPercent(mean)}, shown as ${prediction.predictedOutcomePercent.toFixed(1)}c`,
    '',
    `This is what creditors receive after the ${formatFeeRate(fee)} practitioner fee.`,
  ].join('\n')

  const percentages = offerPercentages(suggestedRounded, prediction.creditorAmount)
  if (!percentages || prediction.creditorAmount == null) return { offer: null, discount: null, cents }

  const atoDebt = prediction.atoDebt === undefined ? prediction.creditorAmount : prediction.atoDebt
  const others = includedCreditorRows(prediction.creditors ?? [])
  const receipt = (mean / 100) * prediction.creditorAmount
  const offer = [
    'SBR offer percentage = SBR payment ÷ total creditors',
    `${formatAud(suggestedRounded)} ÷ ${formatAud(prediction.creditorAmount)} = ${percentages.offer.toFixed(2)}%`,
    '',
    `Total creditors = ATO debt ${formatAud(atoDebt)}${others.map((r) => ` + ${r.label || 'Creditor'} ${formatAud(r.amount)}`).join('')}${others.length ? ` = ${formatAud(prediction.creditorAmount)}` : ''}`,
    '',
    'SBR payment:',
    `To creditors = ${exactPercent(mean)}% × ${formatAud(prediction.creditorAmount)} = ${formatAudCents(receipt)}`,
    `Grossed up for the ${formatFeeRate(fee)} fee: ${formatAudCents(receipt)} ÷ ${(1 - fee).toFixed(3)} = ${formatAudCents(receipt / (1 - fee))}`,
    `Rounded to the nearest $500 = ${formatAud(suggestedRounded)}`,
  ].join('\n')
  const discount = [
    'SBR expected discount = 100% − SBR offer percentage',
    `100% − ${percentages.offer.toFixed(2)}% = ${percentages.discount.toFixed(2)}%`,
    '',
    `The share of the ${formatAud(prediction.creditorAmount)} owed that would be written off.`,
  ].join('\n')
  return { offer, discount, cents }
}

/** An info icon that shows how a figure was worked out, on hover, focus or tap. */
function HowCalculated({ text, label }: { text: string | null; label: string }) {
  if (!text) return null
  return (
    <Tooltip content={text} className="no-print ml-1 inline-flex cursor-help align-middle text-foreground/35 hover:text-foreground/70 focus:text-foreground/70 focus:outline-none">
      <Info className="h-3.5 w-3.5" aria-label={`How the ${label} was calculated`} />
    </Tooltip>
  )
}

/** "with a payment plan offer" / "with an upfront offer": the case set depends on it. */
export function basedOnLine(cases: number, paymentPlanType: 'plan' | 'upfront'): string {
  return `Based on the ${cases} past cases most similar to this client with ${paymentPlanType === 'plan' ? 'a payment plan' : 'an upfront'} offer.`
}

function extractCachedInput(
  cached: CachedSummary | null,
): {
  paymentPlanType: 'plan' | 'upfront'
  directorLoanAtAppointment: boolean
} | null {
  if (!cached) return null
  const f = cached.inputFeatures
  const ppt = f.paymentPlanType
  return {
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
  readiness,
}: Props) {
  const cachedInputs = extractCachedInput(initialPrediction)

  const [auto] = useState<InitialAuto>(initialAuto)
  // Set from what is on file (readiness.ts) when anything is: notices mean
  // Yes, the "none issued" tick means No. With neither, staff tick it here
  // (unticked = No), kept from the last prediction.
  const dpnFromFile = readiness.dpn !== null
  const [dpnManual, setDpnManual] = useState<boolean>(initialPrediction?.inputFeatures.dpn === true)
  const dpn = readiness.dpn ?? dpnManual
  const [notReady, setNotReady] = useState<string[]>(readiness.canPredict ? [] : readiness.waitingFor)
  const [paymentPlanType, setPaymentPlanType] = useState<'plan' | 'upfront'>(
    cachedInputs?.paymentPlanType ?? 'upfront',
  )
  const [directorLoanAtAppointment, setDirectorLoanAtAppointment] = useState(
    // Pre-fill from the cached input if any, else from balance-sheet auto-detection.
    cachedInputs?.directorLoanAtAppointment ?? initialAuto.directorLoanDetected === true,
  )

  // The ATO debt: prefilled from the automatic figure, editable by staff
  // (kept from the last prediction when staff typed it). Only an amount staff
  // changed is sent; otherwise the server works it out afresh.
  const savedAto = initialAuto.savedCreditors?.atoDebtEdited ? initialAuto.savedCreditors.atoDebt : null
  const [creditorText, setCreditorText] = useState(
    savedAto != null
      ? String(Math.round(savedAto))
      : initialAuto.creditorAmount != null
        ? String(Math.round(initialAuto.creditorAmount))
        : '',
  )
  const [creditorEdited, setCreditorEdited] = useState(savedAto != null)
  // The other creditors in the SBR (creditors.ts), from the last prediction or the defaults.
  const [creditorRows, setCreditorRows] = useState<CreditorRowInput[]>(() =>
    (initialAuto.savedCreditors?.rows ?? defaultCreditorRows()).map((r) => ({
      id: newCreditorRowId(),
      label: r.label,
      amountText: r.amount != null ? String(r.amount) : '',
      kind: r.kind,
    })),
  )
  const creditorRowsValid = creditorRows.every((r) => r.amountText.trim() === '' || parseAmount(r.amountText) !== null)
  const creditorOverride = (() => {
    if (!creditorEdited) return undefined
    const n = Number(creditorText.replace(/[$,\s]/g, ''))
    return creditorText.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined
  })()

  // The practitioner fee for this client: saved with its prediction, default
  // 12.5% (fees.ts). Null while a custom entry is not a valid percentage.
  const [feeRate, setFeeRate] = useState<number | null>(
    initialPrediction?.practitionerFeeRate ?? DEFAULT_PRACTITIONER_FEE_RATE,
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
  const canRun =
    lodgementReady && feeRate !== null && creditorRowsValid && readiness.canPredict && notReady.length === 0

  async function runPrediction() {
    setRunning(true)
    setError(null)
    setMissing([])
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/predict-outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentPlanType,
          directorLoanAtAppointment,
          practitionerFeeRate: feeRate ?? DEFAULT_PRACTITIONER_FEE_RATE,
          ...(creditorOverride !== undefined ? { creditorAmount: creditorOverride } : {}),
          // Only when nothing is on file; the server ignores it otherwise.
          ...(dpnFromFile ? {} : { dpn: dpnManual }),
          creditors: creditorRows.map((r) => ({
            label: r.label.trim().slice(0, CREDITOR_LABEL_MAX),
            amount: parseAmount(r.amountText),
            ...(r.kind ? { kind: r.kind } : {}),
          })),
        }),
      })
      const data = await res.json()
      if (res.status === 422 && data.error === 'NOT_READY') {
        setNotReady(data.waitingFor ?? [])
        return
      }
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
  // Not when it is stale: new historical data would silently change the
  // figures, so staff see the saved ones with a banner and re-run themselves.
  const hydrated = useRef(false)
  useEffect(() => {
    if (hydrated.current) return
    if (!initialPrediction || initialPrediction.stale) return
    if (!lodgementReady || !readiness.canPredict) return
    hydrated.current = true
    runPrediction()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div id="print-root" className="space-y-6">
      <div className="space-y-3">
        <Link
          href={`/clients/${clientId}`}
          className="no-print inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors"
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
            <div className="no-print flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMethodologyOpen(true)}
                aria-label="About this prediction"
                title="About this prediction"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground/60 hover:bg-surface/60 hover:text-foreground transition-colors"
              >
                <Info className="h-4 w-4" />
              </button>
              <ExportPdfButton targetId="print-root" fileName={`${clientName}_sbr_outcome_prediction`} />
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

      {initialPrediction?.stale && !prediction && (
        <Card className="border-warning/30 bg-warning/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-medium text-foreground">New historical data added — re-run</p>
                <p className="mt-1 text-xs text-foreground/60">
                  The saved prediction ({initialPrediction.predictedOutcomePercent.toFixed(1)}%, range{' '}
                  {initialPrediction.predictedLowPercent.toFixed(1)}%–
                  {initialPrediction.predictedHighPercent.toFixed(1)}%, from{' '}
                  {initialPrediction.trainingSetSize} cases) was made before the historical cases
                  changed. Re-run it to use the current data.
                </p>
              </div>
            </div>
            <Button size="sm" onClick={runPrediction} loading={running} disabled={!canRun}>
              <RefreshCw className="h-3.5 w-3.5" />
              Re-run
            </Button>
          </div>
        </Card>
      )}

      {missing.length > 0 && <PrereqMissingBlock clientId={clientId} missing={missing} />}

      {notReady.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Not ready for a prediction yet</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-foreground/60">
                {notReady.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Link
                href={`/clients/${clientId}`}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
              >
                Open the readiness checklist
                <ArrowLeft className="h-3 w-3 rotate-180" />
              </Link>
            </div>
          </div>
        </Card>
      )}

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

      {/* Inputs / auto-detected panel is screen-only — excluded from the PDF. */}
      <div className="print:hidden">
        <InputPanel
          auto={auto}
          dpn={dpn}
          dpnDetail={readiness.dpnDetail}
          dpnFromFile={dpnFromFile}
          setDpnManual={setDpnManual}
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
          creditorText={creditorText}
          setCreditorText={setCreditorText}
          creditorEdited={creditorEdited}
          setCreditorEdited={setCreditorEdited}
          creditorRows={creditorRows}
          setCreditorRows={setCreditorRows}
          feeRate={feeRate}
          setFeeRate={setFeeRate}
        />
      </div>

      {prediction && (
        <>
          <HeadlineTiles prediction={prediction} />
          {/* On screen and in the PDF: what the offer is sized against, and from where. */}
          <CreditorsSummaryCard prediction={prediction} />
          {(prediction.selfMatchExcluded ?? 0) > 0 && (
            <p className="-mt-2 text-xs text-foreground/50">
              {prediction.selfMatchExcluded === 1
                ? "1 past case with this client's name was left out"
                : `${prediction.selfMatchExcluded} past cases with this client's name were left out`}
              : a client is never compared with its own record.
            </p>
          )}
          {/* Temporarily hidden (client request): "What the rejections tell us"
              and "How to strengthen this profile". Re-enable by uncommenting. */}
          {/* <RejectionLearningPanel prediction={prediction} /> */}
          {/* <ProfileStrengtheningPanel prediction={prediction} /> */}
          {/* Below the result, in the PDF too. */}
          <FeatureBreakdownPanel prediction={prediction} />
          {/* Print-only: the calculations breakdown that lives behind the
              "Show calculations" modal on screen, rendered inline for the PDF
              between "How we got here" and the nearest cases. */}
          <div className="hidden print:block">
            <Card>
              <CalculationsContent
                prediction={prediction}
                suggestedRounded={
                  prediction.suggestedOfferAmount != null
                    ? roundToNearest(prediction.suggestedOfferAmount, 500)
                    : null
                }
              />
            </Card>
          </div>
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
  dpnDetail: string
  /** True when notices or the "none issued" tick set the answer; false: staff tick it here. */
  dpnFromFile: boolean
  setDpnManual: (v: boolean) => void
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
  creditorText: string
  setCreditorText: (v: string) => void
  creditorEdited: boolean
  setCreditorEdited: (v: boolean) => void
  creditorRows: CreditorRowInput[]
  setCreditorRows: (rows: CreditorRowInput[]) => void
  feeRate: number | null
  setFeeRate: (v: number | null) => void
}

function InputPanel(props: InputPanelProps) {
  const {
    auto,
    dpn,
    dpnDetail,
    dpnFromFile,
    setDpnManual,
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
    creditorText,
    setCreditorText,
    creditorEdited,
    setCreditorEdited,
    creditorRows,
    setCreditorRows,
    feeRate,
    setFeeRate,
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
            Practitioner fee:{' '}
            <span className="text-foreground">{feeRate !== null ? formatFeeRate(feeRate) : '—'}</span>
            <span className="text-foreground/30"> · </span>
            Creditors in the SBR:{' '}
            <span className="text-foreground">
              {formatAud(
                creditorTotal(
                  parseAmount(creditorText),
                  creditorRows.map((r) => ({ label: r.label, amount: parseAmount(r.amountText) })),
                ),
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="no-print text-xs text-accent hover:text-accent/80"
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
                  ? `No payments found in the ATO account${auto.icaHistory ? ` (${auto.icaHistory})` : ''}`
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
          </dl>
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Manual inputs</h3>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="no-print inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
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
            {dpnFromFile ? (
              // Set from the client file: notices uploaded, or "none issued" ticked.
              <div className="rounded-lg border border-border bg-surface/30 px-3 py-2 text-xs text-foreground/80">
                <p>
                  Director Penalty Notice issued:{' '}
                  <span className="font-medium text-foreground">{dpn ? 'Yes' : 'No'}</span>
                </p>
                <p className="mt-0.5 text-foreground/40">{dpnDetail}</p>
              </div>
            ) : (
              <div>
                <CheckboxField label="Director Penalty Notice issued" checked={dpn} onChange={setDpnManual} />
                <p className="mt-1 text-xs text-foreground/40">
                  No notice uploaded and &ldquo;none issued&rdquo; not ticked on the client page: tick this if a
                  notice was issued. Unticked counts as No.
                </p>
              </div>
            )}
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
            <FeeSelector rate={feeRate} onChange={setFeeRate} />
          </div>
        </div>
      </div>

      <CreditorsEditor
        auto={auto}
        creditorText={creditorText}
        setCreditorText={setCreditorText}
        creditorEdited={creditorEdited}
        setCreditorEdited={setCreditorEdited}
        rows={creditorRows}
        setRows={setCreditorRows}
      />

      <div className="no-print mt-5 flex justify-end gap-2">
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

/**
 * "Creditors in the SBR": the ATO debt and six rows staff can relabel and
 * fill in. The offer is sized on their total (creditors.ts). A balance-sheet
 * figure is shown beside a row when there is one; it is never filled in.
 */
function CreditorsEditor({
  auto,
  creditorText,
  setCreditorText,
  creditorEdited,
  setCreditorEdited,
  rows,
  setRows,
}: {
  auto: InitialAuto
  creditorText: string
  setCreditorText: (v: string) => void
  creditorEdited: boolean
  setCreditorEdited: (v: boolean) => void
  rows: CreditorRowInput[]
  setRows: (rows: CreditorRowInput[]) => void
}) {
  const total = creditorTotal(
    parseAmount(creditorText),
    rows.map((r) => ({ label: r.label, amount: parseAmount(r.amountText) })),
  )
  const update = (id: string, change: Partial<CreditorRowInput>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...change } : r)))
  // The row just added gets the focus, ready to be named.
  const [focusId, setFocusId] = useState<string | null>(null)
  const addRow = () => {
    const id = newCreditorRowId()
    setRows([...rows, { id, label: '', amountText: '' }])
    setFocusId(id)
  }
  const removeRow = (id: string) => setRows(rows.filter((r) => r.id !== id))
  const inputClass =
    'h-7 rounded-md border border-border bg-input-bg px-2 text-sm text-foreground focus:border-accent focus:outline-none'
  const grid = 'grid gap-2 sm:grid-cols-[minmax(0,14rem)_9rem_1.75rem_minmax(0,1fr)] sm:items-center'
  const iconButton =
    'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground/60 transition-colors hover:bg-surface/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40'

  return (
    <section className="mt-6 border-t border-border pt-5" aria-labelledby="creditors-heading">
      <h3 id="creditors-heading" className="text-sm font-semibold text-foreground">
        Creditors in the SBR
      </h3>
      <p className="mt-1 mb-3 text-xs text-foreground/40">
        The offer is the recommended % of the total below, grossed up for the practitioner fee. Name each
        creditor as you like, add or remove rows, and leave an amount blank to leave that creditor out.
      </p>
      <div className="space-y-2 text-xs">
        <div className={grid}>
          <label htmlFor="creditor-amount" className="font-medium text-foreground">
            ATO debt
          </label>
          <input
            id="creditor-amount"
            inputMode="decimal"
            value={creditorText}
            placeholder="Enter amount"
            onChange={(event) => {
              setCreditorText(event.target.value)
              setCreditorEdited(true)
            }}
            className={cn(inputClass, 'w-36 font-medium tabular-nums')}
          />
          <span aria-hidden />
          <p className="text-foreground/40">
            {creditorEdited
              ? 'Source: entered by staff'
              : auto.creditorAmount != null
                ? `Source: ${auto.creditorSource}`
                : (auto.creditorMissing ?? 'Enter the ATO debt to get a suggested offer.')}
          </p>
        </div>
        {rows.map((row, i) => {
          const hint = row.kind ? auto.creditorHints[row.kind] : null
          const invalid = row.amountText.trim() !== '' && parseAmount(row.amountText) === null
          return (
            <div key={row.id} className={grid}>
              <input
                aria-label={`Creditor ${i + 1} name`}
                value={row.label}
                maxLength={CREDITOR_LABEL_MAX}
                placeholder="Creditor name"
                autoFocus={row.id === focusId}
                onChange={(event) => update(row.id, { label: event.target.value })}
                className={cn(inputClass, 'w-full')}
              />
              <input
                aria-label={`Creditor ${i + 1} amount`}
                aria-invalid={invalid || undefined}
                inputMode="decimal"
                value={row.amountText}
                placeholder="—"
                onChange={(event) => update(row.id, { amountText: event.target.value })}
                className={cn(inputClass, 'w-36 tabular-nums', invalid && 'border-destructive')}
              />
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                aria-label={`Remove ${row.label.trim() || `creditor ${i + 1}`}`}
                title="Remove this creditor"
                className={iconButton}
              >
                <Minus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <p className="text-foreground/40">
                {invalid ? (
                  <span className="text-destructive">Enter an amount of $0 or more, or leave it blank.</span>
                ) : hint ? (
                  <>
                    Balance sheet shows {formatAud(hint.amount)} ({hint.source})
                    {hint.caution && <span className="text-warning"> · {hint.caution}</span>}
                  </>
                ) : null}
              </p>
            </div>
          )
        })}
        <div>
          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= MAX_CREDITOR_ROWS}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-surface/60 hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add creditor
          </button>
          {rows.length >= MAX_CREDITOR_ROWS && (
            <span className="ml-2 text-foreground/40">Up to {MAX_CREDITOR_ROWS} creditors.</span>
          )}
        </div>
        <div className={cn(grid, 'border-t border-border pt-2')}>
          <span className="font-medium text-foreground">Total creditors</span>
          <span className="font-semibold tabular-nums text-foreground" data-testid="creditor-total">
            {formatAud(total)}
          </span>
        </div>
      </div>
    </section>
  )
}

/** On screen and in the PDF: the creditors the offer was sized on. */
export function CreditorsSummaryCard({ prediction }: { prediction: FullPrediction }) {
  if (prediction.creditorAmount == null) return null
  const others = includedCreditorRows(prediction.creditors ?? [])
  const atoDebt = prediction.atoDebt === undefined ? prediction.creditorAmount : prediction.atoDebt
  return (
    <Card>
      <h3 className="text-sm font-semibold text-foreground">Creditors in the SBR</h3>
      <table className="mt-2 w-full max-w-lg text-xs">
        <tbody>
          <tr className="border-b border-border">
            <td className="py-1 pr-3 text-foreground/70">
              ATO debt
              {prediction.creditorDebt ? (
                <span className="text-foreground/40"> — {prediction.creditorDebt.description}</span>
              ) : null}
            </td>
            <td className="py-1 text-right tabular-nums text-foreground">{formatAud(atoDebt)}</td>
          </tr>
          {others.map((row, i) => (
            <tr key={i} className="border-b border-border">
              <td className="py-1 pr-3 text-foreground/70">{row.label || 'Creditor'}</td>
              <td className="py-1 text-right tabular-nums text-foreground">{formatAud(row.amount)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1 pr-3 font-medium text-foreground">Total</td>
            <td className="py-1 text-right font-semibold tabular-nums text-foreground">
              {formatAud(prediction.creditorAmount)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-foreground/50">
        Practitioner fee {formatFeeRate(prediction.practitionerFeeRate)}.
      </p>
    </Card>
  )
}

/**
 * The SBR practitioner fee for this client: 12.5% (the default), 10%, 7.5%,
 * 5% or a custom percentage. Saved with the prediction; the offer is grossed
 * up for it. A custom entry that is not a valid percentage reports null, and
 * the prediction cannot be run until it is fixed.
 */
function FeeSelector({ rate, onChange }: { rate: number | null; onChange: (v: number | null) => void }) {
  const isPreset = rate !== null && (PRACTITIONER_FEE_OPTIONS as readonly number[]).includes(rate)
  const [custom, setCustom] = useState(!isPreset)
  const [customText, setCustomText] = useState(
    !isPreset && rate !== null ? String(Number((rate * 100).toFixed(2))) : '',
  )
  const maxPercent = MAX_PRACTITIONER_FEE_RATE * 100

  function setCustomPercent(text: string) {
    setCustomText(text)
    const n = Number(text.replace('%', '').trim()) / 100
    onChange(text.trim() !== '' && isValidFeeRate(n) ? n : null)
  }

  return (
    <fieldset className="rounded-lg border border-border bg-surface/30 px-3 py-2">
      <legend className="px-1 text-xs text-foreground/50">SBR practitioner fee</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        {PRACTITIONER_FEE_OPTIONS.map((option) => (
          <label key={option} className="flex items-center gap-2 text-xs text-foreground/80">
            <input
              type="radio"
              name="practitionerFee"
              checked={!custom && rate === option}
              onChange={() => {
                setCustom(false)
                onChange(option)
              }}
              className="accent-accent"
            />
            {formatFeeRate(option)}
            {option === DEFAULT_PRACTITIONER_FEE_RATE && <span className="text-foreground/40">(default)</span>}
          </label>
        ))}
        <label className="flex items-center gap-2 text-xs text-foreground/80">
          <input
            type="radio"
            name="practitionerFee"
            checked={custom}
            onChange={() => {
              setCustom(true)
              setCustomPercent(customText)
            }}
            className="accent-accent"
          />
          Custom
        </label>
        {custom && (
          <span className="flex items-center gap-1 text-xs">
            <input
              aria-label="Custom practitioner fee, percent"
              inputMode="decimal"
              value={customText}
              onChange={(event) => setCustomPercent(event.target.value)}
              placeholder="e.g. 8"
              className="h-7 w-16 rounded-md border border-border bg-input-bg px-2 text-sm tabular-nums text-foreground focus:border-accent focus:outline-none"
            />
            %
          </span>
        )}
      </div>
      {custom && rate === null && (
        <p className="mt-1 text-[11px] text-warning">Enter a fee from 0% to below {maxPercent}%.</p>
      )}
    </fieldset>
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
                  Yes when any director penalty notice is uploaded, No when staff have
                  ticked &ldquo;No director penalty notice has been issued&rdquo; on the
                  client page. With neither, tick it here if a notice was issued;
                  unticked counts as No. Uploading the notices is optional.
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
  const percentages = offerPercentages(suggestedRounded, prediction.creditorAmount)
  const explain = headlineExplanations(prediction, suggestedRounded)

  return (
    <Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. The SBR payment as a share of the creditors, and the discount;
            the cents in the dollar creditors receive under them. */}
        <div className="rounded-lg border border-border bg-surface/50 p-4 text-center">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-3xl font-bold tabular-nums text-foreground" data-testid="offer-percent">
                {percentages ? `${percentages.offer.toFixed(2)}%` : '—'}
              </p>
              <p className="mt-1 text-xs text-foreground/60">
                SBR offer percentage
                <HowCalculated text={explain.offer} label="SBR offer percentage" />
              </p>
            </div>
            <div>
              <p className="text-3xl font-bold tabular-nums text-foreground" data-testid="expected-discount">
                {percentages ? `${percentages.discount.toFixed(2)}%` : '—'}
              </p>
              <p className="mt-1 text-xs text-foreground/60">
                SBR expected discount
                <HowCalculated text={explain.discount} label="SBR expected discount" />
              </p>
            </div>
          </div>
          <div className="mt-3 border-t border-border/60 pt-2">
            <p className="text-lg font-semibold tabular-nums text-foreground">
              {prediction.predictedOutcomePercent.toFixed(1)}c
            </p>
            <p className="text-xs text-foreground/60">
              Creditors receive (cents in the dollar)
              <HowCalculated text={explain.cents} label="cents in the dollar" />
            </p>
            <p className="mt-1 text-[11px] text-foreground/45">
              Offer % = creditors&apos; share ÷ (1 − practitioner fee)
            </p>
          </div>
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
                {prediction.creditorDebt?.missing ?? 'Enter the ATO debt above to get a suggested offer.'}
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

        {/* 3. Risk band — traffic-light label only, never a probability. Says
            it in plain words: at this amount it is X, and what to change to
            get it accepted. */}
        <div className={cn('rounded-lg border p-4 text-center', band.tile)}>
          {suggestedRounded != null && (
            <p className="text-xs text-foreground/60">
              At <span className="font-semibold text-foreground">{formatAud(suggestedRounded)}</span>{' '}
              this offer is
            </p>
          )}
          <p className={cn('text-lg font-bold', suggestedRounded != null && 'mt-0.5', band.text)}>
            {band.emoji} {band.label}
          </p>

          {prediction.creditorAmount == null ? (
            <p className="mt-2 text-xs text-warning">
              Enter the ATO debt above to see the amount needed to get it accepted.
            </p>
          ) : !isRisky ? (
            <p className="mt-2 rounded-md bg-success/10 px-2 py-1.5 text-xs font-medium text-success">
              No change needed — similar deals at this level were accepted.
            </p>
          ) : showRaise ? (
            <div className="mt-2 rounded-md border border-success/30 bg-success/10 px-2 py-1.5">
              <p className="text-[11px] text-foreground/70">To get it accepted, offer</p>
              <p className="text-xl font-bold tabular-nums text-success">
                {formatAud(targetRounded)}
              </p>
              <p className="text-[11px] text-foreground/60">
                {formatAud(Math.max(0, (targetRounded ?? 0) - (suggestedRounded ?? 0)))} more than
                now
              </p>
            </div>
          ) : showAlreadyStrong ? (
            <p className="mt-2 rounded-md bg-surface/60 px-2 py-1.5 text-xs text-foreground/80">
              The amount is already high enough — offering more won&rsquo;t help. Pay sooner or
              upfront instead to improve the odds.
            </p>
          ) : null}

          <p className="mt-2 text-[11px] text-foreground/50">{prediction.riskBandReasoning}</p>
          <p className="mt-2 text-xs text-foreground/40">Risk band (indicative)</p>
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
      <p className="mt-4 text-sm text-foreground/75" data-testid="based-on">
        {basedOnLine(prediction.comparableCases.length, prediction.inputFeatures.paymentPlanType)}
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-foreground/40">
          {prediction.comparableCases.length} most similar of {prediction.trainingSetSize} historical cases; the
          payment type is one of the 7 factors, so a plan and an upfront offer are compared with different cases.
          {prediction.accuracyDisclosure.meanAbsoluteError != null &&
            ` Typical accuracy: ±${prediction.accuracyDisclosure.meanAbsoluteError} percentage points.`}
        </p>
        <button
          type="button"
          onClick={() => setCalcOpen(true)}
          className="no-print inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80"
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

        <CalculationsContent prediction={prediction} suggestedRounded={suggestedRounded} />

        <div className="mt-6 flex justify-end">
          <Button variant="primary" size="sm" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Each creditor in the SBR, step by step, adding up to the total the offer is sized on. */
function CreditorTotalSteps({ prediction }: { prediction: FullPrediction }) {
  const others = includedCreditorRows(prediction.creditors ?? [])
  const atoDebt = prediction.atoDebt === undefined ? prediction.creditorAmount : prediction.atoDebt
  return (
    <div className="mb-2 border-b border-border/60 pb-2">
      <div>
        ATO debt = <span className="text-foreground">{formatAud(atoDebt)}</span>
        {prediction.creditorDebt ? ` (${prediction.creditorDebt.description})` : ''}
      </div>
      {others.map((row, i) => (
        <div key={i}>
          + {row.label || 'Creditor'} = <span className="text-foreground">{formatAud(row.amount)}</span>
        </div>
      ))}
      <div className="mt-1">
        Total creditors ={' '}
        {others.length > 0
          ? `${[atoDebt, ...others.map((r) => r.amount)].map((v) => formatAud(v)).join(' + ')} = `
          : ''}
        <span className="font-semibold text-foreground">{formatAud(prediction.creditorAmount)}</span>
      </div>
    </div>
  )
}

function CalculationsContent({
  prediction,
  suggestedRounded,
}: {
  prediction: FullPrediction
  suggestedRounded: number | null
}) {
  const outcomes = prediction.comparableCases.map((c) => c.outcomePercent)
  const sum = outcomes.reduce((s, v) => s + v, 0)
  const mean = sum / outcomes.length
  const sbrPractitionerFeeRate = prediction.practitionerFeeRate
  const k = prediction.comparableCases.length
  const rejectedCount = prediction.rejectedNeighbours.length
  const acceptedCount = k - rejectedCount
  const band = RISK_BAND_META[prediction.riskBand]
  const split = prediction.paymentStructureRecommendation.neighbourSplit
  const aligned = prediction.acceptedAlignedOffer
  const targetRounded =
    aligned.targetAmount != null ? roundToNearest(aligned.targetAmount, 500) : null
  // The offer is worked out from the unrounded average, so the steps use it too.
  const receipt = prediction.creditorAmount != null ? (mean / 100) * prediction.creditorAmount : 0
  const percentages = offerPercentages(suggestedRounded, prediction.creditorAmount)

  return (
    <>
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

        {/* 1. Creditors receive (cents in the dollar) */}
        <section className="mb-5">
          <h3 className="mb-1 text-sm font-semibold text-foreground">
            1. Creditors receive ({prediction.predictedOutcomePercent.toFixed(1)}c in the dollar)
          </h3>
          <p className="mb-2 text-xs italic text-foreground/45">
            What it is: the cents in the dollar the creditors in the SBR receive, after the practitioner fee.
            The SBR offer percentage is this ÷ (1 − practitioner fee).
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
            What it is: the current dollar offer (the recommended % of this client&apos;s creditors in
            the SBR, grossed up for the SBR practitioner fee) — and the amount needed to match similar
            deals that were accepted.
          </p>
          <p className="mb-2 text-xs font-medium text-foreground/80">2a. Current SBR amount</p>
          {prediction.creditorAmount != null && prediction.suggestedOfferAmount != null ? (
            <>
              <p className="mb-2 text-xs text-foreground/65">
                Formula:{' '}
                <code className="text-foreground/90">
                  (predicted_outcome% × total_creditors) ÷ (1 − SBR_practitioner_fee)
                </code>
              </p>
              <div className="rounded-lg border border-border bg-surface/40 p-3 text-xs text-foreground/70 space-y-1">
                <CreditorTotalSteps prediction={prediction} />
                <div>
                  Step 1. Creditors&apos; share (average of the {k} cases, unrounded) ={' '}
                  <span className="text-foreground">{exactPercent(mean)}%</span>
                  <span className="text-foreground/40"> (shown as {prediction.predictedOutcomePercent.toFixed(1)}c in the dollar)</span>
                </div>
                <div>
                  Step 2. To creditors = {exactPercent(mean)}% × {formatAud(prediction.creditorAmount)} ={' '}
                  <span className="text-foreground">{formatAudCents(receipt)}</span>
                </div>
                <div>
                  Step 3. Practitioner fee = {formatFeeRate(sbrPractitionerFeeRate)}
                  {sbrPractitionerFeeRate !== DEFAULT_PRACTITIONER_FEE_RATE && (
                    <span className="text-warning"> (chosen for this client; the default is {formatFeeRate(DEFAULT_PRACTITIONER_FEE_RATE)})</span>
                  )}
                  , so creditors receive 1 − {formatFeeRate(sbrPractitionerFeeRate)} ={' '}
                  <span className="text-foreground">{(1 - sbrPractitionerFeeRate).toFixed(3)}</span> of the payment
                </div>
                <div>
                  Step 4. SBR payment = {formatAudCents(receipt)} ÷ {(1 - sbrPractitionerFeeRate).toFixed(3)} ={' '}
                  <span className="text-foreground font-semibold">{formatAud(prediction.suggestedOfferAmount)}</span>
                </div>
                <div>
                  Step 5. Rounded to the nearest $500 ={' '}
                  <span className="text-foreground font-semibold">
                    {suggestedRounded != null ? formatAud(suggestedRounded) : '—'}
                  </span>
                </div>
                {percentages && (
                  <>
                    <div className="mt-2 border-t border-border/60 pt-2">
                      SBR offer percentage = {formatAud(suggestedRounded)} ÷ {formatAud(prediction.creditorAmount)} ={' '}
                      <span className="text-foreground font-semibold">{percentages.offer.toFixed(2)}%</span>
                    </div>
                    <div>
                      SBR expected discount = 100% − {percentages.offer.toFixed(2)}% ={' '}
                      <span className="text-foreground font-semibold">{percentages.discount.toFixed(2)}%</span>
                    </div>
                  </>
                )}
                {sbrPractitionerFeeRate !== DEFAULT_PRACTITIONER_FEE_RATE && (
                  <div className="text-foreground/45">
                    At the default {formatFeeRate(DEFAULT_PRACTITIONER_FEE_RATE)} fee it would be {formatAudCents(receipt)} ÷{' '}
                    {(1 - DEFAULT_PRACTITIONER_FEE_RATE).toFixed(3)} ={' '}
                    {formatAud(Math.round(receipt / (1 - DEFAULT_PRACTITIONER_FEE_RATE)))}.
                  </div>
                )}
              </div>
              <p className="mt-2 text-xs text-foreground/45">
                The SBR practitioner fee comes off the gross offer before creditors are paid, so the
                offer is back-calculated by dividing the creditor receipt by{' '}
                {(1 - sbrPractitionerFeeRate).toFixed(3)}.
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
                      (highest_accepted_offer% × total_creditors) ÷ (1 − SBR_practitioner_fee)
                    </code>
                  </p>
                  <div className="rounded-lg border border-border bg-surface/40 p-3 text-xs text-foreground/70 space-y-1">
                    <div>
                      Highest offer a similar case was accepted at ={' '}
                      <span className="text-foreground">{aligned.targetPercent.toFixed(1)}%</span>
                    </div>
                    <div>
                      Creditor receipt = {exactFraction(aligned.targetPercent)} ×{' '}
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
              Not calculable yet —{' '}
              {prediction.creditorDebt?.missing ?? 'enter the ATO debt above to get a suggested offer.'}
            </p>
          )}
        </section>

        {/* 3. Risk band */}
        <section className="mb-5">
          <h3 className="mb-1 text-sm font-semibold text-foreground">
            3. Risk band ({band.emoji} {band.label}, indicative)
          </h3>
          <p className="mb-2 text-xs italic text-foreground/45">
            What it is: a traffic-light read on how risky this profile looks — based purely on how
            many similar past deals were rejected. It is indicative, not a probability.
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
              Bands: <span className="text-foreground">{prediction.riskBandRule}</span>
              <span className="text-foreground/45">
                {' '}
                (set from how often similar past cases were actually rejected, over{' '}
                {prediction.accuracyDisclosure.sampleSize} cases — see Prediction data)
              </span>
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
    </>
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

/**
 * Closed by default (Gabby, 21 Oct), on screen and in the PDF: the PDF is
 * taken from the page as it is, so it shows the cases only when opened.
 */
function ComparableCasesPanel({ prediction }: { prediction: FullPrediction }) {
  const [open, setOpen] = useState(false)
  const count = prediction.comparableCases.length
  return (
    <Card>
      <h3 className="text-sm font-semibold text-foreground">Closest historical cases</h3>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
        {open ? `Hide the ${count} similar past cases` : `Show the ${count} similar past cases`}
      </button>
      {open && (
        <>
          <p className="mt-2 mb-4 text-xs text-foreground/50">
            The {count} closest historical cases, sorted by similarity.
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
        </>
      )}
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
              {prediction.trainingSetSize} historical MCR cases ({prediction.trainingSetAccepted}{' '}
              accepted, {prediction.trainingSetRejected} rejected). The recommended offer is the
              average outcome of the {prediction.comparableCases.length} most similar past cases.
              {prediction.daysSinceLastPaymentCap != null &&
                ` When measuring similarity, "no payments ever" counts as ${prediction.daysSinceLastPaymentCap.toLocaleString('en-AU')} days, the longest real gap in the data.`}
            </p>
          </div>
          <div>
            <p className="text-foreground/90 font-medium mb-1">About the risk band</p>
            <p>
              The risk band is an indicative signal based on how many of the{' '}
              {prediction.comparableCases.length} closest past cases were rejected (
              {prediction.riskBandRule}). It is NOT a calibrated probability. In the historical
              data, rejected cases were not systematically offered less than accepted ones, so
              offering more does not automatically reduce rejection risk.
            </p>
          </div>
          <div>
            <p className="text-foreground/90 font-medium mb-1">Accuracy</p>
            <ul className="list-disc space-y-1 pl-5">
              {prediction.accuracyDisclosure.meanAbsoluteError != null && (
                <li>
                  Predictions are typically within ±{prediction.accuracyDisclosure.meanAbsoluteError}{' '}
                  percentage points of the actual outcome (each of{' '}
                  {prediction.accuracyDisclosure.sampleSize} past cases predicted from the others).
                </li>
              )}
              {prediction.accuracyDisclosure.intervalCoverage != null && (
                <li>
                  {prediction.accuracyDisclosure.intervalCoverage} of historical outcomes fell inside
                  the predicted range.
                </li>
              )}
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
    push('SBR practitioner fee', formatFeeRate(prediction.practitionerFeeRate))
    push('')

    push('SUMMARY')
    const percentages = offerPercentages(
      prediction.suggestedOfferAmount != null ? roundToNearest(prediction.suggestedOfferAmount, 500) : null,
      prediction.creditorAmount,
    )
    push('SBR offer percentage', percentages ? percentages.offer.toFixed(2) : '')
    push('SBR expected discount', percentages ? percentages.discount.toFixed(2) : '')
    push('Creditors receive (cents in the dollar)', prediction.predictedOutcomePercent)
    push('Range low %', prediction.predictedLowPercent)
    push('Range high %', prediction.predictedHighPercent)
    push('Neighbour stdev (pp)', prediction.neighbourStdev)
    push(
      'Suggested SBR offer',
      prediction.suggestedOfferAmount != null
        ? roundToNearest(prediction.suggestedOfferAmount, 500)
        : '',
    )
    push('ATO debt', prediction.atoDebt === undefined ? (prediction.creditorAmount ?? '') : (prediction.atoDebt ?? ''))
    push('ATO debt source', prediction.creditorDebt?.description ?? '')
    push('Total creditors in the SBR', prediction.creditorAmount ?? '')
    push('Risk Band', riskBandExportLabel(prediction.riskBand))
    push('Risk Band Reasoning', prediction.riskBandReasoning)
    push(
      'Payment Structure Recommendation',
      `${paymentStructureLabel(prediction.paymentStructureRecommendation.recommended)} — ${prediction.paymentStructureRecommendation.reasoning}`,
    )
    push('')

    push('CREDITORS IN THE SBR')
    push('Creditor', 'Amount')
    push('ATO debt', prediction.atoDebt === undefined ? (prediction.creditorAmount ?? '') : (prediction.atoDebt ?? ''))
    for (const row of includedCreditorRows(prediction.creditors ?? [])) push(row.label || 'Creditor', row.amount)
    push('Total', prediction.creditorAmount ?? '')
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
      `We compare the client's profile across 7 factors (late lodgement history, payment behaviour, DPN status, director loan, and payment-plan type) against ${prediction.trainingSetSize} historical MCR cases (${prediction.trainingSetAccepted} accepted, ${prediction.trainingSetRejected} rejected). The recommended offer is the average outcome of the ${prediction.comparableCases.length} most similar past cases.`,
    )
    push(
      'About the risk band',
      `The risk band is an indicative signal based on how many of the ${prediction.comparableCases.length} closest past cases were rejected (${prediction.riskBandRule}). It is NOT a calibrated probability. In the historical data, rejected cases were not systematically offered less than accepted ones, so offering more does not automatically reduce rejection risk.`,
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
