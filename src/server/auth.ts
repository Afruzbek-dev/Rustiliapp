import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Web side of the Telegram deep-link login. Pure route logic over an injected store.
 *
 * Threat model in one paragraph: the nonce travels through the Telegram deep link and is
 * therefore NOT a secret. The browser that called /start also holds a random verifier in an
 * HttpOnly cookie (see `loginCookieName`); only sha256(verifier) is stored. /status, /exchange
 * and /cancel demand that cookie, so whoever merely learns or guesses a nonce cannot read the
 * identity or mint a session. The page additionally shows the confirmed name/phone and a match
 * code so a user cannot be talked into finishing somebody else's login.
 *
 * Rate limiting: deliberately NOT implemented in code. An in-memory counter is meaningless on
 * serverless, and a shared one would add a write per poll. The defences are: 192-bit nonce,
 * verifier cookie required, 10 minute expiry, single-use atomic consume, a cross-site POST check,
 * and a platform rate limit on POST /api/auth/telegram/start (see README deploy checklist).
 */

/** `__Secure-` prefix in production (the browser then insists on Secure); plain name in dev over http. */
export const loginCookieName = () => (process.env.NODE_ENV === "production" ? "__Secure-po_login" : "po_login");
export const LOGIN_COOKIE_PATH = "/api/auth";
export const NONCE_TTL_MS = 10 * 60_000;
const NONCE_RE = /^[A-Za-z0-9_-]{32}$/;
/** Roughly one /start in this many also runs the (bounded) cleanup of long-dead rows. */
const CLEANUP_ODDS = 1 / 50;

export type NonceRow = {
  status: "created" | "confirmed" | "consumed";
  telegramId: number | null;
  expiresAt: string;
  verifierHash: string | null;
};
export type ProfileRow = { id: string; fullName: string; phone: string | null };
export type AuthUserInfo = { email: string | null; emailConfirmedAt: string | null; appTelegramId: unknown };

export interface AuthStore {
  insertNonce(row: { nonce: string; verifierHash: string; expiresAt: string }): Promise<void>;
  /** Bounded best-effort cleanup of long-dead rows; failures must not break login. */
  purgeStale(): Promise<void>;
  deleteNonce(nonce: string): Promise<void>;
  getNonce(nonce: string): Promise<NonceRow | null>;
  getProfileByTelegramId(telegramId: number): Promise<ProfileRow | null>;
  /** Atomic confirmed -> consumed for this verifier while unexpired (DB clock). Null when not won. */
  consumeNonce(nonce: string, verifierHash: string): Promise<{ telegramId: number } | null>;
  /** Undo a consume after a failure that happened before any token was handed out. */
  revertConsume(nonce: string, verifierHash: string): Promise<void>;
  getAuthUser(userId: string): Promise<AuthUserInfo | null>;
  /** Magic-link token hash for the email, or null when it cannot be generated. */
  generateTokenHash(email: string): Promise<string | null>;
}

export interface AuthDeps {
  store: AuthStore;
  now?: () => Date;
  botUsername: () => string;
  matchCode: (nonce: string) => string;
  /** Origin of the deployment (from APP_URL), used by the cross-site POST check. */
  appOrigin: () => string;
  /** Injectable for tests; decides whether /start also runs the cleanup. */
  random?: () => number;
}

/**
 * Cross-site POST rule for /start, /exchange and /cancel. A browser request is accepted when
 * `Sec-Fetch-Site` is same-origin, same-site or none (user-initiated); with any other value
 * (cross-site) only when `Origin` equals the app origin. Without `Sec-Fetch-Site`, `Origin` must be
 * absent or equal the app origin. Requests with neither header (curl, server-to-server) are
 * allowed: they cannot ride a victim's cookies, and the verifier cookie is required downstream.
 */
export function originAllowed(headers: Headers, appOrigin: string): boolean {
  const site = headers.get("sec-fetch-site");
  const origin = headers.get("origin");
  if (site) {
    if (site === "same-origin" || site === "same-site" || site === "none") return true;
    return origin === appOrigin;
  }
  return origin === null || origin === appOrigin;
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
  if ((deps.random ?? Math.random)() < CLEANUP_ODDS) await deps.store.purgeStale().catch(() => undefined);
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

  // Everything that can fail benignly happens BEFORE the nonce is consumed, so a missing or
  // untrusted profile does not burn the login attempt. All of those answer the same no_profile
  // (which check failed is deliberately not revealed).
  const profile = await deps.store.getProfileByTelegramId(row.telegramId);
  if (!profile) return { status: 409, json: { error: "no_profile" } };
  const user = await deps.store.getAuthUser(profile.id);
  const trusted =
    user !== null &&
    !!user.email &&
    !!user.emailConfirmedAt &&
    // app_metadata is server-written only; user_metadata is user-editable and never trusted.
    user.appTelegramId !== null &&
    user.appTelegramId !== undefined &&
    String(user.appTelegramId) === String(row.telegramId);
  if (!trusted) return { status: 409, json: { error: "no_profile" } };

  const nonce = body.nonce as string;
  const hash = sha256hex(input.cookie as string);
  const won = await deps.store.consumeNonce(nonce, hash);
  if (!won) return { status: 409, json: { error: "not_confirmed" } };
  if (won.telegramId !== row.telegramId) {
    await deps.store.revertConsume(nonce, hash).catch(() => undefined);
    return { status: 409, json: { error: "not_confirmed" } };
  }

  // Consume first, then mint: generating a link for an unconsumed nonce could make GoTrue
  // overwrite the token of a concurrent winner. If minting fails, give the attempt back.
  let tokenHash: string | null = null;
  try {
    tokenHash = await deps.store.generateTokenHash(user!.email!);
  } catch {
    tokenHash = null;
  }
  if (!tokenHash) {
    await deps.store.revertConsume(nonce, hash).catch(() => undefined);
    return { status: 500, json: { error: "internal_error" } };
  }
  return { status: 200, json: { tokenHash }, cookie: { clear: true } };
}

export async function handleCancel(
  deps: AuthDeps,
  input: { body: unknown; cookie: string | undefined },
): Promise<HandlerResult> {
  const body = (input.body ?? {}) as { nonce?: unknown };
  const row = await ownedNonce(deps, body.nonce, input.cookie);
  if (!row) return { status: 404, json: { error: "not_found" } };
  await deps.store.deleteNonce(body.nonce as string);
  return { status: 200, json: { ok: true }, cookie: { clear: true } };
}
