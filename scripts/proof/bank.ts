/**
 * The test bank check, shared by `npm run proof:check` and `npm run figures:check`
 * (src/lib/proofBank, migration 0060). Prints client aliases (or an id prefix),
 * document id prefixes, kinds and figures only: a statement's line is shown as
 * its statement and a short hash of the line, never the printed label.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { checkProofBank, joinProofBank } from '@/lib/proofBank/store'

export function bankClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<Database>(url, key, { auth: { persistSession: false } }) as never as Parameters<typeof checkProofBank>[0]
}

const aliasFile = 'verified-figures/ica/aliases.json'
const aliases = new Map<string, string>(
  existsSync(aliasFile) ? JSON.parse(readFileSync(aliasFile, 'utf8')).all.map((a: { alias: string; clientId: string }) => [a.clientId, a.alias]) : [],
)
const alias = (id: string) => aliases.get(id) ?? `client-${id.slice(0, 6)}`

/** "years.FY2024.balance_sheet|Assets/Cash: banked 100, now 108" → the line as a hash. */
export function maskLine(difference: string): string {
  return difference.replace(/(profit_and_loss|balance_sheet|trading)\|([^:]+?)(?=:)/g, (_m, kind: string, line: string) => `${kind}|line#${createHash('sha256').update(line).digest('hex').slice(0, 8)}`)
}

export interface BankRun {
  /** Null: the bank is not set up (migration 0060 not applied) or no database settings. */
  checked: number | null
  failed: number
  lines: string[]
}

export async function runBankCheck({ join = false }: { join?: boolean } = {}): Promise<BankRun> {
  const db = bankClient()
  if (!db) return { checked: null, failed: 0, lines: ['proof bank: skipped (no database settings)'] }
  const lines: string[] = []
  if (join) {
    const { data: clients } = await db.from('clients').select('id')
    let joined = 0
    for (const c of clients ?? []) joined += (await joinProofBank(db, c.id)).joined
    lines.push(`proof bank: ${joined} file(s) joined`)
  }
  const results = await checkProofBank(db)
  if (!results) return { checked: null, failed: 0, lines: [...lines, 'proof bank: not set up (apply migration 0060)'] }
  let failed = 0
  for (const r of results) {
    const head = `${alias(r.clientId)} ${r.kind} ${r.documentId.slice(0, 8)} (${r.readFrom === 'file' ? 'file read again' : 'kept reading'})`
    if (r.error) {
      failed++
      lines.push(`  ${head}: COULD NOT CHECK: ${r.error}`)
    } else if (r.differences.length) {
      failed++
      lines.push(`  ${head}: ${r.differences.length} figure(s) CHANGED`)
      for (const d of r.differences.slice(0, 20)) lines.push(`      ${maskLine(d)}`)
    } else {
      lines.push(`  ${head}: unchanged`)
    }
  }
  lines.push(`proof bank: ${results.length} file(s) checked, ${failed} failed`)
  return { checked: results.length, failed, lines }
}
