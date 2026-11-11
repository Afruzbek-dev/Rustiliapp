import { testXp } from "@/lib/gamification/xp";
import {
  gradeTest,
  isGradableType,
  parseKey,
  parseTestAnswer,
  recommend,
  sectionBreakdown,
  type ExerciseResult,
  type GradableType,
  type SectionBreakdown,
  type TestGrade,
  type TestSection,
} from "@/lib/tests/grade";
import { reviewLines, type ReviewLine } from "@/lib/tests/review";

/**
 * Student side of module tests. Rules:
 *  - the test is open only when the path says `available` (all lessons of the module completed) and the
 *    enrollment is active (the user-scoped reads and the SQL functions both enforce visibility);
 *  - answers are stored per exercise, graded ONLY here on the server when the attempt finishes (no
 *    per-item feedback, no keys to the client), finishing is idempotent (SQL), the time limit and the
 *    retake limit live in SQL, an attempt past its deadline is graded from what was saved;
 *  - the result and the per-item review exist only after the attempt is finished; correct answers are
 *    shown only when the student passed or has no attempts left.
 */

export interface TestInfo {
  id: string;
  courseId: string;
  title: string;
  timeLimitMin: number | null;
  passScore: number | null;
  maxAttempts: number;
}

export interface TestItemRow {
  exerciseId: string;
  section: TestSection;
  position: number;
  lessonId: string | null;
  type: string;
  prompt: string | null;
  payload: unknown;
}

export interface AttemptRow {
  id: string;
  startedAt: string;
  deadline: string | null;
  finishedAt: string | null;
  score: number | null;
  passed: boolean | null;
  correct: number | null;
  total: number | null;
  timedOut: boolean;
  itemResults: Record<string, ExerciseResult>;
}

export type StartOutcome = "started" | "resumed" | "expired" | "limit" | "passed" | "no_items";
export type SaveOutcome = "ok" | "finished" | "expired";

export interface FinishRow {
  outcome: "finished" | "already";
  score: number;
  passed: boolean;
  timedOut: boolean;
}

/** Narrow data port. Production adapter: src/server/tests-store.ts; unit tests use an in-memory fake. */
export interface TestStore {
  /** USER-scoped (RLS): null unless the test is published and in the student's active course. */
  getTest(testId: string): Promise<TestInfo | null>;
  /** Path status of the module test (same rule as /path); null when the test is not on the student's path. */
  pathStatus(studentId: string, testId: string): Promise<"locked" | "available" | "completed" | null>;
  /** USER-scoped (RLS): items with the payload students may see (never keys). Ordered by position. */
  getItems(testId: string): Promise<TestItemRow[]>;
  /** The student's attempts at the test, newest first. */
  listAttempts(studentId: string, testId: string): Promise<AttemptRow[]>;
  getAttempt(studentId: string, attemptId: string): Promise<(AttemptRow & { testId: string }) | null>;
  getAnswers(attemptId: string): Promise<Record<string, unknown>>;
  startAttempt(studentId: string, testId: string): Promise<{ outcome: StartOutcome; attemptId: string | null }>;
  saveAnswer(studentId: string, attemptId: string, exerciseId: string, answer: unknown): Promise<SaveOutcome>;
  /** SERVICE read of exercise_keys. */
  getKeys(exerciseIds: string[]): Promise<Record<string, unknown>>;
  finishAttempt(studentId: string, attemptId: string, grade: TestGrade): Promise<FinishRow>;
  /** Lesson titles/positions (course order) for the recommendation links. */
  getLessons(lessonIds: string[]): Promise<{ id: string; title: string; order: number }[]>;
}

export class TestError extends Error {
  constructor(readonly code: "not_found" | "locked" | "limit" | "passed" | "no_items" | "invalid" | "failed") {
    super(code);
  }
}

// ---- view models --------------------------------------------------------------------------------
export interface ClientItem {
  exerciseId: string;
  section: TestSection;
  type: GradableType;
  prompt: string | null;
  payload: unknown;
}

export interface ResultView {
  attemptId: string;
  score: number;
  passScore: number | null;
  passed: boolean;
  correct: number;
  total: number;
  wrong: number;
  timedOut: boolean;
  xp: number;
  sections: SectionBreakdown[];
  recommendations: { section: TestSection; label: string; percent: number; lessons: { id: string; title: string }[] }[];
  /** Per exercise review lines; `expected` is null while the answers are hidden. */
  review: { exerciseId: string; section: TestSection; prompt: string | null; lines: ReviewLine[] }[];
  answersRevealed: boolean;
  attemptsUsed: number;
  attemptsLeft: number;
  canRetake: boolean;
}

export type TestView =
  | { kind: "locked"; title: string }
  | { kind: "intro"; test: TestInfo; itemCount: number }
  | {
      kind: "active";
      test: TestInfo;
      attemptId: string;
      /** ms left at the moment of the response (server clock), null = no time limit */
      remainingMs: number | null;
      items: ClientItem[];
      answers: Record<string, unknown>;
    }
  | { kind: "result"; test: TestInfo; result: ResultView };

const toClientItems = (rows: TestItemRow[]): ClientItem[] =>
  rows.flatMap((r) =>
    isGradableType(r.type)
      ? [{ exerciseId: r.exerciseId, section: r.section, type: r.type, prompt: r.prompt, payload: r.payload }]
      : [],
  );

const expired = (a: { deadline: string | null }, now: Date) => a.deadline !== null && now.getTime() > Date.parse(a.deadline);

/** Grades the SAVED answers of an attempt and finishes it. Idempotent: a finished attempt is returned as stored. */
export async function gradeAndFinish(store: TestStore, studentId: string, test: TestInfo, attemptId: string): Promise<FinishRow> {
  const [items, answers] = await Promise.all([store.getItems(test.id), store.getAnswers(attemptId)]);
  const keys = await store.getKeys(items.map((i) => i.exerciseId));
  const gradeItems = items.flatMap((i) => {
    if (!isGradableType(i.type)) return [];
    const key = parseKey(i.type, keys[i.exerciseId]);
    if (key === null) throw new TestError("failed");
    return [{ exerciseId: i.exerciseId, section: i.section, lessonId: i.lessonId, type: i.type, key, answer: answers[i.exerciseId] }];
  });
  if (gradeItems.length === 0 || gradeItems.every((g) => Object.keys(g.key as object).length === 0)) throw new TestError("failed");
  const grade = gradeTest(gradeItems, test.passScore);
  if (grade.total === 0) throw new TestError("failed");
  return store.finishAttempt(studentId, attemptId, grade);
}

export async function buildResult(store: TestStore, test: TestInfo, attempts: AttemptRow[], attempt: AttemptRow): Promise<ResultView> {
  const finished = attempts.filter((a) => a.finishedAt !== null);
  const attemptsLeft = Math.max(0, test.maxAttempts - finished.length);
  const passed = attempt.passed === true;
  const revealed = passed || attemptsLeft === 0;
  const items = await store.getItems(test.id);
  const results = attempt.itemResults;

  const sections = sectionBreakdown(items, results);
  const weak = recommend(items, results, new Map());
  const lessonIds = [...new Set(weak.flatMap((w) => w.lessonIds))];
  const lessons = lessonIds.length > 0 ? await store.getLessons(lessonIds) : [];
  const order = new Map(lessons.map((l) => [l.id, l.order]));
  const recommendations = recommend(items, results, order).map((r) => ({
    section: r.section,
    label: r.label,
    percent: r.percent,
    lessons: r.lessonIds.flatMap((id) => {
      const l = lessons.find((x) => x.id === id);
      return l ? [{ id: l.id, title: l.title }] : [];
    }),
  }));

  let review: ResultView["review"] = [];
  if (items.length > 0) {
    const [answers, keys] = await Promise.all([
      store.getAnswers(attempt.id),
      revealed ? store.getKeys(items.map((i) => i.exerciseId)) : Promise.resolve({} as Record<string, unknown>),
    ]);
    review = items.flatMap((i) => {
      if (!isGradableType(i.type)) return [];
      const r = results[i.exerciseId];
      // wrong or unanswered items only: a right answer needs no review
      if (!r || r.correct >= r.total) return [];
      const key = revealed ? parseKey(i.type, keys[i.exerciseId]) : null;
      return [
        {
          exerciseId: i.exerciseId,
          section: i.section,
          prompt: i.prompt,
          lines: reviewLines(i.type, i.payload, key, answers[i.exerciseId], r.units),
        },
      ];
    });
  }

  const correct = attempt.correct ?? 0;
  const total = attempt.total ?? 0;
  const score = attempt.score ?? 0;
  return {
    attemptId: attempt.id,
    score,
    passScore: test.passScore,
    passed,
    correct,
    total,
    wrong: Math.max(0, total - correct),
    timedOut: attempt.timedOut,
    xp: passed ? testXp(score) : 0,
    sections,
    recommendations,
    review,
    answersRevealed: revealed,
    attemptsUsed: finished.length,
    attemptsLeft,
    canRetake: !passed && attemptsLeft > 0,
  };
}

/** What /test/[testId] shows. null = 404 (unknown, unpublished, or another course). */
export async function loadTestView(store: TestStore, studentId: string, testId: string, now: Date = new Date()): Promise<TestView | null> {
  const test = await store.getTest(testId);
  if (!test) return null;

  let attempts = await store.listAttempts(studentId, testId);
  const active = attempts.find((a) => a.finishedAt === null);
  if (active && expired(active, now)) {
    // time ran out while the student was away: the saved answers are graded now
    await gradeAndFinish(store, studentId, test, active.id);
    attempts = await store.listAttempts(studentId, testId);
  } else if (active) {
    const [items, answers] = await Promise.all([store.getItems(testId), store.getAnswers(active.id)]);
    return {
      kind: "active",
      test,
      attemptId: active.id,
      remainingMs: active.deadline === null ? null : Math.max(0, Date.parse(active.deadline) - now.getTime()),
      items: toClientItems(items),
      answers,
    };
  }

  const finished = attempts.filter((a) => a.finishedAt !== null);
  if (finished.length === 0) {
    if ((await store.pathStatus(studentId, testId)) !== "available") return { kind: "locked", title: test.title };
    const items = await store.getItems(testId);
    return { kind: "intro", test, itemCount: toClientItems(items).length };
  }
  return { kind: "result", test, result: await buildResult(store, test, attempts, finished[0]) };
}

/** Starts (or resumes) the attempt. Returns the attempt id. */
export async function startTest(store: TestStore, studentId: string, testId: string): Promise<{ attemptId: string }> {
  const test = await store.getTest(testId);
  if (!test) throw new TestError("not_found");
  const existing = (await store.listAttempts(studentId, testId)).some((a) => a.finishedAt === null);
  if (!existing && (await store.pathStatus(studentId, testId)) === "locked") throw new TestError("locked");

  let res = await store.startAttempt(studentId, testId);
  if (res.outcome === "expired" && res.attemptId) {
    await gradeAndFinish(store, studentId, test, res.attemptId);
    res = await store.startAttempt(studentId, testId);
  }
  switch (res.outcome) {
    case "started":
    case "resumed":
      if (res.attemptId) return { attemptId: res.attemptId };
      throw new TestError("failed");
    case "limit":
      throw new TestError("limit");
    case "passed":
      throw new TestError("passed");
    case "no_items":
      throw new TestError("no_items");
    default:
      // 'expired' again: another request finished it between our calls; the page reload shows the result
      throw new TestError("limit");
  }
}

export type SaveResult = "saved" | "finished" | "expired";

/** Stores one exercise answer. After the deadline the attempt is graded from what was saved. */
export async function saveTestAnswer(
  store: TestStore,
  studentId: string,
  input: { attemptId: string; exerciseId: string; answer: unknown },
): Promise<SaveResult> {
  const attempt = await store.getAttempt(studentId, input.attemptId);
  if (!attempt) throw new TestError("not_found");
  const items = await store.getItems(attempt.testId);
  const item = items.find((i) => i.exerciseId === input.exerciseId);
  if (!item) throw new TestError("invalid");
  const answer = parseTestAnswer(item.type, input.answer);
  if (!answer) throw new TestError("invalid");

  const outcome = await store.saveAnswer(studentId, input.attemptId, input.exerciseId, answer);
  if (outcome === "ok") return "saved";
  if (outcome === "expired") {
    const test = await store.getTest(attempt.testId);
    if (test) await gradeAndFinish(store, studentId, test, input.attemptId);
  }
  return outcome;
}

/**
 * Finishes the attempt. `answers` (exerciseId -> answer) is the client's final state: each one is stored
 * first (best effort; late ones are refused by the database), then the saved answers are graded.
 * Calling it again returns the stored result: no second grading, no second payout.
 */
export async function finishTest(
  store: TestStore,
  studentId: string,
  input: { attemptId: string; answers?: Record<string, unknown> },
): Promise<ResultView> {
  const attempt = await store.getAttempt(studentId, input.attemptId);
  if (!attempt) throw new TestError("not_found");
  const test = await store.getTest(attempt.testId);
  if (!test) throw new TestError("not_found");

  if (attempt.finishedAt === null) {
    const items = await store.getItems(attempt.testId);
    for (const [exerciseId, raw] of Object.entries(input.answers ?? {}).slice(0, 200)) {
      const item = items.find((i) => i.exerciseId === exerciseId);
      const answer = item ? parseTestAnswer(item.type, raw) : null;
      if (!answer) continue;
      const outcome = await store.saveAnswer(studentId, input.attemptId, exerciseId, answer);
      if (outcome !== "ok") break;
    }
    await gradeAndFinish(store, studentId, test, input.attemptId);
  }
  const attempts = await store.listAttempts(studentId, attempt.testId);
  const done = attempts.find((a) => a.id === input.attemptId);
  if (!done || done.finishedAt === null) throw new TestError("failed");
  return buildResult(store, test, attempts, done);
}
