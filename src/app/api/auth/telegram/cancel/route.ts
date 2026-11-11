import type { NextRequest } from "next/server";
import { handleCancel } from "@/server/auth";
import { authDeps, checkOrigin, guarded, loginCookie, readJson } from "@/server/auth-store";

export const dynamic = "force-dynamic";

/** POST /api/auth/telegram/cancel { nonce } -> deletes the login row; requires the verifier cookie. */
export async function POST(request: NextRequest) {
  return guarded(async () => {
    const deps = authDeps();
    return checkOrigin(request, deps) ?? handleCancel(deps, { body: await readJson(request), cookie: loginCookie(request) });
  });
}
