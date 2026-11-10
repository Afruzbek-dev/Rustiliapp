import { describe, expect, it } from "vitest";
import { publicEnv, serverEnv } from "@/lib/env";

const validServer = {
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  TELEGRAM_BOT_TOKEN: "tok",
  TELEGRAM_WEBHOOK_SECRET: "sec",
  TELEGRAM_BOT_USERNAME: "bot",
  TELEGRAM_ARCHIVE_CHAT_ID: "-1",
  TELEGRAM_STAFF_CHAT_ID: "-2",
  APP_URL: "https://example.com",
};

describe("env", () => {
  it("parses a valid server env", () => {
    expect(serverEnv(validServer).APP_URL).toBe("https://example.com");
  });

  it("names the missing server key", () => {
    const { TELEGRAM_BOT_TOKEN: _omit, ...rest } = validServer;
    void _omit;
    expect(() => serverEnv(rest)).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("names every invalid public key", () => {
    expect(() => publicEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL.*NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("parses a valid public env", () => {
    const env = publicEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" });
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("k");
  });

  it("does not throw at import time without env vars", async () => {
    await expect(import("@/lib/env")).resolves.toBeDefined();
  });
});
