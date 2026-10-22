/**
 * Server-only. Whether the comparison page shows its diagnostics — the
 * whole "Statements on file" section (coverage table, per-file year
 * override, files not used, per-file list) and the statement checks
 * (warnings and notes), and the red "Needs review" banner with its export
 * lock (hardChecks.ts). Hidden in production at the client's request.
 *
 * On only when SHOW_FINANCIALS_DIAGNOSTICS is exactly "true" (development and
 * test deployments). Unset, or anything else, is production: hidden.
 */
export function financialsDiagnosticsEnabled(): boolean {
  return process.env.SHOW_FINANCIALS_DIAGNOSTICS === 'true'
}
