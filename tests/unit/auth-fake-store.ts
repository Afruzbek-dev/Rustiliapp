import { createHash } from "node:crypto";
import type { AuthDeps, AuthStore, AuthUserInfo, NonceRow, ProfileRow } from "@/server/auth";

export const sha = (v: string) => createHash("sha256").update(v).digest("hex");

export type Seed = { profiles?: Record<number, ProfileRow>; users?: Record<string, AuthUserInfo> };

export const GOOD_USER: AuthUserInfo = {
  email: "tg_555@users.internal",
  emailConfirmedAt: "2026-01-01T00:00:00Z",
  appTelegramId: 555,
};
export const PROFILE: ProfileRow = { id: "uid-1", fullName: "Dilnoza Abdullayeva", phone: "+998901234547" };
export const SEED: Seed = { profiles: { 555: PROFILE }, users: { "uid-1": GOOD_USER } };

export function fakeStore(seed: Seed = SEED) {
  const nonces = new Map<string, NonceRow>();
  const calls = { consume: 0, generate: 0, revert: 0, purge: 0 };
  const store: AuthStore = {
    async insertNonce(r) {
      nonces.set(r.nonce, { status: "created", telegramId: null, expiresAt: r.expiresAt, verifierHash: r.verifierHash });
    },
    async purgeStale() {
      calls.purge++;
    },
    async deleteNonce(n) {
      nonces.delete(n);
    },
    async getNonce(n) {
      return nonces.get(n) ?? null;
    },
    async getProfileByTelegramId(id) {
      return seed.profiles?.[id] ?? null;
    },
    async consumeNonce(n, h) {
      calls.consume++;
      const row = nonces.get(n);
      if (!row || row.status !== "confirmed" || row.verifierHash !== h || Date.parse(row.expiresAt) <= Date.now()) return null;
      row.status = "consumed";
      return { telegramId: row.telegramId! };
    },
    async revertConsume(n, h) {
      calls.revert++;
      const row = nonces.get(n);
      if (row && row.status === "consumed" && row.verifierHash === h) row.status = "confirmed";
    },
    async getAuthUser(id) {
      return seed.users?.[id] ?? null;
    },
    async generateTokenHash(email) {
      calls.generate++;
      return `hash-for-${email}`;
    },
  };
  const deps: AuthDeps = {
    store,
    botUsername: () => "po_russki_bot",
    matchCode: () => "47",
    appOrigin: () => "https://app.example.com",
    random: () => 0.99,
  };
  return { store, nonces, calls, deps };
}
