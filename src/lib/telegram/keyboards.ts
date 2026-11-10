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
