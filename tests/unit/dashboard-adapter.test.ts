import { describe, expect, it } from "vitest";
import { supabaseDashboardDb } from "@/server/dashboard";

/** Chainable fake of a PostgREST builder that resolves to the given result. */
function builder(result: { data: unknown; error: { message: string } | null; count?: number }) {
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown) => res(result);
        if (prop === "maybeSingle") return () => Promise.resolve(result);
        return () => chain;
      },
    },
  );
  return chain;
}

describe("supabaseDashboardDb error handling", () => {
  const boom = { data: null, error: { message: "boom" } };
  const okRes = (data: unknown) => ({ data, error: null });
  const part = { id: "p1", position: 1, kind: "grammar" };
  const modules = okRes([{ position: 1, lessons: [{ position: 1, title: "D1", lesson_parts: [part] }] }]);

  function client(tables: Record<string, unknown>, rpc: unknown = okRes(0)) {
    return {
      from: (t: string) => builder((tables[t] ?? okRes([])) as never),
      rpc: () => builder(rpc as never),
    } as unknown as Parameters<typeof supabaseDashboardDb>[0];
  }

  it("throws when the attempts query fails instead of showing 0%", async () => {
    const db = supabaseDashboardDb(
      client({ modules, blocks: okRes([{ id: "b1" }]), exercises: okRes([{ id: "e1" }]), attempts: boom }),
    );
    await expect(db.currentPart("s1", "c1")).rejects.toThrow(/attempts/);
  });

  it("throws when blocks fails", async () => {
    const db = supabaseDashboardDb(client({ modules, blocks: boom }));
    await expect(db.currentPart("s1", "c1")).rejects.toThrow(/blocks/);
  });

  it("throws when exercises fails", async () => {
    const db = supabaseDashboardDb(client({ modules, blocks: okRes([{ id: "b1" }]), exercises: boom }));
    await expect(db.currentPart("s1", "c1")).rejects.toThrow(/exercises/);
  });

  it("throws on xp rpc and leaderboard failures", async () => {
    await expect(supabaseDashboardDb(client({}, boom)).totalXp("s1")).rejects.toThrow(/total xp/);
    await expect(supabaseDashboardDb(client({}, boom)).weeklyRank("c", "s")).rejects.toThrow(/leaderboard/);
  });

  it("returns the leaderboard score and the rpc total as a number", async () => {
    const lb = okRes([{ rank: 1, student_id: "s1", score: "0" }]);
    expect(await supabaseDashboardDb(client({}, lb)).weeklyRank("c", "s1")).toEqual({ rank: 1, score: 0 });
    expect(await supabaseDashboardDb(client({}, okRes("3000"))).totalXp("s1")).toBe(3000);
  });

  it("throws when the due-cards count query fails", async () => {
    const db = supabaseDashboardDb(client({ srs_cards: boom }));
    await expect(db.dueCards("s1", new Date().toISOString())).rejects.toThrow(/due cards/);
  });

  it("resolves the enrollment with course and group label", async () => {
    const row = okRes({ cohort_id: "co1", cohorts: { name: "Potok 1", course_id: "k1" }, curator_groups: { name: "Guruh A" } });
    const db = supabaseDashboardDb(client({ enrollments: row }));
    expect(await db.enrollment("s1", new Date().toISOString())).toEqual({
      cohortId: "co1",
      courseId: "k1",
      label: "Guruh A",
    });
  });
});
