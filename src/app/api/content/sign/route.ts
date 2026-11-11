import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signContentUrl } from "@/server/content-media";
import { canPlayPart } from "@/server/lesson";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/content/sign?blockId= -> { url } | { url: null, unavailable: true } | 404 */
export async function GET(request: Request) {
  try {
    const user = await createClient();
    const { data } = await user.auth.getUser();
    if (!data.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
    const studentId = data.user.id;

    const { data: profile } = await user.from("profiles").select("role").eq("id", studentId).maybeSingle();
    const blockId = new URL(request.url).searchParams.get("blockId") ?? "";
    if (profile?.role !== "student" || !UUID.test(blockId)) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }

    const res = await signContentUrl(user, blockId, (partId) => canPlayPart(user, studentId, partId));
    if (res.status === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    if (res.status === "unavailable") return NextResponse.json({ url: null, unavailable: true }, { headers: NO_STORE });
    return NextResponse.json({ url: res.url }, { headers: NO_STORE });
  } catch (e) {
    console.error("content sign failed", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
