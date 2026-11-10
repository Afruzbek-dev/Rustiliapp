import type { NextRequest } from "next/server";
import { handleStatus } from "@/server/auth";
import { authDeps, guarded, loginCookie } from "@/server/auth-store";

export const dynamic = "force-dynamic";

/** GET /api/auth/telegram/status?nonce= -> { status, identity? }; requires the verifier cookie. */
export async function GET(request: NextRequest) {
  const nonce = request.nextUrl.searchParams.get("nonce");
  return guarded(() => handleStatus(authDeps(), { nonce, cookie: loginCookie(request) }));
}
