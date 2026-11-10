import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttemptStore, VisibleExercise } from "./attempts";
import type { PartExercise } from "./progress";

/**
 * Supabase-backed AttemptStore. `user` is the USER-scoped client (RLS applies); `service` is the
 * service-role client, used only for exercise_keys and for writes the API roles cannot do.
 */
export function createSupabaseAttemptStore(user: SupabaseClient, service: SupabaseClient): AttemptStore {
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };

  return {
    async getRole(userId) {
      const { data, error } = await user.from("profiles").select("role").eq("id", userId).maybeSingle();
      fail("getRole", error);
      return (data?.role as string | undefined) ?? null;
    },

    async getVisibleExercise(exerciseId): Promise<VisibleExercise | null> {
      const { data, error } = await user
        .from("exercises")
        .select("id, type, check_mode, blocks(lesson_part_id)")
        .eq("id", exerciseId)
        .maybeSingle();
      fail("getVisibleExercise", error);
      if (!data) return null;
      const blocks = data.blocks as { lesson_part_id: string } | { lesson_part_id: string }[] | null;
      const block = Array.isArray(blocks) ? blocks[0] : blocks;
      return {
        id: data.id as string,
        type: data.type as string,
        checkMode: data.check_mode as "auto" | "review",
        partId: block?.lesson_part_id ?? null,
      };
    },

    async getKey(exerciseId) {
      const { data, error } = await service
        .from("exercise_keys")
        .select("answer")
        .eq("exercise_id", exerciseId)
        .maybeSingle();
      fail("getKey", error);
      return data ? data.answer : null;
    },

    async countPriorAttempts(studentId, exerciseId, itemId) {
      let q = service.from("attempts").select("is_correct").eq("student_id", studentId).eq("exercise_id", exerciseId);
      if (itemId !== null) q = q.eq("answer->>itemId", itemId);
      const { data, error } = await q;
      fail("countPriorAttempts", error);
      const rows = data ?? [];
      return { total: rows.length, correct: rows.filter((r) => r.is_correct).length };
    },

    async insertAttempt(studentId, exerciseId, answer, isCorrect) {
      const { error } = await service
        .from("attempts")
        .insert({ student_id: studentId, exercise_id: exerciseId, answer, is_correct: isCorrect });
      fail("insertAttempt", error);
    },

    async awardXp(studentId, amount, reason, ref) {
      const { data, error } = await service.rpc("award_xp", {
        p_student: studentId,
        p_amount: amount,
        p_reason: reason,
        p_ref: ref,
      });
      fail("awardXp", error);
      return data === true;
    },

    async getPartExercises(partId): Promise<PartExercise[]> {
      const { data, error } = await service
        .from("blocks")
        .select("exercises(id, type, check_mode, exercise_keys(answer))")
        .eq("lesson_part_id", partId)
        .eq("published", true);
      fail("getPartExercises", error);
      type Row = {
        id: string;
        type: string;
        check_mode: "auto" | "review";
        exercise_keys: { answer: unknown } | { answer: unknown }[] | null;
      };
      const out: PartExercise[] = [];
      for (const b of (data ?? []) as unknown as { exercises: Row[] }[]) {
        for (const e of b.exercises ?? []) {
          const k = Array.isArray(e.exercise_keys) ? e.exercise_keys[0] : e.exercise_keys;
          out.push({ id: e.id, type: e.type, checkMode: e.check_mode, key: k?.answer ?? null });
        }
      }
      return out;
    },

    async getCorrectRefs(studentId, exerciseIds) {
      if (exerciseIds.length === 0) return [];
      const { data, error } = await service
        .from("attempts")
        .select("exercise_id, answer")
        .eq("student_id", studentId)
        .eq("is_correct", true)
        .in("exercise_id", exerciseIds);
      fail("getCorrectRefs", error);
      return (data ?? []).map((r) => ({
        exerciseId: r.exercise_id as string,
        itemId: typeof (r.answer as { itemId?: unknown })?.itemId === "string" ? (r.answer as { itemId: string }).itemId : null,
      }));
    },

    async getSubmittedExerciseIds(studentId, exerciseIds) {
      if (exerciseIds.length === 0) return [];
      const { data, error } = await service
        .from("submissions")
        .select("exercise_id")
        .eq("student_id", studentId)
        .in("exercise_id", exerciseIds);
      fail("getSubmittedExerciseIds", error);
      return [...new Set((data ?? []).map((r) => r.exercise_id as string))];
    },

    async ensurePartStarted(studentId, partId) {
      const { error } = await service
        .from("part_progress")
        .upsert({ student_id: studentId, lesson_part_id: partId }, { onConflict: "student_id,lesson_part_id", ignoreDuplicates: true });
      fail("ensurePartStarted", error);
    },

    async markPartCompleted(studentId, partId) {
      const { data, error } = await service
        .from("part_progress")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("student_id", studentId)
        .eq("lesson_part_id", partId)
        .neq("status", "completed")
        .select("lesson_part_id");
      fail("markPartCompleted", error);
      return (data ?? []).length > 0;
    },
  };
}
