import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STREAK_BONUS } from "@/lib/gamification/xp";
import { tashkentDay } from "@/lib/gamification/day";
import { currentStreak } from "@/lib/gamification/streak";

export type StreakMilestone = 7 | 14 | 30;

export interface StreakBonusResult {
  /** The milestone the streak is exactly at, else null. */
  milestone: StreakMilestone | null;
  /** True only when this call actually granted the XP (false on repeat visits). */
  awarded: boolean;
  streak: number;
}

export interface StreakBonusDeps {
  /** Service-role client used for award_xp (the RPC is executable by service_role only). */
  service?: () => Pick<SupabaseClient, "rpc">;
  now?: Date;
}

export const isMilestone = (n: number): n is StreakMilestone => n in STREAK_BONUS;

/**
 * Grants the streak bonus (7/14/30 days) once per milestone and Tashkent day.
 *
 * Only ever acts for the session user: `client` is the user-scoped client and its
 * authenticated user must equal `studentId`, otherwise nothing happens. The streak is
 * read through that client (RLS) from daily_activity days with xp > 0. A milestone only
 * counts when today is itself an active day: the bonus XP lands on today's daily_activity
 * row, so granting it for a streak that ended yesterday would manufacture activity.
 *
 * Call it from any server component after requireStudent(). The rating page does; the
 * dashboard (src/server/dashboard.ts, owned by another task) can adopt it later with:
 *   `await ensureStreakBonus(await createClient(), studentId)` inside getDashboard.
 */
export async function ensureStreakBonus(
  client: SupabaseClient,
  studentId: string,
  deps: StreakBonusDeps = {},
): Promise<StreakBonusResult> {
  const none: StreakBonusResult = { milestone: null, awarded: false, streak: 0 };

  const { data: auth } = await client.auth.getUser();
  if (!auth?.user || auth.user.id !== studentId) return none;

  const today = tashkentDay(deps.now ?? new Date());
  const { data, error } = await client
    .from("daily_activity")
    .select("day")
    .eq("student_id", studentId)
    .gt("xp", 0)
    .order("day", { ascending: false })
    .limit(400);
  if (error) throw new Error(`streak bonus: activity: ${error.message}`);

  const days = (data ?? []).map((r) => r.day as string);
  if (!days.includes(today)) return none;
  const streak = currentStreak(days, today);
  if (!isMilestone(streak)) return { ...none, streak };

  const service = deps.service ?? (await import("@/lib/supabase/service")).createServiceClient;
  const res = await service().rpc("award_xp", {
    p_student: studentId,
    p_amount: STREAK_BONUS[streak],
    p_reason: "streak_bonus",
    p_ref: `streak:${streak}:${today}`,
  });
  if (res.error) throw new Error(`streak bonus: award_xp: ${res.error.message}`);
  return { milestone: streak, awarded: res.data === true, streak };
}
