import { beforeEach, describe, expect, it } from "vitest";
import { finishTest, loadTestView, saveTestAnswer, startTest, TestError } from "@/server/tests";
import { E1, E2, FakeTestStore, S1, S2, TEST, uid } from "./test-store-fake";

const GOOD1 = { answers: { a1: "bx", b2: "by" } };
const GOOD2 = { answers: { q: 0 } };

let store: FakeTestStore;
beforeEach(() => {
  store = new FakeTestStore();
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "no error";
  } catch (e) {
    return e instanceof TestError ? e.code : String(e);
  }
};

describe("loadTestView", () => {
  it("404 for an unknown or unpublished test", async () => {
    expect(await loadTestView(store, S1, uid(999))).toBeNull();
    store.published = false;
    expect(await loadTestView(store, S1, TEST)).toBeNull();
  });

  it("is locked until the module lessons are completed (path rule)", async () => {
    store.path = "locked";
    expect(await loadTestView(store, S1, TEST)).toEqual({ kind: "locked", title: "1-modul testi" });
    store.path = null;
    expect((await loadTestView(store, S1, TEST))?.kind).toBe("locked");
  });

  it("shows the intro when available", async () => {
    const v = await loadTestView(store, S1, TEST);
    expect(v).toMatchObject({ kind: "intro", itemCount: 2 });
  });

  it("an active attempt shows the questions without any key and the remaining time", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    await saveTestAnswer(store, S1, { attemptId, exerciseId: E1, answer: GOOD1 });
    store.clock = new Date(store.clock.getTime() + 5 * 60_000);
    const v = await loadTestView(store, S1, TEST, store.clock);
    expect(v).toMatchObject({ kind: "active", attemptId, remainingMs: 15 * 60_000, answers: { [E1]: GOOD1 } });
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/"(key|keys|expected|score|correct|passed)"/);
    expect(JSON.stringify((v as { items: unknown }).items)).not.toContain('"bx"]');
    expect(store.calls).not.toContain("keys");
  });
});

describe("startTest", () => {
  it("starts once and resumes the same attempt", async () => {
    const a = await startTest(store, S1, TEST);
    const b = await startTest(store, S1, TEST);
    expect(b.attemptId).toBe(a.attemptId);
    expect(store.attempts).toHaveLength(1);
  });

  it("refuses a locked test, an unknown test", async () => {
    store.path = "locked";
    expect(await code(startTest(store, S1, TEST))).toBe("locked");
    expect(await code(startTest(store, S1, uid(999)))).toBe("not_found");
  });

  it("a second attempt is refused once the limit is used", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    await finishTest(store, S1, { attemptId });
    expect(await code(startTest(store, S1, TEST))).toBe("limit");
  });

  it("a passed student cannot retake even with attempts left", async () => {
    store.test.maxAttempts = 3;
    const { attemptId } = await startTest(store, S1, TEST);
    await finishTest(store, S1, { attemptId, answers: { [E1]: GOOD1, [E2]: GOOD2 } });
    expect(await code(startTest(store, S1, TEST))).toBe("passed");
  });

  it("an attempt that ran out of time is graded first, then the limit applies", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    await saveTestAnswer(store, S1, { attemptId, exerciseId: E1, answer: { answers: { a1: "bx" } } });
    store.clock = new Date(store.clock.getTime() + 21 * 60_000);
    expect(await code(startTest(store, S1, TEST))).toBe("limit");
    const [a] = store.attempts;
    expect(a.finishedAt).not.toBeNull();
    expect(a.timedOut).toBe(true);
    expect(a.correct).toBe(1);
  });
});

describe("saveTestAnswer", () => {
  it("validates the answer against the item type and the item id", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    expect(await code(saveTestAnswer(store, S1, { attemptId, exerciseId: uid(777), answer: GOOD1 }))).toBe("invalid");
    expect(await code(saveTestAnswer(store, S1, { attemptId, exerciseId: E1, answer: { pairs: [] } }))).toBe("invalid");
    expect(await saveTestAnswer(store, S1, { attemptId, exerciseId: E1, answer: GOOD1 })).toBe("saved");
  });

  it("another student's attempt is not found", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    expect(await code(saveTestAnswer(store, S2, { attemptId, exerciseId: E1, answer: GOOD1 }))).toBe("not_found");
  });

  it("late answers are refused server-side and the attempt is auto-submitted from what was saved", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    await saveTestAnswer(store, S1, { attemptId, exerciseId: E1, answer: GOOD1 });
    store.clock = new Date(store.clock.getTime() + 20 * 60_000 + 14_000);
    expect(await saveTestAnswer(store, S1, { attemptId, exerciseId: E2, answer: GOOD2 })).toBe("saved");
    store.clock = new Date(store.clock.getTime() + 2_000);
    expect(await saveTestAnswer(store, S1, { attemptId, exerciseId: E2, answer: { answers: { q: 1 } } })).toBe("expired");
    const a = store.attempts[0];
    expect(a.finishedAt).not.toBeNull();
    expect(a.timedOut).toBe(true);
    expect(a.correct).toBe(3);
  });

  it("nothing is stored after the attempt is finished", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    await finishTest(store, S1, { attemptId });
    expect(await saveTestAnswer(store, S1, { attemptId, exerciseId: E1, answer: GOOD1 })).toBe("finished");
    expect(store.answers.get(attemptId)).toBeUndefined();
  });
});

describe("finishTest", () => {
  it("grades the saved answers on the server and returns the result", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    const r = await finishTest(store, S1, { attemptId, answers: { [E1]: GOOD1, [E2]: { answers: { q: 1 } } } });
    expect(r).toMatchObject({ correct: 2, total: 3, wrong: 1, score: 66.67, passed: true, xp: 133, canRetake: false, attemptsLeft: 0 });
    expect(r.sections.map((s) => [s.section, s.percent])).toEqual([["vocab", 100], ["grammar", 0]]);
  });

  it("is idempotent: a double submit stores and pays once", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    const first = await finishTest(store, S1, { attemptId, answers: { [E1]: GOOD1, [E2]: GOOD2 } });
    const again = await finishTest(store, S1, { attemptId, answers: { [E1]: { answers: {} } } });
    expect(again).toEqual(first);
    expect(store.calls.filter((c) => c === "finish")).toHaveLength(1);
    expect(store.xp.get(S1)).toBe(200);
    expect(store.answers.get(attemptId)![E1]).toEqual(GOOD1);
  });

  it("unanswered items score zero; invalid client answers are ignored", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    const r = await finishTest(store, S1, { attemptId, answers: { [E1]: { junk: true }, [uid(555)]: GOOD1 } });
    expect(r).toMatchObject({ correct: 0, passed: false, score: 0 });
  });

  it("a foreign attempt is not found", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    expect(await code(finishTest(store, S2, { attemptId }))).toBe("not_found");
  });

  it("recommends the lessons of the wrong items for sections under 50%", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    const r = await finishTest(store, S1, { attemptId, answers: { [E1]: GOOD1 } });
    expect(r.recommendations).toEqual([
      { section: "grammar", label: "Grammatika", percent: 0, lessons: [{ id: uid(32), title: "Урок 2" }] },
    ]);
    expect(r.recommendations.some((x) => x.section === "vocab")).toBe(false);
  });
});

describe("answers are revealed only after finishing, and only when allowed", () => {
  it("hides the correct answers while a retake is possible", async () => {
    store.test.maxAttempts = 2;
    const { attemptId } = await startTest(store, S1, TEST);
    const r = await finishTest(store, S1, { attemptId, answers: { [E1]: { answers: { a1: "by", b2: "by" } } } });
    expect(r.answersRevealed).toBe(false);
    expect(r.canRetake).toBe(true);
    expect(r.attemptsLeft).toBe(1);
    expect(r.review.length).toBe(2);
    expect(r.review.flatMap((x) => x.lines.map((l) => l.expected))).toEqual([null, null, null]);
    expect(JSON.stringify(r)).not.toContain("ж.р\"}],\"expected");
  });

  it("reveals them when no attempts are left, listing only wrong exercises", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    const r = await finishTest(store, S1, { attemptId, answers: { [E1]: GOOD1, [E2]: { answers: { q: 1 } } } });
    expect(r.answersRevealed).toBe(true);
    expect(r.review).toHaveLength(1);
    expect(r.review[0].lines[0]).toMatchObject({ question: "Я ... читать", yours: "умею", expected: "могу", ok: false });
  });

  it("the result view after a reload shows the stored result; retake leads to a fresh attempt", async () => {
    store.test.maxAttempts = 2;
    const { attemptId } = await startTest(store, S1, TEST);
    await finishTest(store, S1, { attemptId });
    const v = await loadTestView(store, S1, TEST, store.clock);
    expect(v).toMatchObject({ kind: "result", result: { attemptId, passed: false, canRetake: true } });
    const again = await startTest(store, S1, TEST);
    expect(again.attemptId).not.toBe(attemptId);
    expect((await loadTestView(store, S1, TEST, store.clock))?.kind).toBe("active");
  });

  it("opening the page after the time ran out shows the auto-graded result", async () => {
    const { attemptId } = await startTest(store, S1, TEST);
    await saveTestAnswer(store, S1, { attemptId, exerciseId: E1, answer: GOOD1 });
    store.clock = new Date(store.clock.getTime() + 25 * 60_000);
    const v = await loadTestView(store, S1, TEST, store.clock);
    expect(v).toMatchObject({ kind: "result", result: { timedOut: true, correct: 2, total: 3 } });
  });
});
