import { PART_COMPLETED } from "@/lib/gamification/xp";

/** Exercise types that `check()` can grade. `arrange` / `listen_pick` are NOT in MVP scope: they have
 * no checker, /api/attempts answers 400 not_checkable for them, and completePart ignores them (they
 * would otherwise block completion forever). The lesson editor (Task 26) must not offer these types. */
export const CHECKABLE_TYPES = ["classify", "fill_blank", "conjugate", "choose", "match"] as const;
export type CheckableType = (typeof CHECKABLE_TYPES)[number];

export function isCheckableType(t: string): t is CheckableType {
  return (CHECKABLE_TYPES as readonly string[]).includes(t);
}

export interface PartExercise {
  id: string;
  type: string;
  checkMode: "auto" | "review";
  /** The answer key (server only) — used to know which items must be answered. */
  key: unknown;
}

/** Data access for part progress. Implemented with the service client in production. */
export interface ProgressStore {
  /** Exercises in the part's PUBLISHED blocks. */
  getPartExercises(partId: string): Promise<PartExercise[]>;
  /** Distinct correct refs (exerciseId, itemId|null) of the student in the part's published blocks. */
  getCorrectRefs(studentId: string, partId: string): Promise<{ exerciseId: string; itemId: string | null }[]>;
  /** Exercise ids (of those given) the student has at least one submission for. */
  getSubmittedExerciseIds(studentId: string, exerciseIds: string[]): Promise<string[]>;
  /** Insert part_progress(in_progress) if absent. */
  ensurePartStarted(studentId: string, partId: string): Promise<void>;
  /**
   * Give the student srs_cards for the words of the part's lesson they do not have yet
   * (idempotent, due now). Optional so existing stores keep compiling; the production store implements it.
   */
  addLessonCards?(studentId: string, partId: string): Promise<void>;
  /** Flip to completed; true only if THIS call changed it (it was not completed before). */
  markPartCompleted(studentId: string, partId: string): Promise<boolean>;
  /** award_xp(); true when XP was actually granted (idempotent per student/reason/ref). */
  awardXp(studentId: string, amount: number, reason: "part_completed", ref: string): Promise<boolean>;
}

const PER_ITEM_TYPES = new Set(["classify", "fill_blank", "choose"]);

/** Item ids that must each be answered correctly for a per-item exercise (its key's entries). */
function requiredItems(type: string, key: unknown): (string | null)[] {
  if (PER_ITEM_TYPES.has(type) && key && typeof key === "object" && !Array.isArray(key)) {
    return Object.keys(key as Record<string, unknown>);
  }
  return [null];
}

/**
 * Completes a part when:
 *  - every `auto` exercise (of a checkable type) in its published blocks has a correct attempt —
 *    for per-item types (classify/fill_blank/choose) EVERY item of the key needs a correct attempt;
 *  - every `review` exercise (speaking/open_text) has at least one submission (grading not required).
 * Then part_progress -> completed and award_xp(PART_COMPLETED, 'part_completed', partId).
 * Parts with review exercises complete from the submission flows (Tasks 20/21 call this right after
 * a submission is stored), because attempts alone never trigger it for them.
 * Idempotent: the XP ledger pays once per (student, reason, partId) and the status flips once.
 * Returns whether the part is complete and how much XP this call granted.
 */
export async function completePart(
  store: ProgressStore,
  studentId: string,
  partId: string,
): Promise<{ completed: boolean; newlyCompleted: boolean; xpAwarded: number }> {
  const exercises = await store.getPartExercises(partId);
  const auto = exercises.filter((e) => e.checkMode === "auto" && isCheckableType(e.type));
  const review = exercises.filter((e) => e.checkMode === "review");
  if (auto.length + review.length === 0) return { completed: false, newlyCompleted: false, xpAwarded: 0 };

  const correct = await store.getCorrectRefs(studentId, partId);
  const done = new Set(correct.map((c) => `${c.exerciseId}\u0000${c.itemId ?? ""}`));
  for (const e of auto) {
    for (const item of requiredItems(e.type, e.key)) {
      if (!done.has(`${e.id}\u0000${item ?? ""}`)) return { completed: false, newlyCompleted: false, xpAwarded: 0 };
    }
  }

  if (review.length > 0) {
    const submitted = new Set(
      await store.getSubmittedExerciseIds(
        studentId,
        review.map((e) => e.id),
      ),
    );
    if (review.some((e) => !submitted.has(e.id))) return { completed: false, newlyCompleted: false, xpAwarded: 0 };
  }

  await store.ensurePartStarted(studentId, partId);
  // Before the status flip: if this throws the part stays uncompleted and a retry redoes everything.
  await store.addLessonCards?.(studentId, partId);
  const newlyCompleted = await store.markPartCompleted(studentId, partId);
  const granted = await store.awardXp(studentId, PART_COMPLETED, "part_completed", partId);
  return { completed: true, newlyCompleted, xpAwarded: granted ? PART_COMPLETED : 0 };
}
