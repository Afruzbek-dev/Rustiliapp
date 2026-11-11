import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { bumpDailyTask } from "./daily-tasks";
import { notifyCuratorsOfSubmission } from "./notify-curators";
import { createSupabaseVideoStore } from "./video-store";
import { completeStaleVideoSubmissions } from "./video-submissions";

/**
 * Service-only entry point for a future cron (Task 31): completes video submissions that were stored
 * but never finished (stored, notified_at null, older than 2 minutes). Not scheduled yet.
 */
export async function runVideoSweeper(limit = 50): Promise<number> {
  const db = createServiceClient();
  return completeStaleVideoSubmissions(
    {
      store: createSupabaseVideoStore(db),
      bumpSpeaking: (studentId) => bumpDailyTask(db, studentId, "speaking"),
      notify: notifyCuratorsOfSubmission,
    },
    limit,
  );
}
