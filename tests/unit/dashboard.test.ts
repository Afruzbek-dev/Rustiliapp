import { describe, expect, it } from "vitest";
import {
  buildWeek,
  getDashboardWith,
  type ActivityRow,
  type CurrentPart,
  type DashboardDb,
} from "@/server/dashboard";

// Tuesday 2026-11-10, 12:00 Asia/Tashkent
const NOW = new Date("2026-11-10T07:00:00Z");

function fakeDb(over: Partial<{
  name: string;
  activity: ActivityRow[];
  xp: number;
  rank: { rank: number; score: number } | null;
  part: CurrentPart | null;
  due: number;
  enrolled: boolean;
}> = {}): DashboardDb {
  const o = { name: "Aziza Karimova", activity: [], xp: 0, rank: null, part: null, due: 0, enrolled: true, ...over };
  return {
    fullName: async () => o.name,
    enrollment: async () => (o.enrolled ? { cohortId: "c1", courseId: "k1", label: "Guruh A" } : null),
    activity: async () => o.activity,
    totalXp: async () => o.xp,
    weeklyRank: async () => o.rank,
    currentPart: async () => o.part,
    dueCards: async () => o.due,
  };
}

describe("buildWeek", () => {
  it("returns Du..Ya with Monday first and marks today", () => {
    const week = buildWeek("2026-11-10", new Set(["2026-11-09"]));
    expect(week.map((d) => d.label)).toEqual(["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"]);
    expect(week[0].day).toBe("2026-11-09");
    expect(week[6].day).toBe("2026-11-15");
    expect(week.filter((d) => d.today).map((d) => d.label)).toEqual(["Se"]);
    expect(week.filter((d) => d.done).map((d) => d.label)).toEqual(["Du"]);
  });

  it("handles Sunday as the last day of the week", () => {
    const week = buildWeek("2026-11-15", new Set());
    expect(week[0].day).toBe("2026-11-09");
    expect(week[6].today).toBe(true);
  });
});

describe("getDashboardWith", () => {
  it("computes streak, week strip, xp, rank and first name", async () => {
    const d = await getDashboardWith(
      fakeDb({
        activity: [
          { day: "2026-11-10", xp: 30, tasks: { words: 4, grammar: 1 } },
          { day: "2026-11-09", xp: 20, tasks: {} },
          { day: "2026-11-08", xp: 10, tasks: {} },
          { day: "2026-11-05", xp: 10, tasks: {} },
          { day: "2026-11-07", xp: 0, tasks: {} },
        ],
        xp: 70,
        rank: { rank: 3, score: 40 },
        due: 5,
      }),
      "s1",
      NOW,
    );
    expect(d.firstName).toBe("Aziza");
    expect(d.groupLabel).toBe("Guruh A");
    expect(d.streak).toBe(3);
    expect(d.totalXp).toBe(70);
    expect(d.weeklyRank).toBe(3);
    expect(d.dueCards).toBe(5);
    expect(d.week.filter((w) => w.done).map((w) => w.label)).toEqual(["Du", "Se"]);
    expect(d.week.find((w) => w.today)?.label).toBe("Se");
    expect(d.isEmpty).toBe(false);
  });

  it("keeps the streak alive when today has no activity yet", async () => {
    const d = await getDashboardWith(
      fakeDb({ activity: [{ day: "2026-11-09", xp: 10, tasks: {} }], xp: 10 }),
      "s1",
      NOW,
    );
    expect(d.streak).toBe(1);
  });

  it("uses Tashkent day, not UTC, for today", async () => {
    // 2026-11-09T20:00Z is already 2026-11-10 01:00 in Tashkent
    const d = await getDashboardWith(
      fakeDb({ activity: [{ day: "2026-11-10", xp: 5, tasks: {} }], xp: 5 }),
      "s1",
      new Date("2026-11-09T20:00:00Z"),
    );
    expect(d.week.find((w) => w.today)?.day).toBe("2026-11-10");
    expect(d.streak).toBe(1);
  });

  it("maps daily tasks from today's row, capped at the target", async () => {
    const d = await getDashboardWith(
      fakeDb({
        activity: [
          { day: "2026-11-10", xp: 10, tasks: { words: 25, grammar: 1, audio: 0 } },
          { day: "2026-11-09", xp: 10, tasks: { speaking: 1 } },
        ],
        xp: 20,
      }),
      "s1",
      NOW,
    );
    expect(d.tasks).toEqual([
      { key: "words", target: 10, done: 10 },
      { key: "grammar", target: 1, done: 1 },
      { key: "audio", target: 1, done: 0 },
      { key: "speaking", target: 1, done: 0 },
    ]);
  });

  it("reports an empty state for a brand new student", async () => {
    const d = await getDashboardWith(fakeDb(), "s1", NOW);
    expect(d.isEmpty).toBe(true);
    expect(d.streak).toBe(0);
    expect(d.weeklyRank).toBeNull();
    expect(d.dueCards).toBe(0);
    expect(d.tasks.every((t) => t.done === 0)).toBe(true);
  });

  it("is not empty once a part was started", async () => {
    const part: CurrentPart = { partId: "p1", lessonTitle: "Dars 1", kind: "grammar", percent: 0, started: true };
    const d = await getDashboardWith(fakeDb({ part }), "s1", NOW);
    expect(d.isEmpty).toBe(false);
    expect(d.currentPart).toEqual(part);
  });

  it("shows no rank when the weekly score is 0 (tied at rank 1)", async () => {
    const d = await getDashboardWith(
      fakeDb({ xp: 5, activity: [{ day: "2026-11-01", xp: 5, tasks: {} }], rank: { rank: 1, score: 0 } }),
      "s1",
      NOW,
    );
    expect(d.weeklyRank).toBeNull();
  });

  it("passes the resolved enrollment's course to currentPart", async () => {
    const seen: string[] = [];
    const db: DashboardDb = {
      ...fakeDb(),
      currentPart: async (_s, courseId) => {
        seen.push(courseId);
        return null;
      },
    };
    await getDashboardWith(db, "s1", NOW);
    expect(seen).toEqual(["k1"]);
  });

  it("skips the rank lookup without an enrollment", async () => {
    const d = await getDashboardWith(fakeDb({ enrolled: false, rank: { rank: 1, score: 10 } }), "s1", NOW);
    expect(d.weeklyRank).toBeNull();
    expect(d.groupLabel).toBeNull();
  });
});
