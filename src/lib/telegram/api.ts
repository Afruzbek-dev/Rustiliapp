import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";

export type Db = ReturnType<typeof createServiceClient>;

export type NonceRow = {
  nonce: string;
  telegram_id: number | null;
  status: "created" | "confirmed" | "consumed";
  expires_at: string;
};

const NONCE_COLUMNS = "nonce, telegram_id, status, expires_at";

function fail(op: string, error: { message: string } | null): never {
  // Never include row data (phones, tokens) in errors.
  throw new Error(`telegram db error in ${op}${error ? `: ${error.message}` : ""}`);
}

/** E.164: digits only with a leading "+". */
export function normalizePhone(raw: string): string {
  return `+${raw.replace(/\D/g, "")}`;
}

export function internalEmail(telegramId: number): string {
  return `tg_${telegramId}@users.internal`;
}

export function isLiveNonce(row: NonceRow | null, now = new Date()): row is NonceRow {
  return !!row && new Date(row.expires_at).getTime() > now.getTime();
}

export async function getNonce(db: Db, nonce: string): Promise<NonceRow | null> {
  const { data, error } = await db.from("login_nonces").select(NONCE_COLUMNS).eq("nonce", nonce).maybeSingle();
  if (error) fail("getNonce", error);
  return (data as NonceRow | null) ?? null;
}

/** Binds an unclaimed, live `created` nonce to a Telegram user. True if it is (now) bound to this user. */
export async function claimNonce(db: Db, nonce: string, telegramId: number): Promise<boolean> {
  const { data, error } = await db
    .from("login_nonces")
    .update({ telegram_id: telegramId })
    .eq("nonce", nonce)
    .eq("status", "created")
    .is("telegram_id", null)
    .gt("expires_at", new Date().toISOString())
    .select(NONCE_COLUMNS);
  if (error) fail("claimNonce", error);
  if (data && data.length > 0) return true;
  // Already claimed: fine only when claimed by the same user (repeated /start).
  const row = await getNonce(db, nonce);
  return isLiveNonce(row) && row.status === "created" && row.telegram_id === telegramId;
}

/** Latest live nonce (created or confirmed) bound to this Telegram user. */
export async function latestNonceFor(db: Db, telegramId: number): Promise<NonceRow | null> {
  const { data, error } = await db
    .from("login_nonces")
    .select(NONCE_COLUMNS)
    .eq("telegram_id", telegramId)
    .in("status", ["created", "confirmed"])
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) fail("latestNonceFor", error);
  return ((data as NonceRow[] | null) ?? [])[0] ?? null;
}

export async function confirmNonce(db: Db, nonce: string, telegramId: number): Promise<void> {
  const { error } = await db
    .from("login_nonces")
    .update({ status: "confirmed", telegram_id: telegramId })
    .eq("nonce", nonce)
    .eq("status", "created")
    .eq("telegram_id", telegramId);
  if (error) fail("confirmNonce", error);
}

async function findAuthUserIdByEmail(db: Db, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail("listUsers", error);
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

/** Finds or creates the auth user `tg_<id>@users.internal`; returns its id. */
export async function ensureAuthUser(db: Db, telegramId: number, fullName: string): Promise<string> {
  const { data: existing, error: profileError } = await db
    .from("profiles")
    .select("id")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (profileError) fail("profileLookup", profileError);
  if (existing) return (existing as { id: string }).id;

  const email = internalEmail(telegramId);
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { telegram_id: telegramId, full_name: fullName },
  });
  if (!error && data.user) return data.user.id;
  // Auth user exists without a profile (e.g. retry after a partial failure).
  const id = await findAuthUserIdByEmail(db, email);
  if (!id) fail("createUser", error);
  return id;
}

/** Upserts the profile; omitted columns (role) of an existing row are left untouched. */
export async function upsertProfile(
  db: Db,
  p: { id: string; telegramId: number; phone: string; fullName: string; username: string | null },
): Promise<void> {
  const { error } = await db.from("profiles").upsert(
    {
      id: p.id,
      telegram_id: p.telegramId,
      phone: p.phone,
      full_name: p.fullName,
      telegram_username: p.username,
    },
    { onConflict: "id" },
  );
  if (error) fail("upsertProfile", error);
}
