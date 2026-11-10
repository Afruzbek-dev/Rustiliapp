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
  /** Lesson part of the exercise's block (null for test-only exercises). */
  partId: string | null;
}

export interface AttemptStore extends ProgressStore {
  /** Role of the signed-in user (user-scoped client). null when there is no profile. */
  getRole(userId: string): Promise<string | null>;
  /** USER-scoped read: null unless RLS lets this student see the (published, own-course) exercise. */
  getVisibleExercise(exerciseId: string): Promise<VisibleExercise | null>;
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
export const answerSchemas: Record<CheckableType, z.ZodType<AnswerMap[CheckableType]>> = {
  classify: z.object({ itemId: str, bucketId: str }).strict(),
  fill_blank: z.object({ itemId: str, value: str }).strict(),
  conjugate: z.object({ forms: z.array(str).length(6) }).strict(),
  choose: z.object({ itemId: str, index: z.number().int().min(0).max(1000) }).strict(),
  match: z.object({ pairs: z.array(z.tuple([str, str])).max(100) }).strict(),
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
 *  - a correct attempt on a ref that already has a correct attempt pays 0 (ref already paid);
 *  - the first correct attempt on a ref with NO earlier attempt pays EXERCISE_FIRST (10);
 *  - the first correct attempt on a ref whose earlier attempts were all wrong pays EXERCISE_RETRY (5).
 * So a ref pays out at most once; award_xp is additionally idempotent per (student, reason, ref),
 * and xpAwarded reflects whether the ledger really granted it (concurrent requests can't double-pay).
 */
export function xpForCorrect(prior: { total: number; correct: number }): number {
  if (prior.correct > 0) return 0;
  return prior.total === 0 ? EXERCISE_FIRST : EXERCISE_RETRY;
}

export async function submitAttempt(
  deps: { store: AttemptStore },
  input: { studentId: string; exerciseId: string; answer: unknown },
): Promise<AttemptResult> {
  const { store } = deps;
  const { studentId, exerciseId } = input;

  // 1. User-scoped read: RLS decides visibility. Unknown / unpublished / foreign course -> 404.
  const exercise = await store.getVisibleExercise(exerciseId);
  if (!exercise) throw new AttemptError(404, "not_found");
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
  const ref = itemId === null ? exerciseId : `${exerciseId}:${itemId}`;

  // Prior attempts are counted BEFORE inserting this one.
  const prior = await store.countPriorAttempts(studentId, exerciseId, itemId);
  await store.insertAttempt(studentId, exerciseId, answer, result.correct);
  if (exercise.partId) await store.ensurePartStarted(studentId, exercise.partId);

  let xpAwarded = 0;
  let partCompleted: boolean | undefined;
  if (result.correct) {
    const amount = xpForCorrect(prior);
    if (amount > 0 && (await store.awardXp(studentId, amount, "exercise_correct", ref))) xpAwarded += amount;
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
  deps: { store: AttemptStore },
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
    if (e instanceof AttemptError) return { status: e.status, json: { error: e.code } };
    return { status: 500, json: { error: "internal_error" } };
  }
}
