import { describe, expect, it } from "vitest";
import { getQueue, getSubmission, recentlyReviewed, type SubmissionRow } from "@/server/curator-queue";
import { displayName, timeAgo } from "@/lib/curator-types";
import { fakeStore, U, type FakeWorld } from "./curator-fake";

const CUR_A = U(1);
const CUR_B = U(2);
const TEACHER = U(3);
const ADMIN = U(4);
const ST1 = U(11);
const ST2 = U(12);
const EX = U(21);
const EX_TEST = U(22);

const sub = (n: number, over: Partial<SubmissionRow & { group: string }> = {}): SubmissionRow & { group: string } => ({
  id: U(100 + n),
  student_id: ST1,
  exercise_id: EX,
  kind: "audio",
  storage_path: `${ST1}/${U(100 + n)}.webm`,
  tg_file_id: null,
  status: "pending",
  created_at: `2026-11-0${n}T10:00:00.000Z`,
  group: "A",
  ...over,
});

function world(over: Partial<FakeWorld> = {}): FakeWorld {
  return {
    roles: { [CUR_A]: "curator", [CUR_B]: "curator", [TEACHER]: "teacher", [ADMIN]: "admin", [ST1]: "student" },
    names: { [ST1]: "Ali Valiyev Karimovich", [ST2]: "Madina", [CUR_A]: "Zarina Qodirova" },
    groupOf: { [CUR_A]: "A", [CUR_B]: "B" },
    exercises: [
      { id: EX, prompt: "Расскажите о себе", lessonTitle: "Знакомство", isTest: false },
      { id: EX_TEST, prompt: "test", lessonTitle: null, isTest: true },
    ],
    submissions: [],
    reviews: [],
    ...over,
  };
}

describe("getQueue", () => {
  it("orders oldest first, with display name, lesson, prompt and count", async () => {
    const w = world({ submissions: [sub(3), sub(1), sub(2)] });
    const q = await getQueue(CUR_A, fakeStore(w, CUR_A));
    expect(q.items.map((i) => i.id)).toEqual([U(101), U(102), U(103)]);
    expect(q.count).toBe(3);
    expect(q.items[0]).toMatchObject({
      studentName: "Ali V.",
      lessonTitle: "Знакомство",
      prompt: "Расскажите о себе",
      kind: "audio",
      status: "pending",
      review: null,
    });
  });

  it("scopes a curator to their own group (the fake applies RLS), a teacher sees all", async () => {
    const w = world({ submissions: [sub(1, { group: "A" }), sub(2, { group: "B" })] });
    expect((await getQueue(CUR_A, fakeStore(w, CUR_A))).items.map((i) => i.id)).toEqual([U(101)]);
    expect((await getQueue(CUR_B, fakeStore(w, CUR_B))).items.map((i) => i.id)).toEqual([U(102)]);
    expect((await getQueue(TEACHER, fakeStore(w, TEACHER))).count).toBe(2);
  });

  it("ignores unfinished audio rows but keeps video rows with a tg_file_id and no storage_path", async () => {
    const w = world({
      submissions: [
        sub(1, { storage_path: null }), // unfinished upload
        sub(2, { kind: "video", storage_path: null, tg_file_id: "FILE" }),
        sub(3, { kind: "video", storage_path: null, tg_file_id: null }), // no file yet
        sub(4, { kind: "text", storage_path: null }),
      ],
    });
    const q = await getQueue(CUR_A, fakeStore(w, CUR_A));
    expect(q.items.map((i) => i.id)).toEqual([U(102)]);
    expect(q.items[0]!.kind).toBe("video");
  });

  it("excludes test-item exercises and exercises the viewer cannot read", async () => {
    const w = world({ submissions: [sub(1, { exercise_id: EX_TEST }), sub(2, { exercise_id: U(99) }), sub(3)] });
    expect((await getQueue(CUR_A, fakeStore(w, CUR_A))).items.map((i) => i.id)).toEqual([U(103)]);
  });

  it("never lists the viewer's own submissions and skips reviewed ones", async () => {
    const w = world({ submissions: [sub(1, { student_id: CUR_A }), sub(2, { status: "reviewed" }), sub(3)] });
    expect((await getQueue(CUR_A, fakeStore(w, CUR_A))).items.map((i) => i.id)).toEqual([U(103)]);
  });

  it("returns an empty queue for a student and never reads submissions", async () => {
    const store = fakeStore(world({ submissions: [sub(1)] }), ST1);
    const q = await getQueue(ST1, store);
    expect(q).toEqual({ items: [], count: 0, role: "student" });
    expect(store.calls).not.toContain("pending");
  });

  it("propagates database errors", async () => {
    const store = fakeStore(world(), CUR_A);
    store.listPending = async () => {
      throw new Error("boom");
    };
    await expect(getQueue(CUR_A, store)).rejects.toThrow("boom");
  });
});

describe("getSubmission (deep link)", () => {
  it("finds pending and reviewed rows; null for invisible, unfinished and test items", async () => {
    const w = world({
      submissions: [
        sub(1),
        sub(2, { status: "reviewed" }),
        sub(3, { group: "B" }),
        sub(4, { storage_path: null }),
        sub(5, { exercise_id: EX_TEST }),
      ],
      reviews: [
        { submission_id: U(102), scores: { completeness: 4, pronunciation: 4, grammar: 4, fluency: 5 }, total: 4.25, comment: "Yaxshi", is_override: false, reviewer_id: CUR_A, created_at: "2026-11-03T10:00:00.000Z" },
      ],
    });
    const store = fakeStore(w, CUR_A);
    expect((await getSubmission(CUR_A, U(101), store))?.status).toBe("pending");
    const reviewed = await getSubmission(CUR_A, U(102), store);
    expect(reviewed?.status).toBe("reviewed");
    expect(reviewed?.review).toMatchObject({ total: 4.25, comment: "Yaxshi", reviewerName: "Zarina Q." });
    for (const n of [3, 4, 5, 9]) expect(await getSubmission(CUR_A, U(100 + n), store)).toBeNull();
  });
});

describe("recentlyReviewed", () => {
  const now = new Date("2026-11-11T00:00:00.000Z");
  const scores = { completeness: 5, pronunciation: 5, grammar: 5, fluency: 5 };
  const rev = (n: number, at: string, over = {}) => ({
    submission_id: U(100 + n), scores, total: 5, comment: null, is_override: false, reviewer_id: CUR_A, created_at: at, ...over,
  });

  it("lists the last 30 days newest review first with the latest review per submission (teacher and admin)", async () => {
    const w = world({
      submissions: [sub(1, { status: "reviewed" }), sub(2, { status: "reviewed" }), sub(3, { status: "reviewed" }), sub(4)],
      reviews: [
        rev(1, "2026-11-05T10:00:00.000Z"),
        rev(1, "2026-11-09T10:00:00.000Z", { total: 3, is_override: true, scores: { ...scores, grammar: 1 } }),
        rev(2, "2026-11-07T10:00:00.000Z"),
        rev(3, "2026-09-01T10:00:00.000Z"), // outside the window
      ],
    });
    for (const viewer of [TEACHER, ADMIN]) {
      const list = await recentlyReviewed(viewer, fakeStore(w, viewer), now);
      expect(list.map((i) => i.id)).toEqual([U(101), U(102)]);
      expect(list[0]!.review).toMatchObject({ total: 3, isOverride: true });
    }
  });

  it("is empty for a curator, who has no override tab", async () => {
    const w = world({ submissions: [sub(1, { status: "reviewed" })], reviews: [rev(1, "2026-11-09T10:00:00.000Z")] });
    const store = fakeStore(w, CUR_A);
    expect(await recentlyReviewed(CUR_A, store, now)).toEqual([]);
  });
});

describe("helpers", () => {
  it("displayName: first name + last initial", () => {
    expect(displayName("Ali Valiyev Karimovich")).toBe("Ali V.");
    expect(displayName("Madina")).toBe("Madina");
    expect(displayName("  ")).toBe("O'quvchi");
    expect(displayName(null)).toBe("O'quvchi");
  });
  it("timeAgo", () => {
    const now = "2026-11-11T12:00:00.000Z";
    expect(timeAgo("2026-11-11T11:59:50.000Z", now)).toBe("hozirgina");
    expect(timeAgo("2026-11-11T11:35:00.000Z", now)).toBe("25 daqiqa oldin");
    expect(timeAgo("2026-11-11T09:00:00.000Z", now)).toBe("3 soat oldin");
    expect(timeAgo("2026-11-09T09:00:00.000Z", now)).toBe("2 kun oldin");
  });
});
