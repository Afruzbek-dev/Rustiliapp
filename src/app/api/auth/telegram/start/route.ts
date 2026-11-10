import { handleStart } from "@/server/auth";
import { authDeps, guarded } from "@/server/auth-store";

export const dynamic = "force-dynamic";

/** POST /api/auth/telegram/start -> { nonce, deepLink, expiresAt, matchCode } + HttpOnly verifier cookie. */
export async function POST() {
  return guarded(() => handleStart(authDeps()));
}
