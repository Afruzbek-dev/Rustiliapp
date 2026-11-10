import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { handleAudioUpload, readSmallJson } from "@/server/audio-submissions";
import { createSupabaseAudioStore } from "@/server/audio-store";
import { bumpDailyTask } from "@/server/daily-tasks";
import { notifyCuratorsOfSubmission } from "@/server/notify-curators";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const user = await createClient();
  const { data } = await user.auth.getUser();
  const userId = data.user?.id ?? null;
  // Auth first: no body is read for anonymous callers.
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });

  const parsed = await readSmallJson(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.status === 413 ? "payload_too_large" : "invalid_request" },
      { status: parsed.status, headers },
    );
  }
  const service = createServiceClient();
  const { status, json } = await handleAudioUpload(
    {
      store: createSupabaseAudioStore(user, service),
      bumpSpeaking: (studentId) => bumpDailyTask(service, studentId, "speaking"),
      notify: notifyCuratorsOfSubmission,
    },
    { userId, body: parsed.body },
  );
  return NextResponse.json(json, { status, headers });
}
