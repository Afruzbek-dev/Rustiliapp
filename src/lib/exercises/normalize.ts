/** Normalizes a free-text answer: whitespace, case, ё→е, stress marks, trailing .!? */
export function normalize(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/́/g, '')
    .replace(/[.!?]+$/, '')
    .trim()
}
