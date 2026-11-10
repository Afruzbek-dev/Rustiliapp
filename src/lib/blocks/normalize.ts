/**
 * Normalises a Russian word for glossary / lesson_words lookup: lowercase, ё -> е, no stress
 * marks, no surrounding punctuation. Hyphens inside the word are kept ("кто-то").
 */
export function normalizeWord(input: string): string {
  const folded = input.normalize("NFC").toLowerCase().replace(/ё/g, "е");
  return folded
    .normalize("NFD")
    .replace(/[̀́]/g, "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}-]/gu, "")
    .replace(/^-+|-+$/g, "");
}

/** Splits a whitespace-delimited token into leading punctuation, the word core and trailing punctuation. */
export function splitToken(token: string): { lead: string; core: string; trail: string } {
  const m = /^([^\p{L}\p{N}\p{M}]*)(.*?)([^\p{L}\p{N}\p{M}]*)$/su.exec(token);
  return { lead: m?.[1] ?? "", core: m?.[2] ?? token, trail: m?.[3] ?? "" };
}
