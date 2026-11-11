import "server-only";
import { Api } from "grammy";
import { serverEnv } from "@/lib/env";

/** Lazy Bot API client for server-initiated messages (no webhook update needed). */
let api: Api | undefined;
export function getTelegramApi(): Api {
  return (api ??= new Api(serverEnv().TELEGRAM_BOT_TOKEN));
}

/** The slice of the Bot API the review/notification code uses (fakes implement this in tests). */
export type TgApi = Pick<Api, "sendMessage" | "copyMessage" | "editMessageText" | "editMessageCaption" | "editMessageReplyMarkup">;
