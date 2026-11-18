import { it, expect } from 'vitest'
import { runBankCheck } from '../proof/bank'
import { out } from './figures'

/**
 * The test bank (src/lib/proofBank): every proven notice and statement, read again with
 * the current code. Skipped, with a line saying so, before migration 0060 or without
 * database settings. Read only.
 */
it('proven notices and statements keep their figures', async () => {
  const run = await runBankCheck()
  for (const line of run.lines) out(line)
  expect(run.failed).toBe(0)
}, 600_000)
