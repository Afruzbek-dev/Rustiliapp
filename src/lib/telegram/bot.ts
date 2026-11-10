import "server-only";
import { Bot, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { serverEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";
import type { Db } from "@/lib/telegram/api";
import { MSG, registerLogin } from "@/lib/telegram/handlers/login";

/** Builds a bot with all handlers; `getDb` and `botInfo` are injectable for tests. */
export function createBot(token: string, getDb: () => Db = createServiceClient, botInfo?: UserFromGetMe) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  // Errors never escape: a non-2xx would make Telegram retry the same update forever.
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      // Log only the error name: messages and updates may contain phone numbers.
      console.error("telegram handler failed:", error instanceof Error ? error.name : "unknown");
      try {
        await ctx.reply(MSG.error);
      } catch {
        // ignore: answering 200 matters more than the notice
      }
    }
  });
  registerLogin(bot, getDb);
  return bot;
}

let instance: Bot | undefined;

/** Lazy singleton: nothing is read from env at import time (so `next build` needs no secrets). */
export function getBot(): Bot {
  return (instance ??= createBot(serverEnv().TELEGRAM_BOT_TOKEN));
}

export function getWebhookHandler() {
  return webhookCallback(getBot(), "std/http");
}
