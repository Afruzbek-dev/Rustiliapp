import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tashkentDay } from "@/lib/gamification/day";

export type DailyTaskName = "words" | "grammar" | "audio" | "speaking";

/** Structural subset of a Supabase client; pass the service-role client. */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ error: { message: string } | null }>;
}

/**
 * Increment today's (Asia/Tashkent) counter for a daily task. The SQL function is
 * service_role-only, so call this with the service client, never the user client.
 * Counters are stored uncapped; the dashboard caps them at the target when reading.
 */
export async function bumpDailyTask(
  client: RpcClient,
  studentId: string,
  key: DailyTaskName,
  inc = 1,
): Promise<void> {
  if (!Number.isInteger(inc) || inc < 1) throw new Error("bumpDailyTask: inc must be a positive integer");
  const { error } = await client.rpc("bump_daily_task", { p_student: studentId, p_key: key, p_inc: inc });
  if (error) throw new Error(`bumpDailyTask failed: ${error.message}`);
}

/** Service client that can both read `daily_activity` and call `bump_daily_task`. */
export type DailyTaskClient = Pick<SupabaseClient, "from" | "rpc">;

/**
 * Bump a daily task at most once per Asia/Tashkent day (the counter is read first; the dashboard
 * caps counters at the target anyway, so a rare concurrent double bump is harmless).
 * Returns whether this call bumped. Pass the service client.
 */
export async function bumpDailyTaskOnce(
  client: DailyTaskClient,
  studentId: string,
  key: DailyTaskName,
  now: Date = new Date(),
): Promise<boolean> {
  const { data, error } = await client
    .from("daily_activity")
    .select("tasks")
    .eq("student_id", studentId)
    .eq("day", tashkentDay(now))
    .maybeSingle();
  if (error) throw new Error(`bumpDailyTaskOnce failed: ${error.message}`);
  const v = (data?.tasks as Record<string, unknown> | null | undefined)?.[key];
  if ((typeof v === "number" && v >= 1) || v === true) return false;
  await bumpDailyTask(client as unknown as RpcClient, studentId, key);
  return true;
}
