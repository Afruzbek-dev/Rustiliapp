import type { SupabaseClient } from "@supabase/supabase-js";

export type LoginView =
  | { kind: "anonymous" }
  | { kind: "pending" }
  /** Enrollment was rejected or has expired and nothing is awaiting approval. */
  | { kind: "closed" }
  | { kind: "redirect"; to: string };

/**
 * What /login should show for the current session. Mirrors requireStudent exactly so the two
 * can never bounce a user between each other: a student WITHOUT an active, unexpired enrollment
 * (requireStudent sends them here) is never redirected to /home.
 */
export async function resolveLoginView(supabase: SupabaseClient): Promise<LoginView> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { kind: "anonymous" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  // requireStudent sends profile-less users to /login: they must see the login steps, not /home.
  if (!profile) return { kind: "anonymous" };
  if (profile.role !== "student") return { kind: "redirect", to: "/home" };

  const { data: rows } = await supabase
    .from("enrollments")
    .select("status, expires_at")
    .eq("student_id", user.id);
  const list = (rows ?? []) as { status: string; expires_at: string | null }[];
  const now = Date.now();
  const live = (e: { expires_at: string | null }) => e.expires_at === null || Date.parse(e.expires_at) > now;
  if (list.some((e) => e.status === "active" && live(e))) return { kind: "redirect", to: "/home" };
  if (list.some((e) => e.status === "pending")) return { kind: "pending" };
  // No enrollment at all counts as pending (the bot creates one on contact verification);
  // rejected / expired ones with nothing pending are closed.
  return list.length > 0 ? { kind: "closed" } : { kind: "pending" };
}
