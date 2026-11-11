import { describe, expect, it } from "vitest";
import {
  displayName,
  handleCancel,
  handleExchange,
  handleStart,
  handleStatus,
  maskPhone,
  originAllowed,
  type AuthDeps,
} from "@/server/auth";
import { fakeStore, sha, SEED, GOOD_USER, type Seed } from "./auth-fake-store";

function setup(seed: Seed = SEED) {
  return fakeStore(seed);
}

async function started(deps: AuthDeps) {
  const res = await handleStart(deps);
  const json = res.json as { nonce: string; deepLink: string; expiresAt: string; matchCode: string };
  const cookie = (res.cookie as { set: string }).set;
  return { res, json, cookie };
}

describe("POST /start", () => {
  it("creates a 32-char nonce, a verifier cookie, and stores only sha256(verifier)", async () => {
    const t = setup();
    const { res, json, cookie } = await started(t.deps);
    expect(res.status).toBe(200);
    expect(json.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(json.deepLink).toBe(`https://t.me/po_russki_bot?start=login_${json.nonce}`);
    expect(json.matchCode).toBe("47");
    expect(Date.parse(json.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(Date.parse(json.expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    expect(Buffer.from(cookie, "base64url")).toHaveLength(32);
    expect(t.nonces.get(json.nonce)!.verifierHash).toBe(sha(cookie));
    expect(JSON.stringify(res.json)).not.toContain(cookie);
  });
});

describe("GET /status", () => {
  it("created -> created", async () => {
    const t = setup();
    const { json, cookie } = await started(t.deps);
    const res = await handleStatus(t.deps, { nonce: json.nonce, cookie });
    expect(res).toMatchObject({ status: 200, json: { status: "created" } });
  });

  it("without cookie or with a wrong cookie is a terminal 404-like answer", async () => {
    const t = setup();
    const { json } = await started(t.deps);
    t.nonces.get(json.nonce)!.status = "confirmed";
    t.nonces.get(json.nonce)!.telegramId = 555;
    for (const cookie of [undefined, "", "wrong-cookie"]) {
      const res = await handleStatus(t.deps, { nonce: json.nonce, cookie });
      expect(res.status).toBe(404);
      expect(res.json).toEqual({ status: "expired" });
    }
  });

  it("missing row and malformed nonce -> expired", async () => {
    const t = setup();
    const { cookie } = await started(t.deps);
    expect((await handleStatus(t.deps, { nonce: "x".repeat(32), cookie })).json).toEqual({ status: "expired" });
    expect((await handleStatus(t.deps, { nonce: "short", cookie })).json).toEqual({ status: "expired" });
    expect((await handleStatus(t.deps, { nonce: null, cookie })).json).toEqual({ status: "expired" });
  });

  it("expired and consumed -> expired", async () => {
    const t = setup();
    const { json, cookie } = await started(t.deps);
    const row = t.nonces.get(json.nonce)!;
    row.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect((await handleStatus(t.deps, { nonce: json.nonce, cookie })).json).toEqual({ status: "expired" });
    row.expiresAt = new Date(Date.now() + 60_000).toISOString();
    row.status = "consumed";
    expect((await handleStatus(t.deps, { nonce: json.nonce, cookie })).json).toEqual({ status: "expired" });
  });

  it("confirmed returns the masked identity for the verifier holder", async () => {
    const t = setup();
    const { json, cookie } = await started(t.deps);
    Object.assign(t.nonces.get(json.nonce)!, { status: "confirmed", telegramId: 555 });
    const res = await handleStatus(t.deps, { nonce: json.nonce, cookie });
    expect(res.json).toEqual({
      status: "confirmed",
      identity: { name: "Dilnoza A.", phoneMasked: "+998 90 *** ** 47" },
    });
  });

  it("confirmed without a profile -> identity null", async () => {
    const t = setup({ profiles: {}, users: {} });
    const { json, cookie } = await started(t.deps);
    Object.assign(t.nonces.get(json.nonce)!, { status: "confirmed", telegramId: 999 });
    const res = await handleStatus(t.deps, { nonce: json.nonce, cookie });
    expect(res.json).toEqual({ status: "confirmed", identity: null });
  });
});

describe("POST /exchange", () => {
  async function confirmed(t: ReturnType<typeof setup>, tg = 555) {
    const s = await started(t.deps);
    Object.assign(t.nonces.get(s.json.nonce)!, { status: "confirmed", telegramId: tg });
    return s;
  }
  const body = (nonce: string) => ({ nonce, confirm: true });

  it("created nonce -> 409", async () => {
    const t = setup();
    const { json, cookie } = await started(t.deps);
    const res = await handleExchange(t.deps, { body: body(json.nonce), cookie });
    expect(res.status).toBe(409);
    expect(t.calls.consume).toBe(0);
  });

  it("expired -> 410", async () => {
    const t = setup();
    const { json, cookie } = await confirmed(t);
    t.nonces.get(json.nonce)!.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect((await handleExchange(t.deps, { body: body(json.nonce), cookie })).status).toBe(410);
  });

  it("missing row, missing cookie and foreign cookie -> 404", async () => {
    const t = setup();
    const { json, cookie } = await confirmed(t);
    expect((await handleExchange(t.deps, { body: body("y".repeat(32)), cookie })).status).toBe(404);
    expect((await handleExchange(t.deps, { body: body(json.nonce), cookie: undefined })).status).toBe(404);
    expect((await handleExchange(t.deps, { body: body(json.nonce), cookie: "someone-else" })).status).toBe(404);
    expect(t.nonces.get(json.nonce)!.status).toBe("confirmed");
  });

  it("requires explicit confirm: true", async () => {
    const t = setup();
    const { json, cookie } = await confirmed(t);
    const res = await handleExchange(t.deps, { body: { nonce: json.nonce }, cookie });
    expect(res.status).toBe(400);
    expect(t.nonces.get(json.nonce)!.status).toBe("confirmed");
  });

  it("no profile -> 409 no_profile and the nonce is NOT consumed", async () => {
    const t = setup();
    const { json, cookie } = await confirmed(t, 999);
    const res = await handleExchange(t.deps, { body: body(json.nonce), cookie });
    expect(res).toMatchObject({ status: 409, json: { error: "no_profile" } });
    expect(t.nonces.get(json.nonce)!.status).toBe("confirmed");
    expect(t.calls.consume).toBe(0);
  });

  it("success consumes once, uses the stored auth email, returns only tokenHash and clears the cookie", async () => {
    const t = setup();
    const { json, cookie } = await confirmed(t);
    const res = await handleExchange(t.deps, { body: body(json.nonce), cookie });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ tokenHash: "hash-for-tg_555@users.internal" });
    expect(res.cookie).toEqual({ clear: true });
    expect(t.nonces.get(json.nonce)!.status).toBe("consumed");

    const again = await handleExchange(t.deps, { body: body(json.nonce), cookie });
    expect(again.status).toBe(409);
    expect(t.calls.consume).toBe(1);
  });

  describe("untrusted auth user (profiles.telegram_id points at a foreign account)", () => {
    const cases: [string, Seed["users"]][] = [
      ["telegram_id mismatch", { "uid-1": { ...GOOD_USER, appTelegramId: 556 } }],
      ["missing app_metadata (user_metadata-only)", { "uid-1": { ...GOOD_USER, appTelegramId: undefined } }],
      ["unconfirmed email", { "uid-1": { ...GOOD_USER, emailConfirmedAt: null } }],
      ["no email", { "uid-1": { ...GOOD_USER, email: null } }],
      ["no auth user", {}],
    ];
    for (const [name, users] of cases) {
      it(`${name} -> 409 no_profile, nothing consumed or minted`, async () => {
        const t = setup({ profiles: SEED.profiles, users });
        const { json, cookie } = await confirmed(t);
        const res = await handleExchange(t.deps, { body: body(json.nonce), cookie });
        expect(res).toMatchObject({ status: 409, json: { error: "no_profile" } });
        expect(t.nonces.get(json.nonce)!.status).toBe("confirmed");
        expect(t.calls.consume).toBe(0);
        expect(t.calls.generate).toBe(0);
      });
    }

    it("compares telegram ids as strings (bigint vs number vs string)", async () => {
      const t = setup({ profiles: SEED.profiles, users: { "uid-1": { ...GOOD_USER, appTelegramId: "555" } } });
      const { json, cookie } = await confirmed(t);
      expect((await handleExchange(t.deps, { body: body(json.nonce), cookie })).status).toBe(200);
    });
  });

  it("a failed token mint reverts the consume so the attempt can be retried", async () => {
    const t = setup();
    const { json, cookie } = await confirmed(t);
    t.store.generateTokenHash = async () => null;
    const res = await handleExchange(t.deps, { body: body(json.nonce), cookie });
    expect(res.status).toBe(500);
    expect(t.calls.revert).toBe(1);
    expect(t.nonces.get(json.nonce)!.status).toBe("confirmed");
  });

  it("consume happens before the token is minted", async () => {
    const t = setup();
    const { json, cookie } = await confirmed(t);
    const order: string[] = [];
    const c = t.store.consumeNonce;
    t.store.consumeNonce = async (n, h) => (order.push("consume"), c(n, h));
    const g = t.store.generateTokenHash;
    t.store.generateTokenHash = async (e) => (order.push("mint"), g(e));
    await handleExchange(t.deps, { body: body(json.nonce), cookie });
    expect(order).toEqual(["consume", "mint"]);
  });

  it("a lost consume race returns 409 and no tokenHash", async () => {
    const t = setup();
    const { json, cookie } = await confirmed(t);
    const original = t.store.consumeNonce;
    t.store.consumeNonce = async (n, h) => {
      t.nonces.get(n)!.status = "consumed"; // the other request wins first
      return original(n, h);
    };
    const res = await handleExchange(t.deps, { body: body(json.nonce), cookie });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.json)).not.toContain("hash-for");
  });
});

describe("identity formatting", () => {
  it("displayName: first name + last initial", () => {
    expect(displayName("Dilnoza Abdullayeva")).toBe("Dilnoza A.");
    expect(displayName("Ali")).toBe("Ali");
    expect(displayName("Ali Valiyev Karimovich")).toBe("Ali K.");
    expect(displayName("")).toBe("Foydalanuvchi");
  });
  it("maskPhone", () => {
    expect(maskPhone("+998901234547")).toBe("+998 90 *** ** 47");
    expect(maskPhone("+79161234567")).toBe("+791 *** ** 67");
    expect(maskPhone(null)).toBe("+*** *** ** **");
  });
});

describe("POST /cancel", () => {
  it("deletes the row for the cookie holder only and clears the cookie", async () => {
    const t = setup();
    const { json, cookie } = await started(t.deps);
    expect((await handleCancel(t.deps, { body: { nonce: json.nonce }, cookie: "other" })).status).toBe(404);
    expect(t.nonces.has(json.nonce)).toBe(true);
    const res = await handleCancel(t.deps, { body: { nonce: json.nonce }, cookie });
    expect(res).toMatchObject({ status: 200, cookie: { clear: true } });
    expect(t.nonces.has(json.nonce)).toBe(false);
    expect((await handleStatus(t.deps, { nonce: json.nonce, cookie })).json).toEqual({ status: "expired" });
  });
});

describe("cleanup and origin rule", () => {
  it("/start purges only occasionally", async () => {
    const t = setup();
    t.deps.random = () => 0.5;
    await handleStart(t.deps);
    expect(t.calls.purge).toBe(0);
    t.deps.random = () => 0.001;
    await handleStart(t.deps);
    expect(t.calls.purge).toBe(1);
  });

  it("originAllowed", () => {
    const o = "https://app.example.com";
    const h = (x: Record<string, string>) => new Headers(x);
    expect(originAllowed(h({ "sec-fetch-site": "same-origin" }), o)).toBe(true);
    expect(originAllowed(h({ "sec-fetch-site": "same-site" }), o)).toBe(true);
    expect(originAllowed(h({ "sec-fetch-site": "none" }), o)).toBe(true);
    expect(originAllowed(h({ "sec-fetch-site": "cross-site" }), o)).toBe(false);
    expect(originAllowed(h({ "sec-fetch-site": "cross-site", origin: o }), o)).toBe(true);
    expect(originAllowed(h({ origin: "https://evil.example" }), o)).toBe(false);
    expect(originAllowed(h({ origin: o }), o)).toBe(true);
    expect(originAllowed(h({}), o)).toBe(true);
  });
});
