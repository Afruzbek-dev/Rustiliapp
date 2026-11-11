import { describe, expect, it } from "vitest";
import {
  gradeExercise,
  gradeTest,
  parseKey,
  parseTestAnswer,
  recommend,
  sectionBreakdown,
  type GradeItem,
} from "@/lib/tests/grade";
import { checkTestForPublish } from "@/lib/tests/publish-check";
import { reviewLines } from "@/lib/tests/review";
import { testXp } from "@/lib/gamification/xp";

const classifyKey = { a1: "bx", b2: "by", c3: "bx" };
const forms = ["пишу", "пишешь", "пишет", "пишем", "пишете", "пишут"];

describe("gradeExercise (units through check())", () => {
  it("classify: partial credit per item, missing items count as wrong", () => {
    const r = gradeExercise("classify", classifyKey, { answers: { a1: "bx", b2: "bx" } });
    expect(r).toEqual({ correct: 1, total: 3, units: { a1: true, b2: false, c3: false } });
  });

  it("fill_blank accepts alternatives and normalised input", () => {
    const key = { q1: ["Москва", "москва"], q2: ["дом"] };
    const r = gradeExercise("fill_blank", key, { answers: { q1: "  МОСКВА ", q2: "дым" } });
    expect(r.units).toEqual({ q1: true, q2: false });
  });

  it("choose compares the option index", () => {
    expect(gradeExercise("choose", { q: 2 }, { answers: { q: 2 } }).correct).toBe(1);
    expect(gradeExercise("choose", { q: 2 }, { answers: { q: 1 } }).correct).toBe(0);
  });

  it("conjugate scores the six forms separately", () => {
    const r = gradeExercise("conjugate", { forms }, { forms: [...forms.slice(0, 4), "", "x"] });
    expect(r.total).toBe(6);
    expect(r.correct).toBe(4);
    expect(r.units.f4).toBe(false);
  });

  it("match scores each pair", () => {
    const key = { l1: "r9", l2: "r8" };
    const r = gradeExercise("match", key, { pairs: [["l1", "r9"], ["l2", "r9"]] });
    expect(r).toEqual({ correct: 1, total: 2, units: { l1: true, l2: false } });
  });

  it("a missing or malformed answer scores zero but keeps the total", () => {
    expect(gradeExercise("classify", classifyKey, undefined)).toMatchObject({ correct: 0, total: 3 });
    expect(gradeExercise("classify", classifyKey, { answers: "nope" })).toMatchObject({ correct: 0, total: 3 });
    expect(gradeExercise("match", { l1: "r1" }, { pairs: "x" })).toMatchObject({ correct: 0, total: 1 });
  });
});

describe("answer / key parsing", () => {
  it("rejects wrong shapes and extra fields", () => {
    expect(parseTestAnswer("classify", { answers: { a: "b" } })).not.toBeNull();
    expect(parseTestAnswer("classify", { answers: { a: 1 } })).toBeNull();
    expect(parseTestAnswer("classify", { answers: {}, extra: 1 })).toBeNull();
    expect(parseTestAnswer("conjugate", { forms: Array(7).fill("x") })).toBeNull();
    expect(parseTestAnswer("speaking", {})).toBeNull();
    expect(parseTestAnswer("choose", { answers: { q: -1 } })).toBeNull();
  });
  it("parseKey validates shapes", () => {
    expect(parseKey("conjugate", { forms })).toEqual({ forms });
    expect(parseKey("classify", { a: 1 })).toBeNull();
    expect(parseKey("open_text", {})).toBeNull();
  });
});

const item = (over: Partial<GradeItem> & Pick<GradeItem, "exerciseId">): GradeItem => ({
  section: "grammar",
  lessonId: null,
  type: "classify",
  key: classifyKey,
  answer: undefined,
  ...over,
});

describe("gradeTest", () => {
  const items: GradeItem[] = [
    item({ exerciseId: "e1", section: "vocab", lessonId: "L1", answer: { answers: { a1: "bx", b2: "by", c3: "bx" } } }),
    item({ exerciseId: "e2", section: "grammar", lessonId: "L2", answer: { answers: { a1: "by" } } }),
    item({ exerciseId: "e3", section: "grammar", lessonId: "L3", type: "choose", key: { q: 0 }, answer: { answers: { q: 0 } } }),
  ];

  it("computes score, sections, pass / fail", () => {
    const g = gradeTest(items, 60);
    expect(g.correct).toBe(4);
    expect(g.total).toBe(7);
    expect(g.score).toBe(57.14);
    expect(g.passed).toBe(false);
    expect(g.sectionScores).toEqual({ vocab: 100, grammar: 25 });
    expect(gradeTest(items, 57).passed).toBe(true);
  });

  it("pays testXp(score) = score % x 2", () => {
    expect(testXp(gradeTest(items, 50).score)).toBe(114);
  });

  it("breakdown follows the section order and skips empty sections", () => {
    const g = gradeTest(items, 50);
    expect(sectionBreakdown(items, g.itemResults).map((s) => [s.section, s.correct, s.total, s.percent])).toEqual([
      ["vocab", 3, 3, 100],
      ["grammar", 1, 4, 25],
    ]);
  });
});

describe("recommendations", () => {
  const items = [
    { exerciseId: "e1", section: "vocab" as const, lessonId: "L3" },
    { exerciseId: "e2", section: "vocab" as const, lessonId: "L1" },
    { exerciseId: "e3", section: "vocab" as const, lessonId: "L1" },
    { exerciseId: "e4", section: "grammar" as const, lessonId: "L2" },
    { exerciseId: "e5", section: "reading" as const, lessonId: null },
  ];
  const results = {
    e1: { correct: 0, total: 2 },
    e2: { correct: 0, total: 1 },
    e3: { correct: 1, total: 1 },
    e4: { correct: 3, total: 3 },
    e5: { correct: 0, total: 2 },
  };
  const order = new Map([["L1", 1], ["L2", 2], ["L3", 3]]);

  it("flags sections under 50% and points at the lessons of the wrong items, in course order", () => {
    const rec = recommend(items, results, order);
    expect(rec.map((r) => r.section)).toEqual(["vocab", "reading"]);
    expect(rec[0].lessonIds).toEqual(["L1", "L3"]);
    expect(rec[1].lessonIds).toEqual([]);
  });

  it("a section exactly at 50% is not weak", () => {
    expect(recommend([{ exerciseId: "x", section: "vocab", lessonId: "L1" }], { x: { correct: 1, total: 2 } }, order)).toEqual([]);
  });
});

describe("reviewLines", () => {
  const payload = {
    items: [{ id: "a1", text: "книга" }, { id: "b2", text: "стол" }],
    buckets: [{ id: "bx", label: "ж.р" }, { id: "by", label: "м.р" }],
  };
  it("hides the expected answers when key is null", () => {
    const lines = reviewLines("classify", payload, null, { answers: { a1: "by" } }, { a1: false, b2: false });
    expect(lines[0]).toEqual({ question: "книга", yours: "м.р", expected: null, ok: false });
    expect(lines[1].yours).toBe("Javob berilmagan");
  });
  it("shows them when revealed", () => {
    const lines = reviewLines("classify", payload, { a1: "bx", b2: "by" }, { answers: { a1: "by", b2: "by" } }, { a1: false, b2: true });
    expect(lines.map((l) => [l.expected, l.ok])).toEqual([["ж.р", false], ["м.р", true]]);
  });
  it("describes choose, fill_blank, conjugate and match", () => {
    expect(reviewLines("choose", { items: [{ id: "q", text: "?", options: ["a", "b"] }] }, { q: 1 }, { answers: { q: 0 } }, { q: false })[0]).toMatchObject({ yours: "a", expected: "b" });
    expect(reviewLines("fill_blank", { items: [{ id: "q", before: "Я", after: "." }] }, { q: ["x", "y"] }, { answers: {} }, { q: false })[0]).toMatchObject({ yours: "Javob berilmagan", expected: "x / y" });
    expect(reviewLines("conjugate", { verb: "писать" }, { forms }, { forms: ["пишу"] }, { f0: true })).toHaveLength(6);
    expect(
      reviewLines("match", { left: [{ id: "l1", text: "L" }], right: [{ id: "r1", text: "R" }] }, { l1: "r1" }, { pairs: [["l1", "r1"]] }, { l1: true })[0],
    ).toMatchObject({ yours: "R", expected: "R", ok: true });
  });
});

describe("checkTestForPublish", () => {
  const good = {
    type: "classify",
    prompt: "Guruhlang",
    blockId: null,
    payload: { items: [{ id: "it_a1", text: "книга" }], buckets: [{ id: "bk_z9", label: "ж.р" }, { id: "bk_y8", label: "м.р" }] },
    key: { it_a1: "bk_z9" },
  };
  const base = { moduleId: "M1", passScore: 60, timeLimitMin: 20 as number | null, items: [good] };

  it("accepts a complete test", () => {
    const r = checkTestForPublish(base);
    expect(r.errors).toEqual([]);
    expect(r.totalUnits).toBe(1);
    expect(r.warnings).toEqual([]);
  });

  it("requires module, reachable pass score and items", () => {
    expect(checkTestForPublish({ ...base, moduleId: null }).errors).toContain("Test modulga biriktirilmagan");
    expect(checkTestForPublish({ ...base, passScore: null }).errors).toContain("O'tish bali kiritilmagan");
    expect(checkTestForPublish({ ...base, passScore: 120 }).errors[0]).toMatch(/1 dan 100/);
    expect(checkTestForPublish({ ...base, passScore: 0 }).errors[0]).toMatch(/1 dan 100/);
    expect(checkTestForPublish({ ...base, items: [] }).errors).toContain("Testda mashqlar yo'q");
  });

  it("rejects incomplete keys, block exercises and non-gradable types", () => {
    expect(checkTestForPublish({ ...base, items: [{ ...good, key: {} }] }).errors[0]).toMatch(/^1-mashq/);
    expect(checkTestForPublish({ ...base, items: [{ ...good, key: null }] }).errors[0]).toMatch(/^1-mashq/);
    expect(checkTestForPublish({ ...base, items: [{ ...good, blockId: "B" }] }).errors[0]).toMatch(/darsdan olingan/);
    expect(checkTestForPublish({ ...base, items: [{ ...good, type: "speaking" }] }).errors[0]).toMatch(/avtomatik tekshirilmaydi/);
    expect(checkTestForPublish({ ...base, items: [{ ...good, prompt: " " }] }).errors[0]).toMatch(/topshiriq matni/);
  });

  it("warns about no time limit and a 100% pass score", () => {
    expect(checkTestForPublish({ ...base, timeLimitMin: null, passScore: 100 }).warnings).toHaveLength(2);
  });
});
