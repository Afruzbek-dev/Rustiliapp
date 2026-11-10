import { InlineKeyboard, Keyboard } from "grammy";

/** One-time, resized keyboard with a single "share my phone number" button. */
export function contactKeyboard() {
  return new Keyboard().requestContact("Telefon raqamini ulashish").oneTime().resized();
}

/** Explicit confirm / cancel of a web login request; callback_data carries the nonce. */
export function confirmKeyboard(nonce: string) {
  return new InlineKeyboard()
    .text("Ha, bu men - saytga kirish", `lg:ok:${nonce}`)
    .row()
    .text("Yo'q, bekor qilish", `lg:no:${nonce}`);
}
