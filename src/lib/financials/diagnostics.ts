/**
 * Server-only. Whether the comparison page shows its diagnostics — the
 * per-file list under "Statements on file" and the statement checks
 * (warnings and notes). The coverage table, where a file's year and type
 * are checked and changed, shows everywhere.
 *
 * On only when SHOW_FINANCIALS_DIAGNOSTICS is exactly "true" (development and
 * test deployments). Unset, or anything else, is production: hidden.
 */
export function financialsDiagnosticsEnabled(): boolean {
  return process.env.SHOW_FINANCIALS_DIAGNOSTICS === 'true'
}
