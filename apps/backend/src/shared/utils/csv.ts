export type CsvValue = string | number | boolean | null | undefined

// Text a spreadsheet would run as a formula, such as a key name starting with
// "=", gets a leading apostrophe. Numbers are written as they are, so a
// negative one stays a number.
const FORMULA_START = /^[=+\-@\t\r]/

const cell = (value: CsvValue): string => {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (typeof value === 'string' && FORMULA_START.test(text)) {
    text = `'${text}`
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** One CSV line (RFC 4180), ending in CRLF. */
export const csvRow = (values: CsvValue[]): string =>
  `${values.map(cell).join(',')}\r\n`

export const toCsv = (header: string[], rows: CsvValue[][]): string =>
  [header, ...rows].map(csvRow).join('')
