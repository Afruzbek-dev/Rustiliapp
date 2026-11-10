import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { bumpDailyTaskOnce } from "@/server/daily-tasks";
import { handleAudioListened, readLimitedJson } from "@/server/lesson-api";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

/** POST /api/lesson/audio-listened { blockId } -> bumps the daily 'audio' task once per day. */
export async function POST(request: Request) {
  const user = await createClient();
  const { data } = await user.auth.getUser();
  const userId = data.user?.id ?? null;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });

  const parsed = await readLimitedJson(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.status === 413 ? "payload_too_large" : "invalid_request" },
      { status: parsed.status, headers: NO_STORE },
    );
  }

  const { status, json } = await handleAudioListened(
    {
      async getRole(id) {
        const { data: p, error } = await user.from("profiles").select("role").eq("id", id).maybeSingle();
        if (error) throw new Error(`getRole: ${error.message}`);
        return (p?.role as string | undefined) ?? null;
      },
      async getVisibleBlock(blockId) {
        const { data: b, error } = await user
          .from("blocks")
          .select("id, type, payload")
          .eq("id", blockId)
          .eq("published", true)
          .maybeSingle();
        if (error) throw new Error(`getVisibleBlock: ${error.message}`);
        return b ? { id: b.id as string, type: b.type as string, payload: b.payload } : null;
      },
      bumpAudioOnce: (studentId) => bumpDailyTaskOnce(createServiceClient(), studentId, "audio"),
    },
    { userId, body: parsed.body },
  );
  return NextResponse.json(json, { status, headers: NO_STORE });
}
