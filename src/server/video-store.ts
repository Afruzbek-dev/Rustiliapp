import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findActiveEnrollment } from "./audio-store";
import { createSupabaseAttemptStore } from "./attempts-store";
import type { CreateVideoResult, VideoExercise, VideoStore } from "./video-submissions";

/** Service-role backed store for the bot's video flow (the bot has no user session). */
export function createSupabaseVideoStore(service: SupabaseClient): VideoStore {
  // The progress methods only use the service client; the user client is never touched here.
  const progress = createSupabaseAttemptStore(service, service);
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
    addLessonCards: progress.addLessonCards,
    isTestItem: progress.isTestItem,
    getActiveEnrollment: (studentId, courseId) => findActiveEnrollment(service, studentId, courseId),

    async getProfileByTelegramId(telegramId) {
      const { data, error } = await service.from("profiles").select("id").eq("telegram_id", telegramId).maybeSingle();
      fail("getProfileByTelegramId", error);
      return data ? { id: data.id as string } : null;
    },

    async getExercise(exerciseId): Promise<VideoExercise | null> {
      const { data, error } = await service
        .from("exercises")
        .select("id, type, check_mode, course_id, blocks(lesson_part_id, published)")
        .eq("id", exerciseId)
        .maybeSingle();
      fail("getExercise", error);
      if (!data) return null;
      type B = { lesson_part_id: string; published: boolean };
      const blocks = data.blocks as B | B[] | null;
      const block = Array.isArray(blocks) ? blocks[0] : blocks;
      return {
        id: data.id as string,
        type: data.type as string,
        checkMode: data.check_mode as "auto" | "review",
        courseId: data.course_id as string,
        partId: block && block.published ? block.lesson_part_id : null,
      };
    },

    async upsertSession(telegramId, exerciseId, expiresAt) {
      const { error } = await service
        .from("bot_sessions")
        .upsert(
          { telegram_id: telegramId, exercise_id: exerciseId, expires_at: expiresAt.toISOString(), created_at: new Date().toISOString() },
          { onConflict: "telegram_id" },
        );
      fail("upsertSession", error);
    },

    async getLiveSession(telegramId, now) {
      const { data, error } = await service
        .from("bot_sessions")
        .select("exercise_id")
        .eq("telegram_id", telegramId)
        .gt("expires_at", now.toISOString())
        .maybeSingle();
      fail("getLiveSession", error);
      return data ? { exerciseId: data.exercise_id as string } : null;
    },

    async deleteSession(telegramId) {
      const { error } = await service.from("bot_sessions").delete().eq("telegram_id", telegramId);
      fail("deleteSession", error);
    },

    async deleteExpiredSessions(beforeIso, telegramId) {
      let q = service.from("bot_sessions").delete().lt("expires_at", beforeIso);
      if (telegramId !== undefined) q = q.eq("telegram_id", telegramId);
      const { error } = await q;
      fail("deleteExpiredSessions", error);
    },

    async findVideoByUnique(fileUniqueId) {
      const { data, error } = await service
        .from("submissions")
        .select("id, student_id, exercise_id, notified_at")
        .eq("kind", "video")
        .eq("tg_file_unique_id", fileUniqueId)
        .maybeSingle();
      fail("findVideoByUnique", error);
      return data
        ? {
            id: data.id as string,
            studentId: data.student_id as string,
            exerciseId: data.exercise_id as string,
            notifiedAt: (data.notified_at as string | null) ?? null,
          }
        : null;
    },

    async countRecentVideos(studentId, exerciseId, sinceIso) {
      const { count, error } = await service
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId)
        .eq("exercise_id", exerciseId)
        .eq("kind", "video")
        .gt("created_at", sinceIso);
      fail("countRecentVideos", error);
      return count ?? 0;
    },

    async listStaleVideos(olderThanIso, limit) {
      const { data, error } = await service
        .from("submissions")
        .select("id, student_id, exercise_id")
        .eq("kind", "video")
        .not("tg_file_id", "is", null)
        .is("notified_at", null)
        .lt("created_at", olderThanIso)
        .order("created_at", { ascending: true })
        .limit(limit);
      fail("listStaleVideos", error);
      return (data ?? []).map((r) => ({ id: r.id as string, studentId: r.student_id as string, exerciseId: r.exercise_id as string }));
    },

    async createVideoSubmission(row): Promise<CreateVideoResult> {
      const { data, error } = await service.rpc("create_video_submission", {
        p_student: row.studentId,
        p_exercise: row.exerciseId,
        p_group: row.curatorGroupId,
        p_file_id: row.fileId,
        p_file_unique_id: row.fileUniqueId,
        p_archive_message_id: row.archiveMessageId,
      });
      fail("createVideoSubmission", error);
      const r = (Array.isArray(data) ? data[0] : data) as { submission_id: string | null; outcome: string } | null;
      if (r && (r.outcome === "ok" || r.outcome === "duplicate") && r.submission_id) {
        return { outcome: r.outcome, submissionId: r.submission_id };
      }
      if (r && (r.outcome === "rate_limited" || r.outcome === "duplicate_other")) return { outcome: r.outcome };
      throw new Error("createVideoSubmission: unexpected result");
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

    async claimNotification(submissionId, studentId) {
      const { data, error } = await service.rpc("claim_submission_notification", { p_id: submissionId, p_student: studentId });
      fail("claimNotification", error);
      return typeof data === "string" ? data : null;
    },

    async releaseNotification(submissionId, token) {
      const { error } = await service.rpc("release_submission_notification", { p_id: submissionId, p_token: token });
      fail("releaseNotification", error);
    },

    async markNotified(submissionId) {
      const { error } = await service
        .from("submissions")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", submissionId)
        .is("notified_at", null);
      fail("markNotified", error);
    },
  };
}
