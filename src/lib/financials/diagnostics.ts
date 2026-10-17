/**
 * Server-only. Whether the comparison page shows its diagnostics: the
 * statement checks (warnings and notes). "Statements on file" used to be one
 * too; since one upload area holds every statement (migration 0031) it shows
 * for everyone, because staff set a misread file's year and type there.
 *
 * On only when SHOW_FINANCIALS_DIAGNOSTICS is exactly "true" (development and
 * test deployments). Unset, or anything else, is production: hidden.
 */
export function financialsDiagnosticsEnabled(): boolean {
  return process.env.SHOW_FINANCIALS_DIAGNOSTICS === 'true'
}
