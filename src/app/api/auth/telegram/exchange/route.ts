import type { NextRequest } from "next/server";
import { handleExchange } from "@/server/auth";
import { authDeps, checkOrigin, guarded, loginCookie, readJson } from "@/server/auth-store";

export const dynamic = "force-dynamic";

/** POST /api/auth/telegram/exchange { nonce, confirm: true } -> { tokenHash }; requires the verifier cookie. */
export async function POST(request: NextRequest) {
  return guarded(async () => {
    const deps = authDeps();
    return checkOrigin(request, deps) ?? handleExchange(deps, { body: await readJson(request), cookie: loginCookie(request) });
  });
}
