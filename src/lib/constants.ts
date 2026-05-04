// MCR Partners — Canonical document category constants.
// Import from here everywhere. Never use ad-hoc strings.

// ============================================================
// Document Categories (6 categories)
// ============================================================

export const DOCUMENT_CATEGORIES = {
  CURRENT_FINANCIALS: 'current_financials',
  HISTORICAL_FINANCIALS: 'historical_financials',
  INTEGRATED_CLIENT_ACCOUNT: 'integrated_client_account',
  DIRECTOR_PENALTY_NOTICES: 'director_penalty_notices',
  TRUST_DEED: 'trust_deed',
  COMPANY_LICENCES: 'company_licences',
} as const

export type DocCategory = (typeof DOCUMENT_CATEGORIES)[keyof typeof DOCUMENT_CATEGORIES]

// MIME type constants
const MIME_PDF = 'application/pdf'
const MIME_CSV = 'text/csv'

/**
 * Returns the start year of the current Australian Financial Year.
 * AU FY runs 1 July → 30 June. On/after 1 July the FY start year is
 * the current calendar year; before 1 July it's the previous year.
 */
export function getCurrentFYStartYear(): number {
  const now = new Date()
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
}

/**
 * Current Period label — e.g. "1 July 2025 until now".
 * Rolls forward automatically every 1 July.
 */
export function getCurrentFinancialPeriod(): string {
  return `1 July ${getCurrentFYStartYear()} until now`
}

/**
 * Historical (last 4 FYs) label — e.g. "FY2022, FY2023, FY2024 & Draft FY2025".
 * The most recent completed FY is prefixed with "Draft" because the
 * accountant may not have finalised it yet.
 */
export function getHistoricalFinancialPeriod(): string {
  const fyStart = getCurrentFYStartYear()
  // Previous 4 complete FYs by their ending year (= the FY name in AU convention)
  const years = [fyStart - 3, fyStart - 2, fyStart - 1, fyStart]
  const labels = years.map((y, i) => (i === years.length - 1 ? `Draft FY${y}` : `FY${y}`))
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`
}

export interface CategoryMeta {
  label: string
  description: string
  acceptedFormats: string[]
  formatLabel: string
  isOptional: boolean
  multipleFiles: boolean
  externalLink?: string
}

export const CATEGORY_META: Record<DocCategory, CategoryMeta> = {
  current_financials: {
    label: 'Current Period Profit and Loss & Balance Sheet',
    description:
      "Copy of the Current Period Company's Profit and Loss Statement & Balance Sheet as of today. (Draft is Acceptable)",
    acceptedFormats: [MIME_PDF],
    formatLabel: 'PDF only',
    isOptional: false,
    multipleFiles: true,
  },
  historical_financials: {
    label: 'Last 4 Years Profit and Loss & Balance Sheet',
    description:
      "Copy of the Last 4 years Company's Profit and Loss Statement & Balance Sheet (accountant prepared)",
    acceptedFormats: [MIME_PDF],
    formatLabel: 'PDF only',
    isOptional: false,
    multipleFiles: true,
  },
  integrated_client_account: {
    label: 'Integrated Client Account (ATO Portal)',
    description:
      'Detailed Integrated Client Account ATO Portal from 01/07/2017 until now (Activity Statement, Income Tax or Super Account). CSV Format.',
    acceptedFormats: [MIME_CSV],
    formatLabel: 'CSV only',
    isOptional: false,
    multipleFiles: true,
    externalLink: 'https://onlineservices.ato.gov.au/business/BusinessLogin.html',
  },
  director_penalty_notices: {
    label: "Director Penalty Notices (DPN's)",
    description:
      "Copies of ALL Director Penalty Notices issued by the ATO (DPN's) (if applicable)",
    acceptedFormats: [MIME_PDF],
    formatLabel: 'PDF only',
    isOptional: true,
    multipleFiles: true,
  },
  trust_deed: {
    label: 'Trust Deed',
    description: 'Copy of Trust Deed (if applicable)',
    acceptedFormats: [MIME_PDF],
    formatLabel: 'PDF only',
    isOptional: true,
    multipleFiles: false,
  },
  company_licences: {
    label: 'Company Licences',
    description: 'Copy of any licences held by the Company (if applicable)',
    acceptedFormats: [MIME_PDF],
    formatLabel: 'PDF only',
    isOptional: true,
    multipleFiles: true,
  },
}

// Display order for checklist
export const CHECKLIST_ORDER: DocCategory[] = [
  DOCUMENT_CATEGORIES.CURRENT_FINANCIALS,
  DOCUMENT_CATEGORIES.HISTORICAL_FINANCIALS,
  DOCUMENT_CATEGORIES.INTEGRATED_CLIENT_ACCOUNT,
  DOCUMENT_CATEGORIES.DIRECTOR_PENALTY_NOTICES,
  DOCUMENT_CATEGORIES.TRUST_DEED,
  DOCUMENT_CATEGORIES.COMPANY_LICENCES,
]

// Categories that MUST have files for "complete" status
export const REQUIRED_CATEGORIES: DocCategory[] = [
  DOCUMENT_CATEGORIES.CURRENT_FINANCIALS,
  DOCUMENT_CATEGORIES.HISTORICAL_FINANCIALS,
  DOCUMENT_CATEGORIES.INTEGRATED_CLIENT_ACCOUNT,
]

// All accepted MIME types (union of all categories)
export const ALL_ACCEPTED_MIME_TYPES = [MIME_PDF, MIME_CSV] as const

// ============================================================
// MCR Partners admin info (displayed on portal)
// ============================================================

export const MCR_ADMIN_INFO = {
  firstName: 'MCR',
  surname: 'Partners',
  email: 'assist@mcrpartners.com.au',
} as const

// ============================================================
// File upload constraints
// ============================================================

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50MB

// ============================================================
// Storage
// ============================================================

export const SIGNED_URL_EXPIRY_SECONDS = 300 // 5 minutes
