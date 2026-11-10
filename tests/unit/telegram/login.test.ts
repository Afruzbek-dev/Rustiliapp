import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UserFromGetMe } from "grammy/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBot } from "@/lib/telegram/bot";
import { MSG } from "@/lib/telegram/handlers/login";
import { createFakeDb } from "./fake-db";

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

function setup(nonces: Record<string, unknown>[]) {
  const fake = createFakeDb({ login_nonces: nonces });
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
  nonce: "abc123",
  telegram_id: null,
  status: "created",
  expires_at: future(),
  created_at: new Date().toISOString(),
  ...over,
});
const texts = (sent: Sent[]) => sent.filter((s) => s.method === "sendMessage").map((s) => s.payload.text);

describe("telegram login", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("/start with a live nonce binds it to the user and asks for the contact", async () => {
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

  it("/start with an unknown nonce is rejected", async () => {
    const { bot, sent, fake } = setup([nonceRow()]);
    await bot.handleUpdate(fixture("start-unknown"));
    expect(texts(sent)).toEqual([MSG.expired]);
    expect(fake.tables.login_nonces![0]!.telegram_id).toBeNull();
  });

  it("/start with an expired nonce is rejected", async () => {
    const { bot, sent } = setup([nonceRow({ expires_at: past() })]);
    await bot.handleUpdate(fixture("start-login"));
    expect(texts(sent)).toEqual([MSG.expired]);
  });

  it("/start with a nonce already claimed by someone else is rejected", async () => {
    const { bot, sent } = setup([nonceRow({ telegram_id: 555 })]);
    await bot.handleUpdate(fixture("start-login"));
    expect(texts(sent)).toEqual([MSG.expired]);
  });

  it("rejects a foreign contact", async () => {
    const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })]);
    await bot.handleUpdate(fixture("contact-foreign"));
    expect(texts(sent)).toEqual([MSG.foreign]);
    expect(fake.tables.profiles).toHaveLength(0);
    expect(fake.tables.login_nonces![0]!.status).toBe("created");
  });

  it("rejects an own contact when the user never opened a valid link", async () => {
    const { bot, sent, fake } = setup([nonceRow()]);
    await bot.handleUpdate(fixture("contact-own"));
    expect(texts(sent)).toEqual([MSG.expired]);
    expect(fake.tables.profiles).toHaveLength(0);
  });

  it("valid flow upserts the profile and confirms the nonce", async () => {
    const { bot, sent, fake } = setup([nonceRow()]);
    await bot.handleUpdate(fixture("start-login"));
    await bot.handleUpdate(fixture("contact-own"));
    expect(texts(sent)).toEqual([MSG.share, MSG.done]);
    expect(sent.at(-1)!.payload.reply_markup).toEqual({ remove_keyboard: true });
    expect(fake.authUsers.map((u) => u.email)).toEqual(["tg_777@users.internal"]);
    expect(fake.tables.profiles).toHaveLength(1);
    expect(fake.tables.profiles![0]).toMatchObject({
      id: "uid-1",
      telegram_id: 777,
      phone: "+998901234567",
      full_name: "Ali Valiyev",
      telegram_username: "ali",
      role: "student",
    });
    expect(fake.tables.login_nonces![0]).toMatchObject({ status: "confirmed", telegram_id: 777 });
  });

  it("a repeated contact update is idempotent", async () => {
    const { bot, sent, fake } = setup([nonceRow()]);
    await bot.handleUpdate(fixture("start-login"));
    await bot.handleUpdate(fixture("contact-own"));
    await bot.handleUpdate(fixture("contact-own"));
    expect(texts(sent)).toEqual([MSG.share, MSG.done, MSG.done]);
    expect(fake.calls.createUser).toBe(1);
    expect(fake.calls.upsert).toBe(1);
    expect(fake.tables.profiles).toHaveLength(1);
    expect(fake.tables.login_nonces![0]!.status).toBe("confirmed");
  });

  it("recovers an auth user that exists without a profile", async () => {
    const { bot, fake } = setup([nonceRow({ telegram_id: 777 })]);
    fake.authUsers.push({ id: "orphan", email: "tg_777@users.internal" });
    await bot.handleUpdate(fixture("contact-own"));
    expect(fake.tables.profiles![0]!.id).toBe("orphan");
  });

  it("answers with a generic error and logs no details when the database fails", async () => {
    const { bot, sent, fake } = setup([nonceRow({ telegram_id: 777 })]);
    fake.admin.createUser = () => Promise.reject(new Error("boom +998901234567"));
    await bot.handleUpdate(fixture("contact-own"));
    expect(texts(sent)).toEqual([MSG.error]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("998");
  });
});
