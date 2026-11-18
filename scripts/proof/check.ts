/**
 * npm run proof:check                        every banked notice and statement read again; read only
 * PROOF_BANK_JOIN=yes npm run proof:check    first joins every proven file not banked yet (after migration 0060)
 *
 * Exits 1 when a proven figure changed or a banked file could not be checked.
 */
import { runBankCheck } from './bank'

try {
  process.loadEnvFile('.env')
} catch {
  // Environment from the shell.
}
const run = await runBankCheck({ join: process.env.PROOF_BANK_JOIN === 'yes' })
for (const line of run.lines) console.log(line)
if (run.failed > 0) process.exit(1)
