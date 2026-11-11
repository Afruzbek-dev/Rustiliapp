import { z } from "zod";
import { tashkentDay } from "@/lib/gamification/day";
import { completePart, type ProgressStore } from "./progress";
import { runSubmissionCompletion } from "./submission-completion";

/** Allowed recording formats -> object extension. Kept in sync with the bucket's allowed_mime_types. */
export const AUDIO_MIME_EXT = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg" } as const;
export type AudioMime = keyof typeof AUDIO_MIME_EXT;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_JSON_BYTES = 4 * 1024;

export interface SpeakingExercise {
  id: string;
  type: string;
  checkMode: "auto" | "review";
  courseId: string;
  /** Lesson part of the (published) block; null when the exercise has no readable block. */
  partId: string | null;
}

export interface AudioSubmissionRow {
  id: string;
  studentId: string;
  exerciseId: string;
  kind: string;
  storagePath: string | null;
  notifiedAt: string | null;
}

/**
 * Approach for "no pre-complete state in the enum": the row is created at upload time with
 * status 'pending' (the only usable value) but with storage_path NULL. A submission only becomes
 * real (storage_path set) in audio-complete, after the object is verified. Everything that lists
 * work for curators / counts submissions must ignore audio rows with storage_path IS NULL
 * (the storage policies already do: they require storage_path = object name).
 */
export interface AudioStore extends ProgressStore {
  /** Role of the signed-in user (user-scoped client). */
  getRole(userId: string): Promise<string | null>;
  /** USER-scoped read (RLS): null unless the student may see this published, own-course exercise. */
  getVisibleExercise(exerciseId: string): Promise<SpeakingExercise | null>;
  /** SERVICE read: is the exercise an item of any test? */
  isTestItem(exerciseId: string): Promise<boolean>;
  /** SERVICE read: the student's active, unexpired enrollment in the course (null when none). */
  getActiveEnrollment(studentId: string, courseId: string): Promise<{ curatorGroupId: string | null } | null>;
  /**
   * Atomic, rate-limited insert (SQL create_audio_submission: advisory lock; max 3 completed per
   * 10 minutes and max 10 incomplete per hour for one student+exercise).
   */
  createAudioSubmission(row: {
    studentId: string;
    exerciseId: string;
    curatorGroupId: string | null;
    ext: string;
  }): Promise<{ submissionId: string } | { limited: true }>;
  createSignedUpload(path: string): Promise<{ uploadUrl: string; token: string } | null>;
  getSubmission(submissionId: string): Promise<AudioSubmissionRow | null>;
  /** Object `<studentId>/<submissionId>.<ext>` in the bucket, if present. */
  findObject(studentId: string, submissionId: string): Promise<{ name: string; size: number } | null>;
  /** Sets storage_path where it is still null; true only when THIS call did it. */
  markComplete(submissionId: string, studentId: string, path: string): Promise<boolean>;
  /** Any other completed submission of the student created at/after sinceIso. */
  hasOtherCompletedSince(studentId: string, excludeId: string, sinceIso: string): Promise<boolean>;
  getExerciseInfo(exerciseId: string): Promise<{ partId: string | null; courseId: string } | null>;
  /** Marks the submission as fully processed (part, daily task and curator notice done). */
  markNotified(submissionId: string): Promise<void>;
  /** Atomic lease (SQL claim_submission_notification): true for exactly one concurrent caller. */
  claimNotification(submissionId: string, studentId: string): Promise<boolean>;
  /** Gives the lease back after a failure. */
  releaseNotification(submissionId: string): Promise<void>;
}

export interface AudioDeps {
  store: AudioStore;
  bumpSpeaking(studentId: string): Promise<void>;
  notify(submissionId: string): Promise<void>;
  now?: () => Date;
}

type Result = { status: number; json: Record<string, unknown> };
const err = (status: number, error: string): Result => ({ status, json: { error } });

export const uploadBody = z.object({ exerciseId: z.string().uuid(), mime: z.string().min(1).max(100) }).strict();
export const completeBody = z.object({ submissionId: z.string().uuid() }).strict();

export function normalizeMime(mime: string): AudioMime | null {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(AUDIO_MIME_EXT, base) ? (base as AudioMime) : null;
}

async function authStudent(store: AudioStore, userId: string | null): Promise<Result | null> {
  if (!userId) return err(401, "unauthenticated");
  if ((await store.getRole(userId)) !== "student") return err(403, "forbidden");
  return null;
}

function internal(e: unknown): Result {
  // Only the error class: messages may carry paths or user data.
  console.error("audio-submissions: internal error", e instanceof Error ? e.name : "unknown");
  return err(500, "internal_error");
}

export async function handleAudioUpload(deps: AudioDeps, req: { userId: string | null; body: unknown }): Promise<Result> {
  const { store } = deps;
  try {
    const denied = await authStudent(store, req.userId);
    if (denied) return denied;
    const studentId = req.userId!;
    const body = uploadBody.safeParse(req.body);
    if (!body.success) return err(400, "invalid_request");
    const mime = normalizeMime(body.data.mime);
    if (!mime) return err(400, "invalid_mime");

    // Visibility is proven through the user-scoped client (RLS): unknown, unpublished, foreign-course,
    // test-only and non-speaking exercises all look the same.
    const ex = await store.getVisibleExercise(body.data.exerciseId);
    if (
      !ex ||
      ex.partId === null ||
      ex.checkMode !== "review" ||
      (ex.type !== "speaking" && ex.type !== "open_text") ||
      (await store.isTestItem(ex.id))
    ) {
      return err(404, "not_found");
    }
    // The curator group comes from the student's own enrollment, never from the client.
    const enrollment = await store.getActiveEnrollment(studentId, ex.courseId);
    if (!enrollment) return err(404, "not_found");

    const created = await store.createAudioSubmission({
      studentId,
      exerciseId: ex.id,
      curatorGroupId: enrollment.curatorGroupId,
      ext: AUDIO_MIME_EXT[mime],
    });
    if ("limited" in created) return err(429, "rate_limited");
    const submissionId = created.submissionId;
    const signed = await store.createSignedUpload(`${studentId}/${submissionId}.${AUDIO_MIME_EXT[mime]}`);
    if (!signed) return err(500, "internal_error");
    return { status: 200, json: { submissionId, uploadUrl: signed.uploadUrl, token: signed.token } };
  } catch (e) {
    return internal(e);
  }
}

export async function handleAudioComplete(deps: AudioDeps, req: { userId: string | null; body: unknown }): Promise<Result> {
  const { store } = deps;
  try {
    const denied = await authStudent(store, req.userId);
    if (denied) return denied;
    const studentId = req.userId!;
    const body = completeBody.safeParse(req.body);
    if (!body.success) return err(400, "invalid_request");

    const sub = await store.getSubmission(body.data.submissionId);
    // Foreign and unknown submissions are indistinguishable.
    if (!sub || sub.studentId !== studentId || sub.kind !== "audio") return err(404, "not_found");

    // Access can lapse between upload and completion.
    const info = await store.getExerciseInfo(sub.exerciseId);
    if (!info || !(await store.getActiveEnrollment(studentId, info.courseId))) return err(404, "not_found");

    if (!sub.storagePath) {
      const obj = await store.findObject(studentId, sub.id);
      if (!obj) return err(409, "upload_missing");
      if (obj.size <= 0) return err(400, "empty_upload");
      if (obj.size > MAX_AUDIO_BYTES) return err(413, "payload_too_large");
      await store.markComplete(sub.id, studentId, obj.name);
    }

    // Idempotent by STATE plus an atomic lease: while notified_at is null exactly ONE concurrent
    // caller wins claimNotification and runs the remaining work (completePart pays once; the bump is
    // skipped when another submission already counted today). A work failure releases the lease and
    // fails the request so a retry finishes it; a notifier failure is logged, releases the lease and
    // leaves notified_at null without failing the student's request (see submission-completion.ts).
    const alreadyDone = !!sub.storagePath && !!sub.notifiedAt;
    if (!sub.notifiedAt) {
      const now = (deps.now ?? (() => new Date()))();
      const dayStart = new Date(`${tashkentDay(now)}T00:00:00+05:00`).toISOString();
      await runSubmissionCompletion({
        claim: () => store.claimNotification(sub.id, studentId),
        release: () => store.releaseNotification(sub.id),
        work: async () => {
          if (info.partId) await completePart(store, studentId, info.partId);
          if (!(await store.hasOtherCompletedSince(studentId, sub.id, dayStart))) await deps.bumpSpeaking(studentId);
        },
        notify: () => deps.notify(sub.id),
        markNotified: () => store.markNotified(sub.id),
      });
    }
    return { status: 200, json: { ok: true, alreadyComplete: alreadyDone } };
  } catch (e) {
    return internal(e);
  }
}

/** Reads a JSON body with a hard cap (4 KB), never buffering more than the cap even without Content-Length. */
export async function readSmallJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) return { ok: false, status: 413 };
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(buf)) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}
