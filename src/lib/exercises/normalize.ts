/** Normalizes a free-text answer: whitespace, case, ё→е, stress marks, trailing .!? */
export function normalize(s: string): string {
  return s
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\u0451/g, '\u0435')
    .replace(/\u0301/g, '')
    .replace(/[.!?]+$/, '')
    .trim()
}
