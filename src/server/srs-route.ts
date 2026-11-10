import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SRS_MAX_BODY_BYTES, type HandlerResult, type SrsStore } from "./srs";
import { createSupabaseSrsStore } from "./srs-store";

const NO_STORE = { "Cache-Control": "no-store" };

/** JSON body with a hard size cap: 413 when too large, 400 when not valid JSON. */
async function readCappedJson(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413 };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** Shared transport shell of the /api/srs/* routes: session, body cap, store wiring. */
export async function runSrsRoute(
  request: Request,
  handler: (deps: { store: SrsStore }, req: { userId: string | null; body: unknown }) => Promise<HandlerResult>,
): Promise<NextResponse> {
  const user = await createClient();
  const { data } = await user.auth.getUser();
  // Auth first: no body is read for anonymous callers. The student id only ever comes from here.
  const userId = data.user?.id ?? null;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });

  const parsed = await readCappedJson(request, SRS_MAX_BODY_BYTES);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.status === 413 ? "payload_too_large" : "invalid_request" },
      { status: parsed.status, headers: NO_STORE },
    );
  }
  const store = createSupabaseSrsStore(user, createServiceClient());
  const { status, json } = await handler({ store }, { userId, body: parsed.body });
  return NextResponse.json(json, { status, headers: NO_STORE });
}
