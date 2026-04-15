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
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MIME_CSV = 'text/csv'

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
    label: 'Current Period P&L & Balance Sheet',
    description:
      "Copy of the Current Period Company's Profit & Loss Statement & Balance Sheet as of today. (Draft is Acceptable)",
    acceptedFormats: [MIME_PDF, MIME_DOCX],
    formatLabel: 'PDF or DOCX',
    isOptional: false,
    multipleFiles: true,
  },
  historical_financials: {
    label: 'Last 4 Years P&L & Balance Sheet',
    description:
      "Copy of the Last 4 years Company's Profit & Loss Statement & Balance Sheet (2022, 2023, 2024 & Draft 2025) (accountant prepared)",
    acceptedFormats: [MIME_PDF, MIME_DOCX],
    formatLabel: 'PDF or DOCX',
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
    acceptedFormats: [MIME_PDF, MIME_DOCX],
    formatLabel: 'PDF or DOCX',
    isOptional: true,
    multipleFiles: true,
  },
  trust_deed: {
    label: 'Trust Deed',
    description: 'Copy of Trust Deed (if applicable)',
    acceptedFormats: [MIME_PDF, MIME_DOCX],
    formatLabel: 'PDF or DOCX',
    isOptional: true,
    multipleFiles: false,
  },
  company_licences: {
    label: 'Company Licences',
    description: 'Copy of any licences held by the Company (if applicable)',
    acceptedFormats: [MIME_PDF, MIME_DOCX],
    formatLabel: 'PDF or DOCX',
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
export const ALL_ACCEPTED_MIME_TYPES = [MIME_PDF, MIME_DOCX, MIME_CSV] as const

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
// Magic link
// ============================================================

export const MAGIC_LINK_EXPIRY_DAYS = 15

// ============================================================
// Reminders
// ============================================================

export const REMINDER_DAYS = [2, 5] // Days after invite

// ============================================================
// Storage
// ============================================================

export const SIGNED_URL_EXPIRY_SECONDS = 300 // 5 minutes
