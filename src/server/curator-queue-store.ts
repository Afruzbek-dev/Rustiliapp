import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExerciseInfo, QueueStore, ReviewRow, Role, SubmissionRow } from "./curator-queue";

/**
 * Explicit column list: `submissions` has column-level SELECT for API roles (migration 0014), so
 * `select *` fails and draft_scores / curator_chat_id / curator_message_id / notify_claimed_at are
 * unreadable by design.
 */
const SUBMISSION_COLUMNS = "id, student_id, exercise_id, kind, storage_path, tg_file_id, status, created_at";
/** keeps `.in()` URLs well below proxy header limits */
const CHUNK = 100;

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

function fail(what: string, error: { message: string } | null): void {
  // the message names the step only; row data never reaches it
  if (error) throw new Error(`curator-queue: ${what}`);
}

type Rel<T> = T | T[] | null;
function one<T>(v: Rel<T> | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

type ExerciseRow = {
  id: string;
  prompt: string | null;
  blocks: Rel<{ lesson_parts: Rel<{ lessons: Rel<{ title: string }> }> }>;
};

/** Production store: every read goes through the session's USER client (RLS decides visibility). */
export function createQueueStore(user: SupabaseClient): QueueStore {
  return {
    async getRole(userId) {
      const { data, error } = await user.from("profiles").select("role").eq("id", userId).maybeSingle();
      fail("role", error);
      return (data?.role as Role | undefined) ?? null;
    },

    async listPending(limit) {
      const { data, error } = await user
        .from("submissions")
        .select(SUBMISSION_COLUMNS)
        .eq("status", "pending")
        .in("kind", ["audio", "video"])
        // unfinished audio uploads (no object yet) and video rows without a Telegram file never show up
        .or("and(kind.eq.audio,storage_path.not.is.null),and(kind.eq.video,tg_file_id.not.is.null)")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit);
      fail("pending", error);
      return (data ?? []) as SubmissionRow[];
    },

    async getSubmission(id) {
      const { data, error } = await user.from("submissions").select(SUBMISSION_COLUMNS).eq("id", id).maybeSingle();
      fail("submission", error);
      return (data as SubmissionRow | null) ?? null;
    },

    async getSubmissionsByIds(ids) {
      const out: SubmissionRow[] = [];
      for (const part of chunks(ids)) {
        const { data, error } = await user.from("submissions").select(SUBMISSION_COLUMNS).in("id", part);
        fail("submissions", error);
        out.push(...((data ?? []) as SubmissionRow[]));
      }
      return out;
    },

    async listReviewsSince(sinceIso, limit) {
      const { data, error } = await user
        .from("reviews")
        .select("submission_id, scores, total, comment, is_override, reviewer_id, created_at")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(limit);
      fail("reviews", error);
      return (data ?? []) as ReviewRow[];
    },

    async getReviewsFor(submissionIds) {
      const out: ReviewRow[] = [];
      for (const part of chunks(submissionIds)) {
        const { data, error } = await user
          .from("reviews")
          .select("submission_id, scores, total, comment, is_override, reviewer_id, created_at")
          .in("submission_id", part)
          .order("created_at", { ascending: false });
        fail("reviews", error);
        out.push(...((data ?? []) as ReviewRow[]));
      }
      return out;
    },

    async getExercises(ids) {
      const found: ExerciseInfo[] = [];
      for (const part of chunks(ids)) {
        const { data, error } = await user
          .from("exercises")
          .select("id, prompt, blocks(lesson_parts(lessons(title)))")
          .in("id", part);
        fail("exercises", error);
        const { data: tests, error: testErr } = await user.from("test_items").select("exercise_id").in("exercise_id", part);
        fail("test items", testErr);
        const testIds = new Set((tests ?? []).map((t) => t.exercise_id as string));
        for (const e of (data ?? []) as unknown as ExerciseRow[]) {
          const lesson = one(one(one(e.blocks)?.lesson_parts)?.lessons);
          found.push({ id: e.id, prompt: e.prompt, lessonTitle: lesson?.title ?? null, isTest: testIds.has(e.id) });
        }
      }
      return found;
    },

    async getNames(ids) {
      const out: Record<string, string> = {};
      for (const part of chunks(ids)) {
        const { data, error } = await user.from("profiles").select("id, full_name").in("id", part);
        fail("names", error);
        for (const p of data ?? []) if (p.full_name) out[p.id as string] = p.full_name as string;
      }
      return out;
    },
  };
}
