import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readSmallJson } from "@/server/audio-submissions";
import { handleReviewRequest, submitReview } from "@/server/reviews";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** POST /api/reviews { submissionId, scores, comment? }: the reviewer is the session user. */
export async function POST(request: Request) {
  const user = await createClient();
  const { data } = await user.auth.getUser();
  const userId = data.user?.id ?? null;
  // Auth first: no body is read for anonymous callers.
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });

  const parsed = await readSmallJson(request); // 4 KB cap
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.status === 413 ? "payload_too_large" : "invalid_request" },
      { status: parsed.status, headers },
    );
  }
  const { status, json } = await handleReviewRequest(
    {
      // USER-scoped read: submissions_select (student / group curator / course teacher / admin).
      async canRead(submissionId) {
        const { data: row, error } = await user.from("submissions").select("id").eq("id", submissionId).maybeSingle();
        if (error) throw new Error("read failed");
        return !!row;
      },
      submit: (input) => submitReview(input),
    },
    { userId, body: parsed.body },
  );
  return NextResponse.json(json, { status, headers });
}
