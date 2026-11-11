import type { Bot } from "grammy";
import {
  startVideoTask,
  submitTelegramVideo,
  TASK_PAYLOAD_RE,
  type VideoDeps,
  type VideoOutcome,
} from "@/server/video-submissions";

export const VIDEO_MSG = {
  unknownUser: "Avval ilovada kiring",
  started: "Endi video-krujok yuboring (60 soniyagacha)",
  notAvailable: "Bu topshiriq siz uchun mavjud emas",
  noSession: "Avval ilovadagi topshiriqdan tugmani bosing",
  tooBig: "Video juda katta. Qisqaroq video yuboring (20 MB gacha)",
  accepted: "Qabul qilindi. Kurator baholagach xabar olasiz.",
  already: "Bu video allaqachon qabul qilingan",
  rateLimited: "Juda ko'p urinish. 10 daqiqadan keyin qayta urinib ko'ring",
  duplicateOther: "Bu video allaqachon yuborilgan. Yangi video yozing",
  duplicateElsewhere: "Bu video boshqa topshiriq uchun yuborilgan",
  inProgress: "Qabul qilinmoqda, bir daqiqa kuting",
  notifyFailed: "Video saqlandi, lekin kuratorga yuborilmadi. Birozdan keyin shu videoni qayta yuboring",
} as const;

const REPLY: Record<VideoOutcome, string> = {
  accepted: VIDEO_MSG.accepted,
  already: VIDEO_MSG.already,
  notify_failed: VIDEO_MSG.notifyFailed,
  unknown_user: VIDEO_MSG.unknownUser,
  too_big: VIDEO_MSG.tooBig,
  no_session: VIDEO_MSG.noSession,
  not_available: VIDEO_MSG.notAvailable,
  rate_limited: VIDEO_MSG.rateLimited,
  duplicate_other: VIDEO_MSG.duplicateOther,
  duplicate_elsewhere: VIDEO_MSG.duplicateElsewhere,
  in_progress: VIDEO_MSG.inProgress,
};

export interface VideoWiring {
  deps: () => VideoDeps;
  archiveChatId: () => string;
}

/**
 * Video-krujok flow, private chats only. Everything is keyed by `from.id` (the sender), never by
 * the chat or by anything in the payload. Errors propagate to the bot's error boundary (generic
 * reply, op/code-only log).
 */
export function registerVideo(bot: Bot, wiring: VideoWiring) {
  const priv = bot.chatType("private");

  priv.command("start", async (ctx, next) => {
    const m = TASK_PAYLOAD_RE.exec(ctx.match?.trim() ?? "");
    const from = ctx.from;
    if (!m || !from) return next(); // other deep links (login_...) are handled elsewhere
    const outcome = await startVideoTask(wiring.deps(), from.id, m[1]!.toLowerCase());
    await ctx.reply(
      outcome === "ok" ? VIDEO_MSG.started : outcome === "unknown_user" ? VIDEO_MSG.unknownUser : VIDEO_MSG.notAvailable,
    );
  });

  priv.on(["message:video_note", "message:video"], async (ctx) => {
    const from = ctx.from;
    const media = ctx.msg.video_note ?? ctx.msg.video;
    if (!from || !media) return;
    const chatId = ctx.chat.id;
    const messageId = ctx.msg.message_id;
    const outcome = await submitTelegramVideo(wiring.deps(), {
      telegramId: from.id,
      fileId: media.file_id,
      fileUniqueId: media.file_unique_id,
      size: media.file_size,
      copyToArchive: async () => (await ctx.api.copyMessage(wiring.archiveChatId(), chatId, messageId)).message_id,
      deleteArchiveCopy: async (id) => void (await ctx.api.deleteMessage(wiring.archiveChatId(), id)),
    });
    await ctx.reply(REPLY[outcome]);
  });
}
