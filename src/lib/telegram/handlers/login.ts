import type { Bot } from "grammy";
import {
  cancelNonce,
  claimNonce,
  confirmNonce,
  deleteAuthUser,
  ensureAuthUser,
  getNonce,
  isLiveNonce,
  latestNonceFor,
  normalizePhone,
  profileByPhone,
  TelegramDbError,
  upsertProfile,
  type Db,
} from "@/lib/telegram/api";
import { serverEnv } from "@/lib/env";
import { confirmKeyboard, contactKeyboard, enrollmentKeyboard } from "@/lib/telegram/keyboards";
import { ensurePendingEnrollment } from "@/server/enrollment";
import { logBotError } from "@/lib/telegram/log";
import { loginMatchCode } from "@/lib/telegram/match-code";

export const MSG = {
  share: "Telefon raqamingizni ulashing",
  expired: "Havola eskirgan, saytdan qayta urinib ko'ring",
  foreign: "Faqat o'z raqamingizni ulashing",
  received: "Raqam qabul qilindi",
  done: "Saytga qayting",
  cancelled: "Bekor qilindi",
  error: "Xatolik yuz berdi, birozdan keyin qayta urinib ko'ring",
  badPhone: "Telefon raqami noto'g'ri formatda, ustozga murojaat qiling",
  phoneTaken: "Bu raqam boshqa akkauntga bog'langan, ustozga murojaat qiling",
  accountProblem: "Akkauntni ulashda muammo bor, ustozga murojaat qiling",
  noCohort: "Hozircha ochiq guruh yo'q, ustozga murojaat qiling",
} as const;

const START_PREFIX = "login_";
const NONCE_RE = /^[A-Za-z0-9_-]{32}$/;
const CALLBACK_RE = /^lg:(ok|no):([A-Za-z0-9_-]{32})$/;

function tashkentTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function confirmText(nonce: string, createdAt: string): string {
  return [
    `Saytdagi kirish so'rovi: soat ${tashkentTime(createdAt)}`,
    `Tasdiqlash kodi: ${loginMatchCode(nonce)}`,
    "Saytda ko'rsatilgan kod bilan bir xil bo'lsagina tasdiqlang.",
    "Agar siz hozir saytda 'Kirish' tugmasini bosmagan bo'lsangiz, bosmang.",
  ].join("\n");
}

export function registerLogin(bot: Bot, getDb: () => Db) {
  const priv = bot.chatType("private");

  priv.command("start", async (ctx, next) => {
    const payload = ctx.match?.trim() ?? "";
    const from = ctx.from;
    if (!from || !payload.startsWith(START_PREFIX)) return next(); // other deep links are handled elsewhere
    const nonce = payload.slice(START_PREFIX.length);
    if (!NONCE_RE.test(nonce)) {
      await ctx.reply(MSG.expired);
      return;
    }
    const db = getDb();
    const row = await getNonce(db, nonce);
    if (!isLiveNonce(row) || row.status !== "created" || !(await claimNonce(db, nonce, from.id))) {
      await ctx.reply(MSG.expired);
      return;
    }
    await ctx.reply(MSG.share, { reply_markup: contactKeyboard() });
  });

  priv.on("message:contact", async (ctx) => {
    const from = ctx.from;
    const contact = ctx.message.contact;
    const remove = { remove_keyboard: true } as const;
    if (contact.user_id !== from.id || ctx.message.forward_origin) {
      await ctx.reply(MSG.foreign);
      return;
    }
    const phone = normalizePhone(contact.phone_number);
    if (!phone) {
      await ctx.reply(MSG.badPhone, { reply_markup: remove });
      return;
    }
    const db = getDb();
    const pending = await latestNonceFor(db, from.id);
    if (!pending) {
      await ctx.reply(MSG.expired, { reply_markup: remove });
      return;
    }
    if (pending.status === "confirmed") {
      // Telegram retry / duplicate after confirmation.
      await ctx.reply(MSG.done, { reply_markup: remove });
      return;
    }
    const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ");
    let createdUserId: string | null = null;
    let profileId = "";
    try {
      const holder = await profileByPhone(db, phone);
      if (holder && holder.telegram_id !== from.id) {
        await ctx.reply(MSG.phoneTaken, { reply_markup: remove });
        return;
      }
      const user = await ensureAuthUser(db, from.id, fullName);
      if (user.created) createdUserId = user.id;
      profileId = user.id;
      await upsertProfile(db, {
        id: user.id,
        telegramId: from.id,
        phone,
        fullName,
        username: from.username ?? null,
      });
    } catch (error) {
      if (createdUserId) await deleteAuthUser(db, createdUserId);
      if (error instanceof TelegramDbError && error.code === "phone_conflict") {
        await ctx.reply(MSG.phoneTaken, { reply_markup: remove });
        return;
      }
      if (error instanceof TelegramDbError && error.code === "untrusted_auth_user") {
        logBotError(error, ctx.update.update_id);
        await ctx.reply(MSG.accountProblem, { reply_markup: remove });
        return;
      }
      throw error;
    }
    // A pending enrollment never grants content access (RLS requires active); staff approve it.
    const enrollment = await ensurePendingEnrollment(db, profileId);
    if (enrollment.created) {
      try {
        await ctx.api.sendMessage(serverEnv().TELEGRAM_STAFF_CHAT_ID, `Yangi o'quvchi: ${fullName}, ${phone}`, {
          reply_markup: enrollmentKeyboard(enrollment.enrollment.id),
        });
      } catch (error) {
        logBotError(error, ctx.update.update_id); // never fails the student's flow
      }
    } else if (enrollment.reason === "exists" && enrollment.enrollment.status === "pending") {
      // The staff message may have been lost; re-sending would need state, so only leave a trace.
      console.info("telegram bot", { op: "ensureEnrollment", note: "pending exists, staff not re-notified", update_id: ctx.update.update_id });
    }
    // The session is only released once the user presses the inline confirm button.
    await ctx.reply(MSG.received, { reply_markup: remove });
    if (!enrollment.created && enrollment.reason === "no_cohort") await ctx.reply(MSG.noCohort);
    await ctx.reply(confirmText(pending.nonce, pending.created_at), {
      reply_markup: confirmKeyboard(pending.nonce),
    });
  });

  priv.callbackQuery(CALLBACK_RE, async (ctx) => {
    const [, action, nonce] = CALLBACK_RE.exec(ctx.callbackQuery.data)!;
    const from = ctx.from;
    const db = getDb();
    if (action === "no") {
      await cancelNonce(db, nonce!, from.id);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(MSG.cancelled).catch(() => undefined);
      return;
    }
    if (await confirmNonce(db, nonce!, from.id)) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(MSG.done).catch(() => undefined);
      return;
    }
    await ctx.answerCallbackQuery({ text: MSG.expired, show_alert: true });
  });
}
