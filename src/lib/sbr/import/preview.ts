/**
 * The whole import check for one uploaded file: read it, validate every row,
 * and compare with the stored cases. Saves nothing.
 */
import { classifyRows } from './classify'
import { parseUpload } from './parseUpload'
import type { ExistingCase, ImportPreview } from './types'
import { DEFAULT_VALIDATE_OPTIONS, validateRow, type ValidateOptions } from './validateRow'

export function previewUpload(
  bytes: Uint8Array,
  fileName: string,
  existing: readonly ExistingCase[],
  options: ValidateOptions = DEFAULT_VALIDATE_OPTIONS,
): ImportPreview {
  const { tabs, rows } = parseUpload(bytes, fileName)
  return classifyRows(
    rows.map((row) => validateRow(row, options)),
    existing,
    tabs,
  )
}
