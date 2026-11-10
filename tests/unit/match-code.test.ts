import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loginMatchCode } from "@/lib/telegram/match-code";

const NONCE = "abcdefghijklmnopqrstuvwxyz012345";

describe("loginMatchCode domain separation", () => {
  it("keys the HMAC with HMAC(secret, 'login-match'), not the raw secret", () => {
    const secret = "w".repeat(40);
    const key = createHmac("sha256", secret).update("login-match").digest();
    const expected = String(createHmac("sha256", key).update(NONCE).digest().readUInt32BE(0) % 100).padStart(2, "0");
    expect(loginMatchCode(NONCE, secret)).toBe(expected);
  });

  it("is stable for the same inputs and depends on the secret", () => {
    const a = loginMatchCode(NONCE, "a".repeat(40));
    expect(loginMatchCode(NONCE, "a".repeat(40))).toBe(a);
    const codes = new Set(["b", "c", "d", "e", "f", "g"].map((c) => loginMatchCode(NONCE, c.repeat(40))));
    expect(codes.size).toBeGreaterThan(1);
  });
});
