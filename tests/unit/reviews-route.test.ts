import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReviewTelegram } from "@/server/review-telegram";

const state = { user: null as { id: string } | null, row: null as { id: string } | null };
const maybeSingle = vi.fn(async () => ({ data: state.row, error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));
const submitReview = vi.fn();
vi.mock("@/server/reviews", async (orig) => ({ ...(await orig<typeof import("@/server/reviews")>()), submitReview: (...a: unknown[]) => submitReview(...a) }));

import { POST } from "@/app/api/reviews/route";

const SUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const scores = { completeness: 5, pronunciation: 4, grammar: 4, fluency: 4 };
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/reviews", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("POST /api/reviews route", () => {
  beforeEach(() => {
    state.user = null;
    state.row = null;
    maybeSingle.mockClear();
    submitReview.mockReset();
  });

  it("401 anonymous (no body read, no db)", async () => {
    expect((await post({ submissionId: SUB, scores })).status).toBe(401);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("413 over 4 KB, 400 on broken json", async () => {
    state.user = { id: "u" };
    expect((await post({ submissionId: SUB, scores, comment: "x".repeat(5000) })).status).toBe(413);
    expect((await post("{")).status).toBe(400);
  });

  it("404 when RLS hides the submission", async () => {
    state.user = { id: "u" };
    const res = await post({ submissionId: SUB, scores });
    expect(res.status).toBe(404);
    expect(submitReview).not.toHaveBeenCalled();
  });

  it("200 with the session user as reviewer; 403 and 409 are mapped", async () => {
    state.user = { id: "reviewer-1" };
    state.row = { id: SUB };
    submitReview.mockResolvedValueOnce({ reviewId: "r", total: 4.25, isOverride: false, xpAwarded: true });
    const ok = await post({ submissionId: SUB, scores, comment: "yaxshi" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, total: 4.25, isOverride: false });
    expect(submitReview.mock.calls[0]![0]).toMatchObject({ reviewerProfileId: "reviewer-1", channel: "web" });

    const { ReviewError } = await import("@/server/reviews");
    submitReview.mockRejectedValueOnce(new ReviewError("forbidden"));
    expect((await post({ submissionId: SUB, scores })).status).toBe(403);
    submitReview.mockRejectedValueOnce(new ReviewError("already_reviewed"));
    expect((await post({ submissionId: SUB, scores })).status).toBe(409);
  });
});

describe("review telegram effects", () => {
  const empty = { inline_keyboard: [] };
  it("audio: the text is replaced and the keyboard removed in one edit", async () => {
    const api = { sendMessage: vi.fn(), editMessageText: vi.fn(), editMessageCaption: vi.fn(), editMessageReplyMarkup: vi.fn(), copyMessage: vi.fn() };
    await createReviewTelegram(api as never).markReviewed({ chatId: 1, messageId: 2, kind: "audio", text: "Baholandi: 4.00 (K)" });
    expect(api.editMessageText).toHaveBeenCalledWith(1, 2, "Baholandi: 4.00 (K)", { reply_markup: empty });
  });

  it("video: caption edit, or (video note) keyboard removal plus a reply", async () => {
    const ok = { sendMessage: vi.fn(), editMessageText: vi.fn(), editMessageCaption: vi.fn(), editMessageReplyMarkup: vi.fn(), copyMessage: vi.fn() };
    await createReviewTelegram(ok as never).markReviewed({ chatId: 1, messageId: 2, kind: "video", text: "t" });
    expect(ok.editMessageCaption).toHaveBeenCalledWith(1, 2, { caption: "t", reply_markup: empty });
    expect(ok.sendMessage).not.toHaveBeenCalled();

    const note = { ...ok, editMessageCaption: vi.fn().mockRejectedValue(new Error("no caption")), editMessageReplyMarkup: vi.fn(), sendMessage: vi.fn() };
    await createReviewTelegram(note as never).markReviewed({ chatId: 1, messageId: 2, kind: "video", text: "t" });
    expect(note.editMessageReplyMarkup).toHaveBeenCalledWith(1, 2, { reply_markup: empty });
    expect(note.sendMessage).toHaveBeenCalledWith(1, "t", { reply_parameters: { message_id: 2, allow_sending_without_reply: true } });
  });
});
