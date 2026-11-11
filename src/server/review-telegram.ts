import "server-only";
import type { TgApi } from "@/lib/telegram/api-client";
import type { ReviewTelegram } from "./reviews";

const NO_BUTTONS = { inline_keyboard: [] as never[] };

/** Telegram side effects of a review: the student's DM and the curator message edit. */
export function createReviewTelegram(api: TgApi): ReviewTelegram {
  return {
    async sendDm(chatId, text) {
      await api.sendMessage(chatId, text);
    },

    async markReviewed({ chatId, messageId, kind, text }) {
      if (kind !== "video") {
        // text message (audio notice): replace the text and drop the keyboard in one call
        await api.editMessageText(chatId, messageId, text, { reply_markup: NO_BUTTONS });
        return;
      }
      // A video message has no text. A regular video accepts a caption; a video note does not, so
      // fall back to removing the keyboard and replying with the result.
      try {
        await api.editMessageCaption(chatId, messageId, { caption: text, reply_markup: NO_BUTTONS });
      } catch {
        await api.editMessageReplyMarkup(chatId, messageId, { reply_markup: NO_BUTTONS });
        await api.sendMessage(chatId, text, { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } });
      }
    },
  };
}
