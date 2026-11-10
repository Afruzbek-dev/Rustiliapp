import type { NextRequest } from "next/server";
import { handleExchange } from "@/server/auth";
import { authDeps, guarded, loginCookie } from "@/server/auth-store";

export const dynamic = "force-dynamic";

/** POST /api/auth/telegram/exchange { nonce, confirm: true } -> { tokenHash }; requires the verifier cookie. */
export async function POST(request: NextRequest) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // handled as not_found / confirmation_required by the handler
  }
  return guarded(() => handleExchange(authDeps(), { body, cookie: loginCookie(request) }));
}
