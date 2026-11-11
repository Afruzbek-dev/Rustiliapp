import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { resolveLoginView } from "@/server/login-view";

type Enr = { status: string; expires_at: string | null };

function client(state: { user: { id: string } | null; role: string | null; enrollments: Enr[] }) {
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const rows = table === "enrollments" ? state.enrollments : [];
      const eq = () => Object.assign(Promise.resolve({ data: rows }), {
        maybeSingle: () => Promise.resolve({ data: state.role ? { role: state.role } : null }),
      });
      return { select: () => ({ eq }) };
    },
  } as unknown as SupabaseClient;
}

const user = { id: "u" };
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

describe("resolveLoginView", () => {
  it("anonymous sees the login steps", async () => {
    expect(await resolveLoginView(client({ user: null, role: null, enrollments: [] }))).toEqual({ kind: "anonymous" });
  });
  it("active student (open-ended or unexpired) is redirected to /home", async () => {
    for (const expires_at of [null, future]) {
      const c = client({ user, role: "student", enrollments: [{ status: "active", expires_at }] });
      expect(await resolveLoginView(c)).toEqual({ kind: "redirect", to: "/home" });
    }
  });
  it("pending / no-enrollment student sees the pending state, never /home (no loop with requireStudent)", async () => {
    expect(await resolveLoginView(client({ user, role: "student", enrollments: [] }))).toEqual({ kind: "pending" });
    const c = client({ user, role: "student", enrollments: [{ status: "pending", expires_at: null }] });
    expect(await resolveLoginView(c)).toEqual({ kind: "pending" });
  });
  it("rejected or expired enrollments (nothing pending) are 'closed', still never /home", async () => {
    const rejected = client({ user, role: "student", enrollments: [{ status: "rejected", expires_at: null }] });
    expect(await resolveLoginView(rejected)).toEqual({ kind: "closed" });
    const lapsed = client({ user, role: "student", enrollments: [{ status: "active", expires_at: past }] });
    expect(await resolveLoginView(lapsed)).toEqual({ kind: "closed" });
    const expired = client({ user, role: "student", enrollments: [{ status: "expired", expires_at: past }] });
    expect(await resolveLoginView(expired)).toEqual({ kind: "closed" });
  });
  it("a pending application wins over an older rejected one", async () => {
    const c = client({
      user,
      role: "student",
      enrollments: [
        { status: "rejected", expires_at: null },
        { status: "pending", expires_at: null },
      ],
    });
    expect(await resolveLoginView(c)).toEqual({ kind: "pending" });
  });
  it("a signed-in user without a profile gets the login steps, not /home", async () => {
    expect(await resolveLoginView(client({ user, role: null, enrollments: [] }))).toEqual({ kind: "anonymous" });
  });
  it("staff are sent to /home (requireStudent lets non-students through)", async () => {
    expect(await resolveLoginView(client({ user, role: "teacher", enrollments: [] }))).toEqual({
      kind: "redirect",
      to: "/home",
    });
  });
});
