import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";
import type { TelegramLinkDeps } from "@/server/manage";

type Service = ReturnType<typeof createServiceClient>;

/** The slice of the Bot API the manual link needs. */
export interface ChatLookup {
  getChat(id: number): Promise<{ id: number; type: string; username?: string }>;
}

/**
 * Production wiring of the manual Telegram link (see manage.ts): the id must resolve to a PRIVATE
 * chat with that very user (only people who started the bot do), and is mirrored into the auth
 * user's app_metadata, which the login exchange requires next to profiles.telegram_id.
 */
export function telegramLinkDeps(db: Service, api: ChatLookup): TelegramLinkDeps {
  return {
    async verifyUser(telegramId) {
      try {
        const chat = await api.getChat(telegramId);
        if (chat.type !== "private" || chat.id !== telegramId) return null;
        return { username: chat.username ?? null };
      } catch {
        return null;
      }
    },
    async mirrorToAuth(profileId, telegramId) {
      const { data, error } = await db.auth.admin.getUserById(profileId);
      if (error || !data.user) return "failed";
      const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
      const current = meta.telegram_id;
      if (current === telegramId) return "ok";
      if (current !== undefined && current !== null) return "conflict";
      const { error: updateError } = await db.auth.admin.updateUserById(profileId, {
        app_metadata: { ...meta, telegram_id: telegramId },
      });
      return updateError ? "failed" : "ok";
    },
  };
}
