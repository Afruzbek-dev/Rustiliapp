import { beforeEach, describe, expect, it, vi } from "vitest";
import { speakingXp } from "@/lib/gamification/xp";
import { handleReviewRequest, ReviewError, submitReview, type ReviewInput } from "@/server/reviews";
import { ADMIN, CURATOR, CURATOR2, createReviewWorld, STUDENT, SUB, TEACHER } from "./review-world";

const scores = { completeness: 5, pronunciation: 4, grammar: 4, fluency: 4 }; // mean 4.25
const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({ submissionId: SUB, reviewerProfileId: CURATOR, scores, comment: "Yaxshi", channel: "web", ...over });
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof ReviewError ? e.code : "other"));

describe("submitReview", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("the curator of the group reviews: total, XP once, DM, curator message edited", async () => {
    const w = createReviewWorld();
    const r = await submitReview(input(), w.deps);
    expect(r).toMatchObject({ total: 4.25, isOverride: false, xpAwarded: true });
    expect(w.sub.status).toBe("reviewed");
    expect(w.reviews).toHaveLength(1);
    expect(w.reviews[0]).toMatchObject({ reviewerId: CURATOR, channel: "web", comment: "Yaxshi", isOverride: false });
    expect(w.xp).toEqual([{ studentId: STUDENT, amount: speakingXp(4.25), ref: SUB }]);
    expect(w.xp[0]!.amount).toBe(34);
    expect(w.dms).toHaveLength(1);
    expect(w.dms[0]!.chatId).toBe(777);
    expect(w.dms[0]!.text).toContain("4.25");
    expect(w.dms[0]!.text).toContain("Izoh: Yaxshi");
    expect(w.edits).toEqual([{ chatId: -100500, messageId: 42, kind: "video", text: "Baholandi: 4.25 (Kurator Bir)" }]);
  });

  it("a curator of another group, a student and an unknown profile are forbidden; nothing changes", async () => {
    for (const reviewerProfileId of [CURATOR2, STUDENT, "99999999-9999-4999-8999-999999999999"]) {
      const w = createReviewWorld();
      expect(await code(submitReview(input({ reviewerProfileId }), w.deps))).toBe("forbidden");
      expect(w.sub.status).toBe("pending");
      expect(w.reviews).toHaveLength(0);
      expect(w.xp).toHaveLength(0);
      expect(w.dms).toHaveLength(0);
    }
  });

  it("unknown submission -> not_found; incomplete submission -> incomplete (audio without storage, video without file)", async () => {
    const w = createReviewWorld({ sub: { complete: false } });
    expect(await code(submitReview(input({ submissionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), w.deps))).toBe("not_found");
    expect(await code(submitReview(input(), w.deps))).toBe("incomplete");
    expect(w.sub.status).toBe("pending");
    expect(w.reviews).toHaveLength(0);
  });

  it("first review wins: a second curator review is already_reviewed (no review, no XP, no DM)", async () => {
    const w = createReviewWorld();
    await submitReview(input(), w.deps);
    expect(await code(submitReview(input({ scores: { ...scores, grammar: 1 } }), w.deps))).toBe("already_reviewed");
    expect(w.reviews).toHaveLength(1);
    expect(w.xp).toHaveLength(1);
    expect(w.dms).toHaveLength(1);
  });

  it("two simultaneous reviews: exactly one wins, the other is already_reviewed", async () => {
    const w = createReviewWorld();
    const results = await Promise.all([submitReview(input(), w.deps), submitReview(input({ channel: "telegram" }), w.deps)].map(code));
    expect(results.sort()).toEqual(["already_reviewed", "ok"]);
    expect(w.reviews).toHaveLength(1);
    expect(w.xp).toHaveLength(1);
  });

  it("teacher override after a review is recorded with is_override, pays no second XP, history kept", async () => {
    const w = createReviewWorld();
    await submitReview(input(), w.deps);
    const two = { completeness: 2, pronunciation: 2, grammar: 2, fluency: 2 };
    const r = await submitReview(input({ reviewerProfileId: TEACHER, scores: two, override: true }), w.deps);
    expect(r).toMatchObject({ isOverride: true, xpAwarded: false, total: 2 });
    expect(w.reviews.map((x) => x.isOverride)).toEqual([false, true]);
    expect(w.xp).toHaveLength(1);
    expect(w.dms[1]!.text).toContain("yangilandi");
    expect(w.edits).toHaveLength(2);
  });

  it("an override must be explicit: staff without the flag, curators with it and Telegram always get already_reviewed", async () => {
    const w = createReviewWorld();
    await submitReview(input(), w.deps);
    expect(await code(submitReview(input({ reviewerProfileId: TEACHER }), w.deps))).toBe("already_reviewed");
    expect(await code(submitReview(input({ reviewerProfileId: ADMIN, override: false }), w.deps))).toBe("already_reviewed");
    expect(await code(submitReview(input({ reviewerProfileId: CURATOR, override: true }), w.deps))).toBe("already_reviewed");
    expect(await code(submitReview(input({ reviewerProfileId: TEACHER, override: true, channel: "telegram" }), w.deps))).toBe("already_reviewed");
    expect(w.submitCalls.at(-1)).toEqual({ allowOverride: false, channel: "telegram" });
    expect(w.reviews).toHaveLength(1);
  });

  it("a double submit of the same staff override creates no extra row and no second DM", async () => {
    const w = createReviewWorld();
    await submitReview(input(), w.deps);
    const two = { completeness: 2, pronunciation: 2, grammar: 2, fluency: 2 };
    await submitReview(input({ reviewerProfileId: TEACHER, scores: two, override: true }), w.deps);
    const again = await submitReview(input({ reviewerProfileId: TEACHER, scores: two, override: true }), w.deps);
    expect(again).toMatchObject({ isOverride: true, xpAwarded: false });
    expect(w.reviews).toHaveLength(2);
    expect(w.dms).toHaveLength(2); // first review + one override
    expect(w.edits).toHaveLength(2);
  });

  it("nobody reviews their own submission (curator, teacher and admin who are also the student)", async () => {
    for (const self of [CURATOR, TEACHER, ADMIN]) {
      const w = createReviewWorld({ sub: { studentId: self } });
      expect(await code(submitReview(input({ reviewerProfileId: self }), w.deps))).toBe("forbidden");
      expect(w.xp).toHaveLength(0);
      expect(w.reviews).toHaveLength(0);
    }
  });

  it("text submissions are not reviewable yet (unsupported_kind) and earn no XP", async () => {
    const w = createReviewWorld({ sub: { kind: "text" } });
    expect(await code(submitReview(input(), w.deps))).toBe("unsupported_kind");
    expect(w.xp).toHaveLength(0);
  });

  it("teacher and admin may review a pending submission as the first (non-override) review", async () => {
    for (const reviewerProfileId of [TEACHER, ADMIN]) {
      const w = createReviewWorld();
      const r = await submitReview(input({ reviewerProfileId }), w.deps);
      expect(r).toMatchObject({ isOverride: false, xpAwarded: true });
      expect(w.xp).toHaveLength(1);
    }
  });

  it("validates scores (exactly four integer criteria 1..5) and the comment length", async () => {
    const w = createReviewWorld();
    const bad: unknown[] = [
      { ...scores, fluency: 0 },
      { ...scores, fluency: 6 },
      { ...scores, fluency: 3.5 },
      { ...scores, fluency: "3" },
      { completeness: 5, pronunciation: 4, grammar: 4 },
      { ...scores, extra: 1 },
    ];
    for (const s of bad) expect(await code(submitReview(input({ scores: s as never }), w.deps))).toBe("invalid_input");
    expect(await code(submitReview(input({ comment: "x".repeat(1001) }), w.deps))).toBe("invalid_input");
    expect(await code(submitReview(input({ channel: "sms" as never }), w.deps))).toBe("invalid_input");
    expect(w.reviews).toHaveLength(0);
    expect(await code(submitReview(input({ comment: "x".repeat(1000) }), createReviewWorld().deps))).toBe("ok");
  });

  it("an empty comment is stored as null and the DM has no 'Izoh' line", async () => {
    const w = createReviewWorld();
    await submitReview(input({ comment: "   " }), w.deps);
    expect(w.reviews[0]!.comment).toBeNull();
    expect(w.dms[0]!.text).not.toContain("Izoh");
  });

  it("a failed DM or curator edit does not roll the review back", async () => {
    const w = createReviewWorld({ failDm: true, failEdit: true });
    const r = await submitReview(input(), w.deps);
    expect(r.xpAwarded).toBe(true);
    expect(w.reviews).toHaveLength(1);
    expect(w.sub.status).toBe("reviewed");
  });


  it("an audio submission edits the message text (kind is passed through)", async () => {
    const w = createReviewWorld({ sub: { kind: "audio" } });
    await submitReview(input(), w.deps);
    expect(w.edits[0]!.kind).toBe("audio");
  });
});

describe("POST /api/reviews logic", () => {
  const body = { submissionId: SUB, scores, comment: "ok" };
  function route(over: { canRead?: boolean; submitError?: ReviewError | Error } = {}) {
    const submit = vi.fn(async (i: ReviewInput) => {
      if (over.submitError) throw over.submitError;
      return { reviewId: "r", total: 4.25, isOverride: false, xpAwarded: true, _in: i } as never;
    });
    return { submit, deps: { canRead: vi.fn(async () => over.canRead ?? true), submit } };
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("401 anonymous, 400 invalid / unknown keys (incl. a reviewer in the body)", async () => {
    const r = route();
    expect((await handleReviewRequest(r.deps, { userId: null, body })).status).toBe(401);
    for (const b of [null, {}, { ...body, reviewerProfileId: CURATOR }, { ...body, submissionId: "x" }, { ...body, scores: { ...scores, fluency: 9 } }, { ...body, comment: "x".repeat(1001) }]) {
      expect((await handleReviewRequest(r.deps, { userId: CURATOR, body: b })).status).toBe(400);
    }
    expect(r.submit).not.toHaveBeenCalled();
  });

  it("404 when the user cannot see the submission (no submit call)", async () => {
    const r = route({ canRead: false });
    expect(await handleReviewRequest(r.deps, { userId: CURATOR2, body })).toEqual({ status: 404, json: { error: "not_found" } });
    expect(r.submit).not.toHaveBeenCalled();
  });

  it("the reviewer is the session user, channel web", async () => {
    const r = route();
    const res = await handleReviewRequest(r.deps, { userId: CURATOR, body });
    expect(res).toEqual({ status: 200, json: { ok: true, total: 4.25, isOverride: false } });
    expect(r.submit.mock.calls[0]![0]).toMatchObject({ submissionId: SUB, reviewerProfileId: CURATOR, channel: "web", comment: "ok" });
  });

  it("accepts an optional boolean `override` (strict) and passes it on; anything else is a 400", async () => {
    const r = route();
    await handleReviewRequest(r.deps, { userId: TEACHER, body: { ...body, override: true } });
    expect(r.submit.mock.calls[0]![0]).toMatchObject({ reviewerProfileId: TEACHER, override: true });
    for (const o of ["true", 1, null]) {
      expect((await handleReviewRequest(r.deps, { userId: TEACHER, body: { ...body, override: o } })).status).toBe(400);
    }
  });

  it("maps 403 / 404 / 409 / 409 / 500", async () => {
    const cases: [ReviewError | Error, number, string][] = [
      [new ReviewError("forbidden"), 403, "forbidden"],
      [new ReviewError("not_found"), 404, "not_found"],
      [new ReviewError("already_reviewed"), 409, "already_reviewed"],
      [new ReviewError("incomplete"), 409, "submission_incomplete"],
      [new Error("db down"), 500, "internal_error"],
    ];
    for (const [e, status, error] of cases) {
      expect(await handleReviewRequest(route({ submitError: e }).deps, { userId: CURATOR, body })).toEqual({ status, json: { error } });
    }
  });
});
