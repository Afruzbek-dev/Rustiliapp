import { z } from "zod";
import { check } from "@/lib/exercises/check";
import type { AnswerMap, ExerciseType, KeyMap } from "@/lib/exercises/types";
import { EXERCISE_FIRST, EXERCISE_RETRY } from "@/lib/gamification/xp";
import { completePart, isCheckableType, type CheckableType, type ProgressStore } from "./progress";

/** An exercise as the student's own (RLS-scoped) client sees it. No key, no payload. */
export interface VisibleExercise {
  id: string;
  type: string;
  checkMode: "auto" | "review";
  /**
   * Lesson part of the exercise's block. null when the exercise has no block (test-only) or the
   * block is not readable by the student; such exercises are never attemptable here.
   */
  partId: string | null;
}

export interface AttemptStore extends ProgressStore {
  /** Role of the signed-in user (user-scoped client). null when there is no profile. */
  getRole(userId: string): Promise<string | null>;
  /** USER-scoped read: null unless RLS lets this student see the (published, own-course) exercise. */
  getVisibleExercise(exerciseId: string): Promise<VisibleExercise | null>;
  /** SERVICE read: is the exercise an item of ANY test? Test items are graded by the test flow only. */
  isTestItem(exerciseId: string): Promise<boolean>;
  /** SERVICE read of exercise_keys.answer. Never returned to clients. */
  getKey(exerciseId: string): Promise<unknown | null>;
  /** Earlier attempts of this student for the ref (itemId null = whole exercise). */
  countPriorAttempts(
    studentId: string,
    exerciseId: string,
    itemId: string | null,
  ): Promise<{ total: number; correct: number }>;
  insertAttempt(studentId: string, exerciseId: string, answer: unknown, isCorrect: boolean): Promise<void>;
  awardXp(
    studentId: string,
    amount: number,
    reason: "exercise_correct" | "part_completed",
    ref: string,
  ): Promise<boolean>;
}

export class AttemptError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 500,
    readonly code: string,
  ) {
    super(code);
  }
}

// ---------------------------------------------------------------------------------------------
// Input validation (before check(), which trusts shapes)
// ---------------------------------------------------------------------------------------------
const str = z.string().max(1000);
const itemIdStr = z.string().max(64);
export const answerSchemas: Record<CheckableType, z.ZodType<AnswerMap[CheckableType]>> = {
  classify: z.object({ itemId: itemIdStr, bucketId: str }).strict(),
  fill_blank: z.object({ itemId: itemIdStr, value: str }).strict(),
  conjugate: z.object({ forms: z.array(str).length(6) }).strict(),
  choose: z.object({ itemId: itemIdStr, index: z.number().int().min(0).max(1000) }).strict(),
  match: z.object({ pairs: z.array(z.tuple([str, str])).max(50) }).strict(),
};

const keySchemas: Record<CheckableType, z.ZodTypeAny> = {
  classify: z.record(z.string()),
  fill_blank: z.record(z.array(z.string())),
  conjugate: z.object({ forms: z.array(z.string()) }),
  choose: z.record(z.number()),
  match: z.record(z.string()),
};

export const bodySchema = z.object({ exerciseId: z.string().uuid(), answer: z.unknown() }).strict();

export interface AttemptResult {
  correct: boolean;
  /** Only present when the answer was wrong. */
  expected?: unknown;
  perItem?: boolean[];
  /** Total XP granted by this request (exercise + part completion). */
  xpAwarded: number;
  /** True only when THIS request completed the part. */
  partCompleted?: boolean;
}

const PER_ITEM_TYPES = new Set<string>(["classify", "fill_blank", "choose"]);

/**
 * XP rule (ref = exerciseId for whole-exercise types, exerciseId:itemId for per-item types):
 *  - a correct attempt on a ref with NO earlier attempt offers EXERCISE_FIRST (10);
 *  - a correct attempt on a ref with any earlier attempt offers EXERCISE_RETRY (5);
 *  - award_xp is ALWAYS called on a correct answer. The ledger is unique per (student, reason, ref),
 *    so a ref pays out once whatever we offer; a later correct attempt on an already-paid ref
 *    yields 0 because award_xp reports "not granted". This also self-heals: if an attempt row was
 *    stored but award_xp failed, the next correct attempt still pays (nothing is skipped based on
 *    attempt history). xpAwarded reflects what the ledger really granted, so concurrent
 *    double-submits cannot double-pay.
 */
export function xpForCorrect(prior: { total: number }): number {
  return prior.total === 0 ? EXERCISE_FIRST : EXERCISE_RETRY;
}

/** Optional side effects of submitAttempt; failures are logged and never fail the attempt. */
export interface AttemptDeps {
  store: AttemptStore;
  /** Called after award_xp for a correct attempt on an exercise that sits in a lesson part. */
  onCorrect?: (info: { studentId: string; partId: string; exerciseId: string }) => Promise<void>;
}

export async function submitAttempt(
  deps: AttemptDeps,
  input: { studentId: string; exerciseId: string; answer: unknown },
): Promise<AttemptResult> {
  const { store } = deps;
  const { studentId, exerciseId } = input;

  // 1. User-scoped read: RLS decides visibility. Unknown / unpublished / foreign course -> 404.
  const exercise = await store.getVisibleExercise(exerciseId);
  if (!exercise || exercise.partId === null) throw new AttemptError(404, "not_found");
  // Items of a test (even one that also sits in a published block) are graded by the test flow only:
  // checking them here would leak `expected` and pay exercise XP. Same indistinguishable 404.
  if (await store.isTestItem(exerciseId)) throw new AttemptError(404, "not_found");
  if (exercise.checkMode !== "auto" || !isCheckableType(exercise.type)) {
    throw new AttemptError(400, "not_checkable");
  }
  const type: CheckableType = exercise.type;

  // 2. Validate the answer shape for this type BEFORE check().
  const parsed = answerSchemas[type].safeParse(input.answer);
  if (!parsed.success) throw new AttemptError(400, "invalid_answer");
  const answer = parsed.data;

  // 3. Key via the service client (only after visibility was proven).
  const rawKey = await store.getKey(exerciseId);
  const keyParsed = keySchemas[type].safeParse(rawKey);
  if (!keyParsed.success) throw new AttemptError(500, "invalid_key");

  const result = check(type as ExerciseType, keyParsed.data as KeyMap[ExerciseType], answer as never);

  const itemId = PER_ITEM_TYPES.has(type) ? (answer as { itemId: string }).itemId : null;
  // An itemId that is not part of the key is rejected BEFORE anything is stored.
  if (itemId !== null && !Object.prototype.hasOwnProperty.call(keyParsed.data, itemId)) {
    throw new AttemptError(400, "invalid_answer");
  }
  const ref = itemId === null ? exerciseId : `${exerciseId}:${itemId}`;

  // Prior attempts are counted BEFORE inserting this one.
  const prior = await store.countPriorAttempts(studentId, exerciseId, itemId);
  await store.insertAttempt(studentId, exerciseId, answer, result.correct);
  if (exercise.partId) await store.ensurePartStarted(studentId, exercise.partId);

  let xpAwarded = 0;
  let partCompleted: boolean | undefined;
  if (result.correct) {
    const amount = xpForCorrect(prior);
    if (await store.awardXp(studentId, amount, "exercise_correct", ref)) xpAwarded += amount;
    if (exercise.partId && deps.onCorrect) {
      try {
        // Daily-task glue (grammar task). Best effort: never fails the attempt, logs no PII.
        await deps.onCorrect({ studentId, partId: exercise.partId, exerciseId });
      } catch (e) {
        console.error("attempts: onCorrect hook failed", e instanceof Error ? e.name : "unknown");
      }
    }
    if (exercise.partId) {
      const part = await completePart(store, studentId, exercise.partId);
      xpAwarded += part.xpAwarded;
      if (part.newlyCompleted) partCompleted = true;
    }
  }

  const out: AttemptResult = { correct: result.correct, xpAwarded };
  if (!result.correct) {
    // The key is revealed ONLY for wrong answers (teaching feedback), never for correct ones.
    if (result.expected !== undefined) out.expected = result.expected;
  }
  if (result.perItem) out.perItem = result.perItem;
  if (partCompleted) out.partCompleted = true;
  return out;
}

/** Transport-independent request handler; the route is a thin adapter around it. */
export async function handleAttemptRequest(
  deps: AttemptDeps,
  req: { userId: string | null; body: unknown },
): Promise<{ status: number; json: Record<string, unknown> }> {
  if (!req.userId) return { status: 401, json: { error: "unauthenticated" } };
  try {
    const role = await deps.store.getRole(req.userId);
    if (role !== "student") return { status: 403, json: { error: "forbidden" } };
    const body = bodySchema.safeParse(req.body);
    if (!body.success) return { status: 400, json: { error: "invalid_request" } };
    const result = await submitAttempt(deps, {
      studentId: req.userId,
      exerciseId: body.data.exerciseId,
      answer: body.data.answer,
    });
    return { status: 200, json: { ...result } };
  } catch (e) {
    if (e instanceof AttemptError) {
      if (e.status === 500) console.error("attempts: failed", e.code);
      return { status: e.status, json: { error: e.code } };
    }
    // Log only the error class: messages may carry user data or answers.
    console.error("attempts: internal error", e instanceof Error ? e.name : "unknown");
    return { status: 500, json: { error: "internal_error" } };
  }
}

export const MAX_BODY_BYTES = 16 * 1024;

/** Reads a JSON request body with a hard size cap. 413 when too large, 400 when not valid JSON. */
export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, status: 413 };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false, status: 413 };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}
