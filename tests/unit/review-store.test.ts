import { describe, expect, it, vi } from "vitest";
import { createSupabaseReviewStore } from "@/server/review-store";
import { TelegramDbError } from "@/lib/telegram/api";

const scores = { completeness: 5, pronunciation: 4, grammar: 4, fluency: 4 };
const args = { submissionId: "s", reviewerId: "r", channel: "web" as const, scores, comment: null };
const store = (rpc: unknown) => createSupabaseReviewStore({ rpc } as never);

describe("review store (rpc mapping)", () => {
  it("passes the SQL function arguments and maps an ok row (numeric total arrives as a string)", async () => {
    const rpc = vi.fn(async () => ({ data: [{ outcome: "ok", review_id: "rv", total: "4.25", is_override: false, student_id: "st" }], error: null }));
    const r = await store(rpc).submit(args);
    expect(r).toEqual({ outcome: "ok", reviewId: "rv", total: 4.25, isOverride: false, studentId: "st" });
    expect(rpc).toHaveBeenCalledWith("submit_review", { p_submission: "s", p_reviewer: "r", p_channel: "web", p_scores: scores, p_comment: null });
  });

  it("maps the typed non-ok outcomes", async () => {
    for (const outcome of ["forbidden", "not_found", "incomplete", "already_reviewed"]) {
      const rpc = async () => ({ data: [{ outcome, review_id: null, total: null, is_override: null, student_id: null }], error: null });
      expect(await store(rpc).submit(args)).toEqual({ outcome });
    }
  });

  it("db errors become TelegramDbError carrying only op and code", async () => {
    const rpc = async () => ({ data: null, error: { code: "42501", message: "secret detail about Ali" } });
    const e = await store(rpc).submit(args).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TelegramDbError);
    expect(String((e as Error).message)).not.toContain("Ali");
    expect(e).toMatchObject({ op: "submit_review", code: "42501" });
  });

  it("award_xp is called with speaking_reviewed and the submission id as ref", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await store(rpc).awardSpeakingXp("st", 34, "sub")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("award_xp", { p_student: "st", p_amount: 34, p_reason: "speaking_reviewed", p_ref: "sub" });
  });

  it("an unexpected outcome is an error, never a silent success", async () => {
    const rpc = async () => ({ data: [{ outcome: "weird" }], error: null });
    await expect(store(rpc).submit(args)).rejects.toBeInstanceOf(TelegramDbError);
  });
});
