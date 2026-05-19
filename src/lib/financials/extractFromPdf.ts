/**
 * Server-only. Extracts canonical financial data from a single annual
 * financial statement PDF using Claude's PDF input + tool-use mode.
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
 *   - the model returns no tool_use block (shouldn't happen with forced tool_choice)
 *   - no financial year can be determined for a returned column
 *
 * Does NOT throw (logs warnings instead) when:
 *   - individual line items can't be mapped (they go in `other`)
 *   - published totals don't reconcile to the sum of line items within $50
 *
 * Must only be imported from API routes — never from a component.
 */
import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import { CLAUDE_MODEL, FINANCIALS_EXTRACTION_PROMPT } from '../ai/prompts'
import type {
  ExtractedFinancialStatement,
  ExtractionWarning,
  FinancialStatementSourceColumn,
} from './types'

const RECONCILIATION_TOLERANCE_AUD = 50

const EXTRACTION_TOOL_NAME = 'submit_extracted_financials'

/** Maximum number of pages to send to Claude. The Income Statement and
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

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.')

  // Trim to the first MAX_PAGES_FOR_EXTRACTION pages. PDFs in this dataset
  // bundle a Company Tax Return after the financials; sending it to Claude
  // wastes tokens and triggers timeouts.
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

  // SDK config tuned for Anthropic's rate-limit backoff behaviour:
  //   - timeout: 300_000ms gives the SDK room to absorb a server-side 429
  //     backoff (Anthropic has been observed to hold a request open for
  //     ~5min when nearing the per-minute token cap).
  //   - maxRetries: 2 lets the SDK retry transient errors automatically
  //     with exponential backoff.
  // Pair this with an inter-document delay in the route loop to stay under
  // the per-minute token cap in the first place.
  const client = new Anthropic({
    apiKey,
    timeout: 300_000,
    maxRetries: 2,
  })

  const callStart = Date.now()
  console.log(`[extractFinancialStatementFromPdf] ${sourceFilename}: calling Anthropic`)

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    tools: [buildExtractionTool()],
    tool_choice: { type: 'tool', name: EXTRACTION_TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Pdf,
            },
          },
          {
            type: 'text',
            text: buildExtractionPromptWithHint(sourceFilename, filenameYear),
          },
        ],
      },
    ],
  })

  const callElapsed = ((Date.now() - callStart) / 1000).toFixed(1)
  console.log(
    `[extractFinancialStatementFromPdf] ${sourceFilename}: Anthropic responded in ${callElapsed}s, stop_reason=${message.stop_reason}, blocks=${message.content.map((b) => b.type).join(',')}`,
  )

  // Diagnostics — if anything goes wrong downstream, this is what we'll need
  // to figure out why.
  if (message.stop_reason === 'max_tokens') {
    console.error(
      `[extractFinancialStatementFromPdf] ${sourceFilename}: response hit max_tokens. ` +
        `stop_reason=${message.stop_reason}, content_blocks=${message.content
          .map((b) => b.type)
          .join(',')}`,
    )
    throw new Error(
      `extractFinancialStatementFromPdf: response truncated at max_tokens for ${sourceFilename}.`,
    )
  }

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  )

  if (!toolUse) {
    console.error(
      `[extractFinancialStatementFromPdf] ${sourceFilename}: no tool_use block in response. ` +
        `stop_reason=${message.stop_reason}, blocks=${message.content
          .map((b) => b.type)
          .join(',')}`,
    )
    // Surface any text the model emitted as a hint for the operator.
    const textHint = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join(' ')
      .slice(0, 300)
    throw new Error(
      `extractFinancialStatementFromPdf: model did not call the extraction tool for ${sourceFilename}. ${
        textHint ? `Model said: ${textHint}` : ''
      }`,
    )
  }

  const parsed = toolUse.input as RawToolInput

  if (!Array.isArray(parsed.statements) || parsed.statements.length === 0) {
    throw new Error(
      `extractFinancialStatementFromPdf: tool input had no statements array for ${sourceFilename}.`,
    )
  }

  const statements: ExtractedFinancialStatement[] = []
  for (const raw of parsed.statements) {
    statements.push(normaliseAndValidate(raw, sourceFilename, message.model))
  }

  return { statements, rawResponse: parsed, model: message.model }
}

// ─── Tool definition ─────────────────────────────────────────────────────────

interface RawToolInput {
  statements: RawStatement[]
}

interface RawStatement {
  sourceColumn?: string
  financialYear?: number
  periodEndDate?: string
  incomeStatement?: Record<string, unknown>
  balanceSheet?: Record<string, unknown>
  rawExtraction?: unknown[]
  warnings?: unknown[]
}

function buildExtractionTool(): Anthropic.Tool {
  return {
    name: EXTRACTION_TOOL_NAME,
    description:
      'Submit the canonical structured extraction of an Australian SME annual financial statement. Call this exactly once with one entry per detected column (primary + optional comparative).',
    input_schema: {
      type: 'object',
      properties: {
        statements: {
          type: 'array',
          description:
            'One entry per detected column in the PDF. Use sourceColumn "primary" for the year named in the heading, "comparative" for the prior-year column.',
          items: {
            type: 'object',
            properties: {
              sourceColumn: {
                type: 'string',
                enum: ['primary', 'comparative'],
              },
              financialYear: {
                type: 'integer',
                description: 'e.g. 2025 for the year ended 30 June 2025',
              },
              periodEndDate: {
                type: 'string',
                description: 'ISO date, e.g. 2025-06-30',
              },
              incomeStatement: {
                type: 'object',
                properties: {
                  income: { type: 'object', additionalProperties: { type: ['number', 'null'] } },
                  cogs: { type: 'object', additionalProperties: { type: ['number', 'null'] } },
                  expenses: { type: 'object', additionalProperties: { type: ['number', 'null'] } },
                  totals: { type: 'object', additionalProperties: { type: ['number', 'null'] } },
                },
                required: ['income', 'cogs', 'expenses', 'totals'],
              },
              balanceSheet: {
                type: 'object',
                properties: {
                  currentAssets: {
                    type: 'object',
                    additionalProperties: { type: ['number', 'null'] },
                  },
                  nonCurrentAssets: {
                    type: 'object',
                    additionalProperties: { type: ['number', 'null'] },
                  },
                  currentLiabilities: {
                    type: 'object',
                    additionalProperties: { type: ['number', 'null'] },
                  },
                  nonCurrentLiabilities: {
                    type: 'object',
                    additionalProperties: { type: ['number', 'null'] },
                  },
                  equity: {
                    type: 'object',
                    additionalProperties: { type: ['number', 'null'] },
                  },
                  totals: {
                    type: 'object',
                    additionalProperties: { type: ['number', 'null'] },
                  },
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
  } as Anthropic.Tool
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

  // Reject extractions that have no meaningful data. Claude has been
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
 *     visually-blank PDF. We observed Claude calling the extraction tool
 *     with all-null values on such PDFs. Better to send the full original
 *     and let Anthropic process it directly.
 *   - Unencrypted PDFs > N pages: trimmed to the first N pages.
 *
 * Source PDFs in this product bundle an Annual Financial Statement
 * (~7-8 pages) followed by an optional Company Tax Return (~10 pages).
 * Trimming dramatically speeds up Claude's processing on unencrypted PDFs.
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
        `[extractFinancialStatementFromPdf] PDF is encrypted/signed (${Math.round(input.length / 1024)}KB) — bypassing trim, sending original to Anthropic`,
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
  if (value === 'primary' || value === 'comparative') return value
  return null
}

interface ReconcileInput {
  incomeStatement: ExtractedFinancialStatement['incomeStatement']
  balanceSheet: ExtractedFinancialStatement['balanceSheet']
  financialYear: number
  sourceColumn: FinancialStatementSourceColumn
}

function reconcile(input: ReconcileInput): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = []
  const { incomeStatement: is, balanceSheet: bs } = input

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
    if (Math.abs(calc - netAssets) > RECONCILIATION_TOLERANCE_AUD) {
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
    if (Math.abs(calc - totalAssets) > RECONCILIATION_TOLERANCE_AUD) {
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
    if (Math.abs(calc - totalLiabilities) > RECONCILIATION_TOLERANCE_AUD) {
      warnings.push({
        kind: 'totals_reconciliation',
        message: `Total liabilities does not reconcile: ${totalCurrentLiabilities} + ${totalNonCurrentLiabilities} = ${calc.toFixed(2)}, but totalLiabilities = ${totalLiabilities}.`,
        section: 'balanceSheet',
      })
    }
  }

  return warnings
}
