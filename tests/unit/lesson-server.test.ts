import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/dashboard", () => ({ supabaseDashboardDb: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import type { PartProgress } from "@/lib/path-status";
import { getLessonPartWith, type LessonDb, type LessonBlockRow } from "@/server/lesson";
import { handleAudioListened, handleCompleteRequest, readLimitedJson } from "@/server/lesson-api";
import type { AttemptStore } from "@/server/attempts";

const EX1 = "11111111-1111-4111-8111-111111111111";
const EX2 = "22222222-2222-4222-8222-222222222222";
const W1 = "33333333-3333-4333-8333-333333333333";

function fakeDb(
  opts: {
    blocks?: LessonBlockRow[];
    progress?: Record<string, PartProgress>;
    published?: string[];
    exercisesExtra?: Record<string, unknown>;
  } = {},
): LessonDb & { calls: string[] } {
  const calls: string[] = [];
  const blocks: LessonBlockRow[] = opts.blocks ?? [
    { id: "b3", position: 3, type: "exercise", payload: { exerciseId: EX1 }, published: true },
    { id: "b1", position: 1, type: "text", payload: { body: "Привет" }, published: true },
    { id: "b2", position: 2, type: "speaking", payload: { exerciseId: EX2 }, published: true },
    { id: "bx", position: 4, type: "text", payload: { body: "draft" }, published: false },
  ];
  return {
    calls,
    async enrollment() {
      calls.push("enrollment");
      return { cohortId: "c", courseId: "course", label: "G" };
    },
    async modules() {
      return [
        {
          id: "m1",
          position: 1,
          title: "M",
          lessons: [
            {
              id: "l1",
              position: 1,
              title: "Dars 1",
              lesson_parts: [
                { id: "p1", position: 1, kind: "grammar", title: "G" },
                { id: "p2", position: 2, kind: "conversation", title: "C" },
              ],
            },
          ],
        },
      ];
    },
    async publishedPartIds() {
      return new Set(opts.published ?? ["p1", "p2"]);
    },
    async progress() {
      return new Map(Object.entries(opts.progress ?? {}) as [string, PartProgress][]);
    },
    async tests() {
      return [];
    },
    async part(id) {
      return { id, kind: "grammar", title: "G", lessonId: "l1", lessonTitle: "Dars 1", objective: "Maqsad" };
    },
    async blocks() {
      return blocks;
    },
    async exercises(ids) {
      calls.push(`exercises:${ids.join(",")}`);
      return [
        // `key`/`answer` simulate a leaky adapter: the mapping must drop them.
        { id: EX1, blockId: "b3", type: "choose", prompt: "Tanlang", payload: { items: [] }, checkMode: "auto", key: { x: 1 }, answer: "secret" },
        { id: EX2, blockId: "b2", type: "speaking", prompt: "Gapiring", payload: {}, checkMode: "review" },
        { id: "zz", blockId: "other", type: "choose", prompt: null, payload: {}, checkMode: "auto" },
      ].map((e) => ({ ...e, ...(opts.exercisesExtra ?? {}) })) as never;
    },
    async words() {
      return [{ id: W1, ru: "мама", stress: "ма́ма", uz: "ona" }];
    },
    async submittedExerciseIds() {
      return [EX2];
    },
  };
}

describe("getLessonPartWith", () => {
  it("orders blocks by position, hides unpublished ones and resolves the enrollment once", async () => {
    const db = fakeDb();
    const data = await getLessonPartWith(db, "s1", "p1");
    expect(data?.blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(db.calls.filter((c) => c === "enrollment")).toHaveLength(1);
    expect(data?.lesson).toEqual({ id: "l1", title: "Dars 1", objective: "Maqsad" });
    expect(data?.words).toEqual([{ id: W1, ru: "мама", stress: "ма́ма", uz: "ona" }]);
    expect(data?.nextPartId).toBe("p2");
    expect(data?.submittedExerciseIds).toEqual([EX2]);
    expect(data?.progress).toBeNull();
  });

  it("never exposes keys or answers, and only returns exercises owned by their block", async () => {
    const data = await getLessonPartWith(fakeDb(), "s1", "p1");
    expect(Object.keys(data!.exercises).sort()).toEqual([EX1, EX2].sort());
    expect(JSON.stringify(data)).not.toMatch(/secret|"key"|"answer"/);
    expect(Object.keys(data!.exercises[EX1]).sort()).toEqual(["checkMode", "id", "payload", "prompt", "type"]);
  });

  it("drops an exercise whose block is not the referencing block", async () => {
    const db = fakeDb({
      blocks: [{ id: "b1", position: 1, type: "exercise", payload: { exerciseId: EX1 }, published: true }],
    });
    const data = await getLessonPartWith(db, "s1", "p1");
    expect(data?.exercises[EX1]).toBeUndefined(); // EX1 belongs to b3, not b1
  });

  it("returns null for a locked part, an unknown part and a part without published blocks", async () => {
    expect(await getLessonPartWith(fakeDb(), "s1", "p2")).toBeNull(); // p1 not completed yet
    expect(await getLessonPartWith(fakeDb(), "s1", "nope")).toBeNull();
    expect(await getLessonPartWith(fakeDb({ published: ["p1"] }), "s1", "p2")).toBeNull();
    const draftOnly = fakeDb({ blocks: [{ id: "b", position: 1, type: "text", payload: { body: "x" }, published: false }] });
    expect(await getLessonPartWith(draftOnly, "s1", "p1")).toBeNull();
  });

  it("opens the second part once the first is completed and reports progress", async () => {
    const data = await getLessonPartWith(fakeDb({ progress: { p1: "completed", p2: "in_progress" } }), "s1", "p2");
    expect(data?.progress).toBe("in_progress");
    expect(data?.nextPartId).toBeNull();
    const first = await getLessonPartWith(fakeDb({ progress: { p1: "completed" } }), "s1", "p1");
    expect(first?.progress).toBe("completed");
  });

  it("marks unknown block types as unsupported instead of failing", async () => {
    const db = fakeDb({ blocks: [{ id: "b1", position: 1, type: "hologram", payload: {}, published: true }] });
    const data = await getLessonPartWith(db, "s1", "p1");
    expect(data?.blocks[0]).toMatchObject({ type: "unsupported" });
  });

  it("every adapter error is thrown, never swallowed", async () => {
    const db = fakeDb();
    db.blocks = async () => Promise.reject(new Error("lesson: blocks: boom"));
    await expect(getLessonPartWith(db, "s1", "p1")).rejects.toThrow(/boom/);
  });
});

// ---------------------------------------------------------------------------------------------
function fakeStore(over: Partial<AttemptStore> = {}): AttemptStore {
  return {
    getRole: async () => "student",
    getPartExercises: async () => [
      { id: EX1, type: "choose", checkMode: "auto", key: { a: 1, b: 0 } },
      { id: EX2, type: "speaking", checkMode: "review", key: null },
    ],
    getCorrectRefs: async () => [{ exerciseId: EX1, itemId: "a" }],
    getSubmittedExerciseIds: async () => [],
    ensurePartStarted: async () => undefined,
    markPartCompleted: async () => true,
    awardXp: async () => true,
    ...over,
  } as AttemptStore;
}

describe("handleCompleteRequest", () => {
  const canPlay = async () => true;
  const body = { partId: "44444444-4444-4444-8444-444444444444" };

  it("401 without a user, 403 for non-students, 400 for a bad body, 404 when not playable", async () => {
    expect((await handleCompleteRequest({ store: fakeStore(), canPlay }, { userId: null, body })).status).toBe(401);
    expect(
      (await handleCompleteRequest({ store: fakeStore({ getRole: async () => "curator" }), canPlay }, { userId: "u", body })).status,
    ).toBe(403);
    expect((await handleCompleteRequest({ store: fakeStore(), canPlay }, { userId: "u", body: { partId: "x" } })).status).toBe(400);
    expect((await handleCompleteRequest({ store: fakeStore(), canPlay }, { userId: "u", body: { ...body, extra: 1 } })).status).toBe(400);
    expect((await handleCompleteRequest({ store: fakeStore(), canPlay: async () => false }, { userId: "u", body })).status).toBe(404);
  });

  it("lists the exercises still missing (ids only) when the part cannot be completed", async () => {
    const r = await handleCompleteRequest({ store: fakeStore(), canPlay }, { userId: "u", body });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      completed: false,
      missing: [
        { exerciseId: EX1, kind: "exercise" },
        { exerciseId: EX2, kind: "speaking" },
      ],
    });
    expect(JSON.stringify(r.json)).not.toContain('"key"');
  });

  it("completes the part when everything is done and reports the XP granted", async () => {
    const store = fakeStore({
      getCorrectRefs: async () => [
        { exerciseId: EX1, itemId: "a" },
        { exerciseId: EX1, itemId: "b" },
      ],
      getSubmittedExerciseIds: async () => [EX2],
    });
    const r = await handleCompleteRequest({ store, canPlay }, { userId: "u", body });
    expect(r.json).toEqual({ completed: true, newlyCompleted: true, xpAwarded: 20 });
  });

  it("is idempotent: a second call grants no XP", async () => {
    const store = fakeStore({
      getCorrectRefs: async () => [
        { exerciseId: EX1, itemId: "a" },
        { exerciseId: EX1, itemId: "b" },
      ],
      getSubmittedExerciseIds: async () => [EX2],
      markPartCompleted: async () => false,
      awardXp: async () => false,
    });
    const r = await handleCompleteRequest({ store, canPlay }, { userId: "u", body });
    expect(r.json).toEqual({ completed: true, newlyCompleted: false, xpAwarded: 0 });
  });

  it("500 on unexpected failures without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await handleCompleteRequest(
      { store: fakeStore({ getPartExercises: async () => Promise.reject(new Error("db down: secret")) }), canPlay },
      { userId: "u", body },
    );
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toContain("secret");
  });
});

describe("handleAudioListened", () => {
  const blockId = "55555555-5555-4555-8555-555555555555";
  const audio = { id: blockId, type: "audio", payload: { path: "a.mp3", title: "A" } };
  const mk = (over: Partial<Parameters<typeof handleAudioListened>[0]> = {}) => ({
    getRole: async () => "student" as string | null,
    getVisibleBlock: async () => audio as { id: string; type: string; payload: unknown } | null,
    bumpAudioOnce: vi.fn(async () => true),
    ...over,
  });

  it("bumps for a visible audio block", async () => {
    const deps = mk();
    const r = await handleAudioListened(deps, { userId: "u", body: { blockId } });
    expect(r).toEqual({ status: 200, json: { ok: true, bumped: true } });
    expect(deps.bumpAudioOnce).toHaveBeenCalledWith("u");
  });

  it("401 / 403 / 400 / 404 and no bump for other block types or invisible blocks", async () => {
    const deps = mk();
    expect((await handleAudioListened(deps, { userId: null, body: { blockId } })).status).toBe(401);
    expect((await handleAudioListened(mk({ getRole: async () => "teacher" }), { userId: "u", body: { blockId } })).status).toBe(403);
    expect((await handleAudioListened(deps, { userId: "u", body: { blockId: "x" } })).status).toBe(400);
    const video = mk({ getVisibleBlock: async () => ({ id: blockId, type: "text", payload: { body: "x" } }) });
    expect((await handleAudioListened(video, { userId: "u", body: { blockId } })).status).toBe(404);
    const hidden = mk({ getVisibleBlock: async () => null });
    expect((await handleAudioListened(hidden, { userId: "u", body: { blockId } })).status).toBe(404);
    expect(deps.bumpAudioOnce).not.toHaveBeenCalled();
    expect(video.bumpAudioOnce).not.toHaveBeenCalled();
    expect(hidden.bumpAudioOnce).not.toHaveBeenCalled();
  });
});

describe("readLimitedJson", () => {
  it("caps the body at 4 KB", async () => {
    const big = new Request("http://x", { method: "POST", body: JSON.stringify({ a: "x".repeat(5000) }) });
    expect(await readLimitedJson(big)).toEqual({ ok: false, status: 413 });
    const small = new Request("http://x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(await readLimitedJson(small)).toEqual({ ok: true, body: { a: 1 } });
    expect(await readLimitedJson(new Request("http://x", { method: "POST", body: "{" }))).toEqual({ ok: false, status: 400 });
  });
});
