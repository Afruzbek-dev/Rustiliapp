import { InlineKeyboard, Keyboard } from "grammy";

/** One-time, resized keyboard with a single "share my phone number" button. */
export function contactKeyboard() {
  return new Keyboard().requestContact("Telefon raqamini ulashish").oneTime().resized();
}

/** Staff approval buttons; callback_data is `enr:<action>:<enrollment uuid>` (<= 48 bytes). */
export function enrollmentKeyboard(enrollmentId: string) {
  return new InlineKeyboard()
    .text("Ruxsat berish", `enr:approve:${enrollmentId}`)
    .text("Rad etish", `enr:reject:${enrollmentId}`);
}

/** Explicit confirm / cancel of a web login request; callback_data carries the nonce. */
export function confirmKeyboard(nonce: string) {
  return new InlineKeyboard()
    .text("Ha, bu men - saytga kirish", `lg:ok:${nonce}`)
    .row()
    .text("Yo'q, bekor qilish", `lg:no:${nonce}`);
}

/** Rubric rows: callback code, criterion key, button prefix (first button of the row), full label. */
export const REVIEW_ROWS = [
  { code: "cm", key: "completeness", short: "Matn", label: "Matnni to'liq aytdi" },
  { code: "pr", key: "pronunciation", short: "Talaffuz", label: "Talaffuz" },
  { code: "gr", key: "grammar", short: "Grammatika", label: "Grammatika" },
  { code: "fl", key: "fluency", short: "Ravonlik", label: "Ravonlik" },
] as const;
export type ReviewCode = (typeof REVIEW_ROWS)[number]["code"];

/** Marker of the chosen value in a row: a plain text character, not an emoji. */
export const mark = (v: number): string => `[${v}]`;

/**
 * Curator rubric keyboard: 4 rows (one per criterion) x 5 buttons (1..5) and a "Saqlash" row.
 * callback_data is exactly `rv:<submissionId>:<c>:<v>` (c in cm|pr|gr|fl, v 1..5) and
 * `rv:<submissionId>:save` (at most 44 bytes). The chosen value of a row is shown as "[v]"; the
 * first button of each row also carries the criterion name.
 */
export function reviewKeyboard(submissionId: string, draft: Partial<Record<string, number>> = {}) {
  const kb = new InlineKeyboard();
  for (const row of REVIEW_ROWS) {
    for (let v = 1; v <= 5; v++) {
      const text = draft[row.key] === v ? mark(v) : String(v);
      kb.text(v === 1 ? `${row.short} ${text}` : text, `rv:${submissionId}:${row.code}:${v}`);
    }
    kb.row();
  }
  kb.text("Saqlash", `rv:${submissionId}:save`);
  return kb;
}
