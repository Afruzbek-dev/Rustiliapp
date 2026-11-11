import { beforeEach, describe, expect, it, vi } from "vitest";

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

const state: { user: { id: string } | null; role: string | null; enrollments: unknown[] } = {
  user: null,
  role: null,
  enrollments: [],
};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.select = self;
  b.eq = self;
  b.or = self;
  b.limit = () => Promise.resolve({ data: table === "enrollments" ? state.enrollments : [] });
  b.maybeSingle = () => Promise.resolve({ data: state.role ? { role: state.role } : null });
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (t: string) => builder(t),
  }),
}));

import { requireCurator, requireStaff, requireStudent } from "@/server/guards";

async function target(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof Redirect) return e.to;
    throw e;
  }
}

beforeEach(() => {
  state.user = { id: "u1" };
  state.role = "student";
  state.enrollments = [{ id: "e1" }];
});

describe("guards", () => {
  it("anonymous -> /login for every guard", async () => {
    state.user = null;
    expect(await target(requireStudent)).toBe("/login");
    expect(await target(requireCurator)).toBe("/login");
    expect(await target(requireStaff)).toBe("/login");
  });

  it("student without active enrollment -> /login?state=pending", async () => {
    state.enrollments = [];
    expect(await target(requireStudent)).toBe("/login?state=pending");
  });

  it("student with active enrollment passes", async () => {
    expect(await target(requireStudent)).toBeNull();
  });

  it("student on curator/staff routes -> /home", async () => {
    expect(await target(requireCurator)).toBe("/home");
    expect(await target(requireStaff)).toBe("/home");
  });

  it("curator passes requireCurator but not requireStaff", async () => {
    state.role = "curator";
    expect(await target(requireCurator)).toBeNull();
    expect(await target(requireStaff)).toBe("/curator");
  });

  it("teacher passes requireStaff but not requireCurator", async () => {
    state.role = "teacher";
    expect(await target(requireStaff)).toBeNull();
    expect(await target(requireCurator)).toBe("/home");
  });

  it("admin passes both", async () => {
    state.role = "admin";
    expect(await target(requireStaff)).toBeNull();
    expect(await target(requireCurator)).toBeNull();
  });

  it("missing profile -> /login", async () => {
    state.role = null;
    expect(await target(requireStudent)).toBe("/login");
  });
});
