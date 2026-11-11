import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBlock } from "@/lib/blocks/types";
import { supabaseLessonDb, type LessonExercise, type LessonPartData } from "@/server/lesson";

/**
 * The lesson of one part exactly as a student would get it, but INCLUDING drafts, for teacher /
 * admin preview. Reads go through the staff user's own RLS-scoped client (a teacher only sees
 * their own course; blocks_select lets course staff read unpublished blocks), with explicit columns
 * and no answer keys. Not locked, no progress: preview is read-only. Null when not visible/empty.
 */
export async function getLessonPreview(sb: SupabaseClient, partId: string): Promise<LessonPartData | null> {
  const db = supabaseLessonDb(sb as Parameters<typeof supabaseLessonDb>[0]);
  const part = await db.part(partId);
  if (!part) return null;

  const { data, error } = await sb
    .from("blocks")
    .select("id, position, type, payload, published")
    .eq("lesson_part_id", partId)
    .order("position");
  if (error) throw new Error(`preview: blocks: ${error.message}`);
  const rows = (data ?? []) as { id: string; position: number; type: string; payload: unknown; published: boolean }[];
  if (rows.length === 0) return null;
  const blocks = rows.map((b) => parseBlock({ id: b.id, type: b.type, payload: b.payload }));

  const refIds = blocks.filter((b) => b.type === "exercise" || b.type === "speaking").map((b) => b.id);
  const exercises: Record<string, LessonExercise> = {};
  if (refIds.length > 0) {
    const found = await db.exercises(refIds);
    const testIds = new Set(found.length > 0 ? await db.testItemIds(found.map((e) => e.id)) : []);
    for (const b of blocks) {
      if (b.type !== "exercise" && b.type !== "speaking") continue;
      const e = found.find((x) => x.id === b.payload.exerciseId);
      // same rules as the student: must belong to the referencing block and not be a test item
      if (!e || e.blockId !== b.id || testIds.has(e.id)) continue;
      exercises[e.id] = { id: e.id, type: e.type, prompt: e.prompt, payload: e.payload, checkMode: e.checkMode };
    }
  }
  const words = await db.words(part.lessonId);
  return {
    part: { id: part.id, kind: part.kind, title: part.title },
    lesson: { id: part.lessonId, title: part.lessonTitle, objective: part.objective },
    blocks,
    exercises,
    words: words.map((w) => ({ id: w.id, ru: w.ru, stress: w.stress, uz: w.uz })),
    progress: null,
    nextPartId: null,
    submittedExerciseIds: [],
  };
}
