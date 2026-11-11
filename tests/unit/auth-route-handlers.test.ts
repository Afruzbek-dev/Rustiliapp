import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeStore } from "./auth-fake-store";

let fake = fakeStore();
vi.mock("@/server/auth-store", async (orig) => ({
  ...(await orig<typeof import("@/server/auth-store")>()),
  authDeps: () => fake.deps,
}));

import { POST as cancel } from "@/app/api/auth/telegram/cancel/route";
import { POST as exchange } from "@/app/api/auth/telegram/exchange/route";
import { POST as start } from "@/app/api/auth/telegram/start/route";
import { GET as status } from "@/app/api/auth/telegram/status/route";

const ORIGIN = "https://app.example.com";
const URL_BASE = `${ORIGIN}/api/auth/telegram`;

function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${URL_BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const get = (nonce: string, cookie?: string, name = "po_login") =>
  new NextRequest(`${URL_BASE}/status?nonce=${nonce}`, { headers: cookie ? { cookie: `${name}=${cookie}` } : {} });

function cookieOf(res: Response, name = "po_login") {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  expect(raw, `Set-Cookie ${name}`).toBeDefined();
  return raw!;
}

async function startLogin(name = "po_login") {
  const res = await start(post("start"));
  const json = (await res.json()) as { nonce: string };
  const value = cookieOf(res, name).split(";")[0]!.slice(name.length + 1);
  return { res, nonce: json.nonce, value };
}

beforeEach(() => {
  fake = fakeStore();
});
afterEach(() => vi.unstubAllEnvs());

describe("start route cookie", () => {
  it("sets an HttpOnly, SameSite=Lax, path=/api/auth, 10 minute cookie (no Secure outside production)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { res } = await startLogin();
    const c = cookieOf(res);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=lax/i);
    expect(c).toMatch(/Path=\/api\/auth(;|$)/);
    expect(c).toMatch(/Max-Age=600/i);
    expect(c).not.toMatch(/Secure/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("uses the __Secure- prefix and the Secure attribute in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { res } = await startLogin("__Secure-po_login");
    const c = cookieOf(res, "__Secure-po_login");
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=lax/i);
    expect(c).toMatch(/Path=\/api\/auth(;|$)/);
    expect(c).toMatch(/Max-Age=600/i);
  });

  it("rejects cross-site POSTs with 403 and creates nothing", async () => {
    const res = await start(post("start", undefined, { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(fake.nonces.size).toBe(0);
    expect((await start(post("start", undefined, { "sec-fetch-site": "", origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("status / exchange never leak without the right cookie", () => {
  async function confirmed() {
    const s = await startLogin();
    Object.assign(fake.nonces.get(s.nonce)!, { status: "confirmed", telegramId: 555 });
    return s;
  }

  it("status: no cookie or wrong cookie -> no identity", async () => {
    const { nonce } = await confirmed();
    for (const cookie of [undefined, "wrong"]) {
      const res = await status(get(nonce, cookie));
      const text = await res.text();
      expect(res.status).toBe(404);
      expect(text).not.toContain("identity");
      expect(text).not.toContain("Dilnoza");
    }
  });

  it("status: right cookie -> identity", async () => {
    const { nonce, value } = await confirmed();
    const json = await (await status(get(nonce, value))).json();
    expect(json.identity).toEqual({ name: "Dilnoza A.", phoneMasked: "+998 90 *** ** 47" });
  });

  it("exchange: no / wrong cookie never returns a tokenHash", async () => {
    const { nonce, value } = await confirmed();
    const variants: Record<string, string>[] = [{}, { cookie: "po_login=wrong" }];
    for (const headers of variants) {
      const res = await exchange(post("exchange", { nonce, confirm: true }, headers));
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("tokenHash");
    }
    expect(fake.nonces.get(nonce)!.status).toBe("confirmed");
    expect(value).toBeTruthy();
  });

  it("exchange success returns only tokenHash, clears the cookie and is no-store", async () => {
    const { nonce, value } = await confirmed();
    const res = await exchange(post("exchange", { nonce, confirm: true }, { cookie: `po_login=${value}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tokenHash: "hash-for-tg_555@users.internal" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const c = cookieOf(res);
    expect(c).toMatch(/^po_login=;/);
    expect(c).toMatch(/Max-Age=0/i);
    expect(c).toMatch(/Path=\/api\/auth/);
    expect(c).toMatch(/HttpOnly/i);
  });

  it("exchange rejects cross-site POSTs even with a valid cookie", async () => {
    const { nonce, value } = await confirmed();
    const res = await exchange(
      post("exchange", { nonce, confirm: true }, { cookie: `po_login=${value}`, "sec-fetch-site": "cross-site" }),
    );
    expect(res.status).toBe(403);
    expect(fake.nonces.get(nonce)!.status).toBe("confirmed");
  });

  it("cancel deletes the row for the cookie holder", async () => {
    const { nonce, value } = await startLogin();
    expect((await cancel(post("cancel", { nonce }, { cookie: "po_login=wrong" }))).status).toBe(404);
    const res = await cancel(post("cancel", { nonce }, { cookie: `po_login=${value}` }));
    expect(res.status).toBe(200);
    expect(fake.nonces.has(nonce)).toBe(false);
  });
});
