import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { parseBlock, type BlockResult } from "@/lib/blocks/types";

/** Private bucket created by the teacher editor (Task 26); students have no storage policies on it. */
export const CONTENT_BUCKET = "content";
export const SIGNED_URL_TTL_SEC = 60 * 60;

export type SignResult =
  | { status: "ok"; url: string }
  /** Block unknown, unpublished, in another course (RLS), or not an audio / rule_image block. */
  | { status: "not_found" }
  /** Bucket or object missing, or storage failed: the UI shows "media unavailable". */
  | { status: "unavailable" };

/** Signs ONE storage path (taken from a block row, never from the client). Null on any storage failure. */
async function signPath(service: SupabaseClient, path: string): Promise<string | null> {
  try {
    const { data, error } = await service.storage.from(CONTENT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SEC);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

function pathOf(block: BlockResult): string | null {
  return block.type === "audio" || block.type === "rule_image" ? block.payload.path : null;
}

/**
 * 1-hour signed URL for the media of one audio / rule_image block.
 * Visibility is proven with the USER client (RLS: published block of the student's active course);
 * the SERVICE client then signs only that block's own path.
 */
export async function signContentUrl(
  clientUser: SupabaseClient,
  blockId: string,
  /** The lock rule: true when the block's part is in the student's path and not locked. */
  canPlay: (partId: string) => Promise<boolean>,
  service?: SupabaseClient,
): Promise<SignResult> {
  const { data, error } = await clientUser
    .from("blocks")
    .select("id, type, payload, published, lesson_part_id")
    .eq("id", blockId)
    .maybeSingle();
  if (error) throw new Error(`content-media: block: ${error.message}`);
  if (!data || data.published !== true) return { status: "not_found" };
  if (typeof data.lesson_part_id !== "string" || !(await canPlay(data.lesson_part_id))) return { status: "not_found" };
  const path = pathOf(parseBlock({ id: data.id as string, type: data.type as string, payload: data.payload }));
  if (!path) return { status: "not_found" };

  let signer: SupabaseClient;
  try {
    signer = service ?? createServiceClient();
  } catch {
    return { status: "unavailable" };
  }
  const url = await signPath(signer, path);
  return url ? { status: "ok", url } : { status: "unavailable" };
}

/**
 * Signs the media of blocks the caller already read through the user client (so visibility is
 * proven). Map blockId -> url, null when the media is unavailable.
 */
export async function signLessonMedia(blocks: BlockResult[], service?: SupabaseClient): Promise<Record<string, string | null>> {
  const media = blocks.filter((b) => pathOf(b) !== null);
  const out: Record<string, string | null> = {};
  if (media.length === 0) return out;
  let signer: SupabaseClient | null = null;
  try {
    signer = service ?? createServiceClient();
  } catch {
    signer = null;
  }
  await Promise.all(
    media.map(async (b) => {
      out[b.id] = signer ? await signPath(signer, pathOf(b) as string) : null;
    }),
  );
  return out;
}
