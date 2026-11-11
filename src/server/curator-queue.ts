import "server-only";
import { displayName, type QueueItem, type ReviewSummary, type Scores } from "@/lib/curator-types";

export type Role = "student" | "curator" | "teacher" | "admin";

export interface SubmissionRow {
  id: string;
  student_id: string;
  exercise_id: string;
  kind: "audio" | "video" | "text";
  storage_path: string | null;
  tg_file_id: string | null;
  status: "pending" | "reviewed";
  created_at: string;
}

export interface ExerciseInfo {
  id: string;
  prompt: string | null;
  lessonTitle: string | null;
  /** the exercise belongs to a test (test_items): never a review target */
  isTest: boolean;
}

export interface ReviewRow {
  submission_id: string;
  scores: Scores;
  total: number;
  comment: string | null;
  is_override: boolean;
  reviewer_id: string | null;
  created_at: string;
}

/**
 * Data access, ALL through the user-scoped client in production (curator-queue-store.ts): RLS decides
 * which submissions the viewer may see. Every method throws on a database error.
 */
export interface QueueStore {
  getRole(userId: string): Promise<Role | null>;
  /** pending audio/video rows the viewer may read, oldest first */
  listPending(limit: number): Promise<SubmissionRow[]>;
  getSubmission(id: string): Promise<SubmissionRow | null>;
  getSubmissionsByIds(ids: string[]): Promise<SubmissionRow[]>;
  /** reviews created at or after `sinceIso`, newest first */
  listReviewsSince(sinceIso: string, limit: number): Promise<ReviewRow[]>;
  getReviewsFor(submissionIds: string[]): Promise<ReviewRow[]>;
  getExercises(ids: string[]): Promise<ExerciseInfo[]>;
  /** full names by profile id (only the ones the viewer may read) */
  getNames(ids: string[]): Promise<Record<string, string>>;
}

export const QUEUE_LIMIT = 500;
export const REVIEWED_WINDOW_DAYS = 30;
const REVIEWED_LIMIT = 100;

const isReviewer = (role: Role | null): role is "curator" | "teacher" | "admin" =>
  role === "curator" || role === "teacher" || role === "admin";
export const isStaffRole = (role: Role | null): boolean => role === "teacher" || role === "admin";

/** Complete rows only: an unfinished audio upload has no object yet; a video needs its Telegram file. */
function isComplete(s: SubmissionRow): boolean {
  if (s.kind === "audio") return !!s.storage_path;
  if (s.kind === "video") return !!s.tg_file_id;
  return false;
}

async function defaultStore(): Promise<QueueStore> {
  const { createClient } = await import("@/lib/supabase/server");
  const { createQueueStore } = await import("./curator-queue-store");
  return createQueueStore(await createClient());
}

/** Resolves the store (the default one reads through the session's user client). */
export async function resolveQueueStore(injected?: QueueStore): Promise<QueueStore> {
  return injected ?? (await defaultStore());
}

function pickLatest(reviews: ReviewRow[]): Map<string, ReviewRow> {
  const latest = new Map<string, ReviewRow>();
  for (const r of reviews) {
    const cur = latest.get(r.submission_id);
    if (!cur || Date.parse(r.created_at) > Date.parse(cur.created_at)) latest.set(r.submission_id, r);
  }
  return latest;
}

async function toItems(
  store: QueueStore,
  userId: string,
  rows: SubmissionRow[],
  withReview: boolean,
  knownReviews?: ReviewRow[],
): Promise<QueueItem[]> {
  // never review one's own work; unfinished rows are not reviewable
  const usable = rows.filter((r) => r.student_id !== userId && isComplete(r));
  if (usable.length === 0) return [];
  const exercises = new Map((await store.getExercises([...new Set(usable.map((r) => r.exercise_id))])).map((e) => [e.id, e]));
  const visible = usable.filter((r) => {
    const e = exercises.get(r.exercise_id);
    return !!e && !e.isTest; // an exercise the viewer cannot read, or a test item: not a target
  });
  if (visible.length === 0) return [];
  const latest = withReview
    ? pickLatest(knownReviews ?? (await store.getReviewsFor(visible.map((r) => r.id))))
    : new Map<string, ReviewRow>();
  const nameIds = new Set(visible.map((r) => r.student_id));
  for (const r of latest.values()) if (r.reviewer_id) nameIds.add(r.reviewer_id);
  const names = await store.getNames([...nameIds]);

  return visible.map((r) => {
    const e = exercises.get(r.exercise_id)!;
    const rv = latest.get(r.id);
    const review: ReviewSummary | null = rv
      ? {
          scores: rv.scores,
          total: Number(rv.total),
          comment: rv.comment,
          reviewerName: rv.reviewer_id && names[rv.reviewer_id] ? displayName(names[rv.reviewer_id]) : null,
          isOverride: rv.is_override,
          createdAt: rv.created_at,
        }
      : null;
    return {
      id: r.id,
      kind: r.kind as "audio" | "video",
      status: r.status,
      createdAt: r.created_at,
      studentName: displayName(names[r.student_id]),
      lessonTitle: e.lessonTitle,
      prompt: e.prompt,
      review,
    };
  });
}

export interface Queue {
  items: QueueItem[];
  count: number;
  role: Role | null;
}

/** Pending submissions the viewer may review, oldest first. RLS scopes curator -> own group, teacher -> taught courses, admin -> all. */
export async function getQueue(userId: string, injected?: QueueStore): Promise<Queue> {
  const store = await resolveQueueStore(injected);
  const role = await store.getRole(userId);
  if (!isReviewer(role)) return { items: [], count: 0, role };
  const rows = await store.listPending(QUEUE_LIMIT);
  const items = (await toItems(store, userId, rows, false)).sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
  return { items, count: items.length, role };
}

/** Deep link `?s=<id>`: pending or reviewed; null (-> 404) when invisible, unfinished, a test item or the viewer's own. */
export async function getSubmission(userId: string, id: string, injected?: QueueStore): Promise<QueueItem | null> {
  const store = await resolveQueueStore(injected);
  const role = await store.getRole(userId);
  if (!isReviewer(role)) return null;
  const row = await store.getSubmission(id);
  if (!row) return null;
  const [item] = await toItems(store, userId, [row], row.status === "reviewed");
  return item ?? null;
}

/** The raw row behind a visible, reviewable submission (media signing); null when not a target. */
export async function getReviewableRow(userId: string, id: string, injected?: QueueStore): Promise<SubmissionRow | null> {
  const store = await resolveQueueStore(injected);
  const role = await store.getRole(userId);
  if (!isReviewer(role)) return null;
  const row = await store.getSubmission(id);
  if (!row || row.student_id === userId || !isComplete(row)) return null;
  const [e] = await store.getExercises([row.exercise_id]);
  if (!e || e.isTest) return null;
  return row;
}

/** Teacher/admin only: submissions reviewed in the last 30 days with their latest review, newest review first. */
export async function recentlyReviewed(userId: string, injected?: QueueStore, now: Date = new Date()): Promise<QueueItem[]> {
  const store = await resolveQueueStore(injected);
  const role = await store.getRole(userId);
  if (!isStaffRole(role)) return [];
  const since = new Date(now.getTime() - REVIEWED_WINDOW_DAYS * 86_400_000).toISOString();
  const reviews = await store.listReviewsSince(since, 500);
  const latest = pickLatest(reviews);
  const ids = [...latest.keys()];
  if (ids.length === 0) return [];
  const rows = (await store.getSubmissionsByIds(ids)).filter((r) => r.status === "reviewed");
  const items = await toItems(store, userId, rows, true, [...latest.values()]);
  return items
    .sort((a, b) => Date.parse(b.review!.createdAt) - Date.parse(a.review!.createdAt) || a.id.localeCompare(b.id))
    .slice(0, REVIEWED_LIMIT);
}
