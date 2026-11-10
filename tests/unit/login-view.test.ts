import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { resolveLoginView } from "@/server/login-view";

function client(state: { user: { id: string } | null; role: string | null; enrollments: unknown[] }) {
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.or = () => b;
      b.limit = () => Promise.resolve({ data: table === "enrollments" ? state.enrollments : [] });
      b.maybeSingle = () => Promise.resolve({ data: state.role ? { role: state.role } : null });
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("resolveLoginView", () => {
  it("anonymous sees the login steps", async () => {
    expect(await resolveLoginView(client({ user: null, role: null, enrollments: [] }))).toEqual({ kind: "anonymous" });
  });
  it("active student is redirected to /home", async () => {
    const c = client({ user: { id: "u" }, role: "student", enrollments: [{ id: "e" }] });
    expect(await resolveLoginView(c)).toEqual({ kind: "redirect", to: "/home" });
  });
  it("pending / no-enrollment student sees the pending state, never /home (no loop with requireStudent)", async () => {
    const c = client({ user: { id: "u" }, role: "student", enrollments: [] });
    expect(await resolveLoginView(c)).toEqual({ kind: "pending" });
  });
  it("a signed-in user without a profile gets the login steps, not /home", async () => {
    expect(await resolveLoginView(client({ user: { id: "u" }, role: null, enrollments: [] }))).toEqual({
      kind: "anonymous",
    });
  });
  it("staff are sent to /home (requireStudent lets non-students through)", async () => {
    const c = client({ user: { id: "u" }, role: "teacher", enrollments: [] });
    expect(await resolveLoginView(c)).toEqual({ kind: "redirect", to: "/home" });
  });
});
