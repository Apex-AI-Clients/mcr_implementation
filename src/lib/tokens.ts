import { randomBytes } from 'crypto'
import { MAGIC_LINK_EXPIRY_DAYS } from './constants'

export function generateMagicToken(): string {
  return randomBytes(32).toString('hex')
}

export function tokenExpiresAt(): Date {
  const d = new Date()
  d.setDate(d.getDate() + MAGIC_LINK_EXPIRY_DAYS)
  return d
}

export function isTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true
  return new Date(expiresAt) < new Date()
}

export function buildPortalUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/portal/${token}`
}
