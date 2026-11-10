import { beforeEach, describe, expect, it, vi } from "vitest";

const handler = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
vi.mock("@/lib/telegram/bot", () => ({ getWebhookHandler: () => handler }));

import { POST } from "@/app/api/telegram/webhook/route";

const SECRET = "s3cret-value";

function req(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ update_id: 1, poll: { id: "x" } }),
  });
}

describe("telegram webhook route", () => {
  beforeEach(() => {
    handler.mockClear();
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "u");
    vi.stubEnv("TELEGRAM_ARCHIVE_CHAT_ID", "1");
    vi.stubEnv("TELEGRAM_STAFF_CHAT_ID", "2");
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  it("returns 401 without the secret header", async () => {
    expect((await POST(req())).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 with a wrong secret", async () => {
    expect((await POST(req({ "x-telegram-bot-api-secret-token": "nope" }))).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes a correctly signed request to the bot", async () => {
    const res = await POST(req({ "x-telegram-bot-api-secret-token": SECRET }));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});
