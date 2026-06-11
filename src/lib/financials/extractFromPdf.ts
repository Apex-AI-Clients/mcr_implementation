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
 * Throws when:
 *   - the model returns no tool call (shouldn't happen with forced tool_choice)
 *   - the tool arguments aren't valid JSON
 *   - no financial year can be determined for a returned column
 *
 * Does NOT throw (logs warnings instead) when:
 *   - individual line items can't be mapped (they go in `other`)
 *   - published totals don't reconcile to the sum of line items within $50
 *
 * Must only be imported from API routes — never from a component.
 */
import { PDFDocument } from 'pdf-lib'
import { OPENROUTER_EXTRACTION_MODEL, FINANCIALS_EXTRACTION_PROMPT } from '../ai/prompts'
import type {
  ExtractedFinancialStatement,
  ExtractionWarning,
  FinancialStatementSourceColumn,
} from './types'

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

const RECONCILIATION_TOLERANCE_AUD = 50
// Current-period (partial-year software exports) tend to have small rounding
// lines, suspense accounts, and Wages-Payable-Payroll style negatives that
// open up minor reconciliation gaps. Loosen the balance-sheet tolerance
// without touching the annual-statement check.
const CURRENT_PERIOD_BALANCE_TOLERANCE_AUD = 200

const EXTRACTION_TOOL_NAME = 'submit_extracted_financials'

/** Maximum number of pages to send to the model. The Income Statement and
 *  Balance Sheet always live within the first 8 pages of these PDFs (the
 *  rest is notes, declarations, depreciation schedule, and an optional
 *  appended Company Tax Return). Trimming dramatically reduces both upload
 *  size and the model's PDF-parse time. */
const MAX_PAGES_FOR_EXTRACTION = 8

export interface ExtractFromPdfInput {
  pdfBytes: Uint8Array
  sourceFilename: string
}

export interface ExtractFromPdfResult {
  statements: ExtractedFinancialStatement[]
  rawResponse: unknown
  model: string
}

export async function extractFinancialStatementFromPdf(
  input: ExtractFromPdfInput,
): Promise<ExtractFromPdfResult> {
  const { pdfBytes, sourceFilename } = input

  // Trim to the first MAX_PAGES_FOR_EXTRACTION pages. PDFs in this dataset
  // bundle a Company Tax Return after the financials; sending it to the
  // model wastes tokens and slows extraction.
  const trimmedBytes = await trimPdfToFirstPages(pdfBytes, MAX_PAGES_FOR_EXTRACTION)
  const trimmedKb = Math.round(trimmedBytes.length / 1024)
  const originalKb = Math.round(pdfBytes.length / 1024)
  // Best-effort year detection from the filename. The expected primary FY
  // typically lives in the filename ("PARKCON_..._2024_signed.pdf" → 2024).
  // We pass this to the model as a guardrail against year hallucinations.
  const filenameYear = inferYearFromFilename(sourceFilename)
  console.log(
    `[extractFinancialStatementFromPdf] ${sourceFilename}: ${originalKb}KB → ${trimmedKb}KB after trimming to ${MAX_PAGES_FOR_EXTRACTION} pages; filename hints FY=${filenameYear ?? 'unknown'}`,
  )
  const base64Pdf = Buffer.from(trimmedBytes).toString('base64')

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
    max_tokens: 16000,
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
            text: buildExtractionPromptWithHint(sourceFilename, filenameYear),
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

  const callStart = Date.now()
  console.log(
    `[extractFinancialStatementFromPdf] ${sourceFilename}: calling OpenRouter (Gemini 2.5 Flash)`,
  )

  // 5-minute timeout via AbortController. Matches the previous SDK timeout.
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), 300_000)

  let httpResponse: Response
  try {
    httpResponse = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.PUBLIC_APP_URL ?? 'https://mcr-partners.local',
        'X-Title': 'MCR Partners SBR Portal',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutHandle)
  }

  if (!httpResponse.ok) {
    const errorText = await httpResponse.text().catch(() => '')
    throw new Error(
      `extractFinancialStatementFromPdf: OpenRouter HTTP ${httpResponse.status} for ${sourceFilename}: ${errorText.slice(0, 500)}`,
    )
  }

  const response = (await httpResponse.json()) as OpenRouterChatResponse
  const callElapsed = ((Date.now() - callStart) / 1000).toFixed(1)

  // OpenRouter frequently returns provider failures as a 200 with an `error`
  // object (top-level or per-choice) and no usable completion. Surface it so the
  // logs show the real cause instead of "model did not call the tool".
  const orError = response.error ?? response.choices?.[0]?.error
  if (orError) {
    const detail =
      typeof orError.message === 'string' ? orError.message : JSON.stringify(orError)
    console.error(
      `[extractFinancialStatementFromPdf] ${sourceFilename}: OpenRouter returned an error (code=${orError.code ?? 'n/a'}): ${detail}`,
    )
    throw new Error(
      `extractFinancialStatementFromPdf: OpenRouter error for ${sourceFilename}: ${detail}`,
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
    statements.push(normaliseAndValidate(raw, sourceFilename, modelUsed))
  }

  return { statements, rawResponse: parsed, model: modelUsed }
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
  sourceColumn?: string
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
const COGS_KEYS = ['purchases', 'directCosts'] as const
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
                'financialYear',
                'periodEndDate',
                'incomeStatement',
                'balanceSheet',
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

function normaliseAndValidate(
  raw: RawStatement,
  sourceFilename: string,
  model: string,
): ExtractedFinancialStatement {
  const sourceColumn = normaliseSourceColumn(raw.sourceColumn)
  if (!sourceColumn) {
    throw new Error(
      `extractFinancialStatementFromPdf: missing or invalid sourceColumn in ${sourceFilename}`,
    )
  }

  const financialYear = raw.financialYear
  if (typeof financialYear !== 'number' || !Number.isInteger(financialYear)) {
    throw new Error(
      `extractFinancialStatementFromPdf: missing or invalid financialYear in ${sourceFilename} (${sourceColumn} column)`,
    )
  }

  const periodEndDate = raw.periodEndDate
  if (typeof periodEndDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(periodEndDate)) {
    throw new Error(
      `extractFinancialStatementFromPdf: missing or invalid periodEndDate in ${sourceFilename} (FY${financialYear})`,
    )
  }

  const warnings: ExtractionWarning[] = Array.isArray(raw.warnings)
    ? (raw.warnings as ExtractionWarning[]).filter((w) => w && typeof w === 'object')
    : []

  const incomeStatement = (raw.incomeStatement ??
    {}) as unknown as ExtractedFinancialStatement['incomeStatement']
  const balanceSheet = (raw.balanceSheet ??
    {}) as unknown as ExtractedFinancialStatement['balanceSheet']

  const filledIncome = {
    income: incomeStatement.income ?? {},
    cogs: incomeStatement.cogs ?? {},
    expenses: incomeStatement.expenses ?? {},
    totals: incomeStatement.totals ?? {},
  }
  const filledBalance = {
    currentAssets: balanceSheet.currentAssets ?? {},
    nonCurrentAssets: balanceSheet.nonCurrentAssets ?? {},
    currentLiabilities: balanceSheet.currentLiabilities ?? {},
    nonCurrentLiabilities: balanceSheet.nonCurrentLiabilities ?? {},
    equity: balanceSheet.equity ?? {},
    totals: balanceSheet.totals ?? {},
  }

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

  // Reject extractions that have no meaningful data. The model has been
  // observed to return a stub (correct shape, null values everywhere) when
  // it fails to parse a column. Persisting such a row would overwrite real
  // data via the UNIQUE(client_id, financial_year) constraint.
  const totalIncome = filledIncome.totals.totalIncome
  const totalAssets = filledBalance.totals.totalAssets
  const sales = filledIncome.income.sales
  if (
    totalIncome == null &&
    totalAssets == null &&
    sales == null
  ) {
    console.error(
      `[extractFinancialStatementFromPdf] EMPTY EXTRACTION ${sourceFilename} (FY${financialYear} ${sourceColumn}): ` +
        `income.sales=${sales}, totals.totalIncome=${totalIncome}, totals.totalAssets=${totalAssets}. ` +
        `Raw response sample: ${JSON.stringify(raw).slice(0, 500)}`,
    )
    throw new Error(
      `extractFinancialStatementFromPdf: rejecting empty extraction for ${sourceFilename} (FY${financialYear} ${sourceColumn}) — no sales, totalIncome, or totalAssets values returned.`,
    )
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
    ...(periodLabel !== undefined ? { periodLabel } : {}),
    ...(periodStartDate !== undefined ? { periodStartDate } : {}),
  }
}

/** Best-effort: extract a 4-digit financial year (20XX) from a filename.
 *  Returns the FIRST 20XX match. Filenames in this product follow patterns
 *  like "2023 - PARKCON...pdf", "PARKCON_..._Tax 2024_signed.pdf", or
 *  "PARKCON_..._Tax Return 2025_signed.pdf". Uses a digit-aware boundary
 *  (negative lookbehind/ahead for digits only) so "_" before/after the
 *  year is treated as a separator, not part of the year. */
function inferYearFromFilename(filename: string): number | null {
  const match = filename.match(/(?<!\d)(20\d{2})(?!\d)/)
  if (!match) return null
  const year = parseInt(match[1], 10)
  const currentYear = new Date().getFullYear()
  if (year < 2000 || year > currentYear + 1) return null
  return year
}

/** Inject the filename + filename-derived year into the prompt so the model
 *  can't hallucinate a different year. If the filename has no detectable
 *  year, the model is told to rely on the PDF heading only. */
function buildExtractionPromptWithHint(filename: string, hintYear: number | null): string {
  const hint = hintYear
    ? `\n\nSOURCE FILENAME: "${filename}"\nFILENAME SUGGESTS PRIMARY FINANCIAL YEAR: ${hintYear}. The PRIMARY column's financialYear should be ${hintYear} unless the PDF heading clearly says otherwise. If the PDF's heading year disagrees with the filename year, trust the PDF heading and add a warning of kind "unmapped_line_item" explaining the mismatch.\n`
    : `\n\nSOURCE FILENAME: "${filename}"\nThe filename does not contain a clear year hint — derive financialYear ONLY from the PDF heading.\n`
  return FINANCIALS_EXTRACTION_PROMPT + hint
}

/**
 * Load a PDF, keep only the first N pages, return the serialised bytes.
 *
 * Behaviour:
 *   - PDFs ≤ N pages: returned untouched.
 *   - Encrypted/signed PDFs: returned untouched. pdf-lib can OPEN encrypted
 *     PDFs with ignoreEncryption:true, but the page-content streams remain
 *     encrypted internally — re-saving produces a structurally-valid but
 *     visually-blank PDF. We observed the model calling the extraction tool
 *     with all-null values on such PDFs. Better to send the full original
 *     and let OpenRouter forward it to the underlying model unmodified.
 *   - Unencrypted PDFs > N pages: trimmed to the first N pages.
 *
 * Source PDFs in this product bundle an Annual Financial Statement
 * (~7-8 pages) followed by an optional Company Tax Return (~10 pages).
 * Trimming dramatically speeds up processing on unencrypted PDFs.
 */
async function trimPdfToFirstPages(input: Uint8Array, maxPages: number): Promise<Uint8Array> {
  let source: PDFDocument
  try {
    // First attempt: refuse encrypted PDFs. If this throws, we know the PDF
    // is encrypted and we shouldn't trim it (the re-saved output would have
    // blank content streams).
    source = await PDFDocument.load(input, { ignoreEncryption: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('encrypted')) {
      console.log(
        `[extractFinancialStatementFromPdf] PDF is encrypted/signed (${Math.round(input.length / 1024)}KB) — bypassing trim, sending original to OpenRouter`,
      )
      return input
    }
    throw err
  }

  const totalPages = source.getPageCount()
  if (totalPages <= maxPages) {
    return input
  }

  const out = await PDFDocument.create()
  const indices = Array.from({ length: maxPages }, (_, i) => i)
  const pages = await out.copyPages(source, indices)
  for (const p of pages) out.addPage(p)
  return await out.save()
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
