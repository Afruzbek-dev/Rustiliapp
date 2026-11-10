import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { handleAttemptRequest, readJsonBody } from "@/server/attempts";
import { createSupabaseAttemptStore } from "@/server/attempts-store";

export const dynamic = "force-dynamic";

/** POST /api/attempts { exerciseId, answer } -> { correct, expected?, perItem?, xpAwarded, partCompleted? } */
export async function POST(request: Request) {
  const user = await createClient();
  const { data } = await user.auth.getUser();

  // Auth first: no body is read for anonymous callers.
  const userId = data.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.status === 413 ? "payload_too_large" : "invalid_request" },
      { status: parsed.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const store = createSupabaseAttemptStore(user, createServiceClient());
  const { status, json } = await handleAttemptRequest({ store }, { userId, body: parsed.body });
  return NextResponse.json(json, { status, headers: { "Cache-Control": "no-store" } });
}
