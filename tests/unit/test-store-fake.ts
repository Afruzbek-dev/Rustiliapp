import type { TestGrade } from "@/lib/tests/grade";
import type { AttemptRow, FinishRow, SaveOutcome, StartOutcome, TestInfo, TestItemRow, TestStore } from "@/server/tests";

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const S1 = uid(1);
export const S2 = uid(2);
export const TEST = uid(100);
export const E1 = uid(201);
export const E2 = uid(202);

const GRACE_MS = 15_000;

/**
 * In-memory TestStore that mirrors the SQL contract of migration 0018 (one active attempt, retake limit,
 * server-held deadline with grace, idempotent finish). Time comes from `clock`.
 */
export class FakeTestStore implements TestStore {
  clock = new Date("2026-11-11T10:00:00Z");
  test: TestInfo = { id: TEST, courseId: uid(9), title: "1-modul testi", timeLimitMin: 20, passScore: 60, maxAttempts: 1 };
  published = true;
  path: "locked" | "available" | "completed" | null = "available";
  items: TestItemRow[] = [
    {
      exerciseId: E1, section: "vocab", position: 1, lessonId: uid(31), type: "classify", prompt: "Rodni belgilang",
      payload: { items: [{ id: "a1", text: "книга" }, { id: "b2", text: "стол" }], buckets: [{ id: "bx", label: "ж.р" }, { id: "by", label: "м.р" }] },
    },
    {
      exerciseId: E2, section: "grammar", position: 2, lessonId: uid(32), type: "choose", prompt: "Tanlang",
      payload: { items: [{ id: "q", text: "Я ... читать", options: ["могу", "умею"] }] },
    },
  ];
  keys: Record<string, unknown> = { [E1]: { a1: "bx", b2: "by" }, [E2]: { q: 0 } };
  lessons = [
    { id: uid(31), title: "Урок 1", order: 10001 },
    { id: uid(32), title: "Урок 2", order: 10002 },
  ];
  attempts: (AttemptRow & { studentId: string; testId: string })[] = [];
  answers = new Map<string, Record<string, unknown>>();
  calls: string[] = [];
  xp = new Map<string, number>();
  private seq = 1000;

  now = () => this.clock.getTime();

  async getTest(testId: string) {
    return testId === TEST && this.published ? this.test : null;
  }
  async pathStatus() {
    return this.path;
  }
  async getItems() {
    return this.items;
  }
  async listAttempts(studentId: string, testId: string) {
    return this.attempts.filter((a) => a.studentId === studentId && a.testId === testId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async getAttempt(studentId: string, attemptId: string) {
    return this.attempts.find((a) => a.id === attemptId && a.studentId === studentId) ?? null;
  }
  async getAnswers(attemptId: string) {
    return { ...(this.answers.get(attemptId) ?? {}) };
  }
  async startAttempt(studentId: string, testId: string): Promise<{ outcome: StartOutcome; attemptId: string | null }> {
    this.calls.push("start");
    const mine = this.attempts.filter((a) => a.studentId === studentId && a.testId === testId);
    const active = mine.find((a) => a.finishedAt === null);
    if (active) return { outcome: active.deadline && this.now() > Date.parse(active.deadline) ? "expired" : "resumed", attemptId: active.id };
    if (mine.some((a) => a.passed)) return { outcome: "passed", attemptId: null };
    if (mine.length >= this.test.maxAttempts) return { outcome: "limit", attemptId: null };
    const id = uid(++this.seq);
    this.attempts.push({
      id, studentId, testId, startedAt: this.clock.toISOString(),
      deadline: this.test.timeLimitMin === null ? null : new Date(this.now() + this.test.timeLimitMin * 60_000).toISOString(),
      finishedAt: null, score: null, passed: null, correct: null, total: null, timedOut: false, itemResults: {},
    });
    return { outcome: "started", attemptId: id };
  }
  async saveAnswer(studentId: string, attemptId: string, exerciseId: string, answer: unknown): Promise<SaveOutcome> {
    this.calls.push(`save:${exerciseId}`);
    const a = await this.getAttempt(studentId, attemptId);
    if (!a) throw new Error("forbidden");
    if (a.finishedAt) return "finished";
    if (a.deadline && this.now() > Date.parse(a.deadline) + GRACE_MS) return "expired";
    this.answers.set(attemptId, { ...(this.answers.get(attemptId) ?? {}), [exerciseId]: answer });
    return "ok";
  }
  async getKeys(ids: string[]) {
    this.calls.push("keys");
    return Object.fromEntries(ids.map((i) => [i, this.keys[i]]));
  }
  async finishAttempt(studentId: string, attemptId: string, g: TestGrade): Promise<FinishRow> {
    this.calls.push("finish");
    const a = await this.getAttempt(studentId, attemptId);
    if (!a) throw new Error("forbidden");
    if (a.finishedAt) return { outcome: "already", score: a.score ?? 0, passed: a.passed === true, timedOut: a.timedOut };
    a.finishedAt = this.clock.toISOString();
    a.score = g.score;
    a.correct = g.correct;
    a.total = g.total;
    a.passed = g.passed;
    a.itemResults = g.itemResults;
    a.timedOut = a.deadline !== null && this.now() > Date.parse(a.deadline);
    if (g.passed) this.xp.set(studentId, this.xp.get(studentId) ?? Math.round(g.score * 2));
    return { outcome: "finished", score: g.score, passed: g.passed, timedOut: a.timedOut };
  }
  async getLessons(ids: string[]) {
    return this.lessons.filter((l) => ids.includes(l.id));
  }
}
