/**
 * Server-only. Extracts canonical financial data from a single annual
 * financial statement PDF using Gemini 2.5 Flash (via OpenRouter) with
 * native PDF input + forced tool calling.
 *
 * Why tool use instead of asking for JSON in the response text:
 *   - The API enforces JSON parsing on our behalf — invalid JSON is impossible.
 *   - The schema is declarative, so the model self-corrects shape issues.
 *   - No comment-stripping, no fence-stripping, no manual JSON.parse failures.
 *
 * A single PDF may carry 1 OR 2 financial years (the comparative column
 * present in most Xero exports). The function returns ONE entry per column
 * detected — so 0, 1, or 2 ExtractedFinancialStatement values.
 *
 * The caller runs the text pre-pass (prepass.ts) first and passes it in. It
 * decides which pages are sent (pageSelection.ts), what the prompt states as
 * fact about the document (extractionContext.ts), and the cross-checks on what
 * comes back (columnChecks.ts): which halves each column really carries, and
 * the year the headings name.
 *
 * Throws when:
 *   - the model returns no tool call (shouldn't happen with forced tool_choice)
 *   - the tool arguments aren't valid JSON
 *   - no financial year can be determined for a returned column
 *   - no column carries any real statement data
 *
 * Does NOT throw (warns instead) when:
 *   - individual line items can't be mapped (they go in `other`)
 *   - published totals don't reconcile to the sum of line items within $50
 *   - one column is empty, or carries a statement the document does not have
 *
 * Must only be imported from API routes — never from a component.
 */
import { OPENROUTER_EXTRACTION_MODEL, FINANCIALS_EXTRACTION_PROMPT } from '../ai/prompts'
import { correctYear, decidePresence } from './columnChecks'
import { buildExtractionContext } from './extractionContext'
import { correctColumn, fixSwappedTotals, isIncomeStatementSection } from './lineCorrections'
import { bytesForSelection, selectPages, type PageSelection } from './pageSelection'
import type { FinancialsPrepass } from './prepass'
import { resolveDocumentYears, type ResolvedYears } from './resolveYear'
import type {
  ExtractedFinancialStatement,
  ExtractionWarning,
  FinancialDocumentKind,
  FinancialStatementSourceColumn,
  LineSection,
  StatementLine,
} from './types'

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

const RECONCILIATION_TOLERANCE_AUD = 50
// Current-period (partial-year software exports) tend to have small rounding
// lines, suspense accounts, and Wages-Payable-Payroll style negatives that
// open up minor reconciliation gaps. Loosen the balance-sheet tolerance
// without touching the annual-statement check.
const CURRENT_PERIOD_BALANCE_TOLERANCE_AUD = 200

const EXTRACTION_TOOL_NAME = 'submit_extracted_financials'

// Retry policy for the OpenRouter call. Gemini's PDF parse occasionally trips a
// 504 gateway timeout (especially on full-size encrypted PDFs); these are
// transient, so we re-issue the idempotent request. Kept small so a sustained
// outage can't blow the route's 800s maxDuration across sequential documents.
const MAX_OPENROUTER_ATTEMPTS = 3
const PER_ATTEMPT_TIMEOUT_MS = 90_000

/** Transient = worth retrying: any 5xx status/code, plus the upstream
 *  "operation was aborted" / timeout messages OpenRouter reports as a 504. */
function isTransientOpenRouterError(
  status: number | string | undefined,
  message: string,
): boolean {
  const code = typeof status === 'number' ? status : parseInt(String(status ?? ''), 10)
  if (!Number.isNaN(code) && code >= 500 && code < 600) return true
  const m = message.toLowerCase()
  return m.includes('abort') || m.includes('timeout') || m.includes('timed out')
}

/** Short backoff between OpenRouter attempts: ~2s, then ~5s. */
function backoffDelay(attempt: number): Promise<void> {
  const ms = attempt === 1 ? 2000 : 5000
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface ExtractFromPdfInput {
  pdfBytes: Uint8Array
  sourceFilename: string
  /** From runFinancialsPrepass on the same bytes. */
  prepass: FinancialsPrepass
  /** The client file says the entity is a trust. A trust pays no tax itself. */
  entityIsTrust?: boolean
}

export interface ExtractFromPdfResult {
  statements: ExtractedFinancialStatement[]
  rawResponse: unknown
  model: string
  selection: PageSelection
  years: ResolvedYears
  /** About the document as a whole: a filename that disagrees with the headings, etc. */
  documentWarnings: ExtractionWarning[]
}

export async function extractFinancialStatementFromPdf(
  input: ExtractFromPdfInput,
): Promise<ExtractFromPdfResult> {
  const { pdfBytes, sourceFilename, prepass } = input
  const { classification } = prepass
  // A trust: from the client file, or a heading like "<CO> PTY LTD ATF <NAME> TRUST".
  const isTrust =
    input.entityIsTrust === true ||
    /\b(atf|a\.t\.f\.?|as trustee for)\b/i.test(classification.entity?.name ?? '')

  // Which pages go: only the statements when the file can be cut, the whole
  // file with the statement pages named when it is encrypted.
  const selection = selectPages({
    encrypted: prepass.encrypted,
    pageCount: prepass.pageCount,
    classification,
  })
  const sentBytes = await bytesForSelection(pdfBytes, selection)

  // Headings decide the year; the filename is only the fallback.
  const years = resolveDocumentYears(classification, sourceFilename)
  const documentWarnings: ExtractionWarning[] = []
  if (years.conflict) {
    documentWarnings.push({
      kind: 'filename_year_conflict',
      message: `The filename suggests FY${years.conflict.filenameYear}, but the statement headings name FY${years.conflict.headingYears.join(', FY')}. The headings were used.`,
    })
  }
  if (
    classification.hasTextLayer &&
    (selection.mode === 'first_pages_fallback' || selection.mode === 'whole_file')
  ) {
    documentWarnings.push({
      kind: 'page_selection',
      message:
        'No Income Statement or Balance Sheet heading was recognised in the text, so the statement pages could not be singled out.',
    })
  }

  const yearLog =
    [...years.annualYears, ...(years.currentPeriodYear ? [`cp${years.currentPeriodYear}`] : [])].join('/') ||
    'none'
  console.log(
    `[extractFinancialStatementFromPdf] ${sourceFilename}: kind=${classification.kind} encrypted=${prepass.encrypted} selection=${selection.mode} pages=[${selection.sentPages.join(',')}] of ${prepass.pageCount}; ${Math.round(pdfBytes.length / 1024)}KB -> ${Math.round(sentBytes.length / 1024)}KB; years=${years.source}:${yearLog}`,
  )
  const base64Pdf = Buffer.from(sentBytes).toString('base64')

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.')

  // Direct fetch instead of the openai SDK. The openai SDK's typed request
  // shape strips fields it doesn't recognise on serialisation (notably
  // OpenRouter's `plugins` and `provider` extensions, which are what turn on
  // native PDF pass-through for Gemini). Bypassing the SDK guarantees the
  // wire body matches OpenRouter's documented shape exactly. See
  // https://openrouter.ai/docs/features/multimodal/pdfs
  const requestBody = {
    model: OPENROUTER_EXTRACTION_MODEL,
    // Room for the full line list on top of the canonical figures.
    max_tokens: 32000,
    tools: [buildExtractionTool()],
    // Force the single extraction tool — equivalent to Anthropic's
    // tool_choice: { type: 'tool', name: EXTRACTION_TOOL_NAME }.
    tool_choice: {
      type: 'function',
      function: { name: EXTRACTION_TOOL_NAME },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              FINANCIALS_EXTRACTION_PROMPT +
              buildExtractionContext({ sourceFilename, classification, years, selection }),
          },
          // OpenRouter PDF input via the `file` content type. The data: URL
          // embeds the base64-encoded PDF. The plugins array (below) tells
          // OpenRouter to forward this file natively to Gemini rather than
          // running its own intermediate parser.
          {
            type: 'file',
            file: {
              filename: sourceFilename,
              file_data: `data:application/pdf;base64,${base64Pdf}`,
            },
          },
        ],
      },
    ],
    // OpenRouter extension — tells the file-parser plugin to forward the PDF
    // unchanged to the underlying model (Gemini supports native PDF input).
    // Without this, OpenRouter defaults to its own OCR layer for some models.
    // We always want native pass-through for Gemini 2.5 Flash.
    plugins: [
      {
        id: 'file-parser',
        pdf: { engine: 'native' },
      },
    ],
    // OpenRouter extension — pin to Google's own infrastructure for Gemini
    // requests, no fallback to other providers if Google is unavailable.
    // Keeps the data path predictable for client compliance.
    provider: {
      order: ['google-ai-studio', 'google-vertex'],
      allow_fallbacks: false,
    },
  }

  // Gemini-via-OpenRouter intermittently returns a 504 ("operation was
  // aborted") when Google's PDF parse runs long — especially on full-size
  // encrypted/signed PDFs we can't trim. These are transient, so retry the
  // (idempotent) request a few times with short backoff before giving up.
  // The provider pin stays Google-only (compliance), so we never fall back to
  // a non-Google provider — we just re-issue the same request.
  const referer =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.PUBLIC_APP_URL ?? 'https://mcr-partners.local'

  let response: OpenRouterChatResponse | null = null
  let callElapsed = '0.0'
  let lastError = ''

  for (let attempt = 1; attempt <= MAX_OPENROUTER_ATTEMPTS; attempt++) {
    const callStart = Date.now()
    console.log(
      `[extractFinancialStatementFromPdf] ${sourceFilename}: calling OpenRouter (Gemini 2.5 Flash), attempt ${attempt}/${MAX_OPENROUTER_ATTEMPTS}`,
    )

    // Per-attempt timeout. A single hung upstream shouldn't consume the whole
    // function budget — abort and retry instead.
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS)

    let httpResponse: Response
    try {
      httpResponse = await fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer,
          'X-Title': 'MCR Partners SBR Portal',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
    } catch (err) {
      // AbortError (our per-attempt timeout) or a network blip — both transient.
      const msg = err instanceof Error ? err.message : String(err)
      lastError = msg
      console.error(
        `[extractFinancialStatementFromPdf] ${sourceFilename}: attempt ${attempt}/${MAX_OPENROUTER_ATTEMPTS} request error after ${((Date.now() - callStart) / 1000).toFixed(1)}s: ${msg}`,
      )
      if (attempt < MAX_OPENROUTER_ATTEMPTS) {
        await backoffDelay(attempt)
        continue
      }
      throw new Error(
        `extractFinancialStatementFromPdf: OpenRouter request failed for ${sourceFilename} after ${MAX_OPENROUTER_ATTEMPTS} attempts: ${msg}`,
      )
    } finally {
      clearTimeout(timeoutHandle)
    }

    callElapsed = ((Date.now() - callStart) / 1000).toFixed(1)

    if (!httpResponse.ok) {
      const errorText = await httpResponse.text().catch(() => '')
      if (isTransientOpenRouterError(httpResponse.status, errorText) && attempt < MAX_OPENROUTER_ATTEMPTS) {
        lastError = `HTTP ${httpResponse.status}: ${errorText.slice(0, 200)}`
        console.error(
          `[extractFinancialStatementFromPdf] ${sourceFilename}: attempt ${attempt}/${MAX_OPENROUTER_ATTEMPTS} transient HTTP ${httpResponse.status} after ${callElapsed}s — retrying`,
        )
        await backoffDelay(attempt)
        continue
      }
      throw new Error(
        `extractFinancialStatementFromPdf: OpenRouter HTTP ${httpResponse.status} for ${sourceFilename}: ${errorText.slice(0, 500)}`,
      )
    }

    const candidate = (await httpResponse.json()) as OpenRouterChatResponse

    // OpenRouter often returns provider failures as a 200 with an `error`
    // object (top-level or per-choice) and no usable completion. Inspect it so
    // the logs show the real cause instead of "model did not call the tool",
    // and retry it when it's a transient gateway/timeout error.
    const orError = candidate.error ?? candidate.choices?.[0]?.error
    if (orError) {
      const detail =
        typeof orError.message === 'string' ? orError.message : JSON.stringify(orError)
      if (isTransientOpenRouterError(orError.code, detail) && attempt < MAX_OPENROUTER_ATTEMPTS) {
        lastError = `code=${orError.code ?? 'n/a'}: ${detail}`
        console.error(
          `[extractFinancialStatementFromPdf] ${sourceFilename}: attempt ${attempt}/${MAX_OPENROUTER_ATTEMPTS} transient OpenRouter error (code=${orError.code ?? 'n/a'}) after ${callElapsed}s: ${detail} — retrying`,
        )
        await backoffDelay(attempt)
        continue
      }
      console.error(
        `[extractFinancialStatementFromPdf] ${sourceFilename}: OpenRouter returned an error (code=${orError.code ?? 'n/a'}): ${detail}`,
      )
      throw new Error(
        `extractFinancialStatementFromPdf: OpenRouter error for ${sourceFilename}: ${detail}`,
      )
    }

    response = candidate
    break
  }

  if (!response) {
    throw new Error(
      `extractFinancialStatementFromPdf: OpenRouter did not return a usable response for ${sourceFilename} after ${MAX_OPENROUTER_ATTEMPTS} attempts${
        lastError ? ` (last error: ${lastError})` : ''
      }.`,
    )
  }

  const choice = response.choices?.[0]
  const finishReason = choice?.finish_reason ?? 'unknown'
  const toolCalls = choice?.message?.tool_calls ?? []
  const modelUsed = response.model ?? OPENROUTER_EXTRACTION_MODEL
  console.log(
    `[extractFinancialStatementFromPdf] ${sourceFilename}: OpenRouter responded in ${callElapsed}s, model=${modelUsed}, finish_reason=${finishReason}, tool_calls=${toolCalls.length}`,
  )

  // Truncation guard. OpenAI-shape finish_reason is "length" when the model
  // hit max_tokens. Mirrors the previous Anthropic max_tokens guard.
  if (finishReason === 'length') {
    console.error(
      `[extractFinancialStatementFromPdf] ${sourceFilename}: response truncated at max_tokens.`,
    )
    throw new Error(
      `extractFinancialStatementFromPdf: response truncated at max_tokens for ${sourceFilename}.`,
    )
  }

  const toolCall = toolCalls.find(
    (tc) => tc.type === 'function' && tc.function?.name === EXTRACTION_TOOL_NAME,
  )
  if (!toolCall || !toolCall.function) {
    const textHint =
      typeof choice?.message?.content === 'string' ? choice.message.content.slice(0, 300) : ''
    // Dump the raw response (truncated) so we can see what the provider actually
    // returned — an empty choice usually means the PDF wasn't ingested (native
    // passthrough failed) or the provider silently dropped the forced tool call.
    const rawDump = JSON.stringify(response).slice(0, 2000)
    console.error(
      `[extractFinancialStatementFromPdf] ${sourceFilename}: model did not call the extraction tool. ` +
        `finish_reason=${finishReason}, native_finish_reason=${choice?.native_finish_reason ?? 'n/a'}, ` +
        `model_text="${textHint}". Raw response (first 2000 chars): ${rawDump}`,
    )
    throw new Error(
      `extractFinancialStatementFromPdf: model did not call the extraction tool for ${sourceFilename}.${
        textHint ? ` Model said: ${textHint}` : ''
      }`,
    )
  }

  // OpenAI-shape tool calls return arguments as a JSON string (unlike
  // Anthropic's already-parsed `input` object). Parse defensively.
  let parsed: RawToolInput
  try {
    parsed = JSON.parse(toolCall.function.arguments) as RawToolInput
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `[extractFinancialStatementFromPdf] ${sourceFilename}: failed to parse tool arguments as JSON: ${msg}. Raw arguments (first 500 chars): ${toolCall.function.arguments.slice(0, 500)}`,
    )
    throw new Error(
      `extractFinancialStatementFromPdf: malformed JSON in tool arguments for ${sourceFilename}: ${msg}`,
    )
  }

  if (!Array.isArray(parsed.statements) || parsed.statements.length === 0) {
    throw new Error(
      `extractFinancialStatementFromPdf: tool input had no statements array for ${sourceFilename}.`,
    )
  }

  const statements: ExtractedFinancialStatement[] = []
  for (const raw of parsed.statements) {
    const statement = normaliseAndValidate(raw, {
      sourceFilename,
      model: modelUsed,
      kind: classification.kind,
      years,
      isTrust,
    })
    if (statement) statements.push(statement)
    else {
      documentWarnings.push({
        kind: 'presence_mismatch',
        message: `A ${raw.sourceColumn ?? 'returned'} column for FY${raw.financialYear ?? '?'} carried no real statement data and was dropped.`,
      })
    }
  }

  // A printed total in the wrong column: take it from its own column's lines.
  const primary = statements.find((st) => st.sourceColumn === 'primary')
  const comparative = statements.find((st) => st.sourceColumn === 'comparative')
  if (primary && comparative) {
    const columns = [primary, comparative].map((st) => ({
      incomeStatement: st.incomeStatement,
      balanceSheet: st.balanceSheet,
      lines: [...(st.incomeStatement.lines ?? []), ...(st.balanceSheet.lines ?? [])],
    }))
    if (fixSwappedTotals(columns[0], columns[1])) {
      for (const st of [primary, comparative]) {
        // Re-check the arithmetic on the corrected totals.
        st.warnings = [
          ...st.warnings.filter((w) => w.kind !== 'totals_reconciliation'),
          ...reconcile({ incomeStatement: st.incomeStatement, balanceSheet: st.balanceSheet, financialYear: st.financialYear, sourceColumn: st.sourceColumn }),
        ]
      }
      documentWarnings.push({
        kind: 'swapped_totals',
        message: 'Totals in this file appear to be printed in the wrong column; figures were taken from the line items.',
      })
    }
  }

  // Nothing real in any column: today's "empty extraction" failure, kept so a
  // stub never reaches storage.
  if (statements.length === 0) {
    throw new Error(
      `extractFinancialStatementFromPdf: rejecting empty extraction for ${sourceFilename} — no column carried real Income Statement or Balance Sheet figures.`,
    )
  }

  return { statements, rawResponse: parsed, model: modelUsed, selection, years, documentWarnings }
}

interface OpenRouterChatResponse {
  model?: string
  // OpenRouter returns provider/gateway failures as an `error` object — often
  // with HTTP 200 and no `choices`. We must inspect this; otherwise the failure
  // surfaces only as a confusing "model did not call the tool" with empty text.
  error?: { message?: string; code?: number | string; metadata?: unknown }
  choices?: Array<{
    finish_reason?: string
    // Some providers report a per-choice error here (e.g. Google safety blocks).
    error?: { message?: string; code?: number | string }
    native_finish_reason?: string
    message?: {
      content?: string | null
      tool_calls?: Array<{
        type?: string
        function?: { name?: string; arguments: string }
      }>
    }
  }>
}

// ─── Tool definition ─────────────────────────────────────────────────────────

interface RawToolInput {
  statements: RawStatement[]
}

interface RawStatement {
  lines?: unknown[]
  sourceColumn?: string
  incomeStatementPresent?: boolean
  balanceSheetPresent?: boolean
  financialYear?: number
  periodEndDate?: string
  periodStartDate?: string | null
  periodLabel?: string | null
  incomeStatement?: Record<string, unknown>
  balanceSheet?: Record<string, unknown>
  rawExtraction?: unknown[]
  warnings?: unknown[]
}

/** Build a section subschema with named canonical keys (all optional,
 *  nullable numbers) plus an open `other` object for unmapped lines.
 *  Gemini reliably fills named properties; pure `additionalProperties` is
 *  ignored, which is why every canonical key appears here explicitly. */
function sectionSchema(canonicalKeys: readonly string[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const key of canonicalKeys) {
    properties[key] = { type: ['number', 'null'] }
  }
  properties.other = {
    type: 'object',
    description:
      'Free-form bucket for line items that do not fit any canonical key above. Use the verbatim PDF label as the key.',
    additionalProperties: { type: ['number', 'null'] },
  }
  return { type: 'object', properties }
}

const INCOME_KEYS = ['sales', 'interestIncome', 'otherRevenue'] as const
const COGS_KEYS = ['openingStock', 'purchases', 'directCosts', 'closingStock'] as const
const APPROPRIATION_KEYS = ['distributions', 'dividends', 'priorYearLossesApplied'] as const
const LINE_SECTIONS: LineSection[] = [
  'income',
  'otherIncome',
  'cogs',
  'expenses',
  'incomeTax',
  'appropriation',
  'incomeTotals',
  'currentAssets',
  'nonCurrentAssets',
  'currentLiabilities',
  'nonCurrentLiabilities',
  'equity',
  'balanceTotals',
]
const EXPENSES_KEYS = [
  'depreciation',
  'motorVehicle',
  'travelAndAccommodation',
  'advertising',
  'bankFees',
  'consultingAndAccounting',
  'entertainment',
  'freightAndCourier',
  'generalExpenses',
  'hireOfPlantAndEquipment',
  'insurance',
  'interestExpense',
  'lightPowerHeating',
  'officeExpenses',
  'printingAndStationery',
  'protectiveClothing',
  'rent',
  'repairsAndMaintenance',
  'subcontractors',
  'subscriptions',
  'superannuation',
  'telephoneAndInternet',
  'tolls',
  'tools',
  'wagesAndSalaries',
  'donations',
  'directorFees',
  'finesNonDeductible',
  'trainingAndDevelopment',
] as const
const IS_TOTALS_KEYS = [
  'totalIncome',
  'totalCogs',
  'grossProfit',
  'totalExpenses',
  'profitBeforeTax',
  'netProfitAfterTax',
] as const
const CURRENT_ASSETS_KEYS = ['bankAccounts', 'accountsReceivable'] as const
const NON_CURRENT_ASSETS_KEYS = ['propertyPlantEquipment', 'directorRelatedLoansReceivable'] as const
const CURRENT_LIAB_KEYS = [
  'bankOverdraft',
  'gstPayable',
  'paygWithholdingPayable',
  'superannuationPayable',
  'atoLiability',
  'incomeTaxPayable',
  'taxation',
] as const
const NON_CURRENT_LIAB_KEYS = [
  'chattelMortgages',
  'loansAndFinance',
  'directorRelatedLoansPayable',
  'ownerDrawings',
] as const
const EQUITY_KEYS = ['retainedEarnings', 'shareCapital'] as const
const BS_TOTALS_KEYS = [
  'totalCurrentAssets',
  'totalNonCurrentAssets',
  'totalAssets',
  'totalCurrentLiabilities',
  'totalNonCurrentLiabilities',
  'totalLiabilities',
  'netAssets',
  'totalEquity',
] as const

function buildExtractionTool(): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: EXTRACTION_TOOL_NAME,
      description:
        'Submit the canonical structured extraction of an Australian SME annual financial statement. Call this exactly once with one entry per detected column (primary + optional comparative). Populate values directly under the named canonical keys in incomeStatement and balanceSheet — DO NOT put values in rawExtraction (rawExtraction is only for unmapped/Quarantined/director-loan audit entries).',
      parameters: {
        type: 'object',
        properties: {
          statements: {
            type: 'array',
            description:
              'One entry per detected column in the PDF. For annual statements: sourceColumn "primary" for the year named in the heading, "comparative" for the prior-year column. For partial-period software exports (Xero/MYOB/QuickBooks): exactly one entry with sourceColumn "current_period" (see the CURRENT-PERIOD PDFs section of the prompt).',
            items: {
              type: 'object',
              properties: {
                sourceColumn: {
                  type: 'string',
                  enum: ['primary', 'comparative', 'current_period'],
                },
                incomeStatementPresent: {
                  type: 'boolean',
                  description:
                    'True only if this document actually contains an Income Statement / Profit and Loss for this column.',
                },
                balanceSheetPresent: {
                  type: 'boolean',
                  description: 'True only if this document actually contains a Balance Sheet for this column.',
                },
                financialYear: {
                  type: 'integer',
                  description: 'e.g. 2025 for the year ended 30 June 2025',
                },
                periodEndDate: {
                  type: 'string',
                  description: 'ISO date, e.g. 2025-06-30',
                },
                periodLabel: {
                  type: ['string', 'null'],
                  description:
                    'Current-period rows only: verbatim human-readable date range, e.g. "1 July 2025 to 4 May 2026". Null for annual statements.',
                },
                periodStartDate: {
                  type: ['string', 'null'],
                  description:
                    'Current-period rows only: ISO start date of the partial period. Null for annual statements.',
                },
                incomeStatement: {
                  type: 'object',
                  description:
                    'Populate values directly under the named canonical keys below. Each section has an `other` object for unmapped lines.',
                  properties: {
                    income: sectionSchema(INCOME_KEYS),
                    cogs: sectionSchema(COGS_KEYS),
                    expenses: sectionSchema(EXPENSES_KEYS),
                    totals: sectionSchema(IS_TOTALS_KEYS),
                    appropriations: {
                      type: 'object',
                      description:
                        'Below the profit line, NOT expenses: distributions to beneficiaries, dividends, prior-year losses applied. Positive numbers.',
                      properties: Object.fromEntries(APPROPRIATION_KEYS.map((k) => [k, { type: ['number', 'null'] }])),
                    },
                  },
                  required: ['income', 'cogs', 'expenses', 'totals'],
                },
                balanceSheet: {
                  type: 'object',
                  description:
                    'Populate values directly under the named canonical keys below. Each section has an `other` object for unmapped lines.',
                  properties: {
                    currentAssets: sectionSchema(CURRENT_ASSETS_KEYS),
                    nonCurrentAssets: sectionSchema(NON_CURRENT_ASSETS_KEYS),
                    currentLiabilities: sectionSchema(CURRENT_LIAB_KEYS),
                    nonCurrentLiabilities: sectionSchema(NON_CURRENT_LIAB_KEYS),
                    equity: sectionSchema(EQUITY_KEYS),
                    totals: sectionSchema(BS_TOTALS_KEYS),
                  },
                  required: [
                    'currentAssets',
                    'nonCurrentAssets',
                    'currentLiabilities',
                    'nonCurrentLiabilities',
                    'equity',
                    'totals',
                  ],
                },
                lines: {
                  type: 'array',
                  description:
                    'Every printed line of this column, in order, totals included. See LINE LIST in the prompt.',
                  items: {
                    type: 'object',
                    properties: {
                      section: { type: 'string', enum: LINE_SECTIONS },
                      rawLabel: { type: 'string' },
                      value: { type: ['number', 'null'] },
                      canonicalKey: { type: ['string', 'null'] },
                      isTotal: { type: 'boolean' },
                    },
                    required: ['section', 'rawLabel', 'value', 'isTotal'],
                  },
                },
                rawExtraction: {
                  type: 'array',
                  description:
                    'Audit trail entries for unmapped, Quarantined, or director-loan lines. Keep short — see prompt for scope.',
                  items: {
                    type: 'object',
                    properties: {
                      section: { type: 'string' },
                      rawLabel: { type: 'string' },
                      rawValue: { type: 'string' },
                      canonicalKey: { type: ['string', 'null'] },
                    },
                    required: ['section', 'rawLabel', 'rawValue'],
                  },
                },
                warnings: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      kind: {
                        type: 'string',
                        enum: [
                          'unmapped_line_item',
                          'totals_reconciliation',
                          'unparseable_value',
                          'missing_total',
                          'incomplete_current_period',
                        ],
                      },
                      message: { type: 'string' },
                      rawLabel: { type: 'string' },
                      rawValue: { type: 'string' },
                      section: { type: 'string' },
                    },
                    required: ['kind', 'message'],
                  },
                },
              },
              required: [
                'sourceColumn',
                'incomeStatementPresent',
                'balanceSheetPresent',
                'financialYear',
                'periodEndDate',
                'incomeStatement',
                'balanceSheet',
                'lines',
              ],
            },
          },
        },
        required: ['statements'],
      },
    },
  }
}

// ─── Per-statement validation + reconciliation ──────────────────────────────

interface NormaliseContext {
  sourceFilename: string
  model: string
  kind: FinancialDocumentKind
  years: ResolvedYears
  isTrust: boolean
}

/** The model's line list, kept only where each entry has the right shape. */
function normaliseLines(value: unknown): StatementLine[] {
  if (!Array.isArray(value)) return []
  const out: StatementLine[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const l = item as Record<string, unknown>
    if (typeof l.rawLabel !== 'string' || !LINE_SECTIONS.includes(l.section as LineSection)) continue
    out.push({
      section: l.section as LineSection,
      rawLabel: l.rawLabel.trim(),
      value: typeof l.value === 'number' && Number.isFinite(l.value) ? l.value : null,
      canonicalKey: typeof l.canonicalKey === 'string' && l.canonicalKey.trim() ? l.canonicalKey.trim() : null,
      isTotal: l.isTotal === true,
    })
  }
  return out
}

/**
 * One returned column -> a statement, or null when neither half is really
 * there. Throws only on a malformed column (no source column, year or date).
 */
function normaliseAndValidate(
  raw: RawStatement,
  { sourceFilename, model, kind, years, isTrust }: NormaliseContext,
): ExtractedFinancialStatement | null {
  let sourceColumn = normaliseSourceColumn(raw.sourceColumn)
  if (!sourceColumn) {
    throw new Error(
      `extractFinancialStatementFromPdf: missing or invalid sourceColumn in ${sourceFilename}`,
    )
  }

  const modelYear = raw.financialYear
  if (typeof modelYear !== 'number' || !Number.isInteger(modelYear)) {
    throw new Error(
      `extractFinancialStatementFromPdf: missing or invalid financialYear in ${sourceFilename} (${sourceColumn} column)`,
    )
  }

  const rawEndDate = raw.periodEndDate
  if (typeof rawEndDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawEndDate)) {
    throw new Error(
      `extractFinancialStatementFromPdf: missing or invalid periodEndDate in ${sourceFilename} (FY${modelYear})`,
    )
  }

  const warnings: ExtractionWarning[] = Array.isArray(raw.warnings)
    ? (raw.warnings as ExtractionWarning[])
        .filter((w) => w && typeof w === 'object')
        // A P&L-only or Balance-Sheet-only file is normal now: the coverage
        // table shows what is missing. Drop the model's "incomplete" note.
        .filter((w) => !(w.kind === 'incomplete_current_period' && (kind === 'pnl_only' || kind === 'bs_only')))
    : []

  // Headings decide annual vs current period too: one value column alone does
  // not make an annual statement a current-period one, nor the reverse.
  if (years.source === 'heading') {
    const annualOnly = years.annualYears.length > 0 && years.currentPeriodYear === null
    const currentOnly = years.annualYears.length === 0 && years.currentPeriodYear !== null
    if (annualOnly && sourceColumn === 'current_period') {
      warnings.push({ kind: 'year_mismatch', message: 'The model read an annual statement as a current-period one. Stored as the annual statement the heading names.' })
      sourceColumn = 'primary'
    } else if (currentOnly && sourceColumn !== 'current_period') {
      warnings.push({ kind: 'year_mismatch', message: 'The model read a current-period statement as an annual one. Stored as the current period the heading names.' })
      sourceColumn = 'current_period'
    }
  }

  // Headings decide the year. An annual column moved to another year takes
  // that year's 30 June as its end date.
  const year = correctYear({ modelYear, sourceColumn, years })
  const financialYear = year.financialYear
  if (year.warning) warnings.push(year.warning)
  const periodEndDate =
    year.warning && sourceColumn !== 'current_period' ? `${financialYear}-06-30` : rawEndDate

  const incomeStatement = (raw.incomeStatement ??
    {}) as unknown as ExtractedFinancialStatement['incomeStatement']
  const balanceSheet = (raw.balanceSheet ??
    {}) as unknown as ExtractedFinancialStatement['balanceSheet']

  const filledIncome: ExtractedFinancialStatement['incomeStatement'] = {
    income: incomeStatement.income ?? {},
    cogs: incomeStatement.cogs ?? {},
    expenses: incomeStatement.expenses ?? {},
    totals: incomeStatement.totals ?? {},
    ...(incomeStatement.appropriations ? { appropriations: incomeStatement.appropriations } : {}),
  }
  const filledBalance: ExtractedFinancialStatement['balanceSheet'] = {
    currentAssets: balanceSheet.currentAssets ?? {},
    nonCurrentAssets: balanceSheet.nonCurrentAssets ?? {},
    currentLiabilities: balanceSheet.currentLiabilities ?? {},
    nonCurrentLiabilities: balanceSheet.nonCurrentLiabilities ?? {},
    equity: balanceSheet.equity ?? {},
    totals: balanceSheet.totals ?? {},
  }

  // Our own corrections over the model's mapping, from the printed lines:
  // the label dictionary, stock, appropriations, and the profit post-check.
  const lines = normaliseLines(raw.lines)
  warnings.push(...correctColumn({ incomeStatement: filledIncome, balanceSheet: filledBalance }, lines, { isTrust }))
  const isLines = lines.filter((l) => isIncomeStatementSection(l.section))
  const bsLines = lines.filter((l) => !isIncomeStatementSection(l.section))
  if (isLines.length) filledIncome.lines = isLines
  if (bsLines.length) filledBalance.lines = bsLines

  warnings.push(
    ...reconcile({
      incomeStatement: filledIncome,
      balanceSheet: filledBalance,
      financialYear,
      sourceColumn,
    }),
  )

  const periodLabel = normalisePeriodField(raw.periodLabel)
  const periodStartDate = normalisePeriodField(raw.periodStartDate)

  // Which halves this column really carries. The model has been observed to
  // return a stub (right shape, nulls everywhere) when it fails to read a
  // column, and to fill a statement the file does not have. Neither may
  // reach storage: a half is stored only when it is really there.
  const isCheck = decidePresence({
    half: 'income_statement',
    modelSaysPresent: raw.incomeStatementPresent,
    data: filledIncome,
    kind,
    financialYear,
    sourceColumn,
  })
  const bsCheck = decidePresence({
    half: 'balance_sheet',
    modelSaysPresent: raw.balanceSheetPresent,
    data: filledBalance,
    kind,
    financialYear,
    sourceColumn,
  })
  for (const check of [isCheck, bsCheck]) if (check.warning) warnings.push(check.warning)

  if (!isCheck.present && !bsCheck.present) {
    console.error(
      `[extractFinancialStatementFromPdf] EMPTY COLUMN ${sourceFilename} (FY${financialYear} ${sourceColumn}). ` +
        `Raw response sample: ${JSON.stringify(raw).slice(0, 500)}`,
    )
    return null
  }

  return {
    financialYear,
    periodEndDate,
    sourceFilename,
    sourceColumn,
    incomeStatement: filledIncome,
    balanceSheet: filledBalance,
    rawExtraction: Array.isArray(raw.rawExtraction)
      ? (raw.rawExtraction as ExtractedFinancialStatement['rawExtraction'])
      : [],
    warnings,
    extractionModel: model,
    present: { income_statement: isCheck.present, balance_sheet: bsCheck.present },
    ...(periodLabel !== undefined ? { periodLabel } : {}),
    ...(periodStartDate !== undefined ? { periodStartDate } : {}),
  }
}

function normaliseSourceColumn(value: unknown): FinancialStatementSourceColumn | null {
  if (value === 'primary' || value === 'comparative' || value === 'current_period') return value
  return null
}

function normalisePeriodField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

interface ReconcileInput {
  incomeStatement: ExtractedFinancialStatement['incomeStatement']
  balanceSheet: ExtractedFinancialStatement['balanceSheet']
  financialYear: number
  sourceColumn: FinancialStatementSourceColumn
}

function reconcile(input: ReconcileInput): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = []
  const { incomeStatement: is, balanceSheet: bs, sourceColumn } = input

  // Current-period PDFs have one column only, so any "comparative" cross-check
  // doesn't apply. The income-statement reconciliation still runs at the
  // standard tolerance; balance-sheet reconciliation loosens to ±$200 to
  // accommodate interim software exports that carry small rounding lines,
  // suspense accounts, and Wages-Payable-Payroll negative entries.
  const balanceTolerance =
    sourceColumn === 'current_period'
      ? CURRENT_PERIOD_BALANCE_TOLERANCE_AUD
      : RECONCILIATION_TOLERANCE_AUD

  const totalIncome = is.totals.totalIncome
  const totalCogs = is.totals.totalCogs
  const totalExpenses = is.totals.totalExpenses
  const profitBeforeTax = is.totals.profitBeforeTax

  if (
    typeof totalIncome === 'number' &&
    typeof totalCogs === 'number' &&
    typeof totalExpenses === 'number' &&
    typeof profitBeforeTax === 'number'
  ) {
    const calc = totalIncome - totalCogs - totalExpenses
    if (Math.abs(calc - profitBeforeTax) > RECONCILIATION_TOLERANCE_AUD) {
      warnings.push({
        kind: 'totals_reconciliation',
        message: `Income statement does not reconcile: totalIncome (${totalIncome}) - totalCogs (${totalCogs}) - totalExpenses (${totalExpenses}) = ${calc.toFixed(2)}, but profitBeforeTax = ${profitBeforeTax}.`,
        section: 'incomeStatement',
      })
    }
  }

  const totalAssets = bs.totals.totalAssets
  const totalLiabilities = bs.totals.totalLiabilities
  const netAssets = bs.totals.netAssets
  const totalCurrentAssets = bs.totals.totalCurrentAssets
  const totalNonCurrentAssets = bs.totals.totalNonCurrentAssets
  const totalCurrentLiabilities = bs.totals.totalCurrentLiabilities
  const totalNonCurrentLiabilities = bs.totals.totalNonCurrentLiabilities

  if (
    typeof totalAssets === 'number' &&
    typeof totalLiabilities === 'number' &&
    typeof netAssets === 'number'
  ) {
    const calc = totalAssets - totalLiabilities
    if (Math.abs(calc - netAssets) > balanceTolerance) {
      warnings.push({
        kind: 'totals_reconciliation',
        message: `Net assets does not reconcile: totalAssets (${totalAssets}) - totalLiabilities (${totalLiabilities}) = ${calc.toFixed(2)}, but netAssets = ${netAssets}.`,
        section: 'balanceSheet',
      })
    }
  }

  if (
    typeof totalCurrentAssets === 'number' &&
    typeof totalNonCurrentAssets === 'number' &&
    typeof totalAssets === 'number'
  ) {
    const calc = totalCurrentAssets + totalNonCurrentAssets
    if (Math.abs(calc - totalAssets) > balanceTolerance) {
      warnings.push({
        kind: 'totals_reconciliation',
        message: `Total assets does not reconcile: ${totalCurrentAssets} + ${totalNonCurrentAssets} = ${calc.toFixed(2)}, but totalAssets = ${totalAssets}.`,
        section: 'balanceSheet',
      })
    }
  }

  if (
    typeof totalCurrentLiabilities === 'number' &&
    typeof totalNonCurrentLiabilities === 'number' &&
    typeof totalLiabilities === 'number'
  ) {
    const calc = totalCurrentLiabilities + totalNonCurrentLiabilities
    if (Math.abs(calc - totalLiabilities) > balanceTolerance) {
      warnings.push({
        kind: 'totals_reconciliation',
        message: `Total liabilities does not reconcile: ${totalCurrentLiabilities} + ${totalNonCurrentLiabilities} = ${calc.toFixed(2)}, but totalLiabilities = ${totalLiabilities}.`,
        section: 'balanceSheet',
      })
    }
  }

  return warnings
}
