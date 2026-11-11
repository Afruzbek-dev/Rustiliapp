import type { NextRequest } from "next/server";
import { handleStart } from "@/server/auth";
import { authDeps, checkOrigin, guarded } from "@/server/auth-store";

export const dynamic = "force-dynamic";

/** POST /api/auth/telegram/start -> { nonce, deepLink, expiresAt, matchCode } + HttpOnly verifier cookie. */
export async function POST(request: NextRequest) {
  return guarded(async () => {
    const deps = authDeps();
    return checkOrigin(request, deps) ?? handleStart(deps);
  });
}
