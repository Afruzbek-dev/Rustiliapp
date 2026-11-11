import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signSubmissionAudio } from "@/server/submission-media";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/submissions/audio-url?id= -> { url } | 401 (no session) | 404 (missing, invisible or not audio: indistinguishable) */
export async function GET(request: Request) {
  try {
    const user = await createClient();
    const { data } = await user.auth.getUser();
    if (!data.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    const res = await signSubmissionAudio(data.user.id, id);
    if (res.status !== "ok") return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ url: res.url }, { headers: NO_STORE });
  } catch (e) {
    console.error("audio url failed", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
