import type { SupabaseClient } from "@supabase/supabase-js";

export type LoginView = { kind: "anonymous" } | { kind: "pending" } | { kind: "redirect"; to: string };

/**
 * What /login should show for the current session. Mirrors requireStudent exactly so the two
 * can never bounce a user between each other: a student WITHOUT an active, unexpired enrollment
 * (requireStudent sends them here) gets the pending view and is never redirected to /home.
 */
export async function resolveLoginView(supabase: SupabaseClient): Promise<LoginView> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { kind: "anonymous" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  // requireStudent sends profile-less users to /login: they must see the login steps, not /home.
  if (!profile) return { kind: "anonymous" };
  if (profile.role !== "student") return { kind: "redirect", to: "/home" };
  const nowIso = new Date().toISOString();
  const { data: enr } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", user.id)
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .limit(1);
  return enr && enr.length > 0 ? { kind: "redirect", to: "/home" } : { kind: "pending" };
}
