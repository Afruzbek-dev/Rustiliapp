import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Role = "student" | "curator" | "teacher" | "admin";

async function currentUserAndRole() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (!profile) redirect("/login");
  return { supabase, user: data.user, role: profile.role as Role };
}

/** All guards query through the user-scoped client, so RLS stays the real authority. */
export const requireStudent = cache(async function requireStudent() {
  const { supabase, user, role } = await currentUserAndRole();
  if (role === "student") {
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from("enrollments")
      .select("id")
      .eq("student_id", user.id)
      .eq("status", "active")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .limit(1);
    if (!data || data.length === 0) redirect("/login?state=pending");
  }
  return { user, role };
});

export async function requireCurator() {
  const { user, role } = await currentUserAndRole();
  if (role !== "curator" && role !== "admin") redirect("/home");
  return { user, role };
}

export async function requireStaff() {
  const { user, role } = await currentUserAndRole();
  if (role !== "teacher" && role !== "admin") redirect("/home");
  return { user, role };
}

/** Anyone who may use the review queue: curator, teacher or admin. */
export async function requireReviewer() {
  const { user, role } = await currentUserAndRole();
  if (role !== "curator" && role !== "teacher" && role !== "admin") redirect("/home");
  return { user, role };
}
