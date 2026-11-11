import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { payloadSchemas, type BlockType } from "@/lib/blocks/types";
import { buildExerciseWrite, isAuthorableType, sanitizePayload, DEFAULT_SPEAKING, SPEAKING_XP, type ExerciseWrite } from "@/lib/exercises/authoring";
import { checkLessonForPublish, type CheckPart } from "@/lib/editor/publish-check";
import { ADDABLE_BLOCKS, type EditorWord } from "@/lib/editor/types";
import { parseWordsCsv, type CsvRowError, type WordRow } from "@/lib/editor/words-csv";

/**
 * Server side of the teacher lesson editor. Every function:
 *  1. validates its input with zod,
 *  2. resolves the course of the entity and re-checks that the actor is that course's teacher or an
 *     admin (the SQL functions check the same thing again),
 *  3. writes through the narrow `EditorDb` port (production: service-role RPC; tests: a fake).
 */

export type Code = "forbidden" | "invalid" | "conflict" | "has_student_data" | "failed";
export type Failure = { ok: false; code: Code; message: string; issues?: string[]; currentUpdatedAt?: string };
export type Result<T> = ({ ok: true } & T) | Failure;

const fail = (code: Code, message: string, extra: Partial<Failure> = {}): Failure => ({ ok: false, code, message, ...extra });
const FORBIDDEN = fail("forbidden", "Bu amal uchun ruxsat yo'q");
const INVALID = fail("invalid", "Ma'lumot noto'g'ri");

export interface BlockMeta {
  courseId: string;
  lessonId: string;
  partId: string;
  type: string;
  published: boolean;
}

export interface EditorDb {
  canEdit(actor: string, courseId: string): Promise<boolean>;
  courseOfModule(id: string): Promise<string | null>;
  courseOfLesson(id: string): Promise<string | null>;
  courseOfPart(id: string): Promise<string | null>;
  blockMeta(id: string): Promise<BlockMeta | null>;
  createModule(actor: string, course: string, title: string): Promise<string>;
  createLesson(actor: string, module: string, title: string): Promise<string>;
  saveLesson(actor: string, lesson: string, title: string, objective: string | null, expected: string): Promise<{ outcome: "ok" | "conflict"; updatedAt: string }>;
  createBlock(actor: string, part: string, type: BlockType, payload: Record<string, unknown>, exercise: ExerciseWrite | null): Promise<{ blockId: string; updatedAt: string }>;
  saveBlock(actor: string, block: string, payload: Record<string, unknown> | null, exercise: ExerciseWrite | null, expected: string): Promise<{ outcome: "ok" | "conflict"; updatedAt: string }>;
  deleteBlock(actor: string, block: string): Promise<"ok" | "has_student_data">;
  reorderBlocks(actor: string, part: string, ids: string[]): Promise<void>;
  setPublished(actor: string, lesson: string, published: boolean): Promise<number>;
  lessonCheckData(lesson: string): Promise<{ parts: CheckPart[]; wordIds: string[] }>;
  lessonWords(lesson: string): Promise<EditorWord[]>;
  importWords(actor: string, lesson: string, rows: WordRow[]): Promise<{ inserted: number; linked: number; skipped: number }>;
  saveWord(actor: string, lesson: string, word: string | null, fields: WordFields): Promise<string>;
  unlinkWord(actor: string, lesson: string, word: string): Promise<void>;
  /** Signed upload target for an object path (service role); null when storage is unavailable. */
  signUpload(path: string): Promise<{ token: string } | null>;
}

export interface WordFields {
  ru: string;
  stress: string;
  uz: string;
  pos: string;
  gender: string;
  example_ru: string;
  example_uz: string;
}

/** Thrown by adapters for a database error that carries a SQLSTATE code. */
export class DbError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

const uuid = z.string().uuid();
const title = z.string().trim().min(1, "Sarlavha bo'sh").max(200, "Sarlavha juda uzun");

async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DbError && (err.code === "42501" || err.code === "P0002")) return FORBIDDEN;
    if (err instanceof DbError && err.code === "22023") return fail("invalid", "Ma'lumot noto'g'ri");
    if (err instanceof DbError && err.code === "23514") return fail("invalid", "Bu o'zgartirish mumkin emas");
    console.error("content-admin failed", { code: err instanceof DbError ? err.code : "unknown" });
    return fail("failed", "Xatolik yuz berdi, qayta urinib ko'ring");
  }
}

async function allowed(db: EditorDb, actor: string, courseId: string | null): Promise<boolean> {
  return courseId !== null && (await db.canEdit(actor, courseId));
}

// --------------------------------------------------------------------------------------------
// Structure
// --------------------------------------------------------------------------------------------
export function createModuleFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<{ moduleId: string }>(async () => {
    const p = z.object({ courseId: uuid, title }).safeParse(input);
    if (!p.success) return INVALID;
    if (!(await allowed(db, actor, p.data.courseId))) return FORBIDDEN;
    return { ok: true, moduleId: await db.createModule(actor, p.data.courseId, p.data.title) };
  });
}

export function createLessonFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<{ lessonId: string }>(async () => {
    const p = z.object({ moduleId: uuid, title }).safeParse(input);
    if (!p.success) return INVALID;
    if (!(await allowed(db, actor, await db.courseOfModule(p.data.moduleId)))) return FORBIDDEN;
    return { ok: true, lessonId: await db.createLesson(actor, p.data.moduleId, p.data.title) };
  });
}

export function saveLessonFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<{ updatedAt: string }>(async () => {
    const p = z
      .object({ lessonId: uuid, title, objective: z.string().max(1000, "Maqsad juda uzun"), expected: z.string().min(1).max(64) })
      .safeParse(input);
    if (!p.success) return fail("invalid", p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri");
    if (!(await allowed(db, actor, await db.courseOfLesson(p.data.lessonId)))) return FORBIDDEN;
    const r = await db.saveLesson(actor, p.data.lessonId, p.data.title, p.data.objective.trim() || null, p.data.expected);
    if (r.outcome === "conflict") return fail("conflict", "Dars boshqa joyda o'zgartirilgan", { currentUpdatedAt: r.updatedAt });
    return { ok: true, updatedAt: r.updatedAt };
  });
}

// --------------------------------------------------------------------------------------------
// Blocks
// --------------------------------------------------------------------------------------------
const exerciseDraft = z.object({
  type: z.string().max(30),
  prompt: z.string().max(2000),
  payload: z.unknown(),
  key: z.unknown(),
  xp: z.number().int().min(0).max(200),
});

/** Drafts (unpublished blocks) only need a SAFE shape; publishing / published blocks need a COMPLETE, valid exercise. */
function exerciseWriteFor(blockType: "exercise" | "speaking", draft: z.infer<typeof exerciseDraft>, strict: boolean): { ok: true; write: ExerciseWrite } | Failure {
  const typeOk = blockType === "speaking" ? draft.type === "speaking" : isAuthorableType(draft.type);
  if (!typeOk) return fail("invalid", "Mashq turi blokka mos kelmaydi");
  if (strict) {
    const res = buildExerciseWrite(draft);
    return res.ok ? { ok: true, write: res.write } : fail("invalid", res.errors[0] ?? "Mashq noto'g'ri", { issues: res.errors });
  }
  const key = draft.key ?? null;
  if (draft.type !== "speaking" && JSON.stringify(key ?? null).length > 100_000) return INVALID;
  return {
    ok: true,
    write: {
      type: draft.type as ExerciseWrite["type"],
      prompt: draft.prompt.trim() || null,
      payload: sanitizePayload(draft.type, draft.payload),
      check_mode: draft.type === "speaking" ? "review" : "auto",
      xp: draft.xp,
      key: draft.type === "speaking" ? null : typeof key === "object" ? key : null,
    },
  };
}

function defaultDraft(type: "exercise" | "speaking") {
  return type === "speaking"
    ? { type: "speaking", prompt: "", payload: { ...DEFAULT_SPEAKING }, key: null, xp: SPEAKING_XP }
    : { type: "classify", prompt: "", payload: { items: [], buckets: [] }, key: {}, xp: 10 };
}

export function createBlockFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<{ blockId: string; updatedAt: string }>(async () => {
    const p = z.object({ partId: uuid, type: z.enum(ADDABLE_BLOCKS as [BlockType, ...BlockType[]]) }).safeParse(input);
    if (!p.success) return INVALID;
    if (!(await allowed(db, actor, await db.courseOfPart(p.data.partId)))) return FORBIDDEN;
    let exercise: ExerciseWrite | null = null;
    if (p.data.type === "exercise" || p.data.type === "speaking") {
      const w = exerciseWriteFor(p.data.type, defaultDraft(p.data.type), false);
      if (!w.ok) return w;
      exercise = w.write;
    }
    const r = await db.createBlock(actor, p.data.partId, p.data.type, {}, exercise);
    return { ok: true, blockId: r.blockId, updatedAt: r.updatedAt };
  });
}

export function saveBlockFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<{ updatedAt: string }>(async () => {
    const p = z
      .object({ blockId: uuid, payload: z.record(z.unknown()).optional(), exercise: exerciseDraft.optional(), expected: z.string().min(1).max(64) })
      .safeParse(input);
    if (!p.success) return INVALID;
    const meta = await db.blockMeta(p.data.blockId);
    if (!meta || !(await allowed(db, actor, meta.courseId))) return FORBIDDEN;
    if (meta.type === "reading" || !(ADDABLE_BLOCKS as string[]).includes(meta.type)) return fail("invalid", "Bu blok turini tahrirlab bo'lmaydi");

    let payload: Record<string, unknown> | null = null;
    let exercise: ExerciseWrite | null = null;
    if (meta.type === "exercise" || meta.type === "speaking") {
      if (!p.data.exercise) return INVALID;
      const w = exerciseWriteFor(meta.type, p.data.exercise, meta.published);
      if (!w.ok) return w;
      exercise = w.write;
    } else {
      const raw = meta.type === "words" ? {} : p.data.payload;
      if (!raw || JSON.stringify(raw).length > 100_000) return INVALID;
      const schema = payloadSchemas[meta.type as BlockType];
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        // A live block must stay valid; a draft block may be incomplete.
        if (meta.published) return fail("invalid", "Blok to'liq emas: nashr qilingan blokni saqlab bo'lmaydi", { issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".") + ": " + i.message) });
      }
      payload = parsed.success ? (parsed.data as Record<string, unknown>) : looseCopy(meta.type, raw);
      const path = payload.path;
      if ((meta.type === "audio" || meta.type === "rule_image") && path !== undefined && !(typeof path === "string" && path.startsWith(`${meta.courseId}/`))) {
        return fail("invalid", "Fayl yo'li noto'g'ri");
      }
      if (meta.type === "text" && Array.isArray(payload.glossary) && payload.glossary.length > 0) {
        const ids = new Set((await db.lessonWords(meta.lessonId)).map((w) => w.id));
        if (payload.glossary.some((g) => !ids.has((g as { wordId?: string }).wordId ?? ""))) {
          return fail("invalid", "Lug'atdagi so'z bu darsga tegishli emas");
        }
      }
    }
    const r = await db.saveBlock(actor, p.data.blockId, payload, exercise, p.data.expected);
    if (r.outcome === "conflict") return fail("conflict", "Blok boshqa joyda o'zgartirilgan", { currentUpdatedAt: r.updatedAt });
    return { ok: true, updatedAt: r.updatedAt };
  });
}

/** Whitelist copy of an incomplete draft payload (no unknown fields are ever stored). */
function looseCopy(type: string, raw: Record<string, unknown>): Record<string, unknown> {
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  const pick = (names: Record<string, number>) => {
    const out: Record<string, unknown> = {};
    for (const [k, n] of Object.entries(names)) {
      const v = s(raw[k], n);
      if (v !== undefined) out[k] = v;
    }
    return out;
  };
  switch (type) {
    case "video":
      return { ...pick({ provider: 20, videoId: 20, title: 200 }) };
    case "audio":
      return { ...pick({ path: 300, title: 200, transcript: 10_000 }), ...(typeof raw.durationSec === "number" ? { durationSec: raw.durationSec } : {}) };
    case "rule_image":
      return pick({ path: 300, alt: 300, caption: 500 });
    case "text":
    case "reading":
      return {
        ...pick({ title: 200, body: 20_000 }),
        glossary: (Array.isArray(raw.glossary) ? raw.glossary : []).slice(0, 500).flatMap((g) => {
          const o = g as Record<string, unknown>;
          return typeof o?.surface === "string" && typeof o?.wordId === "string" ? [{ surface: o.surface.slice(0, 80), wordId: o.wordId }] : [];
        }),
      };
    default:
      return {};
  }
}

export function deleteBlockFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<object>(async () => {
    const p = z.object({ blockId: uuid }).safeParse(input);
    if (!p.success) return INVALID;
    const meta = await db.blockMeta(p.data.blockId);
    if (!meta || !(await allowed(db, actor, meta.courseId))) return FORBIDDEN;
    const r = await db.deleteBlock(actor, p.data.blockId);
    if (r === "has_student_data") return fail("has_student_data", "O'quvchilar bu mashqni bajargan: o'chirib bo'lmaydi");
    return { ok: true };
  });
}

export function reorderBlocksFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<object>(async () => {
    const p = z.object({ partId: uuid, ids: z.array(uuid).min(1).max(200) }).safeParse(input);
    if (!p.success || new Set(p.data.ids).size !== p.data.ids.length) return INVALID;
    if (!(await allowed(db, actor, await db.courseOfPart(p.data.partId)))) return FORBIDDEN;
    await db.reorderBlocks(actor, p.data.partId, p.data.ids);
    return { ok: true };
  });
}

export function setPublishedFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<{ warnings: string[] }>(async () => {
    const p = z.object({ lessonId: uuid, published: z.boolean() }).safeParse(input);
    if (!p.success) return INVALID;
    if (!(await allowed(db, actor, await db.courseOfLesson(p.data.lessonId)))) return FORBIDDEN;
    let warnings: string[] = [];
    if (p.data.published) {
      const data = await db.lessonCheckData(p.data.lessonId);
      const check = checkLessonForPublish(data.parts, data.wordIds.length, new Set(data.wordIds));
      if (check.errors.length > 0) return fail("invalid", "Dars nashr qilishga tayyor emas", { issues: check.errors });
      warnings = check.warnings;
    }
    await db.setPublished(actor, p.data.lessonId, p.data.published);
    return { ok: true, warnings };
  });
}

// --------------------------------------------------------------------------------------------
// Words
// --------------------------------------------------------------------------------------------
export function importWordsFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<{ inserted: number; linked: number; skipped: number; errors: CsvRowError[]; duplicates: number; words: EditorWord[] }>(async () => {
    const p = z.object({ lessonId: uuid, csv: z.string().max(400_000) }).safeParse(input);
    if (!p.success) return INVALID;
    if (!(await allowed(db, actor, await db.courseOfLesson(p.data.lessonId)))) return FORBIDDEN;
    const parsed = parseWordsCsv(p.data.csv);
    if (parsed.fileError) return fail("invalid", parsed.fileError);
    if (parsed.rows.length === 0) return fail("invalid", "Import qilinadigan to'g'ri qator yo'q", { issues: parsed.errors.slice(0, 20).map((e) => `${e.line}-qator: ${e.message}`) });
    const r = await db.importWords(actor, p.data.lessonId, parsed.rows);
    return { ok: true, ...r, errors: parsed.errors, duplicates: parsed.duplicates, words: await db.lessonWords(p.data.lessonId) };
  });
}

const wordFields = z.object({
  ru: z.string().trim().min(1, "Ruscha so'z bo'sh").max(200),
  stress: z.string().trim().max(200),
  uz: z.string().trim().min(1, "Tarjima bo'sh").max(200),
  pos: z.string().trim().max(40),
  gender: z.string().trim().max(20),
  example_ru: z.string().trim().max(500),
  example_uz: z.string().trim().max(500),
});

export function saveWordFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<{ words: EditorWord[] }>(async () => {
    const p = z.object({ lessonId: uuid, wordId: uuid.nullable(), fields: wordFields }).safeParse(input);
    if (!p.success) return fail("invalid", p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri");
    if (!(await allowed(db, actor, await db.courseOfLesson(p.data.lessonId)))) return FORBIDDEN;
    await db.saveWord(actor, p.data.lessonId, p.data.wordId, p.data.fields);
    return { ok: true, words: await db.lessonWords(p.data.lessonId) };
  });
}

export function unlinkWordFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<{ words: EditorWord[] }>(async () => {
    const p = z.object({ lessonId: uuid, wordId: uuid }).safeParse(input);
    if (!p.success) return INVALID;
    if (!(await allowed(db, actor, await db.courseOfLesson(p.data.lessonId)))) return FORBIDDEN;
    await db.unlinkWord(actor, p.data.lessonId, p.data.wordId);
    return { ok: true, words: await db.lessonWords(p.data.lessonId) };
  });
}

// --------------------------------------------------------------------------------------------
// Uploads
// --------------------------------------------------------------------------------------------
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function requestUploadFn(db: EditorDb, actor: string, input: unknown) {
  return guarded<{ path: string; token: string }>(async () => {
    const p = z
      .object({ lessonId: uuid, kind: z.enum(["audio", "image"]), size: z.number().int().positive(), contentType: z.string().max(100) })
      .safeParse(input);
    if (!p.success) return INVALID;
    if (p.data.size > UPLOAD_MAX_BYTES) return fail("invalid", "Fayl 20 MB dan katta");
    const ext = EXT[p.data.contentType];
    if (!ext || !p.data.contentType.startsWith(p.data.kind === "audio" ? "audio/" : "image/")) return fail("invalid", "Fayl turi qo'llab-quvvatlanmaydi");
    const course = await db.courseOfLesson(p.data.lessonId);
    if (!(await allowed(db, actor, course))) return FORBIDDEN;
    const path = `${course}/${randomUUID()}.${ext}`;
    const target = await db.signUpload(path);
    if (!target) return fail("failed", "Yuklash hozir mavjud emas");
    return { ok: true, path, token: target.token };
  });
}

// --------------------------------------------------------------------------------------------
// Production adapter (service-role client; authority is re-checked in code and in SQL)
// --------------------------------------------------------------------------------------------
function ok<T>(res: { data: unknown; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new DbError(`content-admin: ${what}: ${res.error.message}`, res.error.code);
  return res.data as T;
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const WORD_SELECT = "id, ru, stress, uz, pos, gender, example_ru, example_uz";
type WordRowDb = { id: string; ru: string; stress: string | null; uz: string; pos: string | null; gender: string | null; example_ru: string | null; example_uz: string | null };
export const toEditorWord = (w: WordRowDb): EditorWord => ({
  id: w.id,
  ru: w.ru,
  stress: w.stress ?? "",
  uz: w.uz,
  pos: w.pos ?? "",
  gender: w.gender ?? "",
  example_ru: w.example_ru ?? "",
  example_uz: w.example_uz ?? "",
});

export function supabaseEditorDb(sb: SupabaseClient): EditorDb {
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => ok<T>(await sb.rpc(name, args), name);
  const courseOf = async (table: string, select: string, id: string): Promise<unknown> => ok<unknown>(await sb.from(table).select(select).eq("id", id).maybeSingle(), table);

  return {
    async canEdit(actor, courseId) {
      const profile = ok<{ role: string } | null>(await sb.from("profiles").select("role").eq("id", actor).maybeSingle(), "profile");
      if (!profile) return false;
      if (profile.role === "admin") return true;
      if (profile.role !== "teacher") return false;
      const c = ok<{ id: string } | null>(await sb.from("courses").select("id").eq("id", courseId).eq("teacher_id", actor).maybeSingle(), "course");
      return c !== null;
    },
    async courseOfModule(id) {
      return ((await courseOf("modules", "course_id", id)) as { course_id: string } | null)?.course_id ?? null;
    },
    async courseOfLesson(id) {
      const l = (await courseOf("lessons", "module_id, modules(course_id)", id)) as { modules: { course_id: string } | { course_id: string }[] | null } | null;
      return l ? (one(l.modules)?.course_id ?? null) : null;
    },
    async courseOfPart(id) {
      const p = (await courseOf("lesson_parts", "lesson_id, lessons(module_id, modules(course_id))", id)) as {
        lessons: { modules: { course_id: string } | { course_id: string }[] | null } | { modules: { course_id: string } | { course_id: string }[] | null }[] | null;
      } | null;
      const l = p ? one(p.lessons) : null;
      return l ? (one(l.modules)?.course_id ?? null) : null;
    },
    async blockMeta(id) {
      const b = ok<{
        type: string;
        published: boolean;
        lesson_part_id: string;
        lesson_parts: { lesson_id: string; lessons: { modules: { course_id: string } | { course_id: string }[] | null } | { modules: { course_id: string } | { course_id: string }[] | null }[] | null } | null;
      } | null>(
        await sb.from("blocks").select("type, published, lesson_part_id, lesson_parts(lesson_id, lessons(module_id, modules(course_id)))").eq("id", id).maybeSingle(),
        "block",
      );
      const part = b ? one(b.lesson_parts) : null;
      const lesson = part ? one(part.lessons) : null;
      const courseId = lesson ? (one(lesson.modules)?.course_id ?? null) : null;
      if (!b || !part || !courseId) return null;
      return { courseId, lessonId: part.lesson_id, partId: b.lesson_part_id, type: b.type, published: b.published };
    },
    async createModule(actor, course, title) {
      return rpc<string>("editor_create_module", { p_actor: actor, p_course: course, p_title: title });
    },
    async createLesson(actor, module, title) {
      return rpc<string>("editor_create_lesson", { p_actor: actor, p_module: module, p_title: title });
    },
    async saveLesson(actor, lesson, title, objective, expected) {
      const rows = await rpc<{ outcome: "ok" | "conflict"; updated_at: string }[]>("editor_save_lesson", {
        p_actor: actor, p_lesson: lesson, p_title: title, p_objective: objective, p_expected: expected,
      });
      return { outcome: rows[0].outcome, updatedAt: rows[0].updated_at };
    },
    async createBlock(actor, part, type, payload, exercise) {
      const rows = await rpc<{ block_id: string; updated_at: string }[]>("editor_create_block", {
        p_actor: actor, p_part: part, p_type: type, p_payload: payload, p_exercise: exercise,
      });
      return { blockId: rows[0].block_id, updatedAt: rows[0].updated_at };
    },
    async saveBlock(actor, block, payload, exercise, expected) {
      const rows = await rpc<{ outcome: "ok" | "conflict"; updated_at: string }[]>("editor_save_block", {
        p_actor: actor, p_block: block, p_payload: payload, p_exercise: exercise, p_expected: expected,
      });
      return { outcome: rows[0].outcome, updatedAt: rows[0].updated_at };
    },
    async deleteBlock(actor, block) {
      return rpc<"ok" | "has_student_data">("editor_delete_block", { p_actor: actor, p_block: block });
    },
    async reorderBlocks(actor, part, ids) {
      await rpc<unknown>("editor_reorder_blocks", { p_actor: actor, p_part: part, p_ids: ids });
    },
    async setPublished(actor, lesson, published) {
      return rpc<number>("editor_set_lesson_published", { p_actor: actor, p_lesson: lesson, p_published: published });
    },
    async lessonCheckData(lesson) {
      const parts = ok<{ id: string; position: number; title: string }[] | null>(
        await sb.from("lesson_parts").select("id, position, title").eq("lesson_id", lesson).order("position"),
        "parts",
      ) ?? [];
      const partIds = parts.map((p) => p.id);
      const blocks = partIds.length
        ? (ok<{ id: string; lesson_part_id: string; position: number; type: string; payload: unknown }[] | null>(
            await sb.from("blocks").select("id, lesson_part_id, position, type, payload").in("lesson_part_id", partIds).order("position"),
            "blocks",
          ) ?? [])
        : [];
      const blockIds = blocks.map((b) => b.id);
      const exercises = blockIds.length
        ? (ok<{ id: string; block_id: string; type: string; prompt: string | null; payload: unknown; xp: number }[] | null>(
            await sb.from("exercises").select("id, block_id, type, prompt, payload, xp").in("block_id", blockIds),
            "exercises",
          ) ?? [])
        : [];
      const exIds = exercises.map((e) => e.id);
      const keys = exIds.length
        ? (ok<{ exercise_id: string; answer: unknown }[] | null>(await sb.from("exercise_keys").select("exercise_id, answer").in("exercise_id", exIds), "keys") ?? [])
        : [];
      const testItems = exIds.length
        ? (ok<{ exercise_id: string }[] | null>(await sb.from("test_items").select("exercise_id").in("exercise_id", exIds), "test items") ?? [])
        : [];
      const keyOf = new Map(keys.map((k) => [k.exercise_id, k.answer]));
      const inTest = new Set(testItems.map((t) => t.exercise_id));
      const words = ok<{ word_id: string }[] | null>(await sb.from("lesson_words").select("word_id").eq("lesson_id", lesson), "lesson words") ?? [];
      return {
        wordIds: words.map((w) => w.word_id),
        parts: parts.map((p) => ({
          position: p.position,
          title: p.title,
          blocks: blocks
            .filter((b) => b.lesson_part_id === p.id)
            .map((b) => {
              const e = exercises.find((x) => x.block_id === b.id);
              return {
                id: b.id,
                type: b.type,
                payload: b.payload,
                exercise: e
                  ? { id: e.id, type: e.type, prompt: e.prompt, payload: e.payload, key: keyOf.get(e.id) ?? null, xp: e.xp, isTestItem: inTest.has(e.id) }
                  : null,
              };
            }),
        })),
      };
    },
    async lessonWords(lesson) {
      const rows = ok<{ words: WordRowDb | WordRowDb[] | null }[] | null>(await sb.from("lesson_words").select(`words(${WORD_SELECT})`).eq("lesson_id", lesson), "words") ?? [];
      return rows.flatMap((r) => {
        const w = one(r.words);
        return w ? [toEditorWord(w)] : [];
      });
    },
    async importWords(actor, lesson, rows) {
      const r = await rpc<{ inserted: number; linked: number; skipped: number }[]>("editor_import_words", { p_actor: actor, p_lesson: lesson, p_rows: rows });
      return r[0];
    },
    async saveWord(actor, lesson, word, fields) {
      return rpc<string>("editor_save_word", { p_actor: actor, p_lesson: lesson, p_word: word, p_fields: fields });
    },
    async unlinkWord(actor, lesson, word) {
      await rpc<unknown>("editor_unlink_word", { p_actor: actor, p_lesson: lesson, p_word: word });
    },
    async signUpload(path) {
      try {
        const { data, error } = await sb.storage.from("content").createSignedUploadUrl(path);
        return error || !data?.token ? null : { token: data.token };
      } catch {
        return null;
      }
    },
  };
}
