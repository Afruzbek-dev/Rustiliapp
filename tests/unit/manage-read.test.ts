import { describe, expect, it } from "vitest";
import {
  effectiveStatus,
  getStudentDetailWith,
  listCohortOverviewWith,
  listGroupsWith,
  listStudentsWith,
  PAGE_SIZE,
  parseListParams,
  type ManageReadDb,
} from "@/server/manage-read";

type Raw = Record<string, unknown>;
const G = "5b0f6f0e-2f4c-4d57-9a53-0e0a9b8e9a11";

describe("parseListParams", () => {
  it("accepts valid values and normalises junk", () => {
    expect(parseListParams({ q: "  ali ", status: "pending", group: G, page: "3" })).toEqual({
      search: "ali", status: "pending", groupId: G, ungrouped: false, page: 3,
    });
    expect(parseListParams({ group: "none" })).toMatchObject({ ungrouped: true, groupId: null });
    expect(parseListParams({ status: "admin'--", group: "zzz", page: "-4" })).toEqual({
      search: "", status: null, groupId: null, ungrouped: false, page: 1,
    });
    expect(parseListParams({ page: "1e9" }).page).toBe(1);
    expect(parseListParams({ q: "x".repeat(500) }).search).toHaveLength(64);
    expect(parseListParams({ q: ["a", "b"] }).search).toBe("a");
  });
});

function fakeRead(over: Partial<ManageReadDb> = {}): ManageReadDb {
  const none = async () => [] as Raw[];
  return {
    cohortsOverview: none, studentList: none, counts: none, groups: none, curatorProfiles: none, curatorStats: none, courses: none,
    enrollment: async () => null, profile: async () => null, cohort: async () => null, studentDetail: none,
    courseLessons: async () => ({ lessons: [], parts: [], playablePartIds: [] }),
    partProgress: none, recentSubmissions: none, exercisePrompts: none, latestReviewTotals: none,
    ...over,
  };
}

describe("listStudentsWith", () => {
  it("masks phones and maps rows, total and counts", async () => {
    let seen: unknown[] = [];
    const db = fakeRead({
      studentList: async (...args) => {
        seen = args;
        return [
          { enrollment_id: "e1", student_id: "s1", full_name: "Madina", phone: "+998901112233", telegram_linked: true, status: "active", group_id: "g", group_name: "G1", parts_completed: 2, parts_total: 5, last_active: "2026-03-04", requested_at: "x", total_count: 41 },
          { enrollment_id: "e2", student_id: "s2", full_name: "", phone: null, telegram_linked: false, status: "weird", total_count: 41 },
        ];
      },
      counts: async () => [{ total: 41, active: 30, pending: 5, expired: 4, rejected: 2, ungrouped: 7 }],
    });
    const page = await listStudentsWith(db, "c1", { search: "", status: null, groupId: null, ungrouped: false, page: 2 });
    expect(seen.slice(2)).toEqual([PAGE_SIZE, PAGE_SIZE]); // offset, limit
    expect(PAGE_SIZE).toBeLessThanOrEqual(50);
    expect(page.total).toBe(41);
    expect(page.rows[0]).toMatchObject({ name: "Madina", phone: "+998 ** *** ** 33", telegramLinked: true, partsTotal: 5 });
    expect(JSON.stringify(page)).not.toContain("901112233");
    expect(page.rows[1]).toMatchObject({ name: "Ismsiz o'quvchi", phone: null, status: "pending" });
    expect(page.counts).toEqual({ total: 41, active: 30, pending: 5, expired: 4, rejected: 2, ungrouped: 7 });
  });

  it("an empty / foreign cohort gives an empty page with zero counts", async () => {
    const page = await listStudentsWith(fakeRead(), "c1", { search: "", status: null, groupId: null, ungrouped: false, page: 1 });
    expect(page).toMatchObject({ rows: [], total: 0, counts: { total: 0, pending: 0 } });
  });

  it("propagates a database failure (the route error boundary renders it)", async () => {
    const db = fakeRead({ studentList: async () => { throw new Error("boom"); } });
    await expect(listStudentsWith(db, "c1", { search: "", status: null, groupId: null, ungrouped: false, page: 1 })).rejects.toThrow("boom");
  });
});

describe("cohorts and groups", () => {
  it("maps the overview", async () => {
    const [c] = await listCohortOverviewWith(fakeRead({
      cohortsOverview: async () => [{ cohort_id: "c", course_id: "k", course_title: "Rus tili", name: "Potok 1", enrollment_open: true, active_students: 4, pending_students: 1, group_count: 2 }],
    }));
    expect(c).toMatchObject({ cohortId: "c", courseTitle: "Rus tili", enrollmentOpen: true, activeStudents: 4, groupCount: 2 });
  });

  it("builds the balance view with curator names, telegram state and chat ids as strings", async () => {
    const rows = await listGroupsWith(
      fakeRead({
      groups: async () => [
        { id: "g2", name: "B", curator_id: "p1", telegram_chat_id: -1001234567890 },
        { id: "g1", name: "A", curator_id: null, telegram_chat_id: null },
      ],
      curatorProfiles: async () => [{ id: "p1", full_name: "Kurator", telegram_id: 55 }],
      curatorStats: async () => [{ group_id: "g2", students: 9, pending_queue: 4 }],
      }),
      "c1",
    );
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(rows[1]).toMatchObject({ curatorName: "Kurator", curatorTelegramLinked: true, telegramChatId: "-1001234567890", students: 9, pendingQueue: 4 });
    expect(rows[0]).toMatchObject({ curatorName: null, telegramChatId: null, students: 0 });
  });
});

describe("getStudentDetailWith", () => {
  const NOW = new Date("2026-03-05T10:00:00Z");
  const full = (over: Partial<ManageReadDb> = {}) =>
    fakeRead({
      enrollment: async () => ({ id: "e1", student_id: "s1", cohort_id: "c1", curator_group_id: "g1", status: "active", expires_at: "2026-06-01T00:00:00Z" }),
      profile: async () => ({ id: "s1", full_name: "Madina", phone: "+998901112233", telegram_id: null, telegram_username: null }),
      cohort: async () => ({ id: "c1", course_id: "k", name: "Potok 1" }),
      studentDetail: async () => [{ xp_total: 120, attempts_total: 10, attempts_correct: 7, active_days: ["2026-03-03", "2026-03-04"], last_active: "2026-03-04" }],
      groups: async () => [{ id: "g1", name: "G1" }, { id: "g2", name: "G2" }],
      courseLessons: async () => ({
        lessons: [{ id: "l1", title: "Dars 1" }, { id: "l2", title: "Dars 2" }],
        parts: [{ id: "p1", lesson_id: "l1" }, { id: "p2", lesson_id: "l1" }, { id: "p3", lesson_id: "l2" }],
        playablePartIds: ["p1", "p2"],
      }),
      partProgress: async () => [{ lesson_part_id: "p1", status: "completed" }, { lesson_part_id: "p2", status: "in_progress" }],
      recentSubmissions: async () => [
        { id: "s-a", exercise_id: "x1", kind: "audio", status: "reviewed", created_at: "2026-03-04T10:00:00Z" },
        { id: "s-b", exercise_id: "x1", kind: "video", status: "pending", created_at: "2026-03-03T10:00:00Z" },
      ],
      exercisePrompts: async () => [{ id: "x1", prompt: "Расскажите о себе" }],
      latestReviewTotals: async () => [{ submission_id: "s-a", total: "4.25" }, { submission_id: "s-a", total: "3" }],
      ...over,
    });

  it("assembles profile, streak, progress by playable lesson and scored submissions", async () => {
    const d = await getStudentDetailWith(full(), "e1", NOW);
    expect(d).toMatchObject({
      name: "Madina", phone: "+998 ** *** ** 33", status: "active", xp: 120, streak: 2, groupName: "G1",
      canLinkTelegram: true, attemptsCorrect: 7, attemptsTotal: 10,
    });
    expect(d!.lessons).toEqual([{ lessonId: "l1", title: "Dars 1", done: 1, total: 2 }]); // lesson 2 has no playable part
    expect(d!.submissions[0]).toMatchObject({ id: "s-a", prompt: "Расскажите о себе", score: 4.25 }); // newest review wins
    expect(d!.submissions[1]!.score).toBeNull();
    expect(JSON.stringify(d)).not.toContain("901112233");
  });

  it("is null when the viewer may not see the enrollment (foreign teacher)", async () => {
    expect(await getStudentDetailWith(full({ enrollment: async () => null }), "e1", NOW)).toBeNull();
    expect(await getStudentDetailWith(full({ studentDetail: async () => [] }), "e1", NOW)).toBeNull();
    expect(await getStudentDetailWith(full({ cohort: async () => null }), "e1", NOW)).toBeNull();
  });

  it("an active enrollment past its expiry is shown as expired; no link when already linked", async () => {
    expect(effectiveStatus("active", "2026-03-01T00:00:00Z", NOW)).toBe("expired");
    expect(effectiveStatus("active", null, NOW)).toBe("active");
    const d = await getStudentDetailWith(
      full({
        enrollment: async () => ({ id: "e1", student_id: "s1", cohort_id: "c1", curator_group_id: null, status: "active", expires_at: "2026-03-01T00:00:00Z" }),
        profile: async () => ({ id: "s1", full_name: "M", phone: "+998901112233", telegram_id: 5, telegram_username: "m" }),
      }),
      "e1",
      NOW,
    );
    expect(d).toMatchObject({ status: "expired", canLinkTelegram: false, telegramLinked: true, groupName: null });
  });

  it("works for a student without activity, lessons or submissions", async () => {
    const d = await getStudentDetailWith(
      full({
        studentDetail: async () => [{ xp_total: 0, attempts_total: 0, attempts_correct: 0, active_days: [], last_active: null }],
        courseLessons: async () => ({ lessons: [], parts: [], playablePartIds: [] }),
        recentSubmissions: async () => [],
      }),
      "e1",
      NOW,
    );
    expect(d).toMatchObject({ xp: 0, streak: 0, lessons: [], submissions: [], lastActive: null });
  });
});
