/**
 * Server-only. Whether the comparison page shows its diagnostics — the
 * "Statements on file" table and the statement checks (warnings and notes).
 *
 * On only when SHOW_FINANCIALS_DIAGNOSTICS is exactly "true" (development and
 * test deployments). Unset, or anything else, is production: hidden.
 */
export function financialsDiagnosticsEnabled(): boolean {
  return process.env.SHOW_FINANCIALS_DIAGNOSTICS === 'true'
}
