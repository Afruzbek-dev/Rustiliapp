import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";
import { loginMatchCode } from "@/lib/telegram/match-code";
import {
  LOGIN_COOKIE_PATH,
  loginCookieName,
  originAllowed,
  NONCE_TTL_MS,
  type AuthDeps,
  type AuthStore,
  type HandlerResult,
  type NonceRow,
} from "./auth";

type Service = ReturnType<typeof createServiceClient>;

export function createSupabaseAuthStore(db: Service): AuthStore {
  return {
    async insertNonce({ nonce, verifierHash, expiresAt }) {
      const { error } = await db
        .from("login_nonces")
        .insert({ nonce, verifier_hash: verifierHash, expires_at: expiresAt });
      if (error) throw new Error("auth: insert nonce failed");
    },
    async purgeStale() {
      await db.rpc("purge_login_nonces", { p_limit: 500 });
    },
    async deleteNonce(nonce) {
      await db.from("login_nonces").delete().eq("nonce", nonce);
    },
    async getNonce(nonce) {
      const { data, error } = await db
        .from("login_nonces")
        .select("status, telegram_id, expires_at, verifier_hash")
        .eq("nonce", nonce)
        .maybeSingle();
      if (error) throw new Error("auth: read nonce failed");
      if (!data) return null;
      return {
        status: data.status as NonceRow["status"],
        telegramId: data.telegram_id === null ? null : Number(data.telegram_id),
        expiresAt: data.expires_at as string,
        verifierHash: (data.verifier_hash as string | null) ?? null,
      };
    },
    async getProfileByTelegramId(telegramId) {
      const { data, error } = await db
        .from("profiles")
        .select("id, full_name, phone")
        .eq("telegram_id", telegramId)
        .maybeSingle();
      if (error) throw new Error("auth: read profile failed");
      return data ? { id: data.id as string, fullName: (data.full_name as string) ?? "", phone: data.phone as string | null } : null;
    },
    async consumeNonce(nonce, verifierHash) {
      // SQL function: single atomic UPDATE ... RETURNING on the DB clock (migration 0011).
      const { data, error } = await db.rpc("consume_login_nonce", { p_nonce: nonce, p_hash: verifierHash });
      if (error) throw new Error("auth: consume nonce failed");
      return data === null || data === undefined ? null : { telegramId: Number(data) };
    },
    async revertConsume(nonce, verifierHash) {
      await db
        .from("login_nonces")
        .update({ status: "confirmed" })
        .eq("nonce", nonce)
        .eq("status", "consumed")
        .eq("verifier_hash", verifierHash);
    },
    async getAuthUser(userId) {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (error || !data.user) return null;
      return {
        email: data.user.email ?? null,
        emailConfirmedAt: data.user.email_confirmed_at ?? null,
        appTelegramId: (data.user.app_metadata as Record<string, unknown> | undefined)?.telegram_id,
      };
    },
    async generateTokenHash(email) {
      const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
      if (error) return null;
      return data.properties?.hashed_token ?? null;
    },
  };
}

export function authDeps(): AuthDeps {
  return {
    store: createSupabaseAuthStore(createServiceClient()),
    botUsername: () => serverEnv().TELEGRAM_BOT_USERNAME,
    matchCode: (nonce) => loginMatchCode(nonce),
    appOrigin: () => new URL(serverEnv().APP_URL).origin,
  };
}

const NO_STORE = { "Cache-Control": "no-store" };

/** Turns a handler result into a response, applying the verifier cookie action. */
export function respond(result: HandlerResult): NextResponse {
  const res = NextResponse.json(result.json, { status: result.status, headers: NO_STORE });
  const base = {
    name: loginCookieName(),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: LOGIN_COOKIE_PATH,
  };
  if (result.cookie && "set" in result.cookie) {
    res.cookies.set({ ...base, value: result.cookie.set, maxAge: NONCE_TTL_MS / 1000 });
  } else if (result.cookie && "clear" in result.cookie) {
    res.cookies.set({ ...base, value: "", maxAge: 0 });
  }
  return res;
}

export const loginCookie = (request: NextRequest) => request.cookies.get(loginCookieName())?.value;

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null; // handlers answer 404 / 400 for a missing body
  }
}

/** Cross-site POSTs are refused before any work (see `originAllowed`). */
export function checkOrigin(request: Request, deps: AuthDeps): HandlerResult | null {
  return originAllowed(request.headers, deps.appOrigin()) ? null : { status: 403, json: { error: "forbidden" } };
}

/** Shared error shell: never leak internals, never cache. */
export async function guarded(fn: () => Promise<HandlerResult>): Promise<NextResponse> {
  try {
    return respond(await fn());
  } catch (e) {
    console.error("auth: route failed", e instanceof Error ? e.message : "unknown");
    return respond({ status: 500, json: { error: "internal_error" } });
  }
}
