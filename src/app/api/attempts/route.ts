import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { handleAttemptRequest } from "@/server/attempts";
import { createSupabaseAttemptStore } from "@/server/attempts-store";

export const dynamic = "force-dynamic";

/** POST /api/attempts { exerciseId, answer } -> { correct, expected?, perItem?, xpAwarded, partCompleted? } */
export async function POST(request: Request) {
  const user = await createClient();
  const { data } = await user.auth.getUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined; // reported as 400 (invalid_request) by the service
  }

  const store = createSupabaseAttemptStore(user, createServiceClient());
  const { status, json } = await handleAttemptRequest({ store }, { userId: data.user?.id ?? null, body });
  return NextResponse.json(json, { status, headers: { "Cache-Control": "no-store" } });
}
