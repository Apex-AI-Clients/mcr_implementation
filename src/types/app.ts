import type { DocCategory } from '@/lib/constants'

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
}

export interface ClientDetail {
  id: string
  name: string
  email: string
  status: 'invited' | 'in_progress' | 'complete' | 'missing_items'
  atoAdminConfirmed: boolean
  atoAdminConfirmedAt: string | null
  linkExpiresAt: string | null
  createdAt: string
  updatedAt: string
  documents: DocumentRecord[]
  accountantDetails: AccountantDetails | null
  followUps: FollowUpRecord[]
}

export interface FollowUpRecord {
  id: string
  clientId: string
  type: 'auto' | 'manual'
  missingItems: string[]
  sentAt: string
  emailStatus: string
}

export interface ApiError {
  error: string
}
