import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExerciseResult, TestSection } from "@/lib/tests/grade";
import { getPathWith, supabasePathDb } from "@/server/path";
import {
  TestError,
  type AttemptRow,
  type FinishRow,
  type SaveOutcome,
  type StartOutcome,
  type TestInfo,
  type TestStore,
} from "./tests";

/**
 * Supabase-backed TestStore. `user` is the USER-scoped client (RLS decides what the student may see:
 * published tests of the active course, item payloads without keys); `service` is the service-role
 * client used for the attempt state (filtered by the verified student id), exercise_keys, and the
 * SQL functions that only the service role may execute.
 */
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

interface AttemptDb {
  id: string;
  test_id: string;
  started_at: string;
  deadline: string | null;
  finished_at: string | null;
  score: number | string | null;
  passed: boolean | null;
  correct_count: number | null;
  total_count: number | null;
  timed_out: boolean;
  item_results: Record<string, ExerciseResult> | null;
}
const ATTEMPT_COLUMNS = "id, test_id, started_at, deadline, finished_at, score, passed, correct_count, total_count, timed_out, item_results";

const toAttempt = (r: AttemptDb): AttemptRow & { testId: string } => ({
  id: r.id,
  testId: r.test_id,
  startedAt: r.started_at,
  deadline: r.deadline,
  finishedAt: r.finished_at,
  score: r.score === null ? null : Number(r.score),
  passed: r.passed,
  correct: r.correct_count,
  total: r.total_count,
  timedOut: r.timed_out,
  itemResults: r.item_results ?? {},
});

export function createSupabaseTestStore(user: SupabaseClient, service: SupabaseClient): TestStore {
  const fail = (what: string, error: { message: string; code?: string } | null) => {
    if (!error) return;
    // forbidden / unknown ids come back as 42501 from the SQL functions: the same 404 as a missing row
    if (error.code === "42501") throw new TestError("not_found");
    if (error.code === "22023") throw new TestError("invalid");
    throw new Error(`tests: ${what}: ${error.message}`);
  };

  return {
    async getTest(testId): Promise<TestInfo | null> {
      const { data, error } = await user
        .from("tests")
        .select("id, course_id, title, time_limit_min, pass_score, max_attempts, published")
        .eq("id", testId)
        .maybeSingle();
      fail("getTest", error);
      if (!data || data.published !== true) return null;
      return {
        id: data.id as string,
        courseId: data.course_id as string,
        title: data.title as string,
        timeLimitMin: (data.time_limit_min as number | null) ?? null,
        passScore: data.pass_score === null ? null : Number(data.pass_score),
        maxAttempts: data.max_attempts as number,
      };
    },

    async pathStatus(studentId, testId) {
      const path = await getPathWith(supabasePathDb(user as never), studentId);
      for (const m of path.modules) if (m.test?.id === testId) return m.test.status;
      return null;
    },

    async getItems(testId) {
      const { data, error } = await user
        .from("test_items")
        .select("exercise_id, section, position, lesson_id, exercises(type, prompt, payload)")
        .eq("test_id", testId)
        .order("position");
      fail("getItems", error);
      return ((data ?? []) as unknown as {
        exercise_id: string;
        section: TestSection;
        position: number;
        lesson_id: string | null;
        exercises: { type: string; prompt: string | null; payload: unknown } | { type: string; prompt: string | null; payload: unknown }[] | null;
      }[]).flatMap((r) => {
        const e = one(r.exercises);
        return e
          ? [{ exerciseId: r.exercise_id, section: r.section, position: r.position, lessonId: r.lesson_id, type: e.type, prompt: e.prompt, payload: e.payload }]
          : [];
      });
    },

    async listAttempts(studentId, testId) {
      const { data, error } = await service
        .from("test_attempts")
        .select(ATTEMPT_COLUMNS)
        .eq("student_id", studentId)
        .eq("test_id", testId)
        .order("started_at", { ascending: false })
        .limit(50);
      fail("listAttempts", error);
      return ((data ?? []) as unknown as AttemptDb[]).map(toAttempt);
    },

    async getAttempt(studentId, attemptId) {
      const { data, error } = await service
        .from("test_attempts")
        .select(ATTEMPT_COLUMNS)
        .eq("id", attemptId)
        .eq("student_id", studentId)
        .maybeSingle();
      fail("getAttempt", error);
      return data ? toAttempt(data as unknown as AttemptDb) : null;
    },

    async getAnswers(attemptId) {
      const { data, error } = await service.from("test_attempt_answers").select("exercise_id, answer").eq("attempt_id", attemptId).limit(1000);
      fail("getAnswers", error);
      return Object.fromEntries(((data ?? []) as { exercise_id: string; answer: unknown }[]).map((r) => [r.exercise_id, r.answer]));
    },

    async startAttempt(studentId, testId) {
      const { data, error } = await service.rpc("test_start_attempt", { p_student: studentId, p_test: testId });
      fail("startAttempt", error);
      const row = one(data as { outcome: StartOutcome; attempt_id: string | null }[] | null);
      if (!row) throw new Error("tests: startAttempt: empty result");
      return { outcome: row.outcome, attemptId: row.attempt_id };
    },

    async saveAnswer(studentId, attemptId, exerciseId, answer) {
      const { data, error } = await service.rpc("test_save_answer", {
        p_student: studentId,
        p_attempt: attemptId,
        p_exercise: exerciseId,
        p_answer: answer,
      });
      fail("saveAnswer", error);
      return data as SaveOutcome;
    },

    async getKeys(exerciseIds) {
      if (exerciseIds.length === 0) return {};
      const { data, error } = await service.from("exercise_keys").select("exercise_id, answer").in("exercise_id", exerciseIds).limit(1000);
      fail("getKeys", error);
      return Object.fromEntries(((data ?? []) as { exercise_id: string; answer: unknown }[]).map((r) => [r.exercise_id, r.answer]));
    },

    async finishAttempt(studentId, attemptId, grade): Promise<FinishRow> {
      const { data, error } = await service.rpc("test_finish_attempt", {
        p_student: studentId,
        p_attempt: attemptId,
        p_score: grade.score,
        p_correct: grade.correct,
        p_total: grade.total,
        p_section_scores: grade.sectionScores,
        p_item_results: grade.itemResults,
      });
      fail("finishAttempt", error);
      const row = one(data as { outcome: "finished" | "already"; score: number | string; passed: boolean; timed_out: boolean }[] | null);
      if (!row) throw new Error("tests: finishAttempt: empty result");
      return { outcome: row.outcome, score: Number(row.score), passed: row.passed, timedOut: row.timed_out };
    },

    async getLessons(lessonIds) {
      if (lessonIds.length === 0) return [];
      const { data, error } = await user
        .from("lessons")
        .select("id, title, position, modules(position)")
        .in("id", lessonIds);
      fail("getLessons", error);
      return ((data ?? []) as unknown as { id: string; title: string; position: number; modules: { position: number } | { position: number }[] | null }[]).map((l) => ({
        id: l.id,
        title: l.title,
        order: (one(l.modules)?.position ?? 0) * 10000 + l.position,
      }));
    },
  };
}
