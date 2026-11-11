import { tashkentDay } from "@/lib/gamification/day";
import { completePart, type ProgressStore } from "./progress";
import { runSubmissionCompletion } from "./submission-completion";

export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
export const VIDEO_SESSION_MS = 30 * 60 * 1000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** `/start` payload of the deep link: `task_<exerciseId>` (strict uuid). */
export const TASK_PAYLOAD_RE = new RegExp(`^task_(${UUID})$`, "i");

export interface VideoExercise {
  id: string;
  type: string;
  checkMode: "auto" | "review";
  courseId: string;
  /** Lesson part of the exercise's block when that block is PUBLISHED; null otherwise. */
  partId: string | null;
}

export type CreateVideoResult =
  | { outcome: "ok" | "duplicate"; submissionId: string }
  | { outcome: "rate_limited" | "duplicate_other" };

/** Data access for the bot's video flow. Production: the service-role client (see video-store.ts). */
export interface VideoStore extends ProgressStore {
  getProfileByTelegramId(telegramId: number): Promise<{ id: string } | null>;
  getExercise(exerciseId: string): Promise<VideoExercise | null>;
  isTestItem(exerciseId: string): Promise<boolean>;
  /** The student's active, unexpired enrollment in the course (null when none). */
  getActiveEnrollment(studentId: string, courseId: string): Promise<{ curatorGroupId: string | null } | null>;
  upsertSession(telegramId: number, exerciseId: string, expiresAt: Date): Promise<void>;
  getLiveSession(telegramId: number, now: Date): Promise<{ exerciseId: string } | null>;
  deleteSession(telegramId: number): Promise<void>;
  /** A video submission of this student with this Telegram file_unique_id. */
  findVideoByUnique(fileUniqueId: string): Promise<{ id: string; studentId: string; exerciseId: string; notifiedAt: string | null } | null>;
  /** Video submissions of the student for the exercise created at/after sinceIso (cheap rate-limit pre-check). */
  countRecentVideos(studentId: string, exerciseId: string, sinceIso: string): Promise<number>;
  /** Housekeeping: drops bot_sessions expired before `beforeIso` (for one telegram id, or all). */
  deleteExpiredSessions(beforeIso: string, telegramId?: number): Promise<void>;
  /** Stored (tg_file_id set), not yet notified video submissions created before `olderThanIso`. */
  listStaleVideos(olderThanIso: string, limit: number): Promise<{ id: string; studentId: string; exerciseId: string }[]>;
  /** SQL create_video_submission (advisory lock, rate limit, duplicate-safe). */
  createVideoSubmission(row: {
    studentId: string;
    exerciseId: string;
    curatorGroupId: string | null;
    fileId: string;
    fileUniqueId: string;
    archiveMessageId: number;
  }): Promise<CreateVideoResult>;
  hasOtherCompletedSince(studentId: string, excludeId: string, sinceIso: string): Promise<boolean>;
  /** Lease token (the claim timestamp) for exactly one concurrent caller, else null. */
  claimNotification(submissionId: string, studentId: string): Promise<string | null>;
  /** Releases ONLY the lease identified by the token (a stale holder cannot erase a newer one). */
  releaseNotification(submissionId: string, token: string): Promise<void>;
  markNotified(submissionId: string): Promise<void>;
}

export interface VideoDeps {
  store: VideoStore;
  bumpSpeaking(studentId: string): Promise<void>;
  notify(submissionId: string): Promise<void>;
  now?: () => Date;
  /** Random source for opportunistic cleanup (tests inject). */
  random?: () => number;
}

/**
 * A speaking/open_text review exercise of a PUBLISHED block, in the student's active, unexpired
 * course, and not a test item (what RLS + audio-submissions enforce for the web flow). The curator
 * group is the student's own enrollment's group, read on the server.
 */
export async function resolveVideoTarget(
  store: VideoStore,
  studentId: string,
  exerciseId: string,
): Promise<{ exerciseId: string; courseId: string; partId: string; curatorGroupId: string | null } | null> {
  const ex = await store.getExercise(exerciseId);
  if (
    !ex ||
    ex.partId === null ||
    ex.checkMode !== "review" ||
    (ex.type !== "speaking" && ex.type !== "open_text") ||
    (await store.isTestItem(ex.id))
  ) {
    return null;
  }
  const enrollment = await store.getActiveEnrollment(studentId, ex.courseId);
  if (!enrollment) return null;
  return { exerciseId: ex.id, courseId: ex.courseId, partId: ex.partId, curatorGroupId: enrollment.curatorGroupId };
}

export type StartOutcome = "ok" | "unknown_user" | "not_available";

/** `/start task_<exerciseId>`: validates and stores the 30-minute pending task. */
export async function startVideoTask(deps: VideoDeps, telegramId: number, exerciseId: string): Promise<StartOutcome> {
  const { store } = deps;
  const profile = await store.getProfileByTelegramId(telegramId);
  if (!profile) return "unknown_user";
  const target = await resolveVideoTarget(store, profile.id, exerciseId);
  if (!target) return "not_available";
  const now = (deps.now ?? (() => new Date()))();
  // Opportunistic housekeeping: this user's long-expired row, and a batched global sweep (1 in 50).
  const before = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  await store.deleteExpiredSessions(before, telegramId).catch(() => undefined);
  if ((deps.random ?? Math.random)() < 1 / 50) await store.deleteExpiredSessions(before).catch(() => undefined);
  await store.upsertSession(telegramId, target.exerciseId, new Date(now.getTime() + VIDEO_SESSION_MS));
  return "ok";
}

export type VideoOutcome =
  | "accepted"
  | "already"
  | "in_progress"
  | "notify_failed"
  | "unknown_user"
  | "too_big"
  | "no_session"
  | "not_available"
  | "rate_limited"
  | "duplicate_other"
  | "duplicate_elsewhere";

const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 10 * 60 * 1000;

/** Runs the shared completion path for a stored video submission. */
async function finishVideo(
  deps: VideoDeps,
  studentId: string,
  submissionId: string,
  partId: string,
  now: Date,
): Promise<"done" | "skipped" | "notify_failed"> {
  const { store } = deps;
  const dayStart = new Date(`${tashkentDay(now)}T00:00:00+05:00`).toISOString();
  const result = await runSubmissionCompletion({
    claim: () => store.claimNotification(submissionId, studentId),
    release: (token) => store.releaseNotification(submissionId, token),
    work: async () => {
      await completePart(store, studentId, partId);
      if (!(await store.hasOtherCompletedSince(studentId, submissionId, dayStart))) await deps.bumpSpeaking(studentId);
    },
    notify: () => deps.notify(submissionId),
    markNotified: () => store.markNotified(submissionId),
  });
  return result === "skipped" ? "skipped" : result === "notify_failed" ? "notify_failed" : "done";
}

/**
 * A video arrived from `telegramId`. `copyToArchive` copies it to the archive chat and returns the
 * archive message id; `deleteArchiveCopy` removes such a copy again (best effort). The copy is made
 * only AFTER cheap pre-checks (duplicate file, 3-per-10-minutes rate limit), so a rate-limited or
 * re-sending student never floods the shared archive chat; a copy that still ends up unused (a race
 * lost inside create_video_submission) is deleted.
 */
export async function submitTelegramVideo(
  deps: VideoDeps,
  input: {
    telegramId: number;
    fileId: string;
    fileUniqueId: string;
    size: number | undefined;
    copyToArchive(): Promise<number>;
    deleteArchiveCopy(messageId: number): Promise<void>;
  },
): Promise<VideoOutcome> {
  const { store } = deps;
  const profile = await store.getProfileByTelegramId(input.telegramId);
  if (!profile) return "unknown_user";
  if (input.size !== undefined && input.size > MAX_VIDEO_BYTES) return "too_big";
  const studentId = profile.id;
  const now = (deps.now ?? (() => new Date()))();

  const existing = await store.findVideoByUnique(input.fileUniqueId);
  if (existing && existing.studentId !== studentId) return "duplicate_other"; // never reveal whose

  let submissionId: string;
  let partId: string;
  let viaSession = false;
  if (existing) {
    // The same file again. The stored submission is the proof of intent: no live session needed.
    if (existing.notifiedAt) {
      const session = await store.getLiveSession(input.telegramId, now);
      return session && session.exerciseId !== existing.exerciseId ? "duplicate_elsewhere" : "already";
    }
    // stored earlier but never fully processed (a crash or failed completion): finish it, no new copy
    const ex = await store.getExercise(existing.exerciseId);
    if (!ex || ex.partId === null || ex.checkMode !== "review" || (await store.isTestItem(ex.id))) return "not_available";
    submissionId = existing.id;
    partId = ex.partId;
  } else {
    const session = await store.getLiveSession(input.telegramId, now);
    if (!session) return "no_session";
    const target = await resolveVideoTarget(store, studentId, session.exerciseId);
    if (!target) {
      await store.deleteSession(input.telegramId);
      return "not_available";
    }
    viaSession = true;
    partId = target.partId;
    const since = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
    if ((await store.countRecentVideos(studentId, target.exerciseId, since)) >= RATE_LIMIT) return "rate_limited";

    const archiveMessageId = await input.copyToArchive();
    const created = await store.createVideoSubmission({
      studentId,
      exerciseId: target.exerciseId,
      curatorGroupId: target.curatorGroupId,
      fileId: input.fileId,
      fileUniqueId: input.fileUniqueId,
      archiveMessageId,
    });
    if (created.outcome !== "ok") {
      // the copy is an orphan now (rate limit / duplicate decided inside the lock)
      await input.deleteArchiveCopy(archiveMessageId).catch(() => undefined);
      if (!("submissionId" in created)) return created.outcome;
    }
    submissionId = (created as { submissionId: string }).submissionId;
  }

  const result = await finishVideo(deps, studentId, submissionId, partId, now);
  if (result === "skipped") {
    // Someone else holds the lease: finished already, or still being completed right now.
    const again = await store.findVideoByUnique(input.fileUniqueId);
    return again?.notifiedAt ? "already" : "in_progress";
  }
  if (result === "notify_failed") return "notify_failed"; // the session stays: re-sending the same video retries
  if (viaSession) await store.deleteSession(input.telegramId);
  return "accepted";
}

/**
 * Sweeper entry point (service-only; not scheduled yet, Task 31's cron can call it): finishes video
 * submissions that were stored but never completed (crash between create_video_submission and the
 * completion path). Returns how many were completed now.
 */
export async function completeStaleVideoSubmissions(deps: VideoDeps, limit = 50): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const stale = await deps.store.listStaleVideos(new Date(now.getTime() - 2 * 60 * 1000).toISOString(), limit);
  let done = 0;
  for (const s of stale) {
    try {
      const ex = await deps.store.getExercise(s.exerciseId);
      if (!ex || ex.partId === null) continue;
      if ((await finishVideo(deps, s.studentId, s.id, ex.partId, now)) === "done") done++;
    } catch (e) {
      console.error("video sweeper: step failed", { op: "completeStale", code: e instanceof Error ? e.name : "unknown" });
    }
  }
  return done;
}

