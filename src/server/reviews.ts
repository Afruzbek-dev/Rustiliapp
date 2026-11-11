import "server-only";
import { z } from "zod";

export const CRITERIA = ["completeness", "pronunciation", "grammar", "fluency"] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Scores = Record<Criterion, number>;

const score = z.number().int().min(1).max(5);
/** Exactly the four rubric keys, each an integer 1..5 (the table check enforces the same). */
export const scoresSchema = z
  .object({ completeness: score, pronunciation: score, grammar: score, fluency: score })
  .strict();
export const MAX_COMMENT = 1000;
const comment = z
  .string()
  .max(MAX_COMMENT)
  .transform((c) => c.trim())
  .nullish()
  .transform((c) => (c ? c : null));

export const reviewInputSchema = z.object({
  submissionId: z.string().uuid(),
  reviewerProfileId: z.string().uuid(),
  scores: scoresSchema,
  comment,
  channel: z.enum(["web", "telegram"]),
  /** explicit staff override of an already reviewed submission (web only) */
  override: z.boolean().optional(),
});
export type ReviewInput = z.input<typeof reviewInputSchema>;

/** Body of POST /api/reviews: the reviewer is never part of it. */
export const reviewBodySchema = z
  .object({ submissionId: z.string().uuid(), scores: scoresSchema, comment, override: z.boolean().optional() })
  .strict();

export type ReviewErrorCode =
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "incomplete"
  | "unsupported_kind"
  | "already_reviewed";

/** Typed failure; `message` is just the code, never row data. */
export class ReviewError extends Error {
  constructor(public readonly code: ReviewErrorCode) {
    super(`review error (${code})`);
    this.name = "ReviewError";
  }
}

export type SubmitOutcome =
  | { outcome: "ok"; reviewId: string; total: number; isOverride: boolean; studentId: string; xpAwarded: boolean }
  | { outcome: "duplicate"; reviewId: string; total: number }
  | { outcome: "forbidden" | "not_found" | "incomplete" | "unsupported_kind" | "already_reviewed" };

export interface ReviewNotice {
  kind: string;
  studentTelegramId: number | null;
  curatorChatId: number | null;
  curatorMessageId: number | null;
  reviewerName: string | null;
}

/** Data access. Production: service client + SQL functions (review-store.ts). */
export interface ReviewStore {
  /** SQL submit_review: authority check, status flip and review insert in ONE transaction. */
  submit(a: {
    submissionId: string;
    reviewerId: string;
    channel: "web" | "telegram";
    scores: Scores;
    comment: string | null;
    allowOverride: boolean;
  }): Promise<SubmitOutcome>;
  getNotice(submissionId: string, reviewerId: string): Promise<ReviewNotice | null>;
}

/** Telegram side effects after the commit. All best effort. */
export interface ReviewTelegram {
  sendDm(chatId: number, text: string): Promise<void>;
  /** Edits the curator message to `text` and removes the keyboard. */
  markReviewed(m: { chatId: number; messageId: number; kind: string; text: string }): Promise<void>;
}

export interface ReviewDeps {
  store: ReviewStore;
  telegram: ReviewTelegram;
}

export interface ReviewResult {
  reviewId: string;
  total: number;
  isOverride: boolean;
  xpAwarded: boolean;
}

export const fmtTotal = (total: number): string => total.toFixed(2);

export function studentReviewText(total: number, scores: Scores, commentText: string | null, isOverride: boolean): string {
  return [
    isOverride ? `Bahoyingiz yangilandi: ${fmtTotal(total)} / 5` : `Topshiriqingiz baholandi: ${fmtTotal(total)} / 5`,
    `Matnni to'liq aytish: ${scores.completeness}`,
    `Talaffuz: ${scores.pronunciation}`,
    `Grammatika: ${scores.grammar}`,
    `Ravonlik: ${scores.fluency}`,
    ...(commentText ? [`Izoh: ${commentText}`] : []),
  ].join("\n");
}

function logStep(step: string, e: unknown): void {
  // class only: messages and rows can carry names, text or tokens
  console.error("reviews: step failed", { op: step, code: e instanceof Error ? e.name : "unknown" });
}

/**
 * Stores a review. The reviewer must be the curator of the submission's group, the course's teacher
 * or an admin, and never the submission's own student (all decided in SQL: submit_review). The FIRST
 * review wins for everyone: later ones fail with `already_reviewed`, EXCEPT an explicit staff
 * override (`override: true` from the web by a teacher/admin), which is stored with is_override =
 * true (history kept). The XP award happens INSIDE the same SQL transaction (first review only,
 * audio/video only), so it can never be lost after a commit. After the commit the DM to the student
 * and the curator-message edit run as independent best-effort steps (failures are logged by
 * op/class and never roll the review back).
 */
export async function submitReview(input: ReviewInput, injected?: ReviewDeps): Promise<ReviewResult> {
  const parsed = reviewInputSchema.safeParse(input);
  if (!parsed.success) throw new ReviewError("invalid_input");
  // Production dependencies are built lazily (no env read at import time; no import cycle).
  const deps = injected ?? (await import("./review-store")).defaultReviewDeps();
  const { submissionId, reviewerProfileId, scores, comment: commentText, channel } = parsed.data;

  const r = await deps.store.submit({
    submissionId,
    reviewerId: reviewerProfileId,
    channel,
    scores,
    comment: commentText,
    allowOverride: channel === "web" && parsed.data.override === true, // Telegram never overrides
  });
  if (r.outcome === "duplicate") {
    // an identical staff override submitted again within seconds (double tap): nothing new, no second DM
    return { reviewId: r.reviewId, total: r.total, isOverride: true, xpAwarded: false };
  }
  if (r.outcome !== "ok") throw new ReviewError(r.outcome);
  const xpAwarded = r.xpAwarded;

  let notice: ReviewNotice | null = null;
  try {
    notice = await deps.store.getNotice(submissionId, reviewerProfileId);
  } catch (e) {
    logStep("get_notice", e);
  }
  if (notice) {
    if (notice.studentTelegramId !== null) {
      try {
        await deps.telegram.sendDm(notice.studentTelegramId, studentReviewText(r.total, scores, commentText, r.isOverride));
      } catch (e) {
        logStep("student_dm", e);
      }
    }
    if (notice.curatorChatId !== null && notice.curatorMessageId !== null) {
      try {
        await deps.telegram.markReviewed({
          chatId: notice.curatorChatId,
          messageId: notice.curatorMessageId,
          kind: notice.kind,
          text: `Baholandi: ${fmtTotal(r.total)}${notice.reviewerName ? ` (${notice.reviewerName})` : ""}`,
        });
      } catch (e) {
        logStep("curator_edit", e);
      }
    }
  }
  return { reviewId: r.reviewId, total: r.total, isOverride: r.isOverride, xpAwarded };
}

export type RouteResult = { status: number; json: Record<string, unknown> };

export interface ReviewRouteDeps {
  /** USER-scoped read (RLS / can_read_submission): may the session user see this submission? */
  canRead(submissionId: string): Promise<boolean>;
  submit(input: ReviewInput): Promise<ReviewResult>;
}

/** POST /api/reviews logic. The reviewer is the session profile, never the body. */
export async function handleReviewRequest(deps: ReviewRouteDeps, req: { userId: string | null; body: unknown }): Promise<RouteResult> {
  if (!req.userId) return { status: 401, json: { error: "unauthenticated" } };
  const body = reviewBodySchema.safeParse(req.body);
  if (!body.success) return { status: 400, json: { error: "invalid_request" } };
  try {
    // Submissions the reviewer cannot see are indistinguishable from missing ones.
    if (!(await deps.canRead(body.data.submissionId))) return { status: 404, json: { error: "not_found" } };
    const r = await deps.submit({
      submissionId: body.data.submissionId,
      reviewerProfileId: req.userId,
      scores: body.data.scores,
      comment: body.data.comment,
      channel: "web",
      override: body.data.override,
    });
    return { status: 200, json: { ok: true, total: r.total, isOverride: r.isOverride } };
  } catch (e) {
    if (e instanceof ReviewError) {
      switch (e.code) {
        case "forbidden":
          return { status: 403, json: { error: "forbidden" } };
        case "not_found":
          return { status: 404, json: { error: "not_found" } };
        case "already_reviewed":
          return { status: 409, json: { error: "already_reviewed" } };
        case "incomplete":
          return { status: 409, json: { error: "submission_incomplete" } };
        case "unsupported_kind":
          return { status: 409, json: { error: "unsupported_kind" } };
        default:
          return { status: 400, json: { error: "invalid_request" } };
      }
    }
    console.error("reviews: request failed", { op: "handleReviewRequest", code: e instanceof Error ? e.name : "unknown" });
    return { status: 500, json: { error: "internal_error" } };
  }
}
