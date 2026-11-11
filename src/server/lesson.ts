import "server-only";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseBlock, type BlockResult } from "@/lib/blocks/types";
import type { PartProgress } from "@/lib/path-status";
import { getPathWith, supabasePathDb, type PartKind, type PathDb } from "@/server/path";

export interface LessonPartRow {
  id: string;
  kind: PartKind;
  title: string;
  lessonId: string;
  lessonTitle: string;
  objective: string | null;
}

export interface LessonBlockRow {
  id: string;
  position: number;
  type: string;
  payload: unknown;
  published: boolean;
}

/** Columns the student may see. `exercise_keys` is not here and is unreadable by students anyway. */
export interface LessonExerciseRow {
  id: string;
  blockId: string | null;
  type: string;
  prompt: string | null;
  payload: unknown;
  checkMode: "auto" | "review";
}

export interface LessonWord {
  id: string;
  ru: string;
  stress: string | null;
  uz: string;
}

/** Narrow data port; production adapter below (user-scoped client, RLS), tests inject a fake. */
export interface LessonDb extends PathDb {
  part(partId: string): Promise<LessonPartRow | null>;
  /** Blocks of the part visible to the student (RLS: published only). */
  blocks(partId: string): Promise<LessonBlockRow[]>;
  exercises(blockIds: string[]): Promise<LessonExerciseRow[]>;
  words(lessonId: string): Promise<LessonWord[]>;
  /**
   * Of the given exercise ids, those that are items of ANY test. RLS cannot say this for unpublished
   * tests, so production reads it with the service client. Test items are graded by the test flow
   * only (/api/attempts answers 404 for them), so the player must not offer them.
   */
  testItemIds(exerciseIds: string[]): Promise<string[]>;
  /** Exercise ids (of those given) the student has a completed submission for. */
  submittedExerciseIds(studentId: string, exerciseIds: string[]): Promise<string[]>;
}

export interface LessonExercise {
  id: string;
  type: string;
  prompt: string | null;
  payload: unknown;
  checkMode: "auto" | "review";
}

export interface LessonPartData {
  part: { id: string; kind: PartKind; title: string };
  lesson: { id: string; title: string; objective: string | null };
  /** Published blocks by position; unknown/malformed ones come as `unsupported`. */
  blocks: BlockResult[];
  /** Exercise rows referenced by exercise/speaking blocks, by id. No keys, no answers. */
  exercises: Record<string, LessonExercise>;
  words: LessonWord[];
  /** null = not started. */
  progress: PartProgress | null;
  nextPartId: string | null;
  /** Speaking exercises of this part the student already submitted. */
  submittedExerciseIds: string[];
}

/**
 * The lesson of one part for one student, or null when the part is unknown, not visible (RLS),
 * has no published blocks, or is still LOCKED in the student's path (same rule as /path).
 */
export async function getLessonPartWith(
  db: LessonDb,
  studentId: string,
  partId: string,
  now: Date = new Date(),
): Promise<LessonPartData | null> {
  // Enrollment is resolved once, inside getPathWith.
  const path = await getPathWith(db, studentId, now);
  const flat = path.modules.flatMap((m) => m.lessons.flatMap((l) => l.parts));
  const idx = flat.findIndex((p) => p.id === partId);
  if (idx < 0 || flat[idx].status === "locked") return null;
  const pathPart = flat[idx];

  const part = await db.part(partId);
  if (!part) return null;

  const rows = (await db.blocks(partId))
    .filter((b) => b.published === true)
    .sort((a, b) => a.position - b.position);
  if (rows.length === 0) return null;
  const blocks = rows.map((b) => parseBlock({ id: b.id, type: b.type, payload: b.payload }));

  const refBlockIds = blocks.filter((b) => b.type === "exercise" || b.type === "speaking").map((b) => b.id);
  const exercises: Record<string, LessonExercise> = {};
  if (refBlockIds.length > 0) {
    const rows0 = await db.exercises(refBlockIds);
    const testIds = new Set(rows0.length > 0 ? await db.testItemIds(rows0.map((e) => e.id)) : []);
    const fetched = rows0.filter((e) => !testIds.has(e.id));
    const owner = new Map(fetched.map((e) => [e.id, e.blockId]));
    for (const b of blocks) {
      if (b.type !== "exercise" && b.type !== "speaking") continue;
      const e = fetched.find((x) => x.id === b.payload.exerciseId);
      // An exercise only counts when it belongs to the block that references it.
      if (!e || owner.get(e.id) !== b.id) continue;
      // Whitelisted mapping: nothing but these fields ever reaches the client.
      exercises[e.id] = { id: e.id, type: e.type, prompt: e.prompt, payload: e.payload, checkMode: e.checkMode };
    }
  }

  const speakingIds = blocks.flatMap((b) => (b.type === "speaking" && exercises[b.payload.exerciseId] ? [b.payload.exerciseId] : []));
  const [words, submittedExerciseIds] = await Promise.all([
    db.words(part.lessonId),
    speakingIds.length > 0 ? db.submittedExerciseIds(studentId, speakingIds) : Promise.resolve([] as string[]),
  ]);

  return {
    part: { id: part.id, kind: part.kind, title: part.title },
    lesson: { id: part.lessonId, title: part.lessonTitle, objective: part.objective },
    blocks,
    exercises,
    words: words.map((w) => ({ id: w.id, ru: w.ru, stress: w.stress, uz: w.uz })),
    progress: pathPart.status === "completed" ? "completed" : pathPart.status === "in_progress" ? "in_progress" : null,
    nextPartId: flat[idx + 1]?.id ?? null,
    submittedExerciseIds,
  };
}

/** True when the part is in the student's path (published) and not locked: the lesson page's rule. */
export async function canPlayPart(sb: Sb, studentId: string, partId: string): Promise<boolean> {
  const path = await getPathWith(supabasePathDb(sb), studentId);
  return path.modules.some((m) => m.lessons.some((l) => l.parts.some((p) => p.id === partId && p.status !== "locked")));
}

// ---------------------------------------------------------------------------------------------
// Production adapter
// ---------------------------------------------------------------------------------------------
type Sb = Awaited<ReturnType<typeof createClient>>;

function ok<T>(res: { data: unknown; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`lesson: ${what}: ${res.error.message}`);
  return res.data as T;
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export function supabaseLessonDb(sb: Sb, service: () => SupabaseClient = createServiceClient): LessonDb {
  return {
    ...supabasePathDb(sb),

    async testItemIds(exerciseIds) {
      const data = ok<{ exercise_id: string }[] | null>(
        await service().from("test_items").select("exercise_id").in("exercise_id", exerciseIds),
        "test items",
      );
      return (data ?? []).map((r) => r.exercise_id);
    },

    async part(partId) {
      type Row = {
        id: string;
        kind: PartKind;
        title: string;
        lessons: { id: string; title: string; objective: string | null } | { id: string; title: string; objective: string | null }[] | null;
      };
      const data = ok<Row | null>(
        await sb
          .from("lesson_parts")
          .select("id, kind, title, lessons(id, title, objective)")
          .eq("id", partId)
          .maybeSingle(),
        "part",
      );
      const lesson = data ? one(data.lessons) : null;
      if (!data || !lesson) return null;
      return {
        id: data.id,
        kind: data.kind,
        title: data.title,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        objective: lesson.objective,
      };
    },

    async blocks(partId) {
      const data = ok<LessonBlockRow[] | null>(
        await sb
          .from("blocks")
          .select("id, position, type, payload, published")
          .eq("lesson_part_id", partId)
          .eq("published", true)
          .order("position"),
        "blocks",
      );
      return data ?? [];
    },

    async exercises(blockIds) {
      const data = ok<
        { id: string; block_id: string | null; type: string; prompt: string | null; payload: unknown; check_mode: "auto" | "review" }[] | null
      >(
        await sb.from("exercises").select("id, block_id, type, prompt, payload, check_mode").in("block_id", blockIds),
        "exercises",
      );
      return (data ?? []).map((e) => ({
        id: e.id,
        blockId: e.block_id,
        type: e.type,
        prompt: e.prompt,
        payload: e.payload,
        checkMode: e.check_mode,
      }));
    },

    async words(lessonId) {
      const data = ok<{ words: LessonWord | LessonWord[] | null }[] | null>(
        await sb.from("lesson_words").select("words(id, ru, stress, uz)").eq("lesson_id", lessonId),
        "words",
      );
      return (data ?? []).flatMap((r) => {
        const w = one(r.words);
        return w ? [w] : [];
      });
    },

    async submittedExerciseIds(studentId, exerciseIds) {
      const data = ok<{ exercise_id: string }[] | null>(
        await sb
          .from("submissions")
          .select("exercise_id")
          .eq("student_id", studentId)
          // an audio upload that was never completed (storage_path still null) is not a submission
          .or("kind.neq.audio,storage_path.not.is.null")
          .in("exercise_id", exerciseIds),
        "submissions",
      );
      return [...new Set((data ?? []).map((r) => r.exercise_id))];
    },
  };
}

/** Server entry point of the lesson page. Unknown / invisible / locked part -> 404. */
export async function getLessonPart(studentId: string, partId: string): Promise<LessonPartData> {
  const sb = await createClient();
  const data = await getLessonPartWith(supabaseLessonDb(sb), studentId, partId);
  if (!data) notFound();
  return data;
}
