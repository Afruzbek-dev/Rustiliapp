import { describe, expect, it, vi } from "vitest";
import { completePart, type ProgressStore } from "@/server/progress";
import { submitAttempt, type AttemptStore } from "@/server/attempts";

function store(exercises: Awaited<ReturnType<ProgressStore["getPartExercises"]>>): ProgressStore {
  return {
    getPartExercises: async () => exercises,
    getCorrectRefs: async () => [],
    getSubmittedExerciseIds: async () => [],
    ensurePartStarted: vi.fn(async () => undefined),
    markPartCompleted: vi.fn(async () => true),
    awardXp: vi.fn(async () => true),
  };
}

describe("completePart allowEmpty", () => {
  it("defaults to false: a part without required work does not complete", async () => {
    const s = store([]);
    expect(await completePart(s, "s", "p")).toEqual({ completed: false, newlyCompleted: false, xpAwarded: 0 });
    expect(s.markPartCompleted).not.toHaveBeenCalled();
    expect(s.awardXp).not.toHaveBeenCalled();
  });

  it("allowEmpty true completes it and pays once", async () => {
    const s = store([{ id: "a", type: "arrange", checkMode: "auto", key: null }]);
    expect(await completePart(s, "s", "p", { allowEmpty: true })).toEqual({ completed: true, newlyCompleted: true, xpAwarded: 20 });
    expect(s.ensurePartStarted).toHaveBeenCalled();
  });

  it("allowEmpty does not bypass a missing required item", async () => {
    const s = store([{ id: "c", type: "choose", checkMode: "auto", key: { a: 1 } }]);
    expect((await completePart(s, "s", "p", { allowEmpty: true })).completed).toBe(false);
  });
});

describe("submitAttempt does not wait for a slow onCorrect hook", () => {
  it("answers within the hook wait cap", async () => {
    vi.useFakeTimers();
    const st = {
      getVisibleExercise: async () => ({ id: "e1", type: "choose", checkMode: "auto", partId: "p1" }),
      isTestItem: async () => false,
      getKey: async () => ({ a: 1 }),
      countPriorAttempts: async () => ({ total: 0, correct: 0 }),
      insertAttempt: async () => undefined,
      ensurePartStarted: async () => undefined,
      awardXp: async () => true,
      getPartExercises: async () => [],
      getCorrectRefs: async () => [],
      getSubmittedExerciseIds: async () => [],
      markPartCompleted: async () => false,
    } as unknown as AttemptStore;
    const p = submitAttempt(
      { store: st, onCorrect: () => new Promise<void>(() => undefined) },
      { studentId: "s", exerciseId: "e1", answer: { itemId: "a", index: 1 } },
    );
    await vi.advanceTimersByTimeAsync(1600);
    expect((await p).correct).toBe(true);
    vi.useRealTimers();
  });
});
