import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Web side of the Telegram deep-link login. Pure route logic over an injected store.
 *
 * Threat model in one paragraph: the nonce travels through the Telegram deep link and is
 * therefore NOT a secret. The browser that called /start also holds a random verifier in an
 * HttpOnly cookie (`po_login`); only sha256(verifier) is stored. /status and /exchange demand
 * that cookie, so whoever merely learns or guesses a nonce cannot read the identity or mint a
 * session. The page additionally shows the confirmed name/phone and a match code so a user
 * cannot be talked into finishing somebody else's login.
 *
 * Rate limiting: deliberately NOT implemented. An in-memory counter is meaningless on
 * serverless, and a shared one would add a write per poll. The defences are: 192-bit nonce,
 * verifier cookie required, 10 minute expiry, single-use atomic consume.
 */

export const LOGIN_COOKIE = "po_login";
export const LOGIN_COOKIE_PATH = "/api/auth";
export const NONCE_TTL_MS = 10 * 60_000;
const NONCE_RE = /^[A-Za-z0-9_-]{32}$/;

export type NonceRow = {
  status: "created" | "confirmed" | "consumed";
  telegramId: number | null;
  expiresAt: string;
  verifierHash: string | null;
};
export type ProfileRow = { id: string; fullName: string; phone: string | null };

export interface AuthStore {
  insertNonce(row: { nonce: string; verifierHash: string; expiresAt: string }): Promise<void>;
  /** Best-effort cleanup of long-dead rows; failures must not break login. */
  purgeStale(): Promise<void>;
  getNonce(nonce: string): Promise<NonceRow | null>;
  getProfileByTelegramId(telegramId: number): Promise<ProfileRow | null>;
  /** Atomic confirmed -> consumed for this verifier while unexpired. Null when not won. */
  consumeNonce(nonce: string, verifierHash: string): Promise<{ telegramId: number } | null>;
  getAuthEmail(userId: string): Promise<string | null>;
  /** Magic-link token hash for the email, or null when it cannot be generated. */
  generateTokenHash(email: string): Promise<string | null>;
}

export interface AuthDeps {
  store: AuthStore;
  now?: () => Date;
  botUsername: () => string;
  matchCode: (nonce: string) => string;
}

export type CookieAction = { set: string } | { clear: true } | undefined;
export type HandlerResult = { status: number; json: unknown; cookie?: CookieAction };

const sha256hex = (v: string) => createHash("sha256").update(v).digest("hex");

function hashMatches(cookie: string | undefined, stored: string | null): boolean {
  if (!cookie || !stored) return false;
  const a = Buffer.from(sha256hex(cookie), "hex");
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "Dilnoza Abdullayeva" -> "Dilnoza A." */
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Foydalanuvchi";
  if (parts.length === 1) return parts[0]!;
  const last = Array.from(parts[parts.length - 1]!)[0]!.toUpperCase();
  return `${parts[0]} ${last}.`;
}

/** "+998901234547" -> "+998 90 *** ** 47" */
export function maskPhone(phone: string | null): string {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 7) return "+*** *** ** **";
  if (d.startsWith("998") && d.length === 12) return `+998 ${d.slice(3, 5)} *** ** ${d.slice(-2)}`;
  return `+${d.slice(0, 3)} *** ** ${d.slice(-2)}`;
}

const NOT_FOUND: HandlerResult = { status: 404, json: { status: "expired" } };
const expiredAt = (row: NonceRow, now: Date) => new Date(row.expiresAt).getTime() <= now.getTime();

export async function handleStart(deps: AuthDeps): Promise<HandlerResult> {
  const now = (deps.now ?? (() => new Date()))();
  const nonce = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS).toISOString();
  await deps.store.insertNonce({ nonce, verifierHash: sha256hex(verifier), expiresAt });
  await deps.store.purgeStale().catch(() => undefined);
  return {
    status: 200,
    json: {
      nonce,
      deepLink: `https://t.me/${deps.botUsername()}?start=login_${nonce}`,
      expiresAt,
      matchCode: deps.matchCode(nonce),
    },
    cookie: { set: verifier },
  };
}

/** Looks the nonce up and checks the verifier cookie. Null = answer 404. */
async function ownedNonce(deps: AuthDeps, nonce: unknown, cookie: string | undefined) {
  if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) return null;
  const row = await deps.store.getNonce(nonce);
  if (!row || !hashMatches(cookie, row.verifierHash)) return null;
  return row;
}

export async function handleStatus(
  deps: AuthDeps,
  input: { nonce: string | null; cookie: string | undefined },
): Promise<HandlerResult> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await ownedNonce(deps, input.nonce, input.cookie);
  // A deleted row (bot-side cancel), a foreign/missing cookie and an expired or used nonce are
  // all the same terminal answer: the client stops polling and offers a retry.
  if (!row) return NOT_FOUND;
  if (expiredAt(row, now) || row.status === "consumed") return { status: 200, json: { status: "expired" } };
  if (row.status === "created") return { status: 200, json: { status: "created" } };
  const profile = row.telegramId === null ? null : await deps.store.getProfileByTelegramId(row.telegramId);
  return {
    status: 200,
    json: {
      status: "confirmed",
      identity: profile ? { name: displayName(profile.fullName), phoneMasked: maskPhone(profile.phone) } : null,
    },
  };
}

export async function handleExchange(
  deps: AuthDeps,
  input: { body: unknown; cookie: string | undefined },
): Promise<HandlerResult> {
  const now = (deps.now ?? (() => new Date()))();
  const body = (input.body ?? {}) as { nonce?: unknown; confirm?: unknown };
  const row = await ownedNonce(deps, body.nonce, input.cookie);
  if (!row) return { status: 404, json: { error: "not_found" } };
  if (body.confirm !== true) return { status: 400, json: { error: "confirmation_required" } };
  if (expiredAt(row, now)) return { status: 410, json: { error: "expired" } };
  if (row.status !== "confirmed" || row.telegramId === null) return { status: 409, json: { error: "not_confirmed" } };

  // Everything that can fail benignly happens BEFORE the nonce is consumed, so a missing
  // profile or a transient admin error does not burn the login attempt.
  const profile = await deps.store.getProfileByTelegramId(row.telegramId);
  if (!profile) return { status: 409, json: { error: "no_profile" } };
  const email = await deps.store.getAuthEmail(profile.id);
  if (!email) return { status: 409, json: { error: "no_profile" } };
  const tokenHash = await deps.store.generateTokenHash(email);
  if (!tokenHash) return { status: 500, json: { error: "internal_error" } };

  // The link above is only returned to the caller that wins this single-use consume.
  const won = await deps.store.consumeNonce(body.nonce as string, sha256hex(input.cookie as string));
  if (!won) return { status: 409, json: { error: "not_confirmed" } };
  return { status: 200, json: { tokenHash }, cookie: { clear: true } };
}
