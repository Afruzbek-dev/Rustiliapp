import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UserFromGetMe } from "grammy/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBot } from "@/lib/telegram/bot";
import { MSG, confirmText } from "@/lib/telegram/handlers/login";
import { loginMatchCode } from "@/lib/telegram/match-code";
import { createFakeDb } from "./fake-db";

const SECRET = "w".repeat(40);
const NONCE = "abcdefghijklmnopqrstuvwxyz012345";

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

function fixture(name: string) {
  return JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/telegram", `${name}.json`), "utf8"));
}

type Sent = { method: string; payload: Record<string, unknown> };
type Seed = Parameters<typeof createFakeDb>[0];

function setup(nonces: Record<string, unknown>[], extra: Omit<Seed, "login_nonces"> = {}) {
  const fake = createFakeDb({ login_nonces: nonces, ...extra });
  const bot = createBot("123:TEST", () => fake.db, botInfo);
  const sent: Sent[] = [];
  bot.api.config.use((_prev, method, payload) => {
    sent.push({ method, payload: payload as unknown as Record<string, unknown> });
    return Promise.resolve({ ok: true, result: true } as never);
  });
  return { fake, bot, sent };
}

const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();
const nonceRow = (over: Record<string, unknown> = {}) => ({
  nonce: NONCE,
  telegram_id: null,
  status: "created",
  expires_at: future(),
  created_at: new Date().toISOString(),
  ...over,
});
const texts = (sent: Sent[]) =>
  sent.filter((s) => s.method === "sendMessage" || s.method === "editMessageText").map((s) => s.payload.text);
const nonceStatus = (f: ReturnType<typeof createFakeDb>) => f.tables.login_nonces![0]?.status;

describe("telegram login", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "u");
    vi.stubEnv("TELEGRAM_ARCHIVE_CHAT_ID", "1");
    vi.stubEnv("TELEGRAM_STAFF_CHAT_ID", "2");
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  describe("/start", () => {
    it("with a live nonce binds it to the user and asks for the contact", async () => {
      const { bot, sent, fake } = setup([nonceRow()]);
      await bot.handleUpdate(fixture("start-login"));
      expect(texts(sent)).toEqual([MSG.share]);
      const markup = sent[0]!.payload.reply_markup as {
        keyboard: { request_contact?: boolean }[][];
        one_time_keyboard: boolean;
      };
      expect(markup.keyboard[0]![0]!.request_contact).toBe(true);
      expect(markup.one_time_keyboard).toBe(true);
      expect(fake.tables.login_nonces![0]).toMatchObject({ telegram_id: 777, status: "created" });
    });

    it("with an unknown nonce is rejected", async () => {
      const { bot, sent, fake } = setup([nonceRow()]);
      await bot.handleUpdate(fixture("start-unknown"));
      expect(texts(sent)).toEqual([MSG.expired]);
      expect(fake.tables.login_nonces![0]!.telegram_id).toBeNull();
    });

    it("with a malformed nonce is rejected without a DB lookup", async () => {
      const { bot, sent } = setup([nonceRow()]);
      await bot.handleUpdate(fixture("start-malformed"));
      expect(texts(sent)).toEqual([MSG.expired]);
    });

    it("with an expired nonce is rejected", async () => {
      const { bot, sent } = setup([nonceRow({ expires_at: past() })]);
      await bot.handleUpdate(fixture("start-login"));
      expect(texts(sent)).toEqual([MSG.expired]);
    });

    it("with a nonce already claimed by someone else is rejected", async () => {
      const { bot, sent } = setup([nonceRow({ telegram_id: 555 })]);
      await bot.handleUpdate(fixture("start-login"));
      expect(texts(sent)).toEqual([MSG.expired]);
    });
  });

  describe("contact", () => {
    it("rejects a foreign contact", async () => {
      const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })]);
      await bot.handleUpdate(fixture("contact-foreign"));
      expect(texts(sent)).toEqual([MSG.foreign]);
      expect(fake.tables.profiles).toHaveLength(0);
    });

    it("rejects a forwarded contact and contacts sent outside a private chat", async () => {
      const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })]);
      await bot.handleUpdate(fixture("contact-forwarded"));
      await bot.handleUpdate(fixture("contact-group"));
      expect(texts(sent)).toEqual([MSG.foreign]);
      expect(fake.tables.profiles).toHaveLength(0);
    });

    it("rejects an own contact when the user never opened a valid link", async () => {
      const { bot, sent, fake } = setup([nonceRow()]);
      await bot.handleUpdate(fixture("contact-own"));
      expect(texts(sent)).toEqual([MSG.expired]);
      expect(fake.tables.profiles).toHaveLength(0);
    });

    it("alone does not confirm: it upserts the profile and asks for an explicit confirmation", async () => {
      const { bot, sent, fake } = setup([nonceRow()]);
      await bot.handleUpdate(fixture("start-login"));
      await bot.handleUpdate(fixture("contact-own"));
      const created = fake.tables.login_nonces![0]!.created_at as string;
      expect(texts(sent)).toEqual([MSG.share, MSG.received, confirmText(NONCE, created)]);
      expect(sent[1]!.payload.reply_markup).toEqual({ remove_keyboard: true });
      const text = texts(sent)[2] as string;
      expect(text).toContain(`Tasdiqlash kodi: ${loginMatchCode(NONCE, SECRET)}`);
      expect(text).toContain("bosmang");
      const kb = sent[2]!.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] };
      expect(kb.inline_keyboard.flat().map((b) => b.callback_data)).toEqual([`lg:ok:${NONCE}`, `lg:no:${NONCE}`]);
      expect(nonceStatus(fake)).toBe("created");
      expect(fake.authUsers.map((u) => u.email)).toEqual(["tg_777@users.internal"]);
      expect(fake.authUsers[0]!.app_metadata).toEqual({ telegram_id: 777 });
      expect(fake.tables.profiles![0]).toMatchObject({
        id: "uid-1",
        telegram_id: 777,
        phone: "+998901234567",
        full_name: "Ali Valiyev",
        telegram_username: "ali",
        role: "student",
      });
    });

    it("a repeated contact update creates no duplicates", async () => {
      const { bot, fake } = setup([nonceRow({ telegram_id: 777 })]);
      await bot.handleUpdate(fixture("contact-own"));
      await bot.handleUpdate(fixture("contact-own"));
      expect(fake.calls.createUser).toBe(1);
      expect(fake.tables.profiles).toHaveLength(1);
    });

    it("keeps the role and name of an existing teacher profile", async () => {
      const { bot, fake } = setup([nonceRow({ telegram_id: 777 })], {
        profiles: [{ id: "t1", telegram_id: 777, phone: null, full_name: "Ustoz Ali", role: "teacher" }],
      });
      await bot.handleUpdate(fixture("contact-own"));
      expect(fake.tables.profiles).toHaveLength(1);
      expect(fake.tables.profiles![0]).toMatchObject({ id: "t1", role: "teacher", full_name: "Ustoz Ali", phone: "+998901234567" });
      expect(fake.calls.createUser).toBe(0);
    });

    it("refuses a phone that belongs to another telegram account and leaves no orphan user", async () => {
      const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })], {
        profiles: [{ id: "p9", telegram_id: 999, phone: "+998901234567", full_name: "Other", role: "student" }],
      });
      await bot.handleUpdate(fixture("contact-own"));
      expect(texts(sent)).toEqual([MSG.phoneTaken]);
      expect(fake.authUsers).toHaveLength(0);
      expect(fake.tables.profiles).toHaveLength(1);
      expect(fake.tables.profiles![0]).toMatchObject({ id: "p9", telegram_id: 999 });
    });

    it("maps a racing phone unique violation to the dedicated message and removes the new auth user", async () => {
      const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })]);
      // The holder appears after the pre-check: simulate by making the pre-check miss.
      const realFrom = (fake.db as unknown as { from: (t: string) => Record<string, unknown> }).from;
      let phoneReads = 0;
      (fake.db as unknown as { from: unknown }).from = (t: string) => {
        const b = realFrom(t);
        if (t === "profiles") {
          const eq = b.eq as (c: string, v: unknown) => unknown;
          b.eq = (c: string, v: unknown) => {
            if (c === "phone") {
              phoneReads++;
              return eq("phone", "+0");
            }
            return eq(c, v);
          };
        }
        return b;
      };
      fake.tables.profiles!.push({ id: "p9", telegram_id: 999, phone: "+998901234567", full_name: "O", role: "student" });
      await bot.handleUpdate(fixture("contact-own"));
      expect(phoneReads).toBe(1);
      expect(texts(sent)).toEqual([MSG.phoneTaken]);
      expect(fake.authUsers).toHaveLength(0);
      expect(fake.calls.deleteUser).toBe(1);
    });

    it("recovers a pre-existing auth user that carries the trusted telegram_id", async () => {
      const { bot, fake } = setup([nonceRow({ telegram_id: 777 })], {
        authUsers: [{ id: "orphan", email: "tg_777@users.internal", app_metadata: { telegram_id: 777 } }],
      });
      await bot.handleUpdate(fixture("contact-own"));
      expect(fake.tables.profiles![0]!.id).toBe("orphan");
    });

    it("refuses a pre-existing auth user without trusted app_metadata and logs it for staff", async () => {
      const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })], {
        authUsers: [{ id: "squatter", email: "tg_777@users.internal", app_metadata: { provider: "email" } }],
      });
      await bot.handleUpdate(fixture("contact-own"));
      expect(texts(sent)).toEqual([MSG.accountProblem]);
      expect(fake.tables.profiles).toHaveLength(0);
      expect(fake.calls.deleteUser).toBe(0);
      expect(console.error).toHaveBeenCalledWith("telegram bot error", {
        op: "ensureAuthUser",
        code: "untrusted_auth_user",
        update_id: 103,
      });
    });

    it("logs op, code and update_id (never details) and replies generically when the database fails", async () => {
      const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })]);
      fake.admin.createUser = () => Promise.resolve({ data: { user: null }, error: { code: "boom", message: "+998901234567" } });
      await bot.handleUpdate(fixture("contact-own"));
      expect(texts(sent)).toEqual([MSG.error]);
      expect(console.error).toHaveBeenCalledWith("telegram bot error", { op: "createUser", code: "boom", update_id: 103 });
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("998");
    });
  });

  describe("inline confirmation", () => {
    it("confirms only on a callback from the bound user", async () => {
      const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })]);
      await bot.handleUpdate(fixture("callback-ok"));
      expect(nonceStatus(fake)).toBe("confirmed");
      expect(texts(sent)).toEqual([MSG.done]);
    });

    it("is idempotent when Telegram retries the callback", async () => {
      const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })]);
      await bot.handleUpdate(fixture("callback-ok"));
      await bot.handleUpdate(fixture("callback-ok"));
      expect(nonceStatus(fake)).toBe("confirmed");
      expect(texts(sent)).toEqual([MSG.done, MSG.done]);
    });

    it("does not confirm on a callback from another user", async () => {
      const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })]);
      await bot.handleUpdate(fixture("callback-ok-foreign"));
      expect(nonceStatus(fake)).toBe("created");
      expect(sent.find((s) => s.method === "answerCallbackQuery")!.payload.text).toBe(MSG.expired);
    });

    it("does not confirm an unbound nonce", async () => {
      const { bot, fake } = setup([nonceRow()]);
      await bot.handleUpdate(fixture("callback-ok"));
      expect(nonceStatus(fake)).toBe("created");
    });

    it("refuses an expired nonce", async () => {
      const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777, expires_at: past() })]);
      await bot.handleUpdate(fixture("callback-ok"));
      expect(nonceStatus(fake)).toBe("created");
      expect(sent.find((s) => s.method === "answerCallbackQuery")!.payload.text).toBe(MSG.expired);
    });

    it("cancel drops the nonce", async () => {
      const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })]);
      await bot.handleUpdate(fixture("callback-no"));
      expect(fake.tables.login_nonces).toHaveLength(0);
      expect(texts(sent)).toEqual([MSG.cancelled]);
    });

    it("full flow: start, contact, confirm", async () => {
      const { bot, fake } = setup([nonceRow()]);
      await bot.handleUpdate(fixture("start-login"));
      await bot.handleUpdate(fixture("contact-own"));
      expect(nonceStatus(fake)).toBe("created");
      await bot.handleUpdate(fixture("callback-ok"));
      expect(nonceStatus(fake)).toBe("confirmed");
    });
  });

  it("loginMatchCode is a stable two-digit code", () => {
    const code = loginMatchCode(NONCE, SECRET);
    expect(code).toMatch(/^\d{2}$/);
    expect(loginMatchCode(NONCE, SECRET)).toBe(code);
  });
});
