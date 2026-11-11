import { describe, expect, it, vi } from "vitest";
import {
  getDashboardWith,
  listCohortsWith,
  maskPhone,
  pickCohort,
  sortCohorts,
  type StatsDb,
} from "@/server/teacher-stats";

function fakeDb(over: Partial<StatsDb> = {}): StatsDb {
  return {
    cohorts: async () => [],
    rpc: async () => [],
    pendingEnrollments: async () => [],
    profiles: async () => [],
    ...over,
  };
}

describe("teacher stats adapter", () => {
  it("maps the SQL rows to the dashboard model", async () => {
    const rpc = vi.fn(async (fn: string) => {
      switch (fn) {
        case "teacher_kpis":
          return [{ active_students: 3, total_students: "5", pending_requests: 1, active_today: 2, unreviewed_submissions: 4, avg_progress: "1.33" }];
        case "daily_active":
          return [{ day: "2026-11-10", active: 1 }, { day: "2026-11-11", active: 2 }];
        case "lesson_completion":
          return [{ lesson_id: "l1", title: "Dars 1", completed_students: 2, total_active_students: 3 }];
        case "curator_stats":
          return [{ group_id: "g1", group_name: "A", curator_name: "Kurator", students: 3, pending_queue: 16, avg_score: "4.25", avg_response_hours: null }];
        default:
          return [{ student_id: "s1", full_name: "Ali", telegram_linked: true, last_active: null, last_part_title: "Grammatika" }];
      }
    });
    const db = fakeDb({
      rpc,
      pendingEnrollments: async () => [{ id: "e1", student_id: "s9", created_at: "2026-11-10T10:00:00Z" }],
      profiles: async () => [{ id: "s9", full_name: "Zafar Qodirov", phone: "+998901234567" }],
    });
    const d = await getDashboardWith(db, "c1");
    expect(rpc).toHaveBeenCalledTimes(5);
    expect(rpc).toHaveBeenCalledWith("teacher_kpis", "c1");
    expect(d.kpis).toEqual({ activeStudents: 3, totalStudents: 5, pendingRequests: 1, activeToday: 2, unreviewedSubmissions: 4, avgProgress: 1.33 });
    expect(d.activity).toEqual([{ day: "2026-11-10", active: 1 }, { day: "2026-11-11", active: 2 }]);
    expect(d.lessons).toEqual([{ lessonId: "l1", title: "Dars 1", completed: 2, total: 3 }]);
    expect(d.curators[0]).toMatchObject({ groupName: "A", pendingQueue: 16, avgScore: 4.25, avgResponseHours: null });
    expect(d.idle[0]).toEqual({ studentId: "s1", name: "Ali", telegramLinked: true, lastActive: null, lastPartTitle: "Grammatika" });
    expect(d.requests).toEqual([{ enrollmentId: "e1", studentName: "Zafar Qodirov", phone: "+998 ** *** ** 67", requestedAt: "2026-11-10T10:00:00Z" }]);
    expect(JSON.stringify(d)).not.toContain("901234567");
  });

  it("an empty cohort (or one the caller may not see) maps to zeros and empty lists", async () => {
    const profiles = vi.fn(async () => []);
    const d = await getDashboardWith(fakeDb({ profiles }), "c1");
    expect(d.kpis).toEqual({ activeStudents: 0, totalStudents: 0, pendingRequests: 0, activeToday: 0, unreviewedSubmissions: 0, avgProgress: 0 });
    expect([d.activity, d.lessons, d.curators, d.idle, d.requests]).toEqual([[], [], [], [], []]);
    expect(profiles).not.toHaveBeenCalled();
  });

  it("a request without a readable profile still renders", async () => {
    const d = await getDashboardWith(fakeDb({ pendingEnrollments: async () => [{ id: "e1", student_id: "x", created_at: "t" }] }), "c1");
    expect(d.requests[0]).toMatchObject({ studentName: "Ismsiz o'quvchi", phone: null });
  });

  it("propagates data errors", async () => {
    const boom = new Error("db down");
    await expect(getDashboardWith(fakeDb({ rpc: async () => { throw boom; } }), "c1")).rejects.toBe(boom);
    await expect(getDashboardWith(fakeDb({ pendingEnrollments: async () => { throw boom; } }), "c1")).rejects.toBe(boom);
    await expect(listCohortsWith(fakeDb({ cohorts: async () => { throw boom; } }))).rejects.toBe(boom);
  });
});

describe("cohorts", () => {
  const rows = [
    { id: "a", name: "Eski", starts_on: "2026-01-01", created_at: "2026-01-01T00:00:00Z" },
    { id: "b", name: "Yangi", starts_on: "2026-10-01", created_at: "2026-09-01T00:00:00Z" },
    { id: "c", name: "Sanasiz", starts_on: null, created_at: "2026-11-01T00:00:00Z" },
  ];

  it("newest start date first, undated last", () => {
    expect(sortCohorts(rows).map((c) => c.id)).toEqual(["b", "a", "c"]);
  });

  it("?cohort= picks a visible cohort, anything else falls back to the newest", () => {
    const opts = sortCohorts(rows);
    expect(pickCohort(opts, "a")?.id).toBe("a");
    expect(pickCohort(opts, "zzz")?.id).toBe("b");
    expect(pickCohort(opts, undefined)?.id).toBe("b");
    expect(pickCohort(opts, ["a"])?.id).toBe("b");
    expect(pickCohort([], "a")).toBeNull();
  });
});

describe("maskPhone", () => {
  it("keeps the country prefix and the last two digits", () => {
    expect(maskPhone("+998901234567")).toBe("+998 ** *** ** 67");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("123")).toBe("***");
  });
});
