import { Keyboard } from "grammy";

/** One-time, resized keyboard with a single "share my phone number" button. */
export function contactKeyboard() {
  return new Keyboard().requestContact("Telefon raqamini ulashish").oneTime().resized();
}
