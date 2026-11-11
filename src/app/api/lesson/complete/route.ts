import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createSupabaseAttemptStore } from "@/server/attempts-store";
import { canPlayPart } from "@/server/lesson";
import { handleCompleteRequest, readLimitedJson } from "@/server/lesson-api";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

/** POST /api/lesson/complete { partId } -> { completed, xpAwarded?, newlyCompleted? | missing[] } */
export async function POST(request: Request) {
  try {
    const user = await createClient();
    const { data } = await user.auth.getUser();
    // Auth first: no body is read for anonymous callers.
    const userId = data.user?.id ?? null;
    if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });

    const parsed = await readLimitedJson(request);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.status === 413 ? "payload_too_large" : "invalid_request" },
        { status: parsed.status, headers: NO_STORE },
      );
    }

    const store = createSupabaseAttemptStore(user, createServiceClient());
    const { status, json } = await handleCompleteRequest(
      { store, canPlay: (studentId, partId) => canPlayPart(user, studentId, partId) },
      { userId, body: parsed.body },
    );
    return NextResponse.json(json, { status, headers: NO_STORE });
  } catch (e) {
    // Class name only: messages may carry env details or user data.
    console.error("lesson complete route: failed", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
