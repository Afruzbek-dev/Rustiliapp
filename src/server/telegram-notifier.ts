import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type { TgApi } from "@/lib/telegram/api-client";
import { getTelegramApi } from "@/lib/telegram/api-client";
import { TelegramDbError } from "@/lib/telegram/api";
import { reviewKeyboard } from "@/lib/telegram/keyboards";
import { createServiceClient } from "@/lib/supabase/service";
import type { CuratorNotifier } from "./notify-curators";

export interface NoticeSubmission {
  id: string;
  kind: string;
  storagePath: string | null;
  tgFileId: string | null;
  archiveMessageId: number | null;
  curatorMessageId: number | null;
  curatorGroupId: string | null;
  /** curator_groups.telegram_chat_id of the submission's group (null when unset). */
  groupChatId: number | null;
  studentName: string;
  lessonTitle: string | null;
  exercisePrompt: string | null;
}

export interface NotifierStore {
  getSubmission(submissionId: string): Promise<NoticeSubmission | null>;
  saveCuratorMessage(submissionId: string, chatId: number, messageId: number): Promise<void>;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** "Ali Valiyev" -> "Ali V." (first name + last initial). */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "O'quvchi";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${[...parts[parts.length - 1]!][0]!.toUpperCase()}.`;
}

export function noticeTitle(s: Pick<NoticeSubmission, "lessonTitle" | "exercisePrompt">): string {
  const prompt = s.exercisePrompt ? [...s.exercisePrompt.replace(/\s+/g, " ").trim()].slice(0, 60).join("") : "";
  return [s.lessonTitle, prompt].filter(Boolean).join(" · ") || "Gapirish topshirig'i";
}

export interface NotifierOptions {
  store: NotifierStore;
  api: TgApi;
  archiveChatId: string;
  staffChatId: string;
  appUrl: string;
  log?: (line: string) => void;
}

/**
 * Sends a completed submission to its curator group with the rubric keyboard:
 *   video -> a short header line, then copyMessage of the archived video carrying the keyboard;
 *   audio -> a text message "<Ali V.> · <lesson/exercise>" with a "Veb'da eshitish" link + keyboard.
 * The chat is the group's telegram_chat_id, else TELEGRAM_STAFF_CHAT_ID (logged without PII).
 * The keyboard message's chat/message id are stored on the submission (for the later edit).
 * Idempotent: a submission that already has a curator message is not sent again; unfinished uploads
 * (audio without storage_path, video without tg_file_id) are ignored.
 */
export function createTelegramCuratorNotifier(o: NotifierOptions): CuratorNotifier {
  const log = o.log ?? ((line: string) => console.info(line));
  return {
    async notify(submissionId) {
      const s = await o.store.getSubmission(submissionId);
      if (!s) {
        log(`notify-curators: submission ${submissionId} not found`);
        return;
      }
      if (s.curatorMessageId !== null) return; // already sent (retry after a failed markNotified)
      const complete =
        (s.kind === "audio" && !!s.storagePath) ||
        (s.kind === "video" && !!s.tgFileId && s.archiveMessageId !== null);
      if (!complete) {
        log(`notify-curators: submission ${submissionId} is not complete, ignored`);
        return;
      }

      let chat: string | number = o.staffChatId;
      if (s.groupChatId !== null) {
        chat = s.groupChatId;
      } else {
        log(`notify-curators: no telegram chat for the curator group of ${submissionId}, using the staff chat`);
      }
      const keyboard = reviewKeyboard(s.id);
      const head = `${shortName(s.studentName)} · ${noticeTitle(s)}`;

      let messageId: number;
      if (s.kind === "video") {
        await o.api.sendMessage(chat, head);
        const copied = await o.api.copyMessage(chat, o.archiveChatId, s.archiveMessageId!, { reply_markup: keyboard });
        messageId = copied.message_id;
      } else {
        const link = `${o.appUrl.replace(/\/+$/, "")}/curator?s=${s.id}`;
        const sent = await o.api.sendMessage(chat, `${esc(head)}\n<a href="${esc(link)}">Veb'da eshitish</a>`, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: keyboard,
        });
        messageId = sent.message_id;
      }
      const chatId = typeof chat === "number" ? chat : Number(chat);
      // a non-numeric chat reference (e.g. "@channel") cannot be edited later by id: skip storing it
      if (Number.isFinite(chatId)) await o.store.saveCuratorMessage(s.id, chatId, messageId);
    },
  };
}

function check(op: string, error: { code?: string } | null): void {
  if (error) throw new TelegramDbError(op, error.code ?? "unknown");
}

type One<T> = T | T[] | null | undefined;
const one = <T>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export function createSupabaseNotifierStore(service: SupabaseClient): NotifierStore {
  return {
    async getSubmission(id) {
      const { data, error } = await service
        .from("submissions")
        .select(
          "id, kind, storage_path, tg_file_id, tg_archive_message_id, curator_message_id, curator_group_id, " +
            "profiles(full_name), curator_groups(telegram_chat_id), " +
            "exercises(prompt, blocks(lesson_parts(lessons(title))))",
        )
        .eq("id", id)
        .maybeSingle();
      check("notifier.getSubmission", error);
      if (!data) return null;
      const d = data as unknown as Record<string, unknown>;
      const profile = one(d.profiles as One<{ full_name: string | null }>);
      const group = one(d.curator_groups as One<{ telegram_chat_id: number | null }>);
      const ex = one(d.exercises as One<{ prompt: string | null; blocks: One<{ lesson_parts: One<{ lessons: One<{ title: string }> }> }> }>);
      const lesson = one(one(one(ex?.blocks)?.lesson_parts)?.lessons);
      const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        id: d.id as string,
        kind: d.kind as string,
        storagePath: (d.storage_path as string | null) ?? null,
        tgFileId: (d.tg_file_id as string | null) ?? null,
        archiveMessageId: num(d.tg_archive_message_id),
        curatorMessageId: num(d.curator_message_id),
        curatorGroupId: (d.curator_group_id as string | null) ?? null,
        groupChatId: num(group?.telegram_chat_id),
        studentName: profile?.full_name ?? "",
        lessonTitle: lesson?.title ?? null,
        exercisePrompt: ex?.prompt ?? null,
      };
    },

    async saveCuratorMessage(id, chatId, messageId) {
      const { error } = await service
        .from("submissions")
        .update({ curator_chat_id: chatId, curator_message_id: messageId })
        .eq("id", id)
        .is("curator_message_id", null);
      check("notifier.saveCuratorMessage", error);
    },
  };
}

/** Production notifier (built lazily: nothing is read from env at import time). */
export function createDefaultTelegramNotifier(): CuratorNotifier {
  const env = serverEnv();
  return createTelegramCuratorNotifier({
    store: createSupabaseNotifierStore(createServiceClient()),
    api: getTelegramApi(),
    archiveChatId: env.TELEGRAM_ARCHIVE_CHAT_ID,
    staffChatId: env.TELEGRAM_STAFF_CHAT_ID,
    appUrl: env.APP_URL,
  });
}
