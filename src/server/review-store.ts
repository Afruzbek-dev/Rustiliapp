import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTelegramApi } from "@/lib/telegram/api-client";
import { TelegramDbError } from "@/lib/telegram/api";
import { createServiceClient } from "@/lib/supabase/service";
import { createReviewTelegram } from "./review-telegram";
import type { ReviewBotStore } from "@/lib/telegram/handlers/review";
import { CRITERIA, type ReviewDeps, type ReviewNotice, type ReviewStore, type Scores, type SubmitOutcome } from "./reviews";

type DbErrorLike = { code?: string } | null;
function check(op: string, error: DbErrorLike): void {
  if (error) throw new TelegramDbError(op, error.code ?? "unknown");
}

/** Service-role backed ReviewStore (the SQL functions are executable by service_role only). */
export function createSupabaseReviewStore(service: SupabaseClient): ReviewStore {
  return {
    async submit(a): Promise<SubmitOutcome> {
      const { data, error } = await service.rpc("submit_review", {
        p_submission: a.submissionId,
        p_reviewer: a.reviewerId,
        p_channel: a.channel,
        p_scores: a.scores,
        p_comment: a.comment,
      });
      check("submit_review", error);
      const r = (Array.isArray(data) ? data[0] : data) as
        | { outcome: string; review_id: string | null; total: number | string | null; is_override: boolean | null; student_id: string | null }
        | null;
      if (!r) throw new TelegramDbError("submit_review", "empty");
      if (r.outcome === "ok" && r.review_id && r.student_id && r.total !== null) {
        return { outcome: "ok", reviewId: r.review_id, total: Number(r.total), isOverride: r.is_override === true, studentId: r.student_id };
      }
      if (r.outcome === "forbidden" || r.outcome === "not_found" || r.outcome === "incomplete" || r.outcome === "already_reviewed") {
        return { outcome: r.outcome };
      }
      throw new TelegramDbError("submit_review", "unexpected");
    },

    async awardSpeakingXp(studentId, amount, submissionId) {
      const { data, error } = await service.rpc("award_xp", {
        p_student: studentId,
        p_amount: amount,
        p_reason: "speaking_reviewed",
        p_ref: submissionId,
      });
      check("award_xp", error);
      return data === true;
    },

    async getNotice(submissionId, reviewerId): Promise<ReviewNotice | null> {
      const { data: sub, error } = await service
        .from("submissions")
        .select("kind, student_id, curator_chat_id, curator_message_id")
        .eq("id", submissionId)
        .maybeSingle();
      check("getNotice", error);
      if (!sub) return null;
      const [student, reviewer] = await Promise.all([
        service.from("profiles").select("telegram_id").eq("id", sub.student_id as string).maybeSingle(),
        service.from("profiles").select("full_name").eq("id", reviewerId).maybeSingle(),
      ]);
      check("getNotice(student)", student.error);
      check("getNotice(reviewer)", reviewer.error);
      const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        kind: sub.kind as string,
        studentTelegramId: num(student.data?.telegram_id),
        curatorChatId: num(sub.curator_chat_id),
        curatorMessageId: num(sub.curator_message_id),
        reviewerName: (reviewer.data?.full_name as string | null | undefined) ?? null,
      };
    },
  };
}

/** Service-role reads/writes behind the Telegram rubric buttons. */
export function createSupabaseReviewBotStore(service: SupabaseClient): ReviewBotStore {
  const only = (d: unknown): Partial<Scores> => {
    const out: Partial<Scores> = {};
    for (const c of CRITERIA) {
      const v = (d as Record<string, unknown> | null)?.[c];
      if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5) out[c] = v;
    }
    return out;
  };
  return {
    async getReviewer(telegramId) {
      const { data, error } = await service.from("profiles").select("id").eq("telegram_id", telegramId).maybeSingle();
      check("getReviewer", error);
      return data ? { id: data.id as string } : null;
    },
    async authority(submissionId, profileId) {
      const { data, error } = await service.rpc("review_authority", { p_submission: submissionId, p_reviewer: profileId });
      check("review_authority", error);
      return data === "curator" || data === "staff" ? data : null;
    },
    async setDraft(submissionId, criterion, value) {
      const { data, error } = await service.rpc("set_draft_score", { p_submission: submissionId, p_criterion: criterion, p_value: value });
      check("set_draft_score", error);
      return data ? only(data) : null;
    },
    async getDraftState(submissionId) {
      const { data, error } = await service.from("submissions").select("status, draft_scores").eq("id", submissionId).maybeSingle();
      check("getDraftState", error);
      return data ? { status: data.status as "pending" | "reviewed", draft: only(data.draft_scores) } : null;
    },
  };
}

/** Production dependencies (built lazily: nothing is read from env at import time). */
export function defaultReviewDeps(): ReviewDeps {
  return { store: createSupabaseReviewStore(createServiceClient()), telegram: createReviewTelegram(getTelegramApi()) };
}
