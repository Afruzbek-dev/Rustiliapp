import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AudioStore, SpeakingExercise } from "./audio-submissions";
import { createSupabaseAttemptStore } from "./attempts-store";

export const SUBMISSIONS_BUCKET = "submissions";

/** `user` is the user-scoped client (RLS); `service` does storage and the writes API roles cannot do. */
export function createSupabaseAudioStore(user: SupabaseClient, service: SupabaseClient): AudioStore {
  const progress = createSupabaseAttemptStore(user, service);
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };

  return {
    getPartExercises: progress.getPartExercises,
    getCorrectRefs: progress.getCorrectRefs,
    getSubmittedExerciseIds: progress.getSubmittedExerciseIds,
    ensurePartStarted: progress.ensurePartStarted,
    markPartCompleted: progress.markPartCompleted,
    awardXp: progress.awardXp,
    getRole: progress.getRole,
    isTestItem: progress.isTestItem,

    async getVisibleExercise(exerciseId): Promise<SpeakingExercise | null> {
      const { data, error } = await user
        .from("exercises")
        .select("id, type, check_mode, course_id, blocks(lesson_part_id)")
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
        courseId: data.course_id as string,
        partId: block?.lesson_part_id ?? null,
      };
    },

    async getActiveEnrollment(studentId, courseId) {
      const { data, error } = await service
        .from("enrollments")
        .select("curator_group_id, cohorts!inner(course_id)")
        .eq("student_id", studentId)
        .eq("status", "active")
        .eq("cohorts.course_id", courseId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .limit(1);
      fail("getActiveEnrollment", error);
      const row = (data ?? [])[0] as { curator_group_id: string | null } | undefined;
      return row ? { curatorGroupId: row.curator_group_id } : null;
    },

    async countAudioSince(studentId, exerciseId, sinceIso) {
      const { count, error } = await service
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId)
        .eq("exercise_id", exerciseId)
        .eq("kind", "audio")
        .gte("created_at", sinceIso);
      fail("countAudioSince", error);
      return count ?? 0;
    },

    async insertAudioSubmission(row) {
      const { error } = await service.from("submissions").insert({
        id: row.id,
        student_id: row.studentId,
        exercise_id: row.exerciseId,
        curator_group_id: row.curatorGroupId,
        kind: "audio",
        status: "pending",
        storage_path: null,
      });
      fail("insertAudioSubmission", error);
    },

    async createSignedUpload(path) {
      const { data, error } = await service.storage.from(SUBMISSIONS_BUCKET).createSignedUploadUrl(path);
      fail("createSignedUpload", error);
      return data ? { uploadUrl: data.signedUrl, token: data.token } : null;
    },

    async getSubmission(submissionId) {
      const { data, error } = await service
        .from("submissions")
        .select("id, student_id, exercise_id, kind, storage_path")
        .eq("id", submissionId)
        .maybeSingle();
      fail("getSubmission", error);
      if (!data) return null;
      return {
        id: data.id as string,
        studentId: data.student_id as string,
        exerciseId: data.exercise_id as string,
        kind: data.kind as string,
        storagePath: (data.storage_path as string | null) ?? null,
      };
    },

    async findObject(studentId, submissionId) {
      const { data, error } = await service.storage
        .from(SUBMISSIONS_BUCKET)
        .list(studentId, { limit: 10, search: submissionId });
      fail("findObject", error);
      const re = new RegExp(`^${submissionId}\\.(webm|mp4|ogg)$`);
      const hit = (data ?? []).find((o) => re.test(o.name));
      if (!hit) return null;
      const size = Number((hit.metadata as { size?: number } | null)?.size ?? 0);
      return { name: `${studentId}/${hit.name}`, size };
    },

    async markComplete(submissionId, studentId, path) {
      const { data, error } = await service
        .from("submissions")
        .update({ storage_path: path })
        .eq("id", submissionId)
        .eq("student_id", studentId)
        .is("storage_path", null)
        .select("id");
      fail("markComplete", error);
      return (data ?? []).length > 0;
    },

    async hasOtherCompletedSince(studentId, excludeId, sinceIso) {
      const { count, error } = await service
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId)
        .neq("id", excludeId)
        .gte("created_at", sinceIso)
        .or("kind.neq.audio,storage_path.not.is.null");
      fail("hasOtherCompletedSince", error);
      return (count ?? 0) > 0;
    },

    async getExercisePartId(exerciseId) {
      const { data, error } = await service
        .from("exercises")
        .select("blocks(lesson_part_id)")
        .eq("id", exerciseId)
        .maybeSingle();
      fail("getExercisePartId", error);
      const blocks = data?.blocks as { lesson_part_id: string } | { lesson_part_id: string }[] | null | undefined;
      const block = Array.isArray(blocks) ? blocks[0] : blocks;
      return block?.lesson_part_id ?? null;
    },
  };
}
