import "server-only";
import { Bot, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { serverEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";
import type { Db } from "@/lib/telegram/api";
import { registerEnrollment } from "@/lib/telegram/handlers/enrollment";
import { MSG, registerLogin } from "@/lib/telegram/handlers/login";
import { registerVideo, type VideoWiring } from "@/lib/telegram/handlers/video";
import { logBotError } from "@/lib/telegram/log";
import { bumpDailyTask } from "@/server/daily-tasks";
import { notifyCuratorsOfSubmission } from "@/server/notify-curators";
import { createSupabaseVideoStore } from "@/server/video-store";

function defaultVideoWiring(getDb: () => Db): VideoWiring {
  return {
    deps: () => {
      const db = getDb();
      return {
        store: createSupabaseVideoStore(db),
        bumpSpeaking: (studentId) => bumpDailyTask(db, studentId, "speaking"),
        notify: notifyCuratorsOfSubmission,
      };
    },
    archiveChatId: () => serverEnv().TELEGRAM_ARCHIVE_CHAT_ID,
  };
}

/** Builds a bot with all handlers; `getDb`, `botInfo` and the video wiring are injectable for tests. */
export function createBot(
  token: string,
  getDb: () => Db = createServiceClient,
  botInfo?: UserFromGetMe,
  video: VideoWiring = defaultVideoWiring(getDb),
) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  // Errors never escape: a non-2xx would make Telegram retry the same update forever.
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      logBotError(error, ctx.update.update_id);
      try {
        if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: MSG.error, show_alert: true });
        else await ctx.reply(MSG.error);
      } catch {
        // ignore: answering 200 matters more than the notice
      }
    }
  });
  registerLogin(bot, getDb);
  registerVideo(bot, video);
  registerEnrollment(bot, getDb);
  return bot;
}

let instance: Bot | undefined;
let handler: ((req: Request) => Promise<Response>) | undefined;

/** Lazy singleton: nothing is read from env at import time (so `next build` needs no secrets). */
export function getBot(): Bot {
  return (instance ??= createBot(serverEnv().TELEGRAM_BOT_TOKEN));
}

export function getWebhookHandler() {
  return (handler ??= webhookCallback(getBot(), "std/http"));
}
