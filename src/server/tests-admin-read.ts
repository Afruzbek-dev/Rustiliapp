import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TestSection } from "@/lib/tests/grade";
import type { EditorTest, TestResultRow, TestsOverview } from "@/lib/tests/editor-types";

/**
 * Reads for the teacher test pages. They use the teacher's OWN (RLS-scoped) client with explicit
 * columns, so a teacher only sees their courses' tests; the results come from test_results(), which
 * authorises inside (course teacher or admin) and raises 42501 for anyone else.
 */
function ok<T>(res: { data: unknown; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new Error(`tests-admin-read: ${what}: ${res.error.message}`);
  return res.data as T;
}
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function loadTestsOverview(sb: SupabaseClient): Promise<TestsOverview> {
  const courses = ok<{ id: string; title: string }[] | null>(await sb.from("courses").select("id, title").order("title"), "courses") ?? [];
  const courseIds = courses.map((c) => c.id);
  if (courseIds.length === 0) return { courses: [], tests: [] };
  const modules = ok<{ id: string; title: string; position: number; course_id: string }[] | null>(
    await sb.from("modules").select("id, title, position, course_id").in("course_id", courseIds).order("position"),
    "modules",
  ) ?? [];
  const tests = ok<
    { id: string; title: string; course_id: string; after_module_id: string | null; published: boolean; pass_score: number | string | null; time_limit_min: number | null }[] | null
  >(
    await sb.from("tests").select("id, title, course_id, after_module_id, published, pass_score, time_limit_min").in("course_id", courseIds).order("title"),
    "tests",
  ) ?? [];
  const counts = await Promise.all(
    tests.map(async (t) => {
      const res = await sb.from("test_items").select("exercise_id", { count: "exact", head: true }).eq("test_id", t.id);
      if (res.error) throw new Error(`tests-admin-read: item count: ${res.error.message}`);
      return [t.id, res.count ?? 0] as const;
    }),
  );
  const countOf = new Map(counts);
  const moduleTitle = new Map(modules.map((m) => [m.id, m.title]));
  const courseTitle = new Map(courses.map((c) => [c.id, c.title]));
  const taken = new Set(tests.flatMap((t) => (t.after_module_id ? [t.after_module_id] : [])));
  return {
    courses: courses.map((c) => ({
      id: c.id,
      title: c.title,
      modules: modules
        .filter((m) => m.course_id === c.id)
        .map((m) => ({ id: m.id, title: m.title, position: m.position, hasTest: taken.has(m.id) })),
    })),
    tests: tests.map((t) => ({
      id: t.id,
      title: t.title,
      courseTitle: courseTitle.get(t.course_id) ?? "",
      moduleTitle: t.after_module_id ? (moduleTitle.get(t.after_module_id) ?? null) : null,
      published: t.published,
      itemCount: countOf.get(t.id) ?? 0,
      passScore: t.pass_score === null ? null : Number(t.pass_score),
      timeLimitMin: t.time_limit_min,
    })),
  };
}

/** null when the test does not exist or is not visible to the caller (RLS). */
export async function loadTestEditor(sb: SupabaseClient, testId: string): Promise<EditorTest | null> {
  const t = ok<{
    id: string; title: string; course_id: string; after_module_id: string | null; published: boolean;
    pass_score: number | string | null; time_limit_min: number | null; max_attempts: number;
  } | null>(
    await sb.from("tests").select("id, title, course_id, after_module_id, published, pass_score, time_limit_min, max_attempts").eq("id", testId).maybeSingle(),
    "test",
  );
  if (!t) return null;
  const course = ok<{ title: string } | null>(await sb.from("courses").select("title").eq("id", t.course_id).maybeSingle(), "course");
  const mod = t.after_module_id
    ? ok<{ title: string } | null>(await sb.from("modules").select("title").eq("id", t.after_module_id).maybeSingle(), "module")
    : null;
  const lessons = t.after_module_id
    ? (ok<{ id: string; title: string; position: number }[] | null>(
        await sb.from("lessons").select("id, title, position").eq("module_id", t.after_module_id).order("position"),
        "lessons",
      ) ?? [])
    : [];
  const rows = ok<{ exercise_id: string; position: number; section: TestSection; lesson_id: string | null; exercises: unknown }[] | null>(
    await sb.from("test_items").select("exercise_id, position, section, lesson_id, exercises(type, prompt, payload)").eq("test_id", testId).order("position"),
    "items",
  ) ?? [];
  const ids = rows.map((r) => r.exercise_id);
  const keys = ids.length
    ? (ok<{ exercise_id: string; answer: unknown }[] | null>(await sb.from("exercise_keys").select("exercise_id, answer").in("exercise_id", ids), "keys") ?? [])
    : [];
  const keyOf = new Map(keys.map((k) => [k.exercise_id, k.answer]));

  const attempts = await sb.from("test_attempts").select("id", { count: "exact", head: true }).eq("test_id", testId);
  if (attempts.error) throw new Error(`tests-admin-read: attempts: ${attempts.error.message}`);

  const results = ok<
    { student_id: string; full_name: string; attempts: number; best_score: number | string | null; passed: boolean; last_finished_at: string | null; in_progress: boolean }[] | null
  >(await sb.rpc("test_results", { p_test: testId }), "results") ?? [];

  return {
    id: t.id,
    title: t.title,
    courseTitle: course?.title ?? "",
    moduleId: t.after_module_id,
    moduleTitle: mod?.title ?? null,
    published: t.published,
    passScore: t.pass_score === null ? null : Number(t.pass_score),
    timeLimitMin: t.time_limit_min,
    maxAttempts: t.max_attempts,
    hasAttempts: (attempts.count ?? 0) > 0,
    lessons,
    items: rows.flatMap((r) => {
      const e = one(r.exercises as { type: string; prompt: string | null; payload: unknown } | { type: string; prompt: string | null; payload: unknown }[] | null);
      return e
        ? [{ exerciseId: r.exercise_id, position: r.position, section: r.section, lessonId: r.lesson_id, type: e.type, prompt: e.prompt ?? "", payload: e.payload, key: keyOf.get(r.exercise_id) ?? null }]
        : [];
    }),
    results: results.map(
      (r): TestResultRow => ({
        studentId: r.student_id,
        fullName: r.full_name,
        attempts: r.attempts,
        bestScore: r.best_score === null ? null : Number(r.best_score),
        passed: r.passed,
        lastFinishedAt: r.last_finished_at,
        inProgress: r.in_progress,
      }),
    ),
  };
}
