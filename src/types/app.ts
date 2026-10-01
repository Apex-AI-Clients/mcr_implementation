import type { DocCategory } from '@/lib/constants'
import type { Director } from '@/lib/asic/types'

export interface DocumentRecord {
  id: string
  clientId: string
  filePath: string
  originalFilename: string
  fileType: string
  fileSizeBytes: number
  docCategory: DocCategory
  status: 'uploaded' | 'ready' | 'rejected'
  uploadedAt: string
}

export interface AccountantDetails {
  id: string
  clientId: string
  companyName: string
  contactPerson: string
  phoneNumber: string
  emailAddress: string
}

export interface ClientSummary {
  id: string
  name: string
  email: string
  status: 'invited' | 'in_progress' | 'complete' | 'missing_items'
  docsReceived: number
  docsTotal: number
  atoAdminConfirmed: boolean
  hasAccountantDetails: boolean
  lastActivity: string | null
  createdAt: string
  /** Set only on Archive rows (migration 0024). */
  archivedAt?: string | null
  archivedReason?: string | null
}

export interface ClientDetail {
  id: string
  name: string
  email: string
  status: 'invited' | 'in_progress' | 'complete' | 'missing_items'
  atoAdminConfirmed: boolean
  atoAdminConfirmedAt: string | null
  authUserId: string | null
  createdAt: string
  updatedAt: string
  documents: DocumentRecord[]
  accountantDetails: AccountantDetails | null
}

export interface CompanyDetails {
  id: string
  clientId: string
  /** 'company', or 'trust' for a company acting as trustee (migration 0023). */
  entityType: string
  companyName: string
  acnNumber: string
  /** The company's own ABN. */
  abnNumber: string
  trustName: string
  /** The trust's own ABN (migration 0023). */
  trustAbnNumber: string | null
  phoneNumber: string
  emailAddress: string
  /** From the ASIC company extract, or typed by hand (migration 0022). */
  registeredOfficeAddress: string | null
  principalPlaceOfBusiness: string | null
  directors: Director[]
  /** The extract's own date — the "as at". */
  asicExtractDate: string | null
  /** 'asic_pdf' | 'asic_pdf_edited' | 'manual' | null */
  companyDetailsSource: string | null
}

export interface ApiError {
  error: string
}
