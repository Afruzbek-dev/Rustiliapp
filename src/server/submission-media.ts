import "server-only";
import { SUBMISSIONS_BUCKET } from "./audio-store";
import { getReviewableRow, type QueueStore } from "./curator-queue";

export const SUBMISSION_AUDIO_TTL_SEC = 10 * 60;

export type SignAudioResult = { status: "ok"; url: string } | { status: "not_found" };

export interface SignAudioDeps {
  store?: QueueStore;
  /** SERVICE-client signer for one storage path; null on any storage failure */
  sign?: (path: string, ttlSec: number) => Promise<string | null>;
}

async function defaultSign(path: string, ttlSec: number): Promise<string | null> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const { data, error } = await createServiceClient().storage.from(SUBMISSIONS_BUCKET).createSignedUrl(path, ttlSec);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

/**
 * 10-minute signed URL for an audio submission. Visibility is proven first through the USER client
 * (the same read as the review queue); the SERVICE client then signs the object path rebuilt from
 * the DB row (`<student_id>/<submission_id>.<ext>`), never anything the caller sent. Everything
 * else is a plain not_found. The URL is never logged.
 */
export async function signSubmissionAudio(userId: string, submissionId: string, deps: SignAudioDeps = {}): Promise<SignAudioResult> {
  const row = await getReviewableRow(userId, submissionId, deps.store);
  if (!row || row.kind !== "audio" || !row.storage_path) return { status: "not_found" };
  const ext = /\.([a-z0-9]{1,5})$/i.exec(row.storage_path)?.[1]?.toLowerCase();
  if (!ext) return { status: "not_found" };
  const path = `${row.student_id}/${row.id}.${ext}`;
  try {
    const url = await (deps.sign ?? defaultSign)(path, SUBMISSION_AUDIO_TTL_SEC);
    return url ? { status: "ok", url } : { status: "not_found" };
  } catch (e) {
    console.error("submission-media: sign failed", { code: e instanceof Error ? e.name : "unknown" });
    return { status: "not_found" };
  }
}
