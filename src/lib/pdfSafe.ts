/**
 * The standard fonts encode WinAnsi only. A name with characters outside it
 * would make pdf-lib throw, so accents are folded and anything else becomes
 * "?" rather than failing the export. Pure: the entry screen measures with it too.
 */
export function pdfSafe(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
}
