import { icaFileToCsv, isXlsxBytes } from './csv'
import { readIcaXlsx } from './read'

/**
 * An uploaded ATO account file as the ATO's CSV text, whichever it is: the
 * ATO's CSV as it is, or an RBA ICA spreadsheet (.xlsx, columns A–F from row
 * 9) written as that CSV with every cell as printed. Null when a spreadsheet
 * is not in that layout. The analyses and the account-type check read the
 * text, so a spreadsheet goes through exactly the same steps as a CSV.
 */
export async function atoAccountText(bytes: Uint8Array): Promise<string | null> {
  if (!isXlsxBytes(bytes)) return new TextDecoder('utf-8').decode(bytes)
  try {
    return icaFileToCsv(readIcaXlsx(bytes))
  } catch {
    return null
  }
}

export const ATO_UPLOAD_EXTENSIONS = /\.(csv|xlsx)$/i
