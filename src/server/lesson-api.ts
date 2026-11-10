import { z } from "zod";
import { parseBlock } from "@/lib/blocks/types";
import { completePart, requiredItems, isCheckableType } from "./progress";
import type { AttemptStore } from "./attempts";

export const LESSON_MAX_BODY_BYTES = 4 * 1024;

type Reply = { status: number; json: Record<string, unknown> };

/** JSON body with a hard size cap: 413 when too large, 400 when not valid JSON. */
export async function readLimitedJson(
  request: Request,
  maxBytes: number = LESSON_MAX_BODY_BYTES,
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413 };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

// ---------------------------------------------------------------------------------------------
// POST /api/lesson/complete { partId }
// ---------------------------------------------------------------------------------------------
export interface MissingExercise {
  exerciseId: string;
  /** exercise = auto-checked, still has unanswered items; speaking = review exercise without submission. */
  kind: "exercise" | "speaking";
}

export interface CompleteDeps {
  store: AttemptStore;
  /** True when the part is in the student's path and not locked (same rule as /path). */
  canPlay(studentId: string, partId: string): Promise<boolean>;
}

const completeBody = z.object({ partId: z.string().uuid() }).strict();

/** Exercises of the part the student still has to do before completePart can succeed. */
export async function findMissing(store: AttemptStore, studentId: string, partId: string): Promise<MissingExercise[]> {
  const exercises = await store.getPartExercises(partId);
  const correct = await store.getCorrectRefs(studentId, partId);
  const done = new Set(correct.map((c) => `${c.exerciseId}\u0000${c.itemId ?? ""}`));
  const missing: MissingExercise[] = [];
  for (const e of exercises) {
    if (e.checkMode === "auto" && isCheckableType(e.type)) {
      if (requiredItems(e.type, e.key).some((item) => !done.has(`${e.id}\u0000${item ?? ""}`))) {
        missing.push({ exerciseId: e.id, kind: "exercise" });
      }
    }
  }
  const review = exercises.filter((e) => e.checkMode === "review");
  if (review.length > 0) {
    const submitted = new Set(await store.getSubmittedExerciseIds(studentId, review.map((e) => e.id)));
    for (const e of review) if (!submitted.has(e.id)) missing.push({ exerciseId: e.id, kind: "speaking" });
  }
  return missing;
}

/**
 * The server decides eligibility: completePart is idempotent and grants XP once. When the part
 * cannot be completed yet, the answer names the exercises still missing (ids only, never keys).
 */
export async function handleCompleteRequest(
  deps: CompleteDeps,
  req: { userId: string | null; body: unknown },
): Promise<Reply> {
  if (!req.userId) return { status: 401, json: { error: "unauthenticated" } };
  try {
    if ((await deps.store.getRole(req.userId)) !== "student") return { status: 403, json: { error: "forbidden" } };
    const body = completeBody.safeParse(req.body);
    if (!body.success) return { status: 400, json: { error: "invalid_request" } };
    const { partId } = body.data;
    if (!(await deps.canPlay(req.userId, partId))) return { status: 404, json: { error: "not_found" } };

    const res = await completePart(deps.store, req.userId, partId);
    if (res.completed) {
      return { status: 200, json: { completed: true, newlyCompleted: res.newlyCompleted, xpAwarded: res.xpAwarded } };
    }
    return { status: 200, json: { completed: false, missing: await findMissing(deps.store, req.userId, partId) } };
  } catch (e) {
    console.error("lesson complete: internal error", e instanceof Error ? e.name : "unknown");
    return { status: 500, json: { error: "internal_error" } };
  }
}

// ---------------------------------------------------------------------------------------------
// POST /api/lesson/audio-listened { blockId }
// ---------------------------------------------------------------------------------------------
export interface AudioListenedDeps {
  getRole(userId: string): Promise<string | null>;
  /** USER-scoped read (RLS): the block's type/payload, null when not visible. */
  getVisibleBlock(blockId: string): Promise<{ id: string; type: string; payload: unknown } | null>;
  /** Service: bump the 'audio' daily task once per Tashkent day. */
  bumpAudioOnce(studentId: string): Promise<boolean>;
}

const audioBody = z.object({ blockId: z.string().uuid() }).strict();

export async function handleAudioListened(
  deps: AudioListenedDeps,
  req: { userId: string | null; body: unknown },
): Promise<Reply> {
  if (!req.userId) return { status: 401, json: { error: "unauthenticated" } };
  try {
    if ((await deps.getRole(req.userId)) !== "student") return { status: 403, json: { error: "forbidden" } };
    const body = audioBody.safeParse(req.body);
    if (!body.success) return { status: 400, json: { error: "invalid_request" } };
    const block = await deps.getVisibleBlock(body.data.blockId);
    const parsed = block ? parseBlock(block) : null;
    if (!parsed || parsed.type !== "audio") return { status: 404, json: { error: "not_found" } };
    const bumped = await deps.bumpAudioOnce(req.userId);
    return { status: 200, json: { ok: true, bumped } };
  } catch (e) {
    console.error("audio-listened: internal error", e instanceof Error ? e.name : "unknown");
    return { status: 500, json: { error: "internal_error" } };
  }
}
