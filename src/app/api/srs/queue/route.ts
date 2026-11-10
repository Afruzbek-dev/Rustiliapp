import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStudyQueue } from "@/server/srs-store";

export const dynamic = "force-dynamic";

/** GET /api/srs/queue -> { cards } : the student's current study queue (RLS-scoped reads only). */
export async function GET() {
  const user = await createClient();
  const { data } = await user.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const queue = await getStudyQueue(data.user.id);
    return NextResponse.json({ cards: queue.cards }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("srs: queue failed", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
