import type { Bot } from "grammy";
import {
  claimNonce,
  confirmNonce,
  ensureAuthUser,
  getNonce,
  isLiveNonce,
  latestNonceFor,
  normalizePhone,
  upsertProfile,
  type Db,
} from "@/lib/telegram/api";
import { contactKeyboard } from "@/lib/telegram/keyboards";

export const MSG = {
  share: "Telefon raqamingizni ulashing",
  expired: "Havola eskirgan, saytdan qayta urinib ko'ring",
  foreign: "Faqat o'z raqamingizni ulashing",
  done: "Saytga qayting",
  error: "Xatolik yuz berdi, birozdan keyin qayta urinib ko'ring",
} as const;

const START_PREFIX = "login_";

export function registerLogin(bot: Bot, getDb: () => Db) {
  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim() ?? "";
    const from = ctx.from;
    if (!from || !payload.startsWith(START_PREFIX)) return; // other deep links are handled elsewhere
    const nonce = payload.slice(START_PREFIX.length);
    const db = getDb();
    const row = nonce ? await getNonce(db, nonce) : null;
    if (!isLiveNonce(row) || row.status !== "created" || !(await claimNonce(db, nonce, from.id))) {
      await ctx.reply(MSG.expired);
      return;
    }
    await ctx.reply(MSG.share, { reply_markup: contactKeyboard() });
  });

  bot.on("message:contact", async (ctx) => {
    const from = ctx.from;
    const contact = ctx.message.contact;
    if (contact.user_id !== from.id) {
      await ctx.reply(MSG.foreign);
      return;
    }
    const db = getDb();
    const pending = await latestNonceFor(db, from.id);
    if (!pending) {
      await ctx.reply(MSG.expired, { reply_markup: { remove_keyboard: true } });
      return;
    }
    if (pending.status === "created") {
      const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ");
      const id = await ensureAuthUser(db, from.id, fullName);
      await upsertProfile(db, {
        id,
        telegramId: from.id,
        phone: normalizePhone(contact.phone_number),
        fullName,
        username: from.username ?? null,
      });
      await confirmNonce(db, pending.nonce, from.id);
    }
    // status "confirmed": a Telegram retry/duplicate; nothing more to do.
    await ctx.reply(MSG.done, { reply_markup: { remove_keyboard: true } });
  });
}
