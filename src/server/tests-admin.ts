import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildExerciseWrite, type ExerciseWrite } from "@/lib/exercises/authoring";
import { TEST_SECTIONS, type TestSection } from "@/lib/tests/grade";
import { checkTestForPublish } from "@/lib/tests/publish-check";
import { DbError, type Failure, type Result } from "@/server/content-admin";

/**
 * Teacher side of module tests. Same shape as the lesson editor (content-admin.ts): every function
 * validates its input with zod, re-checks that the actor teaches the course (admin: any), and writes
 * through a narrow port (production: service-role RPC to the test_editor_* SQL functions, which check
 * the actor again). Test items are NEW exercises owned by the test (never lesson block exercises), of
 * auto-gradable types, and every save is STRICT: a test item is always complete and valid.
 */

type Code = Failure["code"];
const fail = (code: Code, message: string, extra: Partial<Failure> = {}): Failure => ({ ok: false, code, message, ...extra });
const FORBIDDEN = fail("forbidden", "Bu amal uchun ruxsat yo'q");
const INVALID = fail("invalid", "Ma'lumot noto'g'ri");

export interface TestSettings {
  title: string;
  passScore: number | null;
  timeLimitMin: number | null;
  maxAttempts: number;
}

export interface TestSnapshot {
  courseId: string;
  moduleId: string | null;
  published: boolean;
  passScore: number | null;
  timeLimitMin: number | null;
  items: { exerciseId: string; type: string; prompt: string | null; payload: unknown; key: unknown; blockId: string | null }[];
}

export interface TestsAdminDb {
  canEdit(actor: string, courseId: string): Promise<boolean>;
  courseOfModule(moduleId: string): Promise<string | null>;
  /** null when the test does not exist; the caller's authority is checked separately. */
  snapshot(testId: string): Promise<TestSnapshot | null>;
  create(actor: string, courseId: string, moduleId: string, title: string): Promise<string>;
  update(actor: string, testId: string, s: TestSettings): Promise<void>;
  addItem(actor: string, testId: string, section: TestSection, lessonId: string | null, exercise: ExerciseWrite): Promise<string>;
  updateItem(actor: string, testId: string, exerciseId: string, section: TestSection, lessonId: string | null, exercise: ExerciseWrite): Promise<void>;
  removeItem(actor: string, testId: string, exerciseId: string): Promise<void>;
  reorderItems(actor: string, testId: string, ids: string[]): Promise<void>;
  setPublished(actor: string, testId: string, published: boolean): Promise<void>;
  remove(actor: string, testId: string): Promise<void>;
}

async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (err) {
    const code = err instanceof DbError ? err.code : undefined;
    const message = err instanceof Error ? err.message : "";
    if (code === "42501" || code === "P0002") return FORBIDDEN;
    if (code === "22023") return INVALID;
    if (code === "23505") return fail("invalid", "Bu modulda test allaqachon bor");
    if (code === "23514" && /has attempts/.test(message)) {
      return fail("invalid", "O'quvchilar bu testni topshirgan: mashqlarni o'zgartirib bo'lmaydi");
    }
    if (code === "23514") return fail("invalid", "Test nashr qilishga tayyor emas");
    console.error("tests-admin failed", { code: code ?? "unknown" });
    return fail("failed", "Xatolik yuz berdi, qayta urinib ko'ring");
  }
}

const uuid = z.string().uuid();
const title = z.string().trim().min(1, "Sarlavha bo'sh").max(200, "Sarlavha juda uzun");
const section = z.enum(TEST_SECTIONS as unknown as [TestSection, ...TestSection[]]);
const settings = z.object({
  title,
  passScore: z.number().gt(0, "O'tish bali 1 dan 100 gacha").max(100, "O'tish bali 1 dan 100 gacha").nullable(),
  timeLimitMin: z.number().int().min(1, "Vaqt 1-600 daqiqa").max(600, "Vaqt 1-600 daqiqa").nullable(),
  maxAttempts: z.number().int().min(1, "Urinishlar 1-10").max(10, "Urinishlar 1-10"),
});
const exerciseDraft = z.object({
  type: z.string().max(30),
  prompt: z.string().max(2000),
  payload: z.unknown(),
  key: z.unknown(),
});

async function authorised(db: TestsAdminDb, actor: string, testId: string): Promise<TestSnapshot | null> {
  const snap = await db.snapshot(testId);
  return snap && (await db.canEdit(actor, snap.courseId)) ? snap : null;
}

/** Strict: the item must be complete (type, prompt, payload and key) and auto-gradable. */
function buildItem(draft: z.infer<typeof exerciseDraft>): { ok: true; write: ExerciseWrite } | Failure {
  const res = buildExerciseWrite({ ...draft, xp: 0 });
  if (!res.ok) return fail("invalid", res.errors[0] ?? "Mashq noto'g'ri", { issues: res.errors });
  if (res.write.type === "speaking") return fail("invalid", "Testda faqat avtomatik tekshiriladigan mashqlar bo'ladi");
  return { ok: true, write: res.write };
}

export function createTestFn(db: TestsAdminDb, actor: string, input: unknown) {
  return guarded<{ testId: string }>(async () => {
    const p = z.object({ moduleId: uuid, title }).safeParse(input);
    if (!p.success) return INVALID;
    const course = await db.courseOfModule(p.data.moduleId);
    if (!course || !(await db.canEdit(actor, course))) return FORBIDDEN;
    return { ok: true, testId: await db.create(actor, course, p.data.moduleId, p.data.title) };
  });
}

export function updateTestFn(db: TestsAdminDb, actor: string, input: unknown) {
  return guarded<object>(async () => {
    const p = z.object({ testId: uuid }).merge(settings).safeParse(input);
    if (!p.success) return fail("invalid", p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri");
    const snap = await authorised(db, actor, p.data.testId);
    if (!snap) return FORBIDDEN;
    if (snap.published && p.data.passScore === null) return fail("invalid", "Nashr qilingan testda o'tish bali bo'lishi kerak");
    await db.update(actor, p.data.testId, {
      title: p.data.title,
      passScore: p.data.passScore,
      timeLimitMin: p.data.timeLimitMin,
      maxAttempts: p.data.maxAttempts,
    });
    return { ok: true };
  });
}

export function addItemFn(db: TestsAdminDb, actor: string, input: unknown) {
  return guarded<{ exerciseId: string }>(async () => {
    const p = z.object({ testId: uuid, section, lessonId: uuid.nullable(), exercise: exerciseDraft }).safeParse(input);
    if (!p.success) return INVALID;
    if (!(await authorised(db, actor, p.data.testId))) return FORBIDDEN;
    const built = buildItem(p.data.exercise);
    if (!built.ok) return built;
    return { ok: true, exerciseId: await db.addItem(actor, p.data.testId, p.data.section, p.data.lessonId, built.write) };
  });
}

export function updateItemFn(db: TestsAdminDb, actor: string, input: unknown) {
  return guarded<object>(async () => {
    const p = z.object({ testId: uuid, exerciseId: uuid, section, lessonId: uuid.nullable(), exercise: exerciseDraft }).safeParse(input);
    if (!p.success) return INVALID;
    if (!(await authorised(db, actor, p.data.testId))) return FORBIDDEN;
    const built = buildItem(p.data.exercise);
    if (!built.ok) return built;
    await db.updateItem(actor, p.data.testId, p.data.exerciseId, p.data.section, p.data.lessonId, built.write);
    return { ok: true };
  });
}

export function removeItemFn(db: TestsAdminDb, actor: string, input: unknown) {
  return guarded<object>(async () => {
    const p = z.object({ testId: uuid, exerciseId: uuid }).safeParse(input);
    if (!p.success) return INVALID;
    if (!(await authorised(db, actor, p.data.testId))) return FORBIDDEN;
    await db.removeItem(actor, p.data.testId, p.data.exerciseId);
    return { ok: true };
  });
}

export function reorderItemsFn(db: TestsAdminDb, actor: string, input: unknown) {
  return guarded<object>(async () => {
    const p = z.object({ testId: uuid, ids: z.array(uuid).min(1).max(200) }).safeParse(input);
    if (!p.success || new Set(p.data.ids).size !== p.data.ids.length) return INVALID;
    if (!(await authorised(db, actor, p.data.testId))) return FORBIDDEN;
    await db.reorderItems(actor, p.data.testId, p.data.ids);
    return { ok: true };
  });
}

export function setTestPublishedFn(db: TestsAdminDb, actor: string, input: unknown) {
  return guarded<{ warnings: string[] }>(async () => {
    const p = z.object({ testId: uuid, published: z.boolean() }).safeParse(input);
    if (!p.success) return INVALID;
    const snap = await authorised(db, actor, p.data.testId);
    if (!snap) return FORBIDDEN;
    let warnings: string[] = [];
    if (p.data.published) {
      const check = checkTestForPublish({
        moduleId: snap.moduleId,
        passScore: snap.passScore,
        timeLimitMin: snap.timeLimitMin,
        items: snap.items,
      });
      if (check.errors.length > 0) return fail("invalid", "Test nashr qilishga tayyor emas", { issues: check.errors });
      warnings = check.warnings;
    }
    await db.setPublished(actor, p.data.testId, p.data.published);
    return { ok: true, warnings };
  });
}

export function deleteTestFn(db: TestsAdminDb, actor: string, input: unknown) {
  return guarded<object>(async () => {
    const p = z.object({ testId: uuid }).safeParse(input);
    if (!p.success) return INVALID;
    if (!(await authorised(db, actor, p.data.testId))) return FORBIDDEN;
    await db.remove(actor, p.data.testId);
    return { ok: true };
  });
}

// --------------------------------------------------------------------------------------------
// Production adapter (service-role client; authority is re-checked in code and in SQL)
// --------------------------------------------------------------------------------------------
function ok<T>(res: { data: unknown; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new DbError(`tests-admin: ${what}: ${res.error.message}`, res.error.code);
  return res.data as T;
}
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const exerciseJson = (e: ExerciseWrite) => ({ type: e.type, prompt: e.prompt ?? "", payload: e.payload, key: e.key });

export function supabaseTestsAdminDb(sb: SupabaseClient): TestsAdminDb {
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => ok<T>(await sb.rpc(name, args), name);
  return {
    async canEdit(actor, courseId) {
      const profile = ok<{ role: string } | null>(await sb.from("profiles").select("role").eq("id", actor).maybeSingle(), "profile");
      if (!profile) return false;
      if (profile.role === "admin") return true;
      if (profile.role !== "teacher") return false;
      return ok<{ id: string } | null>(await sb.from("courses").select("id").eq("id", courseId).eq("teacher_id", actor).maybeSingle(), "course") !== null;
    },
    async courseOfModule(moduleId) {
      return ok<{ course_id: string } | null>(await sb.from("modules").select("course_id").eq("id", moduleId).maybeSingle(), "module")?.course_id ?? null;
    },
    async snapshot(testId) {
      const t = ok<{ course_id: string; after_module_id: string | null; published: boolean; pass_score: number | string | null; time_limit_min: number | null } | null>(
        await sb.from("tests").select("course_id, after_module_id, published, pass_score, time_limit_min").eq("id", testId).maybeSingle(),
        "test",
      );
      if (!t) return null;
      const rows = ok<{ exercise_id: string; position: number; exercises: unknown }[] | null>(
        await sb.from("test_items").select("exercise_id, position, exercises(type, prompt, payload, block_id)").eq("test_id", testId).order("position"),
        "items",
      ) ?? [];
      const ids = rows.map((r) => r.exercise_id);
      const keys = ids.length
        ? (ok<{ exercise_id: string; answer: unknown }[] | null>(await sb.from("exercise_keys").select("exercise_id, answer").in("exercise_id", ids), "keys") ?? [])
        : [];
      const keyOf = new Map(keys.map((k) => [k.exercise_id, k.answer]));
      return {
        courseId: t.course_id,
        moduleId: t.after_module_id,
        published: t.published,
        passScore: t.pass_score === null ? null : Number(t.pass_score),
        timeLimitMin: t.time_limit_min,
        items: rows.flatMap((r) => {
          const e = one(r.exercises as { type: string; prompt: string | null; payload: unknown; block_id: string | null } | { type: string; prompt: string | null; payload: unknown; block_id: string | null }[] | null);
          return e ? [{ exerciseId: r.exercise_id, type: e.type, prompt: e.prompt, payload: e.payload, key: keyOf.get(r.exercise_id) ?? null, blockId: e.block_id }] : [];
        }),
      };
    },
    create: (actor, courseId, moduleId, t) => rpc<string>("test_editor_create", { p_actor: actor, p_course: courseId, p_module: moduleId, p_title: t }),
    async update(actor, testId, s) {
      await rpc<unknown>("test_editor_update", {
        p_actor: actor, p_test: testId, p_title: s.title, p_pass_score: s.passScore, p_time_limit: s.timeLimitMin, p_max_attempts: s.maxAttempts,
      });
    },
    addItem: (actor, testId, sec, lessonId, e) =>
      rpc<string>("test_editor_add_item", { p_actor: actor, p_test: testId, p_section: sec, p_lesson: lessonId, p_exercise: exerciseJson(e) }),
    async updateItem(actor, testId, exerciseId, sec, lessonId, e) {
      await rpc<unknown>("test_editor_update_item", {
        p_actor: actor, p_test: testId, p_exercise_id: exerciseId, p_section: sec, p_lesson: lessonId, p_exercise: exerciseJson(e),
      });
    },
    async removeItem(actor, testId, exerciseId) {
      await rpc<unknown>("test_editor_remove_item", { p_actor: actor, p_test: testId, p_exercise_id: exerciseId });
    },
    async reorderItems(actor, testId, ids) {
      await rpc<unknown>("test_editor_reorder_items", { p_actor: actor, p_test: testId, p_ids: ids });
    },
    async setPublished(actor, testId, published) {
      await rpc<unknown>("test_editor_set_published", { p_actor: actor, p_test: testId, p_published: published });
    },
    async remove(actor, testId) {
      await rpc<unknown>("test_editor_delete", { p_actor: actor, p_test: testId });
    },
  };
}
