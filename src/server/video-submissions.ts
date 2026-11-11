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
  findVideoByUnique(studentId: string, fileUniqueId: string): Promise<{ id: string; exerciseId: string; notifiedAt: string | null } | null>;
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
  claimNotification(submissionId: string, studentId: string): Promise<boolean>;
  releaseNotification(submissionId: string): Promise<void>;
  markNotified(submissionId: string): Promise<void>;
}

export interface VideoDeps {
  store: VideoStore;
  bumpSpeaking(studentId: string): Promise<void>;
  notify(submissionId: string): Promise<void>;
  now?: () => Date;
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
  await store.upsertSession(telegramId, target.exerciseId, new Date(now.getTime() + VIDEO_SESSION_MS));
  return "ok";
}

export type VideoOutcome =
  | "accepted"
  | "already"
  | "notify_failed"
  | "unknown_user"
  | "too_big"
  | "no_session"
  | "not_available"
  | "rate_limited"
  | "duplicate_other";

/**
 * A video arrived from `telegramId`. `copyToArchive` copies it to the archive chat and returns the
 * archive message id (called only when a NEW submission may be created).
 */
export async function submitTelegramVideo(
  deps: VideoDeps,
  input: { telegramId: number; fileId: string; fileUniqueId: string; size: number | undefined; copyToArchive(): Promise<number> },
): Promise<VideoOutcome> {
  const { store } = deps;
  const profile = await store.getProfileByTelegramId(input.telegramId);
  if (!profile) return "unknown_user";
  if (input.size !== undefined && input.size > MAX_VIDEO_BYTES) return "too_big";
  const studentId = profile.id;

  // A re-delivered update (the session is already gone) of an already processed video.
  const existing = await store.findVideoByUnique(studentId, input.fileUniqueId);
  if (existing?.notifiedAt) return "already";

  const now = (deps.now ?? (() => new Date()))();
  const session = await store.getLiveSession(input.telegramId, now);
  if (!session) return "no_session";
  const target = await resolveVideoTarget(store, studentId, session.exerciseId);
  if (!target) {
    await store.deleteSession(input.telegramId);
    return "not_available";
  }

  let submissionId: string;
  if (existing && existing.exerciseId === target.exerciseId) {
    // stored earlier but never fully processed (a failed completion): finish it, no second archive copy
    submissionId = existing.id;
  } else {
    const archiveMessageId = await input.copyToArchive();
    const created = await store.createVideoSubmission({
      studentId,
      exerciseId: target.exerciseId,
      curatorGroupId: target.curatorGroupId,
      fileId: input.fileId,
      fileUniqueId: input.fileUniqueId,
      archiveMessageId,
    });
    if (!("submissionId" in created)) return created.outcome;
    submissionId = created.submissionId;
  }

  const dayStart = new Date(`${tashkentDay(now)}T00:00:00+05:00`).toISOString();
  const result = await runSubmissionCompletion({
    claim: () => store.claimNotification(submissionId, studentId),
    release: () => store.releaseNotification(submissionId),
    work: async () => {
      await completePart(store, studentId, target.partId);
      if (!(await store.hasOtherCompletedSince(studentId, submissionId, dayStart))) await deps.bumpSpeaking(studentId);
    },
    notify: () => deps.notify(submissionId),
    markNotified: () => store.markNotified(submissionId),
  });
  if (result === "skipped") return "already";
  if (result === "notify_failed") return "notify_failed"; // the session stays: re-sending the same video retries
  await store.deleteSession(input.telegramId);
  return "accepted";
}
