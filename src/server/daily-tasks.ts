import "server-only";

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
