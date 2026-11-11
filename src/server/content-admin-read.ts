import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BLOCK_TYPES, type BlockType } from "@/lib/blocks/types";
import { lessonStatus, type EditorBlock, type EditorData, type EditorExercise, type EditorPart, type LessonStatus, type TreeModule } from "@/lib/editor/types";
import { createServiceClient } from "@/lib/supabase/service";
import { toEditorWord } from "@/server/content-admin";

/**
 * Reads for the editor pages. They use the teacher's OWN (RLS-scoped) client with explicit column
 * lists, so a teacher only ever sees their courses; answer keys are readable by the teacher only.
 */
function ok<T>(res: { data: unknown; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`editor-read: ${what}: ${res.error.message}`);
  return res.data as T;
}
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

async function loadTree(sb: SupabaseClient, courseId: string): Promise<TreeModule[]> {
  const modules = ok<{ id: string; title: string; position: number }[] | null>(
    await sb.from("modules").select("id, title, position").eq("course_id", courseId).order("position"),
    "modules",
  ) ?? [];
  const mIds = modules.map((m) => m.id);
  const lessons = mIds.length
    ? (ok<{ id: string; title: string; position: number; module_id: string }[] | null>(
        await sb.from("lessons").select("id, title, position, module_id").in("module_id", mIds).order("position"),
        "lessons",
      ) ?? [])
    : [];
  const lIds = lessons.map((l) => l.id);
  const parts = lIds.length
    ? (ok<{ id: string; lesson_id: string }[] | null>(await sb.from("lesson_parts").select("id, lesson_id").in("lesson_id", lIds), "parts") ?? [])
    : [];
  const pIds = parts.map((p) => p.id);
  const blocks = pIds.length
    ? (ok<{ lesson_part_id: string; published: boolean }[] | null>(await sb.from("blocks").select("lesson_part_id, published").in("lesson_part_id", pIds), "block flags") ?? [])
    : [];
  const lessonOfPart = new Map(parts.map((p) => [p.id, p.lesson_id]));
  const statusOf = (lessonId: string): LessonStatus =>
    lessonStatus(blocks.filter((b) => lessonOfPart.get(b.lesson_part_id) === lessonId));
  return modules.map((m) => ({
    id: m.id,
    position: m.position,
    title: m.title,
    lessons: lessons.filter((l) => l.module_id === m.id).map((l) => ({ id: l.id, position: l.position, title: l.title, status: statusOf(l.id) })),
  }));
}

/** Courses the user may edit (RLS) with their trees; for the lessons index page. */
export async function loadCourseTrees(sb: SupabaseClient): Promise<{ id: string; title: string; tree: TreeModule[] }[]> {
  const courses = ok<{ id: string; title: string }[] | null>(await sb.from("courses").select("id, title").order("title"), "courses") ?? [];
  return Promise.all(courses.map(async (c) => ({ ...c, tree: await loadTree(sb, c.id) })));
}

/** null when the lesson does not exist or is not visible to the caller. */
export async function loadEditorData(sb: SupabaseClient, lessonId: string): Promise<EditorData | null> {
  const lesson = ok<{ id: string; title: string; objective: string | null; updated_at: string; position: number; module_id: string } | null>(
    await sb.from("lessons").select("id, title, objective, updated_at, position, module_id").eq("id", lessonId).maybeSingle(),
    "lesson",
  );
  if (!lesson) return null;
  const mod = ok<{ id: string; title: string; position: number; course_id: string } | null>(
    await sb.from("modules").select("id, title, position, course_id").eq("id", lesson.module_id).maybeSingle(),
    "module",
  );
  if (!mod) return null;
  const course = ok<{ id: string; title: string } | null>(await sb.from("courses").select("id, title").eq("id", mod.course_id).maybeSingle(), "course");

  const partRows = ok<{ id: string; position: number; kind: "grammar" | "conversation"; title: string }[] | null>(
    await sb.from("lesson_parts").select("id, position, kind, title").eq("lesson_id", lessonId).order("position"),
    "parts",
  ) ?? [];
  const partIds = partRows.map((p) => p.id);
  const blockRows = partIds.length
    ? (ok<{ id: string; lesson_part_id: string; type: string; payload: unknown; published: boolean; updated_at: string }[] | null>(
        await sb.from("blocks").select("id, lesson_part_id, position, type, payload, published, updated_at").in("lesson_part_id", partIds).order("position"),
        "blocks",
      ) ?? [])
    : [];
  const blockIds = blockRows.map((b) => b.id);
  const exRows = blockIds.length
    ? (ok<{ id: string; block_id: string; type: string; prompt: string | null; payload: unknown; xp: number }[] | null>(
        await sb.from("exercises").select("id, block_id, type, prompt, payload, xp").in("block_id", blockIds),
        "exercises",
      ) ?? [])
    : [];
  const exIds = exRows.map((e) => e.id);
  const keyRows = exIds.length
    ? (ok<{ exercise_id: string; answer: unknown }[] | null>(await sb.from("exercise_keys").select("exercise_id, answer").in("exercise_id", exIds), "keys") ?? [])
    : [];
  const testRows = exIds.length
    ? (ok<{ exercise_id: string }[] | null>(await sb.from("test_items").select("exercise_id").in("exercise_id", exIds), "test items") ?? [])
    : [];
  const wordRows = ok<{ words: Parameters<typeof toEditorWord>[0] | Parameters<typeof toEditorWord>[0][] | null }[] | null>(
    await sb.from("lesson_words").select("words(id, ru, stress, uz, pos, gender, example_ru, example_uz)").eq("lesson_id", lessonId),
    "words",
  ) ?? [];

  // Exercises students already answered (type is locked). The server enforces it too; a failure here only hides the hint.
  let locked = new Set<string>();
  if (exIds.length > 0) {
    try {
      const { data: l } = await createServiceClient().rpc("exercises_with_student_data", { p_ids: exIds });
      locked = new Set((l ?? []) as string[]);
    } catch {
      locked = new Set();
    }
  }
  const keyOf = new Map(keyRows.map((k) => [k.exercise_id, k.answer]));
  const testSet = new Set(testRows.map((t) => t.exercise_id));
  const exerciseOf = (blockId: string): EditorExercise | null => {
    const e = exRows.find((x) => x.block_id === blockId);
    return e ? { id: e.id, type: e.type, prompt: e.prompt ?? "", payload: e.payload, key: keyOf.get(e.id) ?? null, xp: e.xp, isTestItem: testSet.has(e.id), typeLocked: locked.has(e.id) } : null;
  };
  const parts: EditorPart[] = partRows.map((p) => ({
    id: p.id,
    position: p.position,
    kind: p.kind,
    title: p.title,
    blocks: blockRows
      .filter((b) => b.lesson_part_id === p.id && (BLOCK_TYPES as readonly string[]).includes(b.type))
      .map<EditorBlock>((b) => ({
        id: b.id,
        type: b.type as BlockType,
        published: b.published,
        updatedAt: b.updated_at,
        payload: b.payload && typeof b.payload === "object" ? (b.payload as Record<string, unknown>) : {},
        exercise: exerciseOf(b.id),
      })),
  }));

  return {
    courseId: mod.course_id,
    courseTitle: course?.title ?? "",
    tree: await loadTree(sb, mod.course_id),
    lesson: {
      id: lesson.id,
      title: lesson.title,
      objective: lesson.objective ?? "",
      updatedAt: lesson.updated_at,
      moduleId: mod.id,
      moduleTitle: mod.title,
      modulePosition: mod.position,
      lessonPosition: lesson.position,
      parts,
      words: wordRows.flatMap((r) => {
        const w = one(r.words);
        return w ? [toEditorWord(w)] : [];
      }),
    },
  };
}
