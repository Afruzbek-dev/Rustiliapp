import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UserFromGetMe } from "grammy/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBot } from "@/lib/telegram/bot";
import { ENR_MSG } from "@/lib/telegram/handlers/enrollment";
import { MSG } from "@/lib/telegram/handlers/login";
import { createFakeDb } from "./fake-db";

const ENR_ID = "11111111-2222-4333-8444-555555555555";
const STAFF = "2";

const botInfo = {
  id: 1,
  is_bot: true,
  first_name: "Bot",
  username: "po_russki_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

type Sent = { method: string; payload: Record<string, unknown> };
type Row = Record<string, unknown>;

function fixture(name: string) {
  return JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/telegram", `${name}.json`), "utf8"));
}

function setup(seed: Parameters<typeof createFakeDb>[0] = {}) {
  const fake = createFakeDb({
    courses: [{ id: "course", teacher_id: "teacher" }],
    cohorts: [{ id: "c1", course_id: "course", starts_on: "2026-11-01", ends_on: null, access_until: null, created_at: "2026-10-01T00:00:00Z" }],
    curator_groups: [
      { id: "gB", cohort_id: "c1", name: "B guruh" },
      { id: "gA", cohort_id: "c1", name: "A guruh" },
    ],
    ...seed,
  });
  const bot = createBot("123:TEST", () => fake.db, botInfo);
  const sent: Sent[] = [];
  bot.api.config.use((_prev, method, payload) => {
    sent.push({ method, payload: payload as unknown as Record<string, unknown> });
    return Promise.resolve({ ok: true, result: true } as never);
  });
  return { fake, bot, sent };
}

const profiles = (): Row[] => [
  { id: "teacher", role: "teacher", full_name: "Zarina", telegram_id: 1 },
  { id: "teacher2", role: "teacher", full_name: "Boshqa", telegram_id: 2 },
  { id: "student", role: "student", full_name: "Ali Valiyev", telegram_id: 777 },
  { id: "plain", role: "student", full_name: "Vali", telegram_id: 888 },
];
const pending = (): Row => ({
  id: ENR_ID,
  student_id: "student",
  cohort_id: "c1",
  curator_group_id: null,
  status: "pending",
  source: "manual",
  approved_by: null,
  approved_at: null,
  expires_at: null,
});

function press(fromId: number, data: string, updateId = 900) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb${updateId}`,
      from: { id: fromId, is_bot: false, first_name: "Staff" },
      message: { message_id: 50, date: 1760000020, chat: { id: -100500, type: "supergroup", title: "Staff" }, text: "x" },
      chat_instance: "1",
      data,
    },
  };
}

const of = (sent: Sent[], method: string) => sent.filter((s) => s.method === method);

describe("staff enrollment callbacks", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "w".repeat(40));
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "u");
    vi.stubEnv("TELEGRAM_ARCHIVE_CHAT_ID", "1");
    vi.stubEnv("TELEGRAM_STAFF_CHAT_ID", STAFF);
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  it("an unknown actor gets 'Ruxsat yo'q' and nothing changes", async () => {
    const { bot, sent, fake } = setup({ profiles: profiles(), enrollments: [pending()] });
    await bot.handleUpdate(press(4242, `enr:approve:${ENR_ID}`) as never);
    expect(of(sent, "answerCallbackQuery")[0]!.payload).toMatchObject({ text: ENR_MSG.denied, show_alert: true });
    expect(of(sent, "editMessageText")).toHaveLength(0);
    expect(fake.tables.enrollments![0]!.status).toBe("pending");
  });

  it("an actor without rights (student, foreign teacher) is denied by the server function", async () => {
    for (const from of [888, 2]) {
      const { bot, sent, fake } = setup({ profiles: profiles(), enrollments: [pending()] });
      await bot.handleUpdate(press(from, `enr:approve:${ENR_ID}`) as never);
      expect(of(sent, "answerCallbackQuery")[0]!.payload).toMatchObject({ text: ENR_MSG.denied });
      expect(of(sent, "sendMessage")).toHaveLength(0);
      expect(fake.tables.enrollments![0]!.status).toBe("pending");
    }
  });

  it("approve edits the staff message, removes the buttons and DMs the student", async () => {
    const { bot, sent, fake } = setup({ profiles: profiles(), enrollments: [pending()] });
    await bot.handleUpdate(press(1, `enr:approve:${ENR_ID}`) as never);
    expect(fake.tables.enrollments![0]).toMatchObject({ status: "active", approved_by: "teacher", curator_group_id: "gA" });
    expect(fake.tables.enrollments![0]!.expires_at).not.toBeNull();
    const edit = of(sent, "editMessageText")[0]!.payload;
    expect(edit.text).toBe("Ruxsat berildi: Ali Valiyev -> A guruh (Zarina)");
    expect(edit.reply_markup).toEqual({ inline_keyboard: [] });
    const dm = of(sent, "sendMessage");
    expect(dm).toHaveLength(1);
    expect(dm[0]!.payload).toMatchObject({ chat_id: 777, text: ENR_MSG.opened });
    expect(of(sent, "answerCallbackQuery")).toHaveLength(1);
  });

  it("a double press is idempotent: one state change, one DM, text refreshed", async () => {
    const { bot, sent, fake } = setup({ profiles: profiles(), enrollments: [pending()] });
    await bot.handleUpdate(press(1, `enr:approve:${ENR_ID}`, 901) as never);
    const snapshot = JSON.stringify(fake.tables.enrollments);
    await bot.handleUpdate(press(1, `enr:approve:${ENR_ID}`, 902) as never);
    expect(JSON.stringify(fake.tables.enrollments)).toBe(snapshot);
    expect(of(sent, "sendMessage")).toHaveLength(1);
    expect(of(sent, "editMessageText").map((e) => e.payload.text)).toEqual([
      "Ruxsat berildi: Ali Valiyev -> A guruh (Zarina)",
      "Ruxsat berildi: Ali Valiyev -> A guruh (Zarina)",
    ]);
  });

  it("mentions a missing curator group", async () => {
    const { bot, sent } = setup({ profiles: profiles(), enrollments: [pending()], curator_groups: [] });
    await bot.handleUpdate(press(1, `enr:approve:${ENR_ID}`) as never);
    expect(of(sent, "editMessageText")[0]!.payload.text).toBe(
      `Ruxsat berildi: Ali Valiyev -> ${ENR_MSG.noGroup} (Zarina)`,
    );
  });

  it("a staff DM failure is logged and does not break the approval", async () => {
    const { bot, fake } = setup({ profiles: profiles(), enrollments: [pending()] });
    bot.api.config.use((prev, method, payload, signal) =>
      method === "sendMessage" ? Promise.reject(new Error("blocked +998901234567")) : prev(method, payload, signal),
    );
    await bot.handleUpdate(press(1, `enr:approve:${ENR_ID}`) as never);
    expect(fake.tables.enrollments![0]!.status).toBe("active");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("998");
  });

  it("reject edits the message without messaging the student; a second press refreshes it", async () => {
    const { bot, sent, fake } = setup({ profiles: profiles(), enrollments: [pending()] });
    await bot.handleUpdate(press(1, `enr:reject:${ENR_ID}`, 903) as never);
    await bot.handleUpdate(press(1, `enr:reject:${ENR_ID}`, 904) as never);
    expect(fake.tables.enrollments![0]!.status).toBe("rejected");
    expect(of(sent, "sendMessage")).toHaveLength(0);
    expect(of(sent, "editMessageText").map((e) => e.payload.text)).toEqual([
      "Rad etildi: Ali Valiyev (Zarina)",
      "Rad etildi: Ali Valiyev (Zarina)",
    ]);
  });

  it("reject on an already active enrollment does not touch it", async () => {
    const { bot, sent, fake } = setup({
      profiles: profiles(),
      enrollments: [{ ...pending(), status: "active", curator_group_id: "gA", expires_at: "2027-01-01T00:00:00Z" }],
    });
    await bot.handleUpdate(press(1, `enr:reject:${ENR_ID}`) as never);
    expect(fake.tables.enrollments![0]!.status).toBe("active");
    expect(String(of(sent, "editMessageText")[0]!.payload.text)).toContain("rad etib bo'lmaydi");
  });

  it("ignores malformed callback payloads", async () => {
    const { bot, sent, fake } = setup({ profiles: profiles(), enrollments: [pending()] });
    await bot.handleUpdate(press(1, "enr:approve:not-a-uuid") as never);
    await bot.handleUpdate(press(1, `enr:delete:${ENR_ID}`) as never);
    expect(sent).toHaveLength(0);
    expect(fake.tables.enrollments![0]!.status).toBe("pending");
  });

  it("an unknown enrollment id answers 'not found'", async () => {
    const { bot, sent } = setup({ profiles: profiles() });
    await bot.handleUpdate(press(1, `enr:approve:${ENR_ID}`) as never);
    expect(of(sent, "answerCallbackQuery")[0]!.payload).toMatchObject({ text: ENR_MSG.notFound });
  });

  it("keeps callback_data under 64 bytes", async () => {
    const { enrollmentKeyboard } = await import("@/lib/telegram/keyboards");
    const kb = enrollmentKeyboard(ENR_ID).inline_keyboard.flat();
    for (const b of kb) expect(Buffer.byteLength((b as { callback_data: string }).callback_data)).toBeLessThan(64);
  });
});

describe("contact flow creates the pending enrollment", () => {
  const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
  const nonce = () => ({
    nonce: "abcdefghijklmnopqrstuvwxyz012345",
    telegram_id: 777,
    status: "created",
    expires_at: future(),
    created_at: new Date().toISOString(),
  });

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "w".repeat(40));
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "u");
    vi.stubEnv("TELEGRAM_ARCHIVE_CHAT_ID", "1");
    vi.stubEnv("TELEGRAM_STAFF_CHAT_ID", STAFF);
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  it("creates one pending enrollment and exactly one staff message, even when the contact is delivered twice", async () => {
    const { bot, sent, fake } = setup({ login_nonces: [nonce()] });
    await bot.handleUpdate(fixture("contact-own"));
    await bot.handleUpdate(fixture("contact-own"));
    expect(fake.tables.enrollments).toHaveLength(1);
    expect(fake.tables.enrollments![0]).toMatchObject({ student_id: "uid-1", cohort_id: "c1", status: "pending", source: "manual" });
    const staff = of(sent, "sendMessage").filter((s) => String(s.payload.chat_id) === STAFF);
    expect(staff).toHaveLength(1);
    expect(staff[0]!.payload.text).toBe("Yangi o'quvchi: Ali Valiyev, +998901234567");
    const data = (staff[0]!.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard
      .flat()
      .map((b) => b.callback_data);
    const id = fake.tables.enrollments![0]!.id as string;
    expect(data).toEqual([`enr:approve:${id}`, `enr:reject:${id}`]);
  });

  it("a staff chat failure is logged (class/code only) and does not fail the student's flow", async () => {
    const { bot, sent, fake } = setup({ login_nonces: [nonce()] });
    bot.api.config.use((prev, method, payload, signal) =>
      method === "sendMessage" && String((payload as { chat_id: unknown }).chat_id) === STAFF
        ? Promise.reject(new Error("chat not found +998901234567"))
        : prev(method, payload, signal),
    );
    await bot.handleUpdate(fixture("contact-own"));
    expect(fake.tables.enrollments).toHaveLength(1);
    expect(of(sent, "sendMessage").some((s) => s.payload.text === MSG.received)).toBe(true);
    expect(of(sent, "sendMessage").some((s) => s.payload.text === MSG.error)).toBe(false);
    expect(console.error).toHaveBeenCalledWith("telegram bot error", { op: "unknown", code: "Error", update_id: 103 });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("998");
  });

  it("without an open cohort tells the student to contact the teacher and messages no staff", async () => {
    const { bot, sent, fake } = setup({ login_nonces: [nonce()], cohorts: [] });
    await bot.handleUpdate(fixture("contact-own"));
    expect(fake.tables.enrollments).toHaveLength(0);
    expect(of(sent, "sendMessage").map((s) => s.payload.text)).toContain(MSG.noCohort);
    expect(of(sent, "sendMessage").filter((s) => String(s.payload.chat_id) === STAFF)).toHaveLength(0);
  });

  it("does not re-notify staff for an existing rejected enrollment", async () => {
    const { bot, sent, fake } = setup({
      login_nonces: [nonce()],
      profiles: [{ id: "p1", telegram_id: 777, phone: null, full_name: "Ali Valiyev", role: "student" }],
      enrollments: [{ ...pending(), student_id: "p1", status: "rejected" }],
    });
    await bot.handleUpdate(fixture("contact-own"));
    expect(fake.tables.enrollments).toHaveLength(1);
    expect(fake.tables.enrollments![0]!.status).toBe("rejected");
    expect(of(sent, "sendMessage").filter((s) => String(s.payload.chat_id) === STAFF)).toHaveLength(0);
  });
});
