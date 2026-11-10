import type { Bot } from "grammy";
import type { Db } from "@/lib/telegram/api";
import { logBotError } from "@/lib/telegram/log";
import { approveEnrollment, EnrollmentError, rejectEnrollment } from "@/server/enrollment";

export const ENR_MSG = {
  denied: "Ruxsat yo'q",
  notFound: "So'rov topilmadi",
  opened: "Kurs ochildi! Ilovaga qaytib, davom eting.",
  noGroup: "kurator guruhi biriktirilmagan",
  alreadyActive: "allaqachon ruxsat berilgan, rad etib bo'lmaydi",
} as const;

const CALLBACK_RE = /^enr:(approve|reject):([0-9a-f-]{36})$/;
const NO_BUTTONS = { inline_keyboard: [] as never[] };

/** Staff-chat approval buttons. Every press is authorised by the server function, never by the payload. */
export function registerEnrollment(bot: Bot, getDb: () => Db) {
  bot.callbackQuery(CALLBACK_RE, async (ctx) => {
    const [, action, enrollmentId] = CALLBACK_RE.exec(ctx.callbackQuery.data)!;
    const db = getDb();

    const { data: actor, error } = await db
      .from("profiles")
      .select("id, full_name")
      .eq("telegram_id", ctx.from.id)
      .maybeSingle();
    if (error) throw new EnrollmentError("db", "actorLookup", error.code);
    const actorRow = actor as { id: string; full_name: string } | null;
    if (!actorRow) {
      await ctx.answerCallbackQuery({ text: ENR_MSG.denied, show_alert: true });
      return;
    }

    let text: string;
    let notifyStudent: number | null = null;
    try {
      if (action === "approve") {
        const res = await approveEnrollment(db, enrollmentId!, actorRow.id);
        const group = res.groupName ?? ENR_MSG.noGroup;
        text = `Ruxsat berildi: ${res.studentName} -> ${group} (${actorRow.full_name})`;
        if (res.outcome === "approved") notifyStudent = res.studentTelegramId;
      } else {
        const res = await rejectEnrollment(db, enrollmentId!, actorRow.id);
        text =
          res.outcome === "conflict"
            ? `Ruxsat berilgan: ${res.studentName} (${ENR_MSG.alreadyActive})`
            : `Rad etildi: ${res.studentName} (${actorRow.full_name})`;
      }
    } catch (e) {
      if (e instanceof EnrollmentError && (e.code === "forbidden" || e.code === "not_found")) {
        await ctx.answerCallbackQuery({
          text: e.code === "forbidden" ? ENR_MSG.denied : ENR_MSG.notFound,
          show_alert: true,
        });
        return;
      }
      throw e;
    }

    await ctx.answerCallbackQuery();
    // "message is not modified" on a repeated press is expected: ignore it.
    await ctx.editMessageText(text, { reply_markup: NO_BUTTONS }).catch(() => undefined);
    if (notifyStudent !== null) {
      try {
        await ctx.api.sendMessage(notifyStudent, ENR_MSG.opened);
      } catch (e) {
        logBotError(e, ctx.update.update_id);
      }
    }
  });
}
