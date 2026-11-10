import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createSupabaseAttemptStore } from "@/server/attempts-store";
import { handleCompleteRequest, readLimitedJson } from "@/server/lesson-api";
import { getPathWith, supabasePathDb } from "@/server/path";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

/** POST /api/lesson/complete { partId } -> { completed, xpAwarded?, newlyCompleted? | missing[] } */
export async function POST(request: Request) {
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
    {
      store,
      async canPlay(studentId, partId) {
        const path = await getPathWith(supabasePathDb(user), studentId);
        return path.modules.some((m) =>
          m.lessons.some((l) => l.parts.some((p) => p.id === partId && p.status !== "locked")),
        );
      },
    },
    { userId, body: parsed.body },
  );
  return NextResponse.json(json, { status, headers: NO_STORE });
}
