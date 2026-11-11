import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getQueue } from "@/server/curator-queue";

export type StaffRole = "teacher" | "admin" | "curator";

export interface ShellUser {
  id: string;
  name: string;
  role: StaffRole;
}

/**
 * Guard for the whole (staff) area: teacher, admin and curator may enter. Anonymous users go to
 * /login, everybody else (students) to /home. Pages still run their own, stricter guard.
 */
export async function requireShellUser(): Promise<ShellUser> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile) redirect("/login");
  const role = (profile as { role: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "curator") redirect("/home");
  return { id: data.user.id, name: (profile as { full_name: string }).full_name || "Foydalanuvchi", role };
}

/**
 * Badge for "Tekshirish navbati": exactly the queue's own count (getQueue), so it never disagrees with
 * the list: finished audio/video only, never the viewer's own work, never test-item exercises, as far
 * as RLS lets this user see them. A failure only hides the badge.
 *
 * Canonical "unreviewed" definition = the review queue. The KPI tile (teacher_kpis) and curator_stats
 * deliberately count per cohort / per group in SQL (finished pending submissions of active students,
 * text included) and may differ from this per-viewer number.
 */
export async function pendingQueueCount(userId: string): Promise<number | null> {
  try {
    return (await getQueue(userId)).count;
  } catch {
    return null;
  }
}
