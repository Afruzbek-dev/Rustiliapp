import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bumpDailyTaskOnce } from "./daily-tasks";

export interface CorrectAttemptInfo {
  studentId: string;
  partId: string;
  exerciseId: string;
}

/**
 * Hook for submitAttempt: a correct attempt on an exercise of a 'grammar' part counts towards the
 * daily 'grammar' task (once per Tashkent day). `service` is the service-role client.
 */
export function createGrammarTaskHook(service: SupabaseClient) {
  return async function bumpGrammar(info: CorrectAttemptInfo): Promise<void> {
    const { data, error } = await service.from("lesson_parts").select("kind").eq("id", info.partId).maybeSingle();
    if (error) throw new Error(`grammar task: part kind: ${error.message}`);
    if (data?.kind !== "grammar") return;
    await bumpDailyTaskOnce(service, info.studentId, "grammar");
  };
}
