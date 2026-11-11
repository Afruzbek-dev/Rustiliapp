import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UserFromGetMe } from "grammy/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBot } from "@/lib/telegram/bot";
import { RV_MSG } from "@/lib/telegram/handlers/review";
import { mark, reviewKeyboard } from "@/lib/telegram/keyboards";
import { submitReview } from "@/server/reviews";
import { createReviewWorld, CURATOR, SUB } from "../review-world";
import { createFakeDb } from "./fake-db";

const botInfo = {
  id: 1, is_bot: true, first_name: "Bot", username: "po_russki_bot", can_join_groups: true,
  can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false,
} as UserFromGetMe;

type Sent = { method: string; payload: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const template = (): Json => JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/telegram/review-callback.json"), "utf8"));

function setup(opts: Parameters<typeof createReviewWorld>[0] = {}) {
  const w = createReviewWorld(opts);
  const fake = createFakeDb({});
  const bot = createBot(
    "123:TEST",
    () => fake.db,
    botInfo,
    undefined,
    () => ({ store: w.store, submit: (i) => submitReview(i, w.deps) }),
  );
  const sent: Sent[] = [];
  bot.api.config.use((_prev, method, payload) => {
    sent.push({ method, payload: payload as never });
    return Promise.resolve({ ok: true, result: true } as never);
  });
  let id = 600;
  const press = (fromId: number, data: string) => {
    const u = template();
    u.update_id = ++id;
    u.callback_query.id = `cb${id}`;
    u.callback_query.from.id = fromId;
    u.callback_query.data = data;
    return bot.handleUpdate(u as never);
  };
  return { w, bot, sent, press };
}

const of = (sent: Sent[], m: string) => sent.filter((s) => s.method === m);
const answers = (sent: Sent[]) => of(sent, "answerCallbackQuery").map((s) => s.payload);
const cb = (c: string, v?: number) => `rv:${SUB}:${c}${v ? `:${v}` : ""}`;

describe("reviewKeyboard", () => {
  it("has 4 rows x 5 buttons plus Saqlash, exact callback_data, all under 64 bytes", () => {
    const rows = reviewKeyboard(SUB).inline_keyboard;
    expect(rows).toHaveLength(5);
    const codes = ["cm", "pr", "gr", "fl"];
    codes.forEach((c, i) => {
      expect(rows[i]).toHaveLength(5);
      rows[i]!.forEach((b, j) => expect((b as { callback_data: string }).callback_data).toBe(`rv:${SUB}:${c}:${j + 1}`));
    });
    expect(rows[4]).toEqual([{ text: "Saqlash", callback_data: `rv:${SUB}:save` }]);
    for (const b of rows.flat()) expect(Buffer.byteLength((b as { callback_data: string }).callback_data)).toBeLessThan(64);
  });

  it("marks the chosen value of each row with a text marker (no emoji)", () => {
    const rows = reviewKeyboard(SUB, { pronunciation: 4, fluency: 1 }).inline_keyboard;
    expect(rows[1]!.map((b) => b.text)).toEqual(["Talaffuz 1", "2", "3", mark(4), "5"]);
    expect(rows[3]![0]!.text).toBe(`Ravonlik ${mark(1)}`);
    expect(rows[0]!.map((b) => b.text)).toEqual(["Matn 1", "2", "3", "4", "5"]);
    expect(JSON.stringify(rows)).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("telegram rubric flow", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "w".repeat(40));
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "u");
    vi.stubEnv("TELEGRAM_ARCHIVE_CHAT_ID", "1");
    vi.stubEnv("TELEGRAM_STAFF_CHAT_ID", "2");
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  it("a score tap stores the draft atomically and re-renders the keyboard with the marker", async () => {
    const t = setup();
    await t.press(101, cb("pr", 4));
    await t.press(101, cb("fl", 2));
    expect(t.w.sub.draft).toEqual({ pronunciation: 4, fluency: 2 });
    const edits = of(t.sent, "editMessageReplyMarkup");
    expect(edits).toHaveLength(2);
    const rows = edits[1]!.payload.reply_markup.inline_keyboard;
    expect(rows[1].map((b: { text: string }) => b.text)).toEqual(["Talaffuz 1", "2", "3", "[4]", "5"]);
    expect(rows[3].map((b: { text: string }) => b.text)).toEqual(["Ravonlik 1", "[2]", "3", "4", "5"]);
    expect(answers(t.sent)).toHaveLength(2);
    expect(t.w.reviews).toHaveLength(0);
  });

  it("changing a value overwrites that criterion only", async () => {
    const t = setup();
    await t.press(101, cb("pr", 4));
    await t.press(101, cb("pr", 2));
    expect(t.w.sub.draft).toEqual({ pronunciation: 2 });
  });

  it("'Saqlash' with missing criteria is refused with 'Barcha mezonlarni belgilang' and nothing is saved", async () => {
    const t = setup();
    await t.press(101, cb("cm", 5));
    await t.press(101, cb("save"));
    expect(answers(t.sent).at(-1)).toMatchObject({ text: RV_MSG.incomplete, show_alert: true });
    expect(t.w.reviews).toHaveLength(0);
    expect(t.w.sub.status).toBe("pending");
  });

  it("full save submits the review via telegram, pays XP, DMs the student and edits the curator message", async () => {
    const t = setup();
    for (const [c, v] of [["cm", 5], ["pr", 4], ["gr", 4], ["fl", 4]] as const) await t.press(101, cb(c, v));
    await t.press(101, cb("save"));
    expect(t.w.reviews).toHaveLength(1);
    expect(t.w.reviews[0]).toMatchObject({ reviewerId: CURATOR, channel: "telegram", total: 4.25, isOverride: false, comment: null });
    expect(t.w.sub.status).toBe("reviewed");
    expect(t.w.xp).toHaveLength(1);
    expect(t.w.dms).toHaveLength(1);
    expect(t.w.edits).toEqual([{ chatId: -100500, messageId: 42, kind: "video", text: "Baholandi: 4.25 (Kurator Bir)" }]);
    expect(answers(t.sent).at(-1)).toMatchObject({ text: "Baholandi: 4.25" });
  });

  it("a double tap on Saqlash: one review; the second answers that it is already reviewed", async () => {
    const t = setup();
    for (const [c, v] of [["cm", 5], ["pr", 4], ["gr", 4], ["fl", 4]] as const) await t.press(101, cb(c, v));
    await t.press(101, cb("save"));
    await t.press(101, cb("save"));
    expect(t.w.reviews).toHaveLength(1);
    expect(t.w.xp).toHaveLength(1);
    expect(answers(t.sent).at(-1)).toMatchObject({ text: RV_MSG.alreadyReviewed, show_alert: true });
  });

  it("simultaneous saves by two taps: exactly one review", async () => {
    const t = setup();
    for (const [c, v] of [["cm", 5], ["pr", 4], ["gr", 4], ["fl", 4]] as const) await t.press(101, cb(c, v));
    await Promise.all([t.press(101, cb("save")), t.press(101, cb("save"))]);
    expect(t.w.reviews).toHaveLength(1);
  });

  it("a curator of ANOTHER group is denied on scores and save; no state change", async () => {
    const t = setup();
    await t.press(102, cb("pr", 4));
    await t.press(102, cb("save"));
    expect(answers(t.sent).map((a) => a.text)).toEqual([RV_MSG.denied, RV_MSG.denied]);
    expect(t.w.sub.draft).toEqual({});
    expect(t.w.reviews).toHaveLength(0);
    expect(of(t.sent, "editMessageReplyMarkup")).toHaveLength(0);
  });

  it("an unknown actor and a student get 'Ruxsat yo'q' and no state change", async () => {
    const t = setup();
    await t.press(4242, cb("pr", 4));
    await t.press(777, cb("pr", 4));
    await t.press(4242, cb("save"));
    expect(answers(t.sent).map((a) => a.text)).toEqual([RV_MSG.denied, RV_MSG.denied, RV_MSG.denied]);
    expect(t.w.sub.draft).toEqual({});
    expect(t.w.reviews).toHaveLength(0);
  });

  it("the chat the button sits in grants nothing: the actor decides (teacher from any chat is allowed)", async () => {
    const t = setup();
    for (const [c, v] of [["cm", 3], ["pr", 3], ["gr", 3], ["fl", 3]] as const) await t.press(103, cb(c, v));
    await t.press(103, cb("save"));
    expect(t.w.reviews[0]).toMatchObject({ reviewerId: "7e7e7e7e-7e7e-47e7-87e7-7e7e7e7e7e7e", total: 3 });
  });

  it("a tap on an already reviewed (e.g. web) submission does not change the draft", async () => {
    const t = setup({ sub: { status: "reviewed" } });
    await t.press(101, cb("pr", 4));
    expect(answers(t.sent).at(-1)).toMatchObject({ text: RV_MSG.alreadyReviewed });
    expect(t.w.sub.draft).toEqual({});
  });

  it("payloads that do not match exactly are ignored (nothing answered by the review handler)", async () => {
    const t = setup();
    for (const d of [`rv:${SUB}:pr:6`, `rv:${SUB}:pr:0`, `rv:${SUB}:xx:3`, `rv:${SUB}:save:1`, `rv:not-a-uuid:save`, `rv:${SUB}:pr:4 `]) await t.press(101, d);
    expect(t.w.sub.draft).toEqual({});
    expect(of(t.sent, "editMessageReplyMarkup")).toHaveLength(0);
  });

  it("an unexpected failure answers a generic message (the spinner never hangs) and logs op/code only", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = setup();
    t.w.store.setDraft = async () => {
      throw new Error("secret row data Ali Valiyev");
    };
    await t.press(101, cb("pr", 4));
    expect(answers(t.sent).at(-1)).toMatchObject({ text: RV_MSG.error, show_alert: true });
    expect(JSON.stringify(err.mock.calls)).not.toContain("Ali");
    expect(JSON.stringify(err.mock.calls)).toContain("update_id");
  });

  it("a web review first: the telegram save answers 'already reviewed' (first review wins)", async () => {
    const t = setup();
    for (const [c, v] of [["cm", 5], ["pr", 5], ["gr", 5], ["fl", 5]] as const) await t.press(101, cb(c, v));
    // another curator-channel review lands between the last tap and Save
    await submitReview({ submissionId: SUB, reviewerProfileId: CURATOR, scores: { completeness: 1, pronunciation: 1, grammar: 1, fluency: 1 }, channel: "web" }, t.w.deps);
    await t.press(101, cb("save"));
    expect(t.w.reviews).toHaveLength(1);
    expect(t.w.reviews[0]!.channel).toBe("web");
    expect(answers(t.sent).at(-1)).toMatchObject({ show_alert: true });
  });
});
