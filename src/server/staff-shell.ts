import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
 * Badge for "Tekshirish navbati": finished submissions still waiting for a review, as far as RLS lets
 * this user see them (a curator: their groups; a teacher: their course). A failure only hides the badge.
 */
export async function pendingQueueCount(): Promise<number | null> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .or("storage_path.not.is.null,tg_file_id.not.is.null,kind.eq.text");
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}
