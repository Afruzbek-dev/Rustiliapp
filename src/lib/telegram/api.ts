import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";

export type Db = ReturnType<typeof createServiceClient>;

export type NonceRow = {
  nonce: string;
  telegram_id: number | null;
  status: "created" | "confirmed" | "consumed";
  expires_at: string;
  created_at: string;
};

const NONCE_COLUMNS = "nonce, telegram_id, status, expires_at, created_at";

/** Staff-visible DB/auth failure. Carries only the operation and a code: never row data or messages. */
export class TelegramDbError extends Error {
  constructor(
    public readonly op: string,
    public readonly code: string,
  ) {
    super(`telegram db error in ${op} (${code})`);
    this.name = "TelegramDbError";
  }
}

type DbErrorLike = { message?: string; code?: string } | null;

function fail(op: string, error: DbErrorLike): never {
  const isPhoneKey = error?.code === "23505" && (error.message ?? "").includes("profiles_phone_key");
  throw new TelegramDbError(op, isPhoneKey ? "phone_conflict" : (error?.code ?? "unknown"));
}

/** E.164 with a leading "+"; null when the number is not plausible. */
export function normalizePhone(raw: string): string | null {
  const phone = `+${raw.replace(/\D/g, "")}`;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
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

/**
 * created -> confirmed, only for the user the nonce is bound to and only while unexpired.
 * Returns true when confirmed now, or when it already was by the same user (Telegram retry).
 */
export async function confirmNonce(db: Db, nonce: string, telegramId: number): Promise<boolean> {
  const { data, error } = await db
    .from("login_nonces")
    .update({ status: "confirmed" })
    .eq("nonce", nonce)
    .eq("status", "created")
    .eq("telegram_id", telegramId)
    .gt("expires_at", new Date().toISOString())
    .select("nonce");
  if (error) fail("confirmNonce", error);
  if (data && data.length > 0) return true;
  const row = await getNonce(db, nonce);
  return isLiveNonce(row) && row.status === "confirmed" && row.telegram_id === telegramId;
}

/** Drops a still-`created` nonce bound to this user (the user pressed "cancel"). */
export async function cancelNonce(db: Db, nonce: string, telegramId: number): Promise<void> {
  const { error } = await db
    .from("login_nonces")
    .delete()
    .eq("nonce", nonce)
    .eq("status", "created")
    .eq("telegram_id", telegramId);
  if (error) fail("cancelNonce", error);
}

/** The profile (if any) already holding this phone number. */
export async function profileByPhone(db: Db, phone: string): Promise<{ id: string; telegram_id: number | null } | null> {
  const { data, error } = await db.from("profiles").select("id, telegram_id").eq("phone", phone).maybeSingle();
  if (error) fail("profileByPhone", error);
  return (data as { id: string; telegram_id: number | null } | null) ?? null;
}

/**
 * Finds or creates the auth user `tg_<id>@users.internal`.
 * Created users carry `app_metadata.telegram_id` (not editable by the user). An existing user with
 * that email is adopted only when it carries the same trusted app_metadata: anyone could have
 * pre-registered the address through public signup.
 */
export async function ensureAuthUser(
  db: Db,
  telegramId: number,
  fullName: string,
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: profileError } = await db
    .from("profiles")
    .select("id")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (profileError) fail("profileLookup", profileError);
  if (existing) return { id: (existing as { id: string }).id, created: false };

  const email = internalEmail(telegramId);
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { telegram_id: telegramId },
    user_metadata: { full_name: fullName },
  });
  if (!error && data.user) return { id: data.user.id, created: true };
  if ((error as { code?: string } | null)?.code !== "email_exists") fail("createUser", error);

  const { data: id, error: rpcError } = await db.rpc("auth_user_id_by_email", { p_email: email });
  if (rpcError || !id) fail("authLookup", rpcError ?? { code: "not_found" });
  const { data: found, error: getError } = await db.auth.admin.getUserById(id as string);
  if (getError || !found.user) fail("getUserById", getError ?? { code: "not_found" });
  if (found.user.app_metadata?.telegram_id !== telegramId) {
    throw new TelegramDbError("ensureAuthUser", "untrusted_auth_user");
  }
  return { id: found.user.id, created: false };
}

/** Best-effort cleanup of an auth user created in this request when the profile write failed. */
export async function deleteAuthUser(db: Db, id: string): Promise<void> {
  await db.auth.admin.deleteUser(id).catch(() => undefined);
}

/**
 * Upserts the profile. `role` is never written, so an existing teacher/curator keeps it;
 * `full_name` is only set on insert or when the stored name is empty.
 */
export async function upsertProfile(
  db: Db,
  p: { id: string; telegramId: number; phone: string; fullName: string; username: string | null },
): Promise<void> {
  const { data: current, error: readError } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", p.id)
    .maybeSingle();
  if (readError) fail("profileRead", readError);
  const keepName = !!(current as { full_name: string } | null)?.full_name;
  const { error } = await db.from("profiles").upsert(
    {
      id: p.id,
      telegram_id: p.telegramId,
      phone: p.phone,
      telegram_username: p.username,
      ...(keepName ? {} : { full_name: p.fullName }),
    },
    { onConflict: "id" },
  );
  if (error) fail("upsertProfile", error);
}
